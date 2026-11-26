import { describe, expect, it } from "vitest";
import { catalogOverlay } from "./catalog";
import { followFormationRename, followSetMove, formationRenames, rebaseClones, rebasePlays, setFolder, setMoves } from "./followSets";
import { loadLibraryData } from "./libFixture";
import { buildLibraryIndex } from "./library";
import { newCustomSet } from "./sets";
import type { PlaybookSpec, PlaysFile, SetsFile } from "./types";

const OFF = "football/Gameplay/playbooks/PlayLibrary/Formations/Offense/";
const SHOTGUN = OFF + "Shotgun/Shotgun";
const stock = buildLibraryIndex(loadLibraryData());
const bunchOpen = stock.setByAsset.get(OFF + "Shotgun/Bunch_Open_TE/Bunch_Open_TE")!;
const singleback = stock.data.formations.find((f) => f.asset === OFF + "Singleback/Singleback")!;

/** The Edit Set copy: same name as the game's set, in Shotgun. */
const before: SetsFile = { sets: [{ ...newCustomSet(bunchOpen, { name: bunchOpen.name, asset: "PBS_Bunch_Open_TE" }), plays: [] }] };
const libOf = (file: SetsFile) => catalogOverlay(stock, [{ path: "playbooks/sets/a.json", data: file }]).lib;
const book = (): PlaybookSpec => ({
  name: "TEST",
  side: "offense",
  formations: [
    { formation: "Shotgun", sets: [{ set: bunchOpen.name, plays: [{ play: "RPO Alert WR Screen" }] }, { set: "Bunch", plays: [] }] },
    { formation: "Singleback", sets: [{ set: "Ace", plays: [] }] },
  ],
});
const edited = (patch: Record<string, unknown>): SetsFile => ({ sets: [{ ...before.sets[0], ...patch }] });

describe("playbooks follow custom set edits", () => {
  it("renames the playbook entry when the set is renamed", () => {
    const after = edited({ name: "Bunch Open Mine" });
    const [move] = setMoves(before, after);
    expect(move).toMatchObject({ asset: "PBS_Bunch_Open_TE", from: { name: bunchOpen.name }, to: { name: "Bunch Open Mine", formation: SHOTGUN } });
    const b = book();
    expect(followSetMove(b, move, libOf(before), libOf(after), "Shotgun")).toBe(1);
    expect(b.formations[0].sets).toEqual([{ set: "Bunch Open Mine", plays: [{ play: "RPO Alert WR Screen" }] }, { set: "Bunch", plays: [] }]);
    // The renamed entry resolves to the custom set now.
    const lib = libOf(after);
    expect(lib.isCustomSet(lib.setByName(lib.formationByName("Shotgun", "offense")!, "Bunch Open Mine")!.asset)).toBe(true);
  });

  it("moves the entry to the set's new formation (existing entry), keeping its plays", () => {
    const after = edited({ formation: singleback.asset, name: "Bunch Open Mine" });
    const [move] = setMoves(before, after);
    const b = book();
    expect(followSetMove(b, move, libOf(before), libOf(after), singleback.name)).toBe(1);
    expect(b.formations.map((f) => f.formation)).toEqual(["Shotgun", "Singleback"]);
    expect(b.formations[0].sets).toEqual([{ set: "Bunch", plays: [] }]);
    expect(b.formations[1].sets).toEqual([{ set: "Ace", plays: [] }, { set: "Bunch Open Mine", plays: [{ play: "RPO Alert WR Screen" }] }]);
  });

  it("adds the new formation right after the old one, and drops a formation left empty", () => {
    const after = edited({ formation: singleback.asset });
    const [move] = setMoves(before, after);
    const b: PlaybookSpec = { name: "T", side: "offense", formations: [{ formation: "Shotgun", sets: [{ set: bunchOpen.name, plays: [] }] }, { formation: "Pistol", sets: [] }] };
    followSetMove(b, move, libOf(before), libOf(after), singleback.name);
    expect(b.formations).toEqual([
      { formation: singleback.name, sets: [{ set: bunchOpen.name, plays: [] }] },
      { formation: "Pistol", sets: [] },
    ]);
  });

  it("renames formation entries for a renamed custom formation", () => {
    const prev: SetsFile = { formations: [{ name: "Gun PBS", asset: "PBS_Gun", base: SHOTGUN }], sets: [] };
    const next: SetsFile = { formations: [{ name: "Gun Mine", asset: "PBS_Gun", base: SHOTGUN }], sets: [] };
    const [r] = formationRenames(prev, next);
    expect(r).toMatchObject({ from: "Gun PBS", to: "Gun Mine" });
    const b: PlaybookSpec = { name: "T", side: "offense", formations: [{ formation: "Gun PBS", sets: [] }, { formation: "Shotgun", sets: [] }] };
    expect(followFormationRename(b, r, libOf(prev))).toBe(1);
    expect(b.formations.map((f) => f.formation)).toEqual(["Gun Mine", "Shotgun"]);
  });

  it("repoints plays based on the set's clones when it changes formation", () => {
    const from = setFolder(SHOTGUN, "PBS_Bunch_Open_TE");
    const to = setFolder(singleback.asset, "PBS_Bunch_Open_TE");
    const plays: PlaysFile = { plays: [{ name: "Mine", asset: "Mine", base: from + "PBS_BOT_RPO" }, { name: "Other", asset: "Other", base: OFF + "Shotgun/Bunch/Mesh" }] };
    expect(rebasePlays(plays, from, to)).toBe(1);
    expect(plays.plays[0].base).toBe(to + "PBS_BOT_RPO");
    expect(plays.plays[1].base).toBe(OFF + "Shotgun/Bunch/Mesh");
    const sets: SetsFile = { sets: [{ ...before.sets[0], asset: "X", plays: [{ from: from + "PBS_BOT_RPO", name: "A", asset: "A" }] }] };
    expect(rebaseClones(sets, from, to)).toBe(1);
    expect(sets.sets[0].plays![0].from).toBe(to + "PBS_BOT_RPO");
  });

  it("tells apart sets that share an asset in different formations (FUSION's FUS_Bunch_TE)", () => {
    const te = stock.setByAsset.get(OFF + "Singleback/Bunch_TE/Bunch_TE") ?? bunchOpen;
    const a = { ...newCustomSet(te, { name: "Bunch TE", asset: "FUS_Bunch_TE", formation: singleback.asset }) };
    const b = { ...newCustomSet(te, { name: "Bunch TE", asset: "FUS_Bunch_TE", formation: SHOTGUN }) };
    const prev: SetsFile = { sets: [a, b, before.sets[0]] };
    // Only the third set changes (new name); nothing moves between Singleback and Shotgun.
    const next: SetsFile = { sets: [a, b, { ...before.sets[0], name: "Open Far TE" }] };
    expect(setMoves(prev, next)).toEqual([{ asset: "PBS_Bunch_Open_TE", from: { formation: SHOTGUN, name: bunchOpen.name }, to: { formation: SHOTGUN, name: "Open Far TE" } }]);
    // Renaming the Shotgun one pairs it with the Shotgun one.
    const renamed: SetsFile = { sets: [a, { ...b, name: "Bunch TE Gun" }, before.sets[0]] };
    expect(setMoves(prev, renamed)).toEqual([{ asset: "FUS_Bunch_TE", from: { formation: SHOTGUN, name: "Bunch TE" }, to: { formation: SHOTGUN, name: "Bunch TE Gun" } }]);
    // A set added or removed with that asset: unknown pairing, no follow-up.
    expect(setMoves(prev, { sets: [b, before.sets[0]] })).toEqual([]);
  });

  it("sees no change when only the positions changed", () => {
    expect(setMoves(before, edited({ positions: [{ slot: 3, x: 5 }] }))).toEqual([]);
  });
});

describe("depth chart spots in a custom set", () => {
  const al = (list: [string, number][]) => list.map(([pos, depth]) => ({ pos, depth }) as unknown as import("./types").AlignmentPos);
  // QB, TE2 (a receiver turned tight end), TE1, WR1.
  const normal = al([["POSITION_QB", 1], ["POSITION_TE", 2], ["POSITION_TE", 1], ["POSITION_WR", 1]]);

  it("offers a spot per player at that position plus one more backup", async () => {
    const { depthChoices } = await import("./sets");
    expect(depthChoices(normal, 1)).toEqual([1, 2, 3]);
    expect(depthChoices(normal, 3)).toEqual([1, 2]);
  });

  it("swaps with the player who had the spot", async () => {
    const { depthSwap } = await import("./sets");
    expect(depthSwap(normal, 1, 1)).toEqual([
      [1, { pos: "POSITION_TE", depth: 1 }],
      [2, { pos: "POSITION_TE", depth: 2 }],
    ]);
    expect(depthSwap(normal, 1, 3)).toEqual([[1, { pos: "POSITION_TE", depth: 3 }]]);
    expect(depthSwap(normal, 1, 2)).toEqual([]);
  });
});
