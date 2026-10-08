import { describe as suite, expect, it } from "vitest";
import type { CallFormation, CallGroup, CallPlay, CallSet } from "./playcallModel";
import {
  ROWS_VISIBLE,
  VISIBLE,
  cardsLeft,
  closeCards,
  describe,
  initialState,
  listTop,
  openCards,
  randomPlay,
  selectRow,
  setTab,
  step,
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
  favorites: [play(0, 0, 1), play(0, 0, 2)],
  recents: [],
} as unknown as Ctx;

suite("formation tab", () => {
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
    st = step(ctx, st, "LEFT"); // before the first set: wraps to the last
    expect(describe(ctx, st).set?.id).toBe("0.2");
    st = step(ctx, st, "RIGHT");
    expect(describe(ctx, st).set?.id).toBe("0.0");
    st = step(ctx, st, "RIGHT");
    expect(describe(ctx, st).set?.id).toBe("0.1");
  });

  it("remembers each formation's set", () => {
    let st = step(ctx, initialState(), "RIGHT"); // formation 0 → set 1
    st = step(ctx, st, "DOWN"); // formation 1
    st = step(ctx, st, "UP"); // back
    expect(describe(ctx, st).set?.id).toBe("0.1");
  });

  it("Enter opens the cards, ← → walk them, ↑ ↓ jump a page, Back returns", () => {
    let st = openCards(ctx, initialState());
    expect(describe(ctx, st).showCards).toBe(true);
    expect(st.play).toBe(0);
    st = step(ctx, st, "LEFT");
    expect(st.play).toBe(0); // no wrap inside the cards
    st = step(ctx, st, "RIGHT");
    st = step(ctx, st, "RIGHT");
    expect(st.play).toBe(2);
    st = step(ctx, st, "DOWN"); // 2 + 3 → clamps to the last (index 4)
    expect(st.play).toBe(4);
    st = step(ctx, st, "UP");
    expect(st.play).toBe(1);
    expect(closeCards(st).inPlays).toBe(false);
  });

  it("won't open an empty set and picking a row leaves the cards", () => {
    const empty = { ...initialState(), row: 2 };
    expect(openCards(ctx, empty)).toBe(empty);
    expect(selectRow(openCards(ctx, initialState()), 1)).toMatchObject({ row: 1, inPlays: false, play: 0 });
  });

  it("stepSet (the bar's arrows) changes the set and drops back to the bar", () => {
    const st = stepSet(ctx, openCards(ctx, initialState()), 1);
    expect(describe(ctx, st).set?.id).toBe("0.1");
    expect(st.inPlays).toBe(false);
  });
});

suite("other tabs", () => {
  it("concept and play type: a list of groups, their plays as cards, ↑ ↓ change the group", () => {
    let st = setTab(initialState(), "concept");
    let v = describe(ctx, st);
    expect(v.rows.map((r) => r.name)).toEqual(["Mesh", "Smash"]);
    expect(v.cards).toHaveLength(4);
    expect(v.showCards).toBe(true);
    st = step(ctx, st, "DOWN");
    v = describe(ctx, st);
    expect(v.bar.label).toBe("Smash");
    expect(v.cards).toHaveLength(2);
    expect(describe(ctx, setTab(initialState(), "type")).cards).toHaveLength(7);
  });

  it("audibles: the set's audible plays in slot order, empty slots skipped", () => {
    const v = describe(ctx, setTab(initialState(), "audibles"));
    expect(v.cards.map((c) => c.id)).toEqual(["0.0.0", "0.0.2"]);
    expect(v.bar.sub).toBe("2 audibles");
  });

  it("favorites / recent: just the cards, no list", () => {
    const v = describe(ctx, setTab(initialState(), "favorites"));
    expect(v.hasList).toBe(false);
    expect(v.cards).toHaveLength(2);
    expect(describe(ctx, setTab(initialState(), "recent")).bar.sub).toBe("0 plays");
  });

  it("switching tabs starts at the top but keeps the chosen sets", () => {
    const st = setTab(step(ctx, step(ctx, initialState(), "RIGHT"), "DOWN"), "concept");
    expect(st).toMatchObject({ tab: "concept", row: 0, play: 0 });
    expect(setTab(st, "formation").sets).toEqual({ 0: 1 });
  });
});

suite("scrolling windows", () => {
  it("keeps the selection in view and never scrolls past the ends", () => {
    expect(listTop(0, 4, 20)).toBe(0);
    expect(listTop(0, 5, 20)).toBe(1);
    expect(listTop(10, 3, 20)).toBe(3);
    expect(listTop(0, 2, 3)).toBe(0);
    expect(listTop(18, 19, 20)).toBe(20 - ROWS_VISIBLE);
    expect(cardsLeft(0, 2, 10)).toBe(0);
    expect(cardsLeft(0, 3, 10)).toBe(1);
    expect(cardsLeft(5, 1, 10)).toBe(1);
    expect(cardsLeft(0, 1, 2)).toBe(0);
    expect(VISIBLE).toBe(3);
  });
});

suite("random play", () => {
  it("lands on a real play, opening the set on the formation tab", () => {
    const st = randomPlay(ctx, initialState(), () => 0.99);
    const v = describe(ctx, st);
    expect(v.cards.length).toBeGreaterThan(0);
    expect(st.inPlays).toBe(true);
    expect(v.cards[st.play]).toBeDefined();
  });

  it("skips an empty formation", () => {
    const st = randomPlay(ctx, initialState(), () => 0.9); // 0.9 * 3 = row 2, which is empty
    expect(describe(ctx, st).cards.length).toBeGreaterThan(0);
  });

  it("picks among favorites on the favorites tab", () => {
    const st = randomPlay(ctx, setTab(initialState(), "favorites"), () => 0.9);
    expect(st.play).toBe(1);
  });
});
