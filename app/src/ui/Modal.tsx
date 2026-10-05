// Modal dialog (portal + scrim) that registers a modal keyboard scope: Enter confirms (⌘/Ctrl+Enter also inside text
// fields), Esc cancels; everything below the dialog stops receiving keys. Mouse: the footer buttons, the close
// button, and a click on the scrim. confirmDialog()/promptDialog() render through <DialogHost/>, which App mounts once.
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ActionLayer, useActions, type ActionDef } from "../input/actions";
import { Button, IconButton } from "./Button";
import { cx } from "./cx";
import { TextInput } from "./Form";
import s from "./Modal.module.css";

export interface ModalProps {
  open: boolean;
  onClose(): void;
  title?: ReactNode;
  eyebrow?: ReactNode;
  children?: ReactNode;
  /** Replaces the default Cancel/Confirm footer. */
  footer?: ReactNode;
  width?: "sm" | "md" | "lg" | "xl" | number;
  /** Adds a Confirm button and the Enter (and ⌘/Ctrl+Enter, even in text fields) key. */
  onConfirm?(): void;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  /** Confirm button in the danger style. */
  danger?: boolean;
  /** Confirm button spinner. */
  busy?: boolean;
  hideClose?: boolean;
  /** Clicking the scrim closes (default true). */
  closeOnScrim?: boolean;
  /** Keyboard scope id (default "modal"). */
  scopeId?: string;
  className?: string;
  bodyClassName?: string;
}

export function Modal(p: ModalProps) {
  return p.open ? createPortal(<ModalInner {...p} />, document.body) : null;
}

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

function ModalInner({
  onClose,
  title,
  eyebrow,
  children,
  footer,
  width = "md",
  onConfirm,
  confirmLabel = "Confirm",
  cancelLabel,
  confirmDisabled,
  danger,
  busy,
  hideClose,
  closeOnScrim = true,
  scopeId = "modal",
  className,
  bodyClassName,
}: ModalProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const canConfirm = !!onConfirm && !confirmDisabled && !busy;
  const cancelText = cancelLabel ?? (onConfirm ? "Cancel" : "Close");

  const actions: ActionDef[] = [
    ...(onConfirm
      ? [
          { id: "confirm", label: confirmLabel, keys: ["Enter"], enabled: canConfirm, run: () => onConfirm() },
          { id: "confirm-mod", label: confirmLabel, keys: ["mod+Enter"], allowInInput: true, enabled: canConfirm, run: () => onConfirm() },
        ]
      : []),
    { id: "cancel", label: cancelText, keys: ["Escape"], allowInInput: true, run: () => onClose() },
  ];
  const token = useActions(scopeId, actions, { modal: true });

  // Focus the first field (or the dialog) on open; give focus back on close.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const root = dialog.current;
    const target = root?.querySelector<HTMLElement>("[autofocus], [data-autofocus]") ?? root?.querySelector<HTMLElement>("input, textarea, select") ?? root;
    target?.focus();
    return () => {
      if (prev && document.contains(prev)) prev.focus();
    };
  }, []);

  const trapTab = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !dialog.current) return;
    const items = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const w = typeof width === "number" ? width : undefined;
  return (
    <div className={s.scrim} onPointerDown={(e) => closeOnScrim && e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cx(s.dialog, typeof width === "string" && s[width], className)}
        style={w ? { width: w } : undefined}
        onKeyDown={trapTab}
      >
        {(title || eyebrow || !hideClose) && (
          <header className={s.head}>
            <div className={s.titles}>
              {eyebrow && <div className={s.eyebrow}>{eyebrow}</div>}
              {title && <h2 className={s.title}>{title}</h2>}
            </div>
            {!hideClose && <IconButton icon="close" title="Close" onClick={onClose} size="sm" />}
          </header>
        )}
        {children !== undefined && (
          <div className={cx(s.body, bodyClassName)}>
            <ActionLayer token={token}>{children}</ActionLayer>
          </div>
        )}
        {footer !== undefined ? (
          footer && <footer className={s.foot}>{footer}</footer>
        ) : (
          <footer className={s.foot}>
            <Button variant="ghost" onClick={onClose}>
              {cancelText}
            </Button>
            {onConfirm && (
              <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={!canConfirm} loading={busy}>
                {confirmLabel}
              </Button>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────── imperative dialogs ───────────────────────────────

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  eyebrow?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface PromptOptions {
  title: string;
  /** Field label above the input. */
  label?: string;
  initial?: string;
  placeholder?: string;
  body?: ReactNode;
  confirmLabel?: string;
  /** Return an error message to block confirming. */
  validate?(value: string): string | undefined;
  mono?: boolean;
}

type Request =
  | { id: number; kind: "confirm"; opts: ConfirmOptions; resolve(v: boolean): void }
  | { id: number; kind: "prompt"; opts: PromptOptions; resolve(v: string | null): void };

let queue: Request[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function push(r: Request) {
  queue = [...queue, r];
  emit();
}
function settle(id: number) {
  queue = queue.filter((r) => r.id !== id);
  emit();
}

/** Ask a yes/no question; resolves false on cancel. Requires <DialogHost/> to be mounted (App does). */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => push({ id: ++seq, kind: "confirm", opts, resolve }));
}

/** Ask for a line of text; resolves null on cancel. */
export function promptDialog(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => push({ id: ++seq, kind: "prompt", opts, resolve }));
}

function PromptBody({ req }: { req: Extract<Request, { kind: "prompt" }> }) {
  const { opts } = req;
  const [value, setValue] = useState(opts.initial ?? "");
  const error = opts.validate?.(value);
  const done = (v: string | null) => {
    settle(req.id);
    req.resolve(v);
  };
  return (
    <Modal open title={opts.title} onClose={() => done(null)} onConfirm={() => done(value)} confirmLabel={opts.confirmLabel ?? "OK"} confirmDisabled={!!error} width="sm" scopeId="prompt">
      {opts.body && <div className={s.text}>{opts.body}</div>}
      {opts.label && <div className={s.fieldLabel}>{opts.label}</div>}
      <TextInput
        value={value}
        onChange={setValue}
        placeholder={opts.placeholder}
        mono={opts.mono}
        invalid={!!error && value !== ""}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (!error) done(value);
          }
        }}
      />
      {error && value !== "" && <div className={s.error}>{error}</div>}
    </Modal>
  );
}

/** Renders pending confirmDialog/promptDialog requests, one at a time. */
export function DialogHost() {
  const q = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => queue,
  );
  const req = q[0];
  if (!req) return null;
  if (req.kind === "prompt") return <PromptBody key={req.id} req={req} />;
  const done = (v: boolean) => {
    settle(req.id);
    req.resolve(v);
  };
  const o = req.opts;
  return (
    <Modal
      key={req.id}
      open
      title={o.title}
      eyebrow={o.eyebrow}
      onClose={() => done(false)}
      onConfirm={() => done(true)}
      confirmLabel={o.confirmLabel ?? "Confirm"}
      cancelLabel={o.cancelLabel}
      danger={o.danger}
      width="sm"
      scopeId="confirm"
    >
      {o.body !== undefined ? <div className={s.text}>{o.body}</div> : undefined}
    </Modal>
  );
}
