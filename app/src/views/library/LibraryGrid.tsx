// Library grid (#/library): sub-tabs, search, the filter rail, active-filter chips, the selected play's actions and a
// virtualized grid of play cards grouped per tab. Mouse first: click selects, double-click opens, right-click menu;
// the action bar (Open · Add to playbook · Clone in designer · Favorite) acts on the selected card. Arrow keys move
// the selection while the grid has focus; Enter opens.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { PlayCard, cardSubtitle } from "../../field";
import { displayFromLeaf, leaf } from "../../model/names";
import { familyColor, familyLabel, playTypeInfo } from "../../model/playtypes";
import { activeFilterCount, groupResults, type PlayFilters, type ResultSection, type SearchEntry, type SearchIndex } from "../../model/search";
import type { ConceptsDoc } from "../../model/types";
import { useCatalog, useLibrary } from "../../state/library";
import { useSettings } from "../../state/settings";
import { Button, Chip, EmptyState, Icon, IconButton, PlayTypeTag, Spinner, SplitPane, TabBar, TextInput, cx, useContextMenu, type TabItem } from "../../ui";
import { FilterRail } from "./FilterRail";
import { openAddToPlaybook } from "./AddToPlaybook";
import { isCustomSetAsset } from "./format";
import { gridScroll, useLibraryUi, type LibTab } from "./libraryStore";
import { designerAction, openPlay, playMenuItems, toggleFavorite } from "./playActions";
import { SectionGrid, type GridSection, type SectionGridHandle } from "./SectionGrid";
import { PERSONAL_TABS, useConceptsDoc, useLibraryResults } from "./useLibraryResults";
import s from "./LibraryGrid.module.css";

const TAB_LABELS: Record<LibTab, string> = {
  all: "All",
  formation: "Browse",
  concept: "Concept",
  type: "Play Type",
  favorites: "Favorites",
  recent: "Recent",
};

const fmt = (n: number) => n.toLocaleString("en-US");
const cardHeight = (w: number) => w / 2.15 + 52;

export function LibraryGrid() {
  const status = useLibrary((st) => st.status);
  const libError = useLibrary((st) => st.error);
  const { index, result, entries, sections, stale } = useLibraryResults();
  const tab = useLibraryUi((st) => st.tab);
  const query = useLibraryUi((st) => st.query);
  const filters = useLibraryUi((st) => st.filters);
  const selectedId = useLibraryUi((st) => st.selectedId);
  const flip = useLibraryUi((st) => st.flip);
  const railOpen = useLibraryUi((st) => st.railOpen);
  const favorites = useSettings((st) => st.favorites);
  const ballSpot = useSettings((st) => st.ballSpot);
  const hideMinigames = useSettings((st) => st.hideMinigames);
  const concepts = useConceptsDoc();
  const baseLib = useLibrary((st) => st.lib);
  const catalog = useCatalog();

  const searchEl = useRef<HTMLInputElement>(null);
  const gridRef = useRef<SectionGridHandle>(null);
  const menu = useContextMenu();
  const personal = PERSONAL_TABS.has(tab);

  // Browse (the "formation" tab): pick a formation in the list, then one of its sets (or all of them), like the game's
  // formation screen. Counts follow the search and filters.
  const [fSel, setFSel] = useState<string | undefined>();
  const [sSel, setSSel] = useState<string | undefined>();
  const browse = useMemo(() => {
    if (tab !== "formation") return [];
    const lib = catalog?.lib;
    const out = new Map<string, BrowseFormation>();
    for (const e of entries) {
      const fa = e.play.formation;
      const sa = e.play.set;
      let f = out.get(fa);
      if (!f) out.set(fa, (f = { asset: fa, name: lib?.formationByAsset.get(fa)?.name ?? displayFromLeaf(leaf(fa)), count: 0, sets: new Map() }));
      f.count++;
      let st = f.sets.get(sa);
      if (!st) f.sets.set(sa, (st = { asset: sa, name: lib?.setByAsset.get(sa)?.name ?? displayFromLeaf(leaf(sa)), count: 0 }));
      st.count++;
    }
    return [...out.values()];
  }, [tab, entries, catalog]);
  const curF = browse.find((f) => f.asset === fSel) ?? browse[0];
  const curS = curF && sSel ? curF.sets.get(sSel) : undefined;
  const view = useMemo(() => {
    if (tab !== "formation") return sections;
    if (!curF) return [];
    const list = entries.filter((e) => e.play.formation === curF.asset && (!curS || e.play.set === curS.asset));
    return groupResults(list, "formation", { lib: catalog?.lib });
  }, [tab, sections, entries, curF, curS, catalog]);

  // Flat display order (concept tab can list a play in several sections).
  const flat = useMemo(() => view.flatMap((x) => x.entries), [view]);
  const gridSections = useMemo<GridSection<SearchEntry>[]>(() => view.map((x) => ({ key: x.key, items: x.entries })), [view]);
  const hint = useRef(-1);
  const selected = useMemo(() => {
    if (!selectedId) return -1;
    if (hint.current >= 0 && flat[hint.current]?.id === selectedId) return hint.current;
    return flat.findIndex((e) => e.id === selectedId);
  }, [flat, selectedId]);
  const selectedEntry = selected >= 0 ? flat[selected] : undefined;

  const select = useCallback(
    (i: number) => {
      const e = flat[i];
      if (!e) return;
      hint.current = i;
      useLibraryUi.getState().set({ selectedId: e.id, selectedKey: e.key });
    },
    [flat],
  );
  const open = useCallback(
    (i: number) => {
      const e = flat[i];
      if (!e) return;
      select(i);
      openPlay(e.key);
    },
    [flat, select],
  );

  // Like the game, something is always selected: the first play when the selection is gone.
  useEffect(() => {
    if (selected < 0 && flat.length) select(0);
  }, [flat, selected, select]);

  // A new result set scrolls back to the top unless the selection survived.
  const firstEntries = useRef(true);
  useEffect(() => {
    if (firstEntries.current) {
      firstEntries.current = false;
      return;
    }
    if (selected < 0) gridRef.current?.scrollTo(0);
  }, [entries]); // eslint-disable-line react-hooks/exhaustive-deps

  const setTab = (t: LibTab) => {
    gridScroll.top = 0;
    useLibraryUi.getState().set({ tab: t });
  };
  const tabItems = useMemo<TabItem<LibTab>[]>(
    () =>
      (Object.keys(TAB_LABELS) as LibTab[]).map((id) => ({
        id,
        label: TAB_LABELS[id],
        icon: id === "favorites" ? "starFilled" : undefined,
        badge: id === "favorites" && favorites.length ? favorites.length : undefined,
      })),
    [favorites.length],
  );

  const renderCell = useCallback(
    (e: SearchEntry, _flat: number, st: { selected: boolean }) => (
      <PlayCell
        entry={e}
        selected={st.selected}
        flip={flip}
        ballSpot={ballSpot}
        favorite={favorites.includes(e.key)}
        customSet={isCustomSetAsset(baseLib, catalog, e.play.set)}
      />
    ),
    [flip, ballSpot, favorites, baseLib, catalog],
  );
  const renderHeader = useCallback((sec: GridSection<SearchEntry>, i: number) => <SectionHeader section={view[i]} key={sec.key} />, [view]);

  const total = index?.entries.length ?? 0;
  const count = new Set(flat.map((e) => e.id)).size;

  let body: ReactNode;
  if (status !== "ready" || !index) {
    body =
      status === "error" ? (
        <EmptyState icon="warning" title="The Play Library Didn't Load" body={libError ?? "Reload the app to try again."} />
      ) : (
        <EmptyState icon={<Spinner size={26} />} title="Loading the Play Library" body="11,055 plays, 808 sets and 5,402 assignments…" />
      );
  } else {
    const grid = (
      <SectionGrid
        ref={gridRef}
        key={tab === "formation" ? `browse:${curF?.asset}:${curS?.asset}` : tab}
        sections={gridSections}
        renderHeader={tab === "all" || personal ? undefined : renderHeader}
        renderCell={renderCell}
        getKey={(e, i) => (tab === "concept" ? `${e.id}@${i}` : e.id)}
        minCellWidth={300}
        maxColumns={6}
        cellHeight={cardHeight}
        headerHeight={52}
        gap={18}
        rowGap={22}
        padding={18}
        sectionGap={14}
        selected={selected}
        onSelect={select}
        onActivate={open}
        onCellContextMenu={(i, ev) => {
          select(i);
          const e = flat[i];
          if (e) menu.open(ev, playMenuItems(e.play, { onOpen: () => open(i) }));
        }}
        initialScrollTop={gridScroll.top}
        onScrollTopChange={(t) => {
          gridScroll.top = t;
        }}
        padEnd={16}
        aria-label="Plays"
        empty={<NoResults tab={tab} query={query} filters={filters} />}
        className={cx(s.grid, stale && s.stale)}
      />
    );
    body =
      tab === "formation" && browse.length > 0 ? (
        <div className={s.browse}>
          <nav className={s.formList} aria-label="Formations">
            {browse.map((f) => (
              <button
                key={f.asset}
                type="button"
                aria-current={f === curF}
                className={cx(s.formItem, f === curF && s.formItemOn)}
                onClick={() => {
                  setFSel(f.asset);
                  setSSel(undefined);
                  gridScroll.top = 0;
                }}
              >
                <span className={cx(s.formName, "caps")}>{f.name}</span>
                <span className={s.formCount}>{fmt(f.count)}</span>
              </button>
            ))}
          </nav>
          <div className={s.browseMain}>
            {curF && (
              <div className={s.setTabs} role="tablist" aria-label="Sets">
                <button type="button" role="tab" aria-selected={!curS} className={cx(s.setTab, !curS && s.setTabOn)} onClick={() => setSSel(undefined)}>
                  All Sets <span>{fmt(curF.count)}</span>
                </button>
                {[...curF.sets.values()].map((st) => (
                  <button key={st.asset} type="button" role="tab" aria-selected={curS === st} className={cx(s.setTab, curS === st && s.setTabOn)} onClick={() => setSSel(st.asset)}>
                    <span className="caps">{st.name}</span> <span>{fmt(st.count)}</span>
                  </button>
                ))}
              </div>
            )}
            <div className={s.browseGrid}>{grid}</div>
          </div>
        </div>
      ) : (
        grid
      );
  }

  const main = (
    <div className={s.main}>
      <div className={s.bar}>
        <ActiveFilters index={index} filters={filters} query={query} personal={personal} concepts={concepts} />
        {selectedEntry && <SelectionActions entry={selectedEntry} favorite={favorites.includes(selectedEntry.key)} onOpen={() => open(selected)} />}
      </div>
      {body}
    </div>
  );

  return (
    <div className={s.page}>
      <header className={s.head}>
        <TabBar items={tabItems} active={tab} onChange={setTab} size="sm" aria-label="Library tabs" className={s.tabs} />
        <div className={s.search}>
          <TextInput
            ref={searchEl}
            value={query}
            onChange={(v) => useLibraryUi.getState().set({ query: v })}
            icon="search"
            clearable
            placeholder="Search plays, sets, concepts, routes…"
            aria-label="Search plays"
            onKeyDown={(e) => {
              // Esc clears the search first, then leaves the box.
              if (e.key === "Escape" && query) {
                e.preventDefault();
                useLibraryUi.getState().set({ query: "" });
                return;
              }
              // Down / Enter hand the keyboard to the grid (arrows then move the selection).
              if (e.key === "ArrowDown" || (e.key === "Enter" && !e.nativeEvent.isComposing)) {
                e.preventDefault();
                if (selected < 0 && flat.length) select(0);
                gridRef.current?.focus();
              }
            }}
          />
        </div>
        <Button
          size="sm"
          variant="secondary"
          icon="flip"
          active={flip}
          onClick={() => useLibraryUi.getState().set({ flip: !useLibraryUi.getState().flip })}
          title="Mirror every play card (plays that can't flip stay as they are)"
        >
          {flip ? "Flipped" : "Flip Plays"}
        </Button>
        <div className={s.count} aria-live="polite" title={count !== total && total > 0 ? `${fmt(count)} of ${fmt(total)} plays` : undefined}>
          <span className={s.countNum}>{fmt(count)}</span>
          <span className={s.countLabel}>{count === 1 ? "Play" : "Plays"}</span>
          {count !== total && total > 0 && <span className={s.countOf}>of {fmt(total)}</span>}
        </div>
        <a className={s.headLink} href="#/concepts?from=library" title="Gameplan: your concept categories, play tags, run / pass mix and situations (editor-only)">
          <Icon name="tag" size={14} /> Gameplan
        </a>
      </header>
      <div className={s.body}>
        {railOpen && index ? (
          <SplitPane initial={292} min={232} max={460} storageKey="pbstudio.split.library" className={s.split}>
            <div className={s.railWrap}>
              <div className={s.railTop}>
                <span className={s.railTitle}>
                  <Icon name="filter" size={15} /> Filters
                  {activeFilterCount(filters) > 0 && <span className={s.railBadge}>{activeFilterCount(filters)}</span>}
                </span>
                <IconButton icon="chevronLeft" title="Hide filters" size="sm" onClick={() => useLibraryUi.getState().set({ railOpen: false })} />
              </div>
              <FilterRail
                index={index}
                counts={result?.counts}
                filters={filters}
                setFilters={useLibraryUi.getState().setFilters}
                personal={personal}
                hideMinigames={hideMinigames}
                concepts={concepts}
              />
            </div>
            {main}
          </SplitPane>
        ) : (
          <div className={s.noRail}>
            {index && (
              <button type="button" className={s.railTab} onClick={() => useLibraryUi.getState().set({ railOpen: true })} title="Show filters">
                <Icon name="filter" size={16} />
                <span>Filters</span>
                {activeFilterCount(filters) > 0 && <span className={s.railBadge}>{activeFilterCount(filters)}</span>}
              </button>
            )}
            {main}
          </div>
        )}
      </div>
      {menu.node}
    </div>
  );
}

// ───────────────────────────── cells + headers ─────────────────────────────

interface PlayCellProps {
  entry: SearchEntry;
  selected: boolean;
  flip: boolean;
  ballSpot: "left" | "middle" | "right";
  favorite: boolean;
  /** The play's set is a custom set (playbooks/sets/*.json). */
  customSet: boolean;
}

const PlayCell = memo(function PlayCell({ entry, selected, flip, ballSpot, favorite, customSet }: PlayCellProps) {
  const p = entry.play;
  const stat = p.source === "custom" ? leaf(p.file ?? "").replace(/\.json$/i, "") : p.playId !== undefined ? `ID ${p.playId}` : undefined;
  const badges = useMemo(
    () =>
      favorite || customSet ? (
        <>
          {customSet && (
            <span className={s.customSet} title="In a custom set (playbooks/sets/) — built into the mod">
              Custom Set
            </span>
          )}
          {favorite && (
            <span className={s.fav} title="Favorite">
              ★
            </span>
          )}
        </>
      ) : undefined,
    [favorite, customSet],
  );
  return (
    <div className={s.cell} data-selected={selected || undefined}>
      <PlayCard play={p} size="md" selected={selected} flip={flip && p.canFlip} ballSpot={ballSpot} stat={stat} badges={badges} />
      {p.problems.length > 0 && (
        <span className={s.problem} title={p.problems.join("\n")}>
          <Icon name="warning" size={12} /> {p.problems.length}
        </span>
      )}
    </div>
  );
});

function SectionHeader({ section }: { section?: ResultSection }) {
  if (!section) return null;
  const n = section.entries.length;
  // Formation › set and play-type sections are Madden names (caps); concept sections show the user's names as typed.
  const caps = section.key.startsWith("set:") || section.key.startsWith("family:");
  return (
    <div className={s.sectionHead} style={section.color ? ({ "--accent": section.color } as CSSProperties) : undefined}>
      {section.color && <span className={s.sectionAccent} />}
      <span className={cx(s.sectionTitle, caps && "caps")}>{section.title}</span>
      {section.subtitle && <span className={cx(s.sectionSub, caps && "caps")}>{section.subtitle}</span>}
      <span className={s.sectionCount}>
        {fmt(n)} {n === 1 ? "play" : "plays"}
      </span>
    </div>
  );
}

// ───────────────────────────── chips + empty ─────────────────────────────

function ActiveFilters({ index, filters, query, personal, concepts }: { index?: SearchIndex; filters: PlayFilters; query: string; personal: boolean; concepts: ConceptsDoc | null }) {
  const set = useLibraryUi.getState().setFilters;
  const chips: { key: string; label: ReactNode; color?: string; remove(): void }[] = [];
  if (!personal && filters.formation) {
    const f = index?.formations.get(filters.formation);
    chips.push({ key: "formation", label: <span className="caps">{f?.name ?? leaf(filters.formation)}</span>, remove: () => set({ formation: undefined, set: undefined }) });
    if (filters.set) {
      const st = f?.sets.find((x) => x.asset === filters.set);
      chips.push({ key: "set", label: <span className="caps">{st?.name ?? leaf(filters.set)}</span>, remove: () => set({ set: undefined }) });
    }
  }
  for (const fam of filters.families ?? [])
    chips.push({ key: `fam:${fam}`, label: familyLabel(fam), color: familyColor(fam), remove: () => set({ families: filters.families!.filter((x) => x !== fam) }) });
  if (filters.playType) chips.push({ key: "type", label: <span className="caps">{playTypeInfo(filters.playType).long}</span>, color: playTypeInfo(filters.playType).color, remove: () => set({ playType: undefined }) });
  for (const id of filters.categories ?? []) {
    const c = concepts?.categories.find((x) => x.id === id);
    chips.push({ key: `cat:${id}`, label: c?.name ?? id, color: c?.color, remove: () => set({ categories: filters.categories!.filter((x) => x !== id) }) });
  }
  for (const c of filters.readConcepts ?? []) chips.push({ key: `rc:${c}`, label: `Concept: ${c}`, remove: () => set({ readConcepts: filters.readConcepts!.filter((x) => x !== c) }) });
  for (const r of filters.routes ?? []) chips.push({ key: `rt:${r}`, label: `Has ${r}`, remove: () => set({ routes: filters.routes!.filter((x) => x !== r) }) });
  if (filters.availability && filters.availability !== "all")
    chips.push({ key: "avail", label: filters.availability === "global" ? "Works Without Mod" : "Needs Mod", color: filters.availability === "needsMod" ? "var(--amber)" : undefined, remove: () => set({ availability: undefined }) });
  if (filters.source && filters.source !== "all") chips.push({ key: "source", label: filters.source === "custom" ? "Custom" : "Stock", remove: () => set({ source: undefined }) });
  if (filters.favoritesOnly) chips.push({ key: "fav", label: "★ Favorites Only", remove: () => set({ favoritesOnly: undefined }) });

  const side = personal ? "All Sides" : filters.side === "offense" ? "Offense" : filters.side === "defense" ? "Defense" : "Special Teams";
  return (
    <div className={s.chips}>
      <span className={s.sideLabel}>{side}</span>
      {chips.map((c) => (
        <Chip key={c.key} color={c.color} onRemove={c.remove}>
          {c.label}
        </Chip>
      ))}
      {query.trim() && (
        <Chip icon="search" onRemove={() => useLibraryUi.getState().set({ query: "" })}>
          “{query.trim()}”
        </Chip>
      )}
      {(chips.length > 0 || query.trim()) && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            useLibraryUi.getState().clearFilters();
            useLibraryUi.getState().set({ query: "" });
          }}
        >
          Clear All
        </Button>
      )}
    </div>
  );
}

function NoResults({ tab, query, filters }: { tab: LibTab; query: string; filters: PlayFilters }) {
  const any = activeFilterCount(filters) > 0 || !!query.trim();
  if (tab === "favorites" && !any)
    return <EmptyState icon="star" title="No Favorites Yet" body="Select a play and click ☆ Favorite (or right-click a card) to keep it here." className={s.empty} />;
  if (tab === "recent" && !any) return <EmptyState icon="refresh" title="Nothing Opened Yet" body="Plays you open show up here, most recent first." className={s.empty} />;
  return (
    <EmptyState
      icon="search"
      title="No plays match"
      body={query.trim() ? `Nothing matches “${query.trim()}” with these filters.` : "These filters leave nothing. Remove one or clear them all."}
      action={
        <Button
          variant="primary"
          onClick={() => {
            useLibraryUi.getState().clearFilters();
            useLibraryUi.getState().set({ query: "" });
          }}
        >
          Clear Search & Filters
        </Button>
      }
      className={s.empty}
    />
  );
}

// ───────────────────────────── selected play actions ─────────────────────────────

function SelectionActions({ entry, favorite, onOpen }: { entry: SearchEntry; favorite: boolean; onOpen(): void }) {
  const catalog = useCatalog();
  const p = entry.play;
  const design = designerAction(p);
  return (
    <div className={s.selection} aria-label="Selected play">
      <span className={s.selInfo} title={p.asset}>
        <PlayTypeTag playType={p.playType} size="sm" />
        <span className={s.selName}>{p.name}</span>
        <span className={s.selSub}>{cardSubtitle(p, catalog)}</span>
      </span>
      <Button size="sm" variant="primary" icon="external" onClick={onOpen}>
        Open
      </Button>
      <Button size="sm" variant="secondary" icon="plus" onClick={() => openAddToPlaybook(p.key)}>
        Add to Playbook
      </Button>
      <Button size="sm" variant="secondary" icon={p.source === "custom" ? "route" : "duplicate"} disabled={!design.enabled} title={design.title} onClick={design.run}>
        {design.label}
      </Button>
      <Button size="sm" variant="secondary" icon={favorite ? "starFilled" : "star"} active={favorite} onClick={() => toggleFavorite(p)}>
        {favorite ? "Favorited" : "Favorite"}
      </Button>
    </div>
  );
}

/** A formation in the Browse tab: its sets with the number of plays that match the search and filters. */
interface BrowseFormation {
  asset: string;
  name: string;
  count: number;
  sets: Map<string, { asset: string; name: string; count: number }>;
}
