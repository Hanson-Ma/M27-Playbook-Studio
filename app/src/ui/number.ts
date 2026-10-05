// Number helpers for NumberField (pure, tested).

/** Decimal places implied by a step: 1 → 0, 0.5 → 1, 0.25 → 2. */
export function decimalsOf(step: number): number {
  if (!Number.isFinite(step) || Number.isInteger(step)) return 0;
  const s = String(step);
  const e = s.match(/e-(\d+)$/);
  if (e) return Number(e[1]);
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : s.length - dot - 1;
}

export function clamp(v: number, min = -Infinity, max = Infinity): number {
  return Math.min(max, Math.max(min, v));
}

/** Round to `decimals` places without float noise (0.1 + 0.2 → 0.3). */
export function roundTo(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round((v + Number.EPSILON * Math.sign(v)) * f) / f;
}

/** Shortest text for a value at a precision: 7.50 → "7.5", 7.00 → "7", -0 → "0". */
export function formatNumber(v: number | undefined, decimals: number): string {
  if (v === undefined || !Number.isFinite(v)) return "";
  const r = roundTo(v, decimals);
  return String(r === 0 ? 0 : r);
}

/** Parse user text ("7,5", " -3 ", "+2"); undefined when not a number. */
export function parseNumber(text: string): number | undefined {
  const t = text.trim().replace(",", ".");
  if (!t || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** value ± step × multiplier, clamped and rounded to the precision. */
export function stepBy(value: number, dir: 1 | -1, step: number, multiplier: number, decimals: number, min?: number, max?: number): number {
  return clamp(roundTo(value + dir * step * multiplier, decimals), min, max);
}
