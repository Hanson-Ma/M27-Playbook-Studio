// Library loading (data/library/*.json via the server) + the play catalog (library + custom sets/clones + custom plays).
import { useMemo } from "react";
import { create } from "zustand";
import { fetchLibraryFile } from "../api/client";
import { buildCatalog, type Catalog } from "../model/catalog";
import { buildLibraryIndex, type LibraryIndex } from "../model/library";
import type { AssignmentDef, EnumsFile, FormationDef, LibraryData, PlayDef, PlaysFile, SetDef, SetsFile } from "../model/types";
import { selectDocsOfKind, useDocsOfKind, useWorkspace, type DocEntry } from "./workspace";

export interface LibraryState {
  status: "idle" | "loading" | "ready" | "error";
  /** Bytes received across all five files; `label` names the file currently streaming (or the index build). */
  progress: { loaded: number; total: number; label: string };
  lib?: LibraryIndex;
  error?: string;
  /** Fetch + index the library. Idempotent: concurrent calls share one load; after an error it retries. */
  load(): Promise<void>;
}

// Largest first: the progress label names the biggest file still streaming, so it doesn't flicker between files.
const FILES = ["plays", "assignments", "sets", "enums", "formations"] as const;
type FileName = (typeof FILES)[number];

let inflight: Promise<void> | undefined;
/** Bumped per load: fetches abandoned by a failed load must not report into the retry. */
let loadSeq = 0;

export const useLibrary = create<LibraryState>()((set, get) => ({
  status: "idle",
  progress: { loaded: 0, total: 0, label: "" },
  lib: undefined,
  error: undefined,

  load() {
    if (get().status === "ready") return Promise.resolve();
    if (inflight) return inflight;

    const loaded: Record<FileName, number> = { formations: 0, sets: 0, plays: 0, assignments: 0, enums: 0 };
    const totals: Record<FileName, number> = { formations: 0, sets: 0, plays: 0, assignments: 0, enums: 0 };
    const done = new Set<FileName>();
    const token = ++loadSeq;
    const report = (label?: string) => {
      if (token !== loadSeq) return;
      const l = FILES.reduce((n, f) => n + loaded[f], 0);
      // Unknown totals count what has arrived so far, so the bar never runs past 100%.
      const t = FILES.reduce((n, f) => n + Math.max(totals[f], loaded[f]), 0);
      const pending = FILES.find((f) => !done.has(f));
      set({ progress: { loaded: l, total: t, label: label ?? (pending ? `${pending}.json` : "Indexing plays…") } });
    };
    const fetchOne = async <T,>(name: FileName): Promise<T> => {
      const value = await fetchLibraryFile<T>(name, (l, t) => {
        loaded[name] = l;
        totals[name] = t;
        report();
      });
      done.add(name);
      report();
      return value;
    };

    set({ status: "loading", error: undefined, progress: { loaded: 0, total: 0, label: "Connecting…" } });
    inflight = (async () => {
      try {
        const [formations, sets, plays, assignments, enums] = await Promise.all([
          fetchOne<FormationDef[]>("formations"),
          fetchOne<SetDef[]>("sets"),
          fetchOne<PlayDef[]>("plays"),
          fetchOne<Record<string, AssignmentDef>>("assignments"),
          fetchOne<EnumsFile>("enums"),
        ]);
        report("Indexing plays…");
        // Let the loading screen paint the final progress before the synchronous index build.
        await new Promise((r) => setTimeout(r, 0));
        const data: LibraryData = { formations, sets, plays, assignments, enums };
        const lib = buildLibraryIndex(data);
        set({ status: "ready", lib, progress: { ...get().progress, label: "Ready" } });
      } catch (err) {
        loadSeq++; // silence the other fetches of this attempt
        set({ status: "error", error: err instanceof Error ? err.message : String(err) });
      } finally {
        inflight = undefined;
      }
    })();
    return inflight;
  },
}));

// ───────────────────────────── catalog ─────────────────────────────

type PlaysInput = { path: string; data: PlaysFile };
type SetsInput = { path: string; data: SetsFile };

// One shared catalog for the whole app: every component (and getCatalog) sees the same instance and version, and it
// is rebuilt only when the library or a plays/sets doc's data object changes (not on dirty/saved flag changes).
// Sets docs (playbooks/sets/*.json) feed the catalog overlay: custom formations/sets in catalog.lib + their clones.
let cached: { lib: LibraryIndex; inputs: PlaysInput[]; sets: SetsInput[]; catalog: Catalog } | undefined;

function inputsOf<T>(docs: DocEntry<T>[]): { path: string; data: T }[] {
  return docs.filter((d) => !d.error && d.data && typeof d.data === "object").map((d) => ({ path: d.path, data: d.data }));
}

function sameInputs<T>(a: { path: string; data: T }[], b: { path: string; data: T }[]): boolean {
  return a.length === b.length && a.every((x, i) => x.path === b[i].path && x.data === b[i].data);
}

function catalogFor(lib: LibraryIndex, docs: DocEntry<PlaysFile>[], setsDocs: DocEntry<SetsFile>[]): Catalog {
  const inputs = inputsOf(docs);
  const sets = inputsOf(setsDocs);
  if (cached && cached.lib === lib && sameInputs(cached.inputs, inputs) && sameInputs(cached.sets, sets)) return cached.catalog;
  const catalog = buildCatalog(lib, inputs, sets);
  cached = { lib, inputs, sets, catalog };
  return catalog;
}

/** The catalog for the current library + plays and sets docs (undefined until the library is loaded). */
export function useCatalog(): Catalog | undefined {
  const lib = useLibrary((s) => s.lib);
  const docs = useDocsOfKind<PlaysFile>("plays");
  const setsDocs = useDocsOfKind<SetsFile>("sets");
  return useMemo(() => (lib ? catalogFor(lib, docs, setsDocs) : undefined), [lib, docs, setsDocs]);
}

/** Non-hook access for actions and other stores (same shared instance as useCatalog). */
export function getCatalog(): Catalog | undefined {
  const lib = useLibrary.getState().lib;
  const ws = useWorkspace.getState();
  return lib ? catalogFor(lib, selectDocsOfKind<PlaysFile>(ws, "plays"), selectDocsOfKind<SetsFile>(ws, "sets")) : undefined;
}
