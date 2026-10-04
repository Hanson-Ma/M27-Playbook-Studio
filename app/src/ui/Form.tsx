// Form controls. Controlled with value + onChange(value) (not DOM events) so callers stay terse.
import {
  useId,
  useRef,
  useState,
  type CSSProperties,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cx } from "./cx";
import { Icon, renderIcon, type IconName } from "./Icon";
import s from "./Form.module.css";

export type FieldSize = "sm" | "md" | "lg";

// ─────────────────────────────── Label / FormRow ───────────────────────────────

export function Label({ children, htmlFor, className }: { children: ReactNode; htmlFor?: string; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cx(s.label, className)}>
      {children}
    </label>
  );
}

export interface FormRowProps {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Label left, control right (settings rows). */
  inline?: boolean;
  htmlFor?: string;
  className?: string;
}

export function FormRow({ label, children, hint, error, inline, htmlFor, className }: FormRowProps) {
  return (
    <div className={cx(s.row, inline && s.rowInline, className)}>
      <div className={s.rowHead}>
        <Label htmlFor={htmlFor}>{label}</Label>
        {inline && hint && !error && <div className={s.hint}>{hint}</div>}
      </div>
      <div className={s.rowControl}>
        {children}
        {!inline && hint && !error && <div className={s.hint}>{hint}</div>}
        {error && <div className={s.error}>{error}</div>}
      </div>
    </div>
  );
}

// ─────────────────────────────── TextInput / TextArea ───────────────────────────────

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "size" | "prefix"> {
  value: string;
  onChange(value: string): void;
  icon?: IconName | ReactNode;
  /** Show an × button while there's text; Esc also clears. */
  clearable?: boolean;
  onClear?: () => void;
  size?: FieldSize;
  invalid?: boolean;
  mono?: boolean;
  /** Trailing content inside the field (unit, count, button). */
  suffix?: ReactNode;
  ref?: Ref<HTMLInputElement>;
  wrapperClassName?: string;
}

export function TextInput({ value, onChange, icon, clearable, onClear, size = "md", invalid, mono, suffix, ref, className, wrapperClassName, onKeyDown, disabled, ...rest }: TextInputProps) {
  const inner = useRef<HTMLInputElement | null>(null);
  const clear = () => {
    onChange("");
    onClear?.();
    inner.current?.focus();
  };
  const setRef = (node: HTMLInputElement | null) => {
    inner.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) (ref as { current: HTMLInputElement | null }).current = node;
  };
  return (
    <div className={cx(s.field, s[size], invalid && s.invalid, disabled && s.disabled, wrapperClassName)}>
      {icon !== undefined && <span className={s.fieldIcon}>{renderIcon(icon, size === "sm" ? 14 : 16)}</span>}
      <input
        ref={setRef}
        className={cx(s.input, mono && s.mono, className)}
        value={value}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (!e.defaultPrevented && clearable && e.key === "Escape" && value) {
            e.preventDefault();
            clear();
          }
        }}
        {...rest}
      />
      {clearable && value && !disabled && (
        <button type="button" className={s.clear} onClick={clear} aria-label="Clear" tabIndex={-1}>
          <Icon name="close" size={13} />
        </button>
      )}
      {suffix !== undefined && <span className={s.suffix}>{suffix}</span>}
    </div>
  );
}

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> {
  value: string;
  onChange(value: string): void;
  mono?: boolean;
  invalid?: boolean;
  /** Grow with content up to `maxRows`. */
  autoGrow?: boolean;
  maxRows?: number;
  ref?: Ref<HTMLTextAreaElement>;
}

export function TextArea({ value, onChange, mono, invalid, autoGrow, maxRows = 16, rows = 3, className, ref, style, ...rest }: TextAreaProps) {
  const lines = autoGrow ? Math.min(maxRows, Math.max(rows, value.split("\n").length)) : rows;
  return (
    <textarea
      ref={ref}
      className={cx(s.textarea, mono && s.mono, invalid && s.invalid, className)}
      value={value}
      rows={lines}
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange(e.target.value)}
      style={style}
      {...rest}
    />
  );
}

// ─────────────────────────────── Select ───────────────────────────────

export type SelectOption = string | { value: string; label?: string; disabled?: boolean };

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value" | "size"> {
  value: string;
  onChange(value: string): void;
  options: readonly SelectOption[];
  /** Shown as a disabled first option when value is empty / not in the list. */
  placeholder?: string;
  size?: FieldSize;
  invalid?: boolean;
  ref?: Ref<HTMLSelectElement>;
  wrapperClassName?: string;
}

const optValue = (o: SelectOption) => (typeof o === "string" ? o : o.value);
const optLabel = (o: SelectOption) => (typeof o === "string" ? o : (o.label ?? o.value));

/** Styled native select (best for short lists; use SearchSelect for long enums). */
export function Select({ value, onChange, options, placeholder, size = "md", invalid, className, wrapperClassName, disabled, ref, ...rest }: SelectProps) {
  const known = options.some((o) => optValue(o) === value);
  return (
    <div className={cx(s.field, s.selectWrap, s[size], invalid && s.invalid, disabled && s.disabled, wrapperClassName)}>
      <select ref={ref} className={cx(s.select, className)} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} {...rest}>
        {(placeholder !== undefined || !known) && (
          <option value={known ? "" : value} disabled>
            {placeholder ?? value}
          </option>
        )}
        {options.map((o) => (
          <option key={optValue(o)} value={optValue(o)} disabled={typeof o === "string" ? false : o.disabled}>
            {optLabel(o)}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={14} className={s.selectChevron} />
    </div>
  );
}

// ─────────────────────────────── Toggle / Checkbox ───────────────────────────────

export interface ToggleProps {
  checked: boolean;
  onChange(checked: boolean): void;
  label?: ReactNode;
  disabled?: boolean;
  size?: "sm" | "md";
  title?: string;
  className?: string;
  "aria-label"?: string;
}

export function Toggle({ checked, onChange, label, disabled, size = "md", title, className, ...aria }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={aria["aria-label"]}
      disabled={disabled}
      title={title}
      className={cx(s.toggle, s[`toggle_${size}`], checked && s.on, className)}
      onClick={() => onChange(!checked)}
    >
      <span className={s.track}>
        <span className={s.thumb} />
      </span>
      {label !== undefined && <span className={s.controlLabel}>{label}</span>}
    </button>
  );
}

export interface CheckboxProps {
  checked: boolean;
  onChange(checked: boolean): void;
  label?: ReactNode;
  /** Mixed state (some children checked); clicking checks all. */
  indeterminate?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
}

export function Checkbox({ checked, onChange, label, indeterminate, disabled, title, className }: CheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      disabled={disabled}
      title={title}
      className={cx(s.checkbox, (checked || indeterminate) && s.on, className)}
      onClick={() => onChange(indeterminate ? true : !checked)}
    >
      <span className={s.box}>{indeterminate ? <Icon name="minus" size={12} /> : checked ? <Icon name="check" size={12} /> : null}</span>
      {label !== undefined && <span className={s.controlLabel}>{label}</span>}
    </button>
  );
}

// ─────────────────────────────── Segmented ───────────────────────────────

export interface SegmentOption<T extends string = string> {
  value: T;
  label?: ReactNode;
  icon?: IconName | ReactNode;
  title?: string;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string = string> {
  options: SegmentOption<T>[];
  value: T;
  onChange(value: T): void;
  size?: "sm" | "md";
  /** Stretch segments to fill the width. */
  block?: boolean;
  className?: string;
  "aria-label"?: string;
}

export function Segmented<T extends string = string>({ options, value, onChange, size = "md", block, className, ...aria }: SegmentedProps<T>) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const enabled = options.filter((o) => !o.disabled);
    const i = enabled.findIndex((o) => o.value === value);
    const next = enabled[(i + (e.key === "ArrowRight" ? 1 : -1) + enabled.length) % enabled.length];
    if (next) {
      e.preventDefault();
      onChange(next.value);
    }
  };
  return (
    <div className={cx(s.segmented, s[`seg_${size}`], block && s.segBlock, className)} role="radiogroup" aria-label={aria["aria-label"]} onKeyDown={onKey}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={o.disabled}
            title={o.title}
            className={cx(s.segment, on && s.segOn)}
            onClick={() => onChange(o.value)}
          >
            {renderIcon(o.icon, size === "sm" ? 13 : 15)}
            {o.label !== undefined && <span className={s.segLabel}>{o.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────── Slider ───────────────────────────────

export interface SliderProps {
  value: number;
  onChange(value: number): void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  /** Always show the value bubble (default: on hover/drag/focus). */
  showValue?: boolean;
  width?: number | string;
  className?: string;
  "aria-label"?: string;
}

/** Range slider (0–100 by default) with a value bubble over the thumb. */
export function Slider({ value, onChange, min = 0, max = 100, step = 1, suffix = "", disabled, showValue, width, className, ...aria }: SliderProps) {
  const id = useId();
  const [active, setActive] = useState(false);
  const pct = max > min ? ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100 : 0;
  return (
    <div className={cx(s.slider, (active || showValue) && s.sliderActive, disabled && s.disabled, className)} style={{ width, "--p": pct / 100 } as CSSProperties}>
      <input
        id={id}
        type="range"
        className={s.range}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={aria["aria-label"]}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerDown={() => setActive(true)}
        onPointerUp={() => setActive(false)}
        onBlur={() => setActive(false)}
      />
      <output htmlFor={id} className={s.bubble}>
        {value}
        {suffix}
      </output>
    </div>
  );
}
