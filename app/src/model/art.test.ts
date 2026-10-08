import { describe, expect, it } from "vitest";
import {
  artForPlay,
  artSideForPlay,
  computeArt,
  cutStyle,
  flipPartners,
  gapX,
  holeX,
  isTurnBackCut,
  matchPreset,
  qbDropVector,
  withFlipPartners,
} from "./art";
import { buildCatalog } from "./catalog";
import { loadLibraryData, loadPlaysDoc } from "./libFixture";
import { buildLibraryIndex } from "./library";
import type { AlignmentPos, ArtPath, PlayArt, ResolvedPlay, SetDef, Step, Vec } from "./types";

const F = "football/Gameplay/playbooks/PlayLibrary/Formations/";
const data = loadLibraryData();
const lib = buildLibraryIndex(data);
const cat = buildCatalog(lib, [loadPlaysDoc("pbs-ytrips-v1.json"), loadPlaysDoc("art-test.json")]);

const play = (asset: string): ResolvedPlay => {
  const p = cat.get(asset);
  if (!p) throw new Error("missing " + asset);
  return p;
};
const find = (pred: (p: (typeof data.plays)[number]) => boolean) => play(data.plays.find(pred)!.asset);
const art = (p: ResolvedPlay, opts = {}) => artForPlay(cat, p, opts);
const pathsOf = (a: PlayArt, slot: number, kind?: ArtPath["kind"]) =>
  a.paths.filter((p) => p.slot === slot && (!kind || p.kind === kind));
const end = (p: ArtPath): Vec => p.points[p.points.length - 1];
const near = (v: Vec, x: number, y: number, tol = 0.05) => {
  expect(v.x).toBeCloseTo(x, tol < 0.05 ? 3 : 1);
  expect(v.y).toBeCloseTo(y, tol < 0.05 ? 3 : 1);
};

describe("computeArt over the whole library", () => {
  it("draws every library play with finite coordinates", () => {
    const t0 = performance.now();
    let paths = 0;
    const bad: string[] = [];
    for (const p of data.plays) {
      const rp = play(p.asset);
      const set = lib.setByAsset.get(p.set)!;
      const a = computeArt(set, rp.slots.map((s) => s.steps), { vip: rp.vip, runHole: rp.runHole });
      paths += a.paths.length;
      const nums = [
        ...a.players.flatMap((pl) => [pl.base.x, pl.base.y, pl.at.x, pl.at.y, pl.snap.x, pl.snap.y, pl.facing]),
        ...a.paths.flatMap((pa) => pa.points.flatMap((v) => [v.x, v.y])),
        ...a.zones.flatMap((z) => [z.center.x, z.center.y, z.rx, z.ry]),
        a.bounds.minX,
        a.bounds.maxX,
        a.bounds.minY,
        a.bounds.maxY,
      ];
      if (!nums.every(Number.isFinite)) bad.push(p.asset);
      for (const pa of a.paths) {
        if (pa.points.length < 2) bad.push(p.asset + " short path");
        for (const v of pa.vertices ?? []) if (v.index < 0 || v.index >= pa.points.length) bad.push(p.asset + " vertex");
      }
    }
    const ms = performance.now() - t0;
    console.info(`play art: ${data.plays.length} plays, ${paths} paths in ${ms.toFixed(0)} ms`);
    expect(bad).toEqual([]);
    expect(paths).toBeGreaterThan(data.plays.length * 5);
  });
});

describe("spot checks against the dumped play sheets", () => {
  it("Shotgun Y Trips Wk Curls: curls hook back, slot 4 is primary, the HB swings left", () => {
    const a = art(play(F + "Offense/Shotgun/Y_Trips_Wk/Curls"));
    expect(a.players).toHaveLength(11);
    expect(a.players[4].isVip).toBe(true);

    const [x] = pathsOf(a, 3);
    expect(x.kind).toBe("route");
    near(x.points[0], -16.25, -0.8);
    near(x.points[1], -16.25, 9.2); // 10 yd upfield
    const cut = x.vertices!.find((v) => v.cut)!;
    expect(cut).toMatchObject({ index: 1, cut: "RECEIVER_CUT_ANGLE_CURL", cutDir: "RECEIVER_CUT_DIR_RIGHT", step: 1 });
    const hook = end(x);
    expect(hook.x).toBeGreaterThan(-16.25 + 0.5); // curls back toward +x…
    expect(hook.y).toBeLessThan(9.2); // …and down toward the QB
    expect(x.cap).toBe("arrow");

    const [z] = pathsOf(a, 4);
    expect(z.kind).toBe("primary");
    expect(end(z).x).toBeLessThan(16.25); // the other curl turns toward −x

    const [hb] = pathsOf(a, 1);
    expect(hb.kind).toBe("route");
    expect(end(hb).x).toBeLessThan(-15);
    expect(end(hb).y).toBeGreaterThan(0);

    const [qb] = pathsOf(a, 0);
    expect(qb).toMatchObject({ kind: "qb", cap: "arrow" });
    near(end(qb), 0, -8); // shotgun 3-step ≈ 2 yd
    expect(pathsOf(a, 6)).toEqual([]); // OL pass pro hidden by default
    expect(pathsOf(art(play(F + "Offense/Shotgun/Y_Trips_Wk/Curls"), { showPassPro: true }), 6, "block")).toHaveLength(1);
  });

  it("I Form Close Power O: FB kicks out to D gap right, HB run path, pulling guard", () => {
    const a = art(find((p) => p.name === "Power O" && p.set.endsWith("I_Form/Close/Close")));
    const [fb] = pathsOf(a, 2);
    expect(fb).toMatchObject({ kind: "block", cap: "block" });
    near(end(fb), gapX("D_GAP_RIGHT", 0)!, 0.5);
    expect(gapX("D_GAP_RIGHT", 0)).toBeCloseTo(5.9);

    const [hb] = pathsOf(a, 1);
    expect(hb.kind).toBe("run");
    expect(a.players[1].isBallcarrier).toBe(true);
    near(hb.points[1], 0 + 6 * Math.cos((70 * Math.PI) / 180), -7.375 + 6 * Math.sin((70 * Math.PI) / 180));
    expect(end(hb).y).toBeGreaterThan(hb.points[1].y + 4); // RunEndZone keeps going upfield

    const [lg] = pathsOf(a, 7);
    expect(lg.label).toBe("PULL");
    expect(lg.points[1].y).toBeLessThan(-0.9); // steps back behind the line first
    near(end(lg), holeX(2), 1.5); // runHole 2 = A gap right
    const [qb] = pathsOf(a, 0);
    expect(qb.kind).toBe("qb"); // handoff turn
    const [wr] = pathsOf(a, 3);
    expect(wr).toMatchObject({ kind: "block", cap: "block" }); // stalk after a 5 yd release
    near(wr.points[1], -10, 4.2);
  });

  it("4-3 Odd Cover 3 Sky: deep thirds, hook/curl and curl/flat zones, DL rush", () => {
    const a = art(find((p) => p.playId === 18357));
    expect(a.players.every((p) => p.side === "defense")).toBe(true);
    const zone = (slot: number) => a.zones.find((z) => z.slot === slot)!;
    expect(zone(7)).toMatchObject({ kind: "deep" });
    expect(zone(7).center.x).toBeLessThan(-10); // DEEP3A = −x third
    expect(zone(8).center.x).toBeCloseTo(0); // DEEP3B
    expect(zone(10).center.x).toBeGreaterThan(10); // DEEP3C
    for (const s of [7, 8, 10]) expect(zone(s).center.y).toBeGreaterThan(17);
    expect(zone(5)).toMatchObject({ kind: "hook" });
    expect(zone(5).center.x).toBeLessThan(0);
    expect(zone(6).center.x).toBeGreaterThan(0);
    expect(zone(4)).toMatchObject({ kind: "curlflat" });
    expect(zone(4).center.x).toBeLessThan(0);
    expect(pathsOf(a, 7, "coverage")).toHaveLength(1);
    for (const s of [0, 1, 2, 3]) {
      const [r] = pathsOf(a, s, "rush");
      expect(end(r).y).toBeLessThan(0);
    }
  });

  it("Y Trips Wk Mtn Mesh: AutoMotion waypoint path, OverrideFormPos realignment", () => {
    const a = art(play(F + "Offense/Shotgun/Y_Trips_Wk/Mtn_Mesh"));
    const [motion] = pathsOf(a, 4, "motion");
    expect(motion.points).toEqual([{ x: 16.25, y: -2.2 }, { x: 10.5, y: -3.3 }]);
    expect(motion.vertices).toEqual([{ index: 1, step: 0 }]);
    const [route] = pathsOf(a, 4, "primary");
    expect(route.points[0]).toEqual({ x: 10.5, y: -3.3 }); // the route continues from the last waypoint
    expect(a.paths.indexOf(motion)).toBeLessThan(a.paths.indexOf(route));

    const x = a.players[3];
    expect(x.base).toEqual({ x: -16.25, y: -0.8 });
    expect(x.at).toEqual({ x: -8, y: -0.8 });
    expect(x.snap).toEqual(x.at);
    expect(pathsOf(a, 3, "realign")[0].points).toEqual([x.base, x.at]);
    expect(pathsOf(a, 3, "route")[0].points[0]).toEqual(x.at);
  });

  it("2-4-5 Fire Man: OverrideFormPos is absolute, blitzers rush through the LOS, man stubs", () => {
    const a = art(find((p) => p.name === "Fire Man"));
    expect(a.players[4].base).toEqual({ x: -4, y: 5.25 });
    expect(a.players[4].at).toEqual({ x: -4.8, y: 5 });
    const [blitz] = pathsOf(a, 4, "rush");
    expect(blitz.points[0]).toEqual({ x: -4.8, y: 5 });
    expect(end(blitz).y).toBeLessThan(-1);
    expect(pathsOf(a, 7, "coverage")[0]).toMatchObject({ cap: "dot", label: "MAN" });
  });

  it("I Form Slot Jet Sweep: motion then the red run; the HB fake stays a route", () => {
    const a = art(find((p) => p.playId === 26257));
    expect(pathsOf(a, 4, "motion")[0].points).toEqual([{ x: -10, y: -2.2 }, { x: 5, y: -2.2 }]);
    const [run] = pathsOf(a, 4, "run");
    expect(run.points[0]).toEqual({ x: 5, y: -2.2 });
    expect(end(run).y).toBeGreaterThan(0);
    expect(a.players[4].isBallcarrier).toBe(true);
    expect(a.players[1].isBallcarrier).toBe(false);
    expect(pathsOf(a, 1)[0].kind).toBe("route");
    near(end(pathsOf(a, 2)[0]), -2.5, 1.5); // FB lead through B gap left
  });

  it("Shotgun Bunch Reverse and Empty Base WR Screen", () => {
    const rev = art(find((p) => p.playId === 25442));
    const [wr] = pathsOf(rev, 4, "run");
    expect(end(wr).x).toBeLessThan(wr.points[0].x - 8); // reverse runs back across the formation
    expect(end(wr).y).toBeGreaterThan(wr.points[wr.points.length - 2].y + 4); // then turns upfield

    const scr = art(find((p) => p.playId === 12307));
    const [rt] = pathsOf(scr, 10, "block");
    near(end(rt), 3.333 + 6 * Math.cos((10 * Math.PI) / 180), -1.2 + 6 * Math.sin((10 * Math.PI) / 180));
    expect(rt.cap).toBe("block");
    expect(pathsOf(scr, 4)[0].kind).toBe("primary");
  });

  it("custom plays: PBS Snag sit route and the motion kept by PBS Mtn Drive", () => {
    const snag = art(cat.custom.find((p) => p.name === "PBS Snag")!);
    const [y] = pathsOf(snag, 5);
    expect(y.vertices!.some((v) => v.cut === "RECEIVER_CUT_ANGLE_180_PARTIAL")).toBe(true);
    expect(y.points.length).toBe(3 + 3); // start, two legs, three hook points
    const drive = art(cat.custom.find((p) => p.name === "PBS Mtn Drive")!);
    expect(pathsOf(drive, 4, "motion")).toHaveLength(1);
    expect(pathsOf(drive, 4, "primary")[0].points[0]).toEqual({ x: 10.5, y: -3.3 });
  });

  it("pre-snap presets move the player before the snap", () => {
    const set = lib.setByAsset.get(F + "Offense/Shotgun/Y_Trips_Wk/Y_Trips_Wk")!;
    const rp = play(F + "Offense/Shotgun/Y_Trips_Wk/Curls");
    const a = computeArt(set, rp.slots.map((s) => s.steps), { vip: 4, preset: "M1left" });
    expect(a.players[1].base).toEqual({ x: -10.4, y: -2.2 });
    expect(a.players[1].snap).toEqual({ x: -10.4, y: -2.2 });
    const [preset] = pathsOf(a, 1, "preset");
    expect(preset).toMatchObject({ dashed: true, points: [{ x: -2.9, y: -6 }, { x: -10.4, y: -2.2 }] });
    expect(pathsOf(a, 1, "route")[0].points[0]).toEqual({ x: -10.4, y: -2.2 });
    expect(computeArt(set, [], { preset: "NoSuchPreset" }).players[1].base).toEqual({ x: -2.9, y: -6 });
  });
});

describe("flip", () => {
  const mirror = (a: PlayArt): PlayArt => artMirror(a);

  it("mirrors x, keeps y, swaps cut directions; flipping twice is the original", () => {
    for (const p of data.plays.filter((_, i) => i % 7 === 0)) {
      const rp = play(p.asset);
      const set = lib.setByAsset.get(rp.set)!;
      const steps = rp.slots.map((s) => s.steps);
      const o = { vip: rp.vip, runHole: rp.runHole, side: artSideForPlay(cat, rp) };
      const a = computeArt(set, steps, o);
      const f = computeArt(set, steps, { ...o, flip: true });
      expect(f.flipped).toBe(true);
      expect(mirror(f)).toEqual(a);
      // artForPlay applies the flip partners on top: same geometry and slots, only who stands where changes.
      expect(withoutIdentity(mirror(art(rp, { flip: true })))).toEqual(withoutIdentity(art(rp)));
    }
  });

  it("matches flipping the inputs (gap / run hole odd ↔ even)", () => {
    const power = find((p) => p.name === "Power O" && p.set.endsWith("I_Form/Close/Close"));
    const flipped = art(power, { flip: true });
    const leftHole = art(power, { runHole: 1 });
    expect(end(pathsOf(flipped, 7)[0]).x).toBeCloseTo(end(pathsOf(leftHole, 7)[0]).x);
    expect(end(pathsOf(flipped, 2)[0]).x).toBeCloseTo(-gapX("D_GAP_RIGHT", 0)!);
    const curls = art(play(F + "Offense/Shotgun/Y_Trips_Wk/Curls"), { flip: true });
    expect(pathsOf(curls, 3)[0].vertices!.find((v) => v.cut)!.cutDir).toBe("RECEIVER_CUT_DIR_LEFT");
  });
});

describe("helpers and memo", () => {
  it("maps run holes and gaps", () => {
    expect(holeX(0)).toBe(0);
    expect(holeX(1)).toBeCloseTo(-0.85);
    expect(holeX(4)).toBeCloseTo(2.5);
    expect(holeX(9)).toBeCloseTo(-7.6);
    expect(gapX("OUTSIDE_GAP_Left", 0)).toBe(-10);
    expect(gapX("RUN_HOLE", 6)).toBeCloseTo(4.2);
    expect(gapX("GAP_TOTAL", 0)).toBeUndefined();
  });

  it("knows which cuts turn back and how far QBs drop", () => {
    expect(isTurnBackCut("RECEIVER_CUT_ANGLE_CURL")).toBe(true);
    expect(isTurnBackCut("RECEIVER_CUT_ANGLE_SMASH_QUICK")).toBe(true);
    expect(isTurnBackCut("RECEIVER_CUT_ANGLE_45")).toBe(false);
    expect(isTurnBackCut("RECEIVER_CUT_ANGLE_HITCH_GO_INSIDE")).toBe(false);
    const drop = (t: string, extra = {}) => qbDropVector({ type: "QBScramble", dropBackType: "DROP_TYPEENUM_QBDROP_" + t, direction: 0, distance: 0, ...extra });
    expect(drop("7_STEP")!.y).toBeCloseTo(-7);
    expect(drop("5_STEP_PISTOL")!.y).toBeCloseTo(-3);
    expect(drop("SG_0_STEP")!.y).toBeCloseTo(-0.8);
    expect(drop("SG_ROLLOUT_RT")!.x).toBeGreaterThan(5);
    expect(drop("UC_ROLLOUT_LT")!.x).toBeLessThan(-5);
    expect(drop("SG_ROLLOUT_LT", { direction: 190, distance: 4 })!.x).toBeCloseTo(-3.94, 1);
    expect(qbDropVector({ type: "QBScramble", dropBackType: "DROP_TYPEENUM_NONEVALUE", direction: 0, distance: 0 })).toBeUndefined();
  });

  it("memoizes per play + options", () => {
    const rp = play(F + "Offense/Shotgun/Y_Trips_Wk/Curls");
    expect(art(rp)).toBe(art(rp));
    expect(art(rp, { flip: true })).not.toBe(art(rp));
    expect(art(rp, { vip: 3 })).not.toBe(art(rp));
    expect(pathsOf(art(rp, { vip: 3 }), 3)[0].kind).toBe("primary");
  });

  it("returns empty art for unknown sets", () => {
    const a = computeArt({ movements: {} } as never, []);
    expect(a.players).toEqual([]);
    expect(Number.isFinite(a.bounds.minX)).toBe(true);
  });
});

/** Players without the identity fields flip partners may swap (pos, depth, label, glyph). */
function withoutIdentity(a: PlayArt): PlayArt {
  return { ...a, players: a.players.map(({ pos: _p, depth: _d, label: _l, glyph: _g, ...rest }) => rest as never) };
}

const Y_TRIPS_SET = F + "Offense/Shotgun/Y_Trips_Wk/Y_Trips_Wk";
const leg = (distance: number, direction: number): Step => ({ type: "RunRoute", distance, direction, speed: 100 });
const cutStep = (dir: "LEFT" | "RIGHT", cut: string): Step => ({
  type: "ReceiverCut",
  direction: `RECEIVER_CUT_DIR_${dir}`,
  cutType: `RECEIVER_CUT_ANGLE_${cut}`,
});
const GET_OPEN: Step = { type: "GetOpen" };
/** Steps for one slot of a set; every other slot stands. */
const slotSteps = (set: SetDef, slot: number, steps: Step[]): Step[][] => set.movements.Normal.map((_, i) => (i === slot ? steps : []));

describe("cut styles", () => {
  it("classifies cut types (full or short names) and fake-outs", () => {
    const t = (c: string) => cutStyle("RECEIVER_CUT_ANGLE_" + c);
    for (const c of ["22", "45"]) expect(t(c)).toBe("speed");
    for (const c of ["67", "90", "90_INSIDE"]) expect(t(c)).toBe("hard");
    for (const c of ["STUTTER", "STUTTER_STREAK", "SHAKE", "OUT_AND_UP", "HITCH_GO_INSIDE", "HITCH_GO_OUTSIDE", "STICKNOD", "SLANT_AND_GO", "POSTCORNER", "ZIG", "HESITATION"])
      expect(t(c)).toBe("fake");
    for (const c of ["CURL", "HITCH_COMEBACK", "HITCH_COMEBACK_INSIDE", "HINGECOMEBACK", "180", "180_PARTIAL", "SMASH", "SMASH_QUICK", "SCREEN", "SCREEN_BACKPEDAL_LONG", "BUBBLE_SCREEN", "BUBBLE_SCREEN_SHORT"])
      expect(t(c)).toBe("turnback");
    expect(t("DRAG_STOP")).toBe("settle");
    expect(cutStyle("45")).toBe("speed");
    expect(cutStyle("CURL")).toBe("turnback");
    expect(cutStyle("JukeLeft45DegreesWithTurbo")).toBe("fake");
    expect(cutStyle("FAKEOUT")).toBe("fake");
    expect(cutStyle("DoNothing")).toBeUndefined();
    expect(t("INVALID")).toBeUndefined();
    expect(cutStyle(undefined)).toBeUndefined();
    expect(cutStyle("")).toBeUndefined();
  });

  it("classifies every ReceiverCutAngle in enums.json except the sentinels", () => {
    const unstyled = data.enums.enums.ReceiverCutAngle.filter((v) => !cutStyle(v)).sort();
    expect(unstyled).toEqual(["RECEIVER_CUT_ANGLE_INVALID", "RECEIVER_CUT_ANGLE_NORMAL", "RECEIVER_CUT_NONEVALUE"]);
  });

  it("marks every library cut vertex with its style", () => {
    let styled = 0;
    const bad: string[] = [];
    for (const p of data.plays.filter((_, i) => i % 5 === 0)) {
      for (const pa of art(play(p.asset)).paths)
        for (const v of pa.vertices ?? []) {
          if (v.cut === undefined) {
            if (v.style) bad.push(`${p.asset}: style without cut`);
            continue;
          }
          if (v.style !== cutStyle(v.cut)) bad.push(`${p.asset}: ${v.cut} → ${v.style}`);
          if (v.style) styled++;
        }
    }
    expect(bad).toEqual([]);
    expect(styled).toBeGreaterThan(500);
  });

  it("curls hook back; a DRAG_STOP settles (no hook, its vertex ends the route); fakes keep the geometry", () => {
    const set = lib.setByAsset.get(Y_TRIPS_SET)!;
    const drag = computeArt(set, slotSteps(set, 4, [leg(2, 120), leg(10, 180), cutStep("LEFT", "DRAG_STOP"), { type: "Delay", time: 1 }, GET_OPEN]), { vip: 4 });
    const [d] = pathsOf(drag, 4);
    expect(d.points).toHaveLength(3);
    expect(d.vertices!.find((v) => v.cut)).toMatchObject({ index: 2, style: "settle" });

    const curl = computeArt(set, slotSteps(set, 4, [leg(10, 90), cutStep("LEFT", "CURL"), GET_OPEN]), { vip: 4 });
    const [c] = pathsOf(curl, 4);
    expect(c.points).toHaveLength(2 + 3);
    expect(c.vertices!.find((v) => v.cut)).toMatchObject({ index: 1, style: "turnback" });

    const pc = computeArt(set, slotSteps(set, 4, [leg(8.5, 90), cutStep("RIGHT", "POSTCORNER"), leg(18, 30), GET_OPEN]), { vip: 4 });
    const [f] = pathsOf(pc, 4);
    expect(f.points).toHaveLength(3);
    expect(f.vertices!.find((v) => v.cut)).toMatchObject({ index: 1, style: "fake", cutDir: "RECEIVER_CUT_DIR_RIGHT" });

    const juke = computeArt(set, slotSteps(set, 4, [leg(5, 90), { type: "RunRouteFakeOut", fakeout: "JukeLeft45Degrees" }, leg(10, 90), GET_OPEN]));
    expect(pathsOf(juke, 4)[0].vertices!.find((v) => v.cut)).toMatchObject({ index: 1, cut: "JukeLeft45Degrees", style: "fake" });
  });
});

describe("presets by slot", () => {
  it("matches preset entries by slot, even when (pos, depth) would cross the field (Cov0 Odd PS Blitz)", () => {
    const set = lib.setByAsset.get(F + "Defense/Cov0_PS/Odd_PS/Odd_PS")!;
    // The preset lists the left corner (slot 7, CB1 in Normal) as CB depth 2: (pos, depth) would send him to slot 10.
    const entry = set.movements.Blitz.find((p) => p.slot === 7)!;
    expect(entry.depth).not.toBe(set.movements.Normal[7].depth);
    const a = computeArt(set, [], { preset: "Blitz", side: "defense" });
    expect(a.players[7].base).toEqual({ x: -16, y: 3 }); // stays on the left, pressed up
    expect(a.players[10].base).toEqual({ x: 16, y: 3 });
    expect(pathsOf(a, 7, "preset")[0].points).toEqual([{ x: -16, y: 8 }, { x: -16, y: 3 }]);

    const y = lib.setByAsset.get(Y_TRIPS_SET)!;
    const m5 = computeArt(y, [], { preset: "M5left" });
    expect(m5.players[5].base).toEqual({ x: -5, y: -2.2 });
    expect(m5.players[2].base).toEqual({ x: 10.5, y: -0.8 }); // the preset's second (adjusting) player
  });

  it("falls back to (pos, depth) for entries without a slot; slot wins and duplicates are ignored", () => {
    const set = lib.setByAsset.get(Y_TRIPS_SET)!;
    const normal = set.movements.Normal;
    const legacy = set.movements.M1left.map(({ slot: _slot, ...p }) => p as AlignmentPos);
    expect(matchPreset(normal, legacy)[1]).toBe(legacy[0]);
    expect(computeArt({ ...set, movements: { ...set.movements, M1left: legacy } }, [], { preset: "M1left" }).players[1].base).toEqual({
      x: -10.4,
      y: -2.2,
    });

    const wr = (slot: number | undefined, depth: number, x: number): AlignmentPos =>
      ({ slot, pos: "POSITION_WR", depth, x, y: -1, facing: 90, stance: "StanceType_2pt", group: "", motionMan: false }) as AlignmentPos;
    const n = [wr(0, 1, -16), wr(1, 2, 16)];
    // slot 1 even though (pos, depth) says slot 0; a second entry for slot 1 is ignored; out-of-range slot → (pos, depth)
    const m = matchPreset(n, [wr(1, 1, 8), wr(1, 2, 9), wr(7, 1, -9)]);
    expect(m[1]?.x).toBe(8);
    expect(m[0]?.x).toBe(-9);
  });
});

describe("flip partners (flipAssign)", () => {
  it("puts each player on his partner's mirrored spot (Y Trips Wk: WR1 ↔ WR2), keeping geometry, slots and paths", () => {
    const rp = play(F + "Offense/Shotgun/Y_Trips_Wk/Curls");
    const set = lib.setByAsset.get(rp.set)!;
    expect(flipPartners(set.movements.Normal)?.slice(3, 5)).toEqual([4, 3]);
    const plain = computeArt(set, rp.slots.map((s) => s.steps), { vip: rp.vip, runHole: rp.runHole, flip: true, side: "offense" });
    const f = art(rp, { flip: true });
    expect(f.paths).toEqual(plain.paths);
    expect(f.players.map((p) => p.at)).toEqual(plain.players.map((p) => p.at));
    expect(f.players[4]).toMatchObject({ slot: 4, isVip: true, label: plain.players[3].label, depth: 1 }); // WR1 runs the red route
    expect(f.players[3]).toMatchObject({ slot: 3, label: plain.players[4].label, depth: 2 });
    const wr1 = f.players.find((p) => p.pos === "POSITION_WR" && p.depth === 1)!;
    expect(wr1.at).toEqual({ x: -16.25, y: -2.2 }); // = mirror of WR2's spot (16.25, −2.2)
    expect(f.players[0]).toEqual(plain.players[0]); // partners of themselves are untouched
  });

  it("falls back to the plain mirror without a complete flipAssign permutation", () => {
    const set = lib.setByAsset.get(Y_TRIPS_SET)!;
    const normal = set.movements.Normal;
    expect(flipPartners(normal.map(({ flipAssign: _f, ...p }) => p as AlignmentPos))).toBeUndefined();
    expect(flipPartners(normal.map((p) => ({ ...p, flipAssign: 0 })))).toBeUndefined(); // not a permutation
    expect(flipPartners([])).toBeUndefined();
    const flipped = computeArt(set, [], { flip: true });
    expect(withFlipPartners(flipped, { ...set, movements: { Normal: normal.map(({ flipAssign: _f, ...p }) => p as AlignmentPos) } })).toBe(flipped);
    const unflipped = computeArt(set, []);
    expect(withFlipPartners(unflipped, set)).toBe(unflipped);
  });
});

/** Test-side mirror (independent of the engine's own). */
function artMirror(a: PlayArt): PlayArt {
  const mv = (v: Vec): Vec => ({ x: -v.x || 0, y: v.y });
  const swap = (d: string) => (d.includes("LEFT") ? d.replace("LEFT", "RIGHT") : d.replace("RIGHT", "LEFT"));
  const fix = (n: number) => (Object.is(n, -0) ? 0 : n);
  const clean = (v: Vec): Vec => ({ x: fix(v.x), y: v.y });
  return {
    players: a.players.map((p) => ({
      ...p,
      base: clean(mv(p.base)),
      at: clean(mv(p.at)),
      snap: clean(mv(p.snap)),
      facing: (((180 - p.facing) % 360) + 360) % 360,
    })),
    paths: a.paths.map((p) => {
      const q: ArtPath = { ...p, points: p.points.map((v) => clean(mv(v))) };
      if (p.vertices) q.vertices = p.vertices.map((v) => (v.cutDir ? { ...v, cutDir: swap(v.cutDir) } : { ...v }));
      return q;
    }),
    zones: a.zones.map((z) => ({ ...z, center: clean(mv(z.center)) })),
    bounds: { minX: fix(-a.bounds.maxX), maxX: fix(-a.bounds.minX), minY: a.bounds.minY, maxY: a.bounds.maxY },
    flipped: !a.flipped,
  };
}

describe("optionBranches", () => {
  it("draws every branch named by the option route type, relative to the nearer sideline", async () => {
    const { optionBranches } = await import("./art");
    // A right-side receiver, stem heading straight up: hitch and fade.
    const hf = optionBranches("AssignRouteType_RR_Option_Hitch_Fade", { x: 10, y: 6 }, 90);
    expect(hf).toHaveLength(2);
    expect(hf[0].length).toBe(4); // the hook
    const fade = hf[1][hf[1].length - 1];
    expect(fade.x).toBeGreaterThan(10); // fades toward the sideline
    expect(fade.y).toBeGreaterThan(6);
    // Out / in mirror on the other side.
    const [out] = optionBranches("AssignRouteType_RR_Option_Out_Fade", { x: -10, y: 6 }, 90);
    expect(out[out.length - 1].x).toBeLessThan(-10);
    const dig = optionBranches("AssignRouteType_RR_Option_Dig_Post", { x: 10, y: 6 }, 90);
    expect(dig).toHaveLength(2);
    expect(dig.every((b) => b[b.length - 1].x < 10)).toBe(true); // both break inside
    // Generic option routes get the usual two breaks; other route types none.
    expect(optionBranches("AssignRouteType_RR_Option_Route", { x: 8, y: 5 }, 90)).toHaveLength(2);
    expect(optionBranches("AssignRouteType_RR_Slant", { x: 8, y: 5 }, 90)).toEqual([]);
    expect(optionBranches(undefined, { x: 8, y: 5 }, 90)).toEqual([]);
  });
});
