import { describe, expect, it } from "vitest";
import {
  baseView,
  boundsToViewBox,
  compressedDepth,
  cutAtX,
  endAngleSvg,
  fieldMiddleX,
  fieldYRange,
  fitViewBox,
  formatCoord,
  hashXs,
  panBy,
  projectArt,
  pxPerYard,
  sidelineXs,
  squareAround,
  svgPoints,
  sy,
  toSvg,
  trimEnd,
  TRUE_DEPTH,
  viewBoxFor,
  viewBoxToBounds,
  yardLines,
  yardNumber,
  yardTicks,
  zoomAt,
  type ViewLimits,
} from "./fieldMath";
import type { PlayArt } from "../model/types";

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe("coordinates", () => {
  it("flips y between field and SVG", () => {
    expect(sy(4.5)).toBe(-4.5);
    expect(toSvg({ x: 3, y: -6 })).toEqual({ x: 3, y: 6 });
  });

  it("formats readouts to 0.1 yd with a true minus", () => {
    expect(formatCoord(12.34)).toBe("12.3");
    expect(formatCoord(-4.46)).toBe("−4.5");
    expect(formatCoord(-0.04)).toBe("0.0");
    expect(formatCoord(0)).toBe("0.0");
  });

  it("writes polyline points in SVG space", () => {
    expect(svgPoints([{ x: 0, y: -6 }, { x: 1.23456, y: 2 }])).toBe("0,6 1.235,-2");
  });
});

describe("viewBox math", () => {
  const b = { minX: -10, maxX: 10, minY: -5, maxY: 15 };

  it("converts bounds to a viewBox and back", () => {
    const vb = boundsToViewBox(b, 1);
    expect(vb).toEqual({ x: -11, y: -16, width: 22, height: 22 });
    expect(viewBoxToBounds(vb)).toEqual({ minX: -11, maxX: 11, minY: -6, maxY: 16 });
  });

  it("contain grows the short side around the center", () => {
    const vb = fitViewBox(b, 2); // 20×20 into 2:1 → 40×20
    expect(vb).toEqual({ x: -20, y: -15, width: 40, height: 20 });
    const tall = fitViewBox(b, 0.5); // → 20×40
    expect(tall).toEqual({ x: -10, y: -25, width: 20, height: 40 });
  });

  it("cover trims the long side", () => {
    const vb = fitViewBox(b, 2, { mode: "cover" }); // → 20×10
    expect(vb.width).toBe(20);
    expect(vb.height).toBe(10);
    close(vb.y + vb.height / 2, -5);
  });

  it("ignores a bad aspect", () => {
    expect(fitViewBox(b, 0)).toEqual(boundsToViewBox(b));
  });

  it("measures pixels per yard", () => {
    expect(pxPerYard({ x: 0, y: 0, width: 53.333, height: 24.8 }, 533.33, 248)).toBeCloseTo(10, 3);
    expect(pxPerYard({ x: 0, y: 0, width: 10, height: 10 }, 200, 100)).toBe(10);
    expect(pxPerYard({ x: 0, y: 0, width: 0, height: 10 }, 200, 100)).toBe(0);
  });
});

describe("zoom and pan", () => {
  const base = { x: -20, y: -20, width: 40, height: 20 };
  const limits: ViewLimits = { minZoom: 0.5, maxZoom: 8, centerBox: { x: -30, y: -40, width: 60, height: 80 } };

  it("keeps the anchor fixed while zooming", () => {
    const v0 = baseView(base);
    expect(v0.center).toEqual({ x: 0, y: -10 });
    const anchor = { x: 10, y: -15 };
    const v1 = zoomAt(v0, 2, anchor, limits);
    const vb0 = viewBoxFor(base, v0);
    const vb1 = viewBoxFor(base, v1);
    // anchor stays at the same fraction of the viewBox
    close((anchor.x - vb0.x) / vb0.width, (anchor.x - vb1.x) / vb1.width);
    close((anchor.y - vb0.y) / vb0.height, (anchor.y - vb1.y) / vb1.height);
    expect(vb1.width).toBe(20);
  });

  it("clamps zoom and center", () => {
    const v = zoomAt(baseView(base), 100, { x: 0, y: -10 }, limits);
    expect(v.zoom).toBe(8);
    const far = panBy(v, -1e6, 0, 10, limits);
    expect(far.center.x).toBe(30);
  });

  it("pans content with the pointer", () => {
    const v = panBy(baseView(base), 50, -20, 10, limits);
    expect(v.center).toEqual({ x: -5, y: -8 });
  });

  it("a null view is the base viewBox", () => {
    expect(viewBoxFor(base, null)).toBe(base);
  });
});

describe("field markings", () => {
  it("puts the hashes and sidelines relative to the ball spot", () => {
    expect(fieldMiddleX("middle")).toBe(0);
    expect(fieldMiddleX("left")).toBeCloseTo(3.0833, 4);
    expect(fieldMiddleX("right")).toBeCloseTo(-3.0833, 4);
    expect(hashXs("middle")).toEqual([-3.0833, 3.0833]);
    const [l, r] = hashXs("left");
    close(l, 0);
    close(r, 6.1666);
    const [sl, sr] = sidelineXs("right");
    close(sl, -3.0833 - 80 / 3);
    close(sr, -3.0833 + 80 / 3);
  });

  it("paints numbers like a real field with the ball on the 50", () => {
    const lines = yardLines(-12, 30);
    expect(lines.map((l) => l.y)).toEqual([-10, -5, 0, 5, 10, 15, 20, 25, 30]);
    const num = Object.fromEntries(lines.filter((l) => l.number).map((l) => [l.y, l.number]));
    expect(num).toEqual({ [-10]: 40, 0: 50, 10: 40, 20: 30, 30: 20 });
    expect(lines.find((l) => l.y === 0)?.major).toBe(true);
    expect(lines.find((l) => l.y === 5)?.major).toBe(false);
  });

  it("stops at the goal lines", () => {
    const lines = yardLines(-60, 80);
    expect(lines[0]).toMatchObject({ y: -50, yard: 0, goal: true, major: true });
    expect(lines[lines.length - 1]).toMatchObject({ y: 50, yard: 100, goal: true });
    expect(lines.filter((l) => l.number === 50)).toHaveLength(1);
    expect(fieldYRange()).toEqual({ minY: -60, maxY: 60 });
  });

  it("supports another LOS", () => {
    expect(yardLines(-3, 3, 48).map((l) => [l.y, l.number])).toEqual([
      [-3, undefined],
      [2, 50],
    ]);
  });

  it("numbers only the 10s inside the field", () => {
    expect(yardNumber(0)).toBeUndefined();
    expect(yardNumber(10)).toBe(10);
    expect(yardNumber(50)).toBe(50);
    expect(yardNumber(70)).toBe(30);
    expect(yardNumber(35)).toBeUndefined();
    expect(yardNumber(100)).toBeUndefined();
  });

  it("ticks every yard except the 5s", () => {
    expect(yardTicks(-2, 2)).toEqual([-2, -1, 1, 2]);
    expect(yardTicks(-40, -33)).toEqual([-39, -38, -37, -36, -34, -33]);
    expect(yardTicks(-60, -47)).toEqual([-49, -48, -47]); // stops at the goal line
  });
});

describe("path ends", () => {
  it("reads the end direction in SVG degrees", () => {
    expect(endAngleSvg([{ x: 0, y: 0 }, { x: 0, y: 5 }])).toBeCloseTo(-90);
    expect(endAngleSvg([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 0 }])).toBeCloseTo(0);
    expect(endAngleSvg([{ x: 1, y: 1 }], 270)).toBe(-270);
  });

  it("trims the last segment for arrowheads", () => {
    const t = trimEnd([{ x: 0, y: 0 }, { x: 0, y: 10 }], 1);
    expect(t[1]).toEqual({ x: 0, y: 9 });
    const short = trimEnd([{ x: 0, y: 0 }, { x: 0, y: 1 }], 5);
    close(short[1].y, 0.15);
  });

  it("builds square thumbnail bounds", () => {
    const s = squareAround({ minX: 0, maxX: 2, minY: 0, maxY: 10 }, 1, 8);
    expect(s.maxX - s.minX).toBe(12);
    expect(s.maxY - s.minY).toBe(12);
    expect((s.minX + s.maxX) / 2).toBe(1);
  });
});

describe("depth compression (cards)", () => {
  const d = compressedDepth({ knee: 8, reach: 7.6, backKnee: -5.5, backReach: 2.5 });

  it("is the identity between the knees and TRUE_DEPTH everywhere", () => {
    for (const y of [-5.5, -3, 0, 4.2, 8]) {
      expect(d.map(y)).toBe(y);
      expect(d.slope(y)).toBe(1);
    }
    expect(TRUE_DEPTH.map(42)).toBe(42);
    expect(TRUE_DEPTH.id).toBe("");
    expect(d.id).not.toBe("");
  });

  it("is strictly increasing, smooth at the knee and bounded by its limits", () => {
    let prev = -Infinity;
    for (let y = -40; y <= 80; y += 0.5) {
      const v = d.map(y);
      expect(v).toBeGreaterThan(prev);
      expect(v).toBeGreaterThan(d.lo);
      expect(v).toBeLessThan(d.hi);
      prev = v;
    }
    close(d.slope(8.0001), 1, 1e-3);
    expect(d.hi).toBeCloseTo(15.6, 6);
    expect(d.lo).toBeCloseTo(-8, 6);
    // A 40-yd go is drawn ~15.5 yd deep, a 12-yd dig ~11 yd.
    expect(d.map(40)).toBeGreaterThan(15.3);
    expect(d.map(12)).toBeGreaterThan(10.8);
    expect(d.map(12)).toBeLessThan(11.4);
  });

  it("unmaps back to field yards (±Infinity past the limits)", () => {
    for (const y of [-30, -7, -2, 0, 5, 9, 14, 25, 60]) close(d.unmap(d.map(y)), y, 1e-6);
    expect(d.unmap(16)).toBe(Infinity);
    expect(d.unmap(-9)).toBe(-Infinity);
  });

  it("projects art: points and players through map, zones keep their mapped centre, memoized", () => {
    const art: PlayArt = {
      players: [{ slot: 0, pos: "WR", depth: 1, label: "WR1", glyph: "skill", base: { x: 20, y: -1 }, at: { x: 20, y: -1 }, snap: { x: 20, y: -1 }, facing: 90, stance: "", isVip: false, isBallcarrier: false, motionMan: false, side: "offense" }],
      paths: [{ slot: 0, kind: "route", cap: "arrow", points: [{ x: 20, y: -1 }, { x: 20, y: 40 }] }],
      zones: [{ slot: 0, kind: "deep", center: { x: 0, y: 21 }, rx: 8, ry: 5.5 }],
      bounds: { minX: 0, maxX: 20, minY: -1, maxY: 40 },
      flipped: false,
    };
    expect(projectArt(art, TRUE_DEPTH)).toBe(art);
    const p = projectArt(art, d);
    expect(projectArt(art, d)).toBe(p);
    expect(p.paths[0].points[1].y).toBeCloseTo(d.map(40), 9);
    expect(p.players[0].at).toEqual({ x: 20, y: -1 });
    expect(p.zones[0].center.y).toBeCloseTo(d.map(21), 9);
    expect(p.zones[0].ry).toBeCloseTo((d.map(26.5) - d.map(15.5)) / 2, 9);
    expect(p.bounds.maxY).toBeCloseTo(d.map(40), 9);
    expect(art.paths[0].points[1].y).toBe(40); // input untouched
  });

  it("cuts paths at the sideline limit, keeping the crossing as the new end", () => {
    expect(cutAtX([{ x: 20, y: 0 }, { x: 20, y: 10 }, { x: 40, y: 20 }], 26)).toEqual([
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 26, y: 13 },
    ]);
    expect(cutAtX([{ x: -20, y: 0 }, { x: -30, y: 0 }], 26)).toEqual([{ x: -20, y: 0 }, { x: -26, y: 0 }]);
    const inside = [{ x: 0, y: 0 }, { x: 5, y: 5 }];
    expect(cutAtX(inside, 26)).toBe(inside);
    const outside = [{ x: 30, y: 0 }, { x: 40, y: 0 }];
    expect(cutAtX(outside, 26)).toBe(outside);
    const dx = compressedDepth({ knee: 8, reach: 7.6, xLimit: 26 });
    const art: PlayArt = {
      players: [],
      paths: [{ slot: 0, kind: "route", cap: "arrow", points: [{ x: 20, y: 0 }, { x: 40, y: 0 }], vertices: [{ index: 1, step: 0 }] }],
      zones: [],
      bounds: { minX: 20, maxX: 40, minY: 0, maxY: 0 },
      flipped: false,
    };
    const p = projectArt(art, dx);
    expect(p.paths[0].points).toEqual([{ x: 20, y: 0 }, { x: 26, y: 0 }]);
    expect(p.paths[0].cap).toBe("arrow");
  });
});
