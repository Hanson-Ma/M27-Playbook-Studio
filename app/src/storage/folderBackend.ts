// "folder" storage backend: the user's "2026 Playbook" repo folder opened in the browser with the File System Access
// API (Chrome / Edge). Used when the app is hosted as a static site: nothing is uploaded — the page reads the game
// library and the template save from the folder and writes playbooks/** and app-data/** back into it.
//
// Same contract as the local server (server/api.ts):
//   - paths are validated by the shared rules in ./paths.ts (playbooks/*.json except mod.json, playbooks/plays|sets/,
//     app-data/*.json; no "..", no absolute paths, .json only);
//   - a file's version is (lastModified, size) — FileInfo.mtime/size; writeText's ifMatch / ifAbsent preconditions
//     reject with the same ConflictError ("changed" | "deleted" | "exists", incl. letter-case variants);
//   - deleteFile moves the file to app-data/.trash/<yyyymmdd-hhmmss>-<name> (copy + remove);
//   - renameFile copies then removes, refusing an existing target in any letter case (a case-only rename goes
//     through a hidden temp file so case-insensitive disks never see two names for one file);
//   - mutations run one at a time (and across tabs of this site via the Web Locks API when available).
// Chrome writes through a swap file and swaps it in on close(), so a write is all-or-nothing like the server's.
import {
  ConflictError,
  parseLibraryText,
  readStreamText,
  type FileVersion,
  type LibraryFileName,
  type RenamePrecondition,
  type ServerStatus,
  type StorageBackend,
  type WritePrecondition,
} from "../api/client";
import type { DocKind, FileInfo } from "../model/types";
import {
  checkPath,
  isLibraryName,
  LIBRARY_DIR,
  LIBRARY_FILES,
  LISTED_DIRS,
  pathKind,
  splitPath,
  stripBom,
  TEMPLATE_SAVE,
  TRASH_DIR,
  trashStamp,
} from "./paths";

// ───────────────────────────── minimal File System Access types ─────────────────────────────
// Only what this backend uses, so a real FileSystemDirectoryHandle (cast once at the picker) and the in-memory fake
// used by the tests (./memoryFs.ts) both fit. lib.dom lacks entries()/queryPermission()/requestPermission().

export interface FsFile {
  readonly size: number;
  /** ms since the epoch: the file's version together with `size`. */
  readonly lastModified: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  stream(): ReadableStream<Uint8Array>;
}

export interface FsWritable {
  write(data: string | BufferSource | Blob): Promise<void>;
  close(): Promise<void>;
  abort?(reason?: unknown): Promise<void>;
}

export interface FsFileHandle {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<FsFile>;
  createWritable(): Promise<FsWritable>;
}

export interface FsPermissionDescriptor {
  mode?: "read" | "readwrite";
}

export interface FsDirHandle {
  readonly kind: "directory";
  readonly name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FsDirHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterable<[string, FsDirHandle | FsFileHandle]>;
  queryPermission?(descriptor?: FsPermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor?: FsPermissionDescriptor): Promise<PermissionState>;
}

/** Cross-tab lock (navigator.locks). */
export interface LockLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

export interface FolderBackendOptions {
  /** Cross-tab write lock; default navigator.locks when present. Pass null to skip (tests). */
  locks?: LockLike | null;
  /** Clock for trash stamps (tests). */
  now?: () => Date;
}

export const READWRITE: FsPermissionDescriptor = { mode: "readwrite" };
const LOCK_NAME = "pbstudio-folder-writes";

// ───────────────────────────── errors ─────────────────────────────

const errName = (err: unknown) => (err as { name?: unknown })?.name;
const isNotFound = (err: unknown) => errName(err) === "NotFoundError" || errName(err) === "TypeMismatchError";
const isDenied = (err: unknown) => errName(err) === "NotAllowedError" || errName(err) === "SecurityError";

/** Thrown when the browser no longer lets the page use the folder (permission revoked, or never granted). */
export class FolderAccessError extends Error {
  constructor(folder: string) {
    super(
      `Playbook Studio no longer has access to the folder "${folder}". Reload the page and choose "Reconnect" ` +
        `(Chrome asks for access again after every site tab was closed).`,
    );
    this.name = "FolderAccessError";
  }
}

/** A readable message for a failed file operation on `rel`. */
function describe(err: unknown, rel: string): Error {
  const name = errName(err);
  if (name === "NoModificationAllowedError") return new Error(`${rel} is locked by another program (close it there and try again)`);
  if (name === "QuotaExceededError") return new Error(`Couldn't write ${rel}: the disk is full`);
  if (name === "InvalidModificationError") return new Error(`Couldn't change ${rel}: ${(err as Error).message}`);
  return err instanceof Error ? err : new Error(String(err));
}

// ───────────────────────────── helpers on a directory tree ─────────────────────────────

async function dirAt(root: FsDirHandle, dir: string, create = false): Promise<FsDirHandle> {
  let cur = root;
  for (const seg of dir ? dir.split("/") : []) cur = await cur.getDirectoryHandle(seg, { create });
  return cur;
}

async function dirOrUndefined(root: FsDirHandle, dir: string): Promise<FsDirHandle | undefined> {
  try {
    return await dirAt(root, dir);
  } catch (err) {
    if (isNotFound(err)) return undefined;
    throw err;
  }
}

async function fileHandleAt(root: FsDirHandle, rel: string, create = false): Promise<FsFileHandle> {
  const { dir, base } = splitPath(rel);
  return (await dirAt(root, dir, create)).getFileHandle(base, { create });
}

/** The file at `rel`, or undefined when it (or a folder on the way) doesn't exist. */
async function fileOrUndefined(root: FsDirHandle, rel: string): Promise<{ handle: FsFileHandle; file: FsFile } | undefined> {
  let handle: FsFileHandle;
  try {
    handle = await fileHandleAt(root, rel);
  } catch (err) {
    if (isNotFound(err)) return undefined;
    throw err;
  }
  return { handle, file: await handle.getFile() };
}

/** Names directly inside a folder (files and folders). */
async function namesIn(dir: FsDirHandle): Promise<string[]> {
  const out: string[] = [];
  for await (const [name] of dir.entries()) out.push(name);
  return out;
}

async function writeData(handle: FsFileHandle, data: string | Uint8Array): Promise<void> {
  const w = await handle.createWritable();
  try {
    await w.write(data as string | BufferSource);
    await w.close();
  } catch (err) {
    await w.abort?.().catch(() => {});
    throw err;
  }
}

async function exists(dir: FsDirHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

const versionOf = (f: FsFile): FileVersion => ({ mtime: f.lastModified, size: f.size });
const infoOf = (path: string, kind: DocKind, f: FsFile): FileInfo => ({ path, kind, size: f.size, mtime: f.lastModified });
const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

// ───────────────────────────── the backend ─────────────────────────────

export interface FolderBackend extends StorageBackend {
  readonly kind: "folder";
  /** The picked folder. */
  readonly root: FsDirHandle;
  /** The folder's name, for display ("2026 Playbook"). */
  readonly label: string;
}

export function createFolderBackend(root: FsDirHandle, opts: FolderBackendOptions = {}): FolderBackend {
  const label = root.name;
  const locks: LockLike | null =
    opts.locks !== undefined ? opts.locks : ((globalThis as { navigator?: { locks?: LockLike } }).navigator?.locks ?? null);
  const now = opts.now ?? (() => new Date());

  // Mutations (write/delete/rename) run one at a time: check-then-write sequences can't interleave.
  let chain: Promise<unknown> = Promise.resolve();
  function serialized<T>(fn: () => Promise<T>): Promise<T> {
    const locked = () => (locks ? locks.request(LOCK_NAME, fn) : fn());
    const run = chain.then(locked);
    chain = run.catch(() => {});
    return run;
  }

  /**
   * Run a file operation; when the browser refuses access (permission expired or revoked), ask for it again once
   * (works when the call comes from a click or key press) and retry.
   */
  async function withAccess<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (!isDenied(err)) throw err;
      let state: PermissionState | undefined;
      try {
        state = await root.requestPermission?.(READWRITE);
      } catch {
        state = undefined; // no user activation: can't prompt from here
      }
      if (state !== "granted") throw new FolderAccessError(label);
      return fn();
    }
  }

  /**
   * The path on disk of `rel`, or of a file whose name differs from it only in letter case (which macOS/Windows
   * treat as the same file); undefined when neither exists.
   */
  async function nameOnDisk(rel: string): Promise<string | undefined> {
    const { dir, base } = splitPath(rel);
    const d = await dirOrUndefined(root, dir);
    if (!d) return undefined;
    const names = await namesIn(d);
    if (names.includes(base)) return rel;
    const lower = base.toLowerCase();
    const hit = names.find((n) => n.toLowerCase() === lower);
    return hit === undefined ? undefined : `${dir}/${hit}`;
  }

  /** Throws a ConflictError (nothing written) when a precondition doesn't hold. Call inside serialized(). */
  async function checkPreconditions(rel: string, kind: DocKind, pre: { ifMatch?: FileVersion; ifAbsent?: boolean }): Promise<void> {
    if (pre.ifAbsent) {
      const existing = await nameOnDisk(rel);
      if (existing !== undefined) {
        const found = await fileOrUndefined(root, existing).catch(() => undefined);
        throw new ConflictError(
          existing === rel ? `${rel} already exists on disk` : `${existing} already exists on disk (file names can't differ only in letter case)`,
          { path: rel, reason: "exists", file: found ? infoOf(existing, pathKind(existing) ?? kind, found.file) : undefined },
        );
      }
    }
    if (pre.ifMatch) {
      const cur = await fileOrUndefined(root, rel);
      if (!cur) throw new ConflictError(`${rel} was deleted on disk after it was loaded`, { path: rel, reason: "deleted" });
      const v = versionOf(cur.file);
      if (v.mtime !== pre.ifMatch.mtime || v.size !== pre.ifMatch.size) {
        throw new ConflictError(`${rel} changed on disk after it was loaded (another app, git, or another browser tab)`, {
          path: rel,
          reason: "changed",
          file: infoOf(rel, kind, cur.file),
        });
      }
    }
  }

  /**
   * Read a file through one snapshot (so a version describes exactly the bytes read). A file replaced while it's
   * being read makes Chrome throw NotReadableError: take a fresh snapshot and read again (twice at most).
   */
  async function readSnapshot<T>(rel: string, missing: string, read: (f: FsFile) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const found = await fileOrUndefined(root, rel);
      if (!found) throw new Error(missing);
      try {
        return await read(found.file);
      } catch (err) {
        if (errName(err) !== "NotReadableError" || attempt >= 2) throw err;
      }
    }
  }

  return {
    kind: "folder",
    root,
    label,

    getStatus: () =>
      withAccess(async (): Promise<ServerStatus> => {
        const library: { name: string; size: number; mtime: number }[] = [];
        const dir = await dirOrUndefined(root, LIBRARY_DIR);
        if (dir) {
          for await (const [name, h] of dir.entries()) {
            if (h.kind !== "file" || !name.endsWith(".json")) continue;
            const f = await h.getFile();
            library.push({ name, size: f.size, mtime: f.lastModified });
          }
        }
        library.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        const have = new Set(library.map((l) => l.name));
        return { root: label, library, hasLibrary: LIBRARY_FILES.every((n) => have.has(`${n}.json`)), backend: "folder" };
      }),

    listFiles: () =>
      withAccess(async () => {
        const out: FileInfo[] = [];
        for (const dirPath of LISTED_DIRS) {
          const dir = await dirOrUndefined(root, dirPath);
          if (!dir) continue;
          for await (const [name, h] of dir.entries()) {
            if (h.kind !== "file") continue;
            const rel = `${dirPath}/${name}`;
            const kind = pathKind(rel); // skips mod.json, non-json, hidden or oddly named files
            if (!kind) continue;
            try {
              out.push(infoOf(rel, kind, await h.getFile()));
            } catch (err) {
              if (!isNotFound(err)) throw err; // deleted between listing and reading
            }
          }
        }
        return out.sort(byPath);
      }),

    readFile: (path) =>
      withAccess(async () => {
        const { path: rel } = checkPath(path);
        return readSnapshot(rel, `File not found: ${rel}`, async (file) => ({ text: await file.text(), version: versionOf(file) }));
      }),

    writeText: async (path, text, precondition?: WritePrecondition) => {
      const { path: rel, kind } = checkPath(path);
      try {
        JSON.parse(stripBom(text));
      } catch (err) {
        throw new Error(`Body is not valid JSON: ${(err as Error).message}`);
      }
      return serialized(() =>
        withAccess(async () => {
          await checkPreconditions(rel, kind, precondition ?? {});
          try {
            const handle = await fileHandleAt(root, rel, true);
            await writeData(handle, text);
            return infoOf(rel, kind, await handle.getFile());
          } catch (err) {
            if (isDenied(err)) throw err;
            throw describe(err, rel);
          }
        }),
      );
    },

    deleteFile: async (path) => {
      const { path: rel } = checkPath(path);
      return serialized(() =>
        withAccess(async () => {
          const found = await fileOrUndefined(root, rel);
          if (!found) throw new Error(`File not found: ${rel}`);
          const { dir, base } = splitPath(rel);
          const bytes = new Uint8Array(await found.file.arrayBuffer());
          const trash = await dirAt(root, TRASH_DIR, true);
          const stamp = trashStamp(now());
          let dest = `${stamp}-${base}`;
          for (let i = 2; await exists(trash, dest); i++) dest = `${stamp}-${i}-${base}`;
          try {
            await writeData(await trash.getFileHandle(dest, { create: true }), bytes);
            await (await dirAt(root, dir)).removeEntry(base);
          } catch (err) {
            if (isDenied(err)) throw err;
            throw describe(err, rel);
          }
        }),
      );
    },

    renameFile: async (fromPath, toPath, precondition?: RenamePrecondition) => {
      const from = checkPath(fromPath);
      const to = checkPath(toPath);
      if (from.path === to.path) throw new Error("from and to are the same path");
      return serialized(() =>
        withAccess(async () => {
          const src = await fileOrUndefined(root, from.path);
          if (!src) throw new Error(`File not found: ${from.path}`);
          if (precondition?.ifMatch) await checkPreconditions(from.path, from.kind, { ifMatch: precondition.ifMatch });
          // A case-only rename finds `to` "existing" on case-insensitive disks; that's the same file. Otherwise refuse
          // `to` and its letter-case variants (the same file on macOS/Windows, a clash once synced there).
          const caseOnly = from.path.toLowerCase() === to.path.toLowerCase();
          const clash = caseOnly ? undefined : await nameOnDisk(to.path);
          if (clash !== undefined) throw new Error(`Already exists: ${clash}`);
          const bytes = new Uint8Array(await src.file.arrayBuffer());
          const f = splitPath(from.path);
          const fromDir = await dirAt(root, f.dir);
          try {
            if (caseOnly) {
              // Park the content under a hidden name first, so "a.json" → "A.json" never removes the only copy.
              const tmp = `.${f.base}.${Date.now().toString(36)}.rename.tmp`;
              await writeData(await fromDir.getFileHandle(tmp, { create: true }), bytes);
              await fromDir.removeEntry(f.base);
              const handle = await fileHandleAt(root, to.path, true);
              await writeData(handle, bytes);
              await fromDir.removeEntry(tmp).catch(() => {});
              return infoOf(to.path, to.kind, await handle.getFile());
            }
            const handle = await fileHandleAt(root, to.path, true);
            await writeData(handle, bytes);
            await fromDir.removeEntry(f.base);
            return infoOf(to.path, to.kind, await handle.getFile());
          } catch (err) {
            if (isDenied(err)) throw err;
            throw describe(err, from.path);
          }
        }),
      );
    },

    fetchLibraryFile: <T = unknown>(name: LibraryFileName, onProgress?: (loaded: number, total: number) => void) =>
      withAccess(async () => {
        if (!isLibraryName(name)) throw new Error(`Invalid library file name: ${name}`);
        const rel = `${LIBRARY_DIR}/${name}.json`;
        const text = await readSnapshot(rel, `Library file not found: ${rel} (is this the 2026 Playbook folder?)`, (file) =>
          readStreamText(file.stream(), file.size, onProgress),
        );
        return parseLibraryText<T>(name, text);
      }),

    fetchTemplateSave: () =>
      withAccess(async () => {
        return readSnapshot(TEMPLATE_SAVE, `Template save not found: ${TEMPLATE_SAVE}`, async (file) => new Uint8Array(await file.arrayBuffer()));
      }),
  };
}

// ───────────────────────────── folder check ─────────────────────────────

/** Is this the "2026 Playbook" repo folder? */
export interface FolderCheck {
  ok: boolean;
  /** What's missing, e.g. "data/library/plays.json". */
  missing: string[];
  /** One-line explanation for the start screen (when !ok). */
  problem?: string;
  /** What to pick instead, when we can tell. */
  hint?: string;
}

const REPO_INNER = new Set(["app", "data", "library", "playbooks", "plays", "sets", "tools", "docs", "research", "app-data", "src"]);

async function looksLikeRepo(dir: FsDirHandle): Promise<{ library: boolean; playbooks: boolean }> {
  let library = false;
  let playbooks = false;
  try {
    library = !!(await fileOrUndefined(dir, `${LIBRARY_DIR}/plays.json`));
  } catch {
    library = false;
  }
  try {
    playbooks = !!(await dirOrUndefined(dir, "playbooks"));
  } catch {
    playbooks = false;
  }
  return { library, playbooks };
}

/**
 * Check a picked folder: it must contain data/library/plays.json (the game library) and playbooks/. When it doesn't,
 * explain what to pick instead (a repo subfolder → its parent; a folder that contains the repo → that subfolder).
 */
export async function checkFolder(root: FsDirHandle): Promise<FolderCheck> {
  const { library, playbooks } = await looksLikeRepo(root);
  const missing = [...(library ? [] : [`${LIBRARY_DIR}/plays.json`]), ...(playbooks ? [] : ["playbooks/"])];
  if (!missing.length) return { ok: true, missing };

  let hint: string | undefined;
  if (REPO_INNER.has(root.name.toLowerCase())) {
    hint = `"${root.name}" is a folder inside the repo — pick the folder above it (the one that contains data and playbooks).`;
  } else {
    // Maybe they picked the folder that holds the repo (Desktop, Documents, a projects folder…).
    let seen = 0;
    for await (const [name, h] of root.entries()) {
      if (h.kind !== "directory" || name.startsWith(".")) continue;
      if (++seen > 60) break;
      const inner = await looksLikeRepo(h);
      if (inner.library && inner.playbooks) {
        hint = `Your playbook folder is inside it: pick "${name}" instead.`;
        break;
      }
    }
  }
  return {
    ok: false,
    missing,
    problem: `"${root.name}" doesn't look like the folder containing your playbook mod: ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} missing.`,
    hint: hint ?? "Pick the folder that contains data, playbooks and tools.",
  };
}
