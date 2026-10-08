// Tiny route icon for one cut type (the designer's cut picker, the guide, legends): a short stem upfield, then the
// turn / fake / hook the cut makes, drawn with the same cut geometry as the play art (cutGeometry.ts) — speed cuts
// rounded, hard cuts sharp, double moves with a zig, turn-backs hooking, DRAG_STOP settling.
// `dir` is the cut direction (left = counter-clockwise, toward −x on the field). Colors follow `currentColor`.
import { memo } from "react";
import { cutStyle, CUT_STYLE_INFO, type CutStyle } from "../model/art";
import type { Vec } from "../model/types";
import { drawCutPath, type CutCorner } from "./cutGeometry";
import { endAngleSvg, r3, trimEnd } from "./fieldMath";
import styles from "./CutIcon.module.css";

export interface CutIconProps {
  /** ReceiverCutAngle value ("RECEIVER_CUT_ANGLE_45" or "45") or a RunRouteFakeOut type ("JukeLeft45Degrees"). */
  cutType: string;
  /** Cut direction (default "right"). */
  dir?: "left" | "right";
  /** Square size in CSS px (default 28). */
  size?: number;
  /** Tooltip / accessible name (default: the cut's name and style). */
  title?: string;
  className?: string;
}

export interface CutIconShape {
  /** Icon-space points (+y up), starting at the player. */
  points: Vec[];
  corners: CutCorner[];
  /** Highest real vertex index (points after it are a hook). */
  lastVertexIndex: number;
  style?: CutStyle;
}

const DEG = Math.PI / 180;
const polar = (deg: number, d: number): Vec => ({ x: Math.cos(deg * DEG) * d, y: Math.sin(deg * DEG) * d });

/** Points from (0, 0) along [distance, heading°] legs. */
function walk(...legs: [number, number][]): Vec[] {
  const out: Vec[] = [{ x: 0, y: 0 }];
  for (const [d, h] of legs) {
    const p = out[out.length - 1];
    const v = polar(h, d);
    out.push({ x: p.x + v.x, y: p.y + v.y });
  }
  return out;
}

/** The engine's hook (model/art.ts): segments turning by `turns` toward the cut side from `heading`. */
function hookFrom(points: Vec[], heading: number, ccw: number, turns: number[], seg: number): Vec[] {
  const out = [...points];
  for (const t of turns) {
    const p = out[out.length - 1];
    const v = polar(heading + ccw * t, seg);
    out.push({ x: p.x + v.x, y: p.y + v.y });
  }
  return out;
}

const FAKE_AFTER: Record<string, (ccw: number) => [number, number]> = {
  STUTTER: () => [4, 90],
  STUTTER_STREAK: (s) => [5, 90 + s * 12],
  SHAKE: (s) => [4, 90 + s * 45],
  OUT_AND_UP: () => [4.5, 90],
  HITCH_GO_INSIDE: (s) => [4.5, 90 + s * 6],
  HITCH_GO_OUTSIDE: (s) => [4.5, 90 + s * 6],
  STICKNOD: (s) => [4.5, 90 + s * 20],
  SLANT_AND_GO: () => [4.5, 90],
  POSTCORNER: (s) => [4, 90 + s * 50],
  ZIG: (s) => [3.5, 90 + s * 90],
  HESITATION: () => [4.5, 90],
};

const TURN_ANGLE: Record<string, number> = { "22": 22, "45": 45, "67": 67, "90": 90, "90_INSIDE": 90 };

/** The icon's geometry for a cut (pure; exported for tests and custom renderers). */
export function cutIconShape(cutType: string, dir: "left" | "right" = "right"): CutIconShape {
  const key = cutType.replace(/^RECEIVER_CUT_ANGLE_/, "");
  const style = cutStyle(cutType);
  const s = dir === "left" ? 1 : -1; // counter-clockwise sign
  const shape = (points: Vec[], corners: [number, CutStyle][], lastVertexIndex = points.length - 1): CutIconShape => ({
    points,
    corners: corners.map(([index, st]) => ({ index, style: st, turn: s as 1 | -1 })),
    lastVertexIndex,
    style,
  });

  if (key in TURN_ANGLE) return shape(walk([4, 90], [4, 90 + s * TURN_ANGLE[key]]), [[1, style ?? "hard"]]);
  if (key in FAKE_AFTER) {
    const stem = key === "SLANT_AND_GO" ? 3 : 4;
    return shape(walk([stem, 90], FAKE_AFTER[key](s)), [[1, "fake"]]);
  }
  switch (key) {
    case "CURL":
      return shape(hookFrom(walk([5, 90]), 90, s, [60, 120, 170], 1.1), [[1, "turnback"]], 1);
    case "180":
      return shape(hookFrom(walk([5, 90]), 90, s, [60, 120, 180], 1.1), [[1, "turnback"]], 1);
    case "180_PARTIAL":
      return shape(hookFrom(walk([4.5, 90]), 90, s, [55, 110, 150], 1.1), [[1, "turnback"]], 1);
    case "SMASH":
      return shape(hookFrom(walk([3.2, 90]), 90, s, [60, 120, 170], 1.1), [[1, "turnback"]], 1);
    case "SMASH_QUICK":
      return shape(hookFrom(walk([2.4, 90]), 90, s, [60, 120, 170], 1.1), [[1, "turnback"]], 1);
    case "SCREEN":
      return shape(hookFrom(walk([1.8, 90]), 90, s, [70, 140, 180], 1.1), [[1, "turnback"]], 1);
    case "SCREEN_BACKPEDAL_SHORT":
    case "SCREEN_BACKPEDAL_LONG":
      return shape(
        hookFrom(walk([key.endsWith("LONG") ? 4 : 2.5, 270]), 270, -s, [70, 140, 180], 1.1),
        [[1, "turnback"]],
        1,
      );
    case "BUBBLE_SCREEN":
    case "BUBBLE_SCREEN_SHORT": {
      const k = key.endsWith("SHORT") ? 0.7 : 1;
      return shape(walk([2.2 * k, 90 + s * 135], [3.2 * k, 90 + s * 85]), [[1, "speed"]]);
    }
    case "HITCH_COMEBACK":
    case "HITCH_COMEBACK_INSIDE":
      return shape(walk([5, 90], [3.8, 90 + s * 128]), [[1, "turnback"]]);
    case "HINGECOMEBACK":
      return shape(walk([2.5, 90], [4, 90 + s * 115]), [[1, "turnback"]]);
    case "DRAG_STOP":
      return shape(walk([1.6, 90], [4.4, 90 + s * 78]), [[2, "settle"]]);
  }
  if (style === "fake") return shape(walk([4, 90], [4, 90]), [[1, "fake"]]); // jukes / fake-outs
  return shape(walk([6, 90]), []);
}

const prettyCut = (cutType: string) =>
  cutType
    .replace(/^RECEIVER_CUT_ANGLE_/, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());

export const CutIcon = memo(function CutIcon({ cutType, dir = "right", size = 28, title, className }: CutIconProps) {
  const shape = cutIconShape(cutType, dir);
  const k = size / 28;
  const stroke = Math.max(1.4, 2 * k);
  const pad = 2.6 * k + stroke;

  // Fit the icon-space points into the square (keep the aspect; short shapes stay centered).
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of shape.points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const span = Math.max(maxX - minX, maxY - minY, 6);
  const f = (size - 2 * pad) / span;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const pts = shape.points.map((p) => ({ x: (p.x - cx) * f, y: (p.y - cy) * f }));

  const arrowL = 4.8 * k;
  const arrowH = 2.7 * k;
  const line = trimEnd(pts, arrowL * 0.6);
  const drawing = drawCutPath(
    line,
    shape.corners,
    { round: 3.2 * k, zigHalf: 2.8 * k, zigAmp: 2 * k, tick: 2.8 * k, hookIn: 1 * k },
    { lastVertexIndex: shape.lastVertexIndex, hookTail: Infinity },
  );
  const tip = pts[pts.length - 1];
  const angle = endAngleSvg(pts);
  const start = pts[0];
  const label =
    title ?? `${prettyCut(cutType)}${shape.style ? ` (${CUT_STYLE_INFO[shape.style].label.toLowerCase()})` : ""}${dir === "left" ? ", left" : ", right"}`;

  return (
    <svg
      className={[styles.icon, className].filter(Boolean).join(" ")}
      width={size}
      height={size}
      viewBox={`${r3(-size / 2)} ${r3(-size / 2)} ${r3(size)} ${r3(size)}`}
      role="img"
      aria-label={label}
      data-cut-style={shape.style}
    >
      <title>{label}</title>
      <circle className={styles.player} cx={r3(start.x)} cy={r3(-start.y)} r={r3(1.9 * k)} strokeWidth={r3(stroke * 0.7)} />
      <path className={styles.line} d={drawing.d} strokeWidth={r3(stroke)} />
      <g transform={`translate(${r3(tip.x)} ${r3(-tip.y)}) rotate(${r3(angle)})`}>
        <path className={styles.fill} d={`M0 0L${r3(-arrowL)} ${r3(-arrowH)}L${r3(-arrowL)} ${r3(arrowH)}Z`} />
        {drawing.settle && (
          <line className={styles.line} x1={r3(stroke * 0.5)} y1={r3(-arrowH * 1.35)} x2={r3(stroke * 0.5)} y2={r3(arrowH * 1.35)} strokeWidth={r3(stroke)} />
        )}
      </g>
    </svg>
  );
});
