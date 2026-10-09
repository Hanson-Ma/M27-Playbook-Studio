// Play-call preview model (pure): a resolved playbook flattened into the in-game browsing structure — formation →
// set → plays, concept / play-type groups, audible diamonds, favorites and recents — plus 3-per-page paging and the
// URL state of the view. `"sets": "template"` sections are filled from the template save (model/tdb.ts) once it's
// loaded, marked `template` (read-only). No React/DOM; tested in playcallModel.test.ts.
import { resolveLibraryPlay } from "../../model/catalog";
import { categoriesForPlay } from "../../model/conceptsDoc";
import type { LibraryIndex } from "../../model/library";
import { leaf, norm, playSubtitle } from "../../model/names";
import { PLAY_FAMILIES, familyColor, familyLabel, playTypeInfo } from "../../model/playtypes";
import type { ResolvedBook } from "../../model/resolveBook";
import { readConceptLabel } from "../../model/search";
import { SITUATION_LABELS, SITUATION_ORDER, isSituationKey } from "../../model/situations";
import { AUDIBLE_CATEGORY, BUTTON_DIAMOND, type PadButton } from "../../model/audibles";
import { templateFormationFor, type TemplateContents, type TemplateFormation } from "../../model/tdb";
import type { AudibleSlot, ConceptsDoc, FormationDef, PlayEntry, PlayKey, ResolvedPlay, SetDef, SetEntry } from "../../model/types";
import { normalOf, personnelOf } from "../../model/sets";

// ───────────────────────────── book structure ─────────────────────────────

/** One play entry of the playbook (resolved or not). */
export interface CallPlay {
  /**
   * `${f}.${s}.${p}` — indexes into spec.formations / sets / plays. Template plays: f indexes the spec's template
   * section, s / p the template save's sets / plays of that formation.
   */
  id: string;
  f: number;
  s: number;
  p: number;
  entry: PlayEntry;
  play?: ResolvedPlay;
  problem?: string;
  /** Resolved play name, else the name as written. */
  name: string;
  formationName: string;
  setName: string;
  /** "GUN Y TRIPS WK". */
  subtitle: string;
  /** Valid audible slot (1–4), if any. */
  audible?: AudibleSlot;
  cpuCount: number;
  /** From a `"sets": "template"` section: read from the template save, not editable in this file. */
  template?: boolean;
  /** Template play the save files under a set other than its own library set (the game copies it by id). */
  foreign?: boolean;
}

export interface CallSet {
  /** `${f}.${s}`. */
  id: string;
  f: number;
  s: number;
  entry: SetEntry;
  set?: SetDef;
  name: string;
  formationName: string;
  problem?: string;
  plays: CallPlay[];
  /** First play per audible slot (the game allows one). */
  audibles: Partial<Record<AudibleSlot, CallPlay>>;
  /** Slots claimed by more than one play (validation error in the builder). */
  duplicateAudibles: AudibleSlot[];
  /** A set of a `"sets": "template"` section (read-only). */
  template?: boolean;
}

export interface CallFormation {
  /** `${f}`. */
  id: string;
  f: number;
  name: string;
  formation?: FormationDef;
  /** `"sets": "template"` — copied from the template save by the game-side builder. */
  template: boolean;
  /**
   * Template sections only: "ready" = filled from the template save; "pending" = the save isn't loaded (yet);
   * "missing" = the template save has no sets for this formation (tools/pbook-build.mjs stops on that section).
   */
  templateState?: "pending" | "missing" | "ready";
  problem?: string;
  sets: CallSet[];
  playCount: number;
}

export interface CallBook {
  formations: CallFormation[];
  /** Every set, file order (template sections' sets once the template save is loaded). */
  sets: CallSet[];
  /** Every play entry, file order (template plays included, marked `template`). */
  plays: CallPlay[];
  byId: Map<string, CallPlay>;
  /** First entry per resolved play key. */
  byKey: Map<PlayKey, CallPlay>;
}

const isSlot = (v: unknown): v is AudibleSlot => v === 1 || v === 2 || v === 3 || v === 4;

/** The parsed template save + the library it was read against (template plays resolve as library plays). */
export interface TemplateSource {
  contents: TemplateContents;
  lib: LibraryIndex;
}

/**
 * The template formation a `"template"` section copies, the way tools/pbook-build.mjs resolves it: the section's
 * formation (resolved by name and the playbook's side), else another formation of the same name and side that the
 * template save contains.
 */
export function templateFormationForSection(template: TemplateSource, formation: FormationDef | undefined, name: string): TemplateFormation | undefined {
  const direct = templateFormationFor(template.contents, formation);
  if (direct || !name) return direct;
  const side = formation ? template.lib.formationSide(formation) : undefined;
  return template.contents.formations.find(
    (tf) => norm(tf.formation.name) === norm(name) && (!side || template.lib.formationSide(tf.formation) === side) && tf.sets.length > 0,
  );
}

function addAudible(cs: CallSet, cp: CallPlay) {
  if (!cp.audible) return;
  if (cs.audibles[cp.audible]) {
    if (!cs.duplicateAudibles.includes(cp.audible)) cs.duplicateAudibles.push(cp.audible);
  } else cs.audibles[cp.audible] = cp;
}

/**
 * Flatten a resolved playbook (model/resolveBook.ts) into the play-call structure. With `template`, every
 * `"sets": "template"` section gets the template save's sets / plays for its formation (read-only, `template: true`);
 * without it those sections stay empty with `templateState: "pending"`.
 */
export function buildCallBook(book: ResolvedBook, template?: TemplateSource): CallBook {
  const formations: CallFormation[] = [];
  const sets: CallSet[] = [];
  const plays: CallPlay[] = [];
  const byId = new Map<string, CallPlay>();
  const byKey = new Map<PlayKey, CallPlay>();
  const addPlay = (cs: CallSet, cp: CallPlay) => {
    addAudible(cs, cp);
    cs.plays.push(cp);
    plays.push(cp);
    byId.set(cp.id, cp);
    if (cp.play && !byKey.has(cp.play.key)) byKey.set(cp.play.key, cp);
  };

  for (const rf of book.formations) {
    const fName = rf.formation?.name ?? String(rf.entry.formation ?? "");
    const cf: CallFormation = {
      id: String(rf.index),
      f: rf.index,
      name: fName,
      formation: rf.formation,
      template: rf.template,
      problem: rf.problem,
      sets: [],
      playCount: 0,
    };
    if (rf.template) {
      // What the game-side builder copies (formation resolved by side; see templateFormationForSection).
      const tf = template ? templateFormationForSection(template, rf.formation, fName) : undefined;
      cf.templateState = !template ? "pending" : tf && tf.sets.length ? "ready" : "missing";
      tf?.sets.forEach((ts, si) => {
        const sName = ts.set.name;
        const subtitle = playSubtitle(fName, sName);
        const entry: SetEntry = { set: sName, plays: [] };
        const cs: CallSet = {
          id: `${rf.index}.${si}`,
          f: rf.index,
          s: si,
          entry,
          set: ts.set,
          name: sName,
          formationName: fName,
          plays: [],
          audibles: {},
          duplicateAudibles: [],
          template: true,
        };
        ts.plays.forEach((tp, pi) => {
          const pEntry: PlayEntry = { play: tp.play.name };
          if (tp.audible) pEntry.audible = tp.audible;
          if (tp.cpu) pEntry.cpu = { ...tp.cpu };
          entry.plays.push(pEntry);
          const cp: CallPlay = {
            id: `${rf.index}.${si}.${pi}`,
            f: rf.index,
            s: si,
            p: pi,
            entry: pEntry,
            play: resolveLibraryPlay(template!.lib, tp.play),
            name: tp.play.name,
            formationName: fName,
            setName: sName,
            subtitle,
            audible: tp.audible,
            cpuCount: tp.cpu ? Object.keys(tp.cpu).length : 0,
            template: true,
          };
          if (tp.foreign) cp.foreign = true;
          addPlay(cs, cp);
        });
        cf.playCount += cs.plays.length;
        cf.sets.push(cs);
        sets.push(cs);
      });
      formations.push(cf);
      continue;
    }
    for (const rs of rf.sets) {
      const sName = rs.set?.name ?? String(rs.entry.set ?? "");
      const cs: CallSet = {
        id: `${rf.index}.${rs.index}`,
        f: rf.index,
        s: rs.index,
        entry: rs.entry,
        set: rs.set,
        name: sName,
        formationName: fName,
        problem: rs.problem,
        plays: [],
        audibles: {},
        duplicateAudibles: [],
      };
      const subtitle = playSubtitle(fName, sName);
      for (const rp of rs.plays) {
        const audible = isSlot(rp.entry.audible) ? rp.entry.audible : undefined;
        const cpu = rp.entry.cpu;
        addPlay(cs, {
          id: `${rf.index}.${rs.index}.${rp.index}`,
          f: rf.index,
          s: rs.index,
          p: rp.index,
          entry: rp.entry,
          play: rp.play,
          problem: rp.problem,
          name: rp.play?.name ?? String(rp.entry.play ?? ""),
          formationName: fName,
          setName: sName,
          subtitle,
          audible,
          cpuCount: cpu && typeof cpu === "object" && !Array.isArray(cpu) ? Object.keys(cpu).length : 0,
        });
      }
      cf.playCount += cs.plays.length;
      cf.sets.push(cs);
      sets.push(cs);
    }
    formations.push(cf);
  }
  return { formations, sets, plays, byId, byKey };
}

// ───────────────────────────── groups (concept / play type) ─────────────────────────────

export interface CallGroup {
  id: string;
  label: string;
  /** Small line above the label (parent category, "Read concept", "Run scheme"…). */
  eyebrow?: string;
  /** Accent color (category color or a play-type CSS variable). */
  color?: string;
  items: CallPlay[];
}

export interface ConceptGrouping {
  /** "tags" = app-data/concepts.json categories; "reads" = fallback from read concepts / run schemes. */
  source: "tags" | "reads";
  groups: CallGroup[];
}

/** "Concept_Y_Cross" → "Y Cross"; "Concept_Invalid"/empty → undefined (the shared model/search.ts helper). */
export { readConceptLabel };

const NOT_A_RUN_SCHEME = /^(CODE_DETERMINE|Pass|PAScreen|Fake.*|.*Protection)$/i;

/** Run blocking scheme asset → "Inside Zone", "Power", "Buck Sweep"…; pass protections / "determine" → undefined. */
export function runSchemeLabel(blocking: string | undefined): string | undefined {
  if (!blocking) return undefined;
  const l = leaf(blocking);
  if (!l || NOT_A_RUN_SCHEME.test(l)) return undefined;
  const label = l
    .replace(/^(BT|Code_)/i, "")
    .replace(/_+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\bIso\b/i, "Iso")
    .trim();
  return label ? label.replace(/\b\w/g, (c) => c.toUpperCase()) : undefined;
}

/** Distinct read concepts of a play, in read order. */
export function playReadConcepts(play: ResolvedPlay): string[] {
  const out: string[] = [];
  for (const r of play.reads ?? []) {
    const label = readConceptLabel(typeof r.concept === "string" ? r.concept : undefined);
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

/**
 * CONCEPT tab groups. With concept tags on any of the book's plays: one group per tagged category (doc order, direct
 * tags) plus "Untagged". Otherwise the fallback: read concepts (Concept_Mesh → "Mesh"), run blocking schemes for run
 * plays without one, then "Other". Group order follows the first appearance in the file.
 */
export function conceptGroups(book: CallBook, doc: ConceptsDoc | null | undefined): ConceptGrouping {
  const resolved = book.plays.filter((i) => i.play);
  const tagged = doc && Array.isArray(doc.categories) && doc.categories.length > 0 && resolved.some((i) => categoriesForPlay(doc, i.play!.key).length > 0);

  if (tagged && doc) {
    const byId = new Map(doc.categories.map((c) => [c.id, c]));
    const groups = new Map<string, CallGroup>();
    for (const c of doc.categories) {
      const parent = c.parent ? byId.get(c.parent) : undefined;
      groups.set(c.id, {
        id: `cat:${c.id}`,
        label: c.name,
        eyebrow: parent ? parent.name : c.group === "pass" ? "Pass concept" : c.group === "run" ? "Run concept" : "Category",
        color: c.color,
        items: [],
      });
    }
    const untagged: CallGroup = { id: "untagged", label: "Untagged", eyebrow: "No category", items: [] };
    for (const i of resolved) {
      const cats = categoriesForPlay(doc, i.play!.key);
      if (!cats.length) untagged.items.push(i);
      for (const c of cats) groups.get(c.id)?.items.push(i);
    }
    const out = [...groups.values()].filter((g) => g.items.length);
    if (untagged.items.length) out.push(untagged);
    return { source: "tags", groups: out };
  }

  const groups = new Map<string, CallGroup>();
  const other: CallGroup = { id: "other", label: "Other", eyebrow: "No concept", items: [] };
  const add = (id: string, label: string, eyebrow: string, item: CallPlay) => {
    let g = groups.get(id);
    if (!g) groups.set(id, (g = { id, label, eyebrow, items: [] }));
    g.items.push(item);
  };
  for (const i of resolved) {
    const play = i.play!;
    const reads = playReadConcepts(play);
    if (reads.length) {
      for (const r of reads) add(`read:${norm(r)}`, r, "Read concept", i);
      continue;
    }
    const fam = playTypeInfo(play.playType).family;
    const scheme = fam === "run" || fam === "option" ? runSchemeLabel(play.blocking) : undefined;
    if (scheme) add(`run:${norm(scheme)}`, scheme, "Run scheme", i);
    else other.items.push(i);
  }
  const out = [...groups.values()];
  if (other.items.length) out.push(other);
  return { source: "reads", groups: out };
}

const DEFENSE_GROUPS: { id: string; label: string; test: RegExp }[] = [
  { id: "def:blitz", label: "Blitz", test: /^DefensePlayType_Blitz/ },
  { id: "def:man", label: "Man", test: /^DefensePlayType_Man/ },
  { id: "def:zone", label: "Zone", test: /^DefensePlayType_(Zone|GoalLineZone|Prevent)/ },
  { id: "def:special", label: "Special", test: /^DefensePlayType_(FG|Block|Return)/ },
];

/** PLAY TYPE tab: PASS / RUN / PLAY ACTION / SCREEN / RPO / OPTION / SPECIAL / OTHER (defense: BLITZ / MAN / ZONE / SPECIAL). */
/** Plays grouped by their set's offensive personnel ("11 Personnel", "12 Personnel"…), fewest backs / TEs first. */
export function personnelGroups(book: CallBook): CallGroup[] {
  const groups = new Map<string, CallGroup>();
  for (const set of book.sets) {
    const code = set.set ? personnelOf(normalOf(set.set)) : undefined;
    if (!code || !set.plays.length) continue;
    let g = groups.get(code);
    if (!g) {
      const backs = Number(code[0]);
      const tes = Number(code[1]);
      groups.set(code, (g = { id: `pers:${code}`, label: `${code} Personnel`, eyebrow: `${backs} RB · ${tes} TE · ${5 - backs - tes} WR`, items: [] }));
    }
    g.items.push(...set.plays);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map((e) => e[1]);
}

export function typeGroups(book: CallBook): CallGroup[] {
  const groups = new Map<string, CallGroup>();
  const order: string[] = [];
  const add = (id: string, make: () => Omit<CallGroup, "items">, item: CallPlay) => {
    let g = groups.get(id);
    if (!g) groups.set(id, (g = { ...make(), items: [] }));
    g.items.push(item);
  };
  for (const i of book.plays) {
    if (!i.play) continue;
    const info = playTypeInfo(i.play.playType);
    if (info.family === "defense" || (i.play.side === "defense" && info.family === "other")) {
      const d = DEFENSE_GROUPS.find((g) => g.test.test(i.play!.playType));
      const id = d?.id ?? "def:other";
      add(id, () => ({ id, label: d?.label ?? "Other", eyebrow: "Defense", color: familyColor("defense") }), i);
      continue;
    }
    add(info.family, () => ({ id: info.family, label: familyLabel(info.family), eyebrow: "Play type", color: familyColor(info.family) }), i);
  }
  for (const f of PLAY_FAMILIES) if (f !== "defense") order.push(f);
  order.push(...DEFENSE_GROUPS.map((g) => g.id), "def:other");
  return order.map((id) => groups.get(id)).filter((g): g is CallGroup => !!g);
}

/** Favorites / recents restricted to this playbook (first entry per play key), in list order. */
export function playsForKeys(book: CallBook, keys: readonly PlayKey[]): CallPlay[] {
  const out: CallPlay[] = [];
  const seen = new Set<string>();
  for (const k of keys) {
    const i = book.byKey.get(k);
    if (i && !seen.has(i.id)) {
      seen.add(i.id);
      out.push(i);
    }
  }
  return out;
}

// ───────────────────────────── paging ─────────────────────────────

/** Cards per page, like the game. */
export const PAGE_SIZE = 3;

export const pageCount = (n: number, size = PAGE_SIZE): number => Math.max(1, Math.ceil(n / size));
export const clampPage = (page: number, n: number, size = PAGE_SIZE): number =>
  Math.min(Math.max(0, Number.isFinite(page) ? Math.floor(page) : 0), pageCount(n, size) - 1);
export const pageOf = (index: number, size = PAGE_SIZE): number => (index > 0 ? Math.floor(index / size) : 0);
export function pageSlice<T>(items: readonly T[], page: number, size = PAGE_SIZE): T[] {
  const p = clampPage(page, items.length, size);
  return items.slice(p * size, p * size + size);
}

// ───────────────────────────── view state (URL) ─────────────────────────────

export type PlayCallTab = "formation" | "concept" | "type" | "personnel" | "audibles" | "favorites" | "recent";

export const PLAYCALL_TABS: { id: PlayCallTab; label: string }[] = [
  { id: "formation", label: "Formation" },
  { id: "concept", label: "Concept" },
  { id: "type", label: "Play Type" },
  { id: "personnel", label: "Personnel Group" },
  { id: "audibles", label: "Audibles" },
  { id: "favorites", label: "Favorites" },
  { id: "recent", label: "Recent" },
];

const TAB_IDS = new Set<string>(PLAYCALL_TABS.map((t) => t.id));

export interface CallNav {
  tab: PlayCallTab;
  /** Drill-down path: formation tab [f] / [f, s]; concept / type tab [groupId]; others []. */
  at: string[];
  /** 0-based page at the current level (audibles: the set index). */
  page: number;
  /** Open pre-snap play (CallPlay.id). */
  open?: string;
  flip: boolean;
}

export const DEFAULT_NAV: CallNav = { tab: "formation", at: [], page: 0, flip: false };

/** Query → nav. Unknown values fall back to defaults; the level resolver clamps the rest. */
export function parseNav(q: URLSearchParams): CallNav {
  const tabRaw = q.get("tab") ?? "";
  const tab = (TAB_IDS.has(tabRaw) ? tabRaw : "formation") as PlayCallTab;
  const atRaw = q.get("at") ?? "";
  const at = !atRaw ? [] : tab === "formation" ? atRaw.split("/").filter(Boolean) : [atRaw];
  const pg = Number(q.get("pg"));
  const open = q.get("play") || undefined;
  return { tab, at, page: Number.isFinite(pg) && pg >= 1 ? Math.floor(pg) - 1 : 0, open, flip: q.get("flip") === "1" };
}

/** Nav → "?tab=…&at=…&pg=…&play=…&flip=1" (defaults omitted; "" when everything is default). */
export function navQuery(n: CallNav): string {
  const q = new URLSearchParams();
  if (n.tab !== "formation") q.set("tab", n.tab);
  if (n.at.length) q.set("at", n.at.join("/"));
  if (n.page > 0) q.set("pg", String(n.page + 1));
  if (n.open) q.set("play", n.open);
  if (n.flip) q.set("flip", "1");
  const s = q.toString();
  return s ? `?${s}` : "";
}

// ───────────────────────────── levels ─────────────────────────────

export interface CallContext {
  book: CallBook;
  concepts: ConceptGrouping;
  types: CallGroup[];
  personnel?: CallGroup[];
  favorites: CallPlay[];
  recents: CallPlay[];
}

export interface Crumb {
  label: string;
  at: string[];
}

interface LevelBase {
  /** The valid part of the requested path. */
  at: string[];
  crumbs: Crumb[];
  /** Big heading for the level. */
  title: string;
  /** "Formations", "Sets", "Plays", "Concepts"… (the header count's word). */
  noun: string;
  /** Plays under this level (header count). */
  playCount: number;
}

export type CallLevel =
  | (LevelBase & { kind: "formations"; items: CallFormation[] })
  | (LevelBase & { kind: "sets"; formation: CallFormation; items: CallSet[] })
  | (LevelBase & { kind: "groups"; items: CallGroup[] })
  | (LevelBase & { kind: "plays"; items: CallPlay[]; set?: CallSet; group?: CallGroup })
  | (LevelBase & { kind: "audibles"; items: CallSet[] });

const TAB_TITLE: Record<PlayCallTab, string> = {
  formation: "Formations",
  concept: "Concepts",
  type: "Play Types",
  personnel: "Personnel Groups",
  audibles: "Audibles",
  favorites: "Favorites",
  recent: "Recent",
};

/** Template sections open once the template save filled them; explicit formations always open. */
export function canOpenFormation(f: CallFormation): boolean {
  return !f.template || f.templateState === "ready";
}

const uniqueCount = (groups: CallGroup[]) => new Set(groups.flatMap((g) => g.items.map((i) => i.id))).size;

/** What the tab shows for a drill-down path (invalid path parts are dropped). */
export function resolveLevel(ctx: CallContext, tab: PlayCallTab, at: readonly string[]): CallLevel {
  const root: Crumb = { label: TAB_TITLE[tab], at: [] };
  switch (tab) {
    case "formation": {
      const formations = ctx.book.formations;
      const f = at.length ? formations.find((x) => x.id === at[0]) : undefined;
      if (!f || !canOpenFormation(f)) {
        return {
          kind: "formations",
          items: formations,
          at: [],
          crumbs: [root],
          title: "Formations",
          noun: "Formations",
          playCount: ctx.book.plays.length,
        };
      }
      const fCrumb: Crumb = { label: f.name, at: [f.id] };
      const s = at.length > 1 ? f.sets.find((x) => x.id === `${f.id}.${at[1]}`) : undefined;
      if (!s) {
        return { kind: "sets", formation: f, items: f.sets, at: [f.id], crumbs: [root, fCrumb], title: f.name, noun: "Sets", playCount: f.playCount };
      }
      return {
        kind: "plays",
        items: s.plays,
        set: s,
        at: [f.id, String(s.s)],
        crumbs: [root, fCrumb, { label: s.name, at: [f.id, String(s.s)] }],
        title: s.name,
        noun: "Plays",
        playCount: s.plays.length,
      };
    }
    case "concept":
    case "type":
    case "personnel": {
      const groups = tab === "concept" ? ctx.concepts.groups : tab === "type" ? ctx.types : (ctx.personnel ?? []);
      const g = at.length ? groups.find((x) => x.id === at[0]) : undefined;
      if (!g) {
        return {
          kind: "groups",
          items: groups,
          at: [],
          crumbs: [root],
          title: TAB_TITLE[tab],
          noun: tab === "concept" ? "Concepts" : "Play Types",
          playCount: uniqueCount(groups),
        };
      }
      return {
        kind: "plays",
        items: g.items,
        group: g,
        at: [g.id],
        crumbs: [root, { label: g.label, at: [g.id] }],
        title: g.label,
        noun: "Plays",
        playCount: g.items.length,
      };
    }
    case "audibles": {
      const sets = ctx.book.sets;
      const count = sets.reduce((n, s) => n + Object.keys(s.audibles).length, 0);
      return { kind: "audibles", items: sets, at: [], crumbs: [root], title: "Audibles", noun: "Sets", playCount: count };
    }
    case "favorites":
    case "recent": {
      const items = tab === "favorites" ? ctx.favorites : ctx.recents;
      return { kind: "plays", items, at: [], crumbs: [root], title: TAB_TITLE[tab], noun: "Plays", playCount: items.length };
    }
  }
}

/** Index of the child (at[depth]) within the parent level's items, for landing on its page when backing out. */
function childIndex(ctx: CallContext, tab: PlayCallTab, at: readonly string[]): number {
  if (tab === "formation") {
    if (at.length >= 2) {
      const f = ctx.book.formations.find((x) => x.id === at[0]);
      return f ? f.sets.findIndex((x) => x.id === `${at[0]}.${at[1]}`) : 0;
    }
    return ctx.book.formations.findIndex((x) => x.id === at[0]);
  }
  const groups = tab === "concept" ? ctx.concepts.groups : tab === "type" ? ctx.types : tab === "personnel" ? (ctx.personnel ?? []) : [];
  return groups.findIndex((g) => g.id === at[0]);
}

/** One level up from `at`, on the page that holds where we came from. Undefined at the root. */
export function parentOf(ctx: CallContext, tab: PlayCallTab, at: readonly string[]): { at: string[]; page: number } | undefined {
  if (!at.length) return undefined;
  const i = childIndex(ctx, tab, at);
  return { at: at.slice(0, -1), page: pageOf(Math.max(0, i)) };
}

/** Plays the pre-snap view steps through with ◀ ▶ for a level (audibles: the current set's slots 1–4). */
export function presnapList(level: CallLevel, page: number): CallPlay[] {
  if (level.kind === "plays") return level.items.filter((i) => i.play);
  if (level.kind === "audibles") {
    const set = level.items[Math.min(Math.max(0, page), level.items.length - 1)];
    if (!set) return [];
    return ([1, 2, 3, 4] as AudibleSlot[]).map((sl) => set.audibles[sl]).filter((i): i is CallPlay => !!i?.play);
  }
  return [];
}

/** The neighbour of `id` in `list` (wrapping), or undefined when the list has no other entry. */
export function neighbor(list: readonly CallPlay[], id: string, dir: 1 | -1): CallPlay | undefined {
  if (list.length < 2) return undefined;
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return list[0];
  return list[(i + dir + list.length) % list.length];
}

// ───────────────────────────── card text ─────────────────────────────

/** Dark stat chip on a card: the audible (shown as its glyph + category, e.g. [A] RUN) and the CPU-weight count. */
export interface CardStat {
  audible?: AudibleSlot;
  /** "Run", "Play Action"… (defense: "Audible 2" — the categories are offense-only). */
  audibleLabel?: string;
  /** "3 CPU". */
  cpu?: string;
}

/** Stat chip parts for a play card (undefined when neither an audible nor CPU weights apply). */
export function cardStat(item: CallPlay): CardStat | undefined {
  const out: CardStat = {};
  if (item.audible) {
    out.audible = item.audible;
    out.audibleLabel = item.play?.side === "defense" ? `Audible ${item.audible}` : AUDIBLE_CATEGORY[item.audible];
  }
  if (item.cpuCount) out.cpu = `${item.cpuCount} CPU`;
  return out.audible || out.cpu ? out : undefined;
}

export interface CpuRow {
  key: string;
  label: string;
  weight: number;
  /** False for keys outside FORMATS.md's list (the builder rejects them). */
  known: boolean;
}

/** CPU weights in the contract's situation order; unknown keys last. Non-numeric weights are skipped. */
export function cpuRows(cpu: PlayEntry["cpu"] | unknown): CpuRow[] {
  if (!cpu || typeof cpu !== "object" || Array.isArray(cpu)) return [];
  const rank = (k: string) => {
    const i = SITUATION_ORDER.indexOf(k);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return Object.entries(cpu as Record<string, unknown>)
    .filter((e): e is [string, number] => typeof e[1] === "number" && Number.isFinite(e[1]))
    .map(([key, weight]) => ({ key, weight, known: isSituationKey(key), label: isSituationKey(key) ? SITUATION_LABELS[key] : key }))
    .sort((a, b) => rank(a.key) - rank(b.key));
}

/** "3 SETS · 19 PLAYS" for a formation tile ("From template · 3 sets · 40 plays" for a loaded template section). */
export function formationSummary(f: CallFormation): string {
  const s = f.sets.length;
  const counts = `${s} set${s === 1 ? "" : "s"} · ${f.playCount} play${f.playCount === 1 ? "" : "s"}`;
  if (!f.template) return counts;
  if (f.templateState === "missing") return "From template · not in the template save";
  return f.templateState === "ready" ? `From template · ${counts}` : "From template";
}

// ───────────────────────────── audible diamond ─────────────────────────────

export type DiamondPos = "top" | "left" | "right" | "bottom";

const DIAMOND_ORDER: DiamondPos[] = ["top", "left", "right", "bottom"];

/**
 * Where each audible slot sits in the face-button diamond (Y top, X left, B right, A bottom) for the configured
 * buttons. Slots on non-face buttons (or sharing a spot) take the free spots in slot order.
 */
export function diamondPositions(buttons: Record<AudibleSlot, PadButton>): Record<AudibleSlot, DiamondPos> {
  const out = {} as Record<AudibleSlot, DiamondPos>;
  const used = new Set<DiamondPos>();
  const slots: AudibleSlot[] = [1, 2, 3, 4];
  for (const sl of slots) {
    const pos = BUTTON_DIAMOND[buttons[sl]];
    if (pos && !used.has(pos)) {
      out[sl] = pos;
      used.add(pos);
    }
  }
  for (const sl of slots) {
    if (out[sl]) continue;
    const free = DIAMOND_ORDER.find((p) => !used.has(p))!;
    out[sl] = free;
    used.add(free);
  }
  return out;
}
