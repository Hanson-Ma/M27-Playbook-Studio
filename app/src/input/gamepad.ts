// Controller input (Gamepad API). One poller turns the first connected pad into button presses and analog frames and
// hands them to a small stack of handlers; screens register one with usePadHandler(), and src/input/padNav.ts installs
// the fallback that drives the whole app (focus movement, A to click, B to close, bumpers for the top tabs).
//
// Buttons use the Xbox names of the "standard" mapping (PlayStation: A = ✕, B = ○, X = □, Y = △). Directions come from
// the D-pad AND the left stick (so both work everywhere), with auto-repeat while held; the other buttons fire once.
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { PadType } from "./keys";

export type PadName = "A" | "B" | "X" | "Y" | "LB" | "RB" | "LT" | "RT" | "VIEW" | "MENU" | "L3" | "R3" | "UP" | "DOWN" | "LEFT" | "RIGHT";

export interface PadPress {
  button: PadName;
  /** Auto-repeat of a held direction (never set for the other buttons). */
  repeat: boolean;
}

/** Analog state for one frame: sticks −1…1 (dead zone applied), triggers 0…1. */
export interface PadFrame {
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  lt: number;
  rt: number;
  /** Seconds since the previous frame (capped). */
  dt: number;
}

export interface PadHandlerOptions {
  /** Higher runs first. Default 0; the app-wide fallback is −100. */
  priority?: number;
  /**
   * Menus, dialogs and pickers own the controller while they're open. A handler with "yield" (default) is skipped then;
   * "own" handlers belong to the overlay itself (the pre-snap view) and always run.
   */
  overlays?: "yield" | "own";
}

export type PadPressHandler = (p: PadPress) => boolean | void;
export type PadAnalogHandler = (f: PadFrame) => boolean | void;

interface Registered extends Required<PadHandlerOptions> {
  id: number;
  press?: PadPressHandler;
  analog?: PadAnalogHandler;
}

// ───────────────────────────── registry ─────────────────────────────

let nextId = 1;
let handlers: Registered[] = [];

function sorted(list: Registered[]): Registered[] {
  // Higher priority first; equal priority: the later registration first.
  return [...list].sort((a, b) => b.priority - a.priority || b.id - a.id);
}

/** Register handlers; returns the unregister function. */
export function registerPadHandler(h: { press?: PadPressHandler; analog?: PadAnalogHandler }, opts: PadHandlerOptions = {}): () => void {
  const entry: Registered = { id: nextId++, priority: opts.priority ?? 0, overlays: opts.overlays ?? "yield", ...h };
  handlers = sorted([...handlers, entry]);
  ensurePolling();
  return () => {
    handlers = handlers.filter((x) => x !== entry);
  };
}

/**
 * Register a handler while mounted. `press` and `analog` are read through a ref, so closures are always current.
 * Return true from `press` to claim the button (lower handlers don't see it).
 */
export function usePadHandler(h: { press?: PadPressHandler; analog?: PadAnalogHandler }, opts: PadHandlerOptions = {}): void {
  const ref = useRef(h);
  ref.current = h;
  const priority = opts.priority ?? 0;
  const overlays = opts.overlays ?? "yield";
  useEffect(
    () =>
      registerPadHandler(
        {
          press: (p) => ref.current.press?.(p),
          analog: (f) => ref.current.analog?.(f),
        },
        { priority, overlays },
      ),
    [priority, overlays],
  );
}

// ───────────────────────────── overlays ─────────────────────────────

/** True while a menu, picker or dialog (other than a pad-owning overlay) is on screen. */
export function foreignOverlayOpen(): boolean {
  if (typeof document === "undefined") return false;
  for (const el of document.querySelectorAll<HTMLElement>("[role='menu'], [role='listbox'], [role='dialog'][aria-modal='true']")) {
    if (!el.closest("[data-pad-own]") && !el.hasAttribute("data-pad-own")) return true;
  }
  return false;
}

// ───────────────────────────── polling ─────────────────────────────

const BUTTON_INDEX: Record<PadName, number> = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
};
const PAD_BUTTONS = Object.keys(BUTTON_INDEX) as PadName[];
const DIRS: readonly PadName[] = ["UP", "DOWN", "LEFT", "RIGHT"];

const DEAD = 0.18;
const STICK_ON = 0.6;
const STICK_OFF = 0.4;
const REPEAT_DELAY = 380;
const REPEAT_EVERY = 105;

interface HeldState {
  down: boolean;
  nextRepeat: number;
}

const held = new Map<PadName, HeldState>();
let raf = 0;
let timer = 0;
let scheduled = false;
let lastFrame = 0;
let stickDir: PadName | null = null;

// connection state (for hints) -------------------------------------------------

let connected = false;
let padType: PadType = "xbox";
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
function subscribe(f: () => void) {
  subs.add(f);
  return () => subs.delete(f);
}

/** True while a controller is connected (after its first button press, in most browsers). */
export function usePadConnected(): boolean {
  return useSyncExternalStore(subscribe, () => connected, () => false);
}

/** Controller family for button glyphs, from the connected pad's id. */
export function usePadType(): PadType {
  return useSyncExternalStore(subscribe, () => padType, () => "xbox" as PadType);
}

/** True once a pad button was pressed more recently than the mouse moved (focus rings use it, see base.css). */
export function padIsActive(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.input === "pad";
}

function setInputKind(kind: "pad" | "mouse") {
  const root = document.documentElement;
  if (root.dataset.input !== kind) root.dataset.input = kind;
}

function typeOf(id: string): PadType {
  return /054c|playstation|dualsense|dualshock|wireless controller/i.test(id) ? "ps" : "xbox";
}

function pickPad(): Gamepad | undefined {
  const pads = typeof navigator !== "undefined" && navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
  const live = pads.filter((p): p is Gamepad => !!p && p.connected);
  // Prefer a "standard" mapping; otherwise whatever is there.
  return live.find((p) => p.mapping === "standard") ?? live[0];
}

const dead = (v: number) => (Math.abs(v) < DEAD ? 0 : Math.sign(v) * ((Math.abs(v) - DEAD) / (1 - DEAD)));

function dispatchPress(p: PadPress) {
  setInputKind("pad");
  const overlay = foreignOverlayOpen();
  for (const h of handlers) {
    if (!h.press) continue;
    if (overlay && h.overlays === "yield") continue;
    if (h.press(p) === true) return;
  }
}

function dispatchAnalog(f: PadFrame) {
  const overlay = foreignOverlayOpen();
  for (const h of handlers) {
    if (!h.analog) continue;
    if (overlay && h.overlays === "yield") continue;
    if (h.analog(f) === true) return;
  }
}

/** Next poll: on the next animation frame, or within 50 ms when the browser isn't painting (occluded or background window). */
function schedule() {
  if (scheduled || typeof window === "undefined") return;
  scheduled = true;
  const run = (t: number) => {
    if (!scheduled) return;
    scheduled = false;
    cancelAnimationFrame(raf);
    window.clearTimeout(timer);
    frame(t);
  };
  raf = requestAnimationFrame(run);
  timer = window.setTimeout(() => run(performance.now()), 50);
}

function frame(now: number) {
  const pad = pickPad();
  const was = connected;
  connected = !!pad;
  if (pad && typeOf(pad.id) !== padType) padType = typeOf(pad.id);
  if (was !== connected) emit();
  if (!pad) {
    held.clear();
    stickDir = null;
    return; // stop polling; a gamepadconnected event restarts it
  }
  schedule();

  const dt = Math.min(0.1, lastFrame ? (now - lastFrame) / 1000 : 0.016);
  lastFrame = now;

  const pressed = (name: PadName): boolean => {
    const b = pad.buttons[BUTTON_INDEX[name]];
    return !!b && (b.pressed || b.value > 0.55);
  };

  // Left stick → a digital direction with hysteresis (the dominant axis wins).
  const ax = pad.axes[0] ?? 0;
  const ay = pad.axes[1] ?? 0;
  const mag = Math.max(Math.abs(ax), Math.abs(ay));
  if (stickDir && mag < STICK_OFF) stickDir = null;
  else if (!stickDir && mag > STICK_ON) stickDir = Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? "RIGHT" : "LEFT") : ay > 0 ? "DOWN" : "UP";
  else if (stickDir && mag > STICK_ON) {
    const next: PadName = Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? "RIGHT" : "LEFT") : ay > 0 ? "DOWN" : "UP";
    if (next !== stickDir) stickDir = next;
  }

  for (const name of PAD_BUTTONS) {
    const isDir = DIRS.includes(name);
    const down = pressed(name) || (isDir && stickDir === name);
    let st = held.get(name);
    if (!st) held.set(name, (st = { down: false, nextRepeat: 0 }));
    if (down && !st.down) {
      st.down = true;
      st.nextRepeat = now + REPEAT_DELAY;
      dispatchPress({ button: name, repeat: false });
    } else if (down && isDir && now >= st.nextRepeat) {
      st.nextRepeat = now + REPEAT_EVERY;
      dispatchPress({ button: name, repeat: true });
    } else if (!down && st.down) {
      st.down = false;
    }
  }

  const f: PadFrame = {
    lx: dead(ax),
    ly: dead(ay),
    rx: dead(pad.axes[2] ?? 0),
    ry: dead(pad.axes[3] ?? 0),
    lt: pad.buttons[6]?.value ?? 0,
    rt: pad.buttons[7]?.value ?? 0,
    dt,
  };
  if (f.lx || f.ly || f.rx || f.ry || f.lt > 0.05 || f.rt > 0.05) {
    // Moving a stick or squeezing a trigger counts as "using the pad" (focus rings), like a button press.
    setInputKind("pad");
    dispatchAnalog(f);
  }
}

function ensurePolling() {
  if (typeof window === "undefined" || scheduled) return;
  lastFrame = 0;
  schedule();
}

let installed = false;

/** Start listening for controllers (idempotent). Called once by the app shell. */
export function installGamepad(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("gamepadconnected", () => ensurePolling());
  window.addEventListener("gamepaddisconnected", () => ensurePolling());
  // The mouse takes the focus ring back.
  window.addEventListener("pointermove", (e) => {
    if (e.movementX || e.movementY) setInputKind("mouse");
  }, { passive: true });
  window.addEventListener("pointerdown", () => setInputKind("mouse"), true);
  window.addEventListener("keydown", (e) => e.isTrusted && setInputKind("mouse"), true);
  // Some browsers only list a pad after its first press; keep an eye out while nothing is connected.
  window.setInterval(() => {
    if (!scheduled && pickPad()) ensurePolling();
  }, 1000);
  ensurePolling();
}
