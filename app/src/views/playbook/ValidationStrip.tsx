// Compact validation strip under the builder header: how full the save is (plays, sets, formations, CPU rows — template
// sections included once the template save is loaded, counted the way the game-side builder copies them) and one
// status button ("Ready to Export" / "2 Problems to Fix"). Clicking a status opens the list; clicking an issue selects
// its entry.
import { useMemo, useState } from "react";
import { BOOK_LIMITS } from "../../model/resolveBook";
import type { ValidationIssue } from "../../model/types";
import { Floating, Icon, Tooltip, cx, type IconName } from "../../ui";
import { useBuilder } from "./context";
import { IssueList } from "./issues";
import s from "./ValidationStrip.module.css";

type Bucket = "problems" | "mod";

export function ValidationStrip() {
  const data = useBuilder();
  const c = data.book.counts;
  // Template-section rows come from resolvePlaybook(…, { template }): exactly what tools/pbook-build.mjs copies, plus
  // the CPU rows explicit plays without `cpu` inherit.
  const rows = c.saveRows;
  const limits = data.book.limits ?? BOOK_LIMITS;
  const tpl = {
    sets: rows ? rows.template.sets : 0,
    plays: rows ? rows.template.plays : 0,
    cpuRows: rows ? rows.template.cpuRows : 0,
    inherited: rows ? rows.inheritedCpuRows : 0,
  };
  const tplReady = data.template.status === "ready";

  const groups = useMemo(() => {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const notes: ValidationIssue[] = [];
    const mod: ValidationIssue[] = [];
    for (const i of data.issues) {
      if (i.rule === "needs-mod") mod.push(i);
      else if (i.level === "error") errors.push(i);
      else if (i.level === "warning") warnings.push(i);
      else notes.push(i);
    }
    return { errors, warnings, notes, mod };
  }, [data.issues]);
  const [open, setOpen] = useState<{ bucket: Bucket; anchor: HTMLElement } | null>(null);

  const meter = (label: string, used: number, extra: number, max: number, opts: { template?: boolean; inherited?: number } = {}) => {
    const total = used + extra;
    const pct = total / max;
    const tone = pct > 1 ? "danger" : pct > 0.9 ? "warning" : "ok";
    const fromTpl = extra - (opts.inherited ?? 0);
    const tip =
      opts.template !== false && (extra || (!tplReady && c.templateFormations))
        ? `${used} you added + ${tplReady ? fromTpl : "?"} from template sections` +
          (opts.inherited ? ` + ${opts.inherited} the template keeps for plays without their own weights` : "") +
          `. A Madden playbook holds at most ${max}.`
        : `${used} of the ${max} a Madden playbook holds`;
    return (
      <Tooltip className={s.meterWrap} content={tip}>
        <div className={cx(s.meter, s[tone])}>
          <span className={s.meterLabel}>{label}</span>
          <span className={s.meterValue}>
            {total}
            <span className={s.meterMax}>/{max}</span>
          </span>
          <div className={s.bar}>
            <div className={s.barUsed} style={{ width: `${Math.min(100, (used / max) * 100)}%` }} />
            <div className={s.barTpl} style={{ width: `${Math.min(100, (extra / max) * 100)}%` }} />
          </div>
        </div>
      </Tooltip>
    );
  };

  const toggle = (bucket: Bucket, anchor: HTMLElement) => setOpen((cur) => (cur?.bucket === bucket ? null : { bucket, anchor }));
  const nErr = groups.errors.length;
  const nWarn = groups.warnings.length;
  const status: { icon: IconName; label: string; tone: string; title: string } = nErr
    ? { icon: "warning", label: `${nErr} Problem${nErr === 1 ? "" : "s"} to Fix`, tone: s.bad, title: "The export stops on these. Click to see them." }
    : nWarn
      ? { icon: "warning", label: `Ready · ${nWarn} Warning${nWarn === 1 ? "" : "s"}`, tone: s.warn, title: "The playbook builds; these are worth a look." }
      : { icon: "check", label: "Ready to Export", tone: s.good, title: "No problems found." };

  return (
    <div className={s.strip} role="region" aria-label="Playbook check">
      <div className={s.meters}>
        {meter("Plays", c.plays, tpl.plays, limits.plays)}
        {meter("Sets", c.sets, tpl.sets, limits.sets)}
        {meter("Formations", c.formations + c.templateFormations, 0, limits.formations, { template: false })}
        {meter("CPU Rows", c.cpuRows, tpl.cpuRows + tpl.inherited, limits.cpuRows, { inherited: tpl.inherited })}
      </div>
      <div className={s.status}>
        <button
          type="button"
          className={cx(s.pill, status.tone, open?.bucket === "problems" && s.pillOpen)}
          title={status.title}
          onClick={(e) => toggle("problems", e.currentTarget)}
          aria-expanded={open?.bucket === "problems"}
        >
          <Icon name={status.icon} size={14} />
          {status.label}
          <Icon name="chevronDown" size={13} className={s.caret} />
        </button>
      </div>
      {open && (
        <Floating anchor={open.anchor} placement="bottom-end" onDismiss={() => setOpen(null)} dismissIgnore={`.${s.pill}`} className={s.popover} zIndex={900}>
          {open.bucket === "mod" ? (
            <>
              <div className={s.popTitle}>Plays That Need the Mod</div>
              <p className={s.popLead}>
                These show up in game once the Playbook Studio mod is enabled — the Export tab builds it together with the playbook.
              </p>
              <div className={s.popBody}>
                <IssueList issues={groups.mod} onPick={() => setOpen(null)} />
              </div>
            </>
          ) : (
            <div className={s.popBody}>
              {nErr > 0 && (
                <>
                  <div className={s.popTitle}>Fix Before Exporting</div>
                  <IssueList issues={groups.errors} onPick={() => setOpen(null)} />
                </>
              )}
              {nWarn > 0 && (
                <>
                  <div className={s.popTitle}>Warnings</div>
                  <IssueList issues={groups.warnings} onPick={() => setOpen(null)} />
                </>
              )}
              {groups.notes.length > 0 && (
                <>
                  <div className={s.popTitle}>Notes</div>
                  <IssueList issues={groups.notes} onPick={() => setOpen(null)} />
                </>
              )}
              {!nErr && !nWarn && !groups.notes.length && <div className={s.popEmpty}>Everything checks out.</div>}
              <p className={s.popFoot}>Madden sorts formations by how often you call them, so the in-game order can differ; your order is kept in the file.</p>
            </div>
          )}
        </Floating>
      )}
    </div>
  );
}
