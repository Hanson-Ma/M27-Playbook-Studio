// Windowing math for VirtualList / VirtualGrid (pure, tested).

export type ScrollAlign = "auto" | "start" | "center" | "end";
export type NavKey = "up" | "down" | "left" | "right" | "pageUp" | "pageDown" | "home" | "end";

/** Rows to render: [start, end) including `overscan` rows on both sides. */
export function visibleRange(scrollTop: number, viewport: number, rowHeight: number, count: number, overscan: number): { start: number; end: number } {
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const last = Math.ceil((Math.max(0, scrollTop) + Math.max(0, viewport)) / rowHeight);
  return { start: Math.max(0, first - overscan), end: Math.min(count, last + overscan) };
}

/** Columns that fit: n·cell + (n−1)·gap ≤ width, at least 1. */
export function gridColumns(width: number, cellWidth: number, gap: number): number {
  if (cellWidth <= 0) return 1;
  return Math.max(1, Math.floor((width + gap) / (cellWidth + gap)));
}

/** scrollTop that brings the item spanning [top, top+size) into view (auto = minimal scroll; unchanged if visible). */
export function scrollForItem(top: number, size: number, viewport: number, scrollTop: number, align: ScrollAlign = "auto", padding = 0): number {
  const bottom = top + size;
  switch (align) {
    case "start":
      return Math.max(0, top - padding);
    case "end":
      return Math.max(0, bottom - viewport + padding);
    case "center":
      return Math.max(0, top - (viewport - size) / 2);
    default:
      if (top - padding < scrollTop) return Math.max(0, top - padding);
      if (bottom + padding > scrollTop + viewport) return Math.max(0, bottom - viewport + padding);
      return scrollTop;
  }
}

/** Next index for a navigation key in a list (columns = 1) or grid; -1 (nothing selected) starts at 0. */
export function moveIndex(index: number, key: NavKey, count: number, columns = 1, pageRows = 10): number {
  if (count <= 0) return -1;
  if (index < 0 || index >= count) return key === "end" ? count - 1 : 0;
  const cols = Math.max(1, columns);
  switch (key) {
    case "up":
      return index - cols >= 0 ? index - cols : index;
    case "down":
      // Moving down from a column the last row doesn't have lands on the last item.
      return index + cols < count ? index + cols : Math.floor(index / cols) < Math.floor((count - 1) / cols) ? count - 1 : index;
    case "left":
      return cols === 1 ? index : Math.max(0, index - 1);
    case "right":
      return cols === 1 ? index : Math.min(count - 1, index + 1);
    case "pageUp":
      return Math.max(index % cols, index - cols * pageRows);
    case "pageDown": {
      const n = index + cols * pageRows;
      return n < count ? n : count - 1;
    }
    case "home":
      return 0;
    case "end":
      return count - 1;
  }
}

const KEY_MAP: Record<string, NavKey> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  PageUp: "pageUp",
  PageDown: "pageDown",
  Home: "home",
  End: "end",
};

export function navKeyFor(key: string): NavKey | undefined {
  return KEY_MAP[key];
}
