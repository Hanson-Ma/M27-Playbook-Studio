import { describe, expect, it } from "vitest";
import { buildCatalog } from "./catalog";
import { loadLibraryData, loadPlaysDoc, loadSetsDoc } from "./libFixture";
import { buildLibraryIndex } from "./library";
import {
  activeFilterCount,
  assignmentDirection,
  breakSide,
  buildSearchIndex,
  conceptCategories,
  conceptTags,
  defaultRouteScope,
  groupResults,
  orderByKeys,
  parseQuery,
  readConceptLabel,
  routeFamilies,
  routeGroupLabel,
  routeLibrary,
  routeScopes,
  routeTypeGroup,
  routeTypeLabel,
  searchPlays,
} from "./search";
import { ASSIGNMENT_ROOT, type ConceptsDoc } from "./types";

const lib = buildLibraryIndex(loadLibraryData());
const docs = [loadPlaysDoc("art-test.json"), loadPlaysDoc("pbs-ytrips-v1.json")];
const catalog = buildCatalog(lib, docs);

const ROOT = "football/Gameplay/playbooks/PlayLibrary/Formations/";
const SHOTGUN = ROOT + "Offense/Shotgun/Shotgun";
const Y_TRIPS_WK = ROOT + "Offense/Shotgun/Y_Trips_Wk/Y_Trips_Wk";
const GUN_BUNCH = ROOT + "Offense/Shotgun/Bunch/Bunch";

const t0 = performance.now();
const index = buildSearchIndex(catalog);
const buildMs = performance.now() - t0;

describe("route-type vocabulary", () => {
  it("friendly names", () => {
    expect(routeTypeLabel("AssignRouteType_RR_Slant")).toBe("Slant");
    expect(routeTypeLabel("AssignRouteType_RR_Curl_Medium")).toBe("Curl (medium)");
    expect(routeTypeLabel("AssignRouteType_Block_Run")).toBe("Run block");
    expect(routeTypeLabel("AssignRouteType_QB_Pass")).toBe("QB drop");
    expect(routeTypeLabel("AssignRouteType_RR_Flat_Rt")).toBe("Flat (right)");
    expect(routeTypeLabel("AssignRouteType_RR_Post_Deep")).toBe("Post (deep)");
    expect(routeTypeLabel("AssignRouteType_RR_Out_N_Up")).toBe("Out & up");
    expect(routeTypeLabel("AssignRouteType_DefZone_Hook_Lt")).toBe("Zone hook (left)");
    expect(routeTypeLabel("AssignRouteType_Def_Man_3")).toBe("Man #3");
    expect(routeTypeLabel(undefined)).toBe("Unknown");
    // every routeType in the library gets a non-empty label without the raw prefix
    for (const rt of lib.assignmentsByRouteType.keys()) {
      const label = routeTypeLabel(rt);
      expect(label.length).toBeGreaterThan(1);
      expect(label).not.toContain("AssignRouteType");
      expect(routeGroupLabel(routeTypeGroup(rt)).length).toBeGreaterThan(1);
    }
  });

  it("groups merge left/right variants", () => {
    expect(routeTypeGroup("AssignRouteType_RR_Flat_Lt")).toBe("RR_Flat");
    expect(routeTypeGroup("AssignRouteType_RR_Flat_Rt")).toBe("RR_Flat");
    expect(routeTypeGroup("AssignRouteType_RR_RB_Screen_Left")).toBe("RR_RB_Screen");
    expect(routeGroupLabel("RR_Flat")).toBe("Flat");
    expect(routeGroupLabel("RR_Wheel")).toBe("Wheel");
    expect(routeTypeGroup("AssignRouteType_DefZone_Deep_2_Lt_Half")).toBe("DefZone_Deep_2_Lt_Half");
  });

  it("route families and scopes", () => {
    expect(routeFamilies("AssignRouteType_RR_Wheel_Lt")).toEqual(["Wheel"]);
    expect(routeFamilies("AssignRouteType_RR_RB_Flat_Rt")).toEqual(["Flat"]);
    expect(routeFamilies("AssignRouteType_RR_Slant_N_Go")).toEqual(["Double move"]);
    expect(routeFamilies("AssignRouteType_Block_Run")).toEqual([]);
    expect(routeScopes("AssignRouteType_RR_Slant")).toEqual(["routes"]);
    expect(routeScopes("AssignRouteType_RR_Swing_Rt")).toEqual(["routes", "backs"]);
    expect(routeScopes("AssignRouteType_RR_Block_Flats_Rt")).toEqual(["routes", "blocks"]);
    expect(routeScopes("AssignRouteType_Block_Pass")).toEqual(["blocks"]);
    expect(routeScopes("AssignRouteType_RB_Slam")).toEqual(["backs"]);
    expect(routeScopes("AssignRouteType_QB_Pass")).toEqual(["qb"]);
    expect(routeScopes("AssignRouteType_DefZone_Hook_Lt")).toEqual(["defense"]);
    expect(routeScopes("AssignRouteType_ST_Kickoff_Cover")).toEqual(["special"]);
    expect(defaultRouteScope("QB", "offense")).toBe("qb");
    expect(defaultRouteScope("LG", "offense")).toBe("blocks");
    expect(defaultRouteScope("HB", "offense")).toBe("backs");
    expect(defaultRouteScope("WR", "offense")).toBe("routes");
    expect(defaultRouteScope("CB", "defense")).toBe("defense");
  });

  it("read concept labels", () => {
    expect(readConceptLabel("Concept_Mesh")).toBe("Mesh");
    expect(readConceptLabel("Concept_Four_Verticals")).toBe("Four Verticals");
    expect(readConceptLabel("Concept_FL_SE_Screen")).toBe("FL SE Screen");
    expect(readConceptLabel("Concept_Invalid")).toBeUndefined();
    expect(readConceptLabel(undefined)).toBeUndefined();
  });

  it("directional variants from leaf names, then routeType", () => {
    const a = (p: string) => ASSIGNMENT_ROOT + p;
    expect(assignmentDirection(a("RunRoute/WR_CurlLt_Option_New15"))).toBe("left");
    expect(assignmentDirection(a("RunRoute/WR_CurlRt_Option_New15"))).toBe("right");
    // the leaf wins over a mislabeled routeType (this wheel runs at 176°/155°, i.e. left)
    expect(assignmentDirection(a("RunRoute/WR_ALL_SlotWheelLt"), "AssignRouteType_RR_Wheel_Rt")).toBe("left");
    // the route word decides, not the motion direction
    expect(assignmentDirection(a("RunRoute/Automotion_HB_ALL_SwingRt_Motion_Lt"), "AssignRouteType_RR_Swing_Rt")).toBe("right");
    expect(assignmentDirection(a("RunRoute/HB_Something"), "AssignRouteType_RR_Flat_Lt")).toBe("left");
    expect(assignmentDirection(a("DefenseZone/Profile_Curl_Flat_Left"), "AssignRouteType_DefZone_Flat_Rt")).toBeUndefined();
    expect(assignmentDirection(a("RunRoute/WR_Run90for10"), "AssignRouteType_RR_Streak")).toBeUndefined();
  });

  it("inside/outside relative to the player's side", () => {
    expect(breakSide("right", -16.25)).toBe("inside"); // left WR breaking toward +x
    expect(breakSide("left", -16.25)).toBe("outside");
    expect(breakSide("left", 16.25)).toBe("inside");
    expect(breakSide("right", 10.5)).toBe("outside");
    expect(breakSide("right", 0)).toBeUndefined();
    expect(breakSide(undefined, 5)).toBeUndefined();
  });
});

describe("route library", () => {
  it("lists receiver routes grouped by type, inside curl first", () => {
    const left = routeLibrary(lib, { scope: "routes", playerX: -16.25 });
    expect(left.length).toBeGreaterThan(20);
    for (const g of left) for (const it of g.items) expect(it.scopes).toContain("routes");
    const curls = left.find((g) => g.key === "RR_Curl_Medium")!;
    expect(curls.label).toBe("Curl (medium)");
    const sides = curls.items.map((i) => i.side);
    const firstOutside = sides.indexOf("outside");
    const lastInside = sides.lastIndexOf("inside");
    expect(lastInside).toBeGreaterThanOrEqual(0);
    expect(firstOutside === -1 || lastInside < firstOutside).toBe(true);
    const curlRt = curls.items.find((i) => i.path === "RunRoute/WR_CurlRt_Option_New15");
    if (curlRt) expect(curlRt.side).toBe("inside");

    const right = routeLibrary(lib, { scope: "routes", playerX: 16.25 });
    const flats = right.find((g) => g.key === "RR_Flat")!;
    expect(flats.items.some((i) => i.routeType.endsWith("_Lt"))).toBe(true);
    expect(flats.items.some((i) => i.routeType.endsWith("_Rt"))).toBe(true);
    const slotFlatsRt = flats.items.find((i) => i.path === "RunRoute/WR_ALL_SlotFlatsRt")!;
    expect(slotFlatsRt.side).toBe("outside");
  });

  it("filters by scope and text", () => {
    const blocks = routeLibrary(lib, { scope: "blocks", playerX: -3.333 });
    expect(blocks.map((g) => g.label)).toContain("Pass block");
    expect(blocks.every((g) => g.items.every((i) => i.scopes.includes("blocks")))).toBe(true);
    const wheels = routeLibrary(lib, { scope: "all", playerX: 10, filter: "wheel" });
    expect(wheels.length).toBeGreaterThan(0);
    for (const g of wheels) for (const i of g.items) expect(`${g.label} ${i.label} ${i.path}`.toLowerCase()).toContain("wheel");
    const total = routeLibrary(lib, { scope: "all", playerX: 0 }).reduce((n, g) => n + g.items.length, 0);
    expect(total).toBe(Object.keys(lib.data.assignments).length);
  });
});

describe("search index", () => {
  it("indexes every library and custom play", () => {
    expect(index.entries.length).toBe(lib.data.plays.length + catalog.custom.length);
    expect(new Set(index.entries.map((e) => e.id)).size).toBe(index.entries.length);
    expect(buildSearchIndex(catalog)).toBe(index); // memoized per catalog
    console.info(`search index: ${index.entries.length} plays in ${buildMs.toFixed(0)} ms`);
  });

  it("includes plays cloned into custom sets (playbooks/sets/) with their own ids", () => {
    const withSets = buildCatalog(lib, docs, [loadSetsDoc("pbs-sets-v1.json")]);
    expect(withSets.clones.length).toBeGreaterThan(0);
    const idx = buildSearchIndex(withSets);
    expect(idx.entries.length).toBe(withSets.lib.data.plays.length + withSets.clones.length + withSets.custom.length);
    expect(new Set(idx.entries.map((e) => e.id)).size).toBe(idx.entries.length);
    for (const c of withSets.clones) expect(idx.byKey.get(c.key)?.play).toBe(c);
    expect(searchPlays(idx, "PBS T Curls").entries.map((e) => e.play.name)).toContain("PBS T Curls");
  });

  it("computes facets", () => {
    const curls = index.byKey.get(ROOT + "Offense/Shotgun/Y_Trips_Wk/Curls")!;
    expect(curls.facets.side).toBe("offense");
    expect(curls.facets.formation).toBe(SHOTGUN);
    expect(curls.facets.set).toBe(Y_TRIPS_WK);
    expect(curls.facets.family).toBe("pass");
    expect(curls.facets.source).toBe("library");
    expect(curls.facets.routes).toEqual(expect.arrayContaining(["Swing", "Curl", "Flat"]));
    expect(curls.hay).toContain("curls");
    expect(curls.hay).toContain("y trips wk");
    expect(curls.hay).toContain("gun");

    const snag = index.byKey.get(ROOT + "Offense/Shotgun/Y_Trips_Wk/PBS_Snag")!;
    expect(snag.facets.source).toBe("custom");
    expect(snag.facets.global).toBe(false);
    expect(snag.hay).toContain("pbs snag");
    expect(snag.hay).toContain("custom pbs-ytrips-v1");

    const mesh = index.byKey.get(GUN_BUNCH.replace("Bunch/Bunch", "Bunch/Mesh"))!;
    expect(mesh.facets.global).toBe(false);
    expect(mesh.facets.readConcepts).toContain("Mesh");

    const minigame = index.entries.find((e) => e.play.formation.includes("/MG_"))!;
    expect(minigame.facets.minigame).toBe(true);
    expect(index.formations.get(SHOTGUN)!.sets.some((s) => s.asset === Y_TRIPS_WK)).toBe(true);
    expect(index.readConcepts[0]).toBe("Smash");
  });
});

describe("searchPlays", () => {
  it("tokenized AND match + negation + phrases", () => {
    const r = searchPlays(index, "mesh gun bunch");
    expect(r.entries.some((e) => e.key === GUN_BUNCH.replace("Bunch/Bunch", "Bunch/Mesh"))).toBe(true);
    for (const e of r.entries) for (const t of ["mesh", "gun", "bunch"]) expect(e.hay).toContain(t);
    const neg = searchPlays(index, "mesh -bunch");
    expect(neg.entries.length).toBeGreaterThan(0);
    for (const e of neg.entries) expect(e.hay).not.toContain("bunch");
    expect(parseQuery(`"y trips" -Bunch mesh`)).toEqual({ include: ["y trips", "mesh"], exclude: ["bunch"] });
    expect(parseQuery("Y_Trips_Wk")).toEqual({ include: ["y trips wk"], exclude: [] });
    expect(searchPlays(index, "").entries.length).toBe(index.entries.length);
  });

  it("filters by facets and counts the rail", () => {
    const r = searchPlays(index, "", { side: "offense", formation: SHOTGUN, set: Y_TRIPS_WK, hideMinigames: true });
    expect(r.entries.length).toBe(95 + catalog.custom.length);
    expect(r.counts.set.get(Y_TRIPS_WK)).toBe(r.entries.length);
    expect(r.counts.set.get(GUN_BUNCH)).toBeGreaterThan(0); // counts ignore their own dimension
    expect(r.counts.formation.get(SHOTGUN)).toBeGreaterThan(r.entries.length); // …and the set below them
    expect(r.counts.side.get("defense")).toBeGreaterThan(0);
    expect(r.counts.availability.needsMod).toBe(r.entries.filter((e) => !e.facets.global).length);
    expect(r.counts.source.custom).toBe(catalog.custom.length);

    const runs = searchPlays(index, "", { side: "offense", set: Y_TRIPS_WK, families: ["run"] });
    expect(runs.entries.length).toBeGreaterThan(0);
    expect(runs.entries.every((e) => e.facets.family === "run")).toBe(true);
    expect(runs.counts.family.get("pass")).toBeGreaterThan(0);

    const custom = searchPlays(index, "", { source: "custom" });
    expect(custom.entries.length).toBe(catalog.custom.length);
    const global = searchPlays(index, "", { availability: "global" });
    expect(global.entries.every((e) => e.facets.global)).toBe(true);
    const needs = searchPlays(index, "", { availability: "needsMod" });
    expect(global.entries.length + needs.entries.length).toBe(index.entries.length);

    const wheels = searchPlays(index, "", { routes: ["Wheel", "Slant"] });
    expect(wheels.entries.length).toBeGreaterThan(0);
    expect(wheels.entries.every((e) => e.facets.routes.includes("Wheel") && e.facets.routes.includes("Slant"))).toBe(true);

    const mesh = searchPlays(index, "", { readConcepts: ["Mesh"] });
    expect(mesh.entries.every((e) => e.facets.readConcepts.includes("Mesh"))).toBe(true);

    const noMg = searchPlays(index, "", { hideMinigames: true });
    expect(noMg.total).toBeLessThan(index.entries.length);
    expect(noMg.entries.every((e) => !e.facets.minigame)).toBe(true);
  });

  it("favorites and concept categories (with nesting)", () => {
    const curls = ROOT + "Offense/Shotgun/Y_Trips_Wk/Curls";
    const slants = ROOT + "Offense/Shotgun/Y_Trips_Wk/Slants";
    const doc: ConceptsDoc = {
      version: 1,
      categories: [
        { id: "pass", name: "Pass", group: "pass", color: "#fff" },
        { id: "quick", name: "Quick game", group: "pass", color: "#0ff", parent: "pass" },
      ],
      tags: { [curls]: ["quick"], [slants]: ["pass"] },
    };
    const fav = searchPlays(index, "", { favoritesOnly: true }, { favorites: [curls] });
    expect(fav.entries.map((e) => e.key)).toEqual([curls]);
    expect(fav.counts.favorites).toBe(1);
    const parent = searchPlays(index, "", { categories: ["pass"] }, { concepts: doc });
    expect(parent.entries.map((e) => e.key).sort()).toEqual([curls, slants].sort());
    expect(parent.counts.categories.get("pass")).toBe(2);
    expect(parent.counts.categories.get("quick")).toBe(1);
    const child = searchPlays(index, "", { categories: ["quick"] }, { concepts: doc });
    expect(child.entries.map((e) => e.key)).toEqual([curls]);

    const grouped = groupResults(parent.entries, "concept", { concepts: doc });
    expect(grouped[0].title).toBe("Pass");
    expect(grouped[0].entries).toHaveLength(2);
    expect(grouped[1].title).toBe("Quick game");
  });

  it("filters 11k plays in < 30 ms", () => {
    const filters = { side: "offense" as const, hideMinigames: true, families: ["pass" as const], routes: ["Wheel"] };
    searchPlays(index, "smash", filters); // warm
    const runs = 10;
    const t = performance.now();
    for (let i = 0; i < runs; i++) searchPlays(index, i % 2 ? "gun smash" : "y trips", filters);
    const avg = (performance.now() - t) / runs;
    console.info(`searchPlays avg ${avg.toFixed(1)} ms`);
    expect(avg).toBeLessThan(30);
  });
});

describe("grouping", () => {
  const r = searchPlays(index, "", { side: "offense", formation: SHOTGUN, hideMinigames: true });

  it("by formation › set", () => {
    const g = groupResults(r.entries, "formation", { lib });
    expect(g.length).toBe(new Set(r.entries.map((e) => e.play.set)).size);
    const trips = g.find((s) => s.key === `set:${Y_TRIPS_WK}`)!;
    expect(trips.title).toBe("Shotgun");
    expect(trips.subtitle).toBe("Y Trips Wk");
    expect(g.reduce((n, s) => n + s.entries.length, 0)).toBe(r.entries.length);
  });

  it("by family and by read concept", () => {
    const fam = groupResults(r.entries, "family");
    expect(fam[0].title).toBe("PASS");
    expect(fam.reduce((n, s) => n + s.entries.length, 0)).toBe(r.entries.length);
    const con = groupResults(r.entries, "concept");
    expect(con.at(-1)!.title).toBe("No Concept");
    const mesh = con.find((s) => s.title === "Mesh")!;
    expect(mesh.entries.every((e) => e.facets.readConcepts.includes("Mesh"))).toBe(true);
    expect(groupResults(r.entries, "none")).toHaveLength(1);
    expect(groupResults([], "none")).toHaveLength(0);
  });

  it("orders by key lists and counts active filters", () => {
    const keys = [r.entries[5].key, r.entries[2].key, "nope"];
    expect(orderByKeys(r.entries, keys).map((e) => e.key)).toEqual([r.entries[5].key, r.entries[2].key]);
    expect(activeFilterCount({ side: "offense", hideMinigames: true })).toBe(0);
    expect(activeFilterCount({ formation: SHOTGUN, families: ["pass", "run"], availability: "global", favoritesOnly: true })).toBe(5);
  });
});

describe("hand-edited concepts.json", () => {
  const r = searchPlays(index, "slants", { side: "offense" });
  const shapes: unknown[] = [
    { categories: {}, tags: {} },
    { categories: [null, 3, { id: 5 }, { id: "ok", name: "OK" }], tags: { [r.entries[0].key]: ["ok", 7, null] } },
    { categories: "x", tags: [] },
    { tags: { a: "nope" } },
    [],
    "concepts",
  ];
  it("never throws in search or concept grouping", () => {
    for (const doc of shapes) {
      expect(() => searchPlays(index, "", { categories: ["ok"] }, { concepts: doc as ConceptsDoc, favorites: {} as never })).not.toThrow();
      expect(() => groupResults(r.entries, "concept", { concepts: doc as ConceptsDoc })).not.toThrow();
    }
    expect(() => orderByKeys(r.entries, {} as never)).not.toThrow();
  });
  it("keeps the usable parts", () => {
    expect(conceptCategories(shapes[1]).map((c) => c.id)).toEqual(["ok"]);
    expect(conceptTags(shapes[1])).toEqual([[r.entries[0].key, ["ok"]]]);
    const g = groupResults(r.entries, "concept", { concepts: shapes[1] as ConceptsDoc });
    expect(g[0]).toMatchObject({ key: "cat:ok", title: "OK" });
    expect(searchPlays(index, "slants", { side: "offense", categories: ["ok"] }, { concepts: shapes[1] as ConceptsDoc }).entries).toHaveLength(1);
  });
});

