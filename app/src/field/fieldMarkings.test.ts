// Field markings under the card depth compression: everything sits at its mapped y, and nothing the compression would
// squash (ticks, numbers, 5-yd lines) is drawn where the scale gets flat.
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { cardViewport } from "./cardView";
import { fieldYRange, TRUE_DEPTH } from "./fieldMath";
import { fieldMarkings } from "./FieldMarkings";

type El = ReactElement<{ children?: ReactNode; d?: string; transform?: string; className?: string }>;

function flatten(node: ReactNode, out: El[] = []): El[] {
  if (Array.isArray(node)) node.forEach((n) => flatten(n, out));
  else if (isValidElement(node)) {
    out.push(node as El);
    flatten((node as El).props.children, out);
  }
  return out;
}

/** SVG y of every number glyph (translate(x y)). */
const numberYs = (els: El[]) =>
  els.filter((e) => e.type === "text").map((e) => Number(/translate\(\S+ (\S+)\)/.exec(e.props.transform!)![1]));

/** SVG y of every sideline-to-sideline line (yard lines, goal lines, LOS) in path data. */
const lineYs = (els: El[]) => {
  const ys = els.flatMap((e) =>
    [...(e.props.d ?? "").matchAll(/M(-?[\d.]+) (-?[\d.]+)H(-?[\d.]+)/g)]
      .filter((m) => Number(m[1]) === -26.667 && Number(m[3]) === 26.667)
      .map((m) => Number(m[2])),
  );
  return [...new Set(ys)].sort((a, b) => a - b);
};

describe("fieldMarkings with a depth scale", () => {
  const range = fieldYRange(35);

  it("keeps the true-scale paint unchanged and caches per scale", () => {
    const a = fieldMarkings({ minY: -15, maxY: 30, los: 35 });
    expect(fieldMarkings({ minY: -15, maxY: 30, los: 35, depth: TRUE_DEPTH })).toBe(a);
    const nums = numberYs(flatten(a));
    // LOS on the 35: numbers on the 20, 30, 40, 50, 40 (y −15 … 25) on both sides, at SVG y = −y.
    expect(nums.sort((x, y) => x - y)).toEqual([-25, -25, -15, -15, -5, -5, 5, 5, 15, 15]);
    expect(lineYs(flatten(a))).toEqual([-30, -25, -20, -15, -10, -5, 0, 5, 10, 15]);
  });

  for (const side of ["offense", "defense"] as const) {
    it(`draws ${side} card numbers and lines only inside the card, clear of the squashed range`, () => {
      const vp = cardViewport(side);
      const d = vp.depth!;
      const els = flatten(fieldMarkings({ minY: range.minY, maxY: range.maxY, depth: d }));
      expect(fieldMarkings({ minY: range.minY, maxY: range.maxY, depth: d })).not.toBe(fieldMarkings({ minY: range.minY, maxY: range.maxY }));
      const nums = numberYs(els);
      expect(nums.length).toBeGreaterThan(0);
      // Glyphs span ~±1.5 yd along y: whole digits stay inside the card.
      for (const y of nums) {
        expect(-y + 1.5).toBeLessThanOrEqual(vp.maxY);
        expect(-y - 1.5).toBeGreaterThanOrEqual(vp.minY);
      }
      // Drawn 5-yd lines sit at mapped yards and never crowd closer than 1.4 yd; the LOS stays at 0.
      const ys = lineYs(els);
      expect(ys).toContain(0);
      expect(ys).toContain(-5); // 5 yd past the LOS: true scale
      for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThan(1.4);
      for (const y of ys) expect(Number.isFinite(y)).toBe(true);
    });
  }
});
