import { describe, expect, it } from "vitest";
import { loadLibraryData } from "./libFixture";
import {
  ROUTES_PATH,
  addRoute,
  applySavedRouteSteps,
  canSaveRoute,
  emptyRoutesDoc,
  isSavedRouteApplied,
  makeSavedRoute,
  moveRoute,
  newRouteId,
  removeRoute,
  renameRoute,
  routePartOf,
  routesOf,
  savedRouteFor,
  savedRouteNameBase,
  uniqueRouteName,
} from "./routeLibrary";
import {
  CUT_LEFT,
  CUT_RIGHT,
  ROUTE_PRESETS,
  mirrorDirection,
  mirrorGap,
  mirrorRouteType,
  mirrorStep,
  mirrorSteps,
  motionPresetWaypoints,
  motionStep,
  presetSteps,
  routePoints,
  toEditableRoute,
} from "./routes";
import type { RoutesDoc, SavedRoute, Step } from "./types";

const lib = loadLibraryData();

const corner: Step[] = [
  { type: "InitialAnim", optionalInitalDirection: -1, anim: "MOVETYPE_WRSTART", direction: 90 },
  { type: "RunRoute", distance: 1.5, direction: 105, speed: 80 },
  { type: "RunRoute", distance: 8, direction: 90, speed: 80 },
  { type: "ReceiverCut", direction: CUT_RIGHT, cutType: "RECEIVER_CUT_ANGLE_45" },
  { type: "RunRoute", distance: 14, direction: 45, speed: 100 },
  { type: "GetOpen" },
];
const motion = motionStep(motionPresetWaypoints("short", { x: 12, y: -2.2 }));
const ofp: Step = { type: "OverrideFormPos", stance: "Receiver", offsetX: 10, offsetY: -0.8 };

describe("mirroring", () => {
  it("mirrors directions, cut directions, gaps and positions; cut types keep their meaning", () => {
    expect(mirrorDirection(105)).toBe(75);
    expect(mirrorDirection(90)).toBe(90);
    expect(mirrorDirection(0)).toBe(180);
    expect(mirrorDirection(270)).toBe(270);
    expect(mirrorDirection(104.04)).toBe(75.96);
    expect(mirrorStep({ type: "ReceiverCut", direction: CUT_LEFT, cutType: "RECEIVER_CUT_ANGLE_HITCH_GO_INSIDE" })).toEqual({
      type: "ReceiverCut",
      direction: CUT_RIGHT,
      cutType: "RECEIVER_CUT_ANGLE_HITCH_GO_INSIDE",
    });
    expect(mirrorGap("A_GAP_RIGHT")).toBe("A_GAP_Left");
    expect(mirrorGap("OUTSIDE_GAP_Left")).toBe("OUTSIDE_GAP_RIGHT");
    expect(mirrorGap("RUN_HOLE")).toBe("RUN_HOLE");
    expect(mirrorStep(ofp)).toEqual({ ...ofp, offsetX: -10 });
    const m = mirrorStep(motion);
    expect((m.waypoints as { position: { x: number } }[])[0].position.x).toBe(-(motion.waypoints as { position: { x: number } }[])[0].position.x);
    // Key order survives.
    expect(Object.keys(mirrorStep(corner[1]))).toEqual(Object.keys(corner[1]));
  });

  it("mirroring twice gives back every library assignment chain (angles in [0, 360))", () => {
    // Mirrored angles are written in [0, 360): the library's few 360° / negative headings come back as 0° / +.
    const angleKeys = new Set(["direction", "facingDirectionOverride", "faceDirection", "optionalInitalDirection", "facingAngle"]);
    const norm = (v: unknown, k?: string): unknown => {
      if (Array.isArray(v)) return v.map((x) => norm(x));
      if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([kk, x]) => [kk, norm(x, kk)]));
      return typeof v === "number" && k && angleKeys.has(k) && v !== -1 ? ((v % 360) + 360) % 360 : v;
    };
    for (const [asset, a] of Object.entries(lib.assignments)) {
      const twice = mirrorSteps(mirrorSteps(a.steps));
      expect(norm(twice), asset).toEqual(norm(a.steps));
      // Key order survives too.
      twice.forEach((s, i) => expect(Object.keys(s)).toEqual(Object.keys(a.steps[i])));
    }
  });

  it("a mirrored route draws the mirror image of the original", () => {
    for (const p of ROUTE_PRESETS) {
      const steps = presetSteps(p.id, { side: "right" }).steps;
      const a = routePoints({ x: 12, y: -0.8 }, toEditableRoute(steps));
      const b = routePoints({ x: -12, y: -0.8 }, toEditableRoute(mirrorSteps(steps)));
      a.forEach((pt, i) => {
        expect(b[i].x, `${p.id} x${i}`).toBeCloseTo(-pt.x, 6);
        expect(b[i].y, `${p.id} y${i}`).toBeCloseTo(pt.y, 6);
      });
    }
  });

  it("swaps side-specific route types", () => {
    const valid = new Set(lib.enums.enums.AssignRouteType);
    expect(mirrorRouteType("AssignRouteType_RR_Flat_Lt", valid)).toBe("AssignRouteType_RR_Flat_Rt");
    expect(mirrorRouteType("AssignRouteType_RR_RB_Screen_Rt", valid)).toBe("AssignRouteType_RR_RB_Screen_Left");
    expect(mirrorRouteType("AssignRouteType_RR_RB_Screen_Left", valid)).toBe("AssignRouteType_RR_RB_Screen_Rt");
    expect(mirrorRouteType("AssignRouteType_RR_Corner_Deep", valid)).toBe("AssignRouteType_RR_Corner_Deep");
    expect(mirrorRouteType(undefined)).toBeUndefined();
  });
});

describe("saving a route", () => {
  it("stores the route part only (no motion / realignment / None)", () => {
    const chain = [ofp, motion, ...corner, { type: "None" }];
    expect(routePartOf(chain)).toEqual(corner);
    expect(canSaveRoute(chain)).toBe(true);
    expect(canSaveRoute([motion, { type: "PassBlock", time: 0, flags: "PassBlockFlags_None" }, { type: "None" }])).toBe(false);
    const r = makeSavedRoute({ name: "Deep corner", side: "right", steps: chain, routeType: "AssignRouteType_RR_Corner_Deep", createdAt: "2026-10-04T10:00:00Z" });
    expect(r).toEqual({ id: "deep-corner", name: "Deep corner", side: "right", steps: corner, routeType: "AssignRouteType_RR_Corner_Deep", createdAt: "2026-10-04T10:00:00Z" });
    // The stored steps are a copy.
    expect(r.steps[1]).not.toBe(corner[1]);
  });

  it("keeps a handoff precan out of the saved route", () => {
    const precan: Step[] = [{ type: "HandoffFake", pitchPlayer: 0, handoffRun: "x", handoffExit: "y", receiverPlayer: 0 }, { type: "Delay", time: 0.5 }];
    const chain = [...precan, ...corner, { type: "None" }];
    expect(routePartOf(chain, 2)).toEqual(corner);
  });

  it("refuses a chain without legs", () => {
    expect(() => makeSavedRoute({ name: "x", side: "left", steps: [{ type: "GetOpen" }] })).toThrow();
  });

  it("keeps ids and names unique", () => {
    const existing: SavedRoute[] = [{ id: "deep-corner", name: "Deep corner", side: "right", steps: corner }];
    const r = makeSavedRoute({ name: "deep corner", side: "left", steps: corner, existing });
    expect(r).toMatchObject({ id: "deep-corner-2", name: "deep corner 2" });
  });
});

describe("applying a saved route", () => {
  const saved: SavedRoute = { id: "c", name: "Corner", side: "right", steps: corner, routeType: "AssignRouteType_RR_Corner_Deep" };

  it("same side: replaces the route part and keeps the motion / realignment in front", () => {
    const slot: Step[] = [ofp, motion, { type: "RunRoute", distance: 5, direction: 90, speed: 100 }, { type: "None" }];
    const out = applySavedRouteSteps(slot, saved, "right");
    expect(out.mirrored).toBe(false);
    expect(out.steps).toEqual([ofp, motion, ...corner, { type: "None" }]);
    expect(isSavedRouteApplied(out.steps, saved, "right")).toBe(true);
    expect(isSavedRouteApplied(out.steps, saved, "left")).toBe(false);
  });

  it("other side: mirrored (inside stays inside)", () => {
    const out = applySavedRouteSteps([{ type: "None" }], saved, "left");
    expect(out.mirrored).toBe(true);
    const body = out.steps.slice(0, -1);
    expect(body[1]).toMatchObject({ direction: 75 }); // inside release for a left-side player
    expect(body[3]).toMatchObject({ direction: CUT_LEFT, cutType: "RECEIVER_CUT_ANGLE_45" });
    expect(body[4]).toMatchObject({ direction: 135 }); // corner = outside = −x on the left
    expect(isSavedRouteApplied(out.steps, saved, "left")).toBe(true);
  });

  it("round trip: save on the right, apply on the left, save that, apply on the right = the original", () => {
    const left = applySavedRouteSteps([{ type: "None" }], saved, "left").steps;
    const resaved = makeSavedRoute({ name: "Corner L", side: "left", steps: left });
    const back = applySavedRouteSteps([{ type: "None" }], resaved, "right").steps;
    expect(back).toEqual([...corner, { type: "None" }]);
    expect(savedRouteFor(resaved, "left").steps).toEqual(left.slice(0, -1));
  });

  it("respects a kept precan", () => {
    const precan: Step[] = [{ type: "CannedHandoff", playerNum: 0, handoffAnim: "a", flippedHandoffAnim: "b" }, { type: "Delay", time: 1 }];
    const slot = [...precan, { type: "RunRoute", distance: 3, direction: 90, speed: 100 }, { type: "None" }];
    expect(applySavedRouteSteps(slot, saved, "right", 2).steps).toEqual([...precan, ...corner, { type: "None" }]);
  });

  it("names the authored assignment after the route", () => {
    expect(savedRouteNameBase("PBS_", "Deep over")).toBe("PBS_Deep_Over");
    expect(savedRouteNameBase("PBS_", "deep over", "left")).toBe("PBS_Deep_Over_Lt");
    expect(savedRouteNameBase("PBS_", "PBS corner!")).toBe("PBS_Corner");
    expect(savedRouteNameBase("", "  ")).toBe("Route");
  });
});

describe("the routes doc", () => {
  it("adds, renames (unique), moves and removes routes", () => {
    const doc = structuredClone(emptyRoutesDoc()) as RoutesDoc;
    expect(ROUTES_PATH).toBe("app-data/routes.json");
    addRoute(doc, { id: "a", name: "Alpha", side: "left", steps: corner });
    addRoute(doc, { id: "b", name: "Bravo", side: "right", steps: corner });
    expect(renameRoute(doc, "b", "alpha")).toBe("alpha 2");
    expect(renameRoute(doc, "zz", "x")).toBeUndefined();
    moveRoute(doc, "b", -1);
    expect(doc.routes.map((r) => r.id)).toEqual(["b", "a"]);
    expect(removeRoute(doc, "a")).toBe(true);
    expect(removeRoute(doc, "a")).toBe(false);
    expect(routesOf(doc).map((r) => r.name)).toEqual(["alpha 2"]);
  });

  it("tolerates malformed files", () => {
    expect(routesOf(null)).toEqual([]);
    expect(routesOf({ version: 1, routes: "x" } as unknown as RoutesDoc)).toEqual([]);
    expect(routesOf({ version: 1, routes: [{ id: "x" }, { id: "y", name: "Y", side: "left", steps: [] }] } as unknown as RoutesDoc).map((r) => r.id)).toEqual(["y"]);
  });

  it("makes ids and names", () => {
    expect(newRouteId("Deep Over!", [])).toBe("deep-over");
    expect(newRouteId("Deep Over", ["deep-over"])).toBe("deep-over-2");
    expect(newRouteId("***", [])).toBe("route");
    expect(uniqueRouteName("Slant", [{ id: "1", name: "slant", side: "left", steps: [] }])).toBe("Slant 2");
    expect(uniqueRouteName("Slant", [{ id: "1", name: "slant", side: "left", steps: [] }], "1")).toBe("Slant");
  });
});
