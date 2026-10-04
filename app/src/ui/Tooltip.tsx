// Hover/focus tooltip in a portal. `useTooltip` attaches to any element; <Tooltip> wraps children in a span.
import { useEffect, useRef, useState, type FocusEvent, type ReactNode } from "react";
import type { PadButton } from "../model/audibles";
import { KeyCap } from "../input/glyphs";
import { isUniversalCombo } from "../input/registry";
import { cx } from "./cx";
import { Floating } from "./Floating";
import type { Placement } from "./position";
import s from "./Tooltip.module.css";

export interface TooltipOptions {
  content: ReactNode;
  placement?: Placement;
  /** Hover delay in ms (keyboard focus shows immediately). */
  delay?: number;
  disabled?: boolean;
  /** Keyboard shortcut shown after the text as a keycap (first universal key; `button`/`hold` are v1 leftovers, ignored). */
  shortcut?: { button?: PadButton; hold?: PadButton; keys?: string[] };
}

export function useTooltip({ content, placement = "top", delay = 450, disabled, shortcut }: TooltipOptions) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const clear = () => window.clearTimeout(timer.current);
  useEffect(() => clear, []);
  useEffect(() => {
    if (disabled) setAnchor(null);
  }, [disabled]);

  const hide = () => {
    clear();
    setAnchor(null);
  };
  const handlers = {
    onPointerEnter: (e: { currentTarget: HTMLElement; pointerType?: string }) => {
      if (disabled || !content || e.pointerType === "touch") return;
      const el = e.currentTarget;
      clear();
      timer.current = window.setTimeout(() => setAnchor(el), delay);
    },
    onPointerLeave: hide,
    onPointerDown: hide,
    onFocus: (e: FocusEvent<HTMLElement>) => {
      if (!disabled && content && e.currentTarget.matches(":focus-visible")) setAnchor(e.currentTarget);
    },
    onBlur: hide,
  };

  const key = shortcut?.keys?.find(isUniversalCombo);
  const node =
    anchor && content && !disabled ? (
      <Floating anchor={anchor} placement={placement} zIndex={1100} className={s.tip} role="tooltip">
        <span>{content}</span>
        {key ? <KeyCap combo={key} size="sm" /> : null}
      </Floating>
    ) : null;

  return { handlers, node, hide };
}

export interface TooltipProps extends TooltipOptions {
  children: ReactNode;
  className?: string;
}

/** Wraps children in an inline-flex span that shows `content` on hover/focus. */
export function Tooltip({ children, className, ...opts }: TooltipProps) {
  const t = useTooltip(opts);
  return (
    <span className={cx(s.anchor, className)} {...t.handlers}>
      {children}
      {t.node}
    </span>
  );
}
