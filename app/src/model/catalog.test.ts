import { describe, expect, it } from "vitest";
import { buildCatalog, catalogOverlay, classifyPlayProblem, playProblemLevel, resolveCustomPlay, resolveLibraryPlay } from "./catalog";
import { loadLibraryData, loadPlaybook, loadPlaysDoc, loadSetsDoc } from "./libFixture";
import { buildLibraryIndex } from "./library";
import { ASSIGNMENT_ROOT, BLOCKING_ROOT, type CustomPlaySpec, type PlaysFile, type SetsFile } from "./types";

const SET = "football/Gameplay/playbooks/PlayLibrary/Formations/Offense/Shotgun/Y_Trips_Wk/";
const lib = buildLibraryIndex(loadLibraryData());
const docs = [loadPlaysDoc("art-test.json"), loadPlaysDoc("pbs-ytrips-v1.json")];

describe("buildCatalog with the example plays files", () => {
  const cat = buildCatalog(lib, docs);
  const custom = (name: string) => cat.custom.find((p) => p.name === name)!;

  it("resolves all 11 custom plays without problems", () => {
    expect(cat.custom).toHaveLength(11);
    for (const p of cat.custom) {
      expect(p.problems, p.name).toEqual([]);
      expect(p.source).toBe("custom");
      expect(p.global).toBe(false);
      expect(p.side).toBe("offense");
      expect(p.set).toBe(SET + "Y_Trips_Wk");
      expect(p.formation).toBe("football/Gameplay/playbooks/PlayLibrary/Formations/Offense/Shotgun/Shotgun");
      expect(p.slots).toHaveLength(11);
      for (const s of p.slots) expect(s.steps.at(-1)?.type).toBe("None");
    }
    expect(custom("PBS Snag").key).toBe(SET + "PBS_Snag");
    expect(cat.get(SET + "PBS_Snag")).toBe(custom("PBS Snag"));
  });

  it("keeps base steps with keep", () => {
    const drive = custom("PBS Mtn Drive").slots[4];
    expect(drive.authored).toBe("PBS_Z_Mtn_Dig12");
    expect(drive.steps[0].type).toBe("AutoMotion"); // keep 1 = the base slot's motion
    expect(drive.steps.map((s) => s.type)).toEqual(["AutoMotion", "RunRoute", "ReceiverCut", "RunRoute", "GetOpen", "None"]);
    expect(drive.changed).toBe(true);

    const qb = custom("PBS Reverse QB Lead").slots[0];
    expect(qb.steps.slice(0, 2).map((s) => s.type)).toEqual(["CannedHandoff", "OptionHandoff"]);
    expect(qb.steps.slice(2).map((s) => s.type)).toEqual(["MoveDirection", "LeadBlock", "RunBlock", "None"]);
    expect(qb.mechanics).toBe(true);
    expect(custom("PBS Reverse QB Lead").blocking).toBe(BLOCKING_ROOT + "ReverseBlocking");
  });

  it("resolves string specs and falls back to the base", () => {
    const snag = custom("PBS Snag");
    expect(snag.slots[3].assignment).toBe(ASSIGNMENT_ROOT + "RunRoute/WR_Run90for03_CutR45_Run45for20_Slant90_2");
    expect(snag.slots[3].changed).toBe(true);
    expect(snag.slots[3].routeType).toBe("AssignRouteType_RR_Slant");
    expect(snag.slots[0].changed).toBe(false); // QB keeps the base's drop
    expect(snag.base).toBe(SET + "Curls");
    expect(snag.vip).toBe(4); // from the base
    expect(snag.reads.map((r) => r.pos)).toEqual([5, 2, 3, 1, 4]);
    expect(snag.playType).toBe("OffensePlayType_PassShotgun");

    const counter = custom("PBS GT Counter");
    expect(counter.playType).toBe("OffensePlayType_RunCounter");
    expect(counter.blocking).toBe(BLOCKING_ROOT + "BTCounter");
    expect(counter.slots[1].mechanics).toBe(true); // the HB handoff stays locked

    expect(custom("PBS Art E").vip).toBe(2);
    expect(custom("PBS Art A").reads).toBe(lib.playByAsset.get(SET + "Curls")!.reads);
  });

  it("collects authored assignments (first definition wins)", () => {
    expect(cat.authored.get("PBS_Slot_Corner7")).toMatchObject({ file: "playbooks/plays/pbs-ytrips-v1.json", play: "PBS Snag" });
    expect(cat.authored.get("PBS_Slot_Corner7")?.steps.at(-1)?.type).toBe("None");
    // One entry per distinct `new` name across the files (the user edits art-test.json, so count from the data).
    const names = new Set(
      docs.flatMap((d) => d.data.plays.flatMap((p) => Object.values(p.players ?? {}).flatMap((ps) => (typeof ps === "object" && ps && "new" in ps ? [ps.new] : [])))),
    );
    expect(cat.authored.size).toBe(names.size);
    expect(cat.authored.size).toBeGreaterThanOrEqual(11);
  });

  it("lists plays per set with custom plays after library plays; library names win like tools/pbook-build.mjs", () => {
    const list = cat.playsInSet(SET + "Y_Trips_Wk");
    expect(list).toHaveLength(95 + 11);
    expect(list.slice(0, 95).every((p) => p.source === "library")).toBe(true);
    expect(cat.playsInSet(SET + "Y_Trips_Wk")).toBe(list); // cached
    expect(cat.playInSetByName(SET + "Y_Trips_Wk", "pbs snag")).toBe(custom("PBS Snag"));
    expect(cat.playInSetByName(SET + "Y_Trips_Wk", "Curls")?.source).toBe("library");

    const shadow = buildCatalog(lib, [
      { path: "playbooks/plays/x.json", data: { plays: [{ name: "Curls", asset: "PBS_Curls2", base: SET + "Curls" }] } },
    ]);
    // pbook-build searches plays.tsv before custom-plays.tsv: the stock play is what gets built.
    expect(shadow.playInSetByName(SET + "Y_Trips_Wk", "curls")?.key).toBe(SET + "Curls");
    expect(shadow.custom[0].problems.join()).toMatch(/also a library play .*picks the library play; rename the custom play/);
  });

  it("resolves library plays lazily and shares them across catalog versions", () => {
    const curls = cat.get(SET + "Curls")!;
    expect(curls.source).toBe("library");
    expect(curls.playId).toBe(7663);
    expect(curls.slots[3].assignment).toBe(ASSIGNMENT_ROOT + "RunRoute/WR_CurlRt_Option_New15");
    const again = buildCatalog(lib, docs);
    expect(again.version).toBeGreaterThan(cat.version);
    expect(again.get(SET + "Curls")).toBe(curls);
    expect(cat.get("nope")).toBeUndefined();
  });
});

describe("custom play problems", () => {
  const base = SET + "Curls";
  const one = (spec: Partial<CustomPlaySpec>, extra: PlaysFile["plays"] = []) =>
    buildCatalog(lib, [{ path: "playbooks/plays/t.json", data: { plays: [{ name: "T", asset: "PBS_T", base, ...spec }, ...extra] } }])
      .custom[0].problems.join(" | ");

  it("reports unknown and misplaced bases", () => {
    expect(one({ base: SET + "Nope" })).toMatch(/base play not in the library/);
    expect(one({ set: SET.replace("Y_Trips_Wk/", "Bunch/") + "Bunch" })).toMatch(/another set/);
    const misfiled = lib.data.plays.find((p) => !p.asset.startsWith(p.set.slice(0, p.set.lastIndexOf("/") + 1)))!;
    expect(one({ base: misfiled.asset })).toMatch(/outside its set folder/);
  });

  it("reports bad slots, missing assignments and mechanics drops", () => {
    expect(one({ players: { "11": "RunRoute/WR_Run90for30" } })).toMatch(/slot 11: not a slot/);
    expect(one({ players: { x: "RunRoute/WR_Run90for30" } })).toMatch(/slot x: not a slot/);
    expect(one({ players: { "3": "RunRoute/Nope" } })).toMatch(/slot 3: assignment not found/);
    expect(one({ players: { "3": { new: "PBS_X", template: "RunRoute/Nope", steps: [] } } })).toMatch(/template assignment not found/);
    expect(one({ players: { "3": { new: "PBS_X", keep: 9, steps: [] } } })).toMatch(/keep 9/);
    const counter = SET + "HB_Base";
    expect(one({ base: counter, players: { "1": "RunRoute/WR_Run90for30" } })).toMatch(/slot 1: drops the base play's handoff/);
  });

  it("reports duplicate names and assets in the set", () => {
    const twin = { name: "t", asset: "PBS_T", base };
    expect(one({}, [twin])).toMatch(/asset PBS_T is also used/);
    expect(one({}, [{ ...twin, asset: "PBS_T2" }])).toMatch(/name "T" is also used by another custom play/);
    expect(one({ asset: "Curls" })).toMatch(/already exists in the library/);
    expect(one({ asset: "bad name" })).toMatch(/\[A-Za-z0-9_\]/);
    expect(one({ vip: 14 })).toMatch(/vip 14/);
    expect(one({ runHole: 12 })).toMatch(/runHole 12/);
  });

  it("flags a conflicting redefinition of an authored name", () => {
    const def = (steps: number) => ({ new: "PBS_Shared", steps: [{ type: "RunRoute", distance: steps, direction: 90, speed: 100 }] });
    const cat = buildCatalog(lib, [
      {
        path: "playbooks/plays/t.json",
        data: {
          plays: [
            { name: "A", asset: "PBS_A", base, players: { "3": def(5) } },
            { name: "B", asset: "PBS_B", base, players: { "4": def(5) } },
            { name: "C", asset: "PBS_C", base, players: { "4": def(9) } },
          ],
        },
      },
    ]);
    const [a, b, c] = cat.custom;
    expect(a.problems).toEqual([]);
    expect(b.problems).toEqual([]);
    expect(c.problems.join()).toMatch(/first defined by "A"/);
    expect(c.slots[4].steps[0].distance).toBe(5); // the first definition is what the builder uses
  });

  it("resolveCustomPlay works standalone (designer preview)", () => {
    const rp = resolveCustomPlay(
      lib,
      { name: "Preview", asset: "PBS_Preview", base, players: { "3": { new: "PBS_Prev", steps: [{ type: "GetOpen" }] } } },
      "playbooks/plays/t.json",
      0,
      new Map(),
    );
    expect(rp.problems).toEqual([]);
    expect(rp.slots[3].steps.map((s) => s.type)).toEqual(["GetOpen", "None"]);
  });
});

describe("problem severity (shared by the playbook builder, play-call and export)", () => {
  it("classifies problem texts and rates a play by its worst problem", () => {
    expect(classifyPlayProblem("name is empty")).toEqual({ rule: "play-name", level: "error" });
    expect(classifyPlayProblem('slot 2: "PBS_X" is first defined by "PBS Y" (playbooks/plays/a.json); that definition is used').level).toBe("warning");
    expect(classifyPlayProblem("something new").level).toBe("error");
    expect(playProblemLevel([])).toBeUndefined();
    expect(playProblemLevel(["reads: only the first 3 entries are used (the base play has 3)"])).toBe("warning");
    expect(playProblemLevel(["reads: only the first 3 entries are used (the base play has 3)", "name is empty"])).toBe("error");
  });
});

describe("custom formations, sets and clones (catalog overlay, FORMATS.md §5)", () => {
  const OFF = "football/Gameplay/playbooks/PlayLibrary/Formations/Offense/";
  const TIGHT = OFF + "Shotgun/PBS_Y_Trips_Tight_Wk/";
  const OPEN = OFF + "PBS_Gun/PBS_Trips_Open/";
  const setsDoc = loadSetsDoc("pbs-sets-v1.json");
  const cat = buildCatalog(lib, docs, [setsDoc]);

  it("resolves every entry of playbooks/studio-test.json like pbook-build (incl. Gun PBS / Trips Open / Y Trips Tight Wk)", () => {
    const book = loadPlaybook("studio-test.json");
    let plays = 0;
    for (const fe of book.formations) {
      const f = cat.lib.formationByName(fe.formation, book.side);
      expect(f, fe.formation).toBeDefined();
      if (fe.sets === "template") continue;
      for (const se of fe.sets) {
        const s = cat.lib.setByName(f!, se.set);
        expect(s, `${fe.formation} / ${se.set}`).toBeDefined();
        for (const pe of se.plays) {
          const p = cat.playInSetByName(s!.asset, pe.play);
          expect(p, `${se.set} / ${pe.play}`).toBeDefined();
          expect(p!.problems, pe.play).toEqual([]);
          plays++;
        }
      }
    }
    expect(plays).toBeGreaterThan(20);
    expect(cat.lib.formationByName("Gun PBS", "offense")?.asset).toBe(OFF + "PBS_Gun/PBS_Gun");
    expect(cat.lib.formationByName("Gun PBS", "offense")?.formId).toBe(1367080964);
  });

  it("puts custom formations and sets in catalog.lib like stock ones", () => {
    const gun = cat.lib.formationByName("Shotgun", "offense")!;
    const tight = cat.lib.setByName(gun, "Y Trips Tight Wk")!;
    expect(tight.asset).toBe(TIGHT + "PBS_Y_Trips_Tight_Wk");
    expect(tight.setId).toBe(1818248703);
    expect(cat.lib.formationOfSet(tight.asset)).toBe(gun);
    expect(cat.lib.setsByFormation.get(gun.asset)).toContain(tight);
    expect(tight.movements.Normal[4]).toMatchObject({ x: 13.5, y: -2.2 });
    expect(tight.movements.M4left[0]).toMatchObject({ slot: 4, x: -8, y: -2.2 });
    expect(cat.customAssets).toEqual(new Set([OFF + "PBS_Gun/PBS_Gun", TIGHT + "PBS_Y_Trips_Tight_Wk", OPEN + "PBS_Trips_Open"]));
    expect(cat.lib.isCustomSet(tight.asset)).toBe(true);
    expect(cat.customOrigin.get(OPEN + "PBS_Trips_Open")).toEqual({ kind: "set", file: setsDoc.path, index: 1 });
    expect(cat.customOrigin.get(OFF + "PBS_Gun/PBS_Gun")).toEqual({ kind: "formation", file: setsDoc.path, index: 0 });
    // Without sets docs the catalog's lib is the plain library.
    expect(buildCatalog(lib, docs).lib).toBe(lib);
  });

  it("resolves clones as custom plays in their custom set", () => {
    expect(cat.clones.map((c) => c.name)).toEqual(["PBS T Curls", "PBS T Slants", "PBS T Inside Zone", "PBS T HB Slip Screen", "PBS O Four Verticals", "PBS O Mtn Mesh", "PBS O HB Draw"]);
    const curls = cat.get(TIGHT + "PBS_T_Curls")!;
    const from = lib.playByAsset.get(SET + "Curls")!;
    expect(curls).toMatchObject({
      source: "custom",
      name: "PBS T Curls",
      set: TIGHT + "PBS_Y_Trips_Tight_Wk",
      formation: OFF + "Shotgun/Shotgun",
      side: "offense",
      base: SET + "Curls",
      file: setsDoc.path,
      clone: { file: setsDoc.path, setIndex: 0, index: 0 },
      global: false,
      vip: from.vip,
      playType: "OffensePlayType_PassShotgun",
      problems: [],
    });
    expect(curls.index).toBeUndefined(); // not a playbooks/plays entry
    expect(curls.slots.map((s) => s.assignment)).toEqual(from.assignments);
    expect(curls.slots.every((s) => !s.changed)).toBe(true);
    expect(cat.custom.some((p) => p.clone)).toBe(false);
    expect(cat.cloneByKey.get(OPEN + "PBS_O_HB_Draw")?.formation).toBe(OFF + "PBS_Gun/PBS_Gun");

    // Plays in a custom set: its clones; pbook-build finds them by name.
    expect(cat.playsInSet(TIGHT + "PBS_Y_Trips_Tight_Wk").map((p) => p.name)).toEqual(["PBS T Curls", "PBS T Slants", "PBS T Inside Zone", "PBS T HB Slip Screen"]);
    expect(cat.playInSetByName(OPEN + "PBS_Trips_Open", "pbs o mtn mesh")?.key).toBe(OPEN + "PBS_O_Mtn_Mesh");
  });

  it("keeps catalog.lib, clones and library plays stable while only plays docs change", () => {
    const again = buildCatalog(lib, [docs[1]], [{ ...setsDoc }]);
    expect(again.lib).toBe(cat.lib);
    expect(again.clones).toBe(cat.clones);
    expect(again.version).toBeGreaterThan(cat.version);
    expect(again.get(SET + "Curls")).toBe(cat.get(SET + "Curls"));
    expect(resolveLibraryPlay(cat.lib, lib.playByAsset.get(SET + "Curls")!)).toBe(cat.get(SET + "Curls"));
    const edited: SetsFile = { ...setsDoc.data, sets: setsDoc.data.sets.slice(0, 1) };
    const other = buildCatalog(lib, docs, [{ path: setsDoc.path, data: edited }]);
    expect(other.lib).not.toBe(cat.lib);
    expect(other.lib.formationByName("Gun PBS", "offense")).toBeDefined(); // the formation still builds
    expect(other.clones).toHaveLength(4);
    expect(catalogOverlay(lib, [{ path: setsDoc.path, data: edited }]).lib).toBe(other.lib);
  });

  const cloneFile = (plays: SetsFile["sets"][number]["plays"]): { path: string; data: SetsFile } => ({
    path: "playbooks/sets/zz-v2-catalog-test.json",
    data: { sets: [{ ...setsDoc.data.sets[0], plays }] },
  });
  const playsFile = (plays: PlaysFile["plays"]) => ({ path: "playbooks/plays/zz-v2-catalog-test.json", data: { plays } });

  it("applies a clone's §3 overrides and resolves custom plays built on a clone", () => {
    const sets = cloneFile([
      {
        from: SET + "Curls",
        name: "C Curls",
        asset: "PBS_C_Curls",
        vip: 2,
        playType: "OffensePlayType_PassPlayAction",
        players: { "3": "RunRoute/WR_Run90for30", "2": { new: "PBS_Clone_Corner", steps: [{ type: "RunRoute", distance: 7, direction: 90, speed: 100 }] } },
      },
    ]);
    const tightKey = TIGHT + "PBS_C_Curls";
    const c = buildCatalog(
      lib,
      [
        playsFile([
          { name: "On Clone", asset: "PBS_On_Clone", base: tightKey, players: { "4": "PBS/PBS_Clone_Corner" } },
          { name: "Redefine", asset: "PBS_Redefine", base: SET + "Curls", players: { "2": { new: "PBS_Clone_Corner", steps: [{ type: "GetOpen" }] } } },
        ]),
      ],
      [sets],
    );
    const clone = c.get(tightKey)!;
    expect(clone.problems).toEqual([]);
    expect(clone).toMatchObject({ vip: 2, playType: "OffensePlayType_PassPlayAction", clone: { setIndex: 0, index: 0 } });
    expect(clone.slots[3]).toMatchObject({ assignment: ASSIGNMENT_ROOT + "RunRoute/WR_Run90for30", changed: true });
    expect(clone.slots[2]).toMatchObject({ authored: "PBS_Clone_Corner", changed: true });
    expect(c.authored.get("PBS_Clone_Corner")).toMatchObject({ file: sets.path, setIndex: 0, index: 0, play: "C Curls" });

    const [onClone, redefine] = c.custom;
    expect(onClone.problems).toEqual([]);
    expect(onClone).toMatchObject({ key: TIGHT + "PBS_On_Clone", set: TIGHT + "PBS_Y_Trips_Tight_Wk", base: tightKey, vip: 2, playType: "OffensePlayType_PassPlayAction" });
    expect(onClone.slots[4]).toMatchObject({ authored: "PBS_Clone_Corner", changed: true });
    expect(onClone.slots[3]).toMatchObject({ assignment: ASSIGNMENT_ROOT + "RunRoute/WR_Run90for30", changed: false }); // the clone's slot
    expect(redefine.problems.join()).toMatch(/"PBS_Clone_Corner" is first defined by "C Curls"/); // clones build first
    expect(c.playsInSet(TIGHT + "PBS_Y_Trips_Tight_Wk").map((p) => p.name)).toEqual(["C Curls", "On Clone"]);

    // The designer resolves with catalog.lib: the clone base is found through the overlay.
    const rp = resolveCustomPlay(c.lib, { name: "Preview", asset: "PBS_Prev", base: tightKey }, "playbooks/plays/x.json", 0, c.authored);
    expect(rp.problems).toEqual([]);
    expect(rp.set).toBe(TIGHT + "PBS_Y_Trips_Tight_Wk");
    expect(resolveCustomPlay(lib, { name: "Preview", asset: "PBS_Prev", base: tightKey }, "x", 0, c.authored).problems.join()).toMatch(/base play not in the library/);
  });

  it("reports clone problems and clashes between clones and custom plays", () => {
    const sets = cloneFile([
      { from: SET + "Nope", name: "Lost", asset: "PBS_Lost" },
      { from: SET + "Curls", name: "Twin", asset: "PBS_Twin", vip: 14, players: { "1": "RunRoute/WR_Run90for30" } },
      { from: SET + "Curls", name: "twin", asset: "PBS_Twin" },
      { from: OFF + "I_Form/Close/Power_O", name: "Power", asset: "PBS_Power" },
      { from: TIGHT + "PBS_Power", name: "Power 2", asset: "PBS_Power2" },
    ]);
    const c = buildCatalog(
      lib,
      [
        playsFile([
          { name: "Power", asset: "PBS_Mine", base: TIGHT + "PBS_Power" },
          { name: "Mine", asset: "PBS_Power2", base: TIGHT + "PBS_Power" },
        ]),
      ],
      [sets],
    );
    const [lost, twin, twin2, power, power2] = c.clones;
    expect(lost.problems.join()).toMatch(/base play not in the library or an earlier clone/);
    expect(classifyPlayProblem(lost.problems[0]).rule).toBe("play-base");
    expect(twin.problems.join(" | ")).toMatch(/vip 14 is not a slot/);
    expect(twin.problems.join(" | ")).toMatch(/asset PBS_Twin is also used by/);
    expect(twin2.problems.join(" | ")).toMatch(/name "twin" is also used by another custom play in this set/);
    expect(power.problems).toEqual([]); // any set may be cloned (the editor warns about slot order)
    expect(power2.problems).toEqual([]); // an earlier clone may be cloned
    expect(power2.slots.map((s) => s.assignment)).toEqual(lib.playByAsset.get(OFF + "I_Form/Close/Power_O")!.assignments);
    const [mineByName, mineByAsset] = c.custom;
    expect(mineByName.problems.join()).toMatch(/name "Power" is also a cloned play in this set \(the game-side builder picks the clone/);
    expect(classifyPlayProblem(mineByName.problems[0]).rule).toBe("play-name-duplicate");
    expect(mineByAsset.problems.join()).toMatch(/asset PBS_Power2 is also used by the cloned play "Power 2"/);
    expect(c.playInSetByName(TIGHT + "PBS_Y_Trips_Tight_Wk", "power")).toBe(power); // the clone wins like custom-plays.tsv
    expect(c.get(TIGHT + "PBS_Power2")).toBe(power2);
  });
});
