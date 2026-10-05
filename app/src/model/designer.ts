// Play designer model (pure): editor state ⇄ CustomPlaySpec (docs/FORMATS.md §3), plus the helpers the designer
// view needs (slot roles, locks, name/asset rules, base-play grouping for the wizard, reads).
//
// The editor state holds every slot's FULL step chain (trailing None included), starting from the resolved custom
// play. `specFromState` writes the MINIMAL spec back:
// - a slot that equals its base assignment gets no `players` entry;
// - a slot whose steps still equal what its loaded player spec resolved to keeps that spec verbatim (unknown keys,
//   names and `keep` survive untouched);
// - steps equal to a library assignment → its path under ASSIGNMENT_ROOT; equal to an authored assignment already
//   defined in a plays file → that `new` name again (identical steps); otherwise a `new` spec whose name is kept
//   from the slot (unless another play shares it) or generated (prefix + "<Role>_<Family><depth>"), with
//   `keep` = the leading steps it shares with its template (the base slot), e.g. 1 for a kept AutoMotion.
// - playType / blocking / runHole / vip / reads stay exactly as loaded unless edited (setPlayField).
// - Authored names and routeTypes follow the route: applying a preset / tool, or a hand edit that changes what the
//   route is (its inferred routeType), drops the old routeType (re-inferred on write unless the preset gave one) and
//   regenerates a GENERATED-looking name ("PBS_X_Corner10" → "PBS_X_Slant"); a name the user picked is kept.
// - Only step types the library's assignments use can be built (the game-side PlayBuilder copies each step class's
//   opcode from a library instance): `unbuildableSteps` lists the others so the views can flag them.
import { resolveCustomPlay, type AuthoredAssignment, type Catalog } from "./catalog";
import type { LibraryIndex } from "./library";
import { folder, leaf, maddenName, norm, sanitizeAssetLeaf, uniqueName } from "./names";
import { HALF_WIDTH } from "./geometry";
import { isEligible, isOffensiveLine, positionCode, slotLabel } from "./positions";
import { playTypeInfo } from "./playtypes";
import { applySavedRouteSteps, savedRouteNameBase } from "./routeLibrary";
import {
  BLOCK_FAMILY,
  DEPTH_FAMILIES,
  DOUBLE_MOVES,
  ROUTE_PRESETS,
  ROUTE_TYPE_FAMILIES,
  familyFromRouteType,
  inferRouteType,
  routeStart,
  sideOfX,
  stemDepth,
  toEditableRoute,
} from "./routes";
import { isMechanics, stepsEqual, stripNone } from "./steps";
import {
  ASSIGNMENT_ROOT,
  BLOCKING_ROOT,
  PLAYLIBRARY_ROOT,
  type Asset,
  type CustomPlaySpec,
  type NewAssignmentSpec,
  type PlayDef,
  type PlayerSpec,
  type PlaysFile,
  type ReadDef,
  type ResolvedPlay,
  type SavedRoute,
  type SetDef,
  type Step,
  type Vec,
} from "./types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const isNewSpec = (v: unknown): v is NewAssignmentSpec => isObj(v) && typeof v.new === "string";
const NONE: Step = Object.freeze({ type: "None" }) as Step;

// ───────────────────────────── state ─────────────────────────────

export interface SlotDesign {
  /** The slot's full chain as the game will run it (trailing None included). */
  steps: Step[];
  /** The player spec this slot had when loaded (undefined = the base assignment). */
  spec?: PlayerSpec;
  /** What `spec` resolved to; while `steps` still equal it, `spec` is written back verbatim. */
  specSteps?: Step[];
  /** Library assignment path (under ASSIGNMENT_ROOT) the user picked; written as a string while steps match it. */
  assignment?: string;
  /** AssignRouteType for authored steps (from a preset, the loaded spec or the user). */
  routeType?: string;
  /** Preferred authored assignment name (kept unless another play shares it). */
  name?: string;
  /** Family word for generated names ("Corner"). */
  family?: string;
  /** The user renamed the authored assignment: `name` wins over reusing an identical authored assignment. */
  forceName?: boolean;
  /**
   * What the route is changed in this edit (a preset / tool was applied, or a hand edit changed its inferred
   * routeType): a generated `name` is regenerated for the new route on write.
   */
  retitle?: boolean;
  /**
   * Name base for a NEW authored name (instead of "<prefix><Role>_<Family><depth>"): set when a saved route from My
   * Routes is applied ("PBS_Deep_Over"), so the assignment is named after the route. Cleared by presets / tools.
   */
  nameBase?: string;
}

export interface DesignerState {
  /** The play spec without `players`: name, asset, base, optional fields and unknown keys, as loaded/edited. */
  play: CustomPlaySpec;
  /** `players` entries that are not slots of the set (kept verbatim). */
  extraPlayers: Obj;
  /** The loaded spec had an empty `players` object (kept so an untouched play round-trips exactly). */
  emptyPlayers: boolean;
  base?: PlayDef;
  set?: SetDef;
  /** Base play assignment chains per slot (library arrays; never mutate). */
  baseSlots: Step[][];
  /** Base assignment asset per slot. */
  baseAssets: Asset[];
  slots: SlotDesign[];
}

/** Path under ASSIGNMENT_ROOT for a full asset or a path. */
export function assignmentPath(assetOrPath: string): string {
  return assetOrPath.startsWith(ASSIGNMENT_ROOT) ? assetOrPath.slice(ASSIGNMENT_ROOT.length) : assetOrPath;
}

/**
 * A play cloned into a custom set (FORMATS.md §5 `plays`), as the catalog overlay resolves it: a custom ResolvedPlay
 * that doesn't come from a playbooks/plays file. Clones may be the base of a new custom play.
 */
export function isClonePlay(p: ResolvedPlay | undefined): boolean {
  return !!p && p.source === "custom" && !(typeof p.file === "string" && p.file.startsWith("playbooks/plays/"));
}

/** A PlayDef-shaped view of a resolved clone (so a clone can be a base like a library play). */
function cloneAsPlayDef(p: ResolvedPlay): PlayDef {
  return {
    playId: -1,
    name: p.name,
    asset: p.asset,
    set: p.set,
    offensePlayType: p.playType,
    defensePlayType: "",
    blocking: p.blocking,
    runHole: p.runHole,
    vip: p.vip,
    allowHotRoutes: p.allowHotRoutes,
    canFlip: p.canFlip,
    global: false,
    assignments: p.slots.map((s) => s.assignment ?? (s.authored ? `${ASSIGNMENT_ROOT}PBS/${s.authored}` : "")),
    reads: p.reads,
  };
}

/**
 * The base play of a spec: a library play (catalog.lib — with the catalog overlay this also holds custom sets), or a
 * clone in a custom set (catalog.get). Base slot chains come from the library assignments, else from the resolved
 * clone's slots (authored clone assignments aren't library assets).
 */
export function basePlayOf(catalog: Catalog, asset: unknown): { def?: PlayDef; steps: Step[][]; assets: Asset[] } {
  if (typeof asset !== "string" || !asset) return { steps: [], assets: [] };
  const lib = catalog.lib;
  let def = lib.playByAsset.get(asset);
  let resolved: ResolvedPlay | undefined;
  const resolve = () => (resolved ??= catalog.get(asset));
  if (!def) {
    const rp = resolve();
    if (!rp || !isClonePlay(rp)) return { steps: [], assets: [] };
    def = cloneAsPlayDef(rp);
  }
  const steps = def.assignments.map((a, i) => lib.assignment(a)?.steps ?? resolve()?.slots[i]?.steps ?? [NONE]);
  return { def, steps, assets: def.assignments.slice() };
}

/** Editor state for a custom play spec (`file`/`index` locate it, so its own authored definitions resolve as first). */
export function stateFromSpec(spec: CustomPlaySpec, catalog: Catalog, file = "", index = -1): DesignerState {
  const lib = catalog.lib;
  const { players, ...play } = spec;
  const bs = basePlayOf(catalog, spec.base);
  const base = bs.def;
  const set = base ? lib.setByAsset.get(base.set) : undefined;
  const resolved = base ? resolveCustomPlay(lib, spec, file, index, catalog.authored) : undefined;
  const pl = isObj(players) ? players : {};
  const slots: SlotDesign[] = bs.steps.map((b, i) => {
    const ps = pl[String(i)] as PlayerSpec | undefined;
    const steps = resolved?.slots[i]?.steps ?? b;
    const d: SlotDesign = { steps };
    if (ps !== undefined) {
      d.spec = ps;
      d.specSteps = steps;
    }
    if (typeof ps === "string") d.assignment = assignmentPath(ps);
    else if (isNewSpec(ps)) {
      d.name = ps.new;
      if (typeof ps.routeType === "string") d.routeType = ps.routeType;
    }
    return d;
  });
  const extraPlayers: Obj = {};
  for (const k of Object.keys(pl)) {
    if (!/^\d+$/.test(k) || Number(k) >= bs.steps.length) extraPlayers[k] = pl[k];
  }
  return {
    play: play as CustomPlaySpec,
    extraPlayers,
    emptyPlayers: isObj(players) && Object.keys(players).length === 0,
    base,
    set,
    baseSlots: bs.steps,
    baseAssets: bs.assets,
    slots,
  };
}

// ───────────────────────────── spec emission ─────────────────────────────

export interface SpecContext {
  catalog: Catalog;
  /** Every plays doc with its current data (to see which authored names other plays share, and keep names unique). */
  docs: { path: string; data: PlaysFile | null | undefined }[];
  /** This play's file and index in it. */
  file: string;
  index: number;
  /** settings.assetPrefix ("PBS_"). */
  prefix: string;
}

/** Canonical key for step equality (key order and trailing None ignored). */
export function stepsKey(steps: readonly Step[]): string {
  return JSON.stringify(canon(stripNone(steps as Step[])));
}

function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const o = v as Obj;
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, canon(o[k])]),
    );
  }
  return v;
}

const libIndexCache = new WeakMap<LibraryIndex, Map<string, string>>();

/** Library assignment path (under ASSIGNMENT_ROOT) by steps key; the first asset wins for duplicates. */
export function libraryStepsIndex(lib: LibraryIndex): Map<string, string> {
  let m = libIndexCache.get(lib);
  if (!m) {
    m = new Map();
    for (const asset of Object.keys(lib.data.assignments)) {
      const k = stepsKey(lib.data.assignments[asset].steps);
      if (!m.has(k)) m.set(k, assignmentPath(asset));
    }
    libIndexCache.set(lib, m);
  }
  return m;
}

const stepTypeCache = new WeakMap<LibraryIndex, ReadonlySet<string>>();

/**
 * Step types used by the library's assignments — the only ones the game-side PlayBuilder can author: it copies
 * each step class's opcode from a library instance and throws for a class it has never seen (RunRouteFakeOut,
 * RunRouteTurbo, CallForBall… exist only in enums.json).
 */
export function libraryStepTypes(lib: LibraryIndex): ReadonlySet<string> {
  let set = stepTypeCache.get(lib);
  if (!set) {
    const types = new Set<string>();
    for (const a of Object.values(lib.data.assignments)) for (const st of a.steps) types.add(st.type);
    set = types;
    stepTypeCache.set(lib, set);
  }
  return set;
}

/** Steps of a chain whose type has no library instance (the builder can't author them), with their indexes. */
export function unbuildableSteps(steps: readonly Step[], lib: LibraryIndex): { index: number; type: string }[] {
  const known = libraryStepTypes(lib);
  const out: { index: number; type: string }[] = [];
  steps.forEach((st, index) => {
    if (!known.has(st.type)) out.push({ index, type: st.type });
  });
  return out;
}

/** Why a step type can't be built (chip / tooltip text). */
export function unbuildableReason(type: string): string {
  return `${type} has no instance in the library's assignments, so the game-side builder can't author it — remove it or pick another step type.`;
}

export interface AuthoredUse {
  file: string;
  index: number;
  slot: string;
  play: string;
}

/** Every `new` name used by any play spec in the docs → where. */
export function authoredUses(docs: SpecContext["docs"]): Map<string, AuthoredUse[]> {
  const out = new Map<string, AuthoredUse[]>();
  for (const d of docs) {
    const plays = Array.isArray(d.data?.plays) ? d.data!.plays : [];
    plays.forEach((p, index) => {
      if (!isObj(p) || !isObj(p.players)) return;
      for (const [slot, ps] of Object.entries(p.players)) {
        if (!isNewSpec(ps)) continue;
        const list = out.get(ps.new) ?? [];
        list.push({ file: d.path, index, slot, play: typeof p.name === "string" ? p.name : "" });
        out.set(ps.new, list);
      }
    });
  }
  return out;
}

/** Number of leading steps two chains share (deep equality per step). */
export function commonPrefix(a: readonly Step[], b: readonly Step[]): number {
  const x = stripNone(a as Step[]);
  const y = stripNone(b as Step[]);
  let n = 0;
  while (n < x.length && n < y.length && (x[n] === y[n] || stepsKey([x[n]]) === stepsKey([y[n]]))) n++;
  return n;
}

/**
 * Role label for generated names: QB, HB, FB, X (outermost left receiver), Z (outermost right), Slot (other
 * receivers), Y (first TE), TE2…, LT LG C RG RT.
 */
export function slotRoleLabel(set: SetDef | undefined, slot: number): string {
  const normal = set?.movements?.Normal ?? [];
  const a = normal[slot];
  if (!a) return `S${slot}`;
  const code = positionCode(a.pos);
  if (code === "TE") {
    const tes = normal.map((p, i) => ({ p, i })).filter((t) => positionCode(t.p.pos) === "TE");
    const rank = tes.findIndex((t) => t.i === slot);
    return rank <= 0 ? "Y" : `TE${rank + 1}`;
  }
  if (code === "WR" || code === "SL") {
    const recs = normal.map((p, i) => ({ p, i })).filter((t) => ["WR", "SL"].includes(positionCode(t.p.pos)));
    const left = recs.filter((t) => t.p.x < 0).sort((u, v) => u.p.x - v.p.x)[0];
    const right = recs.filter((t) => t.p.x >= 0).sort((u, v) => v.p.x - u.p.x)[0];
    if (left?.i === slot && code === "WR") return "X";
    if (right?.i === slot && code === "WR") return "Z";
    return "Slot";
  }
  if (code === "HB" || code === "FB" || code === "QB") {
    const same = normal.map((p, i) => ({ p, i })).filter((t) => positionCode(t.p.pos) === code);
    const rank = same.findIndex((t) => t.i === slot);
    return rank <= 0 ? code : `${code}${rank + 1}`;
  }
  return slotLabel(a.pos, a.depth);
}

/** Generated authored-assignment name base (before uniquing): "PBS_Slot_Corner7". */
export function authoredNameBase(prefix: string, role: string, family: string, depth?: number): string {
  const p = prefix && !prefix.endsWith("_") ? `${prefix}_` : prefix;
  const d = depth !== undefined && depth > 0 ? String(depth) : "";
  return sanitizeAssetLeaf(`${p}${role}_${family}${d}`) || "PBS_Route";
}

/** Family words of generated names (presets, double moves, block tools, route types, fallbacks). */
export const NAME_FAMILIES: ReadonlySet<string> = new Set([
  ...ROUTE_PRESETS.map((p) => p.family),
  ...DOUBLE_MOVES.map((d) => d.family),
  ...Object.values(BLOCK_FAMILY),
  ...ROUTE_TYPE_FAMILIES,
  "Motion",
  "Run",
  "Handoff",
  "Route",
]);

/**
 * The authored name looks generated for this slot role ("PBS_Slot_Corner7", "PBS_X_Slant_2"): prefix + role +
 * a known family word + optional depth + optional unique suffix. Anything else is a name the user picked.
 */
export function isGeneratedName(name: string, role: string): boolean {
  const m = new RegExp(`(?:^|_)${role.replace(/[^A-Za-z0-9]/g, "")}_([A-Za-z]+?)\\d*(?:_\\d+)?$`).exec(name);
  return !!m && NAME_FAMILIES.has(m[1]);
}

/** `name` is `base` or `base` with a uniqueName suffix ("_2"), case-insensitive. */
function isNameFor(name: string, base: string): boolean {
  const n = name.toLowerCase();
  const b = base.toLowerCase();
  return n === b || (n.startsWith(`${b}_`) && /^\d+$/.test(n.slice(b.length + 1)));
}

function familyFor(steps: Step[], routeType: string | undefined): string {
  const fam = familyFromRouteType(routeType);
  if (fam) return fam;
  const body = stripNone(steps);
  if (body.some((s) => s.type === "AutoMotion") && !toEditableRoute(body).legs.length) return "Motion";
  if (body.some((s) => s.type === "RunEndZone")) return "Run";
  if (body.some(isMechanics)) return "Handoff";
  return "Route";
}

/** Side of the field a slot's route starts on (after realignment / motion). */
export function slotSide(state: DesignerState, slot: number, steps: Step[] = state.slots[slot]?.steps ?? []): "left" | "right" {
  const a = state.set?.movements?.Normal?.[slot];
  if (!a) return "right";
  const r = toEditableRoute(steps);
  return sideOfX(routeStart({ x: a.x, y: a.y }, r.prefix, steps).x);
}

/** The minimal CustomPlaySpec for the editor state (see the file header). */
export function specFromState(state: DesignerState, ctx: SpecContext): CustomPlaySpec {
  const lib = ctx.catalog.lib;
  const out = { ...state.play } as CustomPlaySpec;
  delete (out as Obj).players;
  if (!state.base) {
    // Unknown base: nothing to compare against — keep the loaded players verbatim.
    const players: Obj = {};
    state.slots.forEach((s, i) => s.spec !== undefined && (players[String(i)] = s.spec));
    Object.assign(players, state.extraPlayers);
    if (Object.keys(players).length || state.emptyPlayers) out.players = players as Record<string, PlayerSpec>;
    return out;
  }

  const uses = authoredUses(ctx.docs);
  const libIndex = libraryStepsIndex(lib);
  const taken = new Set<string>([...ctx.catalog.authored.keys(), ...uses.keys()]);
  /** name → steps key it is written with in this spec. */
  const emitted = new Map<string, string>();
  const players: Record<string, PlayerSpec> = {};
  const isThisPlay = (u: AuthoredUse) => u.file === ctx.file && u.index === ctx.index;
  const sharedElsewhere = (name: string) => (uses.get(name) ?? []).some((u) => !isThisPlay(u));
  const canClaim = (name: string, key: string) => !emitted.has(name) || emitted.get(name) === key;

  // Pass 1: slots whose loaded spec still holds are written verbatim (and claim their names).
  const pending: number[] = [];
  state.slots.forEach((slot, i) => {
    if (slot.spec !== undefined && slot.specSteps && stepsEqual(slot.steps, slot.specSteps)) {
      players[String(i)] = slot.spec;
      if (isNewSpec(slot.spec)) emitted.set(slot.spec.new, stepsKey(slot.steps));
    } else pending.push(i);
  });

  // Pass 2: changed slots.
  for (const i of pending) {
    const slot = state.slots[i];
    const cur = stripNone(slot.steps);
    const key = stepsKey(cur);
    const baseSteps = state.baseSlots[i] ?? [NONE];
    if (stepsKey(baseSteps) === key) continue; // back to the base assignment
    if (slot.assignment) {
      const a = lib.assignment(slot.assignment);
      if (a && stepsKey(a.steps) === key) {
        players[String(i)] = slot.assignment;
        continue;
      }
    }
    const libPath = libIndex.get(key);
    if (libPath) {
      players[String(i)] = libPath;
      continue;
    }
    const old = isNewSpec(slot.spec) ? slot.spec : undefined;
    const template = typeof old?.template === "string" && old.template ? old.template : undefined;
    const templateSteps = template ? (lib.assignment(template)?.steps ?? ctx.catalog.authored.get(authoredRef(template) ?? "")?.steps) : baseSteps;

    // Reuse an authored assignment with identical steps.
    let name: string | undefined;
    let reused: AuthoredAssignment | undefined;
    const usable = (n: string | undefined): n is string => !!n && !sharedElsewhere(n) && canClaim(n, key);
    if (slot.forceName && usable(slot.name)) name = slot.name;
    if (!name) for (const [n, def] of ctx.catalog.authored) {
      if (stepsKey(def.steps) === key && canClaim(n, key)) {
        name = n;
        reused = def;
        break;
      }
    }
    // Another slot of this play already got these exact steps in this pass: share its name.
    if (!name) for (const [n, k] of emitted) if (k === key) name = n;
    // No fallback to the loaded spec's routeType: an edit that cleared `slot.routeType` made it stale.
    const routeType = slot.routeType ?? reused?.routeType ?? inferRouteType(cur, slotSide(state, i));
    const role = slotRoleLabel(state.set, i);
    const family = slot.family ?? familyFor(cur, routeType);
    const baseName = slot.nameBase || authoredNameBase(ctx.prefix, role, family, DEPTH_FAMILIES.has(family) ? stemDepth(cur) : undefined);
    // The slot's name sticks unless it is a generated one and the route changed into something else.
    if (!name && usable(slot.name) && (!slot.retitle || !isGeneratedName(slot.name, role) || isNameFor(slot.name, baseName))) name = slot.name;
    if (!name) {
      const pool = new Set([...taken, ...emitted.keys()]);
      // The slot's previous name is free again when nothing else uses it (no "_2" churn when it comes back).
      const own = old?.new;
      if (own && !sharedElsewhere(own) && !emitted.has(own)) pool.delete(own);
      name = uniqueName(baseName, pool);
    }
    taken.add(name);
    emitted.set(name, key);

    const keep = templateSteps ? commonPrefix(cur, templateSteps) : 0;
    const ns: NewAssignmentSpec = { ...(old ?? {}), new: name, steps: cur.slice(keep) } as NewAssignmentSpec;
    if (typeof routeType === "string" && routeType) ns.routeType = routeType;
    else delete ns.routeType;
    if (!template) delete ns.template;
    if (keep > 0) ns.keep = keep;
    else if (old && "keep" in old) ns.keep = 0;
    else delete ns.keep;
    players[String(i)] = ns;
  }

  const ordered: Obj = {};
  for (const k of Object.keys(players).sort((a, b) => Number(a) - Number(b))) ordered[k] = players[k];
  Object.assign(ordered, state.extraPlayers);
  if (Object.keys(ordered).length || state.emptyPlayers) out.players = ordered as Record<string, PlayerSpec>;
  return out;
}

function authoredRef(path: string): string | undefined {
  const p = assignmentPath(path);
  return p.startsWith("PBS/") ? p.slice(4) : undefined;
}

// ───────────────────────────── state edits (pure) ─────────────────────────────

function withSlot(state: DesignerState, i: number, slot: SlotDesign): DesignerState {
  const slots = state.slots.slice();
  slots[i] = slot;
  return { ...state, slots };
}

export interface SlotMeta {
  routeType?: string;
  family?: string;
  assignment?: string;
  /**
   * Forget the slot's authored name (it named something else, e.g. a route applied from My Routes that a preset now
   * replaces): a new name is generated for the new route on write.
   */
  dropName?: boolean;
}

/**
 * Replace a slot's chain (a trailing None is added when missing). Meta from a preset / tool / route picker sets the
 * routeType and family; a hand edit (no meta) that changes the route's inferred routeType drops the old one (it's
 * re-inferred on write). Either way a generated authored name is regenerated (see `retitle`).
 */
export function setSlotSteps(state: DesignerState, i: number, steps: Step[], meta: SlotMeta = {}): DesignerState {
  const cur = state.slots[i];
  if (!cur) return state;
  const chain = steps.length && steps[steps.length - 1].type === "None" ? steps : [...steps, NONE];
  const next: SlotDesign = { ...cur, steps: chain };
  if ("routeType" in meta || "family" in meta) {
    if ("routeType" in meta) next.routeType = meta.routeType;
    if ("family" in meta) next.family = meta.family;
    next.retitle = true;
    // A preset / tool replaces a route applied from My Routes: its name goes with it.
    if (cur.nameBase) {
      if (cur.name && isNameFor(cur.name, cur.nameBase)) next.name = undefined;
      next.nameBase = undefined;
    }
  } else if (inferRouteType(cur.steps, slotSide(state, i, cur.steps)) !== inferRouteType(chain, slotSide(state, i, chain))) {
    next.routeType = undefined;
    next.family = undefined;
    next.retitle = true;
  }
  if (meta.dropName) {
    next.name = undefined;
    next.nameBase = undefined;
    next.forceName = false;
    next.retitle = true;
  }
  next.assignment = meta.assignment;
  return withSlot(state, i, next);
}

/**
 * Authored-assignment details from the INFO tab: routeType and/or a new name. The slot is re-emitted (its loaded
 * spec is dropped) so the change is written even when the steps didn't change.
 */
export function setSlotInfo(state: DesignerState, i: number, info: { routeType?: string; name?: string }): DesignerState {
  const cur = state.slots[i];
  if (!cur) return state;
  const next: SlotDesign = { ...cur, spec: undefined, specSteps: undefined };
  if ("routeType" in info) next.routeType = info.routeType;
  if (info.name !== undefined) {
    next.name = sanitizeAssetLeaf(info.name) || cur.name;
    next.forceName = true;
  }
  return withSlot(state, i, next);
}

/** The slot is written as an authored (`new`) assignment (or would be, once changed from the base / library). */
export function isAuthoredSlot(state: DesignerState, lib: LibraryIndex, i: number): boolean {
  const s = state.slots[i];
  if (!s || !isSlotChanged(state, i)) return false;
  if (s.spec !== undefined && s.specSteps && stepsEqual(s.steps, s.specSteps)) return isNewSpec(s.spec);
  if (s.assignment && lib.assignment(s.assignment) && stepsEqual(lib.assignment(s.assignment)!.steps, s.steps)) return false;
  return !libraryStepsIndex(lib).has(stepsKey(s.steps));
}

/** Use an existing library assignment for a slot (written as its path). */
export function setSlotAssignment(state: DesignerState, lib: LibraryIndex, i: number, path: string): DesignerState {
  const a = lib.assignment(path);
  if (!a) return state;
  return setSlotSteps(state, i, a.steps, { assignment: assignmentPath(path), routeType: a.routeType });
}

/** Back to the base play's assignment. */
export function resetSlot(state: DesignerState, i: number): DesignerState {
  const base = state.baseSlots[i];
  if (!base || !state.slots[i]) return state;
  return withSlot(state, i, { steps: base });
}

// ───────────────────────────── My Routes ─────────────────────────────

export interface ApplySavedRouteOptions {
  /** settings.assetPrefix: the authored name becomes prefix + route name ("PBS_Deep_Over"). */
  prefix: string;
  /** Leading steps kept as a precan (the view's lockOf); default = the slot's motion / realignment / mechanics. */
  keep?: number;
  /** AssignRouteType values (lib.enumValues) — a mirrored side-specific routeType must exist. */
  routeTypes?: ReadonlySet<string>;
}

/**
 * Put a saved route (My Routes) on a slot: its route part is replaced (motion / realignment / kept precan stay), the
 * route is mirrored when the player is on the other side, and a new authored assignment is named after the route
 * (identical authored steps from any plays file are still reused — specFromState).
 */
export function applySavedRoute(state: DesignerState, i: number, route: SavedRoute, opts: ApplySavedRouteOptions): DesignerState {
  const cur = state.slots[i];
  if (!cur) return state;
  const side = slotSide(state, i);
  const r = applySavedRouteSteps(cur.steps, route, side, opts.keep, opts.routeTypes);
  const nameBase = savedRouteNameBase(opts.prefix, route.name, r.mirrored ? side : undefined);
  const next: SlotDesign = {
    ...cur,
    steps: r.steps,
    routeType: r.routeType,
    family: familyFromRouteType(r.routeType),
    name: nameBase,
    nameBase,
    retitle: false,
    forceName: false,
    assignment: undefined,
  };
  return withSlot(state, i, next);
}

/** The routeType a slot's authored steps carry (picked, loaded or inferred) — what "Save route" stores. */
export function slotRouteType(state: DesignerState, i: number): string | undefined {
  const s = state.slots[i];
  if (!s) return undefined;
  if (s.routeType) return s.routeType;
  if (isNewSpec(s.spec) && typeof s.spec.routeType === "string" && s.specSteps && stepsEqual(s.steps, s.specSteps)) return s.spec.routeType;
  return inferRouteType(s.steps, slotSide(state, i));
}

// ───────────────────────────── play-specific start spot (OverrideFormPos) ─────────────────────────────

/** Index of the slot's OverrideFormPos step (its play-specific start spot), or −1. */
export function startOverrideIndex(steps: readonly Step[]): number {
  return steps.findIndex((s) => s.type === "OverrideFormPos");
}

/** The play-specific start spot (absolute OverrideFormPos offsetX / offsetY), if any. */
export function startOverride(steps: readonly Step[]): Vec | undefined {
  const s = steps[startOverrideIndex(steps)];
  return s && typeof s.offsetX === "number" && typeof s.offsetY === "number" ? { x: s.offsetX, y: s.offsetY } : undefined;
}

export type StartLock = { movable: true } | { movable: false; reason: "mechanics" | "line" | "qb" | "unknown" };

/**
 * Whether a player may get a play-specific start spot: eligible receivers and backs without handoff mechanics. The
 * QB and the line stay put (handoffs and protection depend on them), and handoff / fake / option players keep the
 * base play's spot because their precan is paired with the QB (FORMATS.md §3).
 */
export function startLock(state: DesignerState, i: number): StartLock {
  const a = state.set?.movements?.Normal?.[i];
  if (!a) return { movable: false, reason: "unknown" };
  if (isSlotLocked(state, i)) return { movable: false, reason: "mechanics" };
  if (isOffensiveLine(a.pos)) return { movable: false, reason: "line" };
  if (positionCode(a.pos) === "QB") return { movable: false, reason: "qb" };
  return { movable: true };
}

/** Line of scrimmage class: players on the ball (y > −1.5) stay on it and off-ball players stay off it (7 on the line). */
export const ON_LINE_Y = -1.5;

/**
 * Clamp a start spot: inside the sidelines and in the same line class as the formation spot (an on-ball receiver
 * stays between y −1.4 and −0.6, an off-ball player between −12 and −1.6), so the formation stays legal.
 */
export function clampStartSpot(formationSpot: Vec, p: Vec): Vec {
  const onLine = formationSpot.y > ON_LINE_Y;
  const x = Math.max(-(HALF_WIDTH - 1), Math.min(HALF_WIDTH - 1, p.x));
  const y = onLine ? Math.max(-1.4, Math.min(-0.6, p.y)) : Math.max(-12, Math.min(-1.6, p.y));
  return { x: Math.round(x * 100) / 100 + 0, y: Math.round(y * 100) / 100 + 0 };
}

/** Stance written with a new OverrideFormPos (the library uses "Receiver" for receivers and TEs, "HB" for backs). */
export function startStanceFor(pos: string): string {
  const code = positionCode(pos);
  return code === "HB" || code === "FB" ? "HB" : "Receiver";
}

/**
 * Move a player for this play only: an OverrideFormPos first step (absolute x / y, FORMATS.md step table) — the
 * route, which is relative, moves with them; absolute motion waypoints stay. Back on the formation spot = removed.
 */
export function setStartOverride(state: DesignerState, i: number, p: Vec): DesignerState {
  const cur = state.slots[i];
  const a = state.set?.movements?.Normal?.[i];
  if (!cur || !a) return state;
  const spot = clampStartSpot({ x: a.x, y: a.y }, p);
  if (Math.abs(spot.x - a.x) < 0.005 && Math.abs(spot.y - a.y) < 0.005) return clearStartOverride(state, i);
  const steps = cur.steps.slice();
  const at = startOverrideIndex(steps);
  if (at >= 0) steps[at] = { ...steps[at], offsetX: spot.x, offsetY: spot.y };
  else steps.unshift({ type: "OverrideFormPos", stance: startStanceFor(a.pos), offsetX: spot.x, offsetY: spot.y });
  return setSlotSteps(state, i, steps);
}

/** Back to the formation spot (removes the OverrideFormPos). */
export function clearStartOverride(state: DesignerState, i: number): DesignerState {
  const cur = state.slots[i];
  if (!cur) return state;
  const at = startOverrideIndex(cur.steps);
  if (at < 0) return state;
  return setSlotSteps(state, i, cur.steps.filter((_, j) => j !== at));
}

export function isSlotChanged(state: DesignerState, i: number): boolean {
  const s = state.slots[i];
  return !!s && !stepsEqual(s.steps, state.baseSlots[i] ?? [NONE]);
}

/** The base slot carries handoff/fake/option/pitch mechanics (the designer locks it). */
export function isSlotLocked(state: DesignerState, i: number): boolean {
  return (state.baseSlots[i] ?? []).some(isMechanics);
}

/**
 * Leading steps that form the handoff precan: through the last mechanics step of the leading run of
 * mechanics / InitialAnim / Delay / motion steps (QB reverse: CannedHandoff + OptionHandoff = 2).
 */
export function precanLength(steps: readonly Step[]): number {
  let last = -1;
  for (let i = 0; i < steps.length; i++) {
    const t = steps[i].type;
    if (isMechanics(steps[i])) last = i;
    else if (!["InitialAnim", "Delay", "AutoMotion", "AutoMotionSnap", "OverrideFormPos"].includes(t)) break;
  }
  return last + 1;
}

/** Spec-level keys the designer edits. */
export type PlayField = "playType" | "blocking" | "runHole" | "vip" | "reads";

/**
 * Set a play-level field. `undefined` = "inherit from base" (removes the key). A value equal to the base's is only
 * written when the key was already present (FORMATS.md: keep the base's values unless the user edits them).
 */
export function setPlayField(state: DesignerState, key: PlayField, value: unknown): DesignerState {
  const play = { ...state.play } as Obj;
  if (value === undefined) delete play[key];
  else if (key in play || JSON.stringify(value) !== JSON.stringify(baseFieldValue(state, key))) play[key] = value;
  return { ...state, play: play as CustomPlaySpec };
}

/** The base play's value for a play-level field, in spec form (blocking as a leaf). */
export function baseFieldValue(state: DesignerState, key: PlayField): unknown {
  const b = state.base;
  if (!b) return undefined;
  switch (key) {
    case "playType":
      return b.offensePlayType;
    case "blocking":
      return leaf(b.blocking);
    case "runHole":
      return b.runHole;
    case "vip":
      return b.vip;
    case "reads":
      return b.reads;
  }
}

/** Effective value (spec value, else the base's). */
export function effectiveField<T = unknown>(state: DesignerState, key: PlayField): T {
  const v = (state.play as Obj)[key];
  return (v !== undefined ? v : baseFieldValue(state, key)) as T;
}

export function setPlayName(state: DesignerState, name: string): DesignerState {
  return { ...state, play: { ...state.play, name } };
}

export function setPlayAsset(state: DesignerState, asset: string): DesignerState {
  return { ...state, play: { ...state.play, asset } };
}

/**
 * Swap the base play (same set). Changed slots carry over only where neither the old nor the new base slot has
 * handoff mechanics (and the slot itself has none); mechanics slots reset to the new base. Loaded player specs are
 * dropped (their `keep` referred to the old base) but authored names are kept as preferences.
 */
export function swapBase(state: DesignerState, catalog: Catalog, newBase: Asset): DesignerState {
  const lib = catalog.lib;
  const bs = basePlayOf(catalog, newBase);
  const nb = bs.def;
  if (!nb) return state;
  const slots: SlotDesign[] = bs.steps.map((b, i) => {
    const old = state.slots[i];
    const oldBase = state.baseSlots[i] ?? [];
    const changed = old && !stepsEqual(old.steps, oldBase);
    const compatible = changed && !oldBase.some(isMechanics) && !b.some(isMechanics) && !old.steps.some(isMechanics);
    if (!compatible) return { steps: b };
    return { steps: old.steps, assignment: old.assignment, routeType: old.routeType, name: old.name, family: old.family, nameBase: old.nameBase };
  });
  return {
    ...state,
    play: { ...state.play, base: newBase },
    base: nb,
    set: lib.setByAsset.get(nb.set),
    baseSlots: bs.steps,
    baseAssets: bs.assets,
    slots,
  };
}

/** Slots the swap would reset (changed now, but incompatible with the new base). */
export function swapBaseLosses(state: DesignerState, catalog: Catalog, newBase: Asset): number[] {
  const b = basePlayOf(catalog, newBase);
  if (!b.def) return [];
  const bs = b.steps;
  const out: number[] = [];
  state.slots.forEach((s, i) => {
    const oldBase = state.baseSlots[i] ?? [];
    if (!stepsEqual(s.steps, oldBase) && (oldBase.some(isMechanics) || (bs[i] ?? []).some(isMechanics) || s.steps.some(isMechanics))) out.push(i);
  });
  return out;
}

// ───────────────────────────── reads ─────────────────────────────

/** Eligible receiver slots of a set (reads / vip use them). */
export function eligibleSlots(set: SetDef | undefined): number[] {
  return (set?.movements?.Normal ?? []).map((a, i) => (isEligible(a) ? i : -1)).filter((i) => i >= 0);
}

/** Reads written to the spec: a full replacement (keeps unknown keys of each read). */
export function normalizeReads(reads: ReadDef[]): ReadDef[] {
  return reads.map((r) => ({ ...r, pos: Math.round(r.pos), pct: Math.round(Math.max(0, Math.min(1, r.pct)) * 100) / 100 }));
}

// ───────────────────────────── names, assets, validation ─────────────────────────────

/** Problem with a play name inside its set (vs library plays and other custom plays), or undefined. */
export function playNameProblem(catalog: Catalog, set: Asset, name: string, selfKey?: string): string | undefined {
  const n = norm(name);
  if (!n) return "Name is required";
  if ((catalog.lib.playsBySet.get(set) ?? []).some((p) => norm(p.name) === n)) return "A library play in this set has this name";
  const other = catalog.custom.find((rp) => rp.set === set && norm(rp.name) === n && rp.key !== selfKey);
  if (other) return `Already used by "${maddenName(other.name)}" (${other.file})`;
  return undefined;
}

/** Problem with an asset leaf inside the set folder, or undefined. */
export function assetProblem(catalog: Catalog, set: Asset, asset: string, selfKey?: string): string | undefined {
  if (!asset) return "Asset is required";
  if (!/^[A-Za-z0-9_]+$/.test(asset)) return "Only A–Z, a–z, 0–9 and _";
  const key = folder(set) + asset;
  const lower = key.toLowerCase();
  const libHit = (catalog.lib.playsBySet.get(set) ?? []).some((p) => p.asset.toLowerCase() === lower) || catalog.lib.playByAsset.has(key);
  if (libHit) return "A library play already uses this asset";
  const other = catalog.custom.find((rp) => rp.key.toLowerCase() === lower && rp.key !== selfKey);
  if (other) return `Already used by "${maddenName(other.name)}"`;
  return undefined;
}

/** Leaves already used in a set folder (library + custom), lowercase. */
function takenLeaves(catalog: Catalog, set: Asset, selfKey?: string): Set<string> {
  const dir = folder(set);
  const out = new Set<string>();
  for (const p of catalog.lib.playsBySet.get(set) ?? []) out.add(leaf(p.asset));
  for (const rp of catalog.custom) if (rp.key !== selfKey && rp.key.startsWith(dir)) out.add(leaf(rp.key));
  return out;
}

/** prefix + sanitized name (no double prefix), unique in the set folder. */
export function suggestAsset(catalog: Catalog, set: Asset, name: string, prefix: string, selfKey?: string): string {
  const s = sanitizeAssetLeaf(name) || "Play";
  const p = sanitizeAssetLeaf(prefix);
  const base = p && !s.toLowerCase().startsWith(p.toLowerCase()) ? `${p}_${s}` : s;
  return uniqueName(base, takenLeaves(catalog, set, selfKey));
}

/** "PBS <base name>", unique in the set ("PBS Curls 2"). */
export function suggestPlayName(catalog: Catalog, set: Asset, baseName: string, prefix: string): string {
  const word = prefix.replace(/_+$/, "").trim();
  // A base that already carries the prefix (a clone "PBS O Four Verticals") isn't prefixed twice.
  const start = word && !norm(baseName).startsWith(`${norm(word)} `) ? `${word} ${baseName}` : baseName;
  const taken = new Set<string>([
    ...(catalog.lib.playsBySet.get(set) ?? []).map((p) => norm(p.name)),
    ...catalog.custom.filter((rp) => rp.set === set).map((rp) => norm(rp.name)),
  ]);
  if (!taken.has(norm(start))) return start;
  for (let i = 2; ; i++) if (!taken.has(norm(`${start} ${i}`))) return `${start} ${i}`;
}

/** Spec for a new play. With `slot` + `assignment`, that slot starts on the given library assignment. */
export function newPlaySpec(opts: { name: string; asset: string; base: Asset; slot?: number; assignment?: string }): CustomPlaySpec {
  const spec: CustomPlaySpec = { name: opts.name, asset: opts.asset, base: opts.base };
  if (opts.slot !== undefined && opts.assignment) spec.players = { [String(opts.slot)]: assignmentPath(opts.assignment) };
  return spec;
}

/**
 * Make `target` deep-equal `source` by assigning/deleting keys in place (immer drafts keep structural sharing for
 * unchanged parts). Arrays and differing nested values are replaced whole.
 */
export function applySpec(target: Obj, source: Obj): void {
  for (const k of Object.keys(target)) if (!(k in source)) delete target[k];
  for (const k of Object.keys(source)) {
    const a = target[k];
    const b = source[k];
    if (a === b) continue;
    if (isObj(a) && isObj(b)) applySpec(a, b);
    else if (JSON.stringify(a) !== JSON.stringify(b)) target[k] = b;
  }
}

// ───────────────────────────── base play picker (wizard) ─────────────────────────────

/** "BTInsideZone" → "Inside Zone", "CODE_DETERMINE" → "Auto (pass pro)". */
export function blockingLabel(blockingLeaf: string): string {
  if (!blockingLeaf || blockingLeaf === "CODE_DETERMINE") return "Auto (pass pro)";
  return blockingLeaf
    .replace(/^BT(?=[A-Z])/, "")
    .replace(/^Code_/, "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .trim();
}

/** "Concept_Curl_Flat" → "Curl Flat". */
export function conceptLabel(concept: string | undefined): string {
  return String(concept ?? "")
    .replace(/^Concept_/, "")
    .replace(/_/g, " ")
    .trim();
}

/** Main concept of a pass play: the first read with a real concept (not Invalid / Read). */
export function playConcept(reads: readonly ReadDef[]): string | undefined {
  const r = reads.find((x) => typeof x.concept === "string" && !/^Concept_(Invalid|Read|Max)$/.test(x.concept));
  return r?.concept;
}

export type BaseSection = "pass" | "run" | "pa" | "screen" | "other";

export const BASE_SECTION_LABEL: Record<BaseSection, string> = {
  pass: "Pass",
  run: "Run templates",
  pa: "Play action",
  screen: "Screens",
  other: "Other",
};

export interface BaseGroup {
  section: BaseSection;
  /** Group label inside the section ("Curl Flat", "Inside Zone"…). */
  label: string;
  plays: ResolvedPlay[];
}

/**
 * Plays of a set usable as a base: library plays filed in the set folder and, in a custom set, the plays cloned into
 * it (catalog overlay). Library first, then clones.
 */
export function basePlaysInSet(catalog: Catalog, set: Asset): ResolvedPlay[] {
  return catalog.playsInSet(set).filter((p) => (p.source === "library" || isClonePlay(p)) && folder(p.asset) === folder(set));
}

/** Cheap check for the wizard's set list: does the set have any base play? */
export function setHasBasePlays(catalog: Catalog, set: Asset): boolean {
  if ((catalog.lib.playsBySet.get(set) ?? []).some((p) => folder(p.asset) === folder(set))) return true;
  return basePlaysInSet(catalog, set).length > 0;
}

/**
 * Library plays of a set usable as a base (filed in the set folder), grouped like the wizard shows them: PASS by
 * read concept, RUN TEMPLATES by blocking scheme, PLAY ACTION, SCREENS, OTHER. Sections in that order, groups by size.
 */
export function groupBasePlays(catalog: Catalog, set: Asset): BaseGroup[] {
  const plays = basePlaysInSet(catalog, set);
  const groups = new Map<string, BaseGroup>();
  const add = (section: BaseSection, label: string, p: ResolvedPlay) => {
    const k = `${section}|${label}`;
    const g = groups.get(k) ?? { section, label, plays: [] };
    g.plays.push(p);
    groups.set(k, g);
  };
  for (const p of plays) {
    const fam = playTypeInfo(p.playType).family;
    if (fam === "run" || fam === "option") add("run", blockingLabel(leaf(p.blocking)), p);
    else if (fam === "pass" || fam === "rpo") add("pass", conceptLabel(playConcept(p.reads)) || "Other pass", p);
    else if (fam === "pa") add("pa", "Play action", p);
    else if (fam === "screen") add("screen", "Screens", p);
    else add("other", "Other", p);
  }
  const order: BaseSection[] = ["pass", "run", "pa", "screen", "other"];
  return [...groups.values()].sort(
    (a, b) => order.indexOf(a.section) - order.indexOf(b.section) || b.plays.length - a.plays.length || a.label.localeCompare(b.label),
  );
}

/** Unique blocking scheme leaves used by library plays (for the blocking SearchSelect), most used first. */
export function blockingLeaves(lib: LibraryIndex): string[] {
  const counts = new Map<string, number>();
  for (const p of lib.data.plays) {
    if (!p.blocking.startsWith(BLOCKING_ROOT) && !p.blocking.startsWith(PLAYLIBRARY_ROOT)) continue;
    const l = leaf(p.blocking);
    counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l]) => l);
}

/** Slots of the base play whose assignments differ between two chains (for "changed" badges). */
export function changedSlots(state: DesignerState): number[] {
  return state.slots.map((_, i) => i).filter((i) => isSlotChanged(state, i));
}
