// Concepts view state that outlives a tab switch (scope, filters, focus, gameplan book) + doc edit helpers.
import { useMemo } from "react";
import { create } from "zustand";
import type { Catalog } from "../../model/catalog";
import { CONCEPTS_PATH } from "../../model/conceptsDoc";
import { dismissedOf, suggestTags, type Suggestion } from "../../model/concepts";
import { resolvePlaybook, type ResolvedBook } from "../../model/resolveBook";
import type { ConceptsDoc, PlayKey, PlaybookSpec, ResolvedPlay } from "../../model/types";
import { useSettings } from "../../state/settings";
import { useDoc, useDocsOfKind, useWorkspace, type DocEntry } from "../../state/workspace";

export type Section = "tag" | "categories" | "run" | "pass" | "situations" | "coverage";

export const SECTIONS: { id: Section; label: string }[] = [
  { id: "tag", label: "Tag Plays" },
  { id: "categories", label: "Categories" },
  { id: "run", label: "Run Matrix" },
  { id: "pass", label: "Pass Matrix" },
  { id: "situations", label: "Situations" },
  { id: "coverage", label: "Coverage" },
];

export const sectionHash = (s: Section) => (s === "tag" ? "#/concepts" : `#/concepts/${s}`);

export type ScopeKind = "book" | "custom" | "set" | "search" | "tagged";
export type SideFilter = "offense" | "defense" | "all";
export type GroupBy = "none" | "set" | "category";

export interface ConceptsUi {
  scope: ScopeKind;
  /** Playbook path for the "book" scope. */
  scopeBook?: string;
  formation?: string;
  setAsset?: string;
  query: string;
  side: SideFilter;
  /** Category filter (any of; descendants count). Shared by every section. */
  filter: string[];
  untagged: boolean;
  suggested: boolean;
  groupBy: GroupBy;
  focus?: PlayKey;
  checked: PlayKey[];
  /** Tagging inspector cursor: a category id, or "s:<id>" for a suggestion. */
  cursor?: string;
  /** Playbook for the gameplan sections. */
  book?: string;
  topLevelOnly: boolean;
  situation: string;
  /** The tag section was opened from another view via ?play= (Esc goes back there). */
  cameFrom?: string;
  /** Where the header's back link goes: the view that opened Concepts (?from=library|playbook). */
  backTo?: "library" | "playbook";
  set(partial: Partial<Omit<ConceptsUi, "set">>): void;
}

export const useConceptsUi = create<ConceptsUi>()((set) => ({
  scope: "book",
  query: "",
  side: "offense",
  filter: [],
  untagged: false,
  suggested: false,
  groupBy: "none",
  checked: [],
  topLevelOnly: false,
  situation: "FirstDown",
  set: (partial) => set(partial),
}));

export const uiSet = (partial: Partial<Omit<ConceptsUi, "set">>) => useConceptsUi.getState().set(partial);

// ───────────────────────────── doc access + edits ─────────────────────────────

export function useConceptsEntry(): DocEntry<ConceptsDoc | null> | undefined {
  return useDoc<ConceptsDoc | null>(CONCEPTS_PATH);
}

export function getConcepts(): ConceptsDoc | null {
  const d = useWorkspace.getState().docs[CONCEPTS_PATH];
  return d && !d.error ? (d.data as ConceptsDoc) : null;
}

/**
 * One undoable edit of app-data/concepts.json. Discrete edits never merge; pass `coalesceMs` for typing
 * (same label inside the window = one undo step).
 */
export function editConcepts(label: string, recipe: (draft: ConceptsDoc) => void, coalesceMs = 0): void {
  if (!getConcepts()) return;
  useWorkspace.getState().update<ConceptsDoc>(CONCEPTS_PATH, recipe, { label, coalesceMs });
}

// ───────────────────────────── playbooks ─────────────────────────────

export interface BookOption {
  path: string;
  label: string;
  spec?: PlaybookSpec;
  error?: string;
}

const fileName = (p: string) => p.slice(p.lastIndexOf("/") + 1).replace(/\.json$/, "");

/** Playbook docs as picker options (broken files are listed but disabled). */
export function useBookOptions(): BookOption[] {
  const docs = useDocsOfKind<PlaybookSpec | null>("playbook");
  return useMemo(
    () =>
      docs.map((d) => ({
        path: d.path,
        label: d.error || !d.data ? `${fileName(d.path)} (unreadable)` : `${String(d.data.name || fileName(d.path))} · ${fileName(d.path)}.json`,
        spec: d.error || !d.data ? undefined : d.data,
        error: d.error,
      })),
    [docs],
  );
}

/** The gameplan book: the chosen one, else the last opened playbook, else the first readable one. */
export function useGameplanBook(): BookOption | undefined {
  const books = useBookOptions();
  const chosen = useConceptsUi((s) => s.book);
  const last = useSettings((s) => s.lastPlaybook);
  return pickBook(books, chosen, last);
}

/** The default playbook (STUDIO) when nothing was chosen or opened yet. */
export const DEFAULT_BOOK = "playbooks/FUSION.json";

export function pickBook(books: BookOption[], chosen?: string, last?: string): BookOption | undefined {
  const ok = books.filter((b) => b.spec);
  return ok.find((b) => b.path === chosen) ?? ok.find((b) => b.path === last) ?? ok.find((b) => b.path === DEFAULT_BOOK) ?? ok[0];
}

const bookCache = new WeakMap<PlaybookSpec, { catalog: Catalog; book: ResolvedBook }>();

/** resolvePlaybook memoized per (spec object, catalog). */
export function resolvedBook(spec: PlaybookSpec, catalog: Catalog): ResolvedBook {
  const hit = bookCache.get(spec);
  if (hit && hit.catalog === catalog) return hit.book;
  const book = resolvePlaybook(spec, catalog);
  bookCache.set(spec, { catalog, book });
  return book;
}

// ───────────────────────────── suggestions (memoized per play) ─────────────────────────────

const sugCache = new WeakMap<ResolvedPlay, { cats: unknown; tags: unknown; dis: unknown; out: Suggestion[] }>();
const NONE: Suggestion[] = [];

/**
 * Suggestions for a play against the doc. The result array is stable while the doc's categories and this play's
 * tags/dismissals are unchanged (immer structural sharing), so memoized rows don't re-render.
 */
export function suggestionsFor(play: ResolvedPlay, doc: ConceptsDoc | null | undefined): Suggestion[] {
  if (!doc) return NONE;
  const cats = doc.categories;
  const tags = doc.tags?.[play.key];
  const dis = dismissedOf(doc)?.[play.key];
  const hit = sugCache.get(play);
  if (hit && hit.cats === cats && hit.tags === tags && hit.dis === dis) return hit.out;
  const res = suggestTags(play, doc, { key: play.key });
  const out = res.length ? res : NONE;
  sugCache.set(play, { cats, tags, dis, out });
  return out;
}
