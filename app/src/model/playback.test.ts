import { describe, expect, it } from "vitest";
import { HANDOFF_DELAY, MAX_SECONDS, RUN_SPEED, artAt, buildTracks, playDuration, playSpeedup, positionAt } from "./playback";
import type { ArtPath, ArtPlayer, PlayArt } from "./types";

const player = (slot: number, x: number, y: number): ArtPlayer =>
  ({ slot, pos: "WR", depth: 0, label: `P${slot}`, glyph: "skill", base: { x, y }, at: { x, y }, snap: { x, y }, facing: 90, stance: "", isVip: false, isBallcarrier: false, motionMan: false, side: "offense" }) as ArtPlayer;
const path = (slot: number, kind: ArtPath["kind"], pts: [number, number][]): ArtPath => ({ slot, kind, points: pts.map(([x, y]) => ({ x, y })), cap: "arrow" });
const art = (players: ArtPlayer[], paths: ArtPath[]): PlayArt => ({ players, paths, zones: [], bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 }, flipped: false });

describe("playback", () => {
  const a = art(
    [player(1, 0, -5), player(2, 8, -1), player(3, -8, -1), player(6, 0, -1)],
    [path(2, "route", [[8, -1], [8, 7], [14, 13]]), path(3, "primary", [[-8, -1], [-8, 3]]), path(6, "block", [[0, -1], [0, -1.2]]), path(1, "qb", [[0, -5]])],
  );
  const tracks = buildTracks(a);

  it("tracks players that go somewhere and skips static blockers and one-point paths", () => {
    expect(tracks.map((t) => t.slot).sort()).toEqual([2, 3]);
    const t2 = tracks.find((t) => t.slot === 2)!;
    expect(t2.length).toBeCloseTo(8 + Math.hypot(6, 6), 6);
    expect(t2.pts[0]).toEqual({ x: 8, y: -1 });
  });

  it("moves along the polyline at a constant speed and freezes at the end", () => {
    const t2 = tracks.find((t) => t.slot === 2)!;
    expect(positionAt(t2, 0)).toEqual({ x: 8, y: -1 });
    const p = positionAt(t2, 1); // RUN_SPEED yards up the first leg
    expect(p.x).toBeCloseTo(8, 6);
    expect(p.y).toBeCloseTo(-1 + RUN_SPEED, 6);
    const end = positionAt(t2, 100);
    expect(end.x).toBeCloseTo(14, 6);
    expect(end.y).toBeCloseTo(13, 6);
  });

  it("lasts as long as the longest route, capped", () => {
    expect(playDuration(tracks)).toBeCloseTo(Math.min(MAX_SECONDS, (8 + Math.hypot(6, 6)) / RUN_SPEED), 6);
    const long = buildTracks(art([player(1, 0, 0)], [path(1, "route", [[0, 0], [0, 200]])]));
    expect(playDuration(long)).toBe(MAX_SECONDS);
  });

  it("artAt leaves untracked players alone and never mutates the input", () => {
    const moved = artAt(a, tracks, 0.5);
    expect(moved.players.find((p) => p.slot === 6)).toBe(a.players.find((p) => p.slot === 6));
    expect(moved.players.find((p) => p.slot === 2)!.at.y).toBeCloseTo(-1 + RUN_SPEED * 0.5, 6);
    expect(a.players.find((p) => p.slot === 2)!.at).toEqual({ x: 8, y: -1 });
    expect(artAt(a, [], 3)).toBe(a);
  });

  it("starts a motion player's route after their motion", () => {
    const m = buildTracks(art([player(2, 10, -1)], [path(2, "route", [[2, -1], [2, 10]]), path(2, "motion", [[10, -1], [2, -1]])]));
    expect(m[0].pts.map((p) => [p.x, p.y])).toEqual([[10, -1], [2, -1], [2, 10]]);
  });

  it("backpedals a QB through his drop slower than a receiver runs, and sprints him out on a boot", () => {
    const qb = { ...player(1, 0, -6), glyph: "qb" } as ArtPlayer;
    const drop = buildTracks(art([qb], [{ ...path(1, "qb", [[0, -6], [0, -9]]), cap: "none" }]))[0];
    expect(drop.end).toBeCloseTo(3 / 3.2, 6);
    const boot = buildTracks(art([qb], [path(1, "qb", [[0, -6], [-6, -6]])]))[0];
    expect(boot.end).toBeCloseTo(6 / 5.5, 6);
  });

  it("makes a back wait for the handoff but not a QB keeper", () => {
    const hb = player(2, 0, -6);
    const run = buildTracks(art([hb], [path(2, "run", [[0, -6], [0, 4]])]))[0];
    expect(positionAt(run, HANDOFF_DELAY * 0.5)).toEqual({ x: 0, y: -6 });
    expect(positionAt(run, HANDOFF_DELAY + 1).y).toBeCloseTo(-6 + 7.5, 6);
    const qb = { ...player(1, 0, -6), glyph: "qb" } as ArtPlayer;
    const keep = buildTracks(art([qb], [path(1, "run", [[0, -6], [0, 4]])]))[0];
    expect(keep.tcum[0]).toBe(0);
  });

  it("speeds a long play up to fit instead of cutting it off", () => {
    const long = buildTracks(art([player(1, 0, 0)], [path(1, "route", [[0, 0], [0, 100]])]));
    expect(playSpeedup(long)).toBeCloseTo(100 / RUN_SPEED / MAX_SECONDS, 6);
    expect(playSpeedup(tracks)).toBe(1);
  });
});
