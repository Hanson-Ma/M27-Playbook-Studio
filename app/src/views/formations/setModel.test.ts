import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadLibraryData } from "../../model/libFixture";
import { buildLibraryIndex } from "../../model/library";
import { alignmentIssues, effectiveNormal, flippedAlignment, normalOf, NORMAL } from "../../model/sets";
import type { SetsFile } from "../../model/types";
import {
  checkGroups,
  clonableLibraryPlays,
  cloneKey,
  cloneWarnings,
  customSetPath,
  findCustomFormation,
  formationPathOf,
  playSetLabel,
  presetOverride,
  presetTarget,
  refersToFormation,
  slotDependencies,
} from "./setModel";

const lib = buildLibraryIndex(loadLibraryData());
const ROOT = "football/Gameplay/playbooks/PlayLibrary/Formations/Offense/";
const Y_TRIPS = `${ROOT}Shotgun/Y_Trips_Wk/Y_Trips_Wk`;
const base = lib.setByAsset.get(Y_TRIPS)!;
const sample = JSON.parse(readFileSync(new URL("../../../../playbooks/sets/pbs-sets-v1.json", import.meta.url), "utf8")) as SetsFile;
const [tight, open] = sample.sets;

describe("formation references and asset paths", () => {
  it("builds set / clone paths like SetBuilder for both sample sets", () => {
    expect(customSetPath(tight, sample.formations)).toBe(`${ROOT}Shotgun/PBS_Y_Trips_Tight_Wk/PBS_Y_Trips_Tight_Wk`);
    expect(customSetPath(open, sample.formations)).toBe(`${ROOT}PBS_Gun/PBS_Trips_Open/PBS_Trips_Open`);
    expect(cloneKey(tight, "PBS_T_Curls", sample.formations)).toBe(`${ROOT}Shotgun/PBS_Y_Trips_Tight_Wk/PBS_T_Curls`);
    expect(cloneKey({ ...tight, asset: "bad name" }, "X", sample.formations)).toBeUndefined();
  });

  it("finds custom formations by full path and by the bare leaf v1 wrote", () => {
    const gun = sample.formations![0];
    expect(refersToFormation(open.formation, gun)).toBe(true);
    expect(refersToFormation("PBS_Gun", gun)).toBe(true);
    expect(refersToFormation(tight.formation, gun)).toBe(false);
    expect(findCustomFormation(sample.formations, "PBS_Gun")?.index).toBe(0);
    expect(findCustomFormation(sample.formations, tight.formation)).toBeUndefined();
    expect(formationPathOf({ formation: "PBS_Gun" }, sample.formations)).toBe(`${ROOT}PBS_Gun/PBS_Gun`);
    expect(formationPathOf(tight, sample.formations)).toBe(tight.formation);
    // A legacy leaf still yields the right set path.
    expect(customSetPath({ ...open, formation: "PBS_Gun" }, sample.formations)).toBe(`${ROOT}PBS_Gun/PBS_Trips_Open/PBS_Trips_Open`);
  });
});

describe("motion presets", () => {
  it("reads the base targets and the spec's overrides", () => {
    expect(presetTarget(base, "M4left", 4)).toMatchObject({ x: -10.4, y: -2.2 });
    expect(presetTarget(base, "M4left", 3)).toBeUndefined();
    expect(presetTarget(base, NORMAL, 4)).toBeUndefined();
    expect(presetTarget(base, "M9left", 4)).toBeUndefined();
    expect(presetOverride(tight, "M4left", 4)).toEqual({ slot: 4, x: -8, y: -2.2 });
    expect(presetOverride(tight, "M1left", 1)).toBeUndefined();
  });
});

describe("checks strip", () => {
  it("is all green for both sample sets (normal and flipped)", () => {
    for (const spec of sample.sets) {
      const normal = effectiveNormal(base, spec);
      expect(checkGroups(normal, alignmentIssues(normal, base)).filter((c) => c.level !== "ok")).toEqual([]);
      const flipped = flippedAlignment(normal);
      const flippedBase = { ...base, movements: { [NORMAL]: flippedAlignment(normalOf(base)) } };
      expect(checkGroups(flipped, alignmentIssues(flipped, flippedBase)).filter((c) => c.level !== "ok")).toEqual([]);
    }
  });

  it("turns the line count into an error and OL / QB depth into warnings", () => {
    const off = effectiveNormal(base, { positions: [{ slot: 3, y: -2.2 }] });
    const groups = checkGroups(off, alignmentIssues(off, base));
    expect(groups.find((c) => c.id === "line")).toMatchObject({ level: "error", label: "6 on the line" });
    const qb = effectiveNormal(base, { positions: [{ slot: 0, y: -1.4 }] });
    const g2 = checkGroups(qb, alignmentIssues(qb, base));
    expect(g2.find((c) => c.id === "depth")?.level).toBe("warning");
    expect(g2.find((c) => c.id === "line")?.level).toBe("ok"); // the QB never counts
    const ol = effectiveNormal(base, { positions: [{ slot: 6, x: -4 }] });
    expect(checkGroups(ol, alignmentIssues(ol, base)).find((c) => c.id === "ol")?.level).toBe("warning");
    // Shared flip partners show up under "Spacing".
    const shared = effectiveNormal(base, { positions: [{ slot: 3, flipAssign: 2 }] });
    expect(checkGroups(shared, alignmentIssues(shared, base)).find((c) => c.id === "spacing")?.level).not.toBe("ok");
  });
});

describe("clone warnings", () => {
  it("flags alignment-dependent assignments of moved players only", () => {
    const normal = effectiveNormal(base, tight);
    const curls = lib.playByAsset.get(`${ROOT}Shotgun/Y_Trips_Wk/Curls`)!;
    expect(cloneWarnings(lib, curls, normal)).toEqual([]);
    // Receivers' blocks follow them (moving receivers is safe): Inside Zone with SL1 / WR2 moved has no warnings.
    const izPlay = lib.playByAsset.get(`${ROOT}Shotgun/Y_Trips_Wk/Inside_Zone`)!;
    expect(cloneWarnings(lib, izPlay, normal)).toEqual([]);
    const moved = effectiveNormal(base, { positions: [{ slot: 1, x: 2.9 }] });
    const iz = lib.playByAsset.get(`${ROOT}Shotgun/Y_Trips_Wk/Inside_Zone`)!;
    expect(cloneWarnings(lib, iz, moved).some((w) => w.slot === 1 && (w.kind === "mechanics" || w.kind === "handoff"))).toBe(true);
  });

  it("compares a play from another set against its own set (personnel + spots)", () => {
    const normal = effectiveNormal(base, {});
    const other = lib.data.plays.find((p) => p.set.includes("/Offense/Singleback/") && /Run/.test(p.offensePlayType))!;
    const w = cloneWarnings(lib, other, normal);
    expect(w.length).toBeGreaterThan(0);
    expect(w.some((x) => x.kind === "personnel" || x.kind === "mechanics" || x.kind === "handoff" || x.kind === "block")).toBe(true);
  });

  it("explains pulls and fixed starting spots in plain words", () => {
    expect(slotDependencies([{ type: "InitialAnim", anim: "MOVETYPE_POWER_PULL" }]).map((d) => d.kind)).toEqual(["pull"]);
    expect(slotDependencies([{ type: "OverrideFormPos", offsetX: 3, offsetY: -1 }])[0].reason).toMatch(/fixed starting spot/);
    expect(slotDependencies([{ type: "RunRoute", distance: 5, direction: 90, speed: 100 }])).toEqual([]);
  });

  it("lists offense plays of real formations as clone sources", () => {
    const all = clonableLibraryPlays(lib);
    expect(all.length).toBeGreaterThan(5000);
    expect(all.some((p) => p.set === Y_TRIPS)).toBe(true);
    expect(all.every((p) => !/\/(MG_|ST_|NST_)/.test(p.set))).toBe(true);
    expect(playSetLabel(lib, { set: Y_TRIPS })).toBe("Shotgun · Y Trips Wk");
  });
});
