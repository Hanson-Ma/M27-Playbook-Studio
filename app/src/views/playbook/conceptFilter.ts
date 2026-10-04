// Pure helpers behind the builder's concept-category chips and dots (categories.tsx): a shape-checked view of
// app-data/concepts.json, per-category play counts (a parent category counts its children's plays) and the filter test.
import { categoryWithDescendants } from "../../model/conceptsDoc";
import type { ConceptCategory, ConceptsDoc, PlayKey } from "../../model/types";

const sanitized = new WeakMap<object, ConceptsDoc | null>();

/**
 * The doc with only well-formed categories and tag lists, or null when its shape is unusable (a hand-edited
 * concepts.json must not crash the builder). Memoized per doc object.
 */
export function usableConcepts(d: unknown): ConceptsDoc | null {
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const hit = sanitized.get(d);
  if (hit !== undefined) return hit;
  const doc = d as ConceptsDoc;
  let out: ConceptsDoc | null = null;
  if (Array.isArray(doc.categories) && doc.tags && typeof doc.tags === "object" && !Array.isArray(doc.tags)) {
    const categories = doc.categories.filter((c): c is ConceptCategory => !!c && typeof c === "object" && typeof c.id === "string" && !!c.id);
    const tags: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(doc.tags)) if (Array.isArray(v)) tags[k] = v.filter((x): x is string => typeof x === "string");
    out = { ...doc, categories, tags };
  }
  sanitized.set(d, out);
  return out;
}

/** Categories tagging at least one of `keys` (directly or through a child category), in doc order, with play counts. */
export function categoryOptions(doc: ConceptsDoc | null, keys: readonly PlayKey[]): { cat: ConceptCategory; count: number }[] {
  if (!doc || !doc.categories.length) return [];
  const byId = new Map(doc.categories.map((c) => [c.id, c]));
  const counts = new Map<string, number>();
  for (const key of keys) {
    const hit = new Set<string>();
    for (const id of doc.tags[key] ?? []) {
      // The play counts for the category and every ancestor (a parent chip includes its children).
      let cur = byId.get(id);
      const guard = new Set<string>();
      while (cur && !guard.has(cur.id)) {
        guard.add(cur.id);
        hit.add(cur.id);
        cur = typeof cur.parent === "string" ? byId.get(cur.parent) : undefined;
      }
    }
    for (const id of hit) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return doc.categories.filter((c) => counts.has(c.id)).map((cat) => ({ cat, count: counts.get(cat.id)! }));
}

/**
 * Filter test for active category ids: a play passes when it's tagged with an active category or a descendant of one
 * (any active chip; no active chips = everything passes).
 */
export function categoryTest(doc: ConceptsDoc | null, active: readonly string[]): (key: PlayKey) => boolean {
  if (!doc || !active.length) return () => true;
  const ids = new Set<string>();
  for (const id of active) for (const x of categoryWithDescendants(doc, id)) ids.add(x);
  return (key) => !!doc.tags[key]?.some((id) => ids.has(id));
}
