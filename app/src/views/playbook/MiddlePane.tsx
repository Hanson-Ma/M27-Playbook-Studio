// Step 2 — add & order plays: the selected set (SetPanel), a formation's sets, a template section's read-only
// contents, or (book selected) the playbook overview with the three-step guide.
import { memo, useMemo, useState, type PointerEvent, type ReactNode } from "react";
import { AudibleGlyph } from "../../input/glyphs";
import { AUDIBLE_SLOTS } from "../../model/audibles";
import { formatJson } from "../../model/json";
import { formationShort } from "../../model/names";
import { BOOK_KEYS, FORMATION_ENTRY_KEYS, unknownKeys } from "../../model/playbook";
import { templateFormationCounts, templateFormationToEntry, templatePlayProblem } from "../../model/tdb";
import type { PlaybookSpec, Side } from "../../model/types";
import { PlayCard } from "../../field";
import { navigate } from "../../state/router";
import { useDoc } from "../../state/workspace";
import { Button, EmptyState, Icon, Segmented, TextArea, cx } from "../../ui";
import { renamePlaybook } from "./books";
import { tplayIds, tsetId, useBuilder, useDragHandlers, type BookNode, type BuilderData } from "./context";
import { beginDrag } from "./dnd";
import { LazyMount } from "./LazyMount";
import { CategoryDots, playCategories, useConcepts } from "./categories";
import { convertTemplate, labelOf } from "./ops";
import { StepHeader } from "./parts";
import { SetPanel } from "./SetPanel";
import { SkippedList } from "./skipped";
import { BOOK_ID, levelOf, parentOf, useBuilderUi } from "./store";
import { templateEmptyReason } from "./Tree";
import s from "./MiddlePane.module.css";

export function MiddlePane() {
  const data = useBuilder();
  const cursor = useBuilderUi((st) => st.cursor);
  const node = data.nodes.get(cursor) ?? data.nodes.get(BOOK_ID)!;
  let body;
  let hint = "Select a set in step 1 to see and add its plays";
  switch (node.level) {
    case "play":
    case "set": {
      const setNode = node.level === "set" ? node : data.nodes.get(parentOf(node.id));
      body = setNode ? <SetPanel setNode={setNode} /> : null;
      hint = "Tick plays to add them · drag cards to reorder";
      break;
    }
    case "formation":
      body = node.rf?.template ? <TemplateFormationView node={node} /> : <FormationOverview node={node} />;
      if (!node.rf?.template) hint = "Pick one of its sets — or add a set with “+ Set” in step 1";
      break;
    case "tset":
    case "tplay": {
      const sid = node.level === "tset" ? node.id : parentOf(node.id);
      const setNode = data.nodes.get(sid);
      body = setNode ? <TemplateSetView setNode={setNode} /> : null;
      hint = "Template sections are copied as-is — convert to edit";
      break;
    }
    default:
      body = <BookOverview />;
  }
  return (
    <div className={s.pane}>
      <StepHeader step={2} title="Add & Order Plays" hint={hint} />
      {body}
    </div>
  );
}

// ───────────────────────────── book overview ─────────────────────────────

const SIDES = [
  { value: "offense" as const, label: "Offense" },
  { value: "defense" as const, label: "Defense" },
];

function BookOverview() {
  const data = useBuilder();
  const c = data.book.counts;
  const notes = typeof data.spec.notes === "string" ? data.spec.notes : "";
  const side: Side = data.spec.side === "defense" ? "defense" : "offense";
  const extra = unknownKeys(data.spec, BOOK_KEYS);
  const [advanced, setAdvanced] = useState(false);
  const firstSet = data.ids.formations.find((f) => f.sets.length)?.sets[0]?.id;
  const explicit = data.book.formations.filter((rf) => !rf.template).length;
  const tiles: { label: string; value: number | string; tone?: "danger" | "amber" }[] = [
    { label: "Formations", value: c.formations + c.templateFormations },
    { label: "Sets", value: c.sets },
    { label: "Plays", value: c.plays },
    { label: "Need the Mod", value: c.custom + c.pulled, tone: c.custom + c.pulled ? "amber" : undefined },
  ];
  if (c.unresolved) tiles.push({ label: "Can't Be Found", value: c.unresolved, tone: "danger" });
  const doc = useDoc<PlaybookSpec>(data.path);
  return (
    <div className={s.scroll} data-autoscroll>
      <div className={s.inner}>
        <div className={s.eyebrow}>Playbook</div>
        <div className={s.titleRow}>
          <h1 className={s.bigTitle}>{String(data.spec.name || "Untitled")}</h1>
          {doc && (
            <Button size="sm" variant="ghost" icon="file" onClick={() => void renamePlaybook(doc)}>
              Rename…
            </Button>
          )}
        </div>

        <ol className={s.guide}>
          <li className={s.guideStep}>
            <span className={s.guideNum}>1</span>
            <div>
              <div className={s.guideTitle}>Pick a Set</div>
              <p>
                In the tree, add a formation (“+ Formation”), then one of its sets (“+ Set”). {explicit ? "Click a set to open it." : ""}
              </p>
            </div>
          </li>
          <li className={s.guideStep}>
            <span className={s.guideNum}>2</span>
            <div>
              <div className={s.guideTitle}>Add & Order Plays</div>
              <p>Tick plays in the set's list, or use Add Plays to search the library. Drag cards to set the order.</p>
            </div>
          </li>
          <li className={s.guideStep}>
            <span className={s.guideNum}>3</span>
            <div>
              <div className={s.guideTitle}>Audibles & CPU</div>
              <p>Give up to four plays per set an audible button, and tell the CPU when to call each play.</p>
            </div>
          </li>
        </ol>
        <div className={s.actions}>
          {firstSet && (
            <Button variant="primary" icon="chevronRight" onClick={() => useBuilderUi.getState().select(firstSet)}>
              Open the First Set
            </Button>
          )}
          <Button icon="plus" onClick={() => useBuilderUi.getState().setDrawer(true)}>
           Add Plays
          </Button>
          <Button icon="playcall" onClick={() => navigate(`#/playcall/${encodeURIComponent(data.path)}`)}>
           Preview in Game
          </Button>
          <Button icon="export" onClick={() => navigate("#/export")}>
            Export
          </Button>
        </div>

        <div className={s.tiles}>
          {tiles.map((t) => (
            <div key={t.label} className={cx(s.tile, t.tone && s[t.tone])}>
              <div className={s.tileValue}>{t.value}</div>
              <div className={s.tileLabel}>{t.label}</div>
            </div>
          ))}
        </div>

        <section className={s.section}>
          <h3 className={s.h3}>Formations</h3>
          {data.book.formations.length === 0 ? (
            <EmptyState compact icon="field" title="No Formations Yet" body="Use “+ Formation” at the bottom of the tree to add your first one." />
          ) : (
            <div className={s.formList}>
              {data.book.formations.map((rf) => {
                const fid = data.ids.formations[rf.index]?.id;
                const tf = fid ? data.nodes.get(fid)?.tf : undefined;
                const counts = rf.template ? (tf ? templateFormationCounts(tf) : undefined) : { sets: rf.sets.length, plays: rf.sets.reduce((n, x) => n + x.plays.length, 0) };
                return (
                  <button key={fid ?? rf.index} type="button" className={cx(s.formRow, rf.problem && s.bad)} onClick={() => fid && useBuilderUi.getState().select(fid)}>
                    <span className={s.formShort}>{formationShort(String(rf.formation?.name ?? rf.entry.formation))}</span>
                    <span className={s.formName}>{String(rf.entry.formation)}</span>
                    {rf.template && <span className={s.tplTag}>Template</span>}
                    {data.custom.formation(rf.formation?.asset) && <span className={s.customTag}>Custom</span>}
                    <span className={s.formMeta}>
                      {counts ? (
                        <>
                          <b>{counts.sets}</b> {counts.sets === 1 ? "set" : "sets"} · <b>{counts.plays}</b> {counts.plays === 1 ? "play" : "plays"}
                        </>
                      ) : (
                        (rf.problem ?? "…")
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className={s.section}>
          <h3 className={s.h3}>Notes</h3>
          <TextArea
            value={notes}
            onChange={(v) =>
              data.edit(
                "Edit notes",
                (d) => {
                  if (v) d.notes = v;
                  else delete d.notes;
                },
                { coalesceMs: 1500 },
              )
            }
            autoGrow
            rows={3}
            maxRows={16}
            placeholder="What this playbook is for, what to test in game…"
            aria-label="Playbook notes"
          />
        </section>

        <Advanced open={advanced} onToggle={setAdvanced}>
          <dl className={s.dl}>
            <dt>Side</dt>
            <dd>
              <Segmented<Side> size="sm" options={SIDES} value={side} onChange={(v) => data.edit("Change side", (d) => void (d.side = v))} aria-label="Playbook side" />
            </dd>
            <dt>File</dt>
            <dd>
              <code className={s.code}>{data.path}</code>
            </dd>
            <dt>Template Sections</dt>
            <dd>{c.templateFormations}</dd>
            <dt>CPU Weight Rows</dt>
            <dd>{c.cpuRows}</dd>
          </dl>
          {Object.keys(extra).length > 0 && (
            <>
              <div className={s.subhead}>Other Keys in the File (Kept As-Is)</div>
              <pre className={s.json}>{formatJson(extra, { width: 60 })}</pre>
            </>
          )}
        </Advanced>
      </div>
    </div>
  );
}

/** "Advanced" disclosure for raw / technical details. */
export function Advanced({ open, onToggle, children, label = "Advanced" }: { open: boolean; onToggle(v: boolean): void; children: ReactNode; label?: string }) {
  return (
    <section className={s.advanced}>
      <button type="button" className={s.advHead} aria-expanded={open} onClick={() => onToggle(!open)}>
        <Icon name={open ? "chevronDown" : "chevronRight"} size={14} />
        {label}
      </button>
      {open && <div className={s.advBody}>{children}</div>}
    </section>
  );
}

// ───────────────────────────── formation overview ─────────────────────────────

function FormationOverview({ node }: { node: BookNode }) {
  const data = useBuilder();
  const rf = node.rf!;
  const fIds = data.ids.formations[rf.index];
  const drag = useDragHandlers();
  const [advanced, setAdvanced] = useState(false);
  const extra = unknownKeys(rf.entry, FORMATION_ENTRY_KEYS);
  const custom = data.custom.formation(rf.formation?.asset);
  return (
    <div className={s.scroll} data-autoscroll>
      <div className={s.inner}>
        <div className={s.eyebrow}>
          Formation {custom && <span className={s.customTag}>Custom Formation</span>}
        </div>
        <h1 className={cx(s.bigTitle, "caps")}>{String(rf.entry.formation)}</h1>
        {(rf.malformed ?? rf.problem) && <div className={s.problem}>{rf.malformed ?? rf.problem}</div>}
        {rf.sets.length === 0 ? (
          <EmptyState compact icon="grid" title="No Sets Yet" body="Add one with “+ Set” under this formation in the tree." />
        ) : (
          <div className={s.setGrid}>
            {rf.sets.map((rs, i) => {
              const id = fIds?.sets[i]?.id;
              if (!id) return null;
              return (
                <SetTile
                  key={id}
                  id={id}
                  data={data}
                  onPointerDown={(e) => {
                    const n = data.nodes.get(id);
                    if (!n?.ref) return;
                    beginDrag(
                      e,
                      () => {
                        const ui = useBuilderUi.getState();
                        const sel = ui.selected.includes(id) ? ui.selected.filter((x) => levelOf(x) === "set" && parentOf(x) === node.id) : [id];
                        const nodes = sel.map((x) => data.nodes.get(x)).filter((x): x is BookNode => !!x?.ref);
                        return { kind: "sets", refs: nodes.map((x) => x.ref!), label: nodes.length === 1 ? labelOf(nodes[0]) : `${nodes.length} sets`, count: nodes.length };
                      },
                      drag,
                    );
                  }}
                />
              );
            })}
          </div>
        )}
        <Advanced open={advanced} onToggle={setAdvanced}>
          {rf.formation && (
            <dl className={s.dl}>
              <dt>Asset</dt>
              <dd>
                <code className={s.code}>{rf.formation.asset}</code>
              </dd>
              <dt>formId</dt>
              <dd>{rf.formation.formId}</dd>
              <dt>Sets in the Library</dt>
              <dd>{data.lib.setsByFormation.get(rf.formation.asset)?.length ?? 0}</dd>
            </dl>
          )}
          {Object.keys(extra).length > 0 && (
            <>
              <div className={s.subhead}>Other Keys in the File (Kept As-Is)</div>
              <pre className={s.json}>{formatJson(extra, { width: 60 })}</pre>
            </>
          )}
        </Advanced>
      </div>
    </div>
  );
}

const SetTile = memo(function SetTile({ id, data, onPointerDown }: { id: string; data: BuilderData; onPointerDown(e: PointerEvent): void }) {
  const selected = useBuilderUi((st) => st.selected.includes(id));
  const concepts = useConcepts();
  const n = data.nodes.get(id);
  const rs = n?.rs;
  if (!rs) return null;
  const used = new Map(rs.plays.filter((p) => p.entry.audible).map((p) => [p.entry.audible!, p.entry.play]));
  const mods = rs.plays.filter((p) => p.play && !p.play.global).length;
  const bad = rs.plays.filter((p) => p.problem).length;
  const custom = data.custom.set(rs.set?.asset);
  return (
    <div
      className={cx(s.setTile, selected && s.setTileSelected, rs.problem && s.bad)}
      role="button"
      tabIndex={0}
      data-drop="set-card"
      data-drop-id={id}
      data-node-id={id}
      onPointerDown={onPointerDown}
      onClick={(e) => useBuilderUi.getState().select(id, { additive: e.metaKey || e.ctrlKey })}
      onKeyDown={(e) => {
        if (e.key === "Enter") useBuilderUi.getState().select(id);
      }}
    >
      <div className={s.setTileHead}>
        <span className={s.setTileName}>{String(rs.entry.set)}</span>
        <span className={s.setTileCount}>{rs.plays.length}</span>
      </div>
      {custom && <span className={cx(s.customTag, s.tileTag)}>Custom Set</span>}
      {(rs.malformed ?? rs.problem) && <div className={s.problem}>{rs.malformed ?? rs.problem}</div>}
      <div className={s.setTileAud}>
        {AUDIBLE_SLOTS.map((sl) => (
          <span key={sl} className={cx(s.audChip, used.has(sl) && s.audChipOn)} title={used.get(sl) ? String(used.get(sl)) : "No audible"}>
            <AudibleGlyph slot={sl} size="sm" />
          </span>
        ))}
      </div>
      <div className={s.setTilePlays}>
        {rs.plays.slice(0, 6).map((p, i) => (
          <span key={i} className={cx(s.setTilePlay, p.problem && s.badText)}>
            <span className={s.setTilePlayName}>{String(p.entry.play)}</span>
            <CategoryDots cats={playCategories(concepts, p.play?.key)} max={2} />
          </span>
        ))}
        {rs.plays.length > 6 && <span className={s.dim}>+{rs.plays.length - 6} more</span>}
        {rs.plays.length === 0 && <span className={s.dim}>No plays yet</span>}
      </div>
      {(mods > 0 || bad > 0) && (
        <div className={s.setTileFoot}>
          {mods > 0 && <span className={s.modText}>{mods} need the mod</span>}
          {bad > 0 && <span className={s.badText}>{bad} can't be found</span>}
        </div>
      )}
    </div>
  );
});

// ───────────────────────────── template sections ─────────────────────────────

function TemplateFormationView({ node }: { node: BookNode }) {
  const data = useBuilder();
  const rf = node.rf!;
  const tf = node.tf;
  // What "Convert" would leave out (plays a playbook can't list by name).
  const skipped = useMemo(() => (tf ? templateFormationToEntry(tf, data.catalog, data.side, { template: data.template.contents }).skipped : []), [tf, data.catalog, data.side, data.template.contents]);
  const empty = templateEmptyReason(data, node);
  const st = data.template;
  return (
    <div className={s.scroll} data-autoscroll>
      <div className={s.inner}>
        <div className={s.eyebrow}>
          <Icon name="lock" size={12} /> Template Section
        </div>
        <h1 className={cx(s.bigTitle, "caps")}>{String(rf.entry.formation)}</h1>
        <p className={s.lead}>
          This formation is copied as-is from the game's template playbook — every set, play, audible and CPU weight. That's the easy way to keep
          special teams and goal line. Convert it to pick and order its plays yourself.
        </p>
        {empty && (
          <div className={s.dangerBox} role="alert">
            <Icon name="warning" size={18} />
            <div>
              <div className={s.dangerTitle}>Nothing to Copy</div>
              <p>{empty}</p>
            </div>
          </div>
        )}
        {!empty && (rf.malformed ?? rf.problem) && <div className={s.problem}>{rf.malformed ?? rf.problem}</div>}
        {tf && tf.sets.length > 0 && (
          <div className={s.actions}>
            <Button variant="primary" icon="unlock" onClick={() => void convertTemplate(data, rf.index)}>
              Convert to Editable Sets
            </Button>
          </div>
        )}
        {!tf ? (
          st.status !== "ready" && (
            <div className={s.note}>{st.status === "error" ? `The template playbook couldn't be read: ${st.error}` : "Loading the template playbook…"}</div>
          )
        ) : (
          <>
            {skipped.length > 0 && (
              <div className={s.note}>
                Converting leaves out {skipped.length} play{skipped.length === 1 ? "" : "s"} a playbook can't list by name (keep the template section to keep
                them):
                <SkippedList skipped={skipped} />
              </div>
            )}
            <div className={s.setGrid}>
              {tf.sets.map((ts) => {
                const id = tsetId(node.id, ts);
                return (
                  <button key={id} type="button" className={cx(s.setTile, s.readOnly)} onClick={() => useBuilderUi.getState().select(id)}>
                    <div className={s.setTileHead}>
                      <span className={s.setTileName}>{ts.set.name}</span>
                      <span className={s.setTileCount}>{ts.plays.length}</span>
                    </div>
                    <div className={s.setTileAud}>
                      {AUDIBLE_SLOTS.map((sl) => (
                        <span key={sl} className={cx(s.audChip, ts.plays.some((p) => p.audible === sl) && s.audChipOn)}>
                          <AudibleGlyph slot={sl} size="sm" />
                        </span>
                      ))}
                    </div>
                    <div className={s.setTilePlays}>
                      {ts.plays.slice(0, 6).map((p, i) => (
                        <span key={i}>{p.play.name}</span>
                      ))}
                      {ts.plays.length > 6 && <span className={s.dim}>+{ts.plays.length - 6} more</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TemplateSetView({ setNode }: { setNode: BookNode }) {
  const data = useBuilder();
  const cursor = useBuilderUi((st) => st.cursor);
  const ts = setNode.ts!;
  const ids = useMemo(() => tplayIds(setNode.id, ts), [setNode.id, ts]);
  return (
    <div className={s.scroll} data-autoscroll>
      <div className={s.inner}>
        <div className={s.eyebrow}>
          <Icon name="lock" size={12} /> <span className="caps">{setNode.tf?.formation.name}</span> · Template Section (Read-Only)
        </div>
        <h1 className={cx(s.bigTitle, "caps")}>{ts.set.name}</h1>
        <div className={s.actions}>
          <Button icon="unlock" onClick={() => void convertTemplate(data, setNode.ref!.f)}>
            Convert {setNode.tf?.formation.name} to Editable Sets
          </Button>
        </div>
        <div className={s.cardGrid}>
          {ts.plays.map((tp, i) => {
            const id = ids[i];
            const play = data.catalog.get(tp.play.asset);
            return (
              <div key={id} data-node-id={id} className={s.cardCell}>
                <LazyMount placeholder={<div className={s.cardPlaceholder} />}>
                  {play ? (
                    <PlayCard
                      play={play}
                      size="sm"
                      selected={cursor === id}
                      leading={tp.audible ? <AudibleGlyph slot={tp.audible} size="md" /> : undefined}
                      stat={tp.cpu ? `CPU ${Object.keys(tp.cpu).length}` : undefined}
                      muted={!!templatePlayProblem(ts, tp, data.catalog, data.side, { template: data.template.contents })}
                      onClick={() => useBuilderUi.getState().select(id)}
                    />
                  ) : null}
                </LazyMount>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
