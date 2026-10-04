// Read side of EA "DB" (TDB) tables inside a Madden 27 FBCHUNKS playbook save (port of tools/tdb.mjs, see
// research/PHASE0_FINDINGS.md "Custom playbook saves"), plus the template save's contents in library terms.
// Pure TS over Uint8Array/DataView. Never writes saves.
//
// Layout: the FBCHUNKS container holds a TDB database starting at the bytes "DB\0\x08":
//   db+16 u32 table count · db+24 table index (count × { char[4] name, u32 offset }) · u32 CRC · table data.
//   Table header (36 bytes): +4 u32 record bytes, +8 u32 record bits, +16 u16 max records, +18 u16 records used,
//   +20 u16 deleted count, +22 u16 first deleted row, +24 u8 field count, +32 u32 header CRC; then fieldCount ×
//   16-byte field descriptors { u32 type (0 = string), u32 bit offset, char[4] name, u32 bits }; then the records.
//   Fields are little-endian bit-packed (bit 0 = LSB of byte 0). A deleted row has the top bit of its last byte set.
import type { Catalog } from "./catalog";
import type { LibraryIndex } from "./library";
import { AUDIBLE_FLAG_BITS } from "./audibles";
import { nameAddressProblem } from "./playbookOps";
import { formationBookSide } from "./library";
import { bookFormation, type ResolveOptions } from "./resolveBook";
import { SITUATION_BY_ID, SITUATION_ORDER } from "./situations";
import type { AudibleSlot, FormationDef, FormationEntry, PlayDef, PlayEntry, SetDef, SetEntry, Side } from "./types";

export interface TdbField {
  /** 0 = string; other values are integer types. */
  type: number;
  bitOffset: number;
  name: string;
  bits: number;
}

export type TdbRow = Record<string, number | string>;

/** A used row with its deleted flag (`allRows`). */
export interface TdbFlaggedRow {
  [field: string]: number | string | boolean;
  $deleted: boolean;
}

export interface TdbTable {
  name: string;
  /** Offset of the table relative to the data start (from the table index). */
  offset: number;
  /** Absolute byte offset of the table header. */
  start: number;
  recordBytes: number;
  recordBits: number;
  maxRecords: number;
  /** Records in use, including deleted ones. */
  records: number;
  deletedCount: number;
  firstDeleted: number;
  fields: TdbField[];
  /** Absolute byte offset of the first record. */
  dataStart: number;
  /** Live rows in table order (deleted rows skipped). */
  rows: TdbRow[];
  /** Every used row with a `$deleted` flag. */
  allRows: TdbFlaggedRow[];
}

export interface TdbDatabase {
  dbOffset: number;
  tables: TdbTable[];
  table(name: string): TdbTable | undefined;
}

const DB_MAGIC = [0x44, 0x42, 0x00, 0x08]; // "DB\0\x08"

function findMagic(bytes: Uint8Array): number {
  outer: for (let i = 0; i + DB_MAGIC.length <= bytes.length; i++) {
    for (let k = 0; k < DB_MAGIC.length; k++) if (bytes[i + k] !== DB_MAGIC[k]) continue outer;
    return i;
  }
  return -1;
}

function latin1(bytes: Uint8Array, start: number, end: number): string {
  let s = "";
  for (let i = start; i < end && i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** Little-endian bit-packed unsigned integer (≤ 53 bits): bit 0 is the LSB of byte 0 of the record. */
export function readBitsLE(rec: Uint8Array, off: number, bits: number): number {
  let v = 0;
  let mul = 1;
  for (let i = 0; i < bits; i++) {
    const bit = off + i;
    if ((rec[bit >> 3] >> (bit & 7)) & 1) v += mul;
    mul *= 2;
  }
  return v;
}

function readStringField(rec: Uint8Array, f: TdbField): string {
  const s = latin1(rec, f.bitOffset >> 3, (f.bitOffset + f.bits) >> 3);
  const nul = s.indexOf("\0");
  return nul < 0 ? s : s.slice(0, nul);
}

/** Parse every table of the TDB inside a save. Throws on a missing DB header or a truncated file. */
export function readTdb(bytes: Uint8Array): TdbDatabase {
  const db = findMagic(bytes);
  if (db < 0) throw new Error("No TDB database in this file (missing DB header)");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const need = (end: number, what: string) => {
    if (end > bytes.length) throw new Error(`Truncated save: ${what} runs past the end of the file`);
  };
  need(db + 24, "DB header");
  const tableCount = view.getUint32(db + 16, true);
  if (tableCount > 1024) throw new Error(`Implausible TDB table count ${tableCount}`);
  let p = db + 24;
  const index: { name: string; offset: number }[] = [];
  for (let i = 0; i < tableCount; i++, p += 8) {
    need(p + 8, "table index");
    index.push({ name: latin1(bytes, p, p + 4), offset: view.getUint32(p + 4, true) });
  }
  const dataStart = p + 4; // a 4-byte CRC follows the table index

  const tables: TdbTable[] = index.map(({ name, offset }) => {
    const start = dataStart + offset;
    need(start + 36, `${name} header`);
    const recordBytes = view.getUint32(start + 4, true);
    const recordBits = view.getUint32(start + 8, true);
    const maxRecords = view.getUint16(start + 16, true);
    const records = view.getUint16(start + 18, true);
    const deletedCount = view.getUint16(start + 20, true);
    const firstDeleted = view.getUint16(start + 22, true);
    const fieldCount = bytes[start + 24];
    let q = start + 36;
    const fields: TdbField[] = [];
    for (let f = 0; f < fieldCount; f++, q += 16) {
      need(q + 16, `${name} field descriptors`);
      fields.push({
        type: view.getUint32(q, true),
        bitOffset: view.getUint32(q + 4, true),
        name: latin1(bytes, q + 8, q + 12),
        bits: view.getUint32(q + 12, true),
      });
    }
    const recStart = q;
    need(recStart + records * recordBytes, `${name} records`);
    const rows: TdbRow[] = [];
    const allRows: TdbFlaggedRow[] = [];
    for (let r = 0; r < records; r++) {
      const rec = bytes.subarray(recStart + r * recordBytes, recStart + (r + 1) * recordBytes);
      const row: TdbRow = {};
      for (const f of fields) row[f.name] = f.type === 0 ? readStringField(rec, f) : readBitsLE(rec, f.bitOffset, f.bits);
      const deleted = recordBytes > 0 && (rec[recordBytes - 1] & 0x80) !== 0;
      allRows.push({ ...row, $deleted: deleted });
      if (!deleted) rows.push(row);
    }
    return { name, offset, start, recordBytes, recordBits, maxRecords, records, deletedCount, firstDeleted, fields, dataStart: recStart, rows, allRows };
  });

  const byName = new Map(tables.map((t) => [t.name, t]));
  return { dbOffset: db, tables, table: (n) => byName.get(n) };
}

// ───────────────────────────── template save → library terms ─────────────────────────────

export interface TemplatePlay {
  play: PlayDef;
  /**
   * The stock save files this play under a set other than its own library set (e.g. Hail Mary Trio lists Spread's
   * "Goal Post"). The game copies it by id, but a spec can't address it by name in this set.
   */
  foreign?: boolean;
  audible?: AudibleSlot;
  /** Situation key → weight (SITUATION_ORDER). */
  cpu?: Record<string, number>;
}

export interface TemplateSet {
  set: SetDef;
  plays: TemplatePlay[];
}

export interface TemplateFormation {
  formation: FormationDef;
  sets: TemplateSet[];
}

/** Rows of one save table group (STID sets, PGPL plays, PBAI CPU-weight rows). */
export interface TemplateSectionRows {
  sets: number;
  plays: number;
  cpuRows: number;
}

/** Table capacities of a save (maxRecords — what tools/tdb.mjs writeTable enforces). */
export interface SaveCapacity {
  formations: number;
  sets: number;
  plays: number;
  cpuRows: number;
}

export interface TemplateContents {
  formations: TemplateFormation[];
  /**
   * Live PGFM formIds in table order (raw, library-unknown ids included). tools/pbook-build.mjs prefers a formation the
   * template contains when several share a name (`T.PGFM.rows.some(r => r.PBFM === formId)`). Optional only for
   * hand-built contents; templateContents() sets it (resolveBook `templateFormIdsOf` falls back to `formations`).
   */
  formIds?: number[];
  /** Ids the library doesn't know (skipped), e.g. after a game patch. */
  unresolved: string[];
  /** CPU rows whose situation id has no spec key (skipped). */
  unknownSituations: number;
  /**
   * Exactly what tools/pbook-build.mjs copies for a `"sets": "template"` section, by formId: the live STID rows with
   * that PBFM, their PGPL rows and the PBAI rows of those plays (raw rows: ids the library doesn't know count too).
   * A formId without an entry copies nothing. Optional only for hand-built contents; templateContents() sets it.
   */
  sections?: Map<number, TemplateSectionRows>;
  /** Live PBAI rows per play id — an explicit play entry without `cpu` inherits these rows (pbook-build). */
  aiRowsByPlay?: Map<number, number>;
  /** PGFM / STID / PGPL / PBAI maxRecords of the template save (every built save has the same layout). */
  capacity?: SaveCapacity;
}

interface IdMaps {
  formations: Map<number, FormationDef>;
  sets: Map<number, SetDef>;
  plays: Map<number, PlayDef>;
}

const idMapCache = new WeakMap<LibraryIndex, IdMaps>();

function idMaps(lib: LibraryIndex): IdMaps {
  let m = idMapCache.get(lib);
  if (!m) {
    m = { formations: new Map(), sets: new Map(), plays: new Map() };
    for (const f of lib.data.formations) if (!m.formations.has(f.formId)) m.formations.set(f.formId, f);
    for (const s of lib.data.sets) if (!m.sets.has(s.setId)) m.sets.set(s.setId, s);
    for (const p of lib.data.plays) if (!m.plays.has(p.playId)) m.plays.set(p.playId, p);
    idMapCache.set(lib, m);
  }
  return m;
}

const FLAG_TO_SLOT = new Map<number, AudibleSlot>(
  (Object.entries(AUDIBLE_FLAG_BITS) as [string, number][]).map(([slot, bit]) => [bit, Number(slot) as AudibleSlot]),
);

/** Audible slot from a PGPL.Flag value (2/4/16/8 → 1/2/3/4); undefined for 0 or unknown bits. */
export function audibleFromFlag(flag: number): AudibleSlot | undefined {
  return FLAG_TO_SLOT.get(flag);
}

const num = (v: number | string | undefined) => (typeof v === "number" ? v : Number(v ?? NaN));

/**
 * The template save's playbook in library terms: PGFM (formations, table order) → STID (sets per formation, table
 * order) → PGPL (plays per set by `ord_`), PGPL.Flag → audible slot, PBAI (PLYL, AIGR, prct) → CPU weights.
 * Accepts the raw save bytes or an already-parsed database.
 */
export function templateContents(input: Uint8Array | TdbDatabase, lib: LibraryIndex): TemplateContents {
  const db = input instanceof Uint8Array ? readTdb(input) : input;
  const maps = idMaps(lib);
  const PGFM = db.table("PGFM")?.rows ?? [];
  const STID = db.table("STID")?.rows ?? [];
  const PGPL = db.table("PGPL")?.rows ?? [];
  const PBAI = db.table("PBAI")?.rows ?? [];
  const unresolved: string[] = [];
  let unknownSituations = 0;

  const aiRowsByPlay = new Map<number, number>();
  for (const r of PBAI) aiRowsByPlay.set(num(r.PLYL), (aiRowsByPlay.get(num(r.PLYL)) ?? 0) + 1);
  // pbook-build "template" copy: STID rows of the formId → their PGPL rows → the PBAI rows of those plays (per set).
  const pgplBySet = new Map<number, TdbRow[]>();
  for (const r of PGPL) {
    const list = pgplBySet.get(num(r.SETL));
    if (list) list.push(r);
    else pgplBySet.set(num(r.SETL), [r]);
  }
  const sections = new Map<number, TemplateSectionRows>();
  for (const sr of STID) {
    const formId = num(sr.PBFM);
    let sec = sections.get(formId);
    if (!sec) sections.set(formId, (sec = { sets: 0, plays: 0, cpuRows: 0 }));
    const rows = pgplBySet.get(num(sr.SETL)) ?? [];
    sec.sets++;
    sec.plays += rows.length;
    for (const id of new Set(rows.map((r) => num(r.PLYL)))) sec.cpuRows += aiRowsByPlay.get(id) ?? 0;
  }
  const cap = (name: string, fallback: number) => db.table(name)?.maxRecords ?? fallback;
  const capacity: SaveCapacity = { formations: cap("PGFM", 40), sets: cap("STID", 75), plays: cap("PGPL", 750), cpuRows: cap("PBAI", 2200) };

  const cpuByPlay = new Map<number, Record<string, number>>();
  for (const r of PBAI) {
    const key = SITUATION_BY_ID.get(num(r.AIGR));
    if (!key) {
      unknownSituations++;
      continue;
    }
    const id = num(r.PLYL);
    let cpu = cpuByPlay.get(id);
    if (!cpu) cpuByPlay.set(id, (cpu = {}));
    cpu[key] = num(r.prct);
  }
  const orderedCpu = (cpu: Record<string, number> | undefined) => {
    if (!cpu) return undefined;
    const out: Record<string, number> = {};
    for (const k of SITUATION_ORDER) if (k in cpu) out[k] = cpu[k];
    return out;
  };

  const playsBySet = new Map<number, { row: TdbRow; i: number }[]>();
  PGPL.forEach((row, i) => {
    const setId = num(row.SETL);
    let list = playsBySet.get(setId);
    if (!list) playsBySet.set(setId, (list = []));
    list.push({ row, i });
  });

  const formIds: number[] = [];
  for (const fr of PGFM) if (!formIds.includes(num(fr.PBFM))) formIds.push(num(fr.PBFM));
  const seenFormations = new Set<number>();
  const formations: TemplateFormation[] = [];
  for (const fr of PGFM) {
    const formId = num(fr.PBFM);
    if (seenFormations.has(formId)) continue;
    seenFormations.add(formId);
    const formation = maps.formations.get(formId);
    if (!formation) {
      unresolved.push(`formation ${formId}`);
      continue;
    }
    const sets: TemplateSet[] = [];
    for (const sr of STID) {
      if (num(sr.PBFM) !== formId) continue;
      const setId = num(sr.SETL);
      const set = maps.sets.get(setId);
      if (!set) {
        unresolved.push(`set ${setId}`);
        continue;
      }
      const rows = (playsBySet.get(setId) ?? []).slice().sort((a, b) => num(a.row.ord_) - num(b.row.ord_) || a.i - b.i);
      const plays: TemplatePlay[] = [];
      for (const { row } of rows) {
        const playId = num(row.PLYL);
        const play = maps.plays.get(playId);
        if (!play) {
          unresolved.push(`play ${playId}`);
          continue;
        }
        const tp: TemplatePlay = { play };
        if (play.set !== set.asset) tp.foreign = true;
        const audible = audibleFromFlag(num(row.Flag));
        if (audible) tp.audible = audible;
        const cpu = orderedCpu(cpuByPlay.get(playId));
        if (cpu && Object.keys(cpu).length) tp.cpu = cpu;
        plays.push(tp);
      }
      sets.push({ set, plays });
    }
    formations.push({ formation, sets });
  }
  return { formations, formIds, unresolved, unknownSituations, sections, aiRowsByPlay, capacity };
}

/**
 * What tools/pbook-build.mjs copies for a `"sets": "template"` section that resolves to `formId` (0 sets = pbook-build
 * throws "has no sets in the template"). Falls back to the parsed contents when the raw section counts are missing.
 */
export function templateSectionRows(contents: TemplateContents, formId: number | undefined): TemplateSectionRows {
  if (formId === undefined) return { sets: 0, plays: 0, cpuRows: 0 };
  const raw = contents.sections?.get(formId);
  if (raw) return { ...raw };
  if (contents.sections) return { sets: 0, plays: 0, cpuRows: 0 };
  const tf = contents.formations.find((f) => f.formation.formId === formId);
  return tf ? templateFormationCounts(tf) : { sets: 0, plays: 0, cpuRows: 0 };
}

/** Counts of one template formation (for capacity meters). */
export function templateFormationCounts(tf: TemplateFormation): { sets: number; plays: number; cpuRows: number } {
  let plays = 0;
  let cpuRows = 0;
  for (const s of tf.sets) {
    plays += s.plays.length;
    for (const p of s.plays) cpuRows += p.cpu ? Object.keys(p.cpu).length : 0;
  }
  return { sets: tf.sets.length, plays, cpuRows };
}

/** The template formation for a library formation (matched by formId), if the template has it. */
export function templateFormationFor(contents: TemplateContents, formation: FormationDef | undefined): TemplateFormation | undefined {
  if (!formation) return undefined;
  return contents.formations.find((tf) => tf.formation.formId === formation.formId);
}

/** A template play a spec can't carry (it would be dropped or swapped for another play by name). */
export interface TemplateSkip {
  formation: string;
  set: string;
  play: string;
  /** Library asset of the template's play. */
  asset: string;
  reason: string;
}

export interface TemplateFormationConversion {
  /** Explicit entry (sets that lose every play are left out). */
  entry: FormationEntry;
  skipped: TemplateSkip[];
  /**
   * The formation itself can't be written explicitly (tools/pbook-build.mjs would resolve its name to another formation
   * of the playbook's side, or it belongs to the other side); keep it as a `"template"` section. Rare since pbook-build
   * resolves names by side and prefers the template's formations (commit ac54574).
   */
  problem?: string;
}

export interface TemplateConversion {
  /** Explicit entries; formations with a `problem` stay `{ formation, sets: "template" }`. */
  entries: FormationEntry[];
  skipped: TemplateSkip[];
  /** Formations kept as "template" because they can't be written explicitly (with the reason). */
  keptAsTemplate: { formation: string; reason: string }[];
}

const playEntryOf = (tp: TemplatePlay): PlayEntry => {
  const e: PlayEntry = { play: tp.play.name };
  if (tp.audible) e.audible = tp.audible;
  if (tp.cpu) e.cpu = { ...tp.cpu };
  return e;
};

/**
 * Why a template play can't be written into a spec by display name, or undefined: filed under a foreign set in the
 * stock save, or (with a catalog) the name resolves elsewhere in tools/pbook-build.mjs (nameAddressProblem for the
 * playbook's side: a repeated play / set / formation name). Pass `opts.template` (the contents) so formation names
 * prefer the template's formations exactly like pbook-build.
 */
export function templatePlayProblem(
  ts: TemplateSet,
  tp: TemplatePlay,
  catalog?: Catalog,
  side: Side = "offense",
  opts: ResolveOptions = {},
): string | undefined {
  if (tp.foreign) {
    const own = catalog?.lib.setByAsset.get(tp.play.set)?.name;
    return `filed under ${ts.set.name} in the stock save, but it belongs to ${own ?? "another set"} — a playbook lists a play in its own set`;
  }
  if (!catalog) return undefined;
  const problem = nameAddressProblem(catalog, tp.play.asset, side, opts);
  return problem ? `can't be listed by name: ${problem}` : undefined;
}

/** Plays of a template formation that explicit entries can't carry, as "Set / Play" (foreign plays; with a catalog also name clashes). */
export function templateSkippedPlays(tf: TemplateFormation, catalog?: Catalog, side: Side = "offense", opts: ResolveOptions = {}): string[] {
  return tf.sets.flatMap((ts) => ts.plays.filter((tp) => templatePlayProblem(ts, tp, catalog, side, opts)).map((tp) => `${ts.set.name} / ${tp.play.name}`));
}

/**
 * Why a template formation can't be written as an explicit entry in a playbook of `side` (default: the formation's own
 * side), or undefined: it belongs to the other side, or tools/pbook-build.mjs resolves its name to another formation.
 * Pass `opts.template` so the name prefers the template's formations like pbook-build (default: this formation only).
 */
export function templateFormationProblem(tf: TemplateFormation, lib: LibraryIndex, side?: Side, opts: ResolveOptions = {}): string | undefined {
  const own = formationBookSide(tf.formation);
  const s = side ?? own;
  if (own !== s) return `${tf.formation.name} is ${own === "offense" ? "an offense" : "a defense"} formation, so ${s === "offense" ? "an offense" : "a defense"} playbook can't list it`;
  const prefer: ResolveOptions = opts.template ? opts : { template: { formations: [tf], formIds: [tf.formation.formId], unresolved: [], unknownSituations: 0 } };
  const picked = bookFormation(lib, tf.formation.name, s, prefer);
  if (picked?.asset === tf.formation.asset) return undefined;
  const label = picked ? `${picked.asset.split("/").slice(-3, -1).join("/")} (formId ${picked.formId})` : "no formation";
  return `tools/pbook-build.mjs resolves "${tf.formation.name}" to ${label}, not formId ${tf.formation.formId}, so its sets can't be written explicitly — keep it as "template"`;
}

/**
 * One template formation as an explicit spec entry (display names; audible + cpu kept).
 * - Without a catalog (legacy): only plays filed under a foreign set are skipped — returns the FormationEntry.
 * - With a catalog: every play tools/pbook-build.mjs couldn't find by that name (see templatePlayProblem) is skipped
 *   and listed, sets left without plays are dropped, and `problem` says when the formation itself can't be explicit.
 */
export function templateFormationToEntry(tf: TemplateFormation): FormationEntry;
export function templateFormationToEntry(tf: TemplateFormation, catalog: Catalog, side?: Side, opts?: ResolveOptions): TemplateFormationConversion;
export function templateFormationToEntry(
  tf: TemplateFormation,
  catalog?: Catalog,
  side: Side = "offense",
  opts: ResolveOptions = {},
): FormationEntry | TemplateFormationConversion {
  if (!catalog)
    return {
      formation: tf.formation.name,
      sets: tf.sets.map((ts): SetEntry => ({ set: ts.set.name, plays: ts.plays.filter((tp) => !tp.foreign).map(playEntryOf) })),
    };
  const skipped: TemplateSkip[] = [];
  const skip = (ts: TemplateSet, tp: TemplatePlay, reason: string) =>
    skipped.push({ formation: tf.formation.name, set: ts.set.name, play: tp.play.name, asset: tp.play.asset, reason });
  const sets: SetEntry[] = [];
  for (const ts of tf.sets) {
    const setClash = catalog.lib.setByName(tf.formation, ts.set.name)?.asset !== ts.set.asset;
    const plays: PlayEntry[] = [];
    for (const tp of ts.plays) {
      const reason = setClash
        ? `set "${ts.set.name}" shares its name with another set in ${tf.formation.name}`
        : templatePlayProblem(ts, tp, catalog, side, opts);
      if (reason) skip(ts, tp, reason);
      else plays.push(playEntryOf(tp));
    }
    if (setClash || (plays.length === 0 && ts.plays.length > 0)) continue;
    sets.push({ set: ts.set.name, plays });
  }
  return { entry: { formation: tf.formation.name, sets }, skipped, problem: templateFormationProblem(tf, catalog.lib, side, opts) };
}

/**
 * Every template formation as FormationEntry[] ("New from stock template", "Convert to explicit").
 * - Without a catalog (legacy): FormationEntry[] with only foreign plays skipped.
 * - With a catalog: `{ entries, skipped, keptAsTemplate }` — plays a spec can't address by name are skipped and
 *   listed; formations that can't be written explicitly (another formation of the side has the name) stay `"template"`.
 */
export function templateToSpecEntries(contents: TemplateContents): FormationEntry[];
export function templateToSpecEntries(contents: TemplateContents, catalog: Catalog, side?: Side): TemplateConversion;
export function templateToSpecEntries(contents: TemplateContents, catalog?: Catalog, side: Side = "offense"): FormationEntry[] | TemplateConversion {
  if (!catalog) return contents.formations.map((tf) => templateFormationToEntry(tf));
  const out: TemplateConversion = { entries: [], skipped: [], keptAsTemplate: [] };
  for (const tf of contents.formations) {
    const c = templateFormationToEntry(tf, catalog, side, { template: contents });
    if (c.problem) {
      out.entries.push({ formation: tf.formation.name, sets: "template" });
      out.keptAsTemplate.push({ formation: tf.formation.name, reason: c.problem });
      continue;
    }
    out.entries.push(c.entry);
    out.skipped.push(...c.skipped);
  }
  return out;
}
