// Two resizable panes. The sized pane keeps a pixel size (persisted under `storageKey`); the other flexes.
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cx } from "./cx";
import s from "./SplitPane.module.css";

export interface SplitPaneProps {
  /** [first, second] */
  children: [ReactNode, ReactNode];
  /** "horizontal" = side by side (vertical divider), "vertical" = stacked. */
  direction?: "horizontal" | "vertical";
  /** Initial px size of the sized pane. */
  initial: number;
  min?: number;
  max?: number;
  /** Which pane has the fixed size (default "start"). */
  sized?: "start" | "end";
  /** localStorage key to persist the size, e.g. "pbstudio.split.library". */
  storageKey?: string;
  className?: string;
  style?: CSSProperties;
  /** Class for each pane wrapper. */
  paneClassName?: string;
}

function readSize(key: string | undefined, fallback: number): number {
  if (!key) return fallback;
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

export function SplitPane({ children, direction = "horizontal", initial, min = 160, max = 1200, sized = "start", storageKey, className, style, paneClassName }: SplitPaneProps) {
  const [size, setSize] = useState(() => readSize(storageKey, initial));
  const [dragging, setDragging] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const horizontal = direction === "horizontal";

  useEffect(() => {
    if (!storageKey) return;
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(storageKey, String(Math.round(size)));
      } catch {
        /* storage full or blocked: size just isn't remembered */
      }
    }, 150);
    return () => window.clearTimeout(t);
  }, [size, storageKey]);

  const clampSize = (v: number) => {
    const total = root.current ? (horizontal ? root.current.clientWidth : root.current.clientHeight) : Infinity;
    // Leave the flexible pane at least `min` too.
    return Math.max(min, Math.min(max, total - min, v));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const start = horizontal ? e.clientX : e.clientY;
    const startSize = size;
    setDragging(true);
    const move = (ev: globalThis.PointerEvent) => {
      const d = (horizontal ? ev.clientX : ev.clientY) - start;
      setSize(clampSize(startSize + (sized === "start" ? d : -d)));
    };
    const up = () => {
      setDragging(false);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const grow = horizontal ? (sized === "start" ? "ArrowRight" : "ArrowLeft") : sized === "start" ? "ArrowDown" : "ArrowUp";
    const shrink = horizontal ? (sized === "start" ? "ArrowLeft" : "ArrowRight") : sized === "start" ? "ArrowUp" : "ArrowDown";
    const delta = e.shiftKey ? 64 : 16;
    if (e.key === grow) setSize((v) => clampSize(v + delta));
    else if (e.key === shrink) setSize((v) => clampSize(v - delta));
    else return;
    e.preventDefault();
  };

  const fixed: CSSProperties = horizontal ? { width: size } : { height: size };
  const [a, b] = children;
  return (
    <div ref={root} className={cx(s.split, horizontal ? s.horizontal : s.vertical, dragging && s.dragging, className)} style={style}>
      <div className={cx(s.pane, sized === "start" ? s.fixed : s.flex, paneClassName)} style={sized === "start" ? fixed : undefined}>
        {a}
      </div>
      <div
        className={s.handle}
        role="separator"
        aria-orientation={horizontal ? "vertical" : "horizontal"}
        aria-valuenow={Math.round(size)}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onDoubleClick={() => setSize(clampSize(initial))}
        onKeyDown={onKeyDown}
        title="Drag to resize · double-click to reset"
      />
      <div className={cx(s.pane, sized === "end" ? s.fixed : s.flex, paneClassName)} style={sized === "end" ? fixed : undefined}>
        {b}
      </div>
    </div>
  );
}
