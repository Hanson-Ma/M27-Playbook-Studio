import { afterEach, describe, expect, it } from "vitest";
import type { Catalog } from "../../model/catalog";
import type { SetsFile } from "../../model/types";
import { useWorkspace } from "../../state/workspace";
import { candidateKey, cloneIntoSets } from "./stockPlays";

const FILE = "playbooks/sets/test-sets.json";
const FORMATION = "football/Gameplay/playbooks/PlayLibrary/Formations/Offense/Shotgun/Shotgun";
const SET = "football/Gameplay/playbooks/PlayLibrary/Formations/Offense/Shotgun/FUS_Bunch_TE/FUS_Bunch_TE";
const STOCK = "football/Gameplay/playbooks/PlayLibrary/Formations/Offense/Shotgun/Bunch_TE/Crosser_PoCo";

const catalog = {
  customOrigin: new Map([[SET, { kind: "set", file: FILE, index: 0 }]]),
  get: (k: string) => (k === STOCK ? { asset: STOCK, name: "Crosser PoCo" } : undefined),
} as unknown as Catalog;

const setsDoc = (): SetsFile => ({ sets: [{ name: "Bunch TE", asset: "FUS_Bunch_TE", base: "x", formation: FORMATION, plays: [] }] });
const plays = () => (useWorkspace.getState().docs[FILE]?.data as SetsFile).sets[0].plays ?? [];

afterEach(() => useWorkspace.setState({ docs: {} }));

describe("cloneIntoSets", () => {
  it("copies a stock play once, even when asked twice", () => {
    useWorkspace.getState().create(FILE, "sets", setsDoc());
    const first = cloneIntoSets(catalog, [candidateKey(SET, STOCK)], "PBS_");
    const second = cloneIntoSets(catalog, [candidateKey(SET, STOCK)], "PBS_");
    expect(plays()).toHaveLength(1);
    expect(plays()[0]).toMatchObject({ from: STOCK, name: "Crosser PoCo", asset: "PBS_BT_Crosser_PoCo", kept: true });
    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
  });
});
