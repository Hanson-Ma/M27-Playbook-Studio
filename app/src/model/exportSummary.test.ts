import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCatalog, type Catalog } from "./catalog";
import { EXPORT_COMMAND, exportSummary } from "./exportSummary";
import { loadLibraryData, loadPlaysDoc } from "./libFixture";
import { buildLibraryIndex } from "./library";
import { newPlaybookSpec } from "./playbook";
import { templateContents } from "./tdb";
import type { PlaybookSpec, SetsFile } from "./types";
import type { SpecDoc } from "./validate";

const SET = "football/Gameplay/playbooks/PlayLibrary/Formations/Offense/Shotgun/Y_Trips_Wk/";
const FORMS = "football/Gameplay/playbooks/PlayLibrary/Formations/";
const lib = buildLibraryIndex(loadLibraryData());
const plays = [loadPlaysDoc("art-test.json"), loadPlaysDoc("pbs-ytrips-v1.json")];
const cat = buildCatalog(lib, plays);
const book = (name: string): SpecDoc<PlaybookSpec> => ({
  path: `playbooks/${name}`,
  data: JSON.parse(readFileSync(new URL(`../../../playbooks/${name}`, import.meta.url), "utf8")),
});
const setsDoc: { path: string; data: SetsFile } = {
  path: "playbooks/sets/pbs-sets-v1.json",
  data: JSON.parse(readFileSync(new URL("../../../playbooks/sets/pbs-sets-v1.json", import.meta.url), "utf8")),
};
const tc = templateContents(new Uint8Array(readFileSync(new URL("../../../playbooks/templates/PBOOKOFF-TEMPLATE", import.meta.url))), lib);

// Catalog overlay: custom formations/sets/clones from playbooks/sets/ (buildCatalog's sets docs).
const TIGHT = FORMS + "Offense/Shotgun/PBS_Y_Trips_Tight_Wk/PBS_Y_Trips_Tight_Wk";
const ocat: Catalog = buildCatalog(lib, plays, [setsDoc]);

describe("exportSummary", () => {
  const s = exportSummary(cat, { playbooks: [book("studio-lib.json")], plays }, { template: tc });

  it("builds one save per playbook, named like tools/export.ps1", () => {
    expect(s.saves.map((x) => [x.file, x.saveName, x.outPath])).toEqual([["playbooks/studio-lib.json", "PBOOKOFF-STUDIOLIB", "build/PBOOKOFF-STUDIOLIB"]]);
    expect(s.saves[0]).toMatchObject({ formations: 1, sets: 2, plays: 9, audibles: 4, custom: 0, customFormations: 0, customSets: 0, pulled: 1, unresolved: 0, willFail: false });
    expect(s.saves[0].templateSections).toEqual(["Goal Line Offense", "Special", "Kickoff", "Safety Kickoff"]);
    // = tools/pbook-build.mjs: "wrote PBOOKOFF-STUDIOLIB: 5 formations, 16 sets, 60 plays, 57 AI rows".
    expect(s.saves[0].saveRows).toMatchObject({ formations: 5, sets: 16, plays: 60, cpuRows: 57 });
  });

  it("has no special-teams caveats anymore (pbook-build resolves names by side)", () => {
    expect(s.saves[0].notes).toEqual([]);
    expect(s.notes).toEqual([]);
    expect(s.failing).toEqual([]);
  });

  it("lists every custom play in the ONE mod, with the books that use it", () => {
    expect(s.customPlays).toHaveLength(11);
    expect(s.playsFiles).toEqual(["playbooks/plays/art-test.json", "playbooks/plays/pbs-ytrips-v1.json"]);
    const snag = s.customPlays.find((p) => p.name === "PBS Snag")!;
    expect(snag).toMatchObject({ asset: "PBS_Snag", key: SET + "PBS_Snag", setName: "Y Trips Wk", formationName: "Shotgun", subtitle: "GUN Y TRIPS WK" });
    expect(snag.usedBy).toEqual([]); // studio-lib uses no custom plays
    expect(s.authoredAssignments).toBeGreaterThan(5);
  });

  it("pulls non-global library plays used by any playbook (deduped, with users)", () => {
    expect(s.pulled).toHaveLength(1);
    expect(s.pulled[0]).toMatchObject({ name: "Mesh", setName: "Bunch", usedBy: ["PBOOKOFF-STUDIOLIB"] });
  });

  it("marks saves with unresolved plays as failing and lists them", () => {
    const bad: SpecDoc<PlaybookSpec> = {
      path: "playbooks/zz-bad.json",
      data: { name: "zzBad", side: "offense", formations: [{ formation: "Shotgun", sets: [{ set: "Y Trips Wk", plays: [{ play: "Nope" }, { play: "Slants" }] }] }] },
    };
    const r = exportSummary(cat, { playbooks: [bad, { path: "playbooks/zz-broken.json", data: null, error: "Invalid JSON" }], plays });
    expect(r.saves[0]).toMatchObject({ saveName: "PBOOKOFF-ZZBAD", unresolved: 1, willFail: true });
    expect(r.unresolved).toEqual([
      expect.objectContaining({ file: "playbooks/zz-bad.json", play: "Nope", set: "Y Trips Wk", where: "/formations/0/sets/0/plays/0" }),
    ]);
    expect(r.saves[1]).toMatchObject({ error: "Invalid JSON", willFail: true });
    expect(r.customPlays.every((p) => p.usedBy.length === 0)).toBe(true);
  });

  it("builds sets files into the mod and skips nested playbooks like export.ps1", () => {
    const r = exportSummary(cat, {
      playbooks: [{ path: "playbooks/old/zz.json", data: { name: "X", side: "offense", formations: [] } }],
      plays: [],
      sets: [{ path: "playbooks/sets/zz.json", data: { sets: [] } }],
    });
    expect(r.saves).toEqual([]);
    expect(r.notBuilt).toEqual(["playbooks/old/zz.json"]);
    expect(r.setsFiles).toEqual(["playbooks/sets/zz.json"]);
    expect(r.customPlays).toEqual([]);
    expect(r.command).toBe(EXPORT_COMMAND);
    expect(EXPORT_COMMAND).toBe("powershell -ExecutionPolicy Bypass -File tools\\export.ps1 -Install");
  });
});

describe("custom formations, sets and clones in the summary (playbooks/sets/)", () => {
  // The lists come from the sets docs themselves (SetBuilder's asset layout), so they work with any catalog.
  const s = exportSummary(cat, { playbooks: [], plays, sets: [setsDoc] });

  it("lists the custom formation, both custom sets and the seven clones", () => {
    expect(s.setsFiles).toEqual(["playbooks/sets/pbs-sets-v1.json"]);
    expect(s.customFormations).toEqual([
      expect.objectContaining({ name: "Gun PBS", leaf: "PBS_Gun", asset: FORMS + "Offense/PBS_Gun/PBS_Gun", baseName: "Shotgun", sets: 1, index: 0 }),
    ]);
    expect(s.customSets.map((x) => [x.name, x.formationName, x.newFormation, x.positions, x.presets, x.clones, x.subtitle])).toEqual([
      ["Y Trips Tight Wk", "Shotgun", false, 2, 1, 4, "GUN Y TRIPS TIGHT WK"],
      ["Trips Open", "Gun PBS", true, 3, 0, 3, "GUN PBS TRIPS OPEN"],
    ]);
    expect(s.customSets[0]).toMatchObject({ asset: TIGHT, baseName: "Y Trips Wk" });
    expect(s.clonedPlays).toHaveLength(7);
    expect(s.clonedPlays[0]).toMatchObject({
      name: "PBS T Curls",
      key: FORMS + "Offense/Shotgun/PBS_Y_Trips_Tight_Wk/PBS_T_Curls",
      from: SET + "Curls",
      fromName: "Curls",
      setName: "Y Trips Tight Wk",
      setIndex: 0,
      index: 0,
      modified: false,
    });
    expect(s.clonedPlays[6]).toMatchObject({ name: "PBS O HB Draw", key: FORMS + "Offense/PBS_Gun/PBS_Trips_Open/PBS_O_HB_Draw", setIndex: 1, index: 2 });
    expect(s.notes).toEqual([expect.stringMatching(/Custom formations and sets build game-side/)]);
  });

  it("counts and attributes them per save with the overlay (studio-test)", () => {
    const r = exportSummary(ocat, { playbooks: [book("studio-test.json"), book("studio-lib.json")], plays, sets: [setsDoc] }, { template: tc });
    const studio = r.saves[0];
    expect(studio).toMatchObject({ formations: 2, sets: 4, plays: 26, audibles: 8, custom: 18, customFormations: 1, customSets: 2, pulled: 1, unresolved: 0, willFail: false });
    // = tools/pbook-build.mjs with the game PC's custom-*.tsv: "6 formations, 18 sets, 77 plays, 64 AI rows".
    expect(studio.saveRows).toMatchObject({ formations: 6, sets: 18, plays: 77, cpuRows: 64 });
    expect(r.customFormations[0].usedBy).toEqual(["PBOOKOFF-STUDIO"]);
    expect(r.customSets.map((x) => x.usedBy)).toEqual([["PBOOKOFF-STUDIO"], ["PBOOKOFF-STUDIO"]]);
    expect(r.clonedPlays.every((c) => c.usedBy.join() === "PBOOKOFF-STUDIO" && c.problems.length === 0)).toBe(true);
    expect(r.clonedPlays[0].playType).toBe("OffensePlayType_PassShotgun");
    expect(r.customPlays).toHaveLength(11); // clones are listed separately
    expect(r.customPlays.find((p) => p.name === "PBS Snag")!.usedBy).toEqual(["PBOOKOFF-STUDIO"]);
    expect(r.pulled[0].usedBy).toEqual(["PBOOKOFF-STUDIO", "PBOOKOFF-STUDIOLIB"]);
    expect(r.failing).toEqual([]);
  });
});

describe("exportSummary vs tools/pbook-build.mjs", () => {
  const doc = (name: string, data: unknown): SpecDoc<PlaybookSpec> => ({ path: `playbooks/${name}.json`, data: data as PlaybookSpec });

  it("fails saves pbook-build throws on (and export.ps1 then stops)", () => {
    const audible = doc("zz-aud", {
      name: "AUD",
      side: "offense",
      formations: [{ formation: "Shotgun", sets: [{ set: "Y Trips Wk", plays: [{ play: "Slants", audible: 2 }, { play: "Curls", audible: 2 }, { play: "PBS Snag", audible: 7, cpu: { Nope: 3 } }] }] }],
    });
    const shape = doc("zz-shape", { name: "SH", side: "offense", formations: [{ formation: "Shotgun", sets: [{ set: "Bunch" }] }] });
    // pbook-build: 'unknown formation "Nickel"' (it only looks at the playbook side's formations).
    const side = doc("zz-side", { name: "SD", side: "offense", formations: [{ formation: "Nickel", sets: [{ set: "Normal", plays: [] }] }] });
    // pbook-build: '"Strong I" (formId 4) has no sets in the template, so "template" would drop it'.
    const missing = doc("zz-missing", { name: "MS", side: "offense", formations: [{ formation: "Strong I", sets: "template" }] });
    const big = newPlaybookSpec("BIG");
    const shotgun = lib.formationByName("Shotgun", "offense")!;
    const sets = lib.setsByFormation.get(shotgun.asset)!.filter((st) => lib.setByName(shotgun, st.name)?.asset === st.asset);
    big.formations.unshift({ formation: "Shotgun", sets: Array.from({ length: 62 }, (_, i) => ({ set: sets[i % sets.length].name, plays: [{ play: lib.playsBySet.get(sets[i % sets.length].asset)![0].name }] })) });
    const r = exportSummary(cat, { playbooks: [audible, shape, side, missing, doc("zz-big", big)], plays }, { template: tc });
    const [a, b, c, d, e] = r.saves;
    expect(a.failures).toEqual(["Y Trips Wk: audible slot 2 used twice", '"PBS Snag": audible slot must be 1–4', '"PBS Snag": unknown CPU situation in cpu']);
    expect(b.failures).toEqual(['Shotgun: Bunch: "plays" must be an array']);
    expect(c.failures).toEqual([expect.stringMatching(/^Unknown formation "Nickel" \("Nickel" is a defense formation/)]);
    expect(d.failures).toEqual(['"Strong I" (formId 4) has no sets in the template, so "template" would drop it']);
    expect(e.failures).toEqual(["STID: 76 rows exceeds capacity 75 (template sections included)"]);
    expect(r.failing).toEqual(["PBOOKOFF-AUD", "PBOOKOFF-SH", "PBOOKOFF-SD", "PBOOKOFF-MS", "PBOOKOFF-BIG"]);
    // Without the template the capacity / template sections can't be known, so those saves aren't failed on it.
    expect(exportSummary(cat, { playbooks: [doc("zz-big", big), missing], plays }).saves.map((x) => x.willFail)).toEqual([false, false]);
  });

  it("builds explicit offense special teams (pbook-build: 1 formations, 1 sets, 1 plays, 0 AI rows)", () => {
    const sp = doc("zz-special", { name: "SP", side: "offense", formations: [{ formation: "Special", sets: [{ set: "Punt", plays: [{ play: "Fake Punt Dive" }] }] }] });
    const r = exportSummary(cat, { playbooks: [sp], plays }, { template: tc });
    expect(r.saves[0]).toMatchObject({ willFail: false, failures: [], saveRows: { formations: 1, sets: 1, plays: 1, cpuRows: 0 } });
  });

  it("fails a custom formation kept as a template section (pbook-build throws)", () => {
    const gun = doc("zz-gun", { name: "GN", side: "offense", formations: [{ formation: "Gun PBS", sets: "template" }] });
    const r = exportSummary(ocat, { playbooks: [gun], plays, sets: [setsDoc] });
    expect(r.saves[0].failures).toEqual([expect.stringMatching(/^"Gun PBS" \(formId \d+\) has no sets in the template, so "template" would drop it$/)]);
  });

  it("survives wrong-shaped specs", () => {
    const bad = [doc("zz-1", { name: "A", formations: [null, { formation: "Shotgun", sets: [null, { set: "Bunch", plays: [null] }] }] }), doc("zz-2", { formations: { x: 1 } })];
    const r = exportSummary(cat, { playbooks: bad, plays, sets: [{ path: "playbooks/sets/zz.json", data: { sets: [null, { name: 3 }], formations: "x" } as unknown as SetsFile }] }, { template: tc });
    expect(r.saves.map((x) => x.willFail)).toEqual([true, true]);
    expect(r.saves[0].failures.length).toBeGreaterThan(0);
    expect(r.customSets).toHaveLength(1);
    expect(r.customSets[0]).toMatchObject({ name: "", asset: "" });
  });
});
