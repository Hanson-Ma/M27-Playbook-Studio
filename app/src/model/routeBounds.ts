// Does a route stay on the field? (pure)
//
// Field space as everywhere: x = yards from the ball, y = yards from the line of scrimmage. The check assumes the ball
// in the middle of the field (sidelines at ±26.67) and the LOS on the offense's own 35 (LOS_YARD_LINE — what the
// field draws), so the back of the far end zone is 75 yd downfield. A route can run off the field when it is put on
// a player it wasn't drawn for — typically a saved route (My Routes) or a preset drawn for a slot receiver, mirrored
// onto a wide receiver: its outward legs carry him past the sideline.
//
// fitChainToField shortens only the legs that head toward the edge being crossed (by one common factor), so depth
// stems, inward legs, directions and therefore every cut stay as drawn; the route ends 1 yd inside the line.
import { HALF_WIDTH, LOS_YARD_LINE, polar, sub } from "./geometry";
import { fromEditableRoute, r2, routePoints, routeStart, toEditableRoute, type EditableRoute } from "./routes";
import type { Step, Vec } from "./types";

export const FIELD_BOUNDS = {
  /** |x| beyond this is out of bounds (ball in the middle of the field). */
  maxAbsX: HALF_WIDTH,
  /** y beyond this is past the back of the far end zone (LOS on the offense's own 35). */
  maxY: 100 - LOS_YARD_LINE + 10,
} as const;

/** "Fit to field" pulls the route back to this many yards inside the line it crossed. */
export const FIT_MARGIN = 1;

const EPS = 1e-6;

export type OffFieldEdge = "left" | "right" | "deep";

export interface OffField {
  /** The line the route crosses farthest. */
  edge: OffFieldEdge;
  /** Yards past that line (> 0). */
  by: number;
  /** Index of the worst point in the route's points ([start, end of leg 0, …]). */
  at: number;
}

/** How far past a field edge (positive = off the field) a point is, per edge. */
function overshoot(p: Vec, edge: OffFieldEdge): number {
  if (edge === "right") return p.x - FIELD_BOUNDS.maxAbsX;
  if (edge === "left") return -FIELD_BOUNDS.maxAbsX - p.x;
  return p.y - FIELD_BOUNDS.maxY;
}

const EDGES: OffFieldEdge[] = ["left", "right", "deep"];

/**
 * The worst place a polyline leaves the field, or undefined when it stays on it. The field is a rectangle, so
 * checking the corners of the route is enough.
 */
export function pointsOffField(points: readonly Vec[]): OffField | undefined {
  let worst: OffField | undefined;
  points.forEach((p, at) => {
    for (const edge of EDGES) {
      const by = overshoot(p, edge);
      if (by > EPS && (!worst || by > worst.by)) worst = { edge, by, at };
    }
  });
  return worst;
}

/** The route's points for a player lined up at `alignment` (start after motion / realignment, then each leg's end). */
export function chainPoints(alignment: Vec, steps: readonly Step[]): Vec[] {
  const route = toEditableRoute(steps);
  return routePoints(routeStart(alignment, route.prefix, steps), route);
}

/** Where a player's chain leaves the field, or undefined. */
export function chainOffField(alignment: Vec, steps: readonly Step[]): OffField | undefined {
  return pointsOffField(chainPoints(alignment, steps));
}

/** "runs 8 yd past the left sideline" / "runs 3 yd past the back of the end zone". */
export function offFieldText(o: OffField): string {
  const yd = o.by < 0.95 ? "under a yard" : `${Math.round(o.by)} yd`;
  return o.edge === "deep" ? `runs ${yd} past the back of the end zone` : `runs ${yd} past the ${o.edge} sideline`;
}

/** Component of a vector toward an edge (positive = toward it). */
function toward(v: Vec, edge: OffFieldEdge): number {
  return edge === "right" ? v.x : edge === "left" ? -v.x : v.y;
}

/**
 * The factor (0 < k < 1) that shortens the legs heading toward `edge` (legs ≥ `firstLeg` only) so the route stays
 * `margin` yd inside it; undefined when shortening those legs can't bring it back (the rest alone goes that far).
 */
function fitFactor(start: Vec, route: EditableRoute, edge: OffFieldEdge, firstLeg: number, margin: number): number | undefined {
  const pts = routePoints(start, route);
  const limit = (edge === "deep" ? FIELD_BOUNDS.maxY : FIELD_BOUNDS.maxAbsX) - margin;
  let fixed = toward(start, edge);
  let scalable = 0;
  let k = 1;
  route.legs.forEach((leg, i) => {
    const legVec = leg.distance > 0 ? polar(leg.direction, leg.distance) : { x: 0, y: 0 };
    const moved = sub(pts[i + 1], pts[i]);
    // Steps between legs that move the player (rare) count as fixed.
    fixed += toward(moved, edge) - toward(legVec, edge);
    const c = toward(legVec, edge);
    if (i >= firstLeg && c > EPS) scalable += c;
    else fixed += c;
    const at = fixed + scalable;
    if (at <= limit + EPS) return;
    if (scalable <= EPS || fixed > limit) k = -1;
    else k = Math.min(k, (limit - fixed) / scalable);
  });
  return k > EPS && k < 1 ? k : undefined;
}

/**
 * The chain with its outward legs shortened so the route stays on the field (see the file header), or undefined
 * when it already does or can't be fixed that way. `firstLeg`: legs before it (a kept precan) are left alone.
 */
export function fitChainToField(alignment: Vec, steps: readonly Step[], firstLeg = 0): Step[] | undefined {
  if (!chainOffField(alignment, steps)) return undefined;
  let route = toEditableRoute(steps);
  const start = routeStart(alignment, route.prefix, steps);
  // Each pass fixes the worst edge; a route that crosses two edges needs a second pass.
  for (let pass = 0; pass < 4; pass++) {
    const off = pointsOffField(routePoints(start, route));
    if (!off) break;
    // 1 yd inside the line when the rest of the route allows it, else just inside.
    const k = fitFactor(start, route, off.edge, firstLeg, FIT_MARGIN) ?? fitFactor(start, route, off.edge, firstLeg, 0.05);
    if (k === undefined) return undefined;
    route = {
      ...route,
      legs: route.legs.map((leg, i) => {
        if (i < firstLeg || leg.distance <= 0) return leg;
        const c = toward(polar(leg.direction, leg.distance), off.edge);
        // Floor at 0.01 yd: a leg never vanishes (its cut and speed stay where they are).
        return c > EPS ? { ...leg, distance: Math.max(0.01, r2(leg.distance * k)) } : leg;
      }),
    };
  }
  if (pointsOffField(routePoints(start, route))) return undefined;
  return fromEditableRoute(route);
}
