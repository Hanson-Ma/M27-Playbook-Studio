// Which plays the tagging workspace lists: a playbook, every custom play, a library formation › set, a catalog
// search, or every tagged play. Plain functions (memoized by the caller / per library index).
import type { Catalog } from "../../model/catalog";
import { bookPlayRefs } from "../../model/concepts";
import type { LibraryIndex } from "../../model/library";
import { formationShort } from "../../model/names";
import type { ConceptsDoc, PlayKey, PlaybookSpec, ResolvedPlay } from "../../model/types";
import { resolvedBook, type ScopeKind, type SideFilter } from "./store";

export interface ScopeInput {
  scope: ScopeKind;
  book?: PlaybookSpec;
  set?: string;
  query: string;
  side: SideFilter;
  doc: ConceptsDoc | null;
}

export interface ScopeResult {
  plays: ResolvedPlay[];
  /** Group label per play for "group by set" (e.g. "GUN Y TRIPS WK"). */
  groupOf: (p: ResolvedPlay) => string;
  /** Plays the scope names but the catalog can't resolve. */
  missing: number;
  /** Search: total matches before the cap. */
  total?: number;
  /** Shown instead of rows when there's nothing to list yet (e.g. no query). */
  idle?: string;
}

export const SEARCH_CAP = 3000;

const subtitleCache = new WeakMap<LibraryIndex, Map<string, string>>();

/** "GUN Y TRIPS WK" for a set asset (cached per library). */
export function setLabel(lib: LibraryIndex, setAsset: string): string {
  let m = subtitleCache.get(lib);
  if (!m) subtitleCache.set(lib, (m = new Map()));
  let label = m.get(setAsset);
  if (label === undefined) {
    const set = lib.setByAsset.get(setAsset);
    const form = set ? lib.formationByAsset.get(set.formation) : undefined;
    const f = form ? formationShort(form.name) : "";
    const s = set?.name.toUpperCase() ?? setAsset.split("/").pop() ?? "";
    label = f && s && f !== s ? `${f} ${s}` : f || s;
    m.set(setAsset, label);
  }
  return label;
}

interface SearchIndex {
  assets: string[];
  hay: string[];
  names: string[];
  sides: ("offense" | "defense" | "special")[];
}

const searchCache = new WeakMap<LibraryIndex, SearchIndex>();

function searchIndex(lib: LibraryIndex): SearchIndex {
  let ix = searchCache.get(lib);
  if (ix) return ix;
  const assets: string[] = [];
  const hay: string[] = [];
  const names: string[] = [];
  const sides: SearchIndex["sides"] = [];
  for (const p of lib.data.plays) {
    const set = lib.setByAsset.get(p.set);
    const form = set ? lib.formationByAsset.get(set.formation) : undefined;
    const type = (p.offensePlayType !== "OffensePlayType_DontCare" ? p.offensePlayType : p.defensePlayType).replace(/^(Offense|Defense)PlayType_/, "");
    assets.push(p.asset);
    names.push(p.name.toLowerCase());
    hay.push(`${p.name} ${form?.name ?? ""} ${set?.name ?? ""} ${form ? formationShort(form.name) : ""} ${type}`.toLowerCase());
    sides.push(form ? lib.formationSide(form) : "offense");
  }
  ix = { assets, hay, names, sides };
  searchCache.set(lib, ix);
  return ix;
}

/** Every term must appear in name/formation/set/type; name matches rank first. */
export function searchPlays(catalog: Catalog, query: string, side: SideFilter): { plays: ResolvedPlay[]; total: number } {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return { plays: [], total: 0 };
  const ix = searchIndex(catalog.lib);
  const sideOk = (s: string) => side === "all" || s === side || (side === "offense" && s === "special");
  const first: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < ix.assets.length; i++) {
    if (!sideOk(ix.sides[i])) continue;
    const h = ix.hay[i];
    if (!terms.every((t) => h.includes(t))) continue;
    (terms.every((t) => ix.names[i].includes(t)) ? first : rest).push(ix.assets[i]);
  }
  const custom = catalog.custom.filter((p) => {
    if (!sideOk(p.side)) return false;
    const h = `${p.name} ${setLabel(catalog.lib, p.set)} ${p.playType}`.toLowerCase();
    return terms.every((t) => h.includes(t));
  });
  const keys = [...first, ...rest];
  const total = keys.length + custom.length;
  const plays = [...custom];
  for (const k of keys) {
    if (plays.length >= SEARCH_CAP) break;
    const p = catalog.get(k);
    if (p) plays.push(p);
  }
  return { plays, total };
}

export function scopePlays(input: ScopeInput, catalog: Catalog): ScopeResult {
  const lib = catalog.lib;
  const bySet = (p: ResolvedPlay) => setLabel(lib, p.set);
  switch (input.scope) {
    case "book": {
      if (!input.book) return { plays: [], groupOf: bySet, missing: 0, idle: "Pick a playbook" };
      const rb = resolvedBook(input.book, catalog);
      const seen = new Set<PlayKey>();
      const plays: ResolvedPlay[] = [];
      const label = new Map<PlayKey, string>();
      for (const r of bookPlayRefs(rb)) {
        if (seen.has(r.play.key)) continue;
        seen.add(r.play.key);
        plays.push(r.play);
        label.set(r.play.key, `${formationShort(r.formation)} ${r.set.toUpperCase()}`);
      }
      return { plays, groupOf: (p) => label.get(p.key) ?? bySet(p), missing: rb.counts.unresolved };
    }
    case "custom":
      return { plays: catalog.custom.filter((p) => !!p.set), groupOf: bySet, missing: 0 };
    case "set": {
      if (!input.set) return { plays: [], groupOf: bySet, missing: 0, idle: "Pick a formation and set" };
      return { plays: catalog.playsInSet(input.set), groupOf: bySet, missing: 0 };
    }
    case "search": {
      if (!input.query.trim()) return { plays: [], groupOf: bySet, missing: 0, idle: `Search ${lib.data.plays.length.toLocaleString()} library plays and every custom play` };
      const r = searchPlays(catalog, input.query, input.side);
      return { plays: r.plays, groupOf: bySet, missing: 0, total: r.total };
    }
    case "tagged": {
      const keys = Object.keys(input.doc?.tags ?? {}).filter((k) => (input.doc?.tags?.[k]?.length ?? 0) > 0);
      const plays: ResolvedPlay[] = [];
      let missing = 0;
      for (const k of keys) {
        const p = catalog.get(k);
        if (p) plays.push(p);
        else missing++;
      }
      plays.sort((a, b) => bySet(a).localeCompare(bySet(b)) || a.name.localeCompare(b.name));
      return { plays, groupOf: bySet, missing, idle: keys.length ? undefined : "No tagged plays yet" };
    }
  }
}
