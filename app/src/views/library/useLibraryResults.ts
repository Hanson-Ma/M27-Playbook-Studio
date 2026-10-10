// The library's current results (shared by the grid and the detail view's previous/next), memoized on the search
// index, the deferred query, the filters and the personal lists.
import { useDeferredValue, useMemo } from "react";
import { CONCEPTS_PATH } from "../../model/conceptsDoc";
import { buildSearchIndex, groupResults, orderByKeys, searchPlays, type GroupMode, type PlayFilters, type ResultSection, type SearchEntry, type SearchIndex, type SearchResult } from "../../model/search";
import type { ConceptsDoc } from "../../model/types";
import { useCatalog } from "../../state/library";
import { useSettings } from "../../state/settings";
import { useDoc } from "../../state/workspace";
import { useLibraryUi, type LibTab } from "./libraryStore";

export const TAB_GROUP: Record<LibTab, GroupMode> = {
  formation: "formation",
  concept: "concept",
  type: "family",
  favorites: "none",
  recent: "none",
};

/** Personal lists span the whole library: side / formation / set don't narrow them. */
export const PERSONAL_TABS = new Set<LibTab>(["favorites", "recent"]);

export function useSearchIndex(): SearchIndex | undefined {
  const catalog = useCatalog();
  return useMemo(() => (catalog ? buildSearchIndex(catalog) : undefined), [catalog]);
}

/** The concepts doc when it loaded fine (null otherwise). */
export function useConceptsDoc(): ConceptsDoc | null {
  const doc = useDoc<ConceptsDoc>(CONCEPTS_PATH);
  // A hand-edited file with the wrong shape (categories not a list, tags not an object) is treated as absent.
  const d = doc && !doc.error ? doc.data : null;
  return d && typeof d === "object" && Array.isArray(d.categories) && (d.tags === undefined || (!!d.tags && typeof d.tags === "object" && !Array.isArray(d.tags)))
    ? d
    : null;
}

export interface LibraryResults {
  index?: SearchIndex;
  result?: SearchResult;
  /** Unique entries in display order (personal tabs: list order). */
  entries: SearchEntry[];
  sections: ResultSection[];
  /** True while a typed query hasn't been applied yet. */
  stale: boolean;
}

const EMPTY: SearchEntry[] = [];

export function useLibraryResults(): LibraryResults {
  const index = useSearchIndex();
  const catalog = useCatalog();
  const tab = useLibraryUi((s) => s.tab);
  const query = useLibraryUi((s) => s.query);
  const filters = useLibraryUi((s) => s.filters);
  const favorites = useSettings((s) => s.favorites);
  const recents = useSettings((s) => s.recents);
  const hideMinigames = useSettings((s) => s.hideMinigames);
  const concepts = useConceptsDoc();
  const deferredQuery = useDeferredValue(query);

  const personal = PERSONAL_TABS.has(tab);
  const result = useMemo(() => {
    if (!index) return undefined;
    const f: PlayFilters = personal
      ? { ...filters, side: "all", formation: undefined, set: undefined, hideMinigames: false }
      : { ...filters, hideMinigames };
    return searchPlays(index, deferredQuery, f, { favorites, concepts });
  }, [index, deferredQuery, filters, hideMinigames, favorites, concepts, personal]);

  const entries = useMemo(() => {
    if (!result) return EMPTY;
    if (tab === "favorites") return orderByKeys(result.entries, [...favorites].reverse());
    if (tab === "recent") return orderByKeys(result.entries, recents);
    return result.entries;
  }, [result, tab, favorites, recents]);

  const sections = useMemo(
    () => (catalog ? groupResults(entries, TAB_GROUP[tab], { lib: catalog.lib, concepts }) : []),
    [entries, tab, catalog, concepts],
  );

  return { index, result, entries, sections, stale: deferredQuery !== query };
}
