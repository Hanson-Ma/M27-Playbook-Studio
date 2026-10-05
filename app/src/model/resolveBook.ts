// Resolve a playbook spec against the catalog (the same name rules as tools/pbook-build.mjs) and validate it
// against FORMATS.md §2. Shared by the playbook builder, play-call preview, concepts gameplans and export.
// Never throws on a wrong-shaped spec (hand-edited JSON): every level is shape-checked and malformed entries are
// reported (`malformed`, rule "book-shape") instead of crashing the view.
//
// Name resolution = tools/pbook-build.mjs (commit ac54574):
//  - formation: norm() name match among the formations of the PLAYBOOK'S SIDE (defense = FormationType_Defense /
//    KickReturn / Safety_KickReturn, offense = every other type), library then custom (playbooks/sets/), preferring a
//    formation the template save contains, then the one whose asset folder is named after it, then the first;
//  - set: first set inside the formation's asset folder with that name (library sets before custom sets);
//  - play: first play of that set with that name (library plays, then clones and custom plays).
// Custom formations, sets and cloned plays come from the catalog overlay (catalog.lib / catalog.get), so a playbook
// references them by name exactly like stock ones; they and custom plays need the mod (pbstudio.fbmod).
import { playProblemLevel, type Catalog } from "./catalog";
import { formationBookSide, type LibraryIndex } from "./library";
import { maddenName } from "./names";
import { isSituationKey } from "./situations";
import type { SaveCapacity, TemplateContents, TemplateSectionRows } from "./tdb";
import type {
  FormationDef,
  FormationEntry,
  PlayEntry,
  PlaybookSpec,
  ResolvedPlay,
  SetDef,
  SetEntry,
  Side,
  ValidationIssue,
} from "./types";

export const BOOK_LIMITS = { plays: 750, formations: 40, sets: 75, cpuRows: 2200 } as const;

/** Formations every custom playbook should keep (FORMATS.md §2 "Keep special teams"). */
export const SPECIAL_TEAMS_FORMATIONS = ["Special", "Kickoff", "Safety Kickoff"] as const;
export const RECOMMENDED_FORMATIONS = ["Goal Line Offense"] as const;

/** Formation types tools/pbook-build.mjs treats as defense, and the playbook side a formation belongs to (library.ts). */
export { DEFENSE_FORMATION_TYPES, formationBookSide } from "./library";

export interface ResolveOptions {
  /**
   * The template save's contents (state/template.ts `useTemplate().contents`). With it, formation names prefer a
   * formation the template contains (like pbook-build), `counts.saveRows` holds every row tools/pbook-build.mjs writes —
   * template sections and the CPU rows explicit plays inherit included — and playbookIssues checks capacity,
   * template-section audibles/sets and template sections the template has no sets for.
   */
  template?: TemplateContents;
}

export interface ResolvedBookPlay {
  entry: PlayEntry;
  index: number;
  play?: ResolvedPlay;
  problem?: string;
  /** The entry isn't a `{ "play": "<name>" }` object (`entry` is then a stand-in); the game-side build stops on it. */
  malformed?: string;
}

export interface ResolvedBookSet {
  entry: SetEntry;
  index: number;
  set?: SetDef;
  /** The set is a custom set from playbooks/sets/ (built into the mod). */
  custom?: boolean;
  problem?: string;
  /** Not a `{ "set", "plays": [] }` object (`entry` may be a stand-in); the game-side build stops on it. */
  malformed?: string;
  plays: ResolvedBookPlay[];
}

export interface ResolvedBookFormation {
  entry: FormationEntry;
  index: number;
  formation?: FormationDef;
  /** `"sets": "template"` — contents come from the template save. */
  template: boolean;
  /** The formation is a custom formation from playbooks/sets/ (built into the mod). */
  custom?: boolean;
  /**
   * Why tools/pbook-build.mjs stops on this formation entry: the name doesn't resolve for the playbook's side, or (template
   * sections) the template save has no sets for it. Undefined when it builds.
   */
  problem?: string;
  /** Not a `{ "formation", "sets" }` object (`entry` is then a stand-in); the game-side build stops on it. */
  malformed?: string;
  /** The name only exists on the other side of the ball (e.g. "Nickel" in an offense playbook) — pbook-build can't find it. */
  wrongSide?: FormationDef;
  /**
   * Template section whose formation the template save has no sets for (custom formations, formations the stock save
   * never had): tools/pbook-build.mjs throws `"X" (formId N) has no sets in the template, so "template" would drop it`.
   * Known with the template contents, and for custom formations always.
   */
  templateMissing?: boolean;
  /**
   * Template sections, when resolved with the template: the rows tools/pbook-build.mjs copies — the template's sets of
   * the formation (`formId`). `sets: 0` = pbook-build stops (`templateMissing`).
   */
  templateRows?: TemplateSectionRows & { formId?: number };
  sets: ResolvedBookSet[];
}

/** Rows tools/pbook-build.mjs writes to the save tables (PGFM / STID / PGPL / PBAI). */
export interface SaveRows {
  formations: number;
  sets: number;
  plays: number;
  cpuRows: number;
  /** Share of the template sections. */
  template: TemplateSectionRows;
  /** Template CPU rows that explicit plays without `cpu` inherit. */
  inheritedCpuRows: number;
}

export interface BookCounts {
  /** Counts exclude "template" sections (their contents live in the template save) — see `saveRows`. */
  formations: number;
  sets: number;
  plays: number;
  cpuRows: number;
  templateFormations: number;
  /** Library plays outside the global play sheet (the mod pulls them in). */
  pulled: number;
  /** Custom plays and plays cloned into custom sets (always need the mod). */
  custom: number;
  /** Explicit entries that resolve to custom formations / custom sets (need the mod). */
  customFormations: number;
  customSets: number;
  unresolved: number;
  /** Every row the save gets (explicit + template sections + inherited CPU rows); only when resolved with the template. */
  saveRows?: SaveRows;
}

export interface ResolvedBook {
  formations: ResolvedBookFormation[];
  counts: BookCounts;
  /** Table capacities: the template save's maxRecords when known, else BOOK_LIMITS (always set by resolvePlaybook). */
  limits?: SaveCapacity;
  /** The spec isn't an object with a `formations` array (nothing else could be resolved). */
  malformed?: string;
}

/** The side used to resolve formation names: "defense" only when the spec says so (tools/pbook-build.mjs sideOk). */
export function bookSide(spec: Pick<PlaybookSpec, "side">): Side {
  return isObj(spec) && spec.side === "defense" ? "defense" : "offense";
}

const formIdCache = new WeakMap<TemplateContents, ReadonlySet<number>>();

/** PGFM formIds of the template save — tools/pbook-build.mjs prefers a formation the template contains. Cached per contents. */
export function templateFormIdsOf(template: TemplateContents | undefined): ReadonlySet<number> | undefined {
  if (!template) return undefined;
  let ids = formIdCache.get(template);
  if (!ids) formIdCache.set(template, (ids = new Set(template.formIds ?? template.formations.map((f) => f.formation.formId))));
  return ids;
}

/**
 * tools/pbook-build.mjs formByName for a playbook of `side`: the formation the game-side builder picks for this display
 * name, or undefined when it would throw `unknown formation`. `lib.formationByName(name, side, { preferFormIds })` with
 * the template's PGFM formIds (the catalog overlay includes custom formations, after the stock ones).
 */
export function bookFormation(lib: LibraryIndex, name: string, side: Side, opts: ResolveOptions = {}): FormationDef | undefined {
  if (typeof name !== "string" || !name.trim()) return undefined;
  const f = lib.formationByName(name, side, { preferFormIds: templateFormIdsOf(opts.template) });
  return f && formationBookSide(f) === side ? f : undefined;
}

/** A formation with this name on the other side of the ball (explains why `bookFormation` found nothing). */
export function otherSideFormation(lib: LibraryIndex, name: string, side: Side): FormationDef | undefined {
  return bookFormation(lib, name, side === "offense" ? "defense" : "offense");
}

/** True when the formation comes from a playbooks/sets/ file (catalog overlay; built into the mod). */
export function isCustomFormation(lib: LibraryIndex, f: Pick<FormationDef, "asset">): boolean {
  return typeof lib.isCustomFormation === "function" && lib.isCustomFormation(f.asset);
}

/** True when the set comes from a playbooks/sets/ file (catalog overlay; built into the mod). */
export function isCustomSet(lib: LibraryIndex, s: Pick<SetDef, "asset">): boolean {
  return typeof lib.isCustomSet === "function" && lib.isCustomSet(s.asset);
}

/** True for a play cloned into a custom set (FORMATS.md §5 `plays`), as opposed to a playbooks/plays/ custom play. */
export function isClonePlay(play: Pick<ResolvedPlay, "source" | "clone">): boolean {
  return play.source === "custom" && !!play.clone;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");
/** Rows pbook-build writes for an explicit `cpu` value (it maps Object.entries of whatever is there). */
const cpuKeyCount = (cpu: unknown) => (cpu ? Object.keys(Object(cpu)).length : 0);
const ZERO_ROWS: TemplateSectionRows = { sets: 0, plays: 0, cpuRows: 0 };

/** Rows tools/pbook-build.mjs copies for a "template" section of `formId`. */
function sectionRows(t: TemplateContents, formId: number | undefined): TemplateSectionRows {
  if (formId === undefined) return { ...ZERO_ROWS };
  const raw = t.sections?.get(formId);
  if (raw) return { ...raw };
  if (t.sections) return { ...ZERO_ROWS };
  // Hand-built contents without raw section counts: count the parsed formation.
  const tf = t.formations.find((f) => f.formation.formId === formId);
  if (!tf) return { ...ZERO_ROWS };
  let plays = 0;
  let cpuRows = 0;
  for (const s of tf.sets) {
    plays += s.plays.length;
    for (const p of s.plays) cpuRows += p.cpu ? Object.keys(p.cpu).length : 0;
  }
  return { sets: tf.sets.length, plays, cpuRows };
}

/** pbook-build's message when a "template" section has nothing to copy (it throws; the whole export stops). */
export function templateMissingMessage(name: string, formId: number | undefined): string {
  return `"${maddenName(name)}" (formId ${formId ?? "?"}) has no sets in the template, so "template" would drop it`;
}

export function resolvePlaybook(spec: PlaybookSpec, catalog: Catalog, opts: ResolveOptions = {}): ResolvedBook {
  const lib = catalog.lib;
  const tpl = opts.template;
  const counts: BookCounts = {
    formations: 0,
    sets: 0,
    plays: 0,
    cpuRows: 0,
    templateFormations: 0,
    pulled: 0,
    custom: 0,
    customFormations: 0,
    customSets: 0,
    unresolved: 0,
  };
  const limits: SaveCapacity = { ...BOOK_LIMITS, ...tpl?.capacity };
  const rows: SaveRows = { formations: 0, sets: 0, plays: 0, cpuRows: 0, template: { ...ZERO_ROWS }, inheritedCpuRows: 0 };
  const done = (formations: ResolvedBookFormation[], malformed?: string): ResolvedBook => {
    if (tpl) counts.saveRows = rows;
    return malformed ? { formations, counts, limits, malformed } : { formations, counts, limits };
  };
  if (!isObj(spec)) return done([], "A playbook must be a JSON object (FORMATS.md §2)");
  if (!Array.isArray(spec.formations)) return done([], '"formations" must be an array');

  const side = bookSide(spec);
  const formations = (spec.formations as unknown[]).map((raw, fi): ResolvedBookFormation => {
    rows.formations++;
    if (!isObj(raw)) {
      counts.formations++;
      return {
        entry: { formation: "", sets: [] },
        index: fi,
        template: false,
        malformed: `Formation entry ${fi + 1} must be an object`,
        sets: [],
      };
    }
    const entry = raw as FormationEntry;
    const name = str(entry.formation);
    const formation = bookFormation(lib, name, side, opts);
    const template = entry.sets === "template";
    const rf: ResolvedBookFormation = { entry, index: fi, formation, template, sets: [] };
    if (!name.trim()) rf.malformed = `Formation entry ${fi + 1} has no "formation" name`;
    if (!formation) {
      const other = name.trim() ? otherSideFormation(lib, name, side) : undefined;
      if (other) {
        rf.wrongSide = other;
        rf.problem = `"${maddenName(name)}" is ${side === "offense" ? "a defense" : "an offense"} formation — ${side === "offense" ? "an offense" : "a defense"} playbook can't use it`;
      } else rf.problem = `Unknown formation "${maddenName(name)}"`;
    } else if (isCustomFormation(lib, formation)) rf.custom = true;
    if (template) {
      counts.templateFormations++;
      if (formation && rf.custom) rf.templateMissing = true; // the template save can't know a custom formation
      if (tpl) {
        const copied = sectionRows(tpl, formation?.formId);
        rf.templateRows = { ...copied, formId: formation?.formId };
        if (formation && copied.sets === 0) rf.templateMissing = true;
        rows.sets += copied.sets;
        rows.plays += copied.plays;
        rows.cpuRows += copied.cpuRows;
        rows.template.sets += copied.sets;
        rows.template.plays += copied.plays;
        rows.template.cpuRows += copied.cpuRows;
      }
      if (rf.templateMissing && formation) rf.problem = templateMissingMessage(name, formation.formId);
      return rf;
    }
    counts.formations++;
    if (rf.custom) counts.customFormations++;
    const sets: unknown[] = Array.isArray(entry.sets) ? entry.sets : [];
    rf.sets = sets.map((rawSet, si): ResolvedBookSet => {
      counts.sets++;
      rows.sets++;
      if (!isObj(rawSet)) {
        return { entry: { set: "", plays: [] }, index: si, problem: "Not a set entry", malformed: `Set entry ${si + 1} must be an object`, plays: [] };
      }
      const sEntry = rawSet as SetEntry;
      const setName = str(sEntry.set);
      const set = formation ? lib.setByName(formation, setName) : undefined;
      const rs: ResolvedBookSet = {
        entry: sEntry,
        index: si,
        set,
        problem: !formation ? "Formation not resolved" : set ? undefined : `Unknown set "${maddenName(setName)}" in ${maddenName(formation.name)}`,
        plays: [],
      };
      if (set && isCustomSet(lib, set)) {
        rs.custom = true;
        counts.customSets++;
      }
      if (!setName.trim()) rs.malformed = `Set entry ${si + 1} has no "set" name`;
      else if (!Array.isArray(sEntry.plays)) rs.malformed = `${maddenName(setName)}: "plays" must be an array`;
      const plays: unknown[] = Array.isArray(sEntry.plays) ? sEntry.plays : [];
      rs.plays = plays.map((rawPlay, pi): ResolvedBookPlay => {
        counts.plays++;
        rows.plays++;
        if (!isObj(rawPlay)) {
          counts.unresolved++;
          return {
            entry: { play: "" },
            index: pi,
            problem: "Not a play entry",
            malformed: `Play entry ${pi + 1} in ${setName ? maddenName(setName) : `set ${si + 1}`} must be an object`,
          };
        }
        const pEntry = rawPlay as PlayEntry;
        const playName = str(pEntry.play);
        const play = set ? catalog.playInSetByName(set.asset, playName) : undefined;
        const explicitCpu = cpuKeyCount(pEntry.cpu);
        counts.cpuRows += explicitCpu;
        rows.cpuRows += explicitCpu;
        if (!pEntry.cpu && tpl && play?.playId !== undefined) {
          // pbook-build: "explicit cpu wins, otherwise keep whatever the template had for this play".
          const inherited = tpl.aiRowsByPlay?.get(play.playId) ?? 0;
          rows.cpuRows += inherited;
          rows.inheritedCpuRows += inherited;
        }
        if (!play) counts.unresolved++;
        else if (play.source === "custom") counts.custom++;
        else if (!play.global) counts.pulled++;
        const rp: ResolvedBookPlay = {
          entry: pEntry,
          index: pi,
          play,
          problem: play ? undefined : set ? `Unknown play "${maddenName(playName)}" in ${maddenName(set.name)}` : "Set not resolved",
        };
        if (!playName.trim()) rp.malformed = `Play entry ${pi + 1} in ${setName ? maddenName(setName) : `set ${si + 1}`} has no "play" name`;
        return rp;
      });
      return rs;
    });
    return rf;
  });
  return done(formations);
}

const where = (fi: number, si?: number, pi?: number) =>
  `/formations/${fi}` + (si === undefined ? "" : `/sets/${si}`) + (pi === undefined ? "" : `/plays/${pi}`);

/**
 * Every FORMATS.md §2 rule the editor can check, plus what makes tools/pbook-build.mjs stop or drop content.
 * Pass the template contents (`opts.template`) to check capacity against every row the save gets (template sections and
 * inherited CPU rows included — overflow stops the whole export), template-section audibles and template sections the
 * template has no sets for (pbook-build throws on those).
 */
export function playbookIssues(spec: PlaybookSpec, catalog: Catalog, file?: string, opts: ResolveOptions = {}): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const push = (level: ValidationIssue["level"], rule: string, message: string, w?: string) =>
    out.push({ level, rule, message, file, where: w });

  if (!isObj(spec)) {
    push("error", "book-shape", "A playbook must be a JSON object (FORMATS.md §2)");
    return out;
  }
  const name = typeof spec.name === "string" ? spec.name : spec.name === undefined || spec.name === null ? "" : String(spec.name);
  if (!name) push("error", "book-name", "Playbook name is empty");
  else if (!/^[A-Za-z0-9]+$/.test(name))
    push("error", "book-name", `Playbook name "${name}" may only use A–Z and 0–9 (save file PBOOKOFF-${name.toUpperCase()})`);
  if (spec.side !== "offense" && spec.side !== "defense")
    push("error", "book-side", `Side must be "offense" or "defense" (got ${JSON.stringify(spec.side)})`);

  const tpl = opts.template;
  const book = resolvePlaybook(spec, catalog, opts);
  if (book.malformed) {
    push("error", "book-shape", book.malformed, "/formations");
    return out;
  }
  const seenFormations = new Map<string, { index: number; template: boolean }>();
  // One in-game set per set asset: where each set is written, and its audible slots (across entries and template sections).
  const setHome = new Map<string, string>();
  const audibleBySet = new Map<string, Map<number, { label: string; entry: string }>>();
  const slotsOf = (key: string) => {
    let m = audibleBySet.get(key);
    if (!m) audibleBySet.set(key, (m = new Map()));
    return m;
  };

  // Template sections first: the sets (and audibles) pbook-build copies, so explicit entries are checked against them.
  if (tpl)
    for (const rf of book.formations) {
      if (!rf.template || rf.templateRows?.formId === undefined) continue;
      const tf = tpl.formations.find((f) => f.formation.formId === rf.templateRows!.formId);
      for (const ts of tf?.sets ?? []) {
        const label = `the "${maddenName(String(rf.entry.formation))}" template section`;
        if (!setHome.has(ts.set.asset)) setHome.set(ts.set.asset, label);
        const slots = slotsOf(ts.set.asset);
        for (const tp of ts.plays) if (tp.audible && !slots.has(tp.audible)) slots.set(tp.audible, { label: `"${maddenName(tp.play.name)}" (${label})`, entry: `t${rf.index}` });
      }
    }

  for (const rf of book.formations) {
    const fw = where(rf.index);
    const fname = String(rf.entry.formation ?? "");
    if (rf.malformed) push("error", "book-shape", rf.malformed, fw);
    else if (rf.wrongSide)
      push(
        "error",
        "formation-side",
        `${rf.problem} (tools/pbook-build.mjs only looks at ${bookSide(spec)} formations, so the whole export stops)`,
        fw,
      );
    else if (!rf.formation) push("error", "formation-unknown", rf.problem ?? `Unknown formation "${maddenName(fname)}"`, fw);
    if (rf.templateMissing && rf.formation)
      push(
        "error",
        "template-empty",
        rf.custom
          ? `${maddenName(fname)} is a custom formation, so the template save has no sets for it — tools/pbook-build.mjs stops (${templateMissingMessage(fname, rf.formation.formId)}). List its sets explicitly`
          : `The template save has no ${maddenName(fname)} sets — tools/pbook-build.mjs stops (${templateMissingMessage(fname, rf.formation.formId)}). List its sets explicitly or remove the section`,
        fw,
      );
    if (rf.formation) {
      const prev = seenFormations.get(rf.formation.asset);
      if (prev !== undefined) {
        const twice = prev.template || rf.template ? "the formation and the template's sets" : "the formation";
        push(
          "warning",
          "formation-duplicate",
          `${maddenName(rf.formation.name)} appears twice (entries ${prev.index + 1} and ${rf.index + 1}) — tools/pbook-build.mjs writes ${twice} twice ` +
            `(duplicate save rows; the in-game effect is untested)`,
          fw,
        );
      } else seenFormations.set(rf.formation.asset, { index: rf.index, template: rf.template });
      // Own rule ids (not "needs-mod", which counts plays: custom + clones + pulled = counts.custom + counts.pulled).
      if (rf.custom && !rf.template)
        push("info", "custom-formation", `${maddenName(fname)} is a custom formation (built into pbstudio.fbmod from playbooks/sets/)`, fw);
    }
    if (rf.template) continue;
    if (!rf.malformed && !Array.isArray(rf.entry.sets))
      push("error", "formation-sets", `"sets" must be an array or "template"`, fw);
    if (rf.sets.length === 0 && !rf.malformed) push("warning", "formation-empty", `${fname ? maddenName(fname) : `Formation ${rf.index + 1}`} has no sets`, fw);

    for (const rs of rf.sets) {
      const sw = where(rf.index, rs.index);
      const sname = String(rs.entry.set ?? "");
      if (rs.malformed) push("error", "book-shape", rs.malformed, sw);
      if (rs.problem && rf.formation && !(rs.malformed && !rs.entry.set)) push("error", "set-unknown", rs.problem, sw);
      if (rs.set) {
        const home = setHome.get(rs.set.asset);
        if (home !== undefined)
          push("warning", "set-duplicate", `${maddenName(rs.set.name)} is also written by ${home} — the save gets this set twice`, sw);
        else setHome.set(rs.set.asset, `entry ${rf.index + 1} (${maddenName(fname)})`);
        // (Sets of a custom formation are covered by the formation's note.)
        if (rs.custom && !rf.custom) push("info", "custom-set", `${maddenName(sname)} is a custom set (built into pbstudio.fbmod from playbooks/sets/)`, sw);
      }
      if (rs.plays.length === 0 && !rs.malformed) push("warning", "set-empty", `${maddenName(sname)} has no plays`, sw);

      // Audible slots are per in-game set: entries that resolve to the same set (or a template section's copy) share them.
      const entryKey = `${rf.index}/${rs.index}`;
      const slots = slotsOf(rs.set ? rs.set.asset : `entry:${entryKey}`);
      const seenPlays = new Map<string, number>();
      for (const rp of rs.plays) {
        const pw = where(rf.index, rs.index, rp.index);
        const e = rp.entry;
        if (rp.malformed) push("error", "book-shape", rp.malformed, pw);
        else if (rp.problem && rs.set) push("error", "play-unknown", rp.problem, pw);
        if (rp.play) {
          const prev = seenPlays.get(rp.play.key);
          if (prev !== undefined) push("warning", "play-duplicate", `"${maddenName(String(e.play))}" is listed twice in ${maddenName(sname)}`, pw);
          else seenPlays.set(rp.play.key, rp.index);
          if (rp.play.source === "custom")
            push(
              "info",
              "needs-mod",
              isClonePlay(rp.play)
                ? `"${maddenName(String(e.play))}" is cloned into the custom set ${maddenName(rs.set?.name ?? sname)} (built into pbstudio.fbmod)`
                : `"${maddenName(String(e.play))}" is a custom play (built into pbstudio.fbmod)`,
              pw,
            );
          else if (!rp.play.global)
            push("info", "needs-mod", `"${maddenName(String(e.play))}" isn't in the global play sheet; the mod will pull it in`, pw);
          const level = playProblemLevel(rp.play.problems);
          if (level) push(level, "play-problem", `"${maddenName(String(e.play))}": ${rp.play.problems.join("; ")}`, pw);
        }
        if (e.audible !== undefined) {
          if (![1, 2, 3, 4].includes(e.audible as number))
            push("error", "audible-range", `"${maddenName(String(e.play))}": audible must be 1–4 (got ${JSON.stringify(e.audible)})`, pw);
          else {
            const prev = slots.get(e.audible);
            if (!prev) slots.set(e.audible, { label: `"${maddenName(String(e.play))}"`, entry: entryKey });
            else if (prev.entry === entryKey)
              push("error", "audible-duplicate", `Audible ${e.audible} is used by ${prev.label} and "${maddenName(String(e.play))}" in ${maddenName(sname)}`, pw);
            else
              push(
                "error",
                "audible-duplicate",
                `Audible ${e.audible} in ${maddenName(sname)} is also used by ${prev.label} — the in-game set would have two plays on one audible slot`,
                pw,
              );
          }
        }
        if (e.cpu !== undefined) {
          if (!e.cpu || typeof e.cpu !== "object" || Array.isArray(e.cpu))
            push("error", "cpu-shape", `"${maddenName(String(e.play))}": cpu must be an object of situation → weight`, pw);
          else
            for (const [k, v] of Object.entries(e.cpu)) {
              if (!isSituationKey(k)) push("error", "cpu-key", `"${maddenName(String(e.play))}": unknown CPU situation "${k}"`, pw);
              if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100)
                push("error", "cpu-weight", `"${maddenName(String(e.play))}": CPU weight for ${k} must be 0–100 (got ${JSON.stringify(v)})`, pw);
            }
        }
      }
    }
  }

  const c = book.counts;
  const lim = book.limits ?? BOOK_LIMITS;
  const TABLE = { "cap-plays": "PGPL", "cap-formations": "PGFM", "cap-sets": "STID", "cap-cpu": "PBAI" } as const;
  const cap = (n: number, max: number, what: string, rule: keyof typeof TABLE) => {
    if (n > max)
      push(
        "error",
        rule,
        `${n} ${what} — the save holds at most ${max}; tools/pbook-build.mjs stops ("${TABLE[rule]}: ${n} rows exceeds capacity ${max}") and the whole export fails`,
      );
    else if (n > max * 0.9) push("warning", rule, `${n} of ${max} ${what} used`);
  };
  if (c.saveRows) {
    const r = c.saveRows;
    const t = c.templateFormations ? " incl. template sections" : "";
    cap(r.plays, lim.plays, `plays${t}`, "cap-plays");
    cap(r.formations, lim.formations, "formations", "cap-formations");
    cap(r.sets, lim.sets, `sets${t}`, "cap-sets");
    cap(r.cpuRows, lim.cpuRows, `CPU weight rows${t || r.inheritedCpuRows ? " incl. template rows" : ""}`, "cap-cpu");
  } else {
    const t = c.templateFormations ? " (plus template sections)" : "";
    cap(c.plays, lim.plays, `plays${t}`, "cap-plays");
    cap(c.formations + c.templateFormations, lim.formations, "formations", "cap-formations");
    cap(c.sets, lim.sets, `sets${t}`, "cap-sets");
    cap(c.cpuRows, lim.cpuRows, `CPU weight rows${t}`, "cap-cpu");
  }

  if (spec.side !== "defense") {
    const names = new Set((spec.formations ?? []).map((f) => (isObj(f) ? String(f.formation ?? "") : "").toLowerCase()));
    for (const st of SPECIAL_TEAMS_FORMATIONS)
      if (!names.has(st.toLowerCase()))
        push("info", "special-teams", `No "${maddenName(st)}" formation — special teams come from it (usually kept as "template")`);
    for (const st of RECOMMENDED_FORMATIONS)
      if (!names.has(st.toLowerCase())) push("info", "goal-line", `No "${maddenName(st)}" formation (usually kept as "template")`);
  }
  return out;
}
