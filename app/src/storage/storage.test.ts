// Backend selection on boot (storage.ts): local server when /api/status answers like ours, else folder mode.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryFolder } from "./memoryFs";

const handles = vi.hoisted(() => ({
  remembered: undefined as unknown,
  saved: [] as unknown[],
  cleared: 0,
}));

vi.mock("./handleStore", () => ({
  loadFolderHandle: vi.fn(async () => handles.remembered),
  saveFolderHandle: vi.fn(async (h: unknown) => void handles.saved.push(h)),
  clearFolderHandle: vi.fn(async () => {
    handles.cleared++;
    handles.remembered = undefined;
  }),
}));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const STATUS = { app: "playbook-studio", root: "/Users/me/2026 Playbook", library: [], hasLibrary: true };

let storage: typeof import("./storage");
let client: typeof import("../api/client");

function env(opts: { search?: string; picker?: boolean; secure?: boolean; fetch?: () => Promise<Response> }) {
  vi.stubGlobal("location", { search: opts.search ?? "", reload: vi.fn() });
  vi.stubGlobal("window", {
    isSecureContext: opts.secure ?? true,
    ...(opts.picker ? { showDirectoryPicker: vi.fn() } : {}),
  });
  const f = vi.fn(opts.fetch ?? (async () => new Response("<!doctype html>", { status: 200, headers: { "Content-Type": "text/html" } })));
  vi.stubGlobal("fetch", f);
  return f;
}

beforeEach(async () => {
  vi.resetModules();
  handles.remembered = undefined;
  handles.saved = [];
  handles.cleared = 0;
  client = await import("../api/client");
  storage = await import("./storage");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const phase = () => storage.useStorageState.getState().state;

describe("pure helpers", () => {
  it("recognises our /api/status and nobody else's", () => {
    expect(storage.isServerStatus(STATUS)).toBe(true);
    expect(storage.isServerStatus({ root: "/r", library: [], hasLibrary: false })).toBe(true); // older server
    expect(storage.isServerStatus({ app: "wordpress", root: "/r", library: [], hasLibrary: true })).toBe(false);
    expect(storage.isServerStatus({ status: "ok" })).toBe(false);
    expect(storage.isServerStatus(null)).toBe(false);
  });

  it("reads ?storage=folder|server", () => {
    expect(storage.forcedStorage("?storage=folder")).toBe("folder");
    expect(storage.forcedStorage("?x=1&storage=server")).toBe("server");
    expect(storage.forcedStorage("?storage=cloud")).toBeUndefined();
    expect(storage.forcedStorage("")).toBeUndefined();
  });

  it("knows which browsers can open folders", () => {
    expect(storage.folderSupport({ showDirectoryPicker: vi.fn(), isSecureContext: true } as never)).toBeUndefined();
    expect(storage.folderSupport({ isSecureContext: false } as never)).toBe("insecure");
    expect(storage.folderSupport({ isSecureContext: true } as never)).toBe("no-api");
    expect(storage.folderSupport(undefined)).toBe("no-api");
  });
});

describe("startStorage", () => {
  it("uses the local server when /api/status answers", async () => {
    env({ fetch: async () => json(STATUS) });
    await storage.startStorage();
    expect(phase()).toEqual({ phase: "ready", kind: "server", label: STATUS.root });
    expect(client.getStorageBackend().kind).toBe("server");
    expect(storage.getStorage()).toMatchObject({ kind: "server", canSwitch: false });
    await expect(storage.switchFolder()).rejects.toThrow("local server");
  });

  it("static hosting (index.html fallback or 404): asks for the folder", async () => {
    env({ picker: true });
    await storage.startStorage();
    expect(phase()).toEqual({ phase: "folder" });

    vi.resetModules();
    storage = await import("./storage");
    env({ picker: true, fetch: async () => new Response("Not found", { status: 404 }) });
    await storage.startStorage();
    expect(phase()).toEqual({ phase: "folder" });
  });

  it("ignores another site's /api/status", async () => {
    env({ picker: true, fetch: async () => json({ status: "ok", root: 1 }) });
    await storage.startStorage();
    expect(phase().phase).toBe("folder");
  });

  it("explains browsers that can't open folders", async () => {
    env({ picker: false });
    await storage.startStorage();
    expect(phase()).toEqual({ phase: "unsupported", reason: "no-api" });

    vi.resetModules();
    storage = await import("./storage");
    env({ picker: false, secure: false });
    await storage.startStorage();
    expect(phase()).toEqual({ phase: "unsupported", reason: "insecure" });
  });

  it("?storage=folder skips the server probe; ?storage=server reports a missing server", async () => {
    const f = env({ search: "?storage=folder", picker: true, fetch: async () => json(STATUS) });
    await storage.startStorage();
    expect(f).not.toHaveBeenCalled();
    expect(phase().phase).toBe("folder");

    vi.resetModules();
    storage = await import("./storage");
    env({ search: "?storage=server", picker: true });
    await storage.startStorage();
    expect(phase().phase).toBe("server-down");
  });

  it("connects straight to a remembered folder the browser still allows", async () => {
    const repo = memoryFolder("2026 Playbook", { "data/library/plays.json": "[]", "playbooks/a.json": "{}" });
    handles.remembered = repo.root;
    env({ picker: true });
    await storage.startStorage();
    expect(phase()).toEqual({ phase: "ready", kind: "folder", label: "2026 Playbook" });
    expect(client.getStorageBackend().kind).toBe("folder");
    expect((await client.listFiles()).map((x) => x.path)).toEqual(["playbooks/a.json"]);
    expect(storage.getStorage()).toMatchObject({ kind: "folder", label: "2026 Playbook", canSwitch: true });
  });

  it("offers Reconnect when the browser needs a click, then connects", async () => {
    const repo = memoryFolder("2026 Playbook", { "data/library/plays.json": "[]", "playbooks/a.json": "{}" });
    repo.setPermission("prompt", () => "granted");
    handles.remembered = repo.root;
    env({ picker: true });
    await storage.startStorage();
    expect(phase()).toEqual({ phase: "folder", remembered: "2026 Playbook" });
    await storage.reconnectFolder();
    expect(phase()).toMatchObject({ phase: "ready", kind: "folder" });
    expect(handles.saved).toEqual([repo.root]);
  });

  it("a denied reconnect keeps the start screen with an explanation", async () => {
    const repo = memoryFolder("2026 Playbook", { "data/library/plays.json": "[]", "playbooks/a.json": "{}" });
    repo.setPermission("prompt", () => "denied");
    handles.remembered = repo.root;
    env({ picker: true });
    await storage.startStorage();
    await storage.reconnectFolder();
    expect(phase()).toMatchObject({ phase: "folder", remembered: "2026 Playbook", problem: expect.stringContaining("didn't allow") });
  });

  it("forgets a remembered folder that isn't the repo any more", async () => {
    handles.remembered = memoryFolder("Projects", { "2026 Playbook/data/library/plays.json": "[]", "2026 Playbook/playbooks/a.json": "{}" }).root;
    env({ picker: true });
    await storage.startStorage();
    expect(phase()).toMatchObject({ phase: "folder", remembered: undefined, hint: expect.stringContaining('pick "2026 Playbook"') });
    expect(handles.cleared).toBe(1);
  });

  it("opening a folder validates it before connecting", async () => {
    const wrong = memoryFolder("app", { "package.json": "{}" });
    const repo = memoryFolder("2026 Playbook", { "data/library/plays.json": "[]", "playbooks/a.json": "{}" });
    env({ picker: true });
    await storage.startStorage();
    (window as unknown as { showDirectoryPicker: ReturnType<typeof vi.fn> }).showDirectoryPicker.mockResolvedValueOnce(wrong.root).mockResolvedValueOnce(repo.root);
    await storage.openFolder();
    expect(phase()).toMatchObject({ phase: "folder", problem: expect.stringContaining("doesn't look like") });
    expect((phase() as { busy?: boolean }).busy).toBeFalsy();
    await storage.openFolder();
    expect(phase()).toEqual({ phase: "ready", kind: "folder", label: "2026 Playbook" });
    const picker = (window as unknown as { showDirectoryPicker: ReturnType<typeof vi.fn> }).showDirectoryPicker;
    expect(picker.mock.contexts[0]).toBe(window); // a detached call throws "Illegal invocation" in Chrome
    expect(picker.mock.calls[0][0]).toMatchObject({ mode: "readwrite" });
  });

  it("a cancelled picker changes nothing", async () => {
    env({ picker: true });
    await storage.startStorage();
    (window as unknown as { showDirectoryPicker: ReturnType<typeof vi.fn> }).showDirectoryPicker.mockRejectedValueOnce(new DOMException("cancelled", "AbortError"));
    await storage.openFolder();
    expect(phase()).toEqual({ phase: "folder", remembered: undefined, busy: false });
  });
});
