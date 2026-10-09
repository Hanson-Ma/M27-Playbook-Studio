// Route model for the play designer (pure, no React): assignment chains ⇄ editable routes (prefix / legs / suffix),
// point geometry (dragging a vertex recomputes only the two adjacent legs), snapping, ReceiverCut conventions,
// parametric route presets, releases, double moves, block tools and AutoMotion builders.
//
// Conventions (docs/FORMATS.md + app/docs/features/designer.md "Verified conventions")
// - A leg (`RunRoute`, `MoveDirection`, `ReceiveHandoff`, `RecievePitch`, `HeadTurnRunRoute`) is a vector
//   `distance` @ absolute `direction` starting where the previous leg ended.
// - ReceiverCut direction = the turn's rotation sense: LEFT = counter-clockwise (heading angle increases),
//   RIGHT = clockwise. Cut type ≈ the turn's magnitude (_22 / _45 / _67 / _90; bigger turns HITCH_COMEBACK).
// - "Inside" = toward the ball: for a player at x > 0 inside is −x (headings > 90), for x < 0 it's +x.
// - Edits never touch what they don't need: untouched legs keep their exact step objects (and every extra field
//   such as facingDirectionOverride), so `fromEditableRoute(toEditableRoute(s))` reproduces `s` byte for byte.
import { qbDropVector } from "./art";
import { add, angleDeg, deltaDeg, len, normDeg, polar, sub } from "./geometry";
import { MECHANICS_TYPES, stripNone } from "./steps";
import type { AutoMotionWaypoint, Step, Vec } from "./types";

// ───────────────────────────── constants ─────────────────────────────

/** Step types the designer edits as legs (vectors). */
export const EDIT_LEG_TYPES = ["RunRoute", "MoveDirection", "ReceiveHandoff", "RecievePitch", "HeadTurnRunRoute"] as const;
const LEG_SET = new Set<string>(EDIT_LEG_TYPES);

export const CUT_LEFT = "RECEIVER_CUT_DIR_LEFT";
export const CUT_RIGHT = "RECEIVER_CUT_DIR_RIGHT";
export const CUT_PREFIX = "RECEIVER_CUT_ANGLE_";

/** Numbered cut types (a plain turn). Drags retune these to the new turn; named cuts (curl, stutter…) stay. */
export const NUMBERED_CUTS = ["RECEIVER_CUT_ANGLE_22", "RECEIVER_CUT_ANGLE_45", "RECEIVER_CUT_ANGLE_67", "RECEIVER_CUT_ANGLE_90"];

/** Cut types used by double moves (FORMATS.md §3). */
export const DOUBLE_MOVE_CUTS = [
  "RECEIVER_CUT_ANGLE_STUTTER",
  "RECEIVER_CUT_ANGLE_STUTTER_STREAK",
  "RECEIVER_CUT_ANGLE_SLANT_AND_GO",
  "RECEIVER_CUT_ANGLE_HITCH_GO_INSIDE",
  "RECEIVER_CUT_ANGLE_HITCH_GO_OUTSIDE",
  "RECEIVER_CUT_ANGLE_OUT_AND_UP",
  "RECEIVER_CUT_ANGLE_STICKNOD",
  "RECEIVER_CUT_ANGLE_ZIG",
];

/** Default grid / angle snapping (yards / degrees). */
export const SNAP_GRID = 0.5;
export const SNAP_ANGLE = 5;

const MOTION_STEP_TYPES = new Set(["AutoMotion", "AutoMotionSnap", "OverrideFormPos"]);
const MECH = new Set<string>(MECHANICS_TYPES);
/** Steps that stay in front of the legs when a chain without legs gets its first one. */
const LEADING_TYPES = new Set([
  ...MOTION_STEP_TYPES,
  ...MECHANICS_TYPES,
  "InitialAnim",
  "Delay",
  "QBScramble",
  "FaceDirection",
  "DefAlignment",
  "DefMovement",
  "ShowBlitz",
]);

export type RouteSide = "left" | "right";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const num = (v: unknown, d = 0): number => (isNum(v) ? v : d);

/** Round to 0.01 (the precision recomputed legs are written with). */
export const r2 = (n: number): number => Math.round(n * 100) / 100 + 0;

export function isEditLeg(step: Step | undefined): boolean {
  return !!step && LEG_SET.has(step.type);
}

/** x < 0 → "left", otherwise "right" (the QB and center count as right). */
export function sideOfX(x: number): RouteSide {
  return x < 0 ? "left" : "right";
}

// ───────────────────────────── editable route ─────────────────────────────

export interface EditableLeg {
  type: string;
  distance: number;
  direction: number;
  /** undefined when the source step has no speed (HeadTurnRunRoute). */
  speed?: number;
  /**
   * Steps run between the previous leg and this one, in order (ReceiverCut, RunRouteFakeOut, Delay, PassBlock…).
   * The cut at vertex k (the end of leg k) lives in `legs[k + 1].before`; the last vertex's cut leads `suffix`.
   * Always empty for the first leg (everything before it is `prefix`).
   */
  before: Step[];
  /** The step this leg came from: its other fields and key order survive edits. Absent for new legs. */
  source?: Step;
}

export interface EditableRoute {
  /** Steps before the first leg (InitialAnim, AutoMotion, OverrideFormPos, handoff precans…). */
  prefix: Step[];
  legs: EditableLeg[];
  /** Steps after the last leg (end cut, Delay, GetOpen, blocks, RunEndZone, None…). */
  suffix: Step[];
}

function legOf(step: Step, before: Step[]): EditableLeg {
  const leg: EditableLeg = {
    type: step.type,
    distance: num(step.distance),
    direction: num(step.direction),
    before,
    source: step,
  };
  if (isNum(step.speed)) leg.speed = step.speed;
  return leg;
}

/** Split a chain into prefix / legs / suffix. Lossless: `fromEditableRoute` rebuilds the exact chain. */
export function toEditableRoute(steps: readonly Step[]): EditableRoute {
  const legIdx: number[] = [];
  steps.forEach((s, i) => LEG_SET.has(s.type) && legIdx.push(i));
  if (!legIdx.length) {
    let cut = 0;
    while (cut < steps.length && LEADING_TYPES.has(steps[cut].type)) cut++;
    return { prefix: steps.slice(0, cut), legs: [], suffix: steps.slice(cut) };
  }
  const first = legIdx[0];
  const last = legIdx[legIdx.length - 1];
  const legs: EditableLeg[] = [];
  let pending: Step[] = [];
  for (let i = first; i <= last; i++) {
    const s = steps[i];
    if (LEG_SET.has(s.type)) {
      legs.push(legOf(s, pending));
      pending = [];
    } else pending.push(s);
  }
  return { prefix: steps.slice(0, first), legs, suffix: steps.slice(last + 1) };
}

/** The step for a leg: the source step itself when nothing changed, else a copy with the edited fields. */
export function legToStep(leg: EditableLeg): Step {
  const src = leg.source;
  if (!src) {
    const s: Step = { type: leg.type, distance: leg.distance, direction: leg.direction };
    if (leg.speed !== undefined) s.speed = leg.speed;
    return s;
  }
  const same =
    src.type === leg.type &&
    leg.distance === num(src.distance) &&
    leg.direction === num(src.direction) &&
    (leg.speed === undefined || leg.speed === src.speed);
  if (same) return src;
  const out: Step = { ...src, type: leg.type };
  if (leg.distance !== num(src.distance)) out.distance = leg.distance;
  if (leg.direction !== num(src.direction)) out.direction = leg.direction;
  if (leg.speed !== undefined && leg.speed !== src.speed) out.speed = leg.speed;
  return out;
}

export function fromEditableRoute(route: EditableRoute): Step[] {
  const out: Step[] = [...route.prefix];
  for (const leg of route.legs) out.push(...leg.before, legToStep(leg));
  out.push(...route.suffix);
  return out;
}

/** Edit a chain through its editable route. */
export function editRoute(steps: readonly Step[], fn: (r: EditableRoute) => EditableRoute): Step[] {
  return fromEditableRoute(fn(toEditableRoute(steps)));
}

// ───────────────────────────── points ─────────────────────────────

/**
 * Where a chain's legs start: the alignment, moved by OverrideFormPos (absolute) and by the movement steps in
 * front of the legs (AutoMotion → last waypoint, QB drops, handoff turns) — the same rules as the art engine.
 */
export function routeStart(alignment: Vec, prefix: readonly Step[], allSteps: readonly Step[] = prefix): Vec {
  const ofp = allSteps.find((s) => s.type === "OverrideFormPos" && isNum(s.offsetX) && isNum(s.offsetY));
  let cur: Vec = ofp ? { x: ofp.offsetX as number, y: ofp.offsetY as number } : { x: alignment.x, y: alignment.y };
  for (const s of prefix) cur = stepMove(cur, s);
  return cur;
}

/** Position after a non-leg step that moves the player (motion waypoints, QB drops…); others return `cur`. */
function stepMove(cur: Vec, s: Step): Vec {
  switch (s.type) {
    case "AutoMotion": {
      const wps = Array.isArray(s.waypoints) ? (s.waypoints as AutoMotionWaypoint[]) : [];
      for (let i = wps.length - 1; i >= 0; i--) {
        const p = wps[i]?.position;
        if (p && isNum(p.x) && isNum(p.y)) return { x: p.x, y: p.y };
      }
      return cur;
    }
    case "QBScramble": {
      const v = qbDropVector(s);
      return v ? add(cur, v) : cur;
    }
    case "HandOffTurn":
      return add(cur, polar(num(s.direction, 270), 1.5));
    case "OptionRun": {
      const rt = String(s.runType ?? "");
      return add(cur, polar(/LEFT/.test(rt) ? 165 : /RIGHT/.test(rt) ? 15 : 90, 4));
    }
    default:
      return cur;
  }
}

/** [start, end of leg 0, end of leg 1, …]. Vertex k (0-based) is points[k + 1]. */
export function routePoints(start: Vec, route: EditableRoute): Vec[] {
  const pts: Vec[] = [start];
  let cur = start;
  for (const leg of route.legs) {
    for (const b of leg.before) cur = stepMove(cur, b);
    if (leg.distance > 0) cur = add(cur, polar(leg.direction, leg.distance));
    pts.push(cur);
  }
  return pts;
}

/** Vector between two points as leg numbers (0.01 precision). A zero-length leg keeps `fallbackDir`. */
export function legBetween(a: Vec, b: Vec, fallbackDir = 90): { distance: number; direction: number } {
  const d = sub(b, a);
  const distance = r2(len(d));
  if (distance === 0) return { distance: 0, direction: fallbackDir };
  let direction = r2(angleDeg(d.x, d.y));
  if (direction >= 360) direction = 0;
  return { distance, direction };
}

function withLegVector(leg: EditableLeg, a: Vec, b: Vec): EditableLeg {
  const v = legBetween(a, b, leg.direction);
  if (v.distance === leg.distance && v.direction === leg.direction) return leg;
  return { ...leg, ...v };
}

/** Heading of leg k (degrees). */
export function legHeading(route: EditableRoute, k: number): number | undefined {
  return route.legs[k]?.direction;
}

// ───────────────────────────── snapping ─────────────────────────────

export interface SnapOptions {
  /** Distance step (yd). Default 0.5. */
  grid?: number;
  /** Angle step (deg). Default 5. */
  angle?: number;
  /** No snapping. */
  free?: boolean;
}

/** Snap a point to the field grid. */
export function snapToGrid(p: Vec, grid = SNAP_GRID): Vec {
  return { x: r2(Math.round(p.x / grid) * grid), y: r2(Math.round(p.y / grid) * grid) };
}

/**
 * Snap `p` relative to `from`: the leg's angle to `angle` degrees and its length to `grid` yards, so the
 * written leg reads like the library's ("7 yd @ 45°"). Free mode only rounds to 0.01.
 */
export function snapFrom(from: Vec, p: Vec, opts: SnapOptions = {}): Vec {
  if (opts.free) return { x: r2(p.x), y: r2(p.y) };
  const grid = opts.grid ?? SNAP_GRID;
  const step = opts.angle ?? SNAP_ANGLE;
  const d = sub(p, from);
  const dist = Math.round(len(d) / grid) * grid;
  if (dist <= 0) return from;
  const ang = Math.round(angleDeg(d.x, d.y) / step) * step;
  return add(from, polar(ang, dist));
}

// ───────────────────────────── cuts ─────────────────────────────

/** Cut type for a turn of `absDelta` degrees (thresholds measured on the library), or undefined below 10°. */
export function cutTypeForTurn(absDelta: number): string | undefined {
  const d = Math.abs(absDelta);
  if (d < 10) return undefined;
  if (d < 34) return "RECEIVER_CUT_ANGLE_22";
  if (d < 57) return "RECEIVER_CUT_ANGLE_45";
  if (d < 80) return "RECEIVER_CUT_ANGLE_67";
  if (d <= 115) return "RECEIVER_CUT_ANGLE_90";
  return "RECEIVER_CUT_ANGLE_HITCH_COMEBACK";
}

/** LEFT = counter-clockwise turn (heading increases), RIGHT = clockwise. Straight → undefined. */
export function cutDirFor(prevHeading: number, nextHeading: number): string | undefined {
  const d = deltaDeg(prevHeading, nextHeading);
  if (Math.abs(d) < 1e-6) return undefined;
  return d > 0 ? CUT_LEFT : CUT_RIGHT;
}

/** The ReceiverCut for turning from `prevHeading` to `nextHeading`, or undefined for a near-straight line. */
export function cutFor(prevHeading: number, nextHeading: number): Step | undefined {
  const d = deltaDeg(prevHeading, nextHeading);
  const cutType = cutTypeForTurn(d);
  if (!cutType) return undefined;
  return { type: "ReceiverCut", direction: d > 0 ? CUT_LEFT : CUT_RIGHT, cutType };
}

/** Rotation sense that turns toward the ball (inside) for a player on `side` running upfield. */
export function insideTurn(side: RouteSide): string {
  return side === "right" ? CUT_LEFT : CUT_RIGHT;
}
export function outsideTurn(side: RouteSide): string {
  return side === "right" ? CUT_RIGHT : CUT_LEFT;
}

/** Steps that sit at vertex k (the end of leg k): between leg k and leg k+1, or the leading cut steps of the suffix. */
export function vertexSteps(route: EditableRoute, k: number): Step[] {
  if (k < route.legs.length - 1) return route.legs[k + 1].before;
  if (k !== route.legs.length - 1) return [];
  const out: Step[] = [];
  for (const s of route.suffix) {
    if (s.type === "ReceiverCut" || s.type === "RunRouteFakeOut") out.push(s);
    else break;
  }
  return out;
}

/** The ReceiverCut at vertex k, if any. */
export function cutAt(route: EditableRoute, k: number): Step | undefined {
  return vertexSteps(route, k).find((s) => s.type === "ReceiverCut");
}

/** RunRouteFakeOut at vertex k, if any. */
export function fakeAt(route: EditableRoute, k: number): Step | undefined {
  return vertexSteps(route, k).find((s) => s.type === "RunRouteFakeOut");
}

function replaceVertexSteps(route: EditableRoute, k: number, fn: (steps: Step[]) => Step[]): EditableRoute {
  if (k < 0 || k >= route.legs.length) return route;
  if (k < route.legs.length - 1) {
    const legs = route.legs.slice();
    legs[k + 1] = { ...legs[k + 1], before: fn(legs[k + 1].before) };
    return { ...route, legs };
  }
  let lead = 0;
  while (lead < route.suffix.length && (route.suffix[lead].type === "ReceiverCut" || route.suffix[lead].type === "RunRouteFakeOut")) lead++;
  return { ...route, suffix: [...fn(route.suffix.slice(0, lead)), ...route.suffix.slice(lead)] };
}

/**
 * Set (or remove with null) the ReceiverCut at vertex k. Without an explicit direction it is computed from the turn
 * (the last vertex turns back toward the ball unless the route already bends).
 */
export function setCutAt(
  route: EditableRoute,
  k: number,
  cut: { cutType: string; direction?: string } | null,
  start?: Vec,
): EditableRoute {
  return replaceVertexSteps(route, k, (steps) => {
    const i = steps.findIndex((s) => s.type === "ReceiverCut");
    if (!cut) return i < 0 ? steps : steps.filter((_, j) => j !== i);
    const direction = cut.direction ?? autoCutDir(route, k, start);
    if (i >= 0) {
      const next = steps.slice();
      next[i] = { ...steps[i], direction, cutType: cut.cutType };
      return next;
    }
    return [{ type: "ReceiverCut", direction, cutType: cut.cutType }, ...steps];
  });
}

/** Direction a cut at vertex k should have: the turn sense, or inside for an end-of-route cut. */
export function autoCutDir(route: EditableRoute, k: number, start?: Vec): string {
  const a = route.legs[k];
  const b = route.legs[k + 1];
  if (a && b) {
    const d = cutDirFor(a.direction, b.direction);
    if (d) return d;
  }
  // End of route (or straight line): turn toward the ball.
  const x = start ? routePoints(start, route)[k + 1]?.x ?? start.x : 0;
  return insideTurn(sideOfX(x));
}

/**
 * Remove the RunRouteFakeOut at vertex k. The designer never adds one: RunRouteFakeOut has no instance in the
 * library's assignments, so the game-side PlayBuilder (which copies each step class's opcode from a library
 * instance) can't build it. Loaded chains that carry one keep it (round trip) and show an error until removed.
 */
export function removeFakeAt(route: EditableRoute, k: number): EditableRoute {
  return replaceVertexSteps(route, k, (steps) => (steps.some((s) => s.type === "RunRouteFakeOut") ? steps.filter((s) => s.type !== "RunRouteFakeOut") : steps));
}

/** Re-fit a numbered cut (22/45/67/90) at vertex k to the current turn (named cuts are left alone). */
export function retuneCut(route: EditableRoute, k: number): EditableRoute {
  const cut = cutAt(route, k);
  const a = route.legs[k];
  const b = route.legs[k + 1];
  if (!cut || !a || !b || !NUMBERED_CUTS.includes(String(cut.cutType))) return route;
  const fit = cutFor(a.direction, b.direction);
  if (!fit || (fit.cutType === cut.cutType && fit.direction === cut.direction)) return route;
  if (!NUMBERED_CUTS.includes(String(fit.cutType))) return route;
  return setCutAt(route, k, { cutType: String(fit.cutType), direction: String(fit.direction) });
}

// ───────────────────────────── vertex editing ─────────────────────────────

export interface VertexEditOptions {
  /** Refit numbered cuts next to the edit (default true). */
  retuneCuts?: boolean;
}

/**
 * Move vertex k (the end of leg k) to `p`: legs k and k + 1 are recomputed (0.01 precision) so every other vertex
 * stays where it was; every other leg keeps its exact numbers.
 */
export function moveVertex(route: EditableRoute, start: Vec, k: number, p: Vec, opts: VertexEditOptions = {}): EditableRoute {
  if (k < 0 || k >= route.legs.length) return route;
  const pts = routePoints(start, route);
  const legs = route.legs.slice();
  legs[k] = withLegVector(legs[k], pts[k], p);
  if (k + 1 < legs.length) legs[k + 1] = withLegVector(legs[k + 1], p, pts[k + 2]);
  let out: EditableRoute = { ...route, legs };
  if (opts.retuneCuts !== false) for (const v of [k - 1, k, k + 1]) out = retuneCut(out, v);
  return out;
}

export interface AppendOptions {
  /** Leg step type (default: the last leg's, else RunRoute). */
  type?: string;
  speed?: number;
  /** Insert a ReceiverCut for the turn into the new leg (default true when the turn is ≥ 10°). */
  autoCut?: boolean;
}

/** Add a vertex at `p` after the last leg (a new leg of the route's leg type). */
export function appendVertex(route: EditableRoute, start: Vec, p: Vec, opts: AppendOptions = {}): EditableRoute {
  const pts = routePoints(start, route);
  const from = pts[pts.length - 1];
  const last = route.legs[route.legs.length - 1];
  const v = legBetween(from, p, last?.direction ?? 90);
  if (v.distance === 0) return route;
  const leg: EditableLeg = {
    type: opts.type ?? last?.type ?? "RunRoute",
    distance: v.distance,
    direction: v.direction,
    speed: opts.speed ?? last?.speed ?? 100,
    before: [],
  };
  let suffix = route.suffix;
  if (last) {
    // The old end vertex becomes a corner: its end-of-route cut moves in front of the new leg (turn-back cuts such as
    // a curl no longer make sense mid-route and are replaced by the computed cut).
    let lead = 0;
    while (lead < suffix.length && (suffix[lead].type === "ReceiverCut" || suffix[lead].type === "RunRouteFakeOut")) lead++;
    const moved = suffix.slice(0, lead).filter((s) => !(s.type === "ReceiverCut" && !NUMBERED_CUTS.includes(String(s.cutType)) && !DOUBLE_MOVE_CUTS.includes(String(s.cutType))));
    suffix = suffix.slice(lead);
    const hasCut = moved.some((s) => s.type === "ReceiverCut");
    const auto = opts.autoCut !== false && !hasCut ? cutFor(last.direction, leg.direction) : undefined;
    leg.before = auto ? [auto, ...moved] : moved;
  }
  return { ...route, legs: [...route.legs, leg], suffix };
}

/** Split leg `legIndex` at `p` (a new vertex inside the leg; both halves keep the leg's type/speed). */
export function insertVertex(route: EditableRoute, start: Vec, legIndex: number, p: Vec): EditableRoute {
  const leg = route.legs[legIndex];
  if (!leg) return route;
  const pts = routePoints(start, route);
  const first = withLegVector(leg, pts[legIndex], p);
  // The second half is a copy of the same step (extra fields such as facingDirectionOverride carry over).
  const second: EditableLeg = { ...leg, ...legBetween(p, pts[legIndex + 1], leg.direction), before: [] };
  const legs = route.legs.slice();
  legs.splice(legIndex, 1, first, second);
  return { ...route, legs };
}

/**
 * Remove vertex k. A middle vertex merges legs k and k + 1 into one leg (from vertex k − 1 to vertex k + 1, keeping
 * leg k's type, speed and the cut in front of it); the last vertex simply drops the last leg.
 */
export function removeVertex(route: EditableRoute, start: Vec, k: number): EditableRoute {
  if (k < 0 || k >= route.legs.length) return route;
  const legs = route.legs.slice();
  if (k === legs.length - 1) {
    legs.pop();
    return { ...route, legs };
  }
  const pts = routePoints(start, route);
  const merged = withLegVector(legs[k], pts[k], pts[k + 2]);
  legs.splice(k, 2, merged);
  return { ...route, legs };
}

/** Patch leg k's numbers / type (numeric leg table). */
export function setLeg(route: EditableRoute, k: number, patch: Partial<Pick<EditableLeg, "type" | "distance" | "direction" | "speed">>): EditableRoute {
  const leg = route.legs[k];
  if (!leg) return route;
  const legs = route.legs.slice();
  legs[k] = { ...leg, ...patch };
  return { ...route, legs };
}

/** Remove every leg (and what sits between them), keeping prefix and suffix. */
export function clearLegs(route: EditableRoute): EditableRoute {
  return { ...route, legs: [] };
}

/**
 * "Clear route": remove the legs from `firstLeg` on (legs before it, e.g. a locked handoff path, stay) and the cut
 * that sat at the old end of the route. The prefix (release, motion, spot) and what he does at the end (Get open,
 * blocks, None) are kept, so drawing new points starts from the same spot. With no leg left, the old route's
 * end-of-route pauses (a comeback's "Delay 2 s") go too: in a chain without legs they would read as a delay before
 * the new route.
 */
export function clearLegsFrom(route: EditableRoute, firstLeg = 0): EditableRoute {
  const from = Math.max(0, firstLeg);
  if (from >= route.legs.length) return route;
  let lead = 0;
  while (lead < route.suffix.length && (route.suffix[lead].type === "ReceiverCut" || route.suffix[lead].type === "RunRouteFakeOut")) lead++;
  if (from === 0) while (lead < route.suffix.length && LEADING_TYPES.has(route.suffix[lead].type)) lead++;
  return { ...route, legs: route.legs.slice(0, from), suffix: route.suffix.slice(lead) };
}

/** Move one AutoMotion waypoint (absolute position, 0.01 precision). */
export function moveWaypoint(steps: readonly Step[], stepIndex: number, waypoint: number, p: Vec): Step[] {
  const s = steps[stepIndex];
  if (!s || s.type !== "AutoMotion" || !Array.isArray(s.waypoints)) return steps.slice();
  const wps = (s.waypoints as AutoMotionWaypoint[]).slice();
  const w = wps[waypoint];
  if (!w) return steps.slice();
  wps[waypoint] = { ...w, position: { ...w.position, x: r2(p.x), y: r2(p.y) } };
  const out = steps.slice();
  out[stepIndex] = { ...s, waypoints: wps };
  return out;
}

// ───────────────────────────── directions by side ─────────────────────────────

/**
 * Absolute heading for a direction measured `fromVertical` degrees off straight upfield toward the inside or the
 * outside of a player on `side` (0 = upfield, 90 = flat across, >90 = backward).
 */
export function sideHeading(side: RouteSide, toward: "in" | "out", fromVertical: number): number {
  const outward = (side === "right") === (toward === "out");
  return r2(normDeg(outward ? 90 - fromVertical : 90 + fromVertical));
}

/** Degrees off vertical and in/out for an absolute heading (inverse of sideHeading). */
export function headingRelative(side: RouteSide, heading: number): { toward: "in" | "out"; fromVertical: number } {
  const d = deltaDeg(90, heading); // + = toward −x
  const towardNeg = d > 0;
  const outward = side === "right" ? !towardNeg : towardNeg;
  return { toward: outward ? "out" : "in", fromVertical: Math.abs(d) };
}

// ───────────────────────────── step builders ─────────────────────────────

export function runLeg(distance: number, direction: number, speed = 100, type = "RunRoute"): Step {
  return { type, distance: r2(distance), direction: r2(normDeg(direction)), speed };
}

export function receiverCut(cutType: string, direction: string): Step {
  return { type: "ReceiverCut", direction, cutType };
}

export const GET_OPEN: Step = Object.freeze({ type: "GetOpen" }) as Step;

// ───────────────────────────── route presets ─────────────────────────────

export type RoutePresetId =
  | "slant"
  | "flat"
  | "out"
  | "in"
  | "curl"
  | "comeback"
  | "hitch"
  | "corner"
  | "post"
  | "go"
  | "fade"
  | "seam"
  | "wheel"
  | "drag"
  | "whip"
  | "snag"
  | "arrow"
  | "angle"
  | "swing"
  | "bubble";

export type ReleaseKind = "none" | "vertical" | "inside" | "outside";
export type RouteEnd = "getopen" | "sit" | "none";

export interface RouteParams {
  /** Stem length (yd). */
  stem: number;
  /** Break angle, degrees off vertical (0 = upfield, 90 = flat across). */
  breakAngle: number;
  breakDir: "in" | "out";
  /** Break leg length (yd). */
  breakLength: number;
  release: ReleaseKind;
  stemSpeed: number;
  breakSpeed: number;
  end: RouteEnd;
}

export interface RoutePresetDef {
  id: RoutePresetId;
  label: string;
  /** Family word for generated assignment names ("Corner" → PBS_Slot_Corner7). */
  family: string;
  /** Append the stem depth to generated names. */
  depthInName: boolean;
  defaults: RouteParams;
  /** Which params the inspector shows. */
  edit: (keyof RouteParams)[];
}

const P = (p: Partial<RouteParams>): RouteParams => ({
  stem: 10,
  breakAngle: 45,
  breakDir: "out",
  breakLength: 15,
  release: "none",
  stemSpeed: 100,
  breakSpeed: 100,
  end: "getopen",
  ...p,
});
const ALL_EDIT: (keyof RouteParams)[] = ["stem", "breakAngle", "breakDir", "breakLength", "release", "stemSpeed", "breakSpeed", "end"];
const STEM_ONLY: (keyof RouteParams)[] = ["stem", "release", "stemSpeed", "end"];

export const ROUTE_PRESETS: RoutePresetDef[] = [
  { id: "slant", label: "Slant", family: "Slant", depthInName: false, defaults: P({ stem: 2, breakAngle: 65, breakDir: "in", breakLength: 18 }), edit: ALL_EDIT },
  { id: "flat", label: "Flat", family: "Flat", depthInName: false, defaults: P({ stem: 1.5, breakAngle: 75, breakDir: "out", breakLength: 12, stemSpeed: 80, breakSpeed: 80 }), edit: ALL_EDIT },
  { id: "out", label: "Out", family: "Out", depthInName: true, defaults: P({ stem: 10, breakAngle: 90, breakDir: "out", breakLength: 12 }), edit: ALL_EDIT },
  { id: "in", label: "In / Dig", family: "Dig", depthInName: true, defaults: P({ stem: 12, breakAngle: 90, breakDir: "in", breakLength: 18 }), edit: ALL_EDIT },
  { id: "curl", label: "Curl", family: "Curl", depthInName: true, defaults: P({ stem: 12, breakDir: "in", end: "sit" }), edit: ["stem", "breakDir", "release", "stemSpeed"] },
  { id: "comeback", label: "Comeback", family: "Comeback", depthInName: true, defaults: P({ stem: 14, breakAngle: 130, breakDir: "out", breakLength: 4 }), edit: ALL_EDIT },
  { id: "hitch", label: "Hitch", family: "Hitch", depthInName: true, defaults: P({ stem: 5, breakDir: "in", end: "sit" }), edit: ["stem", "breakDir", "release", "stemSpeed"] },
  { id: "corner", label: "Corner", family: "Corner", depthInName: true, defaults: P({ stem: 10, breakAngle: 45, breakDir: "out", breakLength: 20 }), edit: ALL_EDIT },
  { id: "post", label: "Post", family: "Post", depthInName: true, defaults: P({ stem: 10, breakAngle: 40, breakDir: "in", breakLength: 25 }), edit: ALL_EDIT },
  { id: "go", label: "Go", family: "Go", depthInName: false, defaults: P({ stem: 30, breakAngle: 0, breakLength: 0 }), edit: STEM_ONLY },
  { id: "fade", label: "Fade", family: "Fade", depthInName: false, defaults: P({ stem: 2.5, breakAngle: 8, breakDir: "out", breakLength: 28, release: "none" }), edit: ALL_EDIT },
  { id: "seam", label: "Seam", family: "Seam", depthInName: false, defaults: P({ stem: 28, breakAngle: 2, breakDir: "in", breakLength: 0 }), edit: ["stem", "breakAngle", "breakDir", "release", "stemSpeed", "end"] },
  { id: "wheel", label: "Wheel", family: "Wheel", depthInName: false, defaults: P({ stem: 7, breakAngle: 10, breakDir: "out", breakLength: 25 }), edit: ALL_EDIT },
  { id: "drag", label: "Drag / Shallow", family: "Shallow", depthInName: false, defaults: P({ stem: 2, breakAngle: 80, breakDir: "in", breakLength: 25 }), edit: ALL_EDIT },
  { id: "whip", label: "Whip", family: "Whip", depthInName: false, defaults: P({ stem: 4, breakAngle: 90, breakDir: "out", breakLength: 12 }), edit: ALL_EDIT },
  { id: "snag", label: "Snag", family: "Snag", depthInName: true, defaults: P({ stem: 5, breakAngle: 15, breakDir: "in", end: "sit" }), edit: ["stem", "breakAngle", "breakDir", "release", "stemSpeed"] },
  { id: "arrow", label: "Arrow", family: "Arrow", depthInName: false, defaults: P({ stem: 1, breakAngle: 55, breakDir: "out", breakLength: 8 }), edit: ALL_EDIT },
  { id: "angle", label: "Angle", family: "Angle", depthInName: false, defaults: P({ stem: 5.5, breakAngle: 55, breakDir: "in", breakLength: 15 }), edit: ALL_EDIT },
  { id: "swing", label: "Swing", family: "Swing", depthInName: false, defaults: P({ stem: 3, breakLength: 14, stemSpeed: 65, breakSpeed: 65 }), edit: ["stem", "breakLength", "stemSpeed", "breakSpeed", "end"] },
  { id: "bubble", label: "Bubble", family: "Bubble", depthInName: false, defaults: P({ stem: 2.5, breakAngle: 126, breakDir: "out", breakLength: 0 }), edit: ["stem", "breakAngle", "stemSpeed", "end"] },
];

export const PRESET_BY_ID: Record<RoutePresetId, RoutePresetDef> = Object.fromEntries(ROUTE_PRESETS.map((p) => [p.id, p])) as Record<
  RoutePresetId,
  RoutePresetDef
>;

export interface PresetContext {
  side: RouteSide;
}

const lr = (side: RouteSide, toward: "in" | "out") => ((side === "right") === (toward === "out") ? "Rt" : "Lt");

/** AssignRouteType for a preset with these params (depth classes follow the library: short < 8, deep ≥ 13). */
export function presetRouteType(id: RoutePresetId, side: RouteSide, p: RouteParams): string {
  const depth = (shortMax: number, deepMin: number, s: string, m: string, d: string) => (p.stem < shortMax ? s : p.stem >= deepMin ? d : m);
  switch (id) {
    case "slant":
      return "AssignRouteType_RR_Slant";
    case "flat":
    case "arrow":
      return `AssignRouteType_RR_Flat_${lr(side, p.breakDir)}`;
    case "out":
      return depth(8, 14, "AssignRouteType_RR_Out_Short", "AssignRouteType_RR_Out_Middle", "AssignRouteType_RR_Out_Deep");
    case "in":
      return depth(8, 13, "AssignRouteType_RR_In_Short", "AssignRouteType_RR_In_Middle", "AssignRouteType_RR_In_Deep");
    case "curl":
      return p.stem >= 14 ? "AssignRouteType_RR_Curl_Long" : "AssignRouteType_RR_Curl_Medium";
    case "comeback":
      return "AssignRouteType_RR_Comeback";
    case "hitch":
      return "AssignRouteType_RR_Hitch";
    case "corner":
      return p.stem >= 12 ? "AssignRouteType_RR_Corner_Deep" : "AssignRouteType_RR_Corner_Middle";
    case "post":
      return p.stem >= 10 ? "AssignRouteType_RR_Post_Deep" : "AssignRouteType_RR_Post_Middle";
    case "go":
    case "seam":
      return "AssignRouteType_RR_Streak";
    case "fade":
      return "AssignRouteType_RR_Fade";
    case "wheel":
      return `AssignRouteType_RR_Wheel_${lr(side, p.breakDir)}`;
    case "drag":
      // The in-game-verified PBS Slot Shallow uses RR_Cross; a flat drag that never climbs is RR_Drag.
      return p.breakAngle >= 88 ? "AssignRouteType_RR_Drag" : "AssignRouteType_RR_Cross";
    case "whip":
      return p.breakDir === "out" ? "AssignRouteType_RR_Whip_Out" : "AssignRouteType_RR_Whip_In";
    case "snag":
      return "AssignRouteType_RR_Slant_Hook";
    case "angle":
      return "AssignRouteType_RR_RB_Angle";
    case "swing":
      return `AssignRouteType_RR_Swing_${lr(side, "out")}`;
    case "bubble":
      return "AssignRouteType_RR_WR_Screen";
  }
}

/** Release leg heading for a player on `side`. Inside = toward the ball (right side ≈ 105°, left ≈ 75°). */
export function releaseHeading(kind: Exclude<ReleaseKind, "none">, side: RouteSide): number {
  if (kind === "vertical") return 90;
  return kind === "inside" ? sideHeading(side, "in", 15) : sideHeading(side, "out", 30);
}

/** The release legs (and opening animation) in front of a route. */
export function releaseSteps(kind: ReleaseKind, side: RouteSide, opts: { length?: number; anim?: string; speed?: number } = {}): Step[] {
  if (kind === "none") return opts.anim ? [{ type: "InitialAnim", anim: opts.anim, direction: 90 }] : [];
  const dir = releaseHeading(kind, side);
  const out: Step[] = [];
  if (opts.anim) out.push({ type: "InitialAnim", anim: opts.anim, direction: dir });
  out.push(runLeg(opts.length ?? 1.5, dir, opts.speed ?? 100));
  return out;
}

function endSteps(end: RouteEnd, lastHeading: number, side: RouteSide, sitCut = "RECEIVER_CUT_ANGLE_CURL", sitDir?: string): Step[] {
  void lastHeading;
  if (end === "none") return [];
  if (end === "sit") return [receiverCut(sitCut, sitDir ?? insideTurn(side)), GET_OPEN];
  return [GET_OPEN];
}

/** Steps (no trailing None) for a preset route. */
export function presetSteps(id: RoutePresetId, ctx: PresetContext, params: Partial<RouteParams> = {}): { steps: Step[]; routeType: string } {
  const def = PRESET_BY_ID[id];
  const p: RouteParams = { ...def.defaults, ...params };
  const { side } = ctx;
  const out: Step[] = releaseSteps(p.release, side);
  const H = (toward: "in" | "out", a: number) => sideHeading(side, toward, a);
  const legPair = (stemDir: number, breakDir: number) => {
    out.push(runLeg(p.stem, stemDir, p.stemSpeed));
    const cut = cutFor(stemDir, breakDir);
    if (cut) out.push(cut);
    if (p.breakLength > 0) out.push(runLeg(p.breakLength, breakDir, p.breakSpeed));
  };
  const breakHeading = H(p.breakDir, p.breakAngle);
  switch (id) {
    case "slant":
    case "out":
    case "in":
    case "corner":
    case "post":
      legPair(90, breakHeading);
      out.push(...endSteps(p.end, breakHeading, side));
      break;
    case "flat":
    case "arrow": {
      const stemDir = H(p.breakDir, id === "flat" ? 55 : 0);
      if (id === "arrow" && p.stem <= 0) {
        out.push(runLeg(p.breakLength, breakHeading, p.breakSpeed));
      } else legPair(id === "arrow" ? 90 : stemDir, breakHeading);
      out.push(...endSteps(p.end, breakHeading, side));
      break;
    }
    case "curl":
    case "hitch": {
      out.push(runLeg(p.stem, 90, p.stemSpeed));
      const dir = p.breakDir === "in" ? insideTurn(side) : outsideTurn(side);
      const cut = id === "curl" ? "RECEIVER_CUT_ANGLE_CURL" : "RECEIVER_CUT_ANGLE_SMASH_QUICK";
      if (p.end === "none") out.push(receiverCut(cut, dir));
      else out.push(receiverCut(cut, dir), GET_OPEN);
      break;
    }
    case "comeback": {
      out.push(runLeg(p.stem, 90, p.stemSpeed));
      out.push(receiverCut("RECEIVER_CUT_ANGLE_HITCH_COMEBACK", p.breakDir === "out" ? outsideTurn(side) : insideTurn(side)));
      if (p.breakLength > 0) out.push(runLeg(p.breakLength, breakHeading, p.breakSpeed));
      out.push(...endSteps(p.end, breakHeading, side));
      break;
    }
    case "go":
      out.push(runLeg(p.stem, 90, p.stemSpeed));
      out.push(...endSteps(p.end, 90, side));
      break;
    case "seam": {
      const h = H(p.breakDir, p.breakAngle);
      out.push(runLeg(p.stem, h, p.stemSpeed));
      out.push(...endSteps(p.end, h, side));
      break;
    }
    case "fade": {
      const rel = H("out", 40);
      out.push(runLeg(p.stem, rel, p.stemSpeed));
      if (p.breakLength > 0) out.push(runLeg(p.breakLength, breakHeading, p.breakSpeed));
      out.push(...endSteps(p.end, breakHeading, side));
      break;
    }
    case "wheel": {
      const stemDir = H("out", 60);
      legPair(stemDir, breakHeading);
      out.push(...endSteps(p.end, breakHeading, side));
      break;
    }
    case "drag": {
      const stemDir = H(p.breakDir, 30);
      legPair(stemDir, breakHeading);
      out.push(...endSteps(p.end, breakHeading, side));
      break;
    }
    case "whip": {
      // Fake one way, then whip back the other: stem 45° toward the opposite side of the break.
      const stemDir = H(p.breakDir === "out" ? "in" : "out", 45);
      out.push(runLeg(p.stem, stemDir, p.stemSpeed));
      out.push(receiverCut("RECEIVER_CUT_ANGLE_HINGECOMEBACK", cutDirFor(stemDir, breakHeading) ?? outsideTurn(side)));
      if (p.breakLength > 0) out.push(runLeg(p.breakLength, breakHeading, p.breakSpeed));
      out.push(...endSteps(p.end, breakHeading, side));
      break;
    }
    case "snag": {
      // PBS Snag slot 5: 1 yd up, 5 yd slightly inside, then sit back toward the ball.
      out.push(runLeg(1, 90, p.stemSpeed));
      const h = H(p.breakDir, p.breakAngle);
      out.push(runLeg(Math.max(0.5, p.stem), h, p.stemSpeed));
      const turn = p.breakDir === "in" ? insideTurn(side) : outsideTurn(side);
      out.push(receiverCut("RECEIVER_CUT_ANGLE_180_PARTIAL", turn));
      if (p.end !== "none") out.push(GET_OPEN);
      break;
    }
    case "angle": {
      const stemDir = H(p.breakDir === "in" ? "out" : "in", 35);
      legPair(stemDir, breakHeading);
      out.push(...endSteps(p.end, breakHeading, side));
      break;
    }
    case "swing": {
      // Rounded out of the backfield: a few short legs bending from flat-back to upfield.
      const sp = p.stemSpeed;
      out.push(runLeg(p.stem, H("out", 110), sp));
      out.push(runLeg(2, H("out", 90), sp));
      out.push(runLeg(Math.max(2, p.breakLength * 0.45), H("out", 80), p.breakSpeed));
      out.push(runLeg(Math.max(2, p.breakLength * 0.4), H("out", 70), p.breakSpeed));
      out.push(runLeg(Math.max(1, p.breakLength * 0.15), H("out", 40), p.breakSpeed));
      out.push(...endSteps(p.end, H("out", 40), side));
      break;
    }
    case "bubble": {
      const h = H("out", p.breakAngle);
      out.push(runLeg(p.stem, h, p.stemSpeed));
      out.push(...endSteps(p.end, h, side));
      break;
    }
  }
  return { steps: out, routeType: presetRouteType(id, side, p) };
}

// ───────────────────────────── route end ─────────────────────────────

const TURN_BACK = /^RECEIVER_CUT_ANGLE_(CURL|HITCH_COMEBACK(_INSIDE)?|180(_PARTIAL)?|DRAG_STOP|HINGECOMEBACK|SMASH(_QUICK)?)$/;

/** How a route ends: GetOpen (find space), sit (turn-back cut + GetOpen) or nothing. */
export function routeEnd(route: EditableRoute): RouteEnd {
  const lastCut = vertexSteps(route, route.legs.length - 1).find((s) => s.type === "ReceiverCut");
  const getOpen = route.suffix.some((s) => s.type === "GetOpen");
  if (lastCut && TURN_BACK.test(String(lastCut.cutType)) && getOpen) return "sit";
  return getOpen ? "getopen" : "none";
}

/**
 * Change the route's end: "getopen" ensures a GetOpen (dropping a sit cut), "sit" adds a curl-style cut (inside
 * turn) + GetOpen, "none" removes both. Other suffix steps (Delay, blocks, None) stay.
 */
export function setRouteEnd(route: EditableRoute, end: RouteEnd, start: Vec): EditableRoute {
  if (!route.legs.length) return route;
  const k = route.legs.length - 1;
  let r = route;
  const cut = cutAt(r, k);
  if (end !== "sit" && cut && TURN_BACK.test(String(cut.cutType))) r = setCutAt(r, k, null);
  if (end === "sit" && !(cut && TURN_BACK.test(String(cut.cutType)))) r = setCutAt(r, k, { cutType: "RECEIVER_CUT_ANGLE_CURL" }, start);
  const has = r.suffix.some((s) => s.type === "GetOpen");
  if (end === "none" && has) r = { ...r, suffix: r.suffix.filter((s) => s.type !== "GetOpen") };
  if (end !== "none" && !has) {
    const suffix = r.suffix.slice();
    let at = 0;
    while (at < suffix.length && ["ReceiverCut", "RunRouteFakeOut", "Delay"].includes(suffix[at].type)) at++;
    suffix.splice(at, 0, { type: "GetOpen" });
    r = { ...r, suffix };
  }
  return r;
}

// ───────────────────────────── releases on an existing route ─────────────────────────────

const WRSTART = /^MOVETYPE_WRSTART/;

/** Release kind of a route: a short first leg (≤ 2.5 yd) followed by another leg in a different direction. */
export function detectRelease(route: EditableRoute, side: RouteSide): ReleaseKind {
  const [a, b] = route.legs;
  if (!a || !b || a.distance > 2.5 || a.type !== "RunRoute") return "none";
  if (Math.abs(deltaDeg(a.direction, b.direction)) < 5) return "none";
  const rel = headingRelative(side, a.direction);
  if (rel.fromVertical <= 3) return "vertical";
  return rel.toward === "in" ? "inside" : "outside";
}

/** The release animation (InitialAnim MOVETYPE_WRSTART*) of a route, if any. */
export function releaseAnim(route: EditableRoute): string | undefined {
  const s = route.prefix.find((x) => x.type === "InitialAnim" && WRSTART.test(String(x.anim ?? "")));
  return s ? String(s.anim) : undefined;
}

/**
 * Replace the route's release: the old release leg (if detected) is removed, a new one is put in front, and the
 * following leg is recomputed so every later vertex stays put. `anim` adds/replaces the WRSTART animation
 * (null removes it, undefined leaves it).
 */
export function setRelease(
  route: EditableRoute,
  start: Vec,
  side: RouteSide,
  kind: ReleaseKind,
  opts: { length?: number; anim?: string | null } = {},
): EditableRoute {
  let r = route;
  if (detectRelease(r, side) !== "none") {
    const pts = routePoints(start, r);
    const legs = r.legs.slice(1);
    legs[0] = { ...withLegVector(legs[0], start, pts[2]), before: [] };
    r = { ...r, legs };
  }
  if (kind !== "none" && r.legs.length) {
    const dir = releaseHeading(kind, side);
    const relLen = opts.length ?? 1.5;
    const pts = routePoints(start, r);
    const relEnd = add(start, polar(dir, relLen));
    const first = withLegVector(r.legs[0], relEnd, pts[1]);
    const rel: EditableLeg = { type: "RunRoute", distance: r2(relLen), direction: dir, speed: r.legs[0].speed ?? 100, before: [] };
    r = { ...r, legs: [rel, first, ...r.legs.slice(1)] };
  }
  if (opts.anim !== undefined) {
    const prefix = r.prefix.filter((s) => !(s.type === "InitialAnim" && WRSTART.test(String(s.anim ?? ""))));
    if (opts.anim) {
      const dir = kind === "none" ? 90 : releaseHeading(kind, side);
      const at = prefix.findIndex((s) => !MOTION_STEP_TYPES.has(s.type) && !MECH.has(s.type));
      const step: Step = { type: "InitialAnim", anim: opts.anim, direction: dir };
      if (at < 0) prefix.push(step);
      else prefix.splice(at, 0, step);
    }
    r = { ...r, prefix };
  }
  return r;
}

// ───────────────────────────── double moves ─────────────────────────────

export type DoubleMoveId = "stutter" | "stutter_go" | "slant_go" | "hitch_go_in" | "hitch_go_out" | "out_up" | "stick_nod" | "zig";

export interface DoubleMoveDef {
  id: DoubleMoveId;
  label: string;
  family: string;
  routeType: (side: RouteSide) => string;
}

export const DOUBLE_MOVES: DoubleMoveDef[] = [
  { id: "stutter", label: "Stutter", family: "Stutter", routeType: () => "AssignRouteType_RR_Streak" },
  { id: "stutter_go", label: "Stutter-Go", family: "StutterGo", routeType: () => "AssignRouteType_RR_Streak" },
  { id: "slant_go", label: "Slant-and-Go", family: "SlantGo", routeType: () => "AssignRouteType_RR_Slant_N_Go" },
  { id: "hitch_go_in", label: "Hitch-and-Go (in)", family: "HitchGo", routeType: () => "AssignRouteType_RR_Hitch_N_Go" },
  { id: "hitch_go_out", label: "Hitch-and-Go (out)", family: "HitchGo", routeType: () => "AssignRouteType_RR_Hitch_N_Go" },
  { id: "out_up", label: "Out-and-Up", family: "OutUp", routeType: () => "AssignRouteType_RR_Out_N_Up" },
  { id: "stick_nod", label: "Stick-Nod", family: "StickNod", routeType: () => "AssignRouteType_RR_Out_N_Up" },
  { id: "zig", label: "Zig", family: "Zig", routeType: () => "AssignRouteType_RR_Whip_Out" },
];

/**
 * Steps (no None) for a double move from the library's shapes, e.g. slant-and-go: 3.5 up, SLANT_AND_GO toward the
 * ball, 30 yd up-and-out. Every double move is a ReceiverCut cut type (no RunRouteFakeOut: see `removeFakeAt`).
 */
export function doubleMoveSteps(id: DoubleMoveId, side: RouteSide, opts: { stem?: number; length?: number } = {}): { steps: Step[]; routeType: string } {
  const H = (toward: "in" | "out", a: number) => sideHeading(side, toward, a);
  const inT = insideTurn(side);
  const outT = outsideTurn(side);
  const L = opts.length ?? 25;
  let steps: Step[];
  switch (id) {
    case "stutter":
      steps = [runLeg(opts.stem ?? 8, 90), receiverCut("RECEIVER_CUT_ANGLE_STUTTER", outT), runLeg(L, 90), GET_OPEN];
      break;
    case "stutter_go":
      steps = [runLeg(opts.stem ?? 5, 90), receiverCut("RECEIVER_CUT_ANGLE_STUTTER_STREAK", outT), runLeg(L, H("out", 5)), GET_OPEN];
      break;
    case "slant_go":
      steps = [runLeg(opts.stem ?? 3.5, 90), receiverCut("RECEIVER_CUT_ANGLE_SLANT_AND_GO", inT), runLeg(L, H("out", 10)), GET_OPEN];
      break;
    case "hitch_go_in":
      steps = [runLeg(opts.stem ?? 4, 90), receiverCut("RECEIVER_CUT_ANGLE_HITCH_GO_INSIDE", inT), runLeg(L, H("in", 5)), GET_OPEN];
      break;
    case "hitch_go_out":
      steps = [runLeg(opts.stem ?? 4, 90), receiverCut("RECEIVER_CUT_ANGLE_HITCH_GO_OUTSIDE", outT), runLeg(L, H("out", 5)), GET_OPEN];
      break;
    case "out_up":
      steps = [runLeg(opts.stem ?? 6.8, 90), receiverCut("RECEIVER_CUT_ANGLE_OUT_AND_UP", outT), runLeg(L, 90), GET_OPEN];
      break;
    case "stick_nod":
      steps = [runLeg(opts.stem ?? 1.5, 90), receiverCut("RECEIVER_CUT_ANGLE_STICKNOD", outT), runLeg(opts.length ?? 15, H("out", 30)), GET_OPEN];
      break;
    case "zig": {
      const a = H("in", 45);
      const b = H("out", 45);
      steps = [runLeg(opts.stem ?? 5, a), receiverCut("RECEIVER_CUT_ANGLE_ZIG", cutDirFor(a, b) ?? outT), runLeg(opts.length ?? 12, b), GET_OPEN];
      break;
    }
  }
  return { steps, routeType: DOUBLE_MOVES.find((d) => d.id === id)!.routeType(side) };
}

// ───────────────────────────── blocks ─────────────────────────────

export type BlockToolId = "pass" | "release" | "run" | "lead" | "kickout" | "trap" | "wham" | "crack" | "stalk" | "pull" | "screen";

export const BLOCK_TOOLS: { id: BlockToolId; label: string; hint: string }[] = [
  { id: "pass", label: "Pass block", hint: "Protect the QB" },
  { id: "release", label: "Block & release", hint: "Block for a beat, then release into a route" },
  { id: "run", label: "Run block", hint: "The blocking scheme picks the target" },
  { id: "lead", label: "Lead", hint: "Lead through the hole" },
  { id: "kickout", label: "Kickout", hint: "Kick out the end man" },
  { id: "trap", label: "Trap", hint: "Trap the first defender past the gap" },
  { id: "wham", label: "Wham", hint: "Wham the 3-technique" },
  { id: "crack", label: "Crack", hint: "Crack back inside" },
  { id: "stalk", label: "Stalk", hint: "Release, then stalk the corner" },
  { id: "pull", label: "Pull", hint: "Pull animation + lead block" },
  { id: "screen", label: "Screen release", hint: "Sell pass pro, then lead the screen" },
];

/** Family word for generated assignment names per block tool ("PBS_LG_Pull"). */
export const BLOCK_FAMILY: Record<BlockToolId, string> = {
  pass: "PassBlock",
  release: "BlockRelease",
  run: "RunBlock",
  lead: "Lead",
  kickout: "Kickout",
  trap: "Trap",
  wham: "Wham",
  crack: "Crack",
  stalk: "Stalk",
  pull: "Pull",
  screen: "ScreenBlock",
};

export const TECHNIQUE_FOR: Partial<Record<BlockToolId, string>> = {
  lead: "BLOCKINGTECHNIQUE_LEAD_THROUGH_HOLE",
  kickout: "BLOCKINGTECHNIQUE_KICKOUT",
  trap: "BLOCKINGTECHNIQUE_TRAP",
  wham: "BLOCKINGTECHNIQUE_WHAM",
  crack: "BLOCKINGTECHNIQUE_CRACK_BLOCK",
  stalk: "BLOCKINGTECHNIQUE_STALK_BLOCK",
  pull: "BLOCKINGTECHNIQUE_LEAD_THROUGH_HOLE",
};

export const PULL_ANIMS = ["MOVETYPE_COUNTER_PULL", "MOVETYPE_POWER_PULL", "MOVETYPE_SKIP_PULL", "MOVETYPE_TRAP_PULL", "MOVETYPE_TRUCK_PULL", "MOVETYPE_SCREEN_PULL"];

export interface BlockOptions {
  side?: RouteSide;
  /** BlockingGap (default RUN_HOLE). */
  gap?: string;
  technique?: string;
  /** Pull animation (pull tool). */
  anim?: string;
  /** Seconds of pass pro before releasing (release / screen). */
  time?: number;
  /** Screen release: direction / distance of the release leg. */
  direction?: number;
  distance?: number;
  /** Offensive lineman (screen pulls use MOVETYPE_SCREEN_PULL). */
  lineman?: boolean;
}

/** Steps (no None) for a block tool. Shapes follow the library and the in-game-verified GT Counter example. */
export function blockSteps(tool: BlockToolId, opts: BlockOptions = {}): { steps: Step[]; routeType: string } {
  const side = opts.side ?? "right";
  const gap = opts.gap ?? "RUN_HOLE";
  const technique = opts.technique ?? TECHNIQUE_FOR[tool] ?? "BLOCKINGTECHNIQUE_LEAD_THROUGH_HOLE";
  switch (tool) {
    case "pass":
      return { steps: [{ type: "PassBlock", time: 0, flags: "PassBlockFlags_None" }], routeType: "AssignRouteType_Block_Pass" };
    case "release": {
      const a = sideHeading(side, "out", 20);
      const b = sideHeading(side, "out", 80);
      return {
        steps: [
          { type: "PassBlock", time: opts.time ?? 1, flags: "PassBlockFlags_None" },
          runLeg(2, a),
          ...(cutFor(a, b) ? [cutFor(a, b)!] : []),
          runLeg(opts.distance ?? 12, b),
          GET_OPEN,
        ],
        routeType: "AssignRouteType_RR_Block_and_Release",
      };
    }
    case "run":
      return { steps: [{ type: "RunBlock" }], routeType: "AssignRouteType_Block_Run" };
    case "stalk":
      return {
        steps: [runLeg(opts.distance ?? 5, 90), { type: "LeadBlock", blockingTechnique: technique, blockingGap: gap }, { type: "RunBlock" }],
        routeType: "AssignRouteType_Block_Run",
      };
    case "pull":
      return {
        steps: [
          { type: "InitialAnim", anim: opts.anim ?? "MOVETYPE_COUNTER_PULL", direction: 0 },
          { type: "LeadBlock", blockingTechnique: technique, blockingGap: gap },
          { type: "RunBlock" },
        ],
        routeType: "AssignRouteType_Block_Run",
      };
    case "screen": {
      const dir = opts.direction ?? sideHeading(side, "out", 80);
      const steps: Step[] = [];
      if (opts.lineman) steps.push({ type: "InitialAnim", anim: "MOVETYPE_SCREEN_PULL", direction: dir });
      if ((opts.time ?? 1) > 0) steps.push({ type: "PassBlock", time: opts.time ?? 1, flags: "PassBlockFlags_None" });
      steps.push({ type: "MoveDirection", distance: r2(opts.distance ?? 5), direction: r2(dir), speed: 80 });
      steps.push({ type: "PassBlock", time: 0, flags: "PassBlockFlags_ProtectReceiver" });
      return { steps, routeType: "AssignRouteType_Block_Pass" };
    }
    default:
      return {
        steps: [{ type: "LeadBlock", blockingTechnique: technique, blockingGap: gap }, { type: "RunBlock" }],
        routeType: "AssignRouteType_Block_Run",
      };
  }
}

/** Which block tool a chain looks like (for the BLOCK tab's selection), or undefined. */
export function detectBlockTool(steps: readonly Step[]): BlockToolId | undefined {
  const body = stripNone([...steps]);
  const lead = body.find((s) => s.type === "LeadBlock");
  const pull = body.some((s) => s.type === "InitialAnim" && /PULL/.test(String(s.anim ?? "")));
  if (body.some((s) => s.type === "PassBlock" && /ProtectReceiver/.test(String(s.flags ?? "")))) return "screen";
  if (lead) {
    if (pull) return "pull";
    const t = String(lead.blockingTechnique ?? "");
    if (/STALK/.test(t)) return "stalk";
    if (/CRACK/.test(t)) return "crack";
    if (/WHAM/.test(t)) return "wham";
    if (/TRAP/.test(t)) return "trap";
    if (/KICKOUT/.test(t)) return "kickout";
    return "lead";
  }
  const pb = body.findIndex((s) => s.type === "PassBlock");
  if (pb >= 0) return body.slice(pb + 1).some((s) => LEG_SET.has(s.type)) ? "release" : "pass";
  if (body.some((s) => s.type === "RunBlock")) return "run";
  return undefined;
}

// ───────────────────────────── motion ─────────────────────────────

export const LOCO_RUN = "AUTOMOTIONLOCOSTYLE_NORMAL";
export const LOCO_SHUFFLE = "AUTOMOTIONLOCOSTYLE_STRAFE";
export const MOTION_SNAP = "AUTOMOTIONSTARTEVENT_SNAP";

/** A waypoint shaped like the library's (key order included). */
export function makeWaypoint(p: Vec, speed = 80, locoStyle: string = LOCO_RUN): AutoMotionWaypoint {
  return { position: { x: r2(p.x), y: r2(p.y) }, transitID: 0, speed, facingAngle: 0, locoStyle, shouldFaceEndPoint: true };
}

/** An AutoMotion step with the library's default fields (modelled on Gun Y Trips Wk Mtn Mesh's jet motion). */
export function motionStep(waypoints: AutoMotionWaypoint[], opts: { startEvent?: string; startDelay?: number; endDelay?: number } = {}): Step {
  return {
    type: "AutoMotion",
    waypoints,
    startEvent: opts.startEvent ?? MOTION_SNAP,
    endDelay: opts.endDelay ?? 0,
    automotionOrderTransitID: 1,
    startDelay: opts.startDelay ?? 0,
    stanceAtTarget: "StanceType_None",
    automotionOrderPlayer: 0,
    useLegacyLocoPathing: false,
    shouldStopAtTarget: false,
  };
}

export type MotionPresetId = "jet" | "orbit" | "return" | "short";

export const MOTION_PRESETS: { id: MotionPresetId; label: string; hint: string }[] = [
  { id: "jet", label: "Jet", hint: "Across the formation just behind the LOS to the far side" },
  { id: "orbit", label: "Orbit", hint: "Arc behind the QB to the other side" },
  { id: "return", label: "Return / shift", hint: "In toward the ball, then back out" },
  { id: "short", label: "Short", hint: "2–3 yd toward the ball" },
];

/** Waypoints for a motion preset from the player's alignment (`qbY` = the QB's depth, for orbits). */
export function motionPresetWaypoints(id: MotionPresetId, start: Vec, opts: { qbY?: number } = {}): AutoMotionWaypoint[] {
  const s = start.x < 0 ? -1 : 1; // player's side
  const qbY = Math.min(opts.qbY ?? -6, -1.4);
  const offLine = Math.min(start.y, -2.2);
  switch (id) {
    case "jet":
      return [makeWaypoint({ x: -s * 6, y: -2.5 }, 100)];
    case "orbit":
      return [
        makeWaypoint({ x: s * 3, y: Math.min(-3, qbY + 2.5) }, 80),
        makeWaypoint({ x: s * 1.5, y: qbY - 2 }, 75),
        makeWaypoint({ x: -s * 2, y: qbY - 2.5 }, 75),
        makeWaypoint({ x: -s * 5, y: qbY - 1.5 }, 80),
      ];
    case "return":
      return [makeWaypoint({ x: start.x - s * 6, y: offLine }, 70), makeWaypoint({ x: start.x - s * 1.5, y: offLine }, 70)];
    case "short":
      return [makeWaypoint({ x: start.x - s * 2.5, y: offLine }, 60)];
  }
}

/** Index of the (first) AutoMotion step, or −1. */
export function motionIndex(steps: readonly Step[]): number {
  return steps.findIndex((s) => s.type === "AutoMotion");
}

/**
 * Put `motion` into the chain (replacing the first AutoMotion, or after any leading OverrideFormPos), or remove the
 * AutoMotion (and a following AutoMotionSnap) when null.
 */
export function setMotion(steps: readonly Step[], motion: Step | null): Step[] {
  const i = motionIndex(steps);
  const out = steps.slice();
  if (!motion) {
    if (i < 0) return out;
    out.splice(i, out[i + 1]?.type === "AutoMotionSnap" ? 2 : 1);
    return out;
  }
  if (i >= 0) {
    out[i] = motion;
    return out;
  }
  let at = 0;
  while (at < out.length && out[at].type === "OverrideFormPos") at++;
  out.splice(at, 0, motion);
  return out;
}

/** Replace the waypoint list of the chain's AutoMotion (creating one when missing). */
export function setWaypoints(steps: readonly Step[], waypoints: AutoMotionWaypoint[]): Step[] {
  const i = motionIndex(steps);
  if (i < 0) return setMotion(steps, motionStep(waypoints));
  const out = steps.slice();
  out[i] = { ...out[i], waypoints };
  return out;
}

// ───────────────────────────── applying a body to a slot ─────────────────────────────

/**
 * Keep the slot's motion/alignment/precan prefix (AutoMotion, AutoMotionSnap, OverrideFormPos, handoff mechanics)
 * and replace everything else with `body` + None. Used by presets, double moves and block tools.
 */
export function replaceBody(steps: readonly Step[], body: Step[], keepLeading?: number): Step[] {
  const n = keptPrefixLength(steps, keepLeading);
  return [...steps.slice(0, n), ...body, { type: "None" }];
}

/**
 * Leading steps `replaceBody` keeps: `keepLeading` when given (a kept handoff precan), else the run of motion /
 * realignment / mechanics steps at the start of the chain. What follows is the route part (release, legs, cuts, end).
 */
export function keptPrefixLength(steps: readonly Step[], keepLeading?: number): number {
  if (keepLeading !== undefined) return Math.max(0, Math.min(keepLeading, steps.length));
  let n = 0;
  while (n < steps.length && (MOTION_STEP_TYPES.has(steps[n].type) || MECH.has(steps[n].type))) n++;
  return n;
}

/** The route part of a chain: everything after the kept prefix (see keptPrefixLength), without the trailing None. */
export function routeBody(steps: readonly Step[], keepLeading?: number): Step[] {
  return stripNone(steps.slice(keptPrefixLength(steps, keepLeading)) as Step[]);
}

// ───────────────────────────── mirroring (left ⇄ right) ─────────────────────────────

/** 180 − d in [0, 360), without float noise (mirroring twice gives the original number back). */
export function mirrorDirection(deg: number): number {
  const m = (((180 - deg) % 360) + 360) % 360;
  return +m.toFixed(9) + 0;
}

/** BlockingGap Left ⇄ RIGHT (the enum spells them "A_GAP_Left" / "A_GAP_RIGHT"); RUN_HOLE etc. unchanged. */
export function mirrorGap(gap: string): string {
  if (/_RIGHT$/.test(gap)) return gap.replace(/_RIGHT$/, "_Left");
  if (/_Left$/i.test(gap)) return gap.replace(/_Left$/i, "_RIGHT");
  return gap;
}

/** Cut direction LEFT ⇄ RIGHT (INVALID unchanged). */
export function mirrorCutDir(dir: string): string {
  return dir === CUT_LEFT ? CUT_RIGHT : dir === CUT_RIGHT ? CUT_LEFT : dir;
}

/**
 * One step mirrored left ⇄ right (FORMATS.md: direction → 180 − d, cut LEFT ⇄ RIGHT): legs, facing overrides,
 * InitialAnim / QBScramble / FaceDirection directions, LeadBlock gaps, WedgeBlock and absolute positions
 * (OverrideFormPos, AutoMotion waypoints: x → −x). Cut TYPES stay: "inside" / "outside" are relative to the ball, so
 * a mirrored hitch-and-go inside is still inside. Key order and every other field are kept.
 */
export function mirrorStep(step: Step): Step {
  const s: Step = { ...step };
  const flipNum = (k: string) => {
    if (isNum(s[k])) s[k] = mirrorDirection(s[k] as number);
  };
  switch (step.type) {
    case "ReceiverCut":
      if (typeof s.direction === "string") s.direction = mirrorCutDir(s.direction);
      return s;
    case "LeadBlock":
      if (typeof s.blockingGap === "string") s.blockingGap = mirrorGap(s.blockingGap);
      return s;
    case "InitialAnim":
      flipNum("direction");
      if (isNum(s.optionalInitalDirection) && (s.optionalInitalDirection as number) >= 0) flipNum("optionalInitalDirection");
      return s;
    case "OverrideFormPos":
    case "DefMovement":
    case "OptionFollow":
      if (isNum(s.offsetX)) s.offsetX = -(s.offsetX as number) + 0;
      return s;
    case "WedgeBlock":
      flipNum("direction");
      if (isNum(s.offsetX)) s.offsetX = -(s.offsetX as number) + 0;
      return s;
    case "AutoMotion":
      if (Array.isArray(s.waypoints))
        s.waypoints = (s.waypoints as AutoMotionWaypoint[]).map((w) => {
          const o = { ...w } as AutoMotionWaypoint;
          if (w?.position && isNum(w.position.x)) o.position = { ...w.position, x: -w.position.x + 0 };
          else if (isNum(w?.x)) o.x = -(w.x as number) + 0; // flat spec waypoint
          if (isNum(w?.facingAngle) && !w.shouldFaceEndPoint) o.facingAngle = mirrorDirection(w.facingAngle);
          return o;
        });
      return s;
    case "OptionRoute":
      // Branches are named for their side (CurlRight, InOutLeft, SlantLt…): the mirror runs the other side's branch.
      if (Array.isArray(s.options))
        s.options = (s.options as Record<string, unknown>[]).map((o) => (o && typeof o.route === "string" ? { ...o, route: mirrorOptionLeaf(o.route) } : o));
      return s;
    case "QBScramble":
    case "FaceDirection":
    case "HandOffTurn":
      flipNum("direction");
      return s;
    default:
      if (LEG_SET.has(step.type)) {
        flipNum("direction");
        if (s.overrideFacingDirection === true) flipNum("facingDirectionOverride");
        if (step.type === "HeadTurnRunRoute") flipNum("faceDirection");
      }
      return s;
  }
}

/** An OptionRoutes leaf for the other side: CurlRight ⇄ CurlLeft, SlantLt ⇄ SlantRt, ComebackLT ⇄ ComebackRT. */
export function mirrorOptionLeaf(leaf: string): string {
  const SWAP: Record<string, string> = { Right: "Left", Left: "Right", Rt: "Lt", Lt: "Rt", RT: "LT", LT: "RT" };
  return leaf.replace(/Right|Left|(?:Rt|Lt|RT|LT)(?=$|_)/g, (m) => SWAP[m] ?? m);
}

export function mirrorSteps(steps: readonly Step[]): Step[] {
  return steps.map(mirrorStep);
}

/**
 * AssignRouteType for the mirrored route: side-specific types swap (…_Lt ⇄ …_Rt, …_Left ⇄ …_Rt); the first
 * candidate that exists in `valid` (the AssignRouteType enum) wins, else undefined (re-inferred on write).
 * Side-neutral types are returned unchanged.
 */
export function mirrorRouteType(routeType: string | undefined, valid?: ReadonlySet<string>): string | undefined {
  if (!routeType) return routeType;
  const m = /^(.*)_(Lt|Rt|Left|Right)$/.exec(routeType);
  if (!m) return routeType;
  const toRight = m[2] === "Lt" || m[2] === "Left";
  const cands = (toRight ? ["Rt", "Right"] : ["Lt", "Left"]).map((x) => `${m[1]}_${x}`);
  if (!valid) return cands[0];
  return cands.find((c) => valid.has(c));
}

// ───────────────────────────── classification ─────────────────────────────

/** Yards upfield before the first cut (legs before the first ReceiverCut), rounded. */
export function stemDepth(steps: readonly Step[]): number {
  const r = toEditableRoute(steps);
  let y = 0;
  for (let i = 0; i < r.legs.length; i++) {
    if (i > 0 && r.legs[i].before.some((s) => s.type === "ReceiverCut")) break;
    y += Math.sin((r.legs[i].direction * Math.PI) / 180) * r.legs[i].distance;
  }
  return Math.round(y);
}

/** Best-effort AssignRouteType for authored steps (used when the user drew the route without a preset). */
export function inferRouteType(steps: readonly Step[], side: RouteSide): string | undefined {
  const body = stripNone([...steps]);
  const tool = detectBlockTool(body);
  if (tool === "pass" || tool === "screen") return "AssignRouteType_Block_Pass";
  if (tool === "release") return "AssignRouteType_RR_Block_and_Release";
  if (tool) return "AssignRouteType_Block_Run";
  const r = toEditableRoute(body);
  if (!r.legs.length) return undefined;
  if (body.some((s) => s.type === "RunEndZone")) return undefined;
  const last = r.legs[r.legs.length - 1];
  const endCut = cutAt(r, r.legs.length - 1);
  const stem = stemDepth(body);
  const named = endCut ? String(endCut.cutType) : "";
  if (/CURL|180|SMASH|DRAG_STOP/.test(named)) return stem >= 7 ? (stem >= 14 ? "AssignRouteType_RR_Curl_Long" : "AssignRouteType_RR_Curl_Medium") : "AssignRouteType_RR_Hitch";
  if (/HITCH_COMEBACK/.test(named)) return "AssignRouteType_RR_Comeback";
  const rel = headingRelative(side, last.direction);
  const a = rel.fromVertical;
  if (a > 110) return rel.toward === "out" ? "AssignRouteType_RR_Comeback" : "AssignRouteType_RR_WR_Screen";
  if (a <= 12) return "AssignRouteType_RR_Streak";
  if (a >= 70) {
    if (stem < 3) return rel.toward === "in" ? "AssignRouteType_RR_Drag" : `AssignRouteType_RR_Flat_${lr(side, "out")}`;
    if (rel.toward === "in") return stem < 8 ? "AssignRouteType_RR_In_Short" : stem >= 13 ? "AssignRouteType_RR_In_Deep" : "AssignRouteType_RR_In_Middle";
    return stem < 8 ? "AssignRouteType_RR_Out_Short" : stem >= 14 ? "AssignRouteType_RR_Out_Deep" : "AssignRouteType_RR_Out_Middle";
  }
  if (rel.toward === "out") return stem >= 5 ? (stem >= 12 ? "AssignRouteType_RR_Corner_Deep" : "AssignRouteType_RR_Corner_Middle") : `AssignRouteType_RR_Flat_${lr(side, "out")}`;
  return stem >= 5 ? (stem >= 10 ? "AssignRouteType_RR_Post_Deep" : "AssignRouteType_RR_Post_Middle") : "AssignRouteType_RR_Slant";
}

const FAMILY_BY_ROUTE_TYPE: [RegExp, string][] = [
  [/RR_Slant_Hook/, "Snag"],
  [/RR_Slant_N_Go/, "SlantGo"],
  [/RR_Slant/, "Slant"],
  [/RR_Corner/, "Corner"],
  [/RR_Post/, "Post"],
  [/RR_In_N_Up/, "InUp"],
  [/RR_In_/, "Dig"],
  [/RR_Out_N_Up/, "OutUp"],
  [/RR_Out_/, "Out"],
  [/RR_Curl/, "Curl"],
  [/RR_Comeback/, "Comeback"],
  [/RR_Hitch_N_Go/, "HitchGo"],
  [/RR_Hitch/, "Hitch"],
  [/RR_Streak/, "Go"],
  [/RR_Fade/, "Fade"],
  [/RR_Wheel/, "Wheel"],
  [/RR_Drag/, "Drag"],
  [/RR_Cross/, "Shallow"],
  [/RR_Whip/, "Whip"],
  [/RR_RB_Angle/, "Angle"],
  [/RR_Swing/, "Swing"],
  [/Screen/, "Screen"],
  [/RR_RB_Flat|RR_Flat/, "Flat"],
  [/RR_Block_and_Release/, "BlockRelease"],
  [/Block_Pass/, "PassBlock"],
  [/Block_Run/, "RunBlock"],
];

/** Every family word `familyFromRouteType` can return. */
export const ROUTE_TYPE_FAMILIES: readonly string[] = [...new Set(FAMILY_BY_ROUTE_TYPE.map(([, f]) => f))];

/** Family word for generated names ("Corner", "Dig", "RunBlock"…). */
export function familyFromRouteType(routeType: string | undefined): string | undefined {
  if (!routeType) return undefined;
  for (const [re, fam] of FAMILY_BY_ROUTE_TYPE) if (re.test(routeType)) return fam;
  return undefined;
}

/** Families whose generated names carry the stem depth (PBS_Slot_Corner7, PBS_Z_Dig12). */
export const DEPTH_FAMILIES = new Set(["Corner", "Post", "Dig", "Out", "Curl", "Comeback", "Hitch", "Snag"]);

/** "RECEIVER_CUT_ANGLE_45" → "45°", "RECEIVER_CUT_ANGLE_90_INSIDE" → "90° inside", "…_HITCH_GO_INSIDE" → "Hitch go inside". */
export function cutLabel(cutType: string): string {
  const s = cutType.replace(CUT_PREFIX, "").replace(/^RECEIVER_CUT_/, "").replace(/_/g, " ").toLowerCase();
  const m = /^(\d+)( .*)?$/.exec(s);
  if (m) return `${m[1]}°${m[2] ?? ""}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ───────────────────────────── segment controls (designer) ─────────────────────────────

/** How a player faces while running a leg: forward (the default), backpedaling, or shuffling sideways. */
export type LegFacing = "forward" | "backpedal" | "shuffleLeft" | "shuffleRight";

/** Facing of leg k from its facingDirectionOverride (relative to the leg's direction). */
export function legFacing(route: EditableRoute, k: number): LegFacing {
  const leg = route.legs[k];
  const src = leg?.source;
  if (!leg || !src || src.overrideFacingDirection !== true || typeof src.facingDirectionOverride !== "number") return "forward";
  const rel = (((src.facingDirectionOverride - leg.direction) % 360) + 360) % 360;
  if (rel > 135 && rel < 225) return "backpedal";
  if (rel >= 45 && rel <= 135) return "shuffleLeft";
  if (rel >= 225 && rel <= 315) return "shuffleRight";
  return "forward";
}

/** Set how the player faces on leg k (writes overrideFacingDirection / facingDirectionOverride on the leg's step). */
export function setLegFacing(route: EditableRoute, k: number, facing: LegFacing): EditableRoute {
  const leg = route.legs[k];
  if (!leg) return route;
  const base: Step = { ...(leg.source ?? legToStep(leg)) };
  if (facing === "forward") {
    base.overrideFacingDirection = false;
    base.facingDirectionOverride = 0;
  } else {
    const rel = facing === "backpedal" ? 180 : facing === "shuffleLeft" ? 90 : 270;
    base.overrideFacingDirection = true;
    base.facingDirectionOverride = r2((((leg.direction + rel) % 360) + 360) % 360);
  }
  const legs = route.legs.slice();
  legs[k] = { ...leg, source: base };
  return { ...route, legs };
}

/**
 * "Start a new route from this point": keep the legs up to vertex k (and their cuts), drop everything after it,
 * so the next drawn points continue from vertex k. The end steps (Get open, blocks…) stay.
 */
export function branchFrom(route: EditableRoute, k: number): EditableRoute {
  if (k < 0 || k >= route.legs.length) return route;
  return clearLegsFrom(route, k + 1);
}

// ───────────────────────────── QB drops (designer "first steps") ─────────────────────────────

export interface QbDropDef {
  id: string;
  label: string;
  /** DROP_TYPEENUM_* value. */
  drop: string;
}

const D = (id: string, label: string, t: string): QbDropDef => ({ id, label, drop: `DROP_TYPEENUM_QBDROP_${t}` });

/** Drops a QB can take, by where he lines up (under center, pistol, shotgun). */
export function qbDropsFor(qbY: number): QbDropDef[] {
  if (qbY > -2.5)
    return [
      D("1", "1 Step Drop", "1_STEP_QUICK"),
      D("3", "3 Step Drop", "3_STEP_QUICK"),
      D("3b", "3 Step Drop (Big)", "3_STEP_BIG"),
      D("5", "5 Step Drop", "5_STEP_BIG"),
      D("7", "7 Step Drop", "7_STEP_V1"),
      D("rl", "Rollout Left", "UC_ROLLOUT_LT"),
      D("rr", "Rollout Right", "UC_ROLLOUT_RT"),
      D("pl", "Speed Play Action Left", "UC_SPEED_PA_LT"),
      D("pr", "Speed Play Action Right", "UC_SPEED_PA_RT"),
    ];
  if (qbY > -5)
    return [
      D("3", "3 Step Drop (Pistol)", "3_STEP_PISTOL"),
      D("5", "5 Step Drop (Pistol)", "5_STEP_PISTOL"),
      D("rl", "Rollout Left", "SG_ROLLOUT_LT"),
      D("rr", "Rollout Right", "SG_ROLLOUT_RT"),
      D("dl", "Sprint Out Left", "DASH_GUN_LT"),
      D("dr", "Sprint Out Right", "DASH_GUN_RT"),
    ];
  return [
    D("0", "Catch and Throw", "SG_0_STEP"),
    D("1", "1 Step Drop", "SG_1_STEP"),
    D("3", "3 Step Drop", "SG_3_STEP"),
    D("5", "5 Step Drop", "SHOTGUN_5_STEP"),
    D("rl", "Rollout Left", "SG_ROLLOUT_LT"),
    D("rr", "Rollout Right", "SG_ROLLOUT_RT"),
    D("dl", "Sprint Out Left", "DASH_GUN_LT"),
    D("dr", "Sprint Out Right", "DASH_GUN_RT"),
  ];
}

/** The QB's drop (the last QBScramble's dropBackType), if he has one. */
export function qbDropOf(steps: readonly Step[]): string | undefined {
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i].type === "QBScramble") return String(steps[i].dropBackType ?? "");
  return undefined;
}

/** Set the QB's drop (his last QBScramble: the drop type, no explicit distance). Returns the same steps without one. */
export function setQbDrop(steps: readonly Step[], drop: string): Step[] {
  let i = -1;
  for (let j = steps.length - 1; j >= 0; j--) if (steps[j].type === "QBScramble") {
    i = j;
    break;
  }
  if (i < 0) return steps.slice();
  const out = steps.slice();
  out[i] = { ...steps[i], dropBackType: drop, distance: 0, direction: 0 };
  return out;
}
