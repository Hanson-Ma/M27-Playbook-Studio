// To-scale football field: an <svg> whose user unit is one yard (SVG y = −field y). Children draw in yard
// coordinates and read useFieldTransform() to size marks in screen pixels. Optional zoom/pan (wheel / pinch around
// the cursor, drag to pan, double-click to reset) and a live coordinate readout.
// Play cards pass a compressed depth scale (through their viewport): markings, the first-down line and PlayArtLayer
// draw field y at depth.map(y); pointer coordinates (toField, the readout) stay true field yards.
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { ArtBounds, Vec } from "../model/types";
import type { BallSpot } from "../state/settings";
import {
  DEFAULT_LOS_YARD_LINE,
  DEFAULT_VIEWPORT,
  baseView,
  boundsToViewBox,
  fieldMiddleX,
  fieldYRange,
  fitViewBox,
  formatCoord,
  panBy,
  pxPerYard as ppyOf,
  r3,
  sidelineXs,
  sy,
  toSvg,
  TRUE_DEPTH,
  markingDepth,
  viewBoxAttr,
  viewBoxFor,
  zoomAt,
  type DepthScale,
  type FieldViewport,
  type FitMode,
  type ViewBox,
  type ViewLimits,
  type ViewState,
} from "./fieldMath";
import { fieldMarkings, type FieldMarkingsMode } from "./FieldMarkings";
import { observeSize } from "./observeSize";
import styles from "./Field.module.css";

// ───────────────────────────── transform context ─────────────────────────────

export interface FieldTransform {
  /** Field point → SVG point (yards, y flipped, depth applied). */
  toSvg(v: Vec): Vec;
  /** Client (viewport) pixel position → field point in yards (true field yards, depth undone). */
  toField(clientX: number, clientY: number): Vec;
  /** Screen pixels per yard at the current size and zoom. */
  pxPerYard: number;
  /** Zoom relative to the fitted viewport (1 = fitted). */
  zoom: number;
  /** Current SVG viewBox. */
  viewBox: ViewBox;
  /**
   * How field y is drawn: TRUE_DEPTH on detail/editor fields, compressed on play cards. Content drawn in field
   * yards must go through it (PlayArtLayer does: it draws projectArt(art, depth)).
   */
  depth: DepthScale;
}

const FALLBACK_PPY = 8;

const depthToSvg = (depth: DepthScale) => (depth.id ? (v: Vec): Vec => ({ x: v.x, y: sy(depth.map(v.y)) }) : toSvg);

/** Transform for an <svg> whose size is known up front (thumbnails); no DOM needed. */
export function staticFieldTransform(vb: ViewBox, widthPx: number, heightPx: number, depth: DepthScale = TRUE_DEPTH): FieldTransform {
  const ppy = ppyOf(vb, widthPx, heightPx) || FALLBACK_PPY;
  return {
    toSvg: depthToSvg(depth),
    // Without a DOM node we can only map relative to the box itself (callers pass box-relative px).
    toField: (x, y) => ({ x: vb.x + x / ppy, y: depth.unmap(sy(vb.y + y / ppy)) }),
    pxPerYard: ppy,
    zoom: 1,
    viewBox: vb,
    depth,
  };
}

const DEFAULT_TRANSFORM = staticFieldTransform(boundsToViewBox(DEFAULT_VIEWPORT), 53.33 * FALLBACK_PPY, 36 * FALLBACK_PPY);

export const FieldContext = createContext<FieldTransform>(DEFAULT_TRANSFORM);

/** Inside a <Field> (or a FieldContext provider): coordinate helpers and the current pixels-per-yard. */
export function useFieldTransform(): FieldTransform {
  return useContext(FieldContext);
}

// ───────────────────────────── Field ─────────────────────────────

export interface FieldPointerEvent {
  /**
   * "click" = down + up on the field without dragging (not fired when a child claimed the press, e.g. a player);
   * "leave" = the pointer left the field.
   */
  type: "down" | "move" | "up" | "click" | "cancel" | "leave";
  /** Pointer position in field yards. */
  field: Vec;
  raw: PointerEvent;
}

export type { FieldViewport };

export type CoordsPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface FieldProps {
  /**
   * Region to fit into the box, in drawn yards (= field yards unless a depth scale applies). Default: sideline to
   * sideline, −12…24 yd. A `depth` on the viewport (card viewports) applies unless the `depth` prop overrides it.
   */
  viewport?: FieldViewport;
  /** Depth compression for everything drawn on the field (default: the viewport's, else TRUE_DEPTH). */
  depth?: DepthScale;
  /** Extra yards around the viewport. */
  padding?: number;
  /** "contain" (default) keeps the whole viewport visible; "cover" fills the box and trims. */
  fit?: FitMode;
  /** Wheel/pinch zoom around the cursor, drag to pan, double-click to reset. */
  interactive?: boolean;
  /** Which hash the ball sits on (visualization only). */
  ballSpot?: BallSpot;
  /** Live "X 12.3  Y −4.5" readout while hovering/dragging. */
  showCoords?: boolean;
  /** Corner of the readout chip (default "bottom-right", clear of view toolbars/HUDs that sit top-left). */
  coordsPosition?: CoordsPosition;
  /** Field y of the first-down line. */
  firstDown?: number;
  /** Yard line of the LOS measured from the offense's goal (painted numbers). Default 35. */
  losYardLine?: number;
  /** "full" (default), "minimal" (yard lines + LOS) or "none". */
  markings?: FieldMarkingsMode;
  /** Rendered size in CSS px when known up front: skips measuring. Otherwise the field fills its parent. */
  size?: { width: number; height: number };
  minZoom?: number;
  maxZoom?: number;
  /**
   * Pointer events in field coordinates. Call `e.raw.preventDefault()` on "down" to keep the field from panning
   * (e.g. when the editor starts its own drag). Pointers are captured, so "move"/"up" keep coming while dragging.
   */
  onFieldPointer?: (e: FieldPointerEvent) => void;
  /** Double-click on the field. `e.preventDefault()` stops the view reset. */
  onFieldDoubleClick?: (field: Vec, e: MouseEvent) => void;
  className?: string;
  style?: CSSProperties;
  /** Accessible name (non-interactive fields are role="img"). */
  label?: string;
  /** SVG content in yard coordinates (use toSvg / sy). */
  children?: ReactNode;
}

interface Gesture {
  mode: "idle" | "maybePan" | "pan" | "pinch" | "child";
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  pinchDist: number;
  pinchMid: { x: number; y: number };
}

const DRAG_SLOP_PX = 3;

export const Field = memo(function Field(props: FieldProps) {
  const {
    viewport,
    depth: depthProp,
    padding = 0,
    fit = "contain",
    interactive = false,
    ballSpot = "middle",
    showCoords = false,
    coordsPosition = "bottom-right",
    firstDown,
    losYardLine = DEFAULT_LOS_YARD_LINE,
    markings = "full",
    size,
    minZoom = 0.4,
    maxZoom = 14,
    onFieldPointer,
    onFieldDoubleClick,
    className,
    style,
    label,
    children,
  } = props;

  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  const chipXRef = useRef<HTMLSpanElement>(null);
  const chipYRef = useRef<HTMLSpanElement>(null);

  // ── size ──
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (size || !el) return;
    const apply = (width: number, height: number) =>
      setMeasured((prev) =>
        prev && Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5 ? prev : { width, height },
      );
    // Measure before paint so the first frame is already correct; the observer handles later changes.
    apply(el.clientWidth, el.clientHeight);
    return observeSize(el, apply);
  }, [size]);
  const box = size ?? (measured && measured.width > 0 && measured.height > 0 ? measured : null);

  // ── viewBox ──
  const vp = viewport ?? defaultViewport(ballSpot);
  const depth = depthProp ?? viewport?.depth ?? TRUE_DEPTH;
  const vpKey = `${vp.minX}|${vp.maxX}|${vp.minY}|${vp.maxY}|${padding}|${fit}|${depth.id}`;
  const aspect = box ? box.width / box.height : 0;
  const base = useMemo(
    () => fitViewBox(vp, aspect, { pad: padding, mode: fit }),
    [vpKey, aspect], // vp is compared by value through vpKey
  );
  const [viewRec, setViewRec] = useState<{ key: string; view: ViewState } | null>(null);
  const view = viewRec && viewRec.key === vpKey ? viewRec.view : null; // a new viewport resets zoom/pan
  const vb = viewBoxFor(base, view);
  const ppy = box ? ppyOf(vb, box.width, box.height) : FALLBACK_PPY;

  const limits = useMemo<ViewLimits>(() => {
    const [sl, sr] = sidelineXs(ballSpot);
    const yr = fieldYRange(losYardLine);
    return {
      minZoom,
      maxZoom,
      centerBox: boundsToViewBox({ minX: sl - 6, maxX: sr + 6, minY: yr.minY, maxY: yr.maxY }),
    };
  }, [ballSpot, losYardLine, minZoom, maxZoom]);

  // Handlers read the latest values through a ref instead of re-binding on every pan frame.
  const live = useRef({ base, vpKey, limits, interactive, showCoords, onFieldPointer, onFieldDoubleClick, depth });
  live.current = { base, vpKey, limits, interactive, showCoords, onFieldPointer, onFieldDoubleClick, depth };

  const updateView = useCallback((fn: (v: ViewState) => ViewState) => {
    setViewRec((prev) => {
      const { base, vpKey } = live.current;
      const current = prev && prev.key === vpKey ? prev.view : baseView(base);
      return { key: vpKey, view: fn(current) };
    });
  }, []);

  /**
   * Zoom by `factor` around a client point, then pan by a pixel delta. The anchor is derived from the view state
   * being updated (not the DOM), so several wheel/move events between renders compose exactly.
   */
  const zoomPan = useCallback(
    (clientX: number, clientY: number, factor: number, dxPx = 0, dyPx = 0) => {
      const svg = svgRef.current;
      const m = svg?.getScreenCTM();
      const shown = svg?.viewBox.baseVal;
      if (!m || !shown || !shown.width || !shown.height || !m.a) return;
      // Pointer as a fraction of the rendered viewBox, and the rendered scale (exact even when letterboxed).
      const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
      const fx = (p.x - shown.x) / shown.width;
      const fy = (p.y - shown.y) / shown.height;
      const pxPerUnitWidth = m.a * shown.width; // px per whole viewBox width
      updateView((v) => {
        const { base, limits } = live.current;
        const vb = viewBoxFor(base, v);
        let next = factor === 1 ? v : zoomAt(v, factor, { x: vb.x + fx * vb.width, y: vb.y + fy * vb.height }, limits);
        if (dxPx || dyPx) next = panBy(next, dxPx, dyPx, pxPerUnitWidth / viewBoxFor(base, next).width, limits);
        return next;
      });
    },
    [updateView],
  );

  const clientToSvg = useCallback((clientX: number, clientY: number): Vec => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }, []);

  const toField = useCallback(
    (clientX: number, clientY: number): Vec => {
      const p = clientToSvg(clientX, clientY);
      return { x: p.x, y: live.current.depth.unmap(sy(p.y)) };
    },
    [clientToSvg],
  );

  // ── coordinate chip (written straight to the DOM: no re-render per mouse move) ──
  const showChip = useCallback(
    (clientX: number, clientY: number) => {
      if (!live.current.showCoords || !chipRef.current) return;
      const f = toField(clientX, clientY);
      chipXRef.current!.textContent = formatCoord(f.x);
      chipYRef.current!.textContent = formatCoord(f.y);
      chipRef.current.dataset.visible = "true";
    },
    [toField],
  );
  const hideChip = useCallback(() => {
    if (chipRef.current) chipRef.current.dataset.visible = "false";
  }, []);

  // ── pointers ──
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture>({
    mode: "idle",
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    moved: false,
    pinchDist: 0,
    pinchMid: { x: 0, y: 0 },
  });
  const [panning, setPanning] = useState(false);

  const emit = useCallback(
    (type: FieldPointerEvent["type"], e: ReactPointerEvent<SVGSVGElement>) => {
      const cb = live.current.onFieldPointer;
      if (cb) cb({ type, field: toField(e.clientX, e.clientY), raw: e.nativeEvent });
    },
    [toField],
  );

  const pinchState = () => {
    const [a, b] = [...pointers.current.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    showChip(e.clientX, e.clientY);
    emit("down", e);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    const g = gesture.current;
    if (live.current.interactive && pointers.current.size === 2) {
      const p = pinchState();
      Object.assign(g, { mode: "pinch", pinchDist: p.dist, pinchMid: p.mid, moved: true });
      setPanning(false);
      return;
    }
    if (pointers.current.size > 1) return;
    // Children prevent the synthetic event; onFieldPointer consumers prevent `raw` (the native event).
    const prevented = e.isDefaultPrevented() || e.nativeEvent.defaultPrevented;
    const panButton = e.button === 0 || e.button === 1;
    Object.assign(g, {
      mode: prevented ? "child" : live.current.interactive && panButton ? "maybePan" : "idle",
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
    });
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    showChip(e.clientX, e.clientY);
    const g = gesture.current;
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > DRAG_SLOP_PX) g.moved = true;
      if (g.mode === "pinch" && pointers.current.size >= 2) {
        const p = pinchState();
        const factor = g.pinchDist > 0 ? p.dist / g.pinchDist : 1;
        // Zoom around the previous midpoint, then follow the midpoint's movement.
        zoomPan(g.pinchMid.x, g.pinchMid.y, factor, p.mid.x - g.pinchMid.x, p.mid.y - g.pinchMid.y);
        g.pinchDist = p.dist;
        g.pinchMid = p.mid;
      } else if (g.mode === "maybePan" && g.moved) {
        g.mode = "pan";
        setPanning(true);
      }
      if (g.mode === "pan") {
        const dx = e.clientX - g.lastX;
        const dy = e.clientY - g.lastY;
        if (dx || dy) zoomPan(e.clientX, e.clientY, 1, dx, dy);
      }
      g.lastX = e.clientX;
      g.lastY = e.clientY;
    }
    emit("move", e);
  };

  const endPointer = (e: ReactPointerEvent<SVGSVGElement>, type: "up" | "cancel") => {
    const tracked = pointers.current.delete(e.pointerId);
    emit(type, e);
    const g = gesture.current;
    // A press a child claimed (player drag) is not a field click.
    if (tracked && type === "up" && !g.moved && (g.mode === "idle" || g.mode === "maybePan") && pointers.current.size === 0) {
      emit("click", e);
    }
    if (pointers.current.size === 0) {
      g.mode = "idle";
      setPanning(false);
    } else if (g.mode === "pinch") {
      // One finger left: don't let it jump into a pan.
      g.mode = "child";
    }
  };

  const onPointerLeave = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (pointers.current.size) return; // captured drags keep reporting
    hideChip();
    emit("leave", e);
  };

  const onDoubleClick = (e: ReactMouseEvent<SVGSVGElement>) => {
    live.current.onFieldDoubleClick?.(toField(e.clientX, e.clientY), e.nativeEvent);
    if (live.current.interactive && !e.nativeEvent.defaultPrevented) setViewRec(null);
  };

  // Wheel zoom needs a non-passive native listener to stop the page from scrolling.
  useEffect(() => {
    const svg = svgRef.current;
    if (!interactive || !svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      // Trackpad pinches arrive as ctrl+wheel with small deltas.
      const k = e.ctrlKey ? 0.01 : 0.0015;
      zoomPan(e.clientX, e.clientY, Math.exp(-e.deltaY * unit * k));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [interactive, zoomPan]);

  // ── context ──
  const zoom = view?.zoom ?? 1;
  const transform = useMemo<FieldTransform>(
    () => ({ toSvg: depthToSvg(depth), toField, pxPerYard: ppy, zoom, viewBox: vb, depth }),
    [toField, ppy, zoom, vb.x, vb.y, vb.width, vb.height, depth], // vb is compared by value
  );

  // ── static paint ──
  // Interactive fields paint the whole field once so panning never rebuilds markings. Otherwise the visible (drawn)
  // range is taken back to field yards; past a compressed curve's limit that is the end of the field.
  const fullRange = fieldYRange(losYardLine);
  const markDepth = markingDepth(depth);
  const paintRange = interactive
    ? fullRange
    : {
        minY: Math.max(fullRange.minY, markDepth.unmap(sy(vb.y + vb.height)) - 5),
        maxY: Math.min(fullRange.maxY, markDepth.unmap(sy(vb.y)) + 5),
      };
  const marks = fieldMarkings({ minY: paintRange.minY, maxY: paintRange.maxY, ballSpot, los: losYardLine, mode: markings, depth: markDepth });
  const [sl, sr] = sidelineXs(ballSpot);

  const pointerHandlers =
    interactive || onFieldPointer || showCoords || onFieldDoubleClick
      ? {
          onPointerDown,
          onPointerMove,
          onPointerUp: (e: ReactPointerEvent<SVGSVGElement>) => endPointer(e, "up"),
          onPointerCancel: (e: ReactPointerEvent<SVGSVGElement>) => endPointer(e, "cancel"),
          onPointerLeave,
          onDoubleClick,
        }
      : undefined;

  return (
    <div
      ref={rootRef}
      className={[styles.root, interactive && styles.interactive, panning && styles.panning, className].filter(Boolean).join(" ")}
      style={size ? { width: size.width, height: size.height, ...style } : style}
    >
      <svg
        ref={svgRef}
        className={styles.svg}
        viewBox={viewBoxAttr({ x: r3(vb.x), y: r3(vb.y), width: r3(vb.width), height: r3(vb.height) })}
        preserveAspectRatio="xMidYMid meet"
        role={interactive ? "application" : "img"}
        aria-label={label}
        {...pointerHandlers}
      >
        {marks}
        {firstDown !== undefined && (
          <path className={styles.firstDown} d={`M${r3(sl)} ${r3(sy(markDepth.map(firstDown)))}H${r3(sr)}`} />
        )}
        <FieldContext.Provider value={transform}>{children}</FieldContext.Provider>
      </svg>
      {showCoords && (
        <div ref={chipRef} className={styles.chip} data-visible="false" data-pos={coordsPosition} aria-hidden>
          <span className={styles.chipKey}>X</span>
          <span ref={chipXRef} className={styles.chipVal} />
          <span className={styles.chipKey}>Y</span>
          <span ref={chipYRef} className={styles.chipVal} />
        </div>
      )}
    </div>
  );
});

function defaultViewport(ballSpot: BallSpot): ArtBounds {
  const m = fieldMiddleX(ballSpot);
  return { ...DEFAULT_VIEWPORT, minX: DEFAULT_VIEWPORT.minX + m, maxX: DEFAULT_VIEWPORT.maxX + m };
}
