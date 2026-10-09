// Play-designer field extras (in the spirit of Go Army Edge Football's play editor), on top of the existing tools:
//   • SegmentLayer / SegmentPanel: click a route segment to select it (orange) and set its speed, how the player
//     runs it (run / move), which way he faces (forward, backpedal, shuffle) and the cut into it.
//   • FirstStepsFan: the "first steps" picker: a fan of grey arrows around the player for his release (receivers) or
//     his drop (QB); click one to apply it.
//   • PlaybackBar: video-style controls (play / pause, restart, timeline).
import { useMemo, type PointerEvent as ReactPointerEvent } from "react";
import { useFieldTransform } from "../../field";
import { r3 } from "../../field/fieldMath";
import type { Playback } from "../../field/usePlayback";
import { qbDropVector } from "../../model/art";
import { add, polar } from "../../model/geometry";
import {
  cutAt,
  detectRelease,
  editRoute,
  legFacing,
  qbDropOf,
  qbDropsFor,
  releaseHeading,
  setLeg,
  setLegFacing,
  setQbDrop,
  setRelease,
  sideOfX,
  type LegFacing,
  type ReleaseKind,
} from "../../model/routes";
import type { Step, Vec } from "../../model/types";
import { Button, IconButton, cx } from "../../ui";
import { cutName } from "./cuts";
import { viewPoint, type SlotGeometry } from "./shared";
import s from "./FieldExtras.module.css";

// ───────────────────────────── segments ─────────────────────────────

/** Invisible wide hit lines over each editable leg (click = select it) and the orange highlight of the selected one. */
export function SegmentLayer({
  geom,
  flip,
  selected,
  onSelect,
}: {
  geom: SlotGeometry;
  flip: boolean;
  selected?: number;
  onSelect(k: number, e: ReactPointerEvent): void;
}) {
  const { pxPerYard } = useFieldTransform();
  const k = 1 / Math.max(pxPerYard, 0.5);
  const pts = geom.points.map((p) => viewPoint(p, flip));
  return (
    <g className={s.segments}>
      {selected !== undefined && pts[selected] && pts[selected + 1] && (
        <line className={s.segOn} x1={r3(pts[selected].x)} y1={r3(-pts[selected].y)} x2={r3(pts[selected + 1].x)} y2={r3(-pts[selected + 1].y)} strokeWidth={r3(5 * k)} />
      )}
      {geom.route.legs.map((_, i) =>
        i < geom.firstEditableLeg ? null : (
          <line
            key={i}
            className={s.segHit}
            x1={r3(pts[i].x)}
            y1={r3(-pts[i].y)}
            x2={r3(pts[i + 1].x)}
            y2={r3(-pts[i + 1].y)}
            strokeWidth={r3(14 * k)}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              e.preventDefault();
              onSelect(i, e);
            }}
          >
            <title>Segment {i + 1}: click to set its speed, movement and facing</title>
          </line>
        ),
      )}
    </g>
  );
}

const SPEEDS = [25, 50, 75, 100];
const FACINGS: { id: LegFacing; label: string }[] = [
  { id: "forward", label: "Forward" },
  { id: "backpedal", label: "Backpedal" },
  { id: "shuffleLeft", label: "Shuffle L" },
  { id: "shuffleRight", label: "Shuffle R" },
];

/** The selected segment's controls (floats over the field's top right). */
export function SegmentPanel({
  steps,
  geom,
  k,
  editable,
  onChange,
  onPickCut,
  onClose,
}: {
  steps: Step[];
  geom: SlotGeometry;
  k: number;
  editable: boolean;
  onChange(steps: Step[], label: string): void;
  onPickCut(vertex: number, at: { x: number; y: number }): void;
  onClose(): void;
}) {
  const leg = geom.route.legs[k];
  if (!leg) return null;
  const facing = legFacing(geom.route, k);
  const speed = leg.speed ?? 100;
  const cutIn = k > 0 ? cutAt(geom.route, k - 1) : undefined;
  const edit = (fn: Parameters<typeof editRoute>[1], label: string) => onChange(editRoute(steps, fn), label);
  return (
    <div className={s.panel} role="dialog" aria-label="Route segment">
      <div className={s.panelHead}>
        <span>Route Segment {k + 1}</span>
        <span className={s.panelMeta}>
          {Math.round(leg.distance * 10) / 10} yd @ {Math.round(leg.direction)}°
        </span>
        <IconButton icon="close" size="sm" title="Close (Esc)" onClick={onClose} />
      </div>
      <div className={s.row}>
        <span className={s.rowLabel}>Speed</span>
        <div className={s.chips}>
          {SPEEDS.map((v) => (
            <button key={v} type="button" disabled={!editable} className={cx(s.chip, Math.abs(speed - v) < 1 && s.chipOn)} onClick={() => edit((r) => setLeg(r, k, { speed: v }), "Segment speed")}>
              {v === 100 ? "Full" : `${v}%`}
            </button>
          ))}
        </div>
      </div>
      <div className={s.row}>
        <span className={s.rowLabel}>Movement</span>
        <div className={s.chips}>
          {[
            { t: "RunRoute", label: "Run Route" },
            { t: "MoveDirection", label: "Move" },
          ].map((o) => (
            <button
              key={o.t}
              type="button"
              disabled={!editable || !["RunRoute", "MoveDirection"].includes(leg.type)}
              className={cx(s.chip, leg.type === o.t && s.chipOn)}
              title={o.t === "RunRoute" ? "A pass route leg (the receiver runs it at route speed)" : "A plain movement (blocking releases, backfield paths)"}
              onClick={() => edit((r) => setLeg(r, k, { type: o.t }), "Segment movement")}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className={s.row}>
        <span className={s.rowLabel}>Facing</span>
        <div className={s.chips}>
          {FACINGS.map((f) => (
            <button key={f.id} type="button" disabled={!editable} className={cx(s.chip, facing === f.id && s.chipOn)} onClick={() => edit((r) => setLegFacing(r, k, f.id), "Segment facing")}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {k > 0 && (
        <div className={s.row}>
          <span className={s.rowLabel}>Cut Into It</span>
          <Button
            size="sm"
            variant="secondary"
            disabled={!editable}
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              onPickCut(k - 1, { x: r.left, y: r.bottom + 6 });
            }}
          >
            {cutIn ? cutName(String(cutIn.cutType)) : "No Cut"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── first steps ─────────────────────────────

interface FanOption {
  id: string;
  label: string;
  /** Preview polyline from the player (field yards, model orientation). */
  pts: Vec[];
  on: boolean;
  apply(steps: Step[]): Step[];
}

const RELEASES: { kind: Exclude<ReleaseKind, "none">; label: string }[] = [
  { kind: "vertical", label: "Vertical Release" },
  { kind: "inside", label: "Inside Release" },
  { kind: "outside", label: "Outside Release" },
];

/** The options of the first-steps fan for a player (QB: his drops; receivers: releases). Empty = nothing to pick. */
export function firstStepOptions(steps: Step[], geom: SlotGeometry, isQB: boolean): FanOption[] {
  const start = geom.start;
  if (isQB) {
    const cur = qbDropOf(steps);
    if (cur === undefined) return [];
    return qbDropsFor(start.y).map((d) => {
      const v = qbDropVector({ type: "QBScramble", dropBackType: d.drop }) ?? { x: 0, y: -0.8 };
      const len = Math.hypot(v.x, v.y);
      const vv = len < 1.5 ? { x: (v.x / (len || 1)) * 1.5, y: (v.y / (len || 1)) * 1.5 || -1.5 } : v;
      return { id: d.id, label: d.label, pts: [start, add(start, vv)], on: cur === d.drop, apply: (st) => setQbDrop(st, d.drop) };
    });
  }
  if (!geom.route.legs.length) return [];
  const side = sideOfX(start.x);
  const cur = detectRelease(geom.route, side);
  return RELEASES.map((r) => ({
    id: r.kind,
    label: r.label,
    pts: [start, add(start, polar(releaseHeading(r.kind, side), 4.5))],
    on: cur === r.kind,
    apply: (st) => editRoute(st, (route) => setRelease(route, start, side, r.kind)),
  }));
}

/** Grey arrows around the player, one per option; the current one is solid, hover darkens, click applies. */
export function FirstStepsFan({ options, flip, onPick }: { options: FanOption[]; flip: boolean; onPick(o: FanOption): void }) {
  const { pxPerYard } = useFieldTransform();
  const k = 1 / Math.max(pxPerYard, 0.5);
  return (
    <g className={s.fan}>
      {options.map((o) => {
        const pts = o.pts.map((p) => viewPoint(p, flip));
        const a = pts[pts.length - 2];
        const b = pts[pts.length - 1];
        const ang = Math.atan2(-(b.y - a.y), b.x - a.x);
        const L = 9 * k;
        const H = 5 * k;
        const head = `M${r3(b.x)} ${r3(-b.y)}L${r3(b.x - L * Math.cos(ang) + H * Math.sin(ang))} ${r3(-b.y - L * Math.sin(ang) - H * Math.cos(ang))}L${r3(b.x - L * Math.cos(ang) - H * Math.sin(ang))} ${r3(-b.y - L * Math.sin(ang) + H * Math.cos(ang))}Z`;
        return (
          <g key={o.id} className={cx(s.fanItem, o.on && s.fanOn)} onPointerDown={(e) => (e.stopPropagation(), e.preventDefault(), onPick(o))}>
            <title>{o.label}</title>
            <polyline points={pts.map((p) => `${r3(p.x)},${r3(-p.y)}`).join(" ")} strokeWidth={r3(3 * k)} />
            <path d={head} />
            <polyline className={s.fanHit} points={pts.map((p) => `${r3(p.x)},${r3(-p.y)}`).join(" ")} strokeWidth={r3(16 * k)} />
          </g>
        );
      })}
    </g>
  );
}

/** The fan's option list (names), docked like the segment panel. */
export function FirstStepsPanel({ options, title, onPick, onClose }: { options: FanOption[]; title: string; onPick(o: FanOption): void; onClose(): void }) {
  return (
    <div className={s.panel} role="dialog" aria-label="First steps">
      <div className={s.panelHead}>
        <span>{title}</span>
        <IconButton icon="close" size="sm" title="Close (Esc)" onClick={onClose} />
      </div>
      <div className={s.list}>
        {options.map((o) => (
          <button key={o.id} type="button" className={cx(s.listItem, o.on && s.listOn)} onClick={() => onPick(o)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────────── playback ─────────────────────────────

/** Video-style controls for the play on the designer field: play / pause, restart, a timeline to scrub and the time. */
export function PlaybackBar({ playback }: { playback: Playback }) {
  const t = playback.time ?? 0;
  const d = Math.max(0.01, playback.duration);
  const marks = useMemo(() => (playback.snapAt > 0 ? [playback.snapAt] : []), [playback.snapAt]);
  const atStart = playback.time === undefined || (playback.time === 0 && !playback.running);
  return (
    <div className={s.playbar} role="group" aria-label="Play controls">
      <IconButton
        icon={playback.running ? "pause" : "play"}
        size="sm"
        title={playback.running ? "Pause" : playback.time !== undefined && playback.time < d ? "Play on" : "Play"}
        aria-label={playback.running ? "Pause" : "Play"}
        disabled={!playback.canRun}
        onClick={playback.toggle}
      />
      <IconButton icon="refresh" size="sm" title="Restart from the beginning" aria-label="Restart" disabled={!playback.canRun || atStart} onClick={playback.run} />
      <input
        className={s.scrub}
        type="range"
        min={0}
        max={d}
        step={0.01}
        value={t}
        disabled={!playback.canRun}
        aria-label="Play timeline"
        list="designer-timeline-marks"
        onChange={(e) => playback.seek(Number(e.currentTarget.value))}
      />
      <datalist id="designer-timeline-marks">
        {marks.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <span className={s.time} title={playback.snapAt > 0 ? `The ball is snapped at ${playback.snapAt.toFixed(2)} s; the motion runs before it` : undefined}>
        {t.toFixed(2)} s
      </span>
    </div>
  );
}
