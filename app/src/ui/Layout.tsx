// Layout pieces: Panel, Toolbar, Spacer, Divider, ScrollShadow, Kbd.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref, type UIEvent } from "react";
import { KeyCap } from "../input/glyphs";
import { cx } from "./cx";
import s from "./Layout.module.css";

export interface PanelProps {
  title?: ReactNode;
  /** Small gray line above the title (Title Case). */
  eyebrow?: ReactNode;
  /** Right side of the header (buttons). */
  actions?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** Body scrolls (default true). */
  scroll?: boolean;
  /** Body padding (default true). */
  padded?: boolean;
  /** Visual weight: "default" = --bg-1 panel, "raised" = --bg-2 card, "flat" = no background. */
  tone?: "default" | "raised" | "flat";
  className?: string;
  bodyClassName?: string;
  style?: CSSProperties;
}

export function Panel({ title, eyebrow, actions, children, footer, scroll = true, padded = true, tone = "default", className, bodyClassName, style }: PanelProps) {
  const hasHeader = title !== undefined || eyebrow !== undefined || actions !== undefined;
  return (
    <section className={cx(s.panel, s[tone], className)} style={style}>
      {hasHeader && (
        <header className={s.head}>
          <div className={s.titles}>
            {eyebrow && <div className={s.eyebrow}>{eyebrow}</div>}
            {title && <h2 className={s.title}>{title}</h2>}
          </div>
          {actions && <div className={s.actions}>{actions}</div>}
        </header>
      )}
      <div className={cx(s.body, scroll && s.scroll, padded && s.padded, bodyClassName)}>{children}</div>
      {footer && <footer className={s.foot}>{footer}</footer>}
    </section>
  );
}

export function Toolbar({ children, className, dense, wrap }: { children: ReactNode; className?: string; dense?: boolean; wrap?: boolean }) {
  return <div className={cx(s.toolbar, dense && s.dense, wrap && s.wrap, className)}>{children}</div>;
}

/** Flexible gap that pushes following toolbar items to the right. */
export function Spacer() {
  return <div className={s.spacer} />;
}

export function Divider({ vertical, label, className }: { vertical?: boolean; label?: ReactNode; className?: string }) {
  if (vertical) return <div className={cx(s.vdivider, className)} role="separator" aria-orientation="vertical" />;
  if (label) {
    return (
      <div className={cx(s.labelDivider, className)} role="separator">
        <span>{label}</span>
      </div>
    );
  }
  return <hr className={cx(s.divider, className)} />;
}

/** Keyboard keycaps for one or more combos ("mod+s" → ⌘S). */
export function Kbd({ keys, size = "sm", className }: { keys: string | string[]; size?: "sm" | "md" | "lg"; className?: string }) {
  const list = Array.isArray(keys) ? keys : [keys];
  return (
    <span className={cx(s.kbd, className)}>
      {list.map((k) => (
        <KeyCap key={k} combo={k} size={size} />
      ))}
    </span>
  );
}

export interface ScrollShadowProps {
  children: ReactNode;
  className?: string;
  /** Class for the inner scroller. */
  innerClassName?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLDivElement>;
  onScroll?: (e: UIEvent<HTMLDivElement>) => void;
}

/** Vertical scroller with fade shadows at the edges that still have content. */
export function ScrollShadow({ children, className, innerClassName, style, ref, onScroll }: ScrollShadowProps) {
  const inner = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });

  const measure = useCallback(() => {
    const el = inner.current;
    if (!el) return;
    const top = el.scrollTop > 1;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    setEdges((e) => (e.top === top && e.bottom === bottom ? e : { top, bottom }));
  }, []);

  useEffect(() => {
    const el = inner.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [measure]);

  const setRef = (node: HTMLDivElement | null) => {
    inner.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) (ref as { current: HTMLDivElement | null }).current = node;
  };

  return (
    <div className={cx(s.shadowWrap, className)} style={style}>
      <div
        ref={setRef}
        className={cx(s.shadowInner, innerClassName)}
        onScroll={(e) => {
          measure();
          onScroll?.(e);
        }}
      >
        {children}
      </div>
      <div className={cx(s.shade, s.shadeTop, edges.top && s.shadeOn)} aria-hidden />
      <div className={cx(s.shade, s.shadeBottom, edges.bottom && s.shadeOn)} aria-hidden />
    </div>
  );
}
