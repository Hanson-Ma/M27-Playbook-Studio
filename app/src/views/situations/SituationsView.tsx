// Situations (#/situations[/<playbook path>][?s=<situation>]): for each CPU situation (3rd & short, red zone, two-minute…),
// the plays the CPU and Ask Madden may call there, with their weights as editable percentages. Add a play to the
// situation or take it out; every edit is one undoable change to the playbook file (the same `cpu` weights the
// Playbook tab's inspector edits per play).
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { clampWeight, cpuOf, getSet, setCpuWeight } from "../../model/playbook";
import { bookPlayRefs, situationCounts, type BookPlayRef } from "../../model/concepts";
import { PLAY_FAMILIES, familyColor, familyLabel, playTypeInfo, type PlayFamily } from "../../model/playtypes";
import { SITUATION_GROUPS, SITUATION_LABELS, isSituationKey, type SituationKey } from "../../model/situations";
import type { PlayEntry, PlaybookSpec } from "../../model/types";
import { useCatalog } from "../../state/library";
import { href, navigate, useRoute } from "../../state/router";
import { useSettings } from "../../state/settings";
import { useDoc, useWorkspace } from "../../state/workspace";
import { Button, Chip, EmptyState, IconButton, NumberField, PlayTypeTag, Segmented, Spinner, TextInput, VirtualList, cx } from "../../ui";
import { BookPicker } from "../concepts/parts";
import { pickBook, resolvedBook, useBookOptions } from "../concepts/store";
import s from "./SituationsView.module.css";

const DEFAULT_SITUATION: SituationKey = "FirstDown";
/** A play added to a situation starts here (the Playbook tab's weights run 0–100). */
const START_WEIGHT = 50;

export function SituationsView() {
  const route = useRoute();
  const ready = useWorkspace((st) => st.ready);
  const catalog = useCatalog();
  const books = useBookOptions();
  const last = useSettings((st) => st.lastPlaybook);
  const book = pickBook(books, route.parts[0], last);
  if (!ready || !catalog)
    return (
      <div className={s.center}>
        <Spinner size={28} label="Loading" />
      </div>
    );
  if (!book?.spec)
    return (
      <div className={s.center}>
        <EmptyState
          icon="playcall"
          title={books.length ? "Pick a Playbook" : "No Playbooks Yet"}
          body="Situations show which plays the CPU may call for each down, distance and field position in one playbook."
          action={<Button onClick={() => navigate("#/playbook")}>Open Playbook</Button>}
        />
      </div>
    );
  const sit = route.query.get("s") ?? "";
  return <Situations key={book.path} path={book.path} spec={book.spec} books={books} situation={isSituationKey(sit) ? sit : DEFAULT_SITUATION} />;
}

type Row = { ref: BookPlayRef; weight: number; family: PlayFamily };

function Situations({ path, spec, books, situation }: { path: string; spec: PlaybookSpec; books: ReturnType<typeof useBookOptions>; situation: SituationKey }) {
  const catalog = useCatalog()!;
  const doc = useDoc<PlaybookSpec>(path);
  const rb = useMemo(() => resolvedBook(spec, catalog), [spec, catalog]);
  const refs = useMemo(() => bookPlayRefs(rb), [rb]);
  const counts = useMemo(() => situationCounts(rb), [rb]);
  const [sort, setSort] = useState<"formation" | "weight">("formation");
  const [adding, setAdding] = useState(false);

  // Undo / redo / Save in the top bar act on this playbook while the view is open.
  useEffect(() => {
    if (!doc || doc.error) return;
    useWorkspace.getState().setActive(path);
    return () => {
      if (useWorkspace.getState().activePath === path) useWorkspace.getState().setActive(undefined);
    };
  }, [path, !!doc && !doc.error]); // eslint-disable-line react-hooks/exhaustive-deps

  const goSituation = useCallback((k: SituationKey) => navigate(`${href("situations", path)}?s=${encodeURIComponent(k)}`, { replace: true }), [path]);
  const goBook = useCallback((p: string) => navigate(`${href("situations", p)}?s=${encodeURIComponent(situation)}`, { replace: true }), [situation]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const ref of refs) {
      const w = cpuOf(ref.entry)[situation];
      if (w !== undefined) out.push({ ref, weight: w, family: playTypeInfo(ref.play.playType).family });
    }
    return sort === "weight" ? out.sort((a, b) => b.weight - a.weight) : out;
  }, [refs, situation, sort]);

  const edit = useCallback(
    (label: string, ref: BookPlayRef, fn: (e: PlayEntry) => void, coalesce = false) =>
      useWorkspace.getState().update<PlaybookSpec>(
        path,
        (d) => {
          const e = getSet(d, ref.f, ref.s)?.plays?.[ref.p];
          if (e && typeof e === "object") fn(e);
        },
        { label, coalesceMs: coalesce ? 1200 : undefined },
      ),
    [path],
  );
  const setWeight = useCallback(
    (ref: BookPlayRef, v: number) => edit(`${SITUATION_LABELS[situation]} weight`, ref, (e) => setCpuWeight(e, situation, v), true),
    [edit, situation],
  );
  const remove = useCallback((ref: BookPlayRef) => edit(`Remove ${ref.play.name} from ${SITUATION_LABELS[situation]}`, ref, (e) => setCpuWeight(e, situation, undefined)), [edit, situation]);
  const add = useCallback(
    (ref: BookPlayRef, w: number) => edit(`Add ${ref.play.name} to ${SITUATION_LABELS[situation]}`, ref, (e) => setCpuWeight(e, situation, w)),
    [edit, situation],
  );

  const total = rows.reduce((n, r) => n + r.weight, 0);
  const mix = useMemo(() => {
    const m = new Map<PlayFamily, number>();
    for (const r of rows) m.set(r.family, (m.get(r.family) ?? 0) + r.weight);
    return PLAY_FAMILIES.filter((f) => m.has(f)).map((f) => ({ family: f, weight: m.get(f)! }));
  }, [rows]);

  return (
    <div className={s.page}>
      <div className={s.bar}>
        <div className={s.barBook}>
          <span className={s.kicker}>Playbook</span>
          <BookPicker books={books} value={path} onChange={goBook} />
          <span className={s.meta}>
            {rb.counts.plays} plays
            {rb.counts.templateFormations > 0 && ` · ${rb.counts.templateFormations} template section${rb.counts.templateFormations === 1 ? "" : "s"} keep the game's own weights`}
          </span>
        </div>
      </div>
      <div className={s.split}>
        <nav className={s.nav} aria-label="Situations">
          {SITUATION_GROUPS.map((g) => (
            <div key={g.id} className={s.group}>
              <div className={s.groupHead}>{g.label}</div>
              {g.keys.map((k) => {
                const n = counts.get(k)?.plays ?? 0;
                return (
                  <button key={k} type="button" aria-current={k === situation} className={cx(s.item, k === situation && s.itemOn, !n && s.itemEmpty)} onClick={() => goSituation(k)}>
                    <span>{SITUATION_LABELS[k]}</span>
                    <span className={s.count}>{n || "—"}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <section className={s.main}>
          <header className={s.head}>
            <div className={s.titles}>
              <div className={s.kicker}>What the CPU Calls For</div>
              <h2 className={s.title}>{SITUATION_LABELS[situation]}</h2>
            </div>
            <div className={s.headActions}>
              <Segmented<"formation" | "weight">
                size="sm"
                value={sort}
                onChange={setSort}
                options={[
                  { value: "formation", label: "By Formation" },
                  { value: "weight", label: "By Weight" },
                ]}
                aria-label="Order"
              />
              <Button size="sm" variant={adding ? "secondary" : "primary"} icon={adding ? "close" : "plus"} onClick={() => setAdding(!adding)}>
                {adding ? "Done Adding" : "Add Plays"}
              </Button>
            </div>
          </header>
          <div className={s.stats}>
            <span>
              <b>{rows.length}</b> play{rows.length === 1 ? "" : "s"}
            </span>
            {mix.length > 0 && (
              <>
                <div className={s.mixBar} role="img" aria-label="Share of the weight by kind of play">
                  {mix.map((m) => (
                    <span key={m.family} style={{ flex: m.weight, background: familyColor(m.family) }} title={`${familyLabel(m.family)} ${Math.round((100 * m.weight) / Math.max(1, total))}%`} />
                  ))}
                </div>
                <span className={s.mixLegend}>
                  {mix.map((m) => (
                    <span key={m.family}>
                      <i style={{ background: familyColor(m.family) }} />
                      {familyLabel(m.family)} {Math.round((100 * m.weight) / Math.max(1, total))}%
                    </span>
                  ))}
                </span>
              </>
            )}
          </div>
          {adding && <AddPanel refs={refs} situation={situation} onAdd={add} />}
          <div className={s.list}>
            {rows.length === 0 ? (
              <EmptyState
                compact
                icon="playcall"
                title="No Plays Called Here Yet"
                body={`The CPU uses the game's defaults for ${SITUATION_LABELS[situation]}. Add plays to choose what it calls.`}
                action={
                  !adding ? (
                    <Button size="sm" variant="primary" icon="plus" onClick={() => setAdding(true)}>
                      Add Plays
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <RowList rows={rows} grouped={sort === "formation"} onWeight={setWeight} onRemove={remove} />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

// ───────────────────────────── the plays in a situation ─────────────────────────────

function RowList({ rows, grouped, onWeight, onRemove }: { rows: Row[]; grouped: boolean; onWeight(ref: BookPlayRef, v: number): void; onRemove(ref: BookPlayRef): void }) {
  let lastKey = "";
  return (
    <>
      {rows.map((r) => {
        const key = `${r.ref.f}/${r.ref.s}`;
        const head = grouped && key !== lastKey;
        lastKey = key;
        return (
          <div key={`${r.ref.f}/${r.ref.s}/${r.ref.p}`} className={s.rowWrap}>
            {head && (
              <div className={s.setHead}>
                <span className="caps">{r.ref.formation}</span>
                <span className={s.sep}>›</span>
                <span className="caps">{r.ref.set}</span>
              </div>
            )}
            <PlayRow row={r} showWhere={!grouped} onWeight={onWeight} onRemove={onRemove} />
          </div>
        );
      })}
    </>
  );
}

const PlayRow = memo(function PlayRow({ row, showWhere, onWeight, onRemove }: { row: Row; showWhere: boolean; onWeight(ref: BookPlayRef, v: number): void; onRemove(ref: BookPlayRef): void }) {
  const { ref, weight } = row;
  return (
    <div className={s.row}>
      <div className={s.weight} style={{ "--w": `${clampWeight(weight)}%`, "--c": familyColor(row.family) } as React.CSSProperties}>
        <NumberField size="sm" value={weight} min={0} max={100} step={1} suffix="%" width={86} onChange={(v) => onWeight(ref, v)} aria-label={`${ref.play.name} weight`} />
        <span className={s.wbar} aria-hidden>
          <span />
        </span>
      </div>
      <PlayTypeTag playType={ref.play.playType} size="sm" />
      <span className={cx(s.name, "caps")}>{ref.play.name}</span>
      {showWhere && (
        <span className={s.where}>
          <span className="caps">{ref.formation}</span> · <span className="caps">{ref.set}</span>
        </span>
      )}
      <IconButton icon="close" size="sm" title={`Take ${ref.play.name} out of this situation`} aria-label={`Remove ${ref.play.name}`} onClick={() => onRemove(ref)} />
    </div>
  );
});

// ───────────────────────────── add plays ─────────────────────────────

function AddPanel({ refs, situation, onAdd }: { refs: BookPlayRef[]; situation: SituationKey; onAdd(ref: BookPlayRef, w: number): void }) {
  const [query, setQuery] = useState("");
  const [families, setFamilies] = useState<PlayFamily[]>([]);
  const [start, setStart] = useState(START_WEIGHT);
  const candidates = useMemo(
    () => refs.filter((r) => cpuOf(r.entry)[situation] === undefined).map((ref) => ({ ref, family: playTypeInfo(ref.play.playType).family })),
    [refs, situation],
  );
  const famCounts = useMemo(() => {
    const m = new Map<PlayFamily, number>();
    for (const c of candidates) m.set(c.family, (m.get(c.family) ?? 0) + 1);
    return m;
  }, [candidates]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return candidates.filter((c) => (!families.length || families.includes(c.family)) && (!q || `${c.ref.play.name} ${c.ref.formation} ${c.ref.set}`.toLowerCase().includes(q)));
  }, [candidates, query, families]);
  return (
    <div className={s.addPanel}>
      <div className={s.addTools}>
        <TextInput size="sm" value={query} onChange={setQuery} placeholder="Find a play, formation or set" icon="search" clearable aria-label="Find plays to add" />
        <label className={s.startWeight}>
          <span>Start at</span>
          <NumberField size="sm" value={start} min={0} max={100} step={5} suffix="%" width={86} onChange={setStart} aria-label="Weight a new play starts at" />
        </label>
      </div>
      <div className={s.chips}>
        {PLAY_FAMILIES.filter((f) => famCounts.has(f)).map((f) => (
          <Chip key={f} active={families.includes(f)} count={famCounts.get(f)} color={familyColor(f)} onClick={() => setFamilies((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]))}>
            {familyLabel(f)}
          </Chip>
        ))}
      </div>
      <VirtualList
        className={s.addList}
        count={shown.length}
        rowHeight={34}
        getKey={(i) => `${shown[i].ref.f}/${shown[i].ref.s}/${shown[i].ref.p}`}
        aria-label="Plays that aren't in this situation yet"
        empty={<div className={s.addEmpty}>{candidates.length ? "No plays match." : "Every play in the playbook is already in this situation."}</div>}
        onActivate={(i) => shown[i] && onAdd(shown[i].ref, start)}
        renderRow={(i) => {
          const c = shown[i];
          return (
            <div className={s.addRow}>
              <PlayTypeTag playType={c.ref.play.playType} size="sm" />
              <span className={cx(s.name, "caps")}>{c.ref.play.name}</span>
              <span className={s.where}>
                <span className="caps">{c.ref.formation}</span> · <span className="caps">{c.ref.set}</span>
              </span>
              <Button size="sm" variant="secondary" icon="plus" onClick={() => onAdd(c.ref, start)}>
                Add
              </Button>
            </div>
          );
        }}
      />
    </div>
  );
}

