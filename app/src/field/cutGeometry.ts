// Pure geometry for visible cuts (ARCHITECTURE v2 "Cuts are visible"): turns a route polyline + its styled vertices
// into SVG path data. Shared by PlayArtLayer (play art) and CutIcon (cut picker / guide icons) so both draw the same
// shapes. No React/DOM.
// - speed (22/45): rounded corner — a quadratic curve from `round` before the vertex to `round` after it, with the
//   vertex as control point (offsets capped at 45% of each leg so neighbouring corners never overlap);
// - hard (67/90/90_INSIDE, and turn-backs / settles that don't end the route): sharp corner + a short plant tick on
//   the outside of the turn;
// - fake (double moves, jukes): a small two-lobe zig spliced into the line around the vertex, first lobe toward the
//   cut side;
// - turnback ending the route (the engine's synthetic hook after the cut vertex): the hook drawn as one smooth curve;
// - settle (DRAG_STOP) at the end: reported as `settle` so the renderer draws a bar across the arrow tip.
// Inputs are field yards (+y upfield); output path data is in SVG space (y = −field y), like svgPoints().
import { cutStyle, type CutStyle } from "../model/art";
import type { ArtPath, Vec } from "../model/types";
import { r3 } from "./fieldMath";

export interface CutCorner {
  /** Index into the path's points. */
  index: number;
  style: CutStyle;
  /** Turn sense from the cut direction: +1 = LEFT (counter-clockwise), −1 = RIGHT (clockwise), 0 = unknown. */
  turn: 1 | -1 | 0;
}

/** Sizes in the path's units (yards on the field, px in icons). */
export interface CutSizes {
  /** Speed corners: curve starts/ends this far from the vertex (capped at 45% of each leg). */
  round: number;
  /** Fake zig: half length along the line (capped at 40% of each leg) and lobe height. */
  zigHalf: number;
  zigAmp: number;
  /** Hard cuts: plant tick length. */
  tick: number;
  /** Turn-back hooks: the curve starts this far before the cut vertex (capped at 45% of the stem). */
  hookIn: number;
}

export interface CutDrawing {
  /** SVG path data for the whole line (M/L/Q, SVG coordinates). */
  d: string;
  /** Hard-cut plant ticks as SVG path data ("" when none). */
  ticks: string;
  /** The route ends in a settle (DRAG_STOP): draw a bar across the tip. */
  settle: boolean;
}

/** Which style wins when two cuts share a point (rare: two ReceiverCuts in a row). */
const PRIORITY: Record<CutStyle, number> = { speed: 1, hard: 2, turnback: 3, settle: 4, fake: 5 };

const turnOf = (dir: string | undefined): 1 | -1 | 0 => (!dir ? 0 : dir.includes("LEFT") ? 1 : dir.includes("RIGHT") ? -1 : 0);

/**
 * The styled corners of a path, one per point index (strongest style wins), sorted by index. A vertex's explicit
 * `style` is used when present, else it's derived from `cut` (art made by other producers, fixtures).
 */
export function cutCorners(path: Pick<ArtPath, "points" | "vertices">): CutCorner[] {
  const byIndex = new Map<number, CutCorner>();
  for (const v of path.vertices ?? []) {
    const style = v.style ?? cutStyle(v.cut);
    if (!style || v.index < 0 || v.index >= path.points.length) continue;
    const prev = byIndex.get(v.index);
    if (prev && PRIORITY[prev.style] >= PRIORITY[style]) continue;
    byIndex.set(v.index, { index: v.index, style, turn: turnOf(v.cutDir) });
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const addv = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
const length = (a: Vec) => Math.hypot(a.x, a.y);
const unit = (a: Vec): Vec => {
  const l = length(a);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};
const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const pt = (v: Vec) => `${r3(v.x)} ${r3(-v.y)}`;

/** A hook the engine appended after a turn-back cut: no vertex past `k` and only a short tail (≤ 2.5 units). */
function isHookTail(points: Vec[], k: number, lastVertexIndex: number, maxTail: number): boolean {
  if (k > points.length - 3 || lastVertexIndex > k) return false;
  let tail = 0;
  for (let i = k + 1; i < points.length; i++) tail += length(sub(points[i], points[i - 1]));
  return tail <= maxTail;
}

/**
 * Path data for a polyline with styled corners. `lastVertexIndex` = the highest vertex index of the path (any vertex,
 * styled or not) — points after it are synthetic (hooks); pass corners' max when unknown. `hookTail` = the longest
 * tail treated as a hook (default 2.5 units).
 */
export function drawCutPath(
  points: Vec[],
  corners: CutCorner[],
  sizes: CutSizes,
  opts: { lastVertexIndex?: number; hookTail?: number } = {},
): CutDrawing {
  const n = points.length;
  if (!n) return { d: "", ticks: "", settle: false };
  const at = new Map(corners.map((c) => [c.index, c]));
  const lastVertex = opts.lastVertexIndex ?? corners.reduce((m, c) => Math.max(m, c.index), -1);
  const hookTail = opts.hookTail ?? 2.5;
  let d = `M${pt(points[0])}`;
  let ticks = "";
  let settle = false;

  for (let k = 0; k < n; k++) {
    const v = points[k];
    const c = at.get(k);
    const prev = k > 0 ? points[k - 1] : undefined;
    const next = k < n - 1 ? points[k + 1] : undefined;
    const inLen = prev ? length(sub(v, prev)) : 0;
    const outLen = next ? length(sub(next, v)) : 0;
    const uIn = prev ? unit(sub(v, prev)) : undefined;
    const uOut = next ? unit(sub(next, v)) : undefined;
    let style = c?.style;

    if (style === "settle" && !next) {
      settle = true;
      style = undefined;
    } else if (style === "turnback" && prev && isHookTail(points, k, lastVertex, hookTail)) {
      // One smooth curve through the hook: enter a little before the cut, then midpoint-smooth the hook points.
      const e = Math.min(sizes.hookIn, inLen * 0.45);
      if (e > 1e-6) d += `L${pt(addv(v, mul(uIn!, -e)))}`;
      const ctrl = points.slice(k, n - 1);
      for (let i = 0; i < ctrl.length; i++) {
        const end = i < ctrl.length - 1 ? mid(ctrl[i], ctrl[i + 1]) : points[n - 1];
        d += `Q${pt(ctrl[i])} ${pt(end)}`;
      }
      break;
    } else if ((style === "turnback" || style === "settle") && prev && next) {
      style = "hard"; // a comeback / stop that keeps going is a sharp plant
    }

    if (k === 0) {
      if (style === "fake" && uOut) d += zig(v, addv(v, mul(uOut, Math.min(sizes.zigHalf * 2, outLen * 0.4))), c!.turn, sizes.zigAmp);
      continue;
    }

    switch (style) {
      case "speed": {
        if (!uIn || !uOut) break;
        const r = Math.min(sizes.round, inLen * 0.45, outLen * 0.45);
        const cross = uIn.x * uOut.y - uIn.y * uOut.x;
        const dot = uIn.x * uOut.x + uIn.y * uOut.y;
        if (r <= 1e-6 || (Math.abs(cross) < 0.02 && dot > 0)) break; // no turn to round
        d += `L${pt(addv(v, mul(uIn, -r)))}Q${pt(v)} ${pt(addv(v, mul(uOut, r)))}`;
        continue;
      }
      case "fake": {
        const s = Math.min(sizes.zigHalf, inLen * 0.4, next ? outLen * 0.4 : Infinity);
        const a = uIn ? addv(v, mul(uIn, -s)) : v;
        const b = uOut ? addv(v, mul(uOut, s)) : v;
        if (length(sub(b, a)) > 1e-6) {
          d += `L${pt(a)}` + zig(a, b, c!.turn, sizes.zigAmp);
          continue;
        }
        break;
      }
      case "hard": {
        d += `L${pt(v)}`;
        if (uIn && uOut) {
          const out = sub(uIn, uOut); // points away from the inside of the turn
          if (length(out) > 0.1) ticks += `M${pt(v)}L${pt(addv(v, mul(unit(out), sizes.tick)))}`;
        }
        continue;
      }
    }
    d += `L${pt(v)}`;
  }
  return { d, ticks, settle };
}

/** Zig from a to b (path data without the leading move/line to a): two lobes, the first toward the cut side. */
function zig(a: Vec, b: Vec, turn: 1 | -1 | 0, amp: number): string {
  const c = sub(b, a);
  const L = length(c);
  if (L < 1e-6) return "";
  const t = mul(c, 1 / L);
  const h = Math.min(amp, L * 0.7) * (turn === -1 ? -1 : 1);
  const left: Vec = { x: -t.y, y: t.x }; // left of the direction of travel (counter-clockwise side)
  const p1 = addv(addv(a, mul(c, 1 / 3)), mul(left, h));
  const p2 = addv(addv(a, mul(c, 2 / 3)), mul(left, -h));
  return `L${pt(p1)}L${pt(p2)}L${pt(b)}`;
}
