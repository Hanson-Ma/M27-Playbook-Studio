// Which repo files Playbook Studio may touch, shared by both storage backends: the local server (server/api.ts) and
// the browser's folder backend (src/storage/folderBackend.ts). Pure TS with no runtime imports, written as erasable
// TypeScript so Node's type stripping can run it (the server imports it as "../src/storage/paths.ts").
//
//   read        data/library/*.json, playbooks/templates/PBOOKOFF-TEMPLATE
//   read/write  playbooks/<f>.json (not mod.json), playbooks/plays/<f>.json, playbooks/sets/<f>.json, app-data/<f>.json
//   move into   app-data/.trash/ (soft delete)
import type { DocKind } from "../model/types.ts";

/** Library files the app needs before it can run (data/library/<name>.json). */
export const LIBRARY_FILES = ["formations", "sets", "plays", "assignments", "enums"] as const;
/** Repo-relative folder of the game library (read-only). */
export const LIBRARY_DIR = "data/library";
/** Repo-relative path of the template playbook save (binary, read-only). */
export const TEMPLATE_SAVE = "playbooks/templates/PBOOKOFF-TEMPLATE";
/** Soft-deleted files land here as `<yyyymmdd-hhmmss>-<name>`. */
export const TRASH_DIR = "app-data/.trash";
/** Folders a file listing scans (only their direct children that match an allowed path). */
export const LISTED_DIRS = ["playbooks", "playbooks/plays", "playbooks/sets", "app-data"] as const;

// <f> = [A-Za-z0-9._-]+ without a leading dot, so hidden files (and temp files like ".a.json.123.tmp") never match.
const FILE = "[A-Za-z0-9_-][A-Za-z0-9._-]*\\.json";
const ALLOWED: { re: RegExp; kind: (base: string) => DocKind }[] = [
  { re: new RegExp(`^playbooks/(${FILE})$`), kind: () => "playbook" },
  { re: new RegExp(`^playbooks/plays/(${FILE})$`), kind: () => "plays" },
  { re: new RegExp(`^playbooks/sets/(${FILE})$`), kind: () => "sets" },
  { re: new RegExp(`^app-data/(${FILE})$`), kind: (b) => (b === "concepts.json" ? "concepts" : "appdata") },
];

/** A rejected path: `status` 400 = malformed (absolute, "..", backslash), 403 = outside the allowed files. */
export class PathError extends Error {
  readonly status: 400 | 403;

  constructor(status: 400 | 403, message: string) {
    super(message);
    this.name = "PathError";
    this.status = status;
  }
}

/**
 * Classify a repo-relative path. Throws a PathError (400 for malformed paths, 403 for paths outside the allowed
 * folders, including playbooks/mod.json in any letter case).
 */
export function checkPath(p: unknown): { path: string; kind: DocKind } {
  if (typeof p !== "string" || p === "") throw new PathError(400, "Missing path");
  if (p.includes("\\") || p.includes("\0")) throw new PathError(400, `Invalid path: ${p}`);
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) throw new PathError(400, `Absolute paths are not allowed: ${p}`);
  const segs = p.split("/");
  if (segs.some((s) => s === ".." || s === "." || s === "")) throw new PathError(400, `Invalid path: ${p}`);
  // Case-insensitive on purpose: macOS/Windows file systems would map "playbooks/MOD.json" onto mod.json.
  if (p.toLowerCase() === "playbooks/mod.json") throw new PathError(403, "playbooks/mod.json is managed by the game-side tools");
  for (const rule of ALLOWED) {
    const m = rule.re.exec(p);
    if (m) return { path: p, kind: rule.kind(m[1]) };
  }
  throw new PathError(
    403,
    `Path not allowed: ${p} (allowed: playbooks/*.json, playbooks/plays/*.json, playbooks/sets/*.json, app-data/*.json)`,
  );
}

/** checkPath() without throwing: the doc kind, or undefined for anything that isn't an editable file. */
export function pathKind(p: string): DocKind | undefined {
  try {
    return checkPath(p).kind;
  } catch {
    return undefined;
  }
}

/** True for a library file name the app may read (data/library/<name>.json). */
export function isLibraryName(name: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(name);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local time stamp for trash names: yyyymmdd-hhmmss. */
export function trashStamp(d = new Date()): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Strip a UTF-8 byte-order mark. */
export function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** Split "a/b/c.json" into its folder ("a/b") and name ("c.json"). */
export function splitPath(p: string): { dir: string; base: string } {
  const i = p.lastIndexOf("/");
  return i < 0 ? { dir: "", base: p } : { dir: p.slice(0, i), base: p.slice(i + 1) };
}
