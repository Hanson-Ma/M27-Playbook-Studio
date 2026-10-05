// Play-call preview (#/playcall/<playbook path>): the playbook as the Madden 27 play-call screen, driven by the mouse.
// Tabs Formation · Concept · Play Type · Audibles · Favorites · Recent, three cards per page (click a card to drill in
// or open the play; the ☆ on a card favorites it), ‹ › arrows / dots / the wheel page, breadcrumbs and Back go up a
// level, "Back to Playbook" returns to the builder. Picking a play opens the full-screen pre-snap view. Arrow keys
// page while the stage has focus. View state lives in the URL query (tab, at, pg, play, flip) — see playcallModel.ts.
// "sets": "template" sections open read-only once the template save is read (state/template.ts).
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode, type WheelEvent } from "react";
import type { Catalog } from "../../model/catalog";
import { CONCEPTS_PATH } from "../../model/conceptsDoc";
import { resolvePlaybook, type BookCounts } from "../../model/resolveBook";
import type { ConceptsDoc, PlaybookSpec, ResolvedPlay } from "../../model/types";
import { useCatalog, useLibrary } from "../../state/library";
import { getRoute, href, navigate, useRoute } from "../../state/router";
import { useSettings } from "../../state/settings";
import { useTemplate } from "../../state/template";
import { useDocsOfKind, useWorkspace, type DocEntry } from "../../state/workspace";
import { Button, EmptyState, Icon, SearchSelect, Select, Spinner, TabBar, Tag, cx, toast, useHelpTopic, type SearchOption, type TabItem } from "../../ui";
import { AudibleDiamond } from "./AudibleDiamond";
import { FormationTile, GroupTile, PlaySlot, SetTile, missingTemplateText } from "./CallTiles";
import { bookSummary } from "./bookSummary";
import { PreSnap } from "./PreSnap";
import {
  PAGE_SIZE,
  PLAYCALL_TABS,
  buildCallBook,
  canOpenFormation,
  clampPage,
  conceptGroups,
  pageCount,
  pageOf,
  pageSlice,
  parentOf,
  parseNav,
  navQuery,
  playsForKeys,
  presnapList,
  resolveLevel,
  typeGroups,
  type CallBook,
  type CallContext,
  type CallFormation,
  type CallGroup,
  type CallLevel,
  type CallNav,
  type CallPlay,
  type CallSet,
  type PlayCallTab,
  type TemplateSource,
} from "./playcallModel";
import s from "./PlayCall.module.css";

const MAX_DOTS = 18;
/** The default playbook (settings.lastPlaybook falls back to it): STUDIO. */
const DEFAULT_BOOK = "playbooks/studio-test.json";

const TAB_ITEMS: TabItem<PlayCallTab>[] = PLAYCALL_TABS.map((t) => ({ id: t.id, label: t.label }));

/** Last drill-down per playbook + tab, so LT/RT round-trips land where you were. */
const tabMemory = new Map<string, { at: string[]; page: number }>();

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
    const pick =
      docs.find((d) => d.path === lastPlaybook && !d.error) ?? docs.find((d) => d.path === DEFAULT_BOOK && !d.error) ?? docs.find((d) => !d.error) ?? docs[0];
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
  return <PlayCallScreen path={path} doc={doc} docs={docs} catalog={catalog} />;
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

type Anim = "in" | "out" | "next" | "prev" | "tab";

interface ScreenProps {
  path: string;
  doc: DocEntry<PlaybookSpec>;
  docs: DocEntry<PlaybookSpec>[];
  catalog: Catalog;
}

function useCallBook(spec: PlaybookSpec | undefined, catalog: Catalog): { book?: CallBook; counts?: BookCounts; error?: string } {
  // Template sections fill in once the template save is read (it loads once per library).
  const contents = useTemplate().contents;
  return useMemo(() => {
    if (!spec) return {};
    try {
      const resolved = resolvePlaybook(spec, catalog, { template: contents });
      const template: TemplateSource | undefined = contents ? { contents, lib: catalog.lib } : undefined;
      return { book: buildCallBook(resolved, template), counts: resolved.counts };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [spec, catalog, contents]);
}

function PlayCallScreen({ path, doc, docs, catalog }: ScreenProps) {
  const route = useRoute();
  const nav = useMemo(() => parseNav(route.query), [route]);
  // The top bar's "?" explains audibles on the Audibles tab.
  useHelpTopic(nav.tab === "audibles" ? "audibles" : undefined);
  const spec = !doc.error && doc.data && typeof doc.data === "object" ? doc.data : undefined;
  const { book, counts, error: bookError } = useCallBook(spec, catalog);

  const conceptsDoc = useWorkspace((st) => (st.docs[CONCEPTS_PATH]?.data ?? null) as ConceptsDoc | null);
  const favKeys = useSettings((st) => st.favorites);
  const recentKeys = useSettings((st) => st.recents);

  const concepts = useMemo(() => (book ? conceptGroups(book, conceptsDoc) : undefined), [book, conceptsDoc]);
  const types = useMemo(() => (book ? typeGroups(book) : undefined), [book]);
  const favorites = useMemo(() => (book ? playsForKeys(book, favKeys) : []), [book, favKeys]);
  const recents = useMemo(() => (book ? playsForKeys(book, recentKeys) : []), [book, recentKeys]);
  const favSet = useMemo(() => new Set(favKeys), [favKeys]);
  const ctx = useMemo<CallContext | undefined>(
    () => (book && concepts && types ? { book, concepts, types, favorites, recents } : undefined),
    [book, concepts, types, favorites, recents],
  );
  const level = useMemo(() => (ctx ? resolveLevel(ctx, nav.tab, nav.at) : undefined), [ctx, nav.tab, nav.at]);

  const isAud = level?.kind === "audibles";
  const perPage = isAud ? 1 : PAGE_SIZE;
  const total = level?.items.length ?? 0;
  const pages = pageCount(total, perPage);
  const page = clampPage(nav.page, total, perPage);
  const pageItems = useMemo(() => (level ? pageSlice<unknown>(level.items, page, perPage) : []), [level, page, perPage]);
  const audSet = isAud ? (pageItems[0] as CallSet | undefined) : undefined;

  const [cursor, setCursor] = useState<string>();
  const [anim, setAnim] = useState<Anim>("in");
  const levelKey = `${nav.tab}|${level?.at.join("/") ?? ""}`;

  // ── navigation (always from the live route, so rapid clicks never use a stale render) ──
  const update = (fn: (n: CallNav) => CallNav) => {
    const r = getRoute();
    if (r.view !== "playcall" || r.parts[0] !== path) return;
    const target = href("playcall", path) + navQuery(fn(parseNav(r.query)));
    if (target !== r.hash) navigate(target, { replace: true });
  };

  const goPage = (p: number) => {
    if (pages < 2) return;
    const nextPage = ((p % pages) + pages) % pages;
    setAnim(p > page ? "next" : "prev");
    update((n) => ({ ...n, page: nextPage }));
  };

  const setTab = (tab: PlayCallTab) => {
    update((n) => {
      if (n.tab === tab) return n;
      tabMemory.set(`${path}|${n.tab}`, { at: n.at, page: n.page });
      const m = tabMemory.get(`${path}|${tab}`);
      return { ...n, tab, at: m?.at ?? [], page: m?.page ?? 0, open: undefined };
    });
    setAnim("tab");
    setCursor(undefined);
  };

  const template = useTemplate();
  const drill = (item: CallFormation | CallSet | CallGroup) => {
    if (!level) return;
    if (level.kind === "formations") {
      const f = item as CallFormation;
      if (!canOpenFormation(f)) {
        if (f.templateState === "missing") toast.warning(`${f.name}: Not in the Template Save`, { detail: missingTemplateText(f), duration: 5000 });
        else if (template.status === "error") toast.error("Couldn't Read the Template Save", { detail: template.error, duration: 4000 });
        else toast.info(`Loading ${f.name} From the Template Save…`, { duration: 2000 });
        return;
      }
      setCursor(f.id);
      setAnim("in");
      update((n) => ({ ...n, at: [f.id], page: 0 }));
    } else if (level.kind === "sets") {
      const st = item as CallSet;
      setCursor(st.id);
      setAnim("in");
      update((n) => ({ ...n, at: [String(st.f), String(st.s)], page: 0 }));
    } else if (level.kind === "groups") {
      setCursor((item as CallGroup).id);
      setAnim("in");
      update((n) => ({ ...n, at: [(item as CallGroup).id], page: 0 }));
    }
  };

  const back = () => {
    if (!ctx || !level) return;
    const parent = parentOf(ctx, nav.tab, level.at);
    if (!parent) return;
    setCursor(nav.tab === "formation" ? level.at.join(".") : level.at[0]);
    setAnim("out");
    update((n) => ({ ...n, at: parent.at, page: parent.page }));
  };

  const goCrumb = (target: string[]) => {
    if (!ctx || !level || target.length >= level.at.length) return;
    let at = level.at;
    let pg = 0;
    while (at.length > target.length) {
      const p = parentOf(ctx, nav.tab, at);
      if (!p) break;
      at = p.at;
      pg = p.page;
    }
    setCursor(nav.tab === "formation" ? level.at.slice(0, target.length + 1).join(".") : level.at[0]);
    setAnim("out");
    update((n) => ({ ...n, at, page: pg }));
  };

  const toggleFlip = () => update((n) => ({ ...n, flip: !n.flip }));

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
    setCursor(item.id);
    update((n) => ({ ...n, open: item.id }));
  };

  // ── pre-snap ──
  const openItem = nav.open ? book?.byId.get(nav.open) : undefined;
  const presnapItems = useMemo(() => (level ? presnapList(level, page) : []), [level, page]);
  const stepList = openItem ? (presnapItems.some((x) => x.id === openItem.id) ? presnapItems : [openItem]) : [];

  const closePresnap = () => {
    if (!openItem) return update((n) => ({ ...n, open: undefined }));
    setCursor(openItem.id);
    const idx = level?.kind === "plays" ? level.items.indexOf(openItem) : -1;
    update((n) => ({ ...n, open: undefined, page: idx >= 0 ? pageOf(idx) : n.page }));
  };
  const stepPresnap = (item: CallPlay) => {
    setCursor(item.id);
    update((n) => ({ ...n, open: item.id }));
  };

  // Trackpad / wheel pages (throttled), like flicking the stick.
  const [wheel] = useState(() => ({ acc: 0, at: 0 }));
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (pages < 2 || nav.open) return;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const now = performance.now();
    if (now - wheel.at < 380) return;
    wheel.acc += d;
    if (Math.abs(wheel.acc) >= 60) {
      goPage(page + (wheel.acc > 0 ? 1 : -1));
      wheel.acc = 0;
      wheel.at = now;
    }
  };
  // ← → page while the stage (or a card in it) has keyboard focus.
  const onStageKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || pages < 2) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      goPage(page + (e.key === "ArrowRight" ? 1 : -1));
    }
  };

  // ── render ──
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
        <TabBar items={TAB_ITEMS} active={nav.tab} onChange={setTab} className={s.tabs} aria-label="Play call" />
        <div className={s.topRight}>
          <Button size="sm" variant="secondary" icon="flip" active={nav.flip} onClick={toggleFlip} title="Mirror every play (plays that can't flip stay as they are)">
            {nav.flip ? "Flipped" : "Flip Plays"}
          </Button>
          <div className={s.count} aria-live="polite">
            {level ? (
              <>
                <span className={s.countNum}>{level.playCount}</span>
                <span className={s.countLabel}>{isAud ? (level.playCount === 1 ? "Audible" : "Audibles") : level.playCount === 1 ? "Play" : "Plays"}</span>
              </>
            ) : null}
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
      ) : level && ctx ? (
        <>
          <Heading
            level={level}
            nav={nav}
            page={page}
            pages={pages}
            audSet={audSet}
            concepts={ctx.concepts.source}
            bookLabel={`${bookName} · ${spec.side === "defense" ? "Defense" : "Offense"}`}
            onCrumb={goCrumb}
            onBack={back}
            onSetPage={(p) => {
              setAnim(p > page ? "next" : "prev");
              update((n) => ({ ...n, page: p }));
            }}
          />
          <div className={s.stage} data-kind={level.kind} onWheel={onWheel} onKeyDown={onStageKey}>
            {pages > 1 && (
              <button type="button" className={cx(s.arrow, s.arrowLeft)} onMouseDown={(e) => e.preventDefault()} onClick={() => goPage(page - 1)} aria-label="Previous page">
                <Icon name="chevronLeft" size={30} />
              </button>
            )}
            <div className={s.stageCol}>
              <div className={s.stageInner} key={`${levelKey}|${page}`} data-anim={anim}>
                <LevelContent
                  level={level}
                  defense={spec.side === "defense"}
                  tab={nav.tab}
                  pageItems={pageItems}
                  audSet={audSet}
                  flip={nav.flip}
                  favorites={favSet}
                  cursor={cursor}
                  onChoose={(i) => {
                    const it = pageItems[i];
                    if (!it) return;
                    if (level.kind === "plays") openPlay(it as CallPlay);
                    else drill(it as CallFormation | CallSet | CallGroup);
                  }}
                  onOpen={openPlay}
                  onToggleFavorite={(item) => toggleFavorite(item)}
                  bookPath={path}
                />
              </div>
              <Dots page={page} pages={pages} onPage={goPage} />
            </div>
            {pages > 1 && (
              <button type="button" className={cx(s.arrow, s.arrowRight)} onMouseDown={(e) => e.preventDefault()} onClick={() => goPage(page + 1)} aria-label="Next page">
                <Icon name="chevronRight" size={30} />
              </button>
            )}
          </div>
          <Footer counts={counts} />
        </>
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

function Heading({
  level,
  nav,
  page,
  pages,
  audSet,
  concepts,
  bookLabel,
  onCrumb,
  onBack,
  onSetPage,
}: {
  level: CallLevel;
  nav: CallNav;
  page: number;
  pages: number;
  audSet?: CallSet;
  concepts: "tags" | "reads";
  /** "STUDIO · Offense" — the eyebrow at a tab's root level (the playbook name as stored). */
  bookLabel: string;
  onCrumb(at: string[]): void;
  onBack(): void;
  /** Jump to a page (audibles: a set). */
  onSetPage(page: number): void;
}) {
  if (level.kind === "audibles") {
    const n = audSet ? Object.keys(audSet.audibles).length : 0;
    const setOptions = level.items.map((st, i) => ({ value: String(i), label: `${st.formationName} › ${st.name}` }));
    return (
      <div className={s.heading}>
        <div className={s.headLeft}>
          <nav className={s.crumbs} aria-label="Breadcrumb">
            <span>Audibles</span>
            {audSet && (
              <>
                <span className={s.sep}>›</span>
                <span className="caps">{audSet.formationName}</span>
              </>
            )}
          </nav>
          <h1 className={cx(s.title, audSet && "caps")}>{audSet ? audSet.name : "No Sets"}</h1>
        </div>
        <div className={s.headRight}>
          {level.items.length > 1 && (
            <Select size="sm" className={s.setSelect} value={String(page)} options={setOptions} onChange={(v) => onSetPage(Number(v))} aria-label="Jump to a set" />
          )}
          {audSet?.duplicateAudibles.map((sl) => (
            <Tag key={sl} tone="danger" size="sm" icon="warning">
              Audible {sl} Used Twice
            </Tag>
          ))}
          {audSet?.problem && (
            <Tag tone="danger" size="sm" icon="warning">
              {audSet.problem}
            </Tag>
          )}
          <span className={s.headStat}>
            <b>{n}</b>
            <span> / 4</span> Audibles
          </span>
          {level.items.length > 0 && (
            <span className={s.pageNum}>
              Set <b>{page + 1}</b>
              <span> / {pages}</span>
            </span>
          )}
        </div>
      </div>
    );
  }
  const crumbs = level.crumbs;
  const n = level.items.length;
  // Below a tab's root the crumbs and the title are formation / set names or play types (caps); concept names show as typed.
  const namesCaps = nav.tab !== "concept";
  return (
    <div className={s.heading}>
      <div className={s.headLeft}>
        <nav className={s.crumbs} aria-label="Breadcrumb">
          {level.at.length > 0 && (
            <button type="button" className={s.backLink} onClick={onBack} title="Up one level">
              <Icon name="chevronLeft" size={14} /> Back
            </button>
          )}
          {crumbs.length === 1 && <span className={s.crumbCurrent}>{bookLabel}</span>}
          {crumbs.length > 1 && crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <span key={i} className={s.crumb}>
                {i > 0 && <span className={s.sep}>›</span>}
                {last ? (
                  <span className={cx(s.crumbCurrent, i > 0 && namesCaps && "caps")}>{c.label}</span>
                ) : (
                  <button type="button" className={cx(s.crumbLink, i > 0 && namesCaps && "caps")} onClick={() => onCrumb(c.at)}>
                    {c.label}
                  </button>
                )}
              </span>
            );
          })}
        </nav>
        <h1 className={cx(s.title, level.at.length > 0 && namesCaps && "caps")}>{level.title}</h1>
      </div>
      <div className={s.headRight}>
        {((level.kind === "sets" && level.formation.template) || (level.kind === "plays" && level.set?.template)) && (
          <Tag tone="neutral" size="sm" icon="lock" title="Copied from the template save by the game-side builder — read-only here">
           From Template
          </Tag>
        )}
        {nav.tab === "concept" && level.kind === "groups" && (
          <a className={s.sourceNote} href="#/concepts?from=playbook" title="Concept categories live in the Concepts view (app-data/concepts.json)">
            <Icon name="tag" size={13} />
            {concepts === "tags" ? "Your Concept Tags" : "Read Concepts · No Tags Yet"}
          </a>
        )}
        {nav.flip && (
          <Tag tone="neutral" size="sm" icon="flip">
            Flipped
          </Tag>
        )}
        {level.kind !== "plays" && (
          <span className={s.headStat}>
            <b>{n}</b> {level.noun.replace(/s$/, n === 1 ? "" : "s")}
          </span>
        )}
        <span className={s.pageNum}>
          Page <b>{page + 1}</b>
          <span> / {pages}</span>
        </span>
      </div>
    </div>
  );
}

function Dots({ page, pages, onPage }: { page: number; pages: number; onPage(p: number): void }) {
  if (pages < 2) return <div className={s.dots} />;
  if (pages > MAX_DOTS) {
    return (
      <div className={s.dots}>
        <span className={s.dotsText}>
          {page + 1} / {pages}
        </span>
      </div>
    );
  }
  return (
    <div className={s.dots} role="tablist" aria-label="Pages">
      {Array.from({ length: pages }, (_, i) => (
        <button
          key={i}
          type="button"
          role="tab"
          aria-selected={i === page}
          aria-label={`Page ${i + 1}`}
          className={cx(s.dot, i === page && s.dotOn)}
          onClick={() => onPage(i)}
        />
      ))}
    </div>
  );
}

function Footer({ counts }: { counts?: BookCounts }) {
  return (
    <footer className={s.foot}>
      <span className={s.caveat}>
        <Icon name="info" size={13} /> The game sorts formations by usage; this preview uses your file order.
      </span>
      {counts && (
        <span className={s.footChips}>
          {counts.custom > 0 && (
            <Tag tone="custom" size="sm" variant="soft">
              {counts.custom} Custom
            </Tag>
          )}
          {counts.pulled > 0 && (
            <Tag tone="needsMod" size="sm" variant="soft">
              {counts.pulled} Needs Mod
            </Tag>
          )}
          {counts.unresolved > 0 && (
            <Tag tone="danger" size="sm" variant="soft">
              {counts.unresolved} Unresolved
            </Tag>
          )}
          {counts.templateFormations > 0 && (
            <Tag tone="neutral" size="sm" variant="soft" icon="lock">
              {counts.templateFormations} Template
            </Tag>
          )}
        </span>
      )}
    </footer>
  );
}

// ───────────────────────────── level content ─────────────────────────────

interface LevelContentProps {
  level: CallLevel;
  defense: boolean;
  tab: PlayCallTab;
  pageItems: unknown[];
  audSet?: CallSet;
  flip: boolean;
  favorites: ReadonlySet<string>;
  cursor?: string;
  onChoose(i: number): void;
  onOpen(item: CallPlay): void;
  onToggleFavorite(item: CallPlay): void;
  bookPath: string;
}

function LevelContent(p: LevelContentProps) {
  const { level, pageItems, flip, cursor } = p;

  if (level.kind === "audibles") {
    if (!p.audSet) return <LevelEmpty title="No Sets" body="This playbook has no sets to audible from." bookPath={p.bookPath} />;
    return (
      <AudibleDiamond
        set={p.audSet}
        defense={p.defense}
        flip={flip}
        favorites={p.favorites}
        cursor={cursor}
        onOpen={p.onOpen}
        onToggleFavorite={p.onToggleFavorite}
      />
    );
  }

  if (!level.items.length) return <EmptyLevel level={level} tab={p.tab} bookPath={p.bookPath} />;

  return (
    <div className={s.row}>
      {pageItems.map((it, i) => {
        switch (level.kind) {
          case "formations": {
            const f = it as CallFormation;
            return <FormationTile key={f.id} f={f} flip={flip} selected={cursor === f.id} onClick={() => p.onChoose(i)} />;
          }
          case "sets": {
            const st = it as CallSet;
            return <SetTile key={st.id} set={st} flip={flip} selected={cursor === st.id} onClick={() => p.onChoose(i)} />;
          }
          case "groups": {
            const g = it as CallGroup;
            return <GroupTile key={g.id} group={g} nameCaps={p.tab === "type"} flip={flip} selected={cursor === g.id} onClick={() => p.onChoose(i)} />;
          }
          case "plays": {
            const item = it as CallPlay;
            return (
              <PlaySlot
                key={item.id}
                item={item}
                flip={flip}
                favorite={!!item.play && p.favorites.has(item.play.key)}
                selected={cursor === item.id}
                onOpen={p.onOpen}
                onToggleFavorite={p.onToggleFavorite}
              />
            );
          }
        }
      })}
    </div>
  );
}

function LevelEmpty({ title, body, bookPath, icon = "playcall" }: { title: string; body: string; bookPath: string; icon?: "playcall" | "star" | "refresh" | "tag" }) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      body={body}
      action={
        <Button variant="secondary" onClick={() => navigate(href("playbook", bookPath))}>
         Open in the Playbook Builder
        </Button>
      }
    />
  );
}

function EmptyLevel({ level, tab, bookPath }: { level: CallLevel; tab: PlayCallTab; bookPath: string }) {
  if (tab === "favorites")
    return <EmptyState icon="star" title="No Favorites in This Playbook" body="Click the ☆ on any play card (or Favorite in its pre-snap view) to keep it here." />;
  if (tab === "recent") return <EmptyState icon="refresh" title="Nothing Called Yet" body="Plays you pick in this playbook show up here, most recent first." />;
  if (level.kind === "sets") return <LevelEmpty title="No Sets" body={`${level.title} has no sets yet.`} bookPath={bookPath} />;
  if (level.kind === "plays") return <LevelEmpty title="No Plays" body={`${level.title} has no plays yet.`} bookPath={bookPath} />;
  if (level.kind === "groups") return <LevelEmpty title="No Plays to Group" body="None of this playbook's plays resolved." bookPath={bookPath} />;
  return <LevelEmpty title="No Formations" body="This playbook has no formations yet." bookPath={bookPath} />;
}
