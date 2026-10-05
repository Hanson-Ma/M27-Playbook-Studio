// Small shared playbook mutations used outside the builder (library "add to playbook", designer, play-call).
// Operate on immer drafts or plain objects; never rebuild entries (unknown keys must survive).
// Names resolve exactly like tools/pbook-build.mjs (resolveBook.ts `bookFormation`: by the playbook's side, preferring a
// formation the template save contains); pass `{ template }` (useTemplate().contents) when you have it.
import type { Catalog } from "./catalog";
import type { LibraryIndex } from "./library";
import { norm } from "./names";
import { bookFormation, bookSide, formationBookSide, isCustomSet, type ResolveOptions } from "./resolveBook";
import type { FormationDef, FormationEntry, PlayEntry, PlayKey, PlaybookSpec, SetEntry, Side } from "./types";

export interface PlayLocation {
  f: number;
  s: number;
  p: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const formationsOf = (spec: PlaybookSpec): unknown[] => (isObj(spec) && Array.isArray(spec.formations) ? spec.formations : []);
const nameOf = (v: unknown) => (typeof v === "string" ? v : "");

/** Where a play already sits in a playbook (first match), resolving names like the game-side builder. */
export function locatePlay(spec: PlaybookSpec, catalog: Catalog, key: PlayKey, opts: ResolveOptions = {}): PlayLocation | undefined {
  const lib = catalog.lib;
  const side = bookSide(spec);
  const list = formationsOf(spec);
  for (let f = 0; f < list.length; f++) {
    const fe = list[f];
    if (!isObj(fe) || !Array.isArray(fe.sets)) continue;
    const formation = bookFormation(lib, nameOf(fe.formation), side, opts);
    if (!formation) continue;
    for (let s = 0; s < fe.sets.length; s++) {
      const se: unknown = fe.sets[s];
      if (!isObj(se) || !Array.isArray(se.plays)) continue;
      const set = lib.setByName(formation, nameOf(se.set));
      if (!set) continue;
      for (let p = 0; p < se.plays.length; p++) {
        const pe: unknown = se.plays[p];
        if (!isObj(pe)) continue;
        const play = catalog.playInSetByName(set.asset, nameOf(pe.play));
        if (play?.key === key) return { f, s, p };
      }
    }
  }
  return undefined;
}

/** "Offense/Special (formId 12)" */
const formationLabel = (f: FormationDef) => `${f.asset.split("/").slice(-3, -1).join("/")} (formId ${f.formId})`;

/**
 * Why tools/pbook-build.mjs can't find this formation by its display name in a playbook of `side` (default: the
 * formation's own side), or undefined. pbook-build only looks at formations of the playbook's side (so a defense
 * formation can't go in an offense book) and, among formations with the same name, picks one the template save
 * contains, then the one whose folder is named after it, then the first.
 */
export function formationAddressProblem(lib: LibraryIndex, formation: FormationDef, side?: Side, opts: ResolveOptions = {}): string | undefined {
  const own = formationBookSide(formation);
  const s = side ?? own;
  if (own !== s) return `${formation.name} is a${own === "offense" ? "n offense" : " defense"} formation — it can't go in a${s === "offense" ? "n offense" : " defense"} playbook`;
  const picked = bookFormation(lib, formation.name, s, opts);
  if (picked?.asset === formation.asset) return undefined;
  return `Formation "${formation.name}" shares its name with ${picked ? formationLabel(picked) : "another formation"}; the game-side builder picks that one`;
}

/**
 * Why a play can't be referenced by display name from a playbook of `side` (names repeat across folders), or undefined.
 * Mirrors tools/pbook-build.mjs exactly: formation by name for the playbook's side, set inside the formation folder
 * (library sets before custom sets), play inside the set (library plays before clones and custom plays).
 */
export function nameAddressProblem(catalog: Catalog, key: PlayKey, side?: Side, opts: ResolveOptions = {}): string | undefined {
  const play = catalog.get(key);
  if (!play) return "Unknown play";
  const lib = catalog.lib;
  const formation = lib.formationByAsset.get(play.formation);
  const set = lib.setByAsset.get(play.set);
  if (!formation || !set) return "Play has no formation/set";
  const fp = formationAddressProblem(lib, formation, side, opts);
  if (fp) return fp;
  const bySetName = lib.setByName(formation, set.name);
  if (bySetName?.asset !== set.asset)
    return bySetName && !isCustomSet(lib, bySetName) && isCustomSet(lib, set)
      ? `A library set in ${formation.name} is also named "${set.name}" (the game-side builder picks the library set; rename the custom set)`
      : `Set "${set.name}" shares its name with another set in ${formation.name}`;
  const byName = catalog.playInSetByName(set.asset, play.name);
  if (byName?.key !== play.key)
    return byName?.source === "library" && play.source === "custom"
      ? `A library play in ${set.name} is also named "${play.name}" (the game-side builder picks the library play; rename the custom play)`
      : `Another play in ${set.name} is also named "${play.name}"`;
  return undefined;
}

/** Template ("sets": "template") formation entries that resolve to `formation` (by the playbook's side). */
function templateEntriesFor(spec: PlaybookSpec, lib: LibraryIndex, formation: FormationDef, opts: ResolveOptions): FormationEntry[] {
  const side = bookSide(spec);
  return formationsOf(spec).filter(
    (fe): fe is FormationEntry => isObj(fe) && fe.sets === "template" && bookFormation(lib, nameOf(fe.formation), side, opts)?.asset === formation.asset,
  );
}

/**
 * Why addPlayToSpec would refuse this play for this playbook, or undefined (it may still be "already in the book").
 * nameAddressProblem (by the book's side), plus: the play's formation is a `"template"` section of the book (adding an
 * explicit copy would write the formation and its sets twice) — convert it to explicit first.
 */
export function addPlayProblem(spec: PlaybookSpec, catalog: Catalog, key: PlayKey, opts: ResolveOptions = {}): string | undefined {
  if (!isObj(spec) || (spec.formations !== undefined && !Array.isArray(spec.formations))) return `This playbook's "formations" isn't a list`;
  const problem = nameAddressProblem(catalog, key, bookSide(spec), opts);
  if (problem) return problem;
  if (locatePlay(spec, catalog, key, opts)) return undefined;
  const play = catalog.get(key)!;
  const formation = catalog.lib.formationByAsset.get(play.formation)!;
  const tpl = templateEntriesFor(spec, catalog.lib, formation, opts);
  if (tpl.length) return `Convert ${tpl[0].formation} to explicit first (it's a "template" section in this playbook)`;
  return undefined;
}

/** Audible slots already used in the playbook by plays of `setAsset` (every explicit set entry that resolves to it). */
function audiblesInSet(spec: PlaybookSpec, catalog: Catalog, setAsset: string, opts: ResolveOptions): Set<unknown> {
  const lib = catalog.lib;
  const side = bookSide(spec);
  const used = new Set<unknown>();
  for (const fe of formationsOf(spec)) {
    if (!isObj(fe) || !Array.isArray(fe.sets)) continue;
    const formation = bookFormation(lib, nameOf(fe.formation), side, opts);
    if (!formation) continue;
    for (const se of fe.sets as unknown[]) {
      if (!isObj(se) || !Array.isArray(se.plays) || lib.setByName(formation, nameOf(se.set))?.asset !== setAsset) continue;
      for (const pe of se.plays as unknown[]) if (isObj(pe) && pe.audible !== undefined) used.add(pe.audible);
    }
  }
  return used;
}

/**
 * Add a play (library, custom or cloned into a custom set) to a playbook, creating the formation/set entries if needed.
 * New formations go before the first "template" (special teams) section. Returns where it is and whether it was added.
 * Throws when the play can't be addressed by name for the book's side (see nameAddressProblem) or its formation is a
 * "template" section of the book (see addPlayProblem). An `extra.audible` slot another play of the same set already
 * uses is dropped (`audibleDropped`) — one play per audible slot per in-game set.
 */
export function addPlayToSpec(
  spec: PlaybookSpec,
  catalog: Catalog,
  key: PlayKey,
  extra: Omit<Partial<PlayEntry>, "play"> = {},
  opts: ResolveOptions = {},
): PlayLocation & { added: boolean; audibleDropped?: boolean } {
  const problem = addPlayProblem(spec, catalog, key, opts);
  if (problem) throw new Error(problem);
  const side = bookSide(spec);
  const play = catalog.get(key)!;
  const lib = catalog.lib;
  const formation = lib.formationByAsset.get(play.formation)!;
  const set = lib.setByAsset.get(play.set)!;

  const existing = locatePlay(spec, catalog, key, opts);
  if (existing) return { ...existing, added: false };

  spec.formations ??= [];
  let f = spec.formations.findIndex(
    (fe) => isObj(fe) && Array.isArray(fe.sets) && bookFormation(lib, nameOf(fe.formation), side, opts)?.asset === formation.asset,
  );
  if (f < 0) {
    const firstTemplate = spec.formations.findIndex((fe) => isObj(fe) && fe.sets === "template");
    f = firstTemplate < 0 ? spec.formations.length : firstTemplate;
    spec.formations.splice(f, 0, { formation: formation.name, sets: [] });
  }
  const sets = spec.formations[f].sets as SetEntry[];
  let s = sets.findIndex((se) => isObj(se) && Array.isArray(se.plays) && lib.setByName(formation, nameOf(se.set))?.asset === set.asset);
  if (s < 0) {
    sets.push({ set: set.name, plays: [] });
    s = sets.length - 1;
  }
  const entry: PlayEntry = { play: play.name, ...extra };
  let audibleDropped = false;
  if (entry.audible !== undefined && audiblesInSet(spec, catalog, set.asset, opts).has(entry.audible)) {
    delete entry.audible;
    audibleDropped = true;
  }
  sets[s].plays.push(entry);
  return { f, s, p: sets[s].plays.length - 1, added: true, ...(audibleDropped ? { audibleDropped } : {}) };
}

/** Clear `slot` from every other play in the set and give it to play index `p` (one play per audible slot). */
export function assignAudible(set: SetEntry, p: number, slot: 1 | 2 | 3 | 4 | undefined): void {
  set.plays.forEach((e, i) => {
    if (i !== p && slot !== undefined && e.audible === slot) delete e.audible;
  });
  if (slot === undefined) delete set.plays[p].audible;
  else set.plays[p].audible = slot;
}

/** Case/spacing-insensitive name match used by the game-side builder. */
export const sameName = (a: string, b: string) => norm(a) === norm(b);
