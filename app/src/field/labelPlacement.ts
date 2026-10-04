// Player label placement for PlayArtLayer (pure; no React/DOM). Everything is in screen pixels in SVG orientation
// (x right, y DOWN), relative to the field origin: px = (x · ppy, −y · ppy).
//
// Each label tries eight spots around its player — the side's default (offense below, defense above), the opposite
// side, right, left, then the corners on the default side and the opposite corners — and takes the cheapest: covering
// another player's mark costs most, then overlapping an already placed label, leaving the view, and crossing a drawn
// segment — its own path most (so a pass-pro stem, a QB drop or backward motion pushes the label to the other side),
// someone else's route less (the opaque pill only hides a sliver of it); ties keep the default order.

export type LabelSpot = "below" | "above" | "right" | "left" | "below-right" | "below-left" | "above-right" | "above-left";

export interface LabelRequest {
  slot: number;
  /** Player centre (px). */
  x: number;
  y: number;
  /** Label box size (px). */
  w: number;
  h: number;
  /** Default spot: offense labels sit below their mark, defense labels above. */
  prefer: "below" | "above";
}

export interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Slot whose path this is: a label crossing its own player's path costs more than crossing someone else's. */
  slot?: number;
}

export interface MarkCircle {
  slot: number;
  x: number;
  y: number;
  r: number;
}

export interface PlacedLabel {
  slot: number;
  spot: LabelSpot;
  /** Box centre relative to the player (px). */
  dx: number;
  dy: number;
  w: number;
  h: number;
}

export interface PlaceOptions {
  /** Player mark radius (px). */
  radius: number;
  /** Gap between mark and label box (px). */
  gap: number;
  /** Visible area (px, same frame); boxes outside it cost extra. */
  view?: { x0: number; y0: number; x1: number; y1: number };
}

const COST_OWN_SEGMENT = 12;
const COST_SEGMENT = 5;
const COST_MARK = 60;
const COST_LABEL = 30;
const COST_OUTSIDE = 20;
const ORDER_COST = [0, 3, 5, 6, 10, 10, 12, 12];
const ORDER_BELOW: LabelSpot[] = ["below", "above", "right", "left", "below-right", "below-left", "above-right", "above-left"];
const ORDER_ABOVE: LabelSpot[] = ["above", "below", "right", "left", "above-right", "above-left", "below-right", "below-left"];
/** Corner spots sit diagonally off the mark (the box corner clears the mark's circle). */
const DIAG = Math.SQRT1_2;

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const boxesOverlap = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

function circleHitsBox(c: { x: number; y: number; r: number }, b: Box): boolean {
  const nx = Math.max(b.x0, Math.min(c.x, b.x1));
  const ny = Math.max(b.y0, Math.min(c.y, b.y1));
  return (c.x - nx) ** 2 + (c.y - ny) ** 2 < c.r * c.r;
}

/** Liang–Barsky: does segment a→b pass through the box? */
export function segmentHitsBox(s: Segment, b: Box): boolean {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return clip(-dx, s.ax - b.x0) && clip(dx, b.x1 - s.ax) && clip(-dy, s.ay - b.y0) && clip(dy, b.y1 - s.ay) && t0 <= t1;
}

/** Box centre offset from the player for a spot. */
export function spotOffset(spot: LabelSpot, w: number, h: number, radius: number, gap: number): { dx: number; dy: number } {
  switch (spot) {
    case "below":
      return { dx: 0, dy: radius + gap + h / 2 };
    case "above":
      return { dx: 0, dy: -(radius + gap + h / 2) };
    case "right":
      return { dx: radius + gap + w / 2, dy: 0 };
    case "left":
      return { dx: -(radius + gap + w / 2), dy: 0 };
    default: {
      const sx = spot.endsWith("right") ? 1 : -1;
      const sy = spot.startsWith("below") ? 1 : -1;
      const r = radius * DIAG + gap;
      return { dx: sx * (r + w / 2), dy: sy * (r + h / 2) };
    }
  }
}

/** Places labels in request order (greedy). */
export function placeLabels(labels: LabelRequest[], segments: Segment[], marks: MarkCircle[], o: PlaceOptions): PlacedLabel[] {
  const placed: (PlacedLabel & { box: Box })[] = [];
  for (const l of labels) {
    const order = l.prefer === "below" ? ORDER_BELOW : ORDER_ABOVE;
    let best: (PlacedLabel & { box: Box }) | undefined;
    let bestCost = Infinity;
    order.forEach((spot, i) => {
      const { dx, dy } = spotOffset(spot, l.w, l.h, o.radius, o.gap);
      const cx = l.x + dx;
      const cy = l.y + dy;
      const box = { x0: cx - l.w / 2, y0: cy - l.h / 2, x1: cx + l.w / 2, y1: cy + l.h / 2 };
      let cost = ORDER_COST[i];
      for (const s of segments) if (segmentHitsBox(s, box)) cost += s.slot === l.slot ? COST_OWN_SEGMENT : COST_SEGMENT;
      for (const m of marks) if (m.slot !== l.slot && circleHitsBox(m, box)) cost += COST_MARK;
      for (const p of placed) if (boxesOverlap(p.box, box)) cost += COST_LABEL;
      const v = o.view;
      if (v && (box.x0 < v.x0 || box.y0 < v.y0 || box.x1 > v.x1 || box.y1 > v.y1)) cost += COST_OUTSIDE;
      if (cost < bestCost) {
        bestCost = cost;
        best = { slot: l.slot, spot, dx, dy, w: l.w, h: l.h, box };
      }
    });
    placed.push(best!);
  }
  return placed.map(({ box: _box, ...p }) => p);
}
