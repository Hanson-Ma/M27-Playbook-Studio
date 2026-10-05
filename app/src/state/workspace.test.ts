import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serializeDoc } from "../model/json";
import type { DocKind, FileInfo, PlaybookSpec, PlaysFile } from "../model/types";

// In-memory stand-in for the file server, shared by every fresh copy of the mocked client module.
const fake = vi.hoisted(() => {
  const files = new Map<string, { text: string; mtime: number }>();
  let clock = 1000;
  const kind = (p: string): DocKind =>
    p.startsWith("playbooks/plays/")
      ? "plays"
      : p.startsWith("playbooks/sets/")
        ? "sets"
        : p === "app-data/concepts.json"
          ? "concepts"
          : p.startsWith("app-data/")
            ? "appdata"
            : "playbook";
  const info = (path: string): FileInfo => {
    const f = files.get(path)!;
    return { path, kind: kind(path), size: f.text.length, mtime: f.mtime };
  };
  /** Thrown by the fake server's writeText; the mocked client turns it into a real ConflictError. */
  class FakeConflict {
    constructor(
      readonly message: string,
      readonly path: string,
      readonly reason: "changed" | "deleted" | "exists",
      readonly file?: FileInfo,
    ) {}
  }
  /** Case-insensitive lookup, like macOS/Windows file systems. */
  const variant = (path: string) => [...files.keys()].find((p) => p.toLowerCase() === path.toLowerCase());
  return {
    files,
    FakeConflict,
    put(path: string, text: string) {
      files.set(path, { text, mtime: ++clock });
    },
    /** When set, writeText waits for this promise before writing. */
    writeGate: undefined as Promise<void> | undefined,
    listFiles: vi.fn(async () => [...files.keys()].sort().map(info)),
    readFile: vi.fn(async (path: string) => {
      const f = files.get(path);
      if (!f) throw new Error(`File not found: ${path}`);
      return { text: f.text, version: { mtime: f.mtime, size: f.text.length } };
    }),
    writeText: vi.fn(
      async (path: string, text: string, pre?: { ifMatch?: { mtime: number; size: number }; ifAbsent?: boolean }): Promise<FileInfo> => {
        JSON.parse(text);
        if (fake.writeGate) await fake.writeGate;
        if (path.includes("readonly")) throw new Error("Path not allowed");
        if (pre?.ifAbsent) {
          const hit = variant(path);
          if (hit) throw new FakeConflict(`${hit} already exists on disk`, path, "exists", info(hit));
        }
        if (pre?.ifMatch) {
          const cur = files.get(path);
          if (!cur) throw new FakeConflict(`${path} was deleted on disk after it was loaded`, path, "deleted");
          const now = info(path);
          if (now.mtime !== pre.ifMatch.mtime || now.size !== pre.ifMatch.size) {
            throw new FakeConflict(`${path} changed on disk after it was loaded`, path, "changed", now);
          }
        }
        files.set(path, { text, mtime: ++clock });
        return info(path);
      },
    ),
    deleteFile: vi.fn(async (path: string) => {
      if (!files.delete(path)) throw new Error(`File not found: ${path}`);
    }),
    renameFile: vi.fn(async (from: string, to: string): Promise<FileInfo> => {
      const f = files.get(from);
      if (!f) throw new Error(`File not found: ${from}`);
      if (files.has(to)) throw new Error(`Already exists: ${to}`);
      files.delete(from);
      files.set(to, f);
      return info(to);
    }),
  };
});

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ConflictError: actual.ConflictError,
    listFiles: () => fake.listFiles(),
    readFile: (p: string) => fake.readFile(p),
    writeText: async (p: string, t: string, pre?: Parameters<typeof actual.writeText>[2]) => {
      try {
        return await fake.writeText(p, t, pre);
      } catch (err) {
        if (err instanceof fake.FakeConflict) throw new actual.ConflictError(err.message, err);
        throw err;
      }
    },
    deleteFile: (p: string) => fake.deleteFile(p),
    renameFile: (a: string, b: string) => fake.renameFile(a, b),
  };
});

type WS = typeof import("./workspace");
let ws: WS;
const state = () => ws.useWorkspace.getState();

const BOOK = "playbooks/studio.json";
const PLAYS = "playbooks/plays/pbs.json";
// Not canonical on disk (cpu order, compact spacing) + an unknown key the app must keep.
const BOOK_TEXT = JSON.stringify({
  name: "STUDIO",
  side: "offense",
  custom: { keep: true },
  formations: [
    { formation: "Shotgun", sets: [{ set: "Y Trips Wk", plays: [{ play: "Slants", cpu: { LastPlay: 1, FirstDown: 2 } }] }] },
  ],
});
const PLAYS_TEXT = '{ "title": "t", "plays": [] }\n';

beforeEach(async () => {
  fake.files.clear();
  fake.writeGate = undefined;
  fake.put(BOOK, BOOK_TEXT);
  fake.put(PLAYS, PLAYS_TEXT);
  fake.put("playbooks/broken.json", "{ nope");
  vi.clearAllMocks();
  vi.resetModules();
  ws = await import("./workspace");
});

afterEach(() => {
  vi.useRealTimers();
});

async function ready() {
  await state().init();
  expect(state().ready).toBe(true);
}

const book = () => state().docs[BOOK] as import("./workspace").DocEntry<PlaybookSpec>;
const rename = (name: string) => (d: PlaybookSpec) => {
  d.name = name;
};

describe("init", () => {
  it("lists and loads every doc; untouched docs are clean; bad JSON becomes an error doc", async () => {
    await ready();
    const s = state();
    expect(s.files.map((f) => f.path)).toEqual(["playbooks/broken.json", PLAYS, BOOK]);
    expect(book().dirty).toBe(false);
    expect(book().kind).toBe("playbook");
    expect(book().savedText).toBe(serializeDoc("playbook", JSON.parse(BOOK_TEXT)));
    expect(book().data.custom).toEqual({ keep: true });
    const broken = s.docs["playbooks/broken.json"];
    expect(broken.data).toBeNull();
    expect(broken.error).toMatch(/Invalid JSON/);
    expect(broken.dirty).toBe(false);
    expect(s.docs[PLAYS].kind).toBe("plays");
  });

  it("is safe to call twice (one load)", async () => {
    await Promise.all([state().init(), state().init()]);
    await state().init();
    expect(fake.listFiles).toHaveBeenCalledTimes(1);
  });

  it("records a failure and allows a retry", async () => {
    fake.listFiles.mockRejectedValueOnce(new Error("offline"));
    await state().init();
    expect(state().ready).toBe(false);
    expect(state().loading).toBe(false);
    expect(state().error).toMatch(/offline/);
    await state().init();
    expect(state().ready).toBe(true);
    expect(state().error).toBeUndefined();
  });

  it("freezes doc data so stray mutations throw", async () => {
    await ready();
    expect(() => {
      (book().data as PlaybookSpec).name = "X";
    }).toThrow();
  });
});

describe("update / undo / redo", () => {
  it("tracks dirty by serialized content and undoes back to clean", async () => {
    await ready();
    state().update<PlaybookSpec>(BOOK, rename("NEW"));
    expect(book().data.name).toBe("NEW");
    expect(book().dirty).toBe(true);
    expect(book().past).toHaveLength(1);
    expect(ws.anyDirty()).toBe(true);

    state().undo(BOOK);
    expect(book().data.name).toBe("STUDIO");
    expect(book().dirty).toBe(false);
    expect(book().future).toHaveLength(1);
    expect(ws.anyDirty()).toBe(false);

    state().redo(BOOK);
    expect(book().data.name).toBe("NEW");
    expect(book().dirty).toBe(true);
    expect(book().future).toHaveLength(0);
  });

  it("is clean again when an edit restores the saved content", async () => {
    await ready();
    state().update<PlaybookSpec>(BOOK, rename("NEW"));
    state().update<PlaybookSpec>(BOOK, rename("STUDIO"));
    expect(book().dirty).toBe(false);
    expect(book().past).toHaveLength(2);
  });

  it("ignores no-op recipes and edits to error docs", async () => {
    await ready();
    const before = state().docs;
    state().update<PlaybookSpec>(BOOK, () => {});
    expect(state().docs).toBe(before);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    state().update("playbooks/broken.json", () => {});
    state().update("playbooks/missing.json", () => {});
    expect(warn).toHaveBeenCalledTimes(2);
    expect(state().docs).toBe(before);
  });

  it("a new edit clears redo", async () => {
    await ready();
    state().update<PlaybookSpec>(BOOK, rename("A"));
    state().undo(BOOK);
    state().update<PlaybookSpec>(BOOK, rename("B"));
    expect(book().future).toHaveLength(0);
    state().redo(BOOK);
    expect(book().data.name).toBe("B");
  });

  it("caps history at 200 steps", async () => {
    await ready();
    for (let i = 0; i < 205; i++) state().update<PlaybookSpec>(BOOK, rename(`N${i}`));
    expect(book().past).toHaveLength(ws.HISTORY_LIMIT);
    expect(book().past[0].name).toBe("N4");
  });

  it("coalesces same-label edits inside the window", async () => {
    vi.useFakeTimers({ now: 10_000 });
    await ready();
    const move = (x: number) => state().update<PlaybookSpec>(BOOK, rename(`X${x}`), { label: "drag", coalesceMs: 300 });
    move(1);
    vi.advanceTimersByTime(200);
    move(2);
    vi.advanceTimersByTime(200); // sliding window: 200 ms since the last one
    move(3);
    expect(book().past).toHaveLength(1);
    expect(book().past[0].name).toBe("STUDIO");

    vi.advanceTimersByTime(301);
    move(4);
    expect(book().past).toHaveLength(2);

    state().update<PlaybookSpec>(BOOK, rename("typed"), { label: "name", coalesceMs: 300 });
    expect(book().past).toHaveLength(3);

    state().undo(BOOK);
    expect(book().data.name).toBe("X4");
    state().undo(BOOK);
    expect(book().data.name).toBe("X3");
    state().undo(BOOK);
    expect(book().data.name).toBe("STUDIO");
  });

  it("does not coalesce across an undo", async () => {
    vi.useFakeTimers({ now: 10_000 });
    await ready();
    state().update<PlaybookSpec>(BOOK, rename("A"), { label: "drag" });
    state().undo(BOOK);
    state().update<PlaybookSpec>(BOOK, rename("B"), { label: "drag" });
    expect(book().past).toHaveLength(1);
  });

  it("undo/redo default to activePath", async () => {
    await ready();
    state().setActive(BOOK);
    state().update<PlaybookSpec>(BOOK, rename("A"));
    state().undo();
    expect(book().data.name).toBe("STUDIO");
    state().redo();
    expect(book().data.name).toBe("A");
    state().setActive(undefined);
    state().undo();
    expect(book().data.name).toBe("A");
  });

  it("replace() is one undoable step", async () => {
    await ready();
    const data: PlaysFile = { title: "t2", plays: [] };
    state().replace(PLAYS, data);
    expect(state().docs[PLAYS].data).toEqual(data);
    expect(state().docs[PLAYS].dirty).toBe(true);
    state().undo(PLAYS);
    expect(state().docs[PLAYS].dirty).toBe(false);
  });

  it("revert() returns to the saved content as an undoable step", async () => {
    await ready();
    state().update<PlaybookSpec>(BOOK, rename("A"));
    state().update<PlaybookSpec>(BOOK, rename("B"));
    state().revert(BOOK);
    expect(book().data.name).toBe("STUDIO");
    expect(book().dirty).toBe(false);
    state().undo(BOOK);
    expect(book().data.name).toBe("B");
  });
});

describe("save", () => {
  it("writes canonical text, keeps unknown keys, updates savedText and files", async () => {
    await ready();
    state().update<PlaybookSpec>(BOOK, rename("NEW"));
    await state().save(BOOK);
    const written = fake.files.get(BOOK)!.text;
    expect(written).toBe(serializeDoc("playbook", book().data));
    expect(JSON.parse(written).custom).toEqual({ keep: true });
    expect(Object.keys(JSON.parse(written).formations[0].sets[0].plays[0].cpu)).toEqual(["FirstDown", "LastPlay"]);
    expect(book().savedText).toBe(written);
    expect(book().dirty).toBe(false);
    expect(state().files.find((f) => f.path === BOOK)!.mtime).toBe(fake.files.get(BOOK)!.mtime);
    // history survives a save; undo makes it dirty against the new saved text
    state().undo(BOOK);
    expect(book().dirty).toBe(true);
  });

  it("does nothing for clean or error docs", async () => {
    await ready();
    await state().save(BOOK);
    await state().save("playbooks/broken.json");
    await state().save();
    expect(fake.writeText).not.toHaveBeenCalled();
  });

  it("defaults to activePath", async () => {
    await ready();
    state().setActive(BOOK);
    state().update<PlaybookSpec>(BOOK, rename("NEW"));
    await state().save();
    expect(fake.writeText).toHaveBeenCalledWith(BOOK, expect.any(String), { ifMatch: expect.any(Object) });
  });

  it("stays dirty when edits land while the write is in flight", async () => {
    await ready();
    let open!: () => void;
    fake.writeGate = new Promise((r) => (open = r));
    state().update<PlaybookSpec>(BOOK, rename("ONE"));
    const saving = state().save(BOOK);
    state().update<PlaybookSpec>(BOOK, rename("TWO"));
    open();
    await saving;
    expect(JSON.parse(fake.files.get(BOOK)!.text).name).toBe("ONE");
    expect(book().data.name).toBe("TWO");
    expect(book().dirty).toBe(true);
    state().undo(BOOK);
    expect(book().dirty).toBe(false); // back to exactly what was written
  });

  it("serializes saves of one doc", async () => {
    await ready();
    let open!: () => void;
    fake.writeGate = new Promise((r) => (open = r));
    state().update<PlaybookSpec>(BOOK, rename("ONE"));
    const first = state().save(BOOK);
    state().update<PlaybookSpec>(BOOK, rename("TWO"));
    const second = state().save(BOOK);
    await Promise.resolve();
    expect(fake.writeText).toHaveBeenCalledTimes(1);
    open();
    await Promise.all([first, second]);
    expect(fake.writeText).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fake.files.get(BOOK)!.text).name).toBe("TWO");
    expect(book().dirty).toBe(false);
  });

  it("rejects with the server message and leaves the doc dirty", async () => {
    await ready();
    fake.writeText.mockRejectedValueOnce(new Error("disk full"));
    state().update<PlaybookSpec>(BOOK, rename("NEW"));
    await expect(state().save(BOOK)).rejects.toThrow("disk full");
    expect(book().dirty).toBe(true);
  });

  it("saveAll saves every dirty doc and reports failures", async () => {
    await ready();
    state().update<PlaybookSpec>(BOOK, rename("NEW"));
    state().update<PlaysFile>(PLAYS, (d) => {
      d.title = "t2";
    });
    state().create("playbooks/readonly.json", "playbook", { name: "R", side: "offense", formations: [] });
    await expect(state().saveAll()).rejects.toThrow(/1 file.*\n.*readonly\.json: Path not allowed/);
    expect(book().dirty).toBe(false);
    expect(state().docs[PLAYS].dirty).toBe(false);
    expect(state().docs["playbooks/readonly.json"].dirty).toBe(true);
    expect(ws.anyDirty()).toBe(true);
  });
});

describe("create / remove / rename", () => {
  const NEW = "playbooks/new.json";
  const spec: PlaybookSpec = { name: "NEW", side: "offense", formations: [] };

  it("create() makes a dirty new doc that save() writes", async () => {
    await ready();
    state().create(NEW, "playbook", spec);
    expect(state().docs[NEW]).toMatchObject({ isNew: true, dirty: true, kind: "playbook", data: spec });
    expect(() => state().create(NEW, "playbook", spec)).toThrow(/already exists/);
    expect(() => state().create(BOOK, "playbook", spec)).toThrow(/already exists/);
    // a name that differs only in letter case is the same file on macOS/Windows
    expect(() => state().create("playbooks/Studio.json", "playbook", spec)).toThrow(/playbooks\/studio\.json already exists.*letter case/);
    expect(() => state().create("playbooks/NEW.json", "playbook", spec)).toThrow(/letter case/);
    await state().save(NEW);
    expect(fake.files.get(NEW)!.text).toBe(serializeDoc("playbook", spec));
    expect(state().docs[NEW].isNew).toBeUndefined();
    expect(state().docs[NEW].dirty).toBe(false);
    expect(state().files.map((f) => f.path)).toContain(NEW);
  });

  it("revert() on a new doc goes back to the created data", async () => {
    await ready();
    state().create(NEW, "playbook", spec);
    state().update<PlaybookSpec>(NEW, rename("CHANGED"));
    state().revert(NEW);
    expect(state().docs[NEW].data).toEqual(spec);
    expect(state().docs[NEW].dirty).toBe(true);
  });

  it("remove() soft-deletes saved docs on the server", async () => {
    await ready();
    state().setActive(BOOK);
    await state().remove(BOOK);
    expect(fake.deleteFile).toHaveBeenCalledWith(BOOK);
    expect(state().docs[BOOK]).toBeUndefined();
    expect(state().files.some((f) => f.path === BOOK)).toBe(false);
    expect(state().activePath).toBeUndefined();
  });

  it("remove() just drops a never-saved doc", async () => {
    await ready();
    state().create(NEW, "playbook", spec);
    await state().remove(NEW);
    expect(fake.deleteFile).not.toHaveBeenCalled();
    expect(state().docs[NEW]).toBeUndefined();
  });

  it("remove() keeps the doc when the server refuses", async () => {
    await ready();
    fake.deleteFile.mockRejectedValueOnce(new Error("nope"));
    await expect(state().remove(BOOK)).rejects.toThrow("nope");
    expect(book()).toBeDefined();
  });

  it("rename() saves dirty content first, then moves doc, history and activePath", async () => {
    await ready();
    const TO = "playbooks/renamed.json";
    state().setActive(BOOK);
    state().update<PlaybookSpec>(BOOK, rename("NEW"));
    await state().rename(BOOK, TO);
    expect(fake.writeText).toHaveBeenCalledWith(BOOK, expect.any(String), { ifMatch: expect.any(Object) });
    expect(fake.renameFile).toHaveBeenCalledWith(BOOK, TO);
    expect(JSON.parse(fake.files.get(TO)!.text).name).toBe("NEW");
    const moved = state().docs[TO] as import("./workspace").DocEntry<PlaybookSpec>;
    expect(moved).toMatchObject({ path: TO, dirty: false });
    expect(moved.past).toHaveLength(1);
    expect(state().docs[BOOK]).toBeUndefined();
    expect(state().activePath).toBe(TO);
    expect(state().files.map((f) => f.path)).toEqual(["playbooks/broken.json", PLAYS, TO]);
    state().undo();
    expect(state().docs[TO].dirty).toBe(true);
  });

  it("rename() of a clean doc doesn't write; of a new doc stays in memory", async () => {
    await ready();
    await state().rename(PLAYS, "playbooks/plays/other.json");
    expect(fake.writeText).not.toHaveBeenCalled();
    expect(state().docs["playbooks/plays/other.json"].dirty).toBe(false);

    state().create(NEW, "playbook", spec);
    await state().rename(NEW, "playbooks/new2.json");
    expect(fake.renameFile).toHaveBeenCalledTimes(1);
    expect(state().docs["playbooks/new2.json"]).toMatchObject({ isNew: true, dirty: true });
    expect(state().docs[NEW]).toBeUndefined();
  });

  it("rename() refuses taken paths", async () => {
    await ready();
    await expect(state().rename(BOOK, PLAYS)).rejects.toThrow(/already exists/);
    await expect(state().rename(PLAYS, "playbooks/Studio.json")).rejects.toThrow(/letter case/);
    expect(fake.renameFile).not.toHaveBeenCalled();
  });
});

describe("refresh", () => {
  it("loads new files, reloads files changed on disk, keeps dirty docs, drops deleted clean docs", async () => {
    await ready();
    state().update<PlaysFile>(PLAYS, (d) => {
      d.title = "mine";
    });
    fake.put("playbooks/sets/new.json", '{ "sets": [] }');
    fake.put(BOOK, JSON.stringify({ name: "DISK", side: "offense", formations: [] }));
    fake.put(PLAYS, '{ "title": "theirs", "plays": [] }');
    fake.put("playbooks/broken.json", '{ "name": "FIXED", "side": "offense", "formations": [] }');
    await state().refresh();

    const s = state();
    expect(s.docs["playbooks/sets/new.json"]).toMatchObject({ kind: "sets", dirty: false });
    expect((s.docs[BOOK].data as PlaybookSpec).name).toBe("DISK");
    expect(s.docs[BOOK].past).toHaveLength(0);
    expect((s.docs[PLAYS].data as PlaysFile).title).toBe("mine");
    expect(s.docs[PLAYS].dirty).toBe(true);
    expect(s.docs["playbooks/broken.json"].error).toBeUndefined();
    expect(s.files).toHaveLength(4);

    fake.files.delete(BOOK);
    fake.files.delete(PLAYS);
    state().setActive(BOOK);
    await state().refresh();
    expect(state().docs[BOOK]).toBeUndefined();
    expect(state().activePath).toBeUndefined();
    // edits kept; flagged, and saving asks first (resolveConflict "overwrite" recreates the file)
    expect(state().docs[PLAYS]).toMatchObject({ dirty: true, isNew: true, changedOnDisk: true });
  });

  it("before init, behaves like init", async () => {
    await state().refresh();
    expect(state().ready).toBe(true);
  });
});

describe("conflict detection", () => {
  const external = (name: string) => fake.put(BOOK, JSON.stringify({ name, side: "offense", formations: [{ formation: "Shotgun", sets: [] }] }));
  const diskName = () => JSON.parse(fake.files.get(BOOK)!.text).name;

  it("docs remember the disk version they were loaded and saved as", async () => {
    await ready();
    const listed = state().files.find((f) => f.path === BOOK)!;
    expect(book().disk).toEqual({ mtime: listed.mtime, size: listed.size });
    state().update<PlaybookSpec>(BOOK, rename("NEW"));
    await state().save(BOOK);
    const after = state().files.find((f) => f.path === BOOK)!;
    expect(book().disk).toEqual({ mtime: after.mtime, size: after.size });
    expect(after.mtime).not.toBe(listed.mtime);
  });

  it("save refuses to overwrite a file changed on disk: ConflictError, conflict recorded, nothing written", async () => {
    await ready();
    state().update<PlaybookSpec>(BOOK, rename("IN-APP"));
    external("EXTERNAL EDIT");
    const err = await state()
      .save(BOOK)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ws.ConflictError);
    expect(err).toMatchObject({ reason: "changed", path: BOOK });
    expect(diskName()).toBe("EXTERNAL EDIT");
    expect(book()).toMatchObject({ dirty: true, changedOnDisk: true });
    expect(book().data.name).toBe("IN-APP");
    expect(state().conflicts[BOOK]).toMatchObject({ reason: "changed", file: { path: BOOK }, message: expect.stringMatching(/changed on disk/) });
  });

  it("resolveConflict('reload') takes the disk version as one undo step", async () => {
    await ready();
    state().update<PlaybookSpec>(BOOK, rename("IN-APP"));
    external("EXTERNAL EDIT");
    await expect(state().save(BOOK)).rejects.toThrow(/changed on disk/);
    await expect(state().resolveConflict(BOOK, "reload")).resolves.toBe(BOOK);
    expect(book().data.name).toBe("EXTERNAL EDIT");
    expect(book().data.formations).toHaveLength(1);
    expect(book()).toMatchObject({ dirty: false });
    expect(book().changedOnDisk).toBeUndefined();
    expect(state().conflicts).toEqual({});
    // the replaced edits are one undo away, and saving them now is a deliberate overwrite of the reloaded version
    state().undo(BOOK);
    expect(book().data.name).toBe("IN-APP");
    expect(book().dirty).toBe(true);
    await state().save(BOOK);
    expect(diskName()).toBe("IN-APP");
  });

  it("resolveConflict('overwrite') writes the in-app version over the current disk version", async () => {
    await ready();
    state().update<PlaybookSpec>(BOOK, rename("IN-APP"));
    external("EXTERNAL EDIT");
    await expect(state().save(BOOK)).rejects.toBeInstanceOf(ws.ConflictError);
    await expect(state().resolveConflict(BOOK, "overwrite")).resolves.toBe(BOOK);
    expect(diskName()).toBe("IN-APP");
    expect(book()).toMatchObject({ dirty: false });
    expect(book().changedOnDisk).toBeUndefined();
    expect(state().conflicts).toEqual({});
  });

  it("resolveConflict('copy') saves the in-app version next to the file and reloads the original", async () => {
    await ready();
    state().update<PlaybookSpec>(BOOK, rename("IN-APP"));
    external("EXTERNAL EDIT");
    await expect(state().save(BOOK)).rejects.toBeInstanceOf(ws.ConflictError);
    expect(ws.conflictCopyPath(BOOK)).toBe("playbooks/studio-copy.json");
    await expect(state().resolveConflict(BOOK, "copy")).resolves.toBe("playbooks/studio-copy.json");
    expect(JSON.parse(fake.files.get("playbooks/studio-copy.json")!.text)).toMatchObject({ name: "IN-APP", custom: { keep: true } });
    expect(state().docs["playbooks/studio-copy.json"]).toMatchObject({ dirty: false, kind: "playbook" });
    expect(diskName()).toBe("EXTERNAL EDIT");
    expect(book()).toMatchObject({ dirty: false });
    expect(book().data.name).toBe("EXTERNAL EDIT");
    expect(state().conflicts).toEqual({});
    expect(ws.conflictCopyPath(BOOK)).toBe("playbooks/studio-copy2.json");
  });

  it("a doc deleted on disk while dirty: save conflicts; overwrite recreates it, reload drops it", async () => {
    await ready();
    state().update<PlaybookSpec>(BOOK, rename("IN-APP"));
    fake.files.delete(BOOK);
    await expect(state().save(BOOK)).rejects.toMatchObject({ reason: "deleted" });
    expect(fake.files.has(BOOK)).toBe(false);
    await state().resolveConflict(BOOK, "overwrite");
    expect(diskName()).toBe("IN-APP");
    expect(book()).toMatchObject({ dirty: false });
    expect(book().isNew).toBeUndefined();

    state().update<PlaybookSpec>(BOOK, rename("AGAIN"));
    state().setActive(BOOK);
    fake.files.delete(BOOK);
    await state().refresh();
    expect(book()).toMatchObject({ isNew: true, changedOnDisk: true, dirty: true });
    await expect(state().resolveConflict(BOOK, "reload")).resolves.toBeUndefined();
    expect(state().docs[BOOK]).toBeUndefined();
    expect(state().activePath).toBeUndefined();
  });

  it("refresh() flags dirty docs whose file changed and reloads them once they're clean", async () => {
    await ready();
    state().update<PlaybookSpec>(BOOK, rename("IN-APP"));
    external("EXTERNAL EDIT");
    await state().refresh();
    expect(book()).toMatchObject({ dirty: true, changedOnDisk: true });
    expect(book().data.name).toBe("IN-APP");
    state().undo(BOOK);
    expect(book().dirty).toBe(false);
    await state().refresh();
    expect(book().data.name).toBe("EXTERNAL EDIT");
    expect(book().changedOnDisk).toBeUndefined();
  });

  it("a never-saved doc only creates its file: an existing file or letter-case variant conflicts as 'exists'", async () => {
    await ready();
    fake.put("playbooks/ZZ-Review.json", '{ "name": "ORIGINAL MARKER", "side": "offense", "formations": [] }');
    // not refreshed yet, so the client-side check can't see it; the server refuses
    state().create("playbooks/zz-review.json", "playbook", { name: "NEW", side: "offense", formations: [] });
    await expect(state().save("playbooks/zz-review.json")).rejects.toMatchObject({ reason: "exists", file: { path: "playbooks/ZZ-Review.json" } });
    expect(JSON.parse(fake.files.get("playbooks/ZZ-Review.json")!.text).name).toBe("ORIGINAL MARKER");
    expect(fake.files.has("playbooks/zz-review.json")).toBe(false);
    await expect(state().resolveConflict("playbooks/zz-review.json", "overwrite")).rejects.toThrow(/letter case/);
    await expect(state().resolveConflict("playbooks/zz-review.json", "reload")).resolves.toBe("playbooks/ZZ-Review.json");
    expect(state().docs["playbooks/zz-review.json"]).toBeUndefined();
    expect(state().docs["playbooks/ZZ-Review.json"].data).toMatchObject({ name: "ORIGINAL MARKER" });
    expect(state().conflicts).toEqual({});
  });

  it("refresh() flags a never-saved doc whose path appeared on disk", async () => {
    await ready();
    state().create("playbooks/new.json", "playbook", { name: "NEW", side: "offense", formations: [] });
    fake.put("playbooks/New.json", "{}");
    await state().refresh();
    expect(state().docs["playbooks/new.json"]).toMatchObject({ isNew: true, changedOnDisk: true });
  });

  it("saveAll surfaces conflicts as a SaveAllError and overwrites nothing", async () => {
    await ready();
    state().update<PlaybookSpec>(BOOK, rename("IN-APP"));
    state().update<PlaysFile>(PLAYS, (d) => {
      d.title = "t2";
    });
    external("EXTERNAL EDIT");
    const err = (await state()
      .saveAll()
      .catch((e: unknown) => e)) as InstanceType<WS["SaveAllError"]>;
    expect(err).toBeInstanceOf(ws.SaveAllError);
    expect(err.conflicts).toEqual([BOOK]);
    expect(err.message).toMatch(/1 file.*\n.*studio\.json: .*changed on disk/);
    expect(diskName()).toBe("EXTERNAL EDIT");
    expect(state().docs[PLAYS].dirty).toBe(false);
  });

  it("a refresh racing a save keeps the saved doc and its FileInfo", async () => {
    await ready();
    const NEW = "playbooks/new.json";
    state().create(NEW, "playbook", { name: "NEW", side: "offense", formations: [] });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const before = [...fake.files.keys()].sort();
    fake.listFiles.mockImplementationOnce(async () => {
      const listing = before.map((p) => ({ path: p, kind: ws.docKindForPath(p), size: fake.files.get(p)!.text.length, mtime: fake.files.get(p)!.mtime }));
      await gate;
      return listing;
    });
    const refreshing = state().refresh();
    await Promise.resolve();
    await state().save(NEW);
    release();
    await refreshing;
    expect(state().docs[NEW]).toMatchObject({ dirty: false });
    expect(state().files.map((f) => f.path)).toContain(NEW);
  });

  it("concurrent refresh() calls share passes", async () => {
    await ready();
    fake.listFiles.mockClear();
    await Promise.all([state().refresh(), state().refresh(), state().refresh()]);
    expect(fake.listFiles).toHaveBeenCalledTimes(2);
  });
});

describe("selectors", () => {
  it("docKindForPath", () => {
    expect(ws.docKindForPath("playbooks/a.json")).toBe("playbook");
    expect(ws.docKindForPath("playbooks/plays/a.json")).toBe("plays");
    expect(ws.docKindForPath("playbooks/sets/a.json")).toBe("sets");
    expect(ws.docKindForPath("app-data/concepts.json")).toBe("concepts");
    expect(ws.docKindForPath("app-data/ui.json")).toBe("appdata");
  });

  it("selectDocsOfKind is sorted and referentially stable until one of its docs changes", async () => {
    await ready();
    state().create("playbooks/a.json", "playbook", { name: "A", side: "offense", formations: [] });
    const first = ws.selectDocsOfKind(state(), "playbook");
    expect(first.map((d) => d.path)).toEqual(["playbooks/a.json", "playbooks/broken.json", BOOK]);
    expect(ws.selectDocsOfKind(state(), "playbook")).toBe(first);

    // an edit to another kind keeps the array
    state().update<PlaysFile>(PLAYS, (d) => {
      d.title = "x";
    });
    expect(ws.selectDocsOfKind(state(), "playbook")).toBe(first);
    const plays = ws.selectDocsOfKind(state(), "plays");
    expect(ws.selectDocsOfKind(state(), "plays")).toBe(plays);

    // an edit to one of its docs gives a new array
    state().update<PlaybookSpec>(BOOK, rename("Z"));
    const second = ws.selectDocsOfKind(state(), "playbook");
    expect(second).not.toBe(first);
    expect(second[2].data).toMatchObject({ name: "Z" });
    expect(ws.selectDocsOfKind(state(), "playbook")).toBe(second);
  });
});
