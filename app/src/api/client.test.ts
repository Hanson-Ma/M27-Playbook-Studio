import { afterEach, describe, expect, it, vi } from "vitest";
import { ConflictError, parseVersionTag, readFile, versionTag, writeText } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

describe("version tags", () => {
  it("round-trips FileVersion ⇄ the server's ETag format", () => {
    expect(versionTag({ mtime: 1791099331000, size: 1206 })).toBe('"1791099331000-1206"');
    expect(parseVersionTag('"1791099331000-1206"')).toEqual({ mtime: 1791099331000, size: 1206 });
    expect(parseVersionTag('W/"5-6"')).toEqual({ mtime: 5, size: 6 });
    expect(parseVersionTag(null)).toBeUndefined();
    expect(parseVersionTag('"abc"')).toBeUndefined();
  });
});

describe("readFile / writeText", () => {
  it("readFile returns the text with the ETag version", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200, headers: { ETag: '"10-2"' } })));
    await expect(readFile("playbooks/a.json")).resolves.toEqual({ text: "{}", version: { mtime: 10, size: 2 } });
  });

  it("sends preconditions as If-Match / If-None-Match", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => json(200, { ok: true, file: { path: "playbooks/a.json", kind: "playbook", size: 2, mtime: 11 } }));
    vi.stubGlobal("fetch", fetch);
    await writeText("playbooks/a.json", "{}", { ifMatch: { mtime: 10, size: 2 } });
    await writeText("playbooks/a.json", "{}", { ifAbsent: true });
    await writeText("playbooks/a.json", "{}");
    const headers = fetch.mock.calls.map((c) => c[1]?.headers as Record<string, string>);
    expect(headers[0]["If-Match"]).toBe('"10-2"');
    expect(headers[1]["If-None-Match"]).toBe("*");
    expect(headers[2]["If-Match"]).toBeUndefined();
    expect(headers[2]["If-None-Match"]).toBeUndefined();
  });

  it("turns a 409 conflict body into a ConflictError; other errors stay plain", async () => {
    const file = { path: "playbooks/a.json", kind: "playbook", size: 9, mtime: 12 };
    vi.stubGlobal("fetch", vi.fn(async () => json(409, { error: "playbooks/a.json changed on disk", conflict: "changed", path: "playbooks/a.json", file })));
    const err = await writeText("playbooks/a.json", "{}", { ifMatch: { mtime: 10, size: 2 } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err).toMatchObject({ reason: "changed", path: "playbooks/a.json", file, message: "playbooks/a.json changed on disk" });

    vi.stubGlobal("fetch", vi.fn(async () => json(409, { error: "Already exists: playbooks/b.json" })));
    const plain = await writeText("playbooks/a.json", "{}").catch((e: unknown) => e);
    expect(plain).not.toBeInstanceOf(ConflictError);
    expect((plain as Error).message).toBe("Already exists: playbooks/b.json");
  });
});
