// Designer view plumbing: the editor context (state + commit + selection) and slot geometry helpers. Model logic
// lives in model/designer.ts, model/routes.ts and model/routeLibrary.ts.
import { createContext, useContext } from "react";
import type { Catalog } from "../../model/catalog";
import {
  isSlotChanged,
  isSlotLocked,
  precanChain,
  precanLength,
  commonPrefix,
  type DesignerState,
  type SlotMeta,
} from "../../model/designer";
import type { LibraryIndex } from "../../model/library";
import { slotLabel } from "../../model/positions";
import { routePoints, routeStart, toEditableRoute, type EditableRoute, type RoutePresetId, type RouteParams } from "../../model/routes";
import type { SetDef, Step, Vec } from "../../model/types";
import { slotRoleLabel } from "../../model/designer";

/** Inspector tabs: the everyday ones, plus ADVANCED (release details, raw steps, assignment info). */
export type InspectorTab = "route" | "block" | "motion" | "advanced";

export const INSPECTOR_TABS: { id: InspectorTab; label: string; title: string }[] = [
  { id: "route", label: "Route", title: "Pick or draw this player's route; save it to My Routes" },
  { id: "block", label: "Block", title: "Pass / run / lead blocks, pulls and screen releases" },
  { id: "motion", label: "Motion", title: "Pre-snap motion (where the player moves before the snap)" },
  { id: "advanced", label: "Advanced", title: "Release details, raw steps and assignment info" },
];

/** Selected handle: a leg end (vertex k = end of leg k) or a motion waypoint. */
export type VertexSel = { kind: "leg"; k: number } | { kind: "wp"; step: number; wp: number };

export interface PresetMemo {
  id: RoutePresetId;
  params: Partial<RouteParams>;
  /** The chain the preset produced (to know whether the slot was hand-edited since). */
  steps: Step[];
}

export interface EditorUi {
  slot?: number;
  vertex?: VertexSel;
  tab: InspectorTab;
  flip: boolean;
  /** Free placement (no grid / angle snapping). */
  free: boolean;
  /** Clicks on the empty field add route points. */
  drawing: boolean;
  /** Slot → number of leading precan steps kept locked ("edit after the handoff"). */
  unlocked: Record<number, number>;
  /** Slot → the last preset applied (parameter editing). */
  presets: Record<number, PresetMemo>;
  /** "Move this player for this play only" is on for this slot: the field shows a draggable start handle. */
  moveStart?: number;
  /** Selected route segment (leg index) of the selected player: the segment panel edits it. */
  segment?: number;
  /** The first-steps fan (release / QB drop picker) is open. */
  fan?: boolean;
  /** Where a moved player lands: this play only (OverrideFormPos) or the whole custom set (its positions). */
  moveScope?: "play" | "set";
}

export interface DesignerCtxValue {
  file: string;
  index: number;
  catalog: Catalog;
  lib: LibraryIndex;
  state: DesignerState;
  set: SetDef;
  /** Write a new editor state to the plays doc (one undo step per label, coalesced within `coalesceMs`). */
  commit(next: DesignerState, label: string, coalesceMs?: number): void;
  /** Apply a model edit to the latest doc state (preferred: never works on a stale render's state). */
  edit(fn: (st: DesignerState) => DesignerState, label: string, coalesceMs?: number): void;
  /** Convenience: replace a slot's chain. Presets / tools pass meta (routeType, family). */
  commitSlot(slot: number, steps: Step[], label: string, meta?: SlotMeta, coalesceMs?: number): void;
  ui: EditorUi;
  setUi(patch: Partial<EditorUi> | ((u: EditorUi) => Partial<EditorUi>)): void;
  /** Effective vip / runHole (spec or base). */
  vip: number;
  runHole: number;
  prefix: string;
  /** Open the cut picker for a vertex at a client position (default: the vertex on the field). */
  openCutMenu(k: number, at?: { x: number; y: number }): void;
  /** The field registers how to find a vertex's client position (cut picker anchor). */
  registerVertexClient(fn: ((k: number) => { x: number; y: number } | undefined) | null): void;
  /** Right-click menu for a player (field, player strip). */
  openPlayerMenu(slot: number, at: { x: number; y: number }): void;
  /** Make a slot the primary receiver (red route). */
  makePrimary(slot: number): void;
  /** Ask for a name and save the slot's route to My Routes. */
  saveRoute(slot: number): void;
}

export const DesignerCtx = createContext<DesignerCtxValue | null>(null);

export function useDesigner(): DesignerCtxValue {
  const v = useContext(DesignerCtx);
  if (!v) throw new Error("useDesigner outside the designer editor");
  return v;
}

/** Normal alignment of a slot. */
export function alignmentOf(set: SetDef, slot: number): Vec {
  const a = set.movements?.Normal?.[slot];
  return a ? { x: a.x, y: a.y } : { x: 0, y: 0 };
}

/** "WR1 · X" — position label plus the play role when it differs. */
export function playerName(set: SetDef, slot: number): string {
  const a = set.movements?.Normal?.[slot];
  if (!a) return `Slot ${slot}`;
  const l = slotLabel(a.pos, a.depth);
  const r = slotRoleLabel(set, slot);
  return r !== l ? `${l} · ${r}` : l;
}

export interface SlotGeometry {
  route: EditableRoute;
  start: Vec;
  points: Vec[];
  /** Index in the chain of each leg's step. */
  legStepIndex: number[];
  /** Legs before this index are part of the locked precan. */
  firstEditableLeg: number;
}

/** Route geometry for a slot's chain (`lockedSteps` leading steps are not editable). */
export function slotGeometry(set: SetDef, slot: number, steps: Step[], lockedSteps = 0): SlotGeometry {
  const route = toEditableRoute(steps);
  const start = routeStart(alignmentOf(set, slot), route.prefix, steps);
  const points = routePoints(start, route);
  const legStepIndex: number[] = [];
  let i = route.prefix.length;
  for (const leg of route.legs) {
    i += leg.before.length;
    legStepIndex.push(i);
    i++;
  }
  let firstEditableLeg = 0;
  while (firstEditableLeg < legStepIndex.length && legStepIndex[firstEditableLeg] < lockedSteps) firstEditableLeg++;
  return { route, start, points, legStepIndex, firstEditableLeg };
}

/**
 * Editing lock for a slot: `null` = fully locked (handoff mechanics in the base slot and not unlocked),
 * otherwise the number of leading steps that stay fixed (0 = everything editable).
 */
export function lockOf(state: DesignerState, ui: EditorUi, slot: number): number | null {
  if (!isSlotLocked(state, slot)) return 0;
  if (ui.unlocked[slot] !== undefined) return ui.unlocked[slot];
  // A slot already edited after its precan (e.g. "keep": 2) opens unlocked.
  const base = state.baseSlots[slot] ?? [];
  const n = precanLength(precanChain(state, slot));
  if (isSlotChanged(state, slot) && commonPrefix(state.slots[slot].steps, base) >= n) return n;
  return null;
}

/** Field ⇄ model point when the view is flipped (visualization only). */
export const viewPoint = (p: Vec, flip: boolean): Vec => (flip ? { x: -p.x, y: p.y } : p);

export const fmt = (n: number, d = 1) => (Number.isInteger(n) ? String(n) : n.toFixed(d));

