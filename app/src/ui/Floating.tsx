// Portal + anchored positioning shared by Tooltip, Menu and SearchSelect.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { placeFloating, type Placed, type Placement, type RectLike } from "./position";

/** An element, a rect, or a point (context menus). */
export type Anchor = HTMLElement | RectLike | { x: number; y: number };

export function anchorRect(a: Anchor): RectLike {
  if (typeof HTMLElement !== "undefined" && a instanceof HTMLElement) return a.getBoundingClientRect();
  if ("x" in a && !("width" in a)) return { left: a.x, top: a.y, width: 0, height: 0 };
  return a as RectLike;
}

export interface FloatingProps {
  anchor: Anchor;
  placement?: Placement;
  gap?: number;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Pointer-down outside the floating element (and outside an element anchor) calls this. */
  onDismiss?: () => void;
  /** Selector for other elements that don't count as "outside" (e.g. a menu's own submenus). */
  dismissIgnore?: string;
  /** Make the floating element at least as wide as the anchor (dropdowns). */
  matchWidth?: boolean;
  zIndex?: number;
  ref?: Ref<HTMLDivElement>;
  role?: string;
  id?: string;
  /** Receives the computed placement (e.g. to cap max-height with `room`). */
  onPlaced?: (p: Placed) => void;
}

export function Floating({ anchor, placement = "bottom", gap = 6, children, className, style, onDismiss, dismissIgnore, matchWidth, zIndex = 1000, ref, role, id, onPlaced }: FloatingProps) {
  const el = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<Placed | null>(null);
  const [minWidth, setMinWidth] = useState<number | undefined>(undefined);
  const onPlacedRef = useRef(onPlaced);
  onPlacedRef.current = onPlaced;

  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    const update = () => {
      const r = anchorRect(anchor);
      if (matchWidth) setMinWidth(r.width);
      const size = { width: node.offsetWidth, height: node.offsetHeight };
      const p = placeFloating(r, size, placement, { width: window.innerWidth, height: window.innerHeight }, gap);
      setPos((old) => (old && old.left === p.left && old.top === p.top && old.side === p.side ? old : p));
      onPlacedRef.current?.(p);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(node);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchor, placement, gap, matchWidth]);

  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    if (!onDismiss) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t || el.current?.contains(t)) return;
      if (typeof HTMLElement !== "undefined" && anchor instanceof HTMLElement && anchor.contains(t)) return;
      if (dismissIgnore && t instanceof Element && t.closest(dismissIgnore)) return;
      dismiss.current?.();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [anchor, !!onDismiss, dismissIgnore]);

  const setRef = (node: HTMLDivElement | null) => {
    el.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) (ref as { current: HTMLDivElement | null }).current = node;
  };

  return createPortal(
    <div
      ref={setRef}
      role={role}
      id={id}
      className={className}
      data-side={pos?.side}
      style={{
        position: "fixed",
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        minWidth,
        zIndex,
        // Not visibility:hidden — that would make autoFocus inside fail on the first (unpositioned) commit.
        opacity: pos ? undefined : 0,
        pointerEvents: pos ? undefined : "none",
        ...style,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
