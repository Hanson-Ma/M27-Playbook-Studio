// Step 1 — the Formation → Set → Play tree: expand/collapse, multi-select (shift / ⌘-click), right-click or "⋯" for
// options, drag-and-drop with a drop indicator and auto-scroll, inline "+ Formation" / "+ Set" rows, unresolved entries
// in red, custom formations / sets badged, read-only template sections.
// Keys (only while the tree has focus): arrows move / collapse / expand, Enter opens a row, Delete removes,
// ⌘/Ctrl+C / V / D copy, paste, duplicate, Esc drops a multi-selection.
import { memo, useCallback, useEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { AudibleGlyph } from "../../input/glyphs";
import { AUDIBLE_SLOTS } from "../../model/audibles";
import { playTypeInfo } from "../../model/playtypes";
import { bookFormation } from "../../model/resolveBook";
import { templatePlayProblem } from "../../model/tdb";
import { useSettings } from "../../state/settings";
import { Icon, PersonnelTag, SearchSelect, Tooltip, cx, type SearchOption } from "../../ui";
import { normalOf, personnelOf } from "../../model/sets";
import { CategoryDots, playCategories, useConcepts } from "./categories";
import { tplayIds, tsetId, useBuilder, useDragHandlers, useOpenMenu, type BookNode, type BuilderData } from "./context";
import { beginDrag, type DragPayload } from "./dnd";
import { TEMPLATE_EMPTY_RULES } from "./issues";
import { addFormationByAsset, addSetByAsset, convertTemplate, editorKey, labelOf } from "./ops";
import { BOOK_ID, isExpanded, parentOf, useBuilderUi } from "./store";
import s from "./Tree.module.css";

type TreeRow =
  | { kind: "node"; id: string; node: BookNode; depth: number; expandable: boolean; expanded: boolean; sig?: string }
  | { kind: "add-formation"; id: string }
  | { kind: "add-set"; id: string; f: number }
  | { kind: "note"; id: string; depth: number; text: string; tone?: "warning" | "info" | "danger" };

/** Why a template section copies nothing (the game-side builder stops on it), or undefined. */
export function templateEmptyReason(data: BuilderData, node: BookNode): string | undefined {
  const rf = node.rf;
  if (!rf?.template) return undefined;
  const issue = data.issues.find((i) => i.rule && TEMPLATE_EMPTY_RULES.has(i.rule) && i.where === `/formations/${rf.index}`);
  if (issue) return issue.message;
  if (data.template.status !== "ready" || !rf.formation) return undefined;
  if (!node.tf || node.tf.sets.length === 0)
    return `The template playbook has no ${String(rf.entry.formation)} sets, so this section can't be built. Remove it, or add ${String(rf.entry.formation)} sets yourself.`;
  return undefined;
}

function buildRows(data: BuilderData, expanded: Record<string, boolean>): TreeRow[] {
  const rows: TreeRow[] = [];
  const book = data.nodes.get(BOOK_ID)!;
  rows.push({ kind: "node", id: BOOK_ID, node: book, depth: 0, expandable: false, expanded: true });
  data.book.formations.forEach((rf, f) => {
    const fIds = data.ids.formations[f];
    const fNode = fIds && data.nodes.get(fIds.id);
    if (!fIds || !fNode) return;
    const template = rf.template;
    const fOpen = isExpanded(expanded, fIds.id, template);
    rows.push({ kind: "node", id: fIds.id, node: fNode, depth: 1, expandable: true, expanded: fOpen });
    // A template section with nothing to copy stops the export: say so right here, open or closed.
    const empty = templateEmptyReason(data, fNode);
    if (empty) rows.push({ kind: "note", id: `${fIds.id}/empty`, depth: 2, text: empty, tone: "danger" });
    if (!fOpen) return;
    if (template) {
      const tf = fNode.tf;
      if (!tf) {
        const st = data.template;
        if (st.status !== "ready")
          rows.push({
            kind: "note",
            id: `${fIds.id}/note`,
            depth: 2,
            text: st.status === "error" ? `The template playbook couldn't be read: ${st.error}` : "Loading the template playbook…",
            tone: st.status === "error" ? "warning" : "info",
          });
        return;
      }
      for (const ts of tf.sets) {
        const sid = tsetId(fIds.id, ts);
        const sNode = data.nodes.get(sid);
        if (!sNode) continue;
        const sOpen = isExpanded(expanded, sid);
        rows.push({ kind: "node", id: sid, node: sNode, depth: 2, expandable: ts.plays.length > 0, expanded: sOpen, sig: "t" });
        if (sOpen)
          for (const pid of tplayIds(sid, ts)) {
            const pNode = data.nodes.get(pid);
            if (pNode) rows.push({ kind: "node", id: pid, node: pNode, depth: 3, expandable: false, expanded: false, sig: "t" });
          }
      }
      return;
    }
    rf.sets.forEach((_rs, si) => {
      const sIds = fIds.sets[si];
      const sNode = sIds && data.nodes.get(sIds.id);
      if (!sIds || !sNode) return;
      const sOpen = isExpanded(expanded, sIds.id);
      rows.push({ kind: "node", id: sIds.id, node: sNode, depth: 2, expandable: true, expanded: sOpen, sig: rowSig(data, sNode) });
      if (!sOpen) return;
      sIds.plays.forEach((pid) => {
        const pNode = data.nodes.get(pid);
        if (pNode) rows.push({ kind: "node", id: pid, node: pNode, depth: 3, expandable: false, expanded: false, sig: rowSig(data, pNode) });
      });
      if (!sIds.plays.length) rows.push({ kind: "note", id: `${sIds.id}/empty`, depth: 3, text: "No plays yet — select the set, then tick plays", tone: "info" });
    });
    if (rf.formation && Array.isArray(rf.entry.sets)) rows.push({ kind: "add-set", id: `${fIds.id}/+set`, f });
  });
  // A new book only has template sections: say where to start.
  if (data.book.formations.every((rf) => rf.template))
    rows.push({ kind: "note", id: "+formation/hint", depth: 1, text: "Start here: add a formation (Shotgun, Singleback, Pistol…), then one of its sets.", tone: "info" });
  rows.push({ kind: "add-formation", id: "+formation" });
  return rows;
}

/**
 * What a set/play row shows, so memoized rows skip re-rendering when an edit elsewhere re-resolves the book.
 * Formation and book rows (few, context-dependent) always re-render.
 */
function rowSig(data: BuilderData, n: BookNode): string | undefined {
  if (n.level === "play" && n.rp) {
    const e = n.rp.entry;
    const p = n.rp.play;
    const cpu = e.cpu && typeof e.cpu === "object" ? Object.keys(e.cpu).length : 0;
    return [e.play, e.audible, cpu, p?.key, p?.global, p?.source, p?.playType, n.rp.problem, n.rp.malformed, p?.problems[0]].join("|");
  }
  if (n.level === "set" && n.rs) {
    const rs = n.rs;
    const slots = rs.plays.map((p) => p.entry.audible ?? "").join("");
    return [rs.entry.set, rs.problem, rs.malformed, rs.plays.length, slots, rs.plays.filter((p) => p.problem).length, data.custom.set(rs.set?.asset), rs.set ? personnelOf(normalOf(rs.set)) : ""].join("|");
  }
  return undefined;
}

export function Tree() {
  const data = useBuilder();
  const expanded = useBuilderUi((st) => st.expanded);
  const cursor = useBuilderUi((st) => st.cursor);
  const selected = useBuilderUi((st) => st.selected);
  const rows = useMemo(() => buildRows(data, expanded), [data, expanded]);
  const order = useMemo(() => rows.filter((r) => r.kind === "node").map((r) => r.id), [rows]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const orderRef = useRef(order);
  orderRef.current = order;
  const scroller = useRef<HTMLDivElement>(null);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const dataRef = useRef(data);
  dataRef.current = data;

  // Keep the cursor row visible.
  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(cursor)}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const rowOf = (id: string) => rowsRef.current.find((r) => r.id === id);
  const move = (dir: 1 | -1, extend = false) => {
    const o = orderRef.current;
    const i = o.indexOf(useBuilderUi.getState().cursor);
    const next = o[Math.max(0, Math.min(o.length - 1, (i < 0 ? 0 : i) + dir))];
    if (next) useBuilderUi.getState().select(next, extend ? { range: true, order: o } : undefined);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Only keys aimed at the tree itself (not the "+ Formation" search box, which may be portaled into React's tree).
    const t = e.target as HTMLElement;
    if (!e.currentTarget.contains(t) || t.closest("input, textarea, select, [contenteditable=true]")) return;
    const ui = useBuilderUi.getState();
    const r = rowOf(ui.cursor);
    let handled = true;
    switch (e.key) {
      case "ArrowUp":
        move(-1, e.shiftKey);
        break;
      case "ArrowDown":
        move(1, e.shiftKey);
        break;
      case "ArrowLeft":
        if (r?.kind === "node" && r.expandable && r.expanded) ui.expand(r.id, false);
        else if (ui.cursor !== BOOK_ID) ui.select(parentOf(ui.cursor));
        break;
      case "ArrowRight":
        if (r?.kind === "node" && r.expandable) {
          if (!r.expanded) ui.expand(r.id, true);
          else move(1);
        }
        break;
      case "Home":
        if (orderRef.current[0]) ui.select(orderRef.current[0]);
        break;
      case "End":
        if (orderRef.current.length) ui.select(orderRef.current[orderRef.current.length - 1]);
        break;
      case "Enter":
        if (r?.kind === "node" && r.expandable) ui.expand(r.id, !r.expanded);
        break;
      case "ContextMenu":
      case "F10": {
        // The keyboard's menu key (or Shift+F10): the cursor row's options.
        if (e.key === "F10" && !e.shiftKey) {
          handled = false;
          break;
        }
        const el = scroller.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(ui.cursor)}"]`);
        const rect = el?.getBoundingClientRect();
        if (r?.kind === "node" && rect) onMenu(r.node, { x: rect.left + Math.min(rect.width, 220), y: rect.bottom }, r.expanded);
        break;
      }
      default:
        handled = editorKey(dataRef.current, e);
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const openMenu = useOpenMenu();
  const drag = useDragHandlers();

  const onRowClick = useCallback((id: string, e: MouseEvent) => {
    useBuilderUi.getState().select(id, { additive: e.metaKey || e.ctrlKey, range: e.shiftKey, order: orderRef.current });
  }, []);
  const onToggle = useCallback((id: string, on: boolean) => useBuilderUi.getState().expand(id, on), []);
  const onMenu = useCallback(
    (node: BookNode, at: { x: number; y: number }, expanded: boolean) => {
      const ui = useBuilderUi.getState();
      if (!ui.selected.includes(node.id)) ui.select(node.id);
      openMenu(node, at, expanded);
    },
    [openMenu],
  );
  const onPointerDown = useCallback(
    (node: BookNode, e: PointerEvent) => {
      if (!["formation", "set", "play"].includes(node.level) || (e.target as Element).closest("button, input, [role=button]")) return;
      beginDrag(
        e,
        (): DragPayload | undefined => {
          const ui = useBuilderUi.getState();
          let ids = ui.selected.includes(node.id) ? ui.selected : [node.id];
          if (!ui.selected.includes(node.id)) ui.select(node.id);
          const d = dataRef.current;
          const nodes = ids.map((id) => d.nodes.get(id)).filter((n): n is BookNode => !!n && n.level === node.level);
          ids = nodes.map((n) => n.id);
          if (!nodes.length) return undefined;
          const kind = node.level === "formation" ? "formations" : node.level === "set" ? "sets" : "plays";
          // A multi-selection of plays/sets only drags within one parent.
          const parent = parentOf(node.id);
          const same = nodes.filter((n) => parentOf(n.id) === parent);
          return {
            kind,
            refs: same.map((n) => n.ref!),
            keys: kind === "plays" ? same.map((n) => n.rp?.play?.key).filter((k): k is string => !!k) : undefined,
            label: same.length === 1 ? labelOf(same[0]) : `${same.length} ${node.level}s`,
            count: same.length,
          };
        },
        drag,
      );
    },
    [drag],
  );

  return (
    <div
      ref={scroller}
      className={s.tree}
      data-autoscroll
      role="tree"
      aria-label="Formations, sets and plays"
      aria-multiselectable
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      {rows.map((r) => {
        if (r.kind === "node")
          return (
            <NodeRow
              key={r.id}
              row={r}
              selected={selectedSet.has(r.id)}
              isCursor={r.id === cursor}
              onClick={onRowClick}
              onToggle={onToggle}
              onMenu={onMenu}
              onPointerDown={onPointerDown}
            />
          );
        if (r.kind === "note")
          return (
            <div
              key={r.id}
              className={cx(s.note, r.tone === "warning" && s.noteWarn, r.tone === "danger" && s.noteDanger)}
              style={r.tone === "danger" ? { marginLeft: indent(r.depth) - 8 } : { paddingLeft: indent(r.depth) }}
              role={r.tone === "danger" ? "alert" : undefined}
            >
              {r.tone === "danger" && <Icon name="warning" size={13} className={s.noteIcon} />}
              <span>{r.text}</span>
            </div>
          );
        if (r.kind === "add-set") return <AddSetRow key={r.id} f={r.f} />;
        return <AddFormationRow key={r.id} />;
      })}
    </div>
  );
}

const indent = (depth: number) => 8 + depth * 16;

interface NodeRowProps {
  row: Extract<TreeRow, { kind: "node" }>;
  selected: boolean;
  isCursor: boolean;
  onClick(id: string, e: MouseEvent): void;
  onToggle(id: string, on: boolean): void;
  onMenu(node: BookNode, at: { x: number; y: number }, expanded: boolean): void;
  onPointerDown(node: BookNode, e: PointerEvent): void;
}

const sameRow = (a: NodeRowProps, b: NodeRowProps) =>
  a.selected === b.selected &&
  a.isCursor === b.isCursor &&
  a.onClick === b.onClick &&
  a.onToggle === b.onToggle &&
  a.onMenu === b.onMenu &&
  a.onPointerDown === b.onPointerDown &&
  (a.row === b.row ||
    (a.row.sig !== undefined &&
      a.row.sig === b.row.sig &&
      a.row.id === b.row.id &&
      a.row.depth === b.row.depth &&
      a.row.expanded === b.row.expanded &&
      a.row.expandable === b.row.expandable));

const NodeRow = memo(function NodeRow({ row, selected, isCursor, onClick, onToggle, onMenu, onPointerDown }: NodeRowProps) {
  const { node, depth, expandable, expanded } = row;
  const level = node.level;
  const dropZone = level === "formation" ? "tree-formation" : level === "set" ? "tree-set" : level === "play" ? "tree-play" : undefined;
  const problem = level === "formation" ? node.rf?.problem : level === "set" ? node.rs?.problem : level === "play" ? node.rp?.problem : undefined;
  const readOnly = level === "tset" || level === "tplay";
  return (
    <div
      className={cx(s.row, s[level], selected && s.selected, isCursor && s.cursor, !!problem && s.bad, readOnly && s.readOnly)}
      style={{ paddingLeft: indent(depth) }}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={expandable ? expanded : undefined}
      data-node-id={node.id}
      data-drop={dropZone}
      data-drop-id={dropZone ? node.id : undefined}
      onClick={(e) => onClick(node.id, e)}
      onDoubleClick={() => expandable && onToggle(node.id, !expanded)}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(node, { x: e.clientX, y: e.clientY }, expanded);
      }}
      onPointerDown={(e) => onPointerDown(node, e)}
    >
      {expandable ? (
        <button
          type="button"
          className={s.chevron}
          tabIndex={-1}
          aria-label={expanded ? "Collapse" : "Expand"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(node.id, !expanded);
          }}
        >
          <Icon name={expanded ? "chevronDown" : "chevronRight"} size={14} />
        </button>
      ) : (
        <span className={s.chevronSpace} />
      )}
      <RowBody node={node} />
      <button
        type="button"
        className={s.more}
        tabIndex={-1}
        title="Options"
        aria-label={`Options for ${labelOf(node)}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          onMenu(node, { x: r.left, y: r.bottom + 2 }, expanded);
        }}
      >
        <span aria-hidden>⋯</span>
      </button>
    </div>
  );
}, sameRow);

function RowBody({ node }: { node: BookNode }) {
  switch (node.level) {
    case "book":
      return <BookRow />;
    case "formation":
      return <FormationRow node={node} />;
    case "set":
      return <SetRow node={node} />;
    case "play":
      return <PlayRow node={node} />;
    case "tset":
      return (
        <span className={s.main}>
          <span className={s.name}>{node.ts!.set.name}</span>
          <span className={s.meta}>{node.ts!.plays.length}</span>
        </span>
      );
    case "tplay": {
      const tp = node.tp!;
      const info = playTypeInfo(tp.play.offensePlayType);
      return (
        <span className={s.main}>
          <span className={s.family} style={{ background: info.color }} />
          <span className={s.name}>{tp.play.name}</span>
          <TemplatePlayDots asset={tp.play.asset} />
          <TemplatePlayFlag node={node} />
          <span className={s.meta}>
            {tp.cpu && <span className={s.cpu}>{Object.keys(tp.cpu).length}</span>}
            {tp.audible && <AudibleGlyph slot={tp.audible} size="sm" />}
          </span>
        </span>
      );
    }
  }
}

/** Template plays that "Convert to editable" would leave out, with the reason (foreign set or a name clash). */
function TemplatePlayFlag({ node }: { node: BookNode }) {
  const data = useBuilder();
  const why = node.ts && node.tp ? templatePlayProblem(node.ts, node.tp, data.catalog, data.side, { template: data.template.contents }) : undefined;
  if (!why) return null;
  return (
    <Tooltip content={`Converting leaves this play out: ${why}. As a template section it's copied anyway.`}>
      <Icon name="info" size={13} className={s.warnIcon} />
    </Tooltip>
  );
}

function TemplatePlayDots({ asset }: { asset: string }) {
  return <CategoryDots cats={playCategories(useConcepts(), asset)} max={2} />;
}

function BookRow() {
  const data = useBuilder();
  const c = data.book.counts;
  const formations = c.formations + c.templateFormations;
  return (
    <span className={s.main}>
      <Icon name="tree" size={15} className={s.bookIcon} />
      <span className={s.name}>{String(data.spec.name || "Untitled")}</span>
      <span className={s.meta} title={`${formations} formations · ${c.sets} sets · ${c.plays} plays`}>
        {c.plays} <span className={s.metaWord}>plays</span>
      </span>
    </span>
  );
}

function FormationRow({ node }: { node: BookNode }) {
  const data = useBuilder();
  const rf = node.rf!;
  const tf = node.tf;
  const tplKnown = !!tf || data.template.status === "ready";
  const plays = rf.template ? (tplKnown ? (tf?.sets.reduce((n, x) => n + x.plays.length, 0) ?? 0) : undefined) : rf.sets.reduce((n, x) => n + x.plays.length, 0);
  const sets = rf.template ? (tplKnown ? (tf?.sets.length ?? 0) : undefined) : rf.sets.length;
  const custom = data.custom.formation(rf.formation?.asset);
  // A template section with nothing to copy explains itself in the note under the row.
  const problem = rf.malformed ?? (templateEmptyReason(data, node) ? undefined : rf.problem);
  return (
    <span className={s.main}>
      <span className={s.nameCol}>
        <span className={s.name}>{String(rf.entry.formation)}</span>
        {problem && <span className={s.problem}>{problem}</span>}
        {/* Under the name, not beside it: long names ("GOAL LINE OFFENSE") keep the row's width. */}
        {rf.template && (
          <span className={s.tplLine} title="Copied as-is from the template save (convert it to edit its sets)">
            <Icon name="lock" size={10} />
           From Template
          </span>
        )}
      </span>
      {custom && (
        <span className={s.customTag} title="Custom formation (built by Playbook Studio)">
          Custom
        </span>
      )}
      <span className={s.meta}>
        <span title={sets !== undefined ? `${sets} sets · ${plays} plays` : undefined}>{sets !== undefined ? `${sets}S · ${plays}P` : "…"}</span>
      </span>
      {rf.template && tf && tf.sets.length > 0 && (
        <button
          type="button"
          className={s.rowBtn}
          title="Convert to editable sets"
          onClick={(e) => {
            e.stopPropagation();
            void convertTemplate(data, rf.index);
          }}
        >
          <Icon name="unlock" size={13} />
        </button>
      )}
    </span>
  );
}

function SetRow({ node }: { node: BookNode }) {
  const data = useBuilder();
  const rs = node.rs!;
  const used = new Set(rs.plays.map((p) => p.entry.audible));
  const bad = rs.plays.filter((p) => p.problem).length;
  const custom = data.custom.set(rs.set?.asset);
  return (
    <span className={s.main}>
      <span className={s.nameCol}>
        <span className={s.name}>{String(rs.entry.set)}</span>
        {(rs.malformed ?? rs.problem) && <span className={s.problem}>{rs.malformed ?? rs.problem}</span>}
      </span>
      <PersonnelTag code={rs.set ? personnelOf(normalOf(rs.set)) : undefined} bare />
      {custom && (
        <span className={s.customTag} title="Custom set (built by Playbook Studio)">
          Custom
        </span>
      )}
      <span className={s.meta}>
        <span className={s.audDots} title={`${used.size - (used.has(undefined) ? 1 : 0)} of 4 audibles set`}>
          {AUDIBLE_SLOTS.map((sl) => (
            <span key={sl} className={cx(s.audDot, used.has(sl) && s.audOn)} />
          ))}
        </span>
        {bad > 0 && (
          <span className={s.badCount} title={`${bad} play${bad === 1 ? "" : "s"} can't be found`}>
            {bad}
          </span>
        )}
        <span title={`${rs.plays.length} plays`}>{rs.plays.length}</span>
      </span>
    </span>
  );
}

function PlayRow({ node }: { node: BookNode }) {
  const rp = node.rp!;
  const play = rp.play;
  const cats = playCategories(useConcepts(), play?.key);
  const info = play ? playTypeInfo(play.playType) : undefined;
  const cpu = rp.entry.cpu && typeof rp.entry.cpu === "object" ? Object.keys(rp.entry.cpu).length : 0;
  return (
    <span className={s.main}>
      <span className={s.family} style={{ background: info?.color ?? "var(--danger)" }} title={info?.long} />
      <span className={s.nameCol}>
        <span className={s.name}>{String(rp.entry.play)}</span>
        {(rp.malformed ?? rp.problem) && <span className={s.problem}>{rp.malformed ?? rp.problem}</span>}
        {!rp.problem && play?.problems.length ? <span className={s.problem}>{play.problems[0]}</span> : null}
      </span>
      <CategoryDots cats={cats} max={2} />
      {play?.source === "custom" ? (
        <span className={cx(s.mini, s.miniCustom)} title="Custom play (needs the Playbook Studio mod)">
          C
        </span>
      ) : play && !play.global ? (
        <span className={cx(s.mini, s.miniMod)} title="Needs the Playbook Studio mod (not in the game's global play list)">
          M
        </span>
      ) : null}
      <span className={s.meta}>
        {cpu > 0 && (
          <span className={s.cpu} title={`${cpu} CPU weight${cpu === 1 ? "" : "s"}`}>
            {cpu}
          </span>
        )}
        {rp.entry.audible && [1, 2, 3, 4].includes(rp.entry.audible) && <AudibleGlyph slot={rp.entry.audible} size="sm" />}
      </span>
    </span>
  );
}

// ───────────────────────────── inline add rows ─────────────────────────────

const OFFENSE_TYPES = new Set(["FormationType_Offense", "FormationType_Kickoff", "FormationType_SafetyKickoff"]);
const DEFENSE_TYPES = new Set(["FormationType_Defense", "FormationType_KickReturn", "FormationType_Safety_KickReturn"]);

/** The "+ Formation" / "+ Set" trigger text (a dashed pill button, not a faint placeholder). */
function AddLabel({ text }: { text: string }) {
  return (
    <span className={s.addLabel}>
      <Icon name="plus" size={13} />
      {text}
    </span>
  );
}

function AddFormationRow() {
  const data = useBuilder();
  const hideMinigames = useSettings((st) => st.hideMinigames);
  const present = useMemo(() => new Set(data.book.formations.map((rf) => rf.formation?.asset).filter(Boolean)), [data.book]);
  const options = useMemo<SearchOption[]>(() => {
    const lib = data.lib;
    return lib.data.formations
      .filter((f) => {
        const side = lib.formationSide(f);
        const ok = side === data.side || (side === "special" && (data.side === "offense" ? OFFENSE_TYPES : DEFENSE_TYPES).has(f.type));
        return ok && !(hideMinigames && lib.isMinigame(f));
      })
      .map((f) => {
        const addressable = bookFormation(lib, f.name, data.side, { template: data.template.contents })?.asset === f.asset;
        const sets = lib.setsByFormation.get(f.asset)?.length ?? 0;
        const custom = data.custom.formation(f.asset);
        return {
          value: f.asset,
          label: f.name,
          hint: !addressable ? "name taken by another formation" : present.has(f.asset) ? "in this playbook" : `${custom ? "custom · " : ""}${sets} sets`,
          group: custom ? "custom formations" : lib.formationSide(f) === "special" ? "special teams" : data.side,
          disabled: !addressable || present.has(f.asset),
        };
      })
      .sort((a, b) => Number(!!a.disabled) - Number(!!b.disabled) || Number(b.group === "custom formations") - Number(a.group === "custom formations") || a.label.localeCompare(b.label));
  }, [data.lib, data.side, data.custom, data.template.contents, hideMinigames, present]);
  return (
    <div className={s.addRow} style={{ paddingLeft: indent(1) }}>
      <SearchSelect
        value={undefined}
        onChange={(asset) => addFormationByAsset(data, asset)}
        options={options}
        renderValue={() => <AddLabel text="Formation" />}
        searchPlaceholder="Search formations…"
        caps="options"
        size="sm"
        className={s.addSelect}
        menuWidth={320}
        aria-label="Add a formation"
      />
    </div>
  );
}

function AddSetRow({ f }: { f: number }) {
  const data = useBuilder();
  const rf = data.book.formations[f];
  const formation = rf?.formation;
  const present = useMemo(() => new Set(rf?.sets.map((rs) => rs.set?.asset).filter(Boolean)), [rf]);
  const options = useMemo<SearchOption[]>(() => {
    if (!formation) return [];
    const lib = data.lib;
    return (lib.setsByFormation.get(formation.asset) ?? []).map((set) => {
      const addressable = lib.setByName(formation, set.name)?.asset === set.asset;
      const n = data.catalog.playsInSet(set.asset).length;
      const custom = data.custom.set(set.asset);
      return {
        value: set.asset,
        label: set.name,
        hint: !addressable ? "name taken by another set" : present.has(set.asset) ? "in this playbook" : `${custom ? "custom set · " : ""}${n} plays`,
        disabled: !addressable || present.has(set.asset),
      };
    });
  }, [data.lib, data.catalog, data.custom, formation, present]);
  if (!formation) return null;
  return (
    <div className={s.addRow} style={{ paddingLeft: indent(2) }}>
      <SearchSelect
        value={undefined}
        onChange={(asset) => addSetByAsset(data, f, asset)}
        options={options}
        renderValue={() => <AddLabel text="Set" />}
        searchPlaceholder={`Search ${formation.name} sets…`}
        caps="options"
        size="sm"
        className={s.addSelect}
        menuWidth={300}
        aria-label={`Add a ${formation.name} set`}
      />
    </div>
  );
}

