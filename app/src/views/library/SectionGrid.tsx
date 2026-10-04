// Virtualized grid with section headers (sticky, with the push-up handoff) for the library: thousands of PlayCards,
// optional per-section headers, arrow-key navigation while the grid has keyboard focus (rows wrap across sections;
// Home/End, PageUp/PageDown, Enter activates), scroll restore, and selection kept clear of the sticky header.
// ui/VirtualGrid has no sections, so this is local to the library (also used for the route list with 1 column).
import { useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type Key, type MouseEvent, type ReactNode, type Ref } from "react";
import { cx, gridColumns } from "../../ui";
import s from "./SectionGrid.module.css";

export interface GridSection<T> {
  key: string;
  items: T[];
}

export interface SectionGridHandle {
  scrollToFlat(flat: number, align?: "auto" | "center" | "start"): void;
  /** Scroll to a pixel offset (and render that window right away). */
  scrollTo(top: number): void;
  /** Give the grid keyboard focus (arrow keys then move the selection). */
  focus(): void;
  element: HTMLDivElement | null;
}

export interface SectionGridProps<T> {
  sections: GridSection<T>[];
  /** When set, every section gets a header row (and the current one sticks to the top). */
  renderHeader?(section: GridSection<T>, index: number): ReactNode;
  renderCell(item: T, flat: number, state: { selected: boolean; column: number; columns: number }): ReactNode;
  getKey(item: T, flat: number): Key;
  minCellWidth: number;
  maxColumns?: number;
  /** Fixed column count (overrides minCellWidth). */
  columns?: number;
  /** Cell height for a cell width. */
  cellHeight(width: number): number;
  headerHeight?: number;
  gap?: number;
  rowGap?: number;
  padding?: number;
  /** Extra gap after each section. */
  sectionGap?: number;
  selected: number;
  onSelect(flat: number): void;
  onActivate?(flat: number): void;
  onCellContextMenu?(flat: number, e: MouseEvent): void;
  /** Arrow keys / Home / End / PageUp / PageDown / Enter while the grid has focus (default true). */
  keyboard?: boolean;
  initialScrollTop?: number;
  onScrollTopChange?(top: number): void;
  /** Extra space kept free at the bottom. */
  padEnd?: number;
  empty?: ReactNode;
  onColumnsChange?(columns: number): void;
  className?: string;
  "aria-label"?: string;
  ref?: Ref<SectionGridHandle>;
}

interface Row {
  header: boolean;
  section: number;
  top: number;
  height: number;
  /** Flat index of the first cell (cell rows). */
  first: number;
  count: number;
}

interface Layout {
  rows: Row[];
  total: number;
  /** Flat index of each section's first item. */
  starts: number[];
  /** Row index of each section's first cell row. */
  firstRow: number[];
  /** Row index of each section's header (-1 without headers). */
  headerRow: number[];
  count: number;
}

function buildLayout(counts: number[], columns: number, cellH: number, headerH: number, rowGap: number, padding: number, sectionGap: number, headers: boolean): Layout {
  const rows: Row[] = [];
  const starts: number[] = [];
  const firstRow: number[] = [];
  const headerRow: number[] = [];
  let top = padding;
  let flat = 0;
  counts.forEach((n, si) => {
    starts.push(flat);
    if (headers) {
      headerRow.push(rows.length);
      rows.push({ header: true, section: si, top, height: headerH, first: flat, count: 0 });
      top += headerH;
    } else headerRow.push(-1);
    firstRow.push(rows.length);
    const nRows = Math.ceil(n / columns);
    for (let r = 0; r < nRows; r++) {
      const c = Math.min(columns, n - r * columns);
      rows.push({ header: false, section: si, top, height: cellH, first: flat + r * columns, count: c });
      top += cellH + rowGap;
    }
    if (nRows) top -= rowGap;
    top += sectionGap;
    flat += n;
  });
  return { rows, total: top + padding, starts, firstRow, headerRow, count: flat };
}

/** Index of the last row whose top <= y (0 when y is above everything). */
function rowAt(rows: Row[], y: number): number {
  let lo = 0;
  let hi = rows.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].top <= y) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

function sectionOf(starts: number[], flat: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= flat) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  // Skip empty sections that share the same start.
  while (ans + 1 < starts.length && starts[ans + 1] === flat && starts[ans + 1] === starts[ans]) ans++;
  return ans;
}

export function SectionGrid<T>(props: SectionGridProps<T>) {
  const {
    sections,
    renderHeader,
    renderCell,
    getKey,
    minCellWidth,
    maxColumns = 99,
    columns: fixedColumns,
    cellHeight,
    headerHeight = 44,
    gap = 16,
    rowGap = gap,
    padding = 16,
    sectionGap = 8,
    selected,
    onSelect,
    onActivate,
    onCellContextMenu,
    keyboard = true,
    initialScrollTop = 0,
    onScrollTopChange,
    padEnd = 0,
    empty,
    onColumnsChange,
    className,
    ref,
  } = props;
  const el = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(initialScrollTop);
  const restored = useRef(false);
  const onScrollRef = useRef(onScrollTopChange);
  onScrollRef.current = onScrollTopChange;

  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    const update = () => setSize((o) => (o.width === node.clientWidth && o.height === node.clientHeight ? o : { width: node.clientWidth, height: node.clientHeight }));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const inner = Math.max(0, size.width - padding * 2);
  const columns = fixedColumns ?? Math.min(maxColumns, gridColumns(inner, minCellWidth, gap));
  const cellW = columns > 0 ? (inner - gap * (columns - 1)) / columns : inner;
  const cellH = Math.round(cellHeight(Math.max(1, cellW)));
  const headers = !!renderHeader;
  const counts = useMemo(() => sections.map((x) => x.items.length), [sections]);
  const layout = useMemo(
    () => buildLayout(counts, columns, cellH, headerHeight, rowGap, padding, sectionGap, headers),
    [counts, columns, cellH, headerHeight, rowGap, padding, sectionGap, headers],
  );
  const stickyH = headers ? headerHeight : 0;

  const lastCols = useRef(0);
  useLayoutEffect(() => {
    if (size.width > 0 && lastCols.current !== columns) {
      lastCols.current = columns;
      onColumnsChange?.(columns);
    }
  });

  const position = useCallback(
    (flat: number) => {
      const si = sectionOf(layout.starts, flat);
      const j = flat - layout.starts[si];
      const row = layout.firstRow[si] + Math.floor(j / columns);
      return { si, j, row, col: j % columns };
    },
    [layout, columns],
  );

  const scrollToFlat = useCallback(
    (flat: number, align: "auto" | "center" | "start" = "auto") => {
      const node = el.current;
      if (!node || flat < 0 || flat >= layout.count) return;
      const { row, si, j } = position(flat);
      const r = layout.rows[row];
      if (!r) return;
      const view = node.clientHeight;
      const safeBottom = padEnd + 8;
      // The first row of a section scrolls its own header into view too.
      const top = j < columns && headers ? layout.rows[layout.headerRow[si]].top : r.top - stickyH - 6;
      const bottom = r.top + r.height;
      let next = node.scrollTop;
      if (align === "start") next = top - (headers ? 0 : padding);
      else if (align === "center") next = r.top - (view - r.height) / 2;
      else if (si === 0 && j < columns) next = 0;
      else if (top < node.scrollTop) next = top - (headers ? 0 : 6);
      else if (bottom > node.scrollTop + view - safeBottom) next = bottom - view + safeBottom;
      next = Math.max(0, Math.min(next, node.scrollHeight - view));
      if (Math.abs(next - node.scrollTop) > 0.5) {
        node.scrollTop = next;
        // Render the new window now instead of waiting for the scroll event (no blank frame).
        setScrollTop(node.scrollTop);
        onScrollRef.current?.(node.scrollTop);
      }
    },
    [layout, position, columns, headers, stickyH, padEnd, padding],
  );

  useImperativeHandle(
    ref,
    () => ({
      scrollToFlat,
      scrollTo(top: number) {
        const node = el.current;
        if (!node) return;
        node.scrollTop = top;
        setScrollTop(node.scrollTop);
        onScrollRef.current?.(node.scrollTop);
      },
      focus() {
        el.current?.focus({ preventScroll: true });
      },
      element: el.current,
    }),
    [scrollToFlat],
  );

  // Restore the scroll position once the grid has a size, then keep the selection visible.
  useLayoutEffect(() => {
    const node = el.current;
    if (!node || size.width === 0) return;
    if (!restored.current) {
      restored.current = true;
      node.scrollTop = initialScrollTop;
      setScrollTop(node.scrollTop);
    }
  }, [size.width, initialScrollTop]);

  const prevSel = useRef<{ selected: number; columns: number }>({ selected: -2, columns: 0 });
  useLayoutEffect(() => {
    if (size.width === 0) return;
    const p = prevSel.current;
    if (p.selected !== selected || p.columns !== columns) {
      prevSel.current = { selected, columns };
      if (selected >= 0) scrollToFlat(selected);
    }
  });

  // ─────────── navigation ───────────
  const pageRows = Math.max(1, Math.floor((size.height - stickyH) / (cellH + rowGap)));
  const firstVisible = () => {
    const node = el.current;
    const y = (node?.scrollTop ?? 0) + stickyH;
    for (let i = rowAt(layout.rows, y); i < layout.rows.length; i++) if (!layout.rows[i].header && layout.rows[i].count) return layout.rows[i].first;
    return 0;
  };
  const step = (flat: number, dir: "up" | "down"): number => {
    const { si, j, col } = position(flat);
    const n = sections[si].items.length;
    const localRow = Math.floor(j / columns);
    const lastLocalRow = Math.floor((n - 1) / columns);
    if (dir === "up") {
      if (localRow > 0) return flat - columns;
      for (let p = si - 1; p >= 0; p--) {
        const m = sections[p].items.length;
        if (!m) continue;
        const lastRowStart = Math.floor((m - 1) / columns) * columns;
        return layout.starts[p] + Math.min(lastRowStart + col, m - 1);
      }
      return flat;
    }
    if (localRow < lastLocalRow) return Math.min(flat + columns, layout.starts[si] + n - 1);
    for (let q = si + 1; q < sections.length; q++) {
      const m = sections[q].items.length;
      if (!m) continue;
      return layout.starts[q] + Math.min(col, m - 1);
    }
    return flat;
  };
  const move = (k: "up" | "down" | "left" | "right" | "pageUp" | "pageDown" | "home" | "end") => {
    const n = layout.count;
    if (!n) return;
    if (selected < 0 || selected >= n) return onSelect(k === "end" ? n - 1 : firstVisible());
    let next = selected;
    if (k === "left") next = Math.max(0, selected - 1);
    else if (k === "right") next = Math.min(n - 1, selected + 1);
    else if (k === "home") next = 0;
    else if (k === "end") next = n - 1;
    else if (k === "up" || k === "down") next = step(selected, k);
    else for (let i = 0; i < pageRows; i++) next = step(next, k === "pageUp" ? "up" : "down");
    if (next !== selected) onSelect(next);
  };

  const KEY_MOVES: Record<string, Parameters<typeof move>[0]> = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    Home: "home",
    End: "end",
    PageUp: "pageUp",
    PageDown: "pageDown",
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!keyboard || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    // Only when the grid itself (or a non-text control inside a cell) has focus.
    const t = e.target as HTMLElement;
    if (t !== e.currentTarget && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const k = KEY_MOVES[e.key];
    if (k) {
      // A one-column list has no left/right.
      if ((k === "left" || k === "right") && columns <= 1) return;
      e.preventDefault();
      move(k);
    } else if (e.key === "Enter" && onActivate && selected >= 0 && t === e.currentTarget) {
      e.preventDefault();
      onActivate(selected);
    }
  };

  if (layout.count === 0 && empty !== undefined) return <div className={cx(s.viewport, className)}>{empty}</div>;

  // ─────────── render window ───────────
  const overscan = Math.max(200, size.height * 0.5);
  const from = rowAt(layout.rows, Math.max(0, scrollTop - overscan));
  const to = scrollTop + size.height + overscan;
  const nodes: ReactNode[] = [];
  if (columns > 0 && size.width > 0) {
    for (let ri = from; ri < layout.rows.length; ri++) {
      const r = layout.rows[ri];
      if (r.top > to) break;
      if (r.header) {
        nodes.push(
          <div key={`h:${sections[r.section].key}`} className={s.header} style={{ top: r.top, height: r.height, left: padding, right: padding }}>
            {renderHeader!(sections[r.section], r.section)}
          </div>,
        );
        continue;
      }
      const sec = sections[r.section];
      const base = layout.starts[r.section];
      for (let c = 0; c < r.count; c++) {
        const flat = r.first + c;
        const item = sec.items[flat - base];
        const sel = flat === selected;
        nodes.push(
          <div
            key={getKey(item, flat)}
            className={s.cell}
            role="option"
            aria-selected={sel}
            style={{ top: r.top, left: padding + c * (cellW + gap), width: cellW, height: r.height }}
            onClick={() => onSelect(flat)}
            onDoubleClick={() => onActivate?.(flat)}
            onContextMenu={onCellContextMenu ? (e) => onCellContextMenu(flat, e) : undefined}
          >
            {renderCell(item, flat, { selected: sel, column: c, columns })}
          </div>,
        );
      }
    }
  }

  // Sticky header: the section at the top edge; the next header pushes it up.
  let sticky: ReactNode = null;
  if (headers && layout.rows.length && size.width > 0) {
    const top = rowAt(layout.rows, scrollTop + 0.5);
    const si = layout.rows[top].section;
    const own = layout.rows[layout.headerRow[si]];
    if (own && own.top < scrollTop) {
      const nextHeader = si + 1 < sections.length ? layout.rows[layout.headerRow[si + 1]] : undefined;
      const push = nextHeader ? Math.min(0, nextHeader.top - scrollTop - headerHeight) : 0;
      sticky = (
        <div className={s.stickyLayer}>
          <div className={cx(s.header, s.sticky)} style={{ height: headerHeight, left: padding, right: padding, transform: `translateY(${push}px)` }}>
            {renderHeader!(sections[si], si)}
          </div>
        </div>
      );
    }
  }

  return (
    <div
      ref={el}
      className={cx(s.viewport, className)}
      tabIndex={keyboard ? 0 : -1}
      role="listbox"
      onKeyDown={onKeyDown}
      aria-label={props["aria-label"]}
      onScroll={(e) => {
        const t = e.currentTarget.scrollTop;
        setScrollTop(t);
        onScrollTopChange?.(t);
      }}
    >
      {sticky}
      <div className={s.spacer} style={{ height: layout.total + padEnd }}>
        {nodes}
      </div>
    </div>
  );
}
