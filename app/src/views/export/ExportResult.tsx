// Result dialog after EXPORT (save all → re-validate): what was written, what the game PC will build, the command.
import { Fragment } from "react";
import { EXPORT_COMMAND, MOD_FILE, type ExportSummary } from "../../model/exportSummary";
import type { IssueCounts } from "../../model/validate";
import type { ValidationIssue } from "../../model/types";
import { Button, Modal, cx } from "../../ui";
import { LevelIcon } from "./IssuesPanel";
import { basename, plural } from "./exportUtils";
import s from "./Export.module.css";

export interface ExportOutcome {
  /** Files written by this export. */
  saved: string[];
  /** Save failure message (some files may still have been written). */
  error?: string;
}

export interface ExportResultProps {
  outcome: ExportOutcome;
  summary?: ExportSummary;
  counts: IssueCounts;
  errors: readonly ValidationIssue[];
  libraryReady: boolean;
  onClose(): void;
  onCopy(): void;
  onDownload(): void;
  onShowErrors(): void;
}

export function ExportResult(p: ExportResultProps) {
  const failing = p.summary?.failing ?? [];
  const ok = !p.outcome.error && p.counts.error === 0 && failing.length === 0 && p.libraryReady;
  const title = p.outcome.error
    ? "Save failed"
    : !p.libraryReady
      ? "Saved — not validated"
      : p.counts.error
        ? `Saved · ${plural(p.counts.error, "error")} to fix`
        : failing.length
          ? "Saved · the build would fail"
          : "Ready for the game PC";
  return (
    <Modal
      open
      onClose={p.onClose}
      onConfirm={p.onClose}
      confirmLabel="Done"
      cancelLabel="Close"
      eyebrow="Export"
      title={<span className={cx(s.resultTitle, ok ? s.okText : s.errText)}>{title}</span>}
      width="lg"
      scopeId="export.result"
      footer={
        <>
          <Button variant="ghost" icon="download" onClick={p.onDownload}>
            Download .zip
          </Button>
          <Button variant="secondary" icon="copy" onClick={p.onCopy}>
            Copy command
          </Button>
          <span className={s.footSpacer} />
          <Button variant="primary" onClick={p.onClose}>
            Done
          </Button>
        </>
      }
    >
      <ResultBody {...p} />
    </Modal>
  );
}

function ResultBody(p: ExportResultProps) {
  const sm = p.summary;
  const failing = sm?.saves.filter((sv) => sv.willFail) ?? [];
  const { saved, error } = p.outcome;
  return (
    <div className={s.result}>
      <div className={s.resultWritten}>
        {error ? (
          <div className={s.resultError}>
            <LevelIcon level="error" /> <pre>{error}</pre>
          </div>
        ) : saved.length ? (
          <>
            <span className={s.dimLabel}>Wrote {plural(saved.length, "file")}</span>
            <span className={s.resultFiles}>{saved.map(basename).join(" · ")}</span>
          </>
        ) : (
          <span className={s.dimLabel}>Everything was already saved — the files on disk are current.</span>
        )}
      </div>

      {sm && (
        <div className={s.resultTiles}>
          <div className={s.tile}>
            <div className={s.tileValue}>{sm.saves.length}</div>
            <div className={s.tileLabel}>{sm.saves.length === 1 ? "Save" : "Saves"}</div>
            <div className={s.tileList}>
              {sm.saves.length
                ? sm.saves.map((x, i) => (
                    <Fragment key={x.saveName}>
                      {i > 0 && ", "}
                      <span className={s.saveId}>{x.saveName}</span>
                    </Fragment>
                  ))
                : "—"}
            </div>
          </div>
          <div className={s.tile}>
            <div className={s.tileValue}>{sm.customPlays.length + sm.clonedPlays.length}</div>
            <div className={s.tileLabel}>Custom plays</div>
            <div className={s.tileList}>
              in {basename(MOD_FILE)}
              {sm.customSets.length ? ` · ${plural(sm.customSets.length, "custom set")}` : ""}
              {sm.customFormations.length ? ` · ${plural(sm.customFormations.length, "new formation")}` : ""}
            </div>
          </div>
          <div className={cx(s.tile, sm.pulled.length > 0 && s.tile_amber)}>
            <div className={s.tileValue}>{sm.pulled.length}</div>
            <div className={s.tileLabel}>Pulled in</div>
            <div className={s.tileList}>{sm.pulled.map((x) => x.name).join(", ") || "none needed"}</div>
          </div>
        </div>
      )}

      {(p.errors.length > 0 || failing.length > 0) && (
        <div className={s.resultStop}>
          <LevelIcon level="error" size={14} /> tools/export.ps1 stops at the first failing playbook: nothing is built (no saves, no mod) until
          {failing.length ? ` ${failing.map((sv) => sv.saveName).join(", ")} ${failing.length === 1 ? "builds" : "build"}` : " these errors are fixed"}.
        </div>
      )}
      {failing.length > 0 && p.errors.length === 0 && (
        <div className={s.resultIssues}>
          {failing.slice(0, 4).map((sv) => (
            <div key={sv.file} className={s.resultIssue}>
              <LevelIcon level="error" size={14} />
              <span className={s.resultIssueFile}>{sv.saveName}</span>
              <span className={s.resultIssueMsg}>{sv.failures.join("; ") || sv.error}</span>
            </div>
          ))}
        </div>
      )}
      {p.errors.length > 0 && (
        <div className={s.resultIssues}>
          <div className={s.subhead}>Fix these first</div>
          {p.errors.slice(0, 4).map((i, k) => (
            <div key={k} className={s.resultIssue}>
              <LevelIcon level="error" size={14} />
              <span className={s.resultIssueFile}>{i.file ? basename(i.file) : "workspace"}</span>
              <span className={s.resultIssueMsg}>{i.message}</span>
            </div>
          ))}
          <Button size="sm" variant="ghost" iconRight="chevronRight" onClick={p.onShowErrors}>
            Show {plural(p.errors.length, "error")}
          </Button>
        </div>
      )}
      {p.errors.length === 0 && failing.length === 0 && p.counts.warning > 0 && (
        <div className={s.resultWarn}>
          <LevelIcon level="warning" size={14} /> {plural(p.counts.warning, "warning")} — the saves are built, but have a look at them on this page.
        </div>
      )}
      {!p.libraryReady && <div className={s.cardNote}>The play library isn't loaded, so nothing was validated. Load it to check the files before exporting.</div>}

      <div>
        <div className={s.subhead}>Run on the game PC (repo root, Madden closed)</div>
        <div className={s.command}>
          <code className={s.commandText}>{EXPORT_COMMAND}</code>
        </div>
      </div>
    </div>
  );
}
