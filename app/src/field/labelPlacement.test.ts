import { describe, expect, it } from "vitest";
import { placeLabels, segmentHitsBox, spotOffset, type LabelRequest, type MarkCircle, type Segment } from "./labelPlacement";

const opts = { radius: 6.5, gap: 2.5 };
const req = (slot: number, x: number, y: number, prefer: "below" | "above" = "below"): LabelRequest => ({ slot, x, y, w: 20, h: 13, prefer });
const mark = (slot: number, x: number, y: number): MarkCircle => ({ slot, x, y, r: 7.5 });

describe("segmentHitsBox", () => {
  const box = { x0: 0, y0: 0, x1: 10, y1: 10 };
  it("detects crossings, containment and misses", () => {
    expect(segmentHitsBox({ ax: -5, ay: 5, bx: 15, by: 5 }, box)).toBe(true);
    expect(segmentHitsBox({ ax: 2, ay: 2, bx: 3, by: 3 }, box)).toBe(true);
    expect(segmentHitsBox({ ax: -5, ay: -5, bx: -1, by: 20 }, box)).toBe(false);
    expect(segmentHitsBox({ ax: 11, ay: 0, bx: 20, by: 10 }, box)).toBe(false);
  });
});

describe("placeLabels", () => {
  it("uses the side's default spot when nothing is in the way", () => {
    const [off] = placeLabels([req(0, 0, 0)], [], [mark(0, 0, 0)], opts);
    expect(off.spot).toBe("below");
    expect(off).toMatchObject(spotOffset("below", 20, 13, 6.5, 2.5));
    const [def] = placeLabels([req(1, 0, 0, "above")], [], [mark(1, 0, 0)], opts);
    expect(def.spot).toBe("above");
  });

  it("moves off the slot's own path when it leaves downward (pass pro, drop)", () => {
    // A 1-yd protection stem straight down from the mark (SVG y down), 14 px/yd.
    const stem: Segment = { ax: 0, ay: 0, bx: 0, by: 14, slot: 6 };
    const cap: Segment = { ax: -6.5, ay: 14, bx: 6.5, by: 14, slot: 6 };
    const [l] = placeLabels([req(6, 0, 0)], [stem, cap], [mark(6, 0, 0)], opts);
    expect(l.spot).toBe("above");
  });

  it("goes beside the mark when above is another player (QB under center)", () => {
    const drop: Segment = { ax: 0, ay: 0, bx: 0, by: 98, slot: 0 };
    const [qb] = placeLabels([req(0, 0, 0)], [drop], [mark(0, 0, 0), mark(8, 0, -14)], opts);
    expect(["right", "left"]).toContain(qb.spot);
  });

  it("prefers crossing someone else's route over covering its own path", () => {
    const own: Segment = { ax: 0, ay: 0, bx: 0, by: 30, slot: 3 };
    const other: Segment = { ax: -40, ay: -15, bx: 40, by: -15, slot: 4 };
    // Linemen on both sides (1.67 yd at 14 px/yd) rule out the side spots.
    const marks = [mark(3, 0, 0), mark(2, -23, 0), mark(4, 23, 0)];
    const [l] = placeLabels([req(3, 0, 0)], [own, other], marks, opts);
    expect(l.spot).toBe("above");
  });

  it("keeps labels from stacking on each other", () => {
    // Two players side by side: the first takes below, the second can't share the box.
    const labels = placeLabels([req(1, 0, 0), req(2, 8, 0)], [], [mark(1, 0, 0), mark(2, 8, 0)], opts);
    expect(labels[0].spot).toBe("below");
    expect(labels[1].spot).not.toBe("below");
  });

  it("stays inside the view when it can", () => {
    const [l] = placeLabels([req(0, 50, 95)], [], [mark(0, 50, 95)], { ...opts, view: { x0: 0, y0: 0, x1: 100, y1: 100 } });
    expect(l.spot).toBe("above");
  });
});
