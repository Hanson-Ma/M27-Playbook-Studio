// Minimal single-player art builder for thumbnails. MiniRoute prefers model/art.ts computeArt (the source of truth)
// and only falls back to this when the engine yields nothing for the slot (or throws), so route pickers still show
// something. Same conventions as the engine (FORMATS.md): legs are distance @ absolute direction, AutoMotion
// waypoints and OverrideFormPos are absolute, ReceiverCut curls/hitches end with a short hook back, cut vertices carry
// their cut style (a DRAG_STOP settles: no hook).
import { cutStyle } from "../model/art";
import { add, mirrorDeg, polar } from "../model/geometry";
import { glyphFor, slotLabel } from "../model/positions";
import type { ArtKind, ArtPath, ArtPlayer, ArtVertex, PlayArt, SetDef, Step, Vec } from "../model/types";
import { boundsOfPoints } from "./fieldMath";

const LEGS = new Set(["RunRoute", "MoveDirection", "ReceiveHandoff", "RecievePitch", "HeadTurnRunRoute"]);
/** Turn-back cuts that end a route with a hook (same list as the engine; DRAG_STOP settles instead). */
const TURN_BACK = /^RECEIVER_CUT_ANGLE_(CURL|HITCH_COMEBACK(_INSIDE)?|180(_PARTIAL)?|HINGECOMEBACK|SMASH(_QUICK)?)$/;
const HOOK_TURNS = [60, 120, 170];
const HOOK_SEG = 0.5;

/**
 * The hook a curl/hitch draws back toward the QB, as the engine draws it: three 0.5 yd segments turning
 * 60°/120°/170° from the route's last heading toward the cut side (LEFT = counter-clockwise).
 */
export function hookPoints(end: Vec, headingDeg: number, cutLeft: boolean): Vec[] {
  const out: Vec[] = [];
  let p = end;
  for (const t of HOOK_TURNS) {
    p = add(p, polar(headingDeg + (cutLeft ? t : -t), HOOK_SEG));
    out.push(p);
  }
  return out;
}

/** Yards a QB drops for each DROP_TYPEENUM_QBDROP_* family. */
function dropDistance(type: string): number {
  if (/1_STEP/.test(type)) return 1;
  if (/3_STEP/.test(type)) return 2.2;
  if (/5_STEP/.test(type)) return 3.2;
  if (/7_STEP/.test(type)) return 4.5;
  return 2;
}

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Art for one slot of `set` running `steps` (other players omitted). */
export function lightSlotArt(set: SetDef, slot: number, steps: Step[], opts: { flip?: boolean; primary?: boolean } = {}): PlayArt {
  const a = set.movements?.Normal?.[slot];
  const empty: PlayArt = { players: [], paths: [], zones: [], bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 }, flipped: !!opts.flip };
  if (!a) return empty;
  const fx = (v: Vec): Vec => (opts.flip ? { x: -v.x, y: v.y } : v);
  const dir = (d: number) => (opts.flip ? mirrorDeg(d) : d);
  const glyph = glyphFor(a);
  const side = glyph === "def" ? "defense" : "offense";

  const base = fx({ x: a.x, y: a.y });
  let at = base;
  const paths: ArtPath[] = [];
  const routeKind: ArtKind = glyph === "qb" ? "qb" : opts.primary ? "primary" : "route";

  let pos = at;
  let cur: { kind: ArtKind; points: Vec[]; vertices: ArtVertex[]; cap?: ArtPath["cap"] } = { kind: routeKind, points: [pos], vertices: [] };
  const flush = () => {
    if (cur.points.length > 1 || cur.cap === "block") {
      paths.push({ slot, kind: cur.kind, points: cur.points, cap: cur.cap ?? (cur.kind === "qb" ? "none" : "arrow"), vertices: cur.vertices.length ? cur.vertices : undefined });
    }
  };
  const restart = (kind: ArtKind) => {
    flush();
    cur = { kind, points: [pos], vertices: [] };
  };
  const moveTo = (p: Vec) => {
    pos = p;
    cur.points.push(p);
  };
  let started = false;

  steps.forEach((s, i) => {
    switch (s.type) {
      case "OverrideFormPos": {
        if (started) break;
        const next = fx({ x: num(s.offsetX, a.x), y: num(s.offsetY, a.y) });
        paths.push({ slot, kind: "realign", points: [at, next], cap: "none" });
        at = pos = next;
        cur = { kind: routeKind, points: [pos], vertices: [] };
        break;
      }
      case "AutoMotion": {
        const wps = Array.isArray(s.waypoints) ? (s.waypoints as { position?: Vec }[]) : [];
        if (!wps.length) break;
        restart("motion");
        for (const w of wps) if (w.position) moveTo(fx({ x: num(w.position.x), y: num(w.position.y) }));
        restart(routeKind);
        started = true;
        break;
      }
      case "ReceiverCut": {
        const v: ArtVertex = { index: cur.points.length - 1, cut: String(s.cutType ?? ""), cutDir: String(s.direction ?? ""), step: i };
        const style = cutStyle(v.cut);
        if (style) v.style = style;
        cur.vertices.push(v);
        break;
      }
      case "QBScramble": {
        restart("qb");
        const d = num(s.distance);
        moveTo(add(pos, d > 0 ? polar(dir(num(s.direction)), d) : { x: 0, y: -dropDistance(String(s.dropBackType ?? "")) }));
        cur.cap = "none";
        started = true;
        break;
      }
      case "PassBlock":
      case "RunBlock": {
        if (cur.points.length > 1) {
          cur.kind = "block";
          cur.cap = "block";
        } else {
          restart("block");
          moveTo(add(pos, polar(s.type === "PassBlock" ? (side === "offense" ? 270 : 90) : 90, s.type === "PassBlock" ? 0.8 : 1.2)));
          cur.cap = "block";
        }
        started = true;
        break;
      }
      case "LeadBlock":
        if (cur.points.length === 1) moveTo(add(pos, polar(90, 1.5)));
        cur.kind = "block";
        cur.cap = "block";
        started = true;
        break;
      case "RunEndZone":
        cur.kind = "run";
        moveTo(add(pos, { x: 0, y: 8 }));
        break;
      default:
        if (LEGS.has(s.type)) {
          if (s.type === "ReceiveHandoff" || s.type === "RecievePitch") cur.kind = "run";
          const d = num(s.distance);
          if (d > 0) moveTo(add(pos, polar(dir(num(s.direction, 90)), d)));
          started = true;
        }
    }
  });

  // A turn-back cut at the very end draws a short hook back toward the QB.
  const last = cur.vertices[cur.vertices.length - 1];
  const n = cur.points.length;
  if (last && n > 1 && last.index === n - 1 && TURN_BACK.test(last.cut ?? "")) {
    const a = cur.points[n - 2];
    const heading = (Math.atan2(pos.y - a.y, pos.x - a.x) * 180) / Math.PI;
    // Cut sides come from the unflipped steps; without one, hook back toward the middle.
    const named = /LEFT/.test(last.cutDir ?? "") ? "L" : /RIGHT/.test(last.cutDir ?? "") ? "R" : "";
    const left = named ? (named === "L") !== !!opts.flip : pos.x > 0;
    for (const p of hookPoints(pos, heading, left)) moveTo(p);
  }
  flush();

  const player: ArtPlayer = {
    slot,
    pos: a.pos,
    depth: a.depth,
    label: slotLabel(a.pos, a.depth),
    glyph,
    base,
    at,
    snap: at,
    facing: a.facing,
    stance: a.stance,
    isVip: !!opts.primary,
    isBallcarrier: paths.some((p) => p.kind === "run"),
    motionMan: a.motionMan,
    side,
  };
  const bounds = boundsOfPoints([at, base, ...paths.flatMap((p) => p.points)])!;
  return { players: [player], paths, zones: [], bounds, flipped: !!opts.flip };
}
