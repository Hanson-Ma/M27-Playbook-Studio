// Keyboard action registry types (ARCHITECTURE.md "v2 direction"). Re-exported from ./actions.
import type { PadButton } from "../model/audibles";

export interface ActionContext {
  /** "pad" is never sent any more (kept so older view code type-checks). */
  source: "pad" | "key" | "click";
  repeat: boolean;
}

export interface ActionDef {
  id: string;
  /** Human name (tooltips, debugging). Nothing renders a legend any more. */
  label: string;
  /**
   * Keyboard combos ("mod+z", "shift+mod+z", "Enter", "Escape", "Delete", "ArrowUp"…). Only universal keys fire:
   * combos with ⌘/Ctrl/Alt and named keys. Bare printable keys ("x", "1", "?") are ignored — no single-letter
   * shortcuts. Omitted → the universal key of `button` (A → Enter, B → Escape, d-pad → arrows), else none.
   */
  keys?: string[];
  run: (ctx: ActionContext) => void;
  /** Default true. Disabled actions don't fire and still claim their keys. */
  enabled?: boolean;
  /** Auto-repeat while held (arrow keys). */
  repeat?: boolean;
  /** Also fire while a text field has focus (e.g. mod+s, Escape). Printable keys never fire in text fields. */
  allowInInput?: boolean;
  /**
   * Opt in to bare printable keys ("w", " ", "1") for this action: game-style screens (the play-call preview) that
   * mirror the game's own keyboard layout. Never fires while a text field has focus.
   */
  bareKeys?: boolean;

  /** @deprecated v1 controller binding. Ignored, except as the fallback key source described on `keys`. */
  button?: PadButton;
  /** @deprecated v1 pad chord modifier. Ignored (an action with `hold` has no fallback key). */
  hold?: PadButton;
  /** @deprecated v1 legend bar (removed). Ignored. */
  legend?: boolean | "pad";
  /** @deprecated v1 legend order. Ignored. */
  order?: number;
  /** @deprecated v1 legend grouping. Ignored. */
  group?: string;
}
