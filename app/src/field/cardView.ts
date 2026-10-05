// The play card's fixed field window (pure; PlayCard and every card-like field use it).
//
// Cards compress depth like Madden's own art instead of clipping it: true scale from the backfield to 8 yd past the
// LOS, then an ease toward a limit just inside the top edge, so every route (library routes reach ~64 yd) and every
// deep zone ends inside the card with its arrowhead. The deep backfield (punters, deep drops) eases toward the bottom
// edge the same way, and routes that run past a sideline (a third of the library's offense plays: long outs, fades,
// corners) stop just inside it with their arrowhead. Offense: LOS ~1/3 up; defense: LOS lower, deep zones higher.
// Detail, pre-snap and editor fields stay true to scale.
import { HALF_WIDTH } from "../model/geometry";
import type { Side } from "../model/types";
import { compressedDepth, type DepthScale, type FieldViewport } from "./fieldMath";

/** Art aspect of the in-game card. */
export const CARD_ASPECT = 2.15;

const CARD_HEIGHT = (2 * HALF_WIDTH) / CARD_ASPECT;

/** Paths are cut this far inside the card's side edges (room for the arrowhead). */
const CARD_X_LIMIT = HALF_WIDTH - 0.6;

const OFFENSE_DEPTH = compressedDepth({ knee: 8, reach: 7.6, backKnee: -5.5, backReach: 2.5, xLimit: CARD_X_LIMIT });
const DEFENSE_DEPTH = compressedDepth({ knee: 8, reach: 13, backKnee: -2.5, backReach: 2.5, xLimit: CARD_X_LIMIT });

/** Sideline to sideline, in drawn (compressed) yards; carries its depth scale for <Field>. */
const makeViewport = (minY: number, depth: DepthScale): FieldViewport =>
  Object.freeze({ minX: -HALF_WIDTH, maxX: HALF_WIDTH, minY, maxY: minY + CARD_HEIGHT, depth });
const VIEWPORT_OFFENSE = makeViewport(-8.4, OFFENSE_DEPTH);
const VIEWPORT_DEFENSE = makeViewport(-5.4, DEFENSE_DEPTH);

/**
 * The fixed card viewport for a side. It carries the card's depth compression (`viewport.depth`), which <Field>
 * applies to markings and PlayArtLayer to the art, so any field built on it draws like a play card. Returns the same
 * (frozen) object every call, so passing it straight to `<Field viewport>` never resets zoom/pan or re-fits.
 */
export function cardViewport(side: Side | "special" | undefined): FieldViewport {
  return side === "defense" ? VIEWPORT_DEFENSE : VIEWPORT_OFFENSE;
}

/** The card depth scale for a side (what cardViewport(side).depth holds). */
export function cardDepth(side: Side | "special" | undefined): DepthScale {
  return side === "defense" ? DEFENSE_DEPTH : OFFENSE_DEPTH;
}
