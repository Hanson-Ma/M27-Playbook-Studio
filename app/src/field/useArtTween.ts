// Players move to their new spots instead of popping (the game's play-call field view). When `key` changes (stepping
// to another play, flipping), each player slides from where he was drawn to his spot in the new art in a quick fixed
// time. When only `motionKey` changes (a player sent in pre-snap motion) each player who moves jogs there at `speed`
// yards per second, like a real player, so a long motion takes longer than a short one. Paths and zones switch at
// once; players that weren't on the field before appear in place.
import { useEffect, useRef, useState } from "react";
import type { PlayArt, Vec } from "../model/types";
import { nextFrame } from "../ui/frames";

const MS = 280;
/** Yards per second a player jogs to a motion spot (a receiver in motion). */
export const MOTION_SPEED = 7;
const ease = (t: number) => 1 - (1 - t) ** 3;

export function useArtTween(art: PlayArt, key: string, motionKey = ""): PlayArt {
  const shown = useRef<PlayArt>(art);
  const [, redraw] = useState(0);
  const from = useRef<Map<number, Vec>>(new Map());
  /** Per player: ms for the slide, and whether it eases (fixed-time slides do, a jog at a constant speed doesn't). */
  const dur = useRef<Map<number, number>>(new Map());
  const linear = useRef(false);
  const lastKey = useRef(key);
  const lastMotion = useRef(motionKey);
  const t0 = useRef(0);

  if (lastKey.current !== key || lastMotion.current !== motionKey) {
    const byKey = lastKey.current !== key;
    lastKey.current = key;
    lastMotion.current = motionKey;
    from.current = new Map(shown.current.players.map((p) => [p.slot, p.at]));
    linear.current = !byKey;
    dur.current = new Map(
      art.players.map((p) => {
        const a = from.current.get(p.slot);
        const d = a ? Math.hypot(p.at.x - a.x, p.at.y - a.y) : 0;
        return [p.slot, byKey ? MS : Math.max(1, (d / MOTION_SPEED) * 1000)];
      }),
    );
    t0.current = performance.now();
  }

  useEffect(() => {
    if (!from.current.size) return;
    let cancel: (() => void) | undefined;
    const total = Math.max(...dur.current.values(), 1);
    const step = () => {
      redraw((n) => n + 1);
      if (performance.now() - t0.current < total) cancel = nextFrame(step);
      else from.current = new Map();
    };
    cancel = nextFrame(step);
    return () => cancel?.();
  }, [key, motionKey]);

  // Elapsed time is read while rendering, so the very first frame after a change already starts from the old spots.
  const now = performance.now() - t0.current;
  const running = from.current.size > 0 && [...dur.current.values()].some((d) => now < d);
  let out: PlayArt = art;
  if (running) {
    // Where each player is drawn now, and how far that is from his final spot (his route sticks with him).
    const off = new Map<number, Vec>();
    const players = art.players.map((p) => {
      const a = from.current.get(p.slot);
      const d = dur.current.get(p.slot) ?? MS;
      if (!a) return p;
      const k = Math.min(1, now / d);
      const f = linear.current ? k : ease(k);
      const at = { x: a.x + (p.at.x - a.x) * f, y: a.y + (p.at.y - a.y) * f };
      if (linear.current && k < 1) off.set(p.slot, { x: at.x - p.at.x, y: at.y - p.at.y });
      return { ...p, at };
    });
    out = { ...art, players };
    if (off.size)
      out = {
        ...out,
        // the pre-snap shift arrow stays where it is; everything the player runs rides along
        paths: art.paths.map((pa) => {
          const o = off.get(pa.slot);
          return o && pa.kind !== "preset" ? { ...pa, points: pa.points.map((v) => ({ x: v.x + o.x, y: v.y + o.y })) } : pa;
        }),
        zones: art.zones.map((z) => {
          const o = off.get(z.slot);
          return o ? { ...z, center: { x: z.center.x + o.x, y: z.center.y + o.y } } : z;
        }),
      };
  }
  shown.current = out;
  return out;
}
