// Pointer-based drag and drop for the builder: tree rows, set cards, audible targets and the add-plays drawer.
// A drag starts after a few pixels of movement (so clicks stay clicks), follows the pointer with a ghost, finds the
// drop target under the pointer (`[data-drop]` elements), asks the active resolver whether/where it can drop, draws
// a drop indicator line (or an outline for "into"), auto-scrolls `[data-autoscroll]` containers near their edges,
// and swallows the click that follows a drag. Esc cancels.
import { useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import type { EntryRef } from "../../model/playbook";
import type { PlayKey } from "../../model/types";
import { Icon, cx } from "../../ui";
import s from "./dnd.module.css";

export type DragKind = "formations" | "sets" | "plays" | "library";

export interface DragPayload {
  kind: DragKind;
  /** Entry refs (in-book drags). */
  refs: EntryRef[];
  /** Library/catalog play keys (drawer drags, and plays dragged from cards). */
  keys?: PlayKey[];
  /** Ghost text. */
  label: string;
  count: number;
}

export type DropPlace = "before" | "after" | "into";

export interface DropCheck {
  ok: boolean;
  place: DropPlace;
  /** Why the drop is refused (shown on the ghost). */
  reason?: string;
  /** Indicator orientation: "h" = line above/below (lists), "v" = line left/right (card grids). */
  axis?: "h" | "v";
}

export interface DropTargetInfo {
  el: HTMLElement;
  /** data-drop value, e.g. "tree-set", "card", "audible". */
  zone: string;
  /** data-drop-id value. */
  id: string;
  clientX: number;
  clientY: number;
}

export interface DragHandlers {
  /** Can `payload` drop on `target`, and where? Return undefined for "not a target". */
  check(payload: DragPayload, target: DropTargetInfo): DropCheck | undefined;
  drop(payload: DragPayload, target: DropTargetInfo, check: DropCheck): void;
  /** Dropped on a target that refused it (e.g. a play onto another set). */
  refused?(payload: DragPayload, check: DropCheck): void;
  /** Called when the drag ends (dropped or cancelled). */
  end?(): void;
}

interface DragState {
  payload: DragPayload;
  x: number;
  y: number;
  target?: { info: DropTargetInfo; check: DropCheck };
}

let current: DragState | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function useDragState(): DragState | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

export function isDragging(): boolean {
  return current !== null;
}

const THRESHOLD = 5;
const EDGE = 44;
const MAX_SPEED = 18;

/** Default before/after split by pointer position inside the target element. */
export function halfOf(target: DropTargetInfo, axis: "h" | "v" = "h"): "before" | "after" {
  const r = target.el.getBoundingClientRect();
  return axis === "h" ? (target.clientY < r.top + r.height / 2 ? "before" : "after") : target.clientX < r.left + r.width / 2 ? "before" : "after";
}

function findTarget(x: number, y: number): DropTargetInfo | undefined {
  const hit = document.elementFromPoint(x, y);
  const el = hit instanceof Element ? (hit.closest("[data-drop]") as HTMLElement | null) : null;
  if (!el) return undefined;
  return { el, zone: el.dataset.drop ?? "", id: el.dataset.dropId ?? "", clientX: x, clientY: y };
}

function scrollerAt(x: number, y: number): HTMLElement | undefined {
  const hit = document.elementFromPoint(x, y);
  return (hit instanceof Element ? (hit.closest("[data-autoscroll]") as HTMLElement | null) : null) ?? undefined;
}

/**
 * Call from onPointerDown. The drag activates once the pointer moves THRESHOLD px; a plain click is untouched.
 * `payload` is computed lazily at activation (selection may change on pointerdown).
 */
export function beginDrag(e: ReactPointerEvent, payload: () => DragPayload | undefined, handlers: DragHandlers): void {
  if (e.button !== 0 || current) return;
  const startX = e.clientX;
  const startY = e.clientY;
  const pointerId = e.pointerId;
  let active = false;
  let raf = 0;
  let lastX = startX;
  let lastY = startY;

  const update = (x: number, y: number) => {
    if (!current) return;
    const info = findTarget(x, y);
    const check = info ? handlers.check(current.payload, info) : undefined;
    current = { ...current, x, y, target: info && check ? { info, check } : undefined };
    emit();
  };

  const tick = () => {
    raf = 0;
    if (!current) return;
    const sc = scrollerAt(lastX, lastY);
    if (sc) {
      const r = sc.getBoundingClientRect();
      let dy = 0;
      if (lastY < r.top + EDGE) dy = -Math.ceil(((r.top + EDGE - lastY) / EDGE) * MAX_SPEED);
      else if (lastY > r.bottom - EDGE) dy = Math.ceil(((lastY - (r.bottom - EDGE)) / EDGE) * MAX_SPEED);
      if (dy) {
        const before = sc.scrollTop;
        sc.scrollTop += dy;
        if (sc.scrollTop !== before) update(lastX, lastY);
      }
    }
    raf = requestAnimationFrame(tick);
  };

  const finish = (dropIt: boolean) => {
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("pointercancel", cancel, true);
    window.removeEventListener("keydown", key, true);
    if (raf) cancelAnimationFrame(raf);
    if (!active) return;
    document.body.classList.remove(s.bodyDragging);
    const st = current;
    current = null;
    emit();
    // The click that follows a drag must not select whatever is under the pointer.
    const swallow = (ev: MouseEvent) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    if (dropIt && st?.target?.check.ok) handlers.drop(st.payload, st.target.info, st.target.check);
    else if (dropIt && st?.target) handlers.refused?.(st.payload, st.target.check);
    handlers.end?.();
  };

  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    lastX = ev.clientX;
    lastY = ev.clientY;
    if (!active) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < THRESHOLD) return;
      const p = payload();
      if (!p) {
        finish(false);
        return;
      }
      active = true;
      current = { payload: p, x: ev.clientX, y: ev.clientY };
      document.body.classList.add(s.bodyDragging);
      window.getSelection()?.removeAllRanges();
      raf = requestAnimationFrame(tick);
    }
    ev.preventDefault();
    update(ev.clientX, ev.clientY);
  };
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    finish(true);
  };
  const cancel = () => finish(false);
  const key = (ev: KeyboardEvent) => {
    if (ev.key === "Escape" && active) {
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    }
  };
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", up, true);
  window.addEventListener("pointercancel", cancel, true);
  window.addEventListener("keydown", key, true);
}

/** Ghost + drop indicator. Mount once (the builder does). */
export function DragLayer() {
  const st = useDragState();
  if (!st) return null;
  const t = st.target;
  let indicator: { left: number; top: number; width: number; height: number; into: boolean } | undefined;
  if (t?.check.ok) {
    const r = t.info.el.getBoundingClientRect();
    if (t.check.place === "into") indicator = { left: r.left, top: r.top, width: r.width, height: r.height, into: true };
    else if (t.check.axis === "v") {
      const x = t.check.place === "before" ? r.left - 5 : r.right + 3;
      indicator = { left: x, top: r.top, width: 2, height: r.height, into: false };
    } else {
      const y = t.check.place === "before" ? r.top - 1 : r.bottom - 1;
      indicator = { left: r.left, top: y, width: r.width, height: 2, into: false };
    }
  }
  const refused = t && !t.check.ok;
  return createPortal(
    <>
      {indicator && (
        <div
          className={indicator.into ? s.into : s.line}
          style={{ left: indicator.left, top: indicator.top, width: indicator.width, height: indicator.height }}
        />
      )}
      <div className={s.ghost} data-refused={refused || undefined} style={{ left: st.x + 14, top: st.y + 12 }}>
        <span className={s.count}>{st.payload.count}</span>
        <span className={cx(s.label, st.payload.count === 1 && "caps")}>{st.payload.label}</span>
        {refused && (
          <span className={s.reason}>
            <Icon name="close" size={12} /> {t.check.reason ?? "Can't drop here"}
          </span>
        )}
      </div>
    </>,
    document.body,
  );
}
