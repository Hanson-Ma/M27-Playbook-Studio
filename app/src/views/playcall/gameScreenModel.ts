// The play-select screen's state machine (pure TS), modelled on Madden 27's own play-call flow, with the plays in a
// vertical column on the right (so scrolling within a formation / group is up and down):
//   FORMATION tab   a list of formations on the left; ↑ ↓ change formation, ← → cycle its sets (with wrap-around) in
//                   the set bar, Enter opens the set's plays as a column of cards (3 visible): ↑ ↓ move along it, ← →
//                   switch set, Back returns to the set bar.
//   CONCEPT / PLAY TYPE   a list of groups on the left, the group's plays as cards straight away: ↑ ↓ change group,
//                   → moves into the cards (↑ ↓ along them), ← back to the list.
//   AUDIBLES        the formation list and set bar like FORMATION, the set's audible plays as the cards.
//   FAVORITES / RECENT    just the cards, ↑ ↓ along them.
import type { AudibleSlot } from "../../model/types";
import type { CallBook, CallFormation, CallGroup, CallPlay, CallSet, ConceptGrouping, PlayCallTab } from "./playcallModel";

/** Cards visible at once (the game shows three). */
export const VISIBLE = 3;
/** Rows of the left list visible at once. */
export const ROWS_VISIBLE = 5;

export interface Ctx {
  book: CallBook;
  concepts: ConceptGrouping;
  types: CallGroup[];
  favorites: CallPlay[];
  recents: CallPlay[];
}

export interface ScreenState {
  tab: PlayCallTab;
  /** Selected row of the left list. */
  row: number;
  /** Selected set per formation row (formation / audibles tabs). */
  sets: Record<number, number>;
  /** Focus on the cards: false = the left list / set bar (formation tab: the formation dots), true = the play cards. */
  inPlays: boolean;
  /** Selected card. */
  play: number;
}

/** Whether the cards hold the focus (↑ ↓ move along them): always on favorites / recent, else after Enter / →. */
export const cardsFocused = (st: ScreenState): boolean => st.tab === "favorites" || st.tab === "recent" || st.inPlays;

export const initialState = (tab: PlayCallTab = "formation"): ScreenState => ({ tab, row: 0, sets: {}, inPlays: false, play: 0 });

export interface RowInfo {
  id: string;
  name: string;
  /** Two small stats shown at the right of the row (value over label). */
  stats: [{ value: string; label: string }, { value: string; label: string }];
  /** A template section that hasn't loaded (can't be opened). */
  locked?: boolean;
}

export interface View {
  rows: RowInfo[];
  row: number;
  formation?: CallFormation;
  /** Sets of the selected formation, and which one is shown. */
  sets: CallSet[];
  setIndex: number;
  set?: CallSet;
  /** Cards for the card view (the set's plays, a group's plays, audibles, favorites…). */
  cards: CallPlay[];
  /** Whether the card view is showing (otherwise the set bar + dots). */
  showCards: boolean;
  /** The bar above the middle: a set switcher (formation / audibles tabs) or a plain title. */
  bar: { kind: "sets" | "title" | "none"; label: string; sub: string };
  /** The left list is shown (not for favorites / recent). */
  hasList: boolean;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const wrap = (n: number, len: number) => (len ? ((n % len) + len) % len : 0);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Audible plays of a set in slot order (empty slots skipped). */
export function audiblePlays(set: CallSet | undefined): CallPlay[] {
  if (!set) return [];
  return ([1, 2, 3, 4] as AudibleSlot[]).map((s) => set.audibles[s]).filter((x): x is CallPlay => !!x);
}

/** What the screen shows for a state. */
export function describe(ctx: Ctx, st: ScreenState): View {
  switch (st.tab) {
    case "formation":
    case "audibles": {
      const formations = ctx.book.formations;
      const rows: RowInfo[] = formations.map((f) => ({
        id: f.id,
        name: f.name,
        stats: [
          { value: String(f.sets.length), label: "SETS" },
          { value: String(f.playCount), label: "PLAYS" },
        ],
        locked: f.template && f.templateState !== "ready",
      }));
      const row = clamp(st.row, 0, Math.max(0, rows.length - 1));
      const formation = formations[row];
      const sets = formation?.sets ?? [];
      const setIndex = sets.length ? clamp(st.sets[row] ?? 0, 0, sets.length - 1) : 0;
      const set = sets[setIndex];
      const audibles = st.tab === "audibles";
      const cards = audibles ? audiblePlays(set) : (set?.plays ?? []);
      return {
        rows,
        row,
        formation,
        sets,
        setIndex,
        set,
        cards,
        showCards: audibles || st.inPlays,
        bar: {
          kind: "sets",
          label: set ? set.name : formation ? "No sets" : "No formations",
          sub: set ? (audibles ? plural(cards.length, "audible") : plural(set.plays.length, "play")) : "",
        },
        hasList: true,
      };
    }
    case "concept":
    case "type": {
      const groups = st.tab === "concept" ? ctx.concepts.groups : ctx.types;
      const rows: RowInfo[] = groups.map((g) => ({
        id: g.id,
        name: g.label,
        stats: [
          { value: String(g.items.length), label: "PLAYS" },
          { value: g.eyebrow ?? "", label: "" },
        ],
      }));
      const row = clamp(st.row, 0, Math.max(0, rows.length - 1));
      const g = groups[row];
      return {
        rows,
        row,
        sets: [],
        setIndex: 0,
        cards: g?.items ?? [],
        showCards: true,
        bar: { kind: "title", label: g ? g.label : "Nothing here", sub: g ? plural(g.items.length, "play") : "" },
        hasList: true,
      };
    }
    case "favorites":
    case "recent": {
      const items = st.tab === "favorites" ? ctx.favorites : ctx.recents;
      return {
        rows: [],
        row: 0,
        sets: [],
        setIndex: 0,
        cards: items,
        showCards: true,
        bar: { kind: "title", label: st.tab === "favorites" ? "Favorites" : "Recent", sub: plural(items.length, "play") },
        hasList: false,
      };
    }
  }
}

export type Dir = "UP" | "DOWN" | "LEFT" | "RIGHT";

/** One step of the d-pad. */
export function step(ctx: Ctx, st: ScreenState, dir: Dir): ScreenState {
  const v = describe(ctx, st);
  const sets = st.tab === "formation" || st.tab === "audibles";
  const nextSet = (d: 1 | -1): ScreenState => {
    if (!v.sets.length) return st;
    return { ...st, sets: { ...st.sets, [v.row]: wrap(v.setIndex + d, v.sets.length) }, play: 0 };
  };
  if (!cardsFocused(st)) {
    // The list / set bar: ↑ ↓ rows. ← → cycle the sets (formation / audibles); on a group list → goes into the cards.
    if (dir === "UP" || dir === "DOWN") return { ...st, row: wrap(v.row + (dir === "DOWN" ? 1 : -1), v.rows.length), play: 0 };
    if (sets) return nextSet(dir === "RIGHT" ? 1 : -1);
    return dir === "RIGHT" && v.cards.length ? { ...st, inPlays: true, play: 0 } : st;
  }
  // The cards: ↑ ↓ move along the column.
  if (dir === "UP" || dir === "DOWN") return { ...st, play: clamp(st.play + (dir === "DOWN" ? 1 : -1), 0, Math.max(0, v.cards.length - 1)) };
  if (sets) return nextSet(dir === "RIGHT" ? 1 : -1); // switch set without leaving the cards
  if (dir === "LEFT" && v.hasList) return { ...st, inPlays: false };
  return st;
}

/** Choose a row with the mouse (leaves the card view on the formation tab). */
export function selectRow(st: ScreenState, row: number): ScreenState {
  return { ...st, row, inPlays: false, play: 0 };
}

/** Change a formation's set (the arrows of the set bar). */
export function stepSet(ctx: Ctx, st: ScreenState, delta: 1 | -1): ScreenState {
  const v = describe(ctx, st);
  if (!v.sets.length) return st;
  return { ...st, sets: { ...st.sets, [v.row]: wrap(v.setIndex + delta, v.sets.length) }, play: 0 };
}

/** Enter: put the focus on the cards (the set's plays, the group's plays, the audibles). Returns the same state when there is nothing to open. */
export function openCards(ctx: Ctx, st: ScreenState): ScreenState {
  if (cardsFocused(st)) return st;
  const v = describe(ctx, st);
  if (v.cards.length) return { ...st, inPlays: true, play: 0 };
  return st;
}

/** Back: from the cards to the list / set bar. */
export function closeCards(st: ScreenState): ScreenState {
  return st.inPlays && st.tab !== "favorites" && st.tab !== "recent" ? { ...st, inPlays: false } : st;
}

/** Switch tab; the new tab starts at its top. */
export function setTab(st: ScreenState, tab: PlayCallTab): ScreenState {
  return st.tab === tab ? st : { ...initialState(tab), sets: st.sets };
}

/** The left list's scroll position that keeps `row` visible (the list scrolls a row at a time). */
export function listTop(prev: number, row: number, count: number): number {
  let top = prev;
  if (row < top) top = row;
  if (row >= top + ROWS_VISIBLE) top = row - ROWS_VISIBLE + 1;
  return clamp(top, 0, Math.max(0, count - ROWS_VISIBLE));
}

/** The first visible card index that keeps `play` in view (the column scrolls a card at a time). */
export function cardsTop(prev: number, play: number, count: number): number {
  let left = prev;
  if (play < left) left = play;
  if (play >= left + VISIBLE) left = play - VISIBLE + 1;
  return clamp(left, 0, Math.max(0, count - VISIBLE));
}

/** A random play of the current tab, as a state that has it selected (the game's "Random play"). */
export function randomPlay(ctx: Ctx, st: ScreenState, rnd: () => number = Math.random): ScreenState {
  if (st.tab === "favorites" || st.tab === "recent") {
    const n = describe(ctx, st).cards.length;
    return n ? { ...st, play: Math.floor(rnd() * n) } : st;
  }
  const rows = describe(ctx, st).rows.length;
  if (!rows) return st;
  let row = Math.floor(rnd() * rows);
  let next: ScreenState = { ...st, row, play: 0 };
  // try a few rows until one has plays
  for (let i = 0; i < rows && !describe(ctx, next).cards.length; i++) {
    row = (row + 1) % rows;
    next = { ...st, row, play: 0 };
  }
  const v = describe(ctx, next);
  if (st.tab === "formation" || st.tab === "audibles") {
    if (!v.sets.length) return next;
    // pick a set with plays
    const start = Math.floor(rnd() * v.sets.length);
    let si = start;
    for (let i = 0; i < v.sets.length && !(st.tab === "audibles" ? audiblePlays(v.sets[si]) : v.sets[si].plays).length; i++) si = (si + 1) % v.sets.length;
    next = { ...next, sets: { ...next.sets, [row]: si } };
  }
  const cards = describe(ctx, next).cards;
  return { ...next, inPlays: cards.length > 0, play: cards.length ? Math.floor(rnd() * cards.length) : 0 };
}
