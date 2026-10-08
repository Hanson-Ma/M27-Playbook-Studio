// Play playback: turns a PlayArt into per-player tracks and moves the players along them. Everyone starts at the snap
// and runs at the same speed, so short routes finish first; each player freezes where their route ends.
// Pure TS: the view drives `t` (seconds) and asks for the art at that time.
import type { ArtKind, PlayArt, Vec } from "./types";

/** Yards per second along a route (a receiver at a fast jog). */
export const RUN_SPEED = 8;
/** Never take longer than this to finish, however long the longest route is. */
export const MAX_SECONDS = 7;

export interface Track {
  slot: number;
  /** Polyline the player follows, starting at their alignment. */
  pts: Vec[];
  /** Distance from the start to each point. */
  cum: number[];
  length: number;
}

/** Kinds that move a player (coverage and rush lines belong to the defense's assignment, drawn but not run here). */
const MOVING: ReadonlySet<ArtKind> = new Set<ArtKind>(["route", "primary", "run", "motion", "qb", "block"]);

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

/** One track per player that has somewhere to go (a lineman who just pass-blocks has none). */
export function buildTracks(art: PlayArt): Track[] {
  const tracks: Track[] = [];
  for (const pl of art.players) {
    const paths = art.paths.filter((p) => p.slot === pl.slot && MOVING.has(p.kind) && p.points.length > 1);
    if (!paths.length) continue;
    // Pre-snap / snap motion first, then the route or run that follows it.
    const ordered = [...paths.filter((p) => p.kind === "motion"), ...paths.filter((p) => p.kind !== "motion")];
    const pts: Vec[] = [{ x: pl.at.x, y: pl.at.y }];
    for (const p of ordered) for (const v of p.points) if (dist(pts[pts.length - 1], v) > 0.02) pts.push({ x: v.x, y: v.y });
    if (pts.length < 2) continue;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
    const length = cum[cum.length - 1];
    // A block's "path" is its T-cap tick; only count it when the player really travels (a pull).
    if (length < 0.6) continue;
    tracks.push({ slot: pl.slot, pts, cum, length });
  }
  return tracks;
}

/** Seconds until the last player stops. */
export function playDuration(tracks: readonly Track[], speed = RUN_SPEED): number {
  const longest = tracks.reduce((m, t) => Math.max(m, t.length), 0);
  return Math.min(MAX_SECONDS, longest / speed);
}

/** The player's spot after running for `seconds` (frozen at the end of the track). */
export function positionAt(track: Track, seconds: number, speed = RUN_SPEED): Vec {
  const d = Math.max(0, Math.min(track.length, seconds * speed));
  let i = 1;
  while (i < track.cum.length - 1 && track.cum[i] < d) i++;
  const a = track.pts[i - 1];
  const b = track.pts[i];
  const span = track.cum[i] - track.cum[i - 1];
  const f = span > 1e-9 ? (d - track.cum[i - 1]) / span : 1;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

/** The art with every tracked player moved to where they are `seconds` after the snap. */
export function artAt(art: PlayArt, tracks: readonly Track[], seconds: number, speed = RUN_SPEED): PlayArt {
  if (!tracks.length) return art;
  const by = new Map(tracks.map((t) => [t.slot, t]));
  return {
    ...art,
    players: art.players.map((p) => {
      const t = by.get(p.slot);
      return t ? { ...p, at: positionAt(t, seconds, speed) } : p;
    }),
  };
}
