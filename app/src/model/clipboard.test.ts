import { readFileSync } from "node:fs";
import { produce } from "immer";
import { beforeEach, describe, expect, it } from "vitest";
import { buildCatalog } from "./catalog";
import { CLIPBOARD_LIMIT, clipLabel, clipboardStore, pasteInto, pasteSummary, type PasteResult } from "./clipboard";
import { parseJson } from "./json";
import { loadLibraryData, loadPlaysDoc } from "./libFixture";
import { buildLibraryIndex } from "./library";
import { playbookIssues } from "./resolveBook";
import type { FormationEntry, PlayEntry, PlaybookSpec, SetEntry } from "./types";

const lib = buildLibraryIndex(loadLibraryData());
const cat = buildCatalog(lib, [loadPlaysDoc("art-test.json"), loadPlaysDoc("pbs-ytrips-v1.json")]);
const book = (name: string): PlaybookSpec =>
  parseJson<PlaybookSpec>(readFileSync(new URL(`../../../playbooks/${name}`, import.meta.url), "utf8"));
const sets = (spec: PlaybookSpec, f = 0) => spec.formations[f].sets as SetEntry[];
const names = (se: SetEntry) => se.plays.map((p) => p.play);

function paste(spec: PlaybookSpec, kind: "formation" | "set" | "plays", entries: unknown[], target?: { f: number; s?: number; p?: number }) {
  let r: PasteResult | undefined;
  const next = produce(spec, (d) => {
    r = pasteInto(d, cat, { kind, entries: entries as PlayEntry[] }, target);
  });
  return { next, r: r! };
}

describe("clipboard store", () => {
  beforeEach(() => clipboardStore.getState().clear());

  it("keeps deep clones, newest first, up to the limit", () => {
    const entry: PlayEntry = { play: "Mesh", cpu: { FirstDown: 10 } };
    const item = clipboardStore.getState().push({ kind: "plays", sourcePath: "playbooks/a.json", label: "Mesh", entries: [entry] });
    entry.cpu!.FirstDown = 99;
    expect((clipboardStore.getState().items[0].entries[0] as PlayEntry).cpu).toEqual({ FirstDown: 10 });
    expect(item.id).toMatch(/^clip-/);
    for (let i = 0; i < CLIPBOARD_LIMIT + 3; i++)
      clipboardStore.getState().push({ kind: "plays", sourcePath: "x", label: String(i), entries: [] });
    expect(clipboardStore.getState().items.length).toBe(CLIPBOARD_LIMIT);
    expect(clipboardStore.getState().items[0].label).toBe(String(CLIPBOARD_LIMIT + 2));
    clipboardStore.getState().remove(clipboardStore.getState().items[0].id);
    expect(clipboardStore.getState().items.length).toBe(CLIPBOARD_LIMIT - 1);
  });

  it("holds a CPU weights clip", () => {
    clipboardStore.getState().setWeights({ cpu: { FirstDown: 30 }, from: "Mesh" });
    expect(clipboardStore.getState().weights).toEqual({ cpu: { FirstDown: 30 }, from: "Mesh" });
    clipboardStore.getState().clear();
    expect(clipboardStore.getState().weights).toBeUndefined();
  });

  it("labels items", () => {
    expect(clipLabel("plays", [{ play: "Mesh" }])).toBe("Mesh");
    expect(clipLabel("plays", [{ play: "Mesh" }, { play: "Drive" }])).toBe("2 plays");
    expect(clipLabel("set", [{ set: "Bunch", plays: [] }, { set: "Trips", plays: [] }])).toBe("Bunch + 1");
  });
});

describe("paste plays", () => {
  it("pastes plays that resolve in the target set, after the selected play", () => {
    const { next, r } = paste(book("studio-lib.json"), "plays", [{ play: "Curls", cpu: { FirstDown: 5 }, z: 1 }, { play: "Not A Play" }], { f: 0, s: 0, p: 1 });
    expect(r.added).toEqual([{ f: 0, s: 0, p: 2 }]);
    expect(r.skipped).toEqual([{ label: "NOT A PLAY", reason: "not a play in Y TRIPS WK" }]);
    expect(sets(next)[0].plays[2]).toEqual({ play: "Curls", cpu: { FirstDown: 5 }, z: 1 });
  });

  it("skips plays already in the set and drops used audible slots", () => {
    const { next, r } = paste(book("studio-lib.json"), "plays", [{ play: "Slants", audible: 1 }, { play: "Curls", audible: 1 }, { play: "Stick", audible: 2 }], { f: 0, s: 0 });
    expect(r.skipped).toEqual([{ label: "SLANTS", reason: "already in Y TRIPS WK" }]);
    expect(r.droppedAudibles).toEqual(["CURLS (audible 1)", "STICK (audible 2)"]);
    expect(names(sets(next)[0]).slice(-2)).toEqual(["Curls", "Stick"]);
    expect(playbookIssues(next, cat).filter((i) => i.level === "error")).toEqual([]);
  });

  it("resolves by name in the target set (a same-named play of another set)", () => {
    // "Mesh" exists in Gun Bunch and Gun Y Trips Wk is "Mtn Mesh"; "Slants" exists in both Y Trips Wk and Bunch?
    const bunchPlays = cat.playsInSet(lib.setByName(lib.formationByName("Shotgun", "offense")!, "Bunch")!.asset).map((p) => p.name);
    const { r } = paste(book("studio-lib.json"), "plays", [{ play: "Slants" }, { play: "Spacing Snag" }], { f: 0, s: 1 });
    const expected = ["Slants", "Spacing Snag"].filter((n) => bunchPlays.includes(n));
    expect(r.added.length).toBe(expected.length);
    expect(r.skipped.length).toBe(2 - expected.length);
  });

  it("needs a set target", () => {
    expect(paste(book("studio-lib.json"), "plays", [{ play: "Curls" }], { f: 0 }).r.error).toMatch(/Select a set/);
    expect(paste(book("studio-lib.json"), "plays", [{ play: "Curls" }]).r.error).toMatch(/Select a set/);
  });
});

describe("paste sets", () => {
  it("adds sets that resolve in the formation and merges into an existing one", () => {
    const entries: SetEntry[] = [
      { set: "Trips TE", plays: [{ play: "Four Verticals" }], k: 1 },
      { set: "Y Trips Wk", plays: [{ play: "Curls" }, { play: "Slants" }] },
      { set: "Pro", plays: [] },
    ];
    const { next, r } = paste(book("studio-lib.json"), "set", entries, { f: 0, s: 0 });
    expect(r.skipped).toEqual([
      { label: "SLANTS", reason: "already in Y TRIPS WK" },
      { label: "PRO", reason: "not a set of SHOTGUN" },
    ]);
    expect(r.added[0]).toEqual({ f: 0, s: 1 });
    expect(sets(next)[1]).toEqual({ set: "Trips TE", plays: [{ play: "Four Verticals" }], k: 1 });
    // merged: Curls added to the existing Y Trips Wk, Slants skipped as already there
    expect(names(sets(next)[0])).toContain("Curls");
    expect(r.merged).toEqual(["Y TRIPS WK (+1 plays)"]);
  });

  it("refuses template sections", () => {
    const { r } = paste(book("studio-lib.json"), "set", [{ set: "Goal Line", plays: [] }], { f: 1 });
    expect(r.error).toMatch(/template/);
  });
});

describe("paste formations", () => {
  it("inserts new formations after the selection and merges existing ones", () => {
    const entries: FormationEntry[] = [
      { formation: "Pistol", sets: [{ set: "Ace", plays: [] }], c: 3 },
      { formation: "Shotgun", sets: [{ set: "Bunch", plays: [{ play: "Mesh" }, { play: "Snag" }] }] },
      { formation: "4-3", sets: [] },
    ];
    const { next, r } = paste(book("studio-lib.json"), "formation", entries, { f: 0 });
    expect(next.formations.map((f) => f.formation)).toEqual(["Shotgun", "Pistol", "Goal Line Offense", "Special", "Kickoff", "Safety Kickoff"]);
    expect(next.formations[1].c).toBe(3);
    expect(r.added[0]).toEqual({ f: 1 });
    expect(r.skipped.map((s) => s.label)).toContain("MESH"); // already in Bunch
    expect(r.skipped.some((s) => /4-3/.test(s.label) || /defense/.test(s.reason) || /unknown/.test(s.reason))).toBe(true);
    const summary = pasteSummary(r);
    expect(summary.level).toBe("warning");
    expect(summary.message).toMatch(/Pasted/);
  });

  it("pastes before the template sections when the book root is selected", () => {
    const { next } = paste(book("studio-lib.json"), "formation", [{ formation: "Pistol", sets: [] }], undefined);
    expect(next.formations[1].formation).toBe("Pistol");
  });

  it("pastes an explicit offense Special (the game-side builder resolves formations by side since ac54574)", () => {
    const base = book("studio-lib.json");
    const noSpecial = { ...base, formations: base.formations.filter((f) => f.formation !== "Special") };
    const { next, r } = paste(noSpecial, "formation", [{ formation: "Special", sets: [{ set: "Punt", plays: [{ play: "Punt" }] }] }]);
    expect(r.skipped).toEqual([]);
    expect(r.added).toHaveLength(1);
    expect(next.formations.find((f) => f.formation === "Special")?.sets).toEqual([{ set: "Punt", plays: [{ play: "Punt" }] }]);
  });

  it("summarizes an empty paste", () => {
    const { r } = paste(book("studio-lib.json"), "formation", [{ formation: "Special", sets: "template" }]);
    expect(pasteSummary(r)).toMatchObject({ message: "Nothing Pasted", level: "warning" });
  });
});
