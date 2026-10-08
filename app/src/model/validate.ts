// Validate-all for the Export view (docs/FORMATS.md is the rulebook):
//  - playbooks/*.json         §2 via playbookIssues() + shape checks + cross-file save-name clashes
//  - playbooks/plays/*.json   §3 "Rules the editor must enforce" (plus every catalog resolution problem, deduped);
//                             a custom play's base may be a library play or a play cloned into a custom set
//  - playbooks/sets/*.json    §5 via model/sets.ts validateSetsFile (built into the same mod); here only the
//                             file-level checks plus catalog problems of cloned plays the set rules didn't cover
//  - app-data/concepts.json   tags pointing at unknown categories / plays
//  - app-data/routes.json     "My Routes" shape, duplicate ids/names (editor-only: warnings at most)
// Every issue carries `file`, a JSON-pointer-ish `where` and a `rule` id so the UI can group it and jump to the editor.
import { classifyPlayProblem, type Catalog } from "./catalog";
import type { LibraryIndex } from "./library";
import { folder, leaf, maddenName, norm } from "./names";
import { glyphFor, positionCode } from "./positions";
import { validateSetsFile } from "./sets";
import { saveNameFor } from "./playbook";
import { motionIssues } from "./motionLimits";
import { chainOffField, offFieldText } from "./routeBounds";
import { bookFormation, bookSide, isClonePlay, playbookIssues, type ResolveOptions } from "./resolveBook";
import { hasMechanics, isMechanics, templateKept } from "./steps";
import {
  ASSIGNMENT_ROOT,
  AUTHORED_FOLDER,
  type AlignmentPos,
  type Asset,
  type AutoMotionWaypoint,
  type ConceptsDoc,
  type CustomPlaySpec,
  type PlaybookSpec,
  type PlaysFile,
  type ResolvedPlay,
  type RoutesDoc,
  type SetDef,
  type SetsFile,
  type Step,
  type ValidationIssue,
  type Vec,
} from "./types";

/** A workspace document as the validators see it (DocEntry is assignable: data is null when `error` is set). */
export interface SpecDoc<T> {
  path: string;
  data: T | null;
  error?: string;
}

export interface ValidateInput {
  playbooks: readonly SpecDoc<PlaybookSpec>[];
  plays: readonly SpecDoc<PlaysFile>[];
  sets?: readonly SpecDoc<SetsFile>[];
  concepts?: readonly SpecDoc<ConceptsDoc>[];
  /** app-data/routes.json ("My Routes"), when present. */
  routes?: readonly SpecDoc<RoutesDoc>[];
}

export type IssueLevel = ValidationIssue["level"];
export const LEVELS: readonly IssueLevel[] = ["error", "warning", "info"];
const LEVEL_RANK: Record<IssueLevel, number> = { error: 0, warning: 1, info: 2 };

const LEAF_RE = /^[A-Za-z0-9_]+$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v);
const q = (v: unknown) => JSON.stringify(v);

/** Save file name the game-side export writes for a playbook spec (tools/export.ps1 OutName) — defined in playbook.ts. */
export { saveNameFor };

/** True for the playbook specs tools/export.ps1 builds: playbooks/*.json except mod.json (top level only). */
export function isBuiltPlaybookPath(path: string): boolean {
  return /^playbooks\/[^/]+\.json$/i.test(path) && !/^playbooks\/mod\.json$/i.test(path);
}

// ───────────────────────────── library-derived lookups (cached per library index) ─────────────────────────────

interface StepVocabulary {
  /** Every known step type (enums.fields prefixes ∪ step types used in assignments.json). */
  types: Set<string>;
  /**
   * Step types seen in assignments.json. PlayDump's library export writes every public field of a step class, so for
   * these the field list is complete (anything else is a field PlayBuilder.NewStep rejects).
   */
  observedTypes: Set<string>;
  /** "Type.field" → JS type observed in the library ("number" | "string" | "boolean" | "object"). */
  fieldKinds: Map<string, string>;
  /** Known fields per step type (library-observed ∪ enums.fields). */
  fields: Map<string, Set<string>>;
  /** "Type.field" → string values the library itself uses (flag enums store combined values like "14"). */
  observed: Map<string, Set<string>>;
  /** Blocking scheme leaf names used by library plays. */
  blockingLeaves: Set<string>;
  /** Lower-cased library play assets (asset-collision checks ignore case like the game's file system). */
  playAssetsLower: Set<string>;
}

// enums.fields prefixes that describe containers, not assignment steps.
const NON_STEP_PREFIXES = new Set([
  "Play",
  "Set",
  "SetPosition",
  "PositionDefine",
  "PlayPassData",
  "AutomotionWaypoint",
  "DefAlignmentData",
  "OptionRouteData",
  "PrePlayDefensiveShiftInfo",
  "DelayedPrePlayDefensiveShiftInfo",
]);

const vocabCache = new WeakMap<LibraryIndex, StepVocabulary>();

export function stepVocabulary(index: LibraryIndex): StepVocabulary {
  // Only stock data feeds the vocabulary (assignments, enums, library plays), so overlays share the stock index's copy.
  const lib = index.stock ?? index;
  const hit = vocabCache.get(lib);
  if (hit) return hit;
  const types = new Set<string>();
  const observedTypes = new Set<string>();
  const fieldKinds = new Map<string, string>();
  const fields = new Map<string, Set<string>>();
  const observed = new Map<string, Set<string>>();
  const addField = (type: string, field: string) => {
    let f = fields.get(type);
    if (!f) fields.set(type, (f = new Set()));
    f.add(field);
  };
  for (const key of Object.keys(lib.data.enums?.fields ?? {})) {
    const dot = key.indexOf(".");
    if (dot <= 0) continue;
    const type = key.slice(0, dot);
    if (NON_STEP_PREFIXES.has(type)) continue;
    types.add(type);
    addField(type, key.slice(dot + 1));
  }
  for (const a of Object.values(lib.data.assignments ?? {})) {
    for (const step of a.steps ?? []) {
      if (!step || typeof step.type !== "string") continue;
      types.add(step.type);
      observedTypes.add(step.type);
      for (const [field, value] of Object.entries(step)) {
        if (field === "type") continue;
        addField(step.type, field);
        const k = `${step.type}.${field}`;
        if (!fieldKinds.has(k) && value !== null && value !== undefined) fieldKinds.set(k, Array.isArray(value) ? "array" : typeof value);
        if (typeof value === "string") {
          let o = observed.get(k);
          if (!o) observed.set(k, (o = new Set()));
          o.add(value);
        }
      }
    }
  }
  const blockingLeaves = new Set<string>();
  const playAssetsLower = new Set<string>();
  for (const p of lib.data.plays ?? []) {
    if (p.blocking) blockingLeaves.add(leaf(p.blocking));
    playAssetsLower.add(p.asset.toLowerCase());
  }
  const v: StepVocabulary = { types, observedTypes, fieldKinds, fields, observed, blockingLeaves, playAssetsLower };
  vocabCache.set(lib, v);
  return v;
}

/** Steps of an assignment referenced by path (library, or an authored "PBS/<name>"), else undefined. */
function stepsAtPath(catalog: Catalog, path: string): Step[] | undefined {
  const a = catalog.lib.assignment(path);
  if (a) return a.steps;
  const rel = path.startsWith(ASSIGNMENT_ROOT) ? path.slice(ASSIGNMENT_ROOT.length) : path;
  if (rel.startsWith(AUTHORED_FOLDER)) return catalog.authored.get(rel.slice(AUTHORED_FOLDER.length))?.steps;
  return undefined;
}

const LEG_TYPES = new Set(["RunRoute", "MoveDirection", "ReceiveHandoff", "RecievePitch"]);
/** Properties every step class has that PlayDump's export skips (setting them is pointless but not rejected). */
const HIDDEN_STEP_FIELDS = new Set(["Name", "opCodeEX", "__Id", "__InstanceGuid"]);

// ───────────────────────────── steps ─────────────────────────────

/** FORMATS.md §3: step type and enum values must exist in enums.json; numeric fields finite. */
export function stepIssues(step: unknown, lib: LibraryIndex, where: string, file?: string): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const push = (level: IssueLevel, rule: string, message: string, w = where) => out.push({ level, rule, message, file, where: w });
  if (!isObj(step) || typeof step.type !== "string" || !step.type) {
    push("error", "step-shape", `Step must be an object with a "type" (got ${q(step)?.slice(0, 60)})`);
    return out;
  }
  const vocab = stepVocabulary(lib);
  const type = step.type;
  if (!vocab.types.has(type)) {
    push("error", "step-type", `Unknown step type "${type}" (not in enums.json or the library's assignments)`);
    return out;
  }
  if (type === "None") push("warning", "step-none", `"None" ends the chain early; the builder appends the final None itself`);
  else if (!vocab.observedTypes.has(type))
    // PlayBuilder.NewStep copies the step's opcode from a library assignment that uses the class; with no instance
    // in assignments.json it throws ("no opcode seen for …") and tools/export.ps1 stops.
    push(
      "error",
      "step-unbuildable",
      `${type} has no instance in the library's assignments, so PlayBuilder can't author it (no opcode to copy) and the export stops — remove the step or pick another type`,
    );
  const known = vocab.fields.get(type);
  for (const [field, value] of Object.entries(step)) {
    if (field === "type") continue;
    const enumName = lib.enumForField(type, field);
    if (enumName) {
      const values = lib.enumValues(enumName);
      const legal =
        typeof value === "string" &&
        (values.length === 0 ||
          values.includes(value) ||
          !!vocab.observed.get(`${type}.${field}`)?.has(value) ||
          (/Flag/.test(enumName) && /^\d+$/.test(value))); // combined bit flags ("14")
      if (!legal) push("error", "step-enum", `${type}.${field} = ${q(value)} is not a ${enumName} value`);
      continue;
    }
    const kind = vocab.fieldKinds.get(`${type}.${field}`);
    if (kind === "number" && !isNum(value)) push("error", "step-number", `${type}.${field} must be a finite number (got ${q(value)})`);
    else if (kind === "boolean" && typeof value !== "boolean") push("warning", "step-field", `${type}.${field} should be true/false (got ${q(value)})`);
    else if (!kind && !known?.has(field) && !HIDDEN_STEP_FIELDS.has(field)) {
      if (vocab.observedTypes.has(type))
        push("error", "step-field", `${type} has no field "${field}" — PlayBuilder rejects it ("${type}Assignment has no field ${field}"), so the export stops`);
      else push("warning", "step-field", `${type} has no field "${field}" in the library (PlayBuilder rejects fields the step class doesn't have)`);
    }
  }
  if (LEG_TYPES.has(type)) {
    for (const f of ["distance", "direction"] as const)
      if (!isNum(step[f])) push("error", "step-number", `${type} needs a numeric ${f}`);
    if (step.speed === undefined) push("warning", "step-speed", `${type} has no speed (0–100)`);
    else if (isNum(step.speed) && (step.speed < 0 || step.speed > 100)) push("warning", "step-speed", `${type} speed ${step.speed} is outside 0–100`);
    if (isNum(step.distance) && step.distance < 0) push("warning", "step-distance", `${type} distance ${step.distance} is negative`);
  }
  if (type === "AutoMotion") {
    const wps = step.waypoints;
    if (!Array.isArray(wps) || wps.length === 0) push("error", "motion-waypoints", "AutoMotion needs at least one waypoint");
    else
      wps.forEach((wp, k) => {
        const ww = `${where}/waypoints/${k}`;
        if (!isObj(wp)) return push("error", "motion-waypoints", `Waypoint ${k + 1} must be an object`, ww);
        const pos = wp.position;
        if (!isObj(pos) || !isNum(pos.x) || !isNum(pos.y)) push("error", "motion-waypoints", `Waypoint ${k + 1} needs a numeric position {x, y}`, ww);
        for (const f of ["speed", "facingAngle", "transitID"])
          if (wp[f] !== undefined && !isNum(wp[f])) push("error", "step-number", `Waypoint ${k + 1} ${f} must be a finite number`, ww);
        if (wp.locoStyle !== undefined) {
          const en = lib.enumForField("AutomotionWaypoint", "locoStyle") ?? "AutomotionLocoStyle";
          const values = lib.enumValues(en);
          if (typeof wp.locoStyle !== "string" || (values.length > 0 && !values.includes(wp.locoStyle)))
            push("error", "step-enum", `Waypoint ${k + 1} locoStyle ${q(wp.locoStyle)} is not a ${en} value`, ww);
        }
      });
  }
  return out;
}

// ───────────────────────────── plays files (§3) ─────────────────────────────

interface PlaysContext {
  /** set asset + "|" + norm(name) → custom plays (file/index) with that name. */
  names: Map<string, { file: string; index: number; name: string }[]>;
  /** lower-cased custom key → custom plays with that asset. */
  assets: Map<string, { file: string; index: number; name: string }[]>;
  /** `new` name → first definition (file, index, play name). */
  firstNew: Map<string, { file: string; index: number; play: string; spec: Record<string, unknown> }>;
}

/** What a custom play's `base` supplies: a library play, or a play cloned into a custom set (FORMATS.md §5). */
interface BaseInfo {
  asset: Asset;
  set: Asset;
  name: string;
  /** The base is a play cloned into a custom set (playbooks/sets/). */
  clone: boolean;
  slotCount: number;
  readsCount: number;
  /** Steps the base runs in slot `n` (library assignment or the clone's resolved slot). */
  steps(n: number): Step[] | undefined;
}

/** The base play of a custom play: a library play, or a clone from the catalog overlay; undefined otherwise. */
function baseInfo(catalog: Catalog, asset: string): BaseInfo | undefined {
  if (!asset) return undefined;
  const lib = catalog.lib;
  const rp: ResolvedPlay | undefined = catalog.get(asset);
  if (rp && isClonePlay(rp))
    return {
      asset: rp.asset,
      set: rp.set,
      name: rp.name,
      clone: true,
      slotCount: rp.slots.length,
      readsCount: rp.reads.length,
      steps: (n) => rp.slots[n]?.steps,
    };
  const lp = lib.playByAsset.get(asset);
  if (lp)
    return {
      asset: lp.asset,
      set: lp.set,
      name: lp.name,
      clone: false,
      slotCount: lp.assignments.length,
      readsCount: lp.reads.length,
      steps: (n) => (lp.assignments[n] ? lib.assignment(lp.assignments[n])?.steps : undefined),
    };
  return undefined;
}

/** Plays a custom play's name/asset must not repeat in its set: library plays and clones (pbook-build finds them first). */
function builtInPlays(catalog: Catalog, set: Asset): ResolvedPlay[] {
  return catalog.playsInSet(set).filter((p) => p.source === "library" || isClonePlay(p));
}

function pushTo<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const l = m.get(k);
  if (l) l.push(v);
  else m.set(k, [v]);
}

function playsContext(docs: readonly SpecDoc<PlaysFile>[], catalog: Catalog): PlaysContext {
  const ctx: PlaysContext = { names: new Map(), assets: new Map(), firstNew: new Map() };
  for (const doc of docs) {
    const plays = isObj(doc.data) && Array.isArray(doc.data.plays) ? doc.data.plays : [];
    plays.forEach((spec, index) => {
      if (!isObj(spec)) return;
      const base = typeof spec.base === "string" ? baseInfo(catalog, spec.base) : undefined;
      const name = typeof spec.name === "string" ? spec.name : "";
      if (base) {
        if (name.trim()) pushTo(ctx.names, `${base.set}|${norm(name)}`, { file: doc.path, index, name });
        if (typeof spec.asset === "string" && spec.asset)
          pushTo(ctx.assets, (folder(base.set) + spec.asset).toLowerCase(), { file: doc.path, index, name });
      }
      if (isObj(spec.players))
        for (const p of Object.values(spec.players))
          if (isObj(p) && typeof p.new === "string" && !ctx.firstNew.has(p.new))
            ctx.firstNew.set(p.new, { file: doc.path, index, play: name, spec: p });
    });
  }
  return ctx;
}

const other = (list: { file: string; index: number; name: string }[], file: string, index: number) =>
  list.filter((x) => !(x.file === file && x.index === index)).map((x) => `"${maddenName(x.name)}" (${x.file} #${x.index + 1})`);

function sameNewSpec(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const pick = (o: Record<string, unknown>) => JSON.stringify([o.template ?? null, o.keep ?? 0, o.steps ?? null]);
  return pick(a) === pick(b);
}

/** FORMATS.md §3 rules for one custom play spec (without the catalog's own problem list). */
function customPlayIssues(spec: unknown, index: number, file: string, catalog: Catalog, ctx: PlaysContext): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const pw = `/plays/${index}`;
  const push = (level: IssueLevel, rule: string, message: string, w = pw) => out.push({ level, rule, message, file, where: w });
  if (!isObj(spec)) {
    push("error", "play-shape", `Play #${index + 1} must be an object`);
    return out;
  }
  const lib = catalog.lib;
  const vocab = stepVocabulary(lib);
  const p = spec as CustomPlaySpec & Record<string, unknown>;
  const name = typeof p.name === "string" ? p.name : "";
  const label = name.trim() ? `"${maddenName(name)}"` : `Play #${index + 1}`;

  if (!name.trim()) push("error", "play-name", `${label}: name is empty`);
  const asset = typeof p.asset === "string" ? p.asset : "";
  if (!LEAF_RE.test(asset)) push("error", "play-asset", `${label}: asset ${q(p.asset ?? "")} must be [A-Za-z0-9_] and not empty`);

  const baseAsset = typeof p.base === "string" ? p.base : "";
  const base = baseInfo(catalog, baseAsset);
  if (!baseAsset) push("error", "play-base", `${label}: base play is missing`);
  else if (!base)
    push("error", "play-base", `${label}: base play not found — use a library play or a play cloned into a custom set (${baseAsset})`);
  const set: SetDef | undefined = base ? lib.setByAsset.get(base.set) : undefined;
  if (base) {
    if (typeof p.set === "string" && p.set && p.set !== base.set)
      push("error", "play-base-set", `${label}: base play is in ${leaf(base.set)}, not ${leaf(p.set)} — the base must come from the same set`);
    if (folder(base.asset) !== folder(base.set))
      push("error", "play-base-folder", `${label}: base play is filed outside its set folder; pick another base in ${leaf(base.set)}`);
  }

  // Names and assets unique within the set (vs library + other custom plays).
  if (base) {
    const builtIn = builtInPlays(catalog, base.set);
    if (name.trim()) {
      const dupes = other(ctx.names.get(`${base.set}|${norm(name)}`) ?? [], file, index);
      if (dupes.length) push("error", "play-name-duplicate", `${label}: name is also used in this set by ${dupes.join(", ")}`);
      const clash = builtIn.find((bp) => norm(bp.name) === norm(name));
      if (clash)
        push(
          "error",
          "play-name-duplicate",
          clash.source === "library"
            ? `${label}: a library play in ${set ? maddenName(set.name) : leaf(base.set)} has the same name — the game-side builder picks the library play; rename the custom play`
            : `${label}: a play cloned into ${set ? maddenName(set.name) : leaf(base.set)} (${clash.file ?? "playbooks/sets/"}) has the same name — the game-side builder picks the clone; rename the custom play`,
        );
    }
    if (LEAF_RE.test(asset)) {
      const key = (folder(base.set) + asset).toLowerCase();
      if (vocab.playAssetsLower.has(key)) push("error", "play-asset-duplicate", `${label}: asset ${asset} already exists in the library set folder`);
      else if (builtIn.some((bp) => bp.source !== "library" && bp.key.toLowerCase() === key))
        push("error", "play-asset-duplicate", `${label}: asset ${asset} is already used by a play cloned into this set`);
      const dupes = other(ctx.assets.get(key) ?? [], file, index);
      if (dupes.length) push("error", "play-asset-duplicate", `${label}: asset ${asset} is also used by ${dupes.join(", ")}`);
    }
  }

  const side = set ? lib.formationOfSet(set.asset) : undefined;
  const isDefense = side ? lib.formationSide(side) === "defense" : false;
  if (p.playType !== undefined) {
    const enumName = isDefense ? "DefensePlayType" : "OffensePlayType";
    const values = lib.enumValues(enumName);
    if (typeof p.playType !== "string" || (values.length > 0 && !values.includes(p.playType)))
      push("error", "play-type", `${label}: playType ${q(p.playType)} is not an ${enumName} value`);
  }
  if (p.blocking !== undefined) {
    if (typeof p.blocking !== "string" || !p.blocking) push("error", "play-blocking", `${label}: blocking must be a blocking scheme leaf name`);
    else if (p.blocking.includes("/")) push("warning", "play-blocking", `${label}: blocking should be a leaf name (e.g. "BTCounter"), not a path`);
    else if (!vocab.blockingLeaves.has(p.blocking))
      push("warning", "play-blocking", `${label}: blocking "${p.blocking}" isn't used by any library play — check the name (valid schemes may still be unused)`);
  }
  if (p.runHole !== undefined && !(isInt(p.runHole) && p.runHole >= 0 && p.runHole <= 9))
    push("error", "play-runhole", `${label}: runHole ${q(p.runHole)} must be an integer 0–9`);

  const normal: AlignmentPos[] = set?.movements?.Normal ?? [];
  const slotCount = base ? base.slotCount : normal.length;
  const slotName = (n: number) => (normal[n] ? positionCode(normal[n].pos) : `slot ${n}`);
  if (p.vip !== undefined) {
    if (!isInt(p.vip) || (base && (p.vip < 0 || p.vip >= slotCount)))
      push("error", "play-vip", `${label}: vip ${q(p.vip)} is not a slot of this set (0–${Math.max(0, slotCount - 1)})`);
    else if (normal[p.vip] && glyphFor(normal[p.vip]) !== "skill" && glyphFor(normal[p.vip]) !== "qb")
      push("warning", "play-vip", `${label}: vip ${p.vip} (${slotName(p.vip)}) isn't an eligible receiver`);
  }

  // A route put on a player it wasn't drawn for (a mirrored My Routes route on a wide receiver…) can carry him off the
  // field. Offense only (defenders' moves are measured the other way).
  const offFieldCheck = (steps: readonly Step[] | undefined, n: number, who: string, sw: string) => {
    const a = normal[n];
    if (isDefense || !a || !steps) return;
    const o = chainOffField({ x: a.x, y: a.y }, steps);
    if (o)
      push(
        "warning",
        "route-off-field",
        `${who}: the route ${offFieldText(o)} (ball in the middle of the field) — shorten its outward legs (designer: Route → Fit to field)`,
        sw,
      );
  };

  // A motion the player was given here (authored steps only: stock motions are the yardstick) that goes past what
  // real plays do (model/motionLimits.ts — the designer shows the same messages on its Motion tab).
  const motionCheck = (resolved: readonly Step[], authored: readonly Step[], n: number, who: string, sw: string) => {
    const a = normal[n];
    const m = authored.find((st) => st.type === "AutoMotion");
    if (isDefense || !a || !m || !Array.isArray(m.waypoints)) return;
    const wps = (m.waypoints as AutoMotionWaypoint[]).map((w) => w?.position).filter((v): v is Vec => !!v && isNum(v.x) && isNum(v.y));
    if (!wps.length) return;
    const ofp = resolved.find((st) => st.type === "OverrideFormPos" && isNum(st.offsetX) && isNum(st.offsetY));
    const start = ofp ? { x: ofp.offsetX as number, y: ofp.offsetY as number } : { x: a.x, y: a.y };
    for (const issue of motionIssues(start, wps, { pos: a.pos })) push("warning", "motion-limits", `${who}: ${issue.message} (designer: Motion tab)`, sw);
  };

  // players
  if (p.players !== undefined && !isObj(p.players)) push("error", "play-players", `${label}: "players" must be an object of slot → assignment`);
  const players = isObj(p.players) ? p.players : {};
  for (const [slotKey, pspec] of Object.entries(players)) {
    const sw = `${pw}/players/${slotKey}`;
    const n = Number(slotKey);
    if (!/^\d+$/.test(slotKey) || (base && n >= slotCount)) {
      push("error", "play-slot", `${label}: players key "${slotKey}" is not a slot of this set (0–${Math.max(0, slotCount - 1)})`, sw);
      continue;
    }
    const who = `${label} ${slotName(n)} (slot ${n})`;
    const baseSteps = base ? base.steps(n) : undefined;
    const baseMech = baseSteps ? hasMechanics(baseSteps) : false;
    if (typeof pspec === "string") {
      const steps = stepsAtPath(catalog, pspec);
      if (!steps) push("error", "play-assignment", `${who}: assignment not found (${pspec})`, sw);
      else if (baseMech && !hasMechanics(steps))
        push("error", "mechanics", `${who}: replaces the base play's handoff/option mechanics — keep them (a "new" spec with keep) or pick another base`, sw);
      else offFieldCheck(steps, n, who, sw);
      continue;
    }
    if (!isObj(pspec) || typeof pspec.new !== "string") {
      push("error", "play-player-spec", `${who}: expected an assignment path or { "new": … }`, sw);
      continue;
    }
    const nw = pspec.new;
    if (!LEAF_RE.test(nw)) push("error", "assignment-name", `${who}: authored name ${q(nw)} must be [A-Za-z0-9_]`, sw);
    if (pspec.routeType !== undefined) {
      const values = lib.enumValues("AssignRouteType");
      if (typeof pspec.routeType !== "string" || (values.length > 0 && !values.includes(pspec.routeType)))
        push("error", "assignment-routetype", `${who}: routeType ${q(pspec.routeType)} is not an AssignRouteType value`, sw);
    }
    let source = baseSteps;
    if (pspec.template !== undefined) {
      if (typeof pspec.template !== "string" || !pspec.template) push("error", "assignment-template", `${who}: template must be an assignment path`, sw);
      else {
        source = stepsAtPath(catalog, pspec.template);
        if (!source) push("error", "assignment-template", `${who}: template assignment not found (${pspec.template})`, sw);
      }
    }
    let keep = 0;
    if (pspec.keep !== undefined) {
      if (!isInt(pspec.keep) || pspec.keep < -1) push("error", "assignment-keep", `${who}: keep must be a whole number ≥ 0, or -1 for every step (got ${q(pspec.keep)})`, sw);
      else {
        const tk = templateKept(source, pspec);
        keep = tk.keep;
        const real = tk.real;
        if (keep > 0 && !source) push("error", "assignment-keep", `${who}: keep ${keep} needs a template or a base slot`, sw);
        else if (keep > real) push("error", "assignment-keep", `${who}: keep ${keep} is more than the template's ${real} steps`, sw);
      }
    }
    if (!Array.isArray(pspec.steps)) push("error", "steps-array", `${who}: "steps" must be an array`, sw);
    else pspec.steps.forEach((st, j) => out.push(...stepIssues(st, lib, `${sw}/steps/${j}`, file)));

    // Mechanics pairing (FORMATS.md §3): a slot with handoff/fake/option steps must keep them (keep ≥ the source's
    // mechanics prefix), or the QB and ballcarrier fall out of sync.
    if (baseMech && Array.isArray(pspec.steps)) {
      const src = source ?? [];
      const prefix = src.reduce((n, st, i) => (isMechanics(st) ? i + 1 : n), 0);
      const authored = pspec.steps.filter((st): st is Step => isObj(st) && typeof st.type === "string");
      const resolved = [...templateKept(src, pspec).kept, ...authored];
      if (!hasMechanics(resolved))
        push(
          "error",
          "mechanics",
          `${who}: drops the base play's handoff/option mechanics — ${prefix ? `set "keep": ${prefix} to keep them` : "keep them"} or pick another base`,
          sw,
        );
      else if (prefix > 0 && keep < prefix && !authored.some(isMechanics))
        push("warning", "mechanics", `${who}: keeps only ${keep} of the ${prefix} handoff/option steps (keep ${prefix} keeps them paired)`, sw);
    }
    if (Array.isArray(pspec.steps) && (keep === 0 || source)) {
      const authored = pspec.steps.filter((st): st is Step => isObj(st) && typeof st.type === "string");
      const resolved = [...templateKept(source, pspec).kept, ...authored];
      offFieldCheck(resolved, n, who, sw);
      motionCheck(resolved, authored, n, who, sw);
    }
    const first = ctx.firstNew.get(nw);
    if (first && !(first.file === file && first.index === index) && !sameNewSpec(first.spec, pspec))
      push(
        "warning",
        "assignment-redefined",
        `${who}: "${nw}" is first defined by "${maddenName(first.play)}" (${first.file} #${first.index + 1}) with different steps; the builder reuses that first definition`,
        sw,
      );
  }

  // reads
  if (p.reads !== undefined) {
    if (!Array.isArray(p.reads)) push("error", "read-shape", `${label}: reads must be an array`);
    else {
      if (base && p.reads.length > base.readsCount)
        push("warning", "reads-extra", `${label}: ${p.reads.length} reads but the base play has ${base.readsCount}; only the first ${base.readsCount} are used`);
      const concepts = lib.enumValues("ConceptType");
      p.reads.forEach((r, k) => {
        const rw = `${pw}/reads/${k}`;
        if (!isObj(r)) return push("error", "read-shape", `${label}: read ${k + 1} must be an object`, rw);
        if (!isInt(r.pos) || r.pos < 0 || (slotCount > 0 && r.pos >= slotCount))
          push("error", "read-pos", `${label}: read ${k + 1} pos ${q(r.pos)} is not a slot of this set`, rw);
        else if (normal[r.pos] && glyphFor(normal[r.pos]) === "ol")
          push("warning", "read-pos", `${label}: read ${k + 1} points at ${slotName(r.pos)} (an offensive lineman)`, rw);
        if (!isNum(r.pct) || r.pct < 0 || r.pct > 1) push("error", "read-pct", `${label}: read ${k + 1} pct ${q(r.pct)} must be 0–1`, rw);
        if (r.concept !== undefined && r.concept !== null && (typeof r.concept !== "string" || (concepts.length > 0 && !concepts.includes(r.concept))))
          push("error", "read-concept", `${label}: read ${k + 1} concept ${q(r.concept)} is not a ConceptType value — PlayBuilder rejects it (Enum.Parse), so the export stops`, rw);
      });
    }
  }
  return out;
}

/** Catalog problem text → rule + level (defined next to the problem texts in catalog.ts). */
export { classifyPlayProblem };

const playIndexOf = (where?: string) => {
  const m = /^\/plays\/(\d+)/.exec(where ?? "");
  return m ? Number(m[1]) : -1;
};

export function playsFileIssues(doc: SpecDoc<PlaysFile>, catalog: Catalog, ctx?: PlaysContext): ValidationIssue[] {
  const file = doc.path;
  const out: ValidationIssue[] = [];
  if (doc.error || doc.data === null) return [{ level: "error", rule: "file-unreadable", message: doc.error ?? "File failed to load", file }];
  if (!isObj(doc.data)) return [{ level: "error", rule: "plays-shape", message: "A plays file must be a JSON object with a \"plays\" array", file }];
  if (!Array.isArray(doc.data.plays)) return [{ level: "error", rule: "plays-array", message: "\"plays\" must be an array (FORMATS.md §3)", file, where: "/plays" }];
  const c = ctx ?? playsContext([doc], catalog);
  doc.data.plays.forEach((spec, i) => out.push(...customPlayIssues(spec, i, file, catalog, c)));

  // Surface every catalog problem our own checks didn't already report for that play.
  const have = new Set(out.map((i) => `${playIndexOf(i.where)}|${i.rule}`));
  for (const rp of catalog.custom) {
    if (rp.file !== file || rp.index === undefined) continue;
    for (const problem of rp.problems) {
      const { rule, level } = classifyPlayProblem(problem);
      if (have.has(`${rp.index}|${rule}`)) continue;
      have.add(`${rp.index}|${rule}`);
      out.push({ level, rule, message: `"${rp.name ? maddenName(rp.name) : `#${rp.index + 1}`}": ${problem}`, file, where: `/plays/${rp.index}` });
    }
  }
  return out;
}

// ───────────────────────────── sets files (§5) ─────────────────────────────

/**
 * FORMATS.md §5 for one sets file (custom formations, sets and the plays cloned into them — built into the same mod as
 * the custom plays). The rules live in model/sets.ts (`validateSetsFile`, shared with the Formations editor so both
 * views report the same issues); this adds the unreadable-file / shape checks and, with a catalog, the resolution
 * problems of cloned plays (e.g. modified players) that the set rules didn't already report for that clone.
 */
export function setsFileIssues(
  doc: SpecDoc<SetsFile>,
  lib: LibraryIndex,
  allSets: readonly SpecDoc<SetsFile>[] = [doc],
  catalog?: Catalog,
): ValidationIssue[] {
  const file = doc.path;
  if (doc.error || doc.data === null) return [{ level: "error", rule: "file-unreadable", message: doc.error ?? "File failed to load", file }];
  if (!isObj(doc.data)) return [{ level: "error", rule: "sets-shape", message: 'A sets file must be a JSON object with a "sets" array', file }];
  const allFiles = allSets.map((d) => ({ path: d.path, data: d.error || !isObj(d.data) ? null : d.data }));
  const out = validateSetsFile(doc.data, lib, { file, allFiles });
  if (catalog)
    for (const rp of catalog.clones ?? []) {
      if (rp.clone?.file !== file || !rp.problems.length) continue;
      const w = `/sets/${rp.clone.setIndex}/plays/${rp.clone.index}`;
      if (out.some((i) => i.where === w || i.where?.startsWith(w + "/"))) continue;
      const seen = new Set<string>();
      for (const problem of rp.problems) {
        const { rule, level } = classifyPlayProblem(problem);
        if (seen.has(rule)) continue;
        seen.add(rule);
        out.push({ level, rule, message: `"${rp.name ? maddenName(rp.name) : leaf(rp.key)}": ${problem}`, file, where: w });
      }
    }
  return out;
}

// ───────────────────────────── My Routes (app-data/routes.json) ─────────────────────────────

/**
 * Light checks of the saved-routes library (editor-only — the game never reads it, so nothing here is an error):
 * shape, id/name/side/steps per route, step types (with a library), duplicate ids and names.
 */
export function routesIssues(doc: SpecDoc<RoutesDoc>, lib?: LibraryIndex): ValidationIssue[] {
  const file = doc.path;
  const out: ValidationIssue[] = [];
  const push = (rule: string, message: string, where?: string) => out.push({ level: "warning", rule, message, file, where });
  if (doc.error || doc.data === null) return [{ level: "warning", rule: "file-unreadable", message: `${doc.error ?? "File failed to load"} — My Routes can't be used until it's fixed`, file }];
  const d = doc.data;
  if (!isObj(d) || !Array.isArray(d.routes)) {
    push("routes-shape", 'My Routes must be a JSON object with a "routes" array', isObj(d) ? "/routes" : undefined);
    return out;
  }
  if (d.version !== undefined && d.version !== 1) push("routes-shape", `Unknown My Routes version ${q(d.version)} (expected 1)`, "/version");
  const vocab = lib ? stepVocabulary(lib) : undefined;
  const ids = new Map<string, number>();
  const names = new Map<string, number>();
  d.routes.forEach((r, i) => {
    const w = `/routes/${i}`;
    if (!isObj(r)) return push("route-shape", `Route #${i + 1} must be an object`, w);
    const label = typeof r.name === "string" && r.name.trim() ? `"${r.name}"` : `Route #${i + 1}`;
    if (typeof r.id !== "string" || !r.id) push("route-id", `${label} has no id`, w);
    else if (ids.has(r.id)) push("route-duplicate-id", `${label} has the same id as route #${ids.get(r.id)! + 1} ("${r.id}")`, w);
    else ids.set(r.id, i);
    if (typeof r.name !== "string" || !r.name.trim()) push("route-name", `${label} has no name`, w);
    else {
      const k = norm(r.name);
      if (names.has(k)) push("route-duplicate-name", `${label} has the same name as route #${names.get(k)! + 1}`, w);
      else names.set(k, i);
    }
    if (r.side !== "left" && r.side !== "right") push("route-side", `${label}: side must be "left" or "right" (got ${q(r.side)})`, w);
    if (!Array.isArray(r.steps)) return push("route-steps", `${label}: "steps" must be an array`, w);
    if (r.steps.length === 0) push("route-steps", `${label} has no steps`, w);
    r.steps.forEach((st, j) => {
      const sw = `${w}/steps/${j}`;
      if (!isObj(st) || typeof st.type !== "string" || !st.type) push("route-steps", `${label}: step ${j + 1} must be an object with a "type"`, sw);
      else if (vocab && !vocab.types.has(st.type)) push("route-steps", `${label}: step ${j + 1} has an unknown type "${st.type}"`, sw);
    });
  });
  return out;
}

// ───────────────────────────── concepts ─────────────────────────────

const pointer = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");
const unpointer = (seg: string) => seg.replace(/~1/g, "/").replace(/~0/g, "~");

export function conceptsIssues(doc: SpecDoc<ConceptsDoc>, catalog: Catalog | undefined): ValidationIssue[] {
  const file = doc.path;
  const out: ValidationIssue[] = [];
  const push = (level: IssueLevel, rule: string, message: string, where?: string) => out.push({ level, rule, message, file, where });
  if (doc.error || doc.data === null) return [{ level: "error", rule: "file-unreadable", message: doc.error ?? "File failed to load", file }];
  if (!isObj(doc.data)) return [{ level: "error", rule: "concepts-shape", message: "concepts.json must be a JSON object", file }];
  const d = doc.data;
  const cats = Array.isArray(d.categories) ? d.categories : [];
  if (d.categories !== undefined && !Array.isArray(d.categories)) push("error", "concepts-shape", '"categories" must be an array', "/categories");
  const ids = new Map<string, number>();
  cats.forEach((c, i) => {
    if (!isObj(c) || typeof c.id !== "string" || !c.id) return push("warning", "concept-category", `Category #${i + 1} has no id`, `/categories/${i}`);
    if (ids.has(c.id)) push("warning", "concept-category", `Category id "${c.id}" is used twice`, `/categories/${i}`);
    else ids.set(c.id, i);
  });
  cats.forEach((c, i) => {
    if (isObj(c) && typeof c.parent === "string" && c.parent && !ids.has(c.parent))
      push("warning", "concept-parent", `Category "${String(c.name ?? c.id)}" is nested under unknown category "${c.parent}"`, `/categories/${i}`);
  });
  if (d.tags !== undefined && !isObj(d.tags)) push("error", "concepts-shape", '"tags" must be an object of play → category ids', "/tags");
  for (const [key, tags] of Object.entries(isObj(d.tags) ? d.tags : {})) {
    const w = `/tags/${pointer(key)}`;
    if (catalog && !catalog.get(key)) push("warning", "concept-unknown-play", `Tagged play not found in the library or custom plays: ${key.split("/").slice(-3).join("/")}`, w);
    if (!Array.isArray(tags)) {
      push("warning", "concept-tags", `Tags for ${leaf(key)} must be an array of category ids`, w);
      continue;
    }
    const unknown = tags.filter((t) => typeof t !== "string" || !ids.has(t));
    if (unknown.length) push("warning", "concept-unknown-category", `${leaf(key)} is tagged with unknown categor${unknown.length > 1 ? "ies" : "y"} ${unknown.map((t) => q(t)).join(", ")}`, w);
  }
  return out;
}

// ───────────────────────────── playbooks (§2) ─────────────────────────────

/**
 * playbookIssues() reports every catalog problem of a listed custom play as one error. Point at the plays file and
 * downgrade to a warning when all of them are warning-level (e.g. a reused authored-assignment name).
 */
function refinePlayProblem(issue: ValidationIssue, spec: PlaybookSpec, catalog: Catalog, opts: ResolveOptions): void {
  const m = /^\/formations\/(\d+)\/sets\/(\d+)\/plays\/(\d+)$/.exec(issue.where ?? "");
  if (!m) return;
  const fe = spec.formations?.[Number(m[1])];
  const se = fe && Array.isArray(fe.sets) ? fe.sets[Number(m[2])] : undefined;
  const pe = se?.plays?.[Number(m[3])];
  const formation = fe ? bookFormation(catalog.lib, String(fe.formation ?? ""), bookSide(spec), opts) : undefined;
  const set = formation && se ? catalog.lib.setByName(formation, String(se.set ?? "")) : undefined;
  const play = set && pe ? catalog.playInSetByName(set.asset, String(pe.play ?? "")) : undefined;
  if (!play || !play.problems.length) return;
  const errors = play.problems.filter((pr) => classifyPlayProblem(pr).level === "error");
  if (!errors.length) issue.level = "warning";
  if (play.file) {
    const shown = errors.length ? errors : play.problems;
    const at = isClonePlay(play) ? `cloned in ${play.file}` : `${play.file} #${(play.index ?? 0) + 1}`;
    issue.message = `"${maddenName(play.name)}" (${at}): ${shown.join("; ")}`;
  }
}

/**
 * One playbook spec: playbookIssues() (FORMATS.md §2, the shape checks at every level, and what makes
 * tools/pbook-build.mjs stop or drop content; capacity counts template sections when `opts.template` is given).
 */
export function playbookDocIssues(doc: SpecDoc<PlaybookSpec>, catalog: Catalog, opts: ResolveOptions = {}): ValidationIssue[] {
  const file = doc.path;
  if (doc.error || doc.data === null) return [{ level: "error", rule: "file-unreadable", message: doc.error ?? "File failed to load", file }];
  const out: ValidationIssue[] = [];
  if (!isBuiltPlaybookPath(file))
    out.push({ level: "info", rule: "book-not-built", message: "tools/export.ps1 only builds playbooks/*.json (top level); this file won't become a save", file });
  try {
    const issues = playbookIssues(doc.data, catalog, file, opts);
    for (const issue of issues) if (issue.rule === "play-problem") refinePlayProblem(issue, doc.data, catalog, opts);
    out.push(...issues);
  } catch (e) {
    out.push({ level: "error", rule: "book-shape", message: `Couldn't check this playbook: ${e instanceof Error ? e.message : String(e)}`, file });
  }
  return out;
}

// ───────────────────────────── all ─────────────────────────────

/**
 * Every FORMATS.md rule across playbooks/, playbooks/plays/, playbooks/sets/, app-data/concepts.json and
 * app-data/routes.json. Pass the template save's contents (`opts.template`) so formation names prefer the template's
 * formations, capacity counts the template sections and template sections the template lacks are errors.
 */
export function validateAll(input: ValidateInput, catalog: Catalog, opts: ResolveOptions = {}): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const doc of input.playbooks) out.push(...playbookDocIssues(doc, catalog, opts));

  // Two specs with the same name build the same save; the later one overwrites the earlier (tools/export.ps1).
  const bySave = new Map<string, string[]>();
  for (const doc of input.playbooks)
    if (!doc.error && isObj(doc.data) && isBuiltPlaybookPath(doc.path) && typeof doc.data.name === "string" && doc.data.name)
      pushTo(bySave, saveNameFor(doc.data), doc.path);
  for (const [save, files] of bySave)
    if (files.length > 1)
      for (const file of files)
        out.push({
          level: "error",
          rule: "save-name-duplicate",
          message: `${files.join(" and ")} all build ${save}; the last one built overwrites the others — rename one playbook`,
          file,
        });

  const ctx = playsContext(input.plays, catalog);
  for (const doc of input.plays) out.push(...playsFileIssues(doc, catalog, ctx));
  for (const doc of input.sets ?? []) out.push(...setsFileIssues(doc, catalog.lib, input.sets, catalog));
  for (const doc of input.concepts ?? []) out.push(...conceptsIssues(doc, catalog));
  for (const doc of input.routes ?? []) out.push(...routesIssues(doc, catalog.lib));
  return out;
}

// ───────────────────────────── helpers for the UI ─────────────────────────────

export interface IssueCounts {
  error: number;
  warning: number;
  info: number;
}

export function countIssues(issues: readonly ValidationIssue[]): IssueCounts {
  const c: IssueCounts = { error: 0, warning: 0, info: 0 };
  for (const i of issues) c[i.level]++;
  return c;
}

export interface IssueGroup {
  file: string;
  counts: IssueCounts;
  /** Sorted by severity, then document position. */
  issues: ValidationIssue[];
}

/** Natural compare of `where` pointers ("/plays/10" after "/plays/9"). */
function compareWhere(a = "", b = ""): number {
  const pa = a.split("/");
  const pb = b.split("/");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    const na = Number(pa[i]);
    const nb = Number(pb[i]);
    const d = pa[i] !== "" && pb[i] !== "" && Number.isFinite(na) && Number.isFinite(nb) ? na - nb : pa[i].localeCompare(pb[i]);
    if (d) return d;
  }
  return 0;
}

/** Group by file (path order; file-less issues under ""), each group sorted by severity then position. */
export function groupIssues(issues: readonly ValidationIssue[]): IssueGroup[] {
  const map = new Map<string, ValidationIssue[]>();
  for (const i of issues) pushTo(map, i.file ?? "", i);
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([file, list]) => ({
      file,
      counts: countIssues(list),
      issues: [...list].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || compareWhere(a.where, b.where)),
    }));
}

/** Which editor owns an issue (the view turns this into a route). */
export type IssueTarget =
  | { view: "playbook"; path: string; f?: number; s?: number; p?: number }
  | { view: "designer"; path: string; index?: number }
  | { view: "formations"; path: string; index?: number }
  | { view: "concepts"; play?: string };

export function issueTarget(issue: Pick<ValidationIssue, "file" | "where">): IssueTarget | undefined {
  const file = issue.file;
  if (!file) return undefined;
  const where = issue.where ?? "";
  const num = (re: RegExp) => {
    const m = re.exec(where);
    return m ? Number(m[1]) : undefined;
  };
  if (file.startsWith("playbooks/plays/")) return { view: "designer", path: file, index: num(/^\/plays\/(\d+)/) };
  if (file.startsWith("playbooks/sets/")) return { view: "formations", path: file, index: num(/^\/sets\/(\d+)/) };
  if (file.startsWith("app-data/")) {
    // Only concepts.json has an editor view target; My Routes (routes.json) and other app data aren't linkable yet.
    if (!/^app-data\/concepts\.json$/i.test(file)) return undefined;
    const m = /^\/tags\/([^/]+)/.exec(where);
    return { view: "concepts", play: m ? unpointer(m[1]) : undefined };
  }
  if (file.startsWith("playbooks/")) {
    const m = /^\/formations\/(\d+)(?:\/sets\/(\d+)(?:\/plays\/(\d+))?)?/.exec(where);
    return m
      ? { view: "playbook", path: file, f: Number(m[1]), s: m[2] !== undefined ? Number(m[2]) : undefined, p: m[3] !== undefined ? Number(m[3]) : undefined }
      : { view: "playbook", path: file };
  }
  return undefined;
}

/** Human-readable location of an issue inside its document ("Shotgun › Y Trips Wk › Slants", "PBS Snag › slot 3"). */
export function describeWhere(data: unknown, where: string | undefined): string {
  if (!where || !isObj(data)) return "";
  const segs = where.split("/").slice(1);
  const parts: string[] = [];
  let node: unknown = data;
  for (let i = 0; i < segs.length; i++) {
    const seg = unpointer(segs[i]);
    const parent = node;
    node = Array.isArray(parent) ? parent[Number(seg)] : isObj(parent) ? parent[seg] : undefined;
    const prevKey = i > 0 ? unpointer(segs[i - 1]) : "";
    if (Array.isArray(parent) && isObj(node)) {
      // Display names; sets files also carry asset paths (`formation`, `base`, `from`), which are skipped.
      const label = (v: unknown) => (typeof v === "string" && v && !v.includes("/") ? v : undefined);
      const nm = label(node.formation) ?? label(node.set) ?? label(node.play) ?? label(node.name) ?? label(node.new);
      if (nm) parts.push(nm);
      else if (prevKey === "steps") parts.push(`step ${Number(seg) + 1}${typeof node.type === "string" ? ` ${node.type}` : ""}`);
      else if (prevKey === "reads") parts.push(`read ${Number(seg) + 1}`);
      else if (prevKey === "waypoints") parts.push(`waypoint ${Number(seg) + 1}`);
      else if (prevKey === "positions" && isNum(node.slot)) parts.push(`slot ${node.slot}`);
      else parts.push(`#${Number(seg) + 1}`);
    } else if (prevKey === "players") parts.push(`slot ${seg}`);
    else if (prevKey === "movements") parts.push(seg);
    else if (prevKey === "tags") parts.push(seg.split("/").slice(-2).join("/"));
    if (node === undefined) break;
  }
  return parts.join(" › ");
}
