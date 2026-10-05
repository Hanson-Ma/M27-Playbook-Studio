// Mini line-of-scrimmage diagrams: the BlockingGap picker (A–E / OUTSIDE on both sides + RUN_HOLE) and the
// runHole picker (0 middle, odd = left, even = right).
// The buttons are evenly spaced, not to scale: to scale the A gaps (and holes 0 / 1 / 2) sit under a yard apart, so
// their buttons would overlap in a 200–250 px diagram. The linemen are placed on the same piecewise-linear scale
// between the neighbouring stops, so every gap / hole still reads as "between these two linemen".
import { GAP_X, holeX } from "../../model/art";
import { OL_X } from "../../model/geometry";
import { cx } from "../../ui";
import s from "./GapDiagram.module.css";

interface Stop {
  /** Lateral yards (negative = left). */
  x: number;
  /** Relative width of the stop's slot (default 1). */
  w?: number;
}

/** x (yards) → left % on the diagram: stops evenly spaced by weight, linear in between, clamped at the ends. */
function stopScale(stops: Stop[]): (x: number) => string {
  const total = stops.reduce((n, st) => n + (st.w ?? 1), 0);
  let acc = 0;
  const centers = stops.map((st) => {
    const w = st.w ?? 1;
    const c = (acc + w / 2) / total;
    acc += w;
    return c;
  });
  return (x: number) => {
    let t = centers[0];
    if (x >= stops[stops.length - 1].x) t = centers[centers.length - 1];
    else if (x > stops[0].x) {
      let i = 0;
      while (x > stops[i + 1].x) i++;
      t = centers[i] + ((x - stops[i].x) / (stops[i + 1].x - stops[i].x)) * (centers[i + 1] - centers[i]);
    }
    return `${t * 100}%`;
  };
}

function Line() {
  return (
    <svg className={s.svg} viewBox="0 -2 100 4" preserveAspectRatio="none" aria-hidden>
      <line className={s.los} x1={0} y1={0} x2={100} y2={0} />
    </svg>
  );
}

function Linemen({ at }: { at: (x: number) => string }) {
  return (
    <>
      {OL_X.map((x) => (
        <span key={x} className={cx(s.ol, x === 0 && s.center)} style={{ left: at(x) }} />
      ))}
    </>
  );
}

const LETTERS = ["A", "B", "C", "D", "E", "OUTSIDE"] as const;
// OUT · E · D · C · B · A | A · B · C · D · E · OUT (the OUT labels are wider: a bigger slot).
const GAP_SCALE = stopScale(
  [...LETTERS].reverse().map((l) => ({ x: -GAP_X[l], w: l === "OUTSIDE" ? 1.5 : 1 })).concat(LETTERS.map((l) => ({ x: GAP_X[l], w: l === "OUTSIDE" ? 1.5 : 1 }))),
);

export function GapPicker({ value, onChange, disabled }: { value: string; onChange(v: string): void; disabled?: boolean }) {
  const gaps = LETTERS.flatMap((l) => [
    { value: `${l}_GAP_Left`, x: -GAP_X[l], label: l === "OUTSIDE" ? "OUT" : l },
    { value: `${l}_GAP_RIGHT`, x: GAP_X[l], label: l === "OUTSIDE" ? "OUT" : l },
  ]);
  return (
    <div className={s.wrap}>
      <div className={s.diagram}>
        <Line />
        <Linemen at={GAP_SCALE} />
        {gaps.map((g) => (
          <button
            key={g.value}
            type="button"
            disabled={disabled}
            className={cx(s.gap, g.label === "OUT" && s.out, value === g.value && s.on)}
            style={{ left: GAP_SCALE(g.x) }}
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

// Holes left to right; the right side has no 10, so an empty slot at E-right keeps the center in the middle.
const HOLES = [9, 7, 5, 3, 1, 0, 2, 4, 6, 8];
const HOLE_SCALE = stopScale([...HOLES.map((h) => ({ x: holeX(h) })), { x: GAP_X.E }]);

export function HolePicker({ value, onChange, disabled }: { value: number; onChange(v: number): void; disabled?: boolean }) {
  return (
    <div className={s.wrap}>
      <div className={s.diagram}>
        <Line />
        <Linemen at={HOLE_SCALE} />
        {HOLES.map((h) => (
          <button
            key={h}
            type="button"
            disabled={disabled}
            className={cx(s.gap, s.hole, value === h && s.on)}
            style={{ left: HOLE_SCALE(holeX(h)) }}
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
