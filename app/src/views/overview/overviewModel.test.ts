import { describe, expect, it } from "vitest";
import type { CallFormation, CallPlay, CallSet } from "../playcall/playcallModel";
import {
  CARD_H,
  CARD_W,
  COL_GAP,
  COL_W,
  GAP,
  LANE_GAP,
  LANE_TARGET_H,
  MAX_LANES,
  PER_ROW,
  clampK,
  detailAt,
  fitView,
  formationAt,
  intersects,
  layoutBook,
  neighbor,
  nearestTo,
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

const book = { formations: [formation(0, [9, 3]), formation(1, [5]), formation(2, [])] };

describe("layoutBook", () => {
  const l = layoutBook(book);

  it("puts every play in its formation's column, in rows of PER_ROW", () => {
    expect(l.plays).toHaveLength(17);
    expect(l.formations.map((f) => [f.count, f.setCount])).toEqual([
      [12, 2],
      [5, 1],
      [0, 0],
    ]);
    const a = l.byId.get("0.0.0")!;
    const b = l.byId.get("0.0.1")!;
    const e = l.byId.get(`0.0.${PER_ROW}`)!;
    expect(b.x - a.x).toBe(CARD_W + GAP);
    expect(e.x).toBe(a.x);
    expect(e.y - a.y).toBe(CARD_H + GAP);
    expect(l.formations[1].x - l.formations[0].x).toBe(COL_W + COL_GAP);
  });

  it("never overlaps two cards, and keeps every card inside its set block", () => {
    for (let i = 0; i < l.plays.length; i++) {
      for (let j = i + 1; j < l.plays.length; j++) expect(intersects(l.plays[i], l.plays[j])).toBe(false);
    }
    for (const p of l.plays) {
      const s = l.sets.find((x) => x.id === p.setId)!;
      expect(p.x).toBeGreaterThanOrEqual(s.x);
      expect(p.x + p.w).toBeLessThanOrEqual(s.x + s.w);
      expect(p.y + p.h).toBeLessThanOrEqual(s.y + s.h);
      expect(p.y).toBeGreaterThan(s.y);
    }
    expect(l.height).toBeGreaterThan(Math.max(...l.plays.map((p) => p.y + p.h)));
    expect(l.width).toBeGreaterThan(Math.max(...l.plays.map((p) => p.x + p.w)));
  });

  it("flows a long formation into lanes side by side and keeps its sets apart", () => {
    const tall = layoutBook({ formations: [formation(0, Array.from({ length: 14 }, () => 12)), formation(1, [4])] });
    const f0 = tall.formations[0];
    expect(f0.lanes).toBeGreaterThan(1);
    expect(f0.lanes).toBeLessThanOrEqual(MAX_LANES);
    expect(f0.w).toBe(f0.lanes * COL_W + (f0.lanes - 1) * LANE_GAP);
    expect(tall.formations[1].x).toBe(f0.x + f0.w + COL_GAP);
    for (let i = 0; i < tall.plays.length; i++) {
      for (let j = i + 1; j < tall.plays.length; j++) expect(intersects(tall.plays[i], tall.plays[j])).toBe(false);
    }
    for (const st of tall.sets) expect(st.y + st.h).toBeLessThanOrEqual(f0.y + f0.h + 1);
    // a lane stays near the target height (the last set may overshoot it by up to one set)
    expect(f0.h).toBeLessThan(LANE_TARGET_H + 1200);
    // every play sits inside its formation's box
    for (const p of tall.plays.filter((x) => x.f === 0)) {
      expect(p.x).toBeGreaterThanOrEqual(f0.x);
      expect(p.x + p.w).toBeLessThanOrEqual(f0.x + f0.w);
    }
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
    const l = layoutBook(book);
    const v = fitView(l, 1200, 700);
    expect(v.k).toBeLessThanOrEqual(1);
    expect(l.width * v.k).toBeLessThanOrEqual(1200);
    expect(l.height * v.k).toBeLessThanOrEqual(700);
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
    const grown = worldRect(v, 1000, 600, 0.5);
    expect(grown.w).toBeCloseTo(rect.w * 2, 5);
  });

  it("picks less detail as the camera pulls back", () => {
    expect([2, 0.45, 0.3, 0.14, 0.1].map(detailAt)).toEqual(["full", "full", "light", "light", "dot"]);
  });
});

describe("moving around", () => {
  const l = layoutBook(book);

  it("walks along rows and down columns", () => {
    expect(neighbor(l, "0.0.0", "RIGHT")?.id).toBe("0.0.1");
    expect(neighbor(l, "0.0.1", "LEFT")?.id).toBe("0.0.0");
    expect(neighbor(l, "0.0.0", "DOWN")?.id).toBe(`0.0.${PER_ROW}`);
    expect(neighbor(l, `0.0.${PER_ROW}`, "UP")?.id).toBe("0.0.0");
    expect(neighbor(l, "0.0.0", "UP")).toBeUndefined();
  });

  it("crosses into the next formation's column at the right edge", () => {
    expect(neighbor(l, `0.0.${PER_ROW - 1}`, "RIGHT")?.f).toBe(1);
  });

  it("goes from the end of a set into the next set below it", () => {
    expect(neighbor(l, "0.0.8", "DOWN")?.setId).toBe("0.1");
  });

  it("finds the card nearest a point and the column under an x", () => {
    expect(nearestTo(l, 0, 0)?.id).toBe("0.0.0");
    expect(formationAt(l, l.formations[1].x + 10)?.f).toBe(1);
    expect(formationAt(l, 1e6)?.f).toBe(2);
  });
});
