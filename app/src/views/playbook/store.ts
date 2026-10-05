// Builder UI state: selection (by stable entry id, see model/playbook.ts bookIds), tree expansion and the add-plays
// drawer. One builder is open at a time, so this is a single store reset per path.
//
// Node ids: "BOOK" (the book root), entry ids ("F:shotgun#0", "F:shotgun#0/S:bunch#0", ".../P:mesh#0") and
// read-only template contents under a template formation ("F:special#0/TS:<setId>", ".../TS:<setId>/TP:<playId>#k").
import { create } from "zustand";

export const BOOK_ID = "BOOK";

export type NodeLevel = "book" | "formation" | "set" | "play" | "tset" | "tplay";

export function levelOf(id: string): NodeLevel {
  if (id === BOOK_ID) return "book";
  const last = id.slice(id.lastIndexOf("/") + 1);
  if (last.startsWith("TP:")) return "tplay";
  if (last.startsWith("TS:")) return "tset";
  if (last.startsWith("P:")) return "play";
  if (last.startsWith("S:")) return "set";
  return "formation";
}

export function parentOf(id: string): string {
  if (id === BOOK_ID) return BOOK_ID;
  const i = id.lastIndexOf("/");
  return i < 0 ? BOOK_ID : id.slice(0, i);
}

/** Ancestors from the formation down (excluding the node and BOOK). */
export function ancestorsOf(id: string): string[] {
  const out: string[] = [];
  let p = parentOf(id);
  while (p !== BOOK_ID) {
    out.unshift(p);
    p = parentOf(p);
  }
  return out;
}

/** The builder's three steps: 1 pick a set (tree), 2 add & order plays (middle), 3 audibles & CPU (right). */
export type BuilderStep = 1 | 2 | 3;

/** Which step the selection is in: a set → 2, a play → 3, anything else → 1. */
export function stepOf(id: string): BuilderStep {
  const level = levelOf(id);
  if (level === "set" || level === "tset") return 2;
  if (level === "play" || level === "tplay") return 3;
  return 1;
}

/** Same-level check for multi-select (template rows never multi-select). */
const sameLevel = (a: string, b: string) => levelOf(a) === levelOf(b) && !levelOf(a).startsWith("t") && a !== BOOK_ID;

export interface BuilderUi {
  path?: string;
  cursor: string;
  selected: string[];
  anchor?: string;
  /** Explicit expand/collapse overrides (see isExpanded). */
  expanded: Record<string, boolean>;
  drawer: boolean;
  /** CPU weights editor: every situation instead of the common ones. */
  cpuShowAll: boolean;
  clipboardOpen: boolean;

  /** Reset for a playbook (no-op when it's already the open one). */
  open(path: string): void;
  /**
   * Select a node. `additive` toggles it in the multi-selection (same level only); `range` selects every id between
   * the anchor and `id` in `order` (the visible order).
   */
  select(id: string, opts?: { additive?: boolean; range?: boolean; order?: string[] }): void;
  selectMany(ids: string[], cursor?: string): void;
  expand(id: string, on: boolean): void;
  setDrawer(open: boolean): void;
  set(partial: Partial<Pick<BuilderUi, "cpuShowAll" | "clipboardOpen">>): void;
}

/** Default: explicit formations open, sets and template sections closed. */
export function isExpanded(expanded: Record<string, boolean>, id: string, template = false): boolean {
  const v = expanded[id];
  if (v !== undefined) return v;
  const level = levelOf(id);
  return level === "formation" && !template;
}

export const useBuilderUi = create<BuilderUi>()((set, get) => ({
  path: undefined,
  cursor: BOOK_ID,
  selected: [BOOK_ID],
  anchor: undefined,
  expanded: {},
  drawer: false,
  cpuShowAll: false,
  clipboardOpen: false,

  open(path) {
    if (get().path === path) return;
    set({ path, cursor: BOOK_ID, selected: [BOOK_ID], anchor: undefined, expanded: {}, drawer: false });
  },

  select(id, opts = {}) {
    const st = get();
    const expanded = { ...st.expanded };
    for (const a of ancestorsOf(id)) expanded[a] = true;
    let selected: string[] = [id];
    let anchor: string | undefined = id;
    if (opts.range && st.anchor && opts.order && sameLevel(st.anchor, id)) {
      const a = opts.order.indexOf(st.anchor);
      const b = opts.order.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        selected = opts.order.slice(lo, hi + 1).filter((x) => sameLevel(x, id));
        anchor = st.anchor;
      }
    } else if (opts.additive && sameLevel(st.cursor, id)) {
      const has = st.selected.includes(id);
      selected = has ? st.selected.filter((x) => x !== id) : [...st.selected.filter((x) => sameLevel(x, id)), id];
      if (!selected.length) selected = [id];
      else if (has) {
        // Deselecting the cursor moves it to the last remaining member.
        set({ selected, cursor: id === st.cursor ? selected[selected.length - 1] : st.cursor, anchor: id, expanded });
        return;
      }
    }
    set({ cursor: id, selected, anchor, expanded });
  },

  selectMany(ids, cursor) {
    if (!ids.length) return;
    const c = cursor ?? ids[ids.length - 1];
    const expanded = { ...get().expanded };
    for (const id of ids) for (const a of ancestorsOf(id)) expanded[a] = true;
    set({ selected: ids, cursor: c, anchor: ids[0], expanded });
  },

  expand(id, on) {
    const st = get();
    if (st.expanded[id] === on) return;
    set({ expanded: { ...st.expanded, [id]: on } });
  },

  setDrawer(open) {
    if (get().drawer !== open) set({ drawer: open });
  },

  set(partial) {
    set(partial);
  },
}));
