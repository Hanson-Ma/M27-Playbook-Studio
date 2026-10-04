// File API + library serving for Playbook Studio (see ARCHITECTURE.md "Server").
// A connect-style handler shared by the Vite dev/preview servers (server/plugin.ts) and the production server
// (server/serve.ts). Runs under Node's type stripping: erasable TS only, explicit ".ts" import extensions.
//
// The handler only ever touches:
//   read        <root>/data/library/*.json
//   read/write  <root>/playbooks/<f>.json (not mod.json), playbooks/plays/<f>.json, playbooks/sets/<f>.json,
//               <root>/app-data/<f>.json
//   move into   <root>/app-data/.trash/ (soft delete)
//
// Conflict detection: GET /api/file sends the file's version as ETag `"<mtime>-<size>"` (FileInfo's mtime + size).
// PUT honours `If-Match: <that tag>` (409 { conflict: "changed" | "deleted" } when the file moved on) and
// `If-None-Match: *` (409 { conflict: "exists" } when the file, or one whose name differs only in letter case, exists).
// POST /api/rename honours `If-Match` on the source file the same way (409 { conflict, path: from }).
// Mutations run one at a time, so a precondition check and its write can't interleave with another request.
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import type { DocKind, FileInfo } from "../src/model/types.ts";
import { checkPath, LIBRARY_FILES, LISTED_DIRS, stripBom, TEMPLATE_SAVE, TRASH_DIR, trashStamp } from "../src/storage/paths.ts";

export type NextFn = (err?: unknown) => void;
export type ApiHandler = (req: IncomingMessage, res: ServerResponse, next: NextFn) => void;

export interface ApiOptions {
  /** Repo root (the parent of app/). */
  root: string;
  /** Max request body for PUT /api/file (default 20 MB). */
  maxBodyBytes?: number;
}

// Path rules, folder names and trash stamps are shared with the browser's folder backend (src/storage/paths.ts).
export { checkPath, LIBRARY_FILES, TEMPLATE_SAVE, trashStamp };
const LIBRARY_NAME = /^\/library\/([A-Za-z0-9_-]+)\.json$/;
const DEFAULT_MAX_BODY = 20 * 1024 * 1024;
/** GET /api/status `app` marker. */
export const STATUS_APP = "playbook-studio";

const gzip = promisify(zlib.gzip);

interface HttpError extends Error {
  status: number;
  /** Extra fields for the JSON error body (next to `error`). */
  body?: Record<string, unknown>;
}

function httpError(status: number, message: string, body?: Record<string, unknown>): HttpError {
  return Object.assign(new Error(message), { status, body });
}

/** Why a conditional PUT was refused (409 body `conflict`). */
export type ConflictReason = "changed" | "deleted" | "exists";

/** Version tag of a file on disk (ETag of GET /api/file, compared with PUT's If-Match): `"<mtime>-<size>"`. */
export function fileTag(mtime: number, size: number): string {
  return `"${mtime}-${size}"`;
}

/** PUT preconditions from the request headers. Exported for tests. */
export function parsePreconditions(headers: IncomingMessage["headers"]): { ifMatch?: string[]; ifAbsent?: boolean } {
  const out: { ifMatch?: string[]; ifAbsent?: boolean } = {};
  const im = headers["if-match"];
  if (im !== undefined) {
    out.ifMatch = String(im)
      .split(",")
      .map((t) => t.trim().replace(/^W\//, ""))
      .filter(Boolean);
    if (!out.ifMatch.length) throw httpError(400, "Empty If-Match header");
  }
  const inm = headers["if-none-match"];
  if (inm !== undefined) {
    if (String(inm).trim() !== "*") throw httpError(400, "If-None-Match only supports * (write only if the file doesn't exist)");
    out.ifAbsent = true;
  }
  return out;
}

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === "ENOENT";
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Length", Buffer.byteLength(text));
  res.end(text);
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limit) {
      req.resume(); // drain so the response can still be delivered on this socket
      reject(httpError(413, `Body too large (max ${limit} bytes)`));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    req.on("data", (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        chunks.length = 0;
        reject(httpError(413, `Body too large (max ${limit} bytes)`));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!failed) resolve(Buffer.concat(chunks));
    });
    req.on("error", (err) => {
      if (!failed) reject(err);
    });
  });
}

/**
 * Mutating requests must be JSON and same-origin. A cross-site page can't send a JSON PUT/POST without a CORS
 * preflight (which this server never answers), so this blocks drive-by writes from other sites open in the browser.
 */
function checkMutation(req: IncomingMessage, needsBody: boolean): void {
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let host: string | undefined;
    try {
      host = new URL(origin).host; // throws for the opaque origin "null"
    } catch {
      host = undefined;
    }
    if (host !== req.headers.host) throw httpError(403, "Cross-origin requests are not allowed");
  }
  if (needsBody && !/^application\/json\b/i.test(req.headers["content-type"] ?? "")) {
    throw httpError(415, "Content-Type must be application/json");
  }
}

async function exists(abs: string): Promise<boolean> {
  try {
    await fs.access(abs);
    return true;
  } catch {
    return false;
  }
}

interface GzEntry {
  key: string;
  data: Promise<Buffer>;
}

export function createApiHandler(opts: ApiOptions): ApiHandler {
  const root = path.resolve(opts.root);
  const maxBody = opts.maxBodyBytes ?? DEFAULT_MAX_BODY;
  const libDir = path.join(root, "data", "library");
  const gzCache = new Map<string, GzEntry>();

  const abs = (rel: string) => path.join(root, ...rel.split("/"));

  async function fileInfo(rel: string, kind: DocKind): Promise<FileInfo> {
    const st = await fs.stat(abs(rel));
    return { path: rel, kind, size: st.size, mtime: Math.round(st.mtimeMs) };
  }

  // Mutations (PUT/DELETE/rename) run one at a time: check-then-write sequences can't interleave.
  let mutations: Promise<unknown> = Promise.resolve();
  function serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = mutations.then(fn);
    mutations = run.catch(() => {});
    return run;
  }

  /**
   * The repo-relative path on disk of `rel`, or of a file whose name differs from it only in letter case (which
   * macOS/Windows would treat as the same file); undefined when neither exists.
   */
  async function nameOnDisk(rel: string): Promise<string | undefined> {
    const slash = rel.lastIndexOf("/");
    const dir = rel.slice(0, slash);
    const base = rel.slice(slash + 1);
    let names: string[];
    try {
      names = await fs.readdir(abs(dir));
    } catch (err) {
      if (isMissing(err) || (err as NodeJS.ErrnoException)?.code === "ENOTDIR") return undefined;
      throw err;
    }
    if (names.includes(base)) return rel;
    const lower = base.toLowerCase();
    const hit = names.find((n) => n.toLowerCase() === lower);
    return hit === undefined ? undefined : `${dir}/${hit}`;
  }

  async function fileInfoOrUndefined(rel: string, fallbackKind: DocKind): Promise<FileInfo | undefined> {
    let kind = fallbackKind;
    try {
      kind = checkPath(rel).kind;
    } catch {
      /* oddly named case variant: keep the requested path's kind */
    }
    return fileInfo(rel, kind).catch(() => undefined);
  }

  /** Throws 409 with `{ conflict, path, file? }` when a PUT's preconditions don't hold. Call inside serialized(). */
  async function checkPreconditions(rel: string, kind: DocKind, pre: { ifMatch?: string[]; ifAbsent?: boolean }): Promise<void> {
    const conflict = (reason: ConflictReason, message: string, file?: FileInfo) =>
      httpError(409, message, { conflict: reason, path: rel, ...(file ? { file } : {}) });
    if (pre.ifAbsent) {
      const existing = await nameOnDisk(rel);
      if (existing !== undefined) {
        const file = await fileInfoOrUndefined(existing, kind);
        throw conflict(
          "exists",
          existing === rel ? `${rel} already exists on disk` : `${existing} already exists on disk (file names can't differ only in letter case)`,
          file,
        );
      }
    }
    if (pre.ifMatch) {
      const st = await fs.stat(abs(rel)).catch((err: unknown) => {
        if (isMissing(err)) return undefined;
        throw err;
      });
      if (!st?.isFile()) throw conflict("deleted", `${rel} was deleted on disk after it was loaded`);
      const mtime = Math.round(st.mtimeMs);
      if (!pre.ifMatch.includes("*") && !pre.ifMatch.includes(fileTag(mtime, st.size))) {
        throw conflict("changed", `${rel} changed on disk after it was loaded (another app, git, or another browser tab)`, {
          path: rel,
          kind,
          size: st.size,
          mtime,
        });
      }
    }
  }

  async function listFiles(): Promise<FileInfo[]> {
    const out: FileInfo[] = [];
    for (const dir of LISTED_DIRS) {
      let entries: Dirent[];
      try {
        entries = await fs.readdir(abs(dir), { withFileTypes: true });
      } catch (err) {
        if (isMissing(err)) continue;
        throw err;
      }
      for (const e of entries) {
        if (!e.isFile()) continue;
        const rel = `${dir}/${e.name}`;
        let kind: DocKind;
        try {
          kind = checkPath(rel).kind;
        } catch {
          continue; // mod.json, non-json, hidden or oddly named files
        }
        try {
          out.push(await fileInfo(rel, kind));
        } catch (err) {
          if (!isMissing(err)) throw err; // deleted between readdir and stat
        }
      }
    }
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  async function writeAtomic(rel: string, text: string): Promise<void> {
    const target = abs(rel);
    const dir = path.dirname(target);
    await fs.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`);
    try {
      await fs.writeFile(tmp, text, "utf8");
      await fs.rename(tmp, target);
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
  }

  async function libraryStatus() {
    let names: string[] = [];
    try {
      names = (await fs.readdir(libDir)).filter((n) => n.endsWith(".json")).sort();
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
    const library: { name: string; size: number; mtime: number }[] = [];
    for (const name of names) {
      const st = await fs.stat(path.join(libDir, name)).catch(() => undefined);
      if (st?.isFile()) library.push({ name, size: st.size, mtime: Math.round(st.mtimeMs) });
    }
    const have = new Set(library.map((l) => l.name));
    // `app` lets a hosted copy of the app tell this server apart from whatever else answers /api/status
    // (src/storage/storage.ts probes it on boot to pick the "server" or "folder" backend).
    return { app: STATUS_APP, root, library, hasLibrary: LIBRARY_FILES.every((n) => have.has(`${n}.json`)) };
  }

  async function serveLibrary(req: IncomingMessage, res: ServerResponse, name: string): Promise<void> {
    const file = path.join(libDir, `${name}.json`);
    let fh: FileHandle;
    try {
      fh = await fs.open(file, "r");
    } catch (err) {
      if (isMissing(err)) throw httpError(404, `Library file not found: data/library/${name}.json`);
      throw err;
    }
    try {
      const st = await fh.stat();
      if (!st.isFile()) throw httpError(404, `Library file not found: data/library/${name}.json`);
      const key = `${st.size.toString(36)}-${Math.round(st.mtimeMs).toString(36)}`;
      const useGzip = /\bgzip\b/i.test(String(req.headers["accept-encoding"] ?? ""));
      // The gzip and identity representations get different strong ETags.
      const etag = `"${key}${useGzip ? "-gz" : ""}"`;

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Vary", "Accept-Encoding");
      res.setHeader("ETag", etag);
      res.setHeader("X-Uncompressed-Length", String(st.size));

      const inm = req.headers["if-none-match"];
      if (inm && inm.split(",").some((t) => t.trim().replace(/^W\//, "") === etag || t.trim() === "*")) {
        res.statusCode = 304;
        res.end();
        return;
      }

      if (useGzip) {
        let entry = gzCache.get(name);
        if (!entry || entry.key !== key) {
          // Cache the promise so concurrent first requests compress once.
          const data = fh.readFile().then((raw) => gzip(raw, { level: 6 }));
          entry = { key, data };
          gzCache.set(name, entry);
          data.catch(() => {
            if (gzCache.get(name) === entry) gzCache.delete(name);
          });
        }
        const body = await entry.data;
        res.statusCode = 200;
        res.setHeader("Content-Encoding", "gzip");
        res.setHeader("Content-Length", body.length);
        res.end(req.method === "HEAD" ? undefined : body);
        return;
      }

      // Clients without gzip are rare (curl); the files are local and at most a few tens of MB.
      const raw = req.method === "HEAD" ? undefined : await fh.readFile();
      res.statusCode = 200;
      res.setHeader("Content-Length", st.size);
      res.end(raw);
    } finally {
      await fh.close().catch(() => {});
    }
  }

  async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const method = req.method ?? "GET";
    const route = url.pathname;

    if (route === "/api/status") {
      if (method !== "GET") throw httpError(405, "Method not allowed");
      sendJson(res, 200, await libraryStatus());
      return;
    }

    if (route === "/api/files") {
      if (method !== "GET") throw httpError(405, "Method not allowed");
      sendJson(res, 200, { files: await listFiles() });
      return;
    }

    // Read-only: the template playbook save the game-side builder copies "template" sections from.
    if (route === "/api/template") {
      if (method !== "GET" && method !== "HEAD") throw httpError(405, "Method not allowed");
      let bytes: Buffer;
      try {
        bytes = await fs.readFile(abs(TEMPLATE_SAVE));
      } catch (err) {
        if (isMissing(err)) throw httpError(404, `Template save not found: ${TEMPLATE_SAVE}`);
        throw err;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Length", String(bytes.length));
      res.setHeader("Cache-Control", "no-cache");
      res.end(method === "HEAD" ? undefined : bytes);
      return;
    }

    if (route === "/api/file") {
      const { path: rel, kind } = checkPath(url.searchParams.get("path"));
      if (method === "GET" || method === "HEAD") {
        // Read through one handle so the ETag (version) describes exactly the bytes sent.
        let fh: FileHandle;
        try {
          fh = await fs.open(abs(rel), "r");
        } catch (err) {
          if (isMissing(err)) throw httpError(404, `File not found: ${rel}`);
          throw err;
        }
        try {
          const st = await fh.stat();
          if (!st.isFile()) throw httpError(404, `File not found: ${rel}`);
          const text = method === "HEAD" ? undefined : await fh.readFile();
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("ETag", fileTag(Math.round(st.mtimeMs), st.size));
          res.setHeader("Content-Length", text ? text.length : st.size);
          res.end(text);
        } finally {
          await fh.close().catch(() => {});
        }
        return;
      }
      if (method === "PUT") {
        checkMutation(req, true);
        const text = (await readBody(req, maxBody)).toString("utf8");
        const pre = parsePreconditions(req.headers);
        try {
          JSON.parse(stripBom(text));
        } catch (err) {
          throw httpError(400, `Body is not valid JSON: ${(err as Error).message}`);
        }
        const file = await serialized(async () => {
          await checkPreconditions(rel, kind, pre);
          await writeAtomic(rel, text);
          return fileInfo(rel, kind);
        });
        sendJson(res, 200, { ok: true, file });
        return;
      }
      if (method === "DELETE") {
        checkMutation(req, false);
        await serialized(async () => {
          const src = abs(rel);
          if (!(await exists(src))) throw httpError(404, `File not found: ${rel}`);
          const trash = abs(TRASH_DIR);
          await fs.mkdir(trash, { recursive: true });
          const base = path.basename(src);
          const stamp = trashStamp();
          let dest = path.join(trash, `${stamp}-${base}`);
          for (let i = 2; await exists(dest); i++) dest = path.join(trash, `${stamp}-${i}-${base}`);
          await fs.rename(src, dest);
        });
        sendJson(res, 200, { ok: true });
        return;
      }
      throw httpError(405, "Method not allowed");
    }

    if (route === "/api/rename") {
      if (method !== "POST") throw httpError(405, "Method not allowed");
      checkMutation(req, true);
      let body: { from?: unknown; to?: unknown };
      try {
        body = JSON.parse(stripBom((await readBody(req, 64 * 1024)).toString("utf8")));
      } catch (err) {
        if ((err as HttpError).status) throw err;
        throw httpError(400, "Body must be JSON: { from, to }");
      }
      const from = checkPath(body?.from);
      const to = checkPath(body?.to);
      if (from.path === to.path) throw httpError(400, "from and to are the same path");
      const { ifMatch } = parsePreconditions(req.headers);
      const file = await serialized(async () => {
        if (!(await exists(abs(from.path)))) throw httpError(404, `File not found: ${from.path}`);
        // If-Match: only rename the version the caller loaded (the workspace then keeps tracking it under the new name).
        if (ifMatch) await checkPreconditions(from.path, from.kind, { ifMatch });
        // A case-only rename finds `to` "existing" on case-insensitive file systems; that's the same file. Otherwise
        // refuse `to` and its letter-case variants (the same file on macOS/Windows, a clash once synced there).
        const caseOnly = from.path.toLowerCase() === to.path.toLowerCase();
        const clash = caseOnly ? undefined : await nameOnDisk(to.path);
        if (clash !== undefined) throw httpError(409, `Already exists: ${clash}`);
        await fs.mkdir(path.dirname(abs(to.path)), { recursive: true });
        await fs.rename(abs(from.path), abs(to.path));
        return fileInfo(to.path, to.kind);
      });
      sendJson(res, 200, { ok: true, file });
      return;
    }

    throw httpError(404, `Unknown endpoint: ${route}`);
  }

  return (req, res, next) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      next();
      return;
    }
    const isApi = url.pathname === "/api" || url.pathname.startsWith("/api/");
    const lib = LIBRARY_NAME.exec(url.pathname);
    if (!isApi && !url.pathname.startsWith("/library/")) {
      next();
      return;
    }

    const work = isApi
      ? handleApi(req, res, url)
      : lib && (req.method === "GET" || req.method === "HEAD")
        ? serveLibrary(req, res, lib[1])
        : Promise.reject(httpError(lib ? 405 : 404, lib ? "Method not allowed" : `Not found: ${url.pathname}`));

    work.catch((err: unknown) => {
      const status = (err as HttpError)?.status ?? 500;
      const message = err instanceof Error ? err.message : String(err);
      if (status >= 500) console.error(`[pbstudio-api] ${req.method} ${req.url}:`, err);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      // Headers set for a success response (ETag, Content-Encoding…) must not leak into the error.
      for (const h of res.getHeaderNames()) res.removeHeader(h);
      sendJson(res, status, { ...(err as HttpError)?.body, error: message });
    });
  };
}
