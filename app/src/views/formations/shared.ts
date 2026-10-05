// Shared helpers for the formation & set editor views (React-side; pure rules live in model/sets.ts and ./setModel.ts).
import { useMemo } from "react";
import { computeArt, emptyArt } from "../../model/art";
import type { LibraryIndex } from "../../model/library";
import { formationShort, maddenName } from "../../model/names";
import { NORMAL, effectiveNormal, effectiveSet, flippedSet, issuesForSet, validateSetsFiles } from "../../model/sets";
import type { CustomSetSpec, PlayArt, SetDef, SetsFile, ValidationIssue } from "../../model/types";
import { useLibrary } from "../../state/library";
import { href, navigate } from "../../state/router";
import { useDocsOfKind, useWorkspace, type DocEntry } from "../../state/workspace";
import { cloneWarnings, findCustomFormation } from "./setModel";

export type SetsDoc = DocEntry<SetsFile | null>;

/** Every playbooks/sets/*.json doc (stable order by path; memoized by the store). */
export function useSetsDocs(): SetsDoc[] {
  return useDocsOfKind<SetsFile | null>("sets");
}

/** The raw game library (bases must be library sets; the catalog overlay would also contain the custom sets). */
export function useLib(): LibraryIndex | undefined {
  return useLibrary((s) => s.lib);
}

/** Inputs for cross-file validation: path + data (null for docs that failed to load). */
export function useSetsInputs(docs: SetsDoc[]): { path: string; data: SetsFile | null }[] {
  return useMemo(() => docs.map((d) => ({ path: d.path, data: d.error ? null : d.data })), [docs]);
}

/** Validation of every sets file (memoized on the docs' data). */
export function useSetsIssues(lib: LibraryIndex | undefined, docs: SetsDoc[]): ValidationIssue[] {
  const inputs = useSetsInputs(docs);
  return useMemo(() => (lib ? validateSetsFiles(inputs, lib) : []), [lib, inputs]);
}

export const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export const editorHref = (file: string, index: number) => href("formations", file, index);

export function openSet(file: string, index: number): void {
  navigate(editorHref(file, index));
}

/** Players-only art for a library set (cards in the wizard). Cached per set object. */
const librarySetArt = new WeakMap<SetDef, PlayArt>();
export function setArt(set: SetDef): PlayArt {
  let art = librarySetArt.get(set);
  if (!art) {
    try {
      art = computeArt(set, []);
    } catch {
      art = emptyArt();
    }
    librarySetArt.set(set, art);
  }
  return art;
}

/** Players-only art for a custom set (Normal, a motion preset or "flipped"), cached per (spec object, view). */
export const FLIPPED = "__flipped__";
const customArt = new WeakMap<CustomSetSpec, Map<string, PlayArt>>();
export function customSetArt(base: SetDef, spec: CustomSetSpec, view = NORMAL): PlayArt {
  let byView = customArt.get(spec);
  if (!byView) {
    byView = new Map();
    customArt.set(spec, byView);
  }
  let art = byView.get(view);
  if (!art) {
    try {
      art = view === FLIPPED ? computeArt(flippedSet(base, spec), []) : computeArt(effectiveSet(base, spec), [], { preset: view === NORMAL ? undefined : view });
    } catch {
      art = emptyArt();
    }
    byView.set(view, art);
  }
  return art;
}

/** Formation display name of a custom set (custom formation name, or the library formation's). */
export function formationNameOf(lib: LibraryIndex, spec: CustomSetSpec, formations: SetsFile["formations"]): { name: string; custom: boolean } {
  const custom = findCustomFormation(formations, spec.formation)?.cf;
  if (custom) return { name: custom.name || custom.asset, custom: true };
  return { name: lib.formationByAsset.get(spec.formation)?.name ?? "Unknown formation", custom: false };
}

/**
 * The pieces of a custom set's "GUN · from Y TRIPS WK" subtitle: the formation's short name and the base set's name
 * (Madden names: callers show them in caps, the "from" between them is chrome).
 */
export function customSubtitle(lib: LibraryIndex, spec: CustomSetSpec, formations: SetsFile["formations"]): { formation: string; from?: string } {
  const form = formationNameOf(lib, spec, formations);
  return { formation: form.custom ? form.name : formationShort(form.name), from: lib.setByAsset.get(spec.base)?.name };
}

/** Make `file` the doc that global undo/redo/save act on. */
export function activate(file: string | undefined): void {
  useWorkspace.getState().setActive(file);
}

/** Issue counts by level. */
export function countIssues(issues: ValidationIssue[]): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const i of issues) {
    if (i.level === "error") errors++;
    else if (i.level === "warning") warnings++;
  }
  return { errors, warnings };
}

/**
 * What the formations views show for one custom set: its validateSetsFile issues, except the generic
 * "set-play-depends" rule, which is replaced by one warning per copied play from setModel.cloneWarnings (measured
 * against each play's own set; receivers' blocks follow them — FORMATS.md §5). Rule "set-clone-depends".
 */
export function setDisplayIssues(lib: LibraryIndex, fileIssues: ValidationIssue[], index: number, spec: CustomSetSpec, base: SetDef | undefined): ValidationIssue[] {
  const out = issuesForSet(fileIssues, index).filter((i) => i.rule !== "set-play-depends");
  if (!base || !Array.isArray(spec.plays) || !spec.plays.length) return out;
  const stock = lib.stock ?? lib;
  const normal = effectiveNormal(base, spec);
  spec.plays.forEach((c, k) => {
    const play = c && typeof c.from === "string" ? stock.playByAsset.get(c.from) : undefined;
    if (!play) return;
    const w = cloneWarnings(lib, play, normal);
    if (!w.length) return;
    const first = w[0];
    out.push({
      level: "warning",
      rule: "set-clone-depends",
      where: `/sets/${index}/plays/${k}`,
      file: fileIssues[0]?.file,
      // Same "<set>: …" shape as validateSetsFile messages (the inspector strips the set name).
      message: `${spec.name ? maddenName(spec.name) : "Set"}: Play ${maddenName(c.name || play.name)} — ${first.label} ${first.reason}${w.length > 1 ? ` (+${w.length - 1} more)` : ""}`,
    });
  });
  return out;
}
