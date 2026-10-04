// Madden-style tab row: TAB  TAB  TAB with the active tab as a light-gray pill. Mouse first; with keyboard focus on a
// tab, ←/→ (and Home/End) move to the neighbouring tab, like any web tab list.
import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { cx } from "./cx";
import { renderIcon, type IconName } from "./Icon";
import s from "./TabBar.module.css";

export interface TabItem<T extends string = string> {
  id: T;
  label: ReactNode;
  icon?: IconName | ReactNode;
  /** Small count/dot after the label. */
  badge?: ReactNode;
  disabled?: boolean;
  title?: string;
}

export interface TabBarProps<T extends string = string> {
  items: TabItem<T>[];
  /** Active tab id; undefined = none highlighted. */
  active?: T;
  onChange(id: T): void;
  /** "lg" = main nav (Madden top row), "sm" = view sub-tabs. */
  size?: "lg" | "sm";
  className?: string;
  "aria-label"?: string;
}

const noFocus = (e: MouseEvent) => e.preventDefault();

export function TabBar<T extends string = string>({ items, active, onChange, size = "lg", className, ...rest }: TabBarProps<T>) {
  // Keep the active tab visible when the row is squeezed and scrolls.
  const tabsEl = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = tabsEl.current;
    const el = box?.querySelector<HTMLElement>("[aria-selected='true']");
    if (!box || !el) return;
    // Horizontal only: scrollIntoView would also scroll the page.
    const b = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.left < b.left) box.scrollLeft -= b.left - r.left + 8;
    else if (r.right > b.right) box.scrollLeft += r.right - b.right + 8;
  }, [active]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const enabled = items.filter((t) => !t.disabled);
    if (!enabled.length) return;
    const focusedId = (document.activeElement as HTMLElement | null)?.dataset?.tabId;
    const i = enabled.findIndex((t) => t.id === (focusedId ?? active));
    let next: number;
    if (e.key === "ArrowRight") next = i < 0 ? 0 : (i + 1) % enabled.length;
    else if (e.key === "ArrowLeft") next = i < 0 ? enabled.length - 1 : (i - 1 + enabled.length) % enabled.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = enabled.length - 1;
    else return;
    e.preventDefault();
    const id = enabled[next].id;
    onChange(id);
    tabsEl.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`)?.focus();
  };

  return (
    <div className={cx(s.bar, s[size], className)} role="tablist" aria-label={rest["aria-label"]} onKeyDown={onKeyDown}>
      <div className={s.tabs} ref={tabsEl}>
        {items.map((t) => {
          const on = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              data-tab-id={t.id}
              aria-selected={on}
              // One tab stop for the row (the active tab, else the first): arrows move inside it.
              tabIndex={on || (active === undefined && t === items[0]) ? 0 : -1}
              disabled={t.disabled}
              title={t.title}
              className={cx(s.tab, on && s.active)}
              onMouseDown={noFocus}
              onClick={() => onChange(t.id)}
            >
              {renderIcon(t.icon, size === "lg" ? 18 : 15)}
              <span className={s.label}>{t.label}</span>
              {t.badge !== undefined && t.badge !== null && <span className={s.badge}>{t.badge}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
