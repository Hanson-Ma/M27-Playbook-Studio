import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCatalog, type Catalog } from "./catalog";
import { loadLibraryData, loadPlaysDoc } from "./libFixture";
import { buildLibraryIndex } from "./library";
import { newPlaybookSpec } from "./playbook";
import { addPlayProblem, addPlayToSpec, assignAudible, formationAddressProblem, locatePlay, nameAddressProblem } from "./playbookOps";
import { bookFormation, playbookIssues, resolvePlaybook } from "./resolveBook";
import { templateContents, type TemplateContents } from "./tdb";
import type { PlaybookSpec, SetsFile } from "./types";

const lib = buildLibraryIndex(loadLibraryData());
const playsDocs = [loadPlaysDoc("art-test.json"), loadPlaysDoc("pbs-ytrips-v1.json")];
const cat = buildCatalog(lib, playsDocs);
const book = (name: string): PlaybookSpec =>
  JSON.parse(readFileSync(new URL(`../../../playbooks/${name}`, import.meta.url), "utf8"));
const setsDoc = (name: string): { path: string; data: SetsFile } => ({
  path: `playbooks/sets/${name}`,
  data: JSON.parse(readFileSync(new URL(`../../../playbooks/sets/${name}`, import.meta.url), "utf8")),
});

const SET = "football/Gameplay/playbooks/PlayLibrary/Formations/Offense/Shotgun/Y_Trips_Wk/";
const FORMS = "football/Gameplay/playbooks/PlayLibrary/Formations/";
const tc = templateContents(new Uint8Array(readFileSync(new URL("../../../playbooks/templates/PBOOKOFF-TEMPLATE", import.meta.url))), lib);

// Catalog overlay: custom formations/sets/clones from playbooks/sets/ (buildCatalog's sets docs).
const TIGHT = FORMS + "Offense/Shotgun/PBS_Y_Trips_Tight_Wk/PBS_Y_Trips_Tight_Wk";
const ocat: Catalog = buildCatalog(lib, playsDocs, [setsDoc("pbs-sets-v1.json")]);

describe("resolvePlaybook", () => {
  it("resolves every play of studio-lib (library only) by the playbook side", () => {
    const rb = resolvePlaybook(book("studio-lib.json"), cat);
    expect(rb.counts.unresolved).toBe(0);
    for (const f of rb.formations) {
      expect(f.formation, f.entry.formation).toBeDefined();
      for (const s of f.sets) for (const p of s.plays) expect(p.play, p.entry.play).toBeDefined();
    }
    // Offense "Special" is the punt/FG unit (formId 12) — the one the template save holds.
    expect(rb.formations.find((f) => f.entry.formation === "Special")!.formation?.formId).toBe(12);
  });

  it("resolves studio-test's custom formation, custom sets and clones through the overlay", () => {
    const rb = resolvePlaybook(book("studio-test.json"), ocat, { template: tc });
    expect(rb.counts.unresolved).toBe(0);
    const gun = rb.formations.find((f) => f.entry.formation === "Gun PBS")!;
    expect(gun).toMatchObject({ custom: true, template: false });
    expect(gun.problem).toBeUndefined();
    const tight = rb.formations[0].sets.find((s) => s.entry.set === "Y Trips Tight Wk")!;
    expect(tight.custom).toBe(true);
    expect(tight.set?.asset).toBe(TIGHT);
    expect(tight.plays.map((p) => p.play?.source)).toEqual(["custom", "custom", "custom", "custom"]);
    // 11 custom plays + 7 clones; Gun PBS + Y Trips Tight Wk are custom.
    expect(rb.counts).toMatchObject({ custom: 18, customFormations: 1, customSets: 2, templateFormations: 4, plays: 26 });
    // = tools/pbook-build.mjs on the game PC's research/index (custom-*.tsv): "6 formations, 18 sets, 77 plays, 64 AI rows".
    expect(rb.counts.saveRows).toMatchObject({ formations: 6, sets: 18, plays: 77, cpuRows: 64 });
  });

  it("counts every row the save gets with the template (= tools/pbook-build.mjs output)", () => {
    // Verified against the real script: "wrote PBOOKOFF-STUDIOLIB: 5 formations, 16 sets, 60 plays, 57 AI rows".
    const rb = resolvePlaybook(book("studio-lib.json"), cat, { template: tc });
    expect(rb.counts.saveRows).toMatchObject({ formations: 5, sets: 16, plays: 60, cpuRows: 57 });
    expect(rb.formations.find((f) => f.entry.formation === "Special")!.templateRows).toEqual({ sets: 5, plays: 18, cpuRows: 21, formId: 12 });
  });

  it("finds no errors in the example playbooks", () => {
    expect(playbookIssues(book("studio-lib.json"), cat, "studio-lib.json", { template: tc }).filter((i) => i.level === "error")).toEqual([]);
  });

  it("finds no errors in studio-test (custom sets + clones) with the overlay", () => {
    const issues = playbookIssues(book("studio-test.json"), ocat, "studio-test.json", { template: tc });
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    const mod = issues.filter((i) => i.rule === "needs-mod");
    // One per play: 11 custom plays + 7 clones + Gun Bunch Mesh (pulled) = counts.custom + counts.pulled.
    expect(mod).toHaveLength(19);
    // Plus one note for the custom formation and one for the custom set in a stock formation.
    expect(issues.filter((i) => i.rule === "custom-formation").map((i) => i.where)).toEqual(["/formations/1"]);
    expect(issues.filter((i) => i.rule === "custom-set").map((i) => i.where)).toEqual(["/formations/0/sets/1"]);
    expect(mod.some((i) => /"PBS T Curls" is cloned into the custom set Y Trips Tight Wk/.test(i.message))).toBe(true);
  });

  it("reports bad names, duplicate audibles, unknown plays and CPU keys", () => {
    const spec: PlaybookSpec = {
      name: "bad name!",
      side: "offense",
      formations: [
        {
          formation: "Shotgun",
          sets: [
            {
              set: "Y Trips Wk",
              plays: [
                { play: "Slants", audible: 1 },
                { play: "Curls", audible: 1, cpu: { Nope: 10, FirstDown: 140 } },
                { play: "Not A Real Play" },
              ],
            },
          ],
        },
      ],
    };
    const rules = playbookIssues(spec, cat).map((i) => i.rule);
    expect(rules).toEqual(
      expect.arrayContaining(["book-name", "audible-duplicate", "play-unknown", "cpu-key", "cpu-weight", "special-teams"]),
    );
  });
});

describe("playbookOps", () => {
  it("adds a library play into an existing set and refuses duplicates", () => {
    const spec = book("studio-lib.json");
    const key = SET + "Curls";
    expect(locatePlay(spec, cat, key)).toBeUndefined();
    const r = addPlayToSpec(spec, cat, key, { audible: 1 });
    expect(r.added).toBe(true);
    expect(spec.formations[r.f].formation).toBe("Shotgun");
    expect(locatePlay(spec, cat, key)).toEqual({ f: r.f, s: r.s, p: r.p });
    expect(addPlayToSpec(spec, cat, key).added).toBe(false);
  });

  it("creates formation and set entries before the template sections", () => {
    const spec = book("studio-lib.json");
    const close = lib.data.plays.find((p) => p.asset.endsWith("/I_Form/Close/Power_O"))!;
    const r = addPlayToSpec(spec, cat, close.asset);
    expect(spec.formations[r.f].formation).toBe("I Form");
    expect(spec.formations[r.f + 1].sets).toBe("template");
    expect((spec.formations[r.f].sets as { set: string }[])[r.s].set).toBe("Close");
  });

  it("explains plays that can't be addressed by name", () => {
    // The MG_Screen minigame formation is also called "Shotgun"; pbook-build picks Offense/Shotgun.
    const mg = lib.data.formations.find((f) => f.asset.includes("/Offense/MG_Screen/"))!;
    const set = lib.setsByFormation.get(mg.asset)?.[0];
    const play = set && lib.playsBySet.get(set.asset)?.[0];
    expect(play).toBeDefined();
    if (play) expect(nameAddressProblem(cat, play.asset, "offense")).toMatch(/shares its name with Offense\/Shotgun \(formId 1\)/);
  });

  it("keeps one play per audible slot", () => {
    const set = { set: "X", plays: [{ play: "A", audible: 2 as const }, { play: "B" }] };
    assignAudible(set, 1, 2);
    expect(set.plays[0].audible).toBeUndefined();
    expect(set.plays[1].audible).toBe(2);
  });

  it("adds plays cloned into custom sets (custom formations included)", () => {
    const spec = newPlaybookSpec("X");
    const curls = ocat.playInSetByName(TIGHT, "PBS T Curls")!;
    expect(addPlayProblem(spec, ocat, curls.key)).toBeUndefined();
    const r = addPlayToSpec(spec, ocat, curls.key, { audible: 1 });
    expect(spec.formations[r.f]).toMatchObject({ formation: "Shotgun", sets: [{ set: "Y Trips Tight Wk", plays: [{ play: "PBS T Curls", audible: 1 }] }] });
    const open = FORMS + "Offense/PBS_Gun/PBS_Trips_Open/PBS_Trips_Open";
    const draw = ocat.playInSetByName(open, "PBS O HB Draw")!;
    const r2 = addPlayToSpec(spec, ocat, draw.key);
    expect(spec.formations[r2.f]).toMatchObject({ formation: "Gun PBS", sets: [{ set: "Trips Open", plays: [{ play: "PBS O HB Draw" }] }] });
    expect(playbookIssues(spec, ocat, undefined, { template: tc }).filter((i) => i.level === "error")).toEqual([]);
  });
});

// The game-side builder (tools/pbook-build.mjs, commit ac54574) is the contract: these tests mirror what it does with a
// spec, verified against the real script on sandbox copies (formation names resolve BY SIDE, preferring the template's
// formations; template sections copy by formId and throw when there is nothing to copy; template CPU rows are inherited;
// capacity overflow throws).
describe("game-side rules (tools/pbook-build.mjs)", () => {
  const PUNT_FAKE = FORMS + "Offense/Special/Punt/Fake_Punt_Dive";
  const GL_COUNTER = FORMS + "Offense/Goal_Line_Offense/Normal/HB_Counter_Wk";

  it("resolves formation names by the playbook side", () => {
    expect(bookFormation(lib, "Special", "offense")?.formId).toBe(12);
    expect(bookFormation(lib, "Special", "defense")?.formId).toBe(20);
    expect(bookFormation(lib, "Kickoff", "offense")?.formId).toBe(6); // FormationType_Kickoff belongs to offense books
    expect(bookFormation(lib, "Kickoff", "defense")).toBeUndefined();
    expect(bookFormation(lib, "Kick Return", "offense")).toBeUndefined(); // pbook-build: unknown formation "Kick Return"
    expect(bookFormation(lib, "Nickel", "offense")).toBeUndefined();
    expect(bookFormation(lib, " shotgun ", "offense")?.asset).toBe(FORMS + "Offense/Shotgun/Shotgun");
  });

  it("prefers a same-named formation the template save contains (then the folder leaf)", () => {
    const mg = lib.data.formations.find((f) => f.asset.includes("/Offense/MG_Screen/"))!;
    const fake = { formations: [], formIds: [mg.formId], unresolved: [], unknownSituations: 0 } as TemplateContents;
    expect(bookFormation(lib, "Shotgun", "offense", { template: fake })?.asset).toBe(mg.asset);
    expect(bookFormation(lib, "Shotgun", "offense", { template: tc })?.formId).toBe(1);
    expect(tc.formIds).toEqual([11, 206, 3, 13, 1, 103, 10, 132, 12, 6, 8]);
  });

  it("lets offense special-teams plays be listed explicitly", () => {
    expect(nameAddressProblem(cat, PUNT_FAKE, "offense")).toBeUndefined();
    const spec: PlaybookSpec = { name: "X", side: "offense", formations: [] };
    const r = addPlayToSpec(spec, cat, PUNT_FAKE);
    expect(spec.formations[r.f]).toEqual({ formation: "Special", sets: [{ set: "Punt", plays: [{ play: "Fake Punt Dive" }] }] });
    // pbook-build: "wrote …: 1 formations, 1 sets, 1 plays, 0 AI rows".
    expect(resolvePlaybook(spec, cat, { template: tc }).counts.saveRows).toMatchObject({ formations: 1, sets: 1, plays: 1, cpuRows: 0 });
    expect(playbookIssues(spec, cat, undefined, { template: tc }).filter((i) => i.level === "error")).toEqual([]);
    // A defense book's "Special" is Defense/Special (returns, blocks).
    const block = lib.data.plays.find((p) => p.asset.startsWith(FORMS + "Defense/Special/"))!;
    expect(nameAddressProblem(cat, block.asset, "defense")).toBeUndefined();
  });

  it("refuses formations of the other side (pbook-build only sees the book's side)", () => {
    const nickel = lib.formationByName("Nickel", "defense")!;
    expect(formationAddressProblem(lib, nickel, "offense")).toBe("Nickel is a defense formation — it can't go in an offense playbook");
    expect(formationAddressProblem(lib, nickel)).toBeUndefined(); // default: its own side
    const nickelPlay = lib.data.plays.find((p) => lib.formationOfSet(p.set)?.asset === nickel.asset)!;
    expect(addPlayProblem(newPlaybookSpec("X"), cat, nickelPlay.asset)).toMatch(/defense formation/);
    const spec: PlaybookSpec = { name: "X", side: "offense", formations: [{ formation: "Nickel", sets: [{ set: "Normal", plays: [] }] }] };
    const rf = resolvePlaybook(spec, cat).formations[0];
    expect(rf.formation).toBeUndefined();
    expect(rf.wrongSide?.formId).toBe(17);
    const issue = playbookIssues(spec, cat).find((i) => i.rule === "formation-side")!;
    expect(issue).toMatchObject({ level: "error", where: "/formations/0" });
    expect(issue.message).toMatch(/"Nickel" is a defense formation/);
  });

  it("makes a template section the template has no sets for an error (pbook-build throws)", () => {
    const spec: PlaybookSpec = { name: "X", side: "offense", formations: [{ formation: "Strong I", sets: "template" }, ...newPlaybookSpec("X").formations] };
    const rb = resolvePlaybook(spec, cat, { template: tc });
    expect(rb.formations[0]).toMatchObject({ templateMissing: true, templateRows: { sets: 0, plays: 0, cpuRows: 0, formId: 4 } });
    expect(rb.formations[0].problem).toBe('"Strong I" (formId 4) has no sets in the template, so "template" would drop it');
    const issue = playbookIssues(spec, cat, undefined, { template: tc }).find((i) => i.rule === "template-empty")!;
    expect(issue).toMatchObject({ level: "error", where: "/formations/0" });
    expect(issue.message).toContain('"Strong I" (formId 4) has no sets in the template');
    // Defense "Special" (formId 20) isn't in the offense template save either.
    const def: PlaybookSpec = { name: "D", side: "defense", formations: [{ formation: "Special", sets: "template" }] };
    expect(playbookIssues(def, cat, undefined, { template: tc }).find((i) => i.rule === "template-empty")?.level).toBe("error");
    // No template contents: unknowable for stock formations, so no issue.
    expect(playbookIssues(spec, cat).some((i) => i.rule === "template-empty")).toBe(false);
    // Nothing about the old "Special" ambiguity anymore.
    expect(playbookIssues(newPlaybookSpec("X"), cat, undefined, { template: tc }).some((i) => i.rule === "formation-ambiguous" || i.rule === "template-empty")).toBe(false);
  });

  it("makes a custom formation as a template section an error even without the template", () => {
    const spec: PlaybookSpec = { name: "X", side: "offense", formations: [{ formation: "Gun PBS", sets: "template" }] };
    const rf = resolvePlaybook(spec, ocat).formations[0];
    expect(rf).toMatchObject({ custom: true, templateMissing: true });
    expect(playbookIssues(spec, ocat).find((i) => i.rule === "template-empty")?.message).toMatch(/custom formation/);
  });

  it("refuses adding into a formation the book holds as a template section", () => {
    const spec = newPlaybookSpec("X");
    expect(addPlayProblem(spec, cat, GL_COUNTER)).toBe('Convert Goal Line Offense to explicit first (it\'s a "template" section in this playbook)');
    expect(() => addPlayToSpec(spec, cat, GL_COUNTER)).toThrow(/Convert Goal Line Offense to explicit first/);
    expect(addPlayProblem(spec, cat, PUNT_FAKE)).toMatch(/Convert Special to explicit first/);
    expect(spec.formations).toHaveLength(4);
    const explicitGl = { ...spec, formations: [{ formation: "Goal Line Offense", sets: [] }] } as PlaybookSpec;
    expect(addPlayToSpec(explicitGl, cat, GL_COUNTER).added).toBe(true);
  });

  it("counts inherited template CPU rows, and overflow is an error", () => {
    // Explicit plays without cpu inherit the template's PBAI rows (TE Attack has RedZoneFringe in the stock save).
    const spec: PlaybookSpec = {
      name: "X",
      side: "offense",
      formations: [
        { formation: "Singleback", sets: [{ set: "Wing Pair", plays: [{ play: "TE Attack" }, { play: "TE Attack", cpu: { FirstDown: 5, GoalLine: 5 } }] }] },
        ...newPlaybookSpec("X").formations,
      ],
    };
    const rb = resolvePlaybook(spec, cat, { template: tc });
    expect(rb.counts.cpuRows).toBe(2); // explicit only (unchanged meaning)
    const gl = rb.formations.find((f) => f.entry.formation === "Goal Line Offense")!.templateRows!;
    expect(gl.sets).toBeGreaterThan(0);
    expect(rb.counts.saveRows!.inheritedCpuRows).toBe(1);
    expect(rb.counts.saveRows!.cpuRows).toBe(2 + 1 + rb.counts.saveRows!.template.cpuRows);
    expect(rb.limits).toEqual({ formations: 40, sets: 75, plays: 750, cpuRows: 2200 });
    expect(resolvePlaybook(spec, cat).counts.saveRows).toBeUndefined();

    // 61 explicit sets + the default template sections (1 + 5 + 5 + 3 = 14) = 75 rows: fits. 62 → 76 overflows.
    const big = newPlaybookSpec("BIG");
    const shotgun = lib.formationByName("Shotgun", "offense")!;
    const sets = lib.setsByFormation.get(shotgun.asset)!.filter((st) => lib.setByName(shotgun, st.name)?.asset === st.asset);
    const entries = [];
    for (let i = 0; entries.length < 62; i++) {
      const st = sets[i % sets.length];
      const play = lib.playsBySet.get(st.asset)![0];
      entries.push({ set: st.name, plays: [{ play: play.name }] });
    }
    big.formations.unshift({ formation: "Shotgun", sets: entries });
    const withTpl = playbookIssues(big, cat, undefined, { template: tc }).find((i) => i.rule === "cap-sets")!;
    expect(withTpl.level).toBe("error");
    expect(withTpl.message).toMatch(/^76 sets incl\. template sections .*STID: 76 rows exceeds capacity 75/);
    expect(playbookIssues(big, cat).find((i) => i.rule === "cap-sets")).toBeUndefined(); // without the template: 62 explicit sets only
  });

  it("checks audible slots per in-game set across entries and template sections", () => {
    const spec: PlaybookSpec = {
      name: "X",
      side: "offense",
      formations: [
        { formation: "Shotgun", sets: [{ set: "Y Trips Wk", plays: [{ play: "Slants", audible: 1 }] }] },
        { formation: "Shotgun", sets: [{ set: "Y Trips Wk", plays: [{ play: "Curls", audible: 1 }] }] },
        { formation: "Singleback", sets: [{ set: "Wing Pair", plays: [{ play: "HB Dive", audible: 3 }] }] },
        { formation: "Singleback", sets: "template" },
      ],
    };
    const dup = playbookIssues(spec, cat, undefined, { template: tc }).filter((i) => i.rule === "audible-duplicate");
    expect(dup.map((i) => [i.level, i.where])).toEqual([
      ["error", "/formations/1/sets/0/plays/0"],
      ["error", "/formations/2/sets/0/plays/0"],
    ]);
    expect(dup[1].message).toMatch(/also used by "TE Attack" \(the "Singleback" template section\)/);
    // addPlayToSpec drops an audible slot the in-game set already uses.
    const book2: PlaybookSpec = { name: "X", side: "offense", formations: [{ formation: "Shotgun", sets: [{ set: "Y Trips Wk", plays: [{ play: "Slants", audible: 1 }] }] }] };
    const r = addPlayToSpec(book2, cat, SET + "Curls", { audible: 1 });
    expect(r).toMatchObject({ added: true, audibleDropped: true });
    expect((book2.formations[0].sets as { plays: { audible?: number }[] }[])[0].plays[1].audible).toBeUndefined();
  });

  it("never throws on wrong-shaped specs and reports every malformed level", () => {
    const shapes: unknown[] = [
      null,
      { name: 5, formations: { x: 1 } },
      { name: "A", side: "offense", formations: [null, 3, { formation: "Shotgun", sets: [null, { set: "Bunch", plays: { a: 1 } }, { set: "Y Trips Wk", plays: [null, "x", { play: 7 }] }] }] },
      { name: "B", side: "offense", formations: [{ formation: 42, sets: "template" }, { formation: null, sets: [] }] },
    ];
    for (const sh of shapes) {
      expect(() => resolvePlaybook(sh as PlaybookSpec, cat, { template: tc })).not.toThrow();
      expect(() => playbookIssues(sh as PlaybookSpec, cat, "f", { template: tc })).not.toThrow();
      expect(() => locatePlay(sh as PlaybookSpec, cat, SET + "Curls")).not.toThrow();
      expect(() => addPlayProblem(sh as PlaybookSpec, cat, SET + "Curls")).not.toThrow();
    }
    expect(resolvePlaybook(shapes[1] as PlaybookSpec, cat).malformed).toBe('"formations" must be an array');
    const rb = resolvePlaybook(shapes[2] as PlaybookSpec, cat);
    expect(rb.formations).toHaveLength(3); // aligned with spec.formations indices
    expect(rb.formations[0].malformed).toMatch(/must be an object/);
    const issues = playbookIssues(shapes[2] as PlaybookSpec, cat).filter((i) => i.rule === "book-shape");
    expect(issues.map((i) => i.where)).toEqual([
      "/formations/0",
      "/formations/1",
      "/formations/2/sets/0",
      "/formations/2/sets/1",
      "/formations/2/sets/2/plays/0",
      "/formations/2/sets/2/plays/1",
      "/formations/2/sets/2/plays/2",
    ]);
    expect(playbookIssues(shapes[0] as PlaybookSpec, cat).map((i) => i.rule)).toEqual(["book-shape"]);
  });
});
