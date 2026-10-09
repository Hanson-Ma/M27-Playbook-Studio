// Distance guides while something is dragged on a field (a player, a route point, a motion point): dashed lines to
// the nearest players with the distance in yards, plus how far off the line of scrimmage the point is. Drawn in
// field coordinates inside a <Field>; labels stay screen-sized.
import type { Vec } from "../model/types";
import { useFieldTransform } from "./Field";
import { r3 } from "./fieldMath";
import s from "./ProximityGuides.module.css";

export interface ProximityGuidesProps {
  /** The dragged point (field yards, as drawn). */
  at: Vec;
  /** Everyone it can be measured against (as drawn), without the dragged player. */
  others: Vec[];
  /** How many nearest neighbours get a line (default 2). */
  count?: number;
  /** Only neighbours closer than this many yards (default 12). */
  within?: number;
  /** Show the distance to the line of scrimmage (default true). */
  los?: boolean;
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

export function ProximityGuides({ at, others, count = 2, within = 12, los = true }: ProximityGuidesProps) {
  const { pxPerYard } = useFieldTransform();
  const k = +(1 / Math.max(pxPerYard, 0.5)).toPrecision(5);
  const near = others
    .map((p) => ({ p, d: Math.hypot(p.x - at.x, p.y - at.y) }))
    .filter((x) => x.d > 0.05 && x.d <= within)
    .sort((a, b) => a.d - b.d)
    .slice(0, count);
  const label = (x: number, y: number, text: string, key: string) => (
    <g key={key} transform={`translate(${r3(x)} ${r3(-y)}) scale(${k})`} className={s.tag}>
      <rect x={-text.length * 3.6 - 6} y={-9} width={text.length * 7.2 + 12} height={18} rx={4} />
      <text y={4}>{text}</text>
    </g>
  );
  return (
    <g className={s.guides} aria-hidden>
      {near.map(({ p, d }, i) => (
        <line key={`l${i}`} x1={r3(at.x)} y1={r3(-at.y)} x2={r3(p.x)} y2={r3(-p.y)} strokeWidth={r3(1.4 * k)} strokeDasharray={`${r3(4 * k)} ${r3(3 * k)}`} />
      ))}
      {los && Math.abs(at.y) > 0.05 && <line className={s.los} x1={r3(at.x)} y1={r3(-at.y)} x2={r3(at.x)} y2={0} strokeWidth={r3(1.2 * k)} strokeDasharray={`${r3(2 * k)} ${r3(3 * k)}`} />}
      {near.map(({ p, d }, i) => label((at.x + p.x) / 2, (at.y + p.y) / 2, `${fmt(d)} yd`, `t${i}`))}
      {los && Math.abs(at.y) > 0.05 && label(at.x, at.y / 2, `${fmt(Math.abs(at.y))} off LOS`, "los")}
    </g>
  );
}
