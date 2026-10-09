// The editor's big field: the alignment drawn by PlayArtLayer (players + preset paths), ghost markers at the original
// spots, changed-player markers, the on-the-line band and drag guides. Players drag with the mouse (0.5 yd grid or
// free; Alt flips the snap mode, Shift locks the axis). While the field has keyboard focus, the arrow keys nudge the
// selected player (Shift = 0.1 yd) and Esc clears the selection.
import { memo, useRef, useState, type KeyboardEvent } from "react";
import { Field, PlayArtLayer, ProximityGuides, useFieldTransform, type FieldPointerEvent } from "../../field";
import { HALF_WIDTH, clamp } from "../../model/geometry";
import { DEPTHS, LINE_Y, OL_SPOTS, SPLITS, roundCoord } from "../../model/sets";
import type { ArtBounds, PlayArt, Vec } from "../../model/types";
import { useSettings } from "../../state/settings";
import { cx } from "../../ui";
import s from "./Editor.module.css";

export interface Ghost {
  slot: number;
  /** Reference spot (original alignment / original motion target). */
  from: Vec;
  /** Where the player is now. */
  to: Vec;
}

export interface EditorFieldProps {
  art: PlayArt;
  ghosts: Ghost[];
  /** Slots with a changed marker. */
  changed: ReadonlySet<number>;
  showGhosts: boolean;
  selected?: number;
  hover?: number;
  snap: boolean;
  /** Which players can be dragged (default all). */
  canDrag?(slot: number): boolean;
  /** Where a dragged player may go (default: anywhere behind the LOS). Shaded while dragging when `showRegion`. */
  region?: ArtBounds;
  showRegion?: boolean;
  onSelect(slot: number | undefined): void;
  onHover(slot: number | undefined): void;
  /** Live drag: called with the snapped target; `id` is unique per drag (one undo step). */
  onDrag(slot: number, to: Vec, id: number): void;
  /** Arrow keys while the field has focus: one step (0.5 yd, 0.1 with Shift). */
  onNudge?(dx: number, dy: number, fine: boolean): void;
  /** Dim the art (read-only views). */
  readOnly?: boolean;
  label?: string;
  hint?: string;
}

const VIEWPORT: ArtBounds = { minX: -HALF_WIDTH - 0.5, maxX: HALF_WIDTH + 0.5, minY: -11.5, maxY: 3.5 };
export const ALIGN_REGION: ArtBounds = { minX: -HALF_WIDTH, maxX: HALF_WIDTH, minY: -20, maxY: 0 };
let dragSeq = 0;

/** Standard depths / splits a snapped drag sticks to (within MAGNET yd). */
const DEPTH_MAGNETS = [DEPTHS.onLine, DEPTHS.tightEnd, DEPTHS.underCenter, DEPTHS.offLine, DEPTHS.pistol, -4.75, DEPTHS.shotgun, DEPTHS.tailback];
const SPLIT_MAGNETS = [0, SPLITS.tackle + SPLITS.olStep, 2 * SPLITS.tackle, SPLITS.slot, SPLITS.numbers, SPLITS.wide].flatMap((x) => (x ? [x, -x] : [0]));
const MAGNET = 0.3;
/** How far (yd) a dragged lineman may be from his spot / the line and still be pulled onto it. */
const OL_PULL = 0.6;
const GRID = 0.5;

/**
 * Grid snap for drags: moves in 0.5 yd steps from where the player started (so a receiver at −0.8 stays at −0.8 when
 * dragged sideways and 3.333-based splits keep their offset), and sticks to the standard depths and splits nearby.
 */
function snapDrag(start: Vec, raw: Vec, slot: number): Vec {
  const step = (from: number, v: number) => roundCoord(from + Math.round((v - from) / GRID) * GRID);
  const magnet = (v: number, raw: number, list: number[]) => {
    const hit = list.find((m) => Math.abs(raw - m) <= MAGNET);
    return hit !== undefined ? hit : v;
  };
  const to = { x: magnet(step(start.x, raw.x), raw.x, SPLIT_MAGNETS), y: magnet(step(start.y, raw.y), raw.y, DEPTH_MAGNETS) };
  // The five linemen (slots 6–10) are forgiving: a little off their spot or the line pulls back onto it, so the
  // line stays seven strong and the blocking keeps its spots.
  const k = slot - 6;
  if (k >= 0 && k < OL_SPOTS.length) {
    if (Math.abs(raw.x - OL_SPOTS[k]) <= OL_PULL) to.x = OL_SPOTS[k];
    if (raw.y > LINE_Y - OL_PULL && raw.y <= 0) to.y = clamp(to.y, LINE_Y + 0.1, 0);
  }
  return to;
}

interface Drag {
  slot: number;
  id: number;
  offset?: Vec;
  start: Vec;
  last?: Vec;
}

const KEY_DIR: Record<string, [number, number]> = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

export const EditorField = memo(function EditorField(p: EditorFieldProps) {
  const ballSpot = useSettings((st) => st.ballSpot);
  const drag = useRef<Drag | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number>();
  const region = p.region ?? ALIGN_REGION;

  // Drags start from the player's drawn spot (the preset target in a preset view).
  const playerAt = (slot: number): Vec | undefined => {
    const pl = p.art.players.find((x) => x.slot === slot);
    return pl ? pl.snap : undefined;
  };

  const onFieldPointer = (e: FieldPointerEvent) => {
    const d = drag.current;
    switch (e.type) {
      case "down":
        if (d && !d.offset) {
          const at = playerAt(d.slot) ?? e.field;
          d.offset = { x: at.x - e.field.x, y: at.y - e.field.y };
          d.start = at;
        }
        break;
      case "move": {
        if (!d?.offset) return;
        let to = { x: e.field.x + d.offset.x, y: e.field.y + d.offset.y };
        const grid = p.snap !== e.raw.altKey;
        to = grid ? snapDrag(d.start, to, d.slot) : { x: roundCoord(Math.round(to.x * 100) / 100), y: roundCoord(Math.round(to.y * 100) / 100) };
        // Shift locks the dominant axis and keeps the other coordinate exactly where it started.
        if (e.raw.shiftKey) to = Math.abs(to.x - d.start.x) >= Math.abs(to.y - d.start.y) ? { x: to.x, y: d.start.y } : { x: d.start.x, y: to.y };
        to = { x: clamp(to.x, region.minX, region.maxX), y: clamp(to.y, region.minY, region.maxY) };
        if (d.last && d.last.x === to.x && d.last.y === to.y) return;
        if (!d.last && to.x === d.start.x && to.y === d.start.y) return;
        d.last = to;
        if (dragging !== d.slot) setDragging(d.slot);
        p.onDrag(d.slot, to, d.id);
        break;
      }
      case "up":
      case "cancel":
        drag.current = null;
        setDragging(undefined);
        break;
      case "click":
        p.onSelect(undefined);
        break;
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = KEY_DIR[e.key];
    if (dir && p.selected !== undefined && p.onNudge && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      p.onNudge(dir[0], dir[1], e.shiftKey);
    } else if (e.key === "Escape" && p.selected !== undefined) {
      e.preventDefault();
      e.stopPropagation();
      p.onSelect(undefined);
    }
  };

  return (
    <div
      ref={box}
      className={cx(s.fieldFocus, p.readOnly && s.fieldReadOnly)}
      tabIndex={0}
      title={p.hint}
      onKeyDown={onKeyDown}
      onPointerDownCapture={() => box.current?.focus({ preventScroll: true })}
    >
      <Field interactive showCoords ballSpot={ballSpot} viewport={VIEWPORT} className={s.field} onFieldPointer={onFieldPointer} label={p.label ?? "Alignment editor"}>
        <Underlay ghosts={p.showGhosts ? p.ghosts : []} dragging={dragging !== undefined} region={p.showRegion && dragging !== undefined ? region : undefined} />
        <PlayArtLayer
          art={p.art}
          showLabels
          selectedSlot={p.selected}
          highlightSlot={p.hover ?? dragging}
          onPlayerHover={p.onHover}
          onPlayerPointerDown={(slot, e) => {
            if (e.button !== 0) return;
            if (!p.canDrag || p.canDrag(slot)) drag.current = { slot, id: ++dragSeq, start: playerAt(slot) ?? { x: 0, y: 0 } };
            p.onSelect(slot);
          }}
        />
        <ChangedMarkers art={p.art} changed={p.changed} />
        {dragging !== undefined && p.art.players.some((pl) => pl.slot === dragging) && (
          <ProximityGuides at={p.art.players.find((pl) => pl.slot === dragging)!.at} others={p.art.players.filter((pl) => pl.slot !== dragging).map((pl) => pl.at)} />
        )}
      </Field>
    </div>
  );
});

/** LOS band (the builder's "on the line": y above −1.5), depth guides and the allowed region while dragging, and
 *  ghost markers at the reference spots (below the players). */
function Underlay({ ghosts, dragging, region }: { ghosts: Ghost[]; dragging: boolean; region?: ArtBounds }) {
  const { pxPerYard } = useFieldTransform();
  const ppy = Math.max(pxPerYard, 0.5);
  const k = 1 / ppy;
  const W = HALF_WIDTH * 3;
  return (
    <g className={s.underlay} aria-hidden>
      <rect className={s.losBand} x={-W} width={2 * W} y={0} height={-LINE_Y} />
      {region && <rect className={s.region} x={region.minX} width={region.maxX - region.minX} y={-region.maxY} height={region.maxY - region.minY} />}
      {dragging &&
        [DEPTHS.onLine, DEPTHS.offLine, DEPTHS.underCenter, DEPTHS.shotgun].map((y) => (
          <line key={y} className={s.guide} x1={-W} x2={W} y1={-y} y2={-y} />
        ))}
      {ghosts.map((g) => (
        <g key={g.slot}>
          <line className={s.ghostLink} x1={g.from.x} y1={-g.from.y} x2={g.to.x} y2={-g.to.y} />
          <circle className={s.ghost} cx={g.from.x} cy={-g.from.y} r={7.5 * k} />
        </g>
      ))}
    </g>
  );
}

/** A small amber dot at the upper right of every changed player. */
function ChangedMarkers({ art, changed }: { art: PlayArt; changed: ReadonlySet<number> }) {
  const { pxPerYard } = useFieldTransform();
  const k = 1 / Math.max(pxPerYard, 0.5);
  if (!changed.size) return null;
  return (
    <g className={s.markers} aria-hidden>
      {art.players
        .filter((pl) => changed.has(pl.slot))
        .map((pl) => (
          <circle key={pl.slot} className={s.marker} cx={pl.snap.x + 7 * k} cy={-pl.snap.y - 7 * k} r={3 * k} />
        ))}
    </g>
  );
}
