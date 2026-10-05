// Validation issues in the builder: which ones to show, a clickable list (selects the entry), and grouping.
import { idOf, parseWhere } from "../../model/playbook";
import type { ValidationIssue } from "../../model/types";
import { Icon, cx } from "../../ui";
import { useBuilder, type BuilderData } from "./context";
import { BOOK_ID, useBuilderUi } from "./store";
import s from "./issues.module.css";

/** Rule ids for "a template section copies nothing" (the game-side builder refuses it). */
export const TEMPLATE_EMPTY_RULES = new Set(["template-empty", "template-no-sets", "template-section-empty"]);

export function selectIssue(data: BuilderData, issue: ValidationIssue): void {
  const ref = parseWhere(issue.where);
  if (!ref) return useBuilderUi.getState().select(BOOK_ID);
  const id = idOf(data.ids, ref);
  if (!id) return;
  useBuilderUi.getState().select(id);
  requestAnimationFrame(() => document.querySelector(`[data-node-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" }));
}

export function IssueList({ issues, onPick }: { issues: ValidationIssue[]; onPick?(): void }) {
  const data = useBuilder();
  return (
    <ul className={s.issues}>
      {issues.map((i, k) => {
        const clickable = !!parseWhere(i.where);
        return (
          <li key={k}>
            <button
              type="button"
              className={cx(s.issue, s[i.level], clickable && s.clickable)}
              disabled={!clickable}
              title={clickable ? "Show it in the tree" : undefined}
              onClick={() => {
                selectIssue(data, i);
                onPick?.();
              }}
            >
              <Icon name={i.level === "info" ? "info" : "warning"} size={14} />
              <span>{i.message}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
