// Concepts & categories (app-data/concepts.json — editor-only, FORMATS.md §4; the concepts view owns editing).
// Seeds and colors, slug ids, the category tree (nesting without cycles), category/tag/note ops on a doc (immer
// draft or plain object), the tag-suggestion engine (with reasons) and gameplan queries over a ResolvedBook.
// Pure TS: no React/DOM. Read-only helpers shared with other views live in conceptsDoc.ts.
import { maddenName } from "./names";
import { playTypeInfo } from "./playtypes";
import type { ResolvedBook } from "./resolveBook";
import type {
  AudibleSlot,
  CategoryGroup,
  ConceptCategory,
  ConceptsDoc,
  PlayEntry,
  PlayKey,
  ReadDef,
  ResolvedPlay,
} from "./types";

// ───────────────────────────── groups, seeds, colors ─────────────────────────────

export const CATEGORY_GROUPS: CategoryGroup[] = ["pass", "run", "other"];

export const GROUP_LABEL: Record<CategoryGroup, string> = { pass: "Pass", run: "Run", other: "Other" };

/** Default categories for a new concepts file (WEB_APP_PROMPT §3). */
export const SEED_CATEGORIES: Record<CategoryGroup, string[]> = {
  pass: [
    "Mesh", "Snag", "Smash", "Flood", "Y-Cross", "Dagger", "Stick", "Spacing", "Curl-Flat", "Four Verticals", "Drive",
    "Levels", "Shallow Cross", "Slants", "Spot", "China", "Divide",
  ],
  run: ["Inside Zone", "Outside Zone", "Counter", "Power", "Duo", "Toss", "Trap", "Draw", "ISO", "Sweep", "Dive", "QB Run"],
  other: ["Screens", "Play Action", "RPO", "Option", "Trick", "Goal Line", "Two-minute", "Red Zone", "Shot Play", "Base"],
};

/** HSL (deg, %, %) → "#rrggbb". */
export function hslToHex(h: number, s: number, l: number): string {
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const lig = Math.max(0, Math.min(100, l)) / 100;
  const hue = ((h % 360) + 360) % 360;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    const v = lig - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Each group spreads its colors evenly around the wheel (consecutive seeds jump far apart) at its own lightness, so
// colors are distinct inside a column and the groups still read as slightly different families. All are light
// enough for dark chip text and for colored text on the near-black UI.
const GROUP_TONE: Record<CategoryGroup, { start: number; sat: number; light: number }> = {
  pass: { start: 205, sat: 74, light: 66 },
  run: { start: 8, sat: 72, light: 60 },
  other: { start: 52, sat: 58, light: 72 },
};

/** Color for the i-th of n categories in a group (used by the seed). */
export function groupColor(group: CategoryGroup, i: number, n: number): string {
  const t = GROUP_TONE[group];
  const count = Math.max(1, n);
  // A stride coprime with n visits every slot once with big hue jumps between neighbours.
  let stride = Math.max(1, Math.round(count * 0.38));
  while (gcd(stride, count) !== 1) stride++;
  const slot = (i * stride) % count;
  return hslToHex(t.start + (slot * 360) / count, t.sat, t.light);
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Swatch palette for the color picker: 16 hues × 3 tones (light, mid, deep), all readable on the dark UI. */
export const COLOR_SWATCHES: string[] = [74, 64, 54].flatMap((light, row) =>
  Array.from({ length: 16 }, (_, i) => hslToHex(i * 22.5 + 4, row === 0 ? 70 : 72, light)),
);

/** Named swatches for controller menus (a readable subset of COLOR_SWATCHES). */
export const NAMED_SWATCHES: { name: string; color: string }[] = [
  ["Red", 0], ["Orange", 1.5], ["Amber", 2], ["Yellow", 2.5], ["Lime", 4], ["Green", 5.5], ["Teal", 7.5], ["Cyan", 8.5],
  ["Sky", 9.5], ["Blue", 10.3], ["Indigo", 11], ["Violet", 12], ["Purple", 13], ["Magenta", 14], ["Pink", 15],
].map(([name, i]) => ({ name: name as string, color: hslToHex((i as number) * 22.5 + 4, 72, 64) }));

const HEX_RE = /^#[0-9a-f]{6}$/i;

/** True for "#rrggbb". */
export function isHexColor(s: string): boolean {
  return HEX_RE.test(s);
}

/** A color for a new category in `group`: the first palette swatch nobody uses yet, else a seeded hue. */
export function nextColor(doc: Pick<ConceptsDoc, "categories">, group: CategoryGroup): string {
  const used = new Set((doc.categories ?? []).map((c) => String(c.color).toLowerCase()));
  const order = { pass: 1, run: 0, other: 2 }[group];
  const row = COLOR_SWATCHES.slice(16 * (group === "other" ? 0 : 1), 16 * (group === "other" ? 1 : 2));
  for (let k = 0; k < 16; k++) {
    const c = row[(k * 5 + order * 3) % 16];
    if (!used.has(c.toLowerCase())) return c;
  }
  for (const c of COLOR_SWATCHES) if (!used.has(c.toLowerCase())) return c;
  const n = (doc.categories ?? []).length;
  return groupColor(group, n, n + 7);
}

// ───────────────────────────── ids + names ─────────────────────────────

/** "Y-Cross" → "y-cross", "Four Verticals" → "four-verticals". */
export function slugify(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "category";
}

/** A slug id not used by any category: "mesh", "mesh-2"… */
export function uniqueCategoryId(doc: Pick<ConceptsDoc, "categories">, name: string): string {
  const taken = new Set((doc.categories ?? []).map((c) => c.id));
  const base = slugify(name);
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** Name key used to match rules and user categories: "Y-Cross", "y cross", "YCross" → "ycross". */
export function matchKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Validation for a category name (empty / duplicate by matchKey). */
export function categoryNameError(doc: Pick<ConceptsDoc, "categories">, name: string, exceptId?: string): string | undefined {
  const n = name.trim();
  if (!n) return "Name can't be empty";
  if (n.length > 40) return "Keep it to 40 characters or fewer";
  const k = matchKey(n);
  if (!k) return "Use at least one letter or digit";
  const dup = (doc.categories ?? []).find((c) => c.id !== exceptId && matchKey(String(c.name)) === k);
  return dup ? `“${dup.name}” already exists` : undefined;
}

/** A fresh concepts doc with the default PASS / RUN / OTHER categories. */
export function seedConcepts(): ConceptsDoc {
  const categories: ConceptCategory[] = [];
  for (const group of CATEGORY_GROUPS) {
    const names = SEED_CATEGORIES[group];
    names.forEach((name, i) => {
      categories.push({ id: uniqueCategoryId({ categories }, name), name, group, color: groupColor(group, i, names.length) });
    });
  }
  return { version: 1, categories, tags: {}, notes: {} };
}

// ───────────────────────────── tree ─────────────────────────────

export interface CategoryNode {
  cat: ConceptCategory;
  depth: number;
  /** Effective parent id (missing/cyclic/cross-group parents are treated as top level). */
  parent?: string;
  childCount: number;
  /** Index in doc.categories. */
  index: number;
}

export interface ConceptIndex {
  categories: ConceptCategory[];
  byId: Map<string, ConceptCategory>;
  /** Every category, group order (pass, run, other), depth-first in array order. */
  tree: CategoryNode[];
  byGroup: Record<CategoryGroup, CategoryNode[]>;
  node(id: string): CategoryNode | undefined;
  parentOf(id: string): string | undefined;
  /** [id, parent, grandparent…] for a known id; [] otherwise. */
  ancestorsOrSelf(id: string): string[];
  descendantsOrSelf(id: string): Set<string>;
  /** Position in `tree` (sort key); unknown ids sort last. */
  order(id: string): number;
}

const GROUP_SET = new Set<string>(CATEGORY_GROUPS);
export const groupOf = (c: Pick<ConceptCategory, "group">): CategoryGroup => (GROUP_SET.has(c.group) ? c.group : "other");

const indexCache = new WeakMap<object, ConceptIndex>();
const EMPTY_CATS: ConceptCategory[] = Object.freeze([]) as unknown as ConceptCategory[];

/** Tree + lookups for a doc's categories (cached per categories array, so tag edits reuse it). */
export function conceptIndex(doc: Pick<ConceptsDoc, "categories"> | null | undefined): ConceptIndex {
  const cats = Array.isArray(doc?.categories) ? doc.categories : EMPTY_CATS;
  // Only frozen arrays are cached: workspace docs are deep-frozen, while an immer draft keeps the same proxy across
  // mutations inside one recipe (a cache keyed on it would go stale).
  const cacheable = Object.isFrozen(cats);
  const hit = cacheable ? indexCache.get(cats) : undefined;
  if (hit) return hit;

  const byId = new Map<string, ConceptCategory>();
  for (const c of cats) if (c && typeof c.id === "string" && !byId.has(c.id)) byId.set(c.id, c);

  // Effective parent: exists, same group, and walking up from it never comes back to the child.
  const effParent = new Map<string, string | undefined>();
  for (const c of byId.values()) {
    const p = typeof c.parent === "string" ? byId.get(c.parent) : undefined;
    let ok = !!p && p.id !== c.id && groupOf(p) === groupOf(c);
    if (ok) {
      const seen = new Set<string>();
      let cur: ConceptCategory | undefined = p;
      while (cur) {
        if (cur.id === c.id) {
          ok = false; // a cycle through this category: show it at the top level
          break;
        }
        if (seen.has(cur.id)) break; // a loop further up that doesn't involve us
        seen.add(cur.id);
        cur = typeof cur.parent === "string" ? byId.get(cur.parent) : undefined;
      }
    }
    effParent.set(c.id, ok ? p!.id : undefined);
  }

  const children = new Map<string | undefined, ConceptCategory[]>();
  const indexOf = new Map<string, number>();
  cats.forEach((c, i) => {
    if (!c || byId.get(c.id) !== c) return;
    indexOf.set(c.id, i);
    const key = effParent.get(c.id);
    const list = children.get(key);
    if (list) list.push(c);
    else children.set(key, [c]);
  });

  const byGroup: Record<CategoryGroup, CategoryNode[]> = { pass: [], run: [], other: [] };
  const tree: CategoryNode[] = [];
  const nodes = new Map<string, CategoryNode>();
  const visit = (c: ConceptCategory, depth: number, out: CategoryNode[]) => {
    if (nodes.has(c.id)) return;
    const kids = children.get(c.id) ?? [];
    const n: CategoryNode = { cat: c, depth, parent: effParent.get(c.id), childCount: kids.length, index: indexOf.get(c.id) ?? -1 };
    nodes.set(c.id, n);
    out.push(n);
    for (const k of kids) visit(k, depth + 1, out);
  };
  const roots = children.get(undefined) ?? [];
  for (const g of CATEGORY_GROUPS) {
    for (const r of roots) if (groupOf(r) === g) visit(r, 0, byGroup[g]);
    tree.push(...byGroup[g]);
  }
  // Anything unreachable (shouldn't happen) still shows up at the top level of its group.
  for (const c of byId.values())
    if (!nodes.has(c.id)) {
      const g = groupOf(c);
      visit(c, 0, byGroup[g]);
      tree.push(nodes.get(c.id)!);
    }
  const order = new Map(tree.map((n, i) => [n.cat.id, i]));

  const descCache = new Map<string, Set<string>>();
  const ix: ConceptIndex = {
    categories: cats,
    byId,
    tree,
    byGroup,
    node: (id) => nodes.get(id),
    parentOf: (id) => effParent.get(id),
    ancestorsOrSelf(id) {
      if (!byId.has(id)) return [];
      const out: string[] = [];
      let cur: string | undefined = id;
      while (cur !== undefined && !out.includes(cur)) {
        out.push(cur);
        cur = effParent.get(cur);
      }
      return out;
    },
    descendantsOrSelf(id) {
      let s = descCache.get(id);
      if (!s) {
        s = new Set([id]);
        const stack = [id];
        while (stack.length) {
          const cur = stack.pop()!;
          for (const k of children.get(cur) ?? []) if (!s.has(k.id)) {
            s.add(k.id);
            stack.push(k.id);
          }
        }
        descCache.set(id, s);
      }
      return s;
    },
    order: (id) => order.get(id) ?? Number.MAX_SAFE_INTEGER,
  };
  if (cacheable) indexCache.set(cats, ix);
  return ix;
}

/** Can `id` be nested under `parentId` (null = top level) without a cycle? */
export function canNest(doc: Pick<ConceptsDoc, "categories">, id: string, parentId: string | null | undefined): boolean {
  const ix = conceptIndex(doc);
  if (!ix.byId.has(id)) return false;
  if (parentId === null || parentId === undefined) return true;
  if (!ix.byId.has(parentId)) return false;
  return !ix.descendantsOrSelf(id).has(parentId);
}

/** Categories `id` could be moved under (every category except itself and its descendants), tree order. */
export function nestTargets(doc: Pick<ConceptsDoc, "categories">, id: string): CategoryNode[] {
  const ix = conceptIndex(doc);
  const blocked = ix.descendantsOrSelf(id);
  return ix.tree.filter((n) => !blocked.has(n.cat.id));
}

// ───────────────────────────── category ops (mutate a draft) ─────────────────────────────

const catsOf = (doc: ConceptsDoc): ConceptCategory[] => {
  if (!Array.isArray(doc.categories)) doc.categories = [];
  return doc.categories;
};
const tagsOf = (doc: ConceptsDoc): Record<PlayKey, string[]> => {
  if (!doc.tags || typeof doc.tags !== "object" || Array.isArray(doc.tags)) doc.tags = {};
  return doc.tags;
};

/** Ids hidden from a play's suggestions ("dismiss"). Stored in the doc so a dismissal sticks. */
export type DismissedMap = Record<PlayKey, string[]>;

export function dismissedOf(doc: ConceptsDoc | null | undefined): DismissedMap | undefined {
  const d = doc?.dismissed;
  return d && typeof d === "object" && !Array.isArray(d) ? (d as DismissedMap) : undefined;
}

export interface NewCategory {
  name: string;
  group: CategoryGroup;
  color?: string;
  parent?: string;
  /** Insert right after this category (its next sibling); default: last. */
  after?: string;
}

/** Add a category; returns it (the id is a unique slug of the name). Unknown/invalid parents are ignored. */
export function addCategory(doc: ConceptsDoc, init: NewCategory): ConceptCategory {
  const cats = catsOf(doc);
  const parent = init.parent ? cats.find((c) => c.id === init.parent) : undefined;
  const group = parent ? groupOf(parent) : init.group;
  const cat: ConceptCategory = {
    id: uniqueCategoryId(doc, init.name),
    name: init.name.trim(),
    group,
    color: init.color && isHexColor(init.color) ? init.color : nextColor(doc, group),
  };
  if (parent) cat.parent = parent.id;
  const at = init.after ? cats.findIndex((c) => c.id === init.after) : -1;
  if (at >= 0) cats.splice(at + 1, 0, cat);
  else cats.push(cat);
  return cat;
}

export function renameCategory(doc: ConceptsDoc, id: string, name: string): boolean {
  const c = catsOf(doc).find((x) => x.id === id);
  const n = name.trim();
  if (!c || !n || c.name === n) return false;
  c.name = n;
  return true;
}

export function setCategoryColor(doc: ConceptsDoc, id: string, color: string): boolean {
  const c = catsOf(doc).find((x) => x.id === id);
  if (!c || !isHexColor(color) || c.color === color) return false;
  c.color = color.toLowerCase();
  return true;
}

export interface MoveTarget {
  group: CategoryGroup;
  /** New parent id, or null/undefined for top level. Must be in `group` (the group follows the parent otherwise). */
  parent?: string | null;
  /** Place right before this sibling; null/undefined = last among the new siblings. */
  before?: string | null;
}

/**
 * Move a category (with its subtree) to a new parent / group / position. Refuses cycles (returns false).
 * Descendants follow the category's group.
 */
export function moveCategory(doc: ConceptsDoc, id: string, to: MoveTarget): boolean {
  const cats = catsOf(doc);
  const from = cats.findIndex((c) => c.id === id);
  if (from < 0) return false;
  const parentId = to.parent ?? undefined;
  if (parentId !== undefined && !canNest(doc, id, parentId)) return false;
  const parent = parentId !== undefined ? cats.find((c) => c.id === parentId) : undefined;
  const group = parent ? groupOf(parent) : GROUP_SET.has(to.group) ? to.group : "other";
  const subtree = conceptIndex(doc).descendantsOrSelf(id);

  const [cat] = cats.splice(from, 1);
  if (parent) cat.parent = parent.id;
  else delete cat.parent;
  for (const c of cats) if (subtree.has(c.id) && c.group !== group) c.group = group;
  cat.group = group;

  const before = to.before && to.before !== id ? cats.findIndex((c) => c.id === to.before) : -1;
  if (before >= 0) cats.splice(before, 0, cat);
  else {
    // Last among its new siblings, placed right after the end of the parent's subtree (or of its group), so the
    // array stays roughly in display order (nicer diffs).
    const ix = conceptIndex(doc);
    const tail = parent ? ix.descendantsOrSelf(parent.id) : new Set(ix.byGroup[group].map((n) => n.cat.id));
    let at = -1;
    cats.forEach((c, i) => {
      if (tail.has(c.id)) at = i;
    });
    if (at >= 0) cats.splice(at + 1, 0, cat);
    else cats.push(cat);
  }
  return true;
}

/** Siblings of a category (same effective parent and group), display order. */
export function siblingsOf(doc: Pick<ConceptsDoc, "categories">, id: string): ConceptCategory[] {
  const ix = conceptIndex(doc);
  const n = ix.node(id);
  if (!n) return [];
  return ix.tree.filter((m) => m.parent === n.parent && groupOf(m.cat) === groupOf(n.cat)).map((m) => m.cat);
}

/** Swap with the previous (-1) / next (+1) sibling. */
export function moveCategoryBy(doc: ConceptsDoc, id: string, dir: -1 | 1): boolean {
  const sib = siblingsOf(doc, id);
  const i = sib.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sib.length) return false;
  const cats = catsOf(doc);
  const cur = cats.findIndex((c) => c.id === id);
  const [cat] = cats.splice(cur, 1);
  const other = cats.findIndex((c) => c.id === sib[j].id);
  cats.splice(dir < 0 ? other : other + 1, 0, cat);
  return true;
}

/** Nest under the previous sibling (outliner "indent"). */
export function indentCategory(doc: ConceptsDoc, id: string): boolean {
  const sib = siblingsOf(doc, id);
  const i = sib.findIndex((c) => c.id === id);
  if (i <= 0) return false;
  const c = catsOf(doc).find((x) => x.id === id)!;
  return moveCategory(doc, id, { group: groupOf(c), parent: sib[i - 1].id });
}

/** Move up one level, right after the old parent. */
export function outdentCategory(doc: ConceptsDoc, id: string): boolean {
  const ix = conceptIndex(doc);
  const parent = ix.parentOf(id);
  if (!parent) return false;
  const grand = ix.parentOf(parent);
  const pc = ix.byId.get(parent)!;
  // Insert before the parent's next sibling so the category lands right after the parent's subtree.
  const sib = ix.tree.filter((n) => n.parent === grand && groupOf(n.cat) === groupOf(pc));
  const pi = sib.findIndex((n) => n.cat.id === parent);
  const next = sib[pi + 1]?.cat.id;
  return moveCategory(doc, id, { group: groupOf(pc), parent: grand ?? null, before: next ?? null });
}

export interface DeleteResult {
  removed: string[];
  /** Tag references removed (play × category). */
  tagsRemoved: number;
  /** Plays that lost at least one tag. */
  playsTouched: number;
}

/**
 * Delete a category. Its children move up to its parent (or are deleted with it when `withDescendants`).
 * Removes the category from every play's tags (and dismissals); empty tag lists are dropped.
 */
export function deleteCategory(doc: ConceptsDoc, id: string, opts: { withDescendants?: boolean } = {}): DeleteResult {
  const cats = catsOf(doc);
  const ix = conceptIndex(doc);
  if (!ix.byId.has(id)) return { removed: [], tagsRemoved: 0, playsTouched: 0 };
  const removed = opts.withDescendants ? [...ix.descendantsOrSelf(id)] : [id];
  const gone = new Set(removed);
  const parent = ix.parentOf(id);
  for (const c of cats)
    if (!gone.has(c.id) && typeof c.parent === "string" && gone.has(c.parent)) {
      if (parent && !gone.has(parent)) c.parent = parent;
      else delete c.parent;
    }
  for (let i = cats.length - 1; i >= 0; i--) if (gone.has(cats[i].id)) cats.splice(i, 1);
  const res = stripIds(doc, gone);
  return { removed, ...res };
}

function stripIds(doc: ConceptsDoc, gone: Set<string>): { tagsRemoved: number; playsTouched: number } {
  let tagsRemoved = 0;
  let playsTouched = 0;
  const tags = tagsOf(doc);
  for (const key of Object.keys(tags)) {
    const list = Array.isArray(tags[key]) ? tags[key] : [];
    const keep = list.filter((t) => !gone.has(t));
    if (keep.length !== list.length) {
      tagsRemoved += list.length - keep.length;
      playsTouched++;
      if (keep.length) tags[key] = keep;
      else delete tags[key];
    }
  }
  const dis = dismissedOf(doc);
  if (dis)
    for (const key of Object.keys(dis)) {
      const keep = (dis[key] ?? []).filter((t) => !gone.has(t));
      if (keep.length) dis[key] = keep;
      else delete dis[key];
    }
  return { tagsRemoved, playsTouched };
}

/** How many tag references a category (and optionally its subtree) has — for delete confirmations. */
export function tagUsage(doc: ConceptsDoc, id: string, withDescendants = false): { plays: number; refs: number } {
  const ids = withDescendants ? conceptIndex(doc).descendantsOrSelf(id) : new Set([id]);
  let plays = 0;
  let refs = 0;
  for (const list of Object.values(doc.tags ?? {})) {
    const n = (Array.isArray(list) ? list : []).filter((t) => ids.has(t)).length;
    if (n) {
      plays++;
      refs += n;
    }
  }
  return { plays, refs };
}

// ───────────────────────────── tags + notes ─────────────────────────────

export function tagsOfPlay(doc: ConceptsDoc | null | undefined, key: PlayKey): string[] {
  const t = doc?.tags?.[key];
  return Array.isArray(t) ? t : EMPTY_IDS;
}
const EMPTY_IDS: string[] = [];

export function hasTag(doc: ConceptsDoc | null | undefined, key: PlayKey, id: string): boolean {
  return tagsOfPlay(doc, key).includes(id);
}

function sortIds(doc: ConceptsDoc, ids: string[]): string[] {
  const ix = conceptIndex(doc);
  return [...ids].sort((a, b) => ix.order(a) - ix.order(b));
}

/** Set one tag on one play (on = undefined toggles). Returns the new state. Tag lists stay in category order. */
export function toggleTag(doc: ConceptsDoc, key: PlayKey, id: string, on?: boolean): boolean {
  const tags = tagsOf(doc);
  const cur = Array.isArray(tags[key]) ? tags[key] : [];
  const has = cur.includes(id);
  const want = on ?? !has;
  if (want === has) return has;
  if (want) {
    tags[key] = sortIds(doc, [...cur, id]);
    // Accepting/adding a tag also clears a dismissal of it.
    const dis = dismissedOf(doc);
    if (dis?.[key]?.includes(id)) {
      const keep = dis[key].filter((x) => x !== id);
      if (keep.length) dis[key] = keep;
      else delete dis[key];
    }
  } else {
    const keep = cur.filter((x) => x !== id);
    if (keep.length) tags[key] = keep;
    else delete tags[key];
  }
  return want;
}

/** Bulk: set (on) or clear (off) one tag on many plays. Returns how many plays changed. */
export function setTagOnPlays(doc: ConceptsDoc, keys: readonly PlayKey[], id: string, on: boolean): number {
  let n = 0;
  for (const key of new Set(keys)) if (hasTag(doc, key, id) !== on) {
    toggleTag(doc, key, id, on);
    n++;
  }
  return n;
}

/** Tri-state for a set of plays: every play has the tag, some do, or none. */
export function tagState(doc: ConceptsDoc | null | undefined, keys: readonly PlayKey[], id: string): "all" | "some" | "none" {
  let yes = 0;
  for (const k of keys) if (hasTag(doc, k, id)) yes++;
  return yes === 0 ? "none" : yes === keys.length ? "all" : "some";
}

/** Toggle on a multi-selection: when every play has it, remove it from all; otherwise add it to all. */
export function toggleTagOnPlays(doc: ConceptsDoc, keys: readonly PlayKey[], id: string): boolean {
  const on = tagState(doc, keys, id) !== "all";
  setTagOnPlays(doc, keys, id, on);
  return on;
}

export function noteOf(doc: ConceptsDoc | null | undefined, key: PlayKey): string {
  const n = doc?.notes?.[key];
  return typeof n === "string" ? n : "";
}

/** Set a per-play note; empty text removes it. */
export function setNote(doc: ConceptsDoc, key: PlayKey, text: string): void {
  if (!doc.notes || typeof doc.notes !== "object" || Array.isArray(doc.notes)) doc.notes = {};
  if (text.trim()) doc.notes[key] = text;
  else delete doc.notes[key];
}

/** Tagged / noted play keys the catalog can't resolve (e.g. a custom play whose asset was renamed). */
export function orphanKeys(doc: ConceptsDoc | null | undefined, exists: (key: PlayKey) => boolean): PlayKey[] {
  if (!doc) return [];
  const keys = new Set([...Object.keys(doc.tags ?? {}), ...Object.keys(doc.notes ?? {}), ...Object.keys(dismissedOf(doc) ?? {})]);
  return [...keys].filter((k) => !exists(k)).sort();
}

/** Drop tags, notes and dismissals of the given play keys. */
export function forgetPlays(doc: ConceptsDoc, keys: readonly PlayKey[]): void {
  const tags = tagsOf(doc);
  const dis = dismissedOf(doc);
  for (const k of keys) {
    delete tags[k];
    if (doc.notes) delete doc.notes[k];
    if (dis) delete dis[k];
  }
}

/** Library-wide tagged plays per category (a play counts once for each category it carries, ancestors included). */
export function tagCounts(doc: ConceptsDoc | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  if (!doc) return out;
  const ix = conceptIndex(doc);
  for (const list of Object.values(doc.tags ?? {})) {
    const seen = new Set<string>();
    for (const t of Array.isArray(list) ? list : []) for (const a of ix.ancestorsOrSelf(t)) seen.add(a);
    for (const id of seen) out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

/** The play's tags plus all their ancestors (what category filters and gameplan columns match against). */
export function expandedTags(doc: ConceptsDoc | null | undefined, key: PlayKey): Set<string> {
  const out = new Set<string>();
  if (!doc) return out;
  const ix = conceptIndex(doc);
  for (const t of tagsOfPlay(doc, key)) for (const a of ix.ancestorsOrSelf(t)) out.add(a);
  return out;
}

/** Does the play carry any of `ids` (or a descendant of one)? Empty `ids` matches everything. */
export function matchesCategories(doc: ConceptsDoc | null | undefined, key: PlayKey, ids: readonly string[]): boolean {
  if (!ids.length) return true;
  const ex = expandedTags(doc, key);
  return ids.some((id) => ex.has(id));
}

/** Categories on a play (known ids only), tree order. */
export function playCategories(doc: ConceptsDoc | null | undefined, key: PlayKey): ConceptCategory[] {
  if (!doc) return [];
  const ix = conceptIndex(doc);
  return tagsOfPlay(doc, key)
    .map((id) => ix.byId.get(id))
    .filter((c): c is ConceptCategory => !!c)
    .sort((a, b) => ix.order(a.id) - ix.order(b.id));
}

// ───────────────────────────── suggestions ─────────────────────────────

export type SuggestionSource = "concept" | "playType" | "route" | "name";

export interface SuggestionReason {
  source: SuggestionSource;
  text: string;
}

export interface Suggestion {
  category: ConceptCategory;
  reasons: SuggestionReason[];
}

/** What the engine looks at (a ResolvedPlay fits). */
export interface SuggestInput {
  name: string;
  playType: string;
  reads?: readonly ReadDef[];
  slots?: readonly { routeType?: string }[];
}

const SOURCE_RANK: Record<SuggestionSource, number> = { concept: 0, playType: 1, route: 2, name: 3 };

/** OffensePlayType (without prefix) → candidate category names. */
const PLAY_TYPE_RULES: Record<string, string[]> = {
  RunInsideZone: ["Inside Zone"],
  RunOutsideZone: ["Outside Zone"],
  RunPower: ["Power"],
  RunCounter: ["Counter"],
  RunTrap: ["Trap"],
  RunWham: ["Wham", "Trap"],
  RunDraw: ["Draw"],
  RunISO: ["ISO"],
  RunSweep: ["Toss", "Sweep"],
  RunPitch: ["Toss", "Sweep"],
  JetSweep: ["Jet Sweep", "Sweep"],
  QBRun: ["QB Run"],
  QBSneak: ["QB Run", "QB Sneak"],
  QBPlayActionRun: ["QB Run", "Play Action"],
  PassScreen: ["Screens", "Screen"],
  PAScreenPass: ["Screens", "Screen", "Play Action"],
  DoublePassScreen: ["Screens", "Screen", "Trick"],
  PassPlayAction: ["Play Action", "PA"],
  RunPlayAction: ["Play Action", "PA"],
  FleaFlicker: ["Trick", "Flea Flicker"],
  HandoffPass: ["Trick"],
  DoublePass: ["Trick"],
  ReversePass: ["Trick"],
  RunReverse: ["Trick", "Reverse"],
  RunReverseFake: ["Trick"],
  RunEndAround: ["Trick", "End Around"],
  RunEndAroundFake: ["Trick"],
  PassFakeFG: ["Trick", "Fakes"],
  PassFakePunt: ["Trick", "Fakes"],
  RunFakeFG: ["Trick", "Fakes"],
  RunFakePunt: ["Trick", "Fakes"],
  PassHailMary: ["Hail Mary"],
};

/** ConceptType → candidate category names (the concept's own words are always tried too). */
const CONCEPT_RULES: Record<string, string[]> = {
  Concept_Mesh: ["Mesh"],
  Concept_Smash: ["Smash"],
  Concept_Flood: ["Flood"],
  Concept_Y_Cross: ["Y-Cross"],
  Concept_Dagger: ["Dagger"],
  Concept_Curl_Flat: ["Curl-Flat", "Curl Flats"],
  Concept_Four_Verticals: ["Four Verticals", "4 Verticals", "Verticals", "Four Verts", "4 Verts", "Verts"],
  Concept_Shallow_Cross: ["Shallow Cross", "Shallow"],
  Concept_Spacing: ["Spacing"],
  Concept_Stick: ["Stick"],
  Concept_Levels: ["Levels"],
  Concept_Drive: ["Drive"],
  Concept_Slant_Flat: ["Slants", "Slant-Flat", "Slant"],
  Concept_Double_Slant: ["Slants", "Double Slants", "Slant"],
  Concept_Spot: ["Spot"],
  Concept_China: ["China"],
  Concept_Divide: ["Divide"],
  Concept_Shot_Play: ["Shot Play", "Shot Plays"],
  Concept_Bubble_Screen: ["Screens", "Bubble Screen", "Bubble"],
  Concept_HB_Slip_Screen: ["Screens", "Slip Screen"],
  Concept_FL_SE_Screen: ["Screens", "WR Screen"],
  Concept_WR_Mid_Screen: ["Screens", "WR Screen"],
  Concept_Boot: ["Boot", "Bootleg"],
  Concept_Stick_Nod: ["Stick Nod", "Stick-Nod"],
};

/**
 * AssignRouteType (without prefix) → candidates when ANY slot runs it. `fallback` rules (ballcarrier paths, which the
 * game reuses across schemes — a Power play's RB often runs RB_Counter) only apply when the play type says nothing.
 */
const ROUTE_ANY_RULES: Record<string, { names: string[]; text: string; fallback?: boolean }> = {
  RR_WR_Screen: { names: ["Screens", "Screen", "WR Screen"], text: "WR screen route" },
  RR_RB_Screen_Left: { names: ["Screens", "Screen"], text: "RB screen route" },
  RR_RB_Screen_Rt: { names: ["Screens", "Screen"], text: "RB screen route" },
  QB_Play_Action: { names: ["Play Action", "PA"], text: "QB play-action fake" },
  QB_Shotgun_Read_Option: { names: ["Option", "Read Option"], text: "QB read option" },
  QB_Speed_Option: { names: ["Option", "Speed Option"], text: "QB speed option" },
  QB_Triple_Option: { names: ["Option", "Triple Option"], text: "QB triple option" },
  QB_Power_Option: { names: ["Option"], text: "QB power option" },
  QB_Option_Give: { names: ["Option"], text: "QB option give" },
  QB_Option_Pass: { names: ["Option"], text: "QB option pass", fallback: true },
  RB_Option_Follow: { names: ["Option"], text: "RB option pitch man", fallback: true },
  RB_Option_Receive: { names: ["Option"], text: "RB option receive", fallback: true },
  RB_Counter: { names: ["Counter"], text: "RB counter path", fallback: true },
  RB_Draw: { names: ["Draw"], text: "RB draw path", fallback: true },
  QB_Draw: { names: ["Draw", "QB Run"], text: "QB draw" },
  QB_Run: { names: ["QB Run"], text: "QB run assignment" },
  RB_Sweep: { names: ["Toss", "Sweep"], text: "RB sweep path", fallback: true },
  RB_Stretch: { names: ["Outside Zone"], text: "RB stretch path", fallback: true },
  RB_Dive: { names: ["Dive"], text: "RB dive path", fallback: true },
};

/** AssignRouteType groups that suggest a concept when at least `min` slots run them. */
const ROUTE_COUNT_RULES: { types: string[]; min: number; names: string[]; label: string }[] = [
  { types: ["RR_Slant", "RR_Slant_Hook"], min: 2, names: ["Slants"], label: "slants" },
  { types: ["RR_Streak", "RR_Fade"], min: 4, names: ["Four Verticals", "Verticals", "Verts"], label: "vertical routes" },
  { types: ["RR_Drag"], min: 2, names: ["Mesh"], label: "drag routes" },
];

/** Regexes (on the normalized play name) for categories whose names don't appear literally in play names. */
const NAME_ALIASES: Record<string, RegExp[]> = {
  playaction: [/(^| )pa( |$)/, /play action/],
  pa: [/(^| )pa( |$)/],
  fourverticals: [/(^| )(4 |four )?verts?( |$)/, /(^| )verticals?( |$)/],
  verticals: [/(^| )verts?( |$)/],
  trick: [/(^| )reverse( |$)/, /flea flicker/, /double pass/, /end (around|arnd)/, /philly special/, /(^| )trick( |$)/],
  rpo: [/(^| )rpo( |$)/],
  option: [/option/],
  qbrun: [/(^| )qb (draw|run|power|sweep|counter|sneak|zone|stretch|iso|wrap|keep|lead|blast)( |$)/],
  shotplay: [/(^| )shot( |$)/],
  toss: [/(^| )(toss|pitch)( |$)/],
  outsidezone: [/outside zone/, /wide zone/, /stretch/],
  shallowcross: [/(^| )shallow( |$)/],
  curlflat: [/curl flats?/],
  screens: [/screen/],
};

/** Category names that are gameplan buckets, not play shapes: never suggested from the play name alone. */
const NO_NAME_MATCH = new Set(["base", "goalline", "redzone", "twominute", "twominutedrill"]);

const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface Matcher {
  byKey: Map<string, ConceptCategory>;
  nameRules: { cat: ConceptCategory; res: RegExp[]; label: string }[];
}

const matcherCache = new WeakMap<object, Matcher>();

function matcherFor(doc: Pick<ConceptsDoc, "categories">): Matcher {
  const cats = Array.isArray(doc.categories) ? doc.categories : EMPTY_CATS;
  const cacheable = Object.isFrozen(cats);
  const hit = cacheable ? matcherCache.get(cats) : undefined;
  if (hit) return hit;
  const ix = conceptIndex(doc);
  const byKey = new Map<string, ConceptCategory>();
  const nameRules: Matcher["nameRules"] = [];
  for (const n of ix.tree) {
    const c = n.cat;
    const k = matchKey(String(c.name ?? ""));
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, c);
    if (NO_NAME_MATCH.has(k)) continue;
    const words = normName(String(c.name)).split(" ").filter(Boolean);
    const res: RegExp[] = [...(NAME_ALIASES[k] ?? [])];
    if (words.length) {
      const last = words[words.length - 1];
      const stem = last.length > 3 && last.endsWith("s") && !last.endsWith("ss") ? last.slice(0, -1) : last;
      const head = words.slice(0, -1).map(escapeRe);
      const pattern = [...head, `${escapeRe(stem)}s?`].join(" ");
      res.push(new RegExp(`(^| )${pattern}( |$)`));
    }
    nameRules.push({ cat: c, res, label: String(c.name) });
  }
  const m = { byKey, nameRules };
  if (cacheable) matcherCache.set(cats, m);
  return m;
}

const conceptWords = (concept: string) => concept.replace(/^Concept_/, "").replace(/_/g, " ");
const shortType = (t: string) => t.replace(/^(Offense|Defense)PlayType_/, "");

/**
 * Tag suggestions for a play from its play type, read concepts, assignment route types and name — matched by
 * normalized name to the user's categories (renamed/added categories still get suggestions). Excludes categories the
 * play already carries (or an ancestor of one), and dismissed ones unless `includeDismissed`.
 */
export function suggestTags(
  play: SuggestInput,
  doc: ConceptsDoc | null | undefined,
  opts: { key?: PlayKey; includeDismissed?: boolean } = {},
): Suggestion[] {
  if (!doc || !Array.isArray(doc.categories) || !doc.categories.length) return [];
  const m = matcherFor(doc);
  const ix = conceptIndex(doc);
  const found = new Map<string, Suggestion>();
  const add = (names: string[], reason: SuggestionReason) => {
    for (const n of names) {
      const c = m.byKey.get(matchKey(n));
      if (!c) continue;
      const s = found.get(c.id);
      if (!s) found.set(c.id, { category: c, reasons: [reason] });
      else if (!s.reasons.some((r) => r.text === reason.text)) s.reasons.push(reason);
    }
  };

  // Read concepts (the game's own concept labels on the read progression).
  const bySlot = new Map<string, number[]>();
  for (const r of play.reads ?? []) {
    const c = typeof r?.concept === "string" ? r.concept : "";
    if (!c || c === "Concept_Invalid" || c === "Concept_Max") continue;
    const list = bySlot.get(c);
    if (list) list.push(r.pos);
    else bySlot.set(c, [r.pos]);
  }
  for (const [concept, slots] of bySlot) {
    const words = conceptWords(concept);
    const sorted = [...new Set(slots)].sort((a, b) => a - b);
    add([...(CONCEPT_RULES[concept] ?? []), words], {
      source: "concept",
      text: `Read concept ${words} (slot${sorted.length > 1 ? "s" : ""} ${sorted.join(", ")})`,
    });
  }

  // Play type.
  const t = shortType(play.playType ?? "");
  const typeNames = PLAY_TYPE_RULES[t] ?? (/^RPO/.test(t) ? ["RPO"] : /^Option/.test(t) ? ["Option"] : undefined);
  if (typeNames) add(typeNames, { source: "playType", text: `Play type ${maddenName(playTypeInfo(play.playType).long)}` });

  // Assignment route types.
  const counts = new Map<string, number>();
  for (const s of play.slots ?? []) {
    const rt = typeof s?.routeType === "string" ? s.routeType.replace(/^AssignRouteType_/, "") : "";
    if (rt) counts.set(rt, (counts.get(rt) ?? 0) + 1);
  }
  for (const [rt, n] of counts) {
    const rule = ROUTE_ANY_RULES[rt];
    if (rule && !(rule.fallback && typeNames)) add(rule.names, { source: "route", text: n > 1 ? `${n}× ${rule.text}` : `Route ${rule.text}` });
  }
  for (const rule of ROUTE_COUNT_RULES) {
    const n = rule.types.reduce((sum, rt) => sum + (counts.get(rt) ?? 0), 0);
    if (n >= rule.min) add(rule.names, { source: "route", text: `${n} ${rule.label}` });
  }

  // Play name.
  const nm = normName(play.name ?? "");
  if (nm)
    for (const r of m.nameRules)
      if (r.res.some((re) => re.test(nm))) add([r.label], { source: "name", text: `Name “${maddenName(play.name.trim())}” matches ${r.label}` });

  // Drop what's already tagged (or covered by a tagged descendant) and dismissed ones.
  const tagged = new Set<string>();
  if (opts.key) for (const t2 of tagsOfPlay(doc, opts.key)) for (const a of ix.ancestorsOrSelf(t2)) tagged.add(a);
  const dismissed = opts.key && !opts.includeDismissed ? new Set(dismissedOf(doc)?.[opts.key] ?? []) : undefined;
  const out = [...found.values()].filter((s) => !tagged.has(s.category.id) && !dismissed?.has(s.category.id));
  for (const s of out) s.reasons.sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source]);
  out.sort(
    (a, b) =>
      SOURCE_RANK[a.reasons[0].source] - SOURCE_RANK[b.reasons[0].source] ||
      b.reasons.length - a.reasons.length ||
      ix.order(a.category.id) - ix.order(b.category.id),
  );
  return out;
}

/** Dismiss one suggestion for a play (kept in the doc under `dismissed`). */
export function dismissSuggestion(doc: ConceptsDoc, key: PlayKey, id: string): void {
  let dis = dismissedOf(doc);
  if (!dis) {
    doc.dismissed = {};
    dis = doc.dismissed as DismissedMap;
  }
  const cur = Array.isArray(dis[key]) ? dis[key] : [];
  if (!cur.includes(id)) dis[key] = [...cur, id];
}

/** Bring back dismissed suggestions for one play (or every play). */
export function restoreDismissed(doc: ConceptsDoc, key?: PlayKey): void {
  const dis = dismissedOf(doc);
  if (!dis) return;
  if (key === undefined) delete doc.dismissed;
  else {
    delete dis[key];
    if (!Object.keys(dis).length) delete doc.dismissed;
  }
}

export function dismissedCount(doc: ConceptsDoc | null | undefined, key: PlayKey): number {
  return dismissedOf(doc)?.[key]?.length ?? 0;
}

/** Apply accepted suggestions; returns how many tags were added. */
export function acceptSuggestions(doc: ConceptsDoc, items: readonly { key: PlayKey; id: string }[]): number {
  let n = 0;
  for (const it of items) if (!hasTag(doc, it.key, it.id)) {
    toggleTag(doc, it.key, it.id, true);
    n++;
  }
  return n;
}

// ───────────────────────────── gameplan queries (over a ResolvedBook) ─────────────────────────────

export interface BookPlayRef {
  play: ResolvedPlay;
  entry: PlayEntry;
  /** Indexes into the spec: formations[f].sets[s].plays[p]. */
  f: number;
  s: number;
  p: number;
  formation: string;
  set: string;
}

/** Every resolved play entry of a book in book order (template sections and unresolved plays are skipped). */
export function bookPlayRefs(book: ResolvedBook): BookPlayRef[] {
  const out: BookPlayRef[] = [];
  for (const rf of book.formations) {
    if (rf.template) continue;
    for (const rs of rf.sets)
      for (const rp of rs.plays)
        if (rp.play)
          out.push({
            play: rp.play,
            entry: rp.entry,
            f: rf.index,
            s: rs.index,
            p: rp.index,
            formation: String(rf.entry.formation ?? ""),
            set: String(rs.entry.set ?? ""),
          });
  }
  return out;
}

export interface MatrixColumn {
  category: ConceptCategory;
  depth: number;
  /** The category and its descendants (what a cell counts). */
  ids: Set<string>;
}

export interface MatrixRow {
  kind: "formation" | "set";
  /** Stable key: "f3" / "f3s1". */
  key: string;
  label: string;
  f: number;
  s?: number;
  /** Plays in the row. */
  total: number;
  /** Plays per column. */
  cells: BookPlayRef[][];
  /** Plays in the row carrying any column's category. */
  tagged: number;
}

export interface ConceptMatrix {
  group: CategoryGroup;
  columns: MatrixColumn[];
  rows: MatrixRow[];
  /** Plays per column across the book. */
  totals: BookPlayRef[][];
  plays: number;
  templateSections: number;
  unresolved: number;
}

/**
 * Concepts-by-formation matrix: rows = formations › sets, columns = the group's categories (tree order; a parent
 * column counts its descendants). `topLevelOnly` keeps only top-level columns; `only` restricts the columns;
 * `requireAny` only counts plays carrying one of those categories (e.g. RUN concepts among "Goal Line" plays).
 */
export function conceptMatrix(
  book: ResolvedBook,
  doc: ConceptsDoc | null | undefined,
  group: CategoryGroup,
  opts: { topLevelOnly?: boolean; only?: readonly string[]; requireAny?: readonly string[] } = {},
): ConceptMatrix {
  const ix = conceptIndex(doc);
  const require = opts.requireAny?.length ? opts.requireAny : undefined;
  const only = opts.only?.length ? new Set(opts.only) : undefined;
  const columns: MatrixColumn[] = ix.byGroup[group]
    .filter((n) => (!opts.topLevelOnly || n.depth === 0) && (!only || only.has(n.cat.id)))
    .map((n) => ({ category: n.cat, depth: opts.topLevelOnly ? 0 : n.depth, ids: ix.descendantsOrSelf(n.cat.id) }));

  const rows: MatrixRow[] = [];
  const totals: BookPlayRef[][] = columns.map(() => []);
  let plays = 0;
  let templateSections = 0;
  const tagCache = new Map<PlayKey, Set<string>>();
  const tagsFor = (key: PlayKey) => {
    let t = tagCache.get(key);
    if (!t) tagCache.set(key, (t = new Set(tagsOfPlay(doc, key))));
    return t;
  };
  const hits = (key: PlayKey, col: MatrixColumn) => {
    for (const t of tagsFor(key)) if (col.ids.has(t)) return true;
    return false;
  };

  for (const rf of book.formations) {
    if (rf.template) {
      templateSections++;
      continue;
    }
    const fRow: MatrixRow = {
      kind: "formation",
      key: `f${rf.index}`,
      label: String(rf.entry.formation ?? ""),
      f: rf.index,
      total: 0,
      cells: columns.map(() => []),
      tagged: 0,
    };
    const setRows: MatrixRow[] = [];
    for (const rs of rf.sets) {
      const row: MatrixRow = {
        kind: "set",
        key: `f${rf.index}s${rs.index}`,
        label: String(rs.entry.set ?? ""),
        f: rf.index,
        s: rs.index,
        total: 0,
        cells: columns.map(() => []),
        tagged: 0,
      };
      for (const rp of rs.plays) {
        if (!rp.play) continue;
        if (require && !matchesCategories(doc, rp.play.key, require)) continue;
        const ref: BookPlayRef = { play: rp.play, entry: rp.entry, f: rf.index, s: rs.index, p: rp.index, formation: fRow.label, set: row.label };
        row.total++;
        fRow.total++;
        plays++;
        let any = false;
        columns.forEach((col, ci) => {
          if (!hits(rp.play!.key, col)) return;
          any = true;
          row.cells[ci].push(ref);
          fRow.cells[ci].push(ref);
          totals[ci].push(ref);
        });
        if (any) {
          row.tagged++;
          fRow.tagged++;
        }
      }
      setRows.push(row);
    }
    rows.push(fRow, ...setRows);
  }
  return { group, columns, rows, totals, plays, templateSections, unresolved: book.counts.unresolved };
}

export interface SituationPlay {
  ref: BookPlayRef;
  weight: number;
  categories: ConceptCategory[];
}

/** Plays in the book with a CPU weight for `situation`, heaviest first (book order breaks ties). */
export function situationPlays(book: ResolvedBook, doc: ConceptsDoc | null | undefined, situation: string): SituationPlay[] {
  const out: SituationPlay[] = [];
  for (const ref of bookPlayRefs(book)) {
    const cpu = ref.entry.cpu;
    const w = cpu && typeof cpu === "object" ? cpu[situation] : undefined;
    if (typeof w !== "number" || !Number.isFinite(w)) continue;
    out.push({ ref, weight: w, categories: playCategories(doc, ref.play.key) });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

/** Per situation key: how many plays carry a weight and the summed weight. */
export function situationCounts(book: ResolvedBook): Map<string, { plays: number; weight: number }> {
  const out = new Map<string, { plays: number; weight: number }>();
  for (const ref of bookPlayRefs(book)) {
    const cpu = ref.entry.cpu;
    if (!cpu || typeof cpu !== "object") continue;
    for (const [k, w] of Object.entries(cpu)) {
      if (typeof w !== "number" || !Number.isFinite(w)) continue;
      const cur = out.get(k) ?? { plays: 0, weight: 0 };
      cur.plays++;
      cur.weight += w;
      out.set(k, cur);
    }
  }
  return out;
}

export interface CoverageRow {
  category: ConceptCategory;
  depth: number;
  /** Plays in the book carrying the category or a descendant. */
  plays: BookPlayRef[];
  /** Formations (book order) with their play counts. */
  formations: { name: string; count: number }[];
  sets: number;
  /** Plays of this category assigned to an audible slot. */
  audibles: { ref: BookPlayRef; slot: AudibleSlot }[];
  /** Plays with at least one CPU weight. */
  weighted: number;
}

/** Coverage summary per category (tree order, all groups) for a book. */
export function categoryCoverage(book: ResolvedBook, doc: ConceptsDoc | null | undefined): CoverageRow[] {
  const ix = conceptIndex(doc);
  const refs = bookPlayRefs(book);
  const expanded = refs.map((r) => expandedTags(doc, r.play.key));
  return ix.tree.map((n) => {
    const plays = refs.filter((_, i) => expanded[i].has(n.cat.id));
    const forms = new Map<string, number>();
    const sets = new Set<string>();
    const audibles: CoverageRow["audibles"] = [];
    let weighted = 0;
    for (const r of plays) {
      forms.set(r.formation, (forms.get(r.formation) ?? 0) + 1);
      sets.add(`${r.f}/${r.s}`);
      const a = r.entry.audible;
      if (a === 1 || a === 2 || a === 3 || a === 4) audibles.push({ ref: r, slot: a });
      if (r.entry.cpu && Object.keys(r.entry.cpu).length) weighted++;
    }
    return {
      category: n.cat,
      depth: n.depth,
      plays,
      formations: [...forms].map(([name, count]) => ({ name, count })),
      sets: sets.size,
      audibles,
      weighted,
    };
  });
}

/** Book plays with no tag at all. */
export function untaggedPlays(book: ResolvedBook, doc: ConceptsDoc | null | undefined): BookPlayRef[] {
  return bookPlayRefs(book).filter((r) => tagsOfPlay(doc, r.play.key).length === 0);
}
