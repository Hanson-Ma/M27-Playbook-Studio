// Tagging workspace: pick a scope (playbook / custom plays / formation › set / search / tagged), list plays as rows
// (art thumbnail, name, set, tags as colored chips, suggestions column), tag the focused play or every checked row
// from the inspector, accept / dismiss suggestions with their reasons, and keep per-play notes.
import {
  memo,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { PlayCard } from "../../field";
import { useActions } from "../../input/actions";
import { designerEditHref, isSetClone } from "../library/playActions";
import type { Catalog } from "../../model/catalog";
import {
  CATEGORY_GROUPS,
  GROUP_LABEL,
  acceptSuggestions,
  conceptIndex,
  dismissSuggestion,
  dismissedCount,
  groupOf as categoryGroup,
  matchesCategories,
  noteOf,
  restoreDismissed,
  setNote,
  tagState,
  tagsOfPlay,
  toggleTag,
  toggleTagOnPlays,
  type ConceptIndex,
  type Suggestion,
} from "../../model/concepts";
import { isMinigame } from "../../model/library";
import type { ConceptsDoc, PlayKey, ResolvedPlay } from "../../model/types";
import { href, navigate } from "../../state/router";
import { useSettings } from "../../state/settings";
import {
  Button,
  Checkbox,
  Chip,
  EmptyState,
  Icon,
  IconButton,
  MenuButton,
  NeedsModTag,
  PlayTypeTag,
  SearchSelect,
  Segmented,
  Tag,
  TextArea,
  TextInput,
  confirmDialog,
  cx,
  toast,
  type SearchOption,
} from "../../ui";
import { BookPicker, CategoryChip, CategoryFilter, PlayThumb, categoryMenuItems } from "./parts";
import { SEARCH_CAP, scopePlays } from "./scope";
import {
  editConcepts,
  getConcepts,
  pickBook,
  suggestionsFor,
  uiSet,
  useBookOptions,
  useConceptsUi,
  type GroupBy,
  type ScopeKind,
  type SideFilter,
} from "./store";
import s from "./TagSection.module.css";

const ROW_H = 80;
const HEAD_H = 34;
const THUMB_W = 132;
const THUMB_H = Math.round(THUMB_W / 2.15);
const END_PAD = 24; // a little air under the last row

type Row =
  /** `caps`: the label is a formation › set (Madden name); category heads show the user's names as typed. */
  | { kind: "head"; key: string; label: string; color?: string; count: number; caps?: boolean }
  | { kind: "play"; key: string; play: ResolvedPlay; group: string };

const SCOPES: { value: ScopeKind; label: string; title: string }[] = [
  { value: "book", label: "Playbook", title: "Plays in a playbook" },
  { value: "custom", label: "Custom", title: "Every custom play in playbooks/plays/" },
  { value: "set", label: "Set", title: "A library formation › set (library + custom plays)" },
  { value: "search", label: "Search", title: "Search the whole catalog" },
  { value: "tagged", label: "Tagged", title: "Every play with a tag" },
];

// ───────────────────────────── edits (stable, store-driven) ─────────────────────────────

function toggleOne(key: PlayKey, id: string, on?: boolean) {
  editConcepts("tag", (d) => {
    toggleTag(d, key, id, on);
  });
}
function toggleMany(keys: PlayKey[], id: string) {
  if (!keys.length) return;
  editConcepts("tag", (d) => {
    toggleTagOnPlays(d, keys, id);
  });
}
function accept(key: PlayKey, id: string) {
  editConcepts("accept", (d) => {
    acceptSuggestions(d, [{ key, id }]);
  });
}
function dismiss(key: PlayKey, id: string) {
  editConcepts("dismiss", (d) => dismissSuggestion(d, key, id));
}
function toggleCheck(key: PlayKey) {
  const cur = useConceptsUi.getState().checked;
  uiSet({ checked: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] });
}
const reasonsText = (sg: Suggestion) => sg.reasons.map((r) => `• ${r.text}`).join("\n");

// ───────────────────────────── section ─────────────────────────────

export function TagSection({ doc, catalog }: { doc: ConceptsDoc; catalog: Catalog }) {
  const scope = useConceptsUi((st) => st.scope);
  const scopeBook = useConceptsUi((st) => st.scopeBook);
  const setAsset = useConceptsUi((st) => st.setAsset);
  const query = useConceptsUi((st) => st.query);
  const side = useConceptsUi((st) => st.side);
  const filter = useConceptsUi((st) => st.filter);
  const untagged = useConceptsUi((st) => st.untagged);
  const suggested = useConceptsUi((st) => st.suggested);
  const groupBy = useConceptsUi((st) => st.groupBy);
  const focus = useConceptsUi((st) => st.focus);
  const checked = useConceptsUi((st) => st.checked);
  const cameFrom = useConceptsUi((st) => st.cameFrom);
  const lastPlaybook = useSettings((st) => st.lastPlaybook);
  const books = useBookOptions();
  const book = scope === "book" ? pickBook(books, scopeBook, lastPlaybook) : undefined;
  const deferredQuery = useDeferredValue(query);
  const ix = conceptIndex(doc);
  const searchRef = useRef<HTMLInputElement>(null);

  // Rows that were listed stay listed while you work (tagging a play under "Untagged" doesn't yank it away);
  // changing the scope or a filter starts over.
  const filterSig = `${scope}|${book?.path}|${setAsset}|${deferredQuery}|${side}|${filter.join(",")}|${untagged}|${suggested}`;
  const sticky = useRef<{ sig: string; keys: Set<PlayKey> }>({ sig: "", keys: new Set() });
  if (sticky.current.sig !== filterSig) sticky.current = { sig: filterSig, keys: new Set() };

  const result = useMemo(
    () => scopePlays({ scope, book: book?.spec, set: setAsset, query: deferredQuery, side, doc: scope === "tagged" ? doc : null }, catalog),
    // The tagged scope follows doc.tags; the others only depend on their inputs.
    [scope, book?.spec, setAsset, deferredQuery, side, catalog, scope === "tagged" ? doc.tags : null],
  );

  const scopePlaysList = useMemo(() => {
    if (scope !== "tagged") return result.plays;
    // Keep plays untagged during this pass on screen too.
    const have = new Set(result.plays.map((p) => p.key));
    const extra = [...sticky.current.keys].filter((k) => !have.has(k)).map((k) => catalog.get(k)).filter((p): p is ResolvedPlay => !!p);
    return extra.length ? [...result.plays, ...extra] : result.plays;
  }, [result, scope, catalog]);

  const visible = useMemo(() => {
    const keep = sticky.current.keys;
    const out = scopePlaysList.filter((p) => {
      if (keep.has(p.key)) return true;
      if (untagged && tagsOfPlay(doc, p.key).length) return false;
      if (filter.length && !matchesCategories(doc, p.key, filter)) return false;
      if (suggested && !suggestionsFor(p, doc).length) return false;
      return true;
    });
    for (const p of out) keep.add(p.key);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopePlaysList, doc, filterSig]);

  const rows = useMemo(() => buildRows(visible, groupBy, doc, ix, result.groupOf, filter), [visible, groupBy, doc.tags, ix, result.groupOf, filter]);

  // Focus: by row (group-by-category lists a play once per tag), falling back to the play key, then the first row.
  const [focusRowKey, setFocusRowKey] = useState<string>();
  // The row key only wins while it still shows the focused play (deep links / "show in Tag Plays" move focus by key).
  let focusIndex = rows.findIndex((r) => r.key === focusRowKey && r.kind === "play" && r.play.key === focus);
  if (focusIndex < 0 && focus) focusIndex = rows.findIndex((r) => r.kind === "play" && r.play.key === focus);
  if (focusIndex < 0) focusIndex = rows.findIndex((r) => r.kind === "play");
  const focusedRow = rows[focusIndex];
  const focused = focusedRow?.kind === "play" ? focusedRow.play : undefined;
  useEffect(() => {
    if (focused && focused.key !== useConceptsUi.getState().focus) uiSet({ focus: focused.key });
  }, [focused]);

  const checkedSet = useMemo(() => new Set(checked), [checked]);
  const targets = useMemo(() => (checked.length ? checked : focused ? [focused.key] : []), [checked, focused]);
  const sugs = focused ? suggestionsFor(focused, doc) : NO_SUGS;

  const visibleSugCount = useMemo(() => visible.reduce((n, p) => n + suggestionsFor(p, doc).length, 0), [visible, doc]);
  // Pending suggestions of the checked rows (bulk accept from the inspector).
  const checkedSugs = useMemo(() => {
    if (checked.length < 2) return NO_ITEMS;
    const want = new Set(checked);
    const out: { key: PlayKey; id: string }[] = [];
    for (const p of scopePlaysList) if (want.has(p.key)) for (const sg of suggestionsFor(p, doc)) out.push({ key: p.key, id: sg.category.id });
    return out;
  }, [checked, scopePlaysList, doc]);

  const moveFocus = (dir: 1 | -1) => {
    for (let i = focusIndex + dir; i >= 0 && i < rows.length; i += dir) {
      const r = rows[i];
      if (r.kind === "play") {
        setFocusRowKey(r.key);
        uiSet({ focus: r.play.key });
        return;
      }
    }
  };
  const acceptAllVisible = async () => {
    const d0 = getConcepts();
    if (!d0) return;
    const items: { key: PlayKey; id: string }[] = [];
    const perCat = new Map<string, number>();
    let plays = 0;
    for (const p of visible) {
      const sg = suggestionsFor(p, d0);
      if (!sg.length) continue;
      plays++;
      for (const x of sg) {
        items.push({ key: p.key, id: x.category.id });
        perCat.set(x.category.name, (perCat.get(x.category.name) ?? 0) + 1);
      }
    }
    if (!items.length) return;
    const top = [...perCat].sort((a, b) => b[1] - a[1]);
    const summary = top
      .slice(0, 6)
      .map(([n, c]) => `${n} ${c}`)
      .join(" · ");
    const ok = await confirmDialog({
      title: `Accept ${items.length} Suggestion${items.length > 1 ? "s" : ""}?`,
      body: `Adds ${items.length} tag${items.length > 1 ? "s" : ""} to ${plays} visible play${plays > 1 ? "s" : ""}: ${summary}${top.length > 6 ? " …" : ""}. One undo step (⌘/Ctrl+Z).`,
      confirmLabel: "Accept All",
    });
    if (!ok) return;
    editConcepts("accept-all", (d) => {
      acceptSuggestions(d, items);
    });
    toast.success(`Tagged ${plays} Play${plays > 1 ? "s" : ""}`, { detail: `${items.length} suggestions accepted` });
  };
  const hasFilters = filter.length > 0 || untagged || suggested;
  const back = () => {
    if (useConceptsUi.getState().checked.length) uiSet({ checked: [] });
    else if (hasFilters) uiSet({ filter: [], untagged: false, suggested: false });
    else if (cameFrom) {
      uiSet({ cameFrom: undefined });
      history.back();
    }
  };

  // Universal keys only: Esc clears the selection / filters (or goes back after a deep link), ⌘/Ctrl+A selects every
  // listed play. Arrow keys and Space work inside the play list when it has focus (RowList).
  useActions("concepts.tag", [
    { id: "back", label: checked.length ? "Clear Selection" : hasFilters ? "Clear Filters" : "Back", keys: ["Escape"], enabled: checked.length > 0 || hasFilters || !!cameFrom, run: back },
    { id: "select-all", label: "Select All", keys: ["mod+a"], run: () => uiSet({ checked: visible.map((p) => p.key) }) },
  ]);

  // Row clicks: plain = focus, ⌘/Ctrl = toggle check, Shift = check the range from the last click.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const anchor = useRef(-1);
  const onRowClick = useMemo(
    () => (e: MouseEvent, i: number) => {
      const r = rowsRef.current[i];
      if (!r || r.kind !== "play") return;
      if (e.shiftKey && anchor.current >= 0) {
        const [a, b] = anchor.current < i ? [anchor.current, i] : [i, anchor.current];
        const keys = rowsRef.current.slice(a, b + 1).flatMap((x) => (x.kind === "play" ? [x.play.key] : []));
        uiSet({ checked: [...new Set([...useConceptsUi.getState().checked, ...keys])] });
      } else if (e.metaKey || e.ctrlKey) toggleCheck(r.play.key);
      anchor.current = i;
      setFocusRowKey(r.key);
      uiSet({ focus: r.play.key });
    },
    [],
  );

  const allChecked = visible.length > 0 && visible.every((p) => checkedSet.has(p.key));
  const someChecked = !allChecked && visible.some((p) => checkedSet.has(p.key));

  return (
    <div className={s.wrap}>
      <div className={s.main}>
        <ScopeBar catalog={catalog} books={books} bookPath={book?.path} searchRef={searchRef} />
        <div className={s.filters}>
          <CategoryFilter
            doc={doc}
            extra={
              <>
                <Chip active={untagged} onClick={() => uiSet({ untagged: !untagged })} icon="tag" title="Only plays without tags">
                  Untagged
                </Chip>
                <Chip active={suggested} onClick={() => uiSet({ suggested: !suggested })} icon="sparkle" title="Only plays with pending suggestions">
                  Has Suggestions
                </Chip>
              </>
            }
          />
          <div className={s.groupBy}>
            <span className={s.kicker}>Group</span>
            <Segmented<GroupBy>
              size="sm"
              value={groupBy}
              onChange={(v) => uiSet({ groupBy: v })}
              options={[
                { value: "none", label: "None" },
                { value: "set", label: "Set" },
                { value: "category", label: "Category" },
              ]}
              aria-label="Group by"
            />
          </div>
        </div>
        <div className={s.listHead}>
          <span />
          <Checkbox
            checked={allChecked}
            indeterminate={someChecked}
            disabled={!visible.length}
            onChange={() => uiSet({ checked: allChecked ? [] : visible.map((p) => p.key) })}
            title="Select every listed play"
          />
          <span className={s.colPlay}>
            {query !== deferredQuery && scope === "search" ? "Searching… · " : ""}
            {visible.length.toLocaleString()} play{visible.length === 1 ? "" : "s"}
            {checked.length > 0 && <b> · {checked.length} selected</b>}
            {result.total !== undefined && result.total > SEARCH_CAP && <em> · first {SEARCH_CAP.toLocaleString()} of {result.total.toLocaleString()}</em>}
            {result.missing > 0 && <em> · {result.missing} unresolved</em>}
          </span>
          <span className={s.colTags}>Tags</span>
          <span className={s.colSugs}>
            Suggestions
            <Button size="sm" variant="secondary" icon="check" disabled={!visibleSugCount} onClick={() => void acceptAllVisible()} className={s.acceptAll}>
              Accept All {visibleSugCount ? `(${visibleSugCount})` : ""}
            </Button>
          </span>
        </div>
        <RowList
          rows={rows}
          focusIndex={focusIndex}
          onMove={moveFocus}
          onToggleCheck={() => focused && toggleCheck(focused.key)}
          empty={
            <EmptyState
              compact
              icon={scope === "search" ? "search" : "tag"}
              title={scope === "search" && query !== deferredQuery ? "Searching…" : (result.idle ?? (scopePlaysList.length ? "Nothing matches the filters" : "No plays here"))}
              body={
                result.idle
                  ? undefined
                  : scopePlaysList.length
                    ? "Clear the category / untagged / suggestion filters to see every play in this scope."
                    : scope === "custom"
                      ? "Custom plays live in playbooks/plays/*.json — build one in the Designer."
                      : undefined
              }
              action={
                hasFilters && scopePlaysList.length ? (
                  <Button size="sm" onClick={() => uiSet({ filter: [], untagged: false, suggested: false })}>
                    Clear Filters
                  </Button>
                ) : undefined
              }
            />
          }
          render={(r, i) =>
            r.kind === "head" ? (
              <div className={s.head} style={{ "--c": r.color ?? "var(--line-3)" } as CSSProperties}>
                <span className={s.headBar} />
                <span className={cx(s.headLabel, r.caps && "caps")}>{r.label}</span>
                <span className={s.headCount}>{r.count}</span>
              </div>
            ) : (
              <PlayRow
                play={r.play}
                index={i}
                catalog={catalog}
                ix={ix}
                tags={tagsOfPlay(doc, r.play.key)}
                sugs={suggestionsFor(r.play, doc)}
                note={!!noteOf(doc, r.play.key)}
                label={r.group}
                checked={checkedSet.has(r.play.key)}
                focused={i === focusIndex}
                onRowClick={onRowClick}
              />
            )
          }
        />
      </div>
      <Inspector doc={doc} ix={ix} focused={focused} targets={targets} sugs={sugs} checkedSugs={checkedSugs} />
    </div>
  );
}

const NO_SUGS: Suggestion[] = [];
const NO_ITEMS: { key: PlayKey; id: string }[] = [];

function buildRows(
  plays: ResolvedPlay[],
  groupBy: GroupBy,
  doc: ConceptsDoc,
  ix: ConceptIndex,
  groupOf: (p: ResolvedPlay) => string,
  filter: string[],
): Row[] {
  if (groupBy === "none") return plays.map((p) => ({ kind: "play", key: p.key, play: p, group: groupOf(p) }));
  const rows: Row[] = [];
  if (groupBy === "set") {
    const groups = new Map<string, ResolvedPlay[]>();
    for (const p of plays) {
      const g = groupOf(p);
      const list = groups.get(g);
      if (list) list.push(p);
      else groups.set(g, [p]);
    }
    for (const [label, list] of groups) {
      rows.push({ kind: "head", key: `h:${label}`, label, count: list.length, caps: true });
      for (const p of list) rows.push({ kind: "play", key: `${label}|${p.key}`, play: p, group: label });
    }
    return rows;
  }
  // By category: a play is listed under each of its own tags (tree order), then "Untagged".
  const only = filter.length ? new Set(filter.flatMap((id) => [...ix.descendantsOrSelf(id)])) : undefined;
  const byCat = new Map<string, ResolvedPlay[]>();
  const none: ResolvedPlay[] = [];
  for (const p of plays) {
    const tags = tagsOfPlay(doc, p.key).filter((t) => ix.byId.has(t) && (!only || only.has(t)));
    if (!tags.length) none.push(p);
    for (const t of tags) {
      const list = byCat.get(t);
      if (list) list.push(p);
      else byCat.set(t, [p]);
    }
  }
  for (const n of ix.tree) {
    const list = byCat.get(n.cat.id);
    if (!list?.length) continue;
    const label = `${GROUP_LABEL[categoryGroup(n.cat)]} › ${n.cat.name}`;
    rows.push({ kind: "head", key: `h:${n.cat.id}`, label, color: n.cat.color, count: list.length });
    for (const p of list) rows.push({ kind: "play", key: `${n.cat.id}|${p.key}`, play: p, group: groupOf(p) });
  }
  if (none.length) {
    rows.push({ kind: "head", key: "h:none", label: "Untagged", count: none.length });
    for (const p of none) rows.push({ kind: "play", key: `none|${p.key}`, play: p, group: groupOf(p) });
  }
  return rows;
}

// ───────────────────────────── scope bar ─────────────────────────────

function ScopeBar({ catalog, books, bookPath, searchRef }: { catalog: Catalog; books: ReturnType<typeof useBookOptions>; bookPath?: string; searchRef: RefObject<HTMLInputElement | null> }) {
  const scope = useConceptsUi((st) => st.scope);
  const formation = useConceptsUi((st) => st.formation);
  const setAsset = useConceptsUi((st) => st.setAsset);
  const query = useConceptsUi((st) => st.query);
  const side = useConceptsUi((st) => st.side);
  const hideMinigames = useSettings((st) => st.hideMinigames);
  const lib = catalog.lib;

  const formationOptions = useMemo<SearchOption[]>(() => {
    const order = { offense: 0, defense: 1, special: 2 } as const;
    return lib.data.formations
      .filter((f) => (lib.setsByFormation.get(f.asset)?.length ?? 0) > 0 && (!hideMinigames || !isMinigame(f)))
      .map((f) => ({ f, side: lib.formationSide(f) }))
      .sort((a, b) => order[a.side] - order[b.side] || a.f.name.localeCompare(b.f.name))
      .map(({ f, side: sd }) => ({
        value: f.asset,
        label: f.name.toUpperCase(), // the menu is a portal: Madden names are uppercased here (display only)
        group: sd === "offense" ? "Offense" : sd === "defense" ? "Defense" : "Special",
        hint: `${sd === "offense" ? "OFF" : sd === "defense" ? "DEF" : "ST"} · ${lib.setsByFormation.get(f.asset)?.length ?? 0} sets`,
      }));
  }, [lib, hideMinigames]);
  const setOptions = useMemo<SearchOption[]>(
    () =>
      formation
        ? (lib.setsByFormation.get(formation) ?? []).map((st) => ({
            value: st.asset,
            label: st.name.toUpperCase(),
            hint: `${catalog.playsInSet(st.asset).length} plays`,
          }))
        : [],
    [lib, formation, catalog],
  );

  return (
    <div className={s.scopeBar}>
      <Segmented<ScopeKind>
        size="sm"
        value={scope}
        onChange={(v) => {
          // The Set scope starts on the focused play's set, so switching scopes keeps your place.
          const st = useConceptsUi.getState();
          const play = v === "set" && !st.setAsset && st.focus ? catalog.get(st.focus) : undefined;
          const formation = play ? lib.setByAsset.get(play.set)?.formation : undefined;
          uiSet({ scope: v, checked: [], ...(play && formation ? { formation, setAsset: play.set } : {}) });
        }}
        options={SCOPES.map((o) => ({ value: o.value, label: o.label, title: o.title }))}
        aria-label="Scope"
      />
      {scope === "book" && <BookPicker books={books} value={bookPath} onChange={(p) => uiSet({ scopeBook: p, checked: [] })} />}
      {scope === "set" && (
        <>
          <SearchSelect
            size="sm"
            width={230}
            value={formation}
            options={formationOptions}
            placeholder="Formation…"
            searchPlaceholder="Search formations"
            onChange={(v) => uiSet({ formation: v, setAsset: lib.setsByFormation.get(v)?.[0]?.asset, checked: [] })}
            aria-label="Formation"
          />
          <SearchSelect
            size="sm"
            width={230}
            value={setAsset}
            options={setOptions}
            placeholder="Set…"
            searchPlaceholder="Search sets"
            disabled={!formation}
            onChange={(v) => uiSet({ setAsset: v, checked: [] })}
            aria-label="Set"
          />
        </>
      )}
      {scope === "search" && (
        <>
          <TextInput
            ref={searchRef}
            size="sm"
            icon="search"
            clearable
            value={query}
            placeholder="Play, formation or set — e.g. mesh gun bunch"
            onChange={(v) => uiSet({ query: v })}
            wrapperClassName={s.search}
            aria-label="Search plays"
            autoFocus={!query}
          />
          <Segmented<SideFilter>
            size="sm"
            value={side}
            onChange={(v) => uiSet({ side: v })}
            options={[
              { value: "offense", label: "Off" },
              { value: "defense", label: "Def" },
              { value: "all", label: "All" },
            ]}
            aria-label="Side"
          />
        </>
      )}
      {scope === "custom" && <span className={s.scopeNote}>{catalog.custom.length} custom plays in playbooks/plays/</span>}
      {scope === "tagged" && <span className={s.scopeNote}>Every play with at least one tag</span>}
    </div>
  );
}

// ───────────────────────────── virtual rows (variable height) ─────────────────────────────

function RowList({
  rows,
  focusIndex,
  render,
  empty,
  onMove,
  onToggleCheck,
}: {
  rows: Row[];
  focusIndex: number;
  render(r: Row, i: number): ReactNode;
  empty: ReactNode;
  onMove(dir: 1 | -1): void;
  onToggleCheck(): void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ top: 0, height: 0 });
  const offsets = useMemo(() => {
    const o = new Array<number>(rows.length + 1);
    o[0] = 0;
    for (let i = 0; i < rows.length; i++) o[i + 1] = o[i] + (rows[i].kind === "head" ? HEAD_H : ROW_H);
    return o;
  }, [rows]);

  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    const update = () => setVp((v) => (v.top === node.scrollTop && v.height === node.clientHeight ? v : { top: node.scrollTop, height: node.clientHeight }));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(node);
    return () => ro.disconnect();
  }, [rows.length === 0]);

  // Keep the focused row in view (with its group header when it's the first in the group).
  useLayoutEffect(() => {
    const node = el.current;
    if (!node || focusIndex < 0 || focusIndex >= rows.length) return;
    const head = rows[focusIndex - 1]?.kind === "head" ? HEAD_H : 0;
    const top = offsets[focusIndex] - head;
    const bottom = offsets[focusIndex + 1];
    if (top < node.scrollTop) node.scrollTop = Math.max(0, top - 4);
    else if (bottom > node.scrollTop + node.clientHeight - END_PAD + 24) node.scrollTop = bottom - node.clientHeight + END_PAD - 24;
  }, [focusIndex, offsets]);

  if (!rows.length) return <div className={s.listEmpty}>{empty}</div>;

  // Binary search the first row crossing the top edge; render a screen of overscan both ways.
  const overscan = 400;
  const from = vp.top - overscan;
  const to = vp.top + (vp.height || 900) + overscan;
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid + 1] <= from) lo = mid + 1;
    else hi = mid;
  }
  const items: ReactNode[] = [];
  for (let i = lo; i < rows.length && offsets[i] < to; i++) {
    const r = rows[i];
    items.push(
      <div key={r.key} className={s.vrow} style={{ top: offsets[i], height: offsets[i + 1] - offsets[i] }}>
        {render(r, i)}
      </div>,
    );
  }
  return (
    <div
      ref={el}
      className={s.list}
      tabIndex={0}
      role="listbox"
      aria-label="Plays"
      onScroll={(e) => setVp({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
      onKeyDown={(e) => {
        // ↑ ↓ move the focused play, Space selects it (only while the list has focus).
        if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          onMove(e.key === "ArrowDown" ? 1 : -1);
        } else if (e.key === " " && e.target === e.currentTarget) {
          e.preventDefault();
          onToggleCheck();
        }
      }}
    >
      <div className={s.spacer} style={{ height: offsets[rows.length] + END_PAD }}>
        {items}
      </div>
    </div>
  );
}

// ───────────────────────────── row ─────────────────────────────

interface PlayRowProps {
  play: ResolvedPlay;
  index: number;
  catalog: Catalog;
  ix: ConceptIndex;
  tags: string[];
  sugs: Suggestion[];
  note: boolean;
  label: string;
  checked: boolean;
  focused: boolean;
  onRowClick(e: MouseEvent, i: number): void;
}

const PlayRow = memo(function PlayRow({ play, index, catalog, ix, tags, sugs, note, label, checked, focused, onRowClick }: PlayRowProps) {
  const cats = tags.map((id) => ix.byId.get(id)).filter((c) => !!c);
  const accent = cats[0]?.color;
  return (
    <div
      className={cx(s.row, focused && s.rowFocused, checked && s.rowChecked)}
      style={accent ? ({ "--accent": accent } as CSSProperties) : undefined}
      onClick={(e) => onRowClick(e, index)}
      data-focused={focused || undefined}
    >
      <span className={s.accent} />
      <span className={s.check} onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={checked} onChange={() => toggleCheck(play.key)} title="Select for bulk tagging" />
      </span>
      <PlayThumb play={play} catalog={catalog} width={THUMB_W} height={THUMB_H} />
      <div className={s.meta}>
        <div className={s.name} title={play.name}>
          {play.name}
        </div>
        <div className={s.sub}>{label}</div>
        <div className={s.badges}>
          <PlayTypeTag playType={play.playType} size="sm" />
          {play.source === "custom" && (
            <Tag size="sm" tone="custom">
              Custom
            </Tag>
          )}
          {play.source === "library" && !play.global && <NeedsModTag size="sm" />}
          {note && <Icon name="file" size={13} className={s.noteIcon} title="Has a note" />}
        </div>
      </div>
      <div className={s.tags}>
        {cats.map((c) => (
          <CategoryChip key={c.id} category={c} size="sm" state="on" title={`${c.name} — click to remove`} onClick={() => toggleOne(play.key, c.id, false)} />
        ))}
        <MenuButton
          size="sm"
          variant="ghost"
          icon="plus"
          iconRight={null}
          title="Add a tag"
          aria-label="Add a tag"
          className={s.addTag}
          menuMinWidth={220}
          items={() => {
            const d = getConcepts();
            return d ? categoryMenuItems(d, (id) => tagsOfPlay(getConcepts(), play.key).includes(id), (id) => toggleOne(play.key, id)) : [];
          }}
        />
      </div>
      <div className={s.sugs}>
        {sugs.map((sg) => (
          <CategoryChip
            key={sg.category.id}
            category={sg.category}
            size="sm"
            state="suggested"
            title={`Accept ${sg.category.name}\n${reasonsText(sg)}`}
            onClick={() => accept(play.key, sg.category.id)}
            onRemove={() => dismiss(play.key, sg.category.id)}
            removeTitle={`Dismiss ${sg.category.name}`}
          />
        ))}
      </div>
    </div>
  );
});

// ───────────────────────────── inspector ─────────────────────────────

const SOURCE_LABEL: Record<string, string> = { concept: "Read", playType: "Type", route: "Route", name: "Name" };

function Inspector({
  doc,
  ix,
  focused,
  targets,
  sugs,
  checkedSugs,
}: {
  doc: ConceptsDoc;
  ix: ConceptIndex;
  focused?: ResolvedPlay;
  targets: PlayKey[];
  sugs: Suggestion[];
  checkedSugs: { key: PlayKey; id: string }[];
}) {
  const multi = targets.length > 1;

  if (!focused && !multi)
    return (
      <aside className={s.inspector}>
        <EmptyState compact icon="tag" title="No Play Selected" body="Pick a play on the left to tag it." />
      </aside>
    );

  const dismissed = focused && !multi ? dismissedCount(doc, focused.key) : 0;
  return (
    <aside className={s.inspector}>
      <div className={s.inspScroll}>
        {multi ? (
          <div className={s.multi}>
            <div className={s.multiCount}>{targets.length}</div>
            <div>
              <div className={s.multiTitle}>Plays Selected</div>
              <div className={s.multiHint}>Chips below tag or untag all of them.</div>
            </div>
            <Button size="sm" variant="ghost" icon="close" onClick={() => uiSet({ checked: [] })}>
              Clear
            </Button>
          </div>
        ) : (
          focused && (
            <>
              <PlayCard play={focused} size="md" />
              <div className={s.links}>
                <Button size="sm" variant="ghost" icon="external" onClick={() => navigate(href("library", "play", focused.key))}>
                  Library
                </Button>
                {focused.source === "custom" && designerEditHref(focused) && (
                  <Button size="sm" variant="ghost" icon="route" onClick={() => navigate(designerEditHref(focused)!)}>
                    {isSetClone(focused) ? "Formations" : "Designer"}
                  </Button>
                )}
              </div>
            </>
          )
        )}

        {multi && checkedSugs.length > 0 && (
          <section className={s.block}>
            <div className={s.blockHead}>
              <span>
                <Icon name="sparkle" size={14} /> Suggested
              </span>
              <Button
                size="sm"
                variant="secondary"
                icon="check"
                onClick={() =>
                  editConcepts("accept", (d) => {
                    acceptSuggestions(d, checkedSugs);
                  })
                }
              >
                Accept {checkedSugs.length}
              </Button>
            </div>
            <div className={s.dim}>
              {checkedSugs.length} pending suggestion{checkedSugs.length > 1 ? "s" : ""} across {new Set(checkedSugs.map((x) => x.key)).size} of the selected plays.
            </div>
          </section>
        )}

        {!multi && focused && (sugs.length > 0 || dismissed > 0) && (
          <section className={s.block}>
            <div className={s.blockHead}>
              <span>
                <Icon name="sparkle" size={14} /> Suggested
              </span>
              {sugs.length > 1 && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon="check"
                  onClick={() =>
                    editConcepts("accept", (d) => {
                      acceptSuggestions(
                        d,
                        sugs.map((x) => ({ key: focused.key, id: x.category.id })),
                      );
                    })
                  }
                >
                  Accept {sugs.length}
                </Button>
              )}
            </div>
            {sugs.map((sg) => (
              <div key={sg.category.id} className={s.sug}>
                <div className={s.sugTop}>
                  <CategoryChip category={sg.category} state="suggested" onClick={() => accept(focused.key, sg.category.id)} title={`Accept ${sg.category.name}`} />
                  <span className={s.sugBtns}>
                    <IconButton icon="check" size="sm" title={`Accept ${sg.category.name}`} onClick={() => accept(focused.key, sg.category.id)} />
                    <IconButton icon="close" size="sm" title={`Dismiss ${sg.category.name}`} onClick={() => dismiss(focused.key, sg.category.id)} />
                  </span>
                </div>
                <ul className={s.reasons}>
                  {sg.reasons.map((r) => (
                    <li key={r.text}>
                      <span className={s.reasonSrc}>{SOURCE_LABEL[r.source]}</span>
                      {r.text}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {dismissed > 0 && (
              <button type="button" className={s.restore} onClick={() => editConcepts("restore", (d) => restoreDismissed(d, focused.key))}>
                {dismissed} Dismissed · Restore
              </button>
            )}
          </section>
        )}

        <section className={s.block}>
          <div className={s.blockHead}>
            <span>
              <Icon name="tag" size={14} /> {multi ? `Tags · ${targets.length} plays` : "Tags"}
            </span>
          </div>
          {!ix.tree.length && <div className={s.dim}>No categories yet — add some in Categories.</div>}
          {CATEGORY_GROUPS.map((g) =>
            ix.byGroup[g].length ? (
              <div key={g} className={s.tagGroup}>
                <div className={s.tagGroupHead}>{GROUP_LABEL[g]}</div>
                <div className={s.tagChips}>
                  {ix.byGroup[g].map((n) => {
                    const st = tagState(doc, targets, n.cat.id);
                    return (
                      <CategoryChip
                        key={n.cat.id}
                        category={n.cat}
                        depth={n.depth}
                        state={st === "all" ? "on" : st === "some" ? "mixed" : "off"}
                        onClick={() => toggleMany(targets, n.cat.id)}
                        title={st === "all" ? `Remove ${n.cat.name}` : `Tag ${n.cat.name}`}
                      />
                    );
                  })}
                </div>
              </div>
            ) : null,
          )}
        </section>

        {!multi && focused && <Notes key={focused.key} doc={doc} playKey={focused.key} />}
      </div>
    </aside>
  );
}

function Notes({ doc, playKey }: { doc: ConceptsDoc; playKey: PlayKey }) {
  const stored = noteOf(doc, playKey);
  const [text, setText] = useState(stored);
  // Follow undo/redo and outside edits (but not our own trimmed-away whitespace).
  useEffect(() => {
    setText((t) => (t.trim() === stored.trim() ? t : stored));
  }, [stored]);
  return (
    <section className={s.block}>
      <div className={s.blockHead}>
        <span>
          <Icon name="file" size={14} /> Notes
        </span>
      </div>
      <TextArea
        value={text}
        autoGrow
        rows={3}
        maxRows={10}
        placeholder="Why you like it, what it beats, when to call it…"
        onChange={(v) => {
          setText(v);
          editConcepts(`note:${playKey}`, (d) => setNote(d, playKey, v), 1500);
        }}
        aria-label="Play notes"
      />
    </section>
  );
}
