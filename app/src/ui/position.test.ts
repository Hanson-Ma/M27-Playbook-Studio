import { describe, expect, it } from "vitest";
import { placeFloating } from "./position";

const vp = { width: 1000, height: 800 };

describe("placeFloating", () => {
  it("places below, aligned to the start", () => {
    expect(placeFloating({ left: 100, top: 100, width: 80, height: 30 }, { width: 200, height: 100 }, "bottom-start", vp, 4)).toMatchObject({
      left: 100,
      top: 134,
      side: "bottom",
    });
  });
  it("flips when the preferred side doesn't fit", () => {
    const p = placeFloating({ left: 100, top: 750, width: 80, height: 30 }, { width: 200, height: 100 }, "bottom", vp, 4);
    expect(p.side).toBe("top");
    expect(p.top).toBe(646);
  });
  it("clamps into the viewport", () => {
    const p = placeFloating({ left: 960, top: 100, width: 30, height: 30 }, { width: 200, height: 40 }, "bottom-start", vp);
    expect(p.left).toBe(1000 - 200 - 8);
  });
  it("centers tooltips", () => {
    expect(placeFloating({ left: 500, top: 400, width: 100, height: 20 }, { width: 60, height: 24 }, "top", vp, 6)).toMatchObject({ left: 520, top: 370 });
  });
});
