// Backfield action (pure, no React): the QB, the back(s) and the line of a play are tied together by a handoff / fake /
// pitch precan, so the designer locks them. This module lets a play take that whole package from ANY library play whose
// QB and ball carriers stand on the same spots as this play's (the precans are timed to exact spots): a left zone
// handoff, a play-action fake, a jet fake, a plain dropback... It also brings that play's protection (the line), type,
// blocking scheme and run hole, so a run can become a play-action pass (or the other way round) in one pick.
import type { Catalog } from "./catalog";
import { leaf } from "./names";
import { isOffensiveLine, positionCode } from "./positions";
import { playTypeInfo, type PlayFamily } from "./playtypes";
import { isMechanics, stepsEqual } from "./steps";
import type { Asset, PlayDef, ReadDef, SetDef, Step } from "./types";
import { assignmentPath, normalizeReads, effectiveField, setPlayField, setSlotAssignment, type DesignerState } from "./designer";

/** Two spots are "the same" for a precan within this many yards. */
const SPOT_TOL = 0.4;

export interface BackfieldAction {
  /** Identity of the package (same QB / backs / line / type), so plays that share one are listed once. */
  key: string;
  /** The play it is taken from (the first of `plays`). */
  play: PlayDef;
  /** Every library play with this exact package (`play` is the one shown: the first from this formation, else the first). */
  plays: PlayDef[];
  family: PlayFamily;
  /** Assignment paths (under the assignment root) for slot 0 and each other slot the action rewrites. */
  qb: string;
  swaps: { slot: number; path: string }[];
  playType: string;
  /** Blocking scheme leaf. */
  blocking: string;
  runHole: number;
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

export function backfieldActions(state: DesignerState, catalog: Catalog): BackfieldAction[] {
  const lib = catalog.lib;
  const stock = lib.stock ?? lib;
  const set = state.set;
  if (!set || !state.base) return [];
  const N = set.movements.Normal;
  const mine = skillSlots(set);
  const myLine = N.map((a, i) => (isOffensiveLine(a.pos) ? i : -1)).filter((i) => i >= 0);
  const mech = mine.filter((k) => state.slots[k]?.steps.some(isMechanics));
  const steps = (path: string) => lib.assignment(path)?.steps;
  const baseAsset = state.base.asset;

  const groups = new Map<string, BackfieldAction>();
  const setOk = new Map<Asset, SetDef | undefined>();
  const donorSet = (asset: Asset): SetDef | undefined => {
    if (setOk.has(asset)) return setOk.get(asset);
    const s = stock.setByAsset.get(asset);
    let ok = !!s && s.movements?.Normal?.length === N.length;
    if (ok && s) {
      const f = stock.formationOfSet(asset);
      ok = !!f && stock.formationSide(f) === "offense" && !stock.isMinigame(f) && dist(s.movements.Normal[0], N[0]) <= SPOT_TOL && positionCode(s.movements.Normal[0].pos) === "QB";
    }
    setOk.set(asset, ok ? s : undefined);
    return ok ? s : undefined;
  };

  for (const p of stock.playByAsset.values()) {
    if (p.asset === baseAsset || !p.offensePlayType || p.assignments.length !== N.length) continue;
    const ds = donorSet(p.set);
    if (!ds) continue;
    const dN = ds.movements.Normal;
    const dSkill = skillSlots(ds);
    const dSteps = p.assignments.map((a) => steps(a));
    if (dSteps.some((s) => !s)) continue;
    const dMech = dSkill.filter((j) => dSteps[j]!.some(isMechanics));

    // Pair our backs / ballcarriers with theirs by spot (every mechanics slot on either side needs a partner).
    const pair = new Map<number, number>(); // ours → theirs
    const usedD = new Set<number>();
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
      if (j >= 0 && !hasRoute(dSteps[j]!) && hasBlock(dSteps[j]!)) {
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
    // Already exactly this (nothing would change)?
    if (taken.every(([k, j]) => stepsEqual(state.slots[k].steps, dSteps[j]!)) && effectiveField(state, "playType") === p.offensePlayType) continue;
    const qb = assignmentPath(p.assignments[0]);
    const swaps = taken.slice(1).map(([k, j]) => ({ slot: k, path: assignmentPath(p.assignments[j]) }));

    const family = playTypeInfo(p.offensePlayType).family;
    const key = JSON.stringify([qb, swaps.map((s) => [s.slot, s.path]), p.offensePlayType, leaf(p.blocking), p.runHole]);
    const hit = groups.get(key);
    if (hit) {
      // Show the play from this formation when the package comes from several.
      if (ds.formation === set.formation && stock.setByAsset.get(hit.play.set)?.formation !== set.formation) hit.play = p;
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
      playType: p.offensePlayType,
      blocking: leaf(p.blocking),
      runHole: p.runHole,
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
  // Kind of play, then plays from this formation first (their blocking and spots fit best), then the most common.
  const near = (a: BackfieldAction) => (a.plays.some((p) => stock.setByAsset.get(p.set)?.formation === set.formation) ? 0 : 1);
  return [...groups.values()].sort(
    (a, b) =>
      FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family) || near(a) - near(b) || b.plays.length - a.plays.length || a.play.name.localeCompare(b.play.name),
  );
}

/** Take the action: QB, backs and line from the source play, plus its type, blocking, run hole (and reads when this play has none). */
export function applyBackfieldAction(state: DesignerState, action: BackfieldAction, catalog: Catalog): DesignerState {
  const lib = catalog.lib;
  let next = setSlotAssignment(state, lib, 0, action.qb);
  for (const s of action.swaps) next = setSlotAssignment(next, lib, s.slot, s.path);
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
