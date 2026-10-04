// Play detail (#/library/play/<key>): the big interactive field with labels, flip and motion presets, plus the side
// panel (OVERVIEW · PLAYERS · READS · ROUTES). Players are selectable on the field and in the lists; the ROUTES tab
// previews any library assignment (or a saved "My Routes" route) on the selected player. The ‹ › buttons walk the
// grid's current results. Esc clears a route preview, then goes back to the grid.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Field, PlayArtLayer, cardSubtitle, sidelineXs } from "../../field";
import { useActions } from "../../input/actions";
import { artForPlay, artSideForPlay, computeArt } from "../../model/art";
import type { Catalog } from "../../model/catalog";
import { positionCode } from "../../model/positions";
import { defaultRouteScope, type RouteLibraryItem, type RouteScope } from "../../model/search";
import type { ArtOptions, PlayArt, ResolvedPlay, SetDef, Step } from "../../model/types";
import { useCatalog, useLibrary } from "../../state/library";
import { navigate } from "../../state/router";
import { useSettings } from "../../state/settings";
import { Button, EmptyState, IconButton, PlayTypeTag, Select, Spinner, TabBar, Tag, cx, type TabItem } from "../../ui";
import { openAddToPlaybook } from "./AddToPlaybook";
import { OverviewPanel, PlayersPanel, ReadsPanel } from "./DetailPanels";
import { useLibraryUi, type DetailTab } from "./libraryStore";
import { designerAction, designerNewHref, playHref, toggleFavorite } from "./playActions";
import { RoutesPanel } from "./RoutesPanel";
import { useLibraryResults } from "./useLibraryResults";
import { presetLabel } from "./format";
import s from "./PlayDetail.module.css";

const DETAIL_TABS: TabItem<DetailTab>[] = [
  { id: "overview", label: "Overview" },
  { id: "players", label: "Players" },
  { id: "reads", label: "Reads" },
  { id: "routes", label: "Routes" },
];

export function PlayDetail({ playKey }: { playKey: string }) {
  const catalog = useCatalog();
  const status = useLibrary((st) => st.status);
  const back = () => navigate("#/library");
  const play = catalog?.get(playKey);
  useActions("library.detail.missing", play ? [] : [{ id: "back", label: "Back", keys: ["Escape"], run: back }]);

  if (!catalog) {
    return (
      <div className={s.center}>
        {status === "error" ? (
          <EmptyState icon="warning" title="The play library didn't load" />
        ) : (
          <EmptyState icon={<Spinner size={26} />} title="Loading the play library" />
        )}
      </div>
    );
  }
  if (!play) {
    return (
      <div className={s.center}>
        <EmptyState
          icon="search"
          title="Play not found"
          body={<span className={s.mono}>{playKey}</span>}
          action={
            <Button variant="primary" icon="chevronLeft" onClick={back}>
              Back to library
            </Button>
          }
        />
      </div>
    );
  }
  return <Detail key={play.key} play={play} catalog={catalog} />;
}

export interface Preview {
  slot: number;
  /** A library assignment, or a saved route (My Routes: `path` empty, `saved` set). */
  item: RouteLibraryItem & { saved?: string };
}

function Detail({ play, catalog }: { play: ResolvedPlay; catalog: Catalog }) {
  const set: SetDef | undefined = catalog.lib.setByAsset.get(play.set);
  const tab = useLibraryUi((st) => st.detailTab);
  const flipPref = useLibraryUi((st) => st.flip);
  const flip = flipPref && play.canFlip;
  const showPassPro = useSettings((st) => st.showPassPro);
  const ballSpot = useSettings((st) => st.ballSpot);
  const favorite = useSettings((st) => st.favorites.includes(play.key));
  const { entries } = useLibraryResults();

  const presets = useMemo(() => Object.keys(set?.movements ?? {}).filter((k) => k !== "Normal"), [set]);
  const [preset, setPreset] = useState<string | undefined>(undefined);
  const [selectedSlot, setSelectedSlot] = useState<number | undefined>(undefined);
  const [hoverSlot, setHoverSlot] = useState<number | undefined>(undefined);
  const [preview, setPreview] = useState<Preview | undefined>(undefined);
  const panelBody = useRef<HTMLDivElement>(null);

  useEffect(() => {
    useSettings.getState().pushRecent(play.key);
  }, [play.key]);

  const opts = useMemo<ArtOptions>(() => ({ flip, preset, showPassPro }), [flip, preset, showPassPro]);
  const baseArt = useMemo(() => artForPlay(catalog, play, opts), [catalog, play, opts]);
  const art = useMemo<PlayArt>(() => {
    if (!preview || !set) return baseArt;
    const slots: Step[][] = play.slots.map((sl, i) => (i === preview.slot ? preview.item.steps : sl.steps));
    try {
      return computeArt(set, slots, { ...opts, vip: play.vip, runHole: play.runHole, side: artSideForPlay(catalog, play) });
    } catch {
      return baseArt;
    }
  }, [preview, set, play, opts, baseArt, catalog]);

  // Viewport: sideline to sideline filling the box's width, deep enough for every route; extra height goes upfield.
  // Stable across flips and previews (a new viewport resets the user's zoom/pan).
  const fieldBox = useRef<HTMLDivElement>(null);
  const aspect = useBoxAspect(fieldBox);
  const [left, right] = sidelineXs(ballSpot);
  const b = baseArt.bounds;
  const needMin = Math.min(-12, Math.floor(b.minY - 3));
  const needMax = Math.max(18, Math.ceil(b.maxY + 4));
  const widthH = aspect > 0 ? (right - left + 2) / aspect : 0;
  // Very deep routes (60-yd streaks) may run off the top rather than shrink the whole field; zoom/pan reaches them.
  const height = widthH > 0 ? Math.max(widthH, Math.min(needMax - needMin, widthH * 1.15)) : needMax - needMin;
  const viewport = {
    minX: left - 1,
    maxX: right + 1,
    minY: needMin,
    maxY: needMin + Math.round(height),
  };

  // ─────────── prev / next in the current results (or the play's set) ───────────
  const seq = useMemo(() => {
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const e of entries)
      if (!seen.has(e.key)) {
        seen.add(e.key);
        keys.push(e.key);
      }
    if (seen.has(play.key)) return { keys, from: "results" as const };
    return { keys: catalog.playsInSet(play.set).map((p) => p.key), from: "set" as const };
  }, [entries, play, catalog]);
  const pos = seq.keys.indexOf(play.key);
  const go = (d: 1 | -1) => {
    if (pos < 0 || !seq.keys.length) return;
    const key = seq.keys[(pos + d + seq.keys.length) % seq.keys.length];
    if (key === play.key) return;
    const e = entries.find((x) => x.key === key);
    useLibraryUi.getState().set({ selectedKey: key, ...(e ? { selectedId: e.id } : {}) });
    navigate(playHref(key), { replace: true });
  };

  const back = () => {
    const e = entries.find((x) => x.key === play.key);
    if (e) useLibraryUi.getState().set({ selectedId: e.id, selectedKey: e.key });
    navigate("#/library");
  };

  const setTab = (t: DetailTab) => {
    useLibraryUi.getState().set({ detailTab: t });
    if (t === "routes" && selectedSlot === undefined) setSelectedSlot(defaultSlot(play, set));
  };
  // Opening straight onto ROUTES picks a player too.
  useEffect(() => {
    if (tab === "routes" && selectedSlot === undefined) setSelectedSlot(defaultSlot(play, set));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const nSlots = set?.movements.Normal?.length ?? play.slots.length;
  const stepSlot = (d: 1 | -1) => {
    if (!nSlots) return;
    const cur = selectedSlot ?? (d > 0 ? -1 : nSlots);
    selectSlot((cur + d + nSlots) % nSlots);
  };
  const selectSlot = (slot: number | undefined) => {
    setSelectedSlot(slot);
    if (preview && slot !== preview.slot) setPreview(undefined);
  };

  const custom = play.source === "custom";
  const design = designerAction(play);
  // A library route preview opens a new play in the designer with that route on the player; saved routes are applied
  // in the designer itself (My Routes), so they only preview here.
  const previewHref = preview && !preview.item.saved && play.side !== "defense" ? designerNewHref(play, preview.slot, preview.item.path) : undefined;
  const designerLabel = previewHref ? "Use route in designer" : design.label;
  const designerOk = previewHref ? true : design.enabled;
  const runDesigner = () => {
    if (previewHref) navigate(previewHref);
    else if (design.enabled) design.run();
  };

  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const toggleExpanded = (slot: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(slot)) next.delete(slot);
      else next.add(slot);
      return next;
    });

  // Esc: clear the route preview first, then back to the grid.
  useActions("library.detail", [{ id: "back", label: preview ? "Clear preview" : "Back", keys: ["Escape"], run: () => (preview ? setPreview(undefined) : back()) }]);

  const info = cardSubtitle(play, catalog);
  const highlight = hoverSlot ?? (preview ? preview.slot : undefined);

  return (
    <div className={s.page}>
      <header className={s.head}>
        <Button variant="ghost" icon="chevronLeft" onClick={back} className={s.backBtn} title="Back to the library grid (Esc)">
          Library
        </Button>
        <div className={s.titleBlock}>
          <div className={s.titleRow}>
            <IconButton icon="chevronLeft" title="Previous play" size="sm" onClick={() => go(-1)} disabled={seq.keys.length < 2} />
            <h1 className={s.title}>{play.name}</h1>
            <IconButton icon="chevronRight" title="Next play" size="sm" onClick={() => go(1)} disabled={seq.keys.length < 2} />
          </div>
          <div className={s.subRow}>
            <PlayTypeTag playType={play.playType} size="sm" />
            {custom && (
              <Tag tone="custom" size="sm">
                Custom
              </Tag>
            )}
            {catalog.customAssets?.has(play.set) && (
              <Tag tone="custom" variant="soft" size="sm" title="This play's set is a custom set (playbooks/sets/), built into the mod">
                Custom set
              </Tag>
            )}
            {!play.global && (
              <Tag tone="needsMod" size="sm">
                Needs mod
              </Tag>
            )}
            {favorite && <span className={s.favStar}>★</span>}
            <span className={s.subtitle}>{info}</span>
            {pos >= 0 && (
              <span className={s.position}>
                {pos + 1} / {seq.keys.length} {seq.from === "set" ? "in set" : "in results"}
              </span>
            )}
          </div>
        </div>
        <div className={s.headActions}>
          <Button variant="secondary" icon={favorite ? "starFilled" : "star"} onClick={() => toggleFavorite(play)} active={favorite}>
            {favorite ? "Favorited" : "Favorite"}
          </Button>
          <Button variant="secondary" icon="plus" onClick={() => openAddToPlaybook(play.key)}>
            Add to playbook…
          </Button>
          <Button variant="primary" icon={custom || previewHref ? "route" : "duplicate"} onClick={runDesigner} disabled={!designerOk} title={previewHref ? undefined : design.title}>
            {designerLabel}
          </Button>
        </div>
      </header>

      <div className={s.body}>
        <div className={s.fieldWrap} ref={fieldBox}>
          <Field
            viewport={viewport}
            padding={0.5}
            interactive
            showCoords
            coordsPosition="bottom-left"
            ballSpot={ballSpot}
            className={s.field}
            label={`${play.name} play art`}
            onFieldPointer={(e) => {
              if (e.type === "click") selectSlot(undefined);
            }}
          >
            <PlayArtLayer
              art={art}
              showLabels
              showSlots
              selectedSlot={selectedSlot}
              highlightSlot={highlight}
              dimOthers={selectedSlot !== undefined && tab !== "overview"}
              onPlayerPointerDown={(slot) => selectSlot(selectedSlot === slot ? undefined : slot)}
              onPlayerHover={setHoverSlot}
            />
          </Field>
          <div className={s.fieldTools}>
            <Button size="sm" variant="secondary" icon="flip" active={flip} disabled={!play.canFlip} onClick={() => useLibraryUi.getState().set({ flip: !flipPref })} title={play.canFlip ? "Mirror the play" : "This play can't be flipped"}>
              Flip
            </Button>
            {presets.length > 0 && (
              <div className={s.presetBox}>
                <span className={s.toolLabel}>Motion</span>
                <Select
                  size="sm"
                  value={preset ?? "Normal"}
                  onChange={(v) => setPreset(v === "Normal" ? undefined : v)}
                  options={[{ value: "Normal", label: "Normal (no motion)" }, ...presets.map((p) => ({ value: p, label: presetLabel(p) }))]}
                  aria-label="Motion preset"
                />
              </div>
            )}
          </div>
          {preview && (
            <div className={s.previewChip}>
              <span className={s.previewTag}>Preview</span>
              <span className={s.previewText}>
                #{preview.slot} {art.players[preview.slot]?.label ?? ""} → {preview.item.label}
                {preview.item.side ? ` · ${preview.item.side}` : ""}
              </span>
              <IconButton icon="close" title="Clear preview (Esc)" size="sm" onClick={() => setPreview(undefined)} />
            </div>
          )}
          {play.problems.length > 0 && (
            <div className={s.problemBanner} title={play.problems.join("\n")}>
              {play.problems.length} problem{play.problems.length > 1 ? "s" : ""}: {play.problems[0]}
            </div>
          )}
        </div>

        <aside className={s.panel}>
          <div className={s.panelTabs}>
            <TabBar items={DETAIL_TABS} active={tab} onChange={setTab} size="sm" aria-label="Detail tabs" />
          </div>
          <div className={cx(s.panelBody, tab === "routes" && s.panelBodyFlush)} ref={panelBody}>
            {tab === "overview" && <OverviewPanel play={play} catalog={catalog} />}
            {tab === "players" && (
              <PlayersPanel
                play={play}
                art={baseArt}
                set={set}
                selectedSlot={selectedSlot}
                onSelect={(slot) => selectSlot(selectedSlot === slot ? undefined : slot)}
                onHover={setHoverSlot}
                expanded={expanded}
                onToggle={toggleExpanded}
              />
            )}
            {tab === "reads" && <ReadsPanel play={play} art={baseArt} selectedSlot={selectedSlot} onSelect={(slot) => selectSlot(selectedSlot === slot ? undefined : slot)} onHover={setHoverSlot} />}
            {tab === "routes" && set && (
              <RoutesPanel
                play={play}
                set={set}
                art={baseArt}
                slot={selectedSlot}
                flip={flip}
                preset={preset}
                preview={preview}
                onPreview={setPreview}
                onStepSlot={stepSlot}
                onUse={runDesigner}
                canUse={play.side !== "defense"}
                defaultScope={(slot: number) => scopeFor(play, set, slot)}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Width / height of a box (rounded to 2 decimals so tiny resizes don't reset the field view). */
function useBoxAspect(ref: RefObject<HTMLDivElement | null>): number {
  const [aspect, setAspect] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      if (el.clientWidth && el.clientHeight) setAspect(Math.round((el.clientWidth / el.clientHeight) * 50) / 50);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return aspect;
}

function defaultSlot(play: ResolvedPlay, set: SetDef | undefined): number {
  if (play.vip >= 0 && play.vip < (set?.movements.Normal?.length ?? 0)) return play.vip;
  return 0;
}

function scopeFor(play: ResolvedPlay, set: SetDef, slot: number): RouteScope {
  const pos = set.movements.Normal?.[slot]?.pos ?? "";
  return defaultRouteScope(positionCode(pos), play.side);
}
