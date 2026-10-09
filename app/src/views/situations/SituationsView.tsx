// Situations (#/situations[/<playbook path>][?s=<situation>]): for each CPU situation (3rd & short, red zone, two-minute…),
// the plays the CPU and Ask Madden may call there, as play cards with their weights as editable percentages. Show only
// the plays that have a rating or every play in the playbook (add one by giving it a weight); take a play out with ✕.
// Plays that are audibles carry their audible button. Every edit is one undoable change to the playbook file (the same
// `cpu` weights the Playbook tab's inspector edits per play).
import { memo, useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { PlayCard } from "../../field";
import { AudibleGlyph } from "../../input/glyphs";
import { AUDIBLE_CATEGORY } from "../../model/audibles";
import { clampWeight, cpuOf, getSet, setCpuWeight } from "../../model/playbook";
import { bookPlayRefs, situationCounts, type BookPlayRef } from "../../model/concepts";
import { PLAY_FAMILIES, familyColor, familyLabel, playTypeInfo, type PlayFamily } from "../../model/playtypes";
import { SITUATION_GROUPS, SITUATION_LABELS, isSituationKey, type SituationKey } from "../../model/situations";
import type { PlayEntry, PlaybookSpec } from "../../model/types";
import { useCatalog } from "../../state/library";
import { href, navigate, useRoute } from "../../state/router";
import { useSettings } from "../../state/settings";
import { useDoc, useWorkspace } from "../../state/workspace";
import { Button, EmptyState, IconButton, NumberField, Segmented, Spinner, TextInput, cx } from "../../ui";
import { CardColumnsPicker } from "../playbook/CardColumns";
import { LazyMount } from "../playbook/LazyMount";
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
          body="Situations show which plays the CPU may call for each down, distance and field position in a playbook."
          action={<Button onClick={() => navigate("#/playbook")}>Open Playbook</Button>}
        />
      </div>
    );
  const sit = route.query.get("s") ?? "";
  return <Situations key={book.path} path={book.path} spec={book.spec} situation={isSituationKey(sit) ? sit : DEFAULT_SITUATION} />;
}

/** A play of the playbook in this situation: `weight` is undefined when it has no rating there. */
type Row = { ref: BookPlayRef; weight?: number; family: PlayFamily };

function Situations({ path, spec, situation }: { path: string; spec: PlaybookSpec; situation: SituationKey }) {
  const catalog = useCatalog()!;
  const doc = useDoc<PlaybookSpec>(path);
  const rb = useMemo(() => resolvedBook(spec, catalog), [spec, catalog]);
  const refs = useMemo(() => bookPlayRefs(rb), [rb]);
  const counts = useMemo(() => situationCounts(rb), [rb]);
  const cardColumns = useSettings((st) => st.cardColumns);
  const [show, setShow] = useState<"rated" | "all">("rated");
  const [sort, setSort] = useState<"formation" | "weight">("formation");
  const [query, setQuery] = useState("");

  // Undo / redo / Save in the top bar act on this playbook while the view is open.
  useEffect(() => {
    if (!doc || doc.error) return;
    useWorkspace.getState().setActive(path);
    return () => {
      if (useWorkspace.getState().activePath === path) useWorkspace.getState().setActive(undefined);
    };
  }, [path, !!doc && !doc.error]); // eslint-disable-line react-hooks/exhaustive-deps

  const goSituation = useCallback((k: SituationKey) => navigate(`${href("situations", path)}?s=${encodeURIComponent(k)}`, { replace: true }), [path]);

  const all = useMemo<Row[]>(() => refs.map((ref) => ({ ref, weight: cpuOf(ref.entry)[situation], family: playTypeInfo(ref.play.playType).family })), [refs, situation]);
  const rated = useMemo(() => all.filter((r) => r.weight !== undefined), [all]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = all.filter((r) => (show === "all" || r.weight !== undefined) && (!q || `${r.ref.play.name} ${r.ref.formation} ${r.ref.set}`.toLowerCase().includes(q)));
    if (sort === "weight") out = [...out].sort((a, b) => (b.weight ?? -1) - (a.weight ?? -1));
    return out;
  }, [all, show, query, sort]);

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
  const setWeight = useCallback((ref: BookPlayRef, v: number) => edit(`${SITUATION_LABELS[situation]} weight`, ref, (e) => setCpuWeight(e, situation, v), true), [edit, situation]);
  const remove = useCallback((ref: BookPlayRef) => edit(`Remove ${ref.play.name} from ${SITUATION_LABELS[situation]}`, ref, (e) => setCpuWeight(e, situation, undefined)), [edit, situation]);
  const add = useCallback((ref: BookPlayRef) => edit(`Add ${ref.play.name} to ${SITUATION_LABELS[situation]}`, ref, (e) => setCpuWeight(e, situation, START_WEIGHT)), [edit, situation]);

  const total = rated.reduce((n, r) => n + (r.weight ?? 0), 0);
  const audibles = rated.filter((r) => r.ref.entry.audible).length;
  const mix = useMemo(() => {
    const m = new Map<PlayFamily, number>();
    for (const r of rated) m.set(r.family, (m.get(r.family) ?? 0) + (r.weight ?? 0));
    return PLAY_FAMILIES.filter((f) => m.has(f)).map((f) => ({ family: f, weight: m.get(f)! }));
  }, [rated]);

  return (
    <div className={s.page}>
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
              <Segmented<"rated" | "all">
                size="sm"
                value={show}
                onChange={setShow}
                options={[
                  { value: "rated", label: `With Ratings · ${rated.length}`, title: "Only the plays that have a weight in this situation" },
                  { value: "all", label: `All Plays · ${refs.length}`, title: "Every play in the playbook: give one a weight to add it to this situation" },
                ]}
                aria-label="Which plays"
              />
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
              <CardColumnsPicker />
            </div>
          </header>
          <div className={s.stats}>
            <span>
              <b>{rated.length}</b> rated
              {audibles > 0 && (
                <>
                  {" · "}
                  <b>{audibles}</b> audible{audibles === 1 ? "" : "s"}
                </>
              )}
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
            {rb.counts.templateFormations > 0 && <span className={s.note}>Template sections keep the game's own weights.</span>}
            <TextInput size="sm" className={s.filter} value={query} onChange={setQuery} placeholder="Find a play, formation or set" icon="search" clearable aria-label="Find plays" />
          </div>
          <div className={s.list}>
            {rows.length === 0 ? (
              <EmptyState
                compact
                icon="playcall"
                title={query ? "No Plays Match" : "No Plays Rated Here Yet"}
                body={query ? undefined : `The CPU uses the game's defaults for ${SITUATION_LABELS[situation]}. Switch to All Plays and give some a weight to choose what it calls.`}
                action={
                  !query && show === "rated" ? (
                    <Button size="sm" variant="primary" onClick={() => setShow("all")}>
                      Show All Plays
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <CardGrid rows={rows} columns={cardColumns} grouped={sort === "formation"} onWeight={setWeight} onRemove={remove} onAdd={add} />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

// ───────────────────────────── the plays ─────────────────────────────

interface GridProps {
  onWeight(ref: BookPlayRef, v: number): void;
  onRemove(ref: BookPlayRef): void;
  onAdd(ref: BookPlayRef): void;
}

function CardGrid({ rows, columns, grouped, ...handlers }: GridProps & { rows: Row[]; columns: number; grouped: boolean }) {
  const out = [];
  let lastKey = "";
  for (const r of rows) {
    const key = `${r.ref.f}/${r.ref.s}`;
    if (grouped && key !== lastKey) {
      out.push(
        <div key={`h${key}`} className={s.setHead}>
          <span className="caps">{r.ref.formation}</span>
          <span className={s.sep}>›</span>
          <span className="caps">{r.ref.set}</span>
        </div>,
      );
    }
    lastKey = key;
    out.push(<PlayCell key={`${r.ref.f}/${r.ref.s}/${r.ref.p}`} row={r} size={columns === 3 ? "md" : "sm"} {...handlers} />);
  }
  return (
    <div className={s.grid} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {out}
    </div>
  );
}

const PlayCell = memo(function PlayCell({ row, size, onWeight, onRemove, onAdd }: GridProps & { row: Row; size: "sm" | "md" }) {
  const { ref, weight } = row;
  const slot = ref.entry.audible && [1, 2, 3, 4].includes(ref.entry.audible) ? ref.entry.audible : undefined;
  return (
    <div className={cx(s.cell, weight === undefined && s.cellUnrated)}>
      <LazyMount placeholder={<div className={s.placeholder} />}>
        <PlayCard
          play={ref.play}
          size={size}
          autoBadges={false}
          muted={weight === undefined}
          leading={slot ? <AudibleGlyph slot={slot} size="md" /> : undefined}
          stat={slot ? `Audible · ${AUDIBLE_CATEGORY[slot]}` : undefined}
        />
      </LazyMount>
      <div className={s.ctl} style={{ "--w": `${clampWeight(weight ?? 0)}%`, "--c": familyColor(row.family) } as CSSProperties}>
        {weight === undefined ? (
          <Button size="sm" variant="secondary" icon="plus" onClick={() => onAdd(ref)} title={`Rate ${ref.play.name} ${START_WEIGHT}% in this situation`}>
            Add to Situation
          </Button>
        ) : (
          <>
            <NumberField size="sm" value={weight} min={0} max={100} step={1} suffix="%" width={88} onChange={(v) => onWeight(ref, v)} aria-label={`${ref.play.name} weight`} />
            <span className={s.wbar} aria-hidden>
              <span />
            </span>
            <IconButton icon="close" size="sm" title={`Take ${ref.play.name} out of this situation`} aria-label={`Remove ${ref.play.name}`} onClick={() => onRemove(ref)} />
          </>
        )}
      </div>
    </div>
  );
});
