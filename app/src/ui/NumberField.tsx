// Numeric input: steppers (click or hold), min/max/step, unit suffix, ↑/↓ keys while focused (Shift ×10) and
// click-drag scrubbing on the label. Typing edits a draft that commits on Enter/blur (Esc reverts), so partial text
// like "-" is fine. The stepper buttons are tabIndex −1 (Tab goes field to field).
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { clamp, decimalsOf, formatNumber, parseNumber, roundTo, stepBy } from "./number";
import s from "./NumberField.module.css";

export interface NumberFieldProps {
  /** undefined renders empty (e.g. mixed values). */
  value: number | undefined;
  onChange(value: number): void;
  min?: number;
  max?: number;
  step?: number;
  /** Decimal places kept (default: those of `step`). */
  precision?: number;
  /** Unit after the number: "yd", "°", "%". */
  suffix?: string;
  /** Scrub handle inside the field on the left ("X", "Dist"); drag it horizontally to change the value. */
  label?: ReactNode;
  /** Pixels of drag per step while scrubbing (default 4). */
  scrubPixels?: number;
  size?: "sm" | "md";
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
  width?: number | string;
  title?: string;
  className?: string;
  "aria-label"?: string;
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  precision,
  suffix,
  label,
  scrubPixels = 4,
  size = "md",
  disabled,
  invalid,
  placeholder,
  width,
  title,
  className,
  ...aria
}: NumberFieldProps) {
  const decimals = precision ?? decimalsOf(step);
  const [draft, setDraftState] = useState<string | null>(null);
  // Mirrors `draft` for the stepper's repeat timer, which runs a closure from the pointerdown render.
  const draftRef = useRef<string | null>(null);
  const setDraft = (d: string | null) => {
    draftRef.current = d;
    setDraftState(d);
  };
  const input = useRef<HTMLInputElement>(null);
  const repeatTimer = useRef<number | undefined>(undefined);
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => () => window.clearTimeout(repeatTimer.current), []);

  const emit = (v: number) => {
    const next = clamp(roundTo(v, decimals), min, max);
    if (next !== latest.current) {
      latest.current = next;
      onChange(next);
    }
    return next;
  };

  const commit = () => {
    const d = draftRef.current;
    if (d === null) return;
    const n = parseNumber(d);
    if (n !== undefined) emit(n);
    setDraft(null);
  };

  const bump = (dir: 1 | -1, mult: number) => {
    const d = draftRef.current;
    const base = d !== null ? (parseNumber(d) ?? latest.current ?? 0) : (latest.current ?? 0);
    emit(stepBy(base, dir, step, mult, decimals, min, max));
    // The text follows the value again (an undo/redo while focused must not leave a stale draft that blur would
    // write back).
    setDraft(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      bump(e.key === "ArrowUp" ? 1 : -1, e.shiftKey ? 10 : 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit();
      input.current?.select();
    } else if (e.key === "Escape" && draftRef.current !== null) {
      e.preventDefault();
      setDraft(null);
      input.current?.blur();
    }
  };

  // Hold a stepper to repeat (350 ms, then every 80 ms).
  const startRepeat = (dir: 1 | -1, e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const mult = e.shiftKey ? 10 : 1;
    bump(dir, mult);
    const tick = (delay: number) => {
      repeatTimer.current = window.setTimeout(() => {
        bump(dir, mult);
        tick(80);
      }, delay);
    };
    tick(350);
    const stop = () => {
      window.clearTimeout(repeatTimer.current);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  const startScrub = (e: PointerEvent<HTMLSpanElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const start = latest.current ?? 0;
    let moved = false;
    const move = (ev: globalThis.PointerEvent) => {
      const steps = Math.round((ev.clientX - startX) / scrubPixels);
      if (steps !== 0) moved = true;
      if (moved) emit(start + steps * step * (ev.shiftKey ? 10 : 1));
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      if (!moved) input.current?.focus();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const shown = draft ?? formatNumber(value, decimals);
  const atMin = value !== undefined && min !== undefined && value <= min;
  const atMax = value !== undefined && max !== undefined && value >= max;

  return (
    <div className={cx(s.field, s[size], invalid && s.invalid, disabled && s.disabled, className)} style={{ width }} title={title}>
      {label !== undefined && (
        <span className={s.scrub} onPointerDown={startScrub} title="Drag to change (Shift ×10)">
          {label}
        </span>
      )}
      <input
        ref={input}
        className={s.input}
        inputMode="decimal"
        value={shown}
        placeholder={placeholder ?? (value === undefined ? "—" : undefined)}
        disabled={disabled}
        aria-label={aria["aria-label"]}
        aria-invalid={invalid || undefined}
        onFocus={(e) => {
          // No draft until the user types: the shown text tracks the value (steps, drags, undo) while focused.
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      {suffix && <span className={s.suffix}>{suffix}</span>}
      <span className={s.steppers}>
        <button type="button" tabIndex={-1} className={s.stepper} disabled={disabled || atMax} onPointerDown={(e) => startRepeat(1, e)} aria-label="Increase">
          <Icon name="chevronUp" size={11} />
        </button>
        <button type="button" tabIndex={-1} className={s.stepper} disabled={disabled || atMin} onPointerDown={(e) => startRepeat(-1, e)} aria-label="Decrease">
          <Icon name="chevronDown" size={11} />
        </button>
      </span>
    </div>
  );
}
