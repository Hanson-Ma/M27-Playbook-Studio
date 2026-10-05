// Hand-built PlayArt fixtures for developing and eyeballing the renderer independently of the art engine.
// Alignments and steps are copied from data/library (Shotgun Y Trips Wk, 4-3 Over); paths are walked by hand
// with the FORMATS.md conventions (legs = distance @ absolute direction, AutoMotion waypoints absolute,
// OverrideFormPos absolute). They exercise every ArtKind, cap and zone color the renderer supports.
import { add, polar } from "../model/geometry";
import { glyphFor, slotLabel } from "../model/positions";
import type {
  AlignmentPos,
  ArtCap,
  ArtKind,
  ArtPath,
  ArtPlayer,
  ArtVertex,
  ArtZone,
  PlayArt,
  ResolvedPlay,
  SetDef,
  Side,
  Step,
  Vec,
} from "../model/types";
import { boundsOfPoints } from "./fieldMath";
import { hookPoints } from "./lightArt";

const FORMATIONS = "football/Gameplay/playbooks/PlayLibrary/Formations/";
const BLOCKING = "football/Gameplay/playbooks/PlayLibrary/Blocking/";

// ───────────────────────────── sets ─────────────────────────────

const pos = (
  p: string,
  depth: number,
  x: number,
  y: number,
  group: string,
  extra: Partial<AlignmentPos> = {},
): AlignmentPos => ({ pos: p, depth, x, y, facing: 90, stance: "StanceType_2pt", group, motionMan: false, ...extra });

/** Shotgun Y Trips Wk (setId 212), Normal + two motion presets. */
export const SET_Y_TRIPS_WK: SetDef = {
  setId: 212,
  name: "Y Trips Wk",
  asset: `${FORMATIONS}Offense/Shotgun/Y_Trips_Wk/Y_Trips_Wk`,
  formation: `${FORMATIONS}Offense/Shotgun/Shotgun`,
  classification: "Class_Shotgun",
  setType: "SetType_Trips",
  canFlip: true,
  movements: {
    Normal: [
      pos("POSITION_QB", 1, 0, -6, "Set_Group_Type_Quarterback", { stance: "StanceType_QB_Before_Play" }),
      pos("POSITION_3DRB", 1, -2.9, -6, "Set_Group_Type_MotionMan1", { motionMan: true }),
      pos("POSITION_SLWR", 1, 10.5, -2.2, "Set_Group_Type_MotionMan2", { motionMan: true }),
      pos("POSITION_WR", 1, -16.25, -0.8, "Set_Group_Type_MotionMan3"),
      pos("POSITION_WR", 2, 16.25, -2.2, "Set_Group_Type_MotionMan4"),
      pos("POSITION_LASTKEYOFFENSE", 1, 5, -1.4, "Set_Group_Type_MotionMan5", { stance: "StanceType_3pt", motionMan: true }),
      pos("POSITION_FIRSTOFFENSELINE", 1, -3.333, -1.2, "Set_Group_Type_Linemen"),
      pos("POSITION_LG", 1, -1.666, -0.9, "Set_Group_Type_Linemen", { stance: "StanceType_3pt" }),
      pos("POSITION_C", 1, 0, -0.6, "Set_Group_Type_Linemen", { stance: "StanceType_3pt" }),
      pos("POSITION_RG", 1, 1.666, -0.9, "Set_Group_Type_Linemen", { stance: "StanceType_3pt" }),
      pos("POSITION_LASTOFFENSELINE", 1, 3.333, -1.2, "Set_Group_Type_Linemen"),
    ],
    M1left: [pos("POSITION_3DRB", 1, -10.4, -2.2, "Set_Group_Type_MotionMan1", { motionMan: true })],
    M2left: [pos("POSITION_SLWR", 1, -10.4, -2.2, "Set_Group_Type_MotionMan2", { motionMan: true })],
  },
};

/** 4-3 Over (setId 2), Normal. */
export const SET_43_OVER: SetDef = {
  setId: 2,
  name: "Over",
  asset: `${FORMATIONS}Defense/4-3/Over/Over`,
  formation: `${FORMATIONS}Defense/4-3/4-3`,
  classification: "Class_4_3",
  setType: "SetType_None",
  canFlip: true,
  movements: {
    Normal: [
      pos("POSITION_RE", 1, -5, 1.2, "Set_Group_Type_Defensive_Line", { facing: 280, stance: "StanceType_3pt" }),
      pos("POSITION_NT", 1, -0.75, 1.2, "Set_Group_Type_Defensive_Line", { facing: 270, stance: "StanceType_3pt" }),
      pos("POSITION_LASTDEFENSELINE", 1, 2.4, 1.2, "Set_Group_Type_Defensive_Line", { facing: 270, stance: "StanceType_3pt" }),
      pos("POSITION_FIRSTDEFENSELINE", 1, 5.5, 1.2, "Set_Group_Type_Defensive_Line", { facing: 260, stance: "StanceType_3pt" }),
      pos("POSITION_LASTDEFENSELB", 1, -3.8, 5, "Set_Group_Type_Linebackers", { facing: 270 }),
      pos("POSITION_MLB", 1, 0, 6, "Set_Group_Type_Linebackers", { facing: 270 }),
      pos("POSITION_FIRSTDEFENSELB", 1, 3.8, 5, "Set_Group_Type_Linebackers", { facing: 270 }),
      pos("POSITION_FIRSTDEFENSEDB", 1, -15, 8, "Set_Group_Type_Defensive_Backs", { facing: 270 }),
      pos("POSITION_FS", 1, -8, 12, "Set_Group_Type_Defensive_Backs", { facing: 280 }),
      pos("POSITION_SS", 1, 8, 12, "Set_Group_Type_Defensive_Backs", { facing: 260 }),
      pos("POSITION_FIRSTDEFENSEDB", 2, 15, 8, "Set_Group_Type_Defensive_Backs", { facing: 270 }),
    ],
  },
};

// ───────────────────────────── builders ─────────────────────────────

/** Walk legs of [distance, direction°] from `start`; returns every vertex including the start. */
function walk(start: Vec, ...legs: [number, number][]): Vec[] {
  const pts = [start];
  let p = start;
  for (const [d, dir] of legs) {
    p = add(p, polar(dir, d));
    pts.push(p);
  }
  return pts;
}

/** The hook a vertical curl draws back toward the QB: `side` +1 turns toward +x, −1 toward −x. */
const hook = (end: Vec, side: 1 | -1): Vec[] => hookPoints(end, 90, side < 0);

function path(slot: number, kind: ArtKind, points: Vec[], cap: ArtCap, extra: Partial<ArtPath> = {}): ArtPath {
  return { slot, kind, points, cap, ...extra };
}

const cut = (index: number, cutType: string, dir: "LEFT" | "RIGHT", step?: number): ArtVertex => ({
  index,
  cut: `RECEIVER_CUT_ANGLE_${cutType}`,
  cutDir: `RECEIVER_CUT_DIR_${dir}`,
  step,
});

function players(
  set: SetDef,
  side: Side,
  o: { vip?: number; ballcarrier?: number; at?: Record<number, Vec>; snap?: Record<number, Vec> } = {},
): ArtPlayer[] {
  return set.movements.Normal.map((a, slot) => {
    const base = { x: a.x, y: a.y };
    const at = o.at?.[slot] ?? base;
    return {
      slot,
      pos: a.pos,
      depth: a.depth,
      label: slotLabel(a.pos, a.depth),
      glyph: glyphFor(a),
      base,
      at,
      snap: o.snap?.[slot] ?? at,
      facing: a.facing,
      stance: a.stance,
      isVip: slot === o.vip,
      isBallcarrier: slot === o.ballcarrier,
      motionMan: a.motionMan,
      side,
    };
  });
}

function art(ps: ArtPlayer[], paths: ArtPath[], zones: ArtZone[] = []): PlayArt {
  const pts: Vec[] = [];
  for (const p of ps) pts.push(p.at, p.snap);
  for (const p of paths) pts.push(...p.points);
  for (const z of zones) pts.push({ x: z.center.x - z.rx, y: z.center.y - z.ry }, { x: z.center.x + z.rx, y: z.center.y + z.ry });
  return { players: ps, paths, zones, bounds: boundsOfPoints(pts) ?? { minX: -1, maxX: 1, minY: -1, maxY: 1 }, flipped: false };
}

/** OL pass protection as the engine draws it in detail views: a short gray set step with a T. */
function passPro(set: SetDef): ArtPath[] {
  const dirs = [110, 100, 90, 80, 70];
  return [6, 7, 8, 9, 10].map((slot, i) => {
    const a = set.movements.Normal[slot];
    return path(slot, "block", walk({ x: a.x, y: a.y }, [0.9, dirs[i]]), "block");
  });
}

function resolved(p: Pick<ResolvedPlay, "name" | "asset" | "set" | "formation" | "side" | "playType"> & Partial<ResolvedPlay>): ResolvedPlay {
  return {
    key: p.asset,
    source: "library",
    blocking: `${BLOCKING}CODE_DETERMINE`,
    runHole: 0,
    vip: 0,
    reads: [],
    canFlip: true,
    allowHotRoutes: true,
    global: true,
    slots: [],
    problems: [],
    ...p,
  };
}

// ───────────────────────────── fixtures ─────────────────────────────

export interface ArtFixture {
  id: string;
  play: ResolvedPlay;
  set: SetDef;
  /** Card art (no pass protection), like artForPlay for a card. */
  art: PlayArt;
  /** Detail art (adds OL pass protection, labels on paths). */
  detail: PlayArt;
  /** What the fixture exercises. */
  note: string;
  stat?: string;
}

const T = SET_Y_TRIPS_WK.movements.Normal;
const at = (slot: number): Vec => ({ x: T[slot].x, y: T[slot].y });

/** Gun Y Trips Wk — Curls: QB 3-step, HB swing left, slot post, X curl, Z curl (vip, red), Y flat. */
function curls(): ArtFixture {
  const wr1 = walk(at(3), [10, 90]);
  const wr2 = walk(at(4), [10, 90]);
  const routes = [
    path(0, "qb", walk(at(0), [2.2, 270]), "none"),
    path(1, "route", walk(at(1), [3, 200], [2, 180], [6, 170], [3, 160], [3, 130], [3, 110], [3, 90]), "arrow"),
    path(2, "route", walk(at(2), [8.5, 90], [30, 135]), "arrow", { vertices: [cut(1, "45", "LEFT", 1)] }),
    path(3, "route", [...wr1, ...hook(wr1[1], 1)], "arrow", { vertices: [cut(1, "CURL", "RIGHT", 1)], label: "CURL" }),
    path(4, "primary", [...wr2, ...hook(wr2[1], -1)], "arrow", { vertices: [cut(1, "CURL", "LEFT", 1)], label: "CURL" }),
    path(5, "route", walk(at(5), [1, 18], [1.5, 16], [20, 12]), "arrow"),
  ];
  const ps = players(SET_Y_TRIPS_WK, "offense", { vip: 4 });
  const play = resolved({
    name: "Curls",
    asset: `${FORMATIONS}Offense/Shotgun/Y_Trips_Wk/Curls`,
    set: SET_Y_TRIPS_WK.asset,
    formation: SET_Y_TRIPS_WK.formation,
    side: "offense",
    playType: "OffensePlayType_PassShotgun",
    vip: 4,
    playId: 7663,
  });
  return {
    id: "curls",
    play,
    set: SET_Y_TRIPS_WK,
    art: art(ps, routes),
    detail: art(ps, [...passPro(SET_Y_TRIPS_WK), ...routes]),
    note: "QB drop (white), swing, post, curls with hooks, red primary, TE flat",
    stat: "AUD 3 | 2 CPU",
  };
}

/** Gun Y Trips Wk — HB Base (power right, B gap): red ballcarrier, LG skip pull, stalks, down blocks. */
function hbBase(): ArtFixture {
  const blocks = [
    path(2, "block", walk(at(2), [1.3, 105]), "block"),
    path(3, "block", walk(at(3), [5, 90]), "block", { label: "STALK" }),
    path(4, "block", walk(at(4), [5, 90]), "block", { label: "STALK" }),
    path(5, "block", walk(at(5), [1.4, 120]), "block"),
    path(6, "block", walk(at(6), [1.2, 100]), "block"),
    path(7, "block", [at(7), { x: -1.4, y: -2.1 }, { x: 2.2, y: -2.1 }, { x: 2.6, y: 1.6 }], "block", { label: "PULL" }),
    path(8, "block", walk(at(8), [1.3, 125]), "block"),
    path(9, "block", walk(at(9), [1.3, 120]), "block"),
    path(10, "block", walk(at(10), [1.3, 115]), "block"),
  ];
  const carry = walk(at(1), [1.75, 0], [4, 60]);
  const paths = [
    ...blocks,
    path(0, "qb", [at(0), { x: -0.75, y: -6.1 }], "dot"),
    path(1, "run", [...carry, { x: 2.5, y: 0.3 }, { x: 3.0, y: 9 }], "arrow"),
  ];
  const ps = players(SET_Y_TRIPS_WK, "offense", { vip: 1, ballcarrier: 1 });
  const play = resolved({
    name: "HB Base",
    asset: `${FORMATIONS}Offense/Shotgun/Y_Trips_Wk/HB_Base`,
    set: SET_Y_TRIPS_WK.asset,
    formation: SET_Y_TRIPS_WK.formation,
    side: "offense",
    playType: "OffensePlayType_RunPower",
    blocking: `${BLOCKING}BTPower`,
    runHole: 4,
    vip: 1,
    playId: 11296,
  });
  const a = art(ps, paths);
  return { id: "hb-base", play, set: SET_Y_TRIPS_WK, art: a, detail: a, note: "Run (red), pull with T cap, stalks, QB mesh dot", stat: "AUD 2 | 4 CPU" };
}

/**
 * Custom play on Mtn Mesh with the M1left preset: HB preset motion (dashed light blue), Z jet AutoMotion
 * (light blue) into the red drag, X realigned to a tight split (OverrideFormPos, dotted).
 */
function meshMotion(): ArtFixture {
  const hbSnap = { x: -10.4, y: -2.2 };
  const xAt = { x: -8, y: -0.8 };
  const wp = { x: 10.5, y: -3.3 };
  const routes = [
    path(0, "qb", walk(at(0), [3, 270]), "none"),
    path(1, "preset", [at(1), { x: -6.2, y: -4.9 }, hbSnap], "none"),
    path(1, "route", walk(hbSnap, [2, 163], [6, 150], [25, 98]), "arrow", { vertices: [cut(2, "45", "RIGHT", 2)] }),
    path(2, "route", walk(at(2), [6.8, 90], [18, 30]), "arrow", { vertices: [cut(1, "67", "RIGHT", 1)] }),
    path(3, "realign", [at(3), xAt], "none"),
    path(3, "route", walk(xAt, [2, 65], [1, 30], [22, 0]), "arrow"),
    path(4, "motion", [at(4), wp], "none"),
    path(4, "primary", walk(wp, [5, 128], [20, 180]), "arrow"),
    path(5, "route", walk(at(5), [6.8, 90], [22, 150]), "arrow", { vertices: [cut(1, "67", "LEFT", 1)] }),
  ];
  const ps = players(SET_Y_TRIPS_WK, "offense", { vip: 4, at: { 3: xAt }, snap: { 1: hbSnap, 3: xAt } });
  const base = `${FORMATIONS}Offense/Shotgun/Y_Trips_Wk/Mtn_Mesh`;
  const play = resolved({
    name: "PBS Mesh Jet",
    asset: "PBS_Mesh_Jet",
    key: `${FORMATIONS}Offense/Shotgun/Y_Trips_Wk/PBS_Mesh_Jet`,
    source: "custom",
    global: false,
    base,
    file: "playbooks/plays/fixtures.json",
    index: 0,
    set: SET_Y_TRIPS_WK.asset,
    formation: SET_Y_TRIPS_WK.formation,
    side: "offense",
    playType: "OffensePlayType_PassShotgun",
    vip: 4,
  });
  return {
    id: "mesh-motion",
    play,
    set: SET_Y_TRIPS_WK,
    art: art(ps, routes),
    detail: art(ps, [...passPro(SET_Y_TRIPS_WK), ...routes]),
    note: "Preset (dashed), AutoMotion (light blue) → red primary, OverrideFormPos realign (dotted), custom badges",
    stat: "0 CALLS | 0.0 AVG YDS",
  };
}

/** 4-3 Over — Sam Edge 3: four DL gap rushes + Will blitz (red), seam-flat/hook underneath, deep thirds. */
function samEdge3(): ArtFixture {
  const D = SET_43_OVER.movements.Normal;
  const d = (slot: number): Vec => ({ x: D[slot].x, y: D[slot].y });
  const zones: ArtZone[] = [
    { slot: 4, kind: "curlflat", center: { x: -11, y: 7.5 }, rx: 4.6, ry: 2.6, label: "SEAM FLAT" },
    { slot: 5, kind: "hook", center: { x: 3.5, y: 9.5 }, rx: 4, ry: 2.3, label: "HOOK" },
    { slot: 9, kind: "curlflat", center: { x: 11, y: 7.5 }, rx: 4.6, ry: 2.6, label: "SEAM FLAT" },
    { slot: 7, kind: "deep", center: { x: -17.8, y: 17 }, rx: 8.2, ry: 3.8, label: "DEEP 1/3" },
    { slot: 8, kind: "deep", center: { x: 0, y: 18.5 }, rx: 8.2, ry: 4, label: "DEEP 1/3" },
    { slot: 10, kind: "deep", center: { x: 17.8, y: 17 }, rx: 8.2, ry: 3.8, label: "DEEP 1/3" },
  ];
  const paths = [
    path(0, "rush", [d(0), { x: -6.0, y: -0.6 }, { x: -4.8, y: -4.2 }], "arrow"),
    path(1, "rush", [d(1), { x: -0.85, y: -0.6 }, { x: -0.6, y: -3.4 }], "arrow"),
    path(2, "rush", [d(2), { x: 0.85, y: -0.5 }, { x: 0.6, y: -3.4 }], "arrow"),
    path(3, "rush", [d(3), { x: 2.6, y: -0.6 }, { x: 2.0, y: -3.6 }], "arrow"),
    path(6, "rush", [d(6), { x: 6.0, y: -0.6 }, { x: 4.2, y: -4.6 }], "arrow", { label: "BLITZ" }),
    ...zones.map((z) => path(z.slot, "coverage", [d(z.slot), z.center], "none")),
  ];
  const ps = players(SET_43_OVER, "defense");
  const play = resolved({
    name: "Sam Edge 3",
    asset: `${FORMATIONS}Defense/4-3/Over/Sam_Edge_3`,
    set: SET_43_OVER.asset,
    formation: SET_43_OVER.formation,
    side: "defense",
    playType: "DefensePlayType_BlitzZoneCover3",
    playId: 23938,
  });
  const a = art(ps, paths, zones);
  return { id: "sam-edge-3", play, set: SET_43_OVER, art: a, detail: a, note: "Defense: zones (deep/hook/curl-flat), rush + blitz lines, coverage drops", stat: "BLITZ | COVER 3" };
}

export const ART_FIXTURES: ArtFixture[] = [curls(), hbBase(), meshMotion(), samEdge3()];

// ───────────────────────────── sample routes (MiniRoute demos) ─────────────────────────────

const run = (distance: number, direction: number, speed = 100): Step => ({ type: "RunRoute", distance, direction, speed });
const cutStep = (dir: "LEFT" | "RIGHT", cutType: string): Step => ({
  type: "ReceiverCut",
  direction: `RECEIVER_CUT_DIR_${dir}`,
  cutType: `RECEIVER_CUT_ANGLE_${cutType}`,
});
const getOpen: Step = { type: "GetOpen" };

/** Route steps for a receiver aligned on the RIGHT side (outside = 0°, inside = 180°). Mirror for the left. */
export const SAMPLE_ROUTES: { name: string; steps: Step[] }[] = [
  { name: "Slant", steps: [run(2, 90, 90), cutStep("LEFT", "45"), run(15, 135), getOpen] },
  { name: "Flat", steps: [run(1.5, 60, 80), run(18, 10, 90), getOpen] },
  { name: "Out", steps: [run(10, 90), cutStep("RIGHT", "90"), run(10, 0), getOpen] },
  { name: "Dig", steps: [run(12, 90), cutStep("LEFT", "90"), run(15, 180), getOpen] },
  { name: "Curl", steps: [run(10, 90), cutStep("LEFT", "CURL"), { type: "Delay", time: 2 }, getOpen] },
  { name: "Comeback", steps: [run(15, 90), cutStep("RIGHT", "HITCH_COMEBACK"), run(3, 300), getOpen] },
  { name: "Hitch", steps: [run(5, 90), cutStep("LEFT", "HITCH_COMEBACK_INSIDE"), getOpen] },
  { name: "Corner", steps: [run(10, 90), cutStep("RIGHT", "45"), run(15, 45), getOpen] },
  { name: "Post", steps: [run(10, 90), cutStep("LEFT", "45"), run(20, 135), getOpen] },
  { name: "Go", steps: [run(2, 80, 90), run(30, 90), getOpen] },
  { name: "Wheel", steps: [run(3, 20), run(3, 45), cutStep("LEFT", "45"), run(20, 90), getOpen] },
  { name: "Drag", steps: [run(1.5, 120, 80), run(20, 180), getOpen] },
  { name: "Whip", steps: [run(4, 120), cutStep("RIGHT", "180"), run(6, 0), getOpen] },
  { name: "Corner Post", steps: [run(8, 90), cutStep("RIGHT", "POSTCORNER"), run(4, 45), cutStep("LEFT", "90"), run(15, 135), getOpen] },
  { name: "Jet motion → Flat", steps: [
    { type: "AutoMotion", startEvent: "AUTOMOTIONSTARTEVENT_SNAP", waypoints: [{ position: { x: 4, y: -3 }, speed: 70, facingAngle: 180, locoStyle: "AUTOMOTIONLOCOSTYLE_NORMAL", shouldFaceEndPoint: true, transitID: 0 }] },
    run(10, 170), getOpen,
  ] },
  { name: "Stalk block", steps: [run(5, 90), { type: "LeadBlock", blockingTechnique: "BLOCKINGTECHNIQUE_STALK_BLOCK", blockingGap: "RUN_HOLE" }] },
  { name: "Pass block", steps: [{ type: "PassBlock", time: 0, flags: "PassBlockFlags_None" }] },
];

/** Mirror route steps left↔right (directions 180 − d, cut sides, AutoMotion x). */
export function mirrorSteps(steps: Step[]): Step[] {
  return steps.map((s) => {
    const o: Step = { ...s };
    if (typeof o.direction === "number") o.direction = (540 - o.direction) % 360;
    if (typeof o.direction === "string") {
      o.direction = o.direction.replace(/LEFT|RIGHT/, (m) => (m === "LEFT" ? "RIGHT" : "LEFT"));
    }
    if (Array.isArray(o.waypoints)) {
      o.waypoints = (o.waypoints as { position: Vec }[]).map((w) => ({ ...w, position: { x: -w.position.x, y: w.position.y } }));
    }
    return o;
  });
}

// ───────────────────────────── cuts (renderer bench "Cuts") ─────────────────────────────

const stepsFor = (...steps: Step[]): Step[] => [...steps, getOpen];

/**
 * One route per ReceiverCutAngle family for a receiver on the RIGHT (WR2 in Y Trips Wk, slot 4), shaped like the
 * library's uses of that cut (legs copied from library assignments where one exists).
 */
export const CUT_DEMOS: { cut: string; dir: "LEFT" | "RIGHT"; name: string; steps: Step[] }[] = [
  { cut: "22", dir: "LEFT", name: "Seam bend", steps: stepsFor(run(8, 90), cutStep("LEFT", "22"), run(14, 112)) },
  { cut: "45", dir: "LEFT", name: "Post", steps: stepsFor(run(10, 90), cutStep("LEFT", "45"), run(15, 135)) },
  { cut: "67", dir: "LEFT", name: "Deep cross", steps: stepsFor(run(8, 90), cutStep("LEFT", "67"), run(12, 157)) },
  { cut: "90", dir: "RIGHT", name: "Out", steps: stepsFor(run(10, 90), cutStep("RIGHT", "90"), run(8, 0)) },
  { cut: "90_INSIDE", dir: "LEFT", name: "Dig", steps: stepsFor(run(12, 90), cutStep("LEFT", "90_INSIDE"), run(14, 180)) },
  { cut: "CURL", dir: "LEFT", name: "Curl", steps: [run(10, 90), cutStep("LEFT", "CURL"), { type: "Delay", time: 2 }, getOpen] },
  { cut: "HITCH_COMEBACK", dir: "RIGHT", name: "Comeback", steps: stepsFor(run(13, 90), cutStep("RIGHT", "HITCH_COMEBACK"), run(5, 320)) },
  { cut: "SMASH_QUICK", dir: "LEFT", name: "Quick hitch", steps: [run(5, 90), cutStep("LEFT", "SMASH_QUICK"), getOpen] },
  { cut: "180_PARTIAL", dir: "LEFT", name: "Hook", steps: [run(7, 130), cutStep("LEFT", "180_PARTIAL"), { type: "Delay", time: 1 }, getOpen] },
  { cut: "HINGECOMEBACK", dir: "LEFT", name: "Zig (hinge)", steps: [run(1, 90), cutStep("LEFT", "HINGECOMEBACK"), run(10, 180), { type: "Delay", time: 1 }, getOpen] },
  { cut: "DRAG_STOP", dir: "LEFT", name: "Drag sit", steps: [run(2, 120), run(10, 180), cutStep("LEFT", "DRAG_STOP"), { type: "Delay", time: 1 }, getOpen] },
  { cut: "STUTTER_STREAK", dir: "RIGHT", name: "Stutter go", steps: stepsFor(run(5, 90), cutStep("RIGHT", "STUTTER_STREAK"), run(20, 88)) },
  { cut: "OUT_AND_UP", dir: "RIGHT", name: "Out & up", steps: stepsFor(run(6.8, 90), cutStep("RIGHT", "OUT_AND_UP"), run(20, 90)) },
  { cut: "POSTCORNER", dir: "RIGHT", name: "Post corner", steps: stepsFor(run(8.5, 90), cutStep("RIGHT", "POSTCORNER"), run(18, 30)) },
  { cut: "SHAKE", dir: "RIGHT", name: "Shake", steps: stepsFor(run(5, 88), cutStep("RIGHT", "SHAKE"), run(14, 18)) },
  { cut: "STICKNOD", dir: "RIGHT", name: "Stick nod", steps: stepsFor(run(1.5, 90), cutStep("RIGHT", "STICKNOD"), run(18, 70)) },
  { cut: "SLANT_AND_GO", dir: "LEFT", name: "Sluggo", steps: stepsFor(run(3.5, 90), cutStep("LEFT", "SLANT_AND_GO"), run(20, 96)) },
  { cut: "HITCH_GO_INSIDE", dir: "LEFT", name: "Hitch & go", steps: stepsFor(run(6, 90), cutStep("LEFT", "HITCH_GO_INSIDE"), run(20, 95)) },
  { cut: "BUBBLE_SCREEN", dir: "RIGHT", name: "Bubble", steps: [cutStep("RIGHT", "BUBBLE_SCREEN"), run(1.5, 300), run(3, 10), getOpen] },
];

/** A whole Y Trips Wk play that shows every cut style at once (slot 4 = primary): motion + drag sit, dig, post-corner, curl, angle. */
export const CUT_SHOWCASE_SLOTS: Step[][] = [
  [{ type: "QBScramble", dropBackType: "DROP_TYPEENUM_QBDROP_SG_3_STEP", distance: 0, direction: 0 }],
  stepsFor(run(2.5, 10), cutStep("LEFT", "45"), run(8, 60)),
  [
    { type: "AutoMotion", startEvent: "AUTOMOTIONSTARTEVENT_SNAP", waypoints: [{ position: { x: 4, y: -3 }, speed: 80, facingAngle: 180, locoStyle: "AUTOMOTIONLOCOSTYLE_NORMAL", shouldFaceEndPoint: true, transitID: 0 }] },
    run(2, 100),
    run(9, 180),
    cutStep("LEFT", "DRAG_STOP"),
    { type: "Delay", time: 1 },
    getOpen,
  ],
  stepsFor(run(12, 90), cutStep("RIGHT", "90"), run(12, 0)),
  stepsFor(run(8.5, 90), cutStep("RIGHT", "POSTCORNER"), run(18, 30)),
  [run(9, 90), cutStep("LEFT", "CURL"), { type: "Delay", time: 2 }, getOpen],
  ...Array.from({ length: 5 }, (): Step[] => [{ type: "PassBlock", time: 0, flags: "PassBlockFlags_None" }]),
];
