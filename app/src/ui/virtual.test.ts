import { describe, expect, it } from "vitest";
import { gridColumns, moveIndex, scrollForItem, visibleRange } from "./virtual";

describe("visibleRange", () => {
  it("windows rows with overscan", () => {
    expect(visibleRange(0, 300, 30, 5000, 5)).toEqual({ start: 0, end: 15 });
    expect(visibleRange(3000, 300, 30, 5000, 5)).toEqual({ start: 95, end: 115 });
    expect(visibleRange(149_900, 300, 30, 5000, 5)).toEqual({ start: 4991, end: 5000 });
    expect(visibleRange(0, 300, 30, 0, 5)).toEqual({ start: 0, end: 0 });
  });
});

describe("gridColumns", () => {
  it("fits cells with gaps", () => {
    expect(gridColumns(380, 120, 10)).toBe(3);
    expect(gridColumns(379, 120, 10)).toBe(2);
    expect(gridColumns(50, 120, 10)).toBe(1);
  });
});

describe("scrollForItem", () => {
  it("scrolls minimally in auto mode", () => {
    expect(scrollForItem(300, 30, 300, 0)).toBe(30);
    expect(scrollForItem(60, 30, 300, 100)).toBe(60);
    expect(scrollForItem(150, 30, 300, 100)).toBe(100);
    expect(scrollForItem(150, 30, 300, 0, "start")).toBe(150);
    expect(scrollForItem(150, 30, 300, 0, "center")).toBe(15);
  });
});

describe("moveIndex", () => {
  it("moves in a list", () => {
    expect(moveIndex(-1, "down", 10)).toBe(0);
    expect(moveIndex(0, "up", 10)).toBe(0);
    expect(moveIndex(9, "down", 10)).toBe(9);
    expect(moveIndex(5, "pageDown", 10, 1, 3)).toBe(8);
    expect(moveIndex(5, "pageDown", 10, 1, 10)).toBe(9);
    expect(moveIndex(5, "end", 10)).toBe(9);
    expect(moveIndex(5, "left", 10)).toBe(5);
  });
  it("moves in a grid", () => {
    // 3 columns, 8 items: rows [0 1 2] [3 4 5] [6 7]
    expect(moveIndex(1, "down", 8, 3)).toBe(4);
    expect(moveIndex(5, "down", 8, 3)).toBe(7);
    expect(moveIndex(7, "down", 8, 3)).toBe(7);
    expect(moveIndex(4, "up", 8, 3)).toBe(1);
    expect(moveIndex(3, "left", 8, 3)).toBe(2);
    expect(moveIndex(7, "right", 8, 3)).toBe(7);
    expect(moveIndex(7, "pageUp", 8, 3, 5)).toBe(1);
  });
});
