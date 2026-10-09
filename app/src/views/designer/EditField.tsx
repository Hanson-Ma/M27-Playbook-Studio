// The big interactive field: play art from the editor state (plus the live drag draft), the selected player's
// route points / motion points, segment drawing (with "Draw route" on, click the field to add a point; double-click
// to stop), drag with snapping (0.5 yd + 5°, Alt or "Free placement" = free), right-click a point for its cut, and
// right-click a player for the player menu. A toolbar over the field holds every action as a button.
// Players aren't dragged here: their spot comes from the formation / set. "Move this player for this play only"
// shows a start handle that writes an OverrideFormPos for this play; motion points are clamped to the region real
// plays use (model/motionLimits.ts), which is shaded while the MOTION tab is open.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { Field, MotionBounds, PlayArtLayer, ProximityGuides, artMetrics, useFieldTransform, type FieldPointerEvent } from "../../field";
import { usePlayback } from "../../field/usePlayback";
import { patchPosition } from "../../model/sets";
import { navigate } from "../../state/router";
import { useWorkspace } from "../../state/workspace";
import type { SetsFile } from "../../model/types";
import { FirstStepsFan, FirstStepsPanel, PlaybackBar, SegmentLayer, SegmentPanel, firstStepOptions } from "./FieldExtras";
import { computeArt } from "../../model/art";
import { clearStartOverride, isSlotChanged, isSlotLocked, setStartOverride, startLock, startOverride, unbuildableSteps } from "../../model/designer";
import { HALF_WIDTH, add, polar } from "../../model/geometry";
import { MOTION_LIMITS, canMotion, clampMotionPoint, motionPathLength } from "../../model/motionLimits";
import { isEligible, isOffensiveLine } from "../../model/positions";
import {
  appendVertex,
  branchFrom,
  clearLegsFrom,
  cutAt,
  editRoute,
  insertVertex,
  legBetween,
  makeWaypoint,
  motionIndex,
  moveVertex,
  moveWaypoint,
  r2,
  removeVertex,
  setWaypoints,
  snapFrom,
  snapToGrid,
} from "../../model/routes";
import type { ArtBounds, AutoMotionWaypoint, Step, Vec } from "../../model/types";
import { useSettings } from "../../state/settings";
import { Button, cx } from "../../ui";
import { CutIcon, cutName } from "./cuts";
import { alignmentOf, fmt, lockOf, playerName, slotGeometry, useDesigner, viewPoint, type SlotGeometry, type VertexSel } from "./shared";
import s from "./EditField.module.css";

const VIEWPORT: ArtBounds = { minX: -HALF_WIDTH - 1, maxX: HALF_WIDTH + 1, minY: -12, maxY: 27 };

type DragState =
  | { kind: "leg"; slot: number; k: number; steps: Step[]; geom: SlotGeometry; moved: boolean }
  | { kind: "wp"; slot: number; step: number; wp: number; steps: Step[]; moved: boolean }
  | { kind: "start"; slot: number; moved: boolean; target?: Vec };

export function EditField() {
  const d = useDesigner();
  const { state, set, ui, setUi } = d;
  const showPassPro = useSettings((st) => st.showPassPro);
  const cutDetection = useSettings((st) => st.cutDetection);
  const ballSpot = useSettings((st) => st.ballSpot);
  const [draft, setDraft] = useState<{ slot: number; steps: Step[] } | null>(null);
  const draftRef = useRef(draft);
  const [hover, setHover] = useState<number | undefined>();
  const [dragInfo, setDragInfo] = useState<{ p: Vec; text: string } | null>(null);
  const drag = useRef<DragState | null>(null);
  const rightSlot = useRef<number | undefined>(undefined);

  const slotsSteps = useMemo(() => state.slots.map((sl, i) => (draft && draft.slot === i ? draft.steps : sl.steps)), [state, draft]);
  const art = useMemo(
    () => computeArt(set, slotsSteps, { vip: d.vip, runHole: d.runHole, flip: ui.flip, showPassPro, side: "offense" }),
    [set, slotsSteps, d.vip, d.runHole, ui.flip, showPassPro],
  );
  // Run / scrub the play on the field (the timeline bar); while it shows a moment of the play, that's what is drawn.
  const playback = usePlayback(art, "designer", false);
  const shownArt = playback.started && !draft ? playback.art : art;
  const sel = ui.slot;
  const lock = sel !== undefined ? lockOf(state, ui, sel) : null;
  const geom = useMemo(() => (sel !== undefined ? slotGeometry(set, sel, slotsSteps[sel], lock ?? 0) : undefined), [set, sel, slotsSteps, lock]);
  const editable = sel !== undefined && lock !== null;
  const normal = set.movements.Normal;
  const selPos = sel !== undefined ? normal[sel]?.pos ?? "" : "";
  const motionTab = ui.tab === "motion";
  const motionAllowed = sel !== undefined && canMotion(selPos);
  const startMovable = sel !== undefined && startLock(state, sel).movable;
  const startSpot = sel !== undefined ? startOverride(slotsSteps[sel]) : undefined;
  const showStartHandle = startMovable && sel !== undefined && (ui.moveStart === sel || !!startSpot);

  const setDraftBoth = (v: { slot: number; steps: Step[] } | null) => {
    draftRef.current = v;
    setDraft(v);
  };

  const freeFor = (raw?: PointerEvent | MouseEvent) => ui.free || !!raw?.altKey;

  const startDrag = (selv: VertexSel, e: ReactPointerEvent) => {
    if (e.button !== 0 || sel === undefined) return;
    e.preventDefault(); // the field must not pan
    setUi({ vertex: selv });
    if (!editable || !geom) return;
    const steps = state.slots[sel].steps;
    if (selv.kind === "leg") {
      if (selv.k < geom.firstEditableLeg) return;
      drag.current = { kind: "leg", slot: sel, k: selv.k, steps, geom, moved: false };
    } else {
      if (selv.step < (lock ?? 0)) return;
      drag.current = { kind: "wp", slot: sel, step: selv.step, wp: selv.wp, steps, moved: false };
    }
  };

  const startStartDrag = (e: ReactPointerEvent) => {
    if (e.button !== 0 || sel === undefined) return;
    e.preventDefault();
    drag.current = { kind: "start", slot: sel, moved: false };
  };

  const insertAt = (legIndex: number, e: ReactPointerEvent) => {
    if (e.button !== 0 || sel === undefined || !geom || !editable) return;
    e.preventDefault();
    const a = geom.points[legIndex];
    const b = geom.points[legIndex + 1];
    const mid = { x: r2((a.x + b.x) / 2), y: r2((a.y + b.y) / 2) };
    const steps = editRoute(state.slots[sel].steps, (r) => insertVertex(r, geom.start, legIndex, mid));
    const g2 = slotGeometry(set, sel, steps, lock ?? 0);
    setDraftBoth({ slot: sel, steps });
    setUi({ vertex: { kind: "leg", k: legIndex } });
    drag.current = { kind: "leg", slot: sel, k: legIndex, steps, geom: g2, moved: true };
  };

  const onPointer = (ev: FieldPointerEvent) => {
    const g = drag.current;
    if (ev.type === "move" && g) {
      const p = viewPoint(ev.field, ui.flip);
      if (g.kind === "leg") {
        const from = g.geom.points[g.k];
        const target = freeFor(ev.raw) ? { x: r2(p.x), y: r2(p.y) } : snapFrom(from, p);
        const steps = editRoute(g.steps, (r) => moveVertex(r, g.geom.start, g.k, target, { retuneCuts: cutDetection }));
        g.moved = true;
        setDraftBoth({ slot: g.slot, steps });
        const v = legBetween(from, target);
        setDragInfo({ p: target, text: `${fmt(v.distance, 2)} YD @ ${fmt(v.direction, 0)}°` });
      } else if (g.kind === "wp") {
        // Motion stays inside the region real plays use (behind the line, inside the numbers, ≤ 11 yd deep).
        const target = clampMotionPoint(freeFor(ev.raw) ? { x: r2(p.x), y: r2(p.y) } : snapToGrid(p));
        const steps = moveWaypoint(g.steps, g.step, g.wp, target);
        g.moved = true;
        setDraftBoth({ slot: g.slot, steps });
        setDragInfo({ p: target, text: `${fmt(r2(target.x), 2)}, ${fmt(r2(target.y), 2)}` });
      } else {
        const target = freeFor(ev.raw) ? { x: r2(p.x), y: r2(p.y) } : snapToGrid(p);
        const next = setStartOverride(state, g.slot, target);
        const steps = next.slots[g.slot].steps;
        const at = startOverride(steps) ?? alignmentOf(set, g.slot);
        g.moved = true;
        g.target = at;
        setDraftBoth({ slot: g.slot, steps });
        setDragInfo({ p: at, text: `${fmt(at.x, 2)}, ${fmt(at.y, 2)}` });
      }
      return;
    }
    if ((ev.type === "up" || ev.type === "cancel") && g) {
      drag.current = null;
      const dr = draftRef.current;
      if (ev.type === "up" && g.moved && dr) {
        if (g.kind === "start") {
          const target = g.target;
          if (target && ui.moveScope === "set" && setOrigin) moveInSet(g.slot, target);
          else if (target) d.edit((st) => setStartOverride(st, g.slot, target), "Move start spot");
          setUi({ moveStart: undefined });
        } else d.commitSlot(g.slot, dr.steps, g.kind === "leg" ? "Move point" : "Move motion point");
      }
      setDraftBoth(null);
      setDragInfo(null);
      return;
    }
    if (ev.type !== "click") return;
    if (ev.raw.button !== 0) return;
    if (sel !== undefined && editable && geom && motionTab) {
      if (motionAllowed) addWaypointAt(viewPoint(ev.field, ui.flip), freeFor(ev.raw));
      return;
    }
    if (sel !== undefined && editable && geom && ui.drawing) {
      const p = viewPoint(ev.field, ui.flip);
      const from = geom.points[geom.points.length - 1];
      const target = freeFor(ev.raw) ? { x: r2(p.x), y: r2(p.y) } : snapFrom(from, p);
      const last = geom.route.legs[geom.route.legs.length - 1];
      const type = last?.type ?? (isEligible(normal[sel]) ? "RunRoute" : "MoveDirection");
      const steps = editRoute(state.slots[sel].steps, (r) => appendVertex(r, geom.start, target, { type, autoCut: cutDetection }));
      if (steps.length !== state.slots[sel].steps.length) {
        d.commitSlot(sel, steps, "Add point");
        setUi({ vertex: { kind: "leg", k: geom.route.legs.length } });
      }
      return;
    }
    setUi({ slot: undefined, vertex: undefined, drawing: false, moveStart: undefined, segment: undefined, fan: false });
  };

  // ── Go Army–style tools ──
  // Click a route point while drawing (or double-click it) to start a new route from there: the rest is replaced.
  const branchAt = (k: number) => {
    if (sel === undefined || !editable || !geom || k < geom.firstEditableLeg) return;
    d.commitSlot(sel, editRoute(state.slots[sel].steps, (r) => branchFrom(r, k)), "New route from this point");
    setUi({ vertex: { kind: "leg", k }, drawing: true, segment: undefined });
  };
  // The custom set this play is in (moves can go to the whole set, "Edit Set" opens it).
  const origin = d.catalog.customOrigin.get(set.asset);
  const setOrigin = origin?.kind === "set" ? origin : undefined;
  const moveInSet = (slot: number, target: Vec) => {
    if (!setOrigin) return;
    useWorkspace.getState().update<SetsFile>(
      setOrigin.file,
      (doc) => {
        const spec = doc.sets?.[setOrigin.index];
        const base = spec && (d.lib.stock ?? d.lib).setByAsset.get(spec.base);
        if (spec && base) patchPosition(spec, base, slot, { x: r2(target.x), y: r2(target.y) });
      },
      { label: "Move player in the set" },
    );
  };
  const fanOptions = useMemo(
    () => (sel !== undefined && geom && editable ? firstStepOptions(slotsSteps[sel], geom, normal[sel]?.pos === "POSITION_QB") : []),
    [sel, geom, editable, slotsSteps, normal],
  );

  const waypointsOf = (steps: Step[]) => {
    const mi = motionIndex(steps);
    return { mi, wps: mi >= 0 ? ((steps[mi].waypoints as AutoMotionWaypoint[]) ?? []) : [] };
  };

  const addWaypointAt = (p: Vec, free: boolean) => {
    if (sel === undefined) return;
    const steps = state.slots[sel].steps;
    const { mi, wps } = waypointsOf(steps);
    if (mi >= 0 && mi < (lock ?? 0)) return;
    if (wps.length >= MOTION_LIMITS.maxWaypoints) return;
    const target = clampMotionPoint(free ? { x: r2(p.x), y: r2(p.y) } : snapToGrid(p));
    const next = setWaypoints(steps, [...wps, makeWaypoint(target, wps[wps.length - 1]?.speed ?? 80)]);
    d.commitSlot(sel, next, mi >= 0 ? "Add motion point" : "Add motion");
    setUi({ vertex: { kind: "wp", step: motionIndex(next), wp: wps.length } });
  };

  // ── toolbar actions ──
  const addPoint = () => {
    if (sel === undefined || !editable || !geom) return;
    const steps = state.slots[sel].steps;
    if (motionTab) {
      const { wps } = waypointsOf(steps);
      const last = wps[wps.length - 1]?.position ?? geom.start;
      const sgn = last.x < 0 ? -1 : 1;
      addWaypointAt({ x: last.x - sgn * 3, y: Math.min(last.y, -2.2) }, false);
      return;
    }
    const last = geom.route.legs[geom.route.legs.length - 1];
    const from = geom.points[geom.points.length - 1];
    const p = snapFrom(from, add(from, polar(last?.direction ?? 90, 5)));
    const next = editRoute(steps, (r) => appendVertex(r, geom.start, p, { type: last?.type ?? (isEligible(normal[sel]) ? "RunRoute" : "MoveDirection") }));
    d.commitSlot(sel, next, "Add point");
    setUi({ vertex: { kind: "leg", k: geom.route.legs.length } });
  };

  const deletePoint = () => {
    if (sel === undefined || !editable || !ui.vertex || !geom) return;
    const steps = state.slots[sel].steps;
    if (ui.vertex.kind === "leg") {
      const k = ui.vertex.k;
      if (k < geom.firstEditableLeg) return;
      d.commitSlot(sel, editRoute(steps, (r) => removeVertex(r, geom.start, k)), "Delete point");
      setUi({ vertex: k > 0 && k - 1 >= geom.firstEditableLeg ? { kind: "leg", k: k - 1 } : undefined });
    } else {
      const { step, wp } = ui.vertex;
      const wps = (steps[step]?.waypoints as AutoMotionWaypoint[] | undefined) ?? [];
      if (step < (lock ?? 0)) return;
      d.commitSlot(sel, wps.length <= 1 ? steps.filter((_, i) => i !== step) : setWaypoints(steps, wps.filter((_, i) => i !== wp)), wps.length <= 1 ? "Remove motion" : "Delete motion point");
      setUi({ vertex: undefined });
    }
  };

  // Clear the route's editable legs and switch "Draw route" on, so the next clicks draw a new route from his spot.
  const clearRoute = () => {
    if (sel === undefined || !editable || !geom || geom.route.legs.length <= geom.firstEditableLeg) return;
    d.commitSlot(sel, editRoute(state.slots[sel].steps, (r) => clearLegsFrom(r, geom.firstEditableLeg)), "Clear route");
    setUi({ vertex: undefined, drawing: true });
  };

  const onDouble = (_p: Vec, e: MouseEvent) => {
    if (ui.drawing) {
      e.preventDefault(); // keep the zoom
      setUi({ drawing: false, vertex: undefined });
    }
  };

  const onPlayerDown = (slot: number, e: ReactPointerEvent) => {
    if (e.button === 2) rightSlot.current = slot;
    if (slot === sel) {
      if (e.button === 0) setUi({ vertex: undefined });
      return;
    }
    const eligible = isEligible(normal[slot]);
    // Linemen land on BLOCK, receivers leave BLOCK for ROUTE.
    const tab = !eligible && ui.tab === "route" ? "block" : eligible && ui.tab === "block" && !isOffensiveLine(normal[slot].pos) ? "route" : ui.tab;
    setUi({ slot, vertex: undefined, moveStart: undefined, drawing: false, tab, segment: undefined, fan: false });
  };

  // Pointer leaving mid-drag (window blur) → drop the draft.
  useEffect(() => {
    const cancel = () => {
      if (!drag.current) return;
      drag.current = null;
      setDraftBoth(null);
      setDragInfo(null);
    };
    window.addEventListener("blur", cancel);
    return () => window.removeEventListener("blur", cancel);
  }, []);

  const locked = useMemo(() => state.slots.map((_, i) => isSlotLocked(state, i)), [state]);
  const changed = useMemo(() => state.slots.map((_, i) => isSlotChanged(state, i)), [state]);
  const unbuildable = useMemo(() => state.slots.map((sl) => unbuildableSteps(sl.steps, d.lib).length > 0), [state, d.lib]);

  const vertexCut = ui.vertex?.kind === "leg" && geom ? cutAt(geom.route, ui.vertex.k) : undefined;
  const legSelected = ui.vertex?.kind === "leg" && editable && !!geom && ui.vertex.k >= geom.firstEditableLeg;
  const wpCount = sel !== undefined ? waypointsOf(slotsSteps[sel]).wps.length : 0;

  // The point tools show their names while the whole toolbar fits on one row; otherwise Add / Delete / Clear turn into
  // icon buttons (their tooltips keep the names). Measured: the player's name and the cut's name change the width.
  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolsSig = [sel, editable, motionTab, motionAllowed, ui.moveStart, ui.drawing, sel !== undefined ? playerName(set, sel) : "", vertexCut ? cutName(String(vertexCut.cutType)) : ""].join("|");
  const compactTools = useCompactRow(toolbarRef, toolsSig);

  const hint =
    sel === undefined
      ? "Click a player on the field — or pick one above — to edit their route, blocking or motion. Right-click a player for more."
      : ui.moveStart === sel
        ? "Drag the ring to where this player lines up in this play. The formation itself doesn't change."
        : lock === null
          ? "Handoff player: their steps are locked — see the panel on the right."
          : motionTab
            ? !motionAllowed
              ? "Linemen never motion."
              : "Click inside the shaded area to add motion points (up to 5); drag the blue diamonds to move them."
            : ui.drawing
              ? "Drawing: click the field to add route points · double-click to stop · hold Alt for free placement."
              : "Drag the white points to reshape · the + on a leg adds a point · right-click a point for its cut · “Draw Route” to click new points.";

  return (
    <div
      className={s.wrap}
      onContextMenu={(e) => {
        if (e.defaultPrevented) return; // a route point opened its cut picker
        const slot = rightSlot.current ?? hover;
        rightSlot.current = undefined;
        if (slot === undefined) return;
        e.preventDefault();
        d.openPlayerMenu(slot, { x: e.clientX, y: e.clientY });
      }}
    >
      <Field
        viewport={VIEWPORT}
        interactive
        showCoords
        coordsPosition="bottom-right"
        ballSpot={ballSpot}
        className={cx(s.field, ((ui.drawing && editable) || (motionTab && motionAllowed && editable)) && s.drawing)}
        onFieldPointer={onPointer}
        onFieldDoubleClick={onDouble}
        label="Play designer field"
      >
        {motionTab && motionAllowed && editable && sel !== undefined && <MotionArea steps={slotsSteps[sel]} start={startSpot ?? alignmentOf(set, sel)} flip={ui.flip} />}
        <PlayArtLayer
          art={shownArt}
          selectedSlot={sel}
          highlightSlot={hover}
          showLabels
          showSlots
          dimOthers={sel !== undefined}
          onPlayerPointerDown={onPlayerDown}
          onPlayerHover={setHover}
        />
        <SlotMarks art={art.players} locked={locked} changed={changed} unbuildable={unbuildable} />
        {geom && sel !== undefined && editable && !motionTab && !ui.drawing && !ui.fan && (
          <SegmentLayer geom={geom} flip={ui.flip} selected={ui.segment} onSelect={(k) => setUi({ segment: k, vertex: undefined })} />
        )}
        {ui.fan && fanOptions.length > 0 && <FirstStepsFan options={fanOptions} flip={ui.flip} onPick={(o) => sel !== undefined && (d.commitSlot(sel, o.apply(state.slots[sel].steps), o.label), setUi({ fan: false }))} />}
        {dragInfo && sel !== undefined && (
          <ProximityGuides at={viewPoint(dragInfo.p, ui.flip)} others={art.players.filter((p) => p.slot !== sel).map((p) => p.at)} />
        )}
        {geom && sel !== undefined && (
          <Handles
            geom={geom}
            steps={slotsSteps[sel]}
            flip={ui.flip}
            lock={lock}
            vertex={ui.vertex}
            motionTab={motionTab}
            dragInfo={dragInfo}
            onStart={startDrag}
            onInsert={insertAt}
            drawing={ui.drawing}
            onBranch={branchAt}
            onContext={(k, e) => {
              e.preventDefault();
              setUi({ vertex: { kind: "leg", k } });
              if (editable && k >= geom.firstEditableLeg) d.openCutMenu(k, { x: e.clientX, y: e.clientY });
            }}
          />
        )}
        {showStartHandle && sel !== undefined && (
          <StartHandle
            at={startSpot ?? alignmentOf(set, sel)}
            home={alignmentOf(set, sel)}
            flip={ui.flip}
            active={ui.moveStart === sel}
            onPointerDown={startStartDrag}
          />
        )}
      </Field>

      <div className={cx(s.toolbar, compactTools && s.toolbarCompact)} ref={toolbarRef}>
        {sel !== undefined && <span className={s.hudSlot}>{playerName(set, sel)}</span>}
        {sel !== undefined && editable && !motionTab && ui.moveStart !== sel && (
          <>
            <Button size="sm" variant="ghost" icon="route" active={ui.drawing} onClick={() => setUi({ drawing: !ui.drawing, vertex: undefined, segment: undefined })} title="When on, clicking the field adds a route point; clicking a route point starts a new route from it">
              {ui.drawing ? "Drawing On" : "Draw Route"}
            </Button>
            {fanOptions.length > 0 && (
              <Button size="sm" variant="ghost" active={ui.fan} onClick={() => setUi({ fan: !ui.fan, segment: undefined, drawing: false })} title={normal[sel]?.pos === "POSITION_QB" ? "Pick the QB's drop" : "Pick the release (his first steps)"}>
                First Steps
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              active={cutDetection}
              onClick={() => useSettings.getState().set({ cutDetection: !cutDetection })}
              title="Cut detection: new and moved route points get the cut that fits the turn (22° / 45° / 67° / 90° …)"
            >
              {compactTools ? "Cuts" : cutDetection ? "Cut Detection On" : "Cut Detection Off"}
            </Button>
            <Button size="sm" variant="ghost" icon="plus" onClick={addPoint} title="Add point: a point 5 yd past the end of the route" aria-label="Add point">
              {compactTools ? undefined : "Add Point"}
            </Button>
            <Button size="sm" variant="ghost" icon="trash" disabled={!legSelected} onClick={deletePoint} title="Delete point: the selected route point (Delete key)" aria-label="Delete point">
              {compactTools ? undefined : "Delete Point"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon="close"
              disabled={!geom || geom.route.legs.length <= geom.firstEditableLeg}
              onClick={clearRoute}
              title="Clear route: remove the whole route and start drawing a new one from his spot (his spot, motion and release stay)"
              aria-label="Clear route"
            >
              {compactTools ? undefined : "Clear Route"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!legSelected}
              onClick={(e) => {
                if (ui.vertex?.kind !== "leg") return;
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                d.openCutMenu(ui.vertex.k, { x: r.left, y: r.bottom + 6 });
              }}
              title="Pick the cut at the selected point"
            >
              {vertexCut ? (
                <span className={s.cutBtn}>
                  <CutIcon cutType={String(vertexCut.cutType)} dir={String(vertexCut.direction)} size={18} />
                  {cutName(String(vertexCut.cutType))}
                </span>
              ) : (
                "Cut…"
              )}
            </Button>
          </>
        )}
        {sel !== undefined && editable && motionTab && motionAllowed && (
          <>
            <Button
              size="sm"
              variant="ghost"
              icon="plus"
              disabled={wpCount >= MOTION_LIMITS.maxWaypoints}
              onClick={addPoint}
              title={`Add motion point (up to ${MOTION_LIMITS.maxWaypoints})`}
              aria-label="Add motion point"
            >
              {compactTools ? undefined : "Add Motion Point"}
            </Button>
            <Button size="sm" variant="ghost" icon="trash" disabled={ui.vertex?.kind !== "wp"} onClick={deletePoint} title="Delete the selected motion point (Delete key)" aria-label="Delete motion point">
              {compactTools ? undefined : "Delete Motion Point"}
            </Button>
          </>
        )}
        {sel !== undefined && ui.moveStart === sel && (
          <>
            <Button size="sm" variant="ghost" active={ui.moveScope !== "set"} onClick={() => setUi({ moveScope: "play" })} title="Move him in this play only (the set stays as it is)">
              This Play
            </Button>
            <Button
              size="sm"
              variant="ghost"
              active={ui.moveScope === "set"}
              disabled={!setOrigin}
              onClick={() => setUi({ moveScope: "set" })}
              title={setOrigin ? "Move him in the custom set: every play in the set follows" : "Only custom sets can be changed (make one in Formations)"}
            >
              Whole Set
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setUi({ moveStart: undefined })}>
              Done
            </Button>
            {startSpot && (
              <Button size="sm" variant="ghost" icon="undo" onClick={() => (d.edit((st) => clearStartOverride(st, sel), "Reset start spot"), setUi({ moveStart: undefined }))}>
                Reset to Formation Spot
              </Button>
            )}
          </>
        )}
        {setOrigin && (
          <Button size="sm" variant="ghost" icon="field" onClick={() => navigate(`#/formations/${encodeURIComponent(setOrigin.file)}/${setOrigin.index}`)} title="Edit this custom set in the Formations editor (every play in it changes)">
            Edit Set
          </Button>
        )}
      </div>
      {ui.segment !== undefined && geom && sel !== undefined && (
        <SegmentPanel
          steps={state.slots[sel].steps}
          geom={geom}
          k={ui.segment}
          editable={editable}
          onChange={(steps, label) => d.commitSlot(sel, steps, label)}
          onPickCut={(v, at) => d.openCutMenu(v, at)}
          onClose={() => setUi({ segment: undefined })}
        />
      )}
      {ui.fan && fanOptions.length > 0 && sel !== undefined && (
        <FirstStepsPanel
          options={fanOptions}
          title={normal[sel]?.pos === "POSITION_QB" ? "First Steps · QB Drop" : "First Steps · Release"}
          onPick={(o) => (d.commitSlot(sel, o.apply(state.slots[sel].steps), o.label), setUi({ fan: false }))}
          onClose={() => setUi({ fan: false })}
        />
      )}
      <div className={s.bottomRow}>
        <PlaybackBar playback={playback} />
        <div className={cx(s.hint, sel === undefined && s.hintEmpty)}>{hint}</div>
      </div>
    </div>
  );
}

/**
 * Where motion can go (MOTION_LIMITS, the field's MotionBounds): the shaded band, plus rings for how much farther
 * the motion can reach from its current end (soft 25 yd / hard 35 yd, minus what it already uses).
 */
function MotionArea({ steps, start, flip }: { steps: Step[]; start: Vec; flip: boolean }) {
  const mi = motionIndex(steps);
  const wps = mi >= 0 ? ((steps[mi].waypoints as AutoMotionWaypoint[]) ?? []).map((w) => w.position) : [];
  const end = wps.length ? wps[wps.length - 1] : start;
  const used = motionPathLength(start, wps);
  return <MotionBounds from={viewPoint(end, flip)} usedYards={used} label={`Motion area · up to ${MOTION_LIMITS.maxWaypoints} points`} />;
}

/** Draggable start spot for "move this player for this play only" (OverrideFormPos). */
function StartHandle({ at, home, flip, active, onPointerDown }: { at: Vec; home: Vec; flip: boolean; active: boolean; onPointerDown(e: ReactPointerEvent): void }) {
  const { pxPerYard } = useFieldTransform();
  const k = +(1 / Math.max(pxPerYard, 0.5)).toPrecision(5);
  const v = viewPoint(at, flip);
  const h = viewPoint(home, flip);
  const moved = Math.abs(at.x - home.x) > 0.01 || Math.abs(at.y - home.y) > 0.01;
  return (
    <g className={cx(s.start, active && s.startActive)}>
      {moved && (
        <g transform={`translate(${h.x} ${-h.y}) scale(${k})`} className={s.home}>
          <title>Formation spot</title>
          <circle r={7} />
        </g>
      )}
      <g transform={`translate(${v.x} ${-v.y}) scale(${k})`} className={s.startRing} onPointerDown={onPointerDown}>
        <title>Drag to move this player for this play only</title>
        <circle r={17} />
        <path d="M-22 0h-5M22 0h5M0 -22v-5M0 22v5" />
      </g>
    </g>
  );
}

/** Small lock badges (handoff players), change dots and "can't build" marks next to players. */
const SlotMarks = memo(function SlotMarks({
  art,
  locked,
  changed,
  unbuildable,
}: {
  art: { slot: number; at: Vec }[];
  locked: boolean[];
  changed: boolean[];
  unbuildable: boolean[];
}) {
  const { pxPerYard } = useFieldTransform();
  // Player marks grow with the zoom (artMetrics scale), so the badges keep their place just outside the mark.
  const k = +(artMetrics(false, pxPerYard).scale / Math.max(pxPerYard, 0.5)).toPrecision(5);
  return (
    <g className={s.marks} aria-hidden>
      {art.map((p) =>
        locked[p.slot] || changed[p.slot] || unbuildable[p.slot] ? (
          <g key={p.slot} transform={`translate(${p.at.x} ${-p.at.y}) scale(${k})`}>
            {changed[p.slot] && !unbuildable[p.slot] && <circle className={s.changedDot} cx={-10} cy={-10} r={3.2} />}
            {unbuildable[p.slot] && (
              <g className={s.badMark} transform="translate(-11 -11)">
                <circle r={5.5} />
                <path d="M0 -3V0.6M0 2.4V2.6" />
              </g>
            )}
            {locked[p.slot] && (
              <g className={s.lock} transform="translate(9 -15)">
                <rect x={-4} y={-1} width={8} height={6.5} rx={1.2} />
                <path d="M-2.4 -1V-3.2a2.4 2.4 0 0 1 4.8 0V-1" />
              </g>
            )}
          </g>
        ) : null,
      )}
    </g>
  );
});

interface HandlesProps {
  geom: SlotGeometry;
  steps: Step[];
  flip: boolean;
  lock: number | null;
  vertex?: VertexSel;
  motionTab: boolean;
  dragInfo: { p: Vec; text: string } | null;
  onStart(sel: VertexSel, e: ReactPointerEvent): void;
  onInsert(legIndex: number, e: ReactPointerEvent): void;
  onContext(k: number, e: React.MouseEvent): void;
  /** Drawing is on: clicking a point starts a new route from it. */
  drawing?: boolean;
  onBranch?(k: number): void;
}

function Handles({ geom, steps, flip, lock, vertex, motionTab, dragInfo, onStart, onInsert, onContext, drawing, onBranch }: HandlesProps) {
  const { pxPerYard } = useFieldTransform();
  const d = useDesigner();
  const k = +(1 / Math.max(pxPerYard, 0.5)).toPrecision(5);
  const gRef = useRef<SVGGElement>(null);
  const at = (p: Vec) => {
    const v = viewPoint(p, flip);
    return `translate(${v.x} ${-v.y}) scale(${k})`;
  };
  const editable = lock !== null;
  const { route, points, firstEditableLeg } = geom;

  // Client position of vertex k (cut picker anchor for the toolbar / leg list).
  useEffect(() => {
    d.registerVertexClient((vk) => {
      const svg = gRef.current?.ownerSVGElement;
      const m = svg?.getScreenCTM();
      const p = points[vk + 1];
      if (!m || !p) return undefined;
      const v = viewPoint(p, flip);
      const q = new DOMPoint(v.x, -v.y).matrixTransform(m);
      return { x: q.x + 12, y: q.y + 8 };
    });
    return () => d.registerVertexClient(null);
  });

  const waypoints = useMemo(() => {
    const out: { step: number; wp: number; p: Vec }[] = [];
    steps.forEach((st, i) => {
      if (st.type !== "AutoMotion" || !Array.isArray(st.waypoints)) return;
      (st.waypoints as AutoMotionWaypoint[]).forEach((w, j) => {
        if (w?.position && typeof w.position.x === "number" && typeof w.position.y === "number") out.push({ step: i, wp: j, p: w.position });
      });
    });
    return out;
  }, [steps]);

  return (
    <g ref={gRef} className={s.handles}>
      {/* Leg midpoints: press to split the leg and drag the new point. */}
      {editable &&
        !motionTab &&
        route.legs.map((leg, i) => {
          if (i < firstEditableLeg || leg.distance < 1.5) return null;
          const a = points[i];
          const b = points[i + 1];
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          return (
            <g key={`m${i}`} className={s.mid} transform={at(mid)} onPointerDown={(e) => onInsert(i, e)}>
              <title>Add a point here (drag to bend the route)</title>
              <circle r={5.5} />
              <path d="M-2.6 0H2.6M0 -2.6V2.6" />
            </g>
          );
        })}
      {/* Motion points (absolute positions). */}
      {waypoints.map((w) => {
        const selected = vertex?.kind === "wp" && vertex.step === w.step && vertex.wp === w.wp;
        const lockedWp = !editable || w.step < (lock ?? 0);
        return (
          <g
            key={`w${w.step}.${w.wp}`}
            className={cx(s.wp, selected && s.selected, lockedWp && s.locked)}
            transform={at(w.p)}
            onPointerDown={(e) => onStart({ kind: "wp", step: w.step, wp: w.wp }, e)}
          >
            <title>Motion point {w.wp + 1}</title>
            <path d="M0 -7.5L7.5 0L0 7.5L-7.5 0Z" />
          </g>
        );
      })}
      {/* Route points (leg ends). */}
      {!motionTab &&
        route.legs.map((_, i) => {
          const p = points[i + 1];
          const lockedV = !editable || i < firstEditableLeg;
          const selected = vertex?.kind === "leg" && vertex.k === i;
          const cut = cutAt(route, i);
          return (
            <g
              key={`v${i}`}
              className={cx(s.vertex, selected && s.selected, lockedV && s.locked, cut && s.hasCut)}
              transform={at(p)}
              onPointerDown={(e) => {
                // Right / middle press: no drag, and keep the field from capturing the pointer — a captured pointer
                // sends the contextmenu event to the field instead of this point, so the cut picker never opened.
                if (e.button !== 0) return void e.stopPropagation();
                if (drawing && onBranch && !lockedV) {
                  e.preventDefault();
                  e.stopPropagation();
                  return onBranch(i);
                }
                onStart({ kind: "leg", k: i }, e);
              }}
              onDoubleClick={(e) => {
                if (lockedV || !onBranch) return;
                e.preventDefault();
                e.stopPropagation();
                onBranch(i);
              }}
              onContextMenu={(e) => onContext(i, e)}
            >
              <title>{`Point ${i + 1}${cut ? ` · ${cutName(String(cut.cutType))}` : ""} — right-click for the cut · double-click to start a new route from here`}</title>
              {lockedV ? <rect x={-4.5} y={-4.5} width={9} height={9} rx={1.5} /> : <rect x={-6} y={-6} width={12} height={12} rx={1.5} />}
              {cut && (
                <text className={s.cutText} x={10} y={-8}>
                  {cutName(String(cut.cutType))}
                </text>
              )}
            </g>
          );
        })}
      {dragInfo && (
        <g className={s.dragInfo} transform={at(dragInfo.p)}>
          <rect x={14} y={-30} width={dragInfo.text.length * 7 + 14} height={20} rx={4} />
          <text x={21} y={-16}>
            {dragInfo.text}
          </text>
        </g>
      )}
    </g>
  );
}

/**
 * True when a toolbar's items don't fit on one row at full size (re-measured on resize and whenever `sig`, what the
 * row holds, changes — a new signature always measures the full-size row first). Full size never wraps (nowrap), so
 * scrollWidth is the width it needs; that width is kept to switch back once the row is wide enough again.
 */
function useCompactRow(ref: RefObject<HTMLElement | null>, sig: string): boolean {
  const [state, setState] = useState({ sig, compact: false });
  const compact = state.sig === sig && state.compact;
  const fullWidth = useRef(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (!compact) {
        fullWidth.current = el.scrollWidth;
        if (el.scrollWidth > el.clientWidth + 1) setState({ sig, compact: true });
      } else if (fullWidth.current <= el.clientWidth) setState({ sig, compact: false });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, sig, compact]);
  return compact;
}
