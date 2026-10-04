// Buttons: Madden light pill (primary), dark secondary, ghost, danger; IconButton with a tooltip (+ keyboard shortcut).
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import type { PadButton } from "../model/audibles";
import { cx } from "./cx";
import { Icon, renderIcon, type IconName } from "./Icon";
import { Spinner } from "./Feedback";
import { useTooltip } from "./Tooltip";
import type { Placement } from "./position";
import s from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon name or node. */
  icon?: IconName | ReactNode;
  iconRight?: IconName | ReactNode;
  loading?: boolean;
  /** Full width. */
  block?: boolean;
  /** Pressed/selected look (toggle buttons). */
  active?: boolean;
  type?: "button" | "submit" | "reset";
  ref?: Ref<HTMLButtonElement>;
}

const ICON_PX: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 20 };

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  iconRight,
  loading,
  block,
  active,
  type = "button",
  className,
  children,
  disabled,
  ref,
  ...rest
}: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(s.btn, s[variant], s[size], block && s.block, active && s.active, loading && s.loading, !children && s.iconOnly, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-pressed={active === undefined ? undefined : active}
      {...rest}
    >
      {loading ? <Spinner size={ICON_PX[size]} /> : renderIcon(icon, ICON_PX[size])}
      {children !== undefined && children !== null && <span className={s.text}>{children}</span>}
      {renderIcon(iconRight, ICON_PX[size])}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "title"> {
  icon: IconName;
  /** Tooltip + accessible name. */
  title: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
  active?: boolean;
  /** Keyboard shortcut shown in the tooltip (only universal keys such as "mod+z" are drawn; `button`/`hold` are ignored). */
  shortcut?: { button?: PadButton; hold?: PadButton; keys?: string[] };
  tooltipPlacement?: Placement;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({
  icon,
  title,
  size = "md",
  variant = "ghost",
  active,
  shortcut,
  tooltipPlacement = "bottom",
  className,
  ref,
  onPointerEnter,
  onPointerLeave,
  onPointerDown,
  onFocus,
  onBlur,
  ...rest
}: IconButtonProps) {
  const tip = useTooltip({ content: title, placement: tooltipPlacement, shortcut });
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={title}
        aria-pressed={active === undefined ? undefined : active}
        className={cx(s.btn, s[variant], s[size], s.iconOnly, active && s.active, className)}
        onPointerEnter={(e) => {
          tip.handlers.onPointerEnter(e);
          onPointerEnter?.(e);
        }}
        onPointerLeave={(e) => {
          tip.handlers.onPointerLeave();
          onPointerLeave?.(e);
        }}
        onPointerDown={(e) => {
          tip.handlers.onPointerDown();
          onPointerDown?.(e);
        }}
        onFocus={(e) => {
          tip.handlers.onFocus(e);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          tip.handlers.onBlur();
          onBlur?.(e);
        }}
        {...rest}
      >
        <Icon name={icon} size={size === "lg" ? 20 : size === "sm" ? 14 : 18} />
      </button>
      {tip.node}
    </>
  );
}
