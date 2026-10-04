// Mini line-of-scrimmage diagrams: the BlockingGap picker (A–E / OUTSIDE on both sides + RUN_HOLE) and the
// runHole picker (0 middle, odd = left, even = right).
import { GAP_X, holeX } from "../../model/art";
import { OL_X } from "../../model/geometry";
import { cx } from "../../ui";
import s from "./GapDiagram.module.css";

const SPAN = 11.5;
const pct = (x: number) => `${((x + SPAN) / (2 * SPAN)) * 100}%`;

function Line() {
  return (
    <svg className={s.svg} viewBox={`${-SPAN} -2 ${2 * SPAN} 4`} preserveAspectRatio="none" aria-hidden>
      <line className={s.los} x1={-SPAN} y1={0} x2={SPAN} y2={0} />
    </svg>
  );
}

function Linemen() {
  return (
    <>
      {OL_X.map((x) => (
        <span key={x} className={cx(s.ol, x === 0 && s.center)} style={{ left: pct(x) }} />
      ))}
    </>
  );
}

const LETTERS = ["A", "B", "C", "D", "E", "OUTSIDE"] as const;

export function GapPicker({ value, onChange, disabled }: { value: string; onChange(v: string): void; disabled?: boolean }) {
  const gaps = LETTERS.flatMap((l) => [
    { value: `${l}_GAP_Left`, x: -GAP_X[l], label: l === "OUTSIDE" ? "OUT" : l },
    { value: `${l}_GAP_RIGHT`, x: GAP_X[l], label: l === "OUTSIDE" ? "OUT" : l },
  ]);
  return (
    <div className={s.wrap}>
      <div className={s.diagram}>
        <Line />
        <Linemen />
        {gaps.map((g) => (
          <button
            key={g.value}
            type="button"
            disabled={disabled}
            className={cx(s.gap, value === g.value && s.on)}
            style={{ left: pct(Math.max(-SPAN + 0.6, Math.min(SPAN - 0.6, g.x))) }}
            title={g.value}
            onClick={() => onChange(g.value)}
          >
            {g.label}
          </button>
        ))}
      </div>
      <button type="button" disabled={disabled} className={cx(s.holeBtn, value === "RUN_HOLE" && s.on)} onClick={() => onChange("RUN_HOLE")}>
        Run hole
      </button>
    </div>
  );
}

export function HolePicker({ value, onChange, disabled }: { value: number; onChange(v: number): void; disabled?: boolean }) {
  const holes = [9, 7, 5, 3, 1, 0, 2, 4, 6, 8];
  return (
    <div className={s.wrap}>
      <div className={s.diagram}>
        <Line />
        <Linemen />
        {holes.map((h) => (
          <button
            key={h}
            type="button"
            disabled={disabled}
            className={cx(s.gap, s.hole, value === h && s.on)}
            style={{ left: pct(holeX(h)) }}
            title={h === 0 ? "0 · middle" : `${h} · ${h % 2 ? "left" : "right"} ${"ABCDE"[Math.ceil(h / 2) - 1]} gap`}
            onClick={() => onChange(h)}
          >
            {h}
          </button>
        ))}
      </div>
    </div>
  );
}
