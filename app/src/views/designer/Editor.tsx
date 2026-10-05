// Three-pane play editor: play settings (left), the interactive field with the player strip (center), the player
// inspector (right). Mouse and keyboard only: every action is a visible control (buttons, the field toolbar,
// right-click menus); keys are the universal ones — ⌘/Ctrl+Z / ⇧⌘Z / Ctrl+Y undo / redo, ⌘/Ctrl+S save, Esc
// deselects (point → drawing → player), Delete / Backspace removes the selected route point or motion point.
// The plays doc is the source of truth: every edit derives the editor state from the doc's spec, applies a pure
// model edit and writes the minimal spec back (one undo step per edit; drags commit once on pointer-up).
//
// The open play is tracked by identity, not only by the route's index: undo/redo of an insert or delete (or
// duplicate) moves plays around, so the editor follows its play to the new index (replace-navigate) or says it was
// removed, and EditorInner is keyed by that identity so its UI state never carries over to another play.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useActions, type ActionDef } from "../../input/actions";
import {
  applySpec,
  effectiveField,
  isSlotChanged,
  isSlotLocked,
  resetSlot,
  setPlayField,
  setSlotSteps,
  slotRouteType,
  slotSide,
  specFromState,
  startLock,
  startOverride,
  clearStartOverride,
  stateFromSpec,
  type DesignerState,
  type SlotMeta,
} from "../../model/designer";
import { cardSubtitle } from "../../field";
import { canSaveRoute, makeSavedRoute, savedRouteNameBase } from "../../model/routeLibrary";
import { removeVertex, editRoute, setWaypoints } from "../../model/routes";
import { isEligible, isOffensiveLine } from "../../model/positions";
import type { AutoMotionWaypoint, CustomPlaySpec, PlaysFile } from "../../model/types";
import { getCatalog, useCatalog } from "../../state/library";
import { href, navigate } from "../../state/router";
import { useSettings } from "../../state/settings";
import { selectDocsOfKind, useDoc, useWorkspace } from "../../state/workspace";
import { Button, EmptyState, IconButton, Menu, PlayTypeTag, Tag, Tooltip, promptDialog, toast, type MenuItem } from "../../ui";
import { CutMenu } from "./CutMenu";
import { EditField } from "./EditField";
import { Inspector } from "./Inspector";
import { PlayPanel } from "./PlayPanel";
import { PlayerStrip } from "./PlayerStrip";
import { getMyRoutes, saveToMyRoutes } from "./routesStore";
import { DesignerCtx, lockOf, playerName, slotGeometry, useDesigner, type DesignerCtxValue, type EditorUi } from "./shared";
import s from "./Editor.module.css";

type Obj = Record<string, unknown>;

// ── play identity ──
// Play spec objects are immutable snapshots (immer): an edit makes a new object, undo/redo bring old ones back.
// Each play gets a session id; the editor hands it on to the object its own edit produced, so the id follows the
// play through edits, undo/redo and moves while a different play at the same index has a different id.
const playIds = new WeakMap<object, number>();
let nextPlayId = 1;
function playIdOf(p: object): number {
  let id = playIds.get(p);
  if (id === undefined) {
    id = nextPlayId++;
    playIds.set(p, id);
  }
  return id;
}
/** Give `p` an existing id (the same play in a new snapshot); fresh ids never collide with adopted ones. */
function adoptPlayId(p: object, id: number): void {
  playIds.set(p, id);
  if (id >= nextPlayId) nextPlayId = id + 1;
}

interface Tracked {
  file: string;
  /** Route index the play was opened at (a different route index re-seats the tracking). */
  index: number;
  id?: number;
  asset?: string;
  count: number;
}

const isPlay = (p: unknown): p is CustomPlaySpec => !!p && typeof p === "object";

/**
 * Where the tracked play is in `plays` now (-1 = removed). By identity; else by asset (the file was reloaded from
 * disk); else, when the play count didn't change, the play at the route's index (reverted in place).
 */
function locate(plays: readonly unknown[], t: Tracked): number {
  const here = plays[t.index];
  if (isPlay(here) && playIds.get(here) === t.id) return t.index;
  const byId = plays.findIndex((p) => isPlay(p) && playIds.get(p) === t.id);
  if (byId >= 0) return byId;
  if (t.asset) {
    let best = -1;
    plays.forEach((p, i) => {
      if (isPlay(p) && p.asset === t.asset && (best < 0 || Math.abs(i - t.index) < Math.abs(best - t.index))) best = i;
    });
    if (best >= 0) return best;
  }
  return plays.length === t.count && isPlay(here) ? t.index : -1;
}

export function Editor({ file, index }: { file: string; index: number }) {
  const doc = useDoc<PlaysFile>(file);
  const catalog = useCatalog();
  const exists = !!doc && !doc.error && !!doc.data;

  useEffect(() => {
    if (!exists) return;
    useWorkspace.getState().setActive(file);
    if (file.startsWith("playbooks/plays/")) useSettings.getState().set({ lastPlaysFile: file });
    // Like the Builder: leaving the designer must not leave ⌘Z / ⌘S pointed at the plays file.
    return () => {
      if (useWorkspace.getState().activePath === file) useWorkspace.getState().setActive(undefined);
    };
  }, [file, exists]);

  const track = useRef<Tracked | null>(null);
  const plays = exists && Array.isArray(doc!.data.plays) ? (doc!.data.plays as unknown[]) : undefined;
  let at = index;
  let id: number | undefined;
  if (plays) {
    const t = track.current;
    if (!t || t.file !== file || t.index !== index || t.id === undefined) {
      // Opened, switched or followed (or nothing was there yet): track whatever play the route points at now.
      const here = plays[index];
      track.current = { file, index, id: isPlay(here) ? playIdOf(here) : undefined, asset: isPlay(here) ? String(here.asset ?? "") : undefined, count: plays.length };
    } else {
      at = locate(plays, t);
      // Only a found play updates the snapshot facts (a removed one must stay removed on the next render).
      if (at >= 0) {
        adoptPlayId(plays[at] as object, t.id);
        t.asset = String((plays[at] as CustomPlaySpec).asset ?? "");
        t.count = plays.length;
      }
    }
    id = track.current!.id;
  }

  // The play moved (undo/redo of an insert or delete before it): follow it.
  useEffect(() => {
    if (at >= 0 && at !== index) navigate(href("designer", file, at), { replace: true });
  }, [at, index, file]);

  const back = <Button onClick={() => navigate("#/designer")}>Back to plays</Button>;
  if (!catalog) return null;
  if (!doc) return <Centered title="Plays file not found" body={file} action={back} />;
  if (doc.error || !doc.data) return <Centered title="This plays file can't be edited" body={doc.error ?? "Empty file"} action={back} />;
  if (at < 0) return <Removed file={file} />;
  const spec = plays?.[at];
  if (!isPlay(spec) || id === undefined) return <Centered title="Play not found" body={`${file} has no play #${index + 1}.`} action={back} />;
  return <EditorInner key={`${file}#${id}`} file={file} index={at} playId={id} />;
}


/** The open play is gone from its file (undo of "New play" / "Duplicate", redo of a delete…). */
function Removed({ file }: { file: string }) {
  const canUndo = useWorkspace((st) => (st.docs[file]?.past.length ?? 0) > 0);
  const canRedo = useWorkspace((st) => (st.docs[file]?.future.length ?? 0) > 0);
  const undo = () => useWorkspace.getState().undo(file);
  const redo = () => useWorkspace.getState().redo(file);
  useActions("designer.removed", [
    { id: "undo", label: "Undo", keys: ["mod+z"], enabled: canUndo, run: undo },
    { id: "redo", label: "Redo", keys: ["shift+mod+z", "mod+y"], enabled: canRedo, run: redo },
  ]);
  return (
    <div className={s.centered}>
      <EmptyState
        icon="warning"
        title="This play was removed"
        body="Undo brings it back, or go back to the plays list."
        action={
          <div className={s.centeredActions}>
            <Button icon="undo" disabled={!canUndo} onClick={undo}>
              Undo
            </Button>
            <Button icon="redo" disabled={!canRedo} onClick={redo}>
              Redo
            </Button>
            <Button variant="ghost" onClick={() => navigate("#/designer")}>
              Back to plays
            </Button>
          </div>
        }
      />
    </div>
  );
}

/** Save the plays file (⌘S in the designer; the top bar's Save saves the active doc, normally this file). */
async function savePlays(file: string): Promise<void> {
  const ws = useWorkspace.getState();
  if (!ws.docs[file]?.dirty) {
    toast.info("No changes to save", { detail: file, duration: 2000 });
    return;
  }
  try {
    await ws.save(file);
    toast.success("Saved", { detail: file });
  } catch (e) {
    toast.error("Save failed", { detail: e instanceof Error ? e.message : String(e) });
  }
}

function Centered({ title, body, action }: { title: string; body: string; action: React.ReactNode }) {
  return (
    <div className={s.centered}>
      <EmptyState icon="warning" title={title} body={body} action={action} />
    </div>
  );
}

const INITIAL_UI: EditorUi = { tab: "route", flip: false, free: false, drawing: false, unlocked: {}, presets: {} };

function EditorInner({ file, index, playId }: { file: string; index: number; playId: number }) {
  const catalog = useCatalog()!;
  const doc = useDoc<PlaysFile>(file)!;
  const spec = doc.data.plays[index];
  const prefix = useSettings((st) => st.assetPrefix);
  const state = useMemo(() => stateFromSpec(spec, catalog, file, index), [spec, catalog, file, index]);
  const [ui, setUiState] = useState<EditorUi>(INITIAL_UI);
  const setUi = useCallback((patch: Partial<EditorUi> | ((u: EditorUi) => Partial<EditorUi>)) => {
    setUiState((u) => ({ ...u, ...(typeof patch === "function" ? patch(u) : patch) }));
  }, []);
  const [cutMenu, setCutMenu] = useState<{ k: number; at: { x: number; y: number } } | null>(null);
  const [playerMenu, setPlayerMenu] = useState<{ slot: number; at: { x: number; y: number } } | null>(null);
  const vertexClient = useRef<((k: number) => { x: number; y: number } | undefined) | null>(null);

  /** Apply a model edit to the latest doc state and write it (never a stale render's state). */
  const edit = useCallback(
    (fn: (st: DesignerState) => DesignerState, label: string, coalesceMs?: number) => {
      const ws = useWorkspace.getState();
      const data = ws.docs[file]?.data as PlaysFile | null | undefined;
      const cur = data?.plays?.[index];
      const cat = getCatalog();
      if (!cur || !cat) return;
      const st = stateFromSpec(cur, cat, file, index);
      const next = fn(st);
      if (next === st) return;
      const docs = selectDocsOfKind<PlaysFile>(ws, "plays").map((d) => ({ path: d.path, data: d.data }));
      let out: Obj;
      try {
        out = JSON.parse(JSON.stringify(specFromState(next, { catalog: cat, docs, file, index, prefix: useSettings.getState().assetPrefix }))) as Obj;
      } catch (e) {
        toast.error("Couldn't write the play", { detail: e instanceof Error ? e.message : String(e) });
        return;
      }
      ws.update<PlaysFile>(
        file,
        (draft) => {
          const p = draft.plays[index] as unknown as Obj | undefined;
          if (p) applySpec(p, out);
        },
        { label, coalesceMs },
      );
      // The edited play is still this play: hand its identity on to the new snapshot.
      const now = (useWorkspace.getState().docs[file]?.data as PlaysFile | null | undefined)?.plays?.[index];
      if (now && now !== cur) adoptPlayId(now, playId);
      // Editing makes this file the active doc again (e.g. after "Add to playbook…" pointed it at a book).
      if (useWorkspace.getState().activePath !== file) useWorkspace.getState().setActive(file);
    },
    [file, index, playId],
  );

  const set = state.set;
  const vip = effectiveField<number>(state, "vip");
  const runHole = effectiveField<number>(state, "runHole");

  /** A preset / tool replacing a route applied from My Routes drops that route's name (a new one is generated). */
  const commitSlot = useCallback(
    (slot: number, steps: Parameters<typeof setSlotSteps>[2], label: string, meta?: SlotMeta, coalesceMs?: number) =>
      edit((st) => {
        let m = meta;
        if (m && ("routeType" in m || "family" in m) && !m.dropName) {
          const name = st.slots[slot]?.name;
          const side = slotSide(st, slot);
          const fromMyRoutes = !!name && getMyRoutes().some((r) => [savedRouteNameBase(prefix, r.name), savedRouteNameBase(prefix, r.name, side)].some((b) => name === b || name.startsWith(`${b}_`)));
          if (fromMyRoutes) m = { ...m, dropName: true };
        }
        return setSlotSteps(st, slot, steps, m);
      }, label, coalesceMs),
    [edit, prefix],
  );

  const makePrimary = useCallback(
    (slot: number) => {
      edit((st) => setPlayField(st, "vip", slot), "Primary receiver");
      toast.success(`${set ? playerName(set, slot) : `Slot ${slot}`} is the primary receiver`, { detail: "Their route is drawn red — the QB's first look.", duration: 2500 });
    },
    [edit, set],
  );

  const saveRoute = useCallback(
    async (slot: number) => {
      if (!set) return;
      const st = stateFromSpec((useWorkspace.getState().docs[file]?.data as PlaysFile).plays[index], getCatalog()!, file, index);
      const keep = lockOf(st, ui, slot) ?? undefined;
      const steps = st.slots[slot]?.steps ?? [];
      if (!canSaveRoute(steps, keep)) {
        toast.info("Nothing to save yet", { detail: "Draw or pick a route for this player first." });
        return;
      }
      const existing = getMyRoutes();
      const suggestion = suggestRouteName(st, slot);
      const name = await promptDialog({
        title: "Save route to My Routes",
        label: "Route name",
        initial: suggestion,
        body: "Saved routes can be put on any player in any play — they flip automatically for the other side of the field.",
        confirmLabel: "Save route",
        validate: (v) => (!v.trim() ? "Give the route a name" : undefined),
      });
      if (!name) return;
      const play = catalog.custom.find((p) => p.file === file && p.index === index);
      const route = makeSavedRoute({
        name: name.trim(),
        side: slotSide(st, slot),
        steps,
        keepLeading: keep,
        routeType: slotRouteType(st, slot),
        source: { play: play?.key, slot, label: playerName(set, slot) },
        createdAt: new Date().toISOString(),
        existing,
      });
      if (await saveToMyRoutes(route)) toast.success(`Saved "${route.name}" to My Routes`, { detail: "Find it in the Route tab under My Routes." });
    },
    [set, file, index, ui, catalog],
  );

  const ctx = useMemo<DesignerCtxValue | null>(() => {
    if (!set) return null;
    return {
      file,
      index,
      catalog,
      lib: catalog.lib,
      state,
      set,
      commit: (next, label, coalesceMs) => edit(() => next, label, coalesceMs),
      commitSlot,
      edit,
      ui,
      setUi,
      vip,
      runHole,
      prefix,
      openCutMenu: (k, at) => {
        const pos = at ?? vertexClient.current?.(k);
        if (pos) setCutMenu({ k, at: pos });
      },
      registerVertexClient: (fn) => {
        vertexClient.current = fn;
      },
      openPlayerMenu: (slot, at) => setPlayerMenu({ slot, at }),
      makePrimary,
      saveRoute: (slot) => void saveRoute(slot),
    } as DesignerCtxValue;
  }, [file, index, catalog, state, set, edit, commitSlot, ui, setUi, vip, runHole, prefix, makePrimary, saveRoute]);

  // ── keyboard: universal keys only ──
  const selSlot = ui.slot;
  const lock = selSlot !== undefined ? lockOf(state, ui, selSlot) : null;
  const editable = selSlot !== undefined && lock !== null;
  const vertexSelected = !!ui.vertex && editable;

  const deleteSelected = () => {
    if (selSlot === undefined || !editable || !ui.vertex || !set) return;
    const steps = state.slots[selSlot].steps;
    if (ui.vertex.kind === "leg") {
      const g = slotGeometry(set, selSlot, steps, lock ?? 0);
      const k = ui.vertex.k;
      if (k < g.firstEditableLeg) return;
      edit((st) => setSlotSteps(st, selSlot, editRoute(steps, (r) => removeVertex(r, g.start, k))), "Delete point");
      setUi({ vertex: k > 0 && k - 1 >= g.firstEditableLeg ? { kind: "leg", k: k - 1 } : undefined });
    } else {
      const { step, wp } = ui.vertex;
      const wps = (steps[step]?.waypoints as AutoMotionWaypoint[] | undefined) ?? [];
      if (step < (lock ?? 0)) return;
      const next = wps.length <= 1 ? steps.filter((_, i) => i !== step) : setWaypoints(steps, wps.filter((_, i) => i !== wp));
      edit((st) => setSlotSteps(st, selSlot, next), wps.length <= 1 ? "Remove motion" : "Delete motion point");
      setUi({ vertex: undefined });
    }
  };

  const escape = () => {
    // While drawing, every new point is the selected one: one Esc stops drawing (and drops that selection).
    if (ui.drawing) return setUi({ drawing: false, vertex: undefined });
    if (ui.vertex) return setUi({ vertex: undefined });
    if (ui.moveStart !== undefined) return setUi({ moveStart: undefined });
    if (selSlot !== undefined) return setUi({ slot: undefined, vertex: undefined, drawing: false });
  };

  const actions: ActionDef[] = [
    { id: "undo", label: "Undo", keys: ["mod+z"], run: () => useWorkspace.getState().undo(file) },
    { id: "redo", label: "Redo", keys: ["shift+mod+z", "mod+y"], run: () => useWorkspace.getState().redo(file) },
    // ⌘S saves the plays file being edited, whatever the shell's active doc is.
    { id: "save", label: "Save", keys: ["mod+s"], allowInInput: true, run: () => void savePlays(file) },
    { id: "deselect", label: "Deselect", keys: ["Escape"], enabled: !!ui.vertex || ui.drawing || selSlot !== undefined || ui.moveStart !== undefined, run: escape },
    { id: "delete", label: "Delete point", keys: ["Delete", "Backspace"], enabled: vertexSelected, run: deleteSelected },
  ];
  useActions("designer.editor", actions);

  if (!set || !state.base || !ctx) {
    return (
      <Centered
        title="The base play isn't in the library"
        body={`${spec.name}: base ${String(spec.base)} wasn't found. Edit the plays file or pick another base from the plays list.`}
        action={<Button onClick={() => navigate("#/designer")}>Back to plays</Button>}
      />
    );
  }

  return (
    <DesignerCtx.Provider value={ctx}>
      <div className={s.root}>
        <aside className={s.left}>
          <PlayPanel />
        </aside>
        <main className={s.center}>
          <EditorHeader />
          <PlayerStrip />
          <EditField />
        </main>
        <aside className={s.right}>
          <Inspector />
        </aside>
      </div>
      {cutMenu && selSlot !== undefined && <CutMenu slot={selSlot} k={cutMenu.k} at={cutMenu.at} onClose={() => setCutMenu(null)} />}
      {playerMenu && <PlayerMenu slot={playerMenu.slot} at={playerMenu.at} onClose={() => setPlayerMenu(null)} />}
    </DesignerCtx.Provider>
  );
}

/** "Deep over" style suggestion from the slot's route (preset / routeType), else "<Player> route". */
function suggestRouteName(st: DesignerState, slot: number): string {
  const rt = slotRouteType(st, slot);
  const words = (rt ?? "")
    .replace(/^AssignRouteType_(RR_)?/, "")
    .replace(/_(Lt|Rt|Left|Right)$/, "")
    .replace(/_/g, " ")
    .trim();
  const nice = words ? words.charAt(0).toUpperCase() + words.slice(1).toLowerCase() : "";
  const name = st.slots[slot]?.name;
  if (name && !/_\d+$/.test(name) && !/^PBS_(X|Z|Y|Slot|HB|FB|TE\d)_/.test(name)) return name.replace(/^PBS_/, "").replace(/_/g, " ");
  return nice || "My route";
}

/** Right-click menu for a player (field or player strip). */
function PlayerMenu({ slot, at, onClose }: { slot: number; at: { x: number; y: number }; onClose(): void }) {
  const d = useDesigner();
  const { state, set, ui, setUi } = d;
  const a = set.movements.Normal[slot];
  if (!a) return null;
  const eligible = isEligible(a);
  const lineman = isOffensiveLine(a.pos);
  const lock = lockOf(state, ui, slot);
  const steps = state.slots[slot].steps;
  const sl = startLock(state, slot);
  const moved = !!startOverride(steps);
  const select = (tab: EditorUi["tab"]) => setUi({ slot, vertex: undefined, tab, drawing: false, moveStart: undefined });
  const items: MenuItem[] = [
    { kind: "heading", label: playerName(set, slot) },
    ...(eligible ? [{ label: "Edit route", icon: "route", onSelect: () => select("route") } satisfies MenuItem] : []),
    { label: "Edit blocking", icon: "block", onSelect: () => select("block") },
    ...(!lineman ? [{ label: "Edit motion", icon: "motion", onSelect: () => select("motion") } satisfies MenuItem] : []),
    { kind: "separator" },
    ...(eligible
      ? [
          slot === d.vip
            ? ({ label: "Primary receiver (red route)", checked: true, disabled: true } satisfies MenuItem)
            : ({ label: "Make primary receiver (red route)", onSelect: () => d.makePrimary(slot) } satisfies MenuItem),
        ]
      : []),
    ...(lock !== null && canSaveRoute(steps, lock || undefined) ? [{ label: "Save route to My Routes…", icon: "star", onSelect: () => d.saveRoute(slot) } satisfies MenuItem] : []),
    ...(sl.movable
      ? [
          moved
            ? ({ label: "Reset to formation spot", icon: "undo", onSelect: () => d.edit((st) => clearStartOverride(st, slot), "Reset start spot") } satisfies MenuItem)
            : ({ label: "Move this player for this play only", icon: "drag", onSelect: () => setUi({ slot, moveStart: slot, vertex: undefined, drawing: false }) } satisfies MenuItem),
        ]
      : []),
    ...(isSlotChanged(state, slot) ? [{ label: "Reset to the base play's assignment", icon: "undo", onSelect: () => d.edit((st) => resetSlot(st, slot), "Reset player") } satisfies MenuItem] : []),
    ...(isSlotLocked(state, slot) && lock === null ? [{ kind: "heading", label: "Handoff player: locked (see the right panel)" } satisfies MenuItem] : []),
  ];
  return <Menu items={items} anchor={at} onClose={onClose} scopeId="designer.player" minWidth={260} />;
}

/** Title, problems and view toggles. Undo / redo and Save are the top bar's (one of each per screen). */
function EditorHeader() {
  const { state, catalog, file, index, ui, setUi } = useDesigner();
  const play = catalog.custom.find((p) => p.file === file && p.index === index);
  const problems = play?.problems ?? [];
  const playType = effectiveField<string>(state, "playType");
  return (
    <header className={s.header}>
      <IconButton icon="chevronLeft" title="Back to the plays list" onClick={() => navigate("#/designer")} />
      <div className={s.titles}>
        <div className={s.eyebrow}>
          {play ? cardSubtitle(play, catalog) : ""} · base {state.base?.name}
        </div>
        <h1 className={s.title}>{state.play.name || "Untitled play"}</h1>
      </div>
      <PlayTypeTag playType={playType} />
      {problems.length > 0 && (
        <Tooltip content={<ul className={s.problemList}>{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}>
          <Tag tone="danger" icon="warning">
            {problems.length} problem{problems.length > 1 ? "s" : ""}
          </Tag>
        </Tooltip>
      )}
      <div className={s.headerTools}>
        <Button
          size="sm"
          variant="ghost"
          active={!ui.free}
          onClick={() => setUi({ free: !ui.free })}
          title={ui.free ? "Points go exactly where you drop them. Click to snap to 0.5 yd and 5° steps." : "Points snap to 0.5 yd and 5° steps. Click for free placement (or hold Alt while dragging)."}
        >
          {ui.free ? "Free placement" : "Snap to grid"}
        </Button>
        <Button size="sm" variant="ghost" icon="flip" active={ui.flip} onClick={() => setUi({ flip: !ui.flip })} title="Show the play flipped (view only — the play itself isn't changed)">
          Flip view
        </Button>
        <Button size="sm" variant="ghost" onClick={() => navigate(href("library", "play", play?.key ?? ""))} disabled={!play} title="Open this play in the library">
          Details
        </Button>
      </div>
    </header>
  );
}
