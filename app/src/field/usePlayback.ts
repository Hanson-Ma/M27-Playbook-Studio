// Runs a play: motion men move first, then the snap, then everyone runs their routes and freezes where each ends (see model/playback.ts).
// `art` is what to draw right now (the resting art until the first run); `run()` starts it again from the snap.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { artAt, buildTracks, playDuration, playSpeedup } from "../model/playback";
import type { PlayArt } from "../model/types";
import { nextFrame } from "../ui/frames";

export interface Playback {
  art: PlayArt;
  /** True while the players are moving. */
  running: boolean;
  /** True once the play has been run since it was opened (or stepped to). */
  started: boolean;
  /** Start (or restart) the play from the beginning. */
  run(): void;
  /** Pause while running; otherwise play on from where it is (from the start when it hasn't run or has finished). */
  toggle(): void;
  /** True when there is anything to animate. */
  canRun: boolean;
  /** Play length in seconds (as shown, after any speed-up). */
  duration: number;
  /** Seconds since the start of what is shown (undefined = the resting art); pre-snap motion comes before `snapAt`. */
  time: number | undefined;
  /** When the ball is snapped, in the same seconds as `time` (0 when nothing moves before the snap). */
  snapAt: number;
  /** Jump to `t` seconds (stops a run); undefined = back to the resting art. */
  seek(t: number | undefined): void;
}

/** `autoRun` starts a play whenever `playKey` changes (opening a play, stepping to the next one). */
export function usePlayback(art: PlayArt, playKey: string, autoRun = true): Playback {
  const tracks = useMemo(() => buildTracks(art), [art]);
  const duration = useMemo(() => playDuration(tracks), [tracks]);
  const speedup = useMemo(() => playSpeedup(tracks), [tracks]);
  const [t, setT] = useState<number | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const stop = useRef<(() => void) | undefined>(undefined);
  const latest = useRef({ tracks, duration });
  latest.current = { tracks, duration };

  const runFrom = useCallback((from: number) => {
    stop.current?.();
    const { tracks: tr, duration: d } = latest.current;
    if (!tr.length) return;
    const t0 = performance.now() - from * 1000;
    setRunning(true);
    setT(from);
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
  const run = useCallback(() => runFrom(0), [runFrom]);
  const timeRef = useRef<number | undefined>(undefined);
  const runningRef = useRef(false);
  const toggle = useCallback(() => {
    if (runningRef.current) {
      stop.current?.();
      setRunning(false);
      return;
    }
    const at = timeRef.current;
    runFrom(at === undefined || at >= latest.current.duration - 0.01 ? 0 : at);
  }, [runFrom]);

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

  timeRef.current = t;
  runningRef.current = running;
  const shown = useMemo(() => (t === undefined ? art : artAt(art, tracks, t * speedup)), [art, tracks, t, speedup]);
  const seek = useCallback((at: number | undefined) => {
    stop.current?.();
    setRunning(false);
    setT(at === undefined ? undefined : Math.max(0, Math.min(latest.current.duration, at)));
  }, []);
  const snapAt = (tracks[0]?.snap ?? 0) / speedup;
  return { art: shown, running, started: t !== undefined, run, toggle, canRun: tracks.length > 0, duration, time: t, snapAt, seek };
}
