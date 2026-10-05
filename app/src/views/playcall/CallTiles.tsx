// Play-call cards: formation / set / group tiles shaped like the in-game play card (art + NAME + gray line), the play
// card wrapper (PlayCard + stat chip + favorite star) and the placeholder for unresolved entries.
// Template sections (read from the template save) carry a "From Template" badge. Names (formation / set / play) are in
// caps; concept group names show as typed. Art is only computed for mounted tiles (3 per page).
import { memo, useMemo, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Field, PlayArtLayer, PlayCard, cardViewport } from "../../field";
import { AudibleGlyph } from "../../input/glyphs";
import { artForPlay, computeArt, withFlipPartners } from "../../model/art";
import type { Catalog } from "../../model/catalog";
import { HALF_WIDTH } from "../../model/geometry";
import { formationShort } from "../../model/names";
import { playTypeInfo } from "../../model/playtypes";
import type { ArtBounds, PlayArt, SetDef, Side } from "../../model/types";
import { useCatalog } from "../../state/library";
import { useSettings, type BallSpot } from "../../state/settings";
import { useTemplate } from "../../state/template";
import { Icon, Spinner, cx } from "../../ui";
import { cardStat, formationSummary, type CallFormation, type CallGroup, type CallPlay, type CallSet, type CardStat } from "./playcallModel";
import s from "./PlayCall.module.css";

// ───────────────────────────── alignment art ─────────────────────────────

const alignmentCache = new WeakMap<SetDef, Map<string, PlayArt>>();

/** Players only (no routes) at the set's Normal alignment; memoized per set + side + flip. */
export function alignmentArt(set: SetDef, side: Side | undefined, flip: boolean): PlayArt {
  let m = alignmentCache.get(set);
  if (!m) alignmentCache.set(set, (m = new Map()));
  const key = `${side ?? ""}|${flip ? 1 : 0}`;
  let art = m.get(key);
  if (!art) {
    // Flipped: who stands on each mirrored spot follows the set's flipAssign partners, like artForPlay.
    art = withFlipPartners(computeArt(set, [], { side, flip }), set);
    m.set(key, art);
  }
  return art;
}

// Stable viewport objects: a new viewport value makes <Field> re-fit.
const VIEWPORT_OFFENSE = cardViewport("offense");
const VIEWPORT_DEFENSE = cardViewport("defense");

const viewportCache = new WeakMap<PlayArt, ArtBounds>();

/**
 * Alignment tiles have no routes: frame the 11 players (card aspect) so they read big. Wide enough for the widest
 * split and tall enough for the deepest player — kickoff / safety-kick sets spread their coverage team 25–40 yd
 * from the kicker, so those frames get taller (and wider, to keep the aspect).
 */
function alignmentViewport(art: PlayArt): ArtBounds {
  let v = viewportCache.get(art);
  if (v) return v;
  let maxAbs = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of art.players) {
    maxAbs = Math.max(maxAbs, Math.abs(p.at.x));
    minY = Math.min(minY, p.at.y);
    maxY = Math.max(maxY, p.at.y);
  }
  if (!art.players.length) return VIEWPORT_OFFENSE;
  const span = maxY - minY;
  const width = Math.max(30, Math.min(2 * HALF_WIDTH, 2 * maxAbs + 9), (span + 7) * 2.15);
  const height = width / 2.15;
  const defense = art.players[0]?.side === "defense";
  // Show a little more field in front of the players (upfield for offense, toward the LOS for defense) when the
  // frame has room to spare.
  const spare = Math.max(0, height - span - 7);
  const bias = Math.max(-spare / 2, Math.min(spare / 2, (defense ? -0.1 : 0.12) * height));
  const cy = (minY + maxY) / 2 + bias;
  v = { minX: -width / 2, maxX: width / 2, minY: cy - height / 2, maxY: cy + height / 2 };
  viewportCache.set(art, v);
  return v;
}

function sideOfSet(catalog: Catalog | undefined, set: SetDef | undefined): Side | undefined {
  const f = set && catalog?.lib.formationOfSet(set.asset);
  const side = f ? catalog!.lib.formationSide(f) : undefined;
  return side === "special" ? undefined : side;
}

// ───────────────────────────── generic tile ─────────────────────────────

interface TileProps {
  art?: ReactNode;
  /** Centered over the art (locked / missing states). */
  overlay?: ReactNode;
  glyph?: ReactNode;
  name: string;
  /** Name in caps (formation / set / play / play-type names); false for text shown as written (concept names, "No Audible"). */
  nameCaps?: boolean;
  sub: ReactNode;
  tag?: { label: string; color: string };
  stat?: ReactNode;
  badges?: ReactNode;
  accent?: string;
  selected?: boolean;
  locked?: boolean;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
  title?: string;
}

function onKeyActivate(e: KeyboardEvent<HTMLDivElement>) {
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.click();
}

const Tile = memo(function Tile(p: TileProps) {
  return (
    <div
      className={s.tile}
      role="button"
      tabIndex={0}
      title={p.title ?? p.name}
      data-selected={p.selected || undefined}
      data-locked={p.locked || undefined}
      style={p.accent ? ({ "--accent": p.accent } as CSSProperties) : undefined}
      onClick={p.onClick}
      onKeyDown={onKeyActivate}
    >
      <div className={s.tileArt}>
        {p.art}
        {p.accent && <span className={s.tileAccent} />}
        {p.overlay && <div className={s.tileOverlay}>{p.overlay}</div>}
        {p.tag && (
          <span className={s.tileTag} style={{ "--tag": p.tag.color } as CSSProperties}>
            {p.tag.label}
          </span>
        )}
        {p.stat && <span className={s.tileStat}>{p.stat}</span>}
        {p.badges && <span className={s.tileBadges}>{p.badges}</span>}
      </div>
      <div className={s.tileMeta}>
        {p.glyph && <span className={s.tileGlyph}>{p.glyph}</span>}
        <span className={s.tileText}>
          <span className={cx(s.tileName, p.nameCaps !== false && "caps")}>{p.name}</span>
          <span className={s.tileSub}>{p.sub}</span>
        </span>
      </div>
    </div>
  );
});

function ArtField({ art, side, ballSpot, label, tight }: { art: PlayArt; side: Side | "special" | undefined; ballSpot: BallSpot; label: string; tight?: boolean }) {
  const viewport = tight ? alignmentViewport(art) : side === "defense" ? VIEWPORT_DEFENSE : VIEWPORT_OFFENSE;
  return (
    <Field viewport={viewport} ballSpot={ballSpot} fit="cover" className={s.tileField} label={label}>
      <PlayArtLayer art={art} />
    </Field>
  );
}

function EmptyField({ ballSpot }: { ballSpot: BallSpot }) {
  return <Field viewport={VIEWPORT_OFFENSE} ballSpot={ballSpot} fit="cover" className={s.tileField} markings="minimal" />;
}

// ───────────────────────────── formation / set tiles ─────────────────────────────

interface CommonTileProps {
  glyph?: ReactNode;
  selected?: boolean;
  flip: boolean;
  onClick(): void;
}

/** Small badge on template-section cards (their sets/plays come from the template save; read-only here). */
export function TemplateBadge() {
  return (
    <span className={s.tplBadge} title={'From a "sets": "template" section: copied from the template save by the game-side builder (read-only here)'}>
      <Icon name="lock" size={11} />
     From Template
    </span>
  );
}

/** Why a template section has nothing to copy (the game-side builder stops on it). */
export function missingTemplateText(f: CallFormation): string {
  return `The template save has no ${f.name} sets, so the export stops on this section. In the playbook, list ${f.name}'s sets explicitly or remove the section.`;
}

/** Overlay for a template section whose contents aren't available (loading / unreadable save / not in the save). */
function TemplateOverlay({ f }: { f: CallFormation }) {
  const template = useTemplate();
  if (f.templateState === "missing") return <MissingOverlay title="Not in the Template Save" body={missingTemplateText(f)} />;
  if (template.status === "error") return <MissingOverlay title="Template Save Unreadable" body={template.error} />;
  return (
    <>
      <Spinner size={22} />
      <span className={s.overlayTitle}>Loading Template…</span>
      <span className={s.overlayBody}>Reading the template save for this section's sets and plays</span>
    </>
  );
}

export const FormationTile = memo(function FormationTile({ f, ...p }: CommonTileProps & { f: CallFormation }) {
  const catalog = useCatalog();
  const ballSpot = useSettings((st) => st.ballSpot);
  const first = f.sets.find((x) => x.set)?.set;
  const side = sideOfSet(catalog, first);
  const art = useMemo(() => (first ? alignmentArt(first, side, p.flip && first.canFlip) : undefined), [first, side, p.flip]);
  const closedTemplate = f.template && f.templateState !== "ready";

  return (
    <Tile
      art={art ? <ArtField art={art} side={side} ballSpot={ballSpot} label={`${f.name} alignment`} tight /> : <EmptyField ballSpot={ballSpot} />}
      overlay={
        f.problem ? (
          <MissingOverlay title="Unknown Formation" body={f.problem} />
        ) : closedTemplate ? (
          <TemplateOverlay f={f} />
        ) : !first ? (
          <MissingOverlay title="No Sets" body={f.template ? "The template save has no sets for this formation" : "Add sets in the playbook builder"} quiet />
        ) : undefined
      }
      badges={f.template ? <TemplateBadge /> : undefined}
      glyph={p.glyph}
      name={f.name}
      sub={formationSummary(f)}
      locked={closedTemplate}
      selected={p.selected}
      onClick={p.onClick}
      title={f.template ? `${f.name}: "sets": "template" — contents come from the template save` : undefined}
    />
  );
});

export const SetTile = memo(function SetTile({ set, ...p }: CommonTileProps & { set: CallSet }) {
  const catalog = useCatalog();
  const ballSpot = useSettings((st) => st.ballSpot);
  const side = sideOfSet(catalog, set.set);
  const art = useMemo(() => (set.set ? alignmentArt(set.set, side, p.flip && set.set.canFlip) : undefined), [set.set, side, p.flip]);
  const n = set.plays.length;
  const aud = Object.keys(set.audibles).length;
  return (
    <Tile
      art={art ? <ArtField art={art} side={side} ballSpot={ballSpot} label={`${set.name} alignment`} tight /> : <EmptyField ballSpot={ballSpot} />}
      overlay={set.problem ? <MissingOverlay title="Unknown Set" body={set.problem} /> : undefined}
      glyph={p.glyph}
      name={set.name}
      sub={`${formationShort(set.formationName)} · ${n} play${n === 1 ? "" : "s"}`}
      stat={aud ? `${aud} AUD` : undefined}
      badges={set.template ? <TemplateBadge /> : undefined}
      selected={p.selected}
      onClick={p.onClick}
    />
  );
});

// ───────────────────────────── group tiles ─────────────────────────────

/** A concept / play-type group, previewed by its first play (that play's art, type tag and name chip). */
export const GroupTile = memo(function GroupTile({ group, nameCaps, ...p }: CommonTileProps & { group: CallGroup; nameCaps?: boolean }) {
  const catalog = useCatalog();
  const ballSpot = useSettings((st) => st.ballSpot);
  const lead = group.items.find((i) => i.play)?.play;
  const art = useMemo(() => {
    if (!catalog || !lead) return undefined;
    try {
      return artForPlay(catalog, lead, { flip: p.flip && lead.canFlip });
    } catch {
      return undefined;
    }
  }, [catalog, lead, p.flip]);
  const n = group.items.length;
  return (
    <Tile
      art={art && lead ? <ArtField art={art} side={lead.side} ballSpot={ballSpot} label={`${group.label}: ${lead.name}`} /> : <EmptyField ballSpot={ballSpot} />}
      glyph={p.glyph}
      name={group.label}
      nameCaps={nameCaps}
      sub={`${group.eyebrow ? `${group.eyebrow} · ` : ""}${n} play${n === 1 ? "" : "s"}`}
      tag={lead ? { label: playTypeInfo(lead.playType).label, color: playTypeInfo(lead.playType).color } : undefined}
      stat={lead ? <span className={s.statName}>{lead.name}</span> : undefined}
      accent={group.color}
      selected={p.selected}
      onClick={p.onClick}
    />
  );
});

// ───────────────────────────── plays ─────────────────────────────

function MissingOverlay({ title, body, quiet }: { title: string; body?: string; quiet?: boolean }) {
  return (
    <>
      <Icon name={quiet ? "info" : "warning"} size={24} className={quiet ? undefined : s.overlayWarn} />
      <span className={s.overlayTitle}>{title}</span>
      {body && <span className={s.overlayBody}>{body}</span>}
    </>
  );
}

export function FavStar({ on, onToggle, size = 16 }: { on: boolean; onToggle(): void; size?: number }) {
  return (
    <button
      type="button"
      className={cx(s.star, on && s.starOn)}
      title={on ? "Remove from favorites" : "Add to favorites"}
      aria-pressed={on}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <Icon name={on ? "starFilled" : "star"} size={size} />
    </button>
  );
}

/** The card's dark stat chip: the audible as its glyph (settings.audibleStyle) + category ([A] RUN), then the CPU-weight count. */
export function StatChip({ stat }: { stat: CardStat }) {
  return (
    <span className={s.statChip}>
      {stat.audible && (
        <span className={s.statAud} title={`Audible ${stat.audible}: ${stat.audibleLabel}`}>
          <AudibleGlyph slot={stat.audible} size="sm" />
          {stat.audibleLabel}
        </span>
      )}
      {stat.audible && stat.cpu && <span className={s.statSep}>|</span>}
      {stat.cpu && <span>{stat.cpu}</span>}
    </span>
  );
}

export interface PlaySlotProps {
  item: CallPlay;
  glyph?: ReactNode;
  selected?: boolean;
  flip: boolean;
  favorite: boolean;
  size?: "md" | "lg";
  subtitle?: string;
  onOpen(item: CallPlay): void;
  onToggleFavorite(item: CallPlay): void;
}

/** A play on a page: the shared PlayCard (art only computed here, for visible cards) or a placeholder. */
export const PlaySlot = memo(function PlaySlot({ item, glyph, selected, flip, favorite, size = "lg", subtitle, onOpen, onToggleFavorite }: PlaySlotProps) {
  const ballSpot = useSettings((st) => st.ballSpot);
  const play = item.play;
  const stat = cardStat(item);
  if (!play) {
    return (
      <Tile
        art={<EmptyField ballSpot={ballSpot} />}
        overlay={<MissingOverlay title="Play Not Found" body={item.problem} />}
        glyph={glyph}
        name={item.name || "(unnamed)"}
        sub={subtitle ?? item.subtitle}
        selected={selected}
        locked
        onClick={() => onOpen(item)}
      />
    );
  }
  return (
    <div className={s.playSlot}>
      <PlayCard
        play={play}
        size={size}
        leading={glyph}
        subtitle={subtitle ?? item.subtitle}
        selected={selected}
        flip={flip && play.canFlip}
        ballSpot={ballSpot}
        stat={stat ? <StatChip stat={stat} /> : undefined}
        badges={
          <>
            {item.template && <TemplateBadge />}
            <FavStar on={favorite} onToggle={() => onToggleFavorite(item)} size={size === "lg" ? 16 : 14} />
          </>
        }
        className={cx(s.callCard, favorite && s.callCardFav)}
        onClick={() => onOpen(item)}
      />
    </div>
  );
});

/** Ghost card for an empty audible slot. */
export function EmptySlot({ glyph, label, sub }: { glyph?: ReactNode; label: string; sub: string }) {
  return (
    <div className={s.emptySlot}>
      <div className={s.emptySlotArt}>
        <span>{label}</span>
      </div>
      <div className={s.tileMeta}>
        {glyph && <span className={cx(s.tileGlyph, s.dimGlyph)}>{glyph}</span>}
        <span className={s.tileText}>
          <span className={cx(s.tileName, s.emptyName)}>No Audible</span>
          <span className={s.tileSub}>{sub}</span>
        </span>
      </div>
    </div>
  );
}
