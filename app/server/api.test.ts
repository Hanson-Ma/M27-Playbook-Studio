import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { checkPath, createApiHandler, fileTag, parsePreconditions, trashStamp } from "./api.ts";

let root: string;
let server: http.Server;
let base: string;
let nextCalls = 0;

const PLAYBOOK = '{ "name": "STUDIO", "side": "offense", "formations": [] }\n';
const LIB = {
  formations: JSON.stringify([{ formId: 1, name: "Shotgun", type: "FormationType_Offense", asset: "a/Shotgun" }]),
  sets: "[]",
  plays: JSON.stringify(Array.from({ length: 2000 }, (_, i) => ({ playId: i, name: `Play ${i}`, asset: `a/P${i}` }))),
  assignments: "{}",
  enums: '{ "fields": {}, "enums": {} }',
};

async function seed() {
  await rm(root, { recursive: true, force: true });
  await mkdir(path.join(root, "playbooks/plays"), { recursive: true });
  await mkdir(path.join(root, "data/library"), { recursive: true });
  await writeFile(path.join(root, "playbooks/studio.json"), PLAYBOOK);
  await writeFile(path.join(root, "playbooks/mod.json"), '{ "title": "mod" }');
  await writeFile(path.join(root, "playbooks/notes.txt"), "not json");
  await writeFile(path.join(root, "playbooks/plays/pbs.json"), '{ "plays": [] }');
  await mkdir(path.join(root, "playbooks/templates"), { recursive: true });
  await writeFile(path.join(root, "playbooks/templates/x.json"), "{}");
  for (const [name, text] of Object.entries(LIB)) await writeFile(path.join(root, "data/library", `${name}.json`), text);
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "pbstudio-api-"));
  const handler = createApiHandler({ root, maxBodyBytes: 1024 * 1024 });
  server = http.createServer((req, res) =>
    handler(req, res, () => {
      nextCalls++;
      res.statusCode = 299;
      res.end("next");
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
});

beforeEach(seed);

const json = { "Content-Type": "application/json" };
const fileUrl = (p: string) => `${base}/api/file?path=${encodeURIComponent(p)}`;
const put = (p: string, body: string, headers: Record<string, string> = json) =>
  fetch(fileUrl(p), { method: "PUT", headers, body });
const rename = (from: unknown, to: unknown) =>
  fetch(`${base}/api/rename`, { method: "POST", headers: json, body: JSON.stringify({ from, to }) });

/** Raw request (no automatic decompression) for checking the gzip bytes. */
function raw(url: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    http
      .get(url, { headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
      })
      .on("error", reject);
  });
}

describe("checkPath", () => {
  it("classifies allowed paths", () => {
    expect(checkPath("playbooks/a.json").kind).toBe("playbook");
    expect(checkPath("playbooks/plays/p-1_v2.json").kind).toBe("plays");
    expect(checkPath("playbooks/sets/s.json").kind).toBe("sets");
    expect(checkPath("app-data/concepts.json").kind).toBe("concepts");
    expect(checkPath("app-data/notes.json").kind).toBe("appdata");
  });

  it.each([
    ["", 400],
    ["../x.json", 400],
    ["playbooks/../x.json", 400],
    ["playbooks/./a.json", 400],
    ["playbooks//a.json", 400],
    ["/etc/passwd", 400],
    ["C:/x.json", 400],
    ["playbooks\\a.json", 400],
    ["playbooks/mod.json", 403],
    ["playbooks/MOD.json", 403],
    ["playbooks/a.txt", 403],
    ["playbooks/a.JSON", 403],
    ["playbooks/.hidden.json", 403],
    ["playbooks/templates/x.json", 403],
    ["playbooks/plays/sub/x.json", 403],
    ["app-data/.trash/x.json", 403],
    ["tools/x.json", 403],
    ["data/library/plays.json", 403],
    ["playbooks/a b.json", 403],
  ])("rejects %j with %i", (p, status) => {
    expect(() => checkPath(p)).toThrow();
    try {
      checkPath(p);
    } catch (err) {
      expect((err as { status: number }).status).toBe(status);
    }
  });

  it("formats trash stamps as yyyymmdd-hhmmss", () => {
    expect(trashStamp(new Date(2026, 9, 4, 3, 7, 9))).toBe("20261004-030709");
  });
});

describe("GET /api/status and /api/files", () => {
  it("reports the root and library files", async () => {
    const res = await fetch(`${base}/api/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.root).toBe(path.resolve(root));
    expect(body.app).toBe("playbook-studio");
    expect(body.hasLibrary).toBe(true);
    expect(body.library.map((l: { name: string }) => l.name)).toEqual([
      "assignments.json",
      "enums.json",
      "formations.json",
      "plays.json",
      "sets.json",
    ]);
    expect(body.library[0]).toMatchObject({ size: 2, mtime: expect.any(Number) });
  });

  it("hasLibrary is false when a required file is missing", async () => {
    await rm(path.join(root, "data/library/enums.json"));
    expect((await (await fetch(`${base}/api/status`)).json()).hasLibrary).toBe(false);
  });

  it("lists editable files with kinds, sorted, without mod.json or non-json", async () => {
    await mkdir(path.join(root, "app-data/.trash"), { recursive: true });
    await writeFile(path.join(root, "app-data/concepts.json"), "{}");
    await writeFile(path.join(root, "app-data/ui.json"), "{}");
    await writeFile(path.join(root, "app-data/.trash/20260101-000000-x.json"), "{}");
    const { files } = await (await fetch(`${base}/api/files`)).json();
    expect(files.map((f: { path: string; kind: string }) => [f.path, f.kind])).toEqual([
      ["app-data/concepts.json", "concepts"],
      ["app-data/ui.json", "appdata"],
      ["playbooks/plays/pbs.json", "plays"],
      ["playbooks/studio.json", "playbook"],
    ]);
    expect(files[3]).toMatchObject({ size: PLAYBOOK.length, mtime: expect.any(Number) });
  });
});

describe("/api/file", () => {
  it("reads a file", async () => {
    const res = await fetch(fileUrl("playbooks/studio.json"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.text()).toBe(PLAYBOOK);
  });

  it("404s a missing file and rejects disallowed paths with a JSON error", async () => {
    const missing = await fetch(fileUrl("playbooks/nope.json"));
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toMatch(/not found/i);
    expect((await fetch(fileUrl("playbooks/mod.json"))).status).toBe(403);
    expect((await fetch(fileUrl("../secret.json"))).status).toBe(400);
    expect((await fetch(`${base}/api/file`)).status).toBe(400);
    const bad = await fetch(fileUrl("playbooks/../../etc/passwd"));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: expect.any(String) });
  });

  it("writes atomically, creating folders, and returns the FileInfo", async () => {
    const text = '{ "sets": [] }\n';
    const res = await put("playbooks/sets/new.json", text);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, file: { path: "playbooks/sets/new.json", kind: "sets", size: text.length, mtime: expect.any(Number) } });
    expect(await readFile(path.join(root, "playbooks/sets/new.json"), "utf8")).toBe(text);
    expect((await readdir(path.join(root, "playbooks/sets"))).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    // overwrite
    await put("playbooks/sets/new.json", '{ "sets": [1] }');
    expect(await readFile(path.join(root, "playbooks/sets/new.json"), "utf8")).toBe('{ "sets": [1] }');
    // app-data is created on demand too
    expect((await put("app-data/concepts.json", "{}")).status).toBe(200);
  });

  it("refuses invalid JSON, bad paths, non-JSON content types, cross-origin and oversized bodies", async () => {
    const invalid = await put("playbooks/studio.json", "{ nope");
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toMatch(/not valid JSON/);
    expect(await readFile(path.join(root, "playbooks/studio.json"), "utf8")).toBe(PLAYBOOK);

    expect((await put("playbooks/mod.json", "{}")).status).toBe(403);
    expect((await put("tools/x.json", "{}")).status).toBe(403);
    expect((await put("../x.json", "{}")).status).toBe(400);
    expect((await put("playbooks/a.json", "{}", { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await put("playbooks/a.json", "{}", { ...json, Origin: "http://evil.example" })).status).toBe(403);
    expect((await put("playbooks/a.json", "{}", { ...json, Origin: base })).status).toBe(200);

    const big = `{ "x": "${"a".repeat(1024 * 1024)}" }`;
    const tooBig = await put("playbooks/big.json", big);
    expect(tooBig.status).toBe(413);
    await expect(stat(path.join(root, "playbooks/big.json"))).rejects.toThrow();
  });

  it("soft-deletes into app-data/.trash with a timestamp", async () => {
    const res = await fetch(fileUrl("playbooks/studio.json"), { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    await expect(stat(path.join(root, "playbooks/studio.json"))).rejects.toThrow();
    const trash = await readdir(path.join(root, "app-data/.trash"));
    expect(trash).toHaveLength(1);
    expect(trash[0]).toMatch(/^\d{8}-\d{6}-studio\.json$/);
    expect(await readFile(path.join(root, "app-data/.trash", trash[0]), "utf8")).toBe(PLAYBOOK);

    // same name again within the same second doesn't overwrite the first trashed copy
    await writeFile(path.join(root, "playbooks/studio.json"), "{}");
    await fetch(fileUrl("playbooks/studio.json"), { method: "DELETE" });
    expect(await readdir(path.join(root, "app-data/.trash"))).toHaveLength(2);

    expect((await fetch(fileUrl("playbooks/studio.json"), { method: "DELETE" })).status).toBe(404);
    expect((await fetch(fileUrl("playbooks/mod.json"), { method: "DELETE" })).status).toBe(403);
  });

  it("405s other methods", async () => {
    expect((await fetch(fileUrl("playbooks/studio.json"), { method: "POST", headers: json, body: "{}" })).status).toBe(405);
  });
});

describe("/api/file conflict detection", () => {
  const BOOK = "playbooks/studio.json";
  const tagOf = async (p: string) => {
    const st = await stat(path.join(root, p));
    return fileTag(Math.round(st.mtimeMs), st.size);
  };

  it("GET sends the file version as ETag (FileInfo mtime + size)", async () => {
    const res = await fetch(fileUrl(BOOK));
    expect(res.headers.get("etag")).toBe(await tagOf(BOOK));
    const { files } = await (await fetch(`${base}/api/files`)).json();
    const info = files.find((f: { path: string }) => f.path === BOOK);
    expect(res.headers.get("etag")).toBe(fileTag(info.mtime, info.size));
    const head = await fetch(fileUrl(BOOK), { method: "HEAD" });
    expect(head.headers.get("etag")).toBe(res.headers.get("etag"));
  });

  it("If-Match: writes when the version matches and returns the new FileInfo", async () => {
    const tag = (await fetch(fileUrl(BOOK))).headers.get("etag")!;
    const res = await put(BOOK, '{ "name": "MINE" }', { ...json, "If-Match": tag });
    expect(res.status).toBe(200);
    const { file } = await res.json();
    expect(fileTag(file.mtime, file.size)).toBe(await tagOf(BOOK));
    expect(await readFile(path.join(root, BOOK), "utf8")).toBe('{ "name": "MINE" }');
  });

  it("If-Match: 409 'changed' with the disk FileInfo when the file changed, leaving it untouched", async () => {
    const tag = (await fetch(fileUrl(BOOK))).headers.get("etag")!;
    await new Promise((r) => setTimeout(r, 15));
    await writeFile(path.join(root, BOOK), '{ "name": "EXTERNAL EDIT" }');
    const res = await put(BOOK, '{ "name": "MINE" }', { ...json, "If-Match": tag });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ conflict: "changed", path: BOOK, error: expect.stringMatching(/changed on disk/) });
    expect(fileTag(body.file.mtime, body.file.size)).toBe(await tagOf(BOOK));
    expect(await readFile(path.join(root, BOOK), "utf8")).toBe('{ "name": "EXTERNAL EDIT" }');
    // the current tag (or *) goes through
    expect((await put(BOOK, '{ "name": "MINE" }', { ...json, "If-Match": body.file && fileTag(body.file.mtime, body.file.size) })).status).toBe(200);
    expect((await put(BOOK, '{ "name": "ANY" }', { ...json, "If-Match": "*" })).status).toBe(200);
  });

  it("If-Match: 409 'deleted' when the file is gone (nothing is recreated)", async () => {
    const tag = await tagOf(BOOK);
    await rm(path.join(root, BOOK));
    const res = await put(BOOK, "{}", { ...json, "If-Match": tag });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ conflict: "deleted", path: BOOK });
    await expect(stat(path.join(root, BOOK))).rejects.toThrow();
    expect((await put(BOOK, "{}", { ...json, "If-Match": "*" })).status).toBe(409);
  });

  it("If-None-Match: * creates only when neither the file nor a letter-case variant exists", async () => {
    expect((await put("playbooks/fresh.json", "{}", { ...json, "If-None-Match": "*" })).status).toBe(200);
    const same = await put(BOOK, "{}", { ...json, "If-None-Match": "*" });
    expect(same.status).toBe(409);
    expect(await same.json()).toMatchObject({ conflict: "exists", path: BOOK, file: { path: BOOK, kind: "playbook" } });

    await writeFile(path.join(root, "playbooks/ZZ-Review.json"), '{ "name": "ORIGINAL MARKER" }');
    const variant = await put("playbooks/zz-review.json", '{ "name": "NEW" }', { ...json, "If-None-Match": "*" });
    expect(variant.status).toBe(409);
    const body = await variant.json();
    expect(body).toMatchObject({ conflict: "exists", path: "playbooks/zz-review.json", file: { path: "playbooks/ZZ-Review.json" } });
    expect(body.error).toMatch(/letter case/);
    expect(await readFile(path.join(root, "playbooks/ZZ-Review.json"), "utf8")).toBe('{ "name": "ORIGINAL MARKER" }');
    expect(await readdir(path.join(root, "playbooks"))).not.toContain("zz-review.json");
  });

  it("rejects malformed preconditions; no precondition still overwrites", async () => {
    expect((await put(BOOK, "{}", { ...json, "If-None-Match": '"1-2"' })).status).toBe(400);
    expect((await put(BOOK, "{}", { ...json, "If-Match": " , " })).status).toBe(400);
    expect((await put(BOOK, '{ "x": 1 }')).status).toBe(200);
  });

  it("parsePreconditions", () => {
    expect(parsePreconditions({})).toEqual({});
    expect(parsePreconditions({ "if-match": '"1-2", W/"3-4"' })).toEqual({ ifMatch: ['"1-2"', '"3-4"'] });
    expect(parsePreconditions({ "if-none-match": "*" })).toEqual({ ifAbsent: true });
  });

  it("concurrent conditional writes with the same version: exactly one wins", async () => {
    const tag = await tagOf(BOOK);
    const results = await Promise.all(
      ["A", "B", "C"].map((n) => put(BOOK, `{ "name": "${n}", "pad": "${"x".repeat(n.charCodeAt(0))}" }`, { ...json, "If-Match": tag })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
  });
});

describe("POST /api/rename", () => {
  it("renames and returns the new FileInfo", async () => {
    const res = await rename("playbooks/studio.json", "playbooks/plays/moved.json");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      file: { path: "playbooks/plays/moved.json", kind: "plays", size: PLAYBOOK.length, mtime: expect.any(Number) },
    });
    expect(await readFile(path.join(root, "playbooks/plays/moved.json"), "utf8")).toBe(PLAYBOOK);
    await expect(stat(path.join(root, "playbooks/studio.json"))).rejects.toThrow();
  });

  it("creates the target folder", async () => {
    expect((await rename("playbooks/studio.json", "playbooks/sets/s.json")).status).toBe(200);
  });

  it("allows a case-only rename", async () => {
    expect((await rename("playbooks/studio.json", "playbooks/Studio.json")).status).toBe(200);
    expect(await readdir(path.join(root, "playbooks"))).toContain("Studio.json");
  });

  it("honours If-Match on the source (409 conflict when it changed since it was loaded)", async () => {
    const st = await stat(path.join(root, "playbooks/studio.json"));
    const tag = fileTag(Math.round(st.mtimeMs), st.size);
    const post = (to: string, ifMatch: string) =>
      fetch(`${base}/api/rename`, { method: "POST", headers: { ...json, "If-Match": ifMatch }, body: JSON.stringify({ from: "playbooks/studio.json", to }) });
    const stale = await post("playbooks/x.json", fileTag(1, st.size));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ conflict: "changed", path: "playbooks/studio.json", file: { size: st.size } });
    await expect(stat(path.join(root, "playbooks/x.json"))).rejects.toThrow();
    const ok = await post("playbooks/x.json", tag);
    expect(ok.status).toBe(200);
    // A rename keeps the version, so the workspace can keep tracking it under the new name.
    expect((await ok.json()).file).toMatchObject({ path: "playbooks/x.json", mtime: Math.round(st.mtimeMs), size: st.size });
  });

  it("refuses existing targets, missing sources, bad paths and bad bodies", async () => {
    expect((await rename("playbooks/studio.json", "playbooks/plays/pbs.json")).status).toBe(409);
    expect((await rename("playbooks/studio.json", "playbooks/plays/PBS.json")).status).toBe(409); // letter-case variant
    expect((await rename("playbooks/nope.json", "playbooks/x.json")).status).toBe(404);
    expect((await rename("playbooks/studio.json", "playbooks/mod.json")).status).toBe(403);
    expect((await rename("playbooks/studio.json", "../x.json")).status).toBe(400);
    expect((await rename("playbooks/studio.json", 5)).status).toBe(400);
    expect((await rename("playbooks/studio.json", "playbooks/studio.json")).status).toBe(400);
    const notJson = await fetch(`${base}/api/rename`, { method: "POST", headers: json, body: "nope" });
    expect(notJson.status).toBe(400);
    expect((await fetch(`${base}/api/rename`)).status).toBe(405);
    expect(await readFile(path.join(root, "playbooks/studio.json"), "utf8")).toBe(PLAYBOOK);
  });
});

describe("/library", () => {
  it("serves gzip with ETag, X-Uncompressed-Length and no-cache", async () => {
    const res = await raw(`${base}/library/plays.json`, { "Accept-Encoding": "gzip, deflate" });
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("gzip");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers["x-uncompressed-length"]).toBe(String(LIB.plays.length));
    expect(Number(res.headers["content-length"])).toBe(res.body.length);
    expect(res.body.length).toBeLessThan(LIB.plays.length);
    expect(zlib.gunzipSync(res.body).toString("utf8")).toBe(LIB.plays);
    expect(res.headers.etag).toMatch(/^".+-gz"$/);

    const again = await raw(`${base}/library/plays.json`, { "Accept-Encoding": "gzip", "If-None-Match": res.headers.etag! });
    expect(again.status).toBe(304);
    expect(again.body.length).toBe(0);
  });

  it("serves identity when gzip isn't accepted, with its own ETag", async () => {
    const res = await raw(`${base}/library/formations.json`);
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.body.toString("utf8")).toBe(LIB.formations);
    expect(res.headers.etag).not.toMatch(/-gz"$/);
    expect((await raw(`${base}/library/formations.json`, { "If-None-Match": res.headers.etag! })).status).toBe(304);
  });

  it("works through fetch (transparent decompression)", async () => {
    const res = await fetch(`${base}/library/enums.json`);
    expect(res.headers.get("x-uncompressed-length")).toBe(String(LIB.enums.length));
    expect(await res.json()).toEqual(JSON.parse(LIB.enums));
  });

  it("re-compresses when the file changes", async () => {
    const first = await raw(`${base}/library/sets.json`, { "Accept-Encoding": "gzip" });
    await new Promise((r) => setTimeout(r, 20));
    await writeFile(path.join(root, "data/library/sets.json"), '[{ "setId": 1 }]');
    const second = await raw(`${base}/library/sets.json`, { "Accept-Encoding": "gzip", "If-None-Match": first.headers.etag! });
    expect(second.status).toBe(200);
    expect(second.headers.etag).not.toBe(first.headers.etag);
    expect(zlib.gunzipSync(second.body).toString("utf8")).toBe('[{ "setId": 1 }]');
  });

  it("404s unknown or missing library files", async () => {
    const res = await fetch(`${base}/library/nope.json`);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/not found/i);
    expect((await fetch(`${base}/library/../playbooks/studio.json`)).status).not.toBe(200);
    expect((await fetch(`${base}/library/sub/x.json`)).status).toBe(404);
  });
});

describe("routing", () => {
  it("404s unknown API endpoints and passes everything else to next()", async () => {
    const res = await fetch(`${base}/api/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/Unknown endpoint/) });
    const before = nextCalls;
    const page = await fetch(`${base}/index.html`);
    expect(page.status).toBe(299);
    expect(await fetch(`${base}/apix`).then((r) => r.status)).toBe(299);
    expect(nextCalls).toBe(before + 2);
  });
});

describe("GET /api/template", () => {
  it("serves the template save bytes read-only and 404s when it's missing", async () => {
    let res = await fetch(`${base}/api/template`);
    expect(res.status).toBe(404);
    const bytes = Buffer.from([0x46, 0x42, 0x43, 0x48, 0, 1, 2, 255]);
    await writeFile(path.join(root, "playbooks/templates/PBOOKOFF-TEMPLATE"), bytes);
    res = await fetch(`${base}/api/template`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
    res = await fetch(`${base}/api/template`, { method: "PUT", headers: json, body: "{}" });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
