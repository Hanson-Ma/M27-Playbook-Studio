// Scope stack resolution for the keyboard action registry. Pure: the React layer (actions.tsx) owns the live list.
//
// v2 (keyboard + mouse only): actions are matched by keyboard combos. Scopes are ordered by `token` (allocated at
// first render, so parents come before children and later mounts come last). A `modal` scope blocks every scope below
// it. Scopes above the topmost modal stay active when they belong to it: rendered in the same pass (token < the
// modal's `ceiling`) or mounted later inside its ActionLayer (`layer` ≥ the modal's token). Later scopes win
// conflicts, and a disabled action still claims its key so input never silently falls through to a lower scope.
//
// Only universal web keys are honoured (ARCHITECTURE.md "v2 direction"): combos with ⌘/Ctrl/Alt, and named keys
// (Enter, Escape, Delete, Backspace, arrows, Page Up/Down, Home/End, Tab, F-keys). Bare printable keys ("x", "1",
// "?", "shift+q") never fire — the app has no single-letter shortcuts. Pad-only fields on ActionDef (`button`,
// `hold`, `legend`, `group`, `order`) are accepted for compatibility and ignored, except that an action with only a
// `button` keeps the universal key of that button: A → Enter, B → Escape, d-pad → arrows.
import type { PadButton } from "../model/audibles";
import { comboId, matchCombo, parseCombo, type KeyEventLike } from "./keys";
import type { ActionDef } from "./types";

export interface Scope {
  token: number;
  id: string;
  modal: boolean;
  actions: ActionDef[];
  /** Token of the nearest enclosing ActionLayer (0 = base layer). */
  layer?: number;
  /** Modal scopes: first token allocated after the modal was committed. */
  ceiling?: number;
}

export interface Hit {
  scope: Scope;
  action: ActionDef;
}

/** Universal key behind a pad button for actions that declare only `button` (legacy view code). */
export const BUTTON_FALLBACK_KEYS: Partial<Record<PadButton, string>> = {
  A: "Enter",
  B: "Escape",
  UP: "ArrowUp",
  DOWN: "ArrowDown",
  LEFT: "ArrowLeft",
  RIGHT: "ArrowRight",
};

/**
 * True for combos the app honours: anything with ⌘/Ctrl/Alt ("mod+z", "alt+ArrowUp"), or a named key ("Enter",
 * "Escape", "Delete", "ArrowUp", "PageDown", "F2"). False for bare printable keys, with or without Shift ("x", "1",
 * "?", "shift+q", "Space").
 */
export function isUniversalCombo(combo: string): boolean {
  const c = parseCombo(combo);
  if (c.mod || c.ctrl || c.meta || c.alt) return true;
  return c.key.length > 1;
}

/** Scopes currently receiving input, bottom → top. `scopes` must be sorted by token. */
export function activeScopes(scopes: readonly Scope[]): readonly Scope[] {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const m = scopes[i];
    if (!m.modal) continue;
    const ceiling = m.ceiling ?? Infinity;
    return [m, ...scopes.slice(i + 1).filter((s) => s.token < ceiling || (s.layer ?? 0) >= m.token)];
  }
  return scopes;
}

/**
 * Keyboard combos an action responds to: its universal `keys`; with `keys` omitted, the universal key of its
 * `button` (A → Enter, B → Escape, d-pad → arrows; none for chords or other buttons); `keys: []` → none.
 */
export function effectiveKeys(a: ActionDef): string[] {
  if (a.keys) return a.bareKeys ? a.keys : a.keys.filter(isUniversalCombo);
  if (!a.button || a.hold) return [];
  const k = BUTTON_FALLBACK_KEYS[a.button];
  return k ? [k] : [];
}

/** A printable character typed without Ctrl/⌘/Alt: text fields always get these, even for allowInInput actions. */
export function isTypingKey(e: KeyEventLike): boolean {
  return e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
}

export function findByKey(scopes: readonly Scope[], e: KeyEventLike, mac: boolean, inInput: boolean): Hit | undefined {
  if (inInput && isTypingKey(e)) return undefined;
  const active = activeScopes(scopes);
  for (let s = active.length - 1; s >= 0; s--) {
    for (const action of active[s].actions) {
      if (inInput && !action.allowInInput) continue;
      for (const k of effectiveKeys(action)) {
        if (matchCombo(e, parseCombo(k), mac)) return { scope: active[s], action };
      }
    }
  }
  return undefined;
}

export function findById(scopes: readonly Scope[], token: number, id: string): ActionDef | undefined {
  return scopes.find((s) => s.token === token)?.actions.find((a) => a.id === id);
}

/** Fingerprint of an action list's key bindings (debug/tests: two lists with equal signatures behave the same). */
export function bindingSignature(actions: readonly ActionDef[]): string {
  return actions.map((a) => `${a.id}|${effectiveKeys(a).map(comboId).join(",")}|${a.enabled !== false}|${!!a.allowInInput}|${!!a.repeat}`).join("\n");
}
