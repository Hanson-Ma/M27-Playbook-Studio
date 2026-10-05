// Stable JSON formatting + canonical key order for the files the app writes (ARCHITECTURE.md "JSON").
//
// Output is meant to be git-diffable and to look hand-written: containers stay on one line while they fit the
// width, otherwise one member per line. Canonicalization only reorders keys; it never drops or invents any, so
// unknown keys (the game-side tools' or a future version's) survive every save.
import { SITUATION_ORDER } from "./situations";
import type { ConceptsDoc, DocKind, PlaybookSpec, PlaysFile, SetsFile } from "./types";

type Obj = Record<string, unknown>;

/** JSON.parse that tolerates a leading BOM (files edited on Windows). */
export function parseJson<T = unknown>(text: string): T {
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as T;
}

// ───────────────────────────── formatting ─────────────────────────────

const INDENT = "  ";

/** Mirrors JSON.stringify's value conversion: toJSON, boxed primitives, and which values vanish. */
function toJsonValue(value: unknown, key: string): unknown {
  if (value !== null && typeof value === "object" && typeof (value as { toJSON?: unknown }).toJSON === "function") {
    value = (value as { toJSON(k: string): unknown }).toJSON(key);
  }
  if (value instanceof Number || value instanceof String || value instanceof Boolean) value = value.valueOf();
  return value;
}

/** True for values JSON.stringify omits from objects (and turns into null inside arrays). */
function isSkipped(v: unknown): boolean {
  return v === undefined || typeof v === "function" || typeof v === "symbol";
}

function scalar(v: unknown): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "string":
      return JSON.stringify(v);
    case "number":
      return JSON.stringify(v); // NaN/Infinity → "null", -0 → "0", like JSON.stringify
    case "boolean":
      return v ? "true" : "false";
    case "bigint":
      throw new TypeError("Do not know how to serialize a BigInt");
    default:
      return "null";
  }
}

function entriesOf(v: Obj): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (const k of Object.keys(v)) {
    const val = toJsonValue(v[k], k);
    if (!isSkipped(val)) out.push([k, val]);
  }
  return out;
}

function itemsOf(v: unknown[]): unknown[] {
  return Array.from(v, (x, i) => {
    const val = toJsonValue(x, String(i));
    return isSkipped(val) ? null : val;
  });
}

/**
 * The one-line form of `v`, or undefined as soon as it would exceed `budget` characters. The early exit keeps
 * formatting linear-ish: big containers give up after ~width characters instead of rendering the whole subtree.
 */
function inline(v: unknown, budget: number): string | undefined {
  if (budget < 0) return undefined;
  if (v === null || typeof v !== "object") {
    const s = scalar(v);
    return s.length <= budget ? s : undefined;
  }
  if (Array.isArray(v)) {
    const items = itemsOf(v);
    if (items.length === 0) return budget >= 2 ? "[]" : undefined;
    let s = "[";
    for (let i = 0; i < items.length; i++) {
      if (i > 0) s += ", ";
      const part = inline(items[i], budget - s.length - 1);
      if (part === undefined) return undefined;
      s += part;
    }
    s += "]";
    return s.length <= budget ? s : undefined;
  }
  const entries = entriesOf(v as Obj);
  if (entries.length === 0) return budget >= 2 ? "{}" : undefined;
  let s = "{ ";
  for (let i = 0; i < entries.length; i++) {
    if (i > 0) s += ", ";
    s += JSON.stringify(entries[i][0]) + ": ";
    const part = inline(entries[i][1], budget - s.length - 2);
    if (part === undefined) return undefined;
    s += part;
  }
  s += " }";
  return s.length <= budget ? s : undefined;
}

/** Format `v` whose first line starts after `lead` characters and whose last line is followed by `tail` chars. */
function block(v: unknown, indent: string, lead: number, tail: number, width: number): string {
  const one = inline(v, width - lead - tail);
  if (one !== undefined) return one;
  // Only non-empty containers can fail to fit… or a single long scalar, which has no line break to offer.
  if (v === null || typeof v !== "object") return scalar(v);
  const inner = indent + INDENT;
  if (Array.isArray(v)) {
    const items = itemsOf(v);
    const lines = items.map(
      (item, i) => inner + block(item, inner, inner.length, i < items.length - 1 ? 1 : 0, width),
    );
    return `[\n${lines.join(",\n")}\n${indent}]`;
  }
  const entries = entriesOf(v as Obj);
  const lines = entries.map(([k, val], i) => {
    const head = `${inner}${JSON.stringify(k)}: `;
    return head + block(val, inner, head.length, i < entries.length - 1 ? 1 : 0, width);
  });
  return `{\n${lines.join(",\n")}\n${indent}}`;
}

/**
 * Stable pretty printer: a container prints on one line when it fits in `width` columns
 * (`{ "play": "Inside Zone", "audible": 2 }`, `[1, 2]`), otherwise one member per line with 2-space indent.
 * Keys keep insertion order (canonicalize first). Always ends with a newline. Parses back to exactly what
 * JSON.parse(JSON.stringify(value)) would give.
 */
export function formatJson(value: unknown, opts: { width?: number } = {}): string {
  const width = opts.width ?? 110;
  const v = toJsonValue(value, "");
  return (isSkipped(v) ? "null" : block(v, "", 0, 0, width)) + "\n";
}

// ───────────────────────────── canonical key order ─────────────────────────────

function isObj(v: unknown): v is Obj {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Plain assignment would turn an own "__proto__" key (legal JSON) into a prototype change. */
function put(out: Obj, key: string, value: unknown): void {
  if (key === "__proto__") Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
  else out[key] = value;
}

type Fix = (v: unknown) => unknown;

/**
 * Copy `obj` with keys ordered: `head` (in that order, when present), then every other key in its original
 * order, then `tail`. `fix` transforms the values of specific keys (nested canonicalization).
 */
function order(obj: Obj, head: readonly string[], tail: readonly string[] = [], fix: Record<string, Fix> = {}): Obj {
  const out: Obj = {};
  const known = new Set([...head, ...tail]);
  const has = (k: string) => Object.prototype.hasOwnProperty.call(obj, k);
  const val = (k: string) => (Object.prototype.hasOwnProperty.call(fix, k) ? fix[k](obj[k]) : obj[k]);
  for (const k of head) if (has(k)) put(out, k, val(k));
  for (const k of Object.keys(obj)) if (!known.has(k)) put(out, k, val(k));
  for (const k of tail) if (has(k)) put(out, k, val(k));
  return out;
}

/** Apply `fn` to every object element of an array; anything else passes through untouched. */
const eachObj =
  (fn: (o: Obj) => Obj): Fix =>
  (v) =>
    Array.isArray(v) ? v.map((x) => (isObj(x) ? fn(x) : x)) : v;

/** Apply `fn` to every value of an object map (keys keep their order). */
const eachValue =
  (fn: Fix): Fix =>
  (v) => {
    if (!isObj(v)) return v;
    const out: Obj = {};
    for (const k of Object.keys(v)) put(out, k, fn(v[k]));
    return out;
  };

/** Copy of a string-keyed map with keys sorted (code-unit order), so edit order never shows up in diffs. */
const sortedKeys: Fix = (v) => {
  if (!isObj(v)) return v;
  const out: Obj = {};
  for (const k of Object.keys(v).sort()) put(out, k, v[k]);
  return out;
};

// Playbook (FORMATS.md §2)
const cpuWeights: Fix = (v) => (isObj(v) ? order(v, SITUATION_ORDER) : v);
const playEntry = (o: Obj) => order(o, ["play", "audible", "cpu"], [], { cpu: cpuWeights });
const setEntry = (o: Obj) => order(o, ["set", "plays"], [], { plays: eachObj(playEntry) });
const formationEntry = (o: Obj) => order(o, ["formation", "sets"], [], { sets: eachObj(setEntry) });

// Custom plays (FORMATS.md §3). Step objects keep their own key order (and so do reads, whose documented order
// differs between §1 and §3).
const newAssignment = (o: Obj) => order(o, ["new", "routeType", "template", "keep", "steps"]);
const playerSpec: Fix = (v) => (isObj(v) ? newAssignment(v) : v);
const customPlay = (o: Obj) =>
  order(o, ["name", "asset", "base", "playType", "blocking", "runHole", "vip", "players", "reads"], [], {
    players: eachValue(playerSpec),
  });

// Custom sets (FORMATS.md §5)
const slotPosition = (o: Obj) => order(o, ["slot", "x", "y", "stance", "facing"]);
const clonedPlay = (o: Obj) => order(o, ["from", "name", "asset"]);
const customSet = (o: Obj) =>
  order(o, ["name", "asset", "base", "formation", "positions", "movements", "plays"], [], {
    positions: eachObj(slotPosition),
    movements: eachValue(eachObj(slotPosition)),
    plays: eachObj(clonedPlay),
  });
const customFormation = (o: Obj) => order(o, ["name", "asset", "base"]);

// Concepts (app-data/concepts.json)
const category = (o: Obj) => order(o, ["id", "name", "group", "color", "parent"]);

/**
 * Playbook spec: name, side, notes, then unknown top-level keys, then `formations` last.
 * FormationEntry: formation, sets, unknown · SetEntry: set, plays, unknown · PlayEntry: play, audible, cpu, unknown
 * · cpu keys in SITUATION_ORDER, unknown keys after.
 */
export function canonicalPlaybook(spec: PlaybookSpec): PlaybookSpec {
  if (!isObj(spec)) return spec;
  return order(spec, ["name", "side", "notes"], ["formations"], { formations: eachObj(formationEntry) }) as PlaybookSpec;
}

/**
 * Plays file: unknown top-level keys (title, version, description, notes, bundles, brtRef…) first, `plays` last.
 * CustomPlaySpec: name, asset, base, playType, blocking, runHole, vip, players, reads, unknown.
 * NewAssignmentSpec: new, routeType, template, keep, steps, unknown. Steps and reads are not reordered.
 */
export function canonicalPlaysFile(f: PlaysFile): PlaysFile {
  if (!isObj(f)) return f;
  return order(f, [], ["plays"], { plays: eachObj(customPlay) }) as PlaysFile;
}

/**
 * Sets file: unknown top-level keys first, then `sets`, then `formations` (FORMATS.md §5 order).
 * CustomSetSpec: name, asset, base, formation, positions, movements, plays, unknown. SlotPosition: slot, x, y,
 * stance, facing, unknown. Cloned play: from, name, asset, unknown. CustomFormationSpec: name, asset, base, unknown.
 */
export function canonicalSetsFile(f: SetsFile): SetsFile {
  if (!isObj(f)) return f;
  return order(f, [], ["sets", "formations"], {
    sets: eachObj(customSet),
    formations: eachObj(customFormation),
  }) as SetsFile;
}

/**
 * Concepts doc: version, unknown top-level keys, then categories, tags, notes.
 * ConceptCategory: id, name, group, color, parent, unknown. `tags` and `notes` (PlayKey maps) are sorted by key.
 */
export function canonicalConcepts(d: ConceptsDoc): ConceptsDoc {
  if (!isObj(d)) return d;
  return order(d, ["version"], ["categories", "tags", "notes", "dismissed"], {
    categories: eachObj(category),
    tags: sortedKeys,
    notes: sortedKeys,
    dismissed: sortedKeys,
  }) as ConceptsDoc;
}

/** The exact text the app writes for a document: canonical key order + formatJson. */
export function serializeDoc(kind: DocKind, data: unknown): string {
  switch (kind) {
    case "playbook":
      return formatJson(canonicalPlaybook(data as PlaybookSpec));
    case "plays":
      return formatJson(canonicalPlaysFile(data as PlaysFile));
    case "sets":
      return formatJson(canonicalSetsFile(data as SetsFile));
    case "concepts":
      return formatJson(canonicalConcepts(data as ConceptsDoc));
    default:
      return formatJson(data);
  }
}
