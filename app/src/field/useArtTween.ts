// Players move to their new spots instead of popping (the game's play-call field view): when `key` changes (stepping
// to another play, flipping), each player slides from where he was drawn to his spot in the new art. Paths and
// zones switch at once; players that weren't on the field before appear in place.
import { useEffect, useRef, useState } from "react";
import type { PlayArt, Vec } from "../model/types";
import { nextFrame } from "../ui/frames";

const MS = 280;
const ease = (t: number) => 1 - (1 - t) ** 3;

export function useArtTween(art: PlayArt, key: string): PlayArt {
  const shown = useRef<PlayArt>(art);
  const [t, setT] = useState(1);
  const from = useRef<Map<number, Vec>>(new Map());
  const lastKey = useRef(key);

  if (lastKey.current !== key) {
    lastKey.current = key;
    from.current = new Map(shown.current.players.map((p) => [p.slot, p.at]));
  }

  useEffect(() => {
    if (!from.current.size) return;
    const t0 = performance.now();
    let cancel: (() => void) | undefined;
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / MS);
      setT(k);
      if (k < 1) cancel = nextFrame(step);
      else from.current = new Map();
    };
    setT(0);
    cancel = nextFrame(step);
    return () => cancel?.();
  }, [key]);

  const k = ease(t);
  const out: PlayArt =
    t >= 1 || !from.current.size
      ? art
      : {
          ...art,
          players: art.players.map((p) => {
            const a = from.current.get(p.slot);
            return a ? { ...p, at: { x: a.x + (p.at.x - a.x) * k, y: a.y + (p.at.y - a.y) * k } } : p;
          }),
        };
  shown.current = out;
  return out;
}
