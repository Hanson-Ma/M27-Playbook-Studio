// Small shared pieces of the builder: the numbered step header each pane starts with (1 Pick a set · 2 Add & order
// plays · 3 Audibles & CPU). Help is the top bar's "?" (one per screen).
import type { ReactNode } from "react";
import { cx } from "../../ui";
import { stepOf, useBuilderUi, type BuilderStep } from "./store";
import s from "./parts.module.css";

/** The step a pane covers; highlighted while the selection is in that step. */
export function StepHeader({ step, title, hint, children }: { step: BuilderStep; title: string; hint?: ReactNode; children?: ReactNode }) {
  const current = useBuilderUi((st) => stepOf(st.cursor) === step);
  return (
    <div className={cx(s.step, current && s.stepCurrent)}>
      <span className={s.stepNum}>{step}</span>
      <div className={s.stepText}>
        <div className={s.stepTitle}>{title}</div>
        {hint && <div className={s.stepHint}>{hint}</div>}
      </div>
      {children && <div className={s.stepExtra}>{children}</div>}
    </div>
  );
}
