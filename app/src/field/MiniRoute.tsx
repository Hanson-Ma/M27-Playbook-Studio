// Square thumbnail of one player's assignment from their real alignment (route library, route pickers).
// Cheap by design: a fixed-size <svg> with a static transform (no measuring, no context provider state),
// cached minimal markings and a memoized single-slot art.
// True to scale by default: route pickers compare break angles, which depth compression would flatten.
// `compressDepth` draws depth like the play cards (true to 8 yd, then easing) so a 60-yd go doesn't shrink the
// release and break of a small thumbnail to a dot.
import { memo, useMemo, type CSSProperties } from "react";
import { computeArt } from "../model/art";
import type { PlayArt, SetDef, Step } from "../model/types";
import { FieldContext, staticFieldTransform } from "./Field";
import { fieldMarkings } from "./FieldMarkings";
import {
  boundsOfPoints,
  boundsToViewBox,
  compressedDepth,
  projectArt,
  r3,
  squareAround,
  TRUE_DEPTH,
  viewBoxAttr,
} from "./fieldMath";
import { lightSlotArt } from "./lightArt";
import { PlayArtLayer } from "./PlayArtLayer";
import styles from "./MiniRoute.module.css";

export interface MiniRouteProps {
  set: SetDef;
  slot: number;
  /** The slot's steps (trailing None optional). */
  steps: Step[];
  /** Square size in CSS px (default 72). */
  size?: number;
  flip?: boolean;
  /** Draw as the primary (red) route. */
  primary?: boolean;
  /** Pre-snap motion preset (SetDef.movements key). */
  preset?: string;
  selected?: boolean;
  /** Compress depth past 8 yd like the play cards (default false: true to scale). */
  compressDepth?: boolean;
  title?: string;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
}

/** Single-slot art: the engine's output for that slot, or the light builder when the engine has nothing. */
export function miniRouteArt(set: SetDef, slot: number, steps: Step[], opts: { flip?: boolean; primary?: boolean; preset?: string } = {}): PlayArt {
  try {
    const slots = (set.movements?.Normal ?? []).map((_, i) => (i === slot ? steps : []));
    const full = computeArt(set, slots, { flip: opts.flip, vip: opts.primary ? slot : undefined, preset: opts.preset, showPassPro: true });
    const paths = full.paths.filter((p) => p.slot === slot);
    const players = full.players.filter((p) => p.slot === slot);
    if (paths.length && players.length) {
      return { ...full, players, paths, zones: full.zones.filter((z) => z.slot === slot) };
    }
  } catch {
    /* fall through to the light builder */
  }
  return lightSlotArt(set, slot, steps, opts);
}

const PAD = 2.2; // yd around the route
const MIN_SPAN = 10; // yd: short routes don't zoom into a blur
/** compressDepth: true scale to 8 yd, then easing toward 18 yd (a 60-yd go draws ~18 yd long). */
const MINI_DEPTH = compressedDepth({ knee: 8, reach: 10 });

export const MiniRoute = memo(function MiniRoute(props: MiniRouteProps) {
  const { set, slot, steps, size = 72, flip, primary, preset, selected, compressDepth, title, className, style, onClick } = props;
  const depth = compressDepth ? MINI_DEPTH : TRUE_DEPTH;

  const art = useMemo(() => miniRouteArt(set, slot, steps, { flip, primary, preset }), [set, slot, steps, flip, primary, preset]);

  const view = useMemo(() => {
    // Frame the art as drawn (PlayArtLayer projects it through the same scale; projectArt is memoized).
    const shown = projectArt(art, depth);
    const pts = [...shown.players.flatMap((p) => [p.at, p.snap]), ...shown.paths.flatMap((p) => p.points)];
    for (const z of shown.zones) pts.push({ x: z.center.x - z.rx, y: z.center.y - z.ry }, { x: z.center.x + z.rx, y: z.center.y + z.ry });
    const b = boundsOfPoints(pts) ?? { minX: -5, maxX: 5, minY: -5, maxY: 5 };
    const sq = squareAround(b, PAD, MIN_SPAN);
    const vb = boundsToViewBox(sq);
    // Markings take field yards: undo the scale (past its limit = the far end of the field).
    const marks = { minY: Math.max(depth.unmap(sq.minY), -60), maxY: Math.min(depth.unmap(sq.maxY), 75) };
    return { marks, vb, transform: staticFieldTransform(vb, size, size, depth) };
  }, [art, size, depth]);

  return (
    <div
      className={[styles.mini, className].filter(Boolean).join(" ")}
      style={{ width: size, height: size, ...style }}
      data-selected={selected || undefined}
      data-clickable={onClick ? true : undefined}
      title={title}
      role={onClick ? "button" : undefined}
      aria-pressed={onClick ? !!selected : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              e.stopPropagation();
              onClick();
            }
          : undefined
      }
    >
      <svg
        className={styles.svg}
        width={size}
        height={size}
        viewBox={viewBoxAttr({ x: r3(view.vb.x), y: r3(view.vb.y), width: r3(view.vb.width), height: r3(view.vb.height) })}
        aria-hidden
      >
        {fieldMarkings({ minY: view.marks.minY, maxY: view.marks.maxY, mode: "minimal", depth })}
        <FieldContext.Provider value={view.transform}>
          <PlayArtLayer art={art} compact />
        </FieldContext.Provider>
      </svg>
    </div>
  );
});
