// Renders a PlayArt (model/art.ts output) inside a <Field>: zones, paths in Madden draw order, players, then labels.
// Geometry is in yards; everything that should look the same at every zoom (stroke widths, arrowheads, T caps,
// player marks, labels) is drawn in screen pixels: strokes via vector-effect, marks inside a scale(1/pxPerYard) group.
// - The art is drawn through the field's depth scale (projectArt): play cards compress depth, detail fields don't.
// - Detail metrics grow with the field's px/yd (k = clamp(ppy / 14, 1, 1.9); player marks keep growing to 6×) so players stay in proportion to the
//   painted numbers on big screens; compact (card) metrics shrink a little on the smallest cards.
// - Compact art leaves out OL pass-pro stubs (Madden doesn't draw them) and narrows OL block caps so five linemen
//   don't merge into one gray hatch.
// - Labels draw last, each on an opaque field-colored pill, placed around the mark away from the slot's own path
//   (pass pro, drops, backward motion), other marks, other labels and the view edge (labelPlacement.ts).
// - Cuts are visible (cutGeometry.ts): speed cuts round the corner, hard cuts stay sharp with a plant tick, double
//   moves get a zig, turn-back hooks are one smooth curve and a DRAG_STOP ends in a settle bar across the arrow tip.
//   Sizes are screen-based (like the arrowheads) except the speed-corner radius, which is ~1.2 yd.
import { memo, useMemo, type PointerEvent as ReactPointerEvent, type ReactElement } from "react";
import type { ArtKind, ArtPath, ArtPlayer, ArtZone, PlayArt, ZoneKind } from "../model/types";
import { useFieldTransform } from "./Field";
import { cutCorners, drawCutPath, type CutSizes } from "./cutGeometry";
import { endAngleSvg, projectArt, r3, svgPoints, trimEnd, type ViewBox } from "./fieldMath";
import { placeLabels, type LabelRequest, type MarkCircle, type PlacedLabel, type Segment } from "./labelPlacement";
import styles from "./PlayArtLayer.module.css";

export interface PlayArtLayerProps {
  art: PlayArt;
  /** Hover emphasis (thin ring). */
  highlightSlot?: number;
  /** Selection (white ring + glow). */
  selectedSlot?: number;
  /** Makes players grabbable. The field won't pan from a player press (the event is default-prevented). */
  onPlayerPointerDown?: (slot: number, e: ReactPointerEvent<SVGGElement>) => void;
  /** Pointer enters (slot) / leaves (undefined) a player mark. */
  onPlayerHover?: (slot: number | undefined) => void;
  /** Slot labels next to the marks (placed clear of the slot's own path), zone and path labels. */
  showLabels?: boolean;
  /**
   * With showLabels: prefix each label with its slot index (FORMATS.md slot numbers), e.g. "3·WR1".
   * Default: true on detail fields, false on compact (card) art.
   */
  showSlots?: boolean;
  /** Fade every other slot when a slot is selected or highlighted. */
  dimOthers?: boolean;
  /** Card sizing: thinner strokes, smaller marks, no OL pass-pro marks. */
  compact?: boolean;
  /** Default true. */
  showPlayers?: boolean;
  /** Default true. */
  showZones?: boolean;
  /** Draw cut styles at route corners (rounded speed cuts, hard-cut ticks, double-move zigs, settle bars). Default true. */
  cutStyles?: boolean;
}

/** Screen-pixel metrics for the art at a given density and zoom. */
export interface ArtMetrics {
  stroke: number;
  radius: number;
  ring: number;
  arrowLen: number;
  arrowHalf: number;
  tHalf: number;
  dot: number;
  /** Player / zone label font size. */
  label: number;
  /** Size factor applied to the base metrics (selection rings, path labels and hit areas follow it). */
  scale: number;
  /** Size factor of the player marks: they keep growing with the field's zoom (lines and arrows stop at `scale`). */
  iconScale: number;
}

const COMPACT: ArtMetrics = { stroke: 2.4, radius: 4.6, ring: 1.6, arrowLen: 8.5, arrowHalf: 4.4, tHalf: 4.8, dot: 2.6, label: 8.5, scale: 1, iconScale: 1 };
const DETAIL: ArtMetrics = { stroke: 3, radius: 6.5, ring: 1.9, arrowLen: 11, arrowHalf: 5.6, tHalf: 6.5, dot: 3.3, label: 9.5, scale: 1, iconScale: 1 };

/** px/yd at which the detail metrics are 1×, and their largest factor. */
const DETAIL_BASE_PPY = 14;
const DETAIL_MAX_SCALE = 1.9;
/** Player marks follow the zoom much further (a mark is the same share of the field however far you zoom in). */
const ICON_MAX_SCALE = 6;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Metrics for a density at `ppy` screen px per yard. Detail art scales up with the field (k = clamp(ppy / 14, 1, 1.9))
 * so marks stay in proportion to the painted numbers; compact marks shrink a little on the smallest cards (~4 px/yd).
 */
export function artMetrics(compact: boolean, ppy: number): ArtMetrics {
  if (!compact) {
    const k = clamp(ppy / DETAIL_BASE_PPY, 1, DETAIL_MAX_SCALE);
    const ki = clamp(ppy / DETAIL_BASE_PPY, 1, ICON_MAX_SCALE);
    if (ki === 1) return DETAIL;
    const d = DETAIL;
    return {
      stroke: d.stroke * k,
      radius: d.radius * ki,
      ring: d.ring * ki,
      arrowLen: d.arrowLen * k,
      arrowHalf: d.arrowHalf * k,
      tHalf: d.tHalf * k,
      dot: d.dot * k,
      label: d.label * k,
      scale: k,
      iconScale: ki,
    };
  }
  const k = Math.min(1, Math.max(0.75, ppy / 5.6));
  if (k === 1) return COMPACT;
  const c = COMPACT;
  return {
    stroke: c.stroke * Math.max(k, 0.88),
    radius: c.radius * k,
    ring: c.ring * Math.max(k, 0.9),
    arrowLen: c.arrowLen * k,
    arrowHalf: c.arrowHalf * k,
    tHalf: c.tHalf * k,
    dot: c.dot * k,
    label: c.label,
    scale: 1,
    iconScale: 1,
  };
}

/** Draw order: later kinds paint on top. */
const KIND_ORDER: Record<ArtKind, number> = {
  block: 0,
  coverage: 1,
  realign: 1,
  rush: 2,
  route: 3,
  option: 4,
  preset: 4,
  motion: 4,
  qb: 5,
  run: 6,
  primary: 7,
};

const KIND_CLASS: Record<ArtKind, string> = {
  route: styles.route,
  primary: styles.primary,
  run: styles.run,
  block: styles.block,
  motion: styles.motion,
  preset: styles.motion,
  qb: styles.qb,
  option: styles.option,
  rush: styles.rush,
  coverage: styles.coverage,
  realign: styles.realign,
};

const ZONE_CLASS: Record<ZoneKind, string> = {
  deep: styles.zDeep,
  hook: styles.zHook,
  flat: styles.zFlat,
  curlflat: styles.zCurlflat,
  spy: styles.zSpy,
};

/** Stroke width multiplier per kind (relative to the density's base stroke). */
function strokeScale(kind: ArtKind): number {
  switch (kind) {
    case "block":
      return 0.85;
    case "coverage":
    case "realign":
      return 0.55;
    default:
      return 1;
  }
}

const isDashed = (p: ArtPath) => p.dashed ?? (p.kind === "preset" || p.kind === "option");

/** Uniform scale that turns local pixel units into yards (precise enough at any zoom). */
const pxScale = (ppy: number) => `scale(${+(1 / ppy).toPrecision(5)})`;

const isLineman = (p: ArtPlayer) => p.side === "offense" && (p.glyph === "ol" || p.glyph === "center");

/** A block stub: the short (≤ 1.2 yd) two-point path model/art.ts draws for Pass/Run/WedgeBlock in place. */
function isBlockStub(path: ArtPath): boolean {
  if (path.kind !== "block" || path.points.length !== 2) return false;
  const [a, b] = path.points;
  return Math.hypot(b.x - a.x, b.y - a.y) <= 1.2;
}

/** The OL protection mark: a block stub stepping back from the line. */
const isPassProStub = (path: ArtPath) => isBlockStub(path) && path.points[1].y < path.points[0].y - 0.3;

/** OL block caps on cards: ~0.3 yd a side, so neighbors (1.67 yd apart) keep a clear gap instead of a gray hatch. */
const OL_CAP_YD = 0.3;
/** On cards an OL run-block stem shows at least this many px past the lineman's square (else the T sits on it). */
const OL_STEM_MIN_PX = 6;
/** OL block lines on cards (releases, pulls, stubs) are thinner than other blocks so the line stays light. */
const OL_STROKE_COMPACT = 0.65;

export const PlayArtLayer = memo(function PlayArtLayer(props: PlayArtLayerProps) {
  const {
    art: rawArt,
    highlightSlot,
    selectedSlot,
    onPlayerPointerDown,
    onPlayerHover,
    showLabels = false,
    showSlots: showSlotsProp,
    dimOthers = false,
    compact = false,
    showPlayers = true,
    showZones = true,
    cutStyles = true,
  } = props;
  const showSlots = showSlotsProp ?? !compact;
  const { pxPerYard, depth, viewBox } = useFieldTransform();
  const art = projectArt(rawArt, depth);
  const ppy = Math.max(pxPerYard, 0.5);
  const m = useMemo(() => artMetrics(compact, ppy), [compact, ppy]);
  const focus = dimOthers ? (selectedSlot ?? highlightSlot) : undefined;
  const dimmed = (slot: number) => focus !== undefined && slot !== focus;

  const { paths, drawn, olSlots } = useMemo(() => {
    const ol = new Set(art.players.filter(isLineman).map((p) => p.slot));
    let list = art.paths.map((p, i) => ({ p, i }));
    if (compact) {
      // Cards: no OL pass-pro marks (they only add a gray smear under the line), and run-block stems long enough to
      // clear the lineman's square so the T doesn't sit on top of it.
      const stem = (Math.min(m.radius * 0.9, ppy * 0.6) + OL_STEM_MIN_PX) / ppy;
      list = list
        .filter(({ p }) => !(ol.has(p.slot) && isPassProStub(p)))
        .map(({ p, i }) => {
          if (!ol.has(p.slot) || !isBlockStub(p)) return { p, i };
          const [a, b] = p.points;
          const d = Math.hypot(b.x - a.x, b.y - a.y);
          if (d >= stem || d < 1e-6) return { p, i };
          const k = stem / d;
          return { p: { ...p, points: [a, { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }] }, i };
        });
    }
    return { paths: list, drawn: list.map((x) => x.p), olSlots: ol };
  }, [art, compact, m.radius, ppy]);

  // Players who run a pass route (cards draw them as an ×, like the game).
  const runners = new Set(art.paths.filter((p) => p.kind === "route" || p.kind === "primary" || (p.kind === "option" && !p.dashed)).map((p) => p.slot));
  const zoneKindBySlot = new Map<number, ZoneKind>();
  for (const z of art.zones) if (!zoneKindBySlot.has(z.slot)) zoneKindBySlot.set(z.slot, z.kind);

  const ordered = [...paths].sort(
    (a, b) =>
      Number(a.p.slot === focus) - Number(b.p.slot === focus) ||
      KIND_ORDER[a.p.kind] - KIND_ORDER[b.p.kind] ||
      a.i - b.i,
  );
  const olCap = compact ? Math.min(m.tHalf, ppy * OL_CAP_YD) : undefined;

  // Path labels (PULL, MAN…): one per spot — two pullers ending at the same gap would print "PULL" over "PULL".
  const pathLabelShown = useMemo(() => {
    const shown = new Set<number>();
    if (!showLabels || compact) return shown;
    const kept: { text: string; x: number; y: number }[] = [];
    const near = 28 * m.scale;
    for (const { p, i } of paths) {
      if (!p.label || !p.points.length) continue;
      const tip = p.points[p.points.length - 1];
      const x = tip.x * ppy;
      const y = tip.y * ppy;
      if (kept.some((k) => k.text === p.label && Math.hypot(k.x - x, k.y - y) < near)) continue;
      kept.push({ text: p.label, x, y });
      shown.add(i);
    }
    return shown;
  }, [paths, showLabels, compact, ppy, m.scale]);

  const interactive = !!(onPlayerPointerDown || onPlayerHover);

  return (
    <g className={styles.layer} data-compact={compact || undefined}>
      {showZones && art.zones.length > 0 && (
        <g>
          {art.zones.map((z, i) => (
            <ZoneShape key={i} zone={z} dim={dimmed(z.slot)} ppy={ppy} m={m} showLabel={showLabels} />
          ))}
        </g>
      )}
      <g>
        {ordered.map(({ p, i }) => (
          <PathShape
            key={i}
            path={p}
            ppy={ppy}
            m={m}
            dim={dimmed(p.slot)}
            colorClass={p.kind === "coverage" && zoneKindBySlot.has(p.slot) ? ZONE_CLASS[zoneKindBySlot.get(p.slot)!] : undefined}
            showLabel={pathLabelShown.has(i)}
            cuts={cutStyles}
            compact={compact}
            {...(olCap !== undefined && p.kind === "block" && olSlots.has(p.slot)
              ? { tHalf: olCap, strokeWidth: m.stroke * OL_STROKE_COMPACT }
              : undefined)}
          />
        ))}
      </g>
      {showPlayers && (
        <g className={interactive ? styles.players : styles.playersStatic}>
          {art.players.map((pl) => (
            <PlayerMark
              key={pl.slot}
              player={pl}
              ppy={ppy}
              m={m}
              selected={pl.slot === selectedSlot}
              highlighted={pl.slot === highlightSlot}
              cardMark={compact ? (runners.has(pl.slot) && pl.glyph === "skill" ? "x" : pl.glyph === "def" ? undefined : "dot") : undefined}
              dim={dimmed(pl.slot)}
              onPointerDown={onPlayerPointerDown}
              onHover={onPlayerHover}
            />
          ))}
        </g>
      )}
      {showPlayers && showLabels && (
        <PlayerLabels
          art={art}
          paths={drawn}
          ppy={ppy}
          m={m}
          olCap={olCap}
          showSlots={showSlots}
          viewBox={viewBox}
          selectedSlot={selectedSlot}
          dimmed={dimmed}
        />
      )}
    </g>
  );
});

// ───────────────────────────── paths ─────────────────────────────

interface PathShapeProps {
  path: ArtPath;
  ppy: number;
  m: ArtMetrics;
  dim: boolean;
  /** Overrides the kind color (coverage lines take their zone's color). */
  colorClass?: string;
  showLabel: boolean;
  /** Half width (px) of a block T cap (default m.tHalf). */
  tHalf?: number;
  /** Line width (px) override (default m.stroke × the kind's factor). */
  strokeWidth?: number;
  /** Draw cut styles at styled vertices (default true). */
  cuts?: boolean;
  /** Card (compact) sizing for the cut marks; default: from `m` (compact metrics have scale 1 and a smaller radius). */
  compact?: boolean;
}

/** Paths a player runs (not blocks, coverage or rush lines): gentle unstyled bends are drawn as curves. */
const SMOOTH_KINDS: ReadonlySet<ArtKind> = new Set<ArtKind>(["route", "primary", "run", "qb", "option", "motion"]);

/** Speed-corner radius on the field (yd) and its on-screen minimum (px). */
const CUT_ROUND_YD = 1.2;
const CUT_ROUND_MIN_PX = 6;

/** Cut-mark sizes in yards for the current density/zoom (screen-sized like the arrowheads, except the radius). */
export function cutSizes(m: ArtMetrics, ppy: number, compact = m.radius < DETAIL.radius): CutSizes {
  const px = (card: number, detail: number) => (compact ? card : detail * m.scale) / ppy;
  return {
    round: Math.max(CUT_ROUND_YD, CUT_ROUND_MIN_PX / ppy),
    zigHalf: px(5.5, 8),
    zigAmp: px(3.2, 4.6),
    tick: px(4.4, 6.5),
    hookIn: 0.3,
  };
}

const maxVertexIndex = (p: ArtPath) => (p.vertices ?? []).reduce((m, v) => Math.max(m, v.index), -1);

/** One ArtPath: polyline + cap. Exported for custom renderers (designer previews). */
export function PathShape({
  path,
  ppy,
  m,
  dim,
  colorClass,
  showLabel,
  tHalf = m.tHalf,
  strokeWidth,
  cuts = true,
  compact,
}: PathShapeProps): ReactElement | null {
  const pts = path.points;
  if (!pts.length) return null;
  const width = strokeWidth ?? m.stroke * strokeScale(path.kind);
  const tip = pts[pts.length - 1];
  const angle = endAngleSvg(pts, path.kind === "rush" ? 270 : 90);
  // Stop the line inside the arrowhead so the round line cap never pokes past the tip.
  const line = path.cap === "arrow" ? trimEnd(pts, (m.arrowLen * 0.6) / ppy) : pts;
  const corners = cuts && pts.length > 1 && path.vertices?.length ? cutCorners(path) : undefined;
  // Lines a player runs curve through gentle bends (swing arcs, wheels); blocks, coverage and rush lines stay straight.
  const smooth = cuts && pts.length > 2 && SMOOTH_KINDS.has(path.kind);
  const drawing = corners?.length || smooth
    ? drawCutPath(line, corners ?? [], cutSizes(m, ppy, compact), { lastVertexIndex: maxVertexIndex(path), smooth })
    : undefined;
  // A tone (block and release) recolors routes like the game does; the primary route stays red.
  const toneClass = path.tone && path.kind !== "primary" ? styles.toneRelease : undefined;
  const cls = [styles.path, colorClass ?? toneClass ?? KIND_CLASS[path.kind], path.alt && styles.alt, dim && styles.dim].filter(Boolean).join(" ");
  const capTransform = `translate(${r3(tip.x)} ${r3(-tip.y)}) rotate(${r3(angle)}) ${pxScale(ppy)}`;

  let cap: ReactElement | null = null;
  if (path.cap === "arrow") {
    const L = m.arrowLen * (path.kind === "coverage" || path.kind === "realign" ? 0.7 : 1);
    const H = m.arrowHalf * (path.kind === "coverage" || path.kind === "realign" ? 0.7 : 1);
    const head = `M0 0L${r3(-L)} ${r3(-H)}L${r3(-L)} ${r3(H)}Z`;
    cap = drawing?.settle ? (
      // Settle (DRAG_STOP): the arrow runs into a short bar — "get here and sit".
      <g transform={capTransform} data-cut="settle">
        <path className={styles.capFill} d={head} />
        <line className={styles.capStroke} x1={r3(width * 0.5)} y1={r3(-H * 1.3)} x2={r3(width * 0.5)} y2={r3(H * 1.3)} strokeWidth={r3(width)} />
      </g>
    ) : (
      <path className={styles.capFill} transform={capTransform} d={head} />
    );
  } else if (path.cap === "block") {
    cap = (
      <line className={styles.capStroke} transform={capTransform} x1={0} y1={r3(-tHalf)} x2={0} y2={r3(tHalf)} strokeWidth={width} />
    );
  } else if (path.cap === "dot") {
    cap = <circle className={styles.capFill} transform={capTransform} r={r3(m.dot)} />;
  }

  const k = m.scale;
  const lineClass = [styles.line, isDashed(path) && styles.dashed, path.kind === "realign" && styles.dotted].filter(Boolean).join(" ");
  return (
    <g className={cls} data-slot={path.slot} data-kind={path.kind}>
      {pts.length > 1 &&
        (drawing ? (
          <>
            <path className={lineClass} d={drawing.d} strokeWidth={width} />
          </>
        ) : (
          <polyline className={lineClass} points={svgPoints(line)} strokeWidth={width} />
        ))}
      {cap}
      {showLabel && path.label && (
        <text
          className={styles.pathLabel}
          transform={`translate(${r3(tip.x)} ${r3(-tip.y)}) ${pxScale(ppy)}`}
          x={r3(7 * k)}
          y={r3(-7 * k)}
          fontSize={r3(10 * k)}
        >
          {path.label}
        </text>
      )}
    </g>
  );
}

// ───────────────────────────── zones ─────────────────────────────

function ZoneShape({ zone, dim, ppy, m, showLabel }: { zone: ArtZone; dim: boolean; ppy: number; m: ArtMetrics; showLabel: boolean }) {
  return (
    <g className={[styles.zone, ZONE_CLASS[zone.kind], dim && styles.dim].filter(Boolean).join(" ")} data-slot={zone.slot}>
      <ellipse cx={r3(zone.center.x)} cy={r3(-zone.center.y)} rx={r3(zone.rx)} ry={r3(zone.ry)} />
      {showLabel && zone.label && (
        <text
          className={styles.zoneLabel}
          transform={`translate(${r3(zone.center.x)} ${r3(-zone.center.y)}) ${pxScale(ppy)}`}
          fontSize={r3(m.label)}
        >
          {zone.label}
        </text>
      )}
    </g>
  );
}

// ───────────────────────────── players ─────────────────────────────

interface PlayerMarkProps {
  player: ArtPlayer;
  ppy: number;
  m: ArtMetrics;
  selected: boolean;
  highlighted: boolean;
  dim: boolean;
  onPointerDown?: (slot: number, e: ReactPointerEvent<SVGGElement>) => void;
  onHover?: (slot: number | undefined) => void;
  /** Card mark instead of the position glyph: "x" = route runner, "dot" = everyone else. */
  cardMark?: "x" | "dot";
}

function PlayerMark({ player: p, ppy, m, selected, highlighted, dim, onPointerDown, onHover, cardMark }: PlayerMarkProps) {
  const R = m.radius;
  const k = m.iconScale;
  const interactive = !!(onPointerDown || onHover);
  return (
    <g
      className={[styles.player, dim && styles.dimPlayer, onPointerDown && styles.grab].filter(Boolean).join(" ")}
      transform={`translate(${r3(p.at.x)} ${r3(-p.at.y)}) ${pxScale(ppy)}`}
      data-slot={p.slot}
      onPointerDown={
        onPointerDown
          ? (e) => {
              onPointerDown(p.slot, e);
              e.preventDefault();
            }
          : undefined
      }
      onPointerEnter={onHover ? () => onHover(p.slot) : undefined}
      onPointerLeave={onHover ? () => onHover(undefined) : undefined}
    >
      {selected && (
        <>
          <circle className={styles.selGlow} r={r3(R + 6.5 * k)} strokeWidth={r3(5 * k)} />
          <circle className={styles.selRing} r={r3(R + 4 * k)} strokeWidth={r3(2 * k)} />
        </>
      )}
      {highlighted && !selected && <circle className={styles.hiRing} r={r3(R + 3.5 * k)} strokeWidth={r3(1.25 * k)} />}
      {cardMark === "x" ? (
        <path className={styles.mark} d={`M${r3(-R * 0.8)} ${r3(-R * 0.8)}L${r3(R * 0.8)} ${r3(R * 0.8)}M${r3(-R * 0.8)} ${r3(R * 0.8)}L${r3(R * 0.8)} ${r3(-R * 0.8)}`} strokeWidth={r3(m.ring * 1.6)} />
      ) : cardMark === "dot" ? (
        <circle className={styles.solid} r={r3(R * 0.78)} />
      ) : (
        <Glyph glyph={p.glyph} R={R} ring={m.ring} square={Math.min(R * 0.9, ppy * 0.6)} />
      )}
      {interactive && <circle className={styles.hit} r={r3(Math.max(R + 6 * k, 11))} />}
    </g>
  );
}

/** `square` = half side of OL marks, capped so neighbors (1.666 yd apart) never touch. */
function Glyph({ glyph, R, ring, square: s }: { glyph: ArtPlayer["glyph"]; R: number; ring: number; square: number }) {
  const rx = r3(Math.max(0.8, s * 0.14));
  switch (glyph) {
    case "qb":
      return <circle className={styles.solid} r={r3(R)} />;
    case "center":
      return <rect className={styles.solid} x={r3(-s)} y={r3(-s)} width={r3(2 * s)} height={r3(2 * s)} rx={rx} />;
    case "ol":
      return <rect className={styles.hollow} x={r3(-s)} y={r3(-s)} width={r3(2 * s)} height={r3(2 * s)} rx={rx} strokeWidth={r3(ring)} />;
    case "def": {
      // Points at the offense (down the screen).
      const w = R * 1.08;
      return <path className={styles.def} d={`M0 ${r3(R * 1.12)}L${r3(-w)} ${r3(-R * 0.78)}L${r3(w)} ${r3(-R * 0.78)}Z`} strokeWidth={r3(ring)} />;
    }
    default:
      return <circle className={styles.hollow} r={r3(R)} strokeWidth={r3(ring)} />;
  }
}

// ───────────────────────────── labels ─────────────────────────────

const widthCache = new Map<string, number>();
let measureCtx: CanvasRenderingContext2D | null | undefined;
let fontsHooked = false;

/** Rendered width (px) of a label in the display face, bold, 0.02em tracking (canvas when available, else an estimate). */
export function labelTextWidth(text: string, fontPx: number): number {
  const key = `${fontPx}|${text}`;
  const hit = widthCache.get(key);
  if (hit !== undefined) return hit;
  let w: number | undefined;
  if (typeof document !== "undefined") {
    if (!fontsHooked) {
      fontsHooked = true;
      // Widths measured with a fallback face are a little off once the web font arrives.
      document.fonts?.addEventListener?.("loadingdone", () => widthCache.clear());
    }
    measureCtx ??= document.createElement("canvas").getContext("2d");
    if (measureCtx) {
      const family = getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim() || "sans-serif";
      measureCtx.font = `700 ${fontPx}px ${family}`;
      w = measureCtx.measureText(text).width;
    }
  }
  w = (w ?? text.length * fontPx * 0.62) + text.length * fontPx * 0.02;
  widthCache.set(key, w);
  return w;
}

/** Label text for a player: "WR1", or "3·WR1" with slot numbers. */
const labelText = (p: ArtPlayer, showSlots: boolean) => (showSlots ? `${p.slot}·${p.label}` : p.label);

interface PlayerLabelsProps {
  art: PlayArt;
  /** Drawn paths (hidden ones excluded). */
  paths: ArtPath[];
  ppy: number;
  m: ArtMetrics;
  olCap?: number;
  showSlots: boolean;
  viewBox: ViewBox;
  selectedSlot?: number;
  dimmed(slot: number): boolean;
}

/** Everything a label should avoid, in px (SVG orientation): drawn path segments + their caps. */
function obstacleSegments(paths: ArtPath[], ppy: number, m: ArtMetrics, olCap: number | undefined, olSlots: Set<number>): Segment[] {
  const out: Segment[] = [];
  for (const p of paths) {
    const pts = p.points;
    const slot = p.slot;
    for (let i = 1; i < pts.length; i++) {
      out.push({ ax: pts[i - 1].x * ppy, ay: -pts[i - 1].y * ppy, bx: pts[i].x * ppy, by: -pts[i].y * ppy, slot });
    }
    if (!pts.length || p.cap === "none") continue;
    const tip = pts[pts.length - 1];
    const a = (endAngleSvg(pts, p.kind === "rush" ? 270 : 90) * Math.PI) / 180;
    const tx = tip.x * ppy;
    const ty = -tip.y * ppy;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    if (p.cap === "arrow") {
      const L = m.arrowLen;
      const H = m.arrowHalf;
      out.push({ ax: tx, ay: ty, bx: tx - ux * L, by: ty - uy * L, slot });
      out.push({ ax: tx - ux * L - uy * H, ay: ty - uy * L + ux * H, bx: tx - ux * L + uy * H, by: ty - uy * L - ux * H, slot });
    } else {
      const h = p.cap === "block" ? (olCap !== undefined && olSlots.has(p.slot) ? olCap : m.tHalf) : m.dot;
      out.push({ ax: tx - uy * h, ay: ty + ux * h, bx: tx + uy * h, by: ty - ux * h, slot });
    }
  }
  return out;
}

function PlayerLabels({ art, paths, ppy, m, olCap, showSlots, viewBox, selectedSlot, dimmed }: PlayerLabelsProps) {
  const font = m.label;
  const h = Math.round(font * 1.32 * 10) / 10;
  const padX = font * 0.42;
  const gap = 2.5 * m.scale;
  const vx0 = viewBox.x;
  const vy0 = viewBox.y;
  const vx1 = viewBox.x + viewBox.width;
  const vy1 = viewBox.y + viewBox.height;

  const placed = useMemo((): PlacedLabel[] => {
    const olSlots = new Set(art.players.filter(isLineman).map((p) => p.slot));
    const segments = obstacleSegments(paths, ppy, m, olCap, olSlots);
    const marks: MarkCircle[] = art.players.map((p) => ({ slot: p.slot, x: p.at.x * ppy, y: -p.at.y * ppy, r: m.radius + 1 }));
    const requests: LabelRequest[] = art.players.map((p) => ({
      slot: p.slot,
      x: p.at.x * ppy,
      y: -p.at.y * ppy,
      w: labelTextWidth(labelText(p, showSlots), font) + 2 * padX,
      h,
      prefer: p.glyph === "def" ? "above" : "below",
    }));
    return placeLabels(requests, segments, marks, {
      radius: m.radius,
      gap,
      view: { x0: vx0 * ppy, y0: vy0 * ppy, x1: vx1 * ppy, y1: vy1 * ppy },
    });
  }, [art, paths, ppy, m, olCap, showSlots, font, h, padX, gap, vx0, vy0, vx1, vy1]);

  const bySlot = new Map(art.players.map((p) => [p.slot, p]));
  return (
    <g className={styles.labels} aria-hidden>
      {placed.map((l) => {
        const p = bySlot.get(l.slot)!;
        return (
          <g
            key={l.slot}
            className={[styles.labelTag, dimmed(l.slot) && styles.dimPlayer, l.slot === selectedSlot && styles.labelSelected]
              .filter(Boolean)
              .join(" ")}
            transform={`translate(${r3(p.at.x)} ${r3(-p.at.y)}) ${pxScale(ppy)}`}
            data-slot={l.slot}
            data-spot={l.spot}
          >
            <rect className={styles.labelPill} x={r3(l.dx - l.w / 2)} y={r3(l.dy - l.h / 2)} width={r3(l.w)} height={r3(l.h)} rx={r3(l.h / 2)} />
            <text className={styles.label} x={r3(l.dx)} y={r3(l.dy + font * 0.35)} fontSize={r3(font)}>
              {showSlots ? (
                <>
                  <tspan className={styles.slotNum}>{p.slot}</tspan>
                  <tspan className={styles.slotSep}>·</tspan>
                  {p.label}
                </>
              ) : (
                p.label
              )}
            </text>
          </g>
        );
      })}
    </g>
  );
}
