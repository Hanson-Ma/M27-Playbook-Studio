// How far a player can motion, measured from every AutoMotion in the library (2,099 offensive plays, 2026-10-04 data):
//   y (field) never above −0.6 (motion stays behind the line) and never below −11; |x| ≤ 17.5; 1–5 waypoints;
//   path length median 7.2 yd, p90 18.5, p99 24.6, max 35.3; one motion man in 96% of motion plays (2–3 in 39);
//   movers: WR, TE, HB, slot, FB, rarely the QB — never the offensive line.
// The designer clamps waypoint drags to this region and warns past the soft limits.
import type { Vec } from "./types";
import { isOffensiveLine } from "./positions";

export const MOTION_LIMITS = {
  /** Highest y a waypoint may reach (behind the line of scrimmage). */
  maxY: -0.6,
  /** Deepest y seen in the library. */
  minY: -11,
  /** Widest |x| seen (inside the numbers). */
  maxAbsX: 18,
  maxWaypoints: 5,
  /** p99 of library motion path lengths: warn beyond this. */
  warnPathYards: 25,
  /** Longest library motion: refuse beyond this. */
  maxPathYards: 35,
  /** More than one motion man is rare in the library: warn. */
  maxMotionMen: 1,
} as const;

/** Clamp a waypoint into the motion region. */
export function clampMotionPoint(p: Vec): Vec {
  const L = MOTION_LIMITS;
  return {
    x: Math.max(-L.maxAbsX, Math.min(L.maxAbsX, p.x)),
    y: Math.max(L.minY, Math.min(L.maxY, p.y)),
  };
}

/** Total length of a motion from the player's spot through its waypoints. */
export function motionPathLength(start: Vec, waypoints: Vec[]): number {
  let len = 0;
  let at = start;
  for (const w of waypoints) {
    len += Math.hypot(w.x - at.x, w.y - at.y);
    at = w;
  }
  return len;
}

/** The OL never motions in the library (and the game would break line counts). */
export function canMotion(pos: string): boolean {
  return !isOffensiveLine(pos);
}

export interface MotionIssue {
  level: "error" | "warning";
  message: string;
}

/** Problems with one player's motion (and, when given, how many players motion in the play). */
export function motionIssues(start: Vec, waypoints: Vec[], opts: { pos?: string; motionMen?: number } = {}): MotionIssue[] {
  const L = MOTION_LIMITS;
  const out: MotionIssue[] = [];
  if (opts.pos && !canMotion(opts.pos)) out.push({ level: "error", message: "Offensive linemen can't motion." });
  if (waypoints.length > L.maxWaypoints)
    out.push({ level: "error", message: `At most ${L.maxWaypoints} motion points (this has ${waypoints.length}).` });
  for (const w of waypoints) {
    if (w.y > L.maxY + 1e-6) {
      out.push({ level: "error", message: "Motion must stay behind the line of scrimmage." });
      break;
    }
  }
  if (waypoints.some((w) => w.y < L.minY - 1e-6 || Math.abs(w.x) > L.maxAbsX + 1e-6))
    out.push({ level: "error", message: "Motion goes outside the area real plays use (inside the numbers, ≤ 11 yd deep)." });
  const len = motionPathLength(start, waypoints);
  if (len > L.maxPathYards)
    out.push({ level: "error", message: `Motion is ${len.toFixed(1)} yd — the longest in the game is ${L.maxPathYards} yd.` });
  else if (len > L.warnPathYards)
    out.push({ level: "warning", message: `Long motion (${len.toFixed(1)} yd): the snap may come before it finishes.` });
  if ((opts.motionMen ?? 0) > L.maxMotionMen)
    out.push({ level: "warning", message: `${opts.motionMen} players motion in this play — real plays almost always motion one.` });
  return out;
}
