// Keyboard action registry (ARCHITECTURE.md "v2 direction"): scoped actions registered by mounted components and one
// global keydown listener. The app is keyboard + mouse only — every action also has a visible control; this registry
// only carries the universal keys (⌘/Ctrl+Z, ⇧⌘Z / Ctrl+Y, ⌘/Ctrl+S, Esc, Enter in dialogs, Delete, arrows in a
// focused list). There is no controller input and no legend bar any more.
import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from "react";
import { IS_MAC } from "./keys";
import { findById, findByKey, type Scope } from "./registry";
import type { ActionContext, ActionDef } from "./types";

export type { ActionContext, ActionDef };

// ─────────────────────────────── live registry ───────────────────────────────

let nextToken = 1;
let scopes: Scope[] = [];

function upsertScope(token: number, id: string, modal: boolean, layer: number, actions: ActionDef[]) {
  const existing = scopes.find((x) => x.token === token);
  if (existing) {
    existing.actions = actions;
    existing.id = id;
    // A long-lived scope that turns modal can't tell its own children from later siblings by token, so only
    // scopes inside its <ActionLayer> stay active above it. (Mount a fresh component for overlays instead.)
    if (modal && !existing.modal) existing.ceiling = token + 1;
    existing.modal = modal;
    return;
  }
  // Layout effects run after the whole render pass, so everything rendered with the modal is below the ceiling.
  const scope: Scope = { token, id, modal, layer, actions, ceiling: modal ? nextToken : undefined };
  scopes = [...scopes, scope].sort((a, b) => a.token - b.token);
}

function removeScope(token: number) {
  if (!scopes.some((x) => x.token === token)) return;
  scopes = scopes.filter((x) => x.token !== token);
}

const LayerContext = createContext(0);

/**
 * Marks `children` as part of a modal scope's layer, so scopes they mount *later* (lazy panels, lists that appear
 * after loading) stay active above the modal. Modal and SearchSelect do this already; custom overlays that call
 * useActions(…, { modal: true }) should wrap their content: `<ActionLayer token={useActions(…)}>`.
 */
export function ActionLayer({ token, children }: { token: number; children: ReactNode }) {
  return <LayerContext.Provider value={token}>{children}</LayerContext.Provider>;
}

export interface UseActionsOptions {
  /** Block every lower scope (dialogs, open menus). */
  modal?: boolean;
  /**
   * Re-stack the scope on top whenever this turns true, as if it mounted at that moment (focus-bound keys that must
   * beat scopes mounted after it). The token changes: don't pass it to ActionLayer.
   */
  front?: boolean;
}

/**
 * Register keyboard actions while mounted. Scopes stack by mount order (parents before children, later mounts on
 * top); later scopes win conflicts; `modal: true` blocks every lower scope. Pass a fresh array every render — run
 * closures are always current. Returns the scope token (for <ActionLayer>).
 */
export function useActions(scopeId: string, actions: ActionDef[], opts?: UseActionsOptions): number {
  // Allocated during render (not in an effect): render order is parent-first, effect order is child-first.
  const token = useRef(0);
  const front = !!opts?.front;
  const wasFront = useRef(front);
  if (token.current === 0) token.current = nextToken++;
  else if (front && !wasFront.current) token.current = nextToken++;
  wasFront.current = front;
  const modal = !!opts?.modal;
  const layer = useContext(LayerContext);
  const registered = useRef(0);

  useLayoutEffect(() => {
    ensureInput();
    return () => removeScope(registered.current);
  }, []);

  useLayoutEffect(() => {
    if (registered.current && registered.current !== token.current) removeScope(registered.current);
    registered.current = token.current;
    upsertScope(token.current, scopeId, modal, layer, actions);
  });
  return token.current;
}

/** Run an action by scope token + id (e.g. from a button). Returns false when missing or disabled. */
export function runAction(token: number, id: string, ctx: ActionContext = { source: "click", repeat: false }): boolean {
  const a = findById(scopes, token, id);
  if (!a || a.enabled === false) return false;
  a.run(ctx);
  return true;
}

// ─────────────────────────────── keyboard listener ───────────────────────────────

const TEXT_INPUT_TYPES = new Set([
  "", "text", "search", "email", "password", "tel", "url", "number", "date", "datetime-local", "month", "time", "week", "range", "color",
]);

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  if (t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true;
  return t instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(t.type);
}

/** Elements that already activate on Enter/Space; let them, instead of firing an Enter action too. */
function isActivatable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return !!t.closest("button, a[href], summary, input, [role='button'], [role='menuitem'], [role='option'], [role='tab'], [role='checkbox'], [role='switch']");
}

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn", "OS"]);

function onKeyDown(e: KeyboardEvent) {
  if (e.defaultPrevented || e.isComposing || MODIFIER_KEYS.has(e.key)) return;
  const inInput = isEditable(e.target);
  if (!inInput && (e.key === "Enter" || e.key === " ") && isActivatable(e.target)) return;
  const hit = findByKey(scopes, e, IS_MAC, inInput);
  if (!hit) {
    // Esc leaves a text field so the next Esc reaches the view.
    if (e.key === "Escape" && inInput && e.target instanceof HTMLElement) e.target.blur();
    return;
  }
  const { action } = hit;
  if (action.enabled === false) {
    // Still swallow browser shortcuts (⌘S with nothing to save shouldn't open "Save page").
    if (e.metaKey || e.ctrlKey || e.altKey) e.preventDefault();
    return;
  }
  e.preventDefault();
  if (e.repeat && !action.repeat) return;
  action.run({ source: "key", repeat: e.repeat });
}

let installed = false;

/** Install the global keyboard listener (idempotent; useActions calls it). */
export function ensureInput(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("keydown", onKeyDown);
}
