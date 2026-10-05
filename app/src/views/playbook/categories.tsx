// Concept categories in the builder (brief §3 "filter, group and color by category everywhere"): a shape-checked
// read of app-data/concepts.json, category filter chips for play lists, and small color dots for rows and cards.
// A hand-edited concepts.json with the wrong shape simply shows no categories here instead of crashing the builder.
import { useMemo } from "react";
import { CONCEPTS_PATH, categoriesForPlay } from "../../model/conceptsDoc";
import type { ConceptCategory, ConceptsDoc, PlayKey } from "../../model/types";
import { useDoc } from "../../state/workspace";
import { Chip, cx } from "../../ui";
import { categoryOptions, categoryTest, usableConcepts } from "./conceptFilter";
import s from "./categories.module.css";

/** The concepts doc (shape-checked), or null when there is none / it didn't load / it has the wrong shape. */
export function useConcepts(): ConceptsDoc | null {
  const doc = useDoc<ConceptsDoc>(CONCEPTS_PATH);
  const data = doc && !doc.error ? doc.data : null;
  return useMemo(() => usableConcepts(data), [data]);
}

export function categoryColor(c: ConceptCategory): string {
  return typeof c.color === "string" && c.color ? c.color : "var(--text-3)";
}

export function categoryName(c: ConceptCategory): string {
  return typeof c.name === "string" && c.name ? c.name : c.id;
}

/** Categories of a play (empty without a usable doc). */
export function playCategories(doc: ConceptsDoc | null, key: PlayKey | undefined): ConceptCategory[] {
  return doc && key ? categoriesForPlay(doc, key) : [];
}

/** Small color dots for a play's categories (nothing when it has none). */
export function CategoryDots({ cats, max = 3, className }: { cats: ConceptCategory[]; max?: number; className?: string }) {
  if (!cats.length) return null;
  const shown = cats.slice(0, max);
  return (
    <span className={cx(s.dots, className)} title={cats.map(categoryName).join(", ")} aria-label={`Concepts: ${cats.map(categoryName).join(", ")}`}>
      {shown.map((c) => (
        <span key={c.id} className={s.dot} style={{ background: categoryColor(c) }} />
      ))}
      {cats.length > max && <span className={s.more}>+{cats.length - max}</span>}
    </span>
  );
}

export interface CategoryFilter {
  /** Categories that tag at least one of the plays (or a descendant does), in doc order, with counts. */
  options: { cat: ConceptCategory; count: number }[];
  /** Does a play pass the active category chips (any of them; none active = everything passes)? */
  test(key: PlayKey): boolean;
}

/**
 * Category chips for a list of plays. `active` are category ids; a play passes when it is tagged with an active
 * category or one of its descendants.
 */
export function useCategoryFilter(doc: ConceptsDoc | null, keys: readonly PlayKey[], active: readonly string[]): CategoryFilter {
  const options = useMemo(() => categoryOptions(doc, keys), [doc, keys]);
  const test = useMemo(() => categoryTest(doc, active), [doc, active]);
  return useMemo(() => ({ options, test }), [options, test]);
}

/** A wrapping row of category chips (renders nothing when no category applies). */
export function CategoryChips({
  filter,
  active,
  onChange,
  className,
}: {
  filter: CategoryFilter;
  active: readonly string[];
  onChange(next: string[]): void;
  className?: string;
}) {
  if (!filter.options.length) return null;
  return (
    <div className={cx(s.chips, className)} role="group" aria-label="Concept categories">
      <span className={s.label}>Concepts</span>
      {filter.options.map(({ cat, count }) => (
        <Chip
          key={cat.id}
          active={active.includes(cat.id)}
          color={categoryColor(cat)}
          count={count}
          onClick={() => onChange(active.includes(cat.id) ? active.filter((x) => x !== cat.id) : [...active, cat.id])}
        >
          {categoryName(cat)}
        </Chip>
      ))}
    </div>
  );
}
