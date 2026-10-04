import { describe, expect, it } from "vitest";
import { href, lastMainHash, parseRoute, rememberRoute, rememberedHash, rewriteHashPath, rewriteRememberedPath } from "./router";

const book = "playbooks/zzreviewa.json";
const renamed = "playbooks/zzreviewb.json";

describe("rewriteHashPath", () => {
  it("leaves hashes that don't mention the path alone", () => {
    const h = href("playcall", "playbooks/other.json") + "?tab=1";
    expect(rewriteHashPath(h, book, renamed)).toBe(h);
    expect(rewriteHashPath("#/library", book)).toBe("#/library");
  });

  it("rewrites path parts and query values on rename, keeping the rest of the route", () => {
    const h = href("playcall", book) + "?tab=2&pg=1";
    const out = rewriteHashPath(h, book, renamed)!;
    const r = parseRoute(out);
    expect(r.view).toBe("playcall");
    expect(r.parts).toEqual([renamed]);
    expect(r.query.get("tab")).toBe("2");
    expect(r.query.get("pg")).toBe("1");

    const d = parseRoute(rewriteHashPath(`#/designer/new?set=X&file=${encodeURIComponent(book)}`, book, renamed)!);
    expect(d.parts).toEqual(["new"]);
    expect(d.query.get("file")).toBe(renamed);
    expect(d.query.get("set")).toBe("X");
  });

  it("returns null when the path was deleted", () => {
    expect(rewriteHashPath(href("playbook", book) + "?f=0", book)).toBeNull();
  });
});

describe("parseRoute", () => {
  it("opens on the playbook and sends unknown views there", () => {
    expect(parseRoute("").view).toBe("playbook");
    expect(parseRoute("#/").view).toBe("playbook");
    expect(parseRoute("#/nope/x").view).toBe("playbook");
  });
  it("knows the help view and its section", () => {
    const r = parseRoute("#/help/designer?h=cuts");
    expect(r.view).toBe("help");
    expect(r.parts).toEqual(["designer"]);
    expect(r.query.get("h")).toBe("cuts");
  });
});

describe("remembered tab routes", () => {
  it("follow renames and fall back to the view root on delete, keeping recency", () => {
    rememberRoute(parseRoute(href("playbook", book)));
    rememberRoute(parseRoute(href("playcall", book)));
    rememberRoute(parseRoute("#/library"));
    rememberRoute(parseRoute("#/settings"));
    rememberRoute(parseRoute("#/help/routes"));
    expect(lastMainHash()).toBe("#/library");

    rewriteRememberedPath(book, renamed);
    expect(parseRoute(rememberedHash("playcall")!).parts).toEqual([renamed]);
    expect(parseRoute(rememberedHash("playbook")!).parts).toEqual([renamed]);

    rewriteRememberedPath(renamed);
    expect(rememberedHash("playcall")).toBe("#/playcall");
    expect(rememberedHash("playbook")).toBe("#/playbook");
    expect(rememberedHash("library")).toBe("#/library");
    expect(lastMainHash()).toBe("#/library");
  });
});
