import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { buildCatalog } from "./catalog";
import {
  COLOR_SWATCHES,
  SEED_CATEGORIES,
  acceptSuggestions,
  addCategory,
  bookPlayRefs,
  canNest,
  categoryCoverage,
  categoryNameError,
  conceptIndex,
  conceptMatrix,
  deleteCategory,
  dismissSuggestion,
  dismissedCount,
  expandedTags,
  forgetPlays,
  hslToHex,
  indentCategory,
  isHexColor,
  matchKey,
  matchesCategories,
  moveCategory,
  moveCategoryBy,
  nestTargets,
  nextColor,
  orphanKeys,
  outdentCategory,
  restoreDismissed,
  seedConcepts,
  setCategoryColor,
  setNote,
  setTagOnPlays,
  situationCounts,
  situationPlays,
  slugify,
  suggestTags,
  tagCounts,
  tagState,
  tagUsage,
  toggleTag,
  toggleTagOnPlays,
  uniqueCategoryId,
  untaggedPlays,
  type SuggestInput,
} from "./concepts";
import { loadLibraryData, loadPlaysDoc, studioV1 } from "./libFixture";
import { buildLibraryIndex } from "./library";
import { resolvePlaybook } from "./resolveBook";
import type { ConceptsDoc } from "./types";

const lib = buildLibraryIndex(loadLibraryData());
const cat = buildCatalog(lib, [loadPlaysDoc("art-test.json"), loadPlaysDoc("pbs-ytrips-v1.json")]);

const edit = (doc: ConceptsDoc, recipe: (d: ConceptsDoc) => void) => produce(doc, recipe);
const ids = (doc: ConceptsDoc) => doc.categories.map((c) => c.id);
const firstPlay = (name: string) => {
  const p = lib.data.plays.find((x) => x.name === name && lib.formationSide(lib.formationByAsset.get(lib.setByAsset.get(x.set)!.formation)!) === "offense");
  if (!p) throw new Error(`no play ${name}`);
  return cat.get(p.asset)!;
};
const suggestedNames = (input: SuggestInput, doc: ConceptsDoc, key?: string) => suggestTags(input, doc, { key }).map((s) => s.category.name);

describe("seed + ids + colors", () => {
  it("seeds every default category with unique slug ids and distinct hex colors", () => {
    const doc = seedConcepts();
    const total = SEED_CATEGORIES.pass.length + SEED_CATEGORIES.run.length + SEED_CATEGORIES.other.length;
    expect(doc.version).toBe(1);
    expect(doc.categories).toHaveLength(total);
    expect(new Set(ids(doc)).size).toBe(total);
    expect(doc.categories.every((c) => isHexColor(c.color))).toBe(true);
    expect(new Set(doc.categories.map((c) => c.color)).size).toBe(total);
    expect(doc.categories.find((c) => c.name === "Y-Cross")?.id).toBe("y-cross");
    expect(doc.categories.find((c) => c.name === "Four Verticals")?.group).toBe("pass");
    expect(doc.categories.find((c) => c.name === "QB Run")?.group).toBe("run");
    expect(doc.categories.find((c) => c.name === "Two-minute")?.group).toBe("other");
    expect(doc.tags).toEqual({});
  });

  it("slugs and unique ids", () => {
    expect(slugify("Curl-Flat")).toBe("curl-flat");
    expect(slugify("  Four   Verticals!! ")).toBe("four-verticals");
    expect(slugify("Écran")).toBe("ecran");
    expect(slugify("!!!")).toBe("category");
    const doc = seedConcepts();
    expect(uniqueCategoryId(doc, "Mesh")).toBe("mesh-2");
    expect(uniqueCategoryId(doc, "Bunch Mesh")).toBe("bunch-mesh");
  });

  it("colors", () => {
    expect(hslToHex(0, 100, 50)).toBe("#ff0000");
    expect(hslToHex(120, 100, 25)).toBe("#008000");
    expect(hslToHex(240, 100, 50)).toBe("#0000ff");
    expect(COLOR_SWATCHES).toHaveLength(48);
    expect(new Set(COLOR_SWATCHES).size).toBe(48);
    const doc = seedConcepts();
    const c = nextColor(doc, "pass");
    expect(isHexColor(c)).toBe(true);
    expect(doc.categories.some((x) => x.color === c)).toBe(false);
  });

  it("name validation", () => {
    const doc = seedConcepts();
    expect(categoryNameError(doc, "")).toMatch(/empty/);
    expect(categoryNameError(doc, "y cross")).toMatch(/Y-Cross/);
    expect(categoryNameError(doc, "Y-Cross", "y-cross")).toBeUndefined();
    expect(categoryNameError(doc, "Bunch")).toBeUndefined();
    expect(matchKey("Curl-Flat")).toBe(matchKey("curl flat"));
  });
});

describe("tree + nesting", () => {
  it("builds the tree by group, nests, and refuses cycles", () => {
    let doc = seedConcepts();
    doc = edit(doc, (d) => {
      const quick = addCategory(d, { name: "Quick Game", group: "pass" });
      expect(moveCategory(d, "slants", { group: "pass", parent: quick.id })).toBe(true);
      expect(moveCategory(d, "stick", { group: "pass", parent: quick.id })).toBe(true);
      // Can't nest a category under its own descendant.
      expect(moveCategory(d, quick.id, { group: "pass", parent: "slants" })).toBe(false);
      expect(moveCategory(d, quick.id, { group: "pass", parent: quick.id })).toBe(false);
    });
    const ix = conceptIndex(doc);
    const quickNode = ix.node("quick-game")!;
    expect(quickNode.childCount).toBe(2);
    expect(ix.node("slants")?.depth).toBe(1);
    expect(ix.node("slants")?.parent).toBe("quick-game");
    const passOrder = ix.byGroup.pass.map((n) => n.cat.id);
    expect(passOrder.indexOf("stick")).toBe(passOrder.indexOf("slants") + 1); // children follow array order
    expect(passOrder.indexOf("slants")).toBe(passOrder.indexOf("quick-game") + 1);
    expect([...ix.descendantsOrSelf("quick-game")].sort()).toEqual(["quick-game", "slants", "stick"]);
    expect(ix.ancestorsOrSelf("stick")).toEqual(["stick", "quick-game"]);
    expect(canNest(doc, "quick-game", "stick")).toBe(false);
    expect(canNest(doc, "stick", "mesh")).toBe(true);
    expect(nestTargets(doc, "quick-game").some((n) => n.cat.id === "stick")).toBe(false);
  });

  it("moving under a parent of another group moves the subtree into that group", () => {
    const doc = edit(seedConcepts(), (d) => {
      moveCategory(d, "slants", { group: "pass", parent: "mesh" });
      moveCategory(d, "mesh", { group: "other", parent: "screens" });
    });
    const byId = new Map(doc.categories.map((c) => [c.id, c]));
    expect(byId.get("mesh")?.group).toBe("other");
    expect(byId.get("slants")?.group).toBe("other");
    expect(conceptIndex(doc).node("slants")?.depth).toBe(2);
  });

  it("keeps the categories array in display order when nesting and moving between groups", () => {
    const doc = edit(seedConcepts(), (d) => {
      moveCategory(d, "spot", { group: "pass", parent: "snag" }); // childless parent: right after it
      moveCategory(d, "rpo", { group: "run", parent: null }); // to another group: end of that group
    });
    const order = ids(doc);
    expect(order.indexOf("spot")).toBe(order.indexOf("snag") + 1);
    expect(order.indexOf("rpo")).toBe(order.indexOf("qb-run") + 1);
    expect(doc.categories.find((c) => c.id === "rpo")?.group).toBe("run");
    expect(conceptIndex(doc).tree.map((n) => n.cat.id)).toEqual(order);
  });

  it("tolerates hand-edited cycles and cross-group parents", () => {
    const doc: ConceptsDoc = {
      version: 1,
      categories: [
        { id: "a", name: "A", group: "pass", color: "#ffffff", parent: "b" },
        { id: "b", name: "B", group: "pass", color: "#ffffff", parent: "a" },
        { id: "c", name: "C", group: "pass", color: "#ffffff", parent: "a" },
        { id: "d", name: "D", group: "run", color: "#ffffff", parent: "c" },
        { id: "e", name: "E", group: "pass", color: "#ffffff", parent: "missing" },
      ],
      tags: {},
    };
    const ix = conceptIndex(doc);
    expect(ix.tree.map((n) => n.cat.id).sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(ix.node("a")?.depth).toBe(0);
    expect(ix.node("b")?.depth).toBe(0);
    expect(ix.node("c")?.parent).toBe("a");
    expect(ix.node("d")?.depth).toBe(0); // cross-group parent → top level of its own group
    expect(ix.node("e")?.depth).toBe(0);
  });

  it("reorders, indents and outdents", () => {
    let doc = edit(seedConcepts(), (d) => {
      expect(moveCategoryBy(d, "snag", -1)).toBe(true);
      expect(moveCategoryBy(d, "snag", -1)).toBe(false); // already first
    });
    expect(conceptIndex(doc).byGroup.pass.slice(0, 2).map((n) => n.cat.id)).toEqual(["snag", "mesh"]);
    doc = edit(doc, (d) => {
      expect(indentCategory(d, "mesh")).toBe(true); // under the previous sibling (snag)
      expect(indentCategory(d, "snag")).toBe(false);
    });
    expect(conceptIndex(doc).parentOf("mesh")).toBe("snag");
    doc = edit(doc, (d) => {
      expect(outdentCategory(d, "mesh")).toBe(true);
      expect(outdentCategory(d, "mesh")).toBe(false);
    });
    const pass = conceptIndex(doc).byGroup.pass.map((n) => n.cat.id);
    expect(conceptIndex(doc).parentOf("mesh")).toBeUndefined();
    expect(pass.indexOf("mesh")).toBe(pass.indexOf("snag") + 1);
  });

  it("deletes with tag cleanup; children move up or go along", () => {
    let doc = edit(seedConcepts(), (d) => {
      const g = addCategory(d, { name: "Gap", group: "run" });
      moveCategory(d, "power", { group: "run", parent: g.id });
      moveCategory(d, "counter", { group: "run", parent: g.id });
      toggleTag(d, "k1", "power");
      toggleTag(d, "k1", g.id);
      toggleTag(d, "k2", "gap");
      dismissSuggestion(d, "k3", "gap");
    });
    expect(tagUsage(doc, "gap")).toEqual({ plays: 2, refs: 2 });
    expect(tagUsage(doc, "gap", true)).toEqual({ plays: 2, refs: 3 });
    const kept = edit(doc, (d) => {
      const r = deleteCategory(d, "gap");
      expect(r).toEqual({ removed: ["gap"], tagsRemoved: 2, playsTouched: 2 });
    });
    expect(kept.categories.some((c) => c.id === "gap")).toBe(false);
    expect(kept.categories.find((c) => c.id === "power")?.parent).toBeUndefined();
    expect(kept.tags).toEqual({ k1: ["power"] });
    expect(kept.dismissed).toEqual({});
    const all = edit(doc, (d) => {
      const r = deleteCategory(d, "gap", { withDescendants: true });
      expect(r.removed.sort()).toEqual(["counter", "gap", "power"]);
    });
    expect(all.categories.some((c) => c.id === "power")).toBe(false);
    expect(all.tags).toEqual({});
  });

  it("renames and recolors only valid values", () => {
    const doc = edit(seedConcepts(), (d) => {
      expect(setCategoryColor(d, "mesh", "red")).toBe(false);
      expect(setCategoryColor(d, "mesh", "#AABBCC")).toBe(true);
    });
    expect(doc.categories.find((c) => c.id === "mesh")?.color).toBe("#aabbcc");
  });
});

describe("tags + notes", () => {
  it("toggles single and bulk tags, keeping category order and dropping empty lists", () => {
    let doc = edit(seedConcepts(), (d) => {
      toggleTag(d, "p1", "dagger");
      toggleTag(d, "p1", "mesh");
      expect(toggleTag(d, "p1", "mesh", true)).toBe(true);
    });
    expect(doc.tags.p1).toEqual(["mesh", "dagger"]);
    doc = edit(doc, (d) => {
      expect(setTagOnPlays(d, ["p1", "p2", "p3", "p2"], "mesh", true)).toBe(2);
    });
    expect(tagState(doc, ["p1", "p2", "p3"], "mesh")).toBe("all");
    expect(tagState(doc, ["p1", "p4"], "mesh")).toBe("some");
    expect(tagState(doc, ["p4"], "mesh")).toBe("none");
    doc = edit(doc, (d) => {
      expect(toggleTagOnPlays(d, ["p1", "p2", "p3"], "mesh")).toBe(false); // all had it → remove
      expect(toggleTagOnPlays(d, ["p1", "p4"], "dagger")).toBe(true); // some → add to all
    });
    expect(doc.tags).toEqual({ p1: ["dagger"], p4: ["dagger"] });
  });

  it("counts with ancestors, filters by category with descendants", () => {
    const doc = edit(seedConcepts(), (d) => {
      const q = addCategory(d, { name: "Quick", group: "pass" });
      moveCategory(d, "slants", { group: "pass", parent: q.id });
      toggleTag(d, "a", "slants");
      toggleTag(d, "b", "quick");
      toggleTag(d, "b", "slants");
      toggleTag(d, "c", "mesh");
    });
    const counts = tagCounts(doc);
    expect(counts.get("quick")).toBe(2); // a (via slants) and b, once each
    expect(counts.get("slants")).toBe(2);
    expect(counts.get("mesh")).toBe(1);
    expect([...expandedTags(doc, "a")].sort()).toEqual(["quick", "slants"]);
    expect(matchesCategories(doc, "a", ["quick"])).toBe(true);
    expect(matchesCategories(doc, "c", ["quick"])).toBe(false);
    expect(matchesCategories(doc, "c", [])).toBe(true);
  });

  it("notes, orphans and forgetting plays", () => {
    let doc = edit(seedConcepts(), (d) => {
      setNote(d, "x", "Beats cover 3");
      setNote(d, "y", "   ");
      toggleTag(d, "gone", "mesh");
    });
    expect(doc.notes).toEqual({ x: "Beats cover 3" });
    expect(orphanKeys(doc, (k) => k !== "gone")).toEqual(["gone"]);
    doc = edit(doc, (d) => {
      setNote(d, "x", "");
      forgetPlays(d, ["gone"]);
    });
    expect(doc.notes).toEqual({});
    expect(doc.tags).toEqual({});
  });

  it("works on a doc without tags/notes (hand-written file)", () => {
    const bare = { version: 1, categories: seedConcepts().categories } as unknown as ConceptsDoc;
    const doc = edit(bare, (d) => {
      toggleTag(d, "k", "mesh");
      setNote(d, "k", "n");
    });
    expect(doc.tags).toEqual({ k: ["mesh"] });
    expect(doc.notes).toEqual({ k: "n" });
  });
});

describe("suggestions", () => {
  const doc = seedConcepts();

  it("suggests from read concepts, play type, routes and name with reasons", () => {
    const mesh = firstPlay("Mesh");
    const s = suggestTags(mesh, doc, { key: mesh.key });
    const m = s.find((x) => x.category.id === "mesh")!;
    expect(m).toBeDefined();
    expect(m.reasons[0].source).toBe("concept");
    expect(m.reasons.map((r) => r.source)).toEqual(expect.arrayContaining(["concept", "route", "name"]));
    expect(m.reasons[0].text).toMatch(/Read concept Mesh \(slots 3, 5\)/);

    const iz = firstPlay("Inside Zone");
    const izs = suggestTags(iz, doc, { key: iz.key });
    expect(izs[0].category.id).toBe("inside-zone");
    expect(izs[0].reasons.map((r) => r.source)).toEqual(["playType", "name"]);

    expect(suggestedNames(firstPlay("Four Verticals"), doc)).toContain("Four Verticals");
    expect(suggestedNames(firstPlay("Slants"), doc)).toContain("Slants");
    expect(suggestedNames(firstPlay("HB Slip Screen"), doc)).toContain("Screens");
    expect(suggestedNames(firstPlay("HB Toss"), doc)).toEqual(expect.arrayContaining(["Toss", "Sweep"]));
    expect(suggestedNames(firstPlay("Counter Y"), doc)).toContain("Counter");
    expect(suggestedNames(firstPlay("Read Option"), doc)).toContain("Option");
    expect(suggestedNames(firstPlay("RPO Alert Bubble"), doc)).toEqual(expect.arrayContaining(["RPO", "Screens"]));
    expect(suggestedNames(firstPlay("PA Power O"), doc)).toContain("Play Action");
    expect(suggestedNames(firstPlay("Reverse"), doc)).toContain("Trick");
    expect(suggestedNames(firstPlay("HB Dive"), doc)).toContain("Dive");
  });

  it("covers the spec's play-type and concept table", () => {
    const cases: [string, string[], string][] = [
      ["OffensePlayType_RunInsideZone", [], "Inside Zone"],
      ["OffensePlayType_RunOutsideZone", [], "Outside Zone"],
      ["OffensePlayType_RunPower", [], "Power"],
      ["OffensePlayType_RunCounter", [], "Counter"],
      ["OffensePlayType_RunTrap", [], "Trap"],
      ["OffensePlayType_RunDraw", [], "Draw"],
      ["OffensePlayType_RunISO", [], "ISO"],
      ["OffensePlayType_RunSweep", [], "Sweep"],
      ["OffensePlayType_RunPitch", [], "Toss"],
      ["OffensePlayType_QBRun", [], "QB Run"],
      ["OffensePlayType_QBSneak", [], "QB Run"],
      ["OffensePlayType_PassScreen", [], "Screens"],
      ["OffensePlayType_PAScreenPass", [], "Screens"],
      ["OffensePlayType_PassPlayAction", [], "Play Action"],
      ["OffensePlayType_RPO2Read", [], "RPO"],
      ["OffensePlayType_RPOAlert", [], "RPO"],
      ["OffensePlayType_OptionZoneRead", [], "Option"],
      ["OffensePlayType_Pass", ["Concept_Y_Cross"], "Y-Cross"],
      ["OffensePlayType_Pass", ["Concept_Curl_Flat"], "Curl-Flat"],
      ["OffensePlayType_Pass", ["Concept_Shallow_Cross"], "Shallow Cross"],
      ["OffensePlayType_Pass", ["Concept_Double_Slant"], "Slants"],
      ["OffensePlayType_Pass", ["Concept_Slant_Flat"], "Slants"],
      ["OffensePlayType_Pass", ["Concept_Shot_Play"], "Shot Play"],
      ["OffensePlayType_Pass", ["Concept_Divide"], "Divide"],
      ["OffensePlayType_Pass", ["Concept_China"], "China"],
    ];
    for (const [playType, concepts, want] of cases) {
      const input: SuggestInput = { name: "X", playType, reads: concepts.map((c, i) => ({ pos: i + 2, pct: 0.5, concept: c })) };
      expect(suggestedNames(input, doc), `${playType} ${concepts}`).toContain(want);
    }
  });

  it("matches renamed / added categories by normalized name, and nothing for Concept_Invalid", () => {
    const renamed = edit(doc, (d) => {
      d.categories.find((c) => c.id === "y-cross")!.name = "Y Cross";
      addCategory(d, { name: "Switch", group: "pass" });
    });
    const input: SuggestInput = {
      name: "Levels Switch",
      playType: "OffensePlayType_PassShotgun",
      reads: [
        { pos: 3, pct: 0.5, concept: "Concept_Y_Cross" },
        { pos: 4, pct: 0.5, concept: "Concept_Switch" },
        { pos: 5, pct: 0.5, concept: "Concept_Invalid" },
      ],
    };
    expect(suggestedNames(input, renamed).sort()).toEqual(["Levels", "Switch", "Y Cross"]);
    expect(suggestTags({ name: "Cover 3 Sky", playType: "DefensePlayType_ZoneCover3" }, doc)).toEqual([]);
    expect(suggestTags(input, { version: 1, categories: [], tags: {} })).toEqual([]);
  });

  it("doesn't suggest gameplan buckets from names, tagged categories, their ancestors, or dismissed ones", () => {
    expect(suggestedNames({ name: "HB Base", playType: "OffensePlayType_RunPower" }, doc)).toEqual(["Power"]);
    const key = "k";
    let d2 = edit(doc, (d) => {
      const q = addCategory(d, { name: "Quick Game", group: "pass" });
      moveCategory(d, "mesh", { group: "pass", parent: q.id });
      toggleTag(d, key, "mesh");
    });
    const input: SuggestInput = { name: "Quick Game Mesh Spot", playType: "OffensePlayType_Pass", reads: [{ pos: 2, pct: 1, concept: "Concept_Mesh" }] };
    expect(suggestedNames(input, d2, key)).toEqual(["Spot"]);
    d2 = edit(d2, (d) => dismissSuggestion(d, key, "spot"));
    expect(suggestedNames(input, d2, key)).toEqual([]);
    expect(dismissedCount(d2, key)).toBe(1);
    expect(suggestTags(input, d2, { key, includeDismissed: true }).map((s) => s.category.id)).toEqual(["spot"]);
    d2 = edit(d2, (d) => restoreDismissed(d, key));
    expect(d2.dismissed).toBeUndefined();
    d2 = edit(d2, (d) => {
      dismissSuggestion(d, key, "spot");
      expect(acceptSuggestions(d, [{ key, id: "spot" }, { key, id: "mesh" }])).toBe(1);
    });
    expect(d2.tags[key]).toEqual(["spot", "mesh"]); // tree order: mesh now sits under Quick Game (last)
    expect(dismissedCount(d2, key)).toBe(0); // accepting clears the dismissal
  });

  it("suggests for every custom example play without throwing", () => {
    for (const p of cat.custom) expect(() => suggestTags(p, doc, { key: p.key })).not.toThrow();
    const counter = cat.custom.find((p) => p.name === "PBS GT Counter")!;
    expect(suggestedNames(counter, doc, counter.key)).toContain("Counter");
  });

  it("runs over the whole offense library quickly", () => {
    const t0 = performance.now();
    let n = 0;
    for (const p of lib.data.plays) {
      const rp = cat.get(p.asset)!;
      if (rp.side !== "offense") continue;
      n += suggestTags(rp, doc, { key: rp.key }).length;
    }
    expect(n).toBeGreaterThan(5000);
    expect(performance.now() - t0).toBeLessThan(4000);
  });
});

describe("gameplan queries", () => {
  const spec = studioV1(); // frozen copy: the live studio-test.json keeps changing
  const rb = resolvePlaybook(spec, cat);
  const refs = bookPlayRefs(rb);
  const key = (name: string) => refs.find((r) => r.play.name === name)!.play.key;
  const doc = edit(seedConcepts(), (d) => {
    toggleTag(d, key("Inside Zone"), "inside-zone");
    toggleTag(d, key("PBS GT Counter"), "counter");
    toggleTag(d, key("Mesh"), "mesh");
    toggleTag(d, key("Mtn Mesh"), "mesh");
    toggleTag(d, key("Slants"), "slants");
    const g = addCategory(d, { name: "Gap", group: "run" });
    moveCategory(d, "counter", { group: "run", parent: g.id });
  });

  it("flattens resolved book plays in order, skipping templates", () => {
    expect(refs).toHaveLength(19);
    expect(refs[0]).toMatchObject({ f: 0, s: 0, p: 0, formation: "Shotgun", set: "Y Trips Wk" });
    expect(refs.at(-1)).toMatchObject({ set: "Bunch" });
  });

  it("builds the run matrix with formation + set rows, descendant counts and totals", () => {
    const m = conceptMatrix(rb, doc, "run");
    expect(m.templateSections).toBe(4);
    expect(m.plays).toBe(19);
    expect(m.rows.map((r) => `${r.kind}:${r.label}`)).toEqual(["formation:Shotgun", "set:Y Trips Wk", "set:Bunch"]);
    const col = (id: string) => m.columns.findIndex((c) => c.category.id === id);
    const trips = m.rows[1];
    expect(trips.total).toBe(17);
    expect(trips.cells[col("inside-zone")].map((r) => r.play.name)).toEqual(["Inside Zone"]);
    expect(trips.cells[col("gap")].map((r) => r.play.name)).toEqual(["PBS GT Counter"]); // parent counts child
    expect(trips.cells[col("power")]).toEqual([]);
    expect(m.rows[2].cells[col("inside-zone")]).toEqual([]);
    expect(m.rows[0].tagged).toBe(2);
    expect(m.totals[col("counter")]).toHaveLength(1);
    expect(m.columns.find((c) => c.category.id === "counter")?.depth).toBe(1);

    const top = conceptMatrix(rb, doc, "run", { topLevelOnly: true });
    expect(top.columns.some((c) => c.category.id === "counter")).toBe(false);
    const gl = conceptMatrix(rb, doc, "run", { requireAny: ["inside-zone"] });
    expect(gl.plays).toBe(1);
    expect(gl.rows[1].total).toBe(1);
    const only = conceptMatrix(rb, doc, "pass", { only: ["mesh"] });
    expect(only.columns.map((c) => c.category.id)).toEqual(["mesh"]);
    expect(only.totals[0].map((r) => r.play.name).sort()).toEqual(["Mesh", "Mtn Mesh"]);
  });

  it("lists plays for a situation by weight with their categories", () => {
    const sp = situationPlays(rb, doc, "FirstDown");
    expect(sp.map((x) => [x.ref.play.name, x.weight])).toEqual([
      ["PBS GT Counter", 40],
      ["PBS Snag", 20],
    ]);
    expect(sp[0].categories.map((c) => c.id)).toEqual(["counter"]);
    expect(situationPlays(rb, doc, "3rdAndMedium").map((x) => x.weight)).toEqual([40, 30]);
    const counts = situationCounts(rb);
    expect(counts.get("FirstDown")).toEqual({ plays: 2, weight: 60 });
    expect(counts.get("Kneel")).toBeUndefined();
  });

  it("summarizes coverage per category with formations and audibles", () => {
    const cov = categoryCoverage(rb, doc);
    const row = (id: string) => cov.find((r) => r.category.id === id)!;
    expect(row("mesh").plays).toHaveLength(2);
    expect(row("mesh").formations).toEqual([{ name: "Shotgun", count: 2 }]);
    expect(row("mesh").sets).toBe(2);
    expect(row("slants").audibles.map((a) => a.slot)).toEqual([1]);
    expect(row("gap").audibles.map((a) => [a.ref.play.name, a.slot])).toEqual([["PBS GT Counter", 2]]);
    expect(row("gap").weighted).toBe(1);
    expect(row("power").plays).toHaveLength(0);
    expect(cov.length).toBe(doc.categories.length);
    expect(untaggedPlays(rb, doc)).toHaveLength(19 - 5);
  });
});
