// Alignment-only card for a set (library or custom): flat dark field with the eleven player marks, then the
// set name (caps) and the formation / base line underneath — the play-call card look without routes.
import { memo, type MouseEvent, type ReactNode } from "react";
import { Field, PlayArtLayer } from "../../field";
import { HALF_WIDTH } from "../../model/geometry";
import type { ArtBounds, PlayArt } from "../../model/types";
import { useSettings } from "../../state/settings";
import { PersonnelTag, cx } from "../../ui";
import s from "./SetCard.module.css";

/**
 * Sideline to sideline, centered on the alignment (it lives between y −9 and the LOS). The viewport is wider than any
 * card, so "contain" always shows the full width and grows the depth around the players — same scale on every card,
 * with the eleven sitting in the middle of the art.
 */
export const SET_CARD_ASPECT = 2.5;
const EMPTY_VIEWPORT: ArtBounds = { minX: -HALF_WIDTH, maxX: HALF_WIDTH, minY: -10, maxY: 3 };
const viewports = new WeakMap<PlayArt, ArtBounds>();
function viewportFor(art: PlayArt): ArtBounds {
  let vp = viewports.get(art);
  if (!vp) {
    if (!art.players.length) return EMPTY_VIEWPORT;
    const ys = art.players.map((p) => p.at.y);
    const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
    vp = { minX: -HALF_WIDTH, maxX: HALF_WIDTH, minY: mid - 5, maxY: mid + 5 };
    viewports.set(art, vp);
  }
  return vp;
}

export interface SetCardProps {
  art: PlayArt;
  name: string;
  /** Wrap Madden names (formation / set) in `.caps`; counts and file names stay as written. */
  subtitle?: ReactNode;
  /** Offensive personnel ("11") shown next to the name. */
  personnel?: string;
  selected?: boolean;
  /** Top-right chips (issue counts, Custom…). */
  badges?: ReactNode;
  /** Bottom-left chip on the art. */
  tag?: ReactNode;
  /** Bottom-right chip on the art. */
  stat?: ReactNode;
  /** Top-left of the art (e.g. a ⋯ menu button). */
  corner?: ReactNode;
  muted?: boolean;
  /** Width ÷ height of the art (default SET_CARD_ASPECT; a play card's is CARD_ASPECT). */
  aspect?: number;
  /** Fill the parent's height (grid cells): the art takes whatever is left above the name. */
  fill?: boolean;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
  onDoubleClick?: (e: MouseEvent<HTMLDivElement>) => void;
  onContextMenu?: (e: MouseEvent<HTMLDivElement>) => void;
  className?: string;
}

export const SetCard = memo(function SetCard({ art, name, subtitle, personnel, selected, badges, tag, stat, corner, muted, fill, aspect, onClick, onDoubleClick, onContextMenu, className }: SetCardProps) {
  const ballSpot = useSettings((st) => st.ballSpot);
  return (
    <div
      className={cx(s.card, className)}
      data-selected={selected || undefined}
      data-muted={muted || undefined}
      data-fill={fill || undefined}
      data-clickable={onClick ? true : undefined}
      role={onClick ? "button" : undefined}
      aria-pressed={onClick ? !!selected : undefined}
      title={name}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      <div className={s.art} style={aspect ? { aspectRatio: String(aspect) } : undefined}>
        <Field viewport={viewportFor(art)} ballSpot={ballSpot} className={s.field} label={`${name} alignment`}>
          <PlayArtLayer art={art} compact />
        </Field>
        {tag && <span className={s.tag}>{tag}</span>}
        {stat && <span className={s.stat}>{stat}</span>}
        {badges && <span className={s.badges}>{badges}</span>}
        {corner && <span className={s.corner}>{corner}</span>}
      </div>
      <div className={s.meta}>
        <span className={s.text}>
          <span className={s.name}>{name}</span>
          {subtitle && <span className={s.subtitle}>{subtitle}</span>}
        </span>
        <PersonnelTag code={personnel} />
      </div>
    </div>
  );
});
