// Windowed list and grid with fixed item sizes. Click selects, double-click activates; while the list itself has
// keyboard focus, arrows / Page Up / Page Down / Home / End move the selection and Enter activates.
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type Key,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { cx } from "./cx";
import { gridColumns, moveIndex, navKeyFor, scrollForItem, visibleRange, type NavKey, type ScrollAlign } from "./virtual";
import s from "./Virtual.module.css";

export interface VirtualHandle {
  scrollToIndex(index: number, align?: ScrollAlign): void;
  focus(): void;
  element: HTMLDivElement | null;
}

interface CommonProps {
  count: number;
  overscan?: number;
  selectedIndex?: number;
  onSelect?(index: number): void;
  onActivate?(index: number): void;
  getKey?(index: number): Key;
  /** Rendered instead of the list when count is 0. */
  empty?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Extra space after the last item (px). */
  padEnd?: number;
  "aria-label"?: string;
  ref?: Ref<VirtualHandle>;
}

/** Measures the viewport. `variant` changes when a different element may be mounted (the empty placeholder vs the
 *  list), so the observer re-attaches — otherwise a list that first rendered `empty` never learns its size. */
function useViewport(el: RefObject<HTMLDivElement | null>, variant: unknown) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    const update = () => setSize((o) => (o.width === node.clientWidth && o.height === node.clientHeight ? o : { width: node.clientWidth, height: node.clientHeight }));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(node);
    return () => ro.disconnect();
  }, [el, variant]);
  return size;
}

// ─────────────────────────────── VirtualList ───────────────────────────────

export interface VirtualListProps extends CommonProps {
  rowHeight: number;
  renderRow(index: number, state: { selected: boolean }): ReactNode;
}

export function VirtualList({
  count,
  rowHeight,
  renderRow,
  overscan = 6,
  selectedIndex = -1,
  onSelect,
  onActivate,
  getKey,
  empty,
  className,
  style,
  padEnd = 0,
  ref,
  ...aria
}: VirtualListProps) {
  const el = useRef<HTMLDivElement>(null);
  const showEmpty = count === 0 && empty !== undefined;
  const { height } = useViewport(el, showEmpty);
  const [scrollTop, setScrollTop] = useState(0);
  const pageRows = Math.max(1, Math.floor(height / rowHeight) - 1);

  const scrollToIndex = (i: number, align: ScrollAlign = "auto") => {
    const node = el.current;
    if (!node || i < 0 || i >= count) return;
    node.scrollTop = scrollForItem(i * rowHeight, rowHeight, node.clientHeight, node.scrollTop, align);
  };
  useImperativeHandle(ref, () => ({ scrollToIndex, focus: () => el.current?.focus(), element: el.current }));

  useEffect(() => {
    if (selectedIndex >= 0) scrollToIndex(selectedIndex);
  }, [selectedIndex]);

  const move = (k: NavKey) => {
    const next = moveIndex(selectedIndex, k, count, 1, pageRows);
    if (next >= 0 && next !== selectedIndex) onSelect?.(next);
  };
  const activate = onActivate && selectedIndex >= 0 && selectedIndex < count ? () => onActivate(selectedIndex) : undefined;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const k = navKeyFor(e.key);
    if (k && k !== "left" && k !== "right") {
      e.preventDefault();
      move(k);
    } else if (e.key === "Enter" && activate) {
      e.preventDefault();
      activate();
    }
  };

  if (showEmpty)
    return (
      <div ref={el} className={cx(s.viewport, className)} style={style}>
        {empty}
      </div>
    );

  const { start, end } = visibleRange(scrollTop, height, rowHeight, count, overscan);
  const rows: ReactNode[] = [];
  for (let i = start; i < end; i++) {
    const selected = i === selectedIndex;
    rows.push(
      <div
        key={getKey ? getKey(i) : i}
        role="option"
        aria-selected={selected}
        className={cx(s.row, selected && s.rowSelected)}
        style={{ top: i * rowHeight, height: rowHeight }}
        onClick={() => onSelect?.(i)}
        onDoubleClick={() => onActivate?.(i)}
      >
        {renderRow(i, { selected })}
      </div>,
    );
  }

  return (
    <div
      ref={el}
      className={cx(s.viewport, className)}
      style={style}
      tabIndex={0}
      role="listbox"
      aria-label={aria["aria-label"]}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      onKeyDown={onKeyDown}
    >
      <div className={s.spacer} style={{ height: count * rowHeight + padEnd }}>
        {rows}
      </div>
    </div>
  );
}

// ─────────────────────────────── VirtualGrid ───────────────────────────────

export interface VirtualGridProps extends CommonProps {
  /** Minimum cell width; with `stretch` cells grow to fill the row. */
  cellWidth: number;
  cellHeight: number;
  gap?: number;
  /** Inner padding around the grid (px). */
  padding?: number;
  stretch?: boolean;
  renderCell(index: number, state: { selected: boolean }): ReactNode;
  /** Reports the column count whenever it changes (for paging by rows). */
  onColumnsChange?(columns: number): void;
}

export function VirtualGrid({
  count,
  cellWidth,
  cellHeight,
  gap = 12,
  padding = 12,
  stretch,
  renderCell,
  overscan = 2,
  selectedIndex = -1,
  onSelect,
  onActivate,
  onColumnsChange,
  getKey,
  empty,
  className,
  style,
  padEnd = 0,
  ref,
  ...aria
}: VirtualGridProps) {
  const el = useRef<HTMLDivElement>(null);
  const showEmpty = count === 0 && empty !== undefined;
  const { width, height } = useViewport(el, showEmpty);
  const [scrollTop, setScrollTop] = useState(0);
  const inner = Math.max(0, width - padding * 2);
  const columns = gridColumns(inner, cellWidth, gap);
  const cellW = stretch ? (inner - gap * (columns - 1)) / columns : cellWidth;
  const rowH = cellHeight + gap;
  const rowCount = Math.ceil(count / columns);
  const pageRows = Math.max(1, Math.floor(height / rowH));

  useEffect(() => {
    if (width > 0) onColumnsChange?.(columns);
  }, [columns, width > 0]);

  const scrollToIndex = (i: number, align: ScrollAlign = "auto") => {
    const node = el.current;
    if (!node || i < 0 || i >= count) return;
    const top = padding + Math.floor(i / columns) * rowH;
    node.scrollTop = scrollForItem(top, cellHeight, node.clientHeight, node.scrollTop, align, padding);
  };
  useImperativeHandle(ref, () => ({ scrollToIndex, focus: () => el.current?.focus(), element: el.current }));

  useEffect(() => {
    if (selectedIndex >= 0) scrollToIndex(selectedIndex);
  }, [selectedIndex, columns]);

  const move = (k: NavKey) => {
    const next = moveIndex(selectedIndex, k, count, columns, pageRows);
    if (next >= 0 && next !== selectedIndex) onSelect?.(next);
  };
  const activate = onActivate && selectedIndex >= 0 && selectedIndex < count ? () => onActivate(selectedIndex) : undefined;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const k = navKeyFor(e.key);
    if (k) {
      e.preventDefault();
      move(k);
    } else if (e.key === "Enter" && activate) {
      e.preventDefault();
      activate();
    }
  };

  if (showEmpty)
    return (
      <div ref={el} className={cx(s.viewport, className)} style={style}>
        {empty}
      </div>
    );

  const { start, end } = visibleRange(Math.max(0, scrollTop - padding), height, rowH, rowCount, overscan);
  const cells: ReactNode[] = [];
  for (let r = start; r < end; r++) {
    for (let c = 0; c < columns; c++) {
      const i = r * columns + c;
      if (i >= count) break;
      const selected = i === selectedIndex;
      cells.push(
        <div
          key={getKey ? getKey(i) : i}
          role="option"
          aria-selected={selected}
          className={s.cell}
          style={{ top: padding + r * rowH, left: padding + c * (cellW + gap), width: cellW, height: cellHeight }}
          onClick={() => onSelect?.(i)}
          onDoubleClick={() => onActivate?.(i)}
        >
          {renderCell(i, { selected })}
        </div>,
      );
    }
  }

  return (
    <div
      ref={el}
      className={cx(s.viewport, className)}
      style={style}
      tabIndex={0}
      role="listbox"
      aria-label={aria["aria-label"]}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      onKeyDown={onKeyDown}
    >
      <div className={s.spacer} style={{ height: padding * 2 + rowCount * rowH - (rowCount ? gap : 0) + padEnd }}>
        {cells}
      </div>
    </div>
  );
}
