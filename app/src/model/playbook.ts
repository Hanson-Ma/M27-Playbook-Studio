// Playbook builder operations (FORMATS.md §2) on PlaybookSpec drafts (immer) or plain objects.
// Every op edits entries in place or moves whole entry objects, so unknown keys always survive; inserted entries are
// deep clones. Name resolution and validation live in resolveBook.ts / playbookOps.ts.
import { assignAudible } from "./playbookOps";
import { maddenName, norm, sanitizeBookName } from "./names";
import { SITUATION_GROUPS, SITUATION_LABELS, isSituationKey, type SituationKey } from "./situations";
import type { TemplateConversion, TemplateFormationConversion } from "./tdb";
import type { AudibleSlot, FormationEntry, PlayEntry, PlaybookSpec, SetEntry, Side } from "./types";

// ───────────────────────────── refs ─────────────────────────────

/** Address of an entry: formation index, optional set index, optional play index. */
export interface EntryRef {
  f: number;
  s?: number;
  p?: number;
}

export type EntryLevel = "formation" | "set" | "play";

export function refLevel(r: EntryRef): EntryLevel {
  return r.p !== undefined ? "play" : r.s !== undefined ? "set" : "formation";
}

export function sameRef(a: EntryRef | undefined, b: EntryRef | undefined): boolean {
  return !!a && !!b && a.f === b.f && a.s === b.s && a.p === b.p;
}

/** ValidationIssue.where ("/formations/0/sets/1/plays/3") → ref; undefined for book-level issues. */
export function parseWhere(where: string | undefined): EntryRef | undefined {
  const m = /^\/formations\/(\d+)(?:\/sets\/(\d+)(?:\/plays\/(\d+))?)?$/.exec(where ?? "");
  if (!m) return undefined;
  const ref: EntryRef = { f: Number(m[1]) };
  if (m[2] !== undefined) ref.s = Number(m[2]);
  if (m[3] !== undefined) ref.p = Number(m[3]);
  return ref;
}

export function whereOf(r: EntryRef): string {
  return `/formations/${r.f}` + (r.s === undefined ? "" : `/sets/${r.s}`) + (r.p === undefined ? "" : `/plays/${r.p}`);
}

/** Explicit sets of a formation entry ([] for "template" or malformed entries). */
export function setsOf(fe: FormationEntry | undefined): SetEntry[] {
  return fe && Array.isArray(fe.sets) ? fe.sets : [];
}

export function isTemplate(fe: FormationEntry | undefined): boolean {
  return fe?.sets === "template";
}

export function getFormation(spec: PlaybookSpec, f: number): FormationEntry | undefined {
  return (spec.formations ?? [])[f];
}

export function getSet(spec: PlaybookSpec, f: number, s: number): SetEntry | undefined {
  return setsOf(getFormation(spec, f))[s];
}

export function getPlay(spec: PlaybookSpec, f: number, s: number, p: number): PlayEntry | undefined {
  return (getSet(spec, f, s)?.plays ?? [])[p];
}

/** The entry a ref points at, if it exists. */
export function entryAt(spec: PlaybookSpec, r: EntryRef): FormationEntry | SetEntry | PlayEntry | undefined {
  if (r.p !== undefined) return r.s === undefined ? undefined : getPlay(spec, r.f, r.s, r.p);
  if (r.s !== undefined) return getSet(spec, r.f, r.s);
  return getFormation(spec, r.f);
}

// ───────────────────────────── stable ids ─────────────────────────────

/**
 * Stable React ids: an entry's id is the path of normalized names with an occurrence counter
 * ("F:shotgun#0/S:y trips wk#0/P:inside zone#0"), so ids follow entries through reorders, undo/redo and edits that
 * don't rename them, and duplicates stay distinct.
 */
export interface BookIds {
  formations: { id: string; sets: { id: string; plays: string[] }[] }[];
  /** id → ref */
  refs: Map<string, EntryRef>;
}

const idsCache = new WeakMap<object, BookIds>();

function counted(prefix: string, name: unknown, seen: Map<string, number>): string {
  // "/" separates id segments, so it's escaped inside names.
  const key = norm(String(name ?? "")).replace(/%/g, "%25").replace(/\//g, "%2F");
  const n = seen.get(key) ?? 0;
  seen.set(key, n + 1);
  return `${prefix}${key}#${n}`;
}

export function bookIds(spec: PlaybookSpec): BookIds {
  const hit = idsCache.get(spec);
  if (hit) return hit;
  const refs = new Map<string, EntryRef>();
  const fSeen = new Map<string, number>();
  // Hand-edited JSON can hold anything: only arrays are walked (wrong shapes are reported by resolvePlaybook).
  const formations = (Array.isArray(spec?.formations) ? spec.formations : []).map((fe, f) => {
    const fid = counted("F:", fe?.formation, fSeen);
    refs.set(fid, { f });
    const sSeen = new Map<string, number>();
    const sets = setsOf(fe).map((se, s) => {
      const sid = counted(`${fid}/S:`, se?.set, sSeen);
      refs.set(sid, { f, s });
      const pSeen = new Map<string, number>();
      const plays = (Array.isArray(se?.plays) ? se.plays : []).map((pe, p) => {
        const pid = counted(`${sid}/P:`, pe?.play, pSeen);
        refs.set(pid, { f, s, p });
        return pid;
      });
      return { id: sid, plays };
    });
    return { id: fid, sets };
  });
  const out = { formations, refs };
  if (spec && typeof spec === "object") idsCache.set(spec, out);
  return out;
}

export function idOf(ids: BookIds, r: EntryRef): string | undefined {
  const f = ids.formations[r.f];
  if (!f) return undefined;
  if (r.s === undefined) return f.id;
  const s = f.sets[r.s];
  if (!s) return undefined;
  if (r.p === undefined) return s.id;
  return s.plays[r.p];
}

// ───────────────────────────── cloning ─────────────────────────────

/** Deep clone of JSON-like data; works on immer drafts (proxies) too. */
export function deepClone<T>(v: T): T {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => deepClone(x)) as T;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v as object)) out[k] = deepClone((v as Record<string, unknown>)[k]);
  return out as T;
}

// ───────────────────────────── moves ─────────────────────────────

export type DropWhere = "before" | "after";

/**
 * Move the items at `from` (any order, duplicates ignored) as one block before/after the item at `target`, keeping
 * their relative order. Mutates `list` (works on drafts). Returns the new indices of the moved items (ascending).
 * Dropping a block onto one of its own members leaves the list as is.
 */
export function moveBlock<T>(list: T[], from: number[], target: number, where: DropWhere): number[] {
  const idx = [...new Set(from)].filter((i) => i >= 0 && i < list.length).sort((a, b) => a - b);
  if (!idx.length || target < 0 || target >= list.length) return idx;
  if (idx.includes(target)) {
    // Contiguous block dropped on itself: no-op. Non-contiguous: gather around the target.
    const contiguous = idx[idx.length - 1] - idx[0] === idx.length - 1;
    if (contiguous) return idx;
  }
  const moving = idx.map((i) => list[i]);
  const targetItem = list[target];
  const picked = new Set(idx);
  const rest = list.filter((_, i) => !picked.has(i));
  let at: number;
  if (picked.has(target)) {
    // Target is part of the block: insert where the target's first block member was.
    at = rest.length;
    for (let i = 0, kept = 0; i < list.length; i++) {
      if (!picked.has(i)) kept++;
      else if (i === target) {
        at = kept;
        break;
      }
    }
  } else {
    const t = rest.indexOf(targetItem);
    at = where === "before" ? t : t + 1;
  }
  const next = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
  list.splice(0, list.length, ...next);
  return moving.map((_, k) => at + k);
}

/** Reorder formations. Returns the moved formations' new indices. */
export function moveFormations(spec: PlaybookSpec, from: number[], target: number, where: DropWhere): number[] {
  spec.formations ??= [];
  return moveBlock(spec.formations, from, target, where);
}

/** Reorder sets inside one formation (sets never move between formations). */
export function moveSets(spec: PlaybookSpec, f: number, from: number[], target: number, where: DropWhere): number[] {
  const fe = getFormation(spec, f);
  if (!fe || !Array.isArray(fe.sets)) return [];
  return moveBlock(fe.sets, from, target, where);
}

/** Reorder plays inside one set (a play belongs to its set). */
export function movePlays(spec: PlaybookSpec, f: number, s: number, from: number[], target: number, where: DropWhere): number[] {
  const se = getSet(spec, f, s);
  if (!se) return [];
  se.plays ??= [];
  return moveBlock(se.plays, from, target, where);
}

// ───────────────────────────── insert / remove / duplicate ─────────────────────────────

function clampAt(at: number, len: number): number {
  return Math.max(0, Math.min(len, Number.isFinite(at) ? Math.trunc(at) : len));
}

/** Index where new (non-template) formations go: before the first "template" section, else the end. */
export function formationInsertIndex(spec: PlaybookSpec): number {
  const list = spec.formations ?? [];
  const t = list.findIndex((fe) => fe?.sets === "template");
  return t < 0 ? list.length : t;
}

/** Insert deep clones of formation entries at `at` (default: before the template sections). Returns their indices. */
export function insertFormations(spec: PlaybookSpec, entries: FormationEntry[], at = formationInsertIndex(spec)): number[] {
  spec.formations ??= [];
  const i = clampAt(at, spec.formations.length);
  spec.formations.splice(i, 0, ...entries.map((e) => deepClone(e)));
  return entries.map((_, k) => i + k);
}

/** Insert deep clones of set entries into formation `f` (default: the end). Throws for template formations. */
export function insertSets(spec: PlaybookSpec, f: number, entries: SetEntry[], at?: number): number[] {
  const fe = getFormation(spec, f);
  if (!fe) throw new Error(`No formation ${f}`);
  if (!Array.isArray(fe.sets)) throw new Error(`${maddenName(String(fe.formation))} is a template section — convert it to explicit sets first`);
  const i = clampAt(at ?? fe.sets.length, fe.sets.length);
  fe.sets.splice(i, 0, ...entries.map((e) => deepClone(e)));
  return entries.map((_, k) => i + k);
}

/**
 * Insert deep clones of play entries into set (f, s) (default: the end). An `audible` slot already used in the set
 * (or used twice in `entries`) is dropped from the incoming entry. Returns the new indices.
 */
export function insertPlays(spec: PlaybookSpec, f: number, s: number, entries: PlayEntry[], at?: number): number[] {
  const se = getSet(spec, f, s);
  if (!se) throw new Error(`No set ${f}/${s}`);
  se.plays ??= [];
  const used = new Set(se.plays.map((e) => e.audible).filter((a) => a !== undefined));
  const clones = entries.map((e) => {
    const c = deepClone(e);
    if (c.audible !== undefined) {
      if (used.has(c.audible)) delete c.audible;
      else used.add(c.audible);
    }
    return c;
  });
  const i = clampAt(at ?? se.plays.length, se.plays.length);
  se.plays.splice(i, 0, ...clones);
  return clones.map((_, k) => i + k);
}

/** Add a formation entry (`sets: []`) before the template sections. Returns its index. */
export function addFormation(spec: PlaybookSpec, name: string, at?: number): number {
  return insertFormations(spec, [{ formation: name, sets: [] }], at)[0];
}

/** Add a set entry (`plays: []`) to formation `f`. Returns its index. */
export function addSet(spec: PlaybookSpec, f: number, name: string, at?: number): number {
  return insertSets(spec, f, [{ set: name, plays: [] }], at)[0];
}

/** Descending document order (later entries first; children before their parent). */
function cmpRefDesc(a: EntryRef, b: EntryRef): number {
  const ka = [a.f, a.s ?? -1, a.p ?? -1];
  const kb = [b.f, b.s ?? -1, b.p ?? -1];
  for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
  return 0;
}

function sortRefsDesc(refs: EntryRef[]): EntryRef[] {
  return [...refs].sort(cmpRefDesc);
}

/** Drop refs nested under another ref in the list (removing a set already removes its plays). */
export function topLevelRefs(refs: EntryRef[]): EntryRef[] {
  const covers = (a: EntryRef, b: EntryRef) =>
    a !== b &&
    a.f === b.f &&
    ((a.s === undefined && b.s !== undefined) || (a.s !== undefined && a.s === b.s && a.p === undefined && b.p !== undefined));
  const unique = refs.filter((r, i) => refs.findIndex((q) => sameRef(q, r)) === i);
  return unique.filter((r) => !unique.some((q) => covers(q, r)));
}

/** Remove entries (formations, sets, plays in any mix). Returns how many entries were removed. */
export function removeRefs(spec: PlaybookSpec, refs: EntryRef[]): number {
  let n = 0;
  for (const r of sortRefsDesc(topLevelRefs(refs))) {
    if (r.p !== undefined && r.s !== undefined) {
      const se = getSet(spec, r.f, r.s);
      if (se?.plays && r.p < se.plays.length) {
        se.plays.splice(r.p, 1);
        n++;
      }
    } else if (r.s !== undefined) {
      const fe = getFormation(spec, r.f);
      if (fe && Array.isArray(fe.sets) && r.s < fe.sets.length) {
        fe.sets.splice(r.s, 1);
        n++;
      }
    } else if (spec.formations && r.f < spec.formations.length) {
      spec.formations.splice(r.f, 1);
      n++;
    }
  }
  return n;
}

/**
 * Duplicate entries: each clone (deep, unknown keys kept) goes right after the last selected sibling of its group.
 * Play clones drop `audible` (one play per slot). Returns the clones' refs in the edited spec.
 */
export function duplicateRefs(spec: PlaybookSpec, refs: EntryRef[]): EntryRef[] {
  const top = topLevelRefs(refs);
  const level = (r: EntryRef) => refLevel(r);
  const out: EntryRef[] = [];
  // Group by parent so a multi-selection duplicates as one block after its last member.
  const groups = new Map<string, EntryRef[]>();
  for (const r of top) {
    const k = level(r) === "formation" ? "F" : level(r) === "set" ? `S${r.f}` : `P${r.f}/${r.s}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  // Apply later groups first so earlier indices stay valid; shift refs produced earlier when an insert lands before them.
  const ordered = [...groups.values()].sort((a, b) => cmpRefDesc(sortRefsDesc(a)[0], sortRefsDesc(b)[0]));
  for (const g of ordered) {
    const sorted = [...g].sort((a, b) => -cmpRefDesc(a, b));
    const last = sorted[sorted.length - 1];
    const lvl = level(last);
    if (lvl === "formation") {
      const clones = sorted.map((r) => getFormation(spec, r.f)).filter((e): e is FormationEntry => !!e);
      const idx = insertFormations(spec, clones, last.f + 1);
      for (const o of out) if (o.f >= last.f + 1) o.f += clones.length;
      out.push(...idx.map((f) => ({ f })));
    } else if (lvl === "set") {
      const fe = getFormation(spec, last.f);
      if (!fe || !Array.isArray(fe.sets)) continue;
      const sets = fe.sets;
      const clones = sorted.map((r) => sets[r.s!]).filter((e): e is SetEntry => !!e);
      const idx = insertSets(spec, last.f, clones, last.s! + 1);
      for (const o of out) if (o.f === last.f && o.s !== undefined && o.s >= last.s! + 1) o.s += clones.length;
      out.push(...idx.map((s) => ({ f: last.f, s })));
    } else {
      const se = getSet(spec, last.f, last.s!);
      if (!se) continue;
      const clones = sorted
        .map((r) => se.plays[r.p!])
        .filter(Boolean)
        .map((e) => {
          const c = deepClone(e);
          delete c.audible;
          return c;
        });
      const idx = insertPlays(spec, last.f, last.s!, clones, last.p! + 1);
      out.push(...idx.map((p) => ({ f: last.f, s: last.s, p })));
    }
  }
  return out;
}

// ───────────────────────────── plays in a set ─────────────────────────────

/**
 * Where a newly checked play goes so the set "keeps order": when the set's current plays follow `order` (the set's
 * available plays, e.g. catalog.playsInSet names), insert at the matching position; otherwise append.
 */
export function insertionIndex(current: readonly string[], order: readonly string[], name: string): number {
  const pos = new Map<string, number>();
  order.forEach((n, i) => {
    const k = norm(n);
    if (!pos.has(k)) pos.set(k, i);
  });
  const mine = pos.get(norm(name));
  if (mine === undefined) return current.length;
  const ranks = current.map((n) => pos.get(norm(n)));
  const sorted = ranks.every((r, i) => r !== undefined && (i === 0 || (ranks[i - 1] as number) <= r));
  if (!sorted) return current.length;
  const i = ranks.findIndex((r) => (r as number) > mine);
  return i < 0 ? current.length : i;
}

/**
 * Check/uncheck a play (by display name) in a set. Checking adds `{ play: name }` (see insertionIndex); unchecking
 * removes every entry with that name. Returns the affected index (added, or first removed), or -1 when unchanged.
 */
export function togglePlay(set: SetEntry, name: string, on: boolean, order: readonly string[] = []): number {
  set.plays ??= [];
  const key = norm(name);
  const at = set.plays.findIndex((e) => norm(String(e.play ?? "")) === key);
  if (on) {
    if (at >= 0) return -1;
    const i = insertionIndex(
      set.plays.map((e) => String(e.play ?? "")),
      order,
      name,
    );
    set.plays.splice(i, 0, { play: name });
    return i;
  }
  if (at < 0) return -1;
  for (let i = set.plays.length - 1; i >= at; i--) if (norm(String(set.plays[i].play ?? "")) === key) set.plays.splice(i, 1);
  return at;
}

// ───────────────────────────── audibles / CPU weights ─────────────────────────────

/** One play per slot in a set: gives `slot` to play `p` (clearing it elsewhere), or clears p's audible. */
export function setAudible(set: SetEntry, p: number, slot: AudibleSlot | undefined): void {
  if (!set.plays?.[p]) return;
  assignAudible(set, p, slot);
}

/** Next audible in the cycle — → 1 → 2 → 3 → 4 → —. */
export function nextAudible(slot: AudibleSlot | undefined): AudibleSlot | undefined {
  if (slot === undefined) return 1;
  return slot >= 4 ? undefined : ((slot + 1) as AudibleSlot);
}

/** Weights are whole numbers 0–100. */
export function clampWeight(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** Set one situation weight; `undefined` removes the key (and an emptied `cpu` object). */
export function setCpuWeight(e: PlayEntry, key: string, value: number | undefined): void {
  if (value === undefined) {
    if (e.cpu && key in e.cpu) {
      delete e.cpu[key];
      if (Object.keys(e.cpu).length === 0) delete e.cpu;
    }
    return;
  }
  if (!e.cpu || typeof e.cpu !== "object" || Array.isArray(e.cpu)) e.cpu = {};
  e.cpu[key] = clampWeight(value);
}

/** Replace all weights (paste) or clear them (`undefined` / empty). */
export function setCpuWeights(e: PlayEntry, cpu: Record<string, number> | undefined): void {
  const entries = Object.entries(cpu ?? {}).filter(([, v]) => typeof v === "number" && Number.isFinite(v));
  if (!entries.length) {
    delete e.cpu;
    return;
  }
  e.cpu = Object.fromEntries(entries.map(([k, v]) => [k, clampWeight(v)]));
}

/** A play entry's weights as a plain record ({} when none or malformed). */
export function cpuOf(e: PlayEntry | undefined): Record<string, number> {
  const c = e?.cpu;
  if (!c || typeof c !== "object" || Array.isArray(c)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(c)) if (typeof v === "number") out[k] = v;
  return out;
}

// ───────────────────────────── template sections ─────────────────────────────

/**
 * Replace formation `f`'s `"template"` with explicit sets (from tdb.ts templateFormationToEntry). The formation
 * entry object is kept (unknown keys survive); only `sets` changes. Pass the catalog-checked conversion
 * (`templateFormationToEntry(tf, catalog)`) so a formation tools/pbook-build.mjs can't address explicitly (offense
 * "Special") is refused — it throws with the conversion's `problem`. Plays in `skipped` are not written (tell the user).
 */
export function convertTemplateFormation(spec: PlaybookSpec, f: number, explicit: FormationEntry | TemplateFormationConversion): void {
  const fe = getFormation(spec, f);
  if (!fe) throw new Error(`No formation ${f}`);
  if (fe.sets !== "template") throw new Error(`${maddenName(String(fe.formation))} is not a template section`);
  let entry: FormationEntry;
  if (isConversion(explicit)) {
    if (explicit.problem) throw new Error(explicit.problem);
    entry = explicit.entry;
  } else entry = explicit;
  fe.sets = deepClone(Array.isArray(entry.sets) ? entry.sets : []);
}

function isConversion(v: FormationEntry | TemplateFormationConversion): v is TemplateFormationConversion {
  const o = v as Partial<TemplateFormationConversion> & { formation?: unknown };
  return typeof o.formation !== "string" && !!o.entry && Array.isArray(o.skipped);
}

/**
 * Special-teams formations a new / stock playbook keeps as `"template"` sections (punt, field goal, kickoffs come from
 * the template save). Local on purpose: validation no longer has a "special teams missing" rule, but new books still
 * start with these sections.
 */
const SPECIAL_TEAMS_FORMATIONS = ["Special", "Kickoff", "Safety Kickoff"] as const;
const RECOMMENDED_FORMATIONS = ["Goal Line Offense"] as const;

/** Formations a new playbook starts with, as `"template"` sections (special teams + goal line). */
export const DEFAULT_TEMPLATE_FORMATIONS: string[] = [...RECOMMENDED_FORMATIONS, ...SPECIAL_TEAMS_FORMATIONS];

/** A new empty playbook: name sanitized (A–Z0–9), offense, the default template sections. */
export function newPlaybookSpec(name: string, side: Side = "offense"): PlaybookSpec {
  return {
    name: sanitizeBookName(name),
    side,
    formations: side === "offense" ? DEFAULT_TEMPLATE_FORMATIONS.map((formation) => ({ formation, sets: "template" as const })) : [],
  };
}

/**
 * "New from stock template": every template formation as explicit entries, except the special-teams sections,
 * which stay `"template"` (the game-side builder copies them from the same save). Pass the catalog-checked
 * conversion (`templateToSpecEntries(contents, catalog)`) so plays tools/pbook-build.mjs can't find by name are left
 * out instead of silently swapped (show its `skipped` list); a plain FormationEntry[] is still accepted.
 */
export function stockTemplateSpec(name: string, explicit: FormationEntry[] | TemplateConversion): PlaybookSpec {
  const list = Array.isArray(explicit) ? explicit : explicit.entries;
  const special = new Set(SPECIAL_TEAMS_FORMATIONS.map((n) => norm(n)));
  const formations = list.map((fe) =>
    special.has(norm(fe.formation)) || fe.sets === "template" ? { formation: fe.formation, sets: "template" as const } : deepClone(fe),
  );
  for (const st of SPECIAL_TEAMS_FORMATIONS)
    if (!formations.some((fe) => norm(fe.formation) === norm(st))) formations.push({ formation: st, sets: "template" });
  return { name: sanitizeBookName(name), side: "offense", formations };
}

/** File path for a playbook name: playbooks/<lowercase name>.json. */
export function playbookPathFor(name: string): string {
  return `playbooks/${sanitizeBookName(name).toLowerCase()}.json`;
}

/**
 * Save file the game side builds for a spec, exactly like tools/export.ps1 `OutName`: PBOOKOFF-/PBOOKDEF- + the name
 * upper-cased (not sanitized — invalid names are reported by validation, not silently fixed here).
 */
export function saveNameFor(spec: Pick<PlaybookSpec, "name" | "side"> | null | undefined): string {
  return `${spec?.side === "defense" ? "PBOOKDEF" : "PBOOKOFF"}-${String(spec?.name ?? "").toUpperCase()}`;
}

/** Unknown keys of an entry (anything the contract doesn't define), for read-only display. */
export function unknownKeys(e: object | undefined, known: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!e) return out;
  for (const k of Object.keys(e)) if (!known.includes(k)) out[k] = (e as Record<string, unknown>)[k];
  return out;
}

export const PLAY_ENTRY_KEYS = ["play", "audible", "cpu"] as const;
export const SET_ENTRY_KEYS = ["set", "plays"] as const;
export const FORMATION_ENTRY_KEYS = ["formation", "sets"] as const;
export const BOOK_KEYS = ["name", "side", "notes", "formations"] as const;

// ───────────────────────────── builder home + CPU editor rows (v2) ─────────────────────────────

/** The book #/playbook opens when nothing was opened before: FUSION. */
export const DEFAULT_PLAYBOOK_PATH = "playbooks/FUSION.json";

/**
 * Which playbook `#/playbook` opens: the last opened one if it still exists, else FUSION, else the first playbook
 * (paths sorted), else undefined (no playbooks at all). Paths compare case-insensitively (the server refuses names that
 * differ only in case); the returned path is the existing one's spelling.
 */
export function defaultPlaybookPath(last: string | undefined, paths: readonly string[]): string | undefined {
  const find = (p: string | undefined) => (p ? paths.find((x) => x.toLowerCase() === p.toLowerCase()) : undefined);
  return find(last) ?? find(DEFAULT_PLAYBOOK_PATH) ?? [...paths].sort()[0];
}

/** Situations the CPU-weights editor always shows; the rest sit behind "Show all situations". */
export const COMMON_CPU_KEYS: readonly SituationKey[] = [
  "FirstDown",
  "2ndAndShort",
  "2ndAndMedium",
  "2ndAndLong",
  "3rdAndShort",
  "3rdAndMedium",
  "3rdAndLong",
  "4thAndShort",
  "RedZone",
  "GoalLine",
];

export interface CpuEditorRow {
  key: string;
  label: string;
  /** A FORMATS.md §2 situation key (unknown keys are kept and shown so they can be cleared). */
  known: boolean;
}

export interface CpuEditorGroup {
  id: string;
  label: string;
  rows: CpuEditorRow[];
  /** How many rows of this group have a weight. */
  set: number;
}

/**
 * Rows for the CPU-weights editor. Simple view (`all` false): the common situations plus every situation that already
 * has a weight (never hide data). `all`: every situation by group. Unknown keys in `cpu` always come last in an
 * "Unknown Keys" group. Empty groups are dropped.
 */
export function cpuEditorGroups(cpu: Record<string, number>, all: boolean): CpuEditorGroup[] {
  const common = new Set<string>(COMMON_CPU_KEYS);
  const groups: CpuEditorGroup[] = SITUATION_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    rows: g.keys.filter((k) => all || common.has(k) || k in cpu).map((k) => ({ key: k, label: SITUATION_LABELS[k], known: true })),
    set: g.keys.filter((k) => k in cpu).length,
  }));
  const unknown = Object.keys(cpu).filter((k) => !isSituationKey(k));
  if (unknown.length) groups.push({ id: "unknown", label: "Unknown Keys", rows: unknown.map((k) => ({ key: k, label: k, known: false })), set: unknown.length });
  return groups.filter((g) => g.rows.length);
}
