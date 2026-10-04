// Issue list rows (pure): flatten validation issues into file → severity → issue rows for the virtual list.
import { groupIssues, type IssueCounts, type IssueLevel } from "../../model/validate";
import type { ValidationIssue } from "../../model/types";

export type Filter = "all" | IssueLevel;
export const FILTERS: Filter[] = ["all", "error", "warning", "info"];

export type Row =
  | { kind: "file"; file: string; counts: IssueCounts; collapsed: boolean }
  | { kind: "level"; file: string; level: IssueLevel; count: number }
  | { kind: "issue"; id: string; issue: ValidationIssue };

export const ROW_H = 46;

export const LEVEL_LABEL: Record<IssueLevel, string> = { error: "Errors", warning: "Warnings", info: "Notes" };

/** Flattened rows for the virtual list (file header → severity header → issues), honoring filter + collapsed files. */
export function buildRows(issues: readonly ValidationIssue[], filter: Filter, collapsed: ReadonlySet<string>): Row[] {
  const shown = filter === "all" ? issues : issues.filter((i) => i.level === filter);
  const rows: Row[] = [];
  const seen = new Map<string, number>();
  for (const g of groupIssues(shown)) {
    const isCollapsed = collapsed.has(g.file);
    rows.push({ kind: "file", file: g.file, counts: g.counts, collapsed: isCollapsed });
    if (isCollapsed) continue;
    let level: IssueLevel | undefined;
    for (const issue of g.issues) {
      if (filter === "all" && issue.level !== level) {
        level = issue.level;
        rows.push({ kind: "level", file: g.file, level, count: g.counts[level] });
      }
      const base = [issue.file ?? "", issue.where ?? "", issue.rule ?? "", issue.message].join("\u0000");
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      rows.push({ kind: "issue", id: n ? `${base}\u0000${n}` : base, issue });
    }
  }
  return rows;
}

/** Next issue row from `from` in `dir` (from = -1 starts at the top). */
export function nextIssueRow(rows: readonly Row[], from: number, dir: 1 | -1): number {
  let i = from;
  for (;;) {
    i += dir;
    if (i < 0 || i >= rows.length) return from;
    if (rows[i].kind === "issue") return i;
  }
}
