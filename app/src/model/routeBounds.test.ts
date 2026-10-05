import { describe, expect, it } from "vitest";
import { HALF_WIDTH } from "./geometry";
import { FIELD_BOUNDS, FIT_MARGIN, chainOffField, chainPoints, fitChainToField, offFieldText, pointsOffField } from "./routeBounds";
import { applySavedRouteSteps } from "./routeLibrary";
import { cutAt, presetSteps, toEditableRoute } from "./routes";
import type { SavedRoute, Step } from "./types";

const leg = (distance: number, direction: number): Step => ({ type: "RunRoute", distance, direction, speed: 100 });
const NONE: Step = { type: "None" };

describe("pointsOffField", () => {
  it("is undefined on the field, including the sideline itself", () => {
    expect(pointsOffField([{ x: 0, y: 0 }, { x: HALF_WIDTH, y: 10 }, { x: -HALF_WIDTH, y: 60 }])).toBeUndefined();
  });
  it("reports the worst edge crossed", () => {
    const o = pointsOffField([{ x: 20, y: 0 }, { x: 30, y: 5 }, { x: -28, y: 5 }]);
    expect(o).toMatchObject({ edge: "right", at: 1 });
    expect(o!.by).toBeCloseTo(30 - HALF_WIDTH, 5);
    expect(pointsOffField([{ x: 0, y: FIELD_BOUNDS.maxY + 2 }])).toMatchObject({ edge: "deep" });
    expect(FIELD_BOUNDS.maxY).toBe(75);
  });
  it("words the problem plainly", () => {
    expect(offFieldText({ edge: "left", by: 8.4, at: 2 })).toBe("runs 8 yd past the left sideline");
    expect(offFieldText({ edge: "right", by: 0.3, at: 2 })).toBe("runs under a yard past the right sideline");
    expect(offFieldText({ edge: "deep", by: 3, at: 2 })).toBe("runs 3 yd past the back of the end zone");
  });
});

describe("chainOffField / fitChainToField", () => {
  const wide = { x: 22, y: -1 }; // a wide receiver on the right
  it("finds an out route that carries a wide receiver past the sideline", () => {
    // 10 yd stem, then 12 yd straight out (toward the right sideline).
    const steps = [leg(10, 90), { type: "ReceiverCut", cutType: "RECEIVER_CUT_ANGLE_90", direction: "RECEIVER_CUT_DIR_RIGHT" }, leg(12, 0), NONE];
    const off = chainOffField(wide, steps);
    expect(off).toMatchObject({ edge: "right" });
    expect(off!.by).toBeCloseTo(22 + 12 - HALF_WIDTH, 2);
  });

  it("shortens only the outward legs and keeps the cut and the stem", () => {
    const steps = [leg(10, 90), { type: "ReceiverCut", cutType: "RECEIVER_CUT_ANGLE_90", direction: "RECEIVER_CUT_DIR_RIGHT" }, leg(12, 0), NONE];
    const fit = fitChainToField(wide, steps)!;
    expect(fit).toBeDefined();
    expect(chainOffField(wide, fit)).toBeUndefined();
    const r = toEditableRoute(fit);
    expect(r.legs[0].distance).toBe(10); // the stem goes straight up: untouched
    expect(r.legs[1].direction).toBe(0);
    expect(r.legs[1].distance).toBeCloseTo(HALF_WIDTH - FIT_MARGIN - 22, 1);
    expect(cutAt(r, 0)).toEqual(steps[1]);
    expect(fit[fit.length - 1]).toEqual(NONE);
    // The source step's other fields survive.
    expect(fit[2]).toMatchObject({ type: "RunRoute", speed: 100, direction: 0 });
  });

  it("scales every outward leg by the same factor (a corner keeps its angle)", () => {
    const built = presetSteps("corner", { side: "right" }).steps;
    const before = toEditableRoute(built).legs.map((l) => ({ ...l }));
    const fit = fitChainToField({ x: 24, y: -1 }, built)!;
    expect(fit).toBeDefined();
    expect(chainOffField({ x: 24, y: -1 }, fit)).toBeUndefined();
    const after = toEditableRoute(fit).legs;
    after.forEach((l, i) => expect(l.direction).toBe(before[i].direction));
    const ratios = after.map((l, i) => l.distance / before[i].distance).filter((k) => Math.abs(k - 1) > 1e-3);
    expect(ratios.length).toBeGreaterThan(0);
    for (const k of ratios) expect(k).toBeCloseTo(ratios[0], 2);
  });

  it("returns undefined when the route already fits", () => {
    expect(fitChainToField({ x: 5, y: -1 }, [leg(10, 90), leg(5, 0), NONE])).toBeUndefined();
  });

  it("leaves locked legs alone and gives up when they alone run off", () => {
    const steps = [leg(10, 0), leg(5, 90), NONE];
    // The first leg (locked) already carries the player past the sideline.
    expect(fitChainToField({ x: 20, y: -1 }, steps, 1)).toBeUndefined();
    // Unlocked, the same route can be fitted.
    expect(chainOffField({ x: 20, y: -1 }, fitChainToField({ x: 20, y: -1 }, steps)!)).toBeUndefined();
  });

  it("fits a saved route mirrored onto a wide receiver on the other side", () => {
    // Drawn for a slot on the right (x = 8): a 5 yd stem, then 14 yd out toward the right sideline.
    const saved: SavedRoute = { id: "deep-out", name: "Deep out", side: "right", steps: [leg(5, 90), leg(14, 0)] };
    const slotOk = applySavedRouteSteps([NONE], saved, "right");
    expect(chainOffField({ x: 8, y: -1 }, slotOk.steps)).toBeUndefined();
    // Put on a wide receiver on the left (x = -20): mirrored, it now runs 14 yd toward the LEFT sideline.
    const wr = applySavedRouteSteps([NONE], saved, "left");
    expect(wr.mirrored).toBe(true);
    const off = chainOffField({ x: -20, y: -1 }, wr.steps);
    expect(off).toMatchObject({ edge: "left" });
    const fit = fitChainToField({ x: -20, y: -1 }, wr.steps)!;
    expect(chainOffField({ x: -20, y: -1 }, fit)).toBeUndefined();
    const pts = chainPoints({ x: -20, y: -1 }, fit);
    expect(pts[pts.length - 1].x).toBeCloseTo(-(HALF_WIDTH - FIT_MARGIN), 1);
  });

  it("pulls a very deep route back inside the end zone", () => {
    const steps = [leg(80, 90), NONE];
    const fit = fitChainToField({ x: 10, y: -1 }, steps)!;
    expect(chainOffField({ x: 10, y: -1 }, fit)).toBeUndefined();
    expect(toEditableRoute(fit).legs[0].distance).toBeCloseTo(FIELD_BOUNDS.maxY - FIT_MARGIN + 1, 1);
  });
});
