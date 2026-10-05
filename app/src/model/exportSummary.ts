// What the game-side export will build from the current specs — mirrors tools/export.ps1 + tools/pbook-build.mjs +
// PlayDump buildplays (commit ac54574):
//  - playbooks/sets/*.json then playbooks/plays/*.json are merged into ONE mod, mods/pbstudio.fbmod: custom formations
//    (Formations/Offense/<asset>/<asset>), custom sets (<formation folder>/<asset>/<asset>), plays cloned into them
//    (<set folder>/<asset>), custom plays, and the non-global library plays the playbooks use (build/pull-plays.json);
//  - every playbooks/*.json except mod.json becomes one save, build/PBOOKOFF-<NAME> (PBOOKDEF- for defense).
// tools/export.ps1 runs with $ErrorActionPreference = "Stop": the first playbook pbook-build fails on stops the whole
// export, so nothing is built. `willFail` / `failures` mirror every throw in pbook-build.mjs.
import type { Catalog } from "./catalog";
import { leaf, maddenName, playSubtitle } from "./names";
import { BOOK_LIMITS, bookSide, resolvePlaybook, templateMissingMessage, type ResolveOptions, type SaveRows } from "./resolveBook";
import { cloneAsset, customFormationAsset, customSetAsset } from "./sets";
import { isSituationKey } from "./situations";
import type { SaveCapacity } from "./tdb";
import type { Asset, CustomSetSpec, PlaybookSpec, PlayKey, PlaysFile, SetsFile } from "./types";
import { isBuiltPlaybookPath, saveNameFor, type SpecDoc } from "./validate";

export type { SpecDoc };

export const EXPORT_COMMAND = "powershell -ExecutionPolicy Bypass -File tools\\export.ps1 -Install";
export const MOD_FILE = "mods/pbstudio.fbmod";
export const SAVES_FOLDER = "Documents\\Madden NFL 27\\saves";

export interface SaveSummary {
  file: string;
  /** spec.name as written. */
  name: string;
  /** PBOOKOFF-<NAME> / PBOOKDEF-<NAME> (tools/export.ps1 upper-cases the name). */
  saveName: string;
  /** build/<saveName> on the game PC. */
  outPath: string;
  side: "offense" | "defense";
  /** Formation sections built from the spec (template sections excluded). */
  formations: number;
  sets: number;
  plays: number;
  /** Formation names copied from the template save ("sets": "template"). */
  templateSections: string[];
  audibles: number;
  /** Explicit CPU weight rows (plays without `cpu` keep the template's rows for that play). */
  cpuRows: number;
  /** Custom plays + plays cloned into custom sets (built into the mod). */
  custom: number;
  /** Explicit formation / set entries that are custom (playbooks/sets/, built into the mod). */
  customFormations: number;
  customSets: number;
  pulled: number;
  unresolved: number;
  /** Game-side caveats for this save. */
  notes: string[];
  /** Why tools/pbook-build.mjs throws on this spec (empty = it builds). Any failure stops the whole export. */
  failures: string[];
  /** failures.length > 0 (or the spec couldn't be read): this save won't be written and export.ps1 stops. */
  willFail: boolean;
  /** Every row the save gets (template sections + inherited CPU rows included) — only with the template contents. */
  saveRows?: SaveRows;
  /** Save table capacities (template maxRecords, else BOOK_LIMITS). */
  limits: SaveCapacity;
  /** The spec couldn't be read or isn't a playbook object. */
  error?: string;
}

export interface CustomPlaySummary {
  file: string;
  index: number;
  key: PlayKey;
  name: string;
  /** Asset leaf (spec.asset). */
  asset: string;
  /** Set asset ("" when the base doesn't resolve). */
  set: string;
  setName: string;
  formationName: string;
  /** "GUN Y TRIPS WK" */
  subtitle: string;
  playType: string;
  /** Save names of the playbooks that list this play. */
  usedBy: string[];
  problems: string[];
}

/** A new formation from a playbooks/sets/ file (FORMATS.md §5 `formations`). */
export interface CustomFormationSummary {
  file: string;
  index: number;
  name: string;
  /** Leaf (spec.asset). */
  leaf: string;
  /** Formations/Offense/<leaf>/<leaf> (what SetBuilder creates). */
  asset: Asset;
  /** Base formation asset and its name ("" when it isn't a library formation). */
  base: Asset;
  baseName: string;
  /** Custom sets (any sets file) filed under this formation. */
  sets: number;
  usedBy: string[];
}

/** A new set from a playbooks/sets/ file (FORMATS.md §5 `sets`). */
export interface CustomSetSummary {
  file: string;
  index: number;
  name: string;
  leaf: string;
  /** <formation folder>/<leaf>/<leaf> ("" when the formation doesn't resolve). */
  asset: Asset;
  formation: Asset;
  formationName: string;
  /** The formation is new too (defined in a sets file). */
  newFormation: boolean;
  base: Asset;
  baseName: string;
  /** "GUN Y TRIPS TIGHT WK" */
  subtitle: string;
  /** Changed slots (`positions`) and edited motion presets (`movements` keys). */
  positions: number;
  presets: number;
  /** Plays cloned into the set. */
  clones: number;
  usedBy: string[];
}

/** A play cloned into a custom set (FORMATS.md §5 `plays`). */
export interface ClonedPlaySummary {
  file: string;
  /** Index of the set in the file, and of the clone in the set's `plays`. */
  setIndex: number;
  index: number;
  key: PlayKey;
  name: string;
  /** Leaf (spec.asset). */
  asset: string;
  /** Source play asset (`from`) and its name. */
  from: Asset;
  fromName: string;
  set: Asset;
  setName: string;
  formationName: string;
  subtitle: string;
  playType: string;
  /** The clone also edits players / reads / vip / play type (FORMATS.md §3 fields). */
  modified: boolean;
  usedBy: string[];
  problems: string[];
}

export interface PulledPlaySummary {
  key: PlayKey;
  /** Full library asset (same as key; what tools/pbook-build.mjs writes to build/pull-plays.json). */
  asset: string;
  name: string;
  set: string;
  setName: string;
  formationName: string;
  subtitle: string;
  playType: string;
  usedBy: string[];
}

export interface UnresolvedPlaySummary {
  file: string;
  saveName: string;
  where: string;
  play: string;
  set: string;
  formation: string;
  reason: string;
}

export interface ExportSummary {
  saves: SaveSummary[];
  customPlays: CustomPlaySummary[];
  /** Everything playbooks/sets/ adds to the mod. */
  customFormations: CustomFormationSummary[];
  customSets: CustomSetSummary[];
  clonedPlays: ClonedPlaySummary[];
  pulled: PulledPlaySummary[];
  unresolved: UnresolvedPlaySummary[];
  /** playbooks/sets/*.json merged into the mod (built first). */
  setsFiles: string[];
  /** playbooks/plays/*.json merged into the mod. */
  playsFiles: string[];
  /** Distinct authored (`new`) assignment names the mod creates (custom plays and clones). */
  authoredAssignments: number;
  /** Playbook docs that won't become saves (nested folders). */
  notBuilt: string[];
  /** Summary-level caveats (deduped across saves). */
  notes: string[];
  /** Saves pbook-build would fail on (export.ps1 then stops: nothing is built). */
  failing: string[];
  mod: string;
  command: string;
}

export interface SummaryInput {
  playbooks: readonly SpecDoc<PlaybookSpec>[];
  plays: readonly SpecDoc<PlaysFile>[];
  sets?: readonly SpecDoc<SetsFile>[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** pbook-build AUDIBLE_BITS keys (it looks the slot up as an object key, so "2" works like 2). */
const AUDIBLE_KEYS = new Set(["1", "2", "3", "4"]);
/** CloneSpec fields that modify the cloned play (FORMATS.md §5 → §3 play fields). */
const CLONE_EDIT_KEYS = ["players", "reads", "vip", "playType", "blocking", "runHole"];

/**
 * Pass the template save's contents (`opts.template`, from state/template.ts) to count the rows template sections add,
 * resolve formation names like pbook-build (template formations first) and fail saves that overflow the save tables or
 * keep a "template" section the template has no sets for (pbook-build throws, which stops the whole export).
 */
export function exportSummary(catalog: Catalog, docs: SummaryInput, opts: ResolveOptions = {}): ExportSummary {
  const lib = catalog.lib;
  const saves: SaveSummary[] = [];
  const unresolved: UnresolvedPlaySummary[] = [];
  const usedBy = new Map<string, Set<string>>();
  const use = (key: string, save: string) => {
    let set = usedBy.get(key);
    if (!set) usedBy.set(key, (set = new Set()));
    set.add(save);
  };
  const users = (key: string) => [...(usedBy.get(key) ?? [])];
  const pulledKeys: PlayKey[] = [];
  const notes = new Set<string>();
  const notBuilt: string[] = [];

  const formationName = (setAsset: string) => lib.formationOfSet(setAsset)?.name ?? "";
  const setName = (setAsset: string) => lib.setByAsset.get(setAsset)?.name ?? leaf(setAsset);

  for (const doc of docs.playbooks) {
    if (!isBuiltPlaybookPath(doc.path)) {
      notBuilt.push(doc.path);
      continue;
    }
    const spec = doc.data;
    const base: SaveSummary = {
      file: doc.path,
      name: isObj(spec) ? String(spec.name ?? "") : "",
      saveName: saveNameFor(isObj(spec) ? spec : undefined),
      outPath: "",
      side: isObj(spec) ? bookSide(spec) : "offense",
      formations: 0,
      sets: 0,
      plays: 0,
      templateSections: [],
      audibles: 0,
      cpuRows: 0,
      custom: 0,
      customFormations: 0,
      customSets: 0,
      pulled: 0,
      unresolved: 0,
      notes: [],
      failures: [],
      willFail: false,
      limits: { ...BOOK_LIMITS },
    };
    base.outPath = `build/${base.saveName}`;
    const fail = (why: string) => {
      if (!base.failures.includes(why)) base.failures.push(why);
    };
    if (doc.error || !isObj(spec) || !Array.isArray(spec.formations)) {
      base.error = doc.error ?? "Not a playbook spec (needs a formations array)";
      base.failures.push(base.error);
      base.willFail = true;
      saves.push(base);
      continue;
    }
    if (!base.name || !/^[A-Za-z0-9]+$/.test(base.name)) {
      base.notes.push(`The name "${base.name}" isn't A–Z/0–9, so the save would be named ${base.saveName}`);
      if (!base.name) fail("The playbook has no name");
    }

    let rb;
    try {
      rb = resolvePlaybook(spec, catalog, opts);
    } catch (e) {
      base.error = `Couldn't resolve: ${e instanceof Error ? e.message : String(e)}`;
      base.failures.push(base.error);
      base.willFail = true;
      saves.push(base);
      continue;
    }
    base.limits = rb.limits ?? { ...BOOK_LIMITS };
    if (rb.counts.saveRows) base.saveRows = rb.counts.saveRows;
    Object.assign(base, {
      formations: rb.counts.formations,
      sets: rb.counts.sets,
      plays: rb.counts.plays,
      cpuRows: rb.counts.cpuRows,
      custom: rb.counts.custom,
      customFormations: rb.counts.customFormations,
      customSets: rb.counts.customSets,
      pulled: rb.counts.pulled,
      unresolved: rb.counts.unresolved,
    });
    if (rb.malformed) fail(`The spec isn't readable by tools/pbook-build.mjs: ${rb.malformed}`);
    for (const rf of rb.formations) {
      const fname = String(rf.entry.formation ?? "");
      if (rf.template) base.templateSections.push(fname);
      if (rf.malformed) fail(`Entry ${rf.index + 1}: ${rf.malformed}`);
      // pbook-build only looks at formations of the playbook's side: `unknown formation "X"`.
      else if (!rf.formation) fail(rf.wrongSide ? `Unknown formation "${maddenName(fname)}" (${rf.problem})` : `Unknown formation "${maddenName(fname)}"`);
      if (rf.formation) use(rf.formation.asset, base.saveName);
      if (rf.templateMissing && rf.formation) fail(templateMissingMessage(fname, rf.formation.formId));
      for (const rs of rf.sets) {
        // pbook-build stops at the first throw: an unresolved formation hides its sets' problems (and a set its plays').
        if (rs.malformed) fail(`${maddenName(fname)}: ${rs.malformed}`);
        else if (!rs.set && rf.formation) fail(`Unknown set "${maddenName(String(rs.entry.set ?? ""))}" in ${maddenName(fname)}`);
        if (rs.set) use(rs.set.asset, base.saveName);
        const used = new Set<unknown>();
        for (const rp of rs.plays) {
          const e = rp.entry;
          if (rp.malformed) fail(`${maddenName(fname)} › ${maddenName(String(rs.entry.set ?? ""))}: ${rp.malformed}`);
          // pbook-build: `audible slot must be 1-4` / `audible slot N used twice` (per set entry), unknown situation keys.
          const audible: unknown = e.audible ?? 0;
          if (audible) {
            if (!AUDIBLE_KEYS.has(String(audible))) fail(`"${maddenName(String(e.play ?? ""))}": audible slot must be 1–4`);
            else {
              base.audibles++;
              if (used.has(audible)) fail(`${maddenName(String(rs.entry.set ?? ""))}: audible slot ${String(audible)} used twice`);
            }
          }
          used.add(audible);
          if (e.cpu && !Object.keys(Object(e.cpu)).every((k) => isSituationKey(k)))
            fail(`"${maddenName(String(e.play ?? ""))}": unknown CPU situation in cpu`);
          if (!rp.play) {
            if (!rp.malformed && rs.set) fail(`Unresolved play "${maddenName(String(e.play ?? ""))}" in ${maddenName(String(rs.entry.set ?? ""))}`);
            unresolved.push({
              file: doc.path,
              saveName: base.saveName,
              where: `/formations/${rf.index}/sets/${rs.index}/plays/${rp.index}`,
              play: String(e.play ?? ""),
              set: String(rs.entry.set ?? ""),
              formation: fname,
              reason: rp.problem ?? "Unknown play",
            });
            continue;
          }
          use(rp.play.key, base.saveName);
          if (rp.play.source === "library" && !rp.play.global && !pulledKeys.includes(rp.play.key)) pulledKeys.push(rp.play.key);
        }
      }
    }
    if (base.saveRows) {
      // tools/tdb.mjs writeTable: "<TABLE>: N rows exceeds capacity M" (it runs in the --collect pass too).
      const r = base.saveRows;
      const over: [string, number, number][] = [
        ["PGFM", r.formations, base.limits.formations],
        ["STID", r.sets, base.limits.sets],
        ["PGPL", r.plays, base.limits.plays],
        ["PBAI", r.cpuRows, base.limits.cpuRows],
      ];
      for (const [table, n, max] of over) if (n > max) fail(`${table}: ${n} rows exceeds capacity ${max} (template sections included)`);
    }
    base.willFail = base.failures.length > 0;
    saves.push(base);
  }

  const customPlays: CustomPlaySummary[] = catalog.custom
    .filter((rp) => docs.plays.some((d) => d.path === rp.file))
    .map((rp) => ({
      file: rp.file ?? "",
      index: rp.index ?? 0,
      key: rp.key,
      name: rp.name,
      asset: leaf(rp.key),
      set: rp.set,
      setName: rp.set ? setName(rp.set) : "",
      formationName: rp.set ? formationName(rp.set) : "",
      subtitle: rp.set ? playSubtitle(formationName(rp.set), setName(rp.set)) : "",
      playType: rp.playType,
      usedBy: users(rp.key),
      problems: rp.problems,
    }));

  // playbooks/sets/: custom formations, custom sets and the plays cloned into them (SetBuilder asset layout, sets.ts).
  const setsDocs = (docs.sets ?? []).filter((d) => !d.error && isObj(d.data));
  const customFormations: CustomFormationSummary[] = [];
  const customSets: CustomSetSummary[] = [];
  const clonedPlays: ClonedPlaySummary[] = [];
  for (const d of setsDocs) {
    list(d.data!.formations).forEach((f, index) => {
      if (!isObj(f)) return;
      const asset = str(f.asset) ? customFormationAsset(str(f.asset)) : "";
      customFormations.push({
        file: d.path,
        index,
        name: str(f.name),
        leaf: str(f.asset),
        asset,
        base: str(f.base),
        baseName: lib.formationByAsset.get(str(f.base))?.name ?? "",
        sets: 0,
        usedBy: asset ? users(asset) : [],
      });
    });
  }
  for (const d of setsDocs) {
    list(d.data!.sets).forEach((st, setIndex) => {
      if (!isObj(st)) return;
      const asset = customSetAsset(st as CustomSetSpec) ?? "";
      const formAsset = str(st.formation).includes("/") ? str(st.formation) : "";
      const form = customFormations.find((f) => f.asset === formAsset);
      if (form) form.sets++;
      const fName = form?.name ?? lib.formationByAsset.get(formAsset)?.name ?? "";
      const sName = str(st.name);
      const clones = list(st.plays);
      customSets.push({
        file: d.path,
        index: setIndex,
        name: sName,
        leaf: str(st.asset),
        asset,
        formation: formAsset,
        formationName: fName,
        newFormation: !!form,
        base: str(st.base),
        baseName: lib.setByAsset.get(str(st.base))?.name ?? "",
        subtitle: playSubtitle(fName, sName),
        positions: list(st.positions).length,
        presets: isObj(st.movements) ? Object.keys(st.movements).length : 0,
        clones: clones.length,
        usedBy: asset ? users(asset) : [],
      });
      clones.forEach((c, index) => {
        if (!isObj(c)) return;
        const key = asset && str(c.asset) ? cloneAsset(asset, str(c.asset)) : "";
        const rp = key ? catalog.get(key) : undefined;
        const from = str(c.from);
        clonedPlays.push({
          file: d.path,
          setIndex,
          index,
          key,
          name: str(c.name),
          asset: str(c.asset),
          from,
          fromName: catalog.get(from)?.name ?? lib.playByAsset.get(from)?.name ?? "",
          set: asset,
          setName: sName,
          formationName: fName,
          subtitle: playSubtitle(fName, sName),
          playType: rp?.playType ?? (typeof c.playType === "string" ? c.playType : lib.playByAsset.get(from)?.offensePlayType ?? ""),
          modified: CLONE_EDIT_KEYS.some((k) => c[k] !== undefined),
          usedBy: key ? users(key) : [],
          problems: rp?.problems ?? [],
        });
      });
    });
  }

  const pulled: PulledPlaySummary[] = pulledKeys.map((key) => {
    const rp = catalog.get(key)!;
    return {
      key,
      asset: rp.asset,
      name: rp.name,
      set: rp.set,
      setName: setName(rp.set),
      formationName: formationName(rp.set),
      subtitle: playSubtitle(formationName(rp.set), setName(rp.set)),
      playType: rp.playType,
      usedBy: users(key),
    };
  });

  const playsFiles = docs.plays.map((d) => d.path);
  const setsFiles = (docs.sets ?? []).map((d) => d.path);
  const authored = new Set<string>();
  const addAuthored = (players: unknown) => {
    if (isObj(players)) for (const v of Object.values(players)) if (isObj(v) && typeof v.new === "string") authored.add(v.new);
  };
  for (const d of setsDocs) for (const st of list(d.data!.sets)) if (isObj(st)) for (const c of list(st.plays)) if (isObj(c)) addAuthored(c.players);
  for (const d of docs.plays) for (const p of isObj(d.data) ? list(d.data.plays) : []) if (isObj(p)) addAuthored(p.players);

  // Same-name saves overwrite each other on the game PC.
  const byName = new Map<string, number>();
  for (const s of saves) byName.set(s.saveName, (byName.get(s.saveName) ?? 0) + 1);
  for (const s of saves)
    if ((byName.get(s.saveName) ?? 0) > 1) s.notes.push(`Another playbook also builds ${s.saveName}; the last one built wins`);
  if (customSets.length || customFormations.length)
    notes.add("Custom formations and sets build game-side since 2026-10-04 (FORMATS.md §5); check them in-game after the first export");

  return {
    saves,
    failing: saves.filter((sv) => sv.willFail).map((sv) => sv.saveName),
    customPlays,
    customFormations,
    customSets,
    clonedPlays,
    pulled,
    unresolved,
    setsFiles,
    playsFiles,
    authoredAssignments: authored.size,
    notBuilt,
    notes: [...notes],
    mod: MOD_FILE,
    command: EXPORT_COMMAND,
  };
}
