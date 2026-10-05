import { describe, expect, it } from "vitest";
import type { KeyEventLike } from "./keys";
import { activeScopes, bindingSignature, effectiveKeys, findById, findByKey, isUniversalCombo, type Scope } from "./registry";
import type { ActionDef } from "./types";

const noop = () => {};
const act = (id: string, extra: Partial<ActionDef> = {}): ActionDef => ({ id, label: id, run: noop, ...extra });
const scope = (token: number, actions: ActionDef[], modal = false): Scope => ({ token, id: `s${token}`, modal, actions });
const key = (k: string, mods: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe("universal keys only", () => {
  it("accepts modifier combos and named keys, rejects bare printable keys", () => {
    for (const k of ["mod+z", "shift+mod+z", "mod+y", "mod+s", "shift+mod+s", "alt+ArrowUp", "Enter", "Escape", "Delete", "Backspace", "ArrowLeft", "PageDown", "Home", "F2"])
      expect(isUniversalCombo(k), k).toBe(true);
    for (const k of ["x", "q", "1", "?", "shift+q", "space", "+"]) expect(isUniversalCombo(k), k).toBe(false);
  });

  it("drops single-letter keys from an action and never fires them", () => {
    const view = scope(1, [act("flip", { keys: ["f", "mod+f"] }), act("fav", { keys: ["x"] })]);
    expect(effectiveKeys(view.actions[0])).toEqual(["mod+f"]);
    expect(effectiveKeys(view.actions[1])).toEqual([]);
    expect(findByKey([view], key("f"), true, false)).toBeUndefined();
    expect(findByKey([view], key("x"), true, false)).toBeUndefined();
    expect(findByKey([view], key("f", { metaKey: true }), true, false)?.action.id).toBe("flip");
  });

  it("maps a bare `button` to its universal key (A Enter, B Esc, d-pad arrows) and ignores the rest", () => {
    expect(effectiveKeys(act("a", { button: "A" }))).toEqual(["Enter"]);
    expect(effectiveKeys(act("b", { button: "B" }))).toEqual(["Escape"]);
    expect(effectiveKeys(act("u", { button: "UP" }))).toEqual(["ArrowUp"]);
    for (const b of ["X", "Y", "LB", "RB", "LT", "RT", "LS", "RS", "VIEW", "MENU"] as const) expect(effectiveKeys(act(b, { button: b }))).toEqual([]);
    expect(effectiveKeys(act("chord", { hold: "VIEW", button: "A" }))).toEqual([]);
    expect(effectiveKeys(act("padOnly", { button: "A", keys: [] }))).toEqual([]);
  });
});

describe("scope stack", () => {
  const global = scope(1, [act("undo", { keys: ["mod+z"] }), act("save", { keys: ["mod+s"], allowInInput: true })]);
  const view = scope(2, [act("open", { button: "A" }), act("del", { keys: ["Delete", "Backspace"] }), act("save-view", { keys: ["mod+s"], label: "Save play" })]);
  const modal = scope(3, [act("ok", { keys: ["Enter"] }), act("cancel", { keys: ["Escape"], allowInInput: true })], true);

  it("later scopes win conflicts", () => {
    expect(findByKey([global, view], key("s", { metaKey: true }), true, false)?.action.id).toBe("save-view");
    expect(findByKey([global, view], key("z", { metaKey: true }), true, false)?.action.id).toBe("undo");
  });

  it("modal scopes block lower scopes", () => {
    expect(activeScopes([global, view, modal])).toEqual([modal]);
    expect(findByKey([global, view, modal], key("z", { metaKey: true }), true, false)).toBeUndefined();
    expect(findByKey([global, view, modal], key("Delete"), true, false)).toBeUndefined();
    expect(findByKey([global, view, modal], key("Enter"), true, false)?.action.id).toBe("ok");
    const above = scope(4, [act("pick", { keys: ["ArrowDown"] })]);
    expect(activeScopes([global, modal, above])).toEqual([modal, above]);
  });

  it("keeps scopes that belong to the top modal, blocks late mounts behind it", () => {
    const base = scope(1, [act("b", { keys: ["Enter"] })]);
    const dialog: Scope = { ...scope(5, [act("ok", { keys: ["Enter"] })], true), ceiling: 8 };
    const sameRender: Scope = { ...scope(6, [act("list", { keys: ["ArrowUp"] })]), layer: 0 }; // rendered with the dialog
    const lateInside: Scope = { ...scope(9, [act("lazy", { keys: ["Delete"] })]), layer: 5 }; // mounted later in its ActionLayer
    const lateBehind: Scope = { ...scope(10, [act("view", { keys: ["Enter"] }), act("y", { keys: ["Backspace"] })]), layer: 0 }; // view finished loading
    const stack = [base, dialog, sameRender, lateInside, lateBehind];
    expect(activeScopes(stack).map((x) => x.token)).toEqual([5, 6, 9]);
    expect(findByKey(stack, key("Enter"), true, false)?.action.id).toBe("ok");
    expect(findByKey(stack, key("Backspace"), true, false)).toBeUndefined();
  });

  it("skips actions in text fields unless allowInInput", () => {
    expect(findByKey([global], key("z", { metaKey: true }), true, true)).toBeUndefined();
    expect(findByKey([global], key("s", { metaKey: true }), true, true)?.action.id).toBe("save");
    expect(findByKey([modal], key("Escape"), true, true)?.action.id).toBe("cancel");
    expect(findByKey([modal], key("Enter"), true, true)).toBeUndefined();
  });

  it("a disabled action still claims its key", () => {
    const lower = scope(1, [act("a1", { keys: ["Delete"] })]);
    const upper = scope(2, [act("a2", { keys: ["Delete"], enabled: false })]);
    expect(findByKey([lower, upper], key("Delete"), true, false)?.action.id).toBe("a2");
  });

  it("finds an action by scope token and id", () => {
    expect(findById([global, view], 2, "del")?.label).toBe("del");
    expect(findById([global, view], 1, "del")).toBeUndefined();
  });
});

describe("typing in text fields", () => {
  it("never lets a printable key fire an action in a text field, even with allowInInput", () => {
    const s1 = scope(1, [act("back", { keys: ["mod+b"], allowInInput: true }), act("save", { keys: ["mod+s"], allowInInput: true })]);
    expect(findByKey([s1], key("b"), true, true)).toBeUndefined();
    expect(findByKey([s1], key("s", { metaKey: true }), true, true)?.action.id).toBe("save");
  });
});

describe("bindingSignature", () => {
  it("ignores closures and pad-only fields but sees key/enabled changes", () => {
    const a = [act("x", { keys: ["Delete"], button: "X", order: 3 })];
    const b = [{ ...a[0], run: () => 1, button: "Y" as const, order: 9 }];
    expect(bindingSignature(a)).toBe(bindingSignature(b));
    expect(bindingSignature(a)).not.toBe(bindingSignature([{ ...a[0], enabled: false }]));
    expect(bindingSignature(a)).not.toBe(bindingSignature([{ ...a[0], keys: ["Backspace"] }]));
  });
});
