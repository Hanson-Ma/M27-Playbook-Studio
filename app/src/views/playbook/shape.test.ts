import { describe, expect, it } from "vitest";
import { isPlaybookShape, playbookShapeProblem } from "./shape";

describe("playbookShapeProblem", () => {
  it("accepts an object with a formations array", () => {
    expect(playbookShapeProblem({ name: "X", side: "offense", formations: [] })).toBeUndefined();
    expect(isPlaybookShape("playbook", { formations: [{ formation: "Shotgun", sets: "template" }] })).toBe(true);
  });
  it("rejects valid JSON with the wrong shape (the builder shows it instead of crashing)", () => {
    expect(playbookShapeProblem(null)).toMatch(/object/);
    expect(playbookShapeProblem(5)).toMatch(/object/);
    expect(playbookShapeProblem([])).toMatch(/object/);
    expect(playbookShapeProblem({ name: 5 })).toMatch(/missing/);
    expect(playbookShapeProblem({ name: 5, formations: { x: 1 } })).toMatch(/must be an array/);
    expect(isPlaybookShape("plays", { formations: [] })).toBe(false);
  });
});
