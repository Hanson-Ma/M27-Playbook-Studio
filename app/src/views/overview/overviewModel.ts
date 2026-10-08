// Playbook overview layout and camera math (pure TS, no DOM). The whole playbook is one big wall:
//   · one COLUMN per formation, left to right in playbook order (a long formation flows into a few lanes side by side)
//   · inside a column, one BLOCK per set (a title, then its plays in rows of PER_ROW cards)
// The view pans and zooms a camera over it. `View` maps world → screen: screen = world · k + (x, y).
import type { CallBook, CallFormation, CallPlay, CallSet } from "../playcall/playcallModel";

export const CARD_W = 248;
export const CARD_H = 176;
export const GAP = 18;
export const PER_ROW = 4;
export const COL_PAD = 28;
export const COL_GAP = 64;
export const COL_W = PER_ROW * CARD_W + (PER_ROW - 1) * GAP + 2 * COL_PAD;
export const MARGIN = 80;
export const FORM_HEAD_H = 220;
export const SET_HEAD_H = 96;
export const SET_GAP = 44;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OvPlay extends Rect {
  id: string;
  item: CallPlay;
  /** Index of the formation column it belongs to, and the id of its set block. */
  f: number;
  setId: string;
}

export interface OvSet extends Rect {
  id: string;
  f: number;
  name: string;
  count: number;
  set: CallSet;
}

export interface OvFormation extends Rect {
  id: string;
  f: number;
  name: string;
  count: number;
  setCount: number;
  /** Side-by-side columns its sets flow into (1 for most formations). */
  lanes: number;
  formation: CallFormation;
}

export interface OvLayout {
  width: number;
  height: number;
  formations: OvFormation[];
  sets: OvSet[];
  plays: OvPlay[];
  byId: ReadonlyMap<string, OvPlay>;
}

/** A formation taller than this wraps its sets into a second (third…) lane, so no column towers over the rest. */
export const LANE_TARGET_H = 3400;
export const MAX_LANES = 4;
export const LANE_GAP = 28;

const setHeight = (n: number) => SET_HEAD_H + (n ? Math.ceil(n / PER_ROW) * (CARD_H + GAP) - GAP : 0);

/**
 * Lay the playbook out as formation columns of set blocks of play cards. A formation with many sets flows into
 * several lanes side by side (the heading spans them), filling a lane until the next set would pass LANE_TARGET_H.
 */
export function layoutBook(book: Pick<CallBook, "formations">): OvLayout {
  const formations: OvFormation[] = [];
  const sets: OvSet[] = [];
  const plays: OvPlay[] = [];
  const byId = new Map<string, OvPlay>();
  let height = 0;
  let cursor = MARGIN;
  book.formations.forEach((formation, f) => {
    // Assign sets to lanes.
    const laneOf: number[] = [];
    let lane = 0;
    let used = 0;
    formation.sets.forEach((set, i) => {
      const h = setHeight(set.plays.length);
      if (i > 0 && used + SET_GAP + h > LANE_TARGET_H && lane < MAX_LANES - 1) {
        lane++;
        used = 0;
      }
      laneOf.push(lane);
      used += (used ? SET_GAP : 0) + h;
    });
    const lanes = formation.sets.length ? lane + 1 : 1;
    const width = lanes * COL_W + (lanes - 1) * LANE_GAP;
    const x0 = cursor;
    const bottoms: number[] = Array.from({ length: lanes }, () => MARGIN + FORM_HEAD_H);
    formation.sets.forEach((set, i) => {
      const l = laneOf[i];
      const x = x0 + l * (COL_W + LANE_GAP);
      const top = bottoms[l];
      const rowsTop = top + SET_HEAD_H;
      set.plays.forEach((item, j) => {
        const p: OvPlay = {
          id: item.id,
          item,
          f,
          setId: set.id,
          x: x + COL_PAD + (j % PER_ROW) * (CARD_W + GAP),
          y: rowsTop + Math.floor(j / PER_ROW) * (CARD_H + GAP),
          w: CARD_W,
          h: CARD_H,
        };
        plays.push(p);
        byId.set(p.id, p);
      });
      const h = setHeight(set.plays.length);
      sets.push({ id: set.id, f, name: set.name, count: set.plays.length, set, x: x + COL_PAD, y: top, w: COL_W - 2 * COL_PAD, h });
      bottoms[l] = top + h + SET_GAP;
    });
    const bottom = Math.max(...bottoms) - (formation.sets.length ? SET_GAP : 0);
    formations.push({
      id: formation.id,
      f,
      name: formation.name,
      count: formation.playCount,
      setCount: formation.sets.length,
      lanes,
      formation,
      x: x0,
      y: MARGIN,
      w: width,
      h: Math.max(bottom, MARGIN + FORM_HEAD_H) - MARGIN,
    });
    height = Math.max(height, bottom);
    cursor = x0 + width + COL_GAP;
  });
  const width = book.formations.length ? cursor - COL_GAP + MARGIN : 2 * MARGIN;
  return { width, height: height + MARGIN, formations, sets, plays, byId };
}

// ───────────────────────────── camera ─────────────────────────────

export interface View {
  x: number;
  y: number;
  k: number;
}

export const MIN_K = 0.04;
export const MAX_K = 2.4;

export const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));

/** The camera that shows `rect` whole, centered, with `pad` px of air (never zoomed in past `maxK`). */
export function viewFor(rect: Rect, vw: number, vh: number, pad = 40, maxK = 1): View {
  const k = clampK(Math.min(maxK, Math.max(1, vw - 2 * pad) / rect.w, Math.max(1, vh - 2 * pad) / rect.h));
  return { k, x: vw / 2 - (rect.x + rect.w / 2) * k, y: vh / 2 - (rect.y + rect.h / 2) * k };
}

/** The camera that shows the whole wall. */
export function fitView(layout: Pick<OvLayout, "width" | "height">, vw: number, vh: number): View {
  return viewFor({ x: 0, y: 0, w: layout.width, h: layout.height }, vw, vh, 24, 1);
}

/** The same camera zoomed by `factor` around the screen point (sx, sy): the world point under it stays put. */
export function zoomAt(v: View, factor: number, sx: number, sy: number): View {
  const k = clampK(v.k * factor);
  const f = k / v.k;
  return { k, x: sx - (sx - v.x) * f, y: sy - (sy - v.y) * f };
}

/** The world rectangle the camera sees, grown by `margin` (a fraction of its size) on every side. */
export function worldRect(v: View, vw: number, vh: number, margin = 0): Rect {
  const w = vw / v.k;
  const h = vh / v.k;
  return { x: -v.x / v.k - w * margin, y: -v.y / v.k - h * margin, w: w * (1 + 2 * margin), h: h * (1 + 2 * margin) };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** How much of each card to draw: full art, a flat tile with the name, or just a colored block. */
export type Detail = "full" | "light" | "dot";

export const FULL_AT = 0.45;
export const LIGHT_AT = 0.14;

export function detailAt(k: number): Detail {
  return k >= FULL_AT ? "full" : k >= LIGHT_AT ? "light" : "dot";
}

// ───────────────────────────── moving around ─────────────────────────────

export type Dir = "UP" | "DOWN" | "LEFT" | "RIGHT";

/** The card in direction `dir` from `fromId`: nearest by distance ahead, favouring the same row / column. */
export function neighbor(layout: Pick<OvLayout, "plays" | "byId">, fromId: string, dir: Dir): OvPlay | undefined {
  const from = layout.byId.get(fromId);
  if (!from) return undefined;
  const cx = from.x + from.w / 2;
  const cy = from.y + from.h / 2;
  let best: OvPlay | undefined;
  let bestScore = Infinity;
  for (const p of layout.plays) {
    if (p === from) continue;
    const dx = p.x + p.w / 2 - cx;
    const dy = p.y + p.h / 2 - cy;
    const ahead = dir === "RIGHT" ? dx : dir === "LEFT" ? -dx : dir === "DOWN" ? dy : -dy;
    if (ahead < 8) continue;
    const across = dir === "LEFT" || dir === "RIGHT" ? Math.abs(dy) : Math.abs(dx);
    const score = ahead + 3 * across;
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

/** The card closest to a world point (where to start when nothing is selected yet). */
export function nearestTo(layout: Pick<OvLayout, "plays">, wx: number, wy: number): OvPlay | undefined {
  let best: OvPlay | undefined;
  let bestD = Infinity;
  for (const p of layout.plays) {
    const d = Math.hypot(p.x + p.w / 2 - wx, p.y + p.h / 2 - wy);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** The formation column whose horizontal span contains world x (else the nearest one). */
export function formationAt(layout: Pick<OvLayout, "formations">, wx: number): OvFormation | undefined {
  let best: OvFormation | undefined;
  let bestD = Infinity;
  for (const f of layout.formations) {
    const d = wx < f.x ? f.x - wx : wx > f.x + f.w ? wx - (f.x + f.w) : 0;
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}
