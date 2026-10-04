// Pure keyboard + controller naming helpers: combo parsing/matching, keycap labels, pad button names (audible glyphs).
// No React/DOM here so the rules are unit-testable.
import type { PadButton } from "../model/audibles";

/** Controller family for audible glyphs. */
export type PadType = "xbox" | "ps";

export const PAD_BUTTONS: PadButton[] = [
  "A", "B", "X", "Y", "LB", "RB", "LT", "RT", "LS", "RS", "VIEW", "MENU", "UP", "DOWN", "LEFT", "RIGHT",
];
export const FACE_BUTTONS: PadButton[] = ["A", "B", "X", "Y"];
export const DIRECTIONS: PadButton[] = ["UP", "DOWN", "LEFT", "RIGHT"];

export const isDirection = (b: PadButton): boolean => b === "UP" || b === "DOWN" || b === "LEFT" || b === "RIGHT";

const PS_NAMES: Partial<Record<PadButton, string>> = {
  A: "Cross", B: "Circle", X: "Square", Y: "Triangle",
  LB: "L1", RB: "R1", LT: "L2", RT: "R2", LS: "L3", RS: "R3", VIEW: "Create", MENU: "Options",
};
const XBOX_NAMES: Partial<Record<PadButton, string>> = { VIEW: "View", MENU: "Menu" };
const DIR_NAMES: Partial<Record<PadButton, string>> = { UP: "D-pad Up", DOWN: "D-pad Down", LEFT: "D-pad Left", RIGHT: "D-pad Right" };

/** Human name of a pad button for tooltips ("A", "Cross", "L1", "D-pad Up"…). */
export function padButtonName(b: PadButton, type: PadType): string {
  return DIR_NAMES[b] ?? (type === "ps" ? PS_NAMES[b] : XBOX_NAMES[b]) ?? b;
}

/** Short text printed on bumper/trigger/stick glyphs ("LB" / "L1", "LS" / "L3"). */
export function padButtonShort(b: PadButton, type: PadType): string {
  if (type === "ps") {
    const ps: Partial<Record<PadButton, string>> = { LB: "L1", RB: "R1", LT: "L2", RT: "R2", LS: "L3", RS: "R3" };
    return ps[b] ?? b;
  }
  return b;
}

export function detectMac(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export const IS_MAC: boolean =
  typeof navigator !== "undefined" &&
  detectMac(
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
      navigator.platform ||
      navigator.userAgent,
  );

// ─────────────────────────────── combos ───────────────────────────────

export interface KeyCombo {
  /** KeyboardEvent.key, letters lowercased ("z", "Enter", "ArrowUp", "1"). */
  key: string;
  /** ⌘ on mac, Ctrl elsewhere. */
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

const KEY_ALIASES: Record<string, string> = {
  esc: "Escape",
  escape: "Escape",
  enter: "Enter",
  return: "Enter",
  del: "Delete",
  delete: "Delete",
  backspace: "Backspace",
  space: " ",
  spacebar: " ",
  tab: "Tab",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  pageup: "PageUp",
  pagedown: "PageDown",
  pgup: "PageUp",
  pgdn: "PageDown",
  home: "Home",
  end: "End",
  plus: "+",
};

function normKey(k: string): string {
  if (k.length === 1) return k.toLowerCase();
  return KEY_ALIASES[k.toLowerCase()] ?? k;
}

const comboCache = new Map<string, KeyCombo>();

/** "shift+mod+z" → { key: "z", shift, mod }. Modifier names: mod, ctrl/control, meta/cmd, shift, alt/option. */
export function parseCombo(combo: string): KeyCombo {
  const hit = comboCache.get(combo);
  if (hit) return hit;
  const parts = combo.split("+");
  // "mod++" ends with an empty part: the key itself is "+".
  let key = parts.pop() ?? "";
  if (key === "" && parts.length && parts[parts.length - 1] === "") {
    parts.pop();
    key = "+";
  }
  const c: KeyCombo = { key: normKey(key), mod: false, ctrl: false, meta: false, shift: false, alt: false };
  for (const raw of parts) {
    const m = raw.toLowerCase();
    if (m === "mod") c.mod = true;
    else if (m === "ctrl" || m === "control") c.ctrl = true;
    else if (m === "meta" || m === "cmd" || m === "command") c.meta = true;
    else if (m === "shift") c.shift = true;
    else if (m === "alt" || m === "option" || m === "opt") c.alt = true;
  }
  comboCache.set(combo, c);
  return c;
}

/** Stable identity of a combo for conflict detection ("mod+Z" and "mod+z" are the same binding). */
export function comboId(combo: string): string {
  const c = parseCombo(combo);
  return `${c.mod ? "M" : ""}${c.ctrl ? "C" : ""}${c.meta ? "W" : ""}${c.shift ? "S" : ""}${c.alt ? "A" : ""}:${c.key.toLowerCase()}`;
}

export interface KeyEventLike {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

const isAlnum = (k: string) => /^[a-z0-9]$/i.test(k);

export function matchCombo(e: KeyEventLike, c: KeyCombo, mac: boolean): boolean {
  const wantMeta = c.meta || (c.mod && mac);
  const wantCtrl = c.ctrl || (c.mod && !mac);
  if (e.metaKey !== wantMeta || e.ctrlKey !== wantCtrl || e.altKey !== c.alt) return false;
  const single = c.key.length === 1;
  // Shifted punctuation ("?", "+") needs Shift to be typed at all, so Shift only matters for letters, digits and named keys.
  if ((!single || isAlnum(c.key)) && e.shiftKey !== c.shift) return false;
  const k = normKey(e.key);
  if (k === c.key) return true;
  // Alt (mac) and Shift+digit change `key` ("Ω", "!"); fall back to the physical key for letters and digits.
  if (single && isAlnum(c.key) && e.code) {
    const code = /^[0-9]$/.test(c.key) ? `Digit${c.key}` : `Key${c.key.toUpperCase()}`;
    return e.code === code;
  }
  return false;
}

// ─────────────────────────────── labels ───────────────────────────────

const KEY_LABELS: Record<string, string> = {
  Enter: "↵ Enter",
  Escape: "Esc",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Delete: "Del",
  Backspace: "⌫",
  Tab: "Tab",
  " ": "Space",
  PageUp: "PgUp",
  PageDown: "PgDn",
  Home: "Home",
  End: "End",
};

/** Text of the key itself, without modifiers ("Esc", "↑", "Z"). */
export function keyName(key: string): string {
  const k = normKey(key);
  return KEY_LABELS[k] ?? (k.length === 1 ? k.toUpperCase() : k);
}

/** Keycap text: "mod+shift+z" → "⇧⌘Z" on mac, "Ctrl+Shift+Z" elsewhere. */
export function comboLabel(combo: string, mac: boolean = IS_MAC): string {
  const c = parseCombo(combo);
  const key = keyName(c.key);
  if (mac) {
    // Apple's modifier order: ⌃ ⌥ ⇧ ⌘.
    const mods = (c.ctrl ? "⌃" : "") + (c.alt ? "⌥" : "") + (c.shift ? "⇧" : "") + (c.mod || c.meta ? "⌘" : "");
    return mods + key;
  }
  const mods: string[] = [];
  if (c.mod || c.ctrl) mods.push("Ctrl");
  if (c.meta) mods.push("Win");
  if (c.alt) mods.push("Alt");
  if (c.shift) mods.push("Shift");
  return [...mods, key].join("+");
}
