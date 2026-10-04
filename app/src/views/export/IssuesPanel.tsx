// Problems: live validation issues grouped by file, then severity; severity filter tabs; click an issue to open its
// editor (↑ ↓ / Enter work while the list has focus); the selected issue's full text; unsaved files with Save all.
import { useMemo, useState, type ReactNode } from "react";
import { countIssues, describeWhere, issueTarget, type IssueCounts, type IssueLevel } from "../../model/validate";
import type { ValidationIssue } from "../../model/types";
import type { DocEntry } from "../../state/workspace";
import { Button, EmptyState, Icon, IconButton, Spinner, TabBar, Tag, VirtualList, cx, type TabItem } from "../../ui";
import { TARGET_LABEL, basename, dirname, plural } from "./exportUtils";
import { LEVEL_LABEL, ROW_H, nextIssueRow, type Filter, type Row } from "./issueRows";
import s from "./Export.module.css";

function kindLabel(file: string): string {
  if (file.startsWith("playbooks/plays/")) return "Plays";
  if (file.startsWith("playbooks/sets/")) return "Sets";
  if (file === "app-data/concepts.json") return "Concepts";
  if (file.startsWith("app-data/")) return "App data";
  if (file.startsWith("playbooks/")) return "Playbook";
  return "Workspace";
}

export function LevelIcon({ level, size = 16 }: { level: IssueLevel; size?: number }) {
  return (
    <span className={cx(s.levelIcon, s[`lv_${level}`])} style={{ width: size + 4, height: size + 4 }} aria-label={level}>
      <Icon name={level === "error" ? "close" : level === "warning" ? "warning" : "info"} size={size - 2} />
    </span>
  );
}

function CountPills({ counts, compact }: { counts: IssueCounts; compact?: boolean }) {
  return (
    <span className={s.countPills}>
      {counts.error > 0 && <span className={cx(s.countPill, s.lv_error)}>{compact ? counts.error : plural(counts.error, "error")}</span>}
      {counts.warning > 0 && <span className={cx(s.countPill, s.lv_warning)}>{compact ? counts.warning : plural(counts.warning, "warning")}</span>}
      {counts.info > 0 && <span className={cx(s.countPill, s.lv_info)}>{compact ? counts.info : plural(counts.info, "note")}</span>}
    </span>
  );
}

export interface IssuesPanelProps {
  issues: readonly ValidationIssue[];
  rows: readonly Row[];
  filter: Filter;
  onFilter(f: Filter): void;
  cursorRow: number;
  onCursor(row: number): void;
  onOpen(issue: ValidationIssue): void;
  onToggleFile(file: string): void;
  docs: Record<string, DocEntry>;
  dirtyDocs: readonly DocEntry[];
  onSave(path: string): void;
  onSaveAll(): void;
  saving: boolean;
  /** Library/catalog state: validation needs the library. */
  libraryState: "ready" | "loading" | "missing";
  onLoadLibrary(): void;
  /** Shows a "Hide" button (the list folds into a one-line bar when there's nothing to fix). */
  onHide?(): void;
}

/** The folded problems bar: counts + "Show". */
export function IssuesBar({ issues, onShow }: { issues: readonly ValidationIssue[]; onShow(): void }) {
  const counts = countIssues(issues);
  return (
    <section className={cx(s.card, s.issuesBar)}>
      <LevelIcon level={counts.warning ? "warning" : "info"} />
      <span className={s.issuesBarText}>
        Nothing blocks the export
        <span className={s.issuesBarSub}>
          {[counts.warning ? plural(counts.warning, "warning") : "", counts.info ? plural(counts.info, "note") : ""].filter(Boolean).join(" · ")} worth a look
        </span>
      </span>
      <Button size="sm" variant="secondary" iconRight="chevronDown" onClick={onShow}>
        Show
      </Button>
    </section>
  );
}

export function IssuesPanel(p: IssuesPanelProps) {
  const counts = useMemo(() => countIssues(p.issues), [p.issues]);
  const tabs: TabItem<Filter>[] = [
    { id: "all", label: "All", badge: p.issues.length },
    { id: "error", label: "Errors", badge: counts.error, disabled: counts.error === 0 && p.filter !== "error" },
    { id: "warning", label: "Warnings", badge: counts.warning, disabled: counts.warning === 0 && p.filter !== "warning" },
    { id: "info", label: "Notes", badge: counts.info, disabled: counts.info === 0 && p.filter !== "info" },
  ];
  const cursor = p.rows[p.cursorRow];
  const cursorIssue = cursor?.kind === "issue" ? cursor.issue : undefined;
  // Mouse hover previews an issue in the detail strip without moving the (pad/keyboard) cursor or scrolling.
  const [hover, setHover] = useState<string>();
  const hoverRow = hover ? p.rows.find((r) => r.kind === "issue" && r.id === hover) : undefined;
  const detailIssue = hoverRow?.kind === "issue" ? hoverRow.issue : cursorIssue;

  let body: ReactNode;
  if (p.libraryState !== "ready") {
    body =
      p.libraryState === "loading" ? (
        <EmptyState icon={<Spinner size={26} />} title="Loading the play library…" body="Validation resolves every play against data/library." />
      ) : (
        <EmptyState
          icon="warning"
          title="Play library not loaded"
          body="Validation needs data/library/*.json to resolve formations, sets and plays. Saving and the export bundle still work."
          action={
            <Button variant="secondary" icon="refresh" onClick={p.onLoadLibrary}>
              Load library
            </Button>
          }
        />
      );
  } else if (p.issues.length === 0) {
    body = <EmptyState compact icon="check" title="Everything checks out" body="No errors, warnings or notes across playbooks, plays, sets and concepts." />;
  } else {
    body = (
      <VirtualList
        className={s.issueList}
        count={p.rows.length}
        rowHeight={ROW_H}
        selectedIndex={cursorIssue ? p.cursorRow : -1}
        onSelect={(i) => {
          const r = p.rows[i];
          if (r?.kind === "issue") p.onCursor(i);
          // Arrow keys on the focused list land on headers too: step over them (clicks on headers only toggle).
          else if (r && Math.abs(i - p.cursorRow) <= 2) p.onCursor(nextIssueRow(p.rows, i, i >= p.cursorRow ? 1 : -1));
        }}
        getKey={(i) => {
          const r = p.rows[i];
          return r.kind === "issue" ? r.id : r.kind === "file" ? `f:${r.file}` : `l:${r.file}:${r.level}`;
        }}
        padEnd={8}
        aria-label="Validation issues"
        empty={<EmptyState compact icon="filter" title="Nothing at this level" />}
        renderRow={(i, { selected }) => {
          const r = p.rows[i];
          return <IssueRow row={r} selected={selected} docs={p.docs} onOpen={p.onOpen} onToggle={p.onToggleFile} onHover={(on) => setHover(on && r.kind === "issue" ? r.id : undefined)} />;
        }}
      />
    );
  }

  return (
    <section className={cx(s.card, s.issuesCard)}>
      <header className={s.cardHead}>
        <div className={s.cardTitles}>
          <div className={s.cardEyebrow}>Checked live · click one to fix it</div>
          <h2 className={s.cardTitle}>{counts.error ? "Problems to fix" : "Worth a look"}</h2>
        </div>
        <div className={s.filterBar}>
          <TabBar items={tabs} active={p.filter} onChange={p.onFilter} size="sm" aria-label="Severity filter" className={s.filterTabs} />
          {p.onHide && (
            <Button size="sm" variant="ghost" iconRight="chevronUp" onClick={p.onHide}>
              Hide
            </Button>
          )}
        </div>
      </header>

      <div className={s.issueBody}>{body}</div>

      {p.libraryState === "ready" && p.issues.length > 0 && (
        <IssueDetail issue={detailIssue} docs={p.docs} onOpen={p.onOpen} />
      )}

      <UnsavedFiles dirty={p.dirtyDocs} onSave={p.onSave} onSaveAll={p.onSaveAll} saving={p.saving} />
    </section>
  );
}

function IssueRow({
  row,
  selected,
  docs,
  onOpen,
  onToggle,
  onHover,
}: {
  row: Row;
  selected: boolean;
  docs: Record<string, DocEntry>;
  onOpen(issue: ValidationIssue): void;
  onToggle(file: string): void;
  onHover(on: boolean): void;
}) {
  if (row.kind === "file") {
    const doc = docs[row.file];
    return (
      <button
        type="button"
        className={s.fileRow}
        onClick={(e) => {
          e.stopPropagation(); // a header click only folds the file; it doesn't move the cursor
          onToggle(row.file);
        }} aria-expanded={!row.collapsed} title={row.file || "Workspace"}>
        <Icon name={row.collapsed ? "chevronRight" : "chevronDown"} size={15} className={s.fileChevron} />
        <span className={s.fileKind}>{kindLabel(row.file)}</span>
        <span className={s.fileName}>
          {row.file ? (
            <>
              <span className={s.fileDir}>{dirname(row.file)}</span>
              {basename(row.file)}
            </>
          ) : (
            "Workspace"
          )}
        </span>
        {doc && (doc.dirty || doc.isNew) && <span className={s.unsavedDot} title="Unsaved changes" />}
        <CountPills counts={row.counts} compact />
      </button>
    );
  }
  if (row.kind === "level") {
    return (
      <div className={cx(s.levelRow, s[`lv_${row.level}`])}>
        <span className={s.levelRule} />
        {LEVEL_LABEL[row.level]} · {row.count}
      </div>
    );
  }
  const issue = row.issue;
  const target = issueTarget(issue);
  const where = describeWhere(issue.file ? docs[issue.file]?.data : undefined, issue.where);
  return (
    <button
      type="button"
      className={cx(s.issueRow, selected && s.issueRowOn)}
      onClick={() => target && onOpen(issue)}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      title={issue.message}
      aria-disabled={!target}
    >
      <LevelIcon level={issue.level} />
      <span className={s.issueText}>
        <span className={s.issueMsg}>{issue.message}</span>
        <span className={s.issueMeta}>
          {where && <span className={s.issueWhere}>{where}</span>}
          {issue.rule && <span className={s.issueRule}>{issue.rule}</span>}
        </span>
      </span>
      {target && <Icon name="chevronRight" size={16} className={s.issueGo} />}
    </button>
  );
}

function IssueDetail({ issue, docs, onOpen }: { issue?: ValidationIssue; docs: Record<string, DocEntry>; onOpen(issue: ValidationIssue): void }) {
  if (!issue)
    return (
      <div className={cx(s.detail, s.detailEmpty)}>
        Click an issue to jump to its editor.
      </div>
    );
  const target = issueTarget(issue);
  const where = describeWhere(issue.file ? docs[issue.file]?.data : undefined, issue.where);
  return (
    <div className={s.detail}>
      <div className={s.detailHead}>
        <LevelIcon level={issue.level} size={14} />
        <span className={s.detailLevel}>{issue.level === "info" ? "Note" : issue.level}</span>
        {issue.rule && <code className={s.detailRule}>{issue.rule}</code>}
        <span className={s.detailWhere} title={issue.where}>
          {[issue.file, where].filter(Boolean).join(" › ")}
        </span>
        {target && (
          <Button size="sm" variant="secondary" iconRight="chevronRight" className={s.detailGo} onClick={() => onOpen(issue)}>
            Open in {TARGET_LABEL[target.view]}
          </Button>
        )}
      </div>
      <p className={s.detailMsg}>{issue.message}</p>
    </div>
  );
}

function UnsavedFiles({ dirty, onSave, onSaveAll, saving }: { dirty: readonly DocEntry[]; onSave(path: string): void; onSaveAll(): void; saving: boolean }) {
  if (!dirty.length)
    return (
      <div className={s.savedLine}>
        <Icon name="check" size={15} /> All files saved
      </div>
    );
  return (
    <div className={s.unsaved}>
      <div className={s.unsavedHead}>
        <span className={s.unsavedTitle}>
          <span className={s.unsavedDot} /> {plural(dirty.length, "unsaved file")}
        </span>
        <span className={s.unsavedHint}>Export saves them first</span>
        <Button size="sm" variant="secondary" icon="save" loading={saving} onClick={onSaveAll}>
          Save all
        </Button>
      </div>
      <ul className={s.unsavedList}>
        {dirty.map((d) => (
          <li key={d.path}>
            <span className={s.unsavedPath} title={d.path}>
              <span className={s.fileDir}>{dirname(d.path)}</span>
              {basename(d.path)}
            </span>
            {d.isNew && (
              <Tag tone="info" size="sm" variant="soft">
                New
              </Tag>
            )}
            <IconButton icon="save" size="sm" title={`Save ${d.path}`} disabled={saving} onClick={() => onSave(d.path)} />
          </li>
        ))}
      </ul>
    </div>
  );
}
