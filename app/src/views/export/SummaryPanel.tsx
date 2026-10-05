// What the game PC will build, as three cards — Playbook Saves · The Mod (custom plays, custom formations / sets and
// cloned plays from playbooks/sets/) · Library Plays Pulled In — plus the command card and "what happens next".
// Lists show a few rows with "Show all"; save capacity meters sit behind each save's "Details".
import { useState, type ReactNode } from "react";
import { BOOK_LIMITS } from "../../model/resolveBook";
import { EXPORT_COMMAND, MOD_FILE, SAVES_FOLDER, type ExportSummary, type SaveSummary } from "../../model/exportSummary";
import { href, navigate } from "../../state/router";
import { Button, Icon, PlayTypeTag, Tag, cx } from "../../ui";
import { basename, plural } from "./exportUtils";
import s from "./Export.module.css";

const PREVIEW = 4;
const shortSave = (n: string) => n.replace(/^PBOOK(OFF|DEF)-/, "");

export function SummaryCards({ summary, libraryReady }: { summary?: ExportSummary; libraryReady: boolean }) {
  if (!summary)
    return (
      <div className={cx(s.card, s.cardPad, s.muted)}>
        <Icon name="info" size={16} /> {libraryReady ? "Loading the workspace…" : "The build summary needs the play library."}
      </div>
    );
  return (
    <div className={s.cards3}>
      <SavesCard summary={summary} />
      <ModCard summary={summary} />
      <PulledCard summary={summary} />
    </div>
  );
}

function CardHead({ eyebrow, title, count }: { eyebrow: ReactNode; title: ReactNode; count?: number }) {
  return (
    <header className={s.cardHead}>
      <div className={s.cardTitles}>
        <div className={s.cardEyebrow}>{eyebrow}</div>
        <h2 className={s.cardTitle}>
          {title}
          {count !== undefined && <span className={s.cardCount}>{count}</span>}
        </h2>
      </div>
    </header>
  );
}

function ShowAll({ total, open, onToggle, noun }: { total: number; open: boolean; onToggle(): void; noun: string }) {
  if (total <= PREVIEW) return null;
  return (
    <button type="button" className={s.moreBtn} onClick={onToggle}>
      {open ? "Show Fewer" : `Show All ${total} ${noun.charAt(0).toUpperCase()}${noun.slice(1)}`}
    </button>
  );
}

// ───────────────────────────── saves ─────────────────────────────

function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = Math.min(1, value / max);
  return (
    <div className={s.meter} title={`${value} of ${max} ${label}`}>
      <div className={s.meterLabel}>
        <span>{label}</span>
        <span className={s.meterNum}>
          {value}/{max}
        </span>
      </div>
      <div className={s.meterTrack}>
        <div className={cx(s.meterFill, value > max ? s.meterOver : pct > 0.9 && s.meterHigh)} style={{ width: `${Math.max(pct * 100, value ? 1.5 : 0)}%` }} />
      </div>
    </div>
  );
}

/** Capacity: every row the save gets (template sections + inherited CPU rows) once the template save is loaded. */
function SaveMeters({ save }: { save: SaveSummary }) {
  const r = save.saveRows;
  const lim = save.limits ?? BOOK_LIMITS;
  const t = r ? " (incl. template)" : save.templateSections.length ? " (+ template)" : "";
  return (
    <div className={s.meters}>
      <Meter value={r?.plays ?? save.plays} max={lim.plays} label={`Plays${t}`} />
      <Meter value={r?.sets ?? save.sets} max={lim.sets} label={`Sets${t}`} />
      <Meter value={r?.formations ?? save.formations + save.templateSections.length} max={lim.formations} label="Formations" />
      <Meter value={r?.cpuRows ?? save.cpuRows} max={lim.cpuRows} label={`CPU Rows${t}`} />
    </div>
  );
}

function SaveRow({ save }: { save: SaveSummary }) {
  const [details, setDetails] = useState(false);
  const stats = [plural(save.plays, "play"), plural(save.sets, "set"), plural(save.formations, "formation"), plural(save.audibles, "audible")];
  return (
    <div className={s.saveRow}>
      <button type="button" className={s.saveMain} onClick={() => navigate(href("playbook", save.file))} title={`Open ${save.file} in the playbook builder`}>
        <div className={s.saveTop}>
          <span className={s.saveName}>{shortSave(save.saveName)}</span>
          <Tag size="sm" variant="outline" tone="neutral">
            {save.side === "defense" ? "Defense" : "Offense"}
          </Tag>
          {save.willFail && (
            <Tag size="sm" tone="danger" icon="warning" title={save.failures.join("\n")}>
              Won't Build
            </Tag>
          )}
        </div>
        {save.error ? (
          <div className={s.saveErr}>{save.error}</div>
        ) : (
          <>
            <div className={s.saveStats}>{stats.join(" · ")}</div>
            {save.failures.length > 0 && (
              <ul className={s.failures}>
                {save.failures.slice(0, 2).map((f) => (
                  <li key={f}>{f}</li>
                ))}
                {save.failures.length > 2 && <li className={s.more}>+{save.failures.length - 2} more</li>}
              </ul>
            )}
            {save.templateSections.length > 0 && (
              <div className={s.saveTemplate}>
                <span className={s.dimLabel}>+ From Template</span> <span className="caps">{save.templateSections.join(", ")}</span>
              </div>
            )}
            <div className={s.saveTags}>
              {save.custom > 0 && (
                <Tag size="sm" tone="custom" variant="soft">
                  {save.custom} Custom
                </Tag>
              )}
              {save.customSets > 0 && (
                <Tag size="sm" tone="custom" variant="soft">
                  {plural(save.customSets, "Custom Set")}
                </Tag>
              )}
              {save.pulled > 0 && (
                <Tag size="sm" tone="needsMod" variant="soft">
                  {save.pulled} Needs Mod
                </Tag>
              )}
              {save.unresolved > 0 && (
                <Tag size="sm" tone="danger" variant="soft">
                  {save.unresolved} Unresolved
                </Tag>
              )}
              {save.custom + save.pulled + save.customSets + save.customFormations === 0 && save.unresolved === 0 && (
                <Tag size="sm" tone="ok" variant="soft">
                  No Mod Needed
                </Tag>
              )}
            </div>
          </>
        )}
      </button>
      {!save.error && (
        <button type="button" className={s.detailsBtn} onClick={() => setDetails((d) => !d)} aria-expanded={details}>
          {details ? "Hide Details" : "Details"} <Icon name={details ? "chevronUp" : "chevronDown"} size={13} />
        </button>
      )}
      {details && !save.error && (
        <div className={s.saveDetails}>
          <div className={s.saveFile}>
            {save.file} <span className={s.arrow}>→</span> {save.outPath}
          </div>
          <SaveMeters save={save} />
          {save.notes.length > 0 && (
            <ul className={s.notes}>
              {save.notes.map((n) => (
                <li key={n}>
                  <Icon name="info" size={13} /> {n}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function SavesCard({ summary }: { summary: ExportSummary }) {
  const [open, setOpen] = useState(false);
  const saves = summary.saves;
  const shown = open ? saves : saves.slice(0, PREVIEW);
  const unresolved = open ? summary.unresolved : summary.unresolved.slice(0, 3);
  return (
    <section className={s.card}>
      <CardHead eyebrow="One Save per Playbook" title="Playbook Saves" count={saves.length} />
      <div className={s.cardBody}>
        {saves.length === 0 && <div className={s.muted}>No playbooks yet — create one in the Playbook tab. Every playbooks/*.json becomes one save.</div>}
        {shown.map((sv) => (
          <SaveRow key={sv.file} save={sv} />
        ))}
        <ShowAll total={saves.length} open={open} onToggle={() => setOpen((o) => !o)} noun="saves" />
        {unresolved.length > 0 && (
          <div className={s.unresolved}>
            <div className={s.subhead}>Plays That Don't Resolve — the Build Stops on These</div>
            {unresolved.map((u) => (
              <button
                key={u.file + u.where}
                type="button"
                className={s.listRow}
                onClick={() => {
                  const m = /^\/formations\/(\d+)\/sets\/(\d+)\/plays\/(\d+)/.exec(u.where);
                  navigate(href("playbook", u.file) + (m ? `?f=${m[1]}&s=${m[2]}&p=${m[3]}` : ""));
                }}
              >
                <Icon name="warning" size={14} className={s.redIcon} />
                <span className={s.listText}>
                  <span className={s.listName}>{u.play || "(no name)"}</span>
                  <span className={s.listSub}>
                    {u.formation} › {u.set} · {shortSave(u.saveName)}
                  </span>
                </span>
              </button>
            ))}
            {!open && summary.unresolved.length > 3 && <div className={s.more}>+{summary.unresolved.length - 3} more</div>}
          </div>
        )}
        {summary.notBuilt.length > 0 && (
          <div className={s.cardNote}>
            {plural(summary.notBuilt.length, "file")} in sub-folders won't become saves (only playbooks/*.json at the top level do).
          </div>
        )}
      </div>
    </section>
  );
}

// ───────────────────────────── the mod ─────────────────────────────

type ModRow = { key: string; tag?: ReactNode; name: string; sub: string; end?: ReactNode; title?: string; warn?: boolean; go(): void };

function ModCard({ summary }: { summary: ExportSummary }) {
  const [open, setOpen] = useState(false);
  const usedBy = (list: string[]) =>
    list.length ? <span className={s.usedBy}>{list.map(shortSave).join(", ")}</span> : <span className={s.unused}>Not in a playbook</span>;
  const rows: ModRow[] = [
    ...summary.customSets.map(
      (cs): ModRow => ({
        key: `set:${cs.file}:${cs.index}`,
        tag: <Tag size="sm" tone="custom" variant="soft">Custom Set</Tag>,
        name: cs.name || "(no name)",
        sub: `${cs.subtitle || cs.formationName}${cs.newFormation ? " · new formation" : ""} · from ${cs.baseName}`,
        end: usedBy(cs.usedBy),
        title: `${cs.file} #${cs.index + 1}${cs.clones ? ` · ${plural(cs.clones, "cloned play")}` : ""}`,
        go: () => navigate(href("formations", cs.file, cs.index)),
      }),
    ),
    ...summary.customFormations
      .filter((cf) => !summary.customSets.some((cs) => cs.newFormation && cs.formation === cf.asset))
      .map(
        (cf): ModRow => ({
          key: `form:${cf.file}:${cf.index}`,
          tag: <Tag size="sm" tone="custom" variant="soft">New Formation</Tag>,
          name: cf.name || "(no name)",
          sub: `from ${cf.baseName || basename(cf.base)} · ${plural(cf.sets, "set")}`,
          end: usedBy(cf.usedBy),
          title: cf.file,
          go: () => navigate(href("formations", cf.file)),
        }),
      ),
    ...summary.clonedPlays.map(
      (cp): ModRow => ({
        key: `clone:${cp.file}:${cp.setIndex}:${cp.index}`,
        tag: cp.playType ? <PlayTypeTag playType={cp.playType} size="sm" className={s.listTag} /> : undefined,
        name: cp.name || "(no name)",
        sub: `${cp.subtitle} · clone of ${cp.fromName}${cp.modified ? " (edited)" : ""}`,
        end: usedBy(cp.usedBy),
        warn: cp.problems.length > 0,
        title: [cp.key, ...cp.problems].join("\n"),
        go: () => navigate(href("formations", cp.file, cp.setIndex)),
      }),
    ),
    ...summary.customPlays.map(
      (cp): ModRow => ({
        key: `play:${cp.file}:${cp.index}`,
        tag: cp.playType ? <PlayTypeTag playType={cp.playType} size="sm" className={s.listTag} /> : undefined,
        name: cp.name || "(no name)",
        sub: cp.subtitle,
        end: usedBy(cp.usedBy),
        warn: cp.problems.length > 0,
        title: [cp.key, `${cp.file} #${cp.index + 1}`, ...cp.problems].join("\n"),
        go: () => navigate(href("designer", cp.file, cp.index)),
      }),
    ),
  ];
  const shown = open ? rows : rows.slice(0, PREVIEW);
  const parts = [
    plural(summary.customPlays.length, "custom play"),
    summary.customSets.length ? plural(summary.customSets.length, "custom set") : "",
    summary.customFormations.length ? plural(summary.customFormations.length, "new formation") : "",
    summary.clonedPlays.length ? plural(summary.clonedPlays.length, "cloned play") : "",
  ].filter(Boolean);
  return (
    <section className={s.card}>
      <CardHead eyebrow={`One Mod · ${basename(MOD_FILE)}`} title="The Mod" count={rows.length} />
      <div className={s.cardBody}>
        <div className={s.modCounts}>
          <ModCount value={summary.customPlays.length} label="Custom Plays" />
          <ModCount value={summary.customSets.length} label="Custom Sets" />
          <ModCount value={summary.customFormations.length} label="New Formations" />
          <ModCount value={summary.clonedPlays.length} label="Cloned Plays" />
        </div>
        <div className={s.cardNote}>
          {rows.length
            ? `${parts.join(" · ")} — everything in playbooks/sets/ and playbooks/plays/ builds into one mod.`
            : "Nothing custom yet — build plays in the Designer or sets in Formations."}
        </div>
        {shown.map((r) => (
          <button key={r.key} type="button" className={s.listRow} onClick={r.go} title={r.title}>
            <span className={s.listTagCol}>{r.tag}</span>
            <span className={s.listText}>
              <span className={s.listName}>{r.name}</span>
              <span className={s.listSub}>{r.sub}</span>
            </span>
            <span className={s.listEnd}>
              {r.warn && <Icon name="warning" size={14} className={s.redIcon} />}
              {r.end}
            </span>
          </button>
        ))}
        <ShowAll total={rows.length} open={open} onToggle={() => setOpen((o) => !o)} noun="items" />
      </div>
    </section>
  );
}

function ModCount({ value, label }: { value: number; label: string }) {
  return (
    <div className={cx(s.modCount, !value && s.modCountZero)}>
      <span className={s.modCountValue}>{value}</span>
      <span className={s.modCountLabel}>{label}</span>
    </div>
  );
}

// ───────────────────────────── pulled ─────────────────────────────

function PulledCard({ summary }: { summary: ExportSummary }) {
  const [open, setOpen] = useState(false);
  const list = summary.pulled;
  const shown = open ? list : list.slice(0, PREVIEW);
  return (
    <section className={s.card}>
      <CardHead eyebrow="Stock Plays the Game Hides" title="Library Plays Pulled In" count={list.length} />
      <div className={s.cardBody}>
        <div className={s.cardNote}>
          {list.length
            ? "Your playbooks use these stock plays, which the game hides from custom playbooks. The mod adds them back."
            : "Every stock play in your playbooks already works without the mod — nothing to pull in."}
        </div>
        {shown.map((pp) => (
          <button key={pp.key} type="button" className={s.listRow} onClick={() => navigate(href("library", "play", pp.key))} title={pp.key}>
            <span className={s.listTagCol}>{pp.playType && <PlayTypeTag playType={pp.playType} size="sm" className={s.listTag} />}</span>
            <span className={s.listText}>
              <span className={s.listName}>{pp.name}</span>
              <span className={s.listSub}>{pp.subtitle}</span>
            </span>
            <span className={s.listEnd}>
              <span className={s.usedBy}>{pp.usedBy.map(shortSave).join(", ")}</span>
            </span>
          </button>
        ))}
        <ShowAll total={list.length} open={open} onToggle={() => setOpen((o) => !o)} noun="plays" />
      </div>
    </section>
  );
}

// ───────────────────────────── command + next steps ─────────────────────────────

export function CommandCard({ onCopy, onDownload, bundleFiles, dirtyCount }: { onCopy(): void; onDownload(): void; bundleFiles: number; dirtyCount: number }) {
  return (
    <section className={s.card}>
      <CardHead eyebrow="On the Game PC · In the 2026 Playbook Folder · Madden Closed" title="Run the Export" />
      <div className={s.cardBody}>
        <div className={s.command}>
          <code className={s.commandText}>{EXPORT_COMMAND}</code>
          <Button size="sm" variant="primary" icon="copy" onClick={onCopy}>
            Copy
          </Button>
        </div>
        <div className={s.cardNote}>
          Builds the mod and every save; <code className={s.inlineCode}>-Install</code> copies the saves into the saves folder (the previous copy is backed
          up to <code className={s.inlineCode}>backups\</code>).
        </div>
        <div className={s.bundleLine}>
          <span className={s.cardNote}>
            Folder not synced to the game PC? Download the {plural(bundleFiles, "file")}
            {dirtyCount ? ` (including ${plural(dirtyCount, "unsaved edit")})` : ""} as a .zip, unzip it into the folder there, then run the command.
          </span>
          <Button size="sm" variant="secondary" icon="download" onClick={onDownload} disabled={bundleFiles === 0}>
            Download .zip
          </Button>
        </div>
      </div>
    </section>
  );
}

const STEPS: { title: string; body: ReactNode }[] = [
  {
    title: "Apply the Mod",
    body: (
      <>
        The command writes <b>{basename(MOD_FILE)}</b> to <code>mods\</code> (custom plays, custom sets and formations, cloned plays, pulled-in stock plays).
        Add or refresh it in MMC Mod Manager, then Apply.
      </>
    ),
  },
  {
    title: "Pick Your Playbook",
    body: (
      <>
        Each <code>playbooks/*.json</code> becomes a save <b>PBOOKOFF-&lt;NAME&gt;</b> in <code>{SAVES_FOLDER}</code>. Choose it in-game as a custom playbook.
      </>
    ),
  },
  { title: "Nothing by Hand", body: <>Nothing goes into Frosty Editor by hand — the export script does all of it.</> },
  { title: "Offline Modes Only", body: <>Modded playbooks follow the MMC rules: offline modes only.</> },
];

export function NextCard() {
  return (
    <section className={s.card}>
      <CardHead eyebrow="After the Command" title="What Happens Next" />
      <ol className={s.steps}>
        {STEPS.map((st, i) => (
          <li key={st.title}>
            <span className={s.stepNum}>{i + 1}</span>
            <div>
              <div className={s.stepTitle}>{st.title}</div>
              <div className={s.stepBody}>{st.body}</div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
