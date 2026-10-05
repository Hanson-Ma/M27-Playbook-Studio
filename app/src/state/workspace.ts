// Workspace store: every editable document (playbooks, plays, sets, app-data) with undo/redo and save
// (ARCHITECTURE.md "Workspace store").
//
// - Doc data is immutable: edits go through update() (an immer recipe) or replace(); data is deep-frozen so an
//   accidental in-place mutation throws instead of silently skipping history and dirty tracking.
// - `savedText` is what the file holds in canonical form (serializeDoc of the parsed file at load, or the text we
//   wrote at save), so an untouched doc is clean even if the file on disk isn't canonically formatted.
// - `dirty` is computed when data changes, never in render.
// - `past` is oldest → newest (last = the state undo returns to); `future` is a stack (last = the state redo
//   returns to).
// - Files also change outside the app (an editor, git, the game PC's sync, a second browser tab). Each doc keeps the
//   disk version (mtime + size) it was loaded or saved as (`disk`); save() only overwrites that version — or, for a
//   doc that isn't on disk, only creates the file when neither it nor a letter-case variant exists. A refused save
//   records `conflicts[path]`, flags the doc `changedOnDisk` and rejects with a ConflictError; resolveConflict()
//   settles it (reload / overwrite / save a copy). refresh() runs whenever the window regains focus: clean docs whose
//   file changed reload, dirty ones are flagged `changedOnDisk` (never replaced).
import { freeze, produce } from "immer";
import { create } from "zustand";
import * as api from "../api/client";
import { ConflictError, type ConflictReason, type FileVersion, type WritePrecondition } from "../api/client";
import { parseJson, serializeDoc } from "../model/json";
import type { DocKind, FileInfo } from "../model/types";

export { ConflictError };
export type { ConflictReason, FileVersion };

export interface DocEntry<T = unknown> {
  path: string;
  kind: DocKind;
  /** Parsed file content. `null` when the doc failed to load (`error` is set) — check `error` before using. */
  data: T;
  savedText: string;
  dirty: boolean;
  past: T[];
  future: T[];
  /** Load failure (unreadable file or invalid JSON). Such docs are read-only until fixed on disk + refresh(). */
  error?: string;
  /** Not on disk: created in the app and never saved, or deleted on disk while it had unsaved edits. */
  isNew?: boolean;
  /** The disk version (mtime + size) `savedText` came from: loaded or last saved. save() only overwrites this version. */
  disk?: FileVersion;
  /**
   * The file changed, was deleted, or (for a never-saved doc) appeared on disk while this doc had unsaved edits.
   * Saving will conflict; see resolveConflict(). Set by refresh() and by a refused save.
   */
  changedOnDisk?: boolean;
}

/** A save refused because the file on disk wasn't the version the doc was loaded/saved as. */
export interface DocConflict {
  /** "changed" / "deleted" since it was loaded or saved; "exists": a doc that isn't on disk yet found a file there. */
  reason: ConflictReason;
  /** The file on disk when the save was refused (absent when deleted). For "exists" its path may differ in letter case. */
  file?: FileInfo;
  /** The server's explanation, e.g. "playbooks/a.json changed on disk after it was loaded (…)". */
  message: string;
}

/**
 * How to settle a conflict: "reload" = take the disk version (your edits stay one undo step away; for a deleted file
 * the doc is dropped), "overwrite" = write your version over what's on disk now, "copy" = save your version as a new
 * file next to it (`<name>-copy.json`, `-copy2`…) and reload the original.
 */
export type ConflictChoice = "reload" | "overwrite" | "copy";

export interface WorkspaceState {
  ready: boolean;
  loading: boolean;
  files: FileInfo[];
  docs: Record<string, DocEntry>;
  activePath?: string;
  /** Last init()/refresh() failure (e.g. server unreachable); cleared by the next successful one. */
  error?: string;
  /** Saves refused because the file on disk changed, by doc path. Cleared by resolveConflict(), a later successful save, or remove(). */
  conflicts: Record<string, DocConflict>;
  /** List files + load every doc. Safe to call repeatedly (one load); never rejects — failures set `error`. */
  init(): Promise<void>;
  /**
   * Re-list; load new files and reload clean docs whose file changed on disk; dirty docs are never replaced (they get
   * `changedOnDisk`). Runs on window focus too. Concurrent calls share one pass. Never rejects.
   */
  refresh(): Promise<void>;
  /** The doc that global undo/redo/save act on. */
  setActive(path?: string): void;
  /** New unsaved (dirty) doc. Throws if the path — or a path differing only in letter case — is a doc or a file. */
  create<T>(path: string, kind: DocKind, data: T): void;
  /** Edit with an immer recipe. Same `label` within `coalesceMs` (default 1000) → one undo step (drags, typing). */
  update<T>(path: string, recipe: (draft: T) => void, opts?: { label?: string; coalesceMs?: number }): void;
  replace<T>(path: string, data: T, opts?: { label?: string }): void;
  undo(path?: string): void;
  redo(path?: string): void;
  /**
   * Write the doc if dirty (default: activePath), only over the disk version it was loaded/saved as. Rejects with a
   * ConflictError (and records `conflicts[path]`) when the file changed on disk, or with the server's message.
   */
  save(path?: string): Promise<void>;
  /** Save every dirty doc; rejects with a SaveAllError listing every failure (conflicts included — nothing is overwritten). */
  saveAll(): Promise<void>;
  /** Settle a conflicted / changedOnDisk doc (see ConflictChoice). Resolves to the path to show afterwards (see below). */
  resolveConflict(path: string, choice: ConflictChoice): Promise<string | undefined>;
  /** Back to the last loaded/saved content, as an undoable step. */
  revert(path: string): void;
  /** Soft-delete on the server (app-data/.trash), or just drop a never-saved doc. */
  remove(path: string): Promise<void>;
  /**
   * Save pending edits, then rename on disk (only the version the doc tracks: a ConflictError if the file changed
   * since it was loaded); history and activePath follow the doc.
   */
  rename(from: string, to: string): Promise<void>;
}

export const HISTORY_LIMIT = 200;
export const DEFAULT_COALESCE_MS = 1000;
/** Window focus / visibility re-checks run at most this often. */
export const FOCUS_REFRESH_MIN_MS = 1000;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** saveAll() failure: one entry per doc that didn't save. Conflicts (file changed on disk) are ConflictErrors. */
export class SaveAllError extends Error {
  readonly failures: { path: string; error: unknown }[];

  constructor(failures: { path: string; error: unknown }[]) {
    super(`Couldn't save ${failures.length} file(s):\n${failures.map((f) => `${f.path}: ${message(f.error)}`).join("\n")}`);
    this.name = "SaveAllError";
    this.failures = failures;
  }

  /** Paths whose save was refused because the file changed on disk (see WorkspaceState.conflicts). */
  get conflicts(): string[] {
    return this.failures.filter((f) => f.error instanceof ConflictError).map((f) => f.path);
  }
}

// Side tables that aren't render state.
/** The data object whose serialization is savedText — an O(1) clean check after undo/revert. */
const baseline = new Map<string, unknown>();
/** Last labeled edit per doc, for coalescing. */
const lastEdit = new Map<string, { label: string; time: number }>();
/** In-flight save per doc: saves of one doc run in order so an older write can't land last. */
const saveQueue = new Map<string, Promise<void>>();
let initPromise: Promise<void> | undefined;
/** The refresh pass in flight; calls made meanwhile set refreshAgain and share it. */
let refreshing: Promise<void> | undefined;
let refreshAgain = false;

/** Doc kind for a repo-relative path (same rule as the server's file listing). */
export function docKindForPath(path: string): DocKind {
  if (path.startsWith("playbooks/plays/")) return "plays";
  if (path.startsWith("playbooks/sets/")) return "sets";
  if (path === "app-data/concepts.json") return "concepts";
  if (path.startsWith("playbooks/")) return "playbook";
  return "appdata";
}

const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const versionOf = (f: FileVersion): FileVersion => ({ mtime: f.mtime, size: f.size });
const sameVersion = (a: FileVersion | undefined, b: FileVersion | undefined) => !!a && !!b && a.mtime === b.mtime && a.size === b.size;

function without<T>(rec: Record<string, T>, key: string): Record<string, T> {
  if (!(key in rec)) return rec;
  const out = { ...rec };
  delete out[key];
  return out;
}

/**
 * The doc path or listed file path equal to `path` ignoring letter case (`except` excluded): macOS and Windows treat
 * such names as one file, so creating one would overwrite the other.
 */
function takenPath(s: Pick<WorkspaceState, "docs" | "files">, path: string, except?: string): string | undefined {
  const lower = path.toLowerCase();
  const hit = (p: string) => p !== except && p.toLowerCase() === lower;
  return Object.keys(s.docs).find(hit) ?? s.files.find((f) => hit(f.path))?.path;
}

/** Free sibling path for a conflict copy: `<dir>/<name>-copy.json`, then `-copy2`, `-copy3`… */
export function conflictCopyPath(path: string): string {
  const s = useWorkspace.getState();
  const stem = path.toLowerCase().endsWith(".json") ? path.slice(0, -5) : path;
  for (let i = 1; ; i++) {
    const cand = `${stem}-copy${i === 1 ? "" : i}.json`;
    if (!takenPath(s, cand)) return cand;
  }
}

function computeDirty(e: DocEntry): boolean {
  if (e.error) return false;
  if (e.isNew) return true;
  if (e.data === baseline.get(e.path)) return false;
  return serializeDoc(e.kind, e.data) !== e.savedText;
}

/** Push onto a bounded history stack. */
function pushLimited<T>(stack: T[], item: T): T[] {
  const next = stack.length >= HISTORY_LIMIT ? stack.slice(stack.length - HISTORY_LIMIT + 1) : stack.slice();
  next.push(item);
  return next;
}

function upsertFile(files: FileInfo[], file: FileInfo): FileInfo[] {
  return [...files.filter((f) => f.path !== file.path), file].sort(byPath);
}

function forget(path: string): void {
  baseline.delete(path);
  lastEdit.delete(path);
}

/** What a save must find on disk: the version the doc came from, or (not on disk) nothing at that path. */
function preconditionFor(doc: DocEntry): WritePrecondition | undefined {
  if (doc.disk) return { ifMatch: doc.disk };
  if (doc.isNew) return { ifAbsent: true };
  return undefined; // loaded from a server that doesn't report versions
}

/** Read + parse one file into a doc entry. Never throws: failures become an entry with `error`. */
async function loadEntry(path: string, kind: DocKind): Promise<DocEntry> {
  const base: DocEntry = { path, kind, data: null, savedText: "", dirty: false, past: [], future: [] };
  let text: string;
  try {
    const read = await api.readFile(path);
    text = read.text;
    if (read.version) base.disk = read.version;
  } catch (err) {
    return { ...base, error: `Can't read ${path}: ${message(err)}` };
  }
  let data: unknown;
  try {
    data = freeze(parseJson(text), true);
  } catch (err) {
    return { ...base, savedText: text, error: `Invalid JSON in ${path}: ${message(err)}` };
  }
  return { ...base, data, savedText: serializeDoc(kind, data) };
}

/** Install loaded entries, skipping docs the user edited while the load was in flight. */
function mergeLoaded(docs: Record<string, DocEntry>, entries: DocEntry[]): Record<string, DocEntry> {
  const out = { ...docs };
  for (const e of entries) {
    const cur = out[e.path];
    if (cur && (cur.dirty || cur.isNew)) continue;
    out[e.path] = e;
    lastEdit.delete(e.path);
    if (e.error) baseline.delete(e.path);
    else baseline.set(e.path, e.data);
  }
  return out;
}

export const useWorkspace = create<WorkspaceState>()((set, get) => {
  /** Record a new data state for a doc as one history step (or merge it into the current labeled step). */
  function commit(path: string, next: unknown, label?: string, coalesceMs = DEFAULT_COALESCE_MS): void {
    set((s) => {
      const doc = s.docs[path];
      if (!doc || doc.error || Object.is(next, doc.data)) return s; // same state object: no notification
      const now = Date.now();
      const last = lastEdit.get(path);
      const merge = label !== undefined && last?.label === label && now - last.time <= coalesceMs && doc.past.length > 0;
      if (label !== undefined) lastEdit.set(path, { label, time: now });
      else lastEdit.delete(path);
      const entry: DocEntry = { ...doc, data: next, past: merge ? doc.past : pushLimited(doc.past, doc.data), future: [] };
      entry.dirty = computeDirty(entry);
      return { docs: { ...s.docs, [path]: entry } };
    });
  }

  /**
   * Move a doc (and its side-table state) to a new path. `adopt`: the backend renamed exactly the version the doc
   * tracks (If-Match), so the doc now tracks the renamed file's version — the server keeps mtime and size, but the
   * browser-folder backend copies the file (new mtime). Otherwise its `disk` version stays.
   */
  function rekey(from: string, to: string, kind: DocKind, file?: FileInfo, adopt = false): void {
    set((s) => {
      const docs = { ...s.docs };
      const cur = docs[from];
      delete docs[from];
      if (cur) {
        if (baseline.has(from)) baseline.set(to, baseline.get(from));
        const entry: DocEntry = { ...cur, path: to, kind, ...(adopt && file ? { disk: versionOf(file) } : {}) };
        entry.dirty = computeDirty(entry);
        docs[to] = entry;
      }
      let files = s.files.filter((f) => f.path !== from);
      if (file) files = upsertFile(files, file);
      const moved = s.conflicts[from];
      const conflicts = moved ? { ...without(s.conflicts, from), [to]: moved } : s.conflicts;
      return { docs, files, conflicts, activePath: s.activePath === from ? to : s.activePath };
    });
    baseline.delete(from);
    lastEdit.delete(from);
  }

  /** Drop a doc from the workspace (nothing on the server changes). */
  function drop(path: string): void {
    set((s) => {
      const docs = { ...s.docs };
      delete docs[path];
      return {
        docs,
        files: s.files.filter((f) => f.path !== path),
        conflicts: without(s.conflicts, path),
        activePath: s.activePath === path ? undefined : s.activePath,
      };
    });
    forget(path);
  }

  /**
   * Write a doc, queued behind earlier saves of the same path. `force` writes a clean doc too; `pre` replaces the
   * doc's own precondition. A ConflictError records `conflicts[p]` + `changedOnDisk` and is rethrown.
   */
  function write(p: string, opts: { force?: boolean; pre?: WritePrecondition } = {}): Promise<void> {
    const run = async () => {
      const doc = get().docs[p];
      if (!doc || doc.error || !(opts.force || doc.dirty || doc.isNew)) return;
      const data = doc.data;
      const text = serializeDoc(doc.kind, data);
      let file: FileInfo;
      try {
        file = await api.writeText(p, text, opts.pre ?? preconditionFor(doc));
      } catch (err) {
        if (err instanceof ConflictError) {
          set((s) => {
            const conflicts = { ...s.conflicts, [p]: { reason: err.reason, file: err.file, message: err.message } };
            const cur = s.docs[p];
            if (!cur || cur.changedOnDisk) return { conflicts };
            return { conflicts, docs: { ...s.docs, [p]: { ...cur, changedOnDisk: true } } };
          });
        }
        throw err;
      }
      set((s) => {
        const files = upsertFile(s.files, file);
        const conflicts = without(s.conflicts, p);
        const cur = s.docs[p];
        if (!cur) return { files, conflicts };
        baseline.set(p, data);
        const { isNew: _wasNew, changedOnDisk: _moved, ...rest } = cur;
        // Edits made while the write was in flight keep the doc dirty (data !== the saved snapshot).
        const entry: DocEntry = { ...rest, savedText: text, disk: versionOf(file) };
        entry.dirty = computeDirty(entry);
        return { files, conflicts, docs: { ...s.docs, [p]: entry } };
      });
    };
    // Start right away when idle so the snapshot is what the user saw when they hit save.
    const pending = saveQueue.get(p);
    const queued = pending ? pending.catch(() => {}).then(run) : run();
    saveQueue.set(p, queued);
    return queued.finally(() => {
      if (saveQueue.get(p) === queued) saveQueue.delete(p);
    });
  }

  /** The file on disk for `path` right now (exact, else a letter-case variant), from a fresh listing. */
  async function diskFile(path: string): Promise<FileInfo | undefined> {
    const files = await api.listFiles();
    const lower = path.toLowerCase();
    return files.find((f) => f.path === path) ?? files.find((f) => f.path.toLowerCase() === lower);
  }

  /** Replace a doc with its file's content as one undo step (see ConflictChoice "reload"). */
  async function reloadFromDisk(path: string, disk: FileInfo | undefined): Promise<string | undefined> {
    if (!disk) {
      drop(path); // deleted on disk: nothing to reload
      return undefined;
    }
    if (disk.path !== path) {
      // A never-saved doc clashed with a file whose name differs in letter case: that file is the one to show.
      drop(path);
      await get().refresh();
      return disk.path;
    }
    const { text, version } = await api.readFile(path);
    let data: unknown;
    try {
      data = freeze(parseJson(text), true);
    } catch (err) {
      throw new Error(`Can't reload ${path}: the file on disk isn't valid JSON (${message(err)})`);
    }
    const now = version ?? versionOf(disk);
    set((s) => {
      const cur = s.docs[path];
      if (!cur) return s;
      lastEdit.delete(path);
      baseline.set(path, data);
      const { isNew: _n, changedOnDisk: _c, ...rest } = cur;
      const entry: DocEntry = {
        ...rest,
        data,
        savedText: serializeDoc(cur.kind, data),
        disk: now,
        dirty: false,
        // ⌘Z brings the replaced edits back (as unsaved changes against the new disk version).
        past: cur.error ? cur.past : pushLimited(cur.past, cur.data),
        future: [],
      };
      return {
        docs: { ...s.docs, [path]: entry },
        files: upsertFile(s.files, { ...disk, ...now }),
        conflicts: without(s.conflicts, path),
      };
    });
    return path;
  }

  async function refreshOnce(): Promise<void> {
    // Let our own in-flight writes land first so the listing doesn't race them.
    await Promise.allSettled([...saveQueue.values()]);
    const start = get();
    const snap = start.docs;
    const filesAtStart = start.files;
    let listed: FileInfo[];
    try {
      listed = await api.listFiles();
    } catch (err) {
      set({ error: `Can't refresh the workspace: ${message(err)}` });
      return;
    }
    const prev = new Map(filesAtStart.map((f) => [f.path, f]));
    const listedByPath = new Map(listed.map((f) => [f.path, f]));
    const listedByLower = new Map(listed.map((f) => [f.path.toLowerCase(), f]));
    // The version a doc was loaded as; servers that don't report one fall back to the previous listing.
    const known = (d: DocEntry) => d.disk ?? (d.isNew ? undefined : prev.get(d.path));

    const stale = listed.filter((f) => {
      const doc = snap[f.path];
      if (!doc || doc.error) return true; // new, or maybe fixed on disk
      if (doc.dirty || doc.isNew) return false; // unsaved edits are never replaced (flagged below)
      return !sameVersion(known(doc), f);
    });
    const entries = await Promise.all(stale.map((f) => loadEntry(f.path, f.kind)));

    set((s) => {
      const docs = { ...s.docs };
      // A loaded entry replaces a doc only if the doc didn't change meanwhile (an edit, save or create wins).
      for (const e of entries) {
        if (docs[e.path] !== snap[e.path]) continue;
        docs[e.path] = e;
        lastEdit.delete(e.path);
        if (e.error) baseline.delete(e.path);
        else baseline.set(e.path, e.data);
      }
      for (const [path, doc] of Object.entries(snap)) {
        const cur = docs[path];
        if (!cur) continue;
        const f = listedByPath.get(path);
        if (cur.dirty || cur.isNew) {
          // Skip docs saved meanwhile: the listing predates their write.
          if (!sameVersion(cur.disk, doc.disk) && (cur.disk || doc.disk)) continue;
          if (!!cur.isNew !== !!doc.isNew) continue;
          let next: DocEntry = cur;
          const version = known(cur);
          if (!f && !cur.isNew) next = { ...next, isNew: true }; // deleted on disk: keep the edits
          if (f && cur.isNew && cur.disk && sameVersion(cur.disk, f)) {
            const { isNew: _back, ...rest } = next; // the deleted file came back unchanged
            next = rest;
          }
          const moved = version ? !sameVersion(version, f) : !!cur.isNew && listedByLower.has(path.toLowerCase());
          if (moved && !next.changedOnDisk) next = { ...next, changedOnDisk: true };
          if (!moved && next.changedOnDisk) {
            const { changedOnDisk: _c, ...rest } = next;
            next = rest;
          }
          if (next !== cur) {
            next.dirty = computeDirty(next);
            docs[path] = next;
          }
        } else if (!f && cur === doc) {
          delete docs[path]; // deleted on disk, no unsaved edits
          forget(path);
        }
      }
      // Saves / renames / removes that landed during the pass already updated s.files: keep those over the listing.
      const startByPath = new Map(filesAtStart.map((f) => [f.path, f]));
      const nowPaths = new Set(s.files.map((f) => f.path));
      let files = listed.filter((f) => !(startByPath.has(f.path) && !nowPaths.has(f.path)));
      for (const f of s.files) if (startByPath.get(f.path) !== f) files = upsertFile(files, f);
      const conflicts: Record<string, DocConflict> = {};
      for (const [p, c] of Object.entries(s.conflicts)) if (docs[p]?.dirty) conflicts[p] = c;
      const activePath = s.activePath && docs[s.activePath] ? s.activePath : undefined;
      return { files, docs, conflicts, activePath, error: undefined };
    });
  }

  return {
    ready: false,
    loading: false,
    files: [],
    docs: {},
    activePath: undefined,
    error: undefined,
    conflicts: {},

    init() {
      if (get().ready) return Promise.resolve();
      initPromise ??= (async () => {
        set({ loading: true, error: undefined });
        try {
          const files = await api.listFiles();
          const entries = await Promise.all(files.map((f) => loadEntry(f.path, f.kind)));
          set((s) => ({ files, docs: mergeLoaded(s.docs, entries), ready: true, loading: false }));
        } catch (err) {
          initPromise = undefined; // allow a retry
          set({ loading: false, error: `Can't load the workspace: ${message(err)}` });
        }
      })();
      return initPromise;
    },

    refresh() {
      if (!get().ready) return get().init();
      if (refreshing) {
        refreshAgain = true;
        return refreshing;
      }
      const pass = (async () => {
        try {
          do {
            refreshAgain = false;
            await refreshOnce();
          } while (refreshAgain);
        } finally {
          refreshing = undefined;
        }
      })();
      refreshing = pass;
      return pass;
    },

    setActive(path) {
      if (get().activePath !== path) set({ activePath: path });
    },

    create(path, kind, data) {
      const s = get();
      const clash = takenPath(s, path);
      if (clash) throw new Error(clash === path ? `${path} already exists` : `${clash} already exists (file names can't differ only in letter case)`);
      const frozen = freeze(data, true);
      lastEdit.delete(path);
      baseline.set(path, frozen);
      const entry: DocEntry = { path, kind, data: frozen, savedText: "", dirty: true, past: [], future: [], isNew: true };
      set({ docs: { ...s.docs, [path]: entry } });
    },

    update(path, recipe, opts) {
      const doc = get().docs[path];
      if (!doc || doc.error) {
        console.warn(`[workspace] update ignored: ${doc ? `${path} failed to load` : `no document ${path}`}`);
        return;
      }
      const next = produce(doc.data, recipe as (draft: unknown) => void);
      commit(path, next, opts?.label, opts?.coalesceMs);
    },

    replace(path, data, opts) {
      commit(path, freeze(data, true), opts?.label);
    },

    undo(path) {
      const p = path ?? get().activePath;
      if (!p) return;
      set((s) => {
        const doc = s.docs[p];
        if (!doc || doc.past.length === 0) return s;
        lastEdit.delete(p);
        const entry: DocEntry = {
          ...doc,
          data: doc.past[doc.past.length - 1],
          past: doc.past.slice(0, -1),
          future: pushLimited(doc.future, doc.data),
        };
        entry.dirty = computeDirty(entry);
        return { docs: { ...s.docs, [p]: entry } };
      });
    },

    redo(path) {
      const p = path ?? get().activePath;
      if (!p) return;
      set((s) => {
        const doc = s.docs[p];
        if (!doc || doc.future.length === 0) return s;
        lastEdit.delete(p);
        const entry: DocEntry = {
          ...doc,
          data: doc.future[doc.future.length - 1],
          past: pushLimited(doc.past, doc.data),
          future: doc.future.slice(0, -1),
        };
        entry.dirty = computeDirty(entry);
        return { docs: { ...s.docs, [p]: entry } };
      });
    },

    async save(path) {
      const p = path ?? get().activePath;
      if (!p) return;
      await write(p);
    },

    async saveAll() {
      const paths = Object.values(get().docs)
        .filter((d) => !d.error && (d.dirty || d.isNew))
        .map((d) => d.path)
        .sort();
      const results = await Promise.allSettled(paths.map((p) => get().save(p)));
      const failures = results.flatMap((r, i) => (r.status === "rejected" ? [{ path: paths[i], error: r.reason as unknown }] : []));
      if (failures.length) throw new SaveAllError(failures);
    },

    /**
     * "reload" resolves to the doc's path, or to the disk file's path when a never-saved doc clashed with a
     * letter-case variant, or undefined when the file was deleted (the doc is dropped). "overwrite" resolves to the
     * doc's path (refused for a letter-case variant: save a copy instead). "copy" resolves to the copy's path. Rejects,
     * keeping the conflict, when the disk changed again, the file can't be parsed, or the server refuses.
     */
    async resolveConflict(path, choice) {
      await saveQueue.get(path)?.catch(() => {});
      const doc = get().docs[path];
      if (!doc) {
        set((s) => ({ conflicts: without(s.conflicts, path) }));
        return undefined;
      }
      if (doc.error) throw new Error(`${path} failed to load: ${doc.error}`);
      const disk = await diskFile(path);
      if (choice === "overwrite") {
        if (disk && disk.path !== path) throw new Error(`${disk.path} already exists and differs from ${path} only in letter case: save a copy instead`);
        await write(path, { force: true, pre: disk ? { ifMatch: versionOf(disk) } : { ifAbsent: true } });
        return path;
      }
      if (choice === "copy") {
        const to = conflictCopyPath(path);
        get().create(to, docKindForPath(to), doc.data);
        await write(to); // on failure the copy stays as an unsaved new doc and the original keeps its conflict
        try {
          await reloadFromDisk(path, disk);
        } catch (err) {
          throw new Error(`Saved your version as ${to}, but couldn't reload ${path}: ${message(err)}`);
        }
        return to;
      }
      return reloadFromDisk(path, disk);
    },

    revert(path) {
      const doc = get().docs[path];
      if (!doc || doc.error || !baseline.has(path)) return;
      commit(path, baseline.get(path));
    },

    async remove(path) {
      const s = get();
      const doc = s.docs[path];
      const onDisk = s.files.some((f) => f.path === path);
      await saveQueue.get(path)?.catch(() => {});
      if (onDisk || (doc && !doc.isNew)) await api.deleteFile(path);
      drop(path);
    },

    async rename(from, to) {
      if (from === to) return;
      const s = get();
      const caseOnly = from.toLowerCase() === to.toLowerCase();
      const clash = caseOnly ? undefined : takenPath(s, to, from);
      if (clash) throw new Error(clash === to ? `${to} already exists` : `${clash} already exists (file names can't differ only in letter case)`);
      const doc = s.docs[from];
      const onDisk = s.files.some((f) => f.path === from);
      if (doc?.isNew && !onDisk) {
        rekey(from, to, docKindForPath(to)); // never saved: nothing on the server yet
        return;
      }
      if (doc && !doc.error && doc.dirty) await get().save(from);
      else await saveQueue.get(from)?.catch(() => {});
      // Only rename the version this doc was loaded/saved as (a ConflictError otherwise, nothing moved).
      const disk = get().docs[from]?.disk;
      let file: FileInfo;
      try {
        file = await api.renameFile(from, to, disk ? { ifMatch: disk } : undefined);
      } catch (err) {
        // The file changed on disk: re-check so the doc reloads (or is flagged if it has edits), then rename again.
        if (err instanceof ConflictError) void get().refresh();
        throw err;
      }
      rekey(from, to, file.kind, file, !!disk);
    },
  };
});

/** True when any doc has unsaved changes. */
export function anyDirty(): boolean {
  return Object.values(useWorkspace.getState().docs).some((d) => d.dirty);
}

export function useAnyDirty(): boolean {
  return useWorkspace((s) => Object.values(s.docs).some((d) => d.dirty));
}

export function useDoc<T>(path?: string): DocEntry<T> | undefined {
  return useWorkspace((s) => (path ? (s.docs[path] as DocEntry<T> | undefined) : undefined));
}

const kindCache = new Map<DocKind, { docs: Record<string, DocEntry>; list: DocEntry[] }>();

/**
 * Docs of one kind sorted by path. Memoized per kind: returns the previous array while its entries are the same
 * objects, so it's safe as a zustand selector (a fresh array per call would loop React's render).
 */
export function selectDocsOfKind<T>(s: Pick<WorkspaceState, "docs">, kind: DocKind): DocEntry<T>[] {
  const prev = kindCache.get(kind);
  if (prev?.docs === s.docs) return prev.list as DocEntry<T>[];
  const next = Object.values(s.docs)
    .filter((d) => d.kind === kind)
    .sort(byPath);
  const same = prev && prev.list.length === next.length && prev.list.every((d, i) => d === next[i]);
  const list = same ? prev.list : next;
  kindCache.set(kind, { docs: s.docs, list });
  return list as DocEntry<T>[];
}

/** Docs of one kind, stable order by path; the array identity only changes when one of those docs changes. */
export function useDocsOfKind<T>(kind: DocKind): DocEntry<T>[] {
  return useWorkspace((s) => selectDocsOfKind<T>(s, kind));
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  // Closing the tab with unsaved edits asks first.
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (anyDirty()) e.preventDefault();
  };
  // Coming back to the window re-checks the files (an editor, git or another tab may have changed them).
  let lastCheck = 0;
  const recheck = () => {
    if (document.visibilityState === "hidden") return;
    const s = useWorkspace.getState();
    const now = Date.now();
    if (!s.ready || now - lastCheck < FOCUS_REFRESH_MIN_MS) return;
    lastCheck = now;
    void s.refresh();
  };
  window.addEventListener("beforeunload", onBeforeUnload);
  window.addEventListener("focus", recheck);
  document.addEventListener("visibilitychange", recheck);
  import.meta.hot?.dispose(() => {
    window.removeEventListener("beforeunload", onBeforeUnload);
    window.removeEventListener("focus", recheck);
    document.removeEventListener("visibilitychange", recheck);
  });
}
