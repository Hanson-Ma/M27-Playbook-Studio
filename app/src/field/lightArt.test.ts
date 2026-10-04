import { describe, expect, it } from "vitest";
import { SAMPLE_ROUTES, SET_Y_TRIPS_WK, mirrorSteps } from "./fixtures";
import { lightSlotArt } from "./lightArt";

const steps = (name: string) => SAMPLE_ROUTES.find((r) => r.name === name)!.steps;
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6);

describe("lightSlotArt", () => {
  it("walks legs from the alignment", () => {
    const art = lightSlotArt(SET_Y_TRIPS_WK, 4, steps("Out"));
    expect(art.players).toHaveLength(1);
    expect(art.players[0].label).toBe("WR2");
    const p = art.paths[0];
    expect(p.kind).toBe("route");
    expect(p.cap).toBe("arrow");
    const end = p.points[p.points.length - 1];
    close(end.x, 26.25);
    close(end.y, 7.8);
    expect(p.vertices?.[0]).toMatchObject({ index: 1, cut: "RECEIVER_CUT_ANGLE_90" });
  });

  it("hooks curls back toward the cut side", () => {
    const art = lightSlotArt(SET_Y_TRIPS_WK, 4, steps("Curl"));
    const pts = art.paths[0].points;
    expect(pts).toHaveLength(5);
    expect(pts[4].x).toBeLessThan(pts[1].x); // cut LEFT → hook toward −x
    expect(pts[4].y).toBeLessThan(pts[1].y);
  });

  it("splits motion from the route and starts the route at the last waypoint", () => {
    const art = lightSlotArt(SET_Y_TRIPS_WK, 4, steps("Jet motion → Flat"));
    expect(art.paths.map((p) => p.kind)).toEqual(["motion", "route"]);
    expect(art.paths[0].points[1]).toEqual({ x: 4, y: -3 });
    expect(art.paths[1].points[0]).toEqual({ x: 4, y: -3 });
  });

  it("realigns with OverrideFormPos (absolute)", () => {
    const art = lightSlotArt(SET_Y_TRIPS_WK, 3, [
      { type: "OverrideFormPos", stance: "Receiver", offsetX: -8, offsetY: -0.8 },
      { type: "RunRoute", distance: 5, direction: 90, speed: 100 },
    ]);
    expect(art.paths[0]).toMatchObject({ kind: "realign", points: [{ x: -16.25, y: -0.8 }, { x: -8, y: -0.8 }] });
    expect(art.players[0].at).toEqual({ x: -8, y: -0.8 });
    expect(art.paths[1].points[0]).toEqual({ x: -8, y: -0.8 });
  });

  it("draws blocks with a T cap", () => {
    const stalk = lightSlotArt(SET_Y_TRIPS_WK, 3, steps("Stalk block"));
    expect(stalk.paths[0]).toMatchObject({ kind: "block", cap: "block" });
    const pb = lightSlotArt(SET_Y_TRIPS_WK, 8, steps("Pass block"));
    expect(pb.paths[0].points).toHaveLength(2);
    expect(pb.paths[0].points[1].y).toBeLessThan(pb.paths[0].points[0].y);
  });

  it("drops the QB by drop type", () => {
    const art = lightSlotArt(SET_Y_TRIPS_WK, 0, [{ type: "QBScramble", direction: 0, dropBackType: "DROP_TYPEENUM_QBDROP_5_STEP_PISTOL", distance: 0 }]);
    expect(art.paths[0]).toMatchObject({ kind: "qb", cap: "none" });
    close(art.paths[0].points[1].y, -9.2);
  });

  it("flip mirrors alignment and directions", () => {
    const right = lightSlotArt(SET_Y_TRIPS_WK, 4, steps("Curl"));
    const flipped = lightSlotArt(SET_Y_TRIPS_WK, 4, steps("Curl"), { flip: true });
    const a = right.paths[0].points;
    const b = flipped.paths[0].points;
    expect(b).toHaveLength(a.length);
    a.forEach((p, i) => {
      close(b[i].x, -p.x);
      close(b[i].y, p.y);
    });
  });

  it("mirrorSteps is an involution", () => {
    for (const r of SAMPLE_ROUTES) expect(mirrorSteps(mirrorSteps(r.steps))).toEqual(r.steps);
    expect(mirrorSteps([{ type: "RunRoute", distance: 3, direction: 45, speed: 100 }])[0].direction).toBe(135);
  });

  it("returns empty art for an unknown slot", () => {
    expect(lightSlotArt(SET_Y_TRIPS_WK, 42, []).players).toHaveLength(0);
  });
});

describe("lightSlotArt cut styles", () => {
  it("marks cut styles and lets a DRAG_STOP settle instead of hooking", async () => {
    const { lightSlotArt } = await import("./lightArt");
    const { SET_Y_TRIPS_WK } = await import("./fixtures");
    const steps = [
      { type: "RunRoute", distance: 2, direction: 120, speed: 100 },
      { type: "RunRoute", distance: 10, direction: 180, speed: 100 },
      { type: "ReceiverCut", direction: "RECEIVER_CUT_DIR_LEFT", cutType: "RECEIVER_CUT_ANGLE_DRAG_STOP" },
      { type: "GetOpen" },
    ];
    const [p] = lightSlotArt(SET_Y_TRIPS_WK, 4, steps).paths;
    expect(p.points).toHaveLength(3);
    expect(p.vertices?.[0]).toMatchObject({ index: 2, style: "settle" });
    const curl = lightSlotArt(SET_Y_TRIPS_WK, 4, [steps[0], { ...steps[2], cutType: "RECEIVER_CUT_ANGLE_CURL" }, steps[3]]).paths[0];
    expect(curl.points).toHaveLength(2 + 3);
    expect(curl.vertices?.[0]).toMatchObject({ index: 1, style: "turnback" });
  });
});
