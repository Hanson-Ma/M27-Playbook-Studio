// File access for the whole app (ARCHITECTURE.md "API client"). Every exported function dispatches to the active
// storage backend:
//   - "server" (default): the HTTP file API served by server/api.ts (`npm run dev` / `npm start`);
//   - "folder": the user's "2026 Playbook" folder opened in the browser (File System Access API) — used when the app
//     is hosted as a static site; src/storage/ picks it before the app boots (setStorageBackend).
// Every function throws Error(<readable message>) on failure, so callers can show it as-is; a refused conditional
// write throws a ConflictError in both backends.
import { parseJson } from "../model/json";
import type { FileInfo } from "../model/types";

export interface ServerStatus {
  /** Absolute repo root on the server machine; in folder mode, the picked folder's name. */
  root: string;
  /** data/library/*.json with size (bytes) and mtime (ms). */
  library: { name: string; size: number; mtime: number }[];
  /** True when formations/sets/plays/assignments/enums.json are all present. */
  hasLibrary: boolean;
  /** "playbook-studio" from the local server (lets a hosted copy recognise it); absent from older servers. */
  app?: string;
  /** Which backend answered (set by the client, not sent by the server). */
  backend?: StorageKind;
}

/** Where files live: the local file server, or a folder opened in the browser. */
export type StorageKind = "server" | "folder";

/** Rename precondition: only rename the version the caller loaded (fails with a ConflictError "changed"/"deleted"). */
export interface RenamePrecondition {
  ifMatch?: FileVersion;
}

/**
 * One way to reach the repo files. Implementations: the HTTP server (below) and the browser folder
 * (src/storage/folderBackend.ts). Semantics match server/api.ts exactly: same allowed paths, ConflictError on a
 * refused conditional write, soft delete into app-data/.trash, rename refuses an existing target (any letter case).
 */
export interface StorageBackend {
  readonly kind: StorageKind;
  getStatus(): Promise<ServerStatus>;
  listFiles(): Promise<FileInfo[]>;
  readFile(path: string): Promise<{ text: string; version?: FileVersion }>;
  writeText(path: string, text: string, precondition?: WritePrecondition): Promise<FileInfo>;
  deleteFile(path: string): Promise<void>;
  renameFile(from: string, to: string, precondition?: RenamePrecondition): Promise<FileInfo>;
  fetchLibraryFile<T = unknown>(name: LibraryFileName, onProgress?: (loaded: number, total: number) => void): Promise<T>;
  fetchTemplateSave(): Promise<Uint8Array>;
}

export type LibraryFileName = "formations" | "sets" | "plays" | "assignments" | "enums";

const PROGRESS_INTERVAL_MS = 50;

/** Version of a file on disk: FileInfo's `mtime` (ms) and `size` (bytes). */
export interface FileVersion {
  mtime: number;
  size: number;
}

/** Why a conditional write was refused: the file changed or was deleted since it was read, or (create) it exists. */
export type ConflictReason = "changed" | "deleted" | "exists";

/**
 * A conditional writeText() was refused (HTTP 409) because the file on disk isn't the version the caller expected.
 * Nothing was written.
 */
export class ConflictError extends Error {
  /** The path that was written. */
  readonly path: string;
  readonly reason: ConflictReason;
  /** The file on disk now (absent when it was deleted). For "exists" its path may differ from `path` in letter case. */
  readonly file?: FileInfo;

  constructor(message: string, info: { path: string; reason: ConflictReason; file?: FileInfo }) {
    super(message);
    this.name = "ConflictError";
    this.path = info.path;
    this.reason = info.reason;
    this.file = info.file;
  }
}

const CONFLICT_REASONS: readonly string[] = ["changed", "deleted", "exists"];

/** `"<mtime>-<size>"` — the ETag of GET /api/file and the If-Match of a conditional PUT (server/api.ts fileTag). */
export function versionTag(v: FileVersion): string {
  return `"${v.mtime}-${v.size}"`;
}

/** Parses versionTag()'s format; undefined for anything else (e.g. an older server without version ETags). */
export function parseVersionTag(tag: string | null | undefined): FileVersion | undefined {
  const m = /^(?:W\/)?"(\d+)-(\d+)"$/.exec(tag?.trim() ?? "");
  return m ? { mtime: Number(m[1]), size: Number(m[2]) } : undefined;
}

async function failure(res: Response): Promise<Error> {
  let message = `${res.status} ${res.statusText}`.trim();
  try {
    const text = await res.text();
    try {
      const body = JSON.parse(text) as { error?: unknown; conflict?: unknown; path?: unknown; file?: FileInfo };
      if (typeof body?.error === "string" && body.error) message = body.error;
      if (res.status === 409 && typeof body?.conflict === "string" && CONFLICT_REASONS.includes(body.conflict) && typeof body.path === "string") {
        return new ConflictError(message, { path: body.path, reason: body.conflict as ConflictReason, file: body.file ?? undefined });
      }
    } catch {
      if (text.trim()) message = text.trim().slice(0, 300);
    }
  } catch {
    // keep the status line
  }
  return new Error(message);
}

async function request(url: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new Error(`Can't reach the Playbook Studio server (${(err as Error).message}). Is \`npm run dev\` running?`);
  }
  if (!res.ok) throw await failure(res);
  return res;
}

/**
 * Only write when the disk matches what the caller last saw: `ifMatch` = the version it was read/saved as (fails as
 * "changed" or "deleted"), `ifAbsent` = create only (fails as "exists" when the file or a letter-case variant exists).
 */
export interface WritePrecondition {
  ifMatch?: FileVersion;
  ifAbsent?: boolean;
}

/**
 * Decode a byte stream as UTF-8 text, reporting bytes read: ≤ every PROGRESS_INTERVAL_MS plus a final call (with
 * loaded === total when the size is known; `total` 0 = unknown). Shared by both backends' library loading.
 */
export async function readStreamText(
  stream: ReadableStream<Uint8Array>,
  total: number,
  onProgress?: (loaded: number, total: number) => void,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let loaded = 0;
  let lastReport = 0;
  onProgress?.(0, total);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    loaded += value.byteLength;
    parts.push(decoder.decode(value, { stream: true }));
    const now = Date.now();
    if (onProgress && now - lastReport >= PROGRESS_INTERVAL_MS) {
      lastReport = now;
      onProgress(loaded, Math.max(total, loaded));
    }
  }
  parts.push(decoder.decode());
  onProgress?.(loaded, total ? Math.max(total, loaded) : loaded);
  return parts.join("");
}

/** Parse a library file's text with a message that names the file. */
export function parseLibraryText<T>(name: string, text: string): T {
  try {
    return parseJson<T>(text);
  } catch (err) {
    throw new Error(`data/library/${name}.json is not valid JSON: ${(err as Error).message}`);
  }
}

// ───────────────────────────── server backend (HTTP) ─────────────────────────────

const fileUrl = (path: string) => `/api/file?path=${encodeURIComponent(path)}`;

/** The local file server (server/api.ts) — `npm run dev` / `npm start`. The default backend. */
export const serverBackend: StorageBackend = {
  kind: "server",

  async getStatus() {
    const status = (await (await request("/api/status")).json()) as ServerStatus;
    return { ...status, backend: "server" };
  },

  async listFiles() {
    const body = (await (await request("/api/files")).json()) as { files: FileInfo[] };
    return body.files;
  },

  async readFile(path) {
    const res = await request(fileUrl(path), { cache: "no-store" });
    return { version: parseVersionTag(res.headers.get("ETag")), text: await res.text() };
  },

  async writeText(path, text, precondition) {
    const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" };
    if (precondition?.ifMatch) headers["If-Match"] = versionTag(precondition.ifMatch);
    if (precondition?.ifAbsent) headers["If-None-Match"] = "*";
    const res = await request(fileUrl(path), { method: "PUT", headers, body: text });
    return ((await res.json()) as { file: FileInfo }).file;
  },

  async deleteFile(path) {
    await request(fileUrl(path), { method: "DELETE" });
  },

  async renameFile(from, to, precondition) {
    const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" };
    if (precondition?.ifMatch) headers["If-Match"] = versionTag(precondition.ifMatch);
    const res = await request("/api/rename", { method: "POST", headers, body: JSON.stringify({ from, to }) });
    return ((await res.json()) as { file: FileInfo }).file;
  },

  // The server gzips library files and sends the uncompressed size in X-Uncompressed-Length (fetch decompresses
  // transparently, so the bytes counted are uncompressed).
  async fetchLibraryFile<T = unknown>(name: LibraryFileName, onProgress?: (loaded: number, total: number) => void): Promise<T> {
    const res = await request(`/library/${name}.json`);
    const uncompressed = Number(res.headers.get("X-Uncompressed-Length"));
    const contentLength = res.headers.get("Content-Encoding") ? NaN : Number(res.headers.get("Content-Length"));
    const total = uncompressed > 0 ? uncompressed : contentLength > 0 ? contentLength : 0;
    if (!res.body) {
      const text = await res.text();
      onProgress?.(text.length, total || text.length);
      return parseLibraryText<T>(name, text);
    }
    return parseLibraryText<T>(name, await readStreamText(res.body, total, onProgress));
  },

  async fetchTemplateSave() {
    let res: Response;
    try {
      res = await fetch("/api/template");
    } catch (err) {
      throw new Error(`Can't reach the Playbook Studio server (${(err as Error).message}). Is \`npm run dev\` running?`);
    }
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      try {
        message = ((await res.json()) as { error?: string }).error ?? message;
      } catch {
        /* not JSON */
      }
      throw new Error(message);
    }
    return new Uint8Array(await res.arrayBuffer());
  },
};

// ───────────────────────────── active backend ─────────────────────────────

let active: StorageBackend = serverBackend;

/** Switch every client call to `backend` (undefined → the server). src/storage/ calls this before the app boots. */
export function setStorageBackend(backend: StorageBackend | undefined): void {
  active = backend ?? serverBackend;
}

/** The backend client calls go to now. */
export function getStorageBackend(): StorageBackend {
  return active;
}

// ───────────────────────────── public API (dispatches to the active backend) ─────────────────────────────

/** Library status: `root` (server: absolute repo path; folder: folder name), library files, hasLibrary, `backend`. */
export async function getStatus(): Promise<ServerStatus> {
  return active.getStatus();
}

/** Every editable file (playbooks, plays, sets, app-data), sorted by path. */
export async function listFiles(): Promise<FileInfo[]> {
  return active.listFiles();
}

export async function readText(path: string): Promise<string> {
  return (await readFile(path)).text;
}

/** Read a file with the version (mtime + size) of exactly those bytes; `version` is undefined if the server doesn't send it. */
export async function readFile(path: string): Promise<{ text: string; version?: FileVersion }> {
  return active.readFile(path);
}

/**
 * Write `text` (must be valid JSON) to a repo-relative path; folders are created as needed. With a precondition that
 * doesn't hold, nothing is written and it rejects with a ConflictError.
 */
export async function writeText(path: string, text: string, precondition?: WritePrecondition): Promise<FileInfo> {
  return active.writeText(path, text, precondition);
}

/** Soft delete: moves the file to app-data/.trash/<yyyymmdd-hhmmss>-<name>. */
export async function deleteFile(path: string): Promise<void> {
  return active.deleteFile(path);
}

/**
 * Rename/move a file; fails if `to` already exists (in any letter case, unless it's a case-only rename). With
 * `precondition.ifMatch`, only renames that version of `from` (else a ConflictError with path = from).
 */
export async function renameFile(from: string, to: string, precondition?: RenamePrecondition): Promise<FileInfo> {
  return active.renameFile(from, to, precondition);
}

/**
 * Read data/library/<name>.json as parsed JSON, reporting uncompressed bytes received. `total` is 0 when unknown.
 * Progress is throttled; the final call always has loaded === total when the size is known.
 */
export async function fetchLibraryFile<T = unknown>(
  name: LibraryFileName,
  onProgress?: (loaded: number, total: number) => void,
): Promise<T> {
  return active.fetchLibraryFile<T>(name, onProgress);
}

/** The template playbook save (playbooks/templates/PBOOKOFF-TEMPLATE) as raw bytes; read-only. */
export async function fetchTemplateSave(): Promise<Uint8Array> {
  return active.fetchTemplateSave();
}
