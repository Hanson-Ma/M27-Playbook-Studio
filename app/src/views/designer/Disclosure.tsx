// Progressive disclosure for the designer panels: a section header that opens / closes its body. The open state is
// remembered per `id` for the session, so "Advanced" stays open while you move between players.
import { useState, type ReactNode } from "react";
import { Icon, cx } from "../../ui";
import s from "./Inspector.module.css";

const remembered = new Map<string, boolean>();

export function Disclosure({
  id,
  title,
  hint,
  defaultOpen = false,
  right,
  children,
  className,
}: {
  id: string;
  title: ReactNode;
  hint?: ReactNode;
  defaultOpen?: boolean;
  /** Extra controls at the right of the header (stay clickable without toggling). */
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(() => remembered.get(id) ?? defaultOpen);
  const toggle = () => {
    remembered.set(id, !open);
    setOpen(!open);
  };
  return (
    <section className={cx(s.section, s.disclosure, open && s.disclosureOpen, className)}>
      <div className={s.sectionHead}>
        <button type="button" className={s.disclosureBtn} aria-expanded={open} onClick={toggle}>
          <Icon name={open ? "chevronDown" : "chevronRight"} size={14} />
          <span className={s.sectionTitle}>{title}</span>
          {hint && <span className={s.muted}>{hint}</span>}
        </button>
        {right}
      </div>
      {open && <div className={s.disclosureBody}>{children}</div>}
    </section>
  );
}
