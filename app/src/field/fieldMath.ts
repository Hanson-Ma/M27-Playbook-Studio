// Pure field math for the SVG renderer. One SVG user unit = one yard; SVG y points down, field y points up,
// so every field → SVG conversion goes through sy()/toSvg(). No React/DOM here.
import { HALF_WIDTH, HASH_HALF, clamp } from "../model/geometry";
import type { ArtBounds, ArtPath, PlayArt, Vec } from "../model/types";
import type { BallSpot } from "../state/settings";

/** Field y → SVG y. */
export const sy = (y: number): number => -y;

/** Field point → SVG point. */
export const toSvg = (v: Vec): Vec => ({ x: v.x, y: -v.y });

/** SVG point → field point. */
export const fromSvg = (x: number, y: number): Vec => ({ x, y: -y });

/** The ball sits on the 50 (midfield) unless a view says otherwise (only affects painted numbers/end zones). */
export const DEFAULT_LOS_YARD_LINE = 50;

/** Sideline-to-sideline, a little backfield and ~20 yd downfield: what a detail view shows by default. */
export const DEFAULT_VIEWPORT: ArtBounds = { minX: -HALF_WIDTH - 1, maxX: HALF_WIDTH + 1, minY: -12, maxY: 24 };

export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const viewBoxAttr = (vb: ViewBox): string => `${vb.x} ${vb.y} ${vb.width} ${vb.height}`;

/** Field-space bounds (+ padding in yards) → SVG viewBox, without aspect fitting. */
export function boundsToViewBox(b: ArtBounds, pad = 0): ViewBox {
  return {
    x: b.minX - pad,
    y: sy(b.maxY) - pad,
    width: b.maxX - b.minX + 2 * pad,
    height: b.maxY - b.minY + 2 * pad,
  };
}

/** SVG viewBox → field-space bounds. */
export function viewBoxToBounds(vb: ViewBox): ArtBounds {
  return { minX: vb.x, maxX: vb.x + vb.width, minY: sy(vb.y + vb.height), maxY: sy(vb.y) };
}

export type FitMode = "contain" | "cover";

/**
 * A viewBox around `b` (+ `pad` yards) whose aspect equals `aspect` (rendered width / height), centered on the
 * bounds. "contain" grows the short side (everything stays visible); "cover" trims the long side.
 * Matching the aspect exactly keeps pxPerYard identical on both axes, so preserveAspectRatio never letterboxes.
 */
export function fitViewBox(b: ArtBounds, aspect: number, opts: { pad?: number; mode?: FitMode } = {}): ViewBox {
  const raw = boundsToViewBox(b, opts.pad ?? 0);
  if (!(aspect > 0) || !Number.isFinite(aspect)) return raw;
  const cx = raw.x + raw.width / 2;
  const cy = raw.y + raw.height / 2;
  const tooWide = raw.width / raw.height > aspect;
  const grow = (opts.mode ?? "contain") === "contain";
  let width = raw.width;
  let height = raw.height;
  if (tooWide === grow) height = width / aspect;
  else width = height * aspect;
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

/** Screen pixels per yard for a viewBox drawn into a box of `widthPx` × `heightPx` (preserveAspectRatio meet). */
export function pxPerYard(vb: ViewBox, widthPx: number, heightPx: number): number {
  if (!(vb.width > 0) || !(vb.height > 0)) return 0;
  return Math.min(widthPx / vb.width, heightPx / vb.height);
}

// ───────────────────────────── depth compression (cards) ─────────────────────────────

/**
 * A monotonic field-y → drawn-y mapping. Play cards draw depth compressed like Madden's own art (true scale near the
 * LOS, then easing toward a limit) so deep routes and zones end inside the card with their arrowheads. Detail and
 * editor fields use TRUE_DEPTH. Only y changes; x stays true (sideline to sideline).
 */
export interface DepthScale {
  /** Stable id for cache/memo keys ("" = true scale). */
  readonly id: string;
  /** Field y → drawn y (strictly increasing). */
  map(y: number): number;
  /** Drawn y → field y (inverse of map; ±Infinity past the curve's limits). */
  unmap(y: number): number;
  /** d map / dy at y: 1 = true scale, smaller = squashed. */
  slope(y: number): number;
  /** Drawn limits the curve approaches (±Infinity for true scale). */
  readonly lo: number;
  readonly hi: number;
  /** Cards: projectArt cuts paths where they cross |x| = xLimit (just inside the sidelines), keeping their cap. */
  readonly xLimit?: number;
  /**
   * Cards only: the game paints its yard lines closer together than the routes run (a 6.5 yd route reaches the 10-yard
   * mark), so markings and the first-down line are drawn at y × markScale while players and routes keep their yards.
   */
  readonly markScale?: number;
}

/**
 * In game the painted yard lines sit closer together than the routes run: measured on Smoke Curls (7.5 yd stems end on
 * the 20-yard line, 10 yd from the ball), so every Studio field draws its markings at 0.65 of the route scale.
 */
export const GAME_MARK_SCALE = 0.65;

const markDepths = new WeakMap<DepthScale, DepthScale>();

/** The scale the field markings use: `depth` itself, or `depth` with the yard lines pulled in by its markScale. */
export function markingDepth(depth: DepthScale): DepthScale {
  const k = depth.markScale ?? GAME_MARK_SCALE;
  if (!k || k === 1) return depth;
  let m = markDepths.get(depth);
  if (!m) {
    m = Object.freeze({
      id: `${depth.id}|mark${k}`,
      map: (y: number) => depth.map(y * k),
      unmap: (y: number) => depth.unmap(y) / k,
      slope: (y: number) => depth.slope(y * k) * k,
      lo: depth.lo,
      hi: depth.hi,
      xLimit: depth.xLimit,
    });
    markDepths.set(depth, m);
  }
  return m;
}

export const TRUE_DEPTH: DepthScale = Object.freeze({
  id: "",
  map: (y: number) => y,
  unmap: (y: number) => y,
  slope: () => 1,
  lo: -Infinity,
  hi: Infinity,
});

export interface DepthCurve {
  /** True scale up to this many yards past the LOS… */
  knee: number;
  /** …then an exponential ease that never passes knee + reach (slope 1 at the knee, so the bend is smooth). */
  reach: number;
  /** Optional backfield compression: true scale down to backKnee (≤ 0), then easing toward backKnee − backReach. */
  backKnee?: number;
  backReach?: number;
  /** Optional lateral cut for projectArt (see DepthScale.xLimit). */
  xLimit?: number;
  /** See DepthScale.markScale. */
  markScale?: number;
}

/** A Field viewport (drawn yards) that may carry the depth scale it was designed for (card viewports do). */
export interface FieldViewport extends ArtBounds {
  depth?: DepthScale;
}

const ease = (d: number, r: number) => r * (1 - Math.exp(-d / r));
const unease = (e: number, r: number) => (e >= r ? Infinity : -r * Math.log(1 - e / r));

/** Depth compression: identity between backKnee and knee, smooth saturation outside. */
export function compressedDepth(c: DepthCurve): DepthScale {
  const { knee, reach } = c;
  const back = c.backKnee !== undefined && (c.backReach ?? 0) > 0;
  const bk = back ? c.backKnee! : -Infinity;
  const br = back ? c.backReach! : 1;
  const xLimit = c.xLimit !== undefined && c.xLimit > 0 ? c.xLimit : undefined;
  return Object.freeze({
    id: `depth:${knee}/${reach}${back ? `/${bk}/${br}` : ""}${xLimit ? `|x${xLimit}` : ""}`,
    map: (y: number) => (y > knee ? knee + ease(y - knee, reach) : y < bk ? bk - ease(bk - y, br) : y),
    unmap: (y: number) => (y > knee ? knee + unease(y - knee, reach) : y < bk ? bk - unease(bk - y, br) : y),
    slope: (y: number) => (y > knee ? Math.exp(-(y - knee) / reach) : y < bk ? Math.exp(-(bk - y) / br) : 1),
    lo: back ? bk - br : -Infinity,
    hi: knee + reach,
    xLimit,
    markScale: c.markScale,
  });
}

/**
 * The polyline up to where it first leaves |x| ≤ limit (the crossing point becomes its new end), or the points
 * unchanged when it stays inside or already starts outside.
 */
export function cutAtX(points: Vec[], limit: number): Vec[] {
  if (!points.length || Math.abs(points[0].x) > limit) return points;
  for (let i = 1; i < points.length; i++) {
    const b = points[i];
    if (Math.abs(b.x) <= limit) continue;
    const a = points[i - 1];
    const edge = b.x > 0 ? limit : -limit;
    const t = (edge - a.x) / (b.x - a.x);
    const out = points.slice(0, i);
    if (t > 1e-6) out.push({ x: edge, y: a.y + (b.y - a.y) * t });
    return out.length >= 2 ? out : points.slice(0, i + 1);
  }
  return points;
}

const projected = new WeakMap<PlayArt, Map<string, PlayArt>>();

/**
 * The art as drawn through `depth`: every point's y mapped (players, paths, bounds); a zone keeps its centre on the
 * mapped centre and its ry becomes half the mapped span. TRUE_DEPTH returns `art` itself; otherwise the result is
 * memoized per art object + scale (same object every call).
 */
export function projectArt(art: PlayArt, depth: DepthScale): PlayArt {
  if (!depth.id) return art;
  let byScale = projected.get(art);
  if (!byScale) projected.set(art, (byScale = new Map()));
  const hit = byScale.get(depth.id);
  if (hit) return hit;
  const pv = (v: Vec): Vec => ({ x: v.x, y: depth.map(v.y) });
  const lim = depth.xLimit;
  const out: PlayArt = {
    ...art,
    players: art.players.map((p) => ({ ...p, base: pv(p.base), at: pv(p.at), snap: pv(p.snap) })),
    paths: art.paths.map((p) => {
      const points = p.points.map(pv);
      const cut = lim ? cutAtX(points, lim) : points;
      if (cut === points) return { ...p, points };
      const q: ArtPath = { ...p, points: cut };
      if (p.vertices) q.vertices = p.vertices.filter((v) => v.index < cut.length);
      return q;
    }),
    zones: art.zones.map((z) => ({
      ...z,
      center: pv(z.center),
      ry: (depth.map(z.center.y + z.ry) - depth.map(z.center.y - z.ry)) / 2,
    })),
    bounds: { ...art.bounds, minY: depth.map(art.bounds.minY), maxY: depth.map(art.bounds.maxY) },
  };
  byScale.set(depth.id, out);
  return out;
}

// ───────────────────────────── zoom / pan ─────────────────────────────

/** Interactive view state relative to the fitted base viewBox. `center` is in SVG coordinates. */
export interface ViewState {
  zoom: number;
  center: Vec;
}

export interface ViewLimits {
  minZoom: number;
  maxZoom: number;
  /** Region (SVG coords) the view center must stay inside. */
  centerBox: ViewBox;
}

export function viewBoxFor(base: ViewBox, view: ViewState | null): ViewBox {
  if (!view) return base;
  const width = base.width / view.zoom;
  const height = base.height / view.zoom;
  return { x: view.center.x - width / 2, y: view.center.y - height / 2, width, height };
}

export function baseView(base: ViewBox): ViewState {
  return { zoom: 1, center: { x: base.x + base.width / 2, y: base.y + base.height / 2 } };
}

function clampCenter(c: Vec, box: ViewBox): Vec {
  return { x: clamp(c.x, box.x, box.x + box.width), y: clamp(c.y, box.y, box.y + box.height) };
}

/** Multiply the zoom by `factor`, keeping the SVG point `anchor` fixed on screen. */
export function zoomAt(view: ViewState, factor: number, anchor: Vec, limits: ViewLimits): ViewState {
  const zoom = clamp(view.zoom * factor, limits.minZoom, limits.maxZoom);
  const k = view.zoom / zoom;
  const center = {
    x: anchor.x - (anchor.x - view.center.x) * k,
    y: anchor.y - (anchor.y - view.center.y) * k,
  };
  return { zoom, center: clampCenter(center, limits.centerBox) };
}

/** Move the view by a screen-pixel delta (content follows the pointer). */
export function panBy(view: ViewState, dxPx: number, dyPx: number, ppy: number, limits: ViewLimits): ViewState {
  if (!(ppy > 0)) return view;
  const center = { x: view.center.x - dxPx / ppy, y: view.center.y - dyPx / ppy };
  return { zoom: view.zoom, center: clampCenter(center, limits.centerBox) };
}

// ───────────────────────────── field markings ─────────────────────────────

/** x of the middle of the field relative to the ball: ball on the left hash → the middle is to its right. */
export function fieldMiddleX(ballSpot: BallSpot = "middle"): number {
  return ballSpot === "left" ? HASH_HALF : ballSpot === "right" ? -HASH_HALF : 0;
}

/** [left, right] hash columns, relative to the ball. */
export function hashXs(ballSpot: BallSpot = "middle"): [number, number] {
  const m = fieldMiddleX(ballSpot);
  return [m - HASH_HALF, m + HASH_HALF];
}

/** [left, right] sidelines, relative to the ball. */
export function sidelineXs(ballSpot: BallSpot = "middle"): [number, number] {
  const m = fieldMiddleX(ballSpot);
  return [m - HALF_WIDTH, m + HALF_WIDTH];
}

/** Field y range including both 10-yd end zones, for an LOS on the offense's own `los`. */
export function fieldYRange(los = DEFAULT_LOS_YARD_LINE): { minY: number; maxY: number } {
  return { minY: -los - 10, maxY: 100 - los + 10 };
}

/** Painted number for a yard line measured from the offense's goal (0–100): 10…50…10 on the 10s, else undefined. */
export function yardNumber(yard: number): number | undefined {
  if (yard <= 0 || yard >= 100 || yard % 10 !== 0) return undefined;
  return yard <= 50 ? yard : 100 - yard;
}

export interface YardLine {
  /** Field y (yards from the LOS). */
  y: number;
  /** Yards from the offense's own goal line, 0–100. */
  yard: number;
  /** Every 10 yards (and the goal lines). */
  major: boolean;
  goal: boolean;
  /** Painted number on the 10s. */
  number?: number;
}

/** 5-yard lines whose y lies in [minY, maxY], between the goal lines, ascending. */
export function yardLines(minY: number, maxY: number, los = DEFAULT_LOS_YARD_LINE): YardLine[] {
  const out: YardLine[] = [];
  const from = Math.max(0, Math.ceil((los + minY) / 5 - 1e-9) * 5);
  const to = Math.min(100, los + maxY);
  for (let yard = from; yard <= to + 1e-9; yard += 5) {
    out.push({
      y: yard - los,
      yard,
      major: yard % 10 === 0,
      goal: yard === 0 || yard === 100,
      number: yardNumber(yard),
    });
  }
  return out;
}

/** Whole-yard tick positions (field y) in [minY, maxY] that are not on a 5-yard line, inside the field of play. */
export function yardTicks(minY: number, maxY: number, los = DEFAULT_LOS_YARD_LINE): number[] {
  const out: number[] = [];
  const from = Math.max(1, Math.ceil(los + minY - 1e-9));
  const to = Math.min(99, Math.floor(los + maxY + 1e-9));
  for (let yard = from; yard <= to; yard++) if (yard % 5 !== 0) out.push(yard - los);
  return out;
}

/** Coordinate readout with a true minus sign and one decimal: −4.5, 12.3, 0.0. */
export function formatCoord(v: number): string {
  const r = Math.round(v * 10) / 10;
  const s = Math.abs(r).toFixed(1);
  return r < 0 ? `−${s}` : s;
}

/** Union of bounds (ignores undefined). */
export function unionBounds(...bs: (ArtBounds | undefined)[]): ArtBounds | undefined {
  let out: ArtBounds | undefined;
  for (const b of bs) {
    if (!b) continue;
    out = out
      ? { minX: Math.min(out.minX, b.minX), maxX: Math.max(out.maxX, b.maxX), minY: Math.min(out.minY, b.minY), maxY: Math.max(out.maxY, b.maxY) }
      : { ...b };
  }
  return out;
}

/** Bounds of a set of field points (undefined when empty). */
export function boundsOfPoints(points: Iterable<Vec>): ArtBounds | undefined {
  let b: ArtBounds | undefined;
  for (const p of points) {
    if (!b) b = { minX: p.x, maxX: p.x, minY: p.y, maxY: p.y };
    else {
      if (p.x < b.minX) b.minX = p.x;
      if (p.x > b.maxX) b.maxX = p.x;
      if (p.y < b.minY) b.minY = p.y;
      if (p.y > b.maxY) b.maxY = p.y;
    }
  }
  return b;
}

/** Square bounds around `b` (+ pad), at least `minSize` yards across — thumbnails. */
export function squareAround(b: ArtBounds, pad: number, minSize: number): ArtBounds {
  const size = Math.max(b.maxX - b.minX + 2 * pad, b.maxY - b.minY + 2 * pad, minSize);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return { minX: cx - size / 2, maxX: cx + size / 2, minY: cy - size / 2, maxY: cy + size / 2 };
}

/** SVG polyline `points` attribute for field points. */
export function svgPoints(points: Vec[]): string {
  let s = "";
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    s += `${i ? " " : ""}${r3(p.x)},${r3(-p.y)}`;
  }
  return s;
}

/** Round to 3 decimals for compact attribute strings (sub-millimetre at any zoom we allow). */
export function r3(n: number): number {
  return Math.round(n * 1000) / 1000 || 0;
}

// ───────────────────────────── path ends (caps) ─────────────────────────────

const EPS = 1e-6;

/**
 * Direction of a path's last non-degenerate segment, as an SVG rotation in degrees (0 = +x, clockwise positive
 * because SVG y points down). `fallbackFieldDeg` (field degrees, 90 = upfield) is used for single-point paths.
 */
export function endAngleSvg(points: Vec[], fallbackFieldDeg = 90): number {
  const end = points[points.length - 1];
  for (let i = points.length - 2; i >= 0; i--) {
    const dx = end.x - points[i].x;
    const dy = end.y - points[i].y;
    if (Math.abs(dx) > EPS || Math.abs(dy) > EPS) return (Math.atan2(-dy, dx) * 180) / Math.PI;
  }
  return -fallbackFieldDeg;
}

/** The polyline shortened by `d` yards at its end (never past `maxFrac` of the last segment). */
export function trimEnd(points: Vec[], d: number, maxFrac = 0.85): Vec[] {
  if (points.length < 2 || !(d > 0)) return points;
  const end = points[points.length - 1];
  const prev = points[points.length - 2];
  const segLen = Math.hypot(end.x - prev.x, end.y - prev.y);
  if (segLen < EPS) return points;
  const cut = Math.min(d, segLen * maxFrac);
  const t = (segLen - cut) / segLen;
  const out = points.slice(0, -1);
  out.push({ x: prev.x + (end.x - prev.x) * t, y: prev.y + (end.y - prev.y) * t });
  return out;
}
