import { describe, expect, it } from "vitest";
import { clampMotionPoint, MOTION_LIMITS, motionIssues, motionPathLength } from "./motionLimits";

describe("motion limits", () => {
  it("clamps into the region behind the line", () => {
    expect(clampMotionPoint({ x: 30, y: 3 })).toEqual({ x: MOTION_LIMITS.maxAbsX, y: MOTION_LIMITS.maxY });
    expect(clampMotionPoint({ x: -5, y: -20 })).toEqual({ x: -5, y: MOTION_LIMITS.minY });
  });
  it("measures and judges paths", () => {
    expect(motionPathLength({ x: 0, y: -2 }, [{ x: 3, y: -2 }, { x: 3, y: -6 }])).toBeCloseTo(7);
    const jet = motionIssues({ x: -16, y: -0.8 }, [{ x: -6, y: -1.5 }, { x: 8, y: -1.5 }], { pos: "POSITION_WR" });
    expect(jet).toEqual([]);
    expect(motionIssues({ x: 0, y: -1 }, [{ x: 1, y: -1 }], { pos: "POSITION_LG" })[0].level).toBe("error");
    expect(motionIssues({ x: 0, y: -2 }, [{ x: 0, y: 1 }]).some((i) => /behind the line/.test(i.message))).toBe(true);
    expect(motionIssues({ x: -17, y: -2 }, [{ x: 17, y: -2 }, { x: -10, y: -2 }]).some((i) => i.level === "error")).toBe(true);
  });
});
