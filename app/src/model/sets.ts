// Custom formations and sets (FORMATS.md §5, playbooks/sets/*.json), built game-side by tools/PlayDump/SetBuilder.cs
// into the same mod as the custom plays. Pure model: effective alignment (base Normal + `positions`), flipped spots,
// motion-preset target edits, minimal diffs back to the spec, validation that mirrors SetBuilder, the custom
// FormationDefs / SetDefs the catalog overlays on the library (customDefs), name/asset generation, depth classes,
// split/depth presets and dependency warnings for plays cloned into a custom set.
//
// Spec semantics (exactly what SetBuilder does):
// - `positions[]` entries hold only the fields that differ from the base set's Normal alignment for that slot: x, y,
//   stance, facing, flipAssign, motionMan. Entries apply in file order (a repeated slot: the later field wins).
// - Every player's FLIPPED spot is recomputed from its flipAssign partner: fx = −x[partner], fy = y[partner],
//   facing 180 − facing[partner], stance of the partner (flippedAlignment).
// - `movements[K][]` only edits the target spot (x AND y, both required) of a slot that the base set's preset K already
//   moves. Presets can't be added and a preset can't move another slot (the builder throws); stance/facing of a
//   preset target are ignored.
// - Validation errors = what makes the builder throw (or can't work in the game): 11 players, exactly 7 non-QB players
//   with y > −1.5, bad references/assets/names, unknown presets/slots. OL spacing and the QB/HB depth class are warnings.
// - Assets: a custom formation is Formations/Offense/<asset>/<asset>; a custom set <formation folder>/<asset>/<asset>;
//   a play cloned into it <set folder>/<asset>. A set references a custom formation by that FULL path. Ids are the
//   builder's FNV-1a ids (gameId), so they match research/index/custom-*.tsv.
import type { LibraryIndex } from "./library";
import { folder, leaf, maddenName, norm, sanitizeAssetLeaf, uniqueName } from "./names";
import { glyphFor, isEligible, positionCode, positionName, slotLabel } from "./positions";
import { isMechanics } from "./steps";
import {
  PLAYLIBRARY_ROOT,
  type AlignmentPos,
  type Asset,
  type CloneSpec,
  type CustomFormationSpec,
  type CustomSetSpec,
  type FormationDef,
  type PlayDef,
  type SetDef,
  type SetsFile,
  type SlotPosition,
  type Step,
  type ValidationIssue,
} from "./types";

// ───────────────────────────── constants ─────────────────────────────

export const SETS_DIR = "playbooks/sets/";
export const NORMAL = "Normal";
export const PLAYER_COUNT = 11;
export const LINE_COUNT = 7;

/** SetBuilder: a non-QB player is on the line of scrimmage when y > −1.5 (strictly). */
export const LINE_Y = -1.5;
/**
 * On the line ⇔ LINE_BAND.min < y ≤ LINE_BAND.max (min is exclusive: a tackle at exactly −1.5 is OFF the line for the
 * builder). y > max is past the line of scrimmage.
 */
export const LINE_BAND = { min: LINE_Y, max: 0 } as const;
/** Kept for older callers: at or behind this depth a player is clearly off the line. */
export const OFF_LINE_MAX = -2;
/** Players closer than this (yd) are "on the same spot" (the library's closest pair is 0.8 yd). */
export const SAME_SPOT_YD = 0.5;
/** SetBuilder's OL spots for slots 6–10 (LT LG C RG RT) and the tolerance before it warns. */
export const OL_SPOTS = [-3.333, -1.666, 0, 1.666, 3.333] as const;
export const OL_SPOT_TOLERANCE = 0.25;
/** OL depth changes up to this much aren't reported (the "move onto the line" fix nudges −1.5 → −1.4). */
export const OL_DEPTH_TOLERANCE = 0.15;
/** Coordinates are written rounded to this many decimals (the library uses up to 3: 3.333, 7.375). */
export const COORD_DECIMALS = 3;
const EPS = 0.0005;

/** Standard alignment depths (FORMATS.md "Coordinates and units"). */
export const DEPTHS = {
  onLine: -0.8,
  tightEnd: -1.2,
  offLine: -2.2,
  underCenter: -1.4,
  pistol: -4,
  shotgun: -6,
  fullback: -4.75,
  tailback: -7.375,
} as const;

/** Lateral spots (yd from the ball). */
export const SPLITS = {
  tackle: 3.333,
  olStep: 1.667,
  slot: 10.5,
  numbers: 15.5,
  wide: 16.25,
  /** The far hash when the ball sits on a hash (2 × 3.08 yd). */
  hash: 6.167,
  /** "2 yd outside the TE". */
  outsideTe: 2,
} as const;

/** Where SetBuilder creates custom formations. */
export const OFFENSE_FORMATIONS_ROOT = PLAYLIBRARY_ROOT + "Formations/Offense/";

const ASSET_RE = /^[A-Za-z0-9_]+$/;
/** Fields a `positions` entry may change (SetBuilder applies exactly these). */
export const POSITION_FIELDS = ["x", "y", "stance", "facing", "flipAssign", "motionMan"] as const;
export type PositionField = (typeof POSITION_FIELDS)[number];
/** Fields of a motion-preset target the builder reads (both required). */
export const PRESET_FIELDS = ["x", "y"] as const;

export type SlotPatch = Partial<Pick<AlignmentPos, PositionField>>;

export type SetsInput = { path: string; data: SetsFile | null | undefined };

// ───────────────────────────── small helpers ─────────────────────────────

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isSlot = (v: unknown, n: number): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < n;
export const roundCoord = (n: number): number => {
  const k = 10 ** COORD_DECIMALS;
  const r = Math.round(n * k) / k;
  return Object.is(r, -0) ? 0 : r;
};
const sameNum = (a: number, b: number) => Math.abs(a - b) < EPS;
const fieldEq = (f: PositionField, a: unknown, b: unknown): boolean => {
  if (f === "x" || f === "y" || f === "facing") return isNum(a) && isNum(b) && sameNum(a, b);
  if (f === "motionMan") return !!a === !!b;
  return a === b;
};
const fmt = (n: number) => (Math.round(n * 100) / 100).toString();
const neg = (n: number) => (n === 0 ? 0 : -n);
const mod360 = (n: number) => ((n % 360) + 360) % 360;

/** Normal alignment of a set (empty array when missing). */
export function normalOf(set: SetDef): AlignmentPos[] {
  return Array.isArray(set?.movements?.Normal) ? set.movements.Normal : [];
}

/** Slot label as the art engine prints it ("WR1", "TE1", "LT"). */
export function playerLabel(a: Pick<AlignmentPos, "pos" | "depth">): string {
  return slotLabel(a.pos, a.depth);
}

/** True for offensive linemen (incl. the center). */
export function isLineman(a: Pick<AlignmentPos, "pos" | "group">): boolean {
  const g = glyphFor(a);
  return g === "ol" || g === "center";
}

export function isQB(a: Pick<AlignmentPos, "pos" | "group">): boolean {
  return glyphFor(a) === "qb";
}

/** HB / FB style backs (3DRB, PWHB count as HB). */
export function isBack(a: Pick<AlignmentPos, "pos">): boolean {
  const c = positionCode(a.pos);
  return c === "HB" || c === "FB";
}

export function isTightEnd(a: Pick<AlignmentPos, "pos">): boolean {
  return positionCode(a.pos) === "TE";
}

/**
 * On the line of scrimmage as SetBuilder counts it: not the QB (depth position POSITION_QB) and y > −1.5. Players past
 * the LOS count too (validation flags them separately).
 */
export function onLine(a: Pick<AlignmentPos, "pos" | "group" | "y">): boolean {
  return a.pos !== "POSITION_QB" && !isQB(a) && isNum(a.y) && a.y > LINE_Y;
}

// ───────────────────────────── asset paths and game ids ─────────────────────────────

export const isValidAsset = (s: unknown): s is string => typeof s === "string" && ASSET_RE.test(s);

/** Full asset of a custom formation: Formations/Offense/<leaf>/<leaf> (SetBuilder FormationRoot). */
export function customFormationAsset(assetLeaf: string): Asset {
  return `${OFFENSE_FORMATIONS_ROOT}${assetLeaf}/${assetLeaf}`;
}

/** Full asset of a custom set: <formation folder>/<asset>/<asset> (undefined unless `formation` is a full path). */
export function customSetAsset(spec: Pick<CustomSetSpec, "asset" | "formation">): Asset | undefined {
  if (typeof spec?.formation !== "string" || !spec.formation.includes("/") || !isValidAsset(spec.asset)) return undefined;
  return `${folder(spec.formation)}${spec.asset}/${spec.asset}`;
}

/** PlayKey of a play cloned into a custom set: <set folder>/<leaf>. */
export function cloneAsset(setAsset: Asset, cloneLeaf: string): Asset {
  return folder(setAsset) + cloneLeaf;
}

const UTF8 = new TextEncoder();

/**
 * PlayBuilder.NewId: FNV-1a (32-bit) over the lowercased UTF-8 asset name, re-hashed past values < 100000 and ids in
 * `taken` (which receives the result). Formations use `gameId(asset, taken) & 0x7fffffff`.
 */
export function gameId(name: string, taken?: Set<number>): number {
  let h = 2166136261;
  for (const b of UTF8.encode(name.toLowerCase())) {
    h = (h ^ b) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  while (h < 100000 || (taken && taken.has(h))) h = (Math.imul(h, 16777619) + 1) >>> 0;
  taken?.add(h);
  return h;
}

// ───────────────────────────── depth classes ─────────────────────────────

export type DepthClass = "under-center" | "pistol" | "shotgun";

export const DEPTH_CLASS_LABEL: Record<DepthClass, string> = {
  "under-center": "Under center",
  pistol: "Pistol",
  shotgun: "Shotgun",
};

export const QB_DEPTH: Record<DepthClass, number> = {
  "under-center": DEPTHS.underCenter,
  pistol: DEPTHS.pistol,
  shotgun: DEPTHS.shotgun,
};

/**
 * QB depth class from its y: under center (> −3), pistol (−3 … −4.875) or shotgun (≤ −4.875). The library has
 * under-center QBs at −1.4, pistol at −4.75 and shotgun at −5 / −6.
 */
export function depthClass(qbY: number): DepthClass {
  if (qbY > -3) return "under-center";
  if (qbY > -4.875) return "pistol";
  return "shotgun";
}

export type BackDepth = "line" | "wing" | "fullback" | "gun" | "tailback";

export const BACK_DEPTH_LABEL: Record<BackDepth, string> = {
  line: "on the line",
  wing: "wing depth (−1.5 … −3.25)",
  fullback: "fullback / pistol depth (−3.25 … −4.875)",
  gun: "shotgun depth (−4.875 … −6.75)",
  tailback: "tailback depth (≤ −6.75)",
};

/** Depth band of a back (HB / FB) so handoffs keep their timing. */
export function backDepth(y: number): BackDepth {
  if (y > LINE_Y) return "line";
  if (y > -3.25) return "wing";
  if (y > -4.875) return "fullback";
  if (y > -6.75) return "gun";
  return "tailback";
}

/** The set's depth class from its QB (undefined when the set has no QB). */
export function setDepthClass(normal: AlignmentPos[]): DepthClass | undefined {
  const qb = normal.find(isQB);
  return qb ? depthClass(qb.y) : undefined;
}

// ───────────────────────────── effective alignment ─────────────────────────────

/** `positions` / preset entries merged per slot in file order (later fields win, like the builder applying both). */
function entriesBySlot(list: unknown): Map<number, SlotPosition> {
  const out = new Map<number, SlotPosition>();
  if (!Array.isArray(list)) return out;
  for (const e of list) {
    if (!isObj(e) || !Number.isInteger(e.slot)) continue;
    const slot = e.slot as number;
    out.set(slot, { ...(out.get(slot) ?? {}), ...(e as SlotPosition), slot });
  }
  return out;
}

function applyEntry(a: AlignmentPos, e: SlotPosition | undefined, n: number): AlignmentPos {
  if (!e) return a;
  const out = { ...a };
  if (isNum(e.x)) out.x = e.x;
  if (isNum(e.y)) out.y = e.y;
  if (typeof e.stance === "string" && e.stance) out.stance = e.stance;
  if (isNum(e.facing)) out.facing = e.facing;
  if (isSlot(e.flipAssign, n)) out.flipAssign = e.flipAssign;
  if (typeof e.motionMan === "boolean") out.motionMan = e.motionMan;
  return out;
}

/** Base Normal alignment with the spec's `positions` applied (same slot order; `slot` set on every entry). */
export function effectiveNormal(base: SetDef, spec: Pick<CustomSetSpec, "positions">): AlignmentPos[] {
  const entries = entriesBySlot(spec?.positions);
  const normal = normalOf(base);
  return normal.map((a, slot) => {
    const out = applyEntry(a, entries.get(slot), normal.length);
    return out.slot === slot ? out : { ...out, slot };
  });
}

/** The effective Normal alignment of a custom set (its base from the library), or undefined when the base is unknown. */
export function effectiveAlignment(spec: Pick<CustomSetSpec, "base" | "positions">, lib: LibraryIndex): AlignmentPos[] | undefined {
  const base = typeof spec?.base === "string" ? (lib.stock ?? lib).setByAsset.get(spec.base) : undefined;
  return base ? effectiveNormal(base, spec) : undefined;
}

/** Index of a player's flip partner (itself when flipAssign is missing or out of range). */
export function flipPartner(alignment: readonly AlignmentPos[], slot: number): number {
  const p = alignment[slot]?.flipAssign;
  return isSlot(p, alignment.length) ? p : slot;
}

/**
 * The alignment of a FLIPPED play, as SetBuilder writes it: every player takes his flipAssign partner's spot, mirrored
 * (x = −x[partner], y = y[partner], facing = 180 − facing[partner], stance of the partner).
 */
export function flippedAlignment(alignment: readonly AlignmentPos[]): AlignmentPos[] {
  return alignment.map((a, slot) => {
    const p = alignment[flipPartner(alignment, slot)];
    return { ...a, x: neg(p.x), y: p.y, facing: mod360(180 - (isNum(p.facing) ? p.facing : 90)), stance: p.stance };
  });
}

// ───────────────────────────── motion presets ─────────────────────────────

/** Preset keys of the base set (everything but Normal), in data order. */
export function basePresetKeys(base: SetDef): string[] {
  return Object.keys(base?.movements ?? {}).filter((k) => k !== NORMAL && Array.isArray(base.movements[k]));
}

/**
 * Preset keys a custom set has: the base set's (presets can't be added — FORMATS.md §5). `spec` is accepted for
 * older callers; keys only the spec has are invalid (see invalidPresetKeys).
 */
export function presetKeys(base: SetDef, _spec?: Pick<CustomSetSpec, "movements">): string[] {
  return basePresetKeys(base);
}

/** `movements` keys the base set doesn't have (the builder throws "base set has no motion preset …"). */
export function invalidPresetKeys(base: SetDef, spec: Pick<CustomSetSpec, "movements">): string[] {
  const m = spec?.movements;
  return isObj(m) ? Object.keys(m).filter((k) => !isBasePreset(base, k)) : [];
}

export function isBasePreset(base: SetDef, key: string): boolean {
  return key !== NORMAL && Array.isArray(base?.movements?.[key]);
}

/**
 * Library preset entries matched to Normal slots: by `slot` (2026-10-04 export), falling back to the first unmatched
 * slot with the same (pos, depth) for older data. Unmatched entries are dropped.
 */
export function matchPresetToSlots(normal: readonly AlignmentPos[], preset: readonly AlignmentPos[] | undefined): (AlignmentPos | undefined)[] {
  const out: (AlignmentPos | undefined)[] = normal.map(() => undefined);
  if (!Array.isArray(preset)) return out;
  for (const p of preset) {
    if (!p) continue;
    const i = isSlot(p.slot, normal.length) && !out[p.slot] ? p.slot : normal.findIndex((n, k) => !out[k] && n.pos === p.pos && n.depth === p.depth);
    if (i >= 0) out[i] = p;
  }
  return out;
}

/** Slots the base set's preset `key` moves (slot order). Empty for Normal or an unknown key. */
export function presetSlots(base: SetDef, key: string): number[] {
  if (!isBasePreset(base, key)) return [];
  return matchPresetToSlots(normalOf(base), base.movements[key]).flatMap((a, i) => (a ? [i] : []));
}

/**
 * Effective preset `key` per slot: undefined = the slot doesn't move in this preset. Base preset targets with the
 * spec's `movements[key]` x/y applied (only to slots the preset moves). Normal → the effective Normal.
 */
export function effectivePreset(base: SetDef, spec: Pick<CustomSetSpec, "positions" | "movements">, key: string): (AlignmentPos | undefined)[] {
  if (key === NORMAL) return effectiveNormal(base, spec);
  const targets = matchPresetToSlots(normalOf(base), isBasePreset(base, key) ? base.movements[key] : undefined);
  const entries = entriesBySlot(spec?.movements?.[key]);
  return targets.map((t, slot) => {
    if (!t) return undefined;
    const e = entries.get(slot);
    return { ...t, slot, x: isNum(e?.x) ? e.x : t.x, y: isNum(e?.y) ? e.y : t.y };
  });
}

/** Alignment shown for a preset: moving slots at their preset spot, everyone else at Normal. */
export function presetAlignment(base: SetDef, spec: Pick<CustomSetSpec, "positions" | "movements">, key: string): AlignmentPos[] {
  const normal = effectiveNormal(base, spec);
  if (key === NORMAL) return normal;
  const pre = effectivePreset(base, spec, key);
  return normal.map((a, i) => pre[i] ?? a);
}

/** The movements of the built set: effective Normal + every base preset (overridden targets applied). */
export function effectiveMovements(base: SetDef, spec: Pick<CustomSetSpec, "positions" | "movements">): Record<string, AlignmentPos[]> {
  const movements: Record<string, AlignmentPos[]> = { [NORMAL]: effectiveNormal(base, spec) };
  for (const key of basePresetKeys(base)) {
    movements[key] = Array.isArray(spec?.movements?.[key])
      ? effectivePreset(base, spec, key).filter((a): a is AlignmentPos => !!a)
      : base.movements[key];
  }
  return movements;
}

/** The SetDef the builder creates for a custom set (base cloned: classification, setType, canFlip, presets). */
export function buildCustomSetDef(
  base: SetDef,
  spec: Pick<CustomSetSpec, "positions" | "movements" | "name">,
  at: { asset: Asset; formation: Asset; setId: number },
): SetDef {
  return { ...base, setId: at.setId, name: typeof spec.name === "string" ? spec.name : "", asset: at.asset, formation: at.formation, movements: effectiveMovements(base, spec) };
}

/**
 * A SetDef for the art engine (formations editor previews): effective Normal + presets. Its asset is the custom set's
 * full asset when the spec's formation is a full path, else "custom:<asset>".
 */
export function effectiveSet(base: SetDef, spec: Pick<CustomSetSpec, "positions" | "movements" | "name" | "asset"> & { formation?: string }): SetDef {
  const asset = customSetAsset({ asset: spec.asset, formation: spec.formation ?? "" }) ?? (spec.asset ? `custom:${spec.asset}` : base.asset);
  return { ...base, name: spec.name ?? base.name, asset, movements: effectiveMovements(base, spec) };
}

/** The flipped version of a custom set's alignment as a SetDef (Normal only), for a "flipped" preview. */
export function flippedSet(base: SetDef, spec: Pick<CustomSetSpec, "positions" | "name" | "asset"> & { formation?: string }): SetDef {
  const s = effectiveSet(base, { ...spec, movements: undefined });
  return { ...s, movements: { [NORMAL]: flippedAlignment(s.movements[NORMAL]) } };
}

// ───────────────────────────── diffs / edits (immer-draft friendly) ─────────────────────────────

/** Changed fields of a slot in Normal relative to the base. */
export function changedFields(base: SetDef, spec: Pick<CustomSetSpec, "positions">, slot: number): PositionField[] {
  const b = normalOf(base)[slot];
  if (!b) return [];
  const e = effectiveNormal(base, spec)[slot];
  return POSITION_FIELDS.filter((f) => !fieldEq(f, e[f], b[f]));
}

/** Slots whose Normal alignment differs from the base (any field). */
export function changedSlots(base: SetDef, spec: Pick<CustomSetSpec, "positions">): number[] {
  const b = normalOf(base);
  const e = effectiveNormal(base, spec);
  return b.flatMap((a, i) => (POSITION_FIELDS.some((f) => !fieldEq(f, e[i][f], a[f])) ? [i] : []));
}

/** Slots whose x/y moved (what plays care about). */
export function movedSlots(base: SetDef, spec: Pick<CustomSetSpec, "positions">): number[] {
  const b = normalOf(base);
  const e = effectiveNormal(base, spec);
  return b.flatMap((a, i) => (!sameNum(e[i].x, a.x) || !sameNum(e[i].y, a.y) ? [i] : []));
}

/** Slots whose target in preset `key` differs from the base preset's target. */
export function changedPresetSlots(base: SetDef, spec: Pick<CustomSetSpec, "positions" | "movements">, key: string): number[] {
  if (key === NORMAL) return changedSlots(base, spec);
  const targets = matchPresetToSlots(normalOf(base), isBasePreset(base, key) ? base.movements[key] : undefined);
  const eff = effectivePreset(base, spec, key);
  return targets.flatMap((t, i) => (t && eff[i] && (!sameNum(eff[i]!.x, t.x) || !sameNum(eff[i]!.y, t.y)) ? [i] : []));
}

function cleanPatch(patch: SlotPatch): SlotPatch {
  const out: SlotPatch = {};
  if (isNum(patch.x)) out.x = roundCoord(patch.x);
  if (isNum(patch.y)) out.y = roundCoord(patch.y);
  if (typeof patch.stance === "string" && patch.stance) out.stance = patch.stance;
  // The builder stores whole degrees.
  if (isNum(patch.facing)) out.facing = mod360(Math.round(patch.facing));
  if (Number.isInteger(patch.flipAssign)) out.flipAssign = patch.flipAssign;
  if (typeof patch.motionMan === "boolean") out.motionMan = patch.motionMan;
  return out;
}

/**
 * Rewrite one slot's entries in `list` (positions or a preset list) so the first one holds exactly the `fields` where
 * `next` differs from `ref`; repeated entries for the slot lose those fields. Entries left with only `slot` disappear
 * (unknown keys keep an entry alive). New entries go in slot order.
 */
function writeEntry(list: SlotPosition[], slot: number, next: Partial<AlignmentPos>, ref: Partial<AlignmentPos>, fields: readonly PositionField[], always = false): void {
  let idx = list.findIndex((e) => isObj(e) && e.slot === slot);
  const changed = fields.some((f) => !fieldEq(f, next[f], ref[f]));
  if (idx < 0) {
    if (!changed) return;
    const after = list.findIndex((e) => isObj(e) && Number.isInteger(e.slot) && (e.slot as number) > slot);
    idx = after < 0 ? list.length : after;
    list.splice(idx, 0, { slot });
  }
  const entry = list[idx];
  for (const f of fields) {
    if (changed && (always || !fieldEq(f, next[f], ref[f]))) (entry as Record<string, unknown>)[f] = next[f];
    else delete entry[f];
  }
  for (let i = list.length - 1; i > idx; i--) {
    const e = list[i];
    if (!isObj(e) || e.slot !== slot) continue;
    for (const f of fields) delete e[f];
    if (Object.keys(e).every((k) => k === "slot")) list.splice(i, 1);
  }
  if (Object.keys(entry).every((k) => k === "slot")) list.splice(idx, 1);
}

/**
 * Minimal `positions` for an edited alignment: entries hold only the fields that differ from the base Normal. Entries
 * of `existing` keep their order and unknown keys; a slot that matches the base loses its entry. Pure (new array).
 */
export function diffPositions(baseNormal: readonly AlignmentPos[], edited: readonly AlignmentPos[], existing?: readonly SlotPosition[]): SlotPosition[] {
  const list: SlotPosition[] = Array.isArray(existing) ? existing.filter((e): e is SlotPosition => isObj(e)).map((e) => ({ ...e })) : [];
  baseNormal.forEach((b, slot) => {
    const e = edited[slot];
    if (e) writeEntry(list, slot, e, b, POSITION_FIELDS);
  });
  return list;
}

/**
 * Edit one slot of the Normal alignment (works on an immer draft). Only fields that differ from the base are kept in
 * `positions`; an entry that matches the base disappears. Coordinates are rounded to 3 decimals, facing to whole degrees.
 */
export function patchPosition(spec: CustomSetSpec, base: SetDef, slot: number, patch: SlotPatch): void {
  const b = normalOf(base)[slot];
  if (!b) return;
  const cur = effectiveNormal(base, spec)[slot];
  const next = { ...cur, ...cleanPatch(patch) };
  if (next.flipAssign !== undefined && !isSlot(next.flipAssign, normalOf(base).length)) next.flipAssign = cur.flipAssign;
  if (!Array.isArray(spec.positions)) spec.positions = [];
  writeEntry(spec.positions, slot, next, b, POSITION_FIELDS);
}

/** Back to the base alignment for a slot (Normal). Unknown keys stay. */
export function resetPosition(spec: CustomSetSpec, slot: number): void {
  if (!Array.isArray(spec.positions)) return;
  for (let i = spec.positions.length - 1; i >= 0; i--) {
    const e = spec.positions[i];
    if (!isObj(e) || e.slot !== slot) continue;
    for (const f of POSITION_FIELDS) delete e[f];
    if (Object.keys(e).every((k) => k === "slot")) spec.positions.splice(i, 1);
  }
}

/**
 * Move one slot's target in base preset `key` (draft). Only slots the preset already moves can change (see
 * canPatchPreset; anything else is ignored); the entry is written with both x and y (the builder reads both) and
 * removed when it matches the base target again. Returns nothing, so it's safe as an immer recipe body.
 */
export function patchPreset(spec: CustomSetSpec, base: SetDef, key: string, slot: number, patch: SlotPatch): void {
  if (key === NORMAL) return patchPosition(spec, base, slot, patch);
  const target = matchPresetToSlots(normalOf(base), isBasePreset(base, key) ? base.movements[key] : undefined)[slot];
  if (!target) return;
  const cur = effectivePreset(base, spec, key)[slot] ?? target;
  const p = cleanPatch({ x: patch.x, y: patch.y });
  const next = { ...cur, x: p.x ?? cur.x, y: p.y ?? cur.y };
  if (!isObj(spec.movements)) spec.movements = {};
  if (!Array.isArray(spec.movements[key])) spec.movements[key] = [];
  writeEntry(spec.movements[key], slot, next, target, PRESET_FIELDS, true);
  tidyMovements(spec);
}

/** True when preset `key` of the base set moves `slot` (Normal: every slot) — what patchPreset can edit. */
export function canPatchPreset(base: SetDef, key: string, slot: number): boolean {
  return key === NORMAL ? !!normalOf(base)[slot] : presetSlots(base, key).includes(slot);
}

/** Drop a slot's override from preset `key` (draft). */
export function resetPresetSlot(spec: CustomSetSpec, base: SetDef, key: string, slot: number): void {
  if (key === NORMAL) return resetPosition(spec, slot);
  const list = spec.movements?.[key];
  if (!Array.isArray(list)) return;
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (!isObj(e) || e.slot !== slot) continue;
    for (const f of PRESET_FIELDS) delete e[f];
    if (Object.keys(e).every((k) => k === "slot")) list.splice(i, 1);
  }
  tidyMovements(spec);
}

/** Empty preset lists and an empty `movements` object are removed. */
function tidyMovements(spec: CustomSetSpec): void {
  const m = spec.movements;
  if (!isObj(m)) return;
  for (const k of Object.keys(m)) if (Array.isArray(m[k]) && m[k].length === 0) delete m[k];
  if (Object.keys(m).length === 0) delete spec.movements;
}

/** Presets can't be added (FORMATS.md §5): always empty. Kept for older callers. */
export function availablePresetKeys(_base?: SetDef, _spec?: Pick<CustomSetSpec, "movements">): string[] {
  return [];
}

/** Presets can't be added (FORMATS.md §5) — always throws. Kept for older callers. */
export function addPreset(_spec: CustomSetSpec, _base: SetDef, key: string): never {
  throw new Error(`Motion presets can't be added (${key}): you can only move the targets of the base set's own presets`);
}

/** Reset a base preset to the base, or remove a key the base doesn't have (draft). */
export function removePreset(spec: CustomSetSpec, _base: SetDef, key: string): void {
  if (!isObj(spec.movements)) return;
  delete spec.movements[key];
  if (Object.keys(spec.movements).length === 0) delete spec.movements;
}

/** "M1left" → "M1 Left", "SM5right" → "SM5 Right". */
export function presetLabel(key: string): string {
  if (key === NORMAL) return "Normal";
  const m = /^(S?M)(\d)\s*(left|right|lft|rght)?$/i.exec(key);
  if (!m) return key;
  const dir = m[3] ? (/^l/i.test(m[3]) ? "Left" : "Right") : "";
  return `${m[1].toUpperCase()}${m[2]}${dir ? " " + dir : ""}`;
}

/** The motion man group number of a preset key (M2left → 2). */
export function presetMotionMan(key: string): number | undefined {
  const m = /^S?M(\d)/i.exec(key);
  return m ? Number(m[1]) : undefined;
}

// ───────────────────────────── alignment presets (depth / split) ─────────────────────────────

export type DepthPreset = "line" | "off" | "backfield" | DepthClass;

export const DEPTH_PRESET_LABEL: Record<DepthPreset, string> = {
  line: "On the line",
  off: "Off the line",
  backfield: "Backfield",
  "under-center": "Under center",
  pistol: "Pistol",
  shotgun: "Shotgun",
};

/** Depth presets that make sense for a player. */
export function depthPresetsFor(a: Pick<AlignmentPos, "pos" | "group">): DepthPreset[] {
  if (isQB(a)) return ["under-center", "pistol", "shotgun"];
  if (isLineman(a)) return ["line"];
  return ["line", "off", "backfield"];
}

/**
 * y for a depth preset. On the line (the builder's y > −1.5): a player whose base was on the line keeps that depth;
 * otherwise OL and tight ends −1.2, others −0.8. Off: −2.2. QB: −1.4 / −4 / −6. Backfield (HB/FB): the base depth when
 * the base is in the backfield, else by the QB's class (gun −6 beside the QB, otherwise FB −4.75 / HB −7.375); other
 * players FB depth.
 */
export function depthPresetY(preset: DepthPreset, slot: number, base: SetDef, normal: AlignmentPos[]): number | undefined {
  const a = normal[slot];
  const b = normalOf(base)[slot];
  if (!a || !b) return undefined;
  switch (preset) {
    case "under-center":
    case "pistol":
    case "shotgun":
      return QB_DEPTH[preset];
    case "line":
      if (b.y > LINE_Y && b.y <= 0) return b.y;
      return isLineman(a) || isTightEnd(a) ? DEPTHS.tightEnd : DEPTHS.onLine;
    case "off":
      return DEPTHS.offLine;
    case "backfield": {
      if (isBack(a) && backDepth(b.y) !== "line" && backDepth(b.y) !== "wing") return b.y;
      const cls = setDepthClass(normal) ?? "under-center";
      if (positionCode(a.pos) === "HB") return cls === "shotgun" ? DEPTHS.shotgun : DEPTHS.tailback;
      return cls === "shotgun" ? DEPTHS.shotgun : DEPTHS.fullback;
    }
  }
}

export type SplitPreset = "tight" | "wing" | "outsideTe" | "slot" | "numbers" | "hash" | "wide" | "mirror";

export const SPLIT_PRESET_LABEL: Record<SplitPreset, string> = {
  tight: "Tight",
  wing: "Wing",
  outsideTe: "2 yd outside TE",
  slot: "Slot",
  numbers: "Numbers",
  hash: "Hash",
  wide: "Wide",
  mirror: "Mirror",
};

export const SPLIT_PRESET_HINT: Record<SplitPreset, string> = {
  tight: "Next to the tackle, where the game puts tight ends (one OL split outside: ±5.0)",
  wing: "Off the line, two OL splits outside the tackle (±6.67, y −2.2)",
  outsideTe: "2 yd outside the tight end on that side (±7.0 when there is none)",
  slot: "Slot split (±10.5)",
  numbers: "On the numbers (±15.5)",
  hash: "The far hash when the ball is on a hash (±6.17)",
  wide: "Wide split (±16.25)",
  mirror: "Same spot on the other side",
};

/** Side of the field a player is on: −1 left, +1 right (x = 0 counts as right). */
export function sideOf(x: number): -1 | 1 {
  return x < 0 ? -1 : 1;
}

/**
 * Position for a split preset relative to the OL (only x, except "wing" which also steps off the line and "mirror"
 * which flips x and the facing). Uses the player's current side.
 */
export function splitPreset(preset: SplitPreset, slot: number, normal: AlignmentPos[]): SlotPatch | undefined {
  const a = normal[slot];
  if (!a) return undefined;
  const side = sideOf(a.x);
  const center = normal.find((p) => positionCode(p.pos) === "C")?.x ?? 0;
  const tackle = normal.find((p) => positionCode(p.pos) === (side < 0 ? "LT" : "RT"));
  const tackleX = tackle ? tackle.x : center + side * SPLITS.tackle;
  switch (preset) {
    case "tight":
      return { x: tackleX + side * SPLITS.olStep };
    case "wing":
      return { x: tackleX + side * 2 * SPLITS.olStep, y: DEPTHS.offLine };
    case "outsideTe": {
      const te = normal
        .map((p, i) => ({ p, i }))
        .filter(({ p, i }) => i !== slot && isTightEnd(p) && sideOf(p.x) === side && Math.abs(p.x) < SPLITS.slot - 1)
        .sort((u, v) => Math.abs(u.p.x) - Math.abs(v.p.x))[0];
      const teX = te ? te.p.x : tackleX + side * SPLITS.olStep;
      return { x: teX + side * SPLITS.outsideTe };
    }
    case "slot":
      return { x: center + side * SPLITS.slot };
    case "numbers":
      return { x: center + side * SPLITS.numbers };
    case "hash":
      return { x: center + side * SPLITS.hash };
    case "wide":
      return { x: center + side * SPLITS.wide };
    case "mirror":
      return { x: 2 * center - a.x, facing: isNum(a.facing) ? mod360(180 - a.facing) : undefined };
  }
}

// ───────────────────────────── names / assets ─────────────────────────────

/** "Trips Stack Wk" → "TSW"; one word → its first 3 letters ("Bunch" → "Bun"). */
export function setAbbrev(name: string): string {
  const words = name
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "Set";
  if (words.length === 1) return words[0].slice(0, 3).replace(/^./, (c) => c.toUpperCase());
  return words.map((w) => (/^\d+$/.test(w) ? w : w[0].toUpperCase())).join("");
}

const setsOf = (data: SetsFile | null | undefined): CustomSetSpec[] => (data && Array.isArray(data.sets) ? data.sets : []);
const formationsOf = (data: SetsFile | null | undefined): CustomFormationSpec[] => (data && Array.isArray(data.formations) ? data.formations : []);

/** Every custom set asset leaf across the given sets files. */
export function customSetAssets(files: { data: SetsFile | null | undefined }[]): Set<string> {
  const out = new Set<string>();
  for (const f of files) for (const s of setsOf(f.data)) if (isObj(s) && typeof s.asset === "string") out.add(s.asset);
  return out;
}

export function customFormationAssets(files: { data: SetsFile | null | undefined }[]): Set<string> {
  const out = new Set<string>();
  for (const f of files) for (const s of formationsOf(f.data)) if (isObj(s) && typeof s.asset === "string") out.add(s.asset);
  return out;
}

const setLeavesCache = new WeakMap<LibraryIndex, Set<string>>();
const formationLeavesCache = new WeakMap<LibraryIndex, Set<string>>();

/** Asset leaves of every library set folder (stock sets only). Cached per index. */
export function librarySetLeaves(lib: LibraryIndex): Set<string> {
  const stock = lib.stock ?? lib;
  let out = setLeavesCache.get(stock);
  if (!out) {
    out = new Set(stock.data.sets.map((s) => leaf(s.asset)));
    setLeavesCache.set(stock, out);
  }
  return out;
}

/** Asset leaves of every library formation (stock formations only). Cached per index. */
export function libraryFormationLeaves(lib: LibraryIndex): Set<string> {
  const stock = lib.stock ?? lib;
  let out = formationLeavesCache.get(stock);
  if (!out) {
    out = new Set(stock.data.formations.map((f) => leaf(f.asset)));
    formationLeavesCache.set(stock, out);
  }
  return out;
}

/** prefix + sanitized name, unique against `taken` (case-insensitive). */
export function suggestAsset(prefix: string, name: string, taken: Set<string>): string {
  const baseLeaf = sanitizeAssetLeaf(`${prefix}${sanitizeAssetLeaf(name) || "Set"}`) || "Set";
  return uniqueName(baseLeaf, taken);
}

/**
 * Set names a playbook can't reuse in a formation: stock sets in the formation's folder + custom sets in it (by full
 * formation path; a bare custom leaf is matched too). `formation` may be a stock or custom formation asset.
 */
export function setNamesInFormation(lib: LibraryIndex, formation: Asset, files: { data: SetsFile | null | undefined }[], except?: CustomSetSpec): Set<string> {
  const stock = lib.stock ?? lib;
  const dir = folder(formation.includes("/") ? formation : customFormationAsset(formation));
  const out = new Set<string>();
  for (const s of stock.data.sets) if (s.asset.startsWith(dir)) out.add(s.name);
  for (const f of files) {
    for (const s of setsOf(f.data)) {
      if (s === except || !isObj(s) || typeof s.name !== "string" || !s.name) continue;
      const ref = typeof s.formation === "string" ? s.formation : "";
      if (folder(ref.includes("/") ? ref : customFormationAsset(ref)) === dir) out.add(s.name);
    }
  }
  return out;
}

/** A unique set name for a formation ("Y Trips Wk" → "Y Trips Wk 2"). */
export function suggestSetName(base: string, taken: Set<string>): string {
  return uniqueName(base, new Set([...taken].map(norm)), " ");
}

/**
 * A new custom set cloned from `base` (no changes yet). `formation` defaults to the base's formation; a bare custom
 * formation leaf is expanded to its full asset (Formations/Offense/<leaf>/<leaf>), which is what the builder needs.
 */
export function newCustomSet(base: SetDef, opts: { name: string; asset: string; formation?: Asset }): CustomSetSpec {
  const f = opts.formation ?? base.formation;
  return { name: opts.name, asset: opts.asset, base: base.asset, formation: f.includes("/") ? f : customFormationAsset(f), positions: [] };
}

export function newCustomFormation(baseFormation: Asset, opts: { name: string; asset: string }): CustomFormationSpec {
  return { name: opts.name, asset: opts.asset, base: baseFormation };
}

/** Name + asset for a play cloned into a custom set: name = the play's name, asset = prefix + set abbrev + play leaf. */
export function cloneEntry(play: Pick<PlayDef, "asset" | "name">, opts: { prefix: string; setName: string; takenNames: Set<string>; takenAssets: Set<string> }): {
  from: Asset;
  name: string;
  asset: string;
} {
  // Library names sometimes carry stray spaces (" Dig  X Comeback"); clones get a clean in-game name.
  const name = uniqueName(play.name.replace(/\s+/g, " ").trim() || leaf(play.asset), new Set([...opts.takenNames].map(norm)), " ");
  const raw = sanitizeAssetLeaf(`${opts.prefix}${setAbbrev(opts.setName)}_${leaf(play.asset)}`);
  return { from: play.asset, name, asset: uniqueName(raw, opts.takenAssets) };
}

/** Clone entries for `plays`, unique against each other and the set's existing clones. */
export function cloneEntries(plays: Pick<PlayDef, "asset" | "name">[], spec: Pick<CustomSetSpec, "plays" | "name">, prefix: string) {
  const takenNames = new Set((spec.plays ?? []).map((p) => p?.name).filter((n): n is string => typeof n === "string"));
  const takenAssets = new Set((spec.plays ?? []).map((p) => p?.asset).filter((n): n is string => typeof n === "string"));
  return plays.map((p) => {
    const e = cloneEntry(p, { prefix, setName: spec.name, takenNames, takenAssets });
    takenNames.add(e.name);
    takenAssets.add(e.asset);
    return e;
  });
}

// ───────────────────────────── custom formations / sets as library defs (catalog overlay) ─────────────────────────────

export interface CustomFormationDef {
  def: FormationDef;
  spec: CustomFormationSpec;
  base: FormationDef;
  file: string;
  index: number;
}

export interface CustomSetDef {
  def: SetDef;
  spec: CustomSetSpec;
  base: SetDef;
  /** The formation it's built in (stock or custom). */
  formation: FormationDef;
  file: string;
  index: number;
}

export interface CustomDefs {
  formations: CustomFormationDef[];
  sets: CustomSetDef[];
}

const lowerIndexCache = new WeakMap<LibraryIndex, { formations: Map<string, FormationDef>; sets: Map<string, SetDef>; formIds: number[]; setIds: number[] }>();

/** Stock lookups by lowercased asset (Frostbite asset names are case-insensitive) + the ids the builder treats as taken. */
function lowerIndex(stock: LibraryIndex) {
  let hit = lowerIndexCache.get(stock);
  if (!hit) {
    hit = {
      formations: new Map(stock.data.formations.map((f) => [f.asset.toLowerCase(), f])),
      sets: new Map(stock.data.sets.map((s) => [s.asset.toLowerCase(), s])),
      formIds: stock.data.formations.map((f) => f.formId >>> 0),
      setIds: stock.data.sets.map((s) => s.setId >>> 0),
    };
    lowerIndexCache.set(stock, hit);
  }
  return hit;
}

/**
 * The formations and sets the game-side builder creates from the sets files, in builder order (every file's
 * `formations`, then every file's `sets`; files in the given order). Ids are the builder's (gameId). Only entries the
 * builder can create are returned: a valid asset leaf, a library base, a known formation (library, or a custom
 * formation's full path), and an asset not already taken. Alignment problems don't drop a set (validation reports them).
 */
export function customDefs(lib: LibraryIndex, files: readonly SetsInput[]): CustomDefs {
  const stock = lib.stock ?? lib;
  const low = lowerIndex(stock);
  const out: CustomDefs = { formations: [], sets: [] };
  const formTaken = new Set(low.formIds);
  const setTaken = new Set(low.setIds);
  const builtForms = new Map<string, FormationDef>();
  const builtSets = new Set<string>();

  for (const f of files) {
    formationsOf(f.data).forEach((spec, index) => {
      if (!isObj(spec) || !isValidAsset(spec.asset) || typeof spec.base !== "string") return;
      const base = stock.formationByAsset.get(spec.base);
      if (!base) return;
      const asset = customFormationAsset(spec.asset);
      const key = asset.toLowerCase();
      if (low.formations.has(key) || builtForms.has(key)) return;
      const def: FormationDef = { formId: gameId(asset, formTaken) & 0x7fffffff, name: typeof spec.name === "string" ? spec.name : "", type: base.type, asset };
      builtForms.set(key, def);
      out.formations.push({ def, spec, base, file: f.path, index });
    });
  }
  for (const f of files) {
    setsOf(f.data).forEach((spec, index) => {
      if (!isObj(spec) || !isValidAsset(spec.asset) || typeof spec.base !== "string" || typeof spec.formation !== "string") return;
      const base = stock.setByAsset.get(spec.base);
      const formation = low.formations.get(spec.formation.toLowerCase()) ?? builtForms.get(spec.formation.toLowerCase());
      if (!base || !formation) return;
      const asset = `${folder(formation.asset)}${spec.asset}/${spec.asset}`;
      const key = asset.toLowerCase();
      if (low.sets.has(key) || builtSets.has(key)) return;
      builtSets.add(key);
      const def = buildCustomSetDef(base, spec, { asset, formation: formation.asset, setId: gameId(asset, setTaken) });
      out.sets.push({ def, spec, base, formation, file: f.path, index });
    });
  }
  return out;
}

// ───────────────────────────── dependency warnings for cloned plays ─────────────────────────────

export type DependencyKind = "mechanics" | "handoff" | "block" | "realign" | "motion";

export interface PlayDependency {
  slot: number;
  /** "WR1", "HB"… */
  label: string;
  kind: DependencyKind;
  reason: string;
}

const GAP_TEXT = (g: unknown) => String(g ?? "").replace(/_GAP_/, " gap ").replace(/_/g, " ").toLowerCase();

/** Why one slot's steps depend on where the player lines up (empty = alignment-independent). */
export function stepDependencies(steps: Step[]): { kind: DependencyKind; reason: string }[] {
  const out: { kind: DependencyKind; reason: string }[] = [];
  const seen = new Set<string>();
  const add = (kind: DependencyKind, reason: string) => {
    if (seen.has(reason)) return;
    seen.add(reason);
    out.push({ kind, reason });
  };
  for (const s of steps) {
    if (isMechanics(s)) add("mechanics", `${s.type} — handoff/fake/option mechanics are timed to the base spot`);
    else if (s.type === "ReceiveHandoff") add("handoff", "takes the handoff — the mesh point is built for the base spot");
    else if (s.type === "LeadBlock") add("block", `lead block (${GAP_TEXT(s.blockingGap) || "gap"}) — the path is aimed from the base spot`);
    else if (s.type === "RunBlock") add("block", "run block — the blocking scheme picks targets by alignment");
    else if (s.type === "PassBlock") add("block", "pass protection — the protection is built for the base spot");
    else if (s.type === "OverrideFormPos") add("realign", `realigns to (${fmt(Number(s.offsetX))}, ${fmt(Number(s.offsetY))}) — the play overrides your spot`);
    else if (s.type === "AutoMotion") add("motion", "motion waypoints are absolute — the motion now starts from the new spot");
  }
  return out;
}

/**
 * Dependency warnings for a library play cloned into a custom set: every moved slot whose assignment has mechanics,
 * blocks, OverrideFormPos or AutoMotion.
 */
export function playDependencies(lib: LibraryIndex, play: PlayDef, moved: readonly number[], normal: AlignmentPos[]): PlayDependency[] {
  const out: PlayDependency[] = [];
  for (const slot of moved) {
    const asset = play.assignments?.[slot];
    const steps = asset ? (lib.assignment(asset)?.steps ?? []) : [];
    const a = normal[slot];
    const label = a ? playerLabel(a) : `Slot ${slot}`;
    for (const d of stepDependencies(steps)) out.push({ slot, label, ...d });
  }
  return out;
}

export type CloneWarningKind = DependencyKind | "pull" | "personnel" | "source";

export interface CloneWarning {
  slot?: number;
  label: string;
  kind: CloneWarningKind;
  reason: string;
}

const PULL_RE = /PULL/i;

/** Plain-language reasons a slot's steps depend on where the player lines up. */
export function slotDependencies(steps: Step[]): { kind: CloneWarningKind; reason: string }[] {
  const out: { kind: CloneWarningKind; reason: string }[] = [];
  if (steps.some((s) => s.type === "InitialAnim" && PULL_RE.test(String(s.anim ?? "")))) out.push({ kind: "pull", reason: "pulls — the pull path keeps the original spot's coordinates" });
  for (const d of stepDependencies(steps)) {
    if (d.kind === "realign") out.push({ kind: d.kind, reason: "has a fixed starting spot in this play (OverrideFormPos) — your new spot is ignored for this play" });
    else if (d.kind === "motion") out.push({ kind: d.kind, reason: "motion waypoints are absolute field spots — the motion still runs to the original spots" });
    else if (d.kind === "mechanics") out.push({ kind: d.kind, reason: "handoff / fake / option timing is built for the original spot" });
    else out.push({ kind: d.kind, reason: d.reason.replace(/the base spot/g, "the original spot") });
  }
  return out;
}

/** Position family for personnel checks: wide and slot receivers are interchangeable, everyone else by position. */
function role(pos: string): string {
  const c = positionCode(pos);
  return c === "SL" ? "WR" : c;
}

/**
 * Warnings for cloning library play `play` into a custom set whose effective alignment is `normal`:
 * - players that line up somewhere else than in the play's own set and whose assignments depend on the alignment
 *   (handoff precans, pulls, absolute AutoMotion, OverrideFormPos keep the play's original coordinates; blocks only
 *   for the QB, backs and line — moving receivers is safe, FORMATS.md §5);
 * - plays from another set whose personnel / slot order differs (assignments follow slot numbers).
 */
export function cloneWarnings(lib: LibraryIndex, play: PlayDef, normal: AlignmentPos[]): CloneWarning[] {
  const stock = lib.stock ?? lib;
  const src = stock.setByAsset.get(play.set);
  if (!src) return [{ label: "Set", kind: "source", reason: "the play's own set isn't in the library" }];
  const srcNormal = normalOf(src);
  const out: CloneWarning[] = [];
  if (srcNormal.length !== normal.length) out.push({ label: "Players", kind: "personnel", reason: `its set has ${srcNormal.length} players, this one ${normal.length}` });
  normal.forEach((a, slot) => {
    const s = srcNormal[slot];
    if (!s) return;
    if (role(s.pos) !== role(a.pos)) {
      out.push({ slot, label: playerLabel(a), kind: "personnel", reason: `slot ${slot} is a ${positionName(s.pos).toLowerCase()} in ${maddenName(src.name)} but a ${positionName(a.pos).toLowerCase()} here — the assignment goes to whoever is in that slot` });
    }
    const moved = Math.abs(s.x - a.x) > 0.01 || Math.abs(s.y - a.y) > 0.01;
    if (!moved) return;
    const asset = play.assignments?.[slot];
    const steps = asset ? (stock.assignment(asset)?.steps ?? []) : [];
    // FORMATS.md §5: moving receivers is safe — their blocks are found by the game from wherever they line up. Blocks
    // only matter for the QB, the backs and the line.
    const receiver = isEligible(a) && !isBack(a);
    for (const d of slotDependencies(steps)) if (!(receiver && d.kind === "block")) out.push({ slot, label: playerLabel(a), ...d });
  });
  return out;
}

/** Library plays of the base set (the usual plays to clone; `from` may be a play of any set). */
export function clonablePlays(lib: LibraryIndex, base: SetDef): PlayDef[] {
  return (lib.stock ?? lib).playsBySet.get(base.asset) ?? [];
}

// ───────────────────────────── validation (FORMATS.md §5 / SetBuilder) ─────────────────────────────

export interface AlignmentContext {
  file?: string;
  where?: string;
  /** Prefix for messages, e.g. "M1 Left: " for presets. */
  label?: string;
  /** Downgrade errors to warnings (motion presets). */
  soft?: boolean;
}

/**
 * Alignment rules for an effective alignment against its base set. Errors (the builder throws, or the alignment can't
 * work): not 11 players, not exactly 7 non-QB players with y > −1.5, a player past the LOS, two players on the same
 * spot, missing coordinates. Warnings: OL moved off SetBuilder's spots (±0.25), OL depth changed, QB/HB depth class
 * changed (handoffs), flip partners that collide or aren't mutual, a lineman at the end of the line.
 */
export function alignmentIssues(normal: AlignmentPos[], base: SetDef, ctx: AlignmentContext = {}): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const lvl = (l: ValidationIssue["level"]): ValidationIssue["level"] => (ctx.soft && l === "error" ? "warning" : l);
  const push = (level: ValidationIssue["level"], rule: string, message: string) =>
    out.push({ level: lvl(level), rule, message: (ctx.label ?? "") + message, file: ctx.file, where: ctx.where });
  const baseNormal = normalOf(base);
  const label = (a: AlignmentPos, i: number) => (a ? playerLabel(a) : `Slot ${i}`);

  if (normal.length !== PLAYER_COUNT) push("error", "set-player-count", `${normal.length} players (need ${PLAYER_COUNT})`);

  let coordsOk = true;
  normal.forEach((a, i) => {
    if (!isNum(a.x) || !isNum(a.y)) {
      coordsOk = false;
      push("error", "set-position-number", `${label(a, i)} has no valid x/y`);
    } else if (a.y > LINE_BAND.max + EPS) push("error", "set-past-los", `${label(a, i)} is past the line of scrimmage (y ${fmt(a.y)})`);
  });

  // SetBuilder: exactly 7 non-QB players with y > −1.5.
  const line = normal.filter(onLine);
  if (line.length !== LINE_COUNT) {
    const near = normal.filter((a) => a.pos !== "POSITION_QB" && !isQB(a) && isNum(a.y) && a.y <= LINE_Y && a.y > LINE_Y - 0.25);
    const baseLine = baseNormal.filter(onLine).length;
    let msg = `${line.length} players on the line of scrimmage — the game-side builder needs exactly ${LINE_COUNT} (a player is on the line when y > −1.5)`;
    if (line.length < LINE_COUNT && near.length) msg += `; ${near.map((a) => `${playerLabel(a)} (y ${fmt(a.y)})`).join(", ")} count as off the line for the builder — move them up (y −1.4 or closer to the line) or pick another base set`;
    if (baseLine === line.length && baseNormal.length === normal.length) msg += ` (the base set ${maddenName(base.name)} lines up this way too)`;
    push("error", "set-line-count", msg);
  }

  // SetBuilder warns when slots 6–10 leave the standard OL spots; the base's own (wider) splits aren't reported.
  for (let k = 0; k < OL_SPOTS.length; k++) {
    const i = 6 + k;
    const a = normal[i];
    const b = baseNormal[i];
    if (!a || !isNum(a.x) || Math.abs(a.x - OL_SPOTS[k]) <= OL_SPOT_TOLERANCE) continue;
    if (b && isNum(b.x) && sameNum(a.x, b.x)) continue;
    push("warning", "set-ol-spacing", `${label(a, i)} moved to x ${fmt(a.x)} — the line should stay at ${fmt(OL_SPOTS[k])} (±${OL_SPOT_TOLERANCE}); blocking is built for those spots`);
  }
  normal.forEach((a, i) => {
    const b = baseNormal[i];
    if (isLineman(a) && b && isNum(a.y) && isNum(b.y) && Math.abs(a.y - b.y) > OL_DEPTH_TOLERANCE + EPS)
      push("warning", "set-ol-depth", `${label(a, i)} changed depth (${fmt(b.y)} → ${fmt(a.y)}); the OL's blocking is built for the base depth`);
  });

  // QB / backs keep their depth class so handoffs stay valid.
  normal.forEach((a, i) => {
    const b = baseNormal[i];
    if (!b || !isNum(a.y) || !isNum(b.y)) return;
    if (isQB(a)) {
      const want = depthClass(b.y);
      const got = depthClass(a.y);
      if (want !== got) push("warning", "set-qb-depth", `QB is ${DEPTH_CLASS_LABEL[got].toLowerCase()} (y ${fmt(a.y)}) but the base is ${DEPTH_CLASS_LABEL[want].toLowerCase()} — handoffs are built for the base depth`);
    } else if (isBack(a) && !onLine(b)) {
      const want = backDepth(b.y);
      const got = backDepth(a.y);
      if (want !== "wing" && want !== got) push("warning", "set-back-depth", `${label(a, i)} moved from ${BACK_DEPTH_LABEL[want]} to ${BACK_DEPTH_LABEL[got]} — handoffs expect the base depth`);
    }
  });

  // No two players on the same spot (normal and flipped).
  const overlaps = (list: AlignmentPos[]) => {
    const pairs: [number, number][] = [];
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) if (Math.hypot(list[i].x - list[j].x, list[i].y - list[j].y) < SAME_SPOT_YD) pairs.push([i, j]);
    return pairs;
  };
  if (coordsOk) {
    for (const [i, j] of overlaps(normal)) push("error", "set-overlap", `${label(normal[i], i)} and ${label(normal[j], j)} are on the same spot (${fmt(normal[i].x)}, ${fmt(normal[i].y)})`);
    if (!ctx.soft) {
      const flipped = flippedAlignment(normal);
      for (const [i, j] of overlaps(flipped)) {
        push("warning", "set-flip-overlap", `When the play is flipped, ${label(normal[i], i)} and ${label(normal[j], j)} land on the same spot — check their flip partners`);
      }
      normal.forEach((a, i) => {
        const p = flipPartner(normal, i);
        if (flipPartner(normal, p) !== i) push("warning", "set-flip-pair", `${label(a, i)} takes ${label(normal[p], p)}'s spot when flipped, but ${label(normal[p], p)} doesn't take his`);
      });
    }
  }

  // The ends of the line should be eligible receivers (only meaningful once the line count is right).
  if (line.length === LINE_COUNT) {
    const sorted = [...line].sort((u, v) => u.x - v.x);
    for (const [end, which] of [
      [sorted[0], "left"],
      [sorted[sorted.length - 1], "right"],
    ] as const) {
      if (!isEligible(end)) push("warning", "set-line-ends", `${playerLabel(end)} is at the ${which} end of the line — the ends should be eligible receivers`);
    }
  }
  return out;
}

/** Rules that also matter after a pre-snap motion (as warnings): line count, LOS, overlaps, ends. */
const PRESET_RULES = new Set(["set-player-count", "set-past-los", "set-line-count", "set-overlap", "set-line-ends", "set-position-number"]);

/** Alignment issues of preset `key` (always warnings), prefixed "M1 Left: ". */
export function presetIssues(base: SetDef, spec: Pick<CustomSetSpec, "positions" | "movements">, key: string, ctx: AlignmentContext = {}): ValidationIssue[] {
  if (key === NORMAL) return [];
  const shown = presetAlignment(base, spec, key);
  return alignmentIssues(shown, base, { ...ctx, soft: true, label: `${presetLabel(key)}: ` }).filter((i) => PRESET_RULES.has(i.rule ?? ""));
}

export interface SetsValidationContext {
  file?: string;
  /** Every sets file (cross-file formations, assets, names, clones). Default: just this file. */
  allFiles?: { path: string; data: SetsFile | null | undefined }[];
}

interface Owner<T> {
  spec: T;
  file: string;
  index: number;
}

/** Cross-file view of every sets file, in builder order. */
function crossIndex(all: readonly SetsInput[]) {
  const formations = new Map<string, Owner<CustomFormationSpec>[]>(); // lowercased full asset
  const formationLeaves = new Map<string, Owner<CustomFormationSpec>[]>(); // lowercased leaf
  const sets = new Map<string, Owner<CustomSetSpec>[]>(); // lowercased full asset
  const setsInFolder = new Map<string, Owner<CustomSetSpec>[]>(); // lowercased folder | norm(name)
  const clones = new Set<string>(); // lowercased clone keys
  const usedFormations = new Set<string>();
  const add = <T>(m: Map<string, Owner<T>[]>, k: string, v: Owner<T>) => {
    const l = m.get(k);
    if (l) l.push(v);
    else m.set(k, [v]);
  };
  for (const f of all) {
    formationsOf(f.data).forEach((spec, index) => {
      if (!isObj(spec) || !isValidAsset(spec.asset)) return;
      add(formations, customFormationAsset(spec.asset).toLowerCase(), { spec, file: f.path, index });
      add(formationLeaves, spec.asset.toLowerCase(), { spec, file: f.path, index });
    });
  }
  for (const f of all) {
    setsOf(f.data).forEach((spec, index) => {
      if (!isObj(spec)) return;
      if (typeof spec.formation === "string") usedFormations.add(spec.formation.toLowerCase());
      const asset = customSetAsset(spec);
      if (!asset) return;
      add(sets, asset.toLowerCase(), { spec, file: f.path, index });
      if (typeof spec.name === "string") add(setsInFolder, `${folder(spec.formation).toLowerCase()}|${norm(spec.name)}`, { spec, file: f.path, index });
      for (const c of Array.isArray(spec.plays) ? spec.plays : []) if (isObj(c) && isValidAsset(c.asset)) clones.add(cloneAsset(asset, c.asset).toLowerCase());
    });
  }
  return { formations, formationLeaves, sets, setsInFolder, clones, usedFormations };
}

const blockingCache = new WeakMap<LibraryIndex, Set<string>>();
/** Blocking scheme leaves used by library plays. */
function blockingLeaves(stock: LibraryIndex): Set<string> {
  let out = blockingCache.get(stock);
  if (!out) {
    out = new Set(stock.data.plays.map((p) => leaf(p.blocking ?? "")).filter(Boolean));
    blockingCache.set(stock, out);
  }
  return out;
}

/** §3 overrides on a clone (players/reads/vip/playType/blocking/runHole), structurally — the catalog resolves them. */
function cloneOverrideIssues(c: CloneSpec, n: number, stock: LibraryIndex, p: (level: ValidationIssue["level"], rule: string, msg: string) => void): void {
  const slots = `0–${Math.max(0, n - 1)}`;
  if (c.players !== undefined) {
    if (!isObj(c.players)) p("error", "set-play-players", `"players" must be an object of slot → assignment`);
    else {
      for (const [key, spec] of Object.entries(c.players)) {
        if (!/^\d+$/.test(key) || Number(key) >= n) {
          p("error", "set-play-players", `players: ${key} isn't a slot of this set (${slots})`);
          continue;
        }
        if (typeof spec === "string") {
          const path = spec.replace(/^\/+/, "");
          if (!stock.assignment(path) && !/^(football\/Gameplay\/playbooks\/PlayLibrary\/Assignments\/)?PBS\//.test(path)) p("error", "set-play-assignment", `slot ${key}: assignment not found (${spec})`);
        } else if (isObj(spec) && typeof spec.new === "string") {
          if (!/^[A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)*$/.test(spec.new)) p("error", "set-play-new", `slot ${key}: authored name "${spec.new}" must be [A-Za-z0-9_] (folders separated by /)`);
          if (!Array.isArray(spec.steps)) p("error", "set-play-new", `slot ${key}: "steps" must be an array`);
        } else p("error", "set-play-players", `slot ${key}: expected an assignment path or { "new": … }`);
      }
    }
  }
  if (c.vip !== undefined && !isSlot(c.vip, n)) p("error", "set-play-vip", `primary receiver (vip) ${String(c.vip)} isn't a slot (${slots})`);
  if (c.runHole !== undefined && !(Number.isInteger(c.runHole) && (c.runHole as number) >= 0 && (c.runHole as number) <= 9)) p("error", "set-play-runhole", `runHole ${String(c.runHole)} must be 0–9`);
  if (c.reads !== undefined) {
    if (!Array.isArray(c.reads)) p("error", "set-play-reads", `"reads" must be an array`);
    else
      c.reads.forEach((r, k) => {
        if (!isObj(r) || !isSlot(r.pos, n) || !isNum(r.pct)) p("error", "set-play-reads", `read ${k + 1}: needs a slot "pos" (${slots}) and a "pct"`);
      });
  }
  if (c.playType !== undefined) {
    const types = stock.enumValues("OffensePlayType");
    if (typeof c.playType !== "string" || (types.length && !types.includes(c.playType))) p("error", "set-play-type", `unknown play type ${String(c.playType)}`);
  }
  if (c.blocking !== undefined) {
    if (typeof c.blocking !== "string" || !c.blocking) p("error", "set-play-blocking", `"blocking" must be a blocking scheme name`);
    else if (!blockingLeaves(stock).has(leaf(c.blocking))) p("warning", "set-play-blocking", `blocking scheme ${c.blocking} isn't used by any library play`);
  }
}

/** Every FORMATS.md §5 rule for one sets file. `where` = "/sets/<i>…" / "/formations/<i>…". */
export function validateSetsFile(data: SetsFile, lib: LibraryIndex, ctx: SetsValidationContext = {}): ValidationIssue[] {
  const stock = lib.stock ?? lib;
  const file = ctx.file;
  const out: ValidationIssue[] = [];
  const push = (level: ValidationIssue["level"], rule: string, message: string, where?: string) => out.push({ level, rule, message, file, where });

  if (!data || typeof data !== "object" || !Array.isArray(data.sets)) {
    push("error", "sets-file", "A sets file needs a \"sets\" array");
    return out;
  }
  if (data.formations !== undefined && !Array.isArray(data.formations)) push("error", "sets-file", "\"formations\" must be an array", "/formations");

  const all: SetsInput[] = ctx.allFiles ?? [{ path: file ?? "", data }];
  const cross = crossIndex(all);
  const low = lowerIndex(stock);
  const fileOrder = new Map(all.map((f, i) => [f.path, i]));
  const before = (a: { file: string; index: number }, b: { file: string; index: number }) => {
    const fa = fileOrder.get(a.file) ?? 0;
    const fb = fileOrder.get(b.file) ?? 0;
    return fa !== fb ? fa < fb : a.index < b.index;
  };
  const me = (index: number) => ({ file: file ?? "", index });
  const others = <T>(list: Owner<T>[] | undefined, spec: T) => (list ?? []).filter((o) => o.spec !== spec);
  const where1 = (o: Owner<unknown>) => (o.file === (file ?? "") ? `#${o.index + 1}` : `${o.file} #${o.index + 1}`);

  // ── custom formations ──
  const formations = Array.isArray(data.formations) ? data.formations : [];
  const customFormationSide = (cf: CustomFormationSpec) => {
    const b = typeof cf.base === "string" ? stock.formationByAsset.get(cf.base) : undefined;
    return b && b.type !== "FormationType_Offense" ? b.type : "FormationType_Offense";
  };
  formations.forEach((cf, i) => {
    const where = `/formations/${i}`;
    if (!isObj(cf)) return push("error", "formation-entry", "Formation entry must be an object", where);
    const label = cf.name ? maddenName(cf.name) : cf.asset || `#${i + 1}`;
    if (typeof cf.name !== "string" || !cf.name.trim()) push("error", "formation-name", `Formation ${label}: name is required`, where);
    if (!isValidAsset(cf.asset)) push("error", "formation-asset", `Formation ${label}: asset must be [A-Za-z0-9_]`, where);
    else {
      const full = customFormationAsset(cf.asset);
      if (low.formations.has(full.toLowerCase())) push("error", "formation-asset-duplicate", `Formation asset ${cf.asset} collides with the library formation ${full}`, where);
      const dup = others(cross.formations.get(full.toLowerCase()), cf);
      if (dup.length) push("error", "formation-asset-duplicate", `Formation asset ${cf.asset} is also defined by ${dup.map(where1).join(", ")}`, where);
    }
    const bf = typeof cf.base === "string" ? stock.formationByAsset.get(cf.base) : undefined;
    if (!bf) push("error", "formation-base", `Formation ${label}: base ${typeof cf.base === "string" && cf.base ? leaf(cf.base) : "(missing)"} isn't a library formation`, where);
    else if (bf.type !== "FormationType_Offense") push("warning", "formation-base-side", `Formation ${label}: base ${maddenName(bf.name)} isn't an offense formation (custom formations are built under Formations/Offense)`, where);
    if (typeof cf.name === "string" && cf.name.trim()) {
      const type = customFormationSide(cf);
      const isDef = (t: string) => t === "FormationType_Defense" || t === "FormationType_KickReturn" || t === "FormationType_Safety_KickReturn";
      const clash = stock.data.formations.find((f) => norm(f.name) === norm(cf.name) && isDef(f.type) === isDef(type));
      if (clash) push("error", "formation-name-taken", `Formation ${label}: the library formation ${leaf(clash.asset)} is also called "${maddenName(cf.name)}" — playbooks would get the library one; rename it`, where);
      else {
        const earlier: Owner<CustomFormationSpec>[] = [];
        for (const [, list] of cross.formations) for (const o of list) if (o.spec !== cf && isObj(o.spec) && typeof o.spec.name === "string" && norm(o.spec.name) === norm(cf.name) && before(o, me(i))) earlier.push(o);
        if (earlier.length) push("error", "formation-name-duplicate", `Formation ${label}: custom formation ${where1(earlier[0])} is also called "${maddenName(cf.name)}" — playbooks get that one; rename this one`, where);
      }
    }
    if (isValidAsset(cf.asset) && !cross.usedFormations.has(customFormationAsset(cf.asset).toLowerCase())) push("info", "formation-unused", `Formation ${label} isn't used by any custom set`, where);
  });

  // ── custom sets ──
  const stances = new Set(stock.enumValues("StanceType"));

  data.sets.forEach((spec, i) => {
    const where = `/sets/${i}`;
    if (!isObj(spec)) return push("error", "set-entry", "Set entry must be an object", where);
    const label = spec.name ? maddenName(spec.name) : spec.asset || `#${i + 1}`;
    const p = (level: ValidationIssue["level"], rule: string, msg: string, w = where) => push(level, rule, `${label}: ${msg}`, w);

    if (typeof spec.name !== "string" || !spec.name.trim()) p("error", "set-name", "Name is required");
    if (!isValidAsset(spec.asset)) p("error", "set-asset", `Asset "${typeof spec.asset === "string" ? spec.asset : ""}" must be [A-Za-z0-9_]`);

    const base = typeof spec.base === "string" ? stock.setByAsset.get(spec.base) : undefined;
    if (!base) {
      p("error", "set-base", `Base set ${typeof spec.base === "string" && spec.base ? leaf(spec.base) : "(missing)"} isn't in the library`);
      return;
    }
    const baseForm = stock.formationByAsset.get(base.formation);
    if (baseForm && stock.formationSide(baseForm) !== "offense") p("warning", "set-base-side", `Base set ${maddenName(base.name)} isn't an offense set`);

    // Formation: a library formation, or a custom formation (any sets file) by its full asset path.
    let formAsset: Asset | undefined;
    const ref = typeof spec.formation === "string" ? spec.formation : "";
    if (!ref) p("error", "set-formation", "Formation is required");
    else if (low.formations.has(ref.toLowerCase())) {
      formAsset = low.formations.get(ref.toLowerCase())!.asset;
      if (formAsset !== base.formation) p("warning", "set-formation-mismatch", `Formation ${leaf(formAsset)} differs from the base set's (${leaf(base.formation)})`);
    } else if (cross.formations.has(ref.toLowerCase())) {
      const cf = cross.formations.get(ref.toLowerCase())![0].spec;
      formAsset = customFormationAsset(cf.asset);
      if (typeof cf.base === "string" && cf.base !== base.formation) p("warning", "set-formation-mismatch", `Custom formation ${maddenName(cf.name)} is based on ${leaf(cf.base)}, the base set is from ${leaf(base.formation)}`);
    } else if (!ref.includes("/") && cross.formationLeaves.has(ref.toLowerCase())) {
      p("error", "set-formation-path", `Formation must be the full asset path ${customFormationAsset(cross.formationLeaves.get(ref.toLowerCase())![0].spec.asset)} — the game-side builder looks formations up by path`);
    } else p("error", "set-formation", `Formation ${ref} isn't a library formation or a custom formation in playbooks/sets/`);

    // Asset and name inside the formation folder.
    if (formAsset && isValidAsset(spec.asset)) {
      const full = `${folder(formAsset)}${spec.asset}/${spec.asset}`;
      if (low.sets.has(full.toLowerCase())) p("error", "set-asset-duplicate", `Asset ${spec.asset} collides with the library set ${leaf(full)} in this formation`);
      const dup = others(cross.sets.get(full.toLowerCase()), spec);
      if (dup.length) p("error", "set-asset-duplicate", `Asset ${spec.asset} is also used by custom set ${dup.map(where1).join(", ")} in this formation`);
    }
    if (formAsset && typeof spec.name === "string" && spec.name.trim()) {
      const dir = folder(formAsset);
      const stockClash = stock.data.sets.find((s) => s.asset.startsWith(dir) && norm(s.name) === norm(spec.name));
      if (stockClash) p("error", "set-name-duplicate", `The library set ${leaf(stockClash.asset)} in this formation is also called "${maddenName(spec.name)}" — playbooks would get the library set; rename it`);
      else {
        const earlier = others(cross.setsInFolder.get(`${dir.toLowerCase()}|${norm(spec.name)}`), spec).filter((o) => before(o, me(i)));
        if (earlier.length) p("error", "set-name-duplicate", `Custom set ${where1(earlier[0])} in this formation is also called "${maddenName(spec.name)}" — playbooks get that one; rename this one`);
      }
    }

    // positions entries.
    const n = normalOf(base).length;
    const range = `0–${n - 1}`;
    if (spec.positions !== undefined) {
      if (!Array.isArray(spec.positions)) p("error", "set-positions", "Positions must be an array", `${where}/positions`);
      else {
        const seen = new Set<number>();
        spec.positions.forEach((e, k) => {
          const ew = `${where}/positions/${k}`;
          if (!isObj(e) || !isSlot(e.slot, n)) return p("error", "set-positions", `Positions entry ${k + 1}: slot must be ${range}`, ew);
          if (seen.has(e.slot)) p("warning", "set-positions-duplicate", `Positions: slot ${e.slot} is listed twice — the later entry wins`, ew);
          seen.add(e.slot);
          for (const f of ["x", "y", "facing"] as const) if (e[f] !== undefined && !isNum(e[f])) p("error", "set-positions", `Positions slot ${e.slot}: ${f} must be a number`, ew);
          if (e.stance !== undefined && (typeof e.stance !== "string" || (stances.size && !stances.has(e.stance)))) p("error", "set-stance", `Positions slot ${e.slot}: unknown stance ${String(e.stance)}`, ew);
          if (isNum(e.facing) && !Number.isInteger(e.facing)) p("warning", "set-facing", `Positions slot ${e.slot}: facing is stored in whole degrees (${e.facing} → ${Math.round(e.facing)})`, ew);
          if (isNum(e.facing) && (e.facing < 0 || e.facing >= 360)) p("warning", "set-facing", `Positions slot ${e.slot}: facing should be 0–359°`, ew);
          if (e.flipAssign !== undefined && !isSlot(e.flipAssign, n)) p("error", "set-flip-assign", `Positions slot ${e.slot}: flipAssign must be a slot (${range})`, ew);
          if (e.motionMan !== undefined && typeof e.motionMan !== "boolean") p("error", "set-motion-man", `Positions slot ${e.slot}: motionMan must be true or false`, ew);
        });
      }
    }

    const normal = effectiveNormal(base, spec);
    for (const issue of alignmentIssues(normal, base, { file, where })) out.push({ ...issue, message: `${label}: ${issue.message}` });

    // Motion presets: only the base set's presets, only the slots each one moves, x and y both.
    const mw = `${where}/movements`;
    if (spec.movements !== undefined && !isObj(spec.movements)) {
      p("error", "set-movements", "Movements must be an object of preset → entries", mw);
    } else if (isObj(spec.movements)) {
      const keys = basePresetKeys(base);
      for (const key of Object.keys(spec.movements)) {
        const w = `${mw}/${key}`;
        if (key === NORMAL) {
          p("error", "set-movements", "Use positions (not movements.Normal) for the base alignment", w);
          continue;
        }
        if (!isBasePreset(base, key)) {
          p("error", "set-preset-missing", `Base set ${maddenName(base.name)} has no motion preset ${key} — presets can't be added${keys.length ? ` (it has ${keys.map(presetLabel).join(", ")})` : ""}`, w);
          continue;
        }
        const list = spec.movements[key];
        if (!Array.isArray(list)) {
          p("error", "set-movements", `${presetLabel(key)} must be an array of { slot, x, y }`, w);
          continue;
        }
        const moves = presetSlots(base, key);
        const who = moves.map((s) => playerLabel(normal[s] ?? normalOf(base)[s])).join(", ");
        const seen = new Set<number>();
        list.forEach((e, k) => {
          const ew = `${w}/${k}`;
          if (!isObj(e) || !isSlot(e.slot, n)) return p("error", "set-movements", `${presetLabel(key)} entry ${k + 1}: slot must be ${range}`, ew);
          if (seen.has(e.slot)) p("warning", "set-positions-duplicate", `${presetLabel(key)}: slot ${e.slot} is listed twice — the later entry wins`, ew);
          seen.add(e.slot);
          if (!moves.includes(e.slot)) {
            p("error", "set-preset-slot", `${presetLabel(key)} doesn't move ${playerLabel(normal[e.slot])} (slot ${e.slot}) — a preset can only move its own players (${who || "none"})`, ew);
            return;
          }
          if (!isNum(e.x) || !isNum(e.y)) p("error", "set-preset-xy", `${presetLabel(key)} slot ${e.slot}: needs both x and y (the builder reads both)`, ew);
          const ignored = ["stance", "facing", "flipAssign", "motionMan"].filter((f) => e[f] !== undefined);
          if (ignored.length) p("warning", "set-preset-ignored", `${presetLabel(key)} slot ${e.slot}: only x/y of a preset target change — ${ignored.join(", ")} ${ignored.length > 1 ? "are" : "is"} ignored`, ew);
        });
        // Only check presets the spec actually changes (a few of the library's own presets break the line count).
        if (!changedPresetSlots(base, spec, key).length) continue;
        out.push(...presetIssues(base, spec, key, { file, where: w }).map((issue) => ({ ...issue, message: `${label}: ${issue.message}` })));
      }
    }

    // Plays cloned into the set (from any set), with optional §3 overrides.
    if (spec.plays !== undefined && !Array.isArray(spec.plays)) p("error", "set-plays", "Plays must be an array", `${where}/plays`);
    else if (Array.isArray(spec.plays)) {
      const names = new Map<string, number>();
      const assets = new Map<string, number>();
      for (const c of spec.plays) {
        if (isObj(c) && typeof c.name === "string") names.set(norm(c.name), (names.get(norm(c.name)) ?? 0) + 1);
        if (isObj(c) && typeof c.asset === "string") assets.set(c.asset.toLowerCase(), (assets.get(c.asset.toLowerCase()) ?? 0) + 1);
      }
      const layout = (s: SetDef) => normalOf(s).map((a) => positionCode(a.pos)).join(",");
      spec.plays.forEach((c, k) => {
        const w = `${where}/plays/${k}`;
        if (!isObj(c)) return p("error", "set-plays", `Play ${k + 1} must be an object`, w);
        const from = typeof c.from === "string" ? c.from : "";
        const pl = typeof c.name === "string" && c.name ? maddenName(c.name) : from ? leaf(from) : `#${k + 1}`;
        const cp = (level: ValidationIssue["level"], rule: string, msg: string) => p(level, rule, `Play ${pl}: ${msg}`, w);
        const play = from ? stock.playByAsset.get(from) : undefined;
        if (!from) cp("error", "set-play-from", `"from" (the play to clone) is required`);
        else if (!play && !cross.clones.has(from.toLowerCase())) cp("error", "set-play-from", `${leaf(from)} isn't a library play or a play cloned into a custom set`);
        if (play && play.set !== base.asset) {
          const fromSet = stock.setByAsset.get(play.set);
          if (fromSet && layout(fromSet) !== layout(base)) cp("warning", "set-play-layout", `comes from ${maddenName(fromSet.name)}, whose players line up in a different slot order — its assignments go to this set's players by slot`);
        }
        if (typeof c.name !== "string" || !c.name.trim()) p("error", "set-play-name", `Play ${k + 1}: name is required`, w);
        else if ((names.get(norm(c.name)) ?? 0) > 1) p("error", "set-play-name", `Play name "${maddenName(c.name)}" is used twice in this set`, w);
        if (!isValidAsset(c.asset)) cp("error", "set-play-asset", `asset must be [A-Za-z0-9_]`);
        else if ((assets.get(c.asset.toLowerCase()) ?? 0) > 1) p("error", "set-play-asset", `Play asset ${c.asset} is used twice in this set`, w);
        cloneOverrideIssues(c, n, stock, cp);
        if (play) {
          // Same rule as the Formations editor: measured against the play's OWN set; receivers' blocks follow them
          // (FORMATS.md §5). Slot-order / personnel differences are "set-play-layout" above.
          const deps = cloneWarnings(stock, play, normal).filter((d) => d.kind !== "personnel" && d.kind !== "source");
          if (deps.length) {
            const bySlot = [...new Set(deps.map((d) => d.label))].join(", ");
            cp("warning", "set-play-depends", `depends on moved ${bySlot}: ${deps[0].reason}${deps.length > 1 ? ` (+${deps.length - 1} more)` : ""}`);
          }
        }
      });
    }
  });
  return out;
}

/** Issues for every sets file, with cross-file formations, assets, names and clones. */
export function validateSetsFiles(files: { path: string; data: SetsFile | null | undefined }[], lib: LibraryIndex): ValidationIssue[] {
  return files.flatMap((f) => (f.data ? validateSetsFile(f.data, lib, { file: f.path, allFiles: files }) : []));
}

/** Issues that belong to set `index` of a file (where starts with /sets/<index>). */
export function issuesForSet(issues: ValidationIssue[], index: number): ValidationIssue[] {
  const prefix = `/sets/${index}`;
  return issues.filter((i) => i.where === prefix || i.where?.startsWith(prefix + "/"));
}

/** Sets-file path for a user-typed name: "Trips Ideas" → "playbooks/sets/trips-ideas.json". */
export function setsFilePath(name: string): string | undefined {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/\.json$/i, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug ? `${SETS_DIR}${slug}.json` : undefined;
}
