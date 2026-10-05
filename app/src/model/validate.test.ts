import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCatalog } from "./catalog";
import { loadLibraryData, loadPlaysDoc } from "./libFixture";
import { buildLibraryIndex } from "./library";
import { validateSetsFile } from "./sets";
import { templateContents } from "./tdb";
import type { ConceptsDoc, PlaybookSpec, PlaysFile, RoutesDoc, SetsFile, ValidationIssue } from "./types";
import {
  classifyPlayProblem,
  countIssues,
  describeWhere,
  groupIssues,
  isBuiltPlaybookPath,
  issueTarget,
  routesIssues,
  saveNameFor,
  setsFileIssues,
  stepIssues,
  validateAll,
  type SpecDoc,
} from "./validate";

const ROOT = "football/Gameplay/playbooks/PlayLibrary/Formations/Offense/Shotgun/";
const SET = ROOT + "Y_Trips_Wk/";
const TIGHT = ROOT + "PBS_Y_Trips_Tight_Wk/";
const lib = buildLibraryIndex(loadLibraryData());
const exampleDocs = [loadPlaysDoc("art-test.json"), loadPlaysDoc("pbs-ytrips-v1.json")];
const exampleSets: SpecDoc<SetsFile> = {
  path: "playbooks/sets/pbs-sets-v1.json",
  data: JSON.parse(readFileSync(new URL("../../../playbooks/sets/pbs-sets-v1.json", import.meta.url), "utf8")),
};
const book = (name: string): SpecDoc<PlaybookSpec> => ({
  path: `playbooks/${name}`,
  data: JSON.parse(readFileSync(new URL(`../../../playbooks/${name}`, import.meta.url), "utf8")),
});
const tc = templateContents(new Uint8Array(readFileSync(new URL("../../../playbooks/templates/PBOOKOFF-TEMPLATE", import.meta.url))), lib);

/**
 * validateAll with extra docs added to the examples (plays files + the example sets file); the catalog (with its
 * overlay of custom formations/sets/clones) is built from the same docs.
 */
function run(input: {
  playbooks?: SpecDoc<PlaybookSpec>[];
  plays?: SpecDoc<PlaysFile>[];
  sets?: SpecDoc<SetsFile>[];
  concepts?: SpecDoc<ConceptsDoc>[];
  routes?: SpecDoc<RoutesDoc>[];
}) {
  const plays = [...exampleDocs, ...(input.plays ?? [])];
  const sets = [exampleSets, ...(input.sets ?? [])];
  const cat = buildCatalog(
    lib,
    plays.filter((d) => d.data).map((d) => ({ path: d.path, data: d.data as PlaysFile })),
    sets,
  );
  return { cat, issues: validateAll({ playbooks: input.playbooks ?? [], plays, sets, concepts: input.concepts, routes: input.routes }, cat, { template: tc }) };
}

const rulesOf = (issues: ValidationIssue[], file?: string) => issues.filter((i) => !file || i.file === file).map((i) => i.rule);
const errorsOf = (issues: ValidationIssue[]) => issues.filter((i) => i.level === "error");

describe("validateAll on the example files", () => {
  // studio-test uses the custom sets of playbooks/sets/pbs-sets-v1.json (a custom formation, two custom sets, 7 clones).
  const { issues } = run({ playbooks: [book("studio-test.json"), book("studio-lib.json")] });

  it("finds no errors in the examples (custom sets and clones included)", () => {
    expect(errorsOf(issues)).toEqual([]);
  });

  it("reports needs-mod notes and the unused-blocking warning, and nothing about special teams", () => {
    expect(issues.some((i) => i.rule === "formation-ambiguous" || i.rule === "sets-planned" || i.rule === "template-empty")).toBe(false);
    // studio-test: 11 custom plays + 7 clones + Gun Bunch Mesh (pulled); the custom formation/set get their own notes.
    expect(issues.filter((i) => i.rule === "needs-mod" && i.file === "playbooks/studio-test.json")).toHaveLength(19);
    expect(issues.filter((i) => (i.rule === "custom-formation" || i.rule === "custom-set") && i.file === "playbooks/studio-test.json")).toHaveLength(2);
    expect(issues.filter((i) => i.rule === "needs-mod" && i.file === "playbooks/studio-lib.json")).toHaveLength(1);
    const blocking = issues.filter((i) => i.rule === "play-blocking");
    expect(blocking).toHaveLength(1);
    expect(blocking[0]).toMatchObject({ level: "warning", file: "playbooks/plays/pbs-ytrips-v1.json", where: "/plays/4" });
  });

  it("errors on a template section the template save has no sets for", () => {
    const spec: PlaybookSpec = { name: "ZZ", side: "offense", formations: [{ formation: "Gun PBS", sets: "template" }, { formation: "Strong I", sets: "template" }] };
    const { issues: r } = run({ playbooks: [{ path: "playbooks/zz.json", data: spec }] });
    const t = r.filter((i) => i.rule === "template-empty");
    expect(t.map((i) => [i.level, i.where])).toEqual([
      ["error", "/formations/0"],
      ["error", "/formations/1"],
    ]);
    expect(t[0].message).toMatch(/GUN PBS is a custom formation/);
  });
});

describe("custom plays based on a clone (FORMATS.md §5)", () => {
  const file = "playbooks/plays/zz-clone-base.json";
  const plays: PlaysFile = {
    plays: [
      /* 0 */ { name: "ZZ Tight Snag", asset: "ZZ_Tight_Snag", base: TIGHT + "PBS_T_Curls", players: { "2": "RunRoute/WR_Run90for30" } },
      /* 1 */ { name: "PBS T Slants", asset: "PBS_T_Slants", base: TIGHT + "PBS_T_Curls" },
      /* 2 */ { name: "ZZ Ghost", asset: "ZZ_Ghost", base: TIGHT + "Nope" },
    ],
  };
  const { issues } = run({ plays: [{ path: file, data: plays }] });
  const at = (i: number) => issues.filter((x) => x.file === file && (x.where === `/plays/${i}` || x.where?.startsWith(`/plays/${i}/`)));

  it("accepts a clone as the base", () => {
    expect(errorsOf(at(0))).toEqual([]);
  });

  it("flags names and assets a clone in that set already uses (pbook-build finds the clone first)", () => {
    const r = at(1);
    expect(r.find((x) => x.rule === "play-name-duplicate")?.message).toMatch(/a play cloned into Y TRIPS TIGHT WK .* the game-side builder picks the clone/);
    expect(r.find((x) => x.rule === "play-asset-duplicate")?.message).toMatch(/already used by a play cloned into this set/);
  });

  it("explains a base that is neither a library play nor a clone", () => {
    expect(at(2).filter((x) => x.rule === "play-base")).toHaveLength(1);
    expect(at(2).find((x) => x.rule === "play-base")?.message).toMatch(/library play or a play cloned into a custom set/);
  });
});

describe("plays files (FORMATS.md §3)", () => {
  const file = "playbooks/plays/zz-validate.json";
  const plays: PlaysFile = {
    plays: [
      /* 0 */ { name: "", asset: "Bad Asset!", base: SET + "Curls" },
      /* 1 */ { name: "Ghost", asset: "Ghost", base: SET + "Nope" },
      /* 2 */ { name: "Typed", asset: "Typed", base: SET + "Curls", playType: "OffensePlayType_Nope", runHole: 12, vip: 9, blocking: "NotAScheme" },
      /* 3 */ {
        name: "Bad Steps",
        asset: "Bad_Steps",
        base: SET + "Curls",
        players: {
          "2": {
            new: "ZZ_Bad_Steps",
            steps: [
              { type: "RunRoute", distance: 7, direction: "up", speed: 100 },
              { type: "ReceiverCut", direction: "RECEIVER_CUT_DIR_UP", cutType: "RECEIVER_CUT_ANGLE_45" },
              { type: "Teleport" },
            ],
          },
          "3": "RunRoute/Does_Not_Exist",
          "14": "RunRoute/WR_Run90for30",
          "4": { new: "ZZ_Keep_Too_Much", keep: 9, steps: [] },
          "5": { new: "ZZ_Bad_Template", template: "RunRoute/Nope", steps: [{ type: "GetOpen" }] },
        },
        reads: [{ pos: 11, pct: 0.5 }, { pos: 2, pct: 1.5 }],
      },
      /* 4 */ {
        name: "Dropped Handoff",
        asset: "Dropped_Handoff",
        base: SET + "HB_Base",
        players: { "1": { new: "ZZ_HB_Swing", steps: [{ type: "RunRoute", distance: 5, direction: 180, speed: 100 }] } },
      },
      /* 5 */ { name: "Curls", asset: "Curls", base: SET + "Curls" },
      /* 6 */ { name: "Twin", asset: "PBS_Snag", base: SET + "Curls" },
      /* 7 */ {
        name: "Redefines",
        asset: "ZZ_Redefines",
        base: SET + "Curls",
        players: { "2": { new: "PBS_Slot_Out12", steps: [{ type: "RunRoute", distance: 3, direction: 90, speed: 100 }] } },
      },
      /* 8 */ {
        name: "Kept Handoff",
        asset: "ZZ_Kept_Handoff",
        base: SET + "HB_Base",
        players: { "1": { new: "ZZ_HB_Kept", keep: 2, steps: [{ type: "RunRoute", distance: 5, direction: 90, speed: 100 }] } },
      },
    ],
  };
  const { issues } = run({ plays: [{ path: file, data: plays }] });
  const at = (i: number) => issues.filter((x) => x.file === file && (x.where === `/plays/${i}` || x.where?.startsWith(`/plays/${i}/`)));

  it("checks names, assets and the base play", () => {
    expect(rulesOf(at(0))).toEqual(expect.arrayContaining(["play-name", "play-asset"]));
    expect(rulesOf(at(1))).toContain("play-base");
    // Our check and the catalog's problem for the same rule are reported once.
    expect(rulesOf(at(1)).filter((r) => r === "play-base")).toHaveLength(1);
  });

  it("checks playType, runHole, vip and blocking", () => {
    const r = at(2);
    expect(rulesOf(r)).toEqual(expect.arrayContaining(["play-type", "play-runhole", "play-vip", "play-blocking"]));
    expect(r.find((x) => x.rule === "play-blocking")?.level).toBe("warning");
    expect(r.filter((x) => x.rule === "play-vip")).toHaveLength(1);
  });

  it("checks player slots, assignment paths, steps, keep, template and reads", () => {
    const r = at(3);
    expect(rulesOf(r)).toEqual(
      expect.arrayContaining(["step-number", "step-enum", "step-type", "play-assignment", "play-slot", "assignment-keep", "assignment-template", "read-pos", "read-pct"]),
    );
    expect(r.find((x) => x.rule === "step-type")?.where).toBe("/plays/3/players/2/steps/2");
    expect(r.find((x) => x.rule === "step-enum")?.where).toBe("/plays/3/players/2/steps/1");
    expect(r.filter((x) => x.rule === "play-slot")).toHaveLength(1);
  });

  it("enforces handoff mechanics pairing", () => {
    const r = at(4).filter((x) => x.rule === "mechanics");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ level: "error", where: "/plays/4/players/1" });
    expect(r[0].message).toMatch(/"keep": 1/);
    expect(rulesOf(at(8))).not.toContain("mechanics");
  });

  it("flags names/assets that collide with the library or other custom plays", () => {
    expect(rulesOf(at(5))).toEqual(expect.arrayContaining(["play-name-duplicate", "play-asset-duplicate"]));
    expect(rulesOf(at(6))).toContain("play-asset-duplicate"); // PBS_Snag lives in pbs-ytrips-v1.json
    // …and the example file is flagged back.
    expect(issues.some((i) => i.file === "playbooks/plays/pbs-ytrips-v1.json" && i.rule === "play-asset-duplicate")).toBe(true);
  });

  it("warns (not errors) when a `new` name is redefined with different steps", () => {
    const r = at(7).filter((x) => x.rule === "assignment-redefined");
    expect(r).toHaveLength(1);
    expect(r[0].level).toBe("warning");
  });

  it("points playbook entries at the plays file and keeps warning-only problems as warnings", () => {
    const spec: PlaybookSpec = {
      name: "ZZ",
      side: "offense",
      formations: [{ formation: "Shotgun", sets: [{ set: "Y Trips Wk", plays: [{ play: "Redefines" }, { play: "Dropped Handoff" }] }] }],
    };
    const { issues: r } = run({ plays: [{ path: file, data: plays }], playbooks: [{ path: "playbooks/zz.json", data: spec }] });
    const probs = r.filter((i) => i.file === "playbooks/zz.json" && i.rule === "play-problem");
    expect(probs.map((i) => [i.where, i.level])).toEqual([
      ["/formations/0/sets/0/plays/0", "warning"],
      ["/formations/0/sets/0/plays/1", "error"],
    ]);
    expect(probs[1].message).toContain(`${file} #5`);
  });

  it("reports unreadable and malformed files", () => {
    const { issues: bad } = run({
      plays: [
        { path: "playbooks/plays/zz-broken.json", data: null, error: "Invalid JSON in playbooks/plays/zz-broken.json" },
        { path: "playbooks/plays/zz-noplays.json", data: { title: "x" } as unknown as PlaysFile },
      ],
    });
    expect(bad.find((i) => i.file === "playbooks/plays/zz-broken.json")?.rule).toBe("file-unreadable");
    expect(bad.find((i) => i.file === "playbooks/plays/zz-noplays.json")?.rule).toBe("plays-array");
  });
});

describe("steps", () => {
  it("accepts every authored step of the example plays", () => {
    for (const doc of exampleDocs)
      for (const p of doc.data.plays)
        for (const spec of Object.values(p.players ?? {}))
          if (typeof spec === "object") for (const st of spec.steps) expect(stepIssues(st, lib, "/x").filter((i) => i.level === "error"), JSON.stringify(st)).toEqual([]);
  });

  it("accepts every step of the library's 5,402 assignments (no false positives on copied steps)", () => {
    const bad: string[] = [];
    for (const [asset, a] of Object.entries(lib.data.assignments))
      a.steps.forEach((st, i) => {
        if (st.type !== "None") for (const iss of stepIssues(st, lib, "/x")) bad.push(`${asset} #${i}: ${iss.message}`);
      });
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it("validates AutoMotion waypoints", () => {
    const rules = stepIssues(
      { type: "AutoMotion", startEvent: "AUTOMOTIONSTARTEVENT_SNAP", waypoints: [{ position: { x: 1 }, speed: 80, locoStyle: "AUTOMOTIONLOCOSTYLE_FLY" }] },
      lib,
      "/s",
    ).map((i) => i.rule);
    expect(rules).toEqual(expect.arrayContaining(["motion-waypoints", "step-enum"]));
  });

  it("makes fields PlayBuilder rejects errors (it throws, so the export stops)", () => {
    const typo = stepIssues({ type: "RunRoute", distnace: 3, distance: 3, direction: 90, speed: 100 }, lib, "/s");
    expect(typo.map((i) => [i.level, i.rule])).toEqual([["error", "step-field"]]);
    expect(typo[0].message).toMatch(/PlayBuilder rejects it/);
    // Steps without fields (GetOpen) reject any field too; the class's own hidden props don't count.
    expect(stepIssues({ type: "GetOpen", foo: 1 }, lib, "/s").map((i) => i.level)).toEqual(["error"]);
    expect(stepIssues({ type: "GetOpen", Name: "x" }, lib, "/s")).toEqual([]);
  });

  it("makes step types with no library instance errors (PlayBuilder has no opcode to copy)", () => {
    const fake = stepIssues({ type: "RunRouteFakeOut" }, lib, "/s");
    expect(fake.map((i) => [i.level, i.rule])).toContainEqual(["error", "step-unbuildable"]);
    const turbo = stepIssues({ type: "RunRouteTurbo" }, lib, "/s");
    expect(turbo.map((i) => i.rule)).toContain("step-unbuildable");
    expect(stepIssues({ type: "GetOpen" }, lib, "/s")).toEqual([]);
  });
});

describe("custom play names and read concepts (PlayBuilder / pbook-build parity)", () => {
  const file = "playbooks/plays/zz-names.json";
  const { issues } = run({
    plays: [
      {
        path: file,
        data: { plays: [{ name: "Curls", asset: "ZZ_Curls2", base: SET + "Curls", reads: [{ pos: 2, pct: 0.5, concept: "Concept_Bogus" }] }] },
      },
    ],
  });
  it("says the library play wins a name clash (pbook-build searches plays.tsv first)", () => {
    const dup = issues.filter((i) => i.file === file && i.rule === "play-name-duplicate");
    expect(dup.length).toBeGreaterThan(0);
    expect(dup.every((i) => i.level === "error")).toBe(true);
    expect(dup[0].message).toMatch(/game-side builder picks the library play; rename the custom play/);
  });
  it("makes an invalid read concept an error (Enum.Parse throws)", () => {
    const r = issues.find((i) => i.file === file && i.rule === "read-concept")!;
    expect(r.level).toBe("error");
    expect(r.message).toMatch(/PlayBuilder rejects it/);
  });
});

describe("playbooks", () => {
  it("flags two playbooks that build the same save", () => {
    const a = book("studio-lib.json");
    const b: SpecDoc<PlaybookSpec> = { path: "playbooks/zz-copy.json", data: { ...a.data!, name: "studiolib" } };
    const { issues } = run({ playbooks: [a, b] });
    expect(issues.filter((i) => i.rule === "save-name-duplicate").map((i) => i.file)).toEqual(["playbooks/studio-lib.json", "playbooks/zz-copy.json"]);
  });

  it("survives malformed specs", () => {
    const { issues } = run({
      playbooks: [
        { path: "playbooks/zz-a.json", data: { name: "A", side: "offense", formations: "nope" } as unknown as PlaybookSpec },
        { path: "playbooks/zz-b.json", data: { name: "B", side: "offense", formations: [{ formation: "Shotgun", sets: [{ set: "Bunch", plays: 3 }] }] } as unknown as PlaybookSpec },
        { path: "playbooks/zz-c.json", data: null, error: "Can't read" },
      ],
    });
    expect(rulesOf(issues, "playbooks/zz-a.json")).toEqual(["book-shape"]);
    expect(rulesOf(issues, "playbooks/zz-b.json")).toContain("book-shape");
    expect(rulesOf(issues, "playbooks/zz-c.json")).toEqual(["file-unreadable"]);
  });

  it("counts template sections toward capacity when given the template (overflow is an error)", async () => {
    const { templateContents } = await import("./tdb");
    const { newPlaybookSpec } = await import("./playbook");
    const tc = templateContents(new Uint8Array(readFileSync(new URL("../../../playbooks/templates/PBOOKOFF-TEMPLATE", import.meta.url))), lib);
    const big = newPlaybookSpec("BIG");
    const shotgun = lib.formationByName("Shotgun", "offense")!;
    const sets = lib.setsByFormation.get(shotgun.asset)!.filter((st) => lib.setByName(shotgun, st.name)?.asset === st.asset);
    big.formations.unshift({ formation: "Shotgun", sets: Array.from({ length: 70 }, (_, i) => ({ set: sets[i % sets.length].name, plays: [{ play: lib.playsBySet.get(sets[i % sets.length].asset)![0].name }] })) });
    const cat = buildCatalog(lib, []);
    const doc = { path: "playbooks/zz-big.json", data: big };
    const capWith = validateAll({ playbooks: [doc], plays: [] }, cat, { template: tc }).find((i) => i.rule === "cap-sets")!;
    expect(capWith.level).toBe("error");
    expect(validateAll({ playbooks: [doc], plays: [] }, cat).find((i) => i.rule === "cap-sets")!.level).toBe("warning");
  });

  it("names saves like tools/export.ps1", () => {
    expect(saveNameFor({ name: "Studio", side: "offense" })).toBe("PBOOKOFF-STUDIO");
    expect(saveNameFor({ name: "D1", side: "defense" })).toBe("PBOOKDEF-D1");
    expect(isBuiltPlaybookPath("playbooks/studio-test.json")).toBe(true);
    expect(isBuiltPlaybookPath("playbooks/mod.json")).toBe(false);
    expect(isBuiltPlaybookPath("playbooks/plays/x.json")).toBe(false);
  });
});

describe("sets files (FORMATS.md §5)", () => {
  const base = SET + "Y_Trips_Wk";
  const formation = ROOT + "Shotgun";
  const doc = (sets: SetsFile): SpecDoc<SetsFile> => ({ path: "playbooks/sets/zz-sets.json", data: sets });

  it("reports exactly what the Formations editor reports (model/sets.ts), with no planned-support note", () => {
    const data: SetsFile = { sets: [{ name: "Wide", asset: "ZZ_Wide", base, formation, positions: [{ slot: 6, x: -4.5 }, { slot: 0, y: -6 }] }] };
    const issues = setsFileIssues(doc(data), lib);
    expect(issues).toEqual(validateSetsFile(data, lib, { file: "playbooks/sets/zz-sets.json", allFiles: [{ path: "playbooks/sets/zz-sets.json", data }] }));
    expect(issues.some((i) => i.rule === "sets-planned")).toBe(false);
  });

  it("accepts the example sets file (it builds game-side)", () => {
    const { issues } = run({});
    expect(errorsOf(issues.filter((i) => i.file === exampleSets.path))).toEqual([]);
  });

  it("checks the file itself (unreadable, not an object, an unknown base)", () => {
    expect(setsFileIssues({ path: "playbooks/sets/zz.json", data: null, error: "Invalid JSON" }, lib).map((i) => [i.level, i.rule])).toEqual([["error", "file-unreadable"]]);
    expect(setsFileIssues({ path: "playbooks/sets/zz.json", data: [] as unknown as SetsFile }, lib).map((i) => i.rule)).toEqual(["sets-shape"]);
    const lost = setsFileIssues(doc({ sets: [{ name: "Lost", asset: "ZZ_Lost", base: SET + "Nope", formation }] }), lib);
    expect(errorsOf(lost).length).toBeGreaterThan(0);
  });
});

describe("routes that run off the field", () => {
  const file = "playbooks/plays/zz-offfield.json";
  // The widest receiver of the set: a 10 yd stem, then 15 yd straight toward his sideline.
  const normal = lib.setByAsset.get(SET + "Y_Trips_Wk")?.movements?.Normal ?? [];
  const slot = normal.reduce((best, a, i) => (Math.abs(a.x) > Math.abs(normal[best]?.x ?? 0) ? i : best), 0);
  const outward = (normal[slot]?.x ?? 1) > 0 ? 0 : 180;
  const route = (out: number) => [
    { type: "RunRoute", distance: 10, direction: 90, speed: 100 },
    { type: "RunRoute", distance: out, direction: outward, speed: 100 },
  ];
  const plays: PlaysFile = {
    plays: [
      { name: "ZZ Off Field", asset: "ZZ_Off_Field", base: SET + "Curls", players: { [String(slot)]: { new: "ZZ_Wide_Out_Far", steps: route(15) } } },
      { name: "ZZ On Field", asset: "ZZ_On_Field", base: SET + "Curls", players: { [String(slot)]: { new: "ZZ_Wide_Out_Near", steps: route(2) } } },
    ],
  };
  const { issues } = run({ plays: [{ path: file, data: plays }] });
  it("warns when a player's route crosses the sideline, and only then", () => {
    expect(Math.abs(normal[slot].x)).toBeGreaterThan(15);
    const off = issues.filter((i) => i.file === file && i.rule === "route-off-field");
    expect(off).toHaveLength(1);
    expect(off[0]).toMatchObject({ level: "warning", where: `/plays/0/players/${slot}` });
    expect(off[0].message).toMatch(/past the (left|right) sideline.*Fit to field/);
  });
});

describe("motions past what real plays do", () => {
  const file = "playbooks/plays/zz-motion.json";
  const normal = lib.setByAsset.get(SET + "Y_Trips_Wk")?.movements?.Normal ?? [];
  const slot = normal.reduce((best, a, i) => (Math.abs(a.x) > Math.abs(normal[best]?.x ?? 0) ? i : best), 0);
  const side = (normal[slot]?.x ?? 1) > 0 ? 1 : -1;
  const motion = (to: { x: number; y: number }) => ({
    type: "AutoMotion",
    waypoints: [{ position: to, speed: 100, locoStyle: "AUTOMOTION_LOCOSTYLE_RUN" }],
  });
  const go = { type: "RunRoute", distance: 10, direction: 90, speed: 100 };
  const plays: PlaysFile = {
    plays: [
      // From his spot across the formation and 11 yd deep: far past 35 yd in total.
      { name: "ZZ Long Motion", asset: "ZZ_Long_Motion", base: SET + "Curls", players: { [String(slot)]: { new: "ZZ_Long_Mo", steps: [motion({ x: -side * 18, y: -11 }), go] } } },
      { name: "ZZ Short Motion", asset: "ZZ_Short_Motion", base: SET + "Curls", players: { [String(slot)]: { new: "ZZ_Short_Mo", steps: [motion({ x: side * 10, y: -2.5 }), go] } } },
    ],
  };
  const { issues } = run({ plays: [{ path: file, data: plays }] });
  it("warns about a motion longer than the game's longest, and only then", () => {
    const m = issues.filter((i) => i.file === file && i.rule === "motion-limits");
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ level: "warning", where: `/plays/0/players/${slot}` });
    expect(m[0].message).toMatch(/longest in the game is 35 yd/);
  });
});

describe("My Routes (app-data/routes.json)", () => {
  const file = "app-data/routes.json";
  const step = { type: "RunRoute", distance: 5, direction: 90, speed: 100 };
  it("accepts a well-formed library", () => {
    const d: RoutesDoc = { version: 1, routes: [{ id: "r1", name: "Quick Out", side: "left", steps: [step, { type: "GetOpen" }] }] };
    expect(routesIssues({ path: file, data: d }, lib)).toEqual([]);
  });

  it("warns (never errors) about shape, missing fields, unknown step types and duplicates", () => {
    const d = {
      version: 2,
      routes: [
        { id: "r1", name: "Quick Out", side: "left", steps: [step] },
        { id: "r1", name: "quick  out", side: "middle", steps: [] },
        { name: "", steps: [{ type: "Teleport" }, 3] },
        "x",
      ],
    } as unknown as RoutesDoc;
    const { issues } = run({ routes: [{ path: file, data: d }] });
    const r = issues.filter((i) => i.file === file);
    expect(r.every((i) => i.level === "warning")).toBe(true);
    expect(r.map((i) => [i.rule, i.where])).toEqual([
      ["routes-shape", "/version"],
      ["route-duplicate-id", "/routes/1"],
      ["route-duplicate-name", "/routes/1"],
      ["route-side", "/routes/1"],
      ["route-steps", "/routes/1"],
      ["route-id", "/routes/2"],
      ["route-name", "/routes/2"],
      ["route-side", "/routes/2"],
      ["route-steps", "/routes/2/steps/0"],
      ["route-steps", "/routes/2/steps/1"],
      ["route-shape", "/routes/3"],
    ]);
    expect(routesIssues({ path: file, data: { routes: 3 } as unknown as RoutesDoc }).map((i) => i.rule)).toEqual(["routes-shape"]);
    expect(routesIssues({ path: file, data: null, error: "Invalid JSON" })).toEqual([expect.objectContaining({ level: "warning", rule: "file-unreadable" })]);
    expect(describeWhere(d, "/routes/1")).toBe("quick  out");
    expect(issueTarget({ file, where: "/routes/1" })).toBeUndefined();
  });
});

describe("concepts", () => {
  it("warns about tags on unknown categories and unknown plays", () => {
    const concepts: ConceptsDoc = {
      version: 1,
      categories: [{ id: "snag", name: "Snag", group: "pass", color: "#fff" }, { id: "child", name: "Child", group: "pass", color: "#fff", parent: "gone" }],
      tags: { [SET + "Curls"]: ["snag", "mesh"], [SET + "Not_A_Play"]: ["snag"] },
    };
    const { issues } = run({ concepts: [{ path: "app-data/concepts.json", data: concepts }] });
    const rules = rulesOf(issues, "app-data/concepts.json");
    expect(rules).toEqual(expect.arrayContaining(["concept-unknown-category", "concept-unknown-play", "concept-parent"]));
    expect(issues.filter((i) => i.file === "app-data/concepts.json").every((i) => i.level === "warning")).toBe(true);
    const tagIssue = issues.find((i) => i.rule === "concept-unknown-play")!;
    expect(issueTarget(tagIssue)).toEqual({ view: "concepts", play: SET + "Not_A_Play" });
  });
});

describe("UI helpers", () => {
  it("maps issues to their editors", () => {
    expect(issueTarget({ file: "playbooks/studio-test.json", where: "/formations/0/sets/1/plays/3" })).toEqual({ view: "playbook", path: "playbooks/studio-test.json", f: 0, s: 1, p: 3 });
    expect(issueTarget({ file: "playbooks/studio-test.json" })).toEqual({ view: "playbook", path: "playbooks/studio-test.json" });
    expect(issueTarget({ file: "playbooks/plays/a.json", where: "/plays/4/players/2/steps/1" })).toEqual({ view: "designer", path: "playbooks/plays/a.json", index: 4 });
    expect(issueTarget({ file: "playbooks/sets/a.json", where: "/sets/2/positions/0" })).toEqual({ view: "formations", path: "playbooks/sets/a.json", index: 2 });
    expect(issueTarget({ file: undefined })).toBeUndefined();
  });

  it("describes locations by name", () => {
    const spec = book("studio-test.json").data;
    expect(describeWhere(spec, "/formations/0/sets/0/plays/11")).toBe("Shotgun › Y Trips Wk › Slants");
    const plays = exampleDocs[1].data;
    expect(describeWhere(plays, "/plays/1/players/2/steps/1")).toBe("PBS PA Yankee › slot 2 › step 2 ReceiverCut");
    // Sets files: set and clone names, not the formation / source asset paths.
    expect(describeWhere(exampleSets.data, "/sets/0/plays/2")).toBe("Y Trips Tight Wk › PBS T Inside Zone");
    expect(describeWhere(exampleSets.data, "/formations/0")).toBe("Gun PBS");
  });

  it("groups by file, then severity and position", () => {
    const issues: ValidationIssue[] = [
      { level: "info", message: "i", file: "b.json", where: "/plays/2" },
      { level: "error", message: "e10", file: "b.json", where: "/plays/10" },
      { level: "error", message: "e9", file: "b.json", where: "/plays/9" },
      { level: "warning", message: "w", file: "a.json" },
    ];
    const g = groupIssues(issues);
    expect(g.map((x) => x.file)).toEqual(["a.json", "b.json"]);
    expect(g[1].issues.map((i) => i.message)).toEqual(["e9", "e10", "i"]);
    expect(g[1].counts).toEqual({ error: 2, warning: 0, info: 1 });
    expect(countIssues(issues)).toEqual({ error: 2, warning: 1, info: 1 });
  });

  it("classifies catalog problems", () => {
    expect(classifyPlayProblem('slot 2: "X" is first defined by "Y" (f); that definition is used')).toEqual({ rule: "assignment-redefined", level: "warning" });
    expect(classifyPlayProblem("something new")).toEqual({ rule: "play-problem", level: "error" });
  });
});
