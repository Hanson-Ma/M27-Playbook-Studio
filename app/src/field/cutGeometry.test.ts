import { describe, expect, it } from "vitest";
import { cutStyle } from "../model/art";
import { loadLibraryData } from "../model/libFixture";
import type { ArtVertex, Vec } from "../model/types";
import { cutIconShape } from "./CutIcon";
import { cutCorners, drawCutPath, type CutCorner, type CutSizes } from "./cutGeometry";

const SIZES: CutSizes = { round: 1.2, zigHalf: 0.6, zigAmp: 0.4, tick: 0.5, hookIn: 0.3 };

/** Parse "M x y L x y Q cx cy x y" into commands with SVG-space numbers. */
function parse(d: string): { cmd: string; nums: number[] }[] {
  return [...d.matchAll(/([MLQ])([^MLQ]*)/g)].map((m) => ({ cmd: m[1], nums: m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number) }));
}
/** Field point of a command's end (SVG y flipped back). */
const endOf = (c: { nums: number[] }): Vec => ({ x: c.nums[c.nums.length - 2] + 0, y: 0 - c.nums[c.nums.length - 1] });
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
const corner = (index: number, style: CutCorner["style"], turn: CutCorner["turn"] = 0): CutCorner => ({ index, style, turn });

const STEM: Vec[] = [
  { x: 0, y: 0 },
  { x: 0, y: 10 },
  { x: -10, y: 10 },
];

describe("cutCorners", () => {
  it("uses explicit styles, derives missing ones from the cut, keeps the strongest per point and drops bad indices", () => {
    const vertices: ArtVertex[] = [
      { index: 1, step: 0 },
      { index: 1, cut: "RECEIVER_CUT_ANGLE_45", cutDir: "RECEIVER_CUT_DIR_LEFT", step: 1 },
      { index: 2, cut: "RECEIVER_CUT_ANGLE_90", style: "hard", step: 3 },
      { index: 2, cut: "RECEIVER_CUT_ANGLE_STUTTER", cutDir: "RECEIVER_CUT_DIR_RIGHT", step: 4 },
      { index: 9, cut: "RECEIVER_CUT_ANGLE_CURL" },
      { index: 0, cut: "RECEIVER_CUT_ANGLE_INVALID" },
    ];
    expect(cutCorners({ points: [...STEM, { x: -10, y: 20 }], vertices })).toEqual([
      { index: 1, style: "speed", turn: 1 },
      { index: 2, style: "fake", turn: -1 },
    ]);
    expect(cutCorners({ points: STEM })).toEqual([]);
  });
});

describe("drawCutPath", () => {
  it("draws a plain polyline when there are no corners", () => {
    const { d, ticks, settle } = drawCutPath(STEM, [], SIZES);
    expect(parse(d).map((c) => c.cmd).join("")).toBe("MLL");
    expect(ticks).toBe("");
    expect(settle).toBe(false);
  });

  it("rounds speed cuts: the curve starts and ends `round` from the vertex, with the vertex as control point", () => {
    const cmds = parse(drawCutPath(STEM, [corner(1, "speed")], SIZES).d);
    expect(cmds.map((c) => c.cmd).join("")).toBe("MLQL");
    expect(endOf(cmds[1])).toEqual({ x: 0, y: 10 - 1.2 });
    expect({ x: cmds[2].nums[0], y: -cmds[2].nums[1] }).toEqual({ x: 0, y: 10 });
    expect(endOf(cmds[2])).toEqual({ x: -1.2, y: 10 });
  });

  it("caps corner offsets at 45% of short legs and skips straight-through speed cuts", () => {
    const short = [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 1 }];
    const cmds = parse(drawCutPath(short, [corner(1, "speed")], SIZES).d);
    expect(dist(endOf(cmds[1]), { x: 0, y: 1 })).toBeCloseTo(0.45, 3);
    const straight = [{ x: 0, y: 0 }, { x: 0, y: 5 }, { x: 0, y: 10 }];
    expect(parse(drawCutPath(straight, [corner(1, "speed")], SIZES).d).map((c) => c.cmd).join("")).toBe("MLL");
  });

  it("keeps hard cuts sharp and adds a plant tick on the outside of the turn", () => {
    const { d, ticks } = drawCutPath(STEM, [corner(1, "hard")], SIZES);
    expect(parse(d).map((c) => endOf(c))).toEqual(STEM);
    const [m, l] = parse(ticks);
    expect(endOf(m)).toEqual({ x: 0, y: 10 });
    const tip = endOf(l);
    expect(dist(tip, { x: 0, y: 10 })).toBeCloseTo(0.5, 2); // r3 rounding
    expect(tip.x).toBeGreaterThan(0); // the route turns left (−x): the tick points right…
    expect(tip.y).toBeGreaterThan(10); // …and upfield
  });

  it("splices a two-lobe zig around a fake, first lobe toward the cut side", () => {
    const straight = [{ x: 0, y: 0 }, { x: 0, y: 5 }, { x: 0, y: 15 }];
    const cmds = parse(drawCutPath(straight, [corner(1, "fake", 1)], SIZES).d);
    const pts = cmds.map(endOf);
    expect(pts[1]).toEqual({ x: 0, y: 4.4 }); // zigHalf before the vertex
    expect(pts[2].x).toBeCloseTo(-0.4, 6); // LEFT = counter-clockwise: first lobe toward −x
    expect(pts[3].x).toBeCloseTo(0.4, 6);
    expect(pts[4]).toEqual({ x: 0, y: 5.6 });
    expect(pts[pts.length - 1]).toEqual({ x: 0, y: 15 });
    const right = parse(drawCutPath(straight, [corner(1, "fake", -1)], SIZES).d).map(endOf);
    expect(right[2].x).toBeCloseTo(0.4, 6);
  });

  it("draws an end hook after a turn-back cut as one smooth curve", () => {
    const hooked = [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 0.43, y: 10.25 }, { x: 0.68, y: 9.82 }, { x: 0.6, y: 9.33 }];
    const cmds = parse(drawCutPath(hooked, [corner(1, "turnback")], SIZES, { lastVertexIndex: 1 }).d);
    expect(cmds.map((c) => c.cmd).join("")).toBe("MLQQQ");
    expect(endOf(cmds[1])).toEqual({ x: 0, y: 10 - 0.3 });
    expect(endOf(cmds[cmds.length - 1])).toEqual(hooked[4]);
    // A comeback that keeps running (real leg after it) is a sharp plant instead.
    const comeback = drawCutPath(STEM, [corner(1, "turnback")], SIZES, { lastVertexIndex: 2 });
    expect(comeback.ticks).not.toBe("");
  });

  it("reports a settle at the end; a settle mid-route is a hard plant", () => {
    expect(drawCutPath(STEM, [corner(2, "settle")], SIZES).settle).toBe(true);
    const mid = drawCutPath(STEM, [corner(1, "settle")], SIZES);
    expect(mid.settle).toBe(false);
    expect(mid.ticks).not.toBe("");
  });

  it("never emits NaN for degenerate input", () => {
    const dup = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
    for (const style of ["speed", "hard", "fake", "turnback", "settle"] as const) {
      const r = drawCutPath(dup, [corner(1, style)], SIZES);
      expect(r.d + r.ticks).not.toMatch(/NaN|Infinity/);
    }
    expect(drawCutPath([], [], SIZES).d).toBe("");
  });
});

describe("cutIconShape", () => {
  const all = loadLibraryData().enums.enums.ReceiverCutAngle.filter((v) => !/INVALID|NONEVALUE/.test(v));

  it("draws every ReceiverCutAngle with the cut's style, mirrored by direction", () => {
    for (const v of all) {
      const left = cutIconShape(v, "left");
      const right = cutIconShape(v, "right");
      expect(left.points.length).toBeGreaterThanOrEqual(2);
      expect(left.style).toBe(cutStyle(v));
      expect(left.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
      for (let i = 0; i < left.points.length; i++) {
        expect(right.points[i].x).toBeCloseTo(-left.points[i].x, 6);
        expect(right.points[i].y).toBeCloseTo(left.points[i].y, 6);
      }
      const r = drawCutPath(left.points, left.corners, SIZES, { lastVertexIndex: left.lastVertexIndex, hookTail: Infinity });
      expect(r.d).not.toMatch(/NaN/);
    }
  });

  it("left turns head toward −x; DRAG_STOP ends in a settle; curls hook", () => {
    const post = cutIconShape("RECEIVER_CUT_ANGLE_45", "left");
    expect(post.points[2].x).toBeLessThan(0);
    const drag = cutIconShape("RECEIVER_CUT_ANGLE_DRAG_STOP", "left");
    const dr = drawCutPath(drag.points, drag.corners, SIZES, { lastVertexIndex: drag.lastVertexIndex });
    expect(dr.settle).toBe(true);
    const curl = cutIconShape("CURL", "right");
    expect(curl.points.length).toBe(5);
    expect(curl.points[4].y).toBeLessThan(curl.points[1].y + 0.5);
    expect(cutIconShape("JukeLeft45Degrees").style).toBe("fake");
  });
});
