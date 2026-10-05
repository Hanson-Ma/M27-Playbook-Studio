import { describe, expect, it } from "vitest";
import { loadLibraryData, loadPlaysDoc } from "./libFixture";
import {
  appendVertex,
  blockSteps,
  clearLegsFrom,
  cutAt,
  cutFor,
  cutLabel,
  detectBlockTool,
  detectRelease,
  DOUBLE_MOVES,
  doubleMoveSteps,
  editRoute,
  fakeAt,
  fromEditableRoute,
  headingRelative,
  inferRouteType,
  insertVertex,
  legBetween,
  motionPresetWaypoints,
  motionStep,
  moveVertex,
  moveWaypoint,
  presetSteps,
  r2,
  removeVertex,
  replaceBody,
  ROUTE_PRESETS,
  routePoints,
  routeStart,
  setCutAt,
  removeFakeAt,
  setMotion,
  setRelease,
  sideHeading,
  snapFrom,
  stemDepth,
  toEditableRoute,
  type EditableRoute,
} from "./routes";
import type { NewAssignmentSpec, Step, Vec } from "./types";

const lib = loadLibraryData();
const ytrips = loadPlaysDoc("pbs-ytrips-v1.json");

/** Authored steps of a `new` player spec in the Y Trips example file. */
function authored(play: string, slot: number): Step[] {
  const p = ytrips.data.plays.find((x) => x.name === play)!;
  return (p.players![String(slot)] as NewAssignmentSpec).steps;
}

const near = (a: Vec, b: Vec, eps = 0.02) => Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;

describe("editable route round trip", () => {
  it("rebuilds every library assignment chain byte for byte (key order and numbers included)", () => {
    const entries = Object.entries(lib.assignments);
    expect(entries.length).toBeGreaterThan(5000);
    let withLegs = 0;
    for (const [asset, a] of entries) {
      const route = toEditableRoute(a.steps);
      if (route.legs.length) withLegs++;
      const back = fromEditableRoute(route);
      if (JSON.stringify(back) !== JSON.stringify(a.steps)) throw new Error(`round trip differs for ${asset}`);
      // Untouched legs are the very same step objects.
      route.legs.forEach((l) => expect(back).toContain(l.source));
    }
    expect(withLegs).toBeGreaterThan(3000);
  });

  it("round-trips the authored example chains", () => {
    for (const play of ytrips.data.plays) {
      for (const spec of Object.values(play.players ?? {})) {
        if (typeof spec === "string") continue;
        const steps = spec.steps;
        expect(JSON.stringify(fromEditableRoute(toEditableRoute(steps)))).toBe(JSON.stringify(steps));
      }
    }
  });

  it("splits prefix / legs / suffix and files cuts in front of the next leg", () => {
    const r = toEditableRoute([...authored("PBS Snag", 2), { type: "None" }]);
    expect(r.prefix).toEqual([]);
    expect(r.legs.map((l) => [l.distance, l.direction])).toEqual([
      [7, 90],
      [22, 45],
    ]);
    expect(r.legs[1].before).toEqual([{ type: "ReceiverCut", direction: "RECEIVER_CUT_DIR_RIGHT", cutType: "RECEIVER_CUT_ANGLE_45" }]);
    expect(r.suffix.map((s) => s.type)).toEqual(["GetOpen", "None"]);
    expect(cutAt(r, 0)?.cutType).toBe("RECEIVER_CUT_ANGLE_45");
  });

  it("puts leading motion/precan steps in the prefix of a chain without legs", () => {
    const r = toEditableRoute([{ type: "AutoMotion", waypoints: [] }, { type: "Delay", time: 1 }, { type: "PassBlock", time: 0 }, { type: "None" }]);
    expect(r.prefix.map((s) => s.type)).toEqual(["AutoMotion", "Delay"]);
    expect(r.suffix.map((s) => s.type)).toEqual(["PassBlock", "None"]);
  });
});

describe("points and vertex editing", () => {
  const start = { x: 10.5, y: -2.2 };
  const chain = [...authored("PBS Snag", 2), { type: "None" }];

  it("computes vertices from the start", () => {
    const pts = routePoints(start, toEditableRoute(chain));
    expect(pts[0]).toEqual(start);
    expect(near(pts[1], { x: 10.5, y: 4.8 })).toBe(true);
    expect(near(pts[2], { x: 10.5 + 22 * Math.SQRT1_2, y: 4.8 + 22 * Math.SQRT1_2 })).toBe(true);
  });

  it("moving a vertex recomputes only the two adjacent legs and keeps other vertices", () => {
    const steps = [
      { type: "RunRoute", facingDirectionOverride: 0, distance: 5, direction: 90, speed: 80, overrideFacingDirection: false },
      { type: "RunRoute", facingDirectionOverride: 0, distance: 5, direction: 45, speed: 100, overrideFacingDirection: false },
      { type: "RunRoute", facingDirectionOverride: 0, distance: 10, direction: 0, speed: 100, overrideFacingDirection: false },
      { type: "RunRoute", facingDirectionOverride: 0, distance: 3.3333, direction: 87.777, speed: 100, overrideFacingDirection: false },
      { type: "GetOpen" },
      { type: "None" },
    ];
    const r = toEditableRoute(steps);
    const before = routePoints(start, r);
    const moved = moveVertex(r, start, 1, { x: before[2].x + 1, y: before[2].y + 2 });
    const after = routePoints(start, moved);
    expect(near(after[2], { x: before[2].x + 1, y: before[2].y + 2 })).toBe(true);
    for (const i of [0, 1, 3, 4]) expect(near(after[i], before[i])).toBe(true);
    const out = fromEditableRoute(moved);
    // Untouched legs: identical objects with their exact (unrounded) numbers.
    expect(out[0]).toBe(steps[0]);
    expect(out[3]).toBe(steps[3]);
    expect(out[3].distance).toBe(3.3333);
    // Touched legs: 0.01 precision, extra fields + key order preserved.
    expect(Object.keys(out[1])).toEqual(Object.keys(steps[1]));
    expect(r2(out[1].distance as number)).toBe(out[1].distance);
    expect(r2(out[2].direction as number)).toBe(out[2].direction);
    expect(out[4]).toBe(steps[4]);
  });

  it("Clear route drops the legs and the end cut, keeps the prefix, locked legs and the rest of the suffix", () => {
    const steps: Step[] = [
      { type: "InitialAnim", anim: "RELEASE_INSIDE" },
      { type: "RunRoute", distance: 5, direction: 90, speed: 80 },
      { type: "ReceiverCut", direction: "RECEIVER_CUT_LEFT", cutType: "RECEIVER_CUT_ANGLE_45" },
      { type: "RunRoute", distance: 10, direction: 135, speed: 100 },
      { type: "ReceiverCut", direction: "RECEIVER_CUT_LEFT", cutType: "RECEIVER_CUT_ANGLE_HITCH_COMEBACK" },
      { type: "Delay", time: 2 },
      { type: "GetOpen" },
      { type: "None" },
    ];
    // The comeback's end pause goes too: without a leg in front of it, it would become a delay before the new route.
    const cleared = fromEditableRoute(clearLegsFrom(toEditableRoute(steps)));
    expect(cleared.map((x) => x.type)).toEqual(["InitialAnim", "GetOpen", "None"]);
    const redrawn = fromEditableRoute(appendVertex(toEditableRoute(cleared), { x: 10, y: -2 }, { x: 10, y: 8 }));
    expect(redrawn.map((x) => x.type)).toEqual(["InitialAnim", "RunRoute", "GetOpen", "None"]);
    // A locked first leg (handoff path) stays; only what follows it goes (the pause still follows a leg).
    const kept = fromEditableRoute(clearLegsFrom(toEditableRoute(steps), 1));
    expect(kept.map((x) => x.type)).toEqual(["InitialAnim", "RunRoute", "Delay", "GetOpen", "None"]);
    expect(kept[1]).toBe(steps[1]);
    // Nothing editable to clear: unchanged.
    const r = toEditableRoute(steps);
    expect(clearLegsFrom(r, 2)).toBe(r);
  });

  it("retunes numbered cuts next to a drag and leaves named cuts alone", () => {
    const r = toEditableRoute([...authored("PBS Snag", 2), { type: "None" }]);
    const pts = routePoints(start, r);
    // Move the corner's end so the break becomes flat across (45° → 0°): the 45 becomes a 90.
    const moved = moveVertex(r, start, 1, { x: pts[1].x + 15, y: pts[1].y });
    expect(cutAt(moved, 0)).toEqual({ type: "ReceiverCut", direction: "RECEIVER_CUT_DIR_RIGHT", cutType: "RECEIVER_CUT_ANGLE_90" });
    const snag = toEditableRoute([...authored("PBS Snag", 5), { type: "None" }]);
    const sp = routePoints({ x: 5, y: -1.4 }, snag);
    const snag2 = moveVertex(snag, { x: 5, y: -1.4 }, 1, { x: sp[2].x - 2, y: sp[2].y });
    expect(cutAt(snag2, 1)?.cutType).toBe("RECEIVER_CUT_ANGLE_180_PARTIAL");
  });

  it("appends a leg with an automatic cut, inserts and removes vertices", () => {
    const one = toEditableRoute([{ type: "RunRoute", distance: 10, direction: 90, speed: 100 }, { type: "GetOpen" }, { type: "None" }]);
    const pts = routePoints(start, one);
    const two = appendVertex(one, start, { x: pts[1].x + 10, y: pts[1].y });
    expect(two.legs).toHaveLength(2);
    expect(two.legs[1]).toMatchObject({ type: "RunRoute", distance: 10, direction: 0, speed: 100 });
    expect(two.legs[1].before).toEqual([{ type: "ReceiverCut", direction: "RECEIVER_CUT_DIR_RIGHT", cutType: "RECEIVER_CUT_ANGLE_90" }]);
    expect(fromEditableRoute(two).map((s) => s.type)).toEqual(["RunRoute", "ReceiverCut", "RunRoute", "GetOpen", "None"]);

    const split = insertVertex(two, start, 0, { x: start.x, y: start.y + 4 });
    expect(split.legs.map((l) => [l.distance, l.direction])).toEqual([
      [4, 90],
      [6, 90],
      [10, 0],
    ]);
    const merged = removeVertex(split, start, 0);
    expect(merged.legs.map((l) => [l.distance, l.direction])).toEqual([
      [10, 90],
      [10, 0],
    ]);
    const shorter = removeVertex(merged, start, 1);
    expect(shorter.legs).toHaveLength(1);
    expect(fromEditableRoute(shorter).map((s) => s.type)).toEqual(["RunRoute", "GetOpen", "None"]);
  });

  it("appending after a curl turns the curl into a regular corner cut", () => {
    const curl = editRoute([...authored("PBS Snag", 5), { type: "None" }], (r) => r);
    const r = toEditableRoute(curl);
    const s = { x: 5, y: -1.4 };
    const pts = routePoints(s, r);
    const ext = appendVertex(r, s, { x: pts[2].x - 8, y: pts[2].y });
    const out = fromEditableRoute(ext);
    expect(out.filter((x) => x.type === "ReceiverCut").map((x) => x.cutType)).toEqual(["RECEIVER_CUT_ANGLE_67"]);
  });

  it("snaps relative to the previous vertex (angle + distance) or not at all", () => {
    const p = snapFrom({ x: 0, y: 0 }, { x: 4.9, y: 5.2 });
    const v = legBetween({ x: 0, y: 0 }, p);
    expect(v.direction % 5).toBe(0);
    expect((v.distance * 2) % 1).toBe(0);
    expect(snapFrom({ x: 0, y: 0 }, { x: 4.913, y: 5.217 }, { free: true })).toEqual({ x: 4.91, y: 5.22 });
  });

  it("starts after OverrideFormPos and motion", () => {
    const steps: Step[] = [
      { type: "OverrideFormPos", stance: "Receiver", offsetX: 7, offsetY: -0.8 },
      motionStep(motionPresetWaypoints("short", { x: 7, y: -0.8 })),
      { type: "RunRoute", distance: 5, direction: 90, speed: 100 },
    ];
    const r = toEditableRoute(steps);
    expect(routeStart({ x: 16, y: -0.8 }, r.prefix, steps)).toEqual({ x: 4.5, y: -2.2 });
  });

  it("moves motion waypoints as absolute positions", () => {
    const steps = setMotion([{ type: "RunRoute", distance: 5, direction: 90, speed: 100 }, { type: "None" }], motionStep(motionPresetWaypoints("jet", { x: 10.5, y: -2.2 })));
    expect(steps[0].type).toBe("AutoMotion");
    const moved = moveWaypoint(steps, 0, 0, { x: -7.123, y: -3 });
    expect((moved[0].waypoints as { position: Vec }[])[0].position).toEqual({ x: -7.12, y: -3 });
    expect(setMotion(moved, null).map((s) => s.type)).toEqual(["RunRoute", "None"]);
  });
});

describe("cuts", () => {
  it("follows the verified direction convention (LEFT = counter-clockwise)", () => {
    expect(cutFor(90, 45)).toEqual({ type: "ReceiverCut", direction: "RECEIVER_CUT_DIR_RIGHT", cutType: "RECEIVER_CUT_ANGLE_45" });
    expect(cutFor(90, 160)).toEqual({ type: "ReceiverCut", direction: "RECEIVER_CUT_DIR_LEFT", cutType: "RECEIVER_CUT_ANGLE_67" });
    expect(cutFor(90, 0)?.cutType).toBe("RECEIVER_CUT_ANGLE_90");
    expect(cutFor(90, 112)?.cutType).toBe("RECEIVER_CUT_ANGLE_22");
    expect(cutFor(90, 92)).toBeUndefined();
    expect(cutFor(90, 230)).toEqual({ type: "ReceiverCut", direction: "RECEIVER_CUT_DIR_LEFT", cutType: "RECEIVER_CUT_ANGLE_HITCH_COMEBACK" });
  });

  it("agrees with the library's cuts between legs", () => {
    let agree = 0;
    let total = 0;
    for (const a of Object.values(lib.assignments)) {
      const r = toEditableRoute(a.steps);
      for (let k = 0; k + 1 < r.legs.length; k++) {
        const c = cutAt(r, k);
        if (!c || !/ANGLE_(22|45|67|90)$/.test(String(c.cutType))) continue;
        const fit = cutFor(r.legs[k].direction, r.legs[k + 1].direction);
        if (!fit) continue;
        total++;
        if (fit.direction === c.direction) agree++;
      }
    }
    expect(total).toBeGreaterThan(1000);
    expect(agree / total).toBeGreaterThan(0.98);
  });

  it("sets, overrides and removes cuts and fakes at a vertex", () => {
    const start = { x: -16.25, y: -0.8 };
    const r = toEditableRoute([{ type: "RunRoute", distance: 10, direction: 90, speed: 100 }, { type: "GetOpen" }, { type: "None" }]);
    const curl = setCutAt(r, 0, { cutType: "RECEIVER_CUT_ANGLE_CURL" }, start);
    // End-of-route cut on the left side turns back toward the ball: clockwise (RIGHT), like the library's "CurlRt".
    expect(fromEditableRoute(curl)[1]).toEqual({ type: "ReceiverCut", direction: "RECEIVER_CUT_DIR_RIGHT", cutType: "RECEIVER_CUT_ANGLE_CURL" });
    const over = setCutAt(curl, 0, { cutType: "RECEIVER_CUT_ANGLE_CURL", direction: "RECEIVER_CUT_DIR_LEFT" });
    expect(cutAt(over, 0)?.direction).toBe("RECEIVER_CUT_DIR_LEFT");
    expect(fromEditableRoute(setCutAt(over, 0, null))).toEqual(fromEditableRoute(r));
    // A loaded RunRouteFakeOut (the builder can't author one) can be removed; nothing else at the vertex changes.
    const loaded = toEditableRoute([
      { type: "RunRoute", distance: 10, direction: 90, speed: 100 },
      { type: "ReceiverCut", direction: "RECEIVER_CUT_DIR_RIGHT", cutType: "RECEIVER_CUT_ANGLE_45" },
      { type: "RunRouteFakeOut", fakeout: "JukeLeft45Degrees" },
      { type: "RunRoute", distance: 10, direction: 45, speed: 100 },
      { type: "GetOpen" },
      { type: "None" },
    ]);
    expect(fakeAt(loaded, 0)).toBeDefined();
    const cleaned = fromEditableRoute(removeFakeAt(loaded, 0));
    expect(cleaned.map((x) => x.type)).toEqual(["RunRoute", "ReceiverCut", "RunRoute", "GetOpen", "None"]);
    expect(removeFakeAt(r, 0)).toEqual(r);
  });

  it("labels cut types", () => {
    expect(cutLabel("RECEIVER_CUT_ANGLE_45")).toBe("45°");
    expect(cutLabel("RECEIVER_CUT_ANGLE_90_INSIDE")).toBe("90° inside");
    expect(cutLabel("RECEIVER_CUT_ANGLE_HITCH_GO_INSIDE")).toBe("Hitch go inside");
  });
});

describe("presets reproduce the in-game-verified example routes", () => {
  const steps = (id: Parameters<typeof presetSteps>[0], side: "left" | "right", p: Parameters<typeof presetSteps>[2]) => presetSteps(id, { side }, p);

  it("corner, out, dig, post, over, snag, shallow, seam", () => {
    expect(steps("corner", "right", { stem: 7, breakLength: 22 })).toEqual({ steps: authored("PBS Snag", 2), routeType: "AssignRouteType_RR_Corner_Middle" });
    expect(steps("out", "right", { stem: 11, breakLength: 15 })).toEqual({ steps: authored("PBS PA Yankee", 2), routeType: "AssignRouteType_RR_Out_Middle" });
    expect(steps("post", "left", { stem: 12, breakAngle: 35, breakLength: 30 })).toEqual({ steps: authored("PBS PA Yankee", 3), routeType: "AssignRouteType_RR_Post_Deep" });
    expect(steps("in", "right", { stem: 14, breakAngle: 70, breakLength: 30 })).toEqual({ steps: authored("PBS PA Yankee", 4), routeType: "AssignRouteType_RR_In_Deep" });
    expect(steps("in", "right", { stem: 12, breakLength: 22 })).toEqual({ steps: authored("PBS Mtn Drive", 4), routeType: "AssignRouteType_RR_In_Middle" });
    expect(steps("snag", "right", {})).toEqual({ steps: authored("PBS Snag", 5), routeType: "AssignRouteType_RR_Slant_Hook" });
    expect(steps("drag", "right", { breakLength: 28 })).toEqual({ steps: authored("PBS Mtn Drive", 2), routeType: "AssignRouteType_RR_Cross" });
    expect(steps("seam", "right", {})).toEqual({ steps: authored("PBS Mtn Drive", 5), routeType: "AssignRouteType_RR_Streak" });
  });

  it("is direction-aware: out is −x on the left, curls turn toward the ball", () => {
    const outL = presetSteps("out", { side: "left" });
    expect(outL.steps[2]).toMatchObject({ type: "RunRoute", direction: 180 });
    expect(outL.steps[1]).toMatchObject({ direction: "RECEIVER_CUT_DIR_LEFT" });
    expect(presetSteps("curl", { side: "left" }).steps[1]).toMatchObject({ cutType: "RECEIVER_CUT_ANGLE_CURL", direction: "RECEIVER_CUT_DIR_RIGHT" });
    expect(presetSteps("curl", { side: "right" }).steps[1]).toMatchObject({ direction: "RECEIVER_CUT_DIR_LEFT" });
    expect(presetSteps("flat", { side: "left" }).routeType).toBe("AssignRouteType_RR_Flat_Lt");
    expect(presetSteps("wheel", { side: "right" }).routeType).toBe("AssignRouteType_RR_Wheel_Rt");
  });

  it("builds every preset with valid enum values, positive legs and no None", () => {
    const cuts = new Set(lib.enums.enums.ReceiverCutAngle);
    const routeTypes = new Set(lib.enums.enums.AssignRouteType);
    for (const def of ROUTE_PRESETS) {
      for (const side of ["left", "right"] as const) {
        const { steps: s, routeType } = presetSteps(def.id, { side });
        expect(routeTypes.has(routeType), `${def.id} ${routeType}`).toBe(true);
        expect(s.some((x) => x.type === "None")).toBe(false);
        for (const st of s) {
          if (st.type === "ReceiverCut") expect(cuts.has(String(st.cutType))).toBe(true);
          if (st.type === "RunRoute") {
            expect(st.distance as number).toBeGreaterThan(0);
            expect(st.direction as number).toBeGreaterThanOrEqual(0);
            expect(st.direction as number).toBeLessThan(360);
          }
        }
      }
    }
  });

  it("mirrors by side", () => {
    for (const def of ROUTE_PRESETS) {
      const l = presetSteps(def.id, { side: "left" }).steps.filter((s) => s.type === "RunRoute");
      const r = presetSteps(def.id, { side: "right" }).steps.filter((s) => s.type === "RunRoute");
      l.forEach((s, i) => expect(r2((180 - (s.direction as number) + 360) % 360)).toBe(r[i].direction));
    }
  });
});

describe("releases and double moves", () => {
  it("inside means toward the ball", () => {
    expect(sideHeading("right", "in", 15)).toBe(105);
    expect(sideHeading("left", "in", 15)).toBe(75);
    expect(sideHeading("right", "out", 90)).toBe(0);
    expect(sideHeading("left", "out", 90)).toBe(180);
    expect(headingRelative("right", 105)).toEqual({ toward: "in", fromVertical: 15 });
    expect(headingRelative("left", 220)).toEqual({ toward: "out", fromVertical: 130 });
  });

  it("adds, detects, replaces and removes a release without moving later vertices", () => {
    const start = { x: 16.25, y: -2.2 };
    const r = toEditableRoute([...authored("PBS Snag", 2), { type: "None" }]);
    const pts = routePoints(start, r);
    const inside = setRelease(r, start, "right", "inside", { anim: "MOVETYPE_WRSTART" });
    expect(detectRelease(inside, "right")).toBe("inside");
    expect(inside.legs[0]).toMatchObject({ distance: 1.5, direction: 105 });
    expect(inside.prefix).toEqual([{ type: "InitialAnim", anim: "MOVETYPE_WRSTART", direction: 105 }]);
    const ip = routePoints(start, inside);
    expect(near(ip[2], pts[1])).toBe(true);
    expect(near(ip[3], pts[2])).toBe(true);
    const outside = setRelease(inside, start, "right", "outside");
    expect(detectRelease(outside, "right")).toBe("outside");
    expect(near(routePoints(start, outside)[3], pts[2])).toBe(true);
    const none = setRelease(outside, start, "right", "none", { anim: null });
    expect(detectRelease(none, "right")).toBe("none");
    expect(none.prefix).toEqual([]);
    const np = routePoints(start, none);
    expect(np).toHaveLength(3);
    expect(near(np[1], pts[1])).toBe(true);
  });

  it("builds double moves with the library's cut types", () => {
    const sg = doubleMoveSteps("slant_go", "right");
    expect(sg.steps[1]).toEqual({ type: "ReceiverCut", direction: "RECEIVER_CUT_DIR_LEFT", cutType: "RECEIVER_CUT_ANGLE_SLANT_AND_GO" });
    expect(sg.steps[2]).toMatchObject({ direction: 80 });
    expect(doubleMoveSteps("out_up", "right").steps[1]).toMatchObject({ cutType: "RECEIVER_CUT_ANGLE_OUT_AND_UP", direction: "RECEIVER_CUT_DIR_RIGHT" });
    const cuts = new Set(lib.enums.enums.ReceiverCutAngle);
    for (const { id } of DOUBLE_MOVES) {
      const built = doubleMoveSteps(id, "left").steps;
      // Every double move is a ReceiverCut cut type (RunRouteFakeOut has no library instance to build from).
      expect(built.some((st) => st.type === "ReceiverCut"), id).toBe(true);
      expect(built.some((st) => st.type === "RunRouteFakeOut"), id).toBe(false);
      for (const st of built) if (st.type === "ReceiverCut") expect(cuts.has(String(st.cutType))).toBe(true);
    }
  });
});

describe("blocks and motion", () => {
  it("pulls match the in-game-verified GT Counter linemen", () => {
    const gt = ytrips.data.plays.find((p) => p.name === "PBS GT Counter")!;
    expect(blockSteps("pull", { anim: "MOVETYPE_COUNTER_PULL" }).steps).toEqual((gt.players!["6"] as NewAssignmentSpec).steps);
    expect(blockSteps("pull", { anim: "MOVETYPE_COUNTER_PULL", technique: "BLOCKINGTECHNIQUE_KICKOUT" }).steps).toEqual(
      (gt.players!["7"] as NewAssignmentSpec).steps,
    );
  });

  it("detects block tools", () => {
    expect(detectBlockTool(blockSteps("pass").steps)).toBe("pass");
    expect(detectBlockTool(blockSteps("release").steps)).toBe("release");
    expect(detectBlockTool(blockSteps("screen", { lineman: true }).steps)).toBe("screen");
    expect(detectBlockTool(blockSteps("crack").steps)).toBe("crack");
    expect(detectBlockTool(blockSteps("stalk").steps)).toBe("stalk");
    expect(detectBlockTool(blockSteps("pull").steps)).toBe("pull");
    expect(detectBlockTool(authored("PBS Snag", 2))).toBeUndefined();
  });

  it("block steps only use legal enum values", () => {
    const tech = new Set(lib.enums.enums.BlockingTechnique);
    const gaps = new Set(lib.enums.enums.BlockingGap);
    const anims = new Set(lib.enums.enums.InitialMoveType);
    for (const tool of ["pass", "release", "run", "lead", "kickout", "trap", "wham", "crack", "stalk", "pull", "screen"] as const) {
      for (const s of blockSteps(tool, { lineman: true }).steps) {
        if (s.type === "LeadBlock") {
          expect(tech.has(String(s.blockingTechnique))).toBe(true);
          expect(gaps.has(String(s.blockingGap))).toBe(true);
        }
        if (s.type === "InitialAnim") expect(anims.has(String(s.anim))).toBe(true);
      }
    }
  });

  it("motion presets move toward / across the ball and keep library waypoint shapes", () => {
    const start = { x: 10.5, y: -2.2 };
    const jet = motionPresetWaypoints("jet", start);
    expect(jet.at(-1)!.position.x).toBeLessThan(0);
    const orbit = motionPresetWaypoints("orbit", start, { qbY: -6 });
    expect(orbit.length).toBeGreaterThanOrEqual(3);
    expect(Math.min(...orbit.map((w) => w.position.y))).toBeLessThan(-6);
    const lib1 = Object.values(lib.assignments).find((a) => a.steps[0]?.type === "AutoMotion")!.steps[0];
    expect(Object.keys(motionStep(jet))).toEqual(Object.keys(lib1));
    expect(Object.keys(jet[0])).toEqual(Object.keys((lib1.waypoints as object[])[0]));
  });

  it("replaceBody keeps motion and precans in front", () => {
    const chain: Step[] = [{ type: "OverrideFormPos", offsetX: 1, offsetY: -1 }, { type: "AutoMotion", waypoints: [] }, { type: "InitialAnim", anim: "MOVETYPE_WRSTART" }, { type: "RunRoute", distance: 3, direction: 90, speed: 100 }, { type: "None" }];
    expect(replaceBody(chain, [{ type: "GetOpen" }]).map((s) => s.type)).toEqual(["OverrideFormPos", "AutoMotion", "GetOpen", "None"]);
    expect(replaceBody(chain, [{ type: "GetOpen" }], 0).map((s) => s.type)).toEqual(["GetOpen", "None"]);
  });
});

describe("classification", () => {
  it("infers route types for drawn routes", () => {
    expect(inferRouteType(authored("PBS Snag", 2), "right")).toBe("AssignRouteType_RR_Corner_Middle");
    expect(inferRouteType(authored("PBS PA Yankee", 2), "right")).toBe("AssignRouteType_RR_Out_Middle");
    expect(inferRouteType(authored("PBS Mtn Drive", 5), "right")).toBe("AssignRouteType_RR_Streak");
    expect(inferRouteType(authored("PBS GT Counter", 6), "left")).toBe("AssignRouteType_Block_Run");
    expect(inferRouteType(presetSteps("curl", { side: "left" }).steps, "left")).toBe("AssignRouteType_RR_Curl_Medium");
    expect(stemDepth(authored("PBS Snag", 2))).toBe(7);
  });

  it("works on a real route via editRoute without changing untouched input", () => {
    const steps = lib.assignments["football/Gameplay/playbooks/PlayLibrary/Assignments/RunRoute/WR_Run90for30"].steps;
    const copy = JSON.stringify(steps);
    const r: EditableRoute = toEditableRoute(steps);
    moveVertex(r, { x: 0, y: 0 }, 0, { x: 1, y: 1 });
    expect(JSON.stringify(steps)).toBe(copy);
  });
});

describe("route end", () => {
  it("switches between get open, sit and none", async () => {
    const { routeEnd, setRouteEnd } = await import("./routes");
    const start = { x: -16.25, y: -0.8 };
    const r = toEditableRoute([{ type: "RunRoute", distance: 10, direction: 90, speed: 100 }, { type: "GetOpen" }, { type: "None" }]);
    expect(routeEnd(r)).toBe("getopen");
    const sit = setRouteEnd(r, "sit", start);
    expect(routeEnd(sit)).toBe("sit");
    expect(fromEditableRoute(sit).map((s) => s.type)).toEqual(["RunRoute", "ReceiverCut", "GetOpen", "None"]);
    expect(cutAt(sit, 0)).toMatchObject({ cutType: "RECEIVER_CUT_ANGLE_CURL", direction: "RECEIVER_CUT_DIR_RIGHT" });
    const none = setRouteEnd(sit, "none", start);
    expect(routeEnd(none)).toBe("none");
    expect(fromEditableRoute(none).map((s) => s.type)).toEqual(["RunRoute", "None"]);
    expect(fromEditableRoute(setRouteEnd(none, "getopen", start))).toEqual(fromEditableRoute(r));
  });
});
