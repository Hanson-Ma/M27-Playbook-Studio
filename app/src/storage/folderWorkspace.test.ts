// The workspace store (state/workspace.ts) running on the folder backend: load, save, conflict detection, rename,
// soft delete — the same behaviour the app has on the local server.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaybookSpec } from "../model/types";
import { memoryFolder, type MemoryFolder } from "./memoryFs";

const BOOK = "playbooks/studio-test.json";
const SPEC = '{ "name": "STUDIO", "side": "offense", "formations": [] }\n';

let f: MemoryFolder;
let ws: typeof import("../state/workspace");

beforeEach(async () => {
  vi.resetModules();
  f = memoryFolder("2026 Playbook", {
    "data/library/plays.json": "[]",
    [BOOK]: SPEC,
    "playbooks/plays/art-test.json": '{ "plays": [] }\n',
  });
  // Fresh modules for every test (the workspace keeps module-level state); the backend must come from the same fresh
  // module graph so its ConflictError is the class the workspace checks for.
  const client = await import("../api/client");
  const { createFolderBackend } = await import("./folderBackend");
  client.setStorageBackend(createFolderBackend(f.root, { locks: null }));
  ws = await import("../state/workspace");
  await ws.useWorkspace.getState().init();
});

afterEach(async () => {
  (await import("../api/client")).setStorageBackend(undefined);
});

const state = () => ws.useWorkspace.getState();
const setName = (name: string) => (d: PlaybookSpec) => {
  d.name = name;
};

describe("workspace on the folder backend", () => {
  it("loads every doc with its disk version", () => {
    expect(state().ready).toBe(true);
    expect(Object.keys(state().docs).sort()).toEqual(["playbooks/plays/art-test.json", BOOK]);
    expect(state().docs[BOOK].disk).toEqual(f.stat(BOOK));
  });

  it("saves edits and refuses to overwrite a file another program changed", async () => {
    state().update<PlaybookSpec>(BOOK, setName("ONE"));
    await state().save(BOOK);
    expect(JSON.parse(f.text(BOOK)!).name).toBe("ONE");
    expect(state().docs[BOOK].dirty).toBe(false);

    f.put(BOOK, '{ "name": "DISK", "side": "offense", "formations": [] }\n');
    state().update<PlaybookSpec>(BOOK, setName("TWO"));
    await expect(state().save(BOOK)).rejects.toBeInstanceOf(ws.ConflictError);
    expect(JSON.parse(f.text(BOOK)!).name).toBe("DISK");
    expect(state().conflicts[BOOK]?.reason).toBe("changed");

    // "Overwrite" settles it.
    await state().resolveConflict(BOOK, "overwrite");
    expect(JSON.parse(f.text(BOOK)!).name).toBe("TWO");
  });

  it("creates new docs only where no file exists", async () => {
    state().create("playbooks/new.json", "playbook", { name: "NEW", side: "offense", formations: [] });
    await state().save("playbooks/new.json");
    expect(f.text("playbooks/new.json")).toContain('"NEW"');
    f.put("playbooks/other.json", "{}");
    // The workspace doesn't know other.json yet: the create is allowed in memory but the save conflicts on disk.
    state().create("playbooks/OTHER.json", "playbook", { name: "X", side: "offense", formations: [] });
    await expect(state().save("playbooks/OTHER.json")).rejects.toMatchObject({ reason: "exists" });
  });

  it("rename keeps tracking the file (no false conflict after the copy), and delete goes to the trash", async () => {
    await state().rename(BOOK, "playbooks/renamed.json");
    expect(f.text(BOOK)).toBeUndefined();
    expect(state().docs["playbooks/renamed.json"].disk).toEqual(f.stat("playbooks/renamed.json"));
    state().update<PlaybookSpec>("playbooks/renamed.json", setName("AFTER"));
    await state().save("playbooks/renamed.json");
    expect(JSON.parse(f.text("playbooks/renamed.json")!).name).toBe("AFTER");

    await state().remove("playbooks/renamed.json");
    expect(f.text("playbooks/renamed.json")).toBeUndefined();
    expect(f.paths().some((p) => p.startsWith("app-data/.trash/") && p.endsWith("-renamed.json"))).toBe(true);
  });

  it("rename refuses a file that changed on disk since it was loaded, then reloads it", async () => {
    f.put(BOOK, '{ "name": "EXTERNAL", "side": "offense", "formations": [] }\n');
    await expect(state().rename(BOOK, "playbooks/renamed.json")).rejects.toMatchObject({ reason: "changed" });
    expect(f.text("playbooks/renamed.json")).toBeUndefined();
    await state().refresh();
    expect((state().docs[BOOK].data as PlaybookSpec).name).toBe("EXTERNAL");
    await state().rename(BOOK, "playbooks/renamed.json");
    expect(JSON.parse(f.text("playbooks/renamed.json")!).name).toBe("EXTERNAL");
  });

  it("refresh picks up files changed outside the app", async () => {
    f.put(BOOK, '{ "name": "EXTERNAL", "side": "offense", "formations": [] }\n');
    f.put("playbooks/plays/new-plays.json", '{ "plays": [] }\n');
    await state().refresh();
    expect((state().docs[BOOK].data as PlaybookSpec).name).toBe("EXTERNAL");
    expect(state().docs["playbooks/plays/new-plays.json"]).toBeDefined();
  });
});
