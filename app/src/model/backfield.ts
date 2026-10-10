// Backfield action (pure, no React): the QB, the back(s) and the line of a play are tied together by a handoff / fake /
// pitch precan, so the designer locks them. This module lets a play take that whole package from another play — any
// library play, or a FUSION play — whose QB and ball carriers stand on the same spots as this play's (the precans are
// timed to exact spots): a left zone handoff, a play-action fake, a jet fake, a plain dropback... It also brings that
// play's protection (the line), type, blocking scheme and run hole, so a run can become a play-action pass (or the
// other way round) in one pick. PRESETS name the common packages; FUSION packages are the ones only FUSION has.
import type { Catalog } from "./catalog";
import { leaf } from "./names";
import { isOffensiveLine, positionCode } from "./positions";
import { playTypeInfo, type PlayFamily } from "./playtypes";
import { isMechanics, stepsEqual } from "./steps";
import type { Asset, ReadDef, SetDef, Step } from "./types";
import { assignmentPath, normalizeReads, effectiveField, setPlayField, setSlotAssignment, setSlotSteps, type DesignerState } from "./designer";

/** Two spots are "the same" for a precan within this many yards. */
const SPOT_TOL = 0.4;

/** A play a package is taken from (a library play or a play cloned into a custom set, like FUSION's). */
export interface Donor {
  asset: Asset;
  name: string;
  set: Asset;
  playType: string;
  blocking: Asset;
  runHole: number;
  vip: number;
  reads: ReadDef[];
  /** A clone in a custom set (FUSION), not a game play. */
  custom: boolean;
}

/** One slot's replacement: a library assignment path, or (FUSION) its authored steps. */
export interface Swap {
  slot: number;
  path?: string;
  steps?: Step[];
}

export interface BackfieldAction {
  /** Identity of the package (same QB / backs / line / type), so plays that share one are listed once. */
  key: string;
  /** The play it is taken from (the best of `plays`). */
  play: Donor;
  /** Every play with this exact package. */
  plays: Donor[];
  family: PlayFamily;
  qb: Swap;
  swaps: Swap[];
  playType: string;
  /** Blocking scheme leaf. */
  blocking: string;
  runHole: number;
  /** Only FUSION has this package (some slot is an authored assignment). */
  fusion: boolean;
  /** Reads / primary receiver copied from the source play (only when it is a pass-type play whose receivers map onto ours). */
  reads?: ReadDef[];
  vip?: number;
}

const ROUTE_STEPS = new Set(["RunRoute", "OptionRoute", "HeadTurnRunRoute"]);
const FAMILY_ORDER: PlayFamily[] = ["run", "option", "pa", "rpo", "screen", "pass", "other"];

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const hasRoute = (steps: readonly Step[]) => steps.some((s) => ROUTE_STEPS.has(s.type));
const hasBlock = (steps: readonly Step[]) => steps.some((s) => /Block/.test(s.type));

/** A slot that is not the QB and not a lineman. */
function skillSlots(set: SetDef): number[] {
  const out: number[] = [];
  set.movements.Normal.forEach((a, i) => {
    if (i > 0 && positionCode(a.pos) !== "QB" && !isOffensiveLine(a.pos)) out.push(i);
  });
  return out;
}

/** Slot of `set` holding the same position (and depth) as `like`, among linemen. */
function lineMate(set: SetDef, like: { pos: string; depth: number }): number {
  return set.movements.Normal.findIndex((a) => isOffensiveLine(a.pos) && a.pos === like.pos && a.depth === like.depth);
}

interface DonorPlay extends Donor {
  steps: Step[][];
  /** Library assignment path per slot (undefined = authored). */
  paths: (string | undefined)[];
}

/** Every play packages can come from: the library's plays, then the plays cloned into custom sets. */
function donorPlays(catalog: Catalog): DonorPlay[] {
  const lib = catalog.lib;
  const stock = lib.stock ?? lib;
  const out: DonorPlay[] = [];
  for (const p of stock.playByAsset.values()) {
    if (!p.offensePlayType) continue;
    const steps = p.assignments.map((a) => lib.assignment(a)?.steps);
    if (steps.some((s) => !s)) continue;
    out.push({
      asset: p.asset,
      name: p.name,
      set: p.set,
      playType: p.offensePlayType,
      blocking: p.blocking,
      runHole: p.runHole,
      vip: p.vip,
      reads: p.reads,
      custom: false,
      steps: steps as Step[][],
      paths: p.assignments.map(assignmentPath),
    });
  }
  for (const rp of catalog.clones) {
    if (rp.side !== "offense" || !rp.playType || rp.problems.length) continue;
    out.push({
      asset: rp.asset,
      name: rp.name,
      set: rp.set,
      playType: rp.playType,
      blocking: rp.blocking,
      runHole: rp.runHole,
      vip: rp.vip,
      reads: rp.reads,
      custom: true,
      steps: rp.slots.map((s) => s.steps),
      paths: rp.slots.map((s) => (s.assignment && lib.assignment(s.assignment) ? assignmentPath(s.assignment) : undefined)),
    });
  }
  return out;
}

const donorCache = new WeakMap<Catalog, DonorPlay[]>();

export function backfieldActions(state: DesignerState, catalog: Catalog): BackfieldAction[] {
  const lib = catalog.lib;
  const set = state.set;
  if (!set || !state.base) return [];
  let donors = donorCache.get(catalog);
  if (!donors) donorCache.set(catalog, (donors = donorPlays(catalog)));
  const N = set.movements.Normal;
  const mine = skillSlots(set);
  const myLine = N.map((a, i) => (isOffensiveLine(a.pos) ? i : -1)).filter((i) => i >= 0);
  const mech = mine.filter((k) => state.slots[k]?.steps.some(isMechanics));
  const baseAsset = state.base.asset;

  const groups = new Map<string, BackfieldAction>();
  const setOk = new Map<Asset, SetDef | undefined>();
  const donorSet = (asset: Asset): SetDef | undefined => {
    if (setOk.has(asset)) return setOk.get(asset);
    const s = lib.setByAsset.get(asset);
    let ok = !!s && s.movements?.Normal?.length === N.length;
    if (ok && s) {
      const f = lib.formationOfSet(asset);
      ok = !!f && lib.formationSide(f) === "offense" && !lib.isMinigame(f) && dist(s.movements.Normal[0], N[0]) <= SPOT_TOL && positionCode(s.movements.Normal[0].pos) === "QB";
    }
    setOk.set(asset, ok ? s : undefined);
    return ok ? s : undefined;
  };
  const nearest = (from: { x: number; y: number }, cands: number[], pos: (i: number) => { x: number; y: number }, taken: (i: number) => boolean) => {
    let best = -1;
    let bd = SPOT_TOL;
    for (const c of cands) {
      if (taken(c)) continue;
      const d = dist(from, pos(c));
      if (d <= bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  };
  const sameFormation = (d: Donor) => lib.setByAsset.get(d.set)?.formation === set.formation;

  for (const p of donors) {
    if (p.asset === baseAsset || p.steps.length !== N.length) continue;
    const ds = donorSet(p.set);
    if (!ds) continue;
    const dN = ds.movements.Normal;
    const dSkill = skillSlots(ds);
    const dSteps = p.steps;
    const dMech = dSkill.filter((j) => dSteps[j].some(isMechanics));

    // Pair our backs / ballcarriers with theirs by spot (every mechanics slot on either side needs a partner).
    const pair = new Map<number, number>(); // ours → theirs
    const usedD = new Set<number>();
    let ok = true;
    for (const j of dMech) {
      const k = nearest(dN[j], mine, (i) => N[i], (i) => pair.has(i));
      if (k < 0) {
        ok = false;
        break;
      }
      pair.set(k, j);
      usedD.add(j);
    }
    if (!ok) continue;
    for (const k of mech) {
      if (pair.has(k)) continue;
      const j = nearest(N[k], dSkill, (i) => dN[i], (i) => usedD.has(i));
      if (j < 0) {
        ok = false;
        break;
      }
      pair.set(k, j);
      usedD.add(j);
    }
    if (!ok) continue;
    // Blockers who stay in the formation take the source's block (run blocking on a run, pass blocking on a pass).
    for (const k of mine) {
      if (pair.has(k) || hasRoute(state.slots[k].steps)) continue;
      const j = nearest(N[k], dSkill, (i) => dN[i], (i) => usedD.has(i));
      if (j >= 0 && !hasRoute(dSteps[j]) && hasBlock(dSteps[j])) {
        pair.set(k, j);
        usedD.add(j);
      }
    }

    // ours → theirs for the slots the action rewrites (the QB first, then backs, blockers and the line)
    const taken: [number, number][] = [[0, 0], ...pair];
    for (const k of myLine) {
      const j = lineMate(ds, N[k]);
      if (j >= 0) taken.push([k, j]);
    }
    taken.sort((a, b) => a[0] - b[0]);
    // A swapped back who just runs a route in an authored assignment is that play's own route, not a backfield action.
    if (taken.some(([k, j]) => k > 0 && k < 6 && !p.paths[j] && !dSteps[j].some(isMechanics) && hasRoute(dSteps[j]))) continue;
    // Already exactly this (nothing would change)?
    if (taken.every(([k, j]) => stepsEqual(state.slots[k].steps, dSteps[j])) && effectiveField(state, "playType") === p.playType) continue;
    const all: Swap[] = taken.map(([k, j]) => (p.paths[j] ? { slot: k, path: p.paths[j] } : { slot: k, steps: dSteps[j] }));
    const [qb, ...swaps] = all;

    const family = playTypeInfo(p.playType).family;
    const key = JSON.stringify([all.map((s) => [s.slot, s.path ?? s.steps]), p.playType, leaf(p.blocking), p.runHole]);
    const hit = groups.get(key);
    if (hit) {
      // Show the play from this formation when the package comes from several.
      if (sameFormation(p) && !sameFormation(hit.play)) hit.play = p;
      hit.plays.push(p);
      continue;
    }
    const action: BackfieldAction = {
      key,
      play: p,
      plays: [p],
      family,
      qb,
      swaps,
      playType: p.playType,
      blocking: leaf(p.blocking),
      runHole: p.runHole,
      fusion: all.some((s) => !s.path),
    };
    // A pass-type source brings its reads when every receiver it reads maps onto one of ours by spot.
    if (family !== "run" && family !== "option" && p.reads.length) {
      const map = (j: number) => nearest(dN[j], mine, (i) => N[i], () => false);
      const mapped = p.reads.map((r) => ({ ...r, pos: map(r.pos) }));
      const vip = map(p.vip);
      if (mapped.every((r) => r.pos >= 0) && vip >= 0) {
        action.reads = mapped;
        action.vip = vip;
      }
    }
    groups.set(key, action);
  }
  // Kind of play, then game packages before FUSION's, plays from this formation first (their blocking and spots fit
  // best), then the most common.
  const near = (a: BackfieldAction) => (a.plays.some(sameFormation) ? 0 : 1);
  return [...groups.values()].sort(
    (a, b) =>
      FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family) ||
      Number(a.fusion) - Number(b.fusion) ||
      near(a) - near(b) ||
      b.plays.length - a.plays.length ||
      a.play.name.localeCompare(b.play.name),
  );
}

const putSwap = (state: DesignerState, catalog: Catalog, s: Swap): DesignerState =>
  s.path ? setSlotAssignment(state, catalog.lib, s.slot, s.path) : setSlotSteps(state, s.slot, s.steps ?? []);

/** Take the action: QB, backs and line from the source play, plus its type, blocking, run hole (and reads when this play has none). */
export function applyBackfieldAction(state: DesignerState, action: BackfieldAction, catalog: Catalog): DesignerState {
  let next = putSwap(state, catalog, action.qb);
  for (const s of action.swaps) next = putSwap(next, catalog, s);
  next = setPlayField(next, "playType", action.playType);
  next = setPlayField(next, "blocking", action.blocking);
  next = setPlayField(next, "runHole", action.runHole);
  const noReads = effectiveField<ReadDef[]>(state, "reads")?.length === 0 || effectiveField<ReadDef[] | undefined>(state, "reads") === undefined;
  if (action.reads && noReads) {
    next = setPlayField(next, "reads", normalizeReads(action.reads));
    if (action.vip !== undefined) next = setPlayField(next, "vip", action.vip);
  }
  return next;
}

/** Back to what the base play does: its QB / backs / line and its type, blocking, run hole, reads and primary receiver. */
export function resetBackfield(state: DesignerState): DesignerState {
  let next = state;
  for (const i of backfieldSlots(state)) {
    const base = next.baseSlots[i];
    if (base && next.slots[i]) next = { ...next, slots: next.slots.map((s, k) => (k === i ? { steps: base } : s)) };
  }
  for (const key of ["playType", "blocking", "runHole", "vip", "reads"] as const) next = setPlayField(next, key, undefined);
  return next;
}

/** True when the play's backfield differs from the base play's (an action was applied or the slots were edited). */
export function backfieldChanged(state: DesignerState): boolean {
  return backfieldSlots(state).some((i) => !stepsEqual(state.slots[i]?.steps ?? [], state.baseSlots[i] ?? []));
}

/** The slots a backfield action rewrites: the QB, every backfield / mechanics slot and the line. */
export function backfieldSlots(state: DesignerState): number[] {
  const set = state.set;
  if (!set) return [];
  const out: number[] = [0];
  set.movements.Normal.forEach((a, i) => {
    if (i === 0) return;
    if (isOffensiveLine(a.pos) || state.slots[i]?.steps.some(isMechanics) || state.baseSlots[i]?.some(isMechanics)) out.push(i);
  });
  return out;
}

// ───────────────────────────── presets ─────────────────────────────

export interface BackfieldPreset {
  id: string;
  label: string;
  group: "Run" | "Option" | "Pass";
  /** Which of the packages that fit this play's spots belong to the preset. */
  match(a: BackfieldAction): boolean;
}

const type = (re: RegExp) => (a: BackfieldAction) => re.test(a.playType.replace(/^OffensePlayType_/, ""));
/** Run direction from the hole (odd = left, even = right; the middle counts for both). */
const left = (a: BackfieldAction) => a.runHole % 2 === 1 || a.runHole === 0;
const right = (a: BackfieldAction) => a.runHole % 2 === 0;
const qbLeaf = (a: BackfieldAction) => (a.qb.path ? leaf(a.qb.path) : "");

export const BACKFIELD_PRESETS: BackfieldPreset[] = [
  { id: "inside-zone-l", label: "Inside Zone Left", group: "Run", match: (a) => type(/^RunInsideZone$/)(a) && left(a) },
  { id: "inside-zone-r", label: "Inside Zone Right", group: "Run", match: (a) => type(/^RunInsideZone$/)(a) && right(a) },
  { id: "outside-zone-l", label: "Outside Zone Left", group: "Run", match: (a) => type(/^RunOutsideZone$/)(a) && left(a) },
  { id: "outside-zone-r", label: "Outside Zone Right", group: "Run", match: (a) => type(/^RunOutsideZone$/)(a) && right(a) },
  { id: "power-l", label: "Power Left", group: "Run", match: (a) => type(/^RunPower$/)(a) && left(a) },
  { id: "power-r", label: "Power Right", group: "Run", match: (a) => type(/^RunPower$/)(a) && right(a) },
  { id: "counter-l", label: "Counter Left", group: "Run", match: (a) => type(/^RunCounter$/)(a) && left(a) },
  { id: "counter-r", label: "Counter Right", group: "Run", match: (a) => type(/^RunCounter$/)(a) && right(a) },
  { id: "dive", label: "Dive / Iso", group: "Run", match: type(/^(RunInsideTackle|RunOutsideTackle|RunISO)$/) },
  { id: "trap", label: "Trap", group: "Run", match: type(/^RunTrap$/) },
  { id: "draw", label: "Draw", group: "Run", match: type(/^RunDraw$/) },
  { id: "toss", label: "Toss / Pitch", group: "Run", match: type(/^(RunPitch|RunSweep)$/) },
  { id: "fb-dive", label: "Fullback Dive", group: "Run", match: type(/^RunFB$/) },
  { id: "sneak", label: "QB Sneak", group: "Run", match: type(/^QBSneak$/) },
  { id: "read-option", label: "Read Option", group: "Option", match: type(/^OptionZoneRead$/) },
  { id: "jet-sweep", label: "Jet Sweep", group: "Option", match: type(/^JetSweep$/) },
  { id: "rpo", label: "RPO", group: "Option", match: type(/^RPO/) },
  { id: "dropback", label: "Dropback", group: "Pass", match: (a) => a.family === "pass" && type(/^(Pass|Pass[1357]Step|PassShotgun)$/)(a) },
  { id: "play-action", label: "Play Action", group: "Pass", match: (a) => a.family === "pa" && !/Boot|Sprint|Roll|Waggle|Leak/i.test(qbLeaf(a)) },
  { id: "pa-boot", label: "Play Action Boot", group: "Pass", match: (a) => a.family === "pa" && /Boot|Sprint|Roll|Waggle|Leak/i.test(qbLeaf(a)) },
  { id: "rollout", label: "Rollout", group: "Pass", match: type(/^PassRollout$/) },
  { id: "screen", label: "Screen", group: "Pass", match: type(/^(PassScreen|PAScreenPass)$/) },
];

/** The packages that fit this play for each preset (best first; empty = nothing in the game fits these spots). */
export function presetFits(actions: readonly BackfieldAction[]): Map<string, BackfieldAction[]> {
  return new Map(BACKFIELD_PRESETS.map((p) => [p.id, actions.filter((a) => p.match(a))]));
}
