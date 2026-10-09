// Play playback: turns a PlayArt into per-player tracks and moves the players along them. Motion men go first, before
// the snap; the ball is snapped the moment the last motion ends, then everyone runs their routes. Each leg runs at
// the pace of what it is (a receiver sprints, a QB backpedals through his drop, a back waits a beat for the handoff),
// and a player freezes where his track ends.
// Pure TS: the view drives `t` (seconds) and asks for the art at that time.
import type { ArtKind, ArtPath, PlayArt, Vec } from "./types";

/** Yards per second along a route (a receiver at a fast jog). */
export const RUN_SPEED = 8;
/** Never take longer than this to finish: longer plays are sped up to fit (see playSpeedup). */
export const MAX_SECONDS = 7;
/** A back who takes the ball from the QB starts right at the snap (the mesh is the QB's animation, not a wait). */
export const HANDOFF_DELAY = 0;

/** Yards per second by what the path is. */
const SPEED: Partial<Record<ArtKind, number>> = {
  route: RUN_SPEED,
  primary: RUN_SPEED,
  run: 7.5,
  option: 7,
  motion: 4.5,
  block: 5.5,
  qb: 3.2, // backpedal through a drop
};
/** QB boots, rollouts and keepers (a QB path that ends in an arrow) move faster than a drop. */
const QB_BOOT_SPEED = 5.5;

export interface Track {
  slot: number;
  /** Polyline the player follows, starting at their alignment. */
  pts: Vec[];
  /** Distance from the start to each point. */
  cum: number[];
  length: number;
  /** Yards per second on each segment (pts[i] → pts[i + 1]). */
  speeds: number[];
  /** Seconds (after the snap) at which each point is reached; tcum[0] is the start delay. */
  tcum: number[];
  /** Seconds at which the track ends. */
  end: number;
  /** Seconds at which the ball is snapped (the same on every track; 0 when nothing moves before the snap). */
  snap: number;
  /** A motion man waits at `pts[i]` (where his motion ends) until `until` seconds, then runs his route. */
  hold?: { i: number; until: number };
}

/** Kinds that move a player (coverage and rush lines belong to the defense's assignment, drawn but not run here). */
const MOVING: ReadonlySet<ArtKind> = new Set<ArtKind>(["route", "primary", "run", "motion", "qb", "block", "option"]);

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

const speedOf = (p: ArtPath): number => (p.kind === "qb" && p.cap === "arrow" ? QB_BOOT_SPEED : (SPEED[p.kind] ?? RUN_SPEED));

/** One track per player that has somewhere to go (a lineman who just pass-blocks has none). */
export function buildTracks(art: PlayArt): Track[] {
  const draft: { slot: number; pts: Vec[]; cum: number[]; length: number; speeds: number[]; pre: number; delay: number }[] = [];
  for (const pl of art.players) {
    const paths = art.paths.filter((p) => p.slot === pl.slot && !p.alt && MOVING.has(p.kind) && p.points.length > 1);
    if (!paths.length) continue;
    // Pre-snap / snap motion first, then the route or run that follows it.
    const ordered = [...paths.filter((p) => p.kind === "motion"), ...paths.filter((p) => p.kind !== "motion")];
    const pts: Vec[] = [{ x: pl.at.x, y: pl.at.y }];
    const speeds: number[] = [];
    let pre = 0; // how many segments are motion (they come first)
    for (const p of ordered) {
      const sp = speedOf(p);
      for (const v of p.points) {
        if (dist(pts[pts.length - 1], v) > 0.02) {
          pts.push({ x: v.x, y: v.y });
          speeds.push(sp);
          if (p.kind === "motion") pre = speeds.length;
        }
      }
    }
    if (pts.length < 2) continue;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
    const length = cum[cum.length - 1];
    // A block's "path" is its T-cap tick; only count it when the player really travels (a pull).
    if (length < 0.6) continue;
    // A back who runs the ball waits for the handoff (a QB keeper or a player in motion doesn't).
    const takesBall = pl.glyph !== "qb" && ordered[0].kind === "run";
    draft.push({ slot: pl.slot, pts, cum, length, speeds, pre, delay: takesBall ? HANDOFF_DELAY : 0 });
  }

  // The motion runs before the snap: the ball is snapped the moment the last motion man arrives.
  let motion = 0;
  for (const d of draft) {
    let t = 0;
    for (let i = 1; i <= d.pre; i++) t += (d.cum[i] - d.cum[i - 1]) / d.speeds[i - 1];
    motion = Math.max(motion, t);
  }
  const snap = motion;

  return draft.map((d) => {
    // Motion men start at once; everyone else stands until the snap (a back also waits on the handoff).
    const tcum = [d.pre ? 0 : snap + d.delay];
    for (let i = 1; i < d.pts.length; i++) {
      // The first leg after the motion starts at the snap, wherever the man's motion ended.
      const from = d.pre && i === d.pre + 1 ? Math.max(tcum[i - 1], snap + d.delay) : tcum[i - 1];
      tcum.push(from + (d.cum[i] - d.cum[i - 1]) / d.speeds[i - 1]);
    }
    const hold = d.pre && d.pre < d.pts.length - 1 ? { i: d.pre, until: Math.max(tcum[d.pre], snap + d.delay) } : undefined;
    return { slot: d.slot, pts: d.pts, cum: d.cum, length: d.length, speeds: d.speeds, tcum, end: tcum[tcum.length - 1], snap, hold };
  });
}

/** Seconds until the last player stops, at the play's natural pace, capped at MAX_SECONDS. */
export function playDuration(tracks: readonly Track[]): number {
  return Math.min(MAX_SECONDS, tracks.reduce((m, t) => Math.max(m, t.end), 0));
}

/** How much faster than natural pace the play runs so it fits in MAX_SECONDS (1 when it already does). */
export function playSpeedup(tracks: readonly Track[]): number {
  const natural = tracks.reduce((m, t) => Math.max(m, t.end), 0);
  return natural > MAX_SECONDS ? natural / MAX_SECONDS : 1;
}

/** The player's spot `seconds` after the start (waiting where he stands until his turn, frozen at the end). */
export function positionAt(track: Track, seconds: number): Vec {
  const t = Math.max(track.tcum[0], Math.min(track.end, seconds));
  const h = track.hold;
  if (h && t >= track.tcum[h.i] && t <= h.until) return { ...track.pts[h.i] };
  let i = 1;
  while (i < track.tcum.length - 1 && track.tcum[i] < t) i++;
  const a = track.pts[i - 1];
  const b = track.pts[i];
  // The leg after a held motion starts when the hold ends, not when the motion did.
  const t0 = h && i === h.i + 1 ? h.until : track.tcum[i - 1];
  const span = track.tcum[i] - t0;
  const f = span > 1e-9 ? (t - t0) / span : 1;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

/** The art with every tracked player moved to where they are `seconds` after the snap. */
export function artAt(art: PlayArt, tracks: readonly Track[], seconds: number): PlayArt {
  if (!tracks.length) return art;
  const by = new Map(tracks.map((t) => [t.slot, t]));
  return {
    ...art,
    players: art.players.map((p) => {
      const t = by.get(p.slot);
      return t ? { ...p, at: positionAt(t, seconds) } : p;
    }),
  };
}
