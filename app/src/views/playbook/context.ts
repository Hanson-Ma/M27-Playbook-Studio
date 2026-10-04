// Shared data for the builder's panes: the doc, resolved book, stable ids, node lookup and the edit helper.
import { createContext, useContext } from "react";
import type { Catalog } from "../../model/catalog";
import type { LibraryIndex } from "../../model/library";
import type { BookIds, EntryRef } from "../../model/playbook";
import type { ResolvedBook, ResolvedBookFormation, ResolvedBookPlay, ResolvedBookSet } from "../../model/resolveBook";
import { templateFormationFor, type TemplateFormation, type TemplatePlay, type TemplateSet } from "../../model/tdb";
import type { PlaybookSpec, ValidationIssue } from "../../model/types";
import { BOOK_ID, type NodeLevel } from "./store";
import type { TemplateState } from "./template";
import type { DragHandlers } from "./dnd";
import type { CustomMarkers } from "./custom";

export interface BookNode {
  id: string;
  level: NodeLevel;
  ref?: EntryRef;
  rf?: ResolvedBookFormation;
  rs?: ResolvedBookSet;
  rp?: ResolvedBookPlay;
  /** Template contents (read-only) for template formations and their rows. */
  tf?: TemplateFormation;
  ts?: TemplateSet;
  tp?: TemplatePlay;
}

export interface BuilderData {
  path: string;
  spec: PlaybookSpec;
  catalog: Catalog;
  lib: LibraryIndex;
  side: "offense" | "defense";
  book: ResolvedBook;
  ids: BookIds;
  nodes: Map<string, BookNode>;
  issues: ValidationIssue[];
  template: TemplateState;
  /** Custom formations / sets (FORMATS.md §5, from the catalog overlay) — for the CUSTOM SET badges. */
  custom: CustomMarkers;
  /** One undoable edit of this playbook (same label within coalesceMs merges, e.g. slider drags). */
  edit(label: string, recipe: (draft: PlaybookSpec) => void, opts?: { coalesceMs?: number }): void;
}

export const BuilderContext = createContext<BuilderData | null>(null);

export function useBuilder(): BuilderData {
  const d = useContext(BuilderContext);
  if (!d) throw new Error("useBuilder outside the playbook builder");
  return d;
}

export const tsetId = (fid: string, ts: TemplateSet) => `${fid}/TS:${ts.set.setId}`;

/** Every node of the book (entries + read-only template contents), keyed by id. */
export function buildNodes(book: ResolvedBook, ids: BookIds, template: TemplateState): Map<string, BookNode> {
  const nodes = new Map<string, BookNode>();
  nodes.set(BOOK_ID, { id: BOOK_ID, level: "book" });
  book.formations.forEach((rf, f) => {
    const fIds = ids.formations[f];
    if (!fIds) return;
    const tf = rf.template && template.contents ? templateFormationFor(template.contents, rf.formation) : undefined;
    nodes.set(fIds.id, { id: fIds.id, level: "formation", ref: { f }, rf, tf });
    rf.sets.forEach((rs, s) => {
      const sIds = fIds.sets[s];
      if (!sIds) return;
      nodes.set(sIds.id, { id: sIds.id, level: "set", ref: { f, s }, rf, rs });
      rs.plays.forEach((rp, p) => {
        const pid = sIds.plays[p];
        if (pid) nodes.set(pid, { id: pid, level: "play", ref: { f, s, p }, rf, rs, rp });
      });
    });
    if (tf) {
      for (const ts of tf.sets) {
        const sid = tsetId(fIds.id, ts);
        nodes.set(sid, { id: sid, level: "tset", ref: { f }, rf, tf, ts });
        const seen = new Map<number, number>();
        for (const tp of ts.plays) {
          const k = seen.get(tp.play.playId) ?? 0;
          seen.set(tp.play.playId, k + 1);
          const pid = `${sid}/TP:${tp.play.playId}#${k}`;
          nodes.set(pid, { id: pid, level: "tplay", ref: { f }, rf, tf, ts, tp });
        }
      }
    }
  });
  return nodes;
}

/** Template play node ids of a template set node, in order. */
export function tplayIds(sid: string, ts: TemplateSet): string[] {
  const seen = new Map<number, number>();
  return ts.plays.map((tp) => {
    const k = seen.get(tp.play.playId) ?? 0;
    seen.set(tp.play.playId, k + 1);
    return `${sid}/TP:${tp.play.playId}#${k}`;
  });
}

// Context menu opener and drag handlers (provided by the builder).
export type OpenMenu = (node: BookNode, at: { x: number; y: number }, expanded?: boolean) => void;
export const MenuOpener = createContext<OpenMenu>(() => undefined);
export const useOpenMenu = () => useContext(MenuOpener);

export const DragHandlersContext = createContext<DragHandlers | null>(null);
export function useDragHandlers(): DragHandlers {
  const h = useContext(DragHandlersContext);
  if (!h) throw new Error("useDragHandlers outside the builder");
  return h;
}
