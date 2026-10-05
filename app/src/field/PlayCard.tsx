// The in-game play card: flat dark art with the play-type tag (bottom-left), a stat chip (bottom-right) and
// badges (top-right), then an optional leading element (e.g. the audible glyph of a play that has an audible slot)
// + PLAY NAME + FORMATION/SET line underneath. Nothing controller-related renders by default.
import {
  memo,
  useMemo,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { artForPlay } from "../model/art";
import type { Catalog } from "../model/catalog";
import { displayFromLeaf, leaf, playSubtitle } from "../model/names";
import { playTypeInfo } from "../model/playtypes";
import type { PlayArt, ResolvedPlay } from "../model/types";
import { useCatalog } from "../state/library";
import type { BallSpot } from "../state/settings";
import { cardViewport } from "./cardView";
import { Field } from "./Field";
import { PlayArtLayer } from "./PlayArtLayer";
import styles from "./PlayCard.module.css";

export type PlayCardSize = "sm" | "md" | "lg";

export interface PlayCardProps {
  play: ResolvedPlay;
  /** Precomputed art; otherwise artForPlay(catalog, play, { flip }). */
  art?: PlayArt;
  /** Optional element left of the name (e.g. an audible slot glyph, a rank number). Nothing by default. */
  leading?: ReactNode;
  /** Default: "GUN Y TRIPS WK" from the formation and set names. */
  subtitle?: string;
  selected?: boolean;
  size?: PlayCardSize;
  /** Dark chip bottom-right of the art, e.g. "AUD 2 | 3 CPU". */
  stat?: ReactNode;
  /** Extra badges top-right (after the automatic Custom / Needs Mod). */
  badges?: ReactNode;
  /** Automatic Custom / Needs Mod badges (default true). */
  autoBadges?: boolean;
  flip?: boolean;
  ballSpot?: BallSpot;
  /** Faded (e.g. filtered out / not in the book). */
  muted?: boolean;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
  onDoubleClick?: (e: MouseEvent<HTMLDivElement>) => void;
  draggable?: boolean;
  onDragStart?: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: DragEvent<HTMLDivElement>) => void;
  className?: string;
  style?: CSSProperties;
}

export { CARD_ASPECT, cardDepth, cardViewport } from "./cardView";

const EMPTY_ART: PlayArt = { players: [], paths: [], zones: [], bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 }, flipped: false };

/** "GUN Y TRIPS WK" for a play, from the library names when loaded, else from the asset leaves. */
export function cardSubtitle(play: ResolvedPlay, catalog?: Catalog): string {
  const lib = catalog?.lib;
  const formation = lib?.formationByAsset.get(play.formation)?.name ?? displayFromLeaf(leaf(play.formation));
  const set = lib?.setByAsset.get(play.set)?.name ?? displayFromLeaf(leaf(play.set));
  return playSubtitle(formation, set);
}

export const PlayCard = memo(function PlayCard(props: PlayCardProps) {
  const {
    play,
    art,
    leading,
    subtitle,
    selected = false,
    size = "md",
    stat,
    badges,
    autoBadges = true,
    flip = false,
    ballSpot = "middle",
    muted = false,
    onClick,
    onDoubleClick,
    draggable,
    onDragStart,
    onDragEnd,
    className,
    style,
  } = props;
  const catalog = useCatalog();
  const [dragging, setDragging] = useState(false);

  const shownArt = useMemo(() => {
    if (art) return art;
    if (!catalog) return EMPTY_ART;
    try {
      return artForPlay(catalog, play, { flip });
    } catch {
      return EMPTY_ART; // a broken play shouldn't take the grid down; validation reports it
    }
  }, [art, catalog, play, flip]);

  const sub = subtitle ?? cardSubtitle(play, catalog);
  const type = playTypeInfo(play.playType);
  const needsMod = autoBadges && !play.global;
  const custom = autoBadges && play.source === "custom";

  const onKeyDown = onClick
    ? (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        // Keep the global action system from also handling this key; a real click keeps onClick's event type.
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.click();
      }
    : undefined;

  return (
    <div
      className={[styles.card, className].filter(Boolean).join(" ")}
      style={style}
      data-size={size}
      data-selected={selected || undefined}
      data-dragging={dragging || undefined}
      data-muted={muted || undefined}
      data-clickable={onClick ? true : undefined}
      role={onClick ? "button" : undefined}
      aria-pressed={onClick ? selected : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={play.name}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      draggable={draggable}
      onDragStart={
        draggable
          ? (e) => {
              setDragging(true);
              onDragStart?.(e);
            }
          : undefined
      }
      onDragEnd={
        draggable
          ? (e) => {
              setDragging(false);
              onDragEnd?.(e);
            }
          : undefined
      }
    >
      <div className={styles.art}>
        <Field
          viewport={cardViewport(play.side)}
          ballSpot={ballSpot}
          fit="cover"
          className={styles.field}
          label={`${play.name} play art`}
        >
          <PlayArtLayer art={shownArt} compact={size !== "lg"} />
        </Field>
        <span className={styles.tag} style={{ "--tag": type.color } as CSSProperties} title={type.long}>
          {type.label}
        </span>
        {stat !== undefined && stat !== null && stat !== false && <span className={styles.stat}>{stat}</span>}
        {(custom || needsMod || badges) && (
          <span className={styles.badges}>
            {custom && <span className={`${styles.badge} ${styles.custom}`}>Custom</span>}
            {needsMod && (
              <span className={`${styles.badge} ${styles.needsMod}`} title="Not in the global play sheet: needs pbstudio.fbmod">
                Needs Mod
              </span>
            )}
            {badges}
          </span>
        )}
      </div>
      <div className={styles.meta}>
        {leading !== undefined && leading !== null && leading !== false && <span className={styles.leading}>{leading}</span>}
        <span className={styles.text}>
          <span className={styles.name}>{play.name}</span>
          <span className={styles.subtitle}>{sub}</span>
        </span>
      </div>
    </div>
  );
});
