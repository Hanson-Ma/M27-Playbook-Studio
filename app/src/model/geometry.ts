// Vector math in field yards (+x right, +y upfield) and absolute degrees (0 = right, 90 = upfield).
import type { Vec } from "./types";

export const DEG = Math.PI / 180;

/** Field constants (yards). */
export const FIELD_WIDTH = 160 / 3; // 53.33
export const HALF_WIDTH = FIELD_WIDTH / 2; // 26.67
export const HASH_HALF = 3.0833; // NFL hashes: 18.5 ft apart → ±3.08 yd from the middle
/** Where the field puts the line of scrimmage: the offense's own 35 (painted numbers, end zones, off-field checks). */
export const LOS_YARD_LINE = 35;
export const OL_X = [-3.333, -1.666, 0, 1.666, 3.333];

export const vec = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Unit-direction vector times distance for an absolute angle in degrees. */
export function polar(deg: number, distance: number): Vec {
  return { x: Math.cos(deg * DEG) * distance, y: Math.sin(deg * DEG) * distance };
}

/** Normalize to [0, 360). */
export function normDeg(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

/** Angle of a vector in degrees, [0, 360). */
export function angleDeg(dx: number, dy: number): number {
  return normDeg(Math.atan2(dy, dx) / DEG);
}

/** Smallest signed difference b − a in degrees, in (−180, 180]. */
export function deltaDeg(a: number, b: number): number {
  let d = normDeg(b - a);
  if (d > 180) d -= 360;
  return d;
}

export const mirrorX = (v: Vec): Vec => ({ x: -v.x, y: v.y });
/** Mirror an absolute direction left↔right. */
export const mirrorDeg = (deg: number): number => normDeg(180 - deg);

export function snapGrid(v: Vec, step = 0.5): Vec {
  return { x: Math.round(v.x / step) * step, y: Math.round(v.y / step) * step };
}

export function snapAngle(deg: number, step = 5): number {
  return normDeg(Math.round(deg / step) * step);
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
