// Filterable dropdown for long lists (enums, assignments). The list is virtualized; while open it registers a modal
// keyboard scope so view keys stay quiet. Click an option, or type to filter and use ↑/↓ + Enter (Esc closes).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ActionLayer, useActions } from "../input/actions";
import { cx } from "./cx";
import { Floating } from "./Floating";
import { Icon } from "./Icon";
import { TextInput } from "./Form";
import { VirtualList } from "./VirtualList";
import { filterOptions, normalizeOptions, optionLabel, type OptionInput, type SearchOption } from "./options";
import { moveIndex, navKeyFor, type NavKey } from "./virtual";
import s from "./SearchSelect.module.css";

export type { SearchOption };

export interface SearchSelectProps {
  value: string | undefined;
  onChange(value: string): void;
  options: readonly OptionInput[];
  /** Trigger text when nothing is selected. */
  placeholder?: string;
  searchPlaceholder?: string;
  size?: "sm" | "md";
  disabled?: boolean;
  invalid?: boolean;
  width?: number | string;
  /** Offer the typed text as a value even when it isn't in the list. */
  allowCustom?: boolean;
  renderOption?(o: SearchOption, state: { selected: boolean; active: boolean }): ReactNode;
  /** Trigger content for the current value. */
  renderValue?(o: SearchOption | undefined, value: string | undefined): ReactNode;
  emptyText?: string;
  rowHeight?: number;
  /** Visible rows before scrolling. */
  maxRows?: number;
  /** Minimum popover width (default 280). */
  menuWidth?: number;
  /**
   * "field" (default): a form input with body type. "chrome": the trigger sits in headers/toolbars/trees and shows its
   * value (and placeholder) in the display type like the rest of the chrome. Text shows as written.
   */
  variant?: "field" | "chrome";
  /** Madden names (formations, sets, plays, play types) in ALL CAPS: true = the selected value and the menu's options
   *  (the placeholder stays as written), "options" = only the menu's options (for add-pickers whose trigger is chrome).
   *  Works with either variant. */
  caps?: boolean | "options";
  title?: string;
  className?: string;
  "aria-label"?: string;
}

export function SearchSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  size = "md",
  disabled,
  invalid,
  width,
  allowCustom,
  renderOption,
  renderValue,
  emptyText = "No matches",
  rowHeight = 30,
  maxRows = 10,
  menuWidth = 280,
  variant = "field",
  caps,
  title,
  className,
  ...aria
}: SearchSelectProps) {
  const opts = useMemo(() => normalizeOptions(options), [options]);
  const byValue = useMemo(() => new Map(opts.map((o) => [o.value, o])), [opts]);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  const current = value === undefined ? undefined : byValue.get(value);
  const shown = renderValue ? renderValue(current, value) : current ? optionLabel(current) : value;
  const empty = shown === undefined || shown === "";

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={cx(s.trigger, s[size], variant === "chrome" && s.chrome, caps === true && s.caps, invalid && s.invalid, open && s.open, className)}
        style={{ width }}
        disabled={disabled}
        title={title ?? (current ? optionLabel(current) : value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={aria["aria-label"]}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => {
          if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className={cx(s.value, empty && s.placeholder)}>{empty ? placeholder : shown}</span>
        <Icon name="chevronDown" size={14} className={s.chevron} />
      </button>
      {open && trigger.current && (
        <SearchPopover
          anchor={trigger.current}
          opts={opts}
          byValue={byValue}
          value={value}
          onChoose={(v) => {
            onChange(v);
            close();
          }}
          onClose={close}
          allowCustom={allowCustom}
          renderOption={renderOption}
          searchPlaceholder={searchPlaceholder}
          emptyText={emptyText}
          rowHeight={rowHeight}
          maxRows={maxRows}
          menuWidth={menuWidth}
          caps={!!caps}
        />
      )}
    </>
  );
}

interface PopoverProps {
  anchor: HTMLElement;
  opts: SearchOption[];
  byValue: Map<string, SearchOption>;
  value: string | undefined;
  onChoose(value: string): void;
  onClose(refocus?: boolean): void;
  allowCustom?: boolean;
  renderOption?: SearchSelectProps["renderOption"];
  searchPlaceholder: string;
  emptyText: string;
  rowHeight: number;
  maxRows: number;
  menuWidth: number;
  /** Option labels in caps (Madden names), like the trigger. */
  caps?: boolean;
}

/** Mounted fresh on every open so its modal action scope sits on top of everything registered before. */
function SearchPopover({ anchor, opts, byValue, value, onChoose, onClose, allowCustom, renderOption, searchPlaceholder, emptyText, rowHeight, maxRows, menuWidth, caps }: PopoverProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(() => Math.max(0, value === undefined ? -1 : opts.findIndex((o) => o.value === value)));
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => search.current?.focus(), []);

  const filtered = useMemo(() => filterOptions(opts, query), [opts, query]);
  const q = query.trim();
  const custom = allowCustom && q && !byValue.has(q) ? { value: q, label: `Use “${q}”` } : undefined;
  const rows: SearchOption[] = custom ? [custom, ...filtered] : filtered;

  const choose = (i: number) => {
    const o = rows[i];
    if (o && !o.disabled) onChoose(o.value);
  };
  const move = (k: NavKey) => setActive((a) => Math.max(0, moveIndex(a, k, rows.length, 1, maxRows - 1)));

  // The filter input handles its own keys (and preventDefaults them); this scope only blocks the view's keys and
  // closes on Esc when focus wandered off the input.
  const token = useActions("searchselect", [{ id: "close", label: "Close", keys: ["Escape"], allowInInput: true, run: () => onClose() }], { modal: true });

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const k = navKeyFor(e.key);
    if (k === "up" || k === "down" || k === "pageUp" || k === "pageDown") {
      e.preventDefault();
      move(k);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Tab") {
      onClose(false);
    }
  };

  return (
    <Floating anchor={anchor} placement="bottom-start" matchWidth role="listbox" onDismiss={() => onClose(false)} className={s.menu} style={{ width: "max-content", maxWidth: 520 }}>
      <ActionLayer token={token}>
        <div style={{ minWidth: menuWidth }}>
          <div className={s.search}>
            <TextInput
              ref={search}
              value={query}
              onChange={(v) => {
                setQuery(v);
                setActive(0);
              }}
              icon="search"
              size="sm"
              placeholder={searchPlaceholder}
              onKeyDown={onKeyDown}
              aria-label="Filter"
            />
            <span className={s.count}>{filtered.length.toLocaleString()}</span>
          </div>
          {rows.length ? (
            <VirtualList
              count={rows.length}
              rowHeight={rowHeight}
              selectedIndex={active}
              onSelect={choose}
              className={s.list}
              style={{ height: Math.min(maxRows, rows.length) * rowHeight }}
              getKey={(i) => rows[i].value + (i === 0 && custom ? "\u0000custom" : "")}
              renderRow={(i, st) => {
                const o = rows[i];
                const selected = o.value === value && o !== custom;
                if (renderOption) return renderOption(o, { selected, active: st.selected });
                return (
                  <div className={cx(s.option, o.disabled && s.disabled, o === custom && s.custom)} onPointerMove={() => i !== active && setActive(i)}>
                    <span className={s.check}>{selected && <Icon name="check" size={13} />}</span>
                    <span className={cx(s.optLabel, caps && o !== custom && !o.chrome && s.capsOpt)}>{optionLabel(o)}</span>
                    {(o.hint || o.group) && <span className={s.hint}>{o.hint ?? o.group}</span>}
                  </div>
                );
              }}
            />
          ) : (
            <div className={s.empty}>{emptyText}</div>
          )}
        </div>
      </ActionLayer>
    </Floating>
  );
}
