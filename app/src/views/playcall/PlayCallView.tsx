// Play-call preview (#/playcall/<playbook path>): the playbook on Madden 27's own play-select screen (see GameScreen.tsx
// for the layout and gameScreenModel.ts for the flow): formation list, set bar with formation dots, play cards three at
// a time. Mouse, keyboard (↑ ↓ ← → Enter Esc, PgUp / PgDn for tabs) and controller all work. Picking a play opens the
// pre-snap view, where the play runs. View state that other places link to lives in the URL: tab, play (the open
// pre-snap play) and flip. "sets": "template" sections open read-only once the template save is read (state/template.ts).
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useActions } from "../../input/actions";
import { usePadHandler, type PadPress } from "../../input/gamepad";
import type { PlaybookSpec, ResolvedPlay } from "../../model/types";
import { CONCEPTS_PATH } from "../../model/conceptsDoc";
import { useCatalog, useLibrary } from "../../state/library";
import { getRoute, href, navigate, useRoute } from "../../state/router";
import { DEFAULT_PLAYBOOK, useSettings } from "../../state/settings";
import { useDocsOfKind, useWorkspace, type DocEntry } from "../../state/workspace";
import type { ConceptsDoc } from "../../model/types";
import { Button, EmptyState, SearchSelect, Spinner, toast, useHelpTopic, type SearchOption } from "../../ui";
import { GameScreen, type HintItem } from "./GameScreen";
import {
  describe,
  initialState,
  openCards,
  closeCards,
  randomPlay,
  selectRow,
  setTab as withTab,
  step,
  stepSet,
  type Ctx,
  type Dir,
  type ScreenState,
} from "./gameScreenModel";
import { bookSummary } from "./bookSummary";
import { PreSnap } from "./PreSnap";
import { PLAYCALL_TABS, conceptGroups, navQuery, parseNav, playsForKeys, typeGroups, type CallNav, type CallPlay, type PlayCallTab } from "./playcallModel";
import { useCallBook } from "./useCallBook";
import s from "./PlayCall.module.css";

const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);

// ───────────────────────────── entry ─────────────────────────────

export function PlayCallView() {
  const route = useRoute();
  const ready = useWorkspace((st) => st.ready);
  const wsError = useWorkspace((st) => st.error);
  const docs = useDocsOfKind<PlaybookSpec>("playbook");
  const lastPlaybook = useSettings((st) => st.lastPlaybook);
  const catalog = useCatalog();
  const path = route.parts[0];
  const doc = path ? docs.find((d) => d.path === path) : undefined;

  // #/playcall → the last opened playbook (or the first one that loads). A routed playbook that no longer exists
  // (renamed / deleted while the tab remembered its route) is replaced the same way instead of a dead end.
  useEffect(() => {
    if (!ready || !docs.length || (path && doc)) return;
    const pick = docs.find((d) => d.path === lastPlaybook && !d.error) ?? docs.find((d) => d.path === DEFAULT_PLAYBOOK && !d.error) ?? docs.find((d) => !d.error) ?? docs[0];
    if (path) toast.info(`${basename(path)} No Longer Exists`, { detail: `Renamed or deleted — showing ${pick.data?.name || basename(pick.path)} instead.`, duration: 3000 });
    navigate(href("playcall", pick.path), { replace: true });
  }, [path, doc, ready, docs, lastPlaybook]);

  const okPath = doc && !doc.error ? doc.path : undefined;
  useEffect(() => {
    if (okPath && useSettings.getState().lastPlaybook !== okPath) useSettings.getState().set({ lastPlaybook: okPath });
  }, [okPath]);

  if (!ready) {
    return (
      <Centered>
        {wsError ? (
          <EmptyState icon="warning" title="Couldn't Load the Workspace" body={wsError} action={<RetryWorkspace />} />
        ) : (
          <div className={s.loading}>
            <Spinner size={22} /> Loading playbooks…
          </div>
        )}
      </Centered>
    );
  }
  if (!catalog) return <NoLibrary />;
  if (!docs.length) return <NoPlaybooks />;
  if (!path || !doc) {
    // Redirect pending (see the effect above).
    return (
      <Centered>
        <Spinner size={22} />
      </Centered>
    );
  }
  return <PlayCallScreen key={path} path={path} doc={doc} docs={docs} catalog={catalog} />;
}

function Centered({ children }: { children: ReactNode }) {
  return <div className={s.centered}>{children}</div>;
}

function RetryWorkspace() {
  return (
    <Button variant="primary" icon="refresh" onClick={() => void useWorkspace.getState().init()}>
      Retry
    </Button>
  );
}

function NoPlaybooks() {
  const go = () => navigate("#/playbook");
  return (
    <Centered>
      <EmptyState
        icon="playcall"
        title="No Playbooks Yet"
        body="Create a playbook in the builder (playbooks/<name>.json), then preview it here exactly like the in-game play-call screen."
        action={
          <Button variant="primary" onClick={go}>
            Open the Playbook Builder
          </Button>
        }
      />
    </Centered>
  );
}

function NoLibrary() {
  const status = useLibrary((st) => st.status);
  const error = useLibrary((st) => st.error);
  const load = () => void useLibrary.getState().load();
  return (
    <Centered>
      <EmptyState
        icon="field"
        title="The Play Library Isn't Loaded"
        body={error ?? "The play-call preview draws every play from data/library. Load it to continue."}
        action={
          <Button variant="primary" loading={status === "loading"} onClick={load}>
            Load Library
          </Button>
        }
      />
    </Centered>
  );
}

// ───────────────────────────── screen ─────────────────────────────

interface ScreenProps {
  path: string;
  doc: DocEntry<PlaybookSpec>;
  docs: DocEntry<PlaybookSpec>[];
  catalog: NonNullable<ReturnType<typeof useCatalog>>;
}

function PlayCallScreen({ path, doc, docs, catalog }: ScreenProps) {
  const route = useRoute();
  const nav = useMemo(() => parseNav(route.query), [route]);
  // The top bar's "?" explains audibles on the Audibles tab.
  useHelpTopic(nav.tab === "audibles" ? "audibles" : undefined);
  const spec = !doc.error && doc.data && typeof doc.data === "object" ? doc.data : undefined;
  const { book, error: bookError } = useCallBook(spec, catalog);

  const conceptsDoc = useWorkspace((st) => (st.docs[CONCEPTS_PATH]?.data ?? null) as ConceptsDoc | null);
  const favKeys = useSettings((st) => st.favorites);
  const recentKeys = useSettings((st) => st.recents);
  const favSet = useMemo(() => new Set(favKeys), [favKeys]);

  const ctx = useMemo<Ctx | undefined>(() => {
    if (!book) return undefined;
    return {
      book,
      concepts: conceptGroups(book, conceptsDoc),
      types: typeGroups(book),
      favorites: playsForKeys(book, favKeys),
      recents: playsForKeys(book, recentKeys),
    };
  }, [book, conceptsDoc, favKeys, recentKeys]);

  const [st, setSt] = useState<ScreenState>(() => initialState(nav.tab));
  const view = useMemo(() => (ctx ? describe(ctx, st) : undefined), [ctx, st]);

  // ── URL: tab, the open pre-snap play and flip (the rest of the state is local) ──
  const update = (fn: (n: CallNav) => CallNav) => {
    const r = getRoute();
    if (r.view !== "playcall" || r.parts[0] !== path) return;
    const target = href("playcall", path) + navQuery(fn(parseNav(r.query)));
    if (target !== r.hash) navigate(target, { replace: true });
  };
  // Following the URL's tab (a link, the back button).
  useEffect(() => {
    setSt((cur) => (cur.tab === nav.tab ? cur : withTab(cur, nav.tab)));
  }, [nav.tab]);

  const toggleFlip = () => update((n) => ({ ...n, flip: !n.flip }));
  const goTab = (tab: PlayCallTab) => {
    setSt((cur) => withTab(cur, tab));
    update((n) => ({ ...n, tab, open: undefined, at: [], page: 0 }));
  };
  const stepTab = (d: 1 | -1) => {
    const ids = PLAYCALL_TABS.map((t) => t.id);
    goTab(ids[(ids.indexOf(st.tab) + d + ids.length) % ids.length]);
  };

  const cardsActive = !!view && view.showCards && (st.tab !== "formation" || st.inPlays);
  const selectedCard: CallPlay | undefined = cardsActive ? view?.cards[st.play] : undefined;

  const toggleFavorite = (item: CallPlay) => {
    const key = item.play?.key;
    if (!key) return;
    const was = useSettings.getState().favorites.includes(key);
    useSettings.getState().toggleFavorite(key);
    if (was) toast.info(`Removed ${item.name} From Favorites`, { duration: 1800 });
    else toast.success(`Added ${item.name} to Favorites`, { duration: 1800 });
  };

  const openPlay = (item: CallPlay) => {
    if (!item.play) {
      toast.warning(`"${item.name}" Didn't Resolve`, { detail: item.problem });
      return;
    }
    useSettings.getState().pushRecent(item.play.key);
    update((n) => ({ ...n, open: item.id }));
  };

  // ── the flow ──
  const move = (dir: Dir) => ctx && setSt((cur) => step(ctx, cur, dir));
  const choose = () => {
    if (!ctx || !view) return;
    if (cardsActive && selectedCard) return openPlay(selectedCard);
    if (st.tab === "formation") {
      const f = view.formation;
      if (f && f.template && f.templateState !== "ready") {
        toast.info(`${f.name}: From the Template Save`, { detail: "Its sets come from the template save, once it has been read.", duration: 3000 });
        return;
      }
      setSt((cur) => openCards(ctx, cur));
    }
  };
  const back = () => {
    if (st.tab === "formation" && st.inPlays) setSt((cur) => closeCards(cur));
    else navigate(href("playbook", path));
  };
  const random = () => ctx && setSt((cur) => randomPlay(ctx, cur));
  const clickCard = (i: number) => {
    if (!ctx || !view) return;
    if (i === st.play && cardsActive) {
      const item = view.cards[i];
      if (item) openPlay(item);
    } else setSt((cur) => ({ ...cur, play: i }));
  };

  // ── pre-snap ──
  const openItem = nav.open ? book?.byId.get(nav.open) : undefined;
  const presnapList = useMemo(() => (view ? view.cards.filter((c) => c.play) : []), [view]);
  const stepList = openItem ? (presnapList.some((x) => x.id === openItem.id) ? presnapList : [openItem]) : [];
  const closePresnap = () => update((n) => ({ ...n, open: undefined }));
  const stepPresnap = (item: CallPlay) => {
    const i = view?.cards.findIndex((c) => c.id === item.id) ?? -1;
    if (i >= 0) setSt((cur) => ({ ...cur, play: i }));
    update((n) => ({ ...n, open: item.id }));
  };

  // ── keys ──
  const browsing = !nav.open;
  useActions("playcall", [
    { id: "left", label: "Left", keys: ["ArrowLeft"], repeat: true, enabled: browsing, run: () => move("LEFT") },
    { id: "right", label: "Right", keys: ["ArrowRight"], repeat: true, enabled: browsing, run: () => move("RIGHT") },
    { id: "up", label: "Up", keys: ["ArrowUp"], repeat: true, enabled: browsing, run: () => move("UP") },
    { id: "down", label: "Down", keys: ["ArrowDown"], repeat: true, enabled: browsing, run: () => move("DOWN") },
    { id: "choose", label: "Select", keys: ["Enter"], enabled: browsing, run: choose },
    { id: "back", label: "Back", keys: ["Escape"], enabled: browsing, run: back },
    { id: "tab-prev", label: "Previous tab", keys: ["PageUp"], enabled: browsing, run: () => stepTab(-1) },
    { id: "tab-next", label: "Next tab", keys: ["PageDown"], enabled: browsing, run: () => stepTab(1) },
  ]);

  // ── controller: the d-pad / left stick move, A selects, B backs out, LB / RB tabs, X flips, Y a random play ──
  usePadHandler(
    {
      press: (p: PadPress) => {
        if (nav.open) return false; // the pre-snap view owns the pad
        switch (p.button) {
          case "UP":
          case "DOWN":
          case "LEFT":
          case "RIGHT":
            move(p.button);
            return true;
          case "A":
            choose();
            return true;
          case "B":
            back();
            return true;
          case "LB":
            stepTab(-1);
            return true;
          case "RB":
            stepTab(1);
            return true;
          case "X":
            toggleFlip();
            return true;
          case "Y":
            if (selectedCard) toggleFavorite(selectedCard);
            else random();
            return true;
          default:
            return false;
        }
      },
    },
    { priority: 10 },
  );

  const hints: HintItem[] = [
    ...(st.tab === "formation" && st.inPlays ? [{ id: "back", label: "Back", pad: ["B" as const], key: "Esc", onClick: back }] : []),
    { id: "select", label: cardsActive ? "Call Play" : "Select", pad: ["A"], key: "Enter", onClick: choose },
    { id: "flip", label: nav.flip ? "Unflip Plays" : "Flip Plays", pad: ["X"], onClick: toggleFlip },
    { id: "random", label: "Random Play", pad: ["Y"], onClick: random },
    { id: "tabs", label: "Tabs", pad: ["LB", "RB"], key: "PgUp", onClick: () => stepTab(1) },
  ];

  const wheel = (d: 1 | -1, list: boolean) => {
    if (!ctx || !view) return;
    if (list) return setSt((cur) => selectRow(cur, (view.row + d + Math.max(1, view.rows.length)) % Math.max(1, view.rows.length)));
    if (cardsActive) return move(d === 1 ? "RIGHT" : "LEFT");
    if (st.tab === "formation" || st.tab === "audibles") setSt((cur) => stepSet(ctx, cur, d));
  };

  const bookName = spec?.name || basename(doc.path);
  return (
    <div className={s.page}>
      <header className={s.top}>
        <div className={s.topLeft}>
          <Button variant="ghost" icon="chevronLeft" onClick={() => navigate(href("playbook", path))} title="Back to this playbook in the builder">
            Back to Playbook
          </Button>
          <BookSelect docs={docs} path={path} />
        </div>
        <div className={s.topRight}>
          <Button size="sm" variant="secondary" icon="grid" onClick={() => navigate(href("overview", path))} title="The whole playbook on one wall">
            Overview
          </Button>
          <Button size="sm" variant="secondary" icon="flip" active={nav.flip} onClick={toggleFlip} title="Mirror every play (plays that can't flip stay as they are)">
            {nav.flip ? "Flipped" : "Flip Plays"}
          </Button>
          <div className={s.count} aria-live="polite">
            <span className={s.countNum}>{book?.plays.length ?? 0}</span>
            <span className={s.countLabel}>Plays</span>
          </div>
        </div>
      </header>

      {doc.error || bookError || !spec ? (
        <Centered>
          <EmptyState
            icon="warning"
            title={`${bookName} Can't Be Previewed`}
            body={doc.error ?? bookError ?? "The file isn't a playbook spec."}
            action={
              <Button variant="secondary" onClick={() => navigate(href("playbook", path))}>
                Open in the Playbook Builder
              </Button>
            }
          />
        </Centered>
      ) : ctx && view ? (
        <GameScreen
          bookName={bookName}
          defense={spec.side === "defense"}
          st={st}
          view={view}
          flip={nav.flip}
          favorites={favSet}
          hints={hints}
          onTab={goTab}
          onRow={(i) => setSt((cur) => selectRow(cur, i))}
          onSetStep={(d) => setSt((cur) => stepSet(ctx, cur, d))}
          onOpenSet={choose}
          onCard={clickCard}
          onToggleFavorite={toggleFavorite}
          onWheelStep={wheel}
        />
      ) : null}

      {openItem?.play && (
        <PreSnap
          item={openItem as CallPlay & { play: ResolvedPlay }}
          list={stepList}
          bookPath={path}
          flip={nav.flip}
          onFlip={toggleFlip}
          onStep={stepPresnap}
          onClose={closePresnap}
        />
      )}
    </div>
  );
}

// ───────────────────────────── header pieces ─────────────────────────────

function BookSelect({ docs, path }: { docs: DocEntry<PlaybookSpec>[]; path: string }) {
  const options = useMemo<SearchOption[]>(
    () =>
      docs.map((d) => ({
        value: d.path,
        label: d.data?.name || basename(d.path),
        hint: d.error ? "Can't be read" : bookSummary(d.data),
        disabled: !!d.error,
        keywords: d.path,
      })),
    [docs],
  );
  return (
    <div className={s.book}>
      <div className={s.bookText}>
        <span className={s.bookEyebrow}>Playbook</span>
        <SearchSelect
          value={path}
          options={options}
          onChange={(v) => v !== path && navigate(href("playcall", v))}
          renderValue={(o, v) => <span className={s.bookValue}>{o?.label ?? (v ? basename(v) : "")}</span>}
          size="sm"
          width={210}
          menuWidth={360}
          placeholder="Choose playbook"
          searchPlaceholder="Search playbooks…"
          className={s.bookSelect}
          aria-label="Playbook"
        />
      </div>
    </div>
  );
}
