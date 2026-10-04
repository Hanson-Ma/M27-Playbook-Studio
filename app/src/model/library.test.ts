import { describe, expect, it } from "vitest";
import { loadLibraryData } from "./libFixture";
import { buildLibraryIndex, overlayLibraryIndex } from "./library";
import { leaf } from "./names";

const F = "football/Gameplay/playbooks/PlayLibrary/Formations/";
const data = loadLibraryData();

describe("buildLibraryIndex", () => {
  const t0 = performance.now();
  const lib = buildLibraryIndex(data);
  const ms = performance.now() - t0;

  it("builds fast and indexes everything", () => {
    console.info(`library index: ${ms.toFixed(1)} ms for ${data.plays.length} plays`);
    expect(ms).toBeLessThan(300);
    expect(lib.playByAsset.size).toBe(data.plays.length);
    expect(lib.setByAsset.size).toBe(data.sets.length);
    expect(lib.formationByAsset.size).toBe(data.formations.length);
    expect(lib.playsBySet.get(F + "Offense/Shotgun/Y_Trips_Wk/Y_Trips_Wk")).toHaveLength(95);
  });

  it("resolves formation names like pbook-build (prefers the folder named after it)", () => {
    expect(lib.formationByName("Shotgun")?.asset).toBe(F + "Offense/Shotgun/Shotgun");
    expect(lib.formationByName("  shotgun ")?.asset).toBe(F + "Offense/Shotgun/Shotgun");
    expect(lib.formationByName("I Form")?.asset).toBe(F + "Offense/I_Form/I_Form");
    expect(lib.formationByName("Goal_Line_Offense")?.asset).toBe(F + "Offense/Goal_Line_Offense/Goal_Line_Offense");
    expect(lib.formationByName("Nope")).toBeUndefined();
    // Builder rule picks the first "Special" (defense); a side picks the right one.
    expect(lib.formationByName("Special")?.asset).toBe(F + "Defense/Special/Special");
    expect(lib.formationByName("Special", "offense")?.asset).toBe(F + "Offense/Special/Special");
    expect(lib.formationByName("Special", "defense")?.asset).toBe(F + "Defense/Special/Special");
    expect(lib.formationByName("Kickoff", "offense")?.asset).toBe(F + "Kickoff/Kickoff/Kickoff");
  });

  it("mirrors pbook-build formByName: side by formation type, then the template's formIds, then the folder leaf", () => {
    // Defense side ⇔ FormationType_Defense / _KickReturn / _Safety_KickReturn; everything else is offense.
    expect(lib.formationByName("Kickoff", "defense")).toBeUndefined();
    expect(lib.formationByName("Safety Kickoff", "offense")?.asset).toBe(F + "SafetyKickoff/Safety_Kickoff/Safety_Kickoff");
    const kr = data.formations.find((f) => f.type === "FormationType_KickReturn")!;
    expect(lib.formationByName(kr.name, "defense")).toBe(kr);
    expect(lib.formationByName(kr.name, "offense")).toBeUndefined();
    expect(lib.formationByName("Shotgun", "defense")).toBeUndefined();
    // A formation the template save contains wins over the folder-leaf rule.
    const mg = lib.formationByAsset.get(F + "Offense/MG_Screen/MG_Screen")!;
    expect(lib.formationByName("Shotgun", "offense", { preferFormIds: new Set([mg.formId]) })).toBe(mg);
    expect(lib.formationByName("Shotgun", "offense", { preferFormIds: new Set([1]) })?.asset).toBe(F + "Offense/Shotgun/Shotgun");
    expect(lib.formationByName("Shotgun", "offense", { preferFormIds: new Set() })?.asset).toBe(F + "Offense/Shotgun/Shotgun");
    const special = lib.formationByAsset.get(F + "Defense/Special/Special")!;
    expect(lib.formationByName("Special", "offense", { preferFormIds: new Set([special.formId]) })?.asset).toBe(F + "Offense/Special/Special");
    expect(lib.formationByName("Special", undefined, { preferFormIds: new Set([12]) })?.asset).toBe(F + "Offense/Special/Special");
  });

  it("overlays custom formations and sets (stock first, shared plays)", () => {
    const stockShotgun = lib.formationByName("Shotgun", "offense")!;
    const base = lib.setByAsset.get(F + "Offense/Shotgun/Y_Trips_Wk/Y_Trips_Wk")!;
    const gun = { formId: 1367080964, name: "Gun PBS", type: "FormationType_Offense", asset: F + "Offense/PBS_Gun/PBS_Gun" };
    const tight = { ...base, setId: 1818248703, name: "Y Trips Tight Wk", asset: F + "Offense/Shotgun/PBS_Tight/PBS_Tight" };
    const open = { ...base, setId: 1591953037, name: "Trips Open", asset: F + "Offense/PBS_Gun/PBS_Open/PBS_Open", formation: gun.asset };
    const clash = { ...base, name: "Clash", asset: base.asset }; // taken asset: skipped
    const ov = overlayLibraryIndex(lib, { formations: [gun], sets: [tight, open, clash] });

    expect(ov.stock).toBe(lib);
    expect(lib.stock).toBe(lib);
    expect(overlayLibraryIndex(lib, {})).toBe(lib);
    expect(overlayLibraryIndex(ov, {})).toBe(lib);
    expect(ov.playByAsset).toBe(lib.playByAsset);
    expect(ov.playsBySet).toBe(lib.playsBySet);
    expect([...ov.customAssets]).toEqual([gun.asset, tight.asset, open.asset]);
    expect(ov.isCustomFormation(gun.asset) && ov.isCustomSet(open.asset) && ov.isCustom(tight.asset)).toBe(true);
    expect(ov.isCustomSet(gun.asset) || ov.isCustomFormation(open.asset) || ov.isCustom(base.asset) || lib.isCustom(gun.asset)).toBe(false);

    expect(ov.formationByName("Gun PBS", "offense")).toBe(gun);
    expect(ov.formationByName("gun_pbs")).toBe(gun);
    expect(ov.formationByName("Gun PBS", "defense")).toBeUndefined();
    expect(ov.formationByName("Shotgun", "offense")).toBe(stockShotgun);
    expect(ov.setByName(stockShotgun, "Y Trips Tight Wk")).toBe(tight);
    expect(ov.setByName(gun, "Trips Open")).toBe(open);
    expect(ov.setByName(stockShotgun, "Clash")).toBeUndefined();
    expect(ov.setByAsset.get(base.asset)).toBe(base);
    expect(ov.setsByFormation.get(stockShotgun.asset)!.at(-1)).toBe(tight);
    expect(ov.setsByFormation.get(gun.asset)).toEqual([open]);
    expect(ov.formationOfSet(open.asset)).toBe(gun);
    expect(ov.formationOfSet(tight.asset)).toBe(stockShotgun);
    expect(ov.formationSide(gun)).toBe("offense");
    expect(ov.data.formations.at(-1)).toBe(gun);
    expect(ov.data.sets.length).toBe(data.sets.length + 2);
    expect(lib.setByName(stockShotgun, "Y Trips Tight Wk")).toBeUndefined(); // the stock index is untouched
  });

  it("resolves set names inside the formation folder", () => {
    const gun = lib.formationByName("Shotgun")!;
    expect(lib.setByName(gun, "Y Trips Wk")?.asset).toBe(F + "Offense/Shotgun/Y_Trips_Wk/Y_Trips_Wk");
    expect(lib.setByName(gun, "y_trips_wk")?.setId).toBe(212);
    expect(lib.setByName(gun, "Bunch")?.asset).toBe(F + "Offense/Shotgun/Bunch/Bunch");
    expect(lib.setByName(lib.formationByName("Pistol")!, "Y Trips Wk")).toBeUndefined();
  });

  it("lists sets per formation (inside its folder only)", () => {
    const sets = lib.setsByFormation.get(F + "Offense/Shotgun/Shotgun")!;
    expect(sets.some((s) => s.name === "Y Trips Wk")).toBe(true);
    expect(sets.every((s) => s.asset.startsWith(F + "Offense/Shotgun/"))).toBe(true);
    const all = [...lib.setsByFormation.values()].flat();
    expect(all.some((s) => s.asset.includes("/Flag/"))).toBe(false);
    expect(lib.formationOfSet(F + "Offense/Shotgun/Y_Trips_Wk/Y_Trips_Wk")?.name).toBe("Shotgun");
  });

  it("classifies formation sides and minigames", () => {
    const by = (rel: string) => lib.formationByAsset.get(F + rel)!;
    expect(lib.formationSide(by("Offense/Shotgun/Shotgun"))).toBe("offense");
    expect(lib.formationSide(by("Defense/4-3/4-3"))).toBe("defense");
    expect(lib.formationSide(by("Offense/Special/Special"))).toBe("special");
    expect(lib.formationSide(by("Defense/Special/Special"))).toBe("special");
    expect(lib.formationSide(by("Kickoff/Kickoff/Kickoff"))).toBe("special");
    expect(lib.formationSide(by("KickReturn/Kick_Return/Kick_Return"))).toBe("special");

    const minis = [
      "Offense/MG_Screen/MG_Screen",
      "Offense/Combine_Drills/ST_Combine_Drills",
      "Offense/ST_Short_Pass_Concepts_Slants/ST_Short_Pass_Concepts_Slants",
      "Offense/NST_Tutorials/NST_Tutorials",
      "Offense/Pass_Skeleton_Cover0/Passing_Skeleton_Cover0",
      "Offense/Small_Sided/Small_Sided",
      "Offense/Direct_Snaps/Direct_Snaps",
      "Defense/Cov0_PS/Cover0_PS",
      "Defense/MG_DL4on5/4-3_Over_Stunts/MG_DL4on5",
      "Defense/MG_Cover3_Passing_Skeleton/MG_Cover3_Passing_skeleton",
    ];
    for (const m of minis) expect(lib.isMinigame(by(m)), m).toBe(true);
    // Cross-check with the global play sheet: no minigame play is global; real formations mostly are
    // (Flexbone and Wishbone are college-only: real formations whose plays all need the mod).
    const globalCount = (f: (typeof data.formations)[number]) =>
      data.sets
        .filter((s) => s.formation === f.asset)
        .flatMap((s) => lib.playsBySet.get(s.asset) ?? [])
        .filter((p) => p.global).length;
    for (const f of data.formations.filter((f) => lib.isMinigame(f))) expect(globalCount(f), f.asset).toBe(0);
    const real = data.formations.filter((f) => !lib.isMinigame(f));
    const noGlobal = real.filter((f) => globalCount(f) === 0).map((f) => leaf(f.asset));
    expect(noGlobal.sort()).toEqual(["Flexbone", "Wishbone"]);
    expect(real.map((f) => leaf(f.asset))).toEqual(expect.arrayContaining(["Shotgun", "Far", "Near", "Special", "Kickoff"]));
  });

  it("looks up assignments and enums", () => {
    const path = "RunRoute/WR_Run90for30";
    const a = lib.assignment(path)!;
    expect(a).toBeDefined();
    expect(lib.assignment("football/Gameplay/playbooks/PlayLibrary/Assignments/" + path)).toBe(a);
    expect(lib.assignment("RunRoute/Nope")).toBeUndefined();
    expect(lib.assignmentsByRouteType.get("AssignRouteType_RR_Curl_Medium")?.length).toBeGreaterThan(0);
    expect(lib.enumForField("ReceiverCut", "cutType")).toBe("ReceiverCutAngle");
    expect(lib.enumValues("ReceiverCutAngle")).toContain("RECEIVER_CUT_ANGLE_CURL");
    expect(lib.enumValues("NoSuchEnum")).toEqual([]);
  });
});
