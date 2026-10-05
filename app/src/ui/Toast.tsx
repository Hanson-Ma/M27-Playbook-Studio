// Toasts: toast.success("Saved") anywhere; <Toaster/> (mounted once by App) renders them top-right. A toast's
// action is a button (Undo, Open, Retry…); hovering a toast pauses its timer.
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";
import s from "./Toast.module.css";

export type ToastKind = "info" | "success" | "warning" | "error";

export interface ToastOptions {
  detail?: ReactNode;
  /** ms before auto-dismiss; 0 = sticky. Default 4000 (errors 8000). */
  duration?: number;
  action?: { label: string; run(): void };
}

interface ToastItem extends ToastOptions {
  id: number;
  kind: ToastKind;
  message: ReactNode;
}

let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const MAX = 5;

function show(kind: ToastKind, message: ReactNode, opts: ToastOptions = {}): number {
  const id = ++seq;
  items = [...items, { id, kind, message, ...opts }].slice(-MAX);
  emit();
  return id;
}

function dismiss(id: number) {
  if (!items.some((t) => t.id === id)) return;
  items = items.filter((t) => t.id !== id);
  emit();
}

export const toast = {
  info: (message: ReactNode, opts?: ToastOptions) => show("info", message, opts),
  success: (message: ReactNode, opts?: ToastOptions) => show("success", message, opts),
  warning: (message: ReactNode, opts?: ToastOptions) => show("warning", message, opts),
  error: (message: ReactNode, opts?: ToastOptions) => show("error", message, opts),
  dismiss,
  clear: () => {
    items = [];
    emit();
  },
};

const ICON: Record<ToastKind, IconName> = { info: "info", success: "check", warning: "warning", error: "warning" };

function runToastAction(t: ToastItem) {
  t.action?.run();
  dismiss(t.id);
}

function ToastView({ t }: { t: ToastItem }) {
  const timer = useRef<number | undefined>(undefined);
  const duration = t.duration ?? (t.kind === "error" ? 8000 : 4000);
  const arm = () => {
    window.clearTimeout(timer.current);
    if (duration > 0) timer.current = window.setTimeout(() => dismiss(t.id), duration);
  };
  useEffect(() => {
    arm();
    return () => window.clearTimeout(timer.current);
  }, []);

  return (
    <div
      className={cx(s.toast, s[t.kind])}
      role={t.kind === "error" ? "alert" : "status"}
      onPointerEnter={() => window.clearTimeout(timer.current)}
      onPointerLeave={arm}
    >
      <span className={s.icon}>
        <Icon name={ICON[t.kind]} size={16} />
      </span>
      <div className={s.content}>
        <div className={s.message}>{t.message}</div>
        {t.detail && <div className={s.detail}>{t.detail}</div>}
      </div>
      {t.action && (
        <button type="button" className={s.action} onClick={() => runToastAction(t)}>
          {t.action.label}
        </button>
      )}
      <button type="button" className={s.close} onClick={() => dismiss(t.id)} aria-label="Dismiss">
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

export function Toaster() {
  const list = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => items,
  );
  if (!list.length) return null;
  return (
    <div className={s.stack} aria-live="polite">
      {list.map((t) => (
        <ToastView key={t.id} t={t} />
      ))}
    </div>
  );
}
