// Floating-element placement (tooltips, menus, dropdowns): prefer a side, flip when it doesn't fit, clamp to the
// viewport. Pure so the edge cases are testable.

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type Side = "top" | "bottom" | "left" | "right";
export type Align = "start" | "center" | "end";
export type Placement = Side | `${Side}-${Exclude<Align, "center">}`;

export interface Placed {
  left: number;
  top: number;
  side: Side;
  /** Room left on the chosen side (callers cap their max-height with it). */
  room: number;
}

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

export function splitPlacement(p: Placement): [Side, Align] {
  const [side, align] = p.split("-") as [Side, Align | undefined];
  return [side, align ?? "center"];
}

function roomOn(side: Side, a: RectLike, vw: number, vh: number, gap: number, margin: number): number {
  switch (side) {
    case "top":
      return a.top - gap - margin;
    case "bottom":
      return vh - (a.top + a.height) - gap - margin;
    case "left":
      return a.left - gap - margin;
    case "right":
      return vw - (a.left + a.width) - gap - margin;
  }
}

export function placeFloating(
  anchor: RectLike,
  size: { width: number; height: number },
  placement: Placement,
  viewport: { width: number; height: number },
  gap = 6,
  margin = 8,
): Placed {
  const [preferred, align] = splitPlacement(placement);
  const vertical = preferred === "top" || preferred === "bottom";
  const need = vertical ? size.height : size.width;
  let side = preferred;
  const room = (sd: Side) => roomOn(sd, anchor, viewport.width, viewport.height, gap, margin);
  if (room(side) < need && room(OPPOSITE[side]) > room(side)) side = OPPOSITE[side];

  let left: number;
  let top: number;
  if (vertical) {
    top = side === "bottom" ? anchor.top + anchor.height + gap : anchor.top - gap - size.height;
    left =
      align === "start" ? anchor.left : align === "end" ? anchor.left + anchor.width - size.width : anchor.left + anchor.width / 2 - size.width / 2;
  } else {
    left = side === "right" ? anchor.left + anchor.width + gap : anchor.left - gap - size.width;
    top =
      align === "start" ? anchor.top : align === "end" ? anchor.top + anchor.height - size.height : anchor.top + anchor.height / 2 - size.height / 2;
  }
  left = Math.max(margin, Math.min(left, viewport.width - size.width - margin));
  top = Math.max(margin, Math.min(top, viewport.height - size.height - margin));
  return { left: Math.round(left), top: Math.round(top), side, room: Math.max(0, room(side)) };
}
