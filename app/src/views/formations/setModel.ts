// View-side helpers for the formation & set editor on top of model/sets.ts (which mirrors the game-side builder,
// tools/PlayDump/SetBuilder.cs). No React here — unit-tested in setModel.test.ts.
// - Legacy formation references: v1 wrote a custom formation's bare leaf ("PBS_Gun") into a set's `formation`; the
//   builder needs the full path (Formations/Offense/<leaf>/<leaf>). These helpers accept both so the editor can show
//   and fix such sets (validateSetsFile reports them as "set-formation-path").
// - Check groups for the live strip under the field, from alignmentIssues() rules.
// - Clone warnings in plain words, measured against the cloned play's OWN set (a play from another set keeps that
//   set's coordinates for handoff precans, pulls, blocks, absolute motions and fixed starting spots).
import type { LibraryIndex } from "../../model/library";
import { leaf } from "../../model/names";
import {
  NORMAL,
  cloneAsset,
  customFormationAsset,
  customSetAsset,
  depthClass,
  isQB,
  matchPresetToSlots,
  normalOf,
  onLine,
} from "../../model/sets";
import type { AlignmentPos, Asset, CustomFormationSpec, CustomSetSpec, PlayDef, SetDef, SlotPosition, ValidationIssue } from "../../model/types";

// ───────────────────────────── formation references (full path or v1 bare leaf) ─────────────────────────────

/** True when `ref` (a set's `formation`) points at custom formation `cf` (full path, or the bare leaf v1 wrote). */
export function refersToFormation(ref: string | undefined, cf: Pick<CustomFormationSpec, "asset"> | undefined): boolean {
  if (!ref || !cf?.asset) return false;
  return ref === cf.asset || ref.toLowerCase() === customFormationAsset(cf.asset).toLowerCase();
}

/** The custom formation of `formations` a set's `formation` points at (index too), if any. */
export function findCustomFormation(formations: CustomFormationSpec[] | undefined, ref: string | undefined): { cf: CustomFormationSpec; index: number } | undefined {
  if (!Array.isArray(formations)) return undefined;
  const index = formations.findIndex((cf) => cf && refersToFormation(ref, cf));
  return index >= 0 ? { cf: formations[index], index } : undefined;
}

/** A set's formation as a full asset path (bare custom leaves are expanded). */
export function formationPathOf(spec: Pick<CustomSetSpec, "formation">, formations?: CustomFormationSpec[]): Asset {
  const ref = typeof spec.formation === "string" ? spec.formation : "";
  const custom = findCustomFormation(formations, ref);
  if (custom) return customFormationAsset(custom.cf.asset);
  return ref.includes("/") ? ref : customFormationAsset(ref);
}

/** Full game asset of a custom set (<formation folder>/<asset>/<asset>), legacy leaves expanded. */
export function customSetPath(spec: Pick<CustomSetSpec, "formation" | "asset">, formations?: CustomFormationSpec[]): Asset | undefined {
  return customSetAsset({ asset: spec.asset, formation: formationPathOf(spec, formations) });
}

/** PlayKey of a play cloned into a custom set: <set folder>/<clone asset>. */
export function cloneKey(spec: Pick<CustomSetSpec, "formation" | "asset">, cloneLeaf: string, formations?: CustomFormationSpec[]): string | undefined {
  const set = customSetPath(spec, formations);
  return set ? cloneAsset(set, cloneLeaf) : undefined;
}

// ───────────────────────────── motion presets ─────────────────────────────

/** The base set's target for `slot` in preset `key` (undefined = that preset doesn't move him). */
export function presetTarget(base: SetDef, key: string, slot: number): AlignmentPos | undefined {
  if (key === NORMAL || !Array.isArray(base?.movements?.[key])) return undefined;
  return matchPresetToSlots(normalOf(base), base.movements[key])[slot];
}

/** The spec's override entry for (key, slot), if any. */
export function presetOverride(spec: Pick<CustomSetSpec, "movements">, key: string, slot: number): SlotPosition | undefined {
  const list = spec.movements?.[key];
  return Array.isArray(list) ? list.find((e) => e && e.slot === slot) : undefined;
}

// ───────────────────────────── live checks strip ─────────────────────────────

export type CheckId = "players" | "line" | "ol" | "depth" | "spacing";

export interface CheckGroup {
  id: CheckId;
  level: "ok" | "warning" | "error";
  label: string;
  messages: string[];
}

const GROUP_RULES: Record<CheckId, string[]> = {
  players: ["set-player-count", "set-position-number"],
  line: ["set-line-count", "set-past-los"],
  ol: ["set-ol-spacing", "set-ol-depth"],
  depth: ["set-qb-depth", "set-back-depth"],
  spacing: ["set-overlap", "set-flip-overlap", "set-flip-pair", "set-line-ends"],
};

/**
 * The strip under the field: the builder's hard rules (11 players, 7 on the line) and the §5 warnings (OL spacing,
 * QB/HB depth, spacing / flip partners), each OK / warning / error, from alignmentIssues() for the shown alignment.
 */
export function checkGroups(alignment: AlignmentPos[], issues: ValidationIssue[]): CheckGroup[] {
  const qb = alignment.find(isQB);
  const labels: Record<CheckId, string> = {
    players: `${alignment.length} Players`,
    line: `${alignment.filter(onLine).length} on the Line`,
    ol: "OL Spacing",
    depth: qb ? `QB ${depthLabel(depthClass(qb.y))}` : "QB / HB Depth",
    spacing: "Spacing",
  };
  return (Object.keys(GROUP_RULES) as CheckId[]).map((id) => {
    const hits = issues.filter((i) => GROUP_RULES[id].includes(i.rule ?? ""));
    const level = hits.some((i) => i.level === "error") ? "error" : hits.some((i) => i.level === "warning") ? "warning" : "ok";
    return { id, level, label: labels[id], messages: hits.map((i) => i.message) };
  });
}

function depthLabel(c: ReturnType<typeof depthClass>): string {
  return c === "under-center" ? "Under Center" : c.charAt(0).toUpperCase() + c.slice(1);
}

// ───────────────────────────── plays to clone ─────────────────────────────

// cloneWarnings / slotDependencies live in model/sets.ts (Export's "set-play-depends" rule uses them too).
export { cloneWarnings, slotDependencies, type CloneWarning, type CloneWarningKind } from "../../model/sets";

/** Offense library plays of every non-minigame set (the "all sets" clone source), in data order. Cached per index. */
const clonableCache = new WeakMap<LibraryIndex, PlayDef[]>();
export function clonableLibraryPlays(lib: LibraryIndex): PlayDef[] {
  const stock = lib.stock ?? lib;
  let out = clonableCache.get(stock);
  if (!out) {
    out = [];
    for (const f of stock.data.formations) {
      if (stock.formationSide(f) !== "offense" || stock.isMinigame(f)) continue;
      for (const set of stock.setsByFormation.get(f.asset) ?? []) for (const p of stock.playsBySet.get(set.asset) ?? []) out.push(p);
    }
    clonableCache.set(stock, out);
  }
  return out;
}

/** Display line for a play's set: "Shotgun · Y Trips Wk". */
export function playSetLabel(lib: LibraryIndex, play: Pick<PlayDef, "set">): string {
  const stock = lib.stock ?? lib;
  const set = stock.setByAsset.get(play.set);
  const form = set ? stock.formationByAsset.get(set.formation) : undefined;
  return [form?.name, set?.name].filter(Boolean).join(" · ") || leaf(play.set);
}
