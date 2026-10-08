import { describe, expect, it } from "vitest";
import type { CallFormation, CallPlay, CallSet } from "../playcall/playcallModel";
import {
  BLOCK_GAP,
  BLOCK_W,
  CARD_H,
  CARD_W,
  GAP,
  PER_ROW,
  clampK,
  fitView,
  formationAt,
  intersects,
  layoutBook,
  neighbor,
  nearestTo,
  ringOrder,
  viewFor,
  worldRect,
  zoomAt,
} from "./overviewModel";

const play = (f: number, s: number, p: number): CallPlay => ({ id: `${f}.${s}.${p}`, f, s, p, name: `P${f}.${s}.${p}` }) as unknown as CallPlay;
const set = (f: number, s: number, n: number): CallSet =>
  ({ id: `${f}.${s}`, f, s, name: `Set ${f}.${s}`, plays: Array.from({ length: n }, (_, p) => play(f, s, p)) }) as unknown as CallSet;
const formation = (f: number, counts: number[]): CallFormation => {
  const sets = counts.map((n, s) => set(f, s, n));
  return { id: String(f), f, name: `Form ${f}`, sets, playCount: counts.reduce((a, b) => a + b, 0) } as unknown as CallFormation;
};

describe("ringOrder", () => {
  it("puts the first item in the middle and wraps the last ones to its left", () => {
    expect(ringOrder([1, 2, 3]).map((o) => o.item)).toEqual([3, 1, 2]);
    expect(ringOrder([1, 2, 3, 4, 5]).map((o) => o.item)).toEqual([4, 5, 1, 2, 3]);
    expect(ringOrder([1, 2]).map((o) => o.item)).toEqual([2, 1]);
    expect(ringOrder([1]).map((o) => o.item)).toEqual([1]);
    expect(ringOrder([])).toEqual([]);
    expect(ringOrder(["a", "b", "c", "d"]).map((o) => o.index)).toEqual([2, 3, 0, 1]);
  });
});

describe("layoutBook", () => {
  const book = { formations: [formation(0, [9, 3, 4]), formation(1, [5, 6, 7, 8, 12]), formation(2, [])] };
  const l = layoutBook(book);

  it("stacks formations as bands and lays each set out in 3 columns, in play order", () => {
    expect(l.plays).toHaveLength(9 + 3 + 4 + 5 + 6 + 7 + 8 + 12);
    expect(l.formations.map((f) => [f.count, f.setCount])).toEqual([
      [16, 3],
      [38, 5],
      [0, 0],
    ]);
    expect(l.formations[1].y).toBeGreaterThan(l.formations[0].y + l.formations[0].h - 1);
    const a = l.byId.get("0.0.0")!;
    const b = l.byId.get("0.0.1")!;
    const c = l.byId.get("0.0.2")!;
    const d = l.byId.get("0.0.3")!;
    expect(b.x - a.x).toBe(CARD_W + GAP);
    expect(c.x - b.x).toBe(CARD_W + GAP);
    expect(d.x).toBe(a.x);
    expect(d.y - a.y).toBe(CARD_H + GAP);
    expect(PER_ROW).toBe(3);
  });

  it("puts the first set of every band on one spine, the next sets to its right and the last ones to its left", () => {
    const first0 = l.sets.find((s) => s.id === "0.0")!;
    const first1 = l.sets.find((s) => s.id === "1.0")!;
    expect(first0.first && first1.first).toBe(true);
    expect(first0.x).toBe(l.spineX);
    expect(first1.x).toBe(l.spineX);
    expect(l.sets.find((s) => s.id === "0.1")!.x).toBe(l.spineX + BLOCK_W + BLOCK_GAP); // second: right
    expect(l.sets.find((s) => s.id === "0.2")!.x).toBe(l.spineX - (BLOCK_W + BLOCK_GAP)); // last: left
    // 5 sets: 4 5 [1] 2 3
    const xs = ["1.3", "1.4", "1.0", "1.1", "1.2"].map((id) => l.sets.find((s) => s.id === id)!.x);
    expect(xs).toEqual([-2, -1, 0, 1, 2].map((i) => l.spineX + i * (BLOCK_W + BLOCK_GAP)));
  });

  it("never overlaps two cards and keeps every card inside its set block and band", () => {
    for (let i = 0; i < l.plays.length; i++) {
      for (let j = i + 1; j < l.plays.length; j++) expect(intersects(l.plays[i], l.plays[j])).toBe(false);
    }
    for (const p of l.plays) {
      const s = l.sets.find((x) => x.id === p.setId)!;
      expect(p.x).toBeGreaterThanOrEqual(s.x);
      expect(p.x + p.w).toBeLessThanOrEqual(s.x + s.w);
      expect(p.y + p.h).toBeLessThanOrEqual(s.y + s.h);
      expect(p.y).toBeGreaterThan(s.y);
      const band = l.formations[p.f];
      expect(p.x).toBeGreaterThanOrEqual(band.x);
      expect(p.x + p.w).toBeLessThanOrEqual(band.x + band.w);
      expect(p.y + p.h).toBeLessThanOrEqual(band.y + band.h);
    }
    expect(l.height).toBeGreaterThan(Math.max(...l.plays.map((p) => p.y + p.h)));
    expect(l.width).toBeGreaterThan(Math.max(...l.plays.map((p) => p.x + p.w)));
    expect(Math.min(...l.plays.map((p) => p.x))).toBeGreaterThan(0);
  });

  it("handles an empty playbook", () => {
    const e = layoutBook({ formations: [] });
    expect(e.plays).toEqual([]);
    expect(e.width).toBeGreaterThan(0);
    expect(fitView(e, 800, 600).k).toBeGreaterThan(0);
  });
});

describe("camera", () => {
  it("fits the whole wall and centers it", () => {
    const l = layoutBook({ formations: [formation(0, [9, 3, 4]), formation(1, [5])] });
    const v = fitView(l, 1200, 700);
    expect(v.k).toBeLessThanOrEqual(1);
    expect(l.width * v.k).toBeLessThanOrEqual(1200 + 1e-6);
    expect(l.height * v.k).toBeLessThanOrEqual(700 + 1e-6);
    expect(v.x + (l.width / 2) * v.k).toBeCloseTo(600, 5);
    expect(v.y + (l.height / 2) * v.k).toBeCloseTo(350, 5);
  });

  it("zooms around the cursor: the world point under it stays under it", () => {
    const v = { x: 100, y: -50, k: 0.5 };
    const wx = (300 - v.x) / v.k;
    const wy = (200 - v.y) / v.k;
    const z = zoomAt(v, 1.6, 300, 200);
    expect(z.k).toBeCloseTo(0.8, 6);
    expect(wx * z.k + z.x).toBeCloseTo(300, 6);
    expect(wy * z.k + z.y).toBeCloseTo(200, 6);
  });

  it("clamps the zoom", () => {
    expect(zoomAt({ x: 0, y: 0, k: 1 }, 100, 0, 0).k).toBe(clampK(100));
    expect(zoomAt({ x: 0, y: 0, k: 0.05 }, 0.01, 0, 0).k).toBe(clampK(0.0005));
  });

  it("viewFor frames a rect and worldRect reads it back", () => {
    const rect = { x: 500, y: 300, w: 1000, h: 600 };
    const v = viewFor(rect, 1000, 600, 0, 5);
    const w = worldRect(v, 1000, 600);
    expect(w.x).toBeCloseTo(rect.x, 5);
    expect(w.y).toBeCloseTo(rect.y, 5);
    expect(w.w).toBeCloseTo(rect.w, 5);
    expect(worldRect(v, 1000, 600, 0.5).w).toBeCloseTo(rect.w * 2, 5);
  });
});

describe("moving around", () => {
  const l = layoutBook({ formations: [formation(0, [9, 3, 4]), formation(1, [5])] });

  it("walks along rows and down columns", () => {
    expect(neighbor(l, "0.0.0", "RIGHT")?.id).toBe("0.0.1");
    expect(neighbor(l, "0.0.1", "LEFT")?.id).toBe("0.0.0");
    expect(neighbor(l, "0.0.0", "DOWN")?.id).toBe(`0.0.${PER_ROW}`);
    expect(neighbor(l, `0.0.${PER_ROW}`, "UP")?.id).toBe("0.0.0");
  });

  it("crosses from one set block into the next across a band", () => {
    // the first set's right edge leads to the second set (displayed to its right)
    expect(neighbor(l, `0.0.${PER_ROW - 1}`, "RIGHT")?.setId).toBe("0.1");
    // and its left edge to the last set (wrapped to the left)
    expect(neighbor(l, "0.0.0", "LEFT")?.setId).toBe("0.2");
  });

  it("goes from a band down into the next band", () => {
    expect(neighbor(l, "0.0.6", "DOWN")?.f).toBe(1);
  });

  it("finds the card nearest a point and the band under a y", () => {
    expect(nearestTo(l, 0, 0)).toBeDefined();
    expect(formationAt(l, l.formations[1].y + 10)?.f).toBe(1);
    expect(formationAt(l, 1e6)?.f).toBe(1);
  });
});
