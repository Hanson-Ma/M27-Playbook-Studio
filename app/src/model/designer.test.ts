import { describe, expect, it } from "vitest";
import { buildCatalog, resolveCustomPlay, type Catalog } from "./catalog";
import {
  ON_LINE_Y,
  applySavedRoute,
  applySpec,
  assetProblem,
  basePlayOf,
  clampStartSpot,
  clearStartOverride,
  isClonePlay,
  setStartOverride,
  slotRouteType,
  slotSide,
  startLock,
  startOverride,
  startOverrideIndex,
  startStanceFor,
  authoredNameBase,
  blockingLabel,
  commonPrefix,
  effectiveField,
  eligibleSlots,
  groupBasePlays,
  isGeneratedName,
  isSlotChanged,
  libraryStepTypes,
  isSlotLocked,
  newPlaySpec,
  playNameProblem,
  precanLength,
  resetSlot,
  setPlayField,
  setSlotAssignment,
  setSlotInfo,
  setSlotSteps,
  slotRoleLabel,
  specFromState,
  stateFromSpec,
  suggestAsset,
  suggestPlayName,
  swapBase,
  swapBaseLosses,
  unbuildableReason,
  unbuildableSteps,
  type DesignerState,
  type SpecContext,
} from "./designer";
import { loadLibraryData, loadPlaysDoc } from "./libFixture";
import { buildLibraryIndex } from "./library";
import {
  BLOCK_TOOLS,
  DEPTH_FAMILIES,
  DOUBLE_MOVES,
  MOTION_PRESETS,
  ROUTE_PRESETS,
  appendVertex,
  blockSteps,
  doubleMoveSteps,
  editRoute,
  familyFromRouteType,
  inferRouteType,
  motionPresetWaypoints,
  motionStep,
  moveVertex,
  presetSteps,
  releaseSteps,
  routePoints,
  routeStart,
  stemDepth,
  toEditableRoute,
} from "./routes";
import { stepsEqual, stripNone } from "./steps";
import type { CustomPlaySpec, NewAssignmentSpec, PlaysFile, SavedRoute, Step } from "./types";

const lib = buildLibraryIndex(loadLibraryData());
const ytrips = loadPlaysDoc("pbs-ytrips-v1.json");
const artTest = loadPlaysDoc("art-test.json");
const DOCS = [artTest, ytrips];
const catalog = buildCatalog(lib, DOCS);
const SET = "football/Gameplay/playbooks/PlayLibrary/Formations/Offense/Shotgun/Y_Trips_Wk/Y_Trips_Wk";

function ctxFor(file: string, index: number, docs: { path: string; data: PlaysFile }[] = DOCS, cat: Catalog = catalog): SpecContext {
  return { catalog: cat, docs, file, index, prefix: "PBS_" };
}

function find(name: string): { spec: CustomPlaySpec; file: string; index: number } {
  for (const d of DOCS) {
    const index = d.data.plays.findIndex((p) => p.name === name);
    if (index >= 0) return { spec: d.data.plays[index], file: d.path, index };
  }
  throw new Error(name);
}

/** Per-slot steps the spec resolves to (fresh catalog over `docs` with the spec in place). */
function resolvedSteps(spec: CustomPlaySpec, file: string, index: number, docs = DOCS): Step[][] {
  const swapped = docs.map((d) => (d.path === file ? { ...d, data: { ...d.data, plays: d.data.plays.map((p, i) => (i === index ? spec : p)) } } : d));
  const cat = buildCatalog(lib, swapped);
  return resolveCustomPlay(lib, spec, file, index, cat.authored).slots.map((s) => s.steps);
}

const ALL = DOCS.flatMap((d) => d.data.plays.map((spec, index) => ({ spec, file: d.path, index })));

describe("round trip of the example plays", () => {
  it.each(ALL.map((x) => [x.spec.name, x] as const))("%s: stateFromSpec → specFromState is the same spec", (_, { spec, file, index }) => {
    const state = stateFromSpec(spec, catalog, file, index);
    expect(state.base).toBeDefined();
    const back = specFromState(state, ctxFor(file, index));
    expect(back).toEqual(spec);
    // …and resolves to identical per-slot steps.
    const a = resolvedSteps(back, file, index);
    const b = resolveCustomPlay(lib, spec, file, index, catalog.authored).slots.map((s) => s.steps);
    a.forEach((s, i) => expect(stepsEqual(s, b[i])).toBe(true));
  });

  it("recomputing every slot from its steps alone gives a spec that resolves identically and reuses the authored names", () => {
    for (const { spec, file, index } of ALL) {
      const state = stateFromSpec(spec, catalog, file, index);
      // Forget the loaded player specs: only the steps remain.
      const bare: DesignerState = { ...state, slots: state.slots.map((s) => ({ steps: s.steps })) };
      const back = specFromState(bare, ctxFor(file, index));
      const a = resolvedSteps(back, file, index);
      const b = resolveCustomPlay(lib, spec, file, index, catalog.authored).slots.map((s) => s.steps);
      a.forEach((s, i) => expect(stepsEqual(s, b[i]), `${spec.name} slot ${i}`).toBe(true));
      for (const [slot, ps] of Object.entries(spec.players ?? {})) {
        const mine = back.players?.[slot];
        if (typeof ps === "string") {
          expect(typeof mine).toBe("string");
          expect(stepsEqual(lib.assignment(mine as string)!.steps, lib.assignment(ps)!.steps)).toBe(true);
        } else {
          // Same name, routeType, keep and authored steps as the hand-written example.
          expect(mine).toEqual(ps);
        }
      }
      expect(Object.keys(back.players ?? {}).sort()).toEqual(Object.keys(spec.players ?? {}).sort());
    }
  });

  it("keeps unknown keys of the play and of each player spec", () => {
    const { spec, file, index } = find("PBS Snag");
    const extra: CustomPlaySpec = {
      ...spec,
      note: "mine",
      players: { ...spec.players, "2": { ...(spec.players!["2"] as NewAssignmentSpec), comment: "keep me" }, "99": "junk" },
    };
    const state = stateFromSpec(extra, catalog, file, index);
    expect(specFromState(state, ctxFor(file, index))).toEqual(extra);
    // Editing the slot keeps the player spec's unknown keys too.
    const edited = setSlotSteps(state, 2, [...presetSteps("post", { side: "right" }).steps]);
    const out = specFromState(edited, ctxFor(file, index));
    expect(out.note).toBe("mine");
    expect((out.players!["2"] as NewAssignmentSpec).comment).toBe("keep me");
    expect(out.players!["99"]).toBe("junk");
  });
});

describe("editing slots", () => {
  const snag = find("PBS Snag");

  it("a preset applied to an authored slot regenerates its generated name and sets the new routeType", () => {
    const state = stateFromSpec(snag.spec, catalog, snag.file, snag.index);
    const post = presetSteps("post", { side: "right" }, { stem: 8 });
    const out = specFromState(setSlotSteps(state, 2, post.steps, { routeType: post.routeType, family: "Post" }), ctxFor(snag.file, snag.index));
    expect(out.players!["2"]).toEqual({ new: "PBS_Slot_Post8", routeType: "AssignRouteType_RR_Post_Middle", steps: post.steps });
    // Other slots untouched.
    for (const k of ["3", "4", "5"]) expect(out.players![k]).toEqual(snag.spec.players![k]);
  });

  it("a slot set back to the base assignment disappears from players", () => {
    const state = stateFromSpec(snag.spec, catalog, snag.file, snag.index);
    const out = specFromState(resetSlot(state, 3), ctxFor(snag.file, snag.index));
    expect(out.players!["3"]).toBeUndefined();
    expect(Object.keys(out.players!)).toEqual(["2", "4", "5"]);
    const none = specFromState([2, 3, 4, 5].reduce((s, i) => resetSlot(s, i), state), ctxFor(snag.file, snag.index));
    expect(none.players).toBeUndefined();
  });

  it("steps equal to a library assignment are written as its path", () => {
    const state = stateFromSpec(snag.spec, catalog, snag.file, snag.index);
    const path = "RunRoute/WR_Run90for30";
    const viaPicker = specFromState(setSlotAssignment(state, lib, 5, path), ctxFor(snag.file, snag.index));
    expect(viaPicker.players!["5"]).toBe(path);
    const viaSteps = specFromState(setSlotSteps(state, 5, lib.assignment(path)!.steps), ctxFor(snag.file, snag.index));
    expect(typeof viaSteps.players!["5"]).toBe("string");
    expect(stepsEqual(lib.assignment(viaSteps.players!["5"] as string)!.steps, lib.assignment(path)!.steps)).toBe(true);
  });

  it("steps equal to an authored assignment from another play reuse its name", () => {
    const state = stateFromSpec(snag.spec, catalog, snag.file, snag.index);
    const seam = (find("PBS Mtn Drive").spec.players!["5"] as NewAssignmentSpec).steps;
    const out = specFromState(setSlotSteps(state, 4, seam), ctxFor(snag.file, snag.index));
    expect(out.players!["4"]).toEqual({ new: "PBS_Y_Seam", routeType: "AssignRouteType_RR_Streak", steps: seam });
  });

  it("a name another play shares is forked instead of redefined", () => {
    const other: { path: string; data: PlaysFile } = {
      path: "playbooks/plays/zz-designer-other.json",
      data: { plays: [{ name: "PBS Other", asset: "PBS_Other", base: snag.spec.base, players: { "2": snag.spec.players!["2"] } }] },
    };
    const docs = [...DOCS, other];
    const cat = buildCatalog(lib, docs);
    const state = stateFromSpec(snag.spec, cat, snag.file, snag.index);
    const post = presetSteps("post", { side: "right" }, { stem: 8 });
    const out = specFromState(setSlotSteps(state, 2, post.steps, { family: "Post" }), ctxFor(snag.file, snag.index, docs, cat));
    const ns = out.players!["2"] as NewAssignmentSpec;
    expect(ns.new).not.toBe("PBS_Slot_Corner7");
    expect(ns.new).toBe("PBS_Slot_Post8");
  });

  it("generates unique [A-Za-z0-9_] names for new authored slots", () => {
    const found = find("PBS Art A");
    const { file, index } = found;
    // Start from the bare play (the user's art-test edits may carry authored slots with their own routeTypes).
    const { players: _p, ...spec } = found.spec;
    void _p;
    let state = stateFromSpec(spec, catalog, file, index);
    const corner = presetSteps("corner", { side: "right" }, { stem: 7, breakLength: 18 });
    state = setSlotSteps(state, 2, corner.steps, { routeType: corner.routeType, family: "Corner" });
    state = setSlotSteps(state, 4, presetSteps("corner", { side: "right" }, { stem: 7, breakLength: 25 }).steps, { family: "Corner" });
    const out = specFromState(state, ctxFor(file, index));
    const n2 = (out.players!["2"] as NewAssignmentSpec).new;
    const n4 = (out.players!["4"] as NewAssignmentSpec).new;
    // PBS_Slot_Corner7 is taken by PBS Snag → _2.
    expect(n2).toBe("PBS_Slot_Corner7_2");
    expect(n4).toBe("PBS_Z_Corner7");
    for (const n of [n2, n4]) expect(n).toMatch(/^[A-Za-z0-9_]+$/);
    expect(new Set([n2, n4, ...catalog.authored.keys()]).size).toBe(catalog.authored.size + 2);
    expect((out.players!["4"] as NewAssignmentSpec).routeType).toBe("AssignRouteType_RR_Corner_Middle");
  });

  it("two slots changed to the same new steps share one name", () => {
    const { spec, file, index } = find("PBS Art A");
    let state = stateFromSpec(spec, catalog, file, index);
    const go = presetSteps("go", { side: "right" }, { stem: 25 }).steps;
    state = setSlotSteps(state, 2, go, { family: "Go" });
    state = setSlotSteps(state, 4, go, { family: "Go" });
    const out = specFromState(state, ctxFor(file, index));
    expect((out.players!["2"] as NewAssignmentSpec).new).toBe((out.players!["4"] as NewAssignmentSpec).new);
  });

  it("keep counts the template steps a slot still starts with (kept motion = 1, kept precan = 2)", () => {
    const drive = find("PBS Mtn Drive");
    let state = stateFromSpec(drive.spec, catalog, drive.file, drive.index);
    // Drag the dig's break point: the AutoMotion stays → keep 1.
    const a = state.set!.movements.Normal[4];
    const steps = state.slots[4].steps;
    const r = toEditableRoute(steps);
    const start = routeStart({ x: a.x, y: a.y }, r.prefix, steps);
    const pts = routePoints(start, r);
    state = setSlotSteps(state, 4, editRoute(steps, (rr) => moveVertex(rr, start, 0, { x: pts[1].x, y: pts[1].y + 2 })));
    const out = specFromState(state, ctxFor(drive.file, drive.index));
    const ns = out.players!["4"] as NewAssignmentSpec;
    expect(ns.new).toBe("PBS_Z_Mtn_Dig12");
    expect(ns.keep).toBe(1);
    expect(ns.steps[0]).toEqual({ type: "RunRoute", distance: 14, direction: 90, speed: 100 });

    const rev = find("PBS Reverse QB Lead");
    let rs = stateFromSpec(rev.spec, catalog, rev.file, rev.index);
    expect(isSlotLocked(rs, 0)).toBe(true);
    expect(precanLength(rs.baseSlots[0])).toBe(2);
    rs = setSlotSteps(rs, 0, [...rs.slots[0].steps.slice(0, 2), ...blockSteps("lead", { gap: "OUTSIDE_GAP_Left", technique: "BLOCKINGTECHNIQUE_OUTSIDE" }).steps]);
    const ro = specFromState(rs, ctxFor(rev.file, rev.index)).players!["0"] as NewAssignmentSpec;
    expect(ro.new).toBe("PBS_QB_Reverse_LeadLt");
    expect(ro.keep).toBe(2);
    expect(ro.steps.map((s) => s.type)).toEqual(["LeadBlock", "RunBlock"]);
  });

  it("tracks changed / locked slots", () => {
    const state = stateFromSpec(snag.spec, catalog, snag.file, snag.index);
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => isSlotChanged(state, i))).toEqual([false, false, true, true, true, true, false]);
    const gt = find("PBS GT Counter");
    const gs = stateFromSpec(gt.spec, catalog, gt.file, gt.index);
    expect(isSlotLocked(gs, 0)).toBe(true);
    expect(isSlotLocked(gs, 1)).toBe(true);
    expect(isSlotLocked(gs, 6)).toBe(false);
    expect(commonPrefix(gs.slots[1].steps, gs.baseSlots[1])).toBe(gs.baseSlots[1].length - 1);
  });
});

describe("authored names and routeTypes follow the route", () => {
  const artA = find("PBS Art A");
  /** Apply an edit, write the spec into the doc and read the state back (what the editor does per edit). */
  function roundTrip(state: DesignerState, edit: (st: DesignerState) => DesignerState) {
    const spec = specFromState(edit(state), ctxFor(artA.file, artA.index));
    const docs = DOCS.map((d) => (d.path === artA.file ? { ...d, data: { ...d.data, plays: d.data.plays.map((p, i) => (i === artA.index ? spec : p)) } } : d));
    const cat = buildCatalog(lib, docs);
    return { spec, state: stateFromSpec(spec, cat, artA.file, artA.index), ctx: ctxFor(artA.file, artA.index, docs, cat) };
  }
  const slotSpec = (spec: CustomPlaySpec, slot: number) => spec.players![String(slot)] as NewAssignmentSpec;

  it("switching presets renames a generated name and replaces the routeType (CORNER → SLANT)", () => {
    const corner = presetSteps("corner", { side: "left" }, { stem: 10 });
    const a = roundTrip(stateFromSpec(artA.spec, catalog, artA.file, artA.index), (st) => setSlotSteps(st, 3, corner.steps, { routeType: corner.routeType, family: "Corner" }));
    expect(slotSpec(a.spec, 3).new).toBe("PBS_X_Corner10");
    const slant = presetSteps("slant", { side: "left" });
    const spec = specFromState(setSlotSteps(a.state, 3, slant.steps, { routeType: slant.routeType, family: "Slant" }), a.ctx);
    expect(slotSpec(spec, 3)).toMatchObject({ new: "PBS_X_Slant", routeType: slant.routeType });
  });

  it("re-applying the same preset keeps the name (no _2 churn) and a name the user picked survives presets", () => {
    const corner = presetSteps("corner", { side: "left" }, { stem: 10 });
    const a = roundTrip(stateFromSpec(artA.spec, catalog, artA.file, artA.index), (st) => setSlotSteps(st, 3, corner.steps, { routeType: corner.routeType, family: "Corner" }));
    const slower = presetSteps("corner", { side: "left" }, { stem: 10, breakSpeed: 80 });
    expect(slotSpec(specFromState(setSlotSteps(a.state, 3, slower.steps, { routeType: slower.routeType, family: "Corner" }), a.ctx), 3).new).toBe("PBS_X_Corner10");
    const deeper = presetSteps("corner", { side: "left" }, { stem: 12 });
    expect(slotSpec(specFromState(setSlotSteps(a.state, 3, deeper.steps, { routeType: deeper.routeType, family: "Corner" }), a.ctx), 3).new).toBe("PBS_X_Corner12");

    const renamed = roundTrip(a.state, (st) => setSlotInfo(st, 3, { name: "PBS_X_Bender" }));
    expect(slotSpec(renamed.spec, 3).new).toBe("PBS_X_Bender");
    const slant = presetSteps("slant", { side: "left" });
    const out = specFromState(setSlotSteps(renamed.state, 3, slant.steps, { routeType: slant.routeType, family: "Slant" }), renamed.ctx);
    expect(slotSpec(out, 3)).toMatchObject({ new: "PBS_X_Bender", routeType: slant.routeType });
  });

  it("free drawing that changes the route re-infers its routeType; a small nudge keeps the preset's", () => {
    const slant = presetSteps("slant", { side: "left" });
    const a = roundTrip(stateFromSpec(artA.spec, catalog, artA.file, artA.index), (st) => setSlotSteps(st, 3, slant.steps, { routeType: slant.routeType, family: "Slant" }));
    expect(slotSpec(a.spec, 3).routeType).toBe(slant.routeType);
    // Two extra vertices: a zig-zag that ends running back toward the sideline.
    const set = a.state.set!;
    const al = set.movements.Normal[3];
    const steps = a.state.slots[3].steps;
    const r = toEditableRoute(steps);
    const start = routeStart({ x: al.x, y: al.y }, r.prefix, steps);
    const end = routePoints(start, r).at(-1)!;
    const drawn = editRoute(steps, (rr) => appendVertex(appendVertex(rr, start, { x: end.x - 6, y: end.y + 1 }), start, { x: end.x - 12, y: end.y + 1 }));
    const out = specFromState(setSlotSteps(a.state, 3, drawn), a.ctx);
    const want = inferRouteType(drawn, "left");
    expect(want).not.toBe(slant.routeType);
    expect(slotSpec(out, 3).routeType).toBe(want);
    expect(slotSpec(out, 3).new).toBe(authoredNameBase("PBS_", "X", familyFromRouteType(want)!, DEPTH_FAMILIES.has(familyFromRouteType(want)!) ? stemDepth(drawn) : undefined));

    // A preset whose routeType inference can't reproduce (snag = Slant_Hook) keeps it through a small drag.
    const snag = presetSteps("snag", { side: "left" });
    const b = roundTrip(a.state, (st) => setSlotSteps(st, 3, snag.steps, { routeType: snag.routeType, family: "Snag" }));
    const bs = b.state.slots[3].steps;
    const br = toEditableRoute(bs);
    const bstart = routeStart({ x: al.x, y: al.y }, br.prefix, bs);
    const p1 = routePoints(bstart, br)[1];
    const nudged = editRoute(bs, (rr) => moveVertex(rr, bstart, 0, { x: p1.x, y: p1.y + 0.5 }));
    expect(slotSpec(specFromState(setSlotSteps(b.state, 3, nudged), b.ctx), 3)).toMatchObject({ new: slotSpec(b.spec, 3).new, routeType: snag.routeType });
  });

  it("recognizes generated names", () => {
    expect(isGeneratedName("PBS_Slot_Corner7", "Slot")).toBe(true);
    expect(isGeneratedName("PBS_X_Slant_2", "X")).toBe(true);
    expect(isGeneratedName("X_PassBlock", "X")).toBe(true);
    expect(isGeneratedName("PBS_Slot_Corner_Seven", "Slot")).toBe(false);
    expect(isGeneratedName("PBS_Z_Mtn_Dig12", "Z")).toBe(false);
    expect(isGeneratedName("PBS_X_Bender", "X")).toBe(false);
    expect(isGeneratedName("PBS_Z_Corner7", "X")).toBe(false);
  });
});

describe("buildable step types", () => {
  it("flags step types the library's assignments never use", () => {
    const types = libraryStepTypes(lib);
    expect(types.has("RunRoute")).toBe(true);
    expect(types.has("ReceiverCut")).toBe(true);
    expect(types.has("RunRouteFakeOut")).toBe(false);
    const chain: Step[] = [
      { type: "RunRoute", distance: 6, direction: 90, speed: 100 },
      { type: "RunRouteFakeOut", fakeout: "JukeForward" },
      { type: "RunRouteTurbo" },
      { type: "GetOpen" },
      { type: "None" },
    ];
    expect(unbuildableSteps(chain, lib)).toEqual([
      { index: 1, type: "RunRouteFakeOut" },
      { index: 2, type: "RunRouteTurbo" },
    ]);
    expect(unbuildableReason("RunRouteTurbo")).toMatch(/RunRouteTurbo/);
  });

  it("every step the designer's builders write has a library instance", () => {
    const types = libraryStepTypes(lib);
    const chains: Step[][] = [];
    for (const side of ["left", "right"] as const) {
      for (const p of ROUTE_PRESETS) {
        chains.push(presetSteps(p.id, { side }).steps);
        for (const release of ["vertical", "inside", "outside"] as const) chains.push(presetSteps(p.id, { side }, { release, end: "sit" }).steps);
      }
      for (const dm of DOUBLE_MOVES) chains.push(doubleMoveSteps(dm.id, side).steps);
      for (const t of BLOCK_TOOLS) chains.push(blockSteps(t.id, { side, lineman: true }).steps, blockSteps(t.id, { side }).steps);
      for (const k of ["vertical", "inside", "outside"] as const) chains.push(releaseSteps(k, side, { anim: "MOVETYPE_WRSTART" }));
    }
    for (const m of MOTION_PRESETS) chains.push([motionStep(motionPresetWaypoints(m.id, { x: 10, y: -1 }, { qbY: -5 }))]);
    for (const c of chains) for (const st of c) expect(types.has(st.type), st.type).toBe(true);
  });
});

describe("play-level fields", () => {
  const snag = find("PBS Snag");

  it("writes only edited fields; inherit removes the key", () => {
    let state = stateFromSpec(snag.spec, catalog, snag.file, snag.index);
    state = setPlayField(state, "vip", state.base!.vip); // same as base, not present → not written
    expect("vip" in specFromState(state, ctxFor(snag.file, snag.index))).toBe(false);
    state = setPlayField(state, "vip", 5);
    expect(specFromState(state, ctxFor(snag.file, snag.index)).vip).toBe(5);
    expect(effectiveField(state, "vip")).toBe(5);
    state = setPlayField(state, "reads", undefined);
    expect(specFromState(state, ctxFor(snag.file, snag.index)).reads).toBeUndefined();
    expect(effectiveField(state, "reads")).toEqual(state.base!.reads);

    const gt = find("PBS GT Counter");
    let gs = stateFromSpec(gt.spec, catalog, gt.file, gt.index);
    // Explicitly present keys stay even when set equal to the base.
    gs = setPlayField(gs, "blocking", "BTCounter");
    expect(specFromState(gs, ctxFor(gt.file, gt.index)).blocking).toBe("BTCounter");
    gs = setPlayField(gs, "blocking", undefined);
    expect("blocking" in specFromState(gs, ctxFor(gt.file, gt.index))).toBe(false);
  });

  it("swapping the base keeps compatible slot edits and resets mechanics slots", () => {
    const pa = find("PBS PA Yankee");
    const state = stateFromSpec(pa.spec, catalog, pa.file, pa.index);
    const curls = "football/Gameplay/playbooks/PlayLibrary/Formations/Offense/Shotgun/Y_Trips_Wk/Curls";
    expect(swapBaseLosses(state, catalog, curls)).toEqual([]);
    const swapped = swapBase(state, catalog, curls);
    expect(swapped.play.base).toBe(curls);
    for (const i of [2, 3, 4]) expect(stepsEqual(swapped.slots[i].steps, state.slots[i].steps)).toBe(true);
    // The PA precan slots (QB 0, HB 1) take the new base's assignments.
    expect(stepsEqual(swapped.slots[0].steps, swapped.baseSlots[0])).toBe(true);
    const out = specFromState(swapped, ctxFor(pa.file, pa.index));
    expect(Object.keys(out.players!)).toEqual(["2", "3", "4"]);
    expect((out.players!["2"] as NewAssignmentSpec).new).toBe("PBS_Slot_Out12");

    const rev = find("PBS Reverse QB Lead");
    const rs = stateFromSpec(rev.spec, catalog, rev.file, rev.index);
    expect(swapBaseLosses(rs, catalog, curls)).toEqual([0]);
  });
});

describe("helpers", () => {
  it("labels slot roles like the example names", () => {
    const set = lib.setByAsset.get(SET)!;
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => slotRoleLabel(set, i))).toEqual(["QB", "HB", "Slot", "X", "Z", "Y", "LT", "LG", "C", "RG", "RT"]);
    expect(eligibleSlots(set)).toEqual([1, 2, 3, 4, 5]);
    expect(authoredNameBase("PBS_", "Slot", "Corner", 7)).toBe("PBS_Slot_Corner7");
    expect(authoredNameBase("XYZ", "Y", "Go")).toBe("XYZ_Y_Go");
  });

  it("validates names and assets inside the set", () => {
    const self = catalog.custom.find((p) => p.name === "PBS Snag")!;
    expect(playNameProblem(catalog, SET, "Curls")).toMatch(/library/);
    expect(playNameProblem(catalog, SET, "PBS Snag")).toMatch(/Already used/);
    expect(playNameProblem(catalog, SET, "PBS Snag", self.key)).toBeUndefined();
    expect(playNameProblem(catalog, SET, "  ")).toBeDefined();
    expect(assetProblem(catalog, SET, "Curls")).toMatch(/library/);
    expect(assetProblem(catalog, SET, "PBS_Snag")).toMatch(/Already used/);
    expect(assetProblem(catalog, SET, "PBS_Snag", self.key)).toBeUndefined();
    expect(assetProblem(catalog, SET, "bad name")).toBeDefined();
    expect(suggestAsset(catalog, SET, "PBS Snag", "PBS_")).toBe("PBS_Snag_2");
    expect(suggestAsset(catalog, SET, "Smash Seam", "PBS_")).toBe("PBS_Smash_Seam");
    expect(suggestPlayName(catalog, SET, "Snag", "PBS_")).toBe("PBS Snag 2");
    expect(suggestPlayName(catalog, SET, "Mesh", "PBS_")).toBe("PBS Mesh");
  });

  it("builds a new play spec, optionally with a slot assignment", () => {
    expect(newPlaySpec({ name: "A", asset: "PBS_A", base: "b" })).toEqual({ name: "A", asset: "PBS_A", base: "b" });
    expect(
      newPlaySpec({ name: "A", asset: "PBS_A", base: "b", slot: 3, assignment: "football/Gameplay/playbooks/PlayLibrary/Assignments/RunRoute/WR_Run90for30" }),
    ).toEqual({ name: "A", asset: "PBS_A", base: "b", players: { "3": "RunRoute/WR_Run90for30" } });
  });

  it("groups base plays for the wizard", () => {
    const groups = groupBasePlays(catalog, SET);
    const sections = groups.map((g) => g.section);
    expect(sections.indexOf("pass")).toBeLessThan(sections.indexOf("run"));
    const run = groups.filter((g) => g.section === "run").map((g) => g.label);
    expect(run).toEqual(expect.arrayContaining(["Inside Zone", "Power"]));
    expect(groups.flatMap((g) => g.plays).every((p) => p.source === "library")).toBe(true);
    const total = groups.reduce((n, g) => n + g.plays.length, 0);
    expect(total).toBeGreaterThan(20);
    expect(blockingLabel("BTOutsideZone")).toBe("Outside Zone");
    expect(blockingLabel("CODE_DETERMINE")).toBe("Auto (pass pro)");
  });

  it("applySpec syncs an object in place", () => {
    const target: Record<string, unknown> = { name: "a", vip: 3, players: { "2": "x", "3": { new: "n", steps: [1] } }, gone: true };
    const source = { name: "a", players: { "3": { new: "n", steps: [1, 2] } }, reads: [] };
    const players = target.players;
    applySpec(target, source);
    expect(target).toEqual(source);
    expect(target.players).toBe(players);
  });
});

describe("authored slot info", () => {
  it("renames an authored assignment and changes its routeType even when the steps didn't change", async () => {
    const { setSlotInfo, isAuthoredSlot } = await import("./designer");
    const snag = find("PBS Snag");
    const state = stateFromSpec(snag.spec, catalog, snag.file, snag.index);
    expect(isAuthoredSlot(state, lib, 2)).toBe(true);
    expect(isAuthoredSlot(state, lib, 3)).toBe(false); // library path
    expect(isAuthoredSlot(state, lib, 0)).toBe(false); // base
    const renamed = specFromState(setSlotInfo(state, 2, { name: "PBS Slot Corner Seven!" }), ctxFor(snag.file, snag.index));
    expect((renamed.players!["2"] as NewAssignmentSpec).new).toBe("PBS_Slot_Corner_Seven");
    const retyped = specFromState(setSlotInfo(state, 5, { routeType: "AssignRouteType_RR_Hitch" }), ctxFor(snag.file, snag.index));
    expect(retyped.players!["5"]).toEqual({ ...(snag.spec.players!["5"] as NewAssignmentSpec), routeType: "AssignRouteType_RR_Hitch" });
  });
});

describe("My Routes on a slot", () => {
  const artA = find("PBS Art A");
  const deepOver: SavedRoute = {
    id: "deep-over",
    name: "Deep over",
    side: "right",
    steps: [
      { type: "RunRoute", distance: 10, direction: 90, speed: 90 },
      { type: "ReceiverCut", direction: "RECEIVER_CUT_DIR_LEFT", cutType: "RECEIVER_CUT_ANGLE_45" },
      { type: "RunRoute", distance: 16, direction: 150, speed: 100 },
      { type: "GetOpen" },
    ],
    routeType: "AssignRouteType_RR_Cross",
  };
  const routeTypes = new Set(lib.enumValues("AssignRouteType"));
  /** Write the edited state into the docs and build the catalog the next edit would see. */
  function write(state: DesignerState, file: string, index: number, docs = DOCS) {
    const spec = specFromState(state, ctxFor(file, index, docs, buildCatalog(lib, docs)));
    const next = docs.map((d) => (d.path === file ? { ...d, data: { ...d.data, plays: d.data.plays.map((p, i) => (i === index ? spec : p)) } } : d));
    return { spec, docs: next, catalog: buildCatalog(lib, next) };
  }

  it("names the authored assignment after the route; the other side gets the mirrored version", () => {
    const st = stateFromSpec(artA.spec, catalog, artA.file, artA.index);
    expect(slotSide(st, 4)).toBe("right");
    expect(slotSide(st, 3)).toBe("left");
    const right = write(applySavedRoute(st, 4, deepOver, { prefix: "PBS_", routeTypes }), artA.file, artA.index);
    expect(right.spec.players!["4"]).toMatchObject({ new: "PBS_Deep_Over", routeType: "AssignRouteType_RR_Cross" });
    expect(stripNone(resolveCustomPlay(lib, right.spec, artA.file, artA.index, right.catalog.authored).slots[4].steps)).toEqual(deepOver.steps);

    const st2 = stateFromSpec(right.spec, right.catalog, artA.file, artA.index);
    const left = write(applySavedRoute(st2, 3, deepOver, { prefix: "PBS_", routeTypes }), artA.file, artA.index, right.docs);
    const x = left.spec.players!["3"] as NewAssignmentSpec;
    expect(x.new).toBe("PBS_Deep_Over_Lt");
    expect(x.steps[2]).toMatchObject({ direction: 30 });
    expect(x.steps[1]).toMatchObject({ direction: "RECEIVER_CUT_DIR_RIGHT", cutType: "RECEIVER_CUT_ANGLE_45" });
  });

  it("reuses identical authored steps from another play, and forks the name when the steps differ", () => {
    const st = stateFromSpec(artA.spec, catalog, artA.file, artA.index);
    const a = write(applySavedRoute(st, 4, deepOver, { prefix: "PBS_", routeTypes }), artA.file, artA.index);
    // Same route on the same side in another play (Art B, Z): identical steps → the same name.
    const artB = find("PBS Art B");
    const sb = stateFromSpec(artB.spec, a.catalog, artB.file, artB.index);
    const b = write(applySavedRoute(sb, 4, deepOver, { prefix: "PBS_", routeTypes }), artB.file, artB.index, a.docs);
    expect((b.spec.players!["4"] as NewAssignmentSpec).new).toBe("PBS_Deep_Over");
    // With a motion in front the chain differs → its own name.
    const withMotion = setSlotSteps(sb, 4, [motionStep(motionPresetWaypoints("short", { x: 12, y: -0.8 })), { type: "None" }]);
    const c = write(applySavedRoute(withMotion, 4, deepOver, { prefix: "PBS_", routeTypes }), artB.file, artB.index, a.docs);
    const z = c.spec.players!["4"] as NewAssignmentSpec;
    expect(z.new).toBe("PBS_Deep_Over_2");
    expect(z.steps[0].type).toBe("AutoMotion");
  });

  it("a preset applied later drops the route's name", () => {
    const st = stateFromSpec(artA.spec, catalog, artA.file, artA.index);
    const a = write(applySavedRoute(st, 4, deepOver, { prefix: "PBS_", routeTypes }), artA.file, artA.index);
    const st2 = stateFromSpec(a.spec, a.catalog, artA.file, artA.index);
    const slant = presetSteps("slant", { side: "right" });
    const out = specFromState(setSlotSteps(st2, 4, slant.steps, { routeType: slant.routeType, family: "Slant", dropName: true }), ctxFor(artA.file, artA.index, a.docs, a.catalog));
    expect((out.players!["4"] as NewAssignmentSpec).new).toBe("PBS_Z_Slant");
  });

  it("the slot's routeType is what Save route stores", () => {
    const st = stateFromSpec(artA.spec, catalog, artA.file, artA.index);
    expect(slotRouteType(st, 2)).toBe("AssignRouteType_RR_In_Deep");
    expect(slotRouteType(applySavedRoute(st, 2, deepOver, { prefix: "PBS_" }), 2)).toBe("AssignRouteType_RR_Cross");
  });
});

describe("play-specific start spots", () => {
  const artA = find("PBS Art A");
  const pa = find("PBS PA Yankee");

  it("only receivers and backs without handoff mechanics can move", () => {
    const st = stateFromSpec(artA.spec, catalog, artA.file, artA.index);
    expect(startLock(st, 4)).toEqual({ movable: true });
    expect(startLock(st, 0)).toEqual({ movable: false, reason: "qb" });
    expect(startLock(st, 8)).toEqual({ movable: false, reason: "line" });
    const ps = stateFromSpec(pa.spec, catalog, pa.file, pa.index);
    expect(startLock(ps, 1)).toEqual({ movable: false, reason: "mechanics" });
  });

  it("writes an OverrideFormPos first step (absolute, Receiver stance), clamps to the line class and resets", () => {
    const st = stateFromSpec(artA.spec, catalog, artA.file, artA.index);
    const a = st.set!.movements.Normal[3];
    expect(a.y).toBeGreaterThan(ON_LINE_Y); // X is on the line
    const moved = setStartOverride(st, 3, { x: a.x + 6, y: -6 });
    const steps = moved.slots[3].steps;
    expect(steps[0]).toEqual({ type: "OverrideFormPos", stance: "Receiver", offsetX: -10.25, offsetY: -1.4 });
    expect(startOverride(steps)).toEqual({ x: -10.25, y: -1.4 });
    // The route is relative: it starts at the new spot.
    expect(slotSide(moved, 3)).toBe("left");
    const spec = specFromState(moved, ctxFor(artA.file, artA.index));
    const resolved = resolvedSteps(spec, artA.file, artA.index);
    expect(resolved[3][0]).toMatchObject({ type: "OverrideFormPos", offsetX: -10.25, offsetY: -1.4 });
    // Moving again edits the same step; back on the formation spot removes it.
    const again = setStartOverride(moved, 3, { x: a.x + 2, y: a.y });
    expect(again.slots[3].steps.filter((s) => s.type === "OverrideFormPos")).toHaveLength(1);
    expect(startOverrideIndex(setStartOverride(moved, 3, { x: a.x, y: a.y }).slots[3].steps)).toBe(-1);
    expect(startOverrideIndex(clearStartOverride(moved, 3).slots[3].steps)).toBe(-1);
    expect(stepsEqual(clearStartOverride(moved, 3).slots[3].steps, st.slots[3].steps)).toBe(true);
    // Z is off the line: it stays off it.
    expect(setStartOverride(st, 4, { x: 12, y: -0.8 }).slots[4].steps[0]).toMatchObject({ offsetX: 12, offsetY: -1.6 });
    // Off-ball players stay off the line; HB stance for backs.
    expect(clampStartSpot({ x: 0, y: -6 }, { x: 40, y: 0 })).toEqual({ x: 25.67, y: -1.6 });
    expect(startStanceFor("POSITION_HB")).toBe("HB");
  });
});

describe("clone bases (custom sets)", () => {
  it("basePlayOf reads library plays, and resolved clones when the catalog overlay has them", () => {
    const curls = "football/Gameplay/playbooks/PlayLibrary/Formations/Offense/Shotgun/Y_Trips_Wk/Curls";
    const b = basePlayOf(catalog, curls);
    expect(b.def?.asset).toBe(curls);
    expect(b.steps).toHaveLength(11);
    const lib0 = catalog.get(curls)!;
    const clone = { ...lib0, key: `${curls}_PBS_Clone`, asset: `${curls}_PBS_Clone`, source: "custom" as const, file: "playbooks/sets/x.json", playId: undefined };
    const fake: Catalog = { ...catalog, get: (k) => (k === clone.key ? clone : catalog.get(k)) };
    expect(isClonePlay(clone)).toBe(true);
    expect(isClonePlay({ ...clone, file: "playbooks/plays/a.json" })).toBe(false);
    const cb = basePlayOf(fake, clone.key);
    expect(cb.def?.name).toBe(lib0.name);
    cb.steps.forEach((s, i) => expect(stepsEqual(s, lib0.slots[i].steps)).toBe(true));
    expect(basePlayOf(catalog, "nope").def).toBeUndefined();
  });

  it("doesn't prefix a clone's name twice", () => {
    expect(suggestPlayName(catalog, SET, "PBS O Four Verticals", "PBS_")).toBe("PBS O Four Verticals");
    expect(suggestPlayName(catalog, SET, "Four Verticals", "PBS_")).toBe("PBS Four Verticals");
  });
});
