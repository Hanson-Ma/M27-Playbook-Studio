import { describe as suite, expect, it } from "vitest";
import type { CallFormation, CallGroup, CallPlay, CallSet } from "./playcallModel";
import {
  ROWS_VISIBLE,
  VISIBLE,
  cardRow,
  cardRows,
  cardsFocused,
  closeCards,
  describe,
  initialState,
  listTop,
  openCards,
  randomPlay,
  selectGroup,
  selectRow,
  setTab,
  step,
  stepGroup,
  stepSet,
  type Ctx,
} from "./gameScreenModel";

const play = (f: number, s: number, p: number): CallPlay => ({ id: `${f}.${s}.${p}`, f, s, p, name: `P${f}.${s}.${p}` }) as unknown as CallPlay;
const set = (f: number, s: number, n: number, audibles: Record<number, number> = {}): CallSet => {
  const plays = Array.from({ length: n }, (_, p) => play(f, s, p));
  const aud: Record<number, CallPlay> = {};
  for (const [slot, idx] of Object.entries(audibles)) aud[+slot] = plays[idx];
  return { id: `${f}.${s}`, f, s, name: `Set ${f}.${s}`, plays, audibles: aud } as unknown as CallSet;
};
const formation = (f: number, counts: number[], aud?: Record<number, number>): CallFormation => {
  const sets = counts.map((n, s) => set(f, s, n, aud));
  return { id: String(f), f, name: `Form ${f}`, sets, playCount: counts.reduce((a, b) => a + b, 0), template: false } as unknown as CallFormation;
};
const group = (id: string, n: number): CallGroup => ({ id, label: id, items: Array.from({ length: n }, (_, i) => play(9, 9, i)) }) as unknown as CallGroup;

const book = { formations: [formation(0, [5, 2, 3], { 1: 0, 3: 2 }), formation(1, [4]), formation(2, [])], sets: [], plays: [], byId: new Map(), byKey: new Map() };
const ctx = {
  book,
  concepts: { source: "tags", groups: [group("Mesh", 4), group("Smash", 2)] },
  types: [group("PASS", 7), group("RUN", 5)],
  personnel: [group("11 Personnel", 6)],
  favorites: [play(0, 0, 1), play(0, 0, 2)],
  recents: [],
} as unknown as Ctx;

suite("browse screen (formation tab)", () => {
  it("lists the formations with their set and play counts, and shows the first set's bar", () => {
    const v = describe(ctx, initialState());
    expect(v.rows.map((r) => [r.name, r.stats[0].value, r.stats[1].value])).toEqual([
      ["Form 0", "3", "10"],
      ["Form 1", "1", "4"],
      ["Form 2", "0", "0"],
    ]);
    expect(v.bar).toEqual({ kind: "sets", label: "Set 0.0", sub: "5 plays" });
    expect(v.showCards).toBe(false);
  });

  it("↑ ↓ change formation (wrapping) and ← → cycle the sets (wrapping)", () => {
    let st = initialState();
    st = step(ctx, st, "UP");
    expect(describe(ctx, st).row).toBe(2);
    st = step(ctx, st, "DOWN");
    expect(describe(ctx, st).row).toBe(0);
    st = step(ctx, st, "LEFT");
    expect(describe(ctx, st).set?.id).toBe("0.2");
    st = step(ctx, st, "RIGHT");
    expect(describe(ctx, st).set?.id).toBe("0.0");
    st = step(ctx, st, "RIGHT");
    expect(describe(ctx, st).set?.id).toBe("0.1");
  });

  it("remembers each formation's set", () => {
    let st = step(ctx, initialState(), "RIGHT");
    st = step(ctx, st, "DOWN");
    st = step(ctx, st, "UP");
    expect(describe(ctx, st).set?.id).toBe("0.1");
  });

  it("won't open an empty set and picking a row goes back to browsing", () => {
    const empty = { ...initialState(), row: 2 };
    expect(openCards(ctx, empty)).toBe(empty);
    expect(selectRow(openCards(ctx, initialState()), 1)).toMatchObject({ row: 1, inPlays: false, play: 0 });
  });
});

suite("plays screen", () => {
  it("opens with the formation's sets as its tabs and the trail on the side", () => {
    const st = openCards(ctx, initialState());
    const v = describe(ctx, st);
    expect(cardsFocused(st)).toBe(true);
    expect(v.showCards).toBe(true);
    expect(v.groups.map((g) => g.label)).toEqual(["Set 0.0", "Set 0.1", "Set 0.2"]);
    expect(v.groupIndex).toBe(0);
    expect(v.trail).toEqual(["Formation", "Form 0"]);
  });

  it("three to a row: ← → along it, ↑ ↓ a row at a time, no wrap at the ends", () => {
    let st = openCards(ctx, initialState()); // 5 plays: rows [0 1 2] [3 4]
    expect(VISIBLE).toBe(3);
    st = step(ctx, st, "LEFT");
    expect(st.play).toBe(0);
    st = step(ctx, step(ctx, st, "RIGHT"), "RIGHT");
    expect(st.play).toBe(2);
    expect(cardRow(st.play)).toBe(0);
    st = step(ctx, st, "DOWN"); // column 2 of row 1 doesn't exist: the last card
    expect(st.play).toBe(4);
    expect(cardRow(st.play)).toBe(1);
    expect(step(ctx, st, "DOWN").play).toBe(4); // no row below
    st = step(ctx, st, "UP");
    expect(st.play).toBe(1);
    expect(cardRows(5)).toBe(2);
    expect(closeCards(st).inPlays).toBe(false);
  });

  it("LB / RB switch the set (or the group) and start at its first play", () => {
    let st = { ...openCards(ctx, initialState()), play: 3 };
    st = stepGroup(ctx, st, 1);
    expect(describe(ctx, st).set?.id).toBe("0.1");
    expect(st).toMatchObject({ inPlays: true, play: 0 });
    st = stepGroup(ctx, st, -1);
    st = stepGroup(ctx, st, -1);
    expect(describe(ctx, st).set?.id).toBe("0.2"); // wraps
    expect(describe(ctx, selectGroup(st, 1)).set?.id).toBe("0.1");
    let g = openCards(ctx, setTab(initialState(), "concept"));
    g = stepGroup(ctx, g, 1);
    expect(describe(ctx, g).bar.label).toBe("Smash");
    expect(describe(ctx, selectGroup(g, 0)).bar.label).toBe("Mesh");
  });

  it("stepSet (the bar's arrows) changes the set and keeps the screen", () => {
    const st = stepSet(ctx, openCards(ctx, initialState()), 1);
    expect(describe(ctx, st).set?.id).toBe("0.1");
    expect(st).toMatchObject({ inPlays: true, play: 0 });
  });
});

suite("other tabs", () => {
  it("concept / play type / personnel: a list of groups, A opens its plays", () => {
    let st = setTab(initialState(), "concept");
    let v = describe(ctx, st);
    expect(v.rows.map((r) => r.name)).toEqual(["Mesh", "Smash"]);
    expect(v.showCards).toBe(false);
    st = step(ctx, st, "DOWN");
    v = describe(ctx, st);
    expect(v.bar.label).toBe("Smash");
    expect(v.cards).toHaveLength(2);
    expect(describe(ctx, openCards(ctx, st)).showCards).toBe(true);
    expect(describe(ctx, setTab(initialState(), "type")).cards).toHaveLength(7);
    expect(describe(ctx, setTab(initialState(), "personnel")).rows.map((r) => r.name)).toEqual(["11 Personnel"]);
  });

  it("audibles: the set's audible plays in slot order, empty slots skipped", () => {
    const v = describe(ctx, setTab(initialState(), "audibles"));
    expect(v.cards.map((c) => c.id)).toEqual(["0.0.0", "0.0.2"]);
    expect(v.bar.sub).toBe("2 audibles");
  });

  it("favorites / recent: just the plays screen, no list or groups", () => {
    const v = describe(ctx, setTab(initialState(), "favorites"));
    expect(v.hasList).toBe(false);
    expect(v.showCards).toBe(true);
    expect(v.groups).toEqual([]);
    expect(v.cards).toHaveLength(2);
    expect(describe(ctx, setTab(initialState(), "recent")).bar.sub).toBe("0 plays");
  });

  it("switching tabs starts at the top but keeps the chosen sets", () => {
    const st = setTab(step(ctx, step(ctx, initialState(), "RIGHT"), "DOWN"), "concept");
    expect(st).toMatchObject({ tab: "concept", row: 0, play: 0 });
    expect(setTab(st, "formation").sets).toEqual({ 0: 1 });
  });
});

suite("scrolling", () => {
  it("keeps the selected row in view and never scrolls past the ends", () => {
    expect(listTop(0, 4, 20)).toBe(0);
    expect(listTop(0, 5, 20)).toBe(1);
    expect(listTop(10, 3, 20)).toBe(3);
    expect(listTop(0, 2, 3)).toBe(0);
    expect(listTop(18, 19, 20)).toBe(20 - ROWS_VISIBLE);
    expect(cardRow(0)).toBe(0);
    expect(cardRow(5)).toBe(1);
    expect(cardRows(0)).toBe(1);
  });
});

suite("random play", () => {
  it("lands on a real play on the plays screen", () => {
    const st = randomPlay(ctx, initialState(), () => 0.99);
    const v = describe(ctx, st);
    expect(v.cards.length).toBeGreaterThan(0);
    expect(st.inPlays).toBe(true);
    expect(v.cards[st.play]).toBeDefined();
  });

  it("skips an empty formation", () => {
    const st = randomPlay(ctx, initialState(), () => 0.9);
    expect(describe(ctx, st).cards.length).toBeGreaterThan(0);
  });

  it("picks among favorites on the favorites tab", () => {
    const st = randomPlay(ctx, setTab(initialState(), "favorites"), () => 0.9);
    expect(st.play).toBe(1);
  });
});
