// Keeps playbooks pointing at custom sets and formations while they are edited in Formations (model/followSets.ts):
// rename a set, move it to another formation, or rename a custom formation, and every playbook entry that named it
// follows, as do the plays based on its clones. Reacts to any in-app change of a sets doc (typing, undo, redo), never
// to a file reloaded from disk. Each follow-up edit coalesces with the next one (typing a name is one undo step per
// playbook).
import { catalogOverlay } from "../model/catalog";
import { followFormationRename, followSetMove, formationRenames, rebaseClones, rebasePlays, setFolder, setMoves, type SetMove } from "../model/followSets";
import type { LibraryIndex } from "../model/library";
import { deepClone } from "../model/playbook";
import type { PlaybookSpec, PlaysFile, SetsFile } from "../model/types";
import { useLibrary } from "./library";
import { useWorkspace, type DocEntry, type WorkspaceState } from "./workspace";

const COALESCE_MS = 1500;

function setsInputs(docs: WorkspaceState["docs"]) {
  return Object.values(docs)
    .filter((d): d is DocEntry<SetsFile> => d.kind === "sets" && !d.error && !!d.data && typeof d.data === "object")
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((d) => ({ path: d.path, data: d.data }));
}

/** What the playbook calls the set's new formation: the custom formation's name, else the library formation's. */
function formationName(lib: LibraryIndex, move: SetMove): string {
  return lib.formationByAsset.get(move.to.formation)?.name ?? move.to.formation.split("/").pop() ?? "";
}

/** Run `edit` on a copy first; only touch the doc (one coalesced undo step) when something changes. */
function editIfChanged<T>(path: string, data: T, edit: (draft: T) => number, label: string): number {
  const probe = deepClone(data);
  if (!edit(probe)) return 0;
  let n = 0;
  useWorkspace.getState().update<T>(
    path,
    (d) => {
      n = edit(d);
    },
    { label, coalesceMs: COALESCE_MS },
  );
  return n;
}

let busy = false;

/** Start following (App mounts it once); returns the unsubscribe function. */
export function followSetEdits(): () => void {
  return useWorkspace.subscribe((st, prev) => {
    if (busy || st.docs === prev.docs) return;
    const stock = useLibrary.getState().lib;
    if (!stock) return;
    const moves: SetMove[] = [];
    const renames: ReturnType<typeof formationRenames> = [];
    for (const [path, b] of Object.entries(st.docs)) {
      const a = prev.docs[path];
      if (!a || b.kind !== "sets" || a.data === b.data || a.error || b.error) continue;
      // Reloaded from disk (or saved over by another tab): not an edit made here.
      if (a.savedText !== b.savedText && !b.dirty) continue;
      moves.push(...setMoves(a.data as SetsFile, b.data as SetsFile));
      renames.push(...formationRenames(a.data as SetsFile, b.data as SetsFile));
    }
    if (!moves.length && !renames.length) return;

    const prevLib = catalogOverlay(stock, setsInputs(prev.docs)).lib;
    const nextLib = catalogOverlay(stock, setsInputs(st.docs)).lib;
    busy = true;
    try {
      for (const doc of Object.values(useWorkspace.getState().docs)) {
        if (doc.error || !doc.data) continue;
        if (doc.kind === "playbook") {
          editIfChanged<PlaybookSpec>(
            doc.path,
            doc.data as PlaybookSpec,
            (d) =>
              renames.reduce((n, r) => n + followFormationRename(d, r, prevLib), 0) +
              moves.reduce((n, m) => n + followSetMove(d, m, prevLib, nextLib, formationName(nextLib, m)), 0),
            "Follow set changes",
          );
        }
        // A set that changed formation moved its clones' folder: plays based on them follow.
        for (const m of moves) {
          if (m.from.formation.toLowerCase() === m.to.formation.toLowerCase()) continue;
          const from = setFolder(m.from.formation, m.asset);
          const to = setFolder(m.to.formation, m.asset);
          if (doc.kind === "plays") editIfChanged<PlaysFile>(doc.path, doc.data as PlaysFile, (d) => rebasePlays(d, from, to), "Follow set changes");
          if (doc.kind === "sets") editIfChanged<SetsFile>(doc.path, doc.data as SetsFile, (d) => rebaseClones(d, from, to), "Follow set changes");
        }
      }
    } catch (e) {
      console.warn("[followSets] couldn't update the playbooks:", e);
    } finally {
      busy = false;
    }
  });
}
