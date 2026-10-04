// Small UI pieces shared by the formations views: the "Advanced"
// disclosure that holds raw / technical controls (progressive disclosure, ARCHITECTURE.md v2).
import { useState, type ReactNode } from "react";
import { Icon } from "../../ui";
import s from "./Common.module.css";

/** Collapsed-by-default section for technical controls; remembers its state per `id` for the session. */
const openState = new Map<string, boolean>();

export function Advanced({ id, children, hint, label = "Advanced" }: { id: string; children: ReactNode; hint?: string; label?: string }) {
  const [open, setOpen] = useState(() => openState.get(id) ?? false);
  const toggle = () => {
    openState.set(id, !open);
    setOpen(!open);
  };
  return (
    <section className={s.advanced}>
      <button type="button" className={s.advancedHead} aria-expanded={open} onClick={toggle}>
        <Icon name="chevronRight" size={13} />
        {label}
        {hint && <span className={s.advancedHint}>{hint}</span>}
      </button>
      {open && <div className={s.advancedBody}>{children}</div>}
    </section>
  );
}
