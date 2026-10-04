// Menus: anchored or at a point (context menu), mouse first and keyboard navigable while open (↑/↓ move, → opens a
// submenu, ← closes it, Enter chooses, Esc closes; a modal keyboard scope keeps view keys quiet meanwhile). Items
// with icon, keyboard shortcut hint, disabled, danger, checked, and optional submenus.
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useActions } from "../input/actions";
import { KeyCap } from "../input/glyphs";
import { isUniversalCombo } from "../input/registry";
import { Button, type ButtonProps } from "./Button";
import { cx } from "./cx";
import { Floating, type Anchor } from "./Floating";
import { Icon, renderIcon, type IconName } from "./Icon";
import type { Placement } from "./position";
import s from "./Menu.module.css";

export interface MenuAction {
  kind?: "item";
  id?: string;
  label: ReactNode;
  icon?: IconName | ReactNode;
  /** Keyboard combo shown at the right, e.g. "mod+c" (display only; single-letter keys aren't shown). */
  shortcut?: string;
  hint?: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  /** Shows a check mark (toggle items). */
  checked?: boolean;
  onSelect?(): void;
  submenu?: MenuItem[];
}
export type MenuItem = MenuAction | { kind: "separator" } | { kind: "heading"; label: ReactNode };

const isAction = (m: MenuItem): m is MenuAction => m.kind === undefined || m.kind === "item";
const selectable = (m: MenuItem): m is MenuAction => isAction(m) && !m.disabled;

export interface MenuProps {
  items: MenuItem[];
  anchor: Anchor;
  placement?: Placement;
  onClose(): void;
  minWidth?: number;
  /** Nested submenus: ← / Esc closes only this level. */
  nested?: boolean;
  scopeId?: string;
  /** Called instead of `onClose` after an item is chosen (internal: a submenu choice closes the whole menu chain). */
  onChoose?(): void;
  /** Id of the item the cursor starts on (pickers: the current choice); default the first selectable item. */
  initialId?: string;
}

export function Menu({ items, anchor, placement = "bottom-start", onClose, minWidth = 200, nested, scopeId = "menu", onChoose, initialId }: MenuProps) {
  const [active, setActive] = useState(() => {
    const initial = initialId === undefined ? -1 : items.findIndex((m) => selectable(m) && m.id === initialId);
    return initial >= 0 ? initial : items.findIndex(selectable);
  });
  const [sub, setSub] = useState<{ index: number; el: HTMLElement } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const itemEls = useRef<(HTMLElement | null)[]>([]);
  // A menu that opens under a parked mouse pointer (keyboard user) gets pointerenter without any movement;
  // hover only takes over once the pointer really moves after the menu mounted.
  const pointerLive = useRef(false);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    root.current?.focus({ preventScroll: true });
    return () => {
      if (!nested && prev && document.contains(prev)) prev.focus({ preventScroll: true });
    };
  }, [nested]);

  const move = (dir: 1 | -1) => {
    if (!items.some(selectable)) return;
    let i = active;
    for (let n = 0; n < items.length; n++) {
      i = (i + dir + items.length) % items.length;
      if (selectable(items[i])) break;
    }
    setActive(i);
    setSub(null);
  };

  const openSub = (i: number) => {
    const it = items[i];
    const el = itemEls.current[i];
    if (it && selectable(it) && it.submenu?.length && el) setSub({ index: i, el });
  };

  const choose = (i: number) => {
    const it = items[i];
    if (!it || !selectable(it)) return;
    if (it.submenu?.length) return openSub(i);
    if (onChoose) onChoose();
    else onClose();
    it.onSelect?.();
  };

  useActions(
    scopeId,
    [
      { id: "up", label: "Move", keys: ["ArrowUp"], repeat: true, run: () => move(-1) },
      { id: "down", label: "Move", keys: ["ArrowDown"], repeat: true, run: () => move(1) },
      { id: "open-sub", label: "Open", keys: ["ArrowRight"], run: () => openSub(active) },
      ...(nested ? [{ id: "close-sub", label: "Back", keys: ["ArrowLeft"], run: onClose }] : []),
      { id: "choose", label: "Select", keys: ["Enter"], enabled: active >= 0, run: () => choose(active) },
      { id: "close", label: nested ? "Back" : "Close", keys: ["Escape"], allowInInput: true, run: onClose },
    ],
    { modal: true },
  );

  return (
    <Floating
      anchor={anchor}
      placement={placement}
      gap={nested ? 2 : 4}
      onDismiss={nested ? undefined : onClose}
      dismissIgnore={`.${s.menu}`}
      zIndex={1000}
      className={s.menu}
      style={{ minWidth }}
      role="menu"
    >
      <div ref={root} tabIndex={-1} className={s.inner} onContextMenu={(e) => e.preventDefault()}>
        {items.map((it, i) => {
          if (it.kind === "separator") return <div key={i} className={s.separator} role="separator" />;
          if (it.kind === "heading") return <div key={i} className={s.heading}>{it.label}</div>;
          const hasSub = !!it.submenu?.length;
          return (
            <div
              key={it.id ?? i}
              ref={(el) => {
                itemEls.current[i] = el;
              }}
              role="menuitem"
              aria-disabled={it.disabled || undefined}
              aria-haspopup={hasSub || undefined}
              className={cx(s.item, i === active && s.active, it.disabled && s.disabled, it.danger && s.danger)}
              onPointerMove={(e) => {
                if (!pointerLive.current) {
                  if (e.movementX === 0 && e.movementY === 0) return;
                  pointerLive.current = true;
                }
                if (it.disabled || (i === active && (!hasSub || sub?.index === i))) return;
                setActive(i);
                if (hasSub) openSub(i);
                else if (sub) setSub(null);
              }}
              onClick={() => choose(i)}
            >
              <span className={s.icon}>{it.checked ? <Icon name="check" size={14} /> : renderIcon(it.icon, 15)}</span>
              <span className={s.label}>{it.label}</span>
              {it.hint && <span className={s.hint}>{it.hint}</span>}
              {it.shortcut && isUniversalCombo(it.shortcut) && (
                <span className={s.shortcut}>
                  <KeyCap combo={it.shortcut} size="sm" />
                </span>
              )}
              {hasSub && <Icon name="chevronRight" size={13} className={s.chevron} />}
            </div>
          );
        })}
      </div>
      {sub && (items[sub.index] as MenuAction).submenu && (
        <Menu
          items={(items[sub.index] as MenuAction).submenu!}
          anchor={sub.el}
          placement="right-start"
          nested
          minWidth={minWidth}
          scopeId={`${scopeId}.sub`}
          onClose={() => {
            setSub(null);
            root.current?.focus({ preventScroll: true });
          }}
          onChoose={() => {
            setSub(null);
            if (onChoose) onChoose();
            else onClose();
          }}
        />
      )}
    </Floating>
  );
}

/** Right-click menus: `onContextMenu={(e) => cm.open(e, items)}` and render `cm.node`. */
export function useContextMenu() {
  const [state, setState] = useState<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null);
  const close = () => setState(null);
  const open = (e: ReactMouseEvent | MouseEvent | { x: number; y: number }, items: MenuItem[]) => {
    if ("preventDefault" in e) {
      e.preventDefault();
      setState({ at: { x: e.clientX, y: e.clientY }, items });
    } else setState({ at: e, items });
  };
  const node = state ? <Menu items={state.items} anchor={state.at} placement="bottom-start" onClose={close} /> : null;
  return { open, close, node, isOpen: !!state };
}

export interface MenuButtonProps extends Omit<ButtonProps, "onClick"> {
  items: MenuItem[] | (() => MenuItem[]);
  placement?: Placement;
  menuMinWidth?: number;
  /** Item id the menu's cursor starts on (e.g. the current choice). */
  menuInitialId?: string;
}

/** A Button that opens a menu below itself. */
export function MenuButton({ items, placement = "bottom-start", menuMinWidth, menuInitialId, iconRight = "chevronDown", ...rest }: MenuButtonProps) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<MenuItem[] | null>(null);
  return (
    <>
      <Button
        {...rest}
        ref={btn}
        iconRight={iconRight}
        active={open ? true : rest.active}
        aria-haspopup="menu"
        aria-expanded={!!open}
        onClick={() => setOpen(open ? null : typeof items === "function" ? items() : items)}
      />
      {open && btn.current && (
        <Menu items={open} anchor={btn.current} placement={placement} minWidth={menuMinWidth} initialId={menuInitialId} onClose={() => setOpen(null)} />
      )}
    </>
  );
}
