// Tags (play-type chips like Madden's blue PASS) and removable filter chips. Tag and Chip text shows as written
// (Title Case for chrome); pass `caps` when it is a Madden name (play type, formation, play) — PlayTypeTag always is.
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { familyColor, playTypeInfo, type PlayFamily } from "../model/playtypes";
import { cx } from "./cx";
import { Icon, renderIcon, type IconName } from "./Icon";
import s from "./Tag.module.css";

export type TagTone = PlayFamily | "needsMod" | "custom" | "neutral" | "ok" | "warning" | "danger" | "info";

const TONE_COLOR: Record<Exclude<TagTone, PlayFamily>, string> = {
  needsMod: "var(--amber)",
  custom: "var(--blue-2)",
  neutral: "var(--slate)",
  ok: "var(--green)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  info: "var(--info)",
};

/** Tones light enough to need dark text when solid. */
const LIGHT_TONES = new Set<TagTone>(["needsMod", "warning"]);

export interface TagProps {
  children: ReactNode;
  tone?: TagTone;
  /** Any CSS color (overrides tone), e.g. a concept category color. */
  color?: string;
  /** solid = Madden PASS tag; soft = tinted; outline = hairline. */
  variant?: "solid" | "soft" | "outline";
  size?: "sm" | "md";
  icon?: IconName | ReactNode;
  title?: string;
  /** ALL CAPS (for Madden names: play types, formations, plays). Default: the text as written. */
  caps?: boolean;
  className?: string;
}

export function Tag({ children, tone = "neutral", color, variant = "solid", size = "md", icon, title, caps, className }: TagProps) {
  const c = color ?? (tone in TONE_COLOR ? TONE_COLOR[tone as keyof typeof TONE_COLOR] : familyColor(tone as PlayFamily));
  const dark = !color && LIGHT_TONES.has(tone);
  return (
    <span className={cx(s.tag, s[variant], s[size], dark && s.darkText, caps && s.caps, className)} style={{ "--tag": c } as CSSProperties} title={title}>
      {renderIcon(icon, size === "sm" ? 11 : 13)}
      {children}
    </span>
  );
}

/** PASS / RUN / PLAY ACTION … tag from an Offense/DefensePlayType enum value. */
export function PlayTypeTag({ playType, size, variant, className }: { playType: string; size?: TagProps["size"]; variant?: TagProps["variant"]; className?: string }) {
  const info = playTypeInfo(playType);
  return (
    <Tag tone={info.family} size={size} variant={variant} title={info.long} caps className={className}>
      {info.label}
    </Tag>
  );
}

/** Amber "Needs Mod" badge for non-global library plays. */
export function NeedsModTag({ size, className }: { size?: TagProps["size"]; className?: string }) {
  return (
    <Tag tone="needsMod" size={size} className={className} title="Not global: only usable in a custom playbook with the Playbook Studio mod installed">
      Needs Mod
    </Tag>
  );
}

export interface ChipProps {
  children: ReactNode;
  /** Shows an × button. */
  onRemove?: () => void;
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  active?: boolean;
  /** Leading color dot (category color). */
  color?: string;
  icon?: IconName | ReactNode;
  count?: number;
  disabled?: boolean;
  title?: string;
  /** ALL CAPS label (for Madden names: play types, formations, plays). Default: the text as written. */
  caps?: boolean;
  className?: string;
}

/** Filter chip: toggleable (onClick + active) and/or removable (onRemove). */
export function Chip({ children, onRemove, onClick, active, color, icon, count, disabled, title, caps, className }: ChipProps) {
  const Tagname = onClick ? "button" : "span";
  return (
    <span className={cx(s.chip, active && s.chipActive, disabled && s.chipDisabled, className)} title={title}>
      <Tagname
        className={s.chipMain}
        {...(onClick ? { type: "button" as const, onClick, disabled, "aria-pressed": active } : {})}
      >
        {color && <span className={s.dot} style={{ background: color }} />}
        {renderIcon(icon, 13)}
        <span className={cx(s.chipLabel, caps && s.caps)}>{children}</span>
        {count !== undefined && <span className={s.count}>{count}</span>}
      </Tagname>
      {onRemove && (
        <button type="button" className={s.remove} onClick={onRemove} aria-label="Remove" disabled={disabled}>
          <Icon name="close" size={12} />
        </button>
      )}
    </span>
  );
}
