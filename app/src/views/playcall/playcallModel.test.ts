import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCatalog } from "../../model/catalog";
import { loadLibraryData, loadPlaysDoc, studioV1 } from "../../model/libFixture";
import { buildLibraryIndex } from "../../model/library";
import { resolvePlaybook } from "../../model/resolveBook";
import { templateContents } from "../../model/tdb";
import type { ConceptsDoc, PlaybookSpec } from "../../model/types";
import {
  DEFAULT_NAV,
  buildCallBook,
  canOpenFormation,
  cardStat,
  clampPage,
  conceptGroups,
  cpuRows,
  diamondPositions,
  formationSummary,
  navQuery,
  neighbor,
  pageCount,
  pageOf,
  pageSlice,
  parentOf,
  parseNav,
  playsForKeys,
  presnapList,
  readConceptLabel,
  resolveLevel,
  runSchemeLabel,
  typeGroups,
  type CallBook,
  type CallContext,
} from "./playcallModel";

const lib = buildLibraryIndex(loadLibraryData());
const cat = buildCatalog(lib, [loadPlaysDoc("art-test.json"), loadPlaysDoc("pbs-ytrips-v1.json")]);
const spec = (name: string): PlaybookSpec =>
  name === "studio-test.json"
    ? studioV1()
    : JSON.parse(readFileSync(new URL(`../../../../playbooks/${name}`, import.meta.url), "utf8"));
const callBook = (s: PlaybookSpec) => buildCallBook(resolvePlaybook(s, cat));
const templateBytes = new Uint8Array(readFileSync(new URL("../../../../playbooks/templates/PBOOKOFF-TEMPLATE", import.meta.url)));
const template = { contents: templateContents(templateBytes, lib), lib };
const callBookWithTemplate = (s: PlaybookSpec) => buildCallBook(resolvePlaybook(s, cat), template);

function ctxFor(book: CallBook, doc?: ConceptsDoc): CallContext {
  return { book, concepts: conceptGroups(book, doc), types: typeGroups(book), favorites: [], recents: [] };
}

describe("buildCallBook", () => {
  const book = callBook(spec("studio-test.json"));

  it("flattens formations, sets and plays in file order with stable ids", () => {
    expect(book.formations.map((f) => f.name)).toEqual(["Shotgun", "Goal Line Offense", "Special", "Kickoff", "Safety Kickoff"]);
    expect(book.formations.slice(1).every((f) => f.template && f.sets.length === 0)).toBe(true);
    expect(book.sets.map((s) => `${s.formationName}/${s.name}`)).toEqual(["Shotgun/Y Trips Wk", "Shotgun/Bunch"]);
    expect(book.plays).toHaveLength(19);
    expect(book.plays.every((p) => p.play)).toBe(true);
    const first = book.plays[0];
    expect(first.id).toBe("0.0.0");
    expect(first.name).toBe("PBS GT Counter");
    expect(first.subtitle).toBe("GUN Y TRIPS WK");
    expect(first.cpuCount).toBe(3);
    expect(book.byId.get("0.1.1")?.name).toBe("Reverse");
    expect(book.formations[0].playCount).toBe(19);
    expect(formationSummary(book.formations[0])).toBe("2 sets · 19 plays");
    expect(formationSummary(book.formations[2])).toBe("From template");
    expect(book.formations.slice(1).every((f) => f.templateState === "pending" && !canOpenFormation(f))).toBe(true);
  });

  it("fills template sections from the template save (read-only, after the file's own plays)", () => {
    const tb = callBookWithTemplate(spec("studio-test.json"));
    const gl = tb.formations[1];
    expect(gl.name).toBe("Goal Line Offense");
    expect(gl.template).toBe(true);
    expect(gl.templateState).toBe("ready");
    expect(canOpenFormation(gl)).toBe(true);
    expect(gl.sets.map((s) => s.name)).toEqual(["Normal"]);
    expect(gl.sets[0]).toMatchObject({ id: "1.0", f: 1, s: 0, template: true, formationName: "Goal Line Offense" });
    expect(gl.playCount).toBe(12);
    expect(formationSummary(gl)).toBe("From template · 1 set · 12 plays");
    const dive = tb.byId.get("1.0.0")!;
    expect(dive).toMatchObject({ name: "HB Dive", template: true, audible: 4, subtitle: "GOAL LINE NORMAL" });
    expect(dive.play?.source).toBe("library");
    expect(dive.entry).toEqual({ play: "HB Dive", audible: 4, cpu: { Insidefive: 10, SignaturePlays: 0 } });
    expect(dive.cpuCount).toBe(2);
    expect(Object.keys(gl.sets[0].audibles)).toHaveLength(4);
    // the file's own plays keep their ids / order; template plays follow in book order
    expect(tb.plays.slice(0, 19).map((p) => p.id)).toEqual(callBook(spec("studio-test.json")).plays.map((p) => p.id));
    expect(tb.plays.slice(0, 19).every((p) => !p.template)).toBe(true);
    expect(tb.plays.slice(19).every((p) => p.template && p.play)).toBe(true);
    // "Special" resolves by side (tools/pbook-build.mjs, commit ac54574): offense Special's punt / field goal sets.
    const special = tb.formations[2];
    expect(special.name).toBe("Special");
    expect(special.templateState).toBe("ready");
    expect(special.sets.length).toBeGreaterThan(0);
    expect(canOpenFormation(special)).toBe(true);
    expect(special.sets.every((st) => !!st.set && lib.formationSide(lib.formationOfSet(st.set.asset)!) !== "defense")).toBe(true);
    const kickoff = tb.formations.find((f) => f.name === "Kickoff")!;
    expect(kickoff.templateState).toBe("ready");
    // a foreign play (filed under another set in the save) is kept and flagged
    expect(tb.plays.some((p) => p.foreign)).toBe(true);
    // template plays are in the other tabs too (like the game)
    expect(typeGroups(tb).find((g) => g.id === "special")?.items.every((i) => i.template)).toBe(true);
  });

  it("marks template sections the save doesn't have", () => {
    const tc = template.contents;
    const missing = lib.data.formations.find(
      (f) => lib.formationSide(f) === "offense" && !lib.isMinigame(f) && !tc.formations.some((t) => t.formation.formId === f.formId) && lib.formationByName(f.name, "offense") === f,
    )!;
    const b = callBookWithTemplate({ name: "X", side: "offense", formations: [{ formation: missing.name, sets: "template" }] });
    expect(b.formations[0]).toMatchObject({ template: true, templateState: "missing", sets: [] });
    expect(canOpenFormation(b.formations[0])).toBe(false);
    expect(formationSummary(b.formations[0])).toBe("From template · not in the template save");
  });

  it("collects the audible diamond per set", () => {
    const set = book.sets[0];
    expect(set.audibles[1]?.name).toBe("Slants");
    expect(set.audibles[2]?.name).toBe("PBS GT Counter");
    expect(set.audibles[3]?.name).toBe("PBS Bubble Go");
    expect(set.audibles[4]?.name).toBe("PBS PA Yankee");
    expect(set.duplicateAudibles).toEqual([]);
    expect(book.sets[1].audibles).toEqual({});
  });

  it("keeps unresolved entries, ignores bad audibles and flags duplicates", () => {
    const s: PlaybookSpec = {
      name: "X",
      side: "offense",
      formations: [
        {
          formation: "Shotgun",
          sets: [
            {
              set: "Y Trips Wk",
              plays: [
                { play: "Slants", audible: 1 },
                { play: "Four Verticals", audible: 1 },
                { play: "Nope Nope" },
                { play: "Mtn Mesh", audible: 7 as never },
              ],
            },
          ],
        },
        { formation: "Nowhere Formation", sets: [{ set: "Ghost", plays: [{ play: "Boo" }] }] },
      ],
    };
    const b = callBook(s);
    const set = b.sets[0];
    expect(set.audibles[1]?.name).toBe("Slants");
    expect(set.duplicateAudibles).toEqual([1]);
    expect(b.byId.get("0.0.2")?.play).toBeUndefined();
    expect(b.byId.get("0.0.2")?.problem).toMatch(/Unknown play/);
    expect(b.byId.get("0.0.2")?.name).toBe("Nope Nope");
    expect(b.byId.get("0.0.3")?.audible).toBeUndefined();
    expect(b.formations[1].problem).toMatch(/Unknown formation/);
    expect(b.formations[1].sets[0].problem).toBeDefined();
    expect(b.byKey.size).toBe(3);
  });
});

describe("groups", () => {
  const book = callBook(spec("studio-lib.json"));

  it("groups by play-type family in the game's order", () => {
    const groups = typeGroups(book);
    expect(groups.map((g) => g.id)).toEqual(["pass", "run", "pa", "screen"]);
    expect(groups.find((g) => g.id === "run")!.items.map((i) => i.name)).toEqual(["Inside Zone", "Reverse"]);
    expect(groups.find((g) => g.id === "screen")!.items.map((i) => i.name)).toEqual(["HB Slip Screen"]);
    expect(groups.find((g) => g.id === "pa")!.items.map((i) => i.name)).toEqual(["Mtn PA Smash Scissors"]);
    expect(groups[0].label).toBe("PASS");
    expect(groups[0].color).toBe("var(--blue)");
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    expect(total).toBe(book.plays.length);
  });

  it("falls back to read concepts and run schemes without concept tags", () => {
    const { source, groups } = conceptGroups(book, undefined);
    expect(source).toBe("reads");
    const mesh = groups.find((g) => g.id === "read:mesh");
    expect(mesh?.label).toBe("Mesh");
    expect(mesh?.items.map((i) => i.name)).toContain("Mesh");
    const iz = groups.find((g) => g.items.some((i) => i.name === "Inside Zone"));
    expect(iz?.id).toBe("run:inside zone");
    expect(iz?.eyebrow).toBe("Run scheme");
    // every resolved play lands somewhere
    const placed = new Set(groups.flatMap((g) => g.items.map((i) => i.id)));
    expect(placed.size).toBe(book.plays.length);
    // "Other" (if present) is last
    const otherAt = groups.findIndex((g) => g.id === "other");
    expect(otherAt === -1 || otherAt === groups.length - 1).toBe(true);
    // an empty concepts doc also falls back
    expect(conceptGroups(book, { version: 1, categories: [], tags: {} }).source).toBe("reads");
  });

  it("uses concept categories when the book's plays are tagged", () => {
    const mesh = book.plays.find((i) => i.name === "Mesh")!.play!.key;
    const iz = book.plays.find((i) => i.name === "Inside Zone")!.play!.key;
    const doc: ConceptsDoc = {
      version: 1,
      categories: [
        { id: "pass", name: "Pass", group: "pass", color: "#3366ff" },
        { id: "mesh", name: "Mesh", group: "pass", color: "#ff3366", parent: "pass" },
        { id: "zone", name: "Zone", group: "run", color: "#33cc66" },
        { id: "empty", name: "Empty", group: "other", color: "#999999" },
      ],
      tags: { [mesh]: ["mesh"], [iz]: ["zone", "mesh"] },
    };
    const { source, groups } = conceptGroups(book, doc);
    expect(source).toBe("tags");
    expect(groups.map((g) => g.id)).toEqual(["cat:mesh", "cat:zone", "untagged"]);
    expect(groups[0].eyebrow).toBe("Pass");
    expect(groups[0].color).toBe("#ff3366");
    expect(groups[0].items.map((i) => i.name)).toEqual(["Inside Zone", "Mesh"]);
    expect(groups[1].eyebrow).toBe("Run concept");
    expect(groups[2].items).toHaveLength(book.plays.length - 2);
  });

  it("labels read concepts and run schemes", () => {
    expect(readConceptLabel("Concept_Mesh")).toBe("Mesh");
    expect(readConceptLabel("Concept_Y_Cross")).toBe("Y Cross");
    expect(readConceptLabel("Concept_Invalid")).toBeUndefined();
    expect(readConceptLabel(undefined)).toBeUndefined();
    const B = "football/Gameplay/playbooks/PlayLibrary/Blocking/";
    expect(runSchemeLabel(B + "BTInsideZone")).toBe("Inside Zone");
    expect(runSchemeLabel(B + "BTBuckSweep")).toBe("Buck Sweep");
    expect(runSchemeLabel(B + "Code_Outside_Zone")).toBe("Outside Zone");
    expect(runSchemeLabel(B + "PinPull")).toBe("Pin Pull");
    expect(runSchemeLabel(B + "BTIso")).toBe("Iso");
    expect(runSchemeLabel(B + "CODE_DETERMINE")).toBeUndefined();
    expect(runSchemeLabel(B + "FullSlideLeftProtection")).toBeUndefined();
    expect(runSchemeLabel(B + "FakePuntRun")).toBeUndefined();
  });

  it("restricts favorites / recents to the playbook, first entry per key, list order", () => {
    const slants = book.plays.find((i) => i.name === "Slants")!;
    const mesh = book.plays.find((i) => i.name === "Mesh")!;
    const keys = [mesh.play!.key, "football/not/in/this/book", slants.play!.key, mesh.play!.key];
    expect(playsForKeys(book, keys).map((i) => i.id)).toEqual([mesh.id, slants.id]);
  });
});

describe("paging", () => {
  it("pages three at a time", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(3)).toBe(1);
    expect(pageCount(4)).toBe(2);
    expect(clampPage(9, 7)).toBe(2);
    expect(clampPage(-1, 7)).toBe(0);
    expect(clampPage(Number.NaN, 7)).toBe(0);
    expect(pageOf(0)).toBe(0);
    expect(pageOf(5)).toBe(1);
    expect(pageSlice([1, 2, 3, 4, 5, 6, 7], 2)).toEqual([7]);
    expect(pageSlice([1, 2, 3, 4], 8)).toEqual([4]);
    expect(pageSlice([], 0)).toEqual([]);
  });
});

describe("nav state", () => {
  it("round-trips through the query string", () => {
    expect(navQuery(DEFAULT_NAV)).toBe("");
    const n = { tab: "formation" as const, at: ["0", "1"], page: 2, open: "0.1.4", flip: true };
    const q = navQuery(n);
    expect(parseNav(new URLSearchParams(q.slice(1)))).toEqual(n);
    const c = { tab: "concept" as const, at: ["read:y cross/odd"], page: 0, flip: false };
    expect(parseNav(new URLSearchParams(navQuery(c).slice(1)))).toEqual({ ...c, open: undefined });
  });

  it("ignores junk", () => {
    expect(parseNav(new URLSearchParams("tab=nope&pg=-3&at="))).toEqual({ ...DEFAULT_NAV, open: undefined });
    expect(parseNav(new URLSearchParams("tab=recent&pg=abc")).page).toBe(0);
  });
});

describe("levels", () => {
  const book = callBook(spec("studio-test.json"));
  const ctx = ctxFor(book);

  it("drills formation → set → plays and truncates invalid paths", () => {
    const root = resolveLevel(ctx, "formation", []);
    expect(root.kind).toBe("formations");
    expect(root.playCount).toBe(19);
    const sets = resolveLevel(ctx, "formation", ["0"]);
    expect(sets.kind).toBe("sets");
    expect(sets.crumbs.map((c) => c.label)).toEqual(["Formations", "Shotgun"]);
    const plays = resolveLevel(ctx, "formation", ["0", "0"]);
    expect(plays.kind).toBe("plays");
    expect(plays.title).toBe("Y Trips Wk");
    expect(plays.kind === "plays" && plays.items).toHaveLength(17);
    expect(plays.crumbs.map((c) => c.label)).toEqual(["Formations", "Shotgun", "Y Trips Wk"]);
    expect(resolveLevel(ctx, "formation", ["0", "9"]).at).toEqual(["0"]);
    expect(resolveLevel(ctx, "formation", ["42"]).at).toEqual([]);
    // template sections stay closed until the template save is read…
    expect(resolveLevel(ctx, "formation", ["2"]).kind).toBe("formations");
    // …then open like any formation
    const tctx = ctxFor(callBookWithTemplate(spec("studio-test.json")));
    const gl = resolveLevel(tctx, "formation", ["1"]);
    expect(gl.kind === "sets" && gl.formation.template).toBe(true);
    const glPlays = resolveLevel(tctx, "formation", ["1", "0"]);
    expect(glPlays.kind === "plays" && glPlays.set?.template && glPlays.items.length).toBe(12);
    expect(glPlays.crumbs.map((c) => c.label)).toEqual(["Formations", "Goal Line Offense", "Normal"]);
    expect(parentOf(tctx, "formation", ["1", "0"])).toEqual({ at: ["1"], page: 0 });
  });

  it("backs out to the page holding the child", () => {
    expect(parentOf(ctx, "formation", [])).toBeUndefined();
    expect(parentOf(ctx, "formation", ["0", "1"])).toEqual({ at: ["0"], page: 0 });
    expect(parentOf(ctx, "formation", ["4"])).toEqual({ at: [], page: 1 });
    const g = ctx.types[3];
    expect(parentOf(ctx, "type", [g.id])).toEqual({ at: [], page: 1 });
  });

  it("resolves groups, audibles and lists", () => {
    const types = resolveLevel(ctx, "type", []);
    expect(types.kind).toBe("groups");
    const run = resolveLevel(ctx, "type", ["run"]);
    expect(run.kind).toBe("plays");
    expect(run.title).toBe("RUN");
    expect(resolveLevel(ctx, "type", ["nope"]).kind).toBe("groups");
    const aud = resolveLevel(ctx, "audibles", []);
    expect(aud.kind).toBe("audibles");
    expect(aud.playCount).toBe(4);
    const fav = resolveLevel({ ...ctx, favorites: [book.plays[3]] }, "favorites", []);
    expect(fav.kind === "plays" && fav.items.map((i) => i.id)).toEqual(["0.0.3"]);
  });

  it("builds the pre-snap stepping list", () => {
    const plays = resolveLevel(ctx, "formation", ["0", "1"]);
    const list = presnapList(plays, 0);
    expect(list.map((i) => i.name)).toEqual(["Mesh", "Reverse"]);
    expect(neighbor(list, list[0].id, 1)?.name).toBe("Reverse");
    expect(neighbor(list, list[0].id, -1)?.name).toBe("Reverse");
    expect(neighbor(list.slice(0, 1), list[0].id, 1)).toBeUndefined();
    const aud = resolveLevel(ctx, "audibles", []);
    expect(presnapList(aud, 0).map((i) => i.audible)).toEqual([1, 2, 3, 4]);
    expect(presnapList(aud, 1)).toEqual([]);
    expect(presnapList(resolveLevel(ctx, "formation", []), 0)).toEqual([]);
  });
});

describe("card text", () => {
  const book = callBook(spec("studio-test.json"));

  it("builds the stat chip (audible slot + category, CPU count)", () => {
    expect(cardStat(book.byId.get("0.0.0")!)).toEqual({ audible: 2, audibleLabel: "Run", cpu: "3 CPU" });
    expect(cardStat(book.byId.get("0.0.2")!)).toEqual({ cpu: "2 CPU" });
    expect(cardStat(book.byId.get("0.0.6")!)).toBeUndefined();
    const pa = [...book.byId.values()].find((p) => p.audible === 4)!;
    expect(cardStat(pa)?.audibleLabel).toBe("Play Action");
    const def = { ...pa, play: pa.play && { ...pa.play, side: "defense" as const } };
    expect(cardStat(def)?.audibleLabel).toBe("Audible 4");
  });

  it("orders CPU weights by situation and keeps unknown keys last", () => {
    const rows = cpuRows({ "3rdAndShort": 30, Bogus: 5, FirstDown: 40, "2ndAndShort": 50, Bad: "x" });
    expect(rows.map((r) => r.key)).toEqual(["FirstDown", "2ndAndShort", "3rdAndShort", "Bogus"]);
    expect(rows[0].label).toBe("1st Down");
    expect(rows[3].known).toBe(false);
    expect(cpuRows(undefined)).toEqual([]);
    expect(cpuRows([1, 2])).toEqual([]);
  });
});

describe("audible diamond", () => {
  it("places slots by their face button, falling back to free spots", () => {
    expect(diamondPositions({ 1: "X", 2: "A", 3: "Y", 4: "B" })).toEqual({ 1: "left", 2: "bottom", 3: "top", 4: "right" });
    expect(diamondPositions({ 1: "Y", 2: "Y", 3: "RB", 4: "A" })).toEqual({ 1: "top", 2: "left", 3: "right", 4: "bottom" });
  });
});
