// Static field paint (bands, yard lines, hashes, numbers, sidelines, LOS). It only depends on the visible yard
// range, the ball spot, the LOS yard line and the depth scale, so the element trees are cached at module level and
// shared by every Field and thumbnail on the page: React re-renders cost nothing and each instance mounts ~15 DOM
// nodes (all ticks of one kind are a single <path>).
// With a compressed depth scale (play cards) every marking sits at its mapped y; markings that the compression would
// squash together are left out: 1-yd ticks, then numbers, then 5-yd lines/bands as the scale flattens.
import type { ReactElement } from "react";
import type { BallSpot } from "../state/settings";
import {
  DEFAULT_LOS_YARD_LINE,
  fieldYRange,
  hashXs,
  r3,
  sidelineXs,
  sy,
  TRUE_DEPTH,
  yardLines,
  yardTicks,
  type DepthScale,
} from "./fieldMath";
import styles from "./Field.module.css";

export type FieldMarkingsMode = "full" | "minimal" | "none";

export interface FieldMarkingsOptions {
  /** Field y range to paint (clamped to the field incl. end zones). */
  minY: number;
  maxY: number;
  ballSpot?: BallSpot;
  los?: number;
  mode?: FieldMarkingsMode;
  /** Depth compression (cards); minY/maxY stay in true field yards. Default TRUE_DEPTH. */
  depth?: DepthScale;
}

const HASH_LEN = 2 / 3; // 2 ft
const SIDE_TICK_IN = 0.11; // 4 in inside the sideline
const NUMBER_CENTER = 8; // numbers span 7–9 yd from the sideline
const NUMBER_SIZE = 2.9; // font size (yd) for ~2 yd tall digits in a condensed face
// Minimum depth-scale slope for each marking under compression (1 = true scale).
const MIN_SLOPE_TICKS = 0.6;
const MIN_SLOPE_NUMBERS = 0.6;
const MIN_SLOPE_LINES = 0.3;
/** Compressed fields paint the turf this far (drawn yd) past a curve limit, so no out-of-bounds sliver shows. */
const LIMIT_OVERPAINT = 40;

const cache = new Map<string, ReactElement>();
const CACHE_MAX = 96;

/** Cached static layer for the given options (render it inside the field <svg>). */
export function fieldMarkings(o: FieldMarkingsOptions): ReactElement {
  const ballSpot = o.ballSpot ?? "middle";
  const los = o.los ?? DEFAULT_LOS_YARD_LINE;
  const mode = o.mode ?? "full";
  const depth = o.depth ?? TRUE_DEPTH;
  // Snap the range out to whole 5-yd steps so small viewport changes reuse the same tree.
  const minY = Math.floor(o.minY / 5) * 5;
  const maxY = Math.ceil(o.maxY / 5) * 5;
  const key = `${minY}|${maxY}|${ballSpot}|${los}|${mode}|${depth.id}`;
  let el = cache.get(key);
  if (!el) {
    el = build(minY, maxY, ballSpot, los, mode, depth);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, el);
  }
  return el;
}

function build(minY: number, maxY: number, ballSpot: BallSpot, los: number, mode: FieldMarkingsMode, depth: DepthScale): ReactElement {
  const [sl, sr] = sidelineXs(ballSpot);
  const field = fieldYRange(los);
  const y0 = Math.max(minY, field.minY);
  const y1 = Math.min(maxY, field.maxY);
  if (y1 <= y0) return <g />;
  const width = sr - sl;
  const compressed = !!depth.id;
  // Field y → SVG y through the depth scale.
  const Y = (y: number) => r3(sy(depth.map(y)));
  const rectD = (top: number, bottom: number) => `M${r3(sl)} ${r3(top)}h${r3(width)}V${r3(bottom)}H${r3(sl)}Z`;
  const rect = (a: number, b: number) => rectD(Y(b), Y(a));
  const hline = (y: number, xa = sl, xb = sr) => `M${r3(xa)} ${Y(y)}H${r3(xb)}`;
  const flat = (y: number, min: number) => compressed && depth.slope(y) < min;
  // Under compression the far ends of the range sit on the curve's limits; paint the turf past them.
  let turfTop = Y(y1);
  let turfBottom = Y(y0);
  if (compressed && y1 >= field.maxY) turfTop -= LIMIT_OVERPAINT;
  if (compressed && y0 <= field.minY) turfBottom += LIMIT_OVERPAINT;
  const sidelines = `M${r3(sl)} ${r3(turfTop)}V${r3(turfBottom)}M${r3(sr)} ${r3(turfTop)}V${r3(turfBottom)}`;

  const fieldRect = <path className={styles.fieldRect} d={rectD(turfTop, turfBottom)} />;
  if (mode === "none") return <g aria-hidden>{fieldRect}</g>;

  const lines = yardLines(y0, y1, los).filter((l) => !flat(l.y, MIN_SLOPE_LINES));
  let minor = "";
  let major = "";
  let goal = "";
  for (const l of lines) {
    if (l.goal) goal += hline(l.y);
    else if (l.major) major += hline(l.y);
    else minor += hline(l.y);
  }
  const losLine = <path className={styles.los} d={hline(0)} />;

  if (mode === "minimal") {
    return (
      <g aria-hidden>
        {fieldRect}
        <path className={styles.lineMinimal} d={minor + major + goal} />
        <path className={styles.sideline} d={sidelines} />
        {losLine}
      </g>
    );
  }

  // Alternating 5-yd bands inside the field of play, end zones as solid blocks.
  let bands = "";
  const playMin = Math.max(y0, -los);
  const playMax = Math.min(y1, 100 - los);
  for (let yard = Math.floor((los + playMin) / 5) * 5; yard < los + playMax; yard += 5) {
    if ((yard / 5) % 2 !== 1) continue;
    const a = Math.max(yard - los, playMin);
    const b = Math.min(yard + 5 - los, playMax);
    // A band whose edges are no longer drawn as lines would float on its own: drop it with them.
    if (b > a && !flat(a, MIN_SLOPE_LINES) && !flat(b, MIN_SLOPE_LINES)) bands += rect(a, b);
  }
  let endZones = "";
  if (y0 < -los && !flat(-los, MIN_SLOPE_LINES)) endZones += rect(y0, Math.min(-los, y1));
  if (y1 > 100 - los && !flat(100 - los, MIN_SLOPE_LINES)) endZones += rect(Math.max(100 - los, y0), y1);

  const [hl, hr] = hashXs(ballSpot);
  let hashes = "";
  let sideTicks = "";
  for (const y of yardTicks(y0, y1, los)) {
    if (flat(y, MIN_SLOPE_TICKS)) continue;
    hashes += hline(y, hl - HASH_LEN, hl) + hline(y, hr, hr + HASH_LEN);
    sideTicks += hline(y, sl + SIDE_TICK_IN, sl + SIDE_TICK_IN + HASH_LEN) + hline(y, sr - SIDE_TICK_IN - HASH_LEN, sr - SIDE_TICK_IN);
  }

  const numbers: ReactElement[] = [];
  let arrows = "";
  for (const l of lines) {
    if (l.number === undefined) continue;
    // Digits span ~±1.5 yd along y; drawn upright they would overlap the squashed lines around them.
    if (flat(l.y - 1.5, MIN_SLOPE_NUMBERS) || flat(l.y + 1.5, MIN_SLOPE_NUMBERS)) continue;
    const ys = Y(l.y);
    const xl = r3(sl + NUMBER_CENTER);
    const xr = r3(sr - NUMBER_CENTER);
    // Painted numbers read from the near sideline: bottoms toward the sideline.
    numbers.push(
      <text key={`l${l.yard}`} className={styles.num} fontSize={NUMBER_SIZE} transform={`translate(${xl} ${ys}) rotate(90)`}>
        {l.number}
      </text>,
      <text key={`r${l.yard}`} className={styles.num} fontSize={NUMBER_SIZE} transform={`translate(${xr} ${ys}) rotate(-90)`}>
        {l.number}
      </text>,
    );
    // Direction arrows point at the nearer goal line (none at the 50).
    if (l.number !== 50) {
      const dir = l.yard < 50 ? -1 : 1; // field y direction toward the nearer goal
      const tipY = l.y + dir * 2.65;
      const baseY = l.y + dir * 1.95;
      // Arrows keep their true size next to the number (offsets from the mapped line, not mapped themselves).
      const ly = depth.map(l.y);
      for (const x of [sl + NUMBER_CENTER + 0.75, sr - NUMBER_CENTER - 0.75]) {
        arrows += `M${r3(x)} ${r3(sy(ly + tipY - l.y))}L${r3(x - 0.36)} ${r3(sy(ly + baseY - l.y))}H${r3(x + 0.36)}Z`;
      }
    }
  }

  return (
    <g aria-hidden>
      {fieldRect}
      {bands && <path className={styles.band} d={bands} />}
      {endZones && <path className={styles.band} d={endZones} />}
      <path className={styles.hash} d={hashes} />
      <path className={styles.hash} d={sideTicks} />
      {minor && <path className={styles.line} d={minor} />}
      {major && <path className={styles.lineMajor} d={major} />}
      {goal && <path className={styles.goal} d={goal} />}
      {numbers}
      {arrows && <path className={styles.arrow} d={arrows} />}
      <path className={styles.sideline} d={sidelines} />
      {losLine}
    </g>
  );
}
