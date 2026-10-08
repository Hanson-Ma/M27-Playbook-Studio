// Playbook overview layout and camera math (pure TS, no DOM). The whole playbook is one big wall, laid out like the
// game's play-call screen:
//   · one BAND per formation, top to bottom in playbook order
//   · across a band, one BLOCK per set, three columns of play cards each (3 cards per page, like the game)
//   · the set order wraps around like the game's set carousel: the FIRST set sits in the middle (every band's first
//     set lines up in one vertical spine), the next ones go to its right, and the last ones wrap to its left
// The view pans and zooms a camera over it. `View` maps world → screen: screen = world · k + (x, y).
import type { CallBook, CallFormation, CallPlay, CallSet } from "../playcall/playcallModel";

export const CARD_W = 248;
export const CARD_H = 176;
export const GAP = 18;
export const PER_ROW = 3;
export const COL_PAD = 28;
/** Gap between two set blocks of a band. */
export const BLOCK_GAP = 56;
export const BLOCK_W = PER_ROW * CARD_W + (PER_ROW - 1) * GAP + 2 * COL_PAD;
export const MARGIN = 80;
export const FORM_HEAD_H = 150;
export const SET_HEAD_H = 96;
/** Vertical gap between two formation bands. */
export const BAND_GAP = 80;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OvPlay extends Rect {
  id: string;
  item: CallPlay;
  /** Index of the formation band it belongs to, and the id of its set block. */
  f: number;
  setId: string;
}

export interface OvSet extends Rect {
  id: string;
  f: number;
  name: string;
  count: number;
  set: CallSet;
  /** The first set of its formation (the one in the middle of the band). */
  first: boolean;
}

export interface OvFormation extends Rect {
  id: string;
  f: number;
  name: string;
  count: number;
  setCount: number;
  formation: CallFormation;
}

export interface OvLayout {
  width: number;
  height: number;
  formations: OvFormation[];
  sets: OvSet[];
  plays: OvPlay[];
  byId: ReadonlyMap<string, OvPlay>;
  /** x of every band's first set (the spine down the middle of the wall). */
  spineX: number;
}

const setHeight = (n: number) => SET_HEAD_H + (n ? Math.ceil(n / PER_ROW) * (CARD_H + GAP) - GAP : 0);

/**
 * The display order of a formation's sets, left to right: the last floor(N/2) sets wrap around to the left of the
 * first one (3 sets → 3 · 1 · 2, 5 sets → 4 · 5 · 1 · 2 · 3). `index` is the position in the playbook.
 */
export function ringOrder<T>(items: readonly T[]): { item: T; index: number }[] {
  const left = Math.floor(items.length / 2);
  const cut = items.length - left;
  return [...items.slice(cut).map((item, i) => ({ item, index: cut + i })), ...items.slice(0, cut).map((item, i) => ({ item, index: i }))];
}

/** Lay the playbook out as formation bands of set blocks of play cards (see the file header). */
export function layoutBook(book: Pick<CallBook, "formations">): OvLayout {
  const formations: OvFormation[] = [];
  const sets: OvSet[] = [];
  const plays: OvPlay[] = [];
  const byId = new Map<string, OvPlay>();
  // Every band's first set sits at the same x: leave room for the widest left wing.
  const wing = Math.max(0, ...book.formations.map((f) => Math.floor(f.sets.length / 2)));
  const spineX = MARGIN + wing * (BLOCK_W + BLOCK_GAP);
  let y = MARGIN;
  let right = spineX + BLOCK_W;
  book.formations.forEach((formation, f) => {
    const order = ringOrder(formation.sets);
    const firstAt = order.findIndex((o) => o.index === 0);
    const blocksTop = y + FORM_HEAD_H;
    let bandH = 0;
    order.forEach((o, i) => {
      const set = o.item;
      const x = spineX + (i - firstAt) * (BLOCK_W + BLOCK_GAP);
      const h = setHeight(set.plays.length);
      bandH = Math.max(bandH, h);
      set.plays.forEach((item, j) => {
        const p: OvPlay = {
          id: item.id,
          item,
          f,
          setId: set.id,
          x: x + COL_PAD + (j % PER_ROW) * (CARD_W + GAP),
          y: blocksTop + SET_HEAD_H + Math.floor(j / PER_ROW) * (CARD_H + GAP),
          w: CARD_W,
          h: CARD_H,
        };
        plays.push(p);
        byId.set(p.id, p);
      });
      sets.push({ id: set.id, f, name: set.name, count: set.plays.length, set, first: o.index === 0, x, y: blocksTop, w: BLOCK_W, h });
      right = Math.max(right, x + BLOCK_W);
    });
    const bandW = formation.sets.length ? formation.sets.length * BLOCK_W + (formation.sets.length - 1) * BLOCK_GAP : BLOCK_W;
    const bandX = formation.sets.length ? spineX - firstAt * (BLOCK_W + BLOCK_GAP) : spineX;
    formations.push({
      id: formation.id,
      f,
      name: formation.name,
      count: formation.playCount,
      setCount: formation.sets.length,
      formation,
      x: bandX,
      y,
      w: bandW,
      h: FORM_HEAD_H + bandH,
    });
    y += FORM_HEAD_H + bandH + BAND_GAP;
  });
  const height = book.formations.length ? y - BAND_GAP + MARGIN : 2 * MARGIN;
  return { width: right + MARGIN, height, formations, sets, plays, byId, spineX };
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

/** Below this zoom a card is smaller than comfortable to read: moving to it also zooms in. */
export const COMFY_K = 0.45;

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

/** The formation band whose vertical span contains world y (else the nearest one). */
export function formationAt(layout: Pick<OvLayout, "formations">, wy: number): OvFormation | undefined {
  let best: OvFormation | undefined;
  let bestD = Infinity;
  for (const f of layout.formations) {
    const d = wy < f.y ? f.y - wy : wy > f.y + f.h ? wy - (f.y + f.h) : 0;
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}
