import { describe, expect, it } from "vitest";
import { artMetrics, cutSizes, labelTextWidth } from "./PlayArtLayer";

describe("artMetrics", () => {
  it("scales detail marks with px/yd: 1× up to 14 px/yd, then ppy/14; lines cap at 1.9×, player marks keep growing to 6×", () => {
    const base = artMetrics(false, 10);
    expect(base.scale).toBe(1);
    expect(artMetrics(false, 14)).toBe(base);
    const big = artMetrics(false, 21);
    expect(big.scale).toBeCloseTo(1.5, 9);
    for (const k of ["stroke", "radius", "ring", "arrowLen", "arrowHalf", "tHalf", "dot", "label"] as const) {
      expect(big[k]).toBeCloseTo(base[k] * 1.5, 9);
    }
    expect(artMetrics(false, 60).scale).toBe(1.9);
    expect(artMetrics(false, 60).stroke).toBeCloseTo(base.stroke * 1.9, 9);
    // Players stay the same share of the field as you zoom in: 60 px/yd is ppy/14 times the base mark.
    expect(artMetrics(false, 56).radius).toBeCloseTo(base.radius * 4, 9);
    expect(artMetrics(false, 400).radius).toBeCloseTo(base.radius * 6, 9);
  });

  it("keeps compact (card) metrics fixed, shrinking a little on the smallest cards", () => {
    const card = artMetrics(true, 8);
    expect(card.scale).toBe(1);
    expect(artMetrics(true, 30)).toBe(card);
    expect(artMetrics(true, 4.2).radius).toBeLessThan(card.radius);
    expect(artMetrics(true, 4.2).label).toBe(card.label);
  });
});

describe("labelTextWidth", () => {
  it("estimates without a DOM and grows with text and size", () => {
    const w = labelTextWidth("WR1", 10);
    expect(w).toBeGreaterThan(10);
    expect(labelTextWidth("3·WR1", 10)).toBeGreaterThan(w);
    expect(labelTextWidth("WR1", 20)).toBeCloseTo(2 * w, 6);
  });
});

describe("cutSizes", () => {
  it("keeps the speed radius ~1.2 yd (at least 6 px) and screen-sizes the marks", () => {
    const detail = cutSizes(artMetrics(false, 14), 14);
    expect(detail.round).toBe(1.2);
    expect(detail.zigHalf * 14).toBeCloseTo(8, 6);
    const zoomed = cutSizes(artMetrics(false, 28), 28);
    expect(zoomed.tick * 28).toBeCloseTo(6.5 * artMetrics(false, 28).scale, 6); // grows with the detail scale
    const card = cutSizes(artMetrics(true, 4), 4, true);
    expect(card.round * 4).toBeCloseTo(6, 6); // tiny cards: never under 6 px
    expect(card.zigHalf * 4).toBeCloseTo(5.5, 6);
    expect(cutSizes(artMetrics(true, 5.6), 5.6)).toEqual(cutSizes(artMetrics(true, 5.6), 5.6, true)); // inferred from metrics
  });
});
