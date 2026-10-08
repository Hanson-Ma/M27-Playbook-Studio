// Runs a play: the players run their routes from the snap and freeze where each route ends (see model/playback.ts).
// `art` is what to draw right now (the resting art until the first run); `run()` starts it again from the snap.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { artAt, buildTracks, playDuration } from "../model/playback";
import type { PlayArt } from "../model/types";
import { nextFrame } from "../ui/frames";

export interface Playback {
  art: PlayArt;
  /** True while the players are moving. */
  running: boolean;
  /** Start (or restart) the play from the snap. */
  run(): void;
  /** True when there is anything to animate. */
  canRun: boolean;
}

/** `autoRun` starts a play whenever `playKey` changes (opening a play, stepping to the next one). */
export function usePlayback(art: PlayArt, playKey: string, autoRun = true): Playback {
  const tracks = useMemo(() => buildTracks(art), [art]);
  const duration = useMemo(() => playDuration(tracks), [tracks]);
  const [t, setT] = useState<number | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const stop = useRef<(() => void) | undefined>(undefined);
  const latest = useRef({ tracks, duration });
  latest.current = { tracks, duration };

  const run = useCallback(() => {
    stop.current?.();
    const { tracks: tr, duration: d } = latest.current;
    if (!tr.length) return;
    const t0 = performance.now();
    setRunning(true);
    setT(0);
    let cancel: (() => void) | undefined;
    let stopped = false;
    const step = () => {
      if (stopped) return;
      const sec = Math.min(d, (performance.now() - t0) / 1000);
      setT(sec);
      if (sec < d) cancel = nextFrame(step);
      else setRunning(false);
    };
    stop.current = () => {
      stopped = true;
      cancel?.();
    };
    cancel = nextFrame(step);
  }, []);

  // A new play: back to rest, then run it.
  useEffect(() => {
    stop.current?.();
    setT(undefined);
    setRunning(false);
    if (!autoRun) return;
    const id = window.setTimeout(run, 350); // let the field settle first
    return () => window.clearTimeout(id);
  }, [playKey, autoRun, run]);
  useEffect(() => () => stop.current?.(), []);

  const shown = useMemo(() => (t === undefined ? art : artAt(art, tracks, t)), [art, tracks, t]);
  return { art: shown, running, run, canRun: tracks.length > 0 };
}
