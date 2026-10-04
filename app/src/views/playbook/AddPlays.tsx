// "Add plays" drawer: search the library — one set, every set of this playbook's formations, or the whole library
// (custom sets and their cloned plays included, via the catalog overlay) — pick cards and add them. Plays land in the
// matching set of the playbook (formation and set entries are created when needed); cards can also be dragged onto a
// set in the tree. Plays the playbook can't take (addPlayProblem: not addressable by name, or their formation is a
// template section — convert it first) are dimmed with the reason.
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { ActionLayer, useActions } from "../../input/actions";
import { formationShort } from "../../model/names";
import { addPlayProblem } from "../../model/playbookOps";
import { PLAY_FAMILIES, familyColor, familyLabel, playTypeInfo, type PlayFamily } from "../../model/playtypes";
import type { FormationDef, PlayKey, ResolvedPlay } from "../../model/types";
import { PlayCard } from "../../field";
import { useSettings } from "../../state/settings";
import { Button, Chip, EmptyState, IconButton, SearchSelect, Segmented, TextInput, Toggle, VirtualGrid, type SearchOption } from "../../ui";
import { CategoryChips, CategoryDots, playCategories, useCategoryFilter, useConcepts } from "./categories";
import { useBuilder, useDragHandlers } from "./context";
import { beginDrag } from "./dnd";
import { addPlays } from "./ops";
import { levelOf, parentOf, useBuilderUi } from "./store";
import s from "./AddPlays.module.css";

type Scope = "set" | "book" | "library";

const MIN_CELL_W = 220;
const GAP = 14;
const PAD = 16;
/** Whole-library results show once the search has this many characters (thousands of plays otherwise). */
const LIBRARY_MIN_QUERY = 2;

const OFFENSE_TYPES = new Set(["FormationType_Offense", "FormationType_Kickoff", "FormationType_SafetyKickoff"]);
const DEFENSE_TYPES = new Set(["FormationType_Defense", "FormationType_KickReturn", "FormationType_Safety_KickReturn"]);

/** Card cells that fill the drawer width (VirtualGrid needs fixed sizes; the card height follows its width). */
function useCellSize(): [(el: HTMLDivElement | null) => void, number, number] {
  const [w, setW] = useState(0);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect();
    if (!el) return;
    ro.current = new ResizeObserver(() => setW(el.clientWidth));
    ro.current.observe(el);
    setW(el.clientWidth);
  }, []);
  const inner = Math.max(MIN_CELL_W, w - PAD * 2 - 10);
  const cols = Math.max(1, Math.floor((inner + GAP) / (MIN_CELL_W + GAP)));
  const cellW = Math.floor((inner - GAP * (cols - 1)) / cols);
  return [ref, cellW, Math.round(cellW / 2.15) + 54];
}

export function AddPlaysDrawer() {
  const data = useBuilder();
  const close = () => useBuilderUi.getState().setDrawer(false);
  const cursor = useBuilderUi((st) => st.cursor);
  const hideMinigames = useSettings((st) => st.hideMinigames);

  // The set the selection is in (if any).
  const cursorSet = useMemo(() => {
    const lvl = levelOf(cursor);
    const id = lvl === "set" ? cursor : lvl === "play" ? parentOf(cursor) : undefined;
    return id ? data.nodes.get(id)?.rs?.set : undefined;
  }, [cursor, data.nodes]);

  // Formations on the book's side: this playbook's explicit formations first, then the rest of the library.
  const formations = useMemo(() => {
    const lib = data.lib;
    const inBook: FormationDef[] = [];
    const seen = new Set<string>();
    for (const rf of data.book.formations) {
      if (rf.template || !rf.formation || seen.has(rf.formation.asset)) continue;
      seen.add(rf.formation.asset);
      inBook.push(rf.formation);
    }
    const rest = lib.data.formations.filter((f) => {
      if (seen.has(f.asset)) return false;
      const side = lib.formationSide(f);
      const ok = side === data.side || (side === "special" && (data.side === "offense" ? OFFENSE_TYPES : DEFENSE_TYPES).has(f.type));
      return ok && !(hideMinigames && lib.isMinigame(f));
    });
    return { inBook, rest };
  }, [data.book, data.lib, data.side, hideMinigames]);

  const setOptions = useMemo<SearchOption[]>(() => {
    const out: SearchOption[] = [];
    const add = (f: FormationDef, group: string) => {
      for (const set of data.lib.setsByFormation.get(f.asset) ?? []) {
        const custom = data.custom.set(set.asset);
        out.push({
          value: set.asset,
          label: `${formationShort(f.name)} ${set.name}`,
          group,
          hint: `${custom ? "custom set · " : ""}${data.catalog.playsInSet(set.asset).length}`,
        });
      }
    };
    for (const f of formations.inBook) add(f, `In this playbook · ${f.name}`);
    for (const f of [...formations.rest].sort((a, b) => a.name.localeCompare(b.name))) add(f, data.custom.formation(f.asset) ? `Custom · ${f.name}` : f.name);
    return out;
  }, [formations, data.lib, data.catalog, data.custom]);

  const [scope, setScope] = useState<Scope>(cursorSet ? "set" : formations.inBook.length ? "book" : "library");
  const [setAsset, setSetAsset] = useState<string | undefined>(cursorSet?.asset ?? (setOptions[0]?.value as string | undefined));
  useEffect(() => {
    if (cursorSet) setSetAsset(cursorSet.asset);
  }, [cursorSet]);
  const [query, setQuery] = useState("");
  const [families, setFamilies] = useState<PlayFamily[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [hideIn, setHideIn] = useState(false);
  const concepts = useConcepts();
  const [picked, setPicked] = useState<PlayKey[]>([]);
  const [focus, setFocus] = useState(-1);
  const anchor = useRef<number | undefined>(undefined);
  const [sizeRef, cellW, cellH] = useCellSize();

  const inBook = useMemo(() => {
    const m = new Set<PlayKey>();
    for (const rf of data.book.formations) for (const rs of rf.sets) for (const rp of rs.plays) if (rp.play) m.add(rp.play.key);
    return m;
  }, [data.book]);

  const terms = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query]);
  const libraryWaiting = scope === "library" && query.trim().length < LIBRARY_MIN_QUERY;
  const source = useMemo<ResolvedPlay[]>(() => {
    if (scope === "set") return setAsset ? data.catalog.playsInSet(setAsset) : [];
    const list = scope === "book" ? formations.inBook : [...formations.inBook, ...formations.rest];
    if (scope === "library" && libraryWaiting) return [];
    const out: ResolvedPlay[] = [];
    for (const f of list) for (const set of data.lib.setsByFormation.get(f.asset) ?? []) out.push(...data.catalog.playsInSet(set.asset));
    return out;
  }, [scope, setAsset, formations, data.catalog, data.lib, libraryWaiting]);
  // Text search + "hide added" first; the family / concept chips count what's left, then filter it.
  const searched = useMemo(() => {
    return source.filter((p) => {
      if (hideIn && inBook.has(p.key)) return false;
      if (!terms.length) return true;
      const hay = `${p.name} ${data.lib.setByAsset.get(p.set)?.name ?? ""} ${data.lib.formationByAsset.get(p.formation)?.name ?? ""}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [source, terms, hideIn, inBook, data.lib]);
  const famCounts = useMemo(() => {
    const m = new Map<PlayFamily, number>();
    for (const p of searched) {
      const f = playTypeInfo(p.playType).family;
      m.set(f, (m.get(f) ?? 0) + 1);
    }
    return m;
  }, [searched]);
  const searchedKeys = useMemo(() => searched.map((p) => p.key), [searched]);
  const catFilter = useCategoryFilter(concepts, searchedKeys, cats);
  const plays = useMemo(
    () => searched.filter((p) => (!families.length || families.includes(playTypeInfo(p.playType).family)) && catFilter.test(p.key)),
    [searched, families, catFilter],
  );

  // Per-render-input cache (a fresh map whenever the book, catalog or side changes — never a stale answer).
  const problemCache = useMemo(() => new Map<PlayKey, string | undefined>(), [data.catalog, data.side, data.spec, data.template.contents]);
  const problemOf = (key: PlayKey) => {
    // addPlayProblem = the name rule plus "its formation is a template section of this book" (what addPlays enforces).
    if (!problemCache.has(key)) problemCache.set(key, addPlayProblem(data.spec, data.catalog, key, { template: data.template.contents }));
    return problemCache.get(key);
  };
  const pickable = (p: ResolvedPlay) => !inBook.has(p.key) && !problemOf(p.key);

  const pickedSet = useMemo(() => new Set(picked), [picked]);
  const toggle = (i: number, e?: { shiftKey?: boolean }) => {
    const p = plays[i];
    if (!p) return;
    if (e?.shiftKey && anchor.current !== undefined) {
      const [a, b] = anchor.current < i ? [anchor.current, i] : [i, anchor.current];
      const range = plays.slice(a, b + 1).filter(pickable).map((x) => x.key);
      setPicked((cur) => [...new Set([...cur, ...range])]);
      return;
    }
    anchor.current = i;
    if (!pickable(p)) return;
    setPicked((cur) => (cur.includes(p.key) ? cur.filter((k) => k !== p.key) : [...cur, p.key]));
  };
  const add = () => {
    if (!picked.length) return;
    const n = addPlays(data, picked);
    if (n) setPicked([]);
  };
  const selectAll = () => setPicked((cur) => [...new Set([...cur, ...plays.filter(pickable).map((p) => p.key)])]);

  const token = useActions(
    "playbook.drawer",
    [
      // Esc in the (auto-focused) search clears it first (TextInput handles that), then closes.
      { id: "close", label: "Close", keys: ["Escape"], allowInInput: true, run: close },
      { id: "add", label: "Add the selected plays", keys: ["mod+Enter"], allowInInput: true, enabled: picked.length > 0, run: add },
    ],
    { modal: true },
  );

  const drag = useDragHandlers();
  const onPointerDown = (p: ResolvedPlay, e: PointerEvent) => {
    beginDrag(
      e,
      () => {
        const keys = pickedSet.has(p.key) ? picked : [p.key];
        const ok = keys.filter((k) => !inBook.has(k) && !problemOf(k));
        if (!ok.length) return undefined;
        return { kind: "library", refs: [], keys: ok, label: ok.length === 1 ? (data.catalog.get(ok[0])?.name ?? "Play") : `${ok.length} plays`, count: ok.length };
      },
      drag,
    );
  };

  const setLabel = setAsset ? setOptions.find((x) => x.value === setAsset)?.label : undefined;
  const setIsCustom = scope === "set" && data.custom.set(setAsset);
  const searchPlaceholder =
    scope === "set" ? `Search ${setLabel ?? "this set"}` : scope === "book" ? "Search every set of this playbook's formations" : "Type a play name, e.g. Mesh, Four Verticals…";

  return (
    <aside className={s.drawer} role="dialog" aria-label="Add plays">
      <ActionLayer token={token}>
        <header className={s.head}>
          <div className={s.titles}>
            <div className={s.eyebrow}>Step 2 · from the library</div>
            <h2 className={s.title}>Add plays</h2>
          </div>
          <Segmented<Scope>
            size="sm"
            value={scope}
            onChange={setScope}
            options={[
              { value: "set", label: "One set", title: "Plays of one set" },
              { value: "book", label: "My formations", disabled: !formations.inBook.length, title: "Every set of the formations in this playbook" },
              { value: "library", label: "Whole library", title: "Every formation on this side of the ball" },
            ]}
            aria-label="Where to search"
          />
          <IconButton icon="close" title="Close (Esc)" onClick={close} />
        </header>
        <div className={s.filters}>
          {scope === "set" && (
            <SearchSelect
              value={setAsset}
              onChange={setSetAsset}
              options={setOptions}
              placeholder="Pick a set"
              renderValue={(o) => (o ? <span className={s.setValue}>{o.label}</span> : undefined)}
              searchPlaceholder="Search sets…"
              size="sm"
              width={260}
              menuWidth={360}
              aria-label="Set"
            />
          )}
          {setIsCustom && <span className={s.customTag}>Custom set</span>}
          <TextInput value={query} onChange={setQuery} placeholder={searchPlaceholder} icon="search" clearable size="sm" autoFocus wrapperClassName={s.search} aria-label="Search plays" />
          <Toggle size="sm" checked={hideIn} onChange={setHideIn} label="Hide plays already added" />
        </div>
        <div className={s.chips}>
          {PLAY_FAMILIES.filter((f) => famCounts.has(f)).map((f) => (
            <Chip key={f} active={families.includes(f)} color={familyColor(f)} count={famCounts.get(f)} onClick={() => setFamilies((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]))}>
              {familyLabel(f)}
            </Chip>
          ))}
          <span className={s.count}>{libraryWaiting ? "" : `${plays.length} plays`}</span>
        </div>
        <CategoryChips filter={catFilter} active={cats} onChange={setCats} className={s.catChips} />
        {libraryWaiting ? (
          <div className={s.gridWrap}>
            <EmptyState icon="search" title="Search the whole library" body="Type at least two letters of a play name. Plays from formations that aren't in this playbook yet are added with their formation and set." />
          </div>
        ) : (
          <div ref={sizeRef} className={s.gridWrap}>
            <VirtualGrid
              className={s.grid}
              count={plays.length}
              cellWidth={cellW}
              cellHeight={cellH}
              gap={GAP}
              padding={PAD}
              selectedIndex={Math.min(focus, plays.length - 1)}
              onSelect={setFocus}
              onActivate={(i) => toggle(i)}
              getKey={(i) => plays[i].key}
              padEnd={24}
              aria-label="Library plays"
              empty={<EmptyState compact icon="search" title="No plays match" body={scope === "set" ? "Try another set, or search the whole library." : "Try fewer words."} />}
              renderCell={(i) => {
                const p = plays[i];
                const problem = problemOf(p.key);
                const isIn = inBook.has(p.key);
                const pc = playCategories(concepts, p.key);
                const customSet = scope !== "set" && data.custom.set(p.set);
                return (
                  <div className={s.cell} onPointerDown={(e) => onPointerDown(p, e)} title={problem ?? (isIn ? "Already in this playbook" : "Click to select · drag onto a set in the tree")}>
                    <PlayCard
                      play={p}
                      size="sm"
                      selected={pickedSet.has(p.key)}
                      muted={isIn || !!problem}
                      badges={
                        pc.length || isIn || problem || customSet ? (
                          <>
                            <CategoryDots cats={pc} className={s.cardDots} />
                            {customSet && <span className={s.customBadge}>Custom set</span>}
                            {isIn ? <span className={s.inBook}>Added</span> : problem ? <span className={s.blocked}>Can't add</span> : null}
                          </>
                        ) : undefined
                      }
                      onClick={(e: MouseEvent) => toggle(i, e)}
                    />
                  </div>
                );
              }}
            />
          </div>
        )}
        <footer className={s.foot}>
          <span className={s.picked}>{picked.length ? `${picked.length} selected` : "Click cards to select them, or drag one onto a set in the tree"}</span>
          {plays.length > 0 && (
            <Button size="sm" variant="ghost" onClick={selectAll}>
              Select all
            </Button>
          )}
          {picked.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setPicked([])}>
              Clear
            </Button>
          )}
          <Button variant="primary" icon="plus" disabled={!picked.length} onClick={add}>
            Add {picked.length || ""} play{picked.length === 1 ? "" : "s"}
          </Button>
        </footer>
      </ActionLayer>
    </aside>
  );
}
