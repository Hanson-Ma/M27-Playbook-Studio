// Step 3 — audibles & CPU: for a set or one of its plays, the audible diamond (with the Xbox / PS5 / Keyboard switch);
// for a play also its card, the CPU-weights editor (common situations; "Show all situations" for the rest) and its
// actions. Formations, template entries and the book get a short explanation and their actions. Raw details (asset
// paths, unknown keys) sit behind "Advanced".
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { AudibleGlyph } from "../../input/glyphs";
import { clipboardStore } from "../../model/clipboard";
import { AUDIBLE_CATEGORY } from "../../model/audibles";
import { formatJson } from "../../model/json";
import { FORMATION_ENTRY_KEYS, PLAY_ENTRY_KEYS, SET_ENTRY_KEYS, cpuEditorGroups, cpuOf, getSet, setCpuWeight, unknownKeys } from "../../model/playbook";
import { playTypeInfo } from "../../model/playtypes";
import { templatePlayProblem } from "../../model/tdb";
import { SITUATION_LABELS, SITUATION_ORDER } from "../../model/situations";
import { PlayCard } from "../../field";
import { navigate } from "../../state/router";
import { Button, EmptyState, Icon, IconButton, NumberField, Slider, Tag, Toggle, cx } from "../../ui";
import { AudiblePanel } from "./AudiblePanel";
import { useBuilder, type BookNode, type BuilderData } from "./context";
import { Advanced } from "./MiddlePane";
import { clearWeights, convertTemplate, copySelection, copyWeights, duplicateSelection, openInLibrary, pasteWeights, removeSelection } from "./ops";
import { StepHeader } from "./parts";
import { BOOK_ID, parentOf, useBuilderUi } from "./store";
import s from "./Inspector.module.css";

export function Inspector() {
  const data = useBuilder();
  const cursor = useBuilderUi((st) => st.cursor);
  const node = data.nodes.get(cursor) ?? data.nodes.get(BOOK_ID)!;
  const setNode = node.level === "set" ? node : node.level === "play" ? data.nodes.get(parentOf(node.id)) : undefined;
  const hint =
    node.level === "play"
      ? "Its audible button and when the CPU calls it"
      : node.level === "set"
        ? "Select a play to set its CPU weights"
        : "Pick a set in step 1 first";
  return (
    <div className={s.pane}>
      <StepHeader step={3} title="Audibles & CPU" hint={hint} />
      <div className={s.scroll} data-autoscroll>
        <div className={s.inner}>
          {setNode?.rs && <AudiblePanel setNode={setNode} />}
          {node.level === "play" && <PlayInspector key={node.id} node={node} />}
          {node.level === "set" && <SetInspector node={node} />}
          {node.level === "formation" && <FormationInspector node={node} />}
          {node.level === "tplay" && <TemplatePlayInspector node={node} />}
          {node.level === "tset" && <TemplateSetInspector node={node} />}
          {node.level === "book" && <BookInspector />}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── play ─────────────────────────────

function PlayInspector({ node }: { node: BookNode }) {
  const data = useBuilder();
  const rp = node.rp!;
  const play = rp.play;
  const selected = useBuilderUi((st) => st.selected);
  const multi = useMemo(
    () => selected.map((id) => data.nodes.get(id)).filter((n): n is BookNode => n?.level === "play" && !!n.ref),
    [selected, data.nodes],
  );
  const slot = rp.entry.audible;
  const extra = unknownKeys(rp.entry, PLAY_ENTRY_KEYS);
  const info = play ? playTypeInfo(play.playType) : undefined;
  const [advanced, setAdvanced] = useState(false);

  return (
    <section className={s.section}>
      <div className={s.eyebrow}>{multi.length > 1 ? `${multi.length} Plays Selected · Showing` : "Selected Play"}</div>
      {play ? (
        <PlayCard play={play} size="md" leading={slot && [1, 2, 3, 4].includes(slot) ? <AudibleGlyph slot={slot} size="md" /> : undefined} />
      ) : (
        <div className={s.broken}>
          <Icon name="warning" size={18} /> {rp.malformed ?? rp.problem}
        </div>
      )}
      <div className={s.facts}>
        {info && (
          <Tag size="sm" tone={info.family}>
            {info.label}
          </Tag>
        )}
        {play?.source === "custom" && (
          <Tag size="sm" tone="custom">
            Custom
          </Tag>
        )}
        <span className={s.audFact}>{slot && [1, 2, 3, 4].includes(slot) ? `${AUDIBLE_CATEGORY[slot]} Audible` : "No Audible"}</span>
      </div>
      {play?.problems.length ? <div className={s.problem}>{play.problems.join("; ")}</div> : null}

      <CpuEditor node={node} multi={multi} />

      <div className={s.buttons}>
        {play && (
          <Button size="sm" icon="external" onClick={() => openInLibrary(play.key)}>
            Open in Library
          </Button>
        )}
        {play?.source === "custom" && !play.clone && play.file !== undefined && play.index !== undefined && (
          <Button size="sm" icon="route" onClick={() => navigate(`#/designer/${encodeURIComponent(play.file!)}/${play.index}`)}>
            Edit in Designer
          </Button>
        )}
        {play?.clone && data.custom.editHref(play.set) && (
          <Button size="sm" icon="field" onClick={() => navigate(data.custom.editHref(play.set)!)} title="This play is cloned into a custom set">
            Edit Its Custom Set
          </Button>
        )}
        <Button size="sm" variant="danger" icon="trash" onClick={() => void removeSelection(data)}>
          {multi.length > 1 ? `Remove ${multi.length} Plays` : "Remove From Playbook"}
        </Button>
      </div>

      <Advanced open={advanced} onToggle={setAdvanced}>
        {play && (
          <dl className={s.dl}>
            <dt>Play Asset</dt>
            <dd>
              <code className={s.asset}>{play.key}</code>
            </dd>
            <dt>Set</dt>
            <dd className="caps">
              {String(node.rf?.entry.formation)} › {String(node.rs?.entry.set)}
            </dd>
          </dl>
        )}
        {Object.keys(extra).length > 0 && (
          <>
            <div className={s.subhead}>Other Keys in the File (Kept As-Is)</div>
            <pre className={s.json}>{formatJson(extra, { width: 44 })}</pre>
          </>
        )}
      </Advanced>
    </section>
  );
}

// ───────────────────────────── CPU weights ─────────────────────────────

function CpuEditor({ node, multi }: { node: BookNode; multi: BookNode[] }) {
  const data = useBuilder();
  const rp = node.rp!;
  const ref = node.ref!;
  const cpu = cpuOf(rp.entry);
  const rawCpu = rp.entry.cpu;
  const showAll = useBuilderUi((st) => st.cpuShowAll);
  const weightsClip = useStore(clipboardStore, (st) => st.weights);
  const setCount = Object.keys(cpu).length;
  const refs = multi.length > 1 ? multi.map((n) => n.ref!) : [ref];
  const groups = useMemo(() => cpuEditorGroups(cpu, showAll), [cpu, showAll]);

  /** One weight edit (slider drags coalesce into one undo step). */
  const write = (key: string, v: number | undefined) =>
    data.edit(
      `CPU ${key}`,
      (d) => {
        const e = getSet(d, ref.f, ref.s!)?.plays?.[ref.p!];
        if (e) setCpuWeight(e, key, v);
      },
      { coalesceMs: 800 },
    );
  const writeRef = useRef(write);
  writeRef.current = write;
  const onRowChange = useCallback((key: string, v: number | undefined) => writeRef.current(key, v), []);

  return (
    <section className={cx(s.sub, s.cpu)}>
      <div className={s.sectionHead}>
        <h3 className={s.h3}>When the CPU Calls It</h3>
        <span className={s.hint}>{setCount ? `${setCount} situation${setCount === 1 ? "" : "s"}` : "none set"}</span>
      </div>
      <p className={s.hint}>
        CPU weights (0–100) make the CPU and Ask Madden more likely to call this play in a situation. Leave them empty to keep the game's default.
      </p>
      {rawCpu !== undefined && (typeof rawCpu !== "object" || Array.isArray(rawCpu)) && <div className={s.problem}>“cpu” in the file isn't a list of situations — fix it in the file</div>}
      <div className={s.cpuTools}>
        <Button size="sm" variant="ghost" icon="copy" disabled={!setCount} onClick={() => copyWeights(data, node)}>
          Copy
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon="paste"
          disabled={!weightsClip}
          title={weightsClip ? `Paste the weights copied from ${weightsClip.from}` : "Copy weights from a play first"}
          onClick={() => pasteWeights(data, refs)}
        >
          Paste{refs.length > 1 ? ` to ${refs.length}` : ""}
        </Button>
        <Button size="sm" variant="ghost" icon="close" disabled={!setCount && refs.length < 2} onClick={() => clearWeights(data, refs)}>
          Clear{refs.length > 1 ? ` ${refs.length}` : " All"}
        </Button>
      </div>
      {/* One grid for every group (rows are subgrids), so the label column fits the longest label and sliders line up. */}
      <div className={s.cpuGrid}>
        {groups.map((g) => (
          <div key={g.id} className={s.cpuGroup}>
            <div className={s.groupHead}>
              <span>{g.label}</span>
              {g.set > 0 && <span className={s.groupCount}>{g.set}</span>}
            </div>
            {g.rows.map((r) => (
              <CpuRowView key={r.key} rowKey={r.key} label={r.label} known={r.known} value={cpu[r.key]} onChange={onRowChange} />
            ))}
          </div>
        ))}
      </div>
      <Toggle size="sm" checked={showAll} onChange={(v) => useBuilderUi.getState().set({ cpuShowAll: v })} label="Show All Situations" />
    </section>
  );
}

const CpuRowView = memo(function CpuRowView({
  rowKey,
  label,
  known,
  value,
  onChange,
}: {
  rowKey: string;
  label: string;
  known: boolean;
  value: number | undefined;
  onChange(key: string, v: number | undefined): void;
}) {
  const isSet = value !== undefined;
  return (
    <div className={cx(s.cpuRow, isSet && s.cpuSet, !known && s.cpuUnknown)} data-cpu-key={rowKey}>
      <span className={s.cpuLabel} title={known ? label : `${rowKey} isn't a situation the game knows`}>
        {label}
      </span>
      <Slider value={value ?? 0} onChange={(v) => onChange(rowKey, v)} min={0} max={100} step={1} className={s.cpuSlider} aria-label={`${label} weight`} />
      <NumberField value={value} onChange={(v) => onChange(rowKey, v)} min={0} max={100} step={1} size="sm" width={58} placeholder="—" aria-label={`${label} weight value`} />
      <IconButton icon="close" title="Clear" size="sm" className={cx(s.cpuClear, !isSet && s.hidden)} disabled={!isSet} onClick={() => onChange(rowKey, undefined)} />
    </div>
  );
});

// ───────────────────────────── other nodes ─────────────────────────────

function SetInspector({ node }: { node: BookNode }) {
  const data = useBuilder();
  const rs = node.rs!;
  const extra = unknownKeys(rs.entry, SET_ENTRY_KEYS);
  const [advanced, setAdvanced] = useState(false);
  const firstPlay = data.ids.formations[node.ref!.f]?.sets[node.ref!.s!]?.plays[0];
  return (
    <section className={s.section}>
      {rs.plays.length ? (
        <div className={s.callout}>
          <Icon name="info" size={16} />
          <div>
            Select a play — click its card in step 2 — to give it an audible button and set when the CPU calls it.
            {firstPlay && (
              <div className={s.calloutAction}>
                <Button size="sm" onClick={() => useBuilderUi.getState().select(firstPlay)}>
                  Select the First Play
                </Button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <EmptyState compact icon="playcall" title="No Plays in This Set Yet" body="Add plays in step 2 first." />
      )}
      <EntryButtons data={data} />
      <Advanced open={advanced} onToggle={setAdvanced}>
        {rs.set && (
          <dl className={s.dl}>
            <dt>Set Asset</dt>
            <dd>
              <code className={s.asset}>{rs.set.asset}</code>
            </dd>
          </dl>
        )}
        {Object.keys(extra).length > 0 && (
          <>
            <div className={s.subhead}>Other Keys in the File (Kept As-Is)</div>
            <pre className={s.json}>{formatJson(extra, { width: 44 })}</pre>
          </>
        )}
      </Advanced>
    </section>
  );
}

function FormationInspector({ node }: { node: BookNode }) {
  const data = useBuilder();
  const rf = node.rf!;
  const extra = unknownKeys(rf.entry, FORMATION_ENTRY_KEYS);
  const [advanced, setAdvanced] = useState(false);
  return (
    <section className={s.section}>
      <div className={s.eyebrow}>{rf.template ? "Template Section" : "Formation"}</div>
      <h2 className={cx(s.title, "caps")}>{String(rf.entry.formation)}</h2>
      <p className={s.hint}>
        {rf.template
          ? "Its audibles and CPU weights come from the game's template playbook. Convert it to editable sets to change them."
          : "Audibles and CPU weights are set per set and play. Pick one of this formation's sets in step 1."}
      </p>
      {(rf.malformed ?? rf.problem) && <div className={s.problem}>{rf.malformed ?? rf.problem}</div>}
      {rf.template && node.tf && node.tf.sets.length > 0 && (
        <Button size="sm" variant="primary" icon="unlock" onClick={() => void convertTemplate(data, rf.index)}>
          Convert to Editable Sets
        </Button>
      )}
      <EntryButtons data={data} />
      <Advanced open={advanced} onToggle={setAdvanced}>
        {rf.formation && (
          <dl className={s.dl}>
            <dt>Asset</dt>
            <dd>
              <code className={s.asset}>{rf.formation.asset}</code>
            </dd>
            <dt>formId</dt>
            <dd>{rf.formation.formId}</dd>
          </dl>
        )}
        {Object.keys(extra).length > 0 && (
          <>
            <div className={s.subhead}>Other Keys in the File (Kept As-Is)</div>
            <pre className={s.json}>{formatJson(extra, { width: 44 })}</pre>
          </>
        )}
      </Advanced>
    </section>
  );
}

function EntryButtons({ data }: { data: BuilderData }) {
  return (
    <div className={s.buttons}>
      <Button size="sm" icon="copy" onClick={() => copySelection(data)}>
        Copy
      </Button>
      <Button size="sm" icon="duplicate" onClick={() => duplicateSelection(data)}>
        Duplicate
      </Button>
      <Button size="sm" variant="danger" icon="trash" title="Asks first" onClick={() => void removeSelection(data)}>
        Remove…
      </Button>
    </div>
  );
}

function TemplatePlayInspector({ node }: { node: BookNode }) {
  const data = useBuilder();
  const tp = node.tp!;
  const play = data.catalog.get(tp.play.asset);
  const cpu = tp.cpu ?? {};
  const leftOut = node.ts ? templatePlayProblem(node.ts, tp, data.catalog, data.side, { template: data.template.contents }) : undefined;
  return (
    <section className={s.section}>
      <div className={s.eyebrow}>
        <Icon name="lock" size={12} /> Template Play (Read-Only)
      </div>
      {play && <PlayCard play={play} size="md" leading={tp.audible ? <AudibleGlyph slot={tp.audible} size="md" /> : undefined} />}
      <div className={cx(s.facts, "caps")}>
        <span>{node.tf?.formation.name}</span>
        <span className={s.sep}>›</span>
        <span>{node.ts?.set.name}</span>
      </div>
      {leftOut && <div className={s.warnText}>Converting this section leaves this play out: {leftOut}.</div>}
      <dl className={s.dl}>
        <dt>Audible</dt>
        <dd>{tp.audible ? AUDIBLE_CATEGORY[tp.audible] : "None"}</dd>
        {SITUATION_ORDER.filter((k) => k in cpu).map((k) => (
          <div key={k} className={s.dlPair}>
            <dt>{SITUATION_LABELS[k as keyof typeof SITUATION_LABELS] ?? k}</dt>
            <dd>{cpu[k]}</dd>
          </div>
        ))}
      </dl>
      <div className={s.buttons}>
        <Button size="sm" icon="unlock" disabled={!node.tf} onClick={() => void convertTemplate(data, node.ref!.f)}>
          Convert Section
        </Button>
        <Button size="sm" icon="copy" onClick={() => copySelection(data)}>
          Copy
        </Button>
        {play && (
          <Button size="sm" icon="external" onClick={() => openInLibrary(play.key)}>
            Open in Library
          </Button>
        )}
      </div>
    </section>
  );
}

function TemplateSetInspector({ node }: { node: BookNode }) {
  const data = useBuilder();
  const ts = node.ts!;
  return (
    <section className={s.section}>
      <div className={s.eyebrow}>
        <Icon name="lock" size={12} /> Template Set (Read-Only)
      </div>
      <h2 className={cx(s.title, "caps")}>{ts.set.name}</h2>
      <dl className={s.dl}>
        <dt>Plays</dt>
        <dd>{ts.plays.length}</dd>
        <dt>Audibles</dt>
        <dd>{ts.plays.filter((p) => p.audible).length} of 4</dd>
      </dl>
      <div className={s.buttons}>
        <Button size="sm" icon="unlock" disabled={!node.tf} onClick={() => void convertTemplate(data, node.ref!.f)}>
          Convert Section
        </Button>
        <Button size="sm" icon="copy" onClick={() => copySelection(data)}>
          Copy Set
        </Button>
      </div>
    </section>
  );
}

function BookInspector() {
  const data = useBuilder();
  const firstSet = data.ids.formations.find((f) => f.sets.length)?.sets[0]?.id;
  return (
    <EmptyState
      compact
      icon="playcall"
      title="Pick a Set First"
      body="Audibles (four per set, one per controller button) and CPU weights (per play) show up here once you select a set or a play."
      action={
        firstSet ? (
          <Button size="sm" onClick={() => useBuilderUi.getState().select(firstSet)}>
            Open the First Set
          </Button>
        ) : undefined
      }
    />
  );
}
