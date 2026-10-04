// Status pieces: Spinner, ProgressBar, EmptyState.
import type { CSSProperties, ReactNode } from "react";
import { cx } from "./cx";
import { renderIcon, type IconName } from "./Icon";
import s from "./Feedback.module.css";

export function Spinner({ size = 16, className, label }: { size?: number; className?: string; label?: string }) {
  return (
    <svg className={cx(s.spinner, className)} width={size} height={size} viewBox="0 0 24 24" role="status" aria-label={label ?? "Loading"}>
      <circle cx="12" cy="12" r="9" className={s.track} />
      <path d="M12 3a9 9 0 0 1 9 9" className={s.arc} />
    </svg>
  );
}

export interface ProgressBarProps {
  /** 0–1. Omit (or set `indeterminate`) for an animated bar. */
  value?: number;
  indeterminate?: boolean;
  label?: ReactNode;
  /** Right-aligned detail, e.g. "4.2 / 17 MB". Defaults to the percentage. */
  detail?: ReactNode;
  tone?: "default" | "ok" | "warning" | "danger";
  size?: "sm" | "md";
  className?: string;
}

export function ProgressBar({ value, indeterminate, label, detail, tone = "default", size = "md", className }: ProgressBarProps) {
  const ind = indeterminate || value === undefined || !Number.isFinite(value);
  const pct = ind ? 0 : Math.max(0, Math.min(1, value!)) * 100;
  return (
    <div className={cx(s.progress, s[tone], s[size], className)}>
      {label || detail !== undefined ? (
        <div className={s.progressHead}>
          <span className={s.progressLabel}>{label}</span>
          <span className={s.progressDetail}>{detail ?? (ind ? null : `${Math.round(pct)}%`)}</span>
        </div>
      ) : null}
      <div
        className={s.track2}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={ind ? undefined : Math.round(pct)}
      >
        <div className={cx(s.fill, ind && s.indeterminate)} style={ind ? undefined : ({ width: `${pct}%` } as CSSProperties)} />
      </div>
    </div>
  );
}

export interface EmptyStateProps {
  icon?: IconName | ReactNode;
  title: ReactNode;
  body?: ReactNode;
  /** Buttons. */
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}

export function EmptyState({ icon, title, body, action, compact, className }: EmptyStateProps) {
  return (
    <div className={cx(s.empty, compact && s.compact, className)}>
      {icon !== undefined && <div className={s.emptyIcon}>{renderIcon(icon, compact ? 20 : 28)}</div>}
      <div className={s.emptyTitle}>{title}</div>
      {body && <div className={s.emptyBody}>{body}</div>}
      {action && <div className={s.emptyAction}>{action}</div>}
    </div>
  );
}
