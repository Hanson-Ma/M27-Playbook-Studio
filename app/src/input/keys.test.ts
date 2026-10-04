import { describe, expect, it } from "vitest";
import { comboId, comboLabel, detectMac, keyName, matchCombo, padButtonName, parseCombo, type KeyEventLike } from "./keys";

const ev = (key: string, mods: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key,
  code: mods.code,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe("parseCombo", () => {
  it("parses modifiers and normalizes the key", () => {
    expect(parseCombo("shift+mod+Z")).toEqual({ key: "z", mod: true, ctrl: false, meta: false, shift: true, alt: false });
    expect(parseCombo("Esc").key).toBe("Escape");
    expect(parseCombo("up").key).toBe("ArrowUp");
    expect(parseCombo("mod++")).toMatchObject({ key: "+", mod: true });
  });
  it("gives equal bindings the same id", () => {
    expect(comboId("mod+Z")).toBe(comboId("mod+z"));
    expect(comboId("shift+mod+z")).not.toBe(comboId("mod+z"));
  });
});

describe("matchCombo", () => {
  it("maps mod to ⌘ on mac and Ctrl elsewhere", () => {
    const c = parseCombo("mod+z");
    expect(matchCombo(ev("z", { metaKey: true }), c, true)).toBe(true);
    expect(matchCombo(ev("z", { ctrlKey: true }), c, true)).toBe(false);
    expect(matchCombo(ev("z", { ctrlKey: true }), c, false)).toBe(true);
    expect(matchCombo(ev("z", { metaKey: true }), c, false)).toBe(false);
  });
  it("requires exact modifiers", () => {
    expect(matchCombo(ev("Z", { metaKey: true, shiftKey: true }), parseCombo("mod+z"), true)).toBe(false);
    expect(matchCombo(ev("Z", { metaKey: true, shiftKey: true }), parseCombo("shift+mod+z"), true)).toBe(true);
    expect(matchCombo(ev("q"), parseCombo("q"), true)).toBe(true);
    expect(matchCombo(ev("Q", { shiftKey: true }), parseCombo("q"), true)).toBe(false);
  });
  it("ignores Shift for shifted punctuation", () => {
    expect(matchCombo(ev("?", { shiftKey: true }), parseCombo("?"), false)).toBe(true);
  });
  it("falls back to the physical key when Alt or Shift change `key`", () => {
    expect(matchCombo(ev("Ω", { altKey: true, code: "KeyZ" }), parseCombo("alt+z"), true)).toBe(true);
    expect(matchCombo(ev("!", { shiftKey: true, code: "Digit1" }), parseCombo("shift+1"), true)).toBe(true);
  });
  it("matches named keys", () => {
    expect(matchCombo(ev("Enter"), parseCombo("Enter"), true)).toBe(true);
    expect(matchCombo(ev("Escape"), parseCombo("esc"), true)).toBe(true);
    expect(matchCombo(ev("ArrowUp"), parseCombo("ArrowUp"), true)).toBe(true);
  });
});

describe("labels", () => {
  it("formats keycaps per platform", () => {
    expect(comboLabel("mod+z", true)).toBe("⌘Z");
    expect(comboLabel("shift+mod+z", true)).toBe("⇧⌘Z");
    expect(comboLabel("shift+mod+z", false)).toBe("Ctrl+Shift+Z");
    expect(comboLabel("Escape", false)).toBe("Esc");
    expect(keyName("ArrowLeft")).toBe("←");
    expect(keyName("Enter")).toBe("↵ Enter");
  });
  it("names pad buttons per family", () => {
    expect(padButtonName("A", "ps")).toBe("Cross");
    expect(padButtonName("RB", "ps")).toBe("R1");
    expect(padButtonName("RB", "xbox")).toBe("RB");
    expect(padButtonName("UP", "xbox")).toBe("D-pad Up");
  });
});

describe("platform", () => {
  it("detects mac platforms", () => {
    expect(detectMac("MacIntel")).toBe(true);
    expect(detectMac("macOS")).toBe(true);
    expect(detectMac("Win32")).toBe(false);
  });
});
