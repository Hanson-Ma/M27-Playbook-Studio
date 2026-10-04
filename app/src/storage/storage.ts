// Picks where files live before the app boots, and exposes it to the app (useStorage).
//
//   1. GET /api/status answers like Playbook Studio's local server (`npm run dev` / `npm start`) → "server" backend.
//   2. Otherwise the app is hosted as a static site → "folder" backend: the user opens their "2026 Playbook" folder
//      (File System Access API, Chrome/Edge). The folder handle is remembered in IndexedDB; on later visits the start
//      screen offers "Reconnect" (the browser needs a click to grant access again), or connects straight away when
//      the browser kept the permission ("Allow on every visit").
//   `?storage=folder` / `?storage=server` in the page URL (before the #) forces one (e.g. to try folder mode locally).
import { create } from "zustand";
import { setStorageBackend, type ServerStatus, type StorageKind } from "../api/client";
import { anyDirty } from "../state/workspace";
import { checkFolder, createFolderBackend, READWRITE, type FolderCheck, type FsDirHandle } from "./folderBackend";
import { clearFolderHandle, loadFolderHandle, saveFolderHandle } from "./handleStore";

export type { StorageKind };

/** Why folder mode can't run in this browser. */
export type UnsupportedReason = "insecure" | "no-api";

export type StoragePhase =
  /** Probing for the local server. */
  | { phase: "detecting" }
  /** A backend is active: render the app. */
  | { phase: "ready"; kind: StorageKind; label: string }
  /** Hosted: waiting for the user to open (or reconnect to) the folder. */
  | { phase: "folder"; remembered?: string; busy?: boolean; problem?: string; hint?: string }
  /** Hosted, but this browser can't open folders. */
  | { phase: "unsupported"; reason: UnsupportedReason }
  /** `?storage=server` but the local server didn't answer. */
  | { phase: "server-down"; error: string };

interface StorageStore {
  state: StoragePhase;
}

export const useStorageState = create<StorageStore>()(() => ({ state: { phase: "detecting" } }));
const setPhase = (state: StoragePhase) => useStorageState.setState({ state });
const getPhase = () => useStorageState.getState().state;

/** The remembered folder (loaded at start), kept so "Reconnect" can ask for access from the click handler. */
let remembered: FsDirHandle | undefined;
let started: Promise<void> | undefined;

// ───────────────────────────── environment ─────────────────────────────

type PickerWindow = Window & {
  showDirectoryPicker?: (options?: { id?: string; mode?: "read" | "readwrite"; startIn?: unknown }) => Promise<unknown>;
};

/** Why this browser can't use folder mode, or undefined when it can. */
export function folderSupport(win: PickerWindow | undefined = typeof window === "undefined" ? undefined : window): UnsupportedReason | undefined {
  if (!win) return "no-api";
  if (typeof win.showDirectoryPicker === "function") return undefined;
  return win.isSecureContext === false ? "insecure" : "no-api";
}

/** `?storage=folder|server` from the page URL. */
export function forcedStorage(search = typeof location === "undefined" ? "" : location.search): StorageKind | undefined {
  const v = new URLSearchParams(search).get("storage");
  return v === "folder" || v === "server" ? v : undefined;
}

/** True when `body` is GET /api/status from Playbook Studio's server (not some other site's /api/status). */
export function isServerStatus(body: unknown): body is ServerStatus {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  if (b.app !== undefined) return b.app === "playbook-studio";
  return typeof b.root === "string" && Array.isArray(b.library) && typeof b.hasLibrary === "boolean";
}

/** GET /api/status from the local server; undefined when nothing (or something else) answers. */
export async function probeServer(timeoutMs = 3000): Promise<ServerStatus | undefined> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch("/api/status", { cache: "no-store", signal: ctl.signal, headers: { Accept: "application/json" } });
    if (!res.ok || !/json/i.test(res.headers.get("Content-Type") ?? "")) return undefined;
    const body: unknown = await res.json();
    return isServerStatus(body) ? body : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

// ───────────────────────────── boot ─────────────────────────────

/** Decide the backend (once; StorageGate calls it on mount). */
export function startStorage(): Promise<void> {
  started ??= (async () => {
    const forced = forcedStorage();
    if (forced !== "folder") {
      const status = await probeServer();
      if (status) {
        setStorageBackend(undefined);
        setPhase({ phase: "ready", kind: "server", label: status.root });
        return;
      }
      if (forced === "server") {
        setPhase({ phase: "server-down", error: "The local Playbook Studio server didn't answer at /api/status." });
        return;
      }
    }
    const unsupported = folderSupport();
    if (unsupported) {
      setPhase({ phase: "unsupported", reason: unsupported });
      return;
    }
    remembered = await loadFolderHandle();
    if (!remembered) {
      setPhase({ phase: "folder" });
      return;
    }
    // The browser may have kept access ("Allow on every visit", or a reload in the same session): go straight in.
    let permission: PermissionState | undefined;
    try {
      permission = await remembered.queryPermission?.(READWRITE);
    } catch {
      permission = undefined;
    }
    if (permission === "granted") {
      await connect(remembered);
      return;
    }
    setPhase({ phase: "folder", remembered: remembered.name });
  })();
  return started;
}

/** Retry the server probe (the "server-down" screen). */
export async function retryServer(): Promise<void> {
  started = undefined;
  setPhase({ phase: "detecting" });
  await startStorage();
}

function folderProblem(check: FolderCheck): { problem?: string; hint?: string } {
  return { problem: check.problem, hint: check.hint };
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const isAbort = (err: unknown) => (err as { name?: string })?.name === "AbortError";

/** Validate a folder and, when it's the repo, make it the backend and remember it. */
async function connect(handle: FsDirHandle): Promise<boolean> {
  // A remembered folder that no longer checks out (moved, renamed, emptied) is forgotten: "Reconnect" can't fix it.
  const forgetIfRemembered = async () => {
    if (handle !== remembered) return;
    remembered = undefined;
    await clearFolderHandle();
  };
  let check: FolderCheck;
  try {
    check = await checkFolder(handle);
  } catch (err) {
    await forgetIfRemembered();
    setPhase({
      phase: "folder",
      remembered: remembered?.name,
      problem: `Couldn't open "${handle.name}": ${errText(err)}`,
      hint: "Was it moved, renamed or deleted? Open it again from where it is now.",
    });
    return false;
  }
  if (!check.ok) {
    await forgetIfRemembered();
    setPhase({ phase: "folder", remembered: remembered?.name, ...folderProblem(check) });
    return false;
  }
  setStorageBackend(createFolderBackend(handle));
  remembered = handle;
  await saveFolderHandle(handle);
  setPhase({ phase: "ready", kind: "folder", label: handle.name });
  return true;
}

/** Show the browser's folder picker. Resolves undefined when the user cancels. Call from a click handler. */
async function pickFolder(): Promise<FsDirHandle | undefined> {
  const win = window as PickerWindow;
  if (typeof win.showDirectoryPicker !== "function") throw new Error("This browser can't open folders: use Chrome or Edge.");
  // Called as a method of window (a detached call throws "Illegal invocation").
  const show = (startIn?: FsDirHandle) =>
    win.showDirectoryPicker!({ id: "pbstudio-repo", mode: "readwrite", ...(startIn ? { startIn } : {}) }) as Promise<FsDirHandle>;
  try {
    return await show(remembered);
  } catch (err) {
    if (isAbort(err)) return undefined;
    if (!remembered) throw err;
    // startIn fails for a handle whose folder is gone: try once more without it.
    try {
      return await show();
    } catch (again) {
      if (isAbort(again)) return undefined;
      throw again;
    }
  }
}

/** Make sure the page may write to the folder (the picker's "Edit files" prompt). */
async function ensureWritable(handle: FsDirHandle): Promise<boolean> {
  try {
    if ((await handle.queryPermission?.(READWRITE)) === "granted") return true;
    return (await handle.requestPermission?.(READWRITE)) === "granted";
  } catch {
    return false;
  }
}

/** Start screen: "Open folder…" (click handler). */
export async function openFolder(): Promise<void> {
  const cur = getPhase();
  const base = cur.phase === "folder" ? cur : { phase: "folder" as const, remembered: remembered?.name };
  setPhase({ ...base, busy: true, problem: undefined, hint: undefined });
  try {
    const handle = await pickFolder();
    if (!handle) {
      setPhase({ ...base, busy: false });
      return;
    }
    if (!(await ensureWritable(handle))) {
      setPhase({
        ...base,
        busy: false,
        problem: "The browser didn't allow saving to that folder.",
        hint: "Click Open folder again and choose “Edit files” (or “Allow”) when the browser asks.",
      });
      return;
    }
    await connect(handle);
  } catch (err) {
    setPhase({ ...base, busy: false, problem: `Couldn't open the folder: ${errText(err)}` });
  }
}

/** Start screen: "Reconnect to <folder>" (click handler: requestPermission needs the click). */
export async function reconnectFolder(): Promise<void> {
  const handle = remembered;
  if (!handle) return openFolder();
  setPhase({ phase: "folder", remembered: handle.name, busy: true });
  let state: PermissionState | undefined;
  try {
    state = await handle.requestPermission?.(READWRITE);
  } catch (err) {
    setPhase({ phase: "folder", remembered: handle.name, problem: `Couldn't reconnect: ${errText(err)}`, hint: "Open the folder again instead." });
    return;
  }
  if (state !== "granted") {
    setPhase({
      phase: "folder",
      remembered: handle.name,
      problem: "The browser didn't allow access to the folder.",
      hint: "Click Reconnect again and choose “Allow” (or “Allow on every visit”), or open the folder again.",
    });
    return;
  }
  await connect(handle);
}

// ───────────────────────────── for the app (Settings → Files & Data) ─────────────────────────────

export interface StorageInfo {
  /** "server": the local file server (npm run dev / npm start). "folder": a folder opened in the browser (hosted). */
  kind: StorageKind;
  /** Where files live, for display: the repo path the server runs in, or the opened folder's name. */
  label: string;
  /** True in folder mode: switchFolder()/forgetFolder() work. */
  canSwitch: boolean;
  /**
   * Folder mode: pick another folder, then reload the app on it. Call from a click handler. Resolves false when the
   * user cancels; rejects with a readable Error when there are unsaved changes, the folder isn't the repo, or in
   * server mode (which always uses the repo the server runs in).
   */
  switchFolder(): Promise<boolean>;
  /** Folder mode: forget the remembered folder and go back to the start screen (reloads). Rejects with unsaved changes. */
  forgetFolder(): Promise<void>;
}

function requireClean(action: string): void {
  if (anyDirty()) throw new Error(`Save or undo your unsaved changes before you ${action}.`);
}

export async function switchFolder(): Promise<boolean> {
  const cur = getPhase();
  if (cur.phase !== "ready" || cur.kind !== "folder") {
    throw new Error(
      "The local server always uses the repo folder it runs in. To work on another folder, run `npm run dev` there, or open the hosted app.",
    );
  }
  requireClean("switch folders");
  const handle = await pickFolder();
  if (!handle) return false;
  if (!(await ensureWritable(handle))) throw new Error("The browser didn't allow saving to that folder.");
  const check = await checkFolder(handle);
  if (!check.ok) throw new Error([check.problem, check.hint].filter(Boolean).join(" "));
  await saveFolderHandle(handle);
  location.reload();
  return true;
}

export async function forgetFolder(): Promise<void> {
  const cur = getPhase();
  if (cur.phase !== "ready" || cur.kind !== "folder") return;
  requireClean("close the folder");
  await clearFolderHandle();
  location.reload();
}

/** Where files live (for Settings → Files & Data). Meant for components inside StorageGate (the backend is chosen). */
export function useStorage(): StorageInfo {
  const st = useStorageState((s) => s.state);
  const kind: StorageKind = st.phase === "ready" ? st.kind : "server";
  const label = st.phase === "ready" ? st.label : "";
  return { kind, label, canSwitch: kind === "folder", switchFolder, forgetFolder };
}

/** Non-hook version of useStorage(). */
export function getStorage(): StorageInfo {
  const st = getPhase();
  const kind: StorageKind = st.phase === "ready" ? st.kind : "server";
  return { kind, label: st.phase === "ready" ? st.label : "", canSwitch: kind === "folder", switchFolder, forgetFolder };
}
