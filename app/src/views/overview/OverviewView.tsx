// Playbook overview (#/overview/<playbook path>[?flip=1]): the whole playbook on one wall. One column per formation,
// one block per set, every play as a card; drag to move around, scroll (or the + / − buttons) to zoom, click a play for
// its pre-snap view. Far out the cards thin to flat tiles and then colored blocks, so even a 300-play book stays smooth.
// Keyboard: arrows move the selection, Enter opens it, Esc goes back. Controller: D-pad / left stick move the selection,
// A opens, B backs out, LB / RB jump between formations, right stick pans, triggers zoom, X flips, Y fits everything.
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { PlayCard } from "../../field";
import { useActions } from "../../input/actions";
import { usePadHandler, type PadFrame, type PadPress } from "../../input/gamepad";
import { PadHints, type PadHint } from "../../input/PadHints";
import { playTypeInfo } from "../../model/playtypes";
import type { PlaybookSpec, ResolvedPlay } from "../../model/types";
import { useCatalog } from "../../state/library";
import { href, navigate, useRoute } from "../../state/router";
import { DEFAULT_PLAYBOOK, useSettings, type BallSpot } from "../../state/settings";
import { useDocsOfKind, useWorkspace, type DocEntry } from "../../state/workspace";
import { Button, EmptyState, Icon, IconButton, Spinner, TabBar, cx, toast, type TabItem } from "../../ui";
import type { CallPlay } from "../playcall/playcallModel";
import { PreSnap } from "../playcall/PreSnap";
import { useCallBook } from "../playcall/useCallBook";
import {
  FORM_HEAD_H,
  FULL_AT,
  MAX_K,
  MIN_K,
  clampK,
  detailAt,
  fitView,
  formationAt,
  intersects,
  layoutBook,
  neighbor,
  nearestTo,
  SET_HEAD_H,
  worldRect,
  zoomAt,
  type Detail,
  type OvLayout,
  type OvPlay,
  type View,
} from "./overviewModel";
import s from "./Overview.module.css";

const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);

// ───────────────────────────── entry ─────────────────────────────

export function OverviewView() {
  const route = useRoute();
  const ready = useWorkspace((st) => st.ready);
  const docs = useDocsOfKind<PlaybookSpec>("playbook");
  const lastPlaybook = useSettings((st) => st.lastPlaybook);
  const catalog = useCatalog();
  const path = route.parts[0];
  const doc = path ? docs.find((d) => d.path === path) : undefined;

  // #/overview → the last opened playbook (else the default, else the first that loads), like the play-call preview.
  useEffect(() => {
    if (!ready || !docs.length || (path && doc)) return;
    const pick = docs.find((d) => d.path === lastPlaybook && !d.error) ?? docs.find((d) => d.path === DEFAULT_PLAYBOOK && !d.error) ?? docs.find((d) => !d.error) ?? docs[0];
    if (path) toast.info(`${basename(path)} No Longer Exists`, { detail: `Renamed or deleted — showing ${pick.data?.name || basename(pick.path)} instead.`, duration: 3000 });
    navigate(href("overview", pick.path), { replace: true });
  }, [path, doc, ready, docs, lastPlaybook]);

  if (!ready || (path && !doc && docs.length)) {
    return (
      <div className={s.centered}>
        <Spinner size={22} />
      </div>
    );
  }
  if (!catalog) return <Message title="The Play Library Isn't Loaded" body="The overview draws every play from data/library. Load the library to continue." />;
  if (!docs.length || !path || !doc) {
    return (
      <Message
        title="No Playbooks Yet"
        body="Create a playbook in the builder, then see all of it on one wall here."
        action={
          <Button variant="primary" onClick={() => navigate("#/playbook")}>
            Open the Playbook Builder
          </Button>
        }
      />
    );
  }
  return <OverviewScreen path={path} doc={doc} catalog={catalog} />;
}

function Message({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className={s.centered}>
      <EmptyState icon="grid" title={title} body={body} action={action} />
    </div>
  );
}

function OverviewScreen({ path, doc, catalog }: { path: string; doc: DocEntry<PlaybookSpec>; catalog: NonNullable<ReturnType<typeof useCatalog>> }) {
  const spec = !doc.error && doc.data && typeof doc.data === "object" ? doc.data : undefined;
  const { book, error } = useCallBook(spec, catalog);
  const layout = useMemo(() => (book ? layoutBook(book) : undefined), [book]);
  const route = useRoute();
  const flip = route.query.get("flip") === "1";

  // Remember what was opened, so the Playbook / Preview buttons come back to it.
  useEffect(() => {
    if (!doc.error && useSettings.getState().lastPlaybook !== doc.path) useSettings.getState().set({ lastPlaybook: doc.path });
  }, [doc.path, doc.error]);

  if (doc.error || error || !spec || !book || !layout) {
    return (
      <Message
        title={`${spec?.name || basename(doc.path)} Can't Be Shown`}
        body={doc.error ?? error ?? "The file isn't a playbook spec."}
        action={
          <Button variant="secondary" onClick={() => navigate(href("playbook", path))}>
            Open in the Playbook Builder
          </Button>
        }
      />
    );
  }
  const toggleFlip = () => navigate(href("overview", path) + (flip ? "" : "?flip=1"), { replace: true });
  return <Wall key={path} path={path} bookName={spec.name || basename(doc.path)} side={spec.side === "defense" ? "Defense" : "Offense"} layout={layout} flip={flip} onFlip={toggleFlip} />;
}

// ───────────────────────────── the wall ─────────────────────────────

const PAD_HINTS: PadHint[] = [
  { buttons: ["UP", "DOWN", "LEFT", "RIGHT"], label: "Move" },
  { buttons: ["A"], label: "Open" },
  { buttons: ["B"], label: "Back" },
  { buttons: ["LB", "RB"], label: "Formation" },
  { buttons: ["RS"], label: "Pan" },
  { buttons: ["LT", "RT"], label: "Zoom" },
  { buttons: ["X"], label: "Flip" },
  { buttons: ["Y"], label: "Fit" },
];

interface WallProps {
  path: string;
  bookName: string;
  side: string;
  layout: OvLayout;
  flip: boolean;
  onFlip(): void;
}

/** Animation frame, with a timer as the fallback for windows the browser isn't painting. */
function nextFrame(run: () => void): () => void {
  let done = false;
  let raf = 0;
  let timer = 0;
  const go = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    window.clearTimeout(timer);
    run();
  };
  raf = requestAnimationFrame(go);
  timer = window.setTimeout(go, 40);
  return () => {
    done = true;
    cancelAnimationFrame(raf);
    window.clearTimeout(timer);
  };
}

function Wall({ path, bookName, side, layout, flip, onFlip }: WallProps) {
  const ballSpot = useSettings((st) => st.ballSpot);
  const vpRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const view = useRef<View>({ x: 0, y: 0, k: 0.1 });
  const size = useRef({ w: 0, h: 0 });
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [committed, setCommitted] = useState<View>(view.current);
  const [selId, setSelId] = useState<string>();
  const [openId, setOpenId] = useState<string>();
  const stopAnim = useRef<(() => void) | undefined>(undefined);
  const commitTimer = useRef(0);
  const inited = useRef(false);

  // ── camera ──
  const apply = () => {
    const v = view.current;
    const el = worldRef.current;
    if (el) el.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`;
  };
  const commit = () => {
    if (commitTimer.current) return;
    commitTimer.current = window.setTimeout(() => {
      commitTimer.current = 0;
      setCommitted({ ...view.current });
    }, 90);
  };
  const setView = (v: View) => {
    view.current = v;
    apply();
    commit();
  };
  const animateTo = (to: View, ms = 340) => {
    stopAnim.current?.();
    const { w, h } = size.current;
    const from = { ...view.current };
    const c0 = { x: (w / 2 - from.x) / from.k, y: (h / 2 - from.y) / from.k };
    const c1 = { x: (w / 2 - to.x) / to.k, y: (h / 2 - to.y) / to.k };
    const t0 = performance.now();
    let cancel: (() => void) | undefined;
    let stopped = false;
    const step = () => {
      if (stopped) return;
      const t = Math.min(1, (performance.now() - t0) / ms);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const k = from.k * Math.pow(to.k / from.k, e);
      const cx = c0.x + (c1.x - c0.x) * e;
      const cy = c0.y + (c1.y - c0.y) * e;
      setView({ k, x: w / 2 - cx * k, y: h / 2 - cy * k });
      if (t < 1) cancel = nextFrame(step);
    };
    stopAnim.current = () => {
      stopped = true;
      cancel?.();
    };
    cancel = nextFrame(step);
  };
  const jump = (v: View, animate = true) => (animate ? animateTo(v) : (stopAnim.current?.(), setView(v)));

  useEffect(
    () => () => {
      stopAnim.current?.();
      window.clearTimeout(commitTimer.current);
      commitTimer.current = 0; // StrictMode remounts this component: a stale id would block every later commit
    },
    [],
  );

  // Measure the viewport; the first measurement frames the whole wall.
  useEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      size.current = { w: r.width, h: r.height };
      setDims({ w: r.width, h: r.height });
      if (!inited.current && r.width > 0 && r.height > 0) {
        inited.current = true;
        view.current = fitView(layout, r.width, r.height);
        apply();
        setCommitted({ ...view.current });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wheel zooms around the cursor (a non-passive listener, so the page doesn't scroll).
  useEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stopAnim.current?.();
      const r = el.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 100 : e.deltaY;
      setView(zoomAt(view.current, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0016)), e.clientX - r.left, e.clientY - r.top));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drag to pan; a press that doesn't move opens the card under it.
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean; id?: string } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    const target = (e.target as Element).closest<HTMLElement>("[data-ov-id]");
    vpRef.current?.setPointerCapture(e.pointerId);
    vpRef.current?.focus({ preventScroll: true });
    stopAnim.current?.();
    drag.current = { x: e.clientX, y: e.clientY, vx: view.current.x, vy: view.current.y, moved: false, id: target?.dataset.ovId };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    if (!d.moved) vpRef.current?.setAttribute("data-dragging", "");
    d.moved = true;
    setView({ ...view.current, x: d.vx + dx, y: d.vy + dy });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    vpRef.current?.removeAttribute("data-dragging");
    if (vpRef.current?.hasPointerCapture(e.pointerId)) vpRef.current.releasePointerCapture(e.pointerId);
    if (d && !d.moved && d.id && e.button === 0) {
      setSelId(d.id);
      setOpenId(d.id);
    }
  };

  // ── moving the selection ──
  const centerWorld = () => ({ x: (size.current.w / 2 - view.current.x) / view.current.k, y: (size.current.h / 2 - view.current.y) / view.current.k });
  const focusPlay = (p: OvPlay) => {
    const { w, h } = size.current;
    const v = view.current;
    const sx = p.x * v.k + v.x;
    const sy = p.y * v.k + v.y;
    const comfy = sx >= 60 && sy >= 60 && sx + p.w * v.k <= w - 60 && sy + p.h * v.k <= h - 60;
    if (comfy && v.k >= FULL_AT) return;
    const k = Math.max(v.k, 0.7);
    animateTo({ k, x: w / 2 - (p.x + p.w / 2) * k, y: h / 2 - (p.y + p.h / 2) * k });
  };
  const select = (p: OvPlay | undefined) => {
    if (!p) return;
    setSelId(p.id);
    focusPlay(p);
  };
  const move = (dir: "UP" | "DOWN" | "LEFT" | "RIGHT") => {
    const cur = selId ? layout.byId.get(selId) : undefined;
    if (!cur) {
      const c = centerWorld();
      select(nearestTo(layout, c.x, c.y));
      return;
    }
    select(neighbor(layout, cur.id, dir));
  };
  const open = () => {
    const cur = selId ? layout.byId.get(selId) : undefined;
    if (!cur) {
      const c = centerWorld();
      select(nearestTo(layout, c.x, c.y));
      return;
    }
    setOpenId(cur.id);
  };
  const fit = () => jump(fitView(layout, size.current.w, size.current.h));
  const goFormation = (f: number, select_ = true) => {
    const form = layout.formations[f];
    if (!form) return;
    const { w } = size.current;
    // The formation fills the screen width (up to a comfortable zoom), its top sits just under the toolbar.
    const k = clampK(Math.min(0.85, (w - 120) / form.w));
    animateTo({ k, x: w / 2 - (form.x + form.w / 2) * k, y: 70 - form.y * k });
    if (select_) {
      const first = layout.plays.find((p) => p.f === f);
      if (first) setSelId(first.id);
    }
  };
  const activeFormation = dims.w ? formationAt(layout, (dims.w / 2 - committed.x) / committed.k)?.f : undefined;
  const stepFormation = (d: 1 | -1) => {
    const n = layout.formations.length;
    if (!n) return;
    const at = activeFormation ?? 0;
    goFormation(Math.min(n - 1, Math.max(0, at + d)));
  };
  const zoomBy = (factor: number) => {
    const { w, h } = size.current;
    animateTo(zoomAt(view.current, factor, w / 2, h / 2), 220);
  };

  const openItem = openId ? layout.byId.get(openId) : undefined;
  const openList = useMemo(() => {
    const set = openItem ? layout.sets.find((x) => x.id === openItem.setId)?.set : undefined;
    return set?.plays ?? [];
  }, [layout, openItem]);
  const closePresnap = () => setOpenId(undefined);
  const stepPresnap = (item: CallPlay) => {
    setOpenId(item.id);
    setSelId(item.id);
    const p = layout.byId.get(item.id);
    if (p) focusPlay(p);
  };

  // ── keyboard ──
  const browsing = !openId;
  useActions("overview", [
    { id: "left", label: "Move left", keys: ["ArrowLeft"], repeat: true, enabled: browsing, run: () => move("LEFT") },
    { id: "right", label: "Move right", keys: ["ArrowRight"], repeat: true, enabled: browsing, run: () => move("RIGHT") },
    { id: "up", label: "Move up", keys: ["ArrowUp"], repeat: true, enabled: browsing, run: () => move("UP") },
    { id: "down", label: "Move down", keys: ["ArrowDown"], repeat: true, enabled: browsing, run: () => move("DOWN") },
    { id: "open", label: "Open play", keys: ["Enter"], enabled: browsing && !!selId, run: open },
    { id: "fit", label: "Fit everything", keys: ["Home"], enabled: browsing, run: fit },
    { id: "back", label: "Back to the playbook", keys: ["Escape"], enabled: browsing, run: () => navigate(href("playbook", path)) },
  ]);

  // ── controller ──
  usePadHandler(
    {
      press: (p: PadPress) => {
        if (openId) return false;
        switch (p.button) {
          case "UP":
          case "DOWN":
          case "LEFT":
          case "RIGHT":
            move(p.button);
            return true;
          case "A":
            open();
            return true;
          case "B":
            navigate(href("playbook", path));
            return true;
          case "X":
            onFlip();
            return true;
          case "Y":
            fit();
            return true;
          case "LB":
            stepFormation(-1);
            return true;
          case "RB":
            stepFormation(1);
            return true;
          case "LT":
          case "RT":
            return true; // the triggers zoom smoothly (analog below)
          default:
            return false;
        }
      },
      analog: (f: PadFrame) => {
        if (openId) return false;
        let used = false;
        if (f.rx || f.ry) {
          stopAnim.current?.();
          setView({ ...view.current, x: view.current.x - f.rx * 1100 * f.dt, y: view.current.y - f.ry * 1100 * f.dt });
          used = true;
        }
        if (f.lt > 0.05 || f.rt > 0.05) {
          stopAnim.current?.();
          const { w, h } = size.current;
          setView(zoomAt(view.current, Math.exp((f.rt - f.lt) * 2.2 * f.dt), w / 2, h / 2));
          used = true;
        }
        return used;
      },
    },
    { priority: 10 },
  );

  // ── what to draw ──
  const detail = detailAt(committed.k);
  const world = useMemo(() => worldRect(committed, dims.w, dims.h, 0.35), [committed, dims]);
  const plays = useMemo(() => (dims.w ? layout.plays.filter((p) => intersects(p, world)) : []), [layout, world, dims.w]);
  const sets = useMemo(() => (dims.w ? layout.sets.filter((x) => intersects(x, world)) : []), [layout, world, dims.w]);
  const selected = selId ? layout.byId.get(selId) : undefined;
  const tabs = useMemo<TabItem[]>(() => layout.formations.map((f) => ({ id: String(f.f), label: f.name, caps: true, title: `${f.setCount} sets · ${f.count} plays` })), [layout]);
  const totals = useMemo(() => ({ sets: layout.sets.length, plays: layout.plays.length }), [layout]);
  // Titles grow as the camera pulls back so they stay readable (world units; the camera scales them down again).
  const worldVars = {
    width: layout.width,
    height: layout.height,
    "--inv": Math.min(14, 1 / committed.k),
    "--fb": Math.min(2.4, Math.max(1, 0.24 / committed.k)),
    "--sb": Math.min(2, Math.max(1, 0.3 / committed.k)),
  } as CSSProperties;

  return (
    <div className={s.page}>
      <header className={s.top}>
        <div className={s.topLeft}>
          <Button variant="ghost" icon="chevronLeft" onClick={() => navigate(href("playbook", path))} title="Back to this playbook in the builder (Esc)">
            Back to Playbook
          </Button>
          <div className={s.book}>
            <span className={s.eyebrow}>Overview</span>
            <span className={s.bookName}>{bookName}</span>
          </div>
        </div>
        <TabBar items={tabs} active={activeFormation === undefined ? undefined : String(activeFormation)} onChange={(id) => goFormation(Number(id))} size="sm" className={s.chips} aria-label="Formations" />
        <div className={s.topRight}>
          <span className={s.counts}>
            {side} · {layout.formations.length} formations · {totals.sets} sets · {totals.plays} plays
          </span>
          <Button size="sm" variant="secondary" icon="flip" active={flip} onClick={onFlip} title="Mirror every play (plays that can't flip stay as they are)">
            {flip ? "Flipped" : "Flip Plays"}
          </Button>
        </div>
      </header>

      <div className={s.stage}>
        <div
          ref={vpRef}
          className={s.viewport}
          tabIndex={0}
          role="application"
          aria-label={`${bookName} overview. Drag to move, scroll to zoom, arrow keys to pick a play.`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={(e) => {
            if ((e.target as Element).closest("[data-ov-id]")) return;
            const r = vpRef.current?.getBoundingClientRect();
            if (r) animateTo(zoomAt(view.current, 2, e.clientX - r.left, e.clientY - r.top), 260);
          }}
        >
          <div ref={worldRef} className={s.world} style={worldVars}>
            {layout.formations.map((f) => (
              <div key={f.id} className={s.col} style={{ left: f.x, top: f.y, width: f.w, height: f.h }} data-formation={f.f}>
                <div className={s.formHead} style={{ height: FORM_HEAD_H - 24 }}>
                  <h2 className={cx(s.formName, "caps")}>{f.name}</h2>
                  <span className={s.formMeta}>
                    {f.setCount} {f.setCount === 1 ? "set" : "sets"} · {f.count} {f.count === 1 ? "play" : "plays"}
                  </span>
                </div>
              </div>
            ))}
            {sets.map((st) => (
              <div key={st.id} className={s.setBlock} style={{ left: st.x - 14, top: st.y - 8, width: st.w + 28, height: st.h + 22 }}>
                <div className={s.setHead} style={{ height: SET_HEAD_H }}>
                  <h3 className={cx(s.setName, "caps")}>{st.name}</h3>
                  <span className={s.setMeta}>
                    {st.count} {st.count === 1 ? "play" : "plays"}
                  </span>
                </div>
              </div>
            ))}
            {plays.map((p) => (
              <WallCard key={p.id} p={p} detail={detail} flip={flip} ballSpot={ballSpot} selected={p.id === selId} />
            ))}
            {selected && <div className={s.ring} style={{ left: selected.x, top: selected.y, width: selected.w, height: selected.h }} aria-hidden />}
          </div>
        </div>

        <div className={s.hud}>
          <PadHints hints={PAD_HINTS} className={s.padHints} />
          <div className={s.help}>Drag to move · Scroll to zoom · Click a play to open it</div>
        </div>
        <div className={s.zoom}>
          <IconButton icon="minus" title="Zoom out" size="sm" disabled={committed.k <= MIN_K + 1e-6} onClick={() => zoomBy(1 / 1.6)} />
          <span className={s.zoomNum}>{Math.round(committed.k * 100)}%</span>
          <IconButton icon="plus" title="Zoom in" size="sm" disabled={committed.k >= MAX_K - 1e-6} onClick={() => zoomBy(1.6)} />
          <Button size="sm" variant="secondary" icon="field" onClick={fit} title="Fit the whole playbook on screen (Home)">
            Fit
          </Button>
        </div>
      </div>

      {openItem?.item.play && (
        <PreSnap
          item={openItem.item as CallPlay & { play: ResolvedPlay }}
          list={openList}
          bookPath={path}
          flip={flip}
          onFlip={onFlip}
          onStep={stepPresnap}
          onClose={closePresnap}
        />
      )}
    </div>
  );
}

// ───────────────────────────── cards ─────────────────────────────

interface CardProps {
  p: OvPlay;
  detail: Detail;
  flip: boolean;
  ballSpot: BallSpot;
  selected: boolean;
}

const WallCard = memo(function WallCard({ p, detail, flip, ballSpot, selected }: CardProps) {
  const item = p.item;
  const play = item.play;
  const box: CSSProperties = { left: p.x, top: p.y, width: p.w, height: p.h };
  if (!play) {
    return (
      <div className={cx(s.card, s.missing)} style={box} data-ov-id={p.id} data-selected={selected || undefined} title={item.problem}>
        {detail !== "dot" && (
          <>
            <Icon name="warning" size={20} />
            <span className={cx(s.lightName, "caps")}>{item.name || "(unnamed)"}</span>
            <span className={s.lightType}>Not found</span>
          </>
        )}
      </div>
    );
  }
  const type = playTypeInfo(play.playType);
  if (detail === "dot") return <div className={cx(s.card, s.dot)} style={{ ...box, "--tag": type.color } as CSSProperties} data-ov-id={p.id} data-selected={selected || undefined} />;
  if (detail === "light") {
    return (
      <div className={cx(s.card, s.light)} style={{ ...box, "--tag": type.color } as CSSProperties} data-ov-id={p.id} data-selected={selected || undefined}>
        <span className={cx(s.lightName, "caps")}>{play.name}</span>
        <span className={s.lightType}>{type.label}</span>
      </div>
    );
  }
  return (
    <div className={s.card} style={box} data-ov-id={p.id} data-selected={selected || undefined}>
      <PlayCard play={play} size="md" flip={flip && play.canFlip} ballSpot={ballSpot} autoBadges={false} subtitle={type.long} />
    </div>
  );
});
