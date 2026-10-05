import { afterEach, describe, expect, it } from "vitest";
import * as client from "../api/client";
import { ConflictError, getStorageBackend, serverBackend, setStorageBackend } from "../api/client";
import { checkFolder, createFolderBackend, FolderAccessError, type FsDirHandle } from "./folderBackend";
import { memoryFolder, type MemoryFolder } from "./memoryFs";
import { checkPath, PathError } from "./paths";

const BOOK = '{ "name": "STUDIO", "side": "offense", "formations": [] }\n';
const PLAYS = '{ "plays": [] }\n';

function repo(extra: Record<string, string | Uint8Array> = {}, caseInsensitive = false): MemoryFolder {
  return memoryFolder(
    "2026 Playbook",
    {
      "data/library/formations.json": "[]",
      "data/library/sets.json": "[]",
      "data/library/plays.json": '[{"playId":1,"name":"Slants"}]',
      "data/library/assignments.json": "{}",
      "data/library/enums.json": '{"fields":{},"enums":{}}',
      "playbooks/studio-test.json": BOOK,
      "playbooks/mod.json": "{}",
      "playbooks/notes.txt": "x",
      "playbooks/.hidden.json": "{}",
      "playbooks/templates/PBOOKOFF-TEMPLATE": new Uint8Array([1, 2, 3, 4]),
      "playbooks/plays/art-test.json": PLAYS,
      "playbooks/sets/pbs-sets-v1.json": '{ "sets": [] }',
      "tools/pbook-build.mjs": "//",
      ...extra,
    },
    { caseInsensitive },
  );
}

const backend = (f: MemoryFolder) => createFolderBackend(f.root, { locks: null, now: () => new Date(2026, 9, 4, 3, 7, 9) });

afterEach(() => setStorageBackend(undefined));

describe("folder backend: list / read", () => {
  it("lists the editable files like the server (no mod.json, hidden, non-json or nested files), sorted", async () => {
    const f = repo({ "app-data/concepts.json": "{}", "app-data/notes.json": "{}", "app-data/.trash/x.json": "{}" });
    const files = await backend(f).listFiles();
    expect(files.map((x) => [x.path, x.kind])).toEqual([
      ["app-data/concepts.json", "concepts"],
      ["app-data/notes.json", "appdata"],
      ["playbooks/plays/art-test.json", "plays"],
      ["playbooks/sets/pbs-sets-v1.json", "sets"],
      ["playbooks/studio-test.json", "playbook"],
    ]);
    const st = f.stat("playbooks/studio-test.json")!;
    expect(files.at(-1)).toMatchObject({ size: st.size, mtime: st.mtime });
  });

  it("lists nothing (no error) when the folders don't exist yet", async () => {
    const f = memoryFolder("empty", { "data/library/plays.json": "[]" });
    await expect(backend(f).listFiles()).resolves.toEqual([]);
  });

  it("reads text with the version of exactly those bytes", async () => {
    const f = repo();
    const r = await backend(f).readFile("playbooks/studio-test.json");
    expect(r.text).toBe(BOOK);
    expect(r.version).toEqual(f.stat("playbooks/studio-test.json"));
  });

  it("re-reads a file that was replaced while it was being read (NotReadableError)", async () => {
    const f = repo();
    const fh = await (await f.root.getDirectoryHandle("playbooks")).getFileHandle("studio-test.json");
    const orig = fh.getFile.bind(fh);
    let calls = 0;
    (fh as { getFile: typeof fh.getFile }).getFile = async () => {
      const file = await orig();
      if (calls++ > 0) return file;
      return { size: file.size, lastModified: file.lastModified, stream: () => file.stream(), arrayBuffer: () => file.arrayBuffer(),
        text: async () => { throw new DOMException("changed while reading", "NotReadableError"); } };
    };
    await expect(backend(f).readFile("playbooks/studio-test.json")).resolves.toMatchObject({ text: BOOK });
    expect(calls).toBe(2);
  });

  it("reports missing files and refuses paths the server refuses", async () => {
    const b = backend(repo());
    await expect(b.readFile("playbooks/nope.json")).rejects.toThrow("File not found: playbooks/nope.json");
    await expect(b.readFile("playbooks/mod.json")).rejects.toThrow("managed by the game-side tools");
    await expect(b.readFile("data/library/plays.json")).rejects.toThrow("Path not allowed");
    await expect(b.readFile("../secrets.json")).rejects.toThrow("Invalid path");
    await expect(b.writeText("tools/x.json", "{}")).rejects.toBeInstanceOf(PathError);
    await expect(b.deleteFile("playbooks/MOD.json")).rejects.toThrow("managed by the game-side tools");
  });
});

describe("folder backend: write + conflicts", () => {
  it("creates folders and returns the new FileInfo", async () => {
    const f = memoryFolder("fresh", {});
    const info = await backend(f).writeText("app-data/notes.json", '{ "a": 1 }\n');
    expect(f.text("app-data/notes.json")).toBe('{ "a": 1 }\n');
    expect(info).toEqual({ path: "app-data/notes.json", kind: "appdata", ...f.stat("app-data/notes.json")! });
  });

  it("refuses invalid JSON without writing", async () => {
    const f = repo();
    await expect(backend(f).writeText("playbooks/studio-test.json", "{ nope")).rejects.toThrow("not valid JSON");
    expect(f.text("playbooks/studio-test.json")).toBe(BOOK);
  });

  it("ifMatch: writes over the version it was read as, refuses a changed or deleted file", async () => {
    const f = repo();
    const b = backend(f);
    const { version } = await b.readFile("playbooks/studio-test.json");
    const saved = await b.writeText("playbooks/studio-test.json", '{ "name": "A" }', { ifMatch: version });
    expect(f.text("playbooks/studio-test.json")).toBe('{ "name": "A" }');
    expect(saved.mtime).not.toBe(version!.mtime);

    // Stale version (the save above moved it on): nothing is written.
    const err = await b.writeText("playbooks/studio-test.json", '{ "name": "B" }', { ifMatch: version }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err).toMatchObject({ reason: "changed", path: "playbooks/studio-test.json", file: { mtime: saved.mtime, size: saved.size, kind: "playbook" } });
    expect(f.text("playbooks/studio-test.json")).toBe('{ "name": "A" }');

    // Another program edits it (same size, newer mtime) → changed.
    f.put("playbooks/studio-test.json", '{ "name": "C" }');
    await expect(b.writeText("playbooks/studio-test.json", '{ "name": "D" }', { ifMatch: { mtime: saved.mtime, size: saved.size } })).rejects.toMatchObject({
      reason: "changed",
    });

    f.remove("playbooks/studio-test.json");
    await expect(b.writeText("playbooks/studio-test.json", "{}", { ifMatch: { mtime: saved.mtime, size: saved.size } })).rejects.toMatchObject({
      reason: "deleted",
      file: undefined,
    });
    expect(f.text("playbooks/studio-test.json")).toBeUndefined();
  });

  it("ifAbsent: refuses an existing file and letter-case variants", async () => {
    const f = repo();
    const b = backend(f);
    await expect(b.writeText("playbooks/studio-test.json", "{}", { ifAbsent: true })).rejects.toMatchObject({ reason: "exists", path: "playbooks/studio-test.json" });
    const err = (await b.writeText("playbooks/Studio-Test.json", "{}", { ifAbsent: true }).catch((e: unknown) => e)) as ConflictError;
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.reason).toBe("exists");
    expect(err.message).toContain("letter case");
    expect(err.file?.path).toBe("playbooks/studio-test.json");
    expect(f.paths()).not.toContain("playbooks/Studio-Test.json");
    await b.writeText("playbooks/new.json", "{}", { ifAbsent: true });
    expect(f.text("playbooks/new.json")).toBe("{}");
  });

  it("runs mutations one at a time", async () => {
    const f = repo();
    const b = backend(f);
    const { version } = await b.readFile("playbooks/studio-test.json");
    // Two saves of the same loaded version: exactly one wins, the other conflicts.
    const results = await Promise.allSettled([
      b.writeText("playbooks/studio-test.json", '{ "n": 1 }', { ifMatch: version }),
      b.writeText("playbooks/studio-test.json", '{ "n": 2 }', { ifMatch: version }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    expect(f.text("playbooks/studio-test.json")).toBe('{ "n": 1 }');
  });
});

describe("folder backend: delete / rename", () => {
  it("soft-deletes into app-data/.trash/<stamp>-<name>, numbering repeats", async () => {
    const f = repo();
    const b = backend(f);
    await b.deleteFile("playbooks/plays/art-test.json");
    f.put("playbooks/plays/art-test.json", PLAYS);
    await b.deleteFile("playbooks/plays/art-test.json");
    expect(f.text("playbooks/plays/art-test.json")).toBeUndefined();
    expect(f.text("app-data/.trash/20261004-030709-art-test.json")).toBe(PLAYS);
    expect(f.text("app-data/.trash/20261004-030709-2-art-test.json")).toBe(PLAYS);
    expect((await b.listFiles()).some((x) => x.path.includes(".trash"))).toBe(false);
    await expect(b.deleteFile("playbooks/plays/art-test.json")).rejects.toThrow("File not found");
  });

  it("renames (moves) a file and refuses an existing target in any letter case", async () => {
    const f = repo({ "playbooks/other.json": "{}" });
    const b = backend(f);
    const info = await b.renameFile("playbooks/studio-test.json", "playbooks/renamed.json");
    expect(info).toMatchObject({ path: "playbooks/renamed.json", kind: "playbook", size: BOOK.length });
    expect(f.text("playbooks/renamed.json")).toBe(BOOK);
    expect(f.text("playbooks/studio-test.json")).toBeUndefined();
    await expect(b.renameFile("playbooks/renamed.json", "playbooks/other.json")).rejects.toThrow("Already exists: playbooks/other.json");
    await expect(b.renameFile("playbooks/renamed.json", "playbooks/OTHER.json")).rejects.toThrow("Already exists: playbooks/other.json");
    await expect(b.renameFile("playbooks/missing.json", "playbooks/x.json")).rejects.toThrow("File not found");
    await expect(b.renameFile("playbooks/renamed.json", "playbooks/renamed.json")).rejects.toThrow("same path");
    // Moving across kinds is allowed (like the server).
    await b.renameFile("playbooks/renamed.json", "playbooks/sets/moved.json");
    expect(f.text("playbooks/sets/moved.json")).toBe(BOOK);
  });

  it.each([false, true])("case-only rename keeps the content (case-insensitive disk: %s)", async (ci) => {
    const f = repo({}, ci);
    const b = backend(f);
    const info = await b.renameFile("playbooks/studio-test.json", "playbooks/Studio-Test.json");
    expect(info.path).toBe("playbooks/Studio-Test.json");
    expect(f.paths().filter((p) => p.toLowerCase() === "playbooks/studio-test.json")).toEqual(["playbooks/Studio-Test.json"]);
    expect(f.text("playbooks/Studio-Test.json")).toBe(BOOK);
    expect(f.paths().some((p) => p.endsWith(".tmp"))).toBe(false);
  });

  it("rename with ifMatch refuses a source that changed since it was loaded", async () => {
    const f = repo();
    const b = backend(f);
    const { version } = await b.readFile("playbooks/studio-test.json");
    f.put("playbooks/studio-test.json", BOOK + " ");
    const err = await b.renameFile("playbooks/studio-test.json", "playbooks/x.json", { ifMatch: version }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err).toMatchObject({ reason: "changed", path: "playbooks/studio-test.json" });
    expect(f.text("playbooks/x.json")).toBeUndefined();
  });
});

describe("folder backend: library, template, status", () => {
  it("reads library files with byte progress", async () => {
    const f = repo();
    const calls: [number, number][] = [];
    const plays = await backend(f).fetchLibraryFile<{ name: string }[]>("plays", (l, t) => calls.push([l, t]));
    expect(plays[0].name).toBe("Slants");
    const size = f.stat("data/library/plays.json")!.size;
    expect(calls[0]).toEqual([0, size]);
    expect(calls.at(-1)).toEqual([size, size]);
  });

  it("explains a missing or broken library file", async () => {
    const f = repo({ "data/library/enums.json": "{ broken" });
    f.remove("data/library/sets.json");
    const b = backend(f);
    await expect(b.fetchLibraryFile("sets")).rejects.toThrow("Library file not found: data/library/sets.json");
    await expect(b.fetchLibraryFile("enums")).rejects.toThrow("data/library/enums.json is not valid JSON");
  });

  it("reads the template save as bytes", async () => {
    const f = repo();
    expect(await backend(f).fetchTemplateSave()).toEqual(new Uint8Array([1, 2, 3, 4]));
    f.remove("playbooks/templates/PBOOKOFF-TEMPLATE");
    await expect(backend(f).fetchTemplateSave()).rejects.toThrow("Template save not found");
  });

  it("status lists the library files", async () => {
    const f = repo();
    const st = await backend(f).getStatus();
    expect(st).toMatchObject({ root: "2026 Playbook", hasLibrary: true, backend: "folder" });
    expect(st.library.map((l) => l.name)).toEqual(["assignments.json", "enums.json", "formations.json", "plays.json", "sets.json"]);
    f.remove("data/library/enums.json");
    expect((await backend(f).getStatus()).hasLibrary).toBe(false);
  });
});

describe("folder backend: permission", () => {
  it("asks for access again once when the browser dropped it, then retries", async () => {
    const f = repo();
    const b = backend(f);
    f.setPermission("prompt", () => "granted");
    await expect(b.listFiles()).resolves.toHaveLength(3);
    expect(f.permissionRequests).toBe(1);
  });

  it("fails with a FolderAccessError when access is refused", async () => {
    const f = repo();
    f.setPermission("prompt", () => "denied");
    const err = await backend(f).readFile("playbooks/studio-test.json").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FolderAccessError);
    expect((err as Error).message).toContain("Reconnect");
  });
});

describe("checkFolder", () => {
  it("accepts the repo folder", async () => {
    await expect(checkFolder(repo().root)).resolves.toEqual({ ok: true, missing: [] });
  });

  it("explains a repo subfolder", async () => {
    const f = memoryFolder("app", { "package.json": "{}", "src/main.tsx": "" });
    const r = await checkFolder(f.root);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["data/library/plays.json", "playbooks/"]);
    expect(r.hint).toContain("pick the folder above it");
  });

  it("finds the repo one level down", async () => {
    const f = memoryFolder("Projects", { "2026 Playbook/data/library/plays.json": "[]", "2026 Playbook/playbooks/a.json": "{}", "other/x.txt": "" });
    const r = await checkFolder(f.root);
    expect(r.ok).toBe(false);
    expect(r.hint).toContain('pick "2026 Playbook"');
  });

  it("needs playbooks/ too", async () => {
    const r = await checkFolder(memoryFolder("x", { "data/library/plays.json": "[]" }).root);
    expect(r).toMatchObject({ ok: false, missing: ["playbooks/"] });
  });
});

describe("client dispatch", () => {
  it("routes every client call to the active backend", async () => {
    const f = repo();
    const b = backend(f);
    expect(getStorageBackend()).toBe(serverBackend);
    setStorageBackend(b);
    expect(getStorageBackend().kind).toBe("folder");
    expect((await client.listFiles()).map((x) => x.path)).toContain("playbooks/studio-test.json");
    expect(await client.readText("playbooks/studio-test.json")).toBe(BOOK);
    await client.writeText("app-data/notes.json", "{}", { ifAbsent: true });
    expect(f.text("app-data/notes.json")).toBe("{}");
    await client.renameFile("app-data/notes.json", "app-data/notes2.json");
    await client.deleteFile("app-data/notes2.json");
    expect((await client.getStatus()).backend).toBe("folder");
    expect(await client.fetchTemplateSave()).toHaveLength(4);
    expect(await client.fetchLibraryFile("formations")).toEqual([]);
    setStorageBackend(undefined);
    expect(getStorageBackend()).toBe(serverBackend);
  });
});

describe("shared path rules", () => {
  it("are the server's rules", () => {
    expect(checkPath("playbooks/plays/x.json").kind).toBe("plays");
    expect(() => checkPath("playbooks/templates/x.json")).toThrow(PathError);
  });

  it("the fake satisfies the handle interface", () => {
    const root: FsDirHandle = memoryFolder("x").root;
    expect(root.kind).toBe("directory");
  });
});
