import { describe, expect, it } from "vitest";
import { clamp, decimalsOf, formatNumber, parseNumber, roundTo, stepBy } from "./number";

describe("number helpers", () => {
  it("derives precision from the step", () => {
    expect(decimalsOf(1)).toBe(0);
    expect(decimalsOf(0.5)).toBe(1);
    expect(decimalsOf(0.25)).toBe(2);
    expect(decimalsOf(1e-7)).toBe(7);
  });
  it("rounds without float noise and formats short", () => {
    expect(roundTo(0.1 + 0.2, 2)).toBe(0.3);
    expect(roundTo(-1.005, 2)).toBe(-1.01);
    expect(formatNumber(7.5, 1)).toBe("7.5");
    expect(formatNumber(7, 1)).toBe("7");
    expect(formatNumber(-0.0001, 1)).toBe("0");
    expect(formatNumber(undefined, 1)).toBe("");
  });
  it("parses user text", () => {
    expect(parseNumber("7,5")).toBe(7.5);
    expect(parseNumber(" -3 ")).toBe(-3);
    expect(parseNumber("+2")).toBe(2);
    expect(parseNumber(".5")).toBe(0.5);
    expect(parseNumber("-")).toBeUndefined();
    expect(parseNumber("abc")).toBeUndefined();
    expect(parseNumber("")).toBeUndefined();
  });
  it("steps, clamps and rounds", () => {
    expect(stepBy(7.3, 1, 0.5, 1, 1)).toBe(7.8);
    expect(stepBy(355, 1, 5, 10, 0, 0, 359)).toBe(359);
    expect(stepBy(0.2, -1, 0.1, 1, 1, 0)).toBe(0.1);
    expect(clamp(5, 0, 3)).toBe(3);
  });
});
