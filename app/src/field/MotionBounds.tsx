// The area a pre-snap motion may use (model/motionLimits.ts MOTION_LIMITS, measured from every library motion): a
// shaded band behind the line of scrimmage, inside the numbers (|x| ≤ 18) and no deeper than 11 yd (y −11 … −0.6).
// Optionally shows how much farther a motion can go from a point: a dashed ring at the soft length limit (25 yd,
// "may not finish before the snap") and a solid one at the hard limit (35 yd, the longest in the game), both
// clipped to the band and shrunk by the yards the motion already uses. Draw it inside a <Field>, under the play art.
import { memo, useId } from "react";
import { MOTION_LIMITS } from "../model/motionLimits";
import type { Vec } from "../model/types";
import { useFieldTransform } from "./Field";
import { r3 } from "./fieldMath";
import styles from "./MotionBounds.module.css";

export interface MotionBoundsProps {
  /** Default true. Hidden bounds render nothing (keep the component mounted and toggle this). */
  visible?: boolean;
  /** Where the motion currently ends (the player's spot or the last waypoint): draws the remaining-length rings. */
  from?: Vec;
  /** Yards the motion already covers before `from` (default 0). */
  usedYards?: number;
  /** Caption in the band's corner: true = "MOTION AREA" (default), a string, or false for none. */
  label?: boolean | string;
  className?: string;
}

/** Remaining motion length from a point: [soft, hard] radii in yards (never negative). */
export function motionReach(usedYards = 0): { soft: number; hard: number } {
  const used = Math.max(0, usedYards || 0);
  return {
    soft: Math.max(0, MOTION_LIMITS.warnPathYards - used),
    hard: Math.max(0, MOTION_LIMITS.maxPathYards - used),
  };
}

export const MotionBounds = memo(function MotionBounds({ visible = true, from, usedYards = 0, label = true, className }: MotionBoundsProps) {
  const { toSvg, pxPerYard } = useFieldTransform();
  const clipId = `motion-bounds-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  if (!visible) return null;
  const L = MOTION_LIMITS;
  const a = toSvg({ x: -L.maxAbsX, y: L.maxY });
  const b = toSvg({ x: L.maxAbsX, y: L.minY });
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  const ppy = Math.max(pxPerYard, 0.5);
  const text = label === true ? "Motion Area" : label || "";
  const reach = from ? motionReach(usedYards) : undefined;
  const c = from ? toSvg(from) : undefined;
  const scale = `scale(${+(1 / ppy).toPrecision(5)})`;
  const fs = Math.min(11, Math.max(8.5, h * ppy * 0.12));

  return (
    <g className={[styles.bounds, className].filter(Boolean).join(" ")} aria-hidden data-motion-bounds>
      <rect className={styles.band} x={r3(x)} y={r3(y)} width={r3(w)} height={r3(h)} />
      {reach && c && (
        <>
          <clipPath id={clipId}>
            <rect x={r3(x)} y={r3(y)} width={r3(w)} height={r3(h)} />
          </clipPath>
          <g clipPath={`url(#${clipId})`}>
            {reach.hard > 0 && <circle className={styles.reachHard} cx={r3(c.x)} cy={r3(c.y)} r={r3(reach.hard)} />}
            {reach.soft > 0 && <circle className={styles.reachSoft} cx={r3(c.x)} cy={r3(c.y)} r={r3(reach.soft)} />}
          </g>
        </>
      )}
      <rect className={styles.edge} x={r3(x)} y={r3(y)} width={r3(w)} height={r3(h)} />
      {text && h * ppy > 18 && (
        <text className={styles.label} transform={`translate(${r3(x)} ${r3(y + h)}) ${scale}`} x={6} y={-6} fontSize={r3(fs)}>
          {text}
        </text>
      )}
    </g>
  );
});
