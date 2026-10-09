// The play-select screen as Madden 27 draws it. Everything sits on the game's layout (a 2000 × 1125 stage scaled to
// fit) on plain black, and nothing fades: things move to their place.
//   BROWSE  the tab row with its LB / RB hints, the list on the left with its scroll bar, the set bar
//           (‹ SET - 9 PLAYS ›) with the formation's dots under it and KEY PLAYERS to the right, the hint pill.
//   PLAYS   the tab row becomes the formation's sets (or the list's groups), "9 PLAYS" at the right, the play cards
//           three to a row with one row in view and a scroll bar, the hint pill.
// State and key / pad handling live in PlayCallView; this file draws.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type WheelEvent } from "react";
import { Field, PlayArtLayer, cardViewport } from "../../field";
import { Glyph, KeyCap } from "../../input/glyphs";
import { usePadConnected, usePadType } from "../../input/gamepad";
import type { PadButton } from "../../model/audibles";
import { artForPlay } from "../../model/art";
import { playTypeInfo } from "../../model/playtypes";
import { slotLabel } from "../../model/positions";
import type { PlayArt, SetDef } from "../../model/types";
import { useCatalog } from "../../state/library";
import { useSettings } from "../../state/settings";
import { Icon, cx } from "../../ui";
import { FavStar, StatChip, alignmentArt, keyPlayers, sideOfSet } from "./CallTiles";
import { ROWS_VISIBLE, VISIBLE, cardRow, cardRows, listTop, type ScreenState, type View } from "./gameScreenModel";
import { PLAYCALL_TABS, cardStat, type CallPlay, type PlayCallTab } from "./playcallModel";
import s from "./GameScreen.module.css";

const STAGE_W = 2000;
const STAGE_H = 1125;
const ROW_PITCH = 68;
/** Plays screen: one row of cards (art + name) and the gap to the next row. */
const CARD_ROW_PITCH = 380;
const CARD_W = 580;
const CARD_GAP = 50;

export interface HintItem {
  id: string;
  label: string;
  pad: PadButton[];
  key?: string;
  onClick(): void;
}

export interface GameScreenProps {
  bookName: string;
  defense: boolean;
  st: ScreenState;
  view: View;
  flip: boolean;
  favorites: ReadonlySet<string>;
  hints: HintItem[];
  onTab(tab: PlayCallTab): void;
  onRow(row: number): void;
  onSetStep(delta: 1 | -1): void;
  onOpenSet(): void;
  onCard(index: number): void;
  /** Plays screen: pick one of its tabs (a set of the formation / a group of the list). */
  onGroup(index: number): void;
  onBack(): void;
  onToggleFavorite(item: CallPlay): void;
  /** Wheel: a step along what the pointer is over (the formation list, else the cards / set bar). */
  onWheelStep(delta: 1 | -1, zone: "list" | "cards" | "other"): void;
}

export function GameScreen(p: GameScreenProps) {
  const { st, view } = p;
  const vp = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = vp.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      setScale(Math.min(r.width / STAGE_W, r.height / STAGE_H));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // list scroll position (a row at a time)
  const top = useRef(0);
  top.current = listTop(top.current, view.row, view.rows.length);

  const wheel = useRef({ acc: 0 });
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    wheel.current.acc += e.deltaY;
    if (Math.abs(wheel.current.acc) < 60) return;
    const d = Math.sign(wheel.current.acc) as 1 | -1;
    wheel.current.acc = 0;
    const el = e.target as Element;
    p.onWheelStep(d, el.closest("[data-list]") ? "list" : el.closest("[data-cards]") ? "cards" : "other");
  };

  return (
    <div ref={vp} className={s.viewport} onWheel={onWheel}>
      <div className={s.stage} style={{ transform: `translate(-50%, -50%) scale(${scale || 0.01})`, visibility: scale ? "visible" : "hidden" }}>
        {view.showCards ? (
          <>
            {view.groups.length ? <GroupTabs view={view} onGroup={p.onGroup} /> : <Tabs tab={st.tab} onTab={p.onTab} />}
            <div className={s.count}>
              {view.cards.length} {view.cards.length === 1 ? "Play" : "Plays"}
            </div>
            <Cards view={view} st={st} flip={p.flip} favorites={p.favorites} onCard={p.onCard} onToggleFavorite={p.onToggleFavorite} />
          </>
        ) : (
          <>
            <Tabs tab={st.tab} onTab={p.onTab} />
            {view.hasList && <List view={view} top={top.current} onRow={p.onRow} />}
            <Bar view={view} onStep={p.onSetStep} onOpen={p.onOpenSet} />
            {view.set?.set ? <Dots set={view.set.set} flip={p.flip} onOpen={p.onOpenSet} /> : <GroupPreview item={view.cards[0]} flip={p.flip} onOpen={p.onOpenSet} />}
            {view.set?.set && <KeyPlayers set={view.set.set} flip={p.flip} />}
          </>
        )}
        <Hints items={p.hints} />
      </div>
    </div>
  );
}

// ───────────────────────────── tabs ─────────────────────────────

function useCap() {
  const pad = usePadConnected();
  const type = usePadType();
  return (pb: PadButton, key: string): ReactNode => (pad ? <Glyph button={pb} mode={type} size="md" /> : <KeyCap label={key} />);
}

function Tabs({ tab, onTab }: { tab: PlayCallTab; onTab(t: PlayCallTab): void }) {
  const cap = useCap();
  return (
    <div className={s.tabs} role="tablist" aria-label="Play call">
      <span className={s.tabKey}>{cap("LB", "PgUp")}</span>
      {PLAYCALL_TABS.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={t.id === tab} className={cx(s.tab, t.id === tab && s.tabOn)} onClick={() => onTab(t.id)}>
          {t.label}
        </button>
      ))}
      <span className={s.tabKey}>{cap("RB", "PgDn")}</span>
    </div>
  );
}

/** The plays screen's tab row: the formation's sets (or the list's groups). Keeps the selected one in view. */
function GroupTabs({ view, onGroup }: { view: View; onGroup(i: number): void }) {
  const cap = useCap();
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = row.current;
    const el = box?.querySelector<HTMLElement>("[aria-selected=true]");
    if (!box || !el) return;
    if (el.offsetLeft < box.scrollLeft) box.scrollLeft = el.offsetLeft;
    else if (el.offsetLeft + el.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollLeft = el.offsetLeft + el.offsetWidth - box.clientWidth;
  }, [view.groupIndex]);
  return (
    <div className={s.tabs} role="tablist" aria-label="Sets">
      <span className={s.tabKey}>{cap("LB", "PgUp")}</span>
      <div ref={row} className={s.groupTabs}>
        {view.groups.map((g, i) => (
          <button key={g.id} type="button" role="tab" aria-selected={i === view.groupIndex} className={cx(s.tab, i === view.groupIndex && s.tabOn)} onClick={() => onGroup(i)}>
            {g.label}
          </button>
        ))}
      </div>
      <span className={s.tabKey}>{cap("RB", "PgDn")}</span>
    </div>
  );
}

// ───────────────────────────── browse: left list ─────────────────────────────

function List({ view, top, onRow }: { view: View; top: number; onRow(i: number): void }) {
  const n = view.rows.length;
  const track = 322;
  const thumbH = n <= ROWS_VISIBLE ? track : (track * ROWS_VISIBLE) / n;
  const thumbTop = n <= ROWS_VISIBLE ? 0 : ((track - thumbH) * top) / (n - ROWS_VISIBLE);
  return (
    <>
      <div className={s.list} data-list>
        <div className={s.listInner} style={{ transform: `translateY(${-top * ROW_PITCH}px)` }}>
          {view.rows.map((r, i) => (
            <button
              key={r.id}
              type="button"
              className={cx(s.row, i === view.row && s.rowOn, r.locked && s.rowLocked)}
              style={{ top: i * ROW_PITCH }}
              onClick={() => onRow(i)}
              aria-pressed={i === view.row}
            >
              <span className={s.rowName}>{r.name}</span>
              <span className={cx(s.rowStat, s.rowStat1)}>
                <b>{r.stats[0].value}</b>
                <i>{r.stats[0].label}</i>
              </span>
              <span className={cx(s.rowStat, s.rowStat2)}>
                {r.stats[1].label ? (
                  <>
                    <b>{r.stats[1].value}</b>
                    <i>{r.stats[1].label}</i>
                  </>
                ) : (
                  <i>{r.stats[1].value}</i>
                )}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className={s.scroll} aria-hidden>
        <div className={s.thumb} style={{ height: thumbH, top: thumbTop }} />
      </div>
    </>
  );
}

// ───────────────────────────── browse: set bar, dots, key players ─────────────────────────────

function Bar({ view, onStep, onOpen }: { view: View; onStep(d: 1 | -1): void; onOpen(): void }) {
  const text = view.bar.sub ? `${view.bar.label} - ${view.bar.sub}` : view.bar.label;
  const sets = view.bar.kind === "sets";
  return (
    <div className={s.setbar}>
      {sets && (
        <button type="button" className={s.arr} aria-label="Previous set" onClick={() => onStep(-1)} disabled={view.sets.length < 2}>
          <Icon name="chevronLeft" size={26} />
        </button>
      )}
      <button type="button" className={s.barName} onClick={onOpen}>
        {text}
      </button>
      {sets && (
        <button type="button" className={s.arr} aria-label="Next set" onClick={() => onStep(1)} disabled={view.sets.length < 2}>
          <Icon name="chevronRight" size={26} />
        </button>
      )}
    </div>
  );
}

/**
 * Field yards → px inside the dots box (the ball at the top middle). The game's camera spreads the line out (~22 px per
 * yard across) and flattens depth; wide sets shrink to fit ±300 px.
 */
const DOT_PPY = 22;
const DOT_DEPTH = 0.62;
const DOT_BOX = { w: 595, h: 270, losY: 44 };

/** The set's alignment as the game shows it under the set bar: navy discs with the player's position on them. */
function Dots({ set, flip, onOpen }: { set: SetDef; flip: boolean; onOpen(): void }) {
  const catalog = useCatalog();
  const side = sideOfSet(catalog, set);
  const art = useMemo(() => alignmentArt(set, side, flip && set.canFlip), [set, side, flip]);
  // Scale down for very wide or deep sets so every disc stays in the box.
  const maxX = Math.max(10, ...art.players.map((pl) => Math.abs(pl.at.x)));
  const maxD = Math.max(5, ...art.players.map((pl) => -pl.at.y));
  const k = Math.min(DOT_PPY, 300 / maxX, (DOT_BOX.h - DOT_BOX.losY - 24) / (maxD * DOT_DEPTH));
  return (
    <button type="button" className={s.dots} onClick={onOpen} title="Open the plays">
      {art.players.map((pl) => (
        <span key={pl.slot} className={s.dot} style={{ left: DOT_BOX.w / 2 + pl.at.x * k, top: DOT_BOX.losY - pl.at.y * k * DOT_DEPTH }}>
          {slotLabel(pl.pos, pl.depth).replace(/^(LT|LG|C|RG|RT)$/, "OL")}
        </span>
      ))}
    </button>
  );
}

/** Group tabs (concept, play type, personnel) have no formation: show the group's first play instead. */
function GroupPreview({ item, flip, onOpen }: { item?: CallPlay; flip: boolean; onOpen(): void }) {
  const catalog = useCatalog();
  const ballSpot = useSettings((x) => x.ballSpot);
  const play = item?.play;
  const art = useMemo(() => {
    if (!catalog || !play) return undefined;
    try {
      return artForPlay(catalog, play, { flip: flip && play.canFlip });
    } catch {
      return undefined;
    }
  }, [catalog, play, flip]);
  if (!play || !art) return null;
  return (
    <button type="button" className={s.preview} onClick={onOpen} title="Open the plays">
      <Field viewport={cardViewport(play.side)} ballSpot={ballSpot} fit="cover" className={s.previewField} markings="minimal">
        <PlayArtLayer art={art} compact />
      </Field>
      <span className={s.previewName}>{play.name}</span>
    </button>
  );
}

function KeyPlayers({ set, flip }: { set: SetDef; flip: boolean }) {
  const catalog = useCatalog();
  const list = useMemo(() => keyPlayers(set, catalog ? sideOfSet(catalog, set) : undefined, flip), [set, catalog, flip]);
  if (!list.length) return null;
  return (
    <div className={s.keyp}>
      <h2>Key Players</h2>
      {list.map((k, i) => (
        <div key={k.slot} className={s.kp}>
          {i === 0 && (
            <span className={s.kpIcon}>
              <Icon name="star" size={26} />
            </span>
          )}
          <b>{k.label}</b>
          <i>Slot {k.slot}</i>
        </div>
      ))}
    </div>
  );
}

// ───────────────────────────── plays: the cards ─────────────────────────────

const EMPTY_ART: PlayArt = { players: [], paths: [], zones: [], bounds: { minX: -10, maxX: 10, minY: -8, maxY: 12 }, flipped: false };

function Cards({
  view,
  st,
  flip,
  favorites,
  onCard,
  onToggleFavorite,
}: {
  view: View;
  st: ScreenState;
  flip: boolean;
  favorites: ReadonlySet<string>;
  onCard(i: number): void;
  onToggleFavorite(item: CallPlay): void;
}) {
  const n = view.cards.length;
  if (!n) {
    return (
      <div className={s.cards} data-cards>
        <div className={s.empty}>{view.bar.kind === "sets" ? "Nothing to show for this set" : "No plays here yet"}</div>
      </div>
    );
  }
  const row = cardRow(st.play);
  const rows = cardRows(n);
  // Only the row in view and its neighbours get art (the rest are off screen).
  const near = (i: number) => Math.abs(cardRow(i) - row) <= 1;
  const track = 330;
  const thumbH = track / rows;
  return (
    <>
      <div className={s.cards} data-cards>
        <div className={s.cardsInner} style={{ transform: `translateY(${-row * CARD_ROW_PITCH}px)` }}>
          {view.cards.map((item, i) => (
            <div
              key={item.id}
              className={cx(s.card, i === st.play && s.cardOn)}
              style={{ left: (i % VISIBLE) * (CARD_W + CARD_GAP), top: cardRow(i) * CARD_ROW_PITCH }}
              onClick={() => onCard(i)}
            >
              <GameCard item={item} col={i % VISIBLE} flip={flip} favorite={!!item.play && favorites.has(item.play.key)} mounted={near(i)} onToggleFavorite={onToggleFavorite} />
            </div>
          ))}
        </div>
      </div>
      {rows > 1 && (
        <div className={s.cardScroll} aria-hidden>
          <div className={s.thumb} style={{ height: thumbH, top: row * thumbH }} />
        </div>
      )}
    </>
  );
}

/** The game's play card: dark field art with the type tag and a stat chip, then the audible glyph, NAME and set line. */
/** The game calls the left / middle / right play of a row with X / A / Y (keyboard W / Space / Q). */
const COLUMN_PAD: PadButton[] = ["X", "A", "Y"];
const COLUMN_KEY = ["W", "␣", "Q"];

function GameCard({ item, col, flip, favorite, mounted, onToggleFavorite }: { item: CallPlay; col: number; flip: boolean; favorite: boolean; mounted: boolean; onToggleFavorite(item: CallPlay): void }) {
  const catalog = useCatalog();
  const ballSpot = useSettings((x) => x.ballSpot);
  const pad = usePadConnected();
  const padType = usePadType();
  const play = item.play;
  const art = useMemo(() => {
    if (!mounted || !catalog || !play) return EMPTY_ART;
    try {
      return artForPlay(catalog, play, { flip: flip && play.canFlip });
    } catch {
      return EMPTY_ART;
    }
  }, [mounted, catalog, play, flip]);
  const info = play ? playTypeInfo(play.playType) : undefined;
  const stat = cardStat(item);
  return (
    <>
      <div className={s.cardArt}>
        {play && mounted ? (
          <Field viewport={cardViewport(play.side)} ballSpot={ballSpot} fit="cover" firstDown={play.side === "defense" ? undefined : 10} className={s.cardField} label={`${play.name} play art`}>
            <PlayArtLayer art={art} compact />
          </Field>
        ) : !play ? (
          <div className={s.missing} title={item.problem}>
            <Icon name="warning" size={26} />
            <b>Play not found</b>
          </div>
        ) : null}
        {info && (
          <span className={s.cardTag} style={{ "--tag": info.color } as CSSProperties}>
            {info.label}
          </span>
        )}
        {stat && (
          <span className={s.cardStat}>
            <StatChip stat={stat} />
          </span>
        )}
        {play && (
          <span className={s.cardStar}>
            <FavStar on={favorite} onToggle={() => onToggleFavorite(item)} size={22} />
          </span>
        )}
      </div>
      <div className={s.cardMeta}>
        <span className={s.cardGlyph}>{pad ? <Glyph button={COLUMN_PAD[col]} mode={padType} size="md" /> : <KeyCap label={COLUMN_KEY[col]} />}</span>
        <span className={s.cardText}>
          <b>{item.name || "(unnamed)"}</b>
          <i>{item.subtitle}</i>
        </span>
      </div>
    </>
  );
}

// ───────────────────────────── bottom hints ─────────────────────────────

function Hints({ items }: { items: HintItem[] }) {
  const pad = usePadConnected();
  const type = usePadType();
  return (
    <div className={s.hints}>
      {items.map((h) => (
        <button key={h.id} type="button" className={s.hint} onClick={h.onClick}>
          {pad ? <Glyph buttons={h.pad} mode={type} size="md" /> : h.key ? <KeyCap label={h.key} /> : null}
          <span>{h.label}</span>
        </button>
      ))}
    </div>
  );
}
