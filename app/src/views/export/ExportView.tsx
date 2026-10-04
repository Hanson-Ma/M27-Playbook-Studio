// Export (#/export): one simple screen — a big status, three summary cards (playbook saves · the mod · library plays
// pulled in), the command to run on the game PC and what happens next. Problems (live validation against
// docs/FORMATS.md) only show up when there are some, each one a click away from its editor.
// EXPORT = (confirm the files it writes) save all → re-validate → result dialog. Validation and the summary use the
// template save (state/template.ts) so capacity counts the template sections.
import { useEffect, useMemo, useRef, useState } from "react";
import { EXPORT_COMMAND, exportSummary } from "../../model/exportSummary";
import { ROUTES_PATH } from "../../model/routeLibrary";
import type { ConceptsDoc, PlaybookSpec, PlaysFile, RoutesDoc, SetsFile, ValidationIssue } from "../../model/types";
import { countIssues, issueTarget, validateAll } from "../../model/validate";
import { bundleEntries, bundleFileName, buildExportZip, type BundleDoc } from "../../model/zip";
import { useCatalog, useLibrary } from "../../state/library";
import { navigate } from "../../state/router";
import { useTemplate } from "../../state/template";
import { useDoc, useDocsOfKind, useWorkspace } from "../../state/workspace";
import { Button, EmptyState, Icon, Spinner, confirmDialog, cx, toast } from "../../ui";
import { ExportResult, type ExportOutcome } from "./ExportResult";
import { IssuesBar, IssuesPanel } from "./IssuesPanel";
import { buildRows, nextIssueRow, type Filter } from "./issueRows";
import { CommandCard, NextCard, SummaryCards } from "./SummaryPanel";
import { copyText, downloadBytes, plural, targetHref } from "./exportUtils";
import s from "./Export.module.css";

const NO_ISSUES: ValidationIssue[] = [];
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

export function ExportView() {
  const ready = useWorkspace((st) => st.ready);
  const wsError = useWorkspace((st) => st.error);
  if (!ready)
    return (
      <div className={s.page}>
        {wsError ? (
          <EmptyState
            icon="warning"
            title="Couldn't load the workspace"
            body={wsError}
            action={
              <Button variant="secondary" icon="refresh" onClick={() => void useWorkspace.getState().init()}>
                Retry
              </Button>
            }
          />
        ) : (
          <EmptyState icon={<Spinner size={26} />} title="Loading playbooks…" />
        )}
      </div>
    );
  return <ExportPage />;
}

function ExportPage() {
  const libStatus = useLibrary((st) => st.status);
  const catalog = useCatalog();
  const playbooks = useDocsOfKind<PlaybookSpec>("playbook");
  const plays = useDocsOfKind<PlaysFile>("plays");
  const sets = useDocsOfKind<SetsFile>("sets");
  const concepts = useDocsOfKind<ConceptsDoc>("concepts");
  const routesDoc = useDoc<RoutesDoc>(ROUTES_PATH);
  const routes = useMemo(() => (routesDoc ? [routesDoc] : []), [routesDoc]);
  const docs = useWorkspace((st) => st.docs);
  const tpl = useTemplate();
  const template = tpl.contents;

  // Live validation + build summary (cheap: a few docs; the catalog is shared and memoized).
  const issues = useMemo(
    () => (catalog ? validateAll({ playbooks, plays, sets, concepts, routes }, catalog, { template }) : NO_ISSUES),
    [catalog, playbooks, plays, sets, concepts, routes, template],
  );
  const summary = useMemo(
    () => (catalog ? exportSummary(catalog, { playbooks, plays, sets }, { template }) : undefined),
    [catalog, playbooks, plays, sets, template],
  );
  const counts = useMemo(() => countIssues(issues), [issues]);
  const errors = useMemo(() => issues.filter((i) => i.level === "error"), [issues]);
  const dirtyDocs = useMemo(() => Object.values(docs).filter((d) => !d.error && (d.dirty || d.isNew)).sort(byPath), [docs]);
  const bundleCount = useMemo(() => bundleEntries(Object.values(docs) as BundleDoc[]).length, [docs]);
  const libraryState = catalog ? "ready" : libStatus === "loading" ? "loading" : "missing";

  // Problem list: filter, collapsed files, cursor (kept by issue id so live re-validation doesn't make it jump).
  const [pickedFilter, setFilter] = useState<Filter>("all");
  // A level that no longer has issues (all fixed) falls back to ALL instead of showing an empty list.
  const filter: Filter = pickedFilter !== "all" && counts[pickedFilter] === 0 ? "all" : pickedFilter;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const rows = useMemo(() => buildRows(issues, filter, collapsed), [issues, filter, collapsed]);
  const [cursorId, setCursorId] = useState<string>();
  const lastRow = useRef(-1);
  let cursorRow = cursorId ? rows.findIndex((r) => r.kind === "issue" && r.id === cursorId) : -1;
  if (cursorRow < 0 && cursorId && lastRow.current >= 0 && rows.length) {
    // The selected issue vanished (fixed elsewhere, filtered out): stay near the same spot.
    const at = Math.min(lastRow.current, rows.length - 1);
    cursorRow = rows[at].kind === "issue" ? at : nextIssueRow(rows, at, 1);
    if (rows[cursorRow]?.kind !== "issue") cursorRow = nextIssueRow(rows, at, -1);
    if (rows[cursorRow]?.kind !== "issue") cursorRow = -1;
  }
  if (cursorRow < 0 && !cursorId) {
    // Nothing picked yet: start on the first error (else the first issue) so the detail strip is live.
    const firstError = rows.findIndex((r) => r.kind === "issue" && r.issue.level === "error");
    cursorRow = firstError >= 0 ? firstError : nextIssueRow(rows, -1, 1);
  }
  useEffect(() => {
    lastRow.current = cursorRow;
  });
  const setCursorRow = (i: number) => {
    const r = rows[i];
    if (r?.kind === "issue") {
      lastRow.current = i;
      setCursorId(r.id);
    }
  };

  // Problems fold into a one-line bar while nothing blocks the export (errors always show the list).
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<ExportOutcome>();

  // ───────────── commands ─────────────

  const openIssue = (issue: ValidationIssue) => {
    const t = issueTarget(issue);
    if (t) navigate(targetHref(t));
  };

  const copyCommand = async () => {
    const cmd = EXPORT_COMMAND;
    if (await copyText(cmd)) toast.success("Command copied", { detail: cmd, duration: 2500 });
    else toast.error("Couldn't copy", { detail: "Select the command and copy it by hand." });
  };

  const download = () => {
    try {
      const all = Object.values(useWorkspace.getState().docs) as BundleDoc[];
      const date = new Date();
      const bytes = buildExportZip(all, { date, summary });
      const name = bundleFileName(date);
      downloadBytes(bytes, name);
      const n = bundleEntries(all).length;
      toast.success("Bundle downloaded", { detail: `${name} · ${plural(n, "file")} + README.txt` });
    } catch (e) {
      toast.error("Couldn't build the bundle", { detail: errMsg(e) });
    }
  };

  const saveOne = async (path: string) => {
    setSaving(true);
    try {
      await useWorkspace.getState().save(path);
      toast.success("Saved", { detail: path });
    } catch (e) {
      toast.error("Save failed", { detail: `${path}: ${errMsg(e)}` });
    } finally {
      setSaving(false);
    }
  };

  const saveAll = async () => {
    const n = dirtyDocs.length;
    if (!n) return;
    setSaving(true);
    try {
      await useWorkspace.getState().saveAll();
      toast.success(`Saved ${plural(n, "file")}`);
    } catch (e) {
      toast.error("Save all failed", { detail: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  const runExport = async () => {
    if (busy) return;
    const pending = Object.values(useWorkspace.getState().docs)
      .filter((d) => !d.error && (d.dirty || d.isNew))
      .map((d) => d.path)
      .sort();
    const ok = await confirmDialog({
      eyebrow: "Export",
      title: pending.length ? `Save ${plural(pending.length, "file")} and export?` : "Export now?",
      body: (
        <div className={s.confirmBody}>
          {pending.length ? (
            <>
              <p>Export saves these files to disk, then checks everything again:</p>
              <ul className={s.confirmFiles}>
                {pending.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </>
          ) : (
            <p>Everything is saved. Export re-reads the files on disk and checks them again.</p>
          )}
          <p className={s.confirmNote}>Then run the command on the game PC (it's shown after the check).</p>
        </div>
      ),
      confirmLabel: pending.length ? "Save & export" : "Export",
    });
    if (!ok) return;
    setBusy(true);
    const before = Object.values(useWorkspace.getState().docs)
      .filter((d) => !d.error && (d.dirty || d.isNew))
      .map((d) => d.path)
      .sort();
    let error: string | undefined;
    // Re-check the disk first: clean docs pick up outside edits, and edited docs whose file changed get flagged so
    // saveAll() refuses them (the conflict dialog offers reload / overwrite / copy) instead of overwriting.
    await useWorkspace.getState().refresh();
    try {
      await useWorkspace.getState().saveAll();
    } catch (e) {
      error = errMsg(e);
    }
    // Re-validate against what's on disk now (picks up files changed outside the app; dirty docs are kept).
    await useWorkspace.getState().refresh();
    const after = useWorkspace.getState().docs;
    const saved = before.filter((p) => after[p] && !after[p].dirty && !after[p].isNew);
    setBusy(false);
    setOutcome({ saved, error });
  };

  // ───────────── render ─────────────

  // Never a clean green READY while any save would fail (export.ps1 then stops: nothing is built).
  const failing = summary?.failing ?? [];
  const nothing = !!summary && summary.saves.length === 0 && summary.customPlays.length === 0 && summary.customSets.length === 0;
  const status =
    libraryState !== "ready"
      ? { tone: "warn", icon: "warning" as const, text: libraryState === "loading" ? "Checking…" : "Library not loaded" }
      : counts.error
        ? { tone: "bad", icon: "close" as const, text: `${plural(counts.error, "problem")} to fix` }
        : failing.length
          ? { tone: "bad", icon: "close" as const, text: "Build would fail" }
          : nothing
            ? { tone: "warn", icon: "info" as const, text: "Nothing to export yet" }
            : { tone: "ok", icon: "check" as const, text: "Ready to export" };
  const sub: string[] = [];
  if (libraryState === "ready") {
    if (counts.error) sub.push(`in ${plural(new Set(errors.map((e) => e.file ?? "")).size, "file")} — fix them first`);
    if (failing.length) sub.push(`${failing.join(", ")} won't build`);
    if (counts.warning) sub.push(plural(counts.warning, "warning"));
    if (!counts.error && !failing.length && !nothing) sub.push("Click Export, then run the command on the game PC");
    if (tpl.status === "error") sub.push("template save unreadable — capacity excludes template sections");
  }
  if (dirtyDocs.length) sub.push(`${plural(dirtyDocs.length, "unsaved file")} — Export saves them`);
  const showIssues = libraryState !== "ready" || issues.length > 0;
  const issuesFolded = libraryState === "ready" && counts.error === 0 && !issuesOpen;

  return (
    <div className={s.page}>
      <div className={s.inner}>
        <header className={s.header}>
          <div className={s.statusBlock}>
            <div className={s.eyebrow}>Export to Madden</div>
            <div className={cx(s.status, s[`status_${status.tone}`])}>
              <span className={s.statusIcon}>
                <Icon name={status.icon} size={22} />
              </span>
              <h1 className={s.statusText}>{status.text}</h1>
            </div>
            <div className={s.statusSub}>{sub.join(" · ")}</div>
          </div>
          <div className={s.headerActions}>
            <Button variant="primary" size="lg" icon="export" loading={busy} onClick={() => void runExport()} title="Save every file, then check everything again">
              Export
            </Button>
            <Button variant="secondary" size="lg" icon="download" disabled={bundleCount === 0} onClick={download} title="Every playbook / plays / sets file as a .zip (for a game PC without the repo)">
              Download zip
            </Button>
            <Button variant="secondary" size="lg" icon="copy" onClick={() => void copyCommand()} title={EXPORT_COMMAND}>
              Copy command
            </Button>
          </div>
        </header>

        {showIssues && issuesFolded && <IssuesBar issues={issues} onShow={() => setIssuesOpen(true)} />}
        {showIssues && !issuesFolded && (
          <IssuesPanel
            onHide={counts.error === 0 && libraryState === "ready" ? () => setIssuesOpen(false) : undefined}
            issues={issues}
            rows={rows}
            filter={filter}
            onFilter={setFilter}
            cursorRow={cursorRow}
            onCursor={setCursorRow}
            onOpen={openIssue}
            onToggleFile={(file) =>
              setCollapsed((prev) => {
                const next = new Set(prev);
                if (next.has(file)) next.delete(file);
                else next.add(file);
                return next;
              })
            }
            docs={docs}
            dirtyDocs={dirtyDocs}
            onSave={(p) => void saveOne(p)}
            onSaveAll={() => void saveAll()}
            saving={saving}
            libraryState={libraryState}
            onLoadLibrary={() => void useLibrary.getState().load()}
          />
        )}

        <SummaryCards summary={summary} libraryReady={libraryState === "ready"} />
        <CommandCard onCopy={() => void copyCommand()} onDownload={download} bundleFiles={bundleCount} dirtyCount={dirtyDocs.length} />
        <NextCard />
      </div>

      {outcome && (
        <ExportResult
          outcome={outcome}
          summary={summary}
          counts={counts}
          errors={errors}
          libraryReady={libraryState === "ready"}
          onClose={() => setOutcome(undefined)}
          onCopy={() => void copyCommand()}
          onDownload={download}
          onShowErrors={() => {
            setOutcome(undefined);
            setIssuesOpen(true);
            setFilter("error");
            setCollapsed(new Set());
          }}
        />
      )}
    </div>
  );
}
