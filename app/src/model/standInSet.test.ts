import { describe, expect, it } from "vitest";
import { buildCatalog } from "./catalog";
import { loadLibraryData, loadPlaysDoc, studioV1 } from "./libFixture";
import { buildLibraryIndex } from "./library";
import { validateSetsFile } from "./sets";
import { standInSet, standInSetsFile } from "./standInSet";
import type { PlaysFile, SetsFile } from "./types";

const OFF = "football/Gameplay/playbooks/PlayLibrary/Formations/Offense/";
const Y_TRIPS = OFF + "Shotgun/Y_Trips_Wk/Y_Trips_Wk";
const lib = buildLibraryIndex(loadLibraryData());
const plays = loadPlaysDoc("pbs-ytrips-v1.json");
const catalog = buildCatalog(lib, [{ path: plays.path, data: plays.data as PlaysFile }]);
const book = { path: "playbooks/studio.json", data: studioV1() };
const set = lib.setByAsset.get(Y_TRIPS)!;
const docs = { playbooks: [book], plays: [plays], sets: [] };

describe("Edit Set on a library set (stand-in custom set)", () => {
  const plan = standInSet(set, catalog, docs, { prefix: "PBS_", first: book.path });

  it("keeps the library set's name and formation, with the library set as its base", () => {
    expect(plan.spec).toMatchObject({ name: set.name, base: Y_TRIPS, formation: set.formation });
    expect(plan.spec.asset).toMatch(/^PBS_/);
    expect(plan.books).toEqual([book.path]);
  });

  it("clones every play the playbook lists there; edited copies carry their changes onto their base", () => {
    const names = plan.spec.plays!.map((c) => c.name);
    // 6 edited copies (PBS …) + 6 library plays, in playbook order; the five PBS Art plays don't resolve (no such plays).
    expect(names).toEqual([
      "PBS GT Counter",
      "PBS PA Yankee",
      "PBS Snag",
      "PBS Bubble Go",
      "PBS Reverse QB Lead",
      "PBS Mtn Drive",
      "Inside Zone",
      "Mtn Mesh",
      "Spacing Snag",
      "Mtn PA Smash Scissors",
      "Four Verticals",
      "Slants",
    ]);
    expect(plan.edited).toBe(6);
    expect(plan.missing).toEqual(["PBS Art A", "PBS Art B", "PBS Art C", "PBS Art D", "PBS Art E"]);
    const snag = plan.spec.plays!.find((c) => c.name === "PBS Snag")!;
    const src = (plays.data as PlaysFile).plays.find((p) => p.name === "PBS Snag")!;
    expect(snag.from).toBe(src.base);
    expect(snag.players).toEqual(src.players);
    expect(snag.reads).toEqual(src.reads);
    expect(snag).not.toHaveProperty("base");
    const slants = plan.spec.plays!.find((c) => c.name === "Slants")!;
    expect(slants.from).toBe(OFF + "Shotgun/Y_Trips_Wk/Slants");
    expect(Object.keys(slants)).toEqual(["from", "name", "asset"]);
    expect(new Set(plan.spec.plays!.map((c) => c.asset.toLowerCase())).size).toBe(12);
  });

  it("takes over the playbook's set and plays once saved, and validates clean", () => {
    const file: SetsFile = { sets: [plan.spec] };
    const path = standInSetsFile("STUDIO");
    expect(path).toBe("playbooks/sets/studio-sets.json");
    const after = buildCatalog(lib, [{ path: plays.path, data: plays.data as PlaysFile }], [{ path, data: file }]);
    const shotgun = after.lib.formationByName("Shotgun", "offense")!;
    const resolved = after.lib.setByName(shotgun, "Y Trips Wk")!;
    expect(after.lib.isCustomSet(resolved.asset)).toBe(true);
    for (const c of plan.spec.plays!) expect(after.playInSetByName(resolved.asset, c.name)?.clone).toBeTruthy();
    const issues = validateSetsFile(file, lib, { file: path });
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    expect(issues.some((i) => i.rule === "set-stands-in")).toBe(true);
  });

  it("only copies library sets", () => {
    const after = buildCatalog(lib, [], [{ path: "playbooks/sets/x.json", data: { sets: [plan.spec] } }]);
    const custom = after.lib.setByName(after.lib.formationByName("Shotgun", "offense")!, "Y Trips Wk")!;
    expect(() => standInSet(custom, after, docs, { prefix: "PBS_" })).toThrow();
  });
});
