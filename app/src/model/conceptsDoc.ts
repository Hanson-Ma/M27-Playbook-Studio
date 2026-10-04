// Shared read helpers for app-data/concepts.json (the concepts view owns editing; model/concepts.ts).
import type { ConceptCategory, ConceptsDoc, PlayKey } from "./types";

export const CONCEPTS_PATH = "app-data/concepts.json";

export function emptyConcepts(): ConceptsDoc {
  return { version: 1, categories: [], tags: {}, notes: {} };
}

// concepts.json can be hand-edited: the readers below skip anything that isn't the documented shape instead of
// throwing (a wrong-shaped file must not take down the views that only display tags).
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const categoriesOf = (doc: ConceptsDoc): ConceptCategory[] =>
  Array.isArray(doc.categories) ? doc.categories.filter((c): c is ConceptCategory => isObj(c) && typeof c.id === "string") : [];
const tagsOf = (doc: ConceptsDoc, key: PlayKey): unknown[] => {
  const t = isObj(doc.tags) ? doc.tags[key] : undefined;
  return Array.isArray(t) ? t : [];
};

/** Categories tagged on a play, in category order. */
export function categoriesForPlay(doc: ConceptsDoc | undefined | null, key: PlayKey): ConceptCategory[] {
  if (!isObj(doc)) return [];
  const ids = new Set(tagsOf(doc, key));
  return categoriesOf(doc).filter((c) => ids.has(c.id));
}

/** Category plus all of its descendants (nesting via `parent`). */
export function categoryWithDescendants(doc: ConceptsDoc, id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of categoriesOf(doc))
      if (c.parent && out.has(c.parent) && !out.has(c.id)) {
        out.add(c.id);
        grew = true;
      }
  }
  return out;
}

/** Play keys tagged with a category or any of its descendants. */
export function playsInCategory(doc: ConceptsDoc, id: string): PlayKey[] {
  const ids = categoryWithDescendants(doc, id);
  return Object.entries(isObj(doc.tags) ? doc.tags : {})
    .filter(([, tags]) => Array.isArray(tags) && tags.some((t) => ids.has(t)))
    .map(([key]) => key);
}
