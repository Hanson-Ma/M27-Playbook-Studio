// The play-select screen's state machine (pure TS), modelled on Madden 27's own play-call flow (two screens):
//   BROWSE   the tab row (FORMATION · CONCEPT · PLAY TYPE · PERSONNEL GROUP · AUDIBLES · FAVORITES · RECENT), a list on
//            the left and, on the formation / audibles tabs, the set bar (‹ SET - 9 PLAYS ›) with the formation dots.
//            ↑ ↓ change the row, ← → cycle the sets (wrapping), A / Enter opens the PLAYS screen.
//   PLAYS    the tab row becomes the sets of that formation (or the groups of the list); LB / RB switch them. The
//            plays sit three to a row, one row in view, scrolling up and down: ← → move along the row, ↑ ↓ a row at a
//            time. B / Esc goes back to BROWSE. Favorites and Recent are only ever this screen.
import type { AudibleSlot } from "../../model/types";
import { normalOf, personnelOf } from "../../model/sets";
import type { CallBook, CallFormation, CallGroup, CallPlay, CallSet, ConceptGrouping, PlayCallTab } from "./playcallModel";

/** Cards per row on the plays screen (the game shows three). */
export const VISIBLE = 3;
/** Rows of the left list visible at once. */
export const ROWS_VISIBLE = 5;

export interface Ctx {
  book: CallBook;
  concepts: ConceptGrouping;
  types: CallGroup[];
  personnel: CallGroup[];
  favorites: CallPlay[];
  recents: CallPlay[];
}

export interface ScreenState {
  tab: PlayCallTab;
  /** Selected row of the left list. */
  row: number;
  /** Selected set per formation row (formation / audibles tabs). */
  sets: Record<number, number>;
  /** The plays screen is open (always, on favorites / recent). */
  inPlays: boolean;
  /** Selected card. */
  play: number;
}

/** Whether the plays screen is showing: always on favorites / recent, else after A / Enter. */
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
  /** Cards of the plays screen (the set's plays, a group's plays, audibles, favorites…). */
  cards: CallPlay[];
  /** The plays screen is showing (otherwise the browse screen). */
  showCards: boolean;
  /** Browse screen: the bar above the middle, a set switcher (formation / audibles tabs) or a plain title. */
  bar: { kind: "sets" | "title" | "none"; label: string; sub: string };
  /** The browse screen has a left list (not favorites / recent). */
  hasList: boolean;
  /** Plays screen: its tab row (the formation's sets, or the list's groups); empty = the main tabs. */
  groups: { id: string; label: string }[];
  groupIndex: number;
  /** Plays screen: the trail on the side label ("FORMATION / SINGLEBACK"). */
  trail: string[];
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const wrap = (n: number, len: number) => (len ? ((n % len) + len) % len : 0);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Audible plays of a set in slot order (empty slots skipped). */
export function audiblePlays(set: CallSet | undefined): CallPlay[] {
  if (!set) return [];
  return ([1, 2, 3, 4] as AudibleSlot[]).map((s) => set.audibles[s]).filter((x): x is CallPlay => !!x);
}

const TAB_TRAIL: Record<PlayCallTab, string> = {
  formation: "Formation",
  concept: "Concept",
  type: "Play Type",
  personnel: "Personnel Group",
  audibles: "Audibles",
  favorites: "Favorites",
  recent: "Recent",
};

function groupsOf(ctx: Ctx, tab: PlayCallTab): CallGroup[] {
  return tab === "concept" ? ctx.concepts.groups : tab === "type" ? ctx.types : tab === "personnel" ? ctx.personnel : [];
}

/** What the screen shows for a state. */
export function describe(ctx: Ctx, st: ScreenState): View {
  const showCards = cardsFocused(st);
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
      const pers = set?.set ? personnelOf(normalOf(set.set)) : undefined;
      return {
        rows,
        row,
        formation,
        sets,
        setIndex,
        set,
        cards,
        showCards,
        bar: {
          kind: "sets",
          label: set ? set.name : formation ? "No sets" : "No formations",
          sub: set ? [audibles ? plural(cards.length, "audible") : plural(set.plays.length, "play"), pers ? `${pers} personnel` : ""].filter(Boolean).join(" · ") : "",
        },
        hasList: true,
        groups: sets.map((x) => ({ id: x.id, label: x.name })),
        groupIndex: setIndex,
        trail: [TAB_TRAIL[st.tab], formation?.name ?? ""],
      };
    }
    case "concept":
    case "type":
    case "personnel": {
      const groups = groupsOf(ctx, st.tab);
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
        showCards,
        bar: { kind: "title", label: g ? g.label : "Nothing here", sub: g ? plural(g.items.length, "play") : "" },
        hasList: true,
        groups: groups.map((x) => ({ id: x.id, label: x.label })),
        groupIndex: row,
        trail: [TAB_TRAIL[st.tab], g?.label ?? ""],
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
        groups: [],
        groupIndex: 0,
        trail: [TAB_TRAIL[st.tab]],
      };
    }
  }
}

export type Dir = "UP" | "DOWN" | "LEFT" | "RIGHT";

/** One step of the d-pad. */
export function step(ctx: Ctx, st: ScreenState, dir: Dir): ScreenState {
  const v = describe(ctx, st);
  if (!cardsFocused(st)) {
    // Browse: ↑ ↓ rows; ← → cycle the sets (formation / audibles tabs).
    if (dir === "UP" || dir === "DOWN") return { ...st, row: wrap(v.row + (dir === "DOWN" ? 1 : -1), v.rows.length), play: 0 };
    if (!v.sets.length) return st;
    return { ...st, sets: { ...st.sets, [v.row]: wrap(v.setIndex + (dir === "RIGHT" ? 1 : -1), v.sets.length) }, play: 0 };
  }
  // Plays: ← → along the row (and on into the next / previous row), ↑ ↓ a row at a time; no wrap at the ends.
  const n = v.cards.length;
  if (dir === "LEFT" || dir === "RIGHT") return { ...st, play: clamp(st.play + (dir === "RIGHT" ? 1 : -1), 0, Math.max(0, n - 1)) };
  const row = cardRow(st.play) + (dir === "DOWN" ? 1 : -1);
  if (row < 0 || row >= cardRows(n)) return st;
  return { ...st, play: clamp(row * VISIBLE + (st.play % VISIBLE), 0, Math.max(0, n - 1)) };
}

/** Choose a row with the mouse (back to the browse screen). */
export function selectRow(st: ScreenState, row: number): ScreenState {
  return { ...st, row, inPlays: false, play: 0 };
}

/** Change a formation's set (the arrows of the set bar), staying on whichever screen is showing. */
export function stepSet(ctx: Ctx, st: ScreenState, delta: 1 | -1): ScreenState {
  const v = describe(ctx, st);
  if (!v.sets.length) return st;
  return { ...st, sets: { ...st.sets, [v.row]: wrap(v.setIndex + delta, v.sets.length) }, play: 0 };
}

/** LB / RB on the plays screen: the next set of the formation, or the next group of the list. */
export function stepGroup(ctx: Ctx, st: ScreenState, delta: 1 | -1): ScreenState {
  const v = describe(ctx, st);
  if (!v.groups.length) return st;
  if (st.tab === "formation" || st.tab === "audibles") return stepSet(ctx, st, delta);
  return { ...st, row: wrap(v.row + delta, v.rows.length), play: 0 };
}

/** Pick a group tab on the plays screen (a set of the formation, a group of the list). */
export function selectGroup(st: ScreenState, index: number): ScreenState {
  if (st.tab === "formation" || st.tab === "audibles") return { ...st, sets: { ...st.sets, [st.row]: index }, play: 0 };
  return { ...st, row: index, play: 0 };
}

/** A / Enter on the browse screen: open the plays screen. Returns the same state when there is nothing to open. */
export function openCards(ctx: Ctx, st: ScreenState): ScreenState {
  if (cardsFocused(st)) return st;
  const v = describe(ctx, st);
  if (v.cards.length) return { ...st, inPlays: true, play: 0 };
  return st;
}

/** B / Esc: from the plays screen back to the browse screen. */
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

/** The card row a play is on (the plays screen shows one row of three at a time). */
export function cardRow(play: number): number {
  return Math.floor(Math.max(0, play) / VISIBLE);
}

/** Number of card rows. */
export function cardRows(count: number): number {
  return Math.max(1, Math.ceil(count / VISIBLE));
}

/** A random play of the current tab, as a state that has it selected on the plays screen (the game's "Random play"). */
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
