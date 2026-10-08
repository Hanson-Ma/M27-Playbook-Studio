// The app-wide controller fallback: with nothing else claiming a button, the pad drives the whole site.
//   D-pad / left stick   move focus to the nearest control in that direction (inside a menu or picker: ↑ ↓ ← →)
//   A                    click the focused control (Enter inside a menu or picker)
//   B                    Esc: closes the menu, dialog or picker on top
//   LB / RB              previous / next tab of the top bar
//   right stick          scroll the list or pane under the focus
// Screens that want more (the play call, the overview) register their own handler with usePadHandler() at a higher
// priority and return true for the buttons they use.
import { foreignOverlayOpen, padIsActive, registerPadHandler, type PadFrame, type PadName, type PadPress } from "./gamepad";

export type Dir = "UP" | "DOWN" | "LEFT" | "RIGHT";
const isDir = (b: PadName): b is Dir => b === "UP" || b === "DOWN" || b === "LEFT" || b === "RIGHT";

/** Things a pad can land on: native controls, links, ARIA widgets and anything given a tab stop. */
export const FOCUSABLE =
  "button:not([disabled]), a[href], input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled]), summary, " +
  "[role='button'], [role='tab'], [role='menuitem'], [role='option'], [role='checkbox'], [role='switch'], [role='radio'], [tabindex='0']";

interface Box {
  el: HTMLElement;
  left: number;
  right: number;
  top: number;
  bottom: number;
  cx: number;
  cy: number;
}

function boxOf(el: HTMLElement): Box | undefined {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return undefined;
  return { el, left: r.left, right: r.right, top: r.top, bottom: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
}

function visible(el: HTMLElement): boolean {
  if (el.closest("[inert], [aria-hidden='true'], [hidden]")) return false;
  const st = getComputedStyle(el);
  return st.visibility !== "hidden" && st.display !== "none" && st.pointerEvents !== "none";
}

/** The overlay on top (menu, picker or dialog), else undefined. Portaled overlays come last in the document. */
export function topOverlay(): HTMLElement | undefined {
  const all = Array.from(document.querySelectorAll<HTMLElement>("[role='menu'], [role='listbox'], [role='dialog'][aria-modal='true']"));
  return all.filter((el) => !el.hasAttribute("data-pad-own") && !el.closest("[data-pad-own]")).pop();
}

/** Visible, focusable controls inside `root` that sit (at least partly) in the window. */
export function focusables(root: ParentNode = document): HTMLElement[] {
  const out: HTMLElement[] = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  for (const el of root.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (el.matches("[disabled], [aria-disabled='true'], [data-pad-skip], [role='separator']") || !visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) continue;
    out.push(el);
  }
  return out;
}

/** Best control in direction `dir` from `from`, by edge distance with a penalty for being off to the side. */
export function nearest(from: Box, dir: Dir, candidates: HTMLElement[]): HTMLElement | undefined {
  let best: HTMLElement | undefined;
  let bestScore = Infinity;
  for (const el of candidates) {
    if (el === from.el || from.el.contains(el) || el.contains(from.el)) continue;
    const b = boxOf(el);
    if (!b) continue;
    let along: number; // gap between the facing edges (negative = overlapping along the axis)
    let across: number; // gap on the other axis (0 = they overlap, i.e. same row / column)
    let ahead: boolean;
    if (dir === "RIGHT" || dir === "LEFT") {
      ahead = dir === "RIGHT" ? b.cx > from.cx + 2 : b.cx < from.cx - 2;
      along = dir === "RIGHT" ? b.left - from.right : from.left - b.right;
      across = Math.max(0, b.top - from.bottom, from.top - b.bottom);
    } else {
      ahead = dir === "DOWN" ? b.cy > from.cy + 2 : b.cy < from.cy - 2;
      along = dir === "DOWN" ? b.top - from.bottom : from.top - b.bottom;
      across = Math.max(0, b.left - from.right, from.left - b.right);
    }
    if (!ahead) continue;
    const off = dir === "LEFT" || dir === "RIGHT" ? Math.abs(b.cy - from.cy) : Math.abs(b.cx - from.cx);
    const score = Math.max(0, along) + 4 * across + 0.25 * off + (along < 0 ? 40 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

/** Focus an element and keep it on screen; the ring shows because the pad is the active input. */
export function focusEl(el: HTMLElement): void {
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/** Move focus one step. Returns false when there was nowhere to go. */
export function moveFocus(dir: Dir, root: ParentNode = document): boolean {
  const cands = focusables(root);
  if (!cands.length) return false;
  const cur = document.activeElement instanceof HTMLElement && cands.includes(document.activeElement) ? document.activeElement : undefined;
  if (!cur) {
    focusEl(initialTarget(cands));
    return true;
  }
  const from = boxOf(cur);
  if (!from) return false;
  const next = nearest(from, dir, cands);
  if (!next) return false;
  focusEl(next);
  return true;
}

/** Where the pad lands first: the selected / current control, else the first one in the main area. */
function initialTarget(cands: HTMLElement[]): HTMLElement {
  const marked = cands.find((c) => c.matches("[aria-selected='true'], [aria-current='true'], [data-selected], [data-pad-start]"));
  if (marked) return marked;
  return cands.find((c) => c.closest("main")) ?? cands[0];
}

/** Dispatch a key the way the keyboard would (the app's menus, pickers and dialogs listen for these). */
export function sendKey(key: string): boolean {
  const target = document.activeElement ?? document.body;
  const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(ev);
  return ev.defaultPrevented;
}

function activate(el: Element | null): boolean {
  if (!(el instanceof HTMLElement) || el === document.body) return false;
  if (el instanceof HTMLInputElement && (el.type === "text" || el.type === "search" || el.type === "number")) {
    el.select();
    return true;
  }
  el.click();
  return true;
}

/** Cycle the top bar's tabs (Playbook · Library · Designer · …). */
function cycleMainTab(delta: 1 | -1): boolean {
  const tabs = Array.from(document.querySelectorAll<HTMLElement>("[role='tablist'][aria-label='Main'] [role='tab']"));
  if (!tabs.length) return false;
  const i = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
  const next = tabs[(i + delta + tabs.length) % tabs.length];
  next.click();
  return true;
}

function scrollable(el: Element | null): HTMLElement | undefined {
  for (let n: Element | null = el; n && n !== document.documentElement; n = n.parentElement) {
    if (!(n instanceof HTMLElement)) continue;
    const st = getComputedStyle(n);
    if (/(auto|scroll)/.test(st.overflowY) && n.scrollHeight > n.clientHeight + 2) return n;
  }
  return undefined;
}

/** True when keys (not spatial moves) should carry the pad: inside a menu or picker, or a text field. */
function keyMode(): boolean {
  const a = document.activeElement;
  if (!(a instanceof HTMLElement)) return false;
  if (a.closest("[role='menu'], [role='listbox']")) return true;
  const top = topOverlay();
  if (top && (top.getAttribute("role") === "menu" || top.getAttribute("role") === "listbox")) return true;
  // The picker's filter box: ↑ ↓ pick, Enter chooses.
  return a instanceof HTMLInputElement && a.getAttribute("aria-label") === "Filter";
}

function onPress(p: PadPress): boolean {
  const over = topOverlay();
  switch (p.button) {
    case "UP":
    case "DOWN":
    case "LEFT":
    case "RIGHT": {
      if (keyMode()) {
        sendKey({ UP: "ArrowUp", DOWN: "ArrowDown", LEFT: "ArrowLeft", RIGHT: "ArrowRight" }[p.button]);
        return true;
      }
      // A dialog keeps the pad inside it; nothing focused yet → land on its first control.
      moveFocus(p.button, over ?? document);
      return true;
    }
    case "A": {
      if (keyMode()) {
        sendKey("Enter");
        return true;
      }
      if (!activate(document.activeElement)) moveFocus("DOWN", over ?? document);
      return true;
    }
    case "B":
      sendKey("Escape");
      return true;
    case "LB":
      return over ? false : cycleMainTab(-1);
    case "RB":
      return over ? false : cycleMainTab(1);
    default:
      return false;
  }
}

function onAnalog(f: PadFrame): boolean {
  if (!f.ry) return false;
  const el = scrollable(document.activeElement) ?? scrollable(document.querySelector("main"));
  if (!el) return false;
  el.scrollTop += f.ry * 900 * f.dt;
  return true;
}

let installed = false;

/** Install the fallback handler (idempotent). */
export function installPadNav(): void {
  if (installed) return;
  installed = true;
  registerPadHandler({ press: onPress, analog: onAnalog }, { priority: -100, overlays: "own" });
}

export { padIsActive, foreignOverlayOpen, isDir };
