// Catalog: every play the editor knows — library plays (resolved lazily), plays cloned into custom sets
// (playbooks/sets/*.json, FORMATS.md §5) and custom plays (playbooks/plays/*.json, §3) — over an OVERLAY library index
// that also holds the custom formations and sets (`catalog.lib`; views see them like stock ones).
//
// Resolution mirrors the game side (tools/PlayDump/PlayBuilder.cs + SetBuilder.cs, tools/pbook-build.mjs):
//  - build order: every sets file's formations, then every sets file's sets with their clones (each clone right after
//    its set), then every plays file's plays. research/index/custom-plays.tsv lists clones before custom plays, so
//    pbook-build finds a library play first, then a clone, then a custom play with the same name in a set.
//  - a play (clone or custom play) is a copy of its base (`from` / `base`): slots keep the base assignments unless
//    overridden; a string player spec points at an existing assignment (path under ASSIGNMENT_ROOT, or "PBS/<name>"
//    authored by an earlier play); a `new` spec = first `keep` steps of (`template` ?? base slot) + `steps` + None.
//    The FIRST definition of a `new` name (in build order) wins everywhere (the builder reuses the asset).
//  - clones: base = `from` (a library play of ANY set, or an earlier clone), set = the custom set, key = <custom set
//    folder>/<asset>. Custom plays: base = a library play or a clone, in the base's set, key = <base set folder>/<asset>.
import { overlayLibraryIndex, type LibraryIndex } from "./library";
import { folder, leaf, maddenName, norm } from "./names";
import { cloneAsset, customDefs, normalOf, type CustomDefs, type CustomSetDef, type SetsInput } from "./sets";
import { hasMechanics, stepsEqual, withNone } from "./steps";
import {
  ASSIGNMENT_ROOT,
  AUTHORED_FOLDER,
  BLOCKING_ROOT,
  PLAYLIBRARY_ROOT,
  type Asset,
  type CloneSpec,
  type CustomPlaySpec,
  type NewAssignmentSpec,
  type PlayDef,
  type PlayKey,
  type PlaysFile,
  type ReadDef,
  type ResolvedPlay,
  type ResolvedSlot,
  type SetsFile,
  type Step,
  type ValidationIssue,
} from "./types";

export type { SetsInput } from "./sets";

export interface AuthoredAssignment {
  /** Resolved steps (kept template steps + authored steps + trailing None). */
  steps: Step[];
  routeType?: string;
  /** File, play name and play index (in that file) of the first definition. */
  file: string;
  play: string;
  index?: number;
  /** Set when the first definition is a clone: the custom set's index in its sets file (`index` = clone index). */
  setIndex?: number;
}

/** Where a custom formation / set of the overlay is defined. */
export interface CustomOrigin {
  kind: "formation" | "set";
  file: string;
  index: number;
}

export interface Catalog {
  /** Overlay library index: the game library + custom formations and sets from every sets doc. */
  lib: LibraryIndex;
  /** Clones first, then custom plays, then library plays (a duplicate key is an error on the later-built play). */
  get(key: PlayKey): ResolvedPlay | undefined;
  /** Library plays (data order), then clones, then custom plays (file order). Cached per catalog. */
  playsInSet(set: Asset): ResolvedPlay[];
  /**
   * norm() compare, exactly like tools/pbook-build.mjs (plays.tsv, then custom-plays.tsv where clones come before
   * custom plays): a library play wins over a clone, a clone over a custom play; otherwise the first in build order.
   */
  playInSetByName(set: Asset, name: string): ResolvedPlay | undefined;
  /** Every custom play from every plays doc (not clones). */
  custom: ResolvedPlay[];
  /** Every play cloned into a custom set (sets docs), in build order. ResolvedPlay.clone locates its spec. */
  clones: ResolvedPlay[];
  cloneByKey: ReadonlyMap<PlayKey, ResolvedPlay>;
  /** Custom formation + set assets in `lib` (same as lib.customAssets). */
  customAssets: ReadonlySet<Asset>;
  /** Custom formation / set asset → its sets file + index (for "Edit in Formations" links). */
  customOrigin: ReadonlyMap<Asset, CustomOrigin>;
  /** The custom formations and sets as built (defs + specs + bases). */
  customDefs: CustomDefs;
  authored: Map<string, AuthoredAssignment>;
  /** Unique per buildCatalog call (memo key for derived data such as play art). */
  version: number;
}

let versionCounter = 0;

// Library plays never change for a given stock index, so their resolutions are shared by every catalog (and every
// overlay) built on it: stable object identity across custom-play and custom-set edits keeps React memoization effective.
const libraryCache = new WeakMap<LibraryIndex, Map<Asset, ResolvedPlay>>();

function libraryPlays(stock: LibraryIndex): Map<Asset, ResolvedPlay> {
  let m = libraryCache.get(stock);
  if (!m) {
    m = new Map();
    libraryCache.set(stock, m);
  }
  return m;
}

function sideOf(lib: LibraryIndex, set: Asset): ResolvedPlay["side"] {
  const f = lib.formationOfSet(set);
  return f ? lib.formationSide(f) : "offense";
}

function playTypeOf(p: Pick<PlayDef, "offensePlayType" | "defensePlayType">, side: ResolvedPlay["side"]): string {
  if (side === "defense") return p.defensePlayType;
  if (side === "offense") return p.offensePlayType;
  return p.offensePlayType && p.offensePlayType !== "OffensePlayType_DontCare" ? p.offensePlayType : p.defensePlayType;
}

function librarySlot(lib: LibraryIndex, asset: Asset): ResolvedSlot {
  const a = lib.assignment(asset);
  const steps = a?.steps ?? [{ type: "None" }];
  return { steps, assignment: asset, routeType: a?.routeType, mechanics: hasMechanics(steps), changed: false };
}

/** Resolve a library play (memoized per stock library index; an overlay shares its stock index's objects). */
export function resolveLibraryPlay(lib: LibraryIndex, p: PlayDef): ResolvedPlay {
  const stock = lib.stock ?? lib;
  const cache = libraryPlays(stock);
  const hit = cache.get(p.asset);
  if (hit) return hit;
  const side = sideOf(stock, p.set);
  const problems: string[] = [];
  const slots = p.assignments.map((asset, i) => {
    if (!stock.assignment(asset)) problems.push(`slot ${i}: assignment not in the library (${asset})`);
    return librarySlot(stock, asset);
  });
  const rp: ResolvedPlay = {
    key: p.asset,
    source: "library",
    name: p.name,
    asset: p.asset,
    set: p.set,
    formation: stock.setByAsset.get(p.set)?.formation ?? "",
    side,
    playType: playTypeOf(p, side),
    blocking: p.blocking,
    runHole: p.runHole,
    vip: p.vip,
    reads: p.reads,
    canFlip: p.canFlip,
    allowHotRoutes: p.allowHotRoutes,
    global: p.global,
    playId: p.playId,
    slots,
    problems,
  };
  cache.set(p.asset, rp);
  return rp;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isNewSpec = (v: unknown): v is NewAssignmentSpec => isObj(v) && typeof v.new === "string";

/** Authored-assignment name from a string player spec ("PBS/PBS_Slot_Corner7" → "PBS_Slot_Corner7"), else undefined. */
function authoredRef(path: string): string | undefined {
  const p = path.startsWith(ASSIGNMENT_ROOT) ? path.slice(ASSIGNMENT_ROOT.length) : path;
  return p.startsWith(AUTHORED_FOLDER) ? p.slice(AUTHORED_FOLDER.length) : undefined;
}

/** Steps of an existing assignment referenced by path: library first, then an authored "PBS/<name>". */
function stepsAt(
  lib: LibraryIndex,
  path: string,
  authored: Map<string, AuthoredAssignment>,
): { steps: Step[]; routeType?: string; asset?: Asset; authored?: string } | undefined {
  const a = lib.assignment(path);
  if (a) return { steps: a.steps, routeType: a.routeType, asset: path.startsWith(PLAYLIBRARY_ROOT) ? path : ASSIGNMENT_ROOT + path };
  const name = authoredRef(path);
  const def = name !== undefined ? authored.get(name) : undefined;
  if (def && name !== undefined) return { steps: def.steps, routeType: def.routeType, authored: name };
  return undefined;
}

/**
 * Steps a `new` spec produces: first `keep` steps of (template ?? base slot) + spec.steps + None.
 * Pushes problems for a missing template or a `keep` that reaches past the template's real steps.
 */
function buildNewSteps(
  lib: LibraryIndex,
  spec: NewAssignmentSpec,
  baseSlot: Step[] | undefined,
  authored: Map<string, AuthoredAssignment>,
  where: string,
  problems: string[],
): { steps: Step[]; routeType?: string } {
  let source = baseSlot;
  let sourceRouteType: string | undefined;
  if (typeof spec.template === "string" && spec.template) {
    const t = stepsAt(lib, spec.template, authored);
    if (!t) problems.push(`${where}: template assignment not found (${spec.template})`);
    source = t?.steps;
    sourceRouteType = t?.routeType;
  }
  const keep = typeof spec.keep === "number" && spec.keep > 0 ? Math.floor(spec.keep) : 0;
  const kept = keep > 0 && source ? source.slice(0, keep) : [];
  if (keep > 0 && source) {
    const real = source.length - (source.length && source[source.length - 1].type === "None" ? 1 : 0);
    if (keep > real) problems.push(`${where}: keep ${keep} is more than the template's ${real} steps`);
  } else if (keep > 0 && !source) {
    problems.push(`${where}: keep ${keep} needs a template or a base slot`);
  }
  const authoredSteps = Array.isArray(spec.steps) ? spec.steps.filter(isObj).map((s) => s as Step) : [];
  if (!Array.isArray(spec.steps)) problems.push(`${where}: "steps" must be an array`);
  return {
    steps: withNone([...kept.filter((s) => s.type !== "None"), ...authoredSteps]),
    routeType: typeof spec.routeType === "string" ? spec.routeType : sourceRouteType,
  };
}

const LEAF_RE = /^[A-Za-z0-9_]+$/;

// ───────────────────────────── shared play-spec resolution (clones + custom plays) ─────────────────────────────

/** What a clone / custom play copies from its base (a library play or a clone). */
interface BaseInfo {
  asset: Asset;
  set: Asset;
  slots: ResolvedSlot[];
  reads: ReadDef[];
  vip: number;
  runHole: number;
  blocking: Asset;
  canFlip: boolean;
  allowHotRoutes: boolean;
  playTypeFor(side: ResolvedPlay["side"]): string;
  /** A library play filed outside its set's folder (the builder would create a custom play next to it). */
  filedOutside: boolean;
}

function baseFromDef(stock: LibraryIndex, p: PlayDef): BaseInfo {
  return {
    asset: p.asset,
    set: p.set,
    slots: p.assignments.map((a) => librarySlot(stock, a)),
    reads: p.reads,
    vip: p.vip,
    runHole: p.runHole,
    blocking: p.blocking,
    canFlip: p.canFlip,
    allowHotRoutes: p.allowHotRoutes,
    playTypeFor: (side) => playTypeOf(p, side),
    filedOutside: folder(p.asset) !== folder(p.set),
  };
}

function baseFromResolved(rp: ResolvedPlay): BaseInfo {
  return {
    asset: rp.key,
    set: rp.set,
    slots: rp.slots.map((s) => ({ ...s, changed: false })),
    reads: rp.reads,
    vip: rp.vip,
    runHole: rp.runHole,
    blocking: rp.blocking,
    canFlip: rp.canFlip,
    allowHotRoutes: rp.allowHotRoutes,
    playTypeFor: () => rp.playType,
    filedOutside: false,
  };
}

/** Identity of a play spec for "first definition wins": plays file + index, or sets file + set index + clone index. */
interface SpecOwner {
  file: string;
  index: number;
  setIndex?: number;
}

const isOwner = (a: AuthoredAssignment, o: SpecOwner) => a.file === o.file && a.index === o.index && a.setIndex === o.setIndex;

type PlayFields = Pick<CustomPlaySpec, "players" | "reads" | "vip" | "runHole" | "playType" | "blocking">;

/** Slots / reads / vip / runHole / playType / blocking of a play spec on top of its base (FORMATS.md §3). */
function applyPlaySpec(
  lib: LibraryIndex,
  spec: PlayFields,
  base: BaseInfo | undefined,
  owner: SpecOwner,
  authored: Map<string, AuthoredAssignment>,
  side: ResolvedPlay["side"],
  problems: string[],
) {
  const baseSlots = base ? base.slots : [];
  const slots: ResolvedSlot[] = baseSlots.map((s) => ({ ...s }));

  const players = isObj(spec.players) ? spec.players : {};
  if (spec.players !== undefined && !isObj(spec.players)) problems.push(`"players" must be an object of slot → assignment`);
  for (const slotKey of Object.keys(players)) {
    const n = Number(slotKey);
    const pspec = players[slotKey];
    const where = `slot ${slotKey}`;
    if (!/^\d+$/.test(slotKey) || (base && n >= baseSlots.length)) {
      problems.push(`${where}: not a slot of this set (0–${Math.max(0, baseSlots.length - 1)})`);
      continue;
    }
    if (!base) continue;
    const baseSlot = baseSlots[n];
    if (typeof pspec === "string") {
      const hit = stepsAt(lib, pspec, authored);
      if (!hit) {
        problems.push(`${where}: assignment not found (${pspec})`);
        continue;
      }
      slots[n] = {
        steps: hit.steps,
        assignment: hit.asset,
        authored: hit.authored,
        routeType: hit.routeType,
        mechanics: hasMechanics(hit.steps),
        changed: hit.asset !== baseSlot.assignment || hit.authored !== baseSlot.authored,
      };
    } else if (isNewSpec(pspec)) {
      const first = authored.get(pspec.new);
      const isFirst = !first || isOwner(first, owner);
      // Build our own version for its problems (first definition) or to detect a conflicting redefinition.
      const mine = buildNewSteps(lib, pspec, baseSlot.steps, authored, where, isFirst ? problems : []);
      if (!isFirst && first && !stepsEqual(mine.steps, first.steps)) {
        problems.push(`${where}: "${pspec.new}" is first defined by "${maddenName(first.play)}" (${first.file}); that definition is used`);
      }
      const resolved = first ?? mine;
      if (!LEAF_RE.test(pspec.new)) problems.push(`${where}: authored name "${pspec.new}" must be [A-Za-z0-9_]`);
      slots[n] = {
        steps: resolved.steps,
        authored: pspec.new,
        routeType: resolved.routeType,
        mechanics: hasMechanics(resolved.steps),
        changed: true,
      };
    } else {
      problems.push(`${where}: expected an assignment path or { "new": … }`);
      continue;
    }
    // Handoff/fake/option mechanics are paired with another slot (FORMATS.md §3): dropping one side breaks the play.
    if (baseSlot.mechanics && !slots[n].mechanics) {
      problems.push(`${where}: drops the base play's handoff/option mechanics (keep them with "keep" or pick another base)`);
    }
  }

  const reads: ReadDef[] = Array.isArray(spec.reads) ? spec.reads : base?.reads ?? [];
  if (base && Array.isArray(spec.reads) && spec.reads.length > base.reads.length) {
    problems.push(`reads: only the first ${base.reads.length} entries are used (the base play has ${base.reads.length})`);
  }
  for (const r of reads) {
    if (!isObj(r) || typeof r.pos !== "number" || r.pos < 0 || (base && r.pos >= baseSlots.length)) {
      problems.push(`reads: bad slot ${isObj(r) ? String(r.pos) : "?"}`);
    }
  }

  const vip = typeof spec.vip === "number" ? spec.vip : base?.vip ?? 0;
  if (base && (vip < 0 || vip >= baseSlots.length || !Number.isInteger(vip))) problems.push(`vip ${vip} is not a slot`);
  const runHole = typeof spec.runHole === "number" ? spec.runHole : base?.runHole ?? 0;
  if (!Number.isInteger(runHole) || runHole < 0 || runHole > 9) problems.push(`runHole ${runHole} must be 0–9`);

  return {
    slots,
    reads,
    vip,
    runHole,
    playType: typeof spec.playType === "string" && spec.playType ? spec.playType : base ? base.playTypeFor(side) : "",
    blocking: typeof spec.blocking === "string" && spec.blocking ? BLOCKING_ROOT + spec.blocking : base?.blocking ?? "",
  };
}

/** First definitions of a spec's `new` names (slot order) not defined yet; base slot steps feed `keep` without template. */
function collectNew(lib: LibraryIndex, spec: PlayFields & { name?: unknown }, baseSlots: ResolvedSlot[] | undefined, owner: SpecOwner, authored: Map<string, AuthoredAssignment>): void {
  if (!isObj(spec.players)) return;
  for (const [slotKey, pspec] of Object.entries(spec.players)) {
    if (!isNewSpec(pspec) || authored.has(pspec.new)) continue;
    const built = buildNewSteps(lib, pspec, baseSlots?.[Number(slotKey)]?.steps, authored, "", []);
    authored.set(pspec.new, {
      steps: built.steps,
      routeType: built.routeType,
      file: owner.file,
      play: typeof spec.name === "string" ? spec.name : "",
      index: owner.index,
      ...(owner.setIndex !== undefined ? { setIndex: owner.setIndex } : {}),
    });
  }
}

// Clones of every overlay index (resolveCustomPlay finds a clone base through the overlay it's given).
const overlayClones = new WeakMap<LibraryIndex, ReadonlyMap<PlayKey, ResolvedPlay>>();

/**
 * Resolve one custom play spec. `authored` must already hold the first definition of every `new` name
 * (buildCatalog collects them first); a `new` spec whose name is defined elsewhere resolves to that first definition.
 * The base may be a library play or a play cloned into a custom set: pass `clones` (e.g. catalog.cloneByKey), or a
 * catalog overlay as `lib` (catalog.lib) — its clones are found automatically.
 */
export function resolveCustomPlay(
  lib: LibraryIndex,
  spec: CustomPlaySpec,
  file: string,
  index: number,
  authored: Map<string, AuthoredAssignment>,
  clones?: ReadonlyMap<PlayKey, ResolvedPlay>,
): ResolvedPlay {
  const stock = lib.stock ?? lib;
  const cloneMap = clones ?? overlayClones.get(lib);
  const problems: string[] = [];
  const name = typeof spec.name === "string" ? spec.name : "";
  const assetLeaf = typeof spec.asset === "string" ? spec.asset : "";
  const baseAsset = typeof spec.base === "string" ? spec.base : "";
  if (!name.trim()) problems.push("name is empty");
  if (!LEAF_RE.test(assetLeaf)) problems.push(`asset "${assetLeaf}" must be [A-Za-z0-9_] and not empty`);

  const def = stock.playByAsset.get(baseAsset);
  const cloneBase = !def && baseAsset ? cloneMap?.get(baseAsset) : undefined;
  const base = def ? baseFromDef(stock, def) : cloneBase ? baseFromResolved(cloneBase) : undefined;
  if (!base) problems.push(baseAsset ? `base play not in the library or a custom set (${baseAsset})` : "base play is missing");

  // Without a base the set can only be guessed from the base path (plays live in their set's folder).
  const guessSet = (() => {
    const dir = folder(baseAsset);
    const cand = dir + leaf(dir.slice(0, -1));
    return lib.setByAsset.has(cand) ? cand : "";
  })();
  const set = base?.set ?? guessSet;
  const setDir = set ? folder(set) : folder(baseAsset);
  const key = setDir + assetLeaf;

  if (base) {
    if (typeof spec.set === "string" && spec.set && spec.set !== base.set) {
      problems.push(`base play is in another set (${leaf(base.set)}), not ${leaf(spec.set)}`);
    }
    // The builder creates the clone next to the base play's asset; for the few library plays filed outside their set's
    // folder that is a different folder than this play's key.
    if (base.filedOutside) problems.push(`base play is filed outside its set folder; pick another base in ${leaf(base.set)}`);
  }

  const side = set ? sideOf(lib, set) : "offense";
  const r = applyPlaySpec(stock, spec, base, { file, index }, authored, side, problems);
  return {
    key,
    source: "custom",
    name,
    asset: key,
    set,
    formation: lib.setByAsset.get(set)?.formation ?? "",
    side,
    playType: r.playType,
    blocking: r.blocking,
    runHole: r.runHole,
    vip: r.vip,
    reads: r.reads,
    canFlip: base?.canFlip ?? true,
    allowHotRoutes: base?.allowHotRoutes ?? true,
    global: false,
    slots: r.slots,
    base: base?.asset ?? (baseAsset || undefined),
    file,
    index,
    problems,
  };
}

/** A play cloned into custom set `cs` (SetBuilder: BuildPlay with base = from, set = the custom set). */
function resolveClone(
  overlay: LibraryIndex,
  c: CloneSpec,
  cs: CustomSetDef,
  ci: number,
  authored: Map<string, AuthoredAssignment>,
  earlier: ReadonlyMap<PlayKey, ResolvedPlay>,
): ResolvedPlay {
  const stock = overlay.stock ?? overlay;
  const problems: string[] = [];
  const name = typeof c.name === "string" ? c.name : "";
  const assetLeaf = typeof c.asset === "string" ? c.asset : "";
  const from = typeof c.from === "string" ? c.from : "";
  if (!name.trim()) problems.push("name is empty");
  if (!LEAF_RE.test(assetLeaf)) problems.push(`asset "${assetLeaf}" must be [A-Za-z0-9_] and not empty`);

  const def = stock.playByAsset.get(from);
  const prev = !def && from ? earlier.get(from) : undefined;
  const base = def ? baseFromDef(stock, def) : prev ? baseFromResolved(prev) : undefined;
  if (!base) problems.push(from ? `base play not in the library or an earlier clone (${from})` : "base play is missing (\"from\")");
  const players = normalOf(cs.def).length;
  if (base && base.slots.length !== players) problems.push(`the "from" play has ${base.slots.length} players, this set has ${players}`);

  const set = cs.def.asset;
  const key = cloneAsset(set, assetLeaf);
  const side = sideOf(overlay, set);
  const r = applyPlaySpec(stock, c, base, { file: cs.file, index: ci, setIndex: cs.index }, authored, side, problems);
  return {
    key,
    source: "custom",
    name,
    asset: key,
    set,
    formation: cs.def.formation,
    side,
    playType: r.playType,
    blocking: r.blocking,
    runHole: r.runHole,
    vip: r.vip,
    reads: r.reads,
    canFlip: base?.canFlip ?? true,
    allowHotRoutes: base?.allowHotRoutes ?? true,
    global: false,
    slots: r.slots,
    base: base?.asset ?? (from || undefined),
    file: cs.file,
    clone: { file: cs.file, setIndex: cs.index, index: ci },
    problems,
  };
}

// ───────────────────────────── overlay (custom formations, sets, clones) ─────────────────────────────

/** Custom formations/sets/clones layered over a stock library (see catalogOverlay). */
export interface CatalogOverlay {
  lib: LibraryIndex;
  defs: CustomDefs;
  clones: ResolvedPlay[];
  cloneByKey: Map<PlayKey, ResolvedPlay>;
  /** First definitions of `new` names made by clones (they're built before every custom play). */
  authored: Map<string, AuthoredAssignment>;
  origin: Map<Asset, CustomOrigin>;
}

// A few recent overlays per stock index (most recent first): the app's shared catalog plus any preview catalogs built
// from other sets inputs don't evict each other.
const overlayCache = new WeakMap<LibraryIndex, { inputs: SetsInput[]; overlay: CatalogOverlay }[]>();
const OVERLAY_CACHE_SIZE = 4;

const sameInputs = (a: readonly SetsInput[], b: readonly SetsInput[]) => a.length === b.length && a.every((x, i) => x.path === b[i].path && x.data === b[i].data);

function buildOverlay(stock: LibraryIndex, setsDocs: readonly SetsInput[]): CatalogOverlay {
  const defs = customDefs(stock, setsDocs);
  const lib = overlayLibraryIndex(stock, { formations: defs.formations.map((f) => f.def), sets: defs.sets.map((s) => s.def) });
  const origin = new Map<Asset, CustomOrigin>();
  for (const f of defs.formations) origin.set(f.def.asset, { kind: "formation", file: f.file, index: f.index });
  for (const s of defs.sets) origin.set(s.def.asset, { kind: "set", file: s.file, index: s.index });

  const authored = new Map<string, AuthoredAssignment>();
  const clones: ResolvedPlay[] = [];
  const cloneByKey = new Map<PlayKey, ResolvedPlay>();
  for (const cs of defs.sets) {
    const list = Array.isArray(cs.spec.plays) ? cs.spec.plays : [];
    list.forEach((c, ci) => {
      if (!isObj(c)) return;
      // Builder order: this clone's own `new` definitions exist before its slots resolve; later plays reuse them.
      const from = typeof c.from === "string" ? c.from : "";
      const fromDef = stock.playByAsset.get(from);
      const baseSlots = fromDef ? fromDef.assignments.map((a) => librarySlot(stock, a)) : cloneByKey.get(from)?.slots;
      collectNew(stock, c, baseSlots, { file: cs.file, index: ci, setIndex: cs.index }, authored);
      const rp = resolveClone(lib, c, cs, ci, authored, cloneByKey);
      clones.push(rp);
      if (rp.set && LEAF_RE.test(leaf(rp.key)) && !cloneByKey.has(rp.key)) cloneByKey.set(rp.key, rp);
    });
  }
  // Duplicate assets / names inside a custom set (every member is flagged).
  const where = (rp: ResolvedPlay) => `"${maddenName(rp.name)}" (${rp.file} set #${(rp.clone?.setIndex ?? 0) + 1}, play #${(rp.clone?.index ?? 0) + 1})`;
  const dupGroups = (keyOf: (rp: ResolvedPlay) => string | undefined) => {
    const m = new Map<string, ResolvedPlay[]>();
    for (const rp of clones) {
      const k = keyOf(rp);
      if (k !== undefined) push(m, k, rp);
    }
    return [...m.values()].filter((g) => g.length > 1);
  };
  for (const g of dupGroups((rp) => (LEAF_RE.test(leaf(rp.key)) ? rp.key.toLowerCase() : undefined))) {
    for (const rp of g) rp.problems.push(`asset ${leaf(rp.key)} is also used by ${g.filter((o) => o !== rp).map(where).join(", ")}`);
  }
  for (const g of dupGroups((rp) => (rp.name.trim() ? rp.set + "|" + norm(rp.name) : undefined))) {
    for (const rp of g) rp.problems.push(`name "${maddenName(rp.name)}" is also used by another custom play in this set: ${g.filter((o) => o !== rp).map(where).join(", ")}`);
  }
  if (lib !== stock) overlayClones.set(lib, cloneByKey);
  return { lib, defs, clones, cloneByKey, authored, origin };
}

/**
 * The overlay for a library + sets docs: overlay index (custom formations/sets), clones, their authored assignments.
 * Memoized per stock index on the docs' data identity, so `catalog.lib` and the clone objects stay the same while only
 * plays docs change.
 */
export function catalogOverlay(lib: LibraryIndex, setsDocs: readonly SetsInput[] = []): CatalogOverlay {
  const stock = lib.stock ?? lib;
  const inputs = setsDocs.filter((d) => d && isObj(d.data));
  let list = overlayCache.get(stock);
  if (!list) overlayCache.set(stock, (list = []));
  const at = list.findIndex((e) => sameInputs(e.inputs, inputs));
  if (at >= 0) {
    const [hit] = list.splice(at, 1);
    list.unshift(hit);
    return hit.overlay;
  }
  const overlay = buildOverlay(stock, inputs);
  list.unshift({ inputs, overlay });
  list.length = Math.min(list.length, OVERLAY_CACHE_SIZE);
  return overlay;
}

// ───────────────────────────── catalog ─────────────────────────────

export function buildCatalog(
  lib: LibraryIndex,
  playsDocs: { path: string; data: PlaysFile }[],
  setsDocs: readonly { path: string; data: SetsFile | null | undefined }[] = [],
): Catalog {
  const stock = lib.stock ?? lib;
  const ov = catalogOverlay(stock, setsDocs);
  const overlay = ov.lib;

  // First definition of every `new` name: clones (built first), then plays docs in doc → play → slot order.
  const authored = new Map(ov.authored);
  for (const doc of playsDocs) {
    const plays = Array.isArray(doc.data?.plays) ? doc.data.plays : [];
    plays.forEach((spec, index) => {
      if (!isObj(spec) || !isObj(spec.players)) return;
      const baseAsset = typeof spec.base === "string" ? spec.base : "";
      const def = stock.playByAsset.get(baseAsset);
      const baseSlots = def ? def.assignments.map((a) => librarySlot(stock, a)) : ov.cloneByKey.get(baseAsset)?.slots;
      collectNew(stock, spec, baseSlots, { file: doc.path, index }, authored);
    });
  }

  const custom: ResolvedPlay[] = [];
  for (const doc of playsDocs) {
    const plays = Array.isArray(doc.data?.plays) ? doc.data.plays : [];
    plays.forEach((spec, i) => {
      if (!isObj(spec)) return;
      custom.push(resolveCustomPlay(overlay, spec, doc.path, i, authored, ov.cloneByKey));
    });
  }

  // Duplicate assets / names inside a set (custom vs custom — every member is flagged — custom vs clone, custom vs library).
  const groups = (keyOf: (rp: ResolvedPlay) => string) => {
    const m = new Map<string, ResolvedPlay[]>();
    for (const rp of custom) if (rp.set) push(m, keyOf(rp), rp);
    return [...m.values()].filter((g) => g.length > 1);
  };
  const where = (rp: ResolvedPlay) => `"${maddenName(rp.name)}" (${rp.file} #${(rp.index ?? 0) + 1})`;
  for (const g of groups((rp) => rp.key.toLowerCase())) {
    for (const rp of g) {
      const others = g.filter((o) => o !== rp).map(where).join(", ");
      rp.problems.push(`asset ${leaf(rp.key)} is also used by ${others}`);
    }
  }
  for (const g of groups((rp) => rp.set + "|" + norm(rp.name))) {
    for (const rp of g) {
      const others = g.filter((o) => o !== rp).map(where).join(", ");
      rp.problems.push(`name "${maddenName(rp.name)}" is also used by another custom play in this set: ${others}`);
    }
  }
  const clonesBySet = new Map<Asset, ResolvedPlay[]>();
  for (const c of ov.clones) if (c.set) push(clonesBySet, c.set, c);
  const cloneKeysLower = new Map<string, ResolvedPlay>();
  for (const c of ov.clones) if (!cloneKeysLower.has(c.key.toLowerCase())) cloneKeysLower.set(c.key.toLowerCase(), c);
  for (const rp of custom) {
    if (!rp.set) continue;
    if (stock.playByAsset.has(rp.key)) rp.problems.push(`asset ${leaf(rp.key)} already exists in the library`);
    const clone = cloneKeysLower.get(rp.key.toLowerCase());
    if (clone) rp.problems.push(`asset ${leaf(rp.key)} is also used by the cloned play "${maddenName(clone.name)}" (${clone.file})`);
    if ((stock.playsBySet.get(rp.set) ?? []).some((p) => norm(p.name) === norm(rp.name))) {
      rp.problems.push(`name "${maddenName(rp.name)}" is also a library play in this set (the game-side builder picks the library play; rename the custom play)`);
    } else if ((clonesBySet.get(rp.set) ?? []).some((c) => norm(c.name) === norm(rp.name))) {
      rp.problems.push(`name "${maddenName(rp.name)}" is also a cloned play in this set (the game-side builder picks the clone; rename the custom play)`);
    }
  }

  const customByKey = new Map<PlayKey, ResolvedPlay>();
  const customBySet = new Map<Asset, ResolvedPlay[]>();
  for (const rp of custom) {
    if (!customByKey.has(rp.key)) customByKey.set(rp.key, rp);
    if (rp.set) push(customBySet, rp.set, rp);
  }

  const inSetCache = new Map<Asset, ResolvedPlay[]>();
  const playsInSet = (set: Asset): ResolvedPlay[] => {
    let list = inSetCache.get(set);
    if (!list) {
      list = [
        ...(stock.playsBySet.get(set) ?? []).map((p) => resolveLibraryPlay(stock, p)),
        ...(clonesBySet.get(set) ?? []),
        ...(customBySet.get(set) ?? []),
      ];
      inSetCache.set(set, list);
    }
    return list;
  };

  return {
    lib: overlay,
    get(key) {
      const c = ov.cloneByKey.get(key) ?? customByKey.get(key);
      if (c) return c;
      const p = stock.playByAsset.get(key);
      return p ? resolveLibraryPlay(stock, p) : undefined;
    },
    playsInSet,
    playInSetByName(set, name) {
      const key = norm(String(name ?? ""));
      const p = (stock.playsBySet.get(set) ?? []).find((pd) => norm(pd.name) === key);
      if (p) return resolveLibraryPlay(stock, p);
      return (clonesBySet.get(set) ?? []).find((rp) => norm(rp.name) === key) ?? (customBySet.get(set) ?? []).find((rp) => norm(rp.name) === key);
    },
    custom,
    clones: ov.clones,
    cloneByKey: ov.cloneByKey,
    customAssets: overlay.customAssets,
    customOrigin: ov.origin,
    customDefs: ov.defs,
    authored,
    version: ++versionCounter,
  };
}

// ───────────────────────────── problem severity ─────────────────────────────

/**
 * Catalog problem text → rule + level. Kept next to the texts above so a wording change updates both; the Export
 * view dedupes catalog problems against its own checks by `rule`, and every view uses the same level.
 * Unmatched problems are errors.
 */
const PROBLEM_RULES: [RegExp, string, ValidationIssue["level"]][] = [
  [/^name is empty/, "play-name", "error"],
  [/^asset ".*" must be/, "play-asset", "error"],
  [/^base play (not in the library|is missing)/, "play-base", "error"],
  [/^base play is in another set/, "play-base-set", "error"],
  [/filed outside its set folder/, "play-base-folder", "error"],
  [/^the "from" play has \d+ players/, "play-base-players", "error"],
  [/: not a slot of this set/, "play-slot", "error"],
  [/: assignment not found/, "play-assignment", "error"],
  [/template assignment not found/, "assignment-template", "error"],
  [/keep \d+ (is more than|needs a template)/, "assignment-keep", "error"],
  [/"steps" must be an array/, "steps-array", "error"],
  [/is first defined by/, "assignment-redefined", "warning"],
  [/authored name .* must be/, "assignment-name", "error"],
  [/expected an assignment path/, "play-player-spec", "error"],
  [/handoff\/option mechanics/, "mechanics", "error"],
  [/^"players" must be an object/, "play-players", "error"],
  [/^reads: only the first/, "reads-extra", "warning"],
  [/^reads: bad slot/, "read-pos", "error"],
  [/^vip .* is not a slot/, "play-vip", "error"],
  [/^runHole/, "play-runhole", "error"],
  [/^asset .* (is also used by|already exists in the library)/, "play-asset-duplicate", "error"],
  [/^name ".*" is also (used by another custom play|a library play|a cloned play)/, "play-name-duplicate", "error"],
];

export function classifyPlayProblem(problem: string): { rule: string; level: ValidationIssue["level"] } {
  for (const [re, rule, level] of PROBLEM_RULES) if (re.test(problem)) return { rule, level };
  return { rule: "play-problem", level: "error" };
}

/** Severity of a play's catalog problems as a whole: "error" if any is error-level, "warning" otherwise. */
export function playProblemLevel(problems: readonly string[]): ValidationIssue["level"] | undefined {
  if (!problems.length) return undefined;
  return problems.some((p) => classifyPlayProblem(p).level === "error") ? "error" : "warning";
}
