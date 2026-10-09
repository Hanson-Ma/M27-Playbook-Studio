// The middle pane for a set: its plays in playbook order as play cards (drag to reorder; right-click or "⋯" for options) and
// the list of every play available in the set (tick to add / untick to remove). Audibles live in the Inspector.
import { memo, useCallback, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { AudibleGlyph } from "../../input/glyphs";
import { formationShort } from "../../model/names";
import { nameAddressProblem } from "../../model/playbookOps";
import { PLAY_FAMILIES, familyColor, familyLabel, playTypeInfo, type PlayFamily } from "../../model/playtypes";
import { getSet, togglePlay } from "../../model/playbook";
import type { AudibleSlot, ConceptCategory, ResolvedPlay } from "../../model/types";
import { PlayCard } from "../../field";
import { navigate } from "../../state/router";
import { useSettings } from "../../state/settings";
import { Button, Checkbox, Chip, EmptyState, Icon, PersonnelTag, Tag, TextInput, Toggle, VirtualList, cx } from "../../ui";
import { normalOf, personnelOf } from "../../model/sets";
import { CategoryChips, CategoryDots, playCategories, useCategoryFilter, useConcepts } from "./categories";
import { useBuilder, useDragHandlers, useOpenMenu, type BookNode } from "./context";
import { CardColumnsPicker } from "./CardColumns";
import { beginDrag } from "./dnd";
import { editPlay } from "./editPlay";
import { LazyMount } from "./LazyMount";
import { editorKey, labelOf } from "./ops";
import { parentOf, useBuilderUi } from "./store";
import s from "./SetPanel.module.css";

export function SetPanel({ setNode }: { setNode: BookNode }) {
  const data = useBuilder();
  const rs = setNode.rs!;
  const rf = setNode.rf!;
  const audibles = rs.plays.filter((p) => p.entry.audible).length;
  const custom = data.custom.set(rs.set?.asset);
  const editHref = data.custom.editHref(rs.set?.asset);
  return (
    <div className={s.panel}>
      <header className={s.head}>
        <div className={s.titles}>
          <div className={s.titleLine}>
            <button
              type="button"
              className={s.back}
              title={`Back to ${String(rf.entry.formation)}`}
              aria-label={`Back to the ${String(rf.entry.formation)} formation`}
              onClick={() => useBuilderUi.getState().select(parentOf(setNode.id))}
            >
              <Icon name="chevronLeft" size={16} />
              <span>{formationShort(String(rf.formation?.name ?? rf.entry.formation))}</span>
            </button>
            <h2 className={s.title}>
              <span className={cx("caps", s.titleName)}>{String(rs.entry.set)}</span>
            </h2>
          </div>
          <div className={s.sub}>
            <span>
              <span className="caps">{String(rf.entry.formation)}</span> · {rs.plays.length} play{rs.plays.length === 1 ? "" : "s"} · {audibles}/4 audibles
            </span>
            {custom && <span className={s.customTag}>Custom Set</span>}
            <PersonnelTag code={rs.set ? personnelOf(normalOf(rs.set)) : undefined} spell />
          </div>
          {(rs.malformed ?? rs.problem) && <div className={s.problem}>{rs.malformed ?? rs.problem}</div>}
        </div>
        <div className={s.headActions}>
          <CardColumnsPicker className={s.colPicker} />
          {editHref && (
            <Button size="sm" icon="field" onClick={() => navigate(editHref)} title="Change player spots and motions in the Formations editor">
              Edit Set
            </Button>
          )}
          <Button size="sm" variant="primary" icon="plus" onClick={() => useBuilderUi.getState().setDrawer(true)}>
           Add Plays
          </Button>
        </div>
      </header>
      <div className={s.body}>
        <CardsGrid setNode={setNode} />
        <aside className={s.aside}>
          <ToggleList setNode={setNode} />
        </aside>
      </div>
    </div>
  );
}

// ───────────────────────────── cards ─────────────────────────────

function CardsGrid({ setNode }: { setNode: BookNode }) {
  const data = useBuilder();
  const ref = setNode.ref!;
  const sIds = data.ids.formations[ref.f]?.sets[ref.s!];
  const playIds = useMemo(() => sIds?.plays ?? [], [sIds]);
  const cursor = useBuilderUi((st) => st.cursor);
  const selected = useBuilderUi((st) => st.selected);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const grid = useRef<HTMLDivElement>(null);
  const idsRef = useRef(playIds);
  idsRef.current = playIds;
  const concepts = useConcepts();
  const dataRef = useRef(data);
  dataRef.current = data;
  const cardColumns = useSettings((st) => st.cardColumns);

  const columns = () => {
    const g = grid.current;
    if (!g) return 1;
    return Math.max(1, getComputedStyle(g).gridTemplateColumns.split(" ").filter(Boolean).length);
  };
  // Arrow keys move between cards while the grid has focus; the editor keys (Delete, ⌘C/V/D, Esc) act on the selection.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (!e.currentTarget.contains(t) || t.closest("input, textarea, select, [contenteditable=true]")) return;
    const ids = idsRef.current;
    const ui = useBuilderUi.getState();
    const i = ids.indexOf(ui.cursor);
    const step = (n: number) => {
      if (!ids.length) return;
      const j = i < 0 ? 0 : i + n;
      if (j >= 0 && j < ids.length) {
        ui.select(ids[j], e.shiftKey ? { range: true, order: ids } : undefined);
        grid.current?.querySelector(`[data-card-id="${CSS.escape(ids[j])}"]`)?.scrollIntoView({ block: "nearest" });
      }
    };
    let handled = true;
    if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "ArrowRight") step(1);
    else if (e.key === "ArrowUp") step(-columns());
    else if (e.key === "ArrowDown") step(columns());
    else handled = editorKey(dataRef.current, e);
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const openMenu = useOpenMenu();
  const drag = useDragHandlers();

  const onClick = useCallback((id: string, e: MouseEvent) => {
    useBuilderUi.getState().select(id, { additive: e.metaKey || e.ctrlKey, range: e.shiftKey, order: idsRef.current });
  }, []);
  const onEdit = useCallback((node: BookNode) => editPlay(dataRef.current, node), []);
  const onMenu = useCallback(
    (node: BookNode, at: { x: number; y: number }) => {
      const ui = useBuilderUi.getState();
      if (!ui.selected.includes(node.id)) ui.select(node.id);
      openMenu(node, at);
    },
    [openMenu],
  );
  const onPointerDown = useCallback(
    (node: BookNode, e: PointerEvent) => {
      if ((e.target as Element).closest("button")) return;
      beginDrag(
        e,
        () => {
          const ui = useBuilderUi.getState();
          if (!ui.selected.includes(node.id)) ui.select(node.id);
          const d = dataRef.current;
          const ids = useBuilderUi.getState().selected.filter((id) => parentOf(id) === parentOf(node.id));
          const nodes = ids.map((id) => d.nodes.get(id)).filter((n): n is BookNode => !!n?.ref);
          return {
            kind: "plays",
            refs: nodes.map((n) => n.ref!),
            keys: nodes.map((n) => n.rp?.play?.key).filter((k): k is string => !!k),
            label: nodes.length === 1 ? labelOf(nodes[0]) : `${nodes.length} plays`,
            count: nodes.length,
          };
        },
        drag,
      );
    },
    [drag],
  );

  return (
    <div className={s.cardsScroll} data-autoscroll>
      <div className={s.sectionTitle}>
        <span className={s.sectionHint} title="Drag cards to reorder · double-click a card to edit the play · shift / ⌘-click to select several · right-click (or ⋯) for options">
          Drag to reorder · double-click to edit · right-click for options
        </span>
      </div>
      {playIds.length === 0 ? (
        <div className={s.emptyWrap} data-drop="set-grid" data-drop-id={setNode.id}>
          <EmptyState
            compact
            icon="playcall"
            title="No Plays in This Set Yet"
            body="Tick plays in the list on the right, or search the whole library with Add Plays."
            action={
              <Button size="sm" icon="plus" onClick={() => useBuilderUi.getState().setDrawer(true)}>
               Add Plays
              </Button>
            }
          />
        </div>
      ) : (
        <div ref={grid} className={s.grid} style={{ gridTemplateColumns: `repeat(${cardColumns}, minmax(0, 1fr))` }} data-drop="set-grid" data-drop-id={setNode.id} tabIndex={0} onKeyDown={onKeyDown} aria-label="Plays in this set, in order">
          {playIds.map((id) => {
            const node = data.nodes.get(id);
            if (!node) return null;
            return (
              <CardCell
                key={id}
                node={node}
                size={cardColumns === 3 ? "md" : "sm"}
                selected={selectedSet.has(id)}
                isCursor={cursor === id}
                cats={playCategories(concepts, node.rp?.play?.key)}
                onClick={onClick}
                onEdit={onEdit}
                onMenu={onMenu}
                onPointerDown={onPointerDown}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

interface CardCellProps {
  node: BookNode;
  size: "sm" | "md";
  selected: boolean;
  isCursor: boolean;
  /** Concept categories of the play (color dots on the card). */
  cats: ConceptCategory[];
  onClick(id: string, e: MouseEvent): void;
  onEdit(node: BookNode): void;
  onMenu(node: BookNode, at: { x: number; y: number }): void;
  onPointerDown(node: BookNode, e: PointerEvent): void;
}

function cardSig(n: BookNode): string {
  const e = n.rp!.entry;
  const cpu = e.cpu && typeof e.cpu === "object" ? Object.keys(e.cpu).length : 0;
  return [n.id, e.play, e.audible, cpu, n.rp!.play?.key, n.rp!.problem].join("|");
}

const sameCell = (a: CardCellProps, b: CardCellProps) =>
  a.size === b.size &&
  a.selected === b.selected &&
  a.isCursor === b.isCursor &&
  a.cats.map((c) => c.id + c.color).join() === b.cats.map((c) => c.id + c.color).join() &&
  a.onClick === b.onClick &&
  a.onEdit === b.onEdit &&
  a.onMenu === b.onMenu &&
  a.onPointerDown === b.onPointerDown &&
  (a.node === b.node || cardSig(a.node) === cardSig(b.node));

const CardCell = memo(function CardCell({ node, size, selected, isCursor, cats, onClick, onEdit, onMenu, onPointerDown }: CardCellProps) {
  const rp = node.rp!;
  const play = rp.play;
  const cpu = rp.entry.cpu && typeof rp.entry.cpu === "object" ? Object.keys(rp.entry.cpu).length : 0;
  const slot = rp.entry.audible;
  return (
    <div
      className={cx(s.cell, selected && s.cellSelected, isCursor && s.cellCursor)}
      data-card-id={node.id}
      data-node-id={node.id}
      data-drop="card"
      data-drop-id={node.id}
      onPointerDown={(e) => onPointerDown(node, e)}
      onDoubleClick={(e) => {
        if ((e.target as Element).closest("button")) return;
        onEdit(node);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(node, { x: e.clientX, y: e.clientY });
      }}
    >
      <LazyMount placeholder={<div className={s.cardPlaceholder} />}>
        {play ? (
          <PlayCard
            play={play}
            size={size}
            autoBadges={false}
            selected={selected}
            leading={slot && [1, 2, 3, 4].includes(slot) ? <AudibleGlyph slot={slot} size="md" /> : undefined}
            stat={cpu ? `CPU ${cpu}` : undefined}
            badges={cats.length ? <CategoryDots cats={cats} className={s.cardDots} /> : undefined}
            onClick={(e) => onClick(node.id, e)}
          />
        ) : (
          <div className={cx(s.broken, selected && s.brokenSelected)} onClick={(e) => onClick(node.id, e)} role="button" tabIndex={-1}>
            <Icon name="warning" size={18} />
            <div className={s.brokenName}>{String(rp.entry.play)}</div>
            <div className={s.brokenWhy}>{rp.malformed ?? rp.problem}</div>
          </div>
        )}
      </LazyMount>
      <button
        type="button"
        className={s.cardMore}
        title="Options"
        aria-label={`Options for ${String(rp.entry.play)}`}
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          onMenu(node, { x: r.left, y: r.bottom + 2 });
        }}
      >
        <span aria-hidden>⋯</span>
      </button>
    </div>
  );
}, sameCell);

// ───────────────────────────── toggle list ─────────────────────────────

interface ToggleRow {
  play: ResolvedPlay;
  family: PlayFamily;
  inBook: boolean;
  audible?: AudibleSlot;
  problem?: string;
}

function ToggleList({ setNode }: { setNode: BookNode }) {
  const data = useBuilder();
  const rs = setNode.rs!;
  const ref = setNode.ref!;
  const set = rs.set;
  const [query, setQuery] = useState("");
  const [families, setFamilies] = useState<PlayFamily[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [onlyIn, setOnlyIn] = useState(false);
  const [focus, setFocus] = useState(-1);
  const concepts = useConcepts();

  const available = useMemo(() => (set ? data.catalog.playsInSet(set.asset) : []), [data.catalog, set]);
  const order = useMemo(() => available.map((p) => p.name), [available]);
  const inBook = useMemo(() => {
    const m = new Map<string, AudibleSlot | 0>();
    for (const rp of rs.plays) if (rp.play) m.set(rp.play.key, rp.entry.audible ?? 0);
    return m;
  }, [rs]);
  const all = useMemo<ToggleRow[]>(
    () =>
      available.map((play) => ({
        play,
        family: playTypeInfo(play.playType).family,
        inBook: inBook.has(play.key),
        audible: inBook.get(play.key) || undefined,
        problem: nameAddressProblem(data.catalog, play.key, data.side, { template: data.template.contents }),
      })),
    [available, inBook, data.catalog, data.side],
  );
  const famCounts = useMemo(() => {
    const m = new Map<PlayFamily, number>();
    for (const r of all) m.set(r.family, (m.get(r.family) ?? 0) + 1);
    return m;
  }, [all]);
  const keys = useMemo(() => available.map((p) => p.key), [available]);
  const catFilter = useCategoryFilter(concepts, keys, cats);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter(
      (r) =>
        (!onlyIn || r.inBook) &&
        (!families.length || families.includes(r.family)) &&
        catFilter.test(r.play.key) &&
        (!q || r.play.name.toLowerCase().includes(q)),
    );
  }, [all, query, families, onlyIn, catFilter]);
  const included = all.filter((r) => r.inBook).length;

  const toggle = useCallback(
    (r: ToggleRow) => {
      if (r.problem && !r.inBook) return;
      data.edit(r.inBook ? `Remove ${r.play.name}` : `Add ${r.play.name}`, (d) => {
        const se = getSet(d, ref.f, ref.s!);
        if (!se) return;
        // Remove the entries that resolve to this play (by name, like the game-side builder); add in library order.
        if (r.inBook) togglePlay(se, r.play.name, false);
        else togglePlay(se, r.play.name, true, order);
      });
    },
    [data, ref.f, ref.s, order],
  );

  if (!set)
    return (
      <section className={s.toggleWrap}>
        <div className={s.sectionTitle}>Plays in This Set</div>
        <div className={s.toggleEmpty}>This set can't be found, so its plays can't be listed. Check the set name, or remove it.</div>
      </section>
    );

  return (
    <section className={s.toggleWrap}>
      <div className={s.sectionTitle}>
        All Plays in This Set
        <span className={s.sectionHint}>
          {included} of {available.length} added
        </span>
      </div>
      <div className={s.filters}>
        <TextInput size="sm" value={query} onChange={setQuery} placeholder="Filter by name" icon="search" clearable aria-label="Filter plays" />
        <div className={s.chips}>
          {PLAY_FAMILIES.filter((f) => famCounts.has(f)).map((f) => (
            <Chip
              key={f}
              active={families.includes(f)}
              count={famCounts.get(f)}
              color={familyColor(f)}
              onClick={() => setFamilies((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]))}
            >
              {familyLabel(f)}
            </Chip>
          ))}
        </div>
        <CategoryChips filter={catFilter} active={cats} onChange={setCats} className={s.catChips} />
        <Toggle size="sm" checked={onlyIn} onChange={setOnlyIn} label="Only Show Added Plays" />
      </div>
      <VirtualList
        className={s.toggleList}
        count={rows.length}
        rowHeight={30}
        selectedIndex={Math.min(focus, rows.length - 1)}
        onSelect={setFocus}
        onActivate={(i) => rows[i] && toggle(rows[i])}
        getKey={(i) => rows[i].play.key}
        padEnd={8}
        aria-label="Plays available in this set"
        empty={<div className={s.toggleEmpty}>No plays match.</div>}
        renderRow={(i) => {
          const r = rows[i];
          const disabled = !!r.problem && !r.inBook;
          return (
            <div
              className={cx(s.toggleRow, r.inBook && s.toggleIn, disabled && s.toggleDisabled)}
              title={r.problem ?? (r.inBook ? `Remove ${r.play.name} from this set` : `Add ${r.play.name} to this set`)}
              onClick={() => {
                setFocus(i);
                toggle(r);
              }}
            >
              <Checkbox checked={r.inBook} disabled={disabled} onChange={() => undefined} className={s.toggleCheck} />
              <span className={s.family} style={{ background: playTypeInfo(r.play.playType).color }} />
              <span className={s.toggleName}>{r.play.name}</span>
              <CategoryDots cats={playCategories(concepts, r.play.key)} max={2} />
              {r.play.source === "custom" ? (
                <Tag size="sm" tone="custom">
                  Custom
                </Tag>
              ) : null}
              {r.audible && <AudibleGlyph slot={r.audible} size="sm" />}
              {disabled && <Icon name="warning" size={13} className={s.warn} />}
            </div>
          );
        }}
      />
    </section>
  );
}
