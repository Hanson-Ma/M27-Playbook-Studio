// The play-select screen as Madden 27 draws it, in this app's style. Everything sits on the game's 1920-ish layout (a
// 2000 × 1125 stage scaled to fit): the tab row with its LB / RB hints, the formation list on the left with its scroll
// bar, the set bar (‹ SET - 9 plays ›) with the formation dots under it and KEY PLAYERS to the right, the play cards
// as a vertical column on the right (three and a peek visible, scrolled a card at a time) and the hint pill at the
// bottom. A big field above shows what is selected.
// State and key / pad handling live in PlayCallView; this file draws.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type WheelEvent } from "react";
import { Field, PlayArtLayer, PlayCard, cardViewport } from "../../field";
import { AudibleGlyph } from "../../input/glyphs";
import { Glyph } from "../../input/glyphs";
import { KeyCap } from "../../input/glyphs";
import { usePadConnected, usePadType } from "../../input/gamepad";
import type { PadButton } from "../../model/audibles";
import { artForPlay } from "../../model/art";
import { playTypeInfo } from "../../model/playtypes";
import type { PlayArt, ResolvedPlay } from "../../model/types";
import { useCatalog } from "../../state/library";
import { useSettings } from "../../state/settings";
import { Icon, cx } from "../../ui";
import { AlignmentField, FavStar, StatChip, keyPlayers, sideOfSet } from "./CallTiles";
import { AUDIBLE_CATEGORY } from "../../model/audibles";
import { ROWS_VISIBLE, cardsFocused, cardsTop, listTop, type ScreenState, type View } from "./gameScreenModel";
import { PLAYCALL_TABS, cardStat, cpuRows, type CallPlay, type PlayCallTab } from "./playcallModel";
import s from "./GameScreen.module.css";

const STAGE_W = 2000;
const STAGE_H = 1125;
const ROW_PITCH = 68;
/** A card in the column: the card (262 tall) plus the gap to the next one. */
const CARD_PITCH = 286;

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
  onToggleFavorite(item: CallPlay): void;
  /** Wheel: a step along what the pointer is over (the formation list, the card column, else the set bar). */
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

  // list + card scroll positions (a row / card at a time)
  const top = useRef(0);
  top.current = listTop(top.current, view.row, view.rows.length);
  const cardTop = useRef(0);
  const cardsKey = `${st.tab}|${view.row}|${view.setIndex}`;
  const lastKey = useRef(cardsKey);
  if (lastKey.current !== cardsKey) {
    lastKey.current = cardsKey;
    cardTop.current = 0;
  }
  cardTop.current = cardsTop(cardTop.current, st.play, view.cards.length);

  const wheel = useRef({ acc: 0 });
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    wheel.current.acc += e.deltaY;
    if (Math.abs(wheel.current.acc) < 60) return;
    const d = Math.sign(wheel.current.acc) as 1 | -1;
    wheel.current.acc = 0;
    const el = e.target as Element;
    p.onWheelStep(d, el.closest("[data-list]") ? "list" : el.closest("[data-cards]") ? "cards" : "other");
  };

  const selected = view.showCards ? view.cards[st.play] : undefined;
  return (
    <div ref={vp} className={s.viewport} onWheel={onWheel}>
      <div className={s.stage} style={{ transform: `translate(-50%, -50%) scale(${scale || 0.01})`, opacity: scale ? 1 : 0 }}>
        <Backdrop view={view} selected={selected} flip={p.flip} defense={p.defense} />
        <div className={s.vlabel}>{p.bookName} / Select a Play</div>
        <Tabs tab={st.tab} onTab={p.onTab} />
        {view.hasList && <List view={view} top={top.current} onRow={p.onRow} />}
        <Bar view={view} onStep={p.onSetStep} onOpen={p.onOpenSet} showCards={view.showCards} />
        {!view.showCards && view.set?.set && <Dots view={view} flip={p.flip} onOpen={p.onOpenSet} />}
        {!view.showCards && view.set?.set && <KeyPlayers view={view} flip={p.flip} />}
        {view.showCards && <PlayInfo item={selected} />}
        {view.showCards && (
          <Cards view={view} st={st} top={cardTop.current} flip={p.flip} favorites={p.favorites} onCard={p.onCard} onToggleFavorite={p.onToggleFavorite} />
        )}
        <Hints items={p.hints} />
      </div>
    </div>
  );
}

// ───────────────────────────── backdrop (the field up top) ─────────────────────────────

const EMPTY: PlayArt = { players: [], paths: [], zones: [], bounds: { minX: -10, maxX: 10, minY: -8, maxY: 12 }, flipped: false };

/** The big field above the lists: the selected play's art, else the selected set's alignment. */
function Backdrop({ view, selected, flip, defense }: { view: View; selected?: CallPlay; flip: boolean; defense: boolean }) {
  const catalog = useCatalog();
  const ballSpot = useSettings((st) => st.ballSpot);
  const showPassPro = useSettings((st) => st.showPassPro);
  const play: ResolvedPlay | undefined = selected?.play;
  const art = useMemo(() => {
    if (!catalog || !play) return EMPTY;
    try {
      return artForPlay(catalog, play, { flip: flip && play.canFlip, showPassPro });
    } catch {
      return EMPTY;
    }
  }, [catalog, play, flip, showPassPro]);
  const set = view.set?.set;
  const side = catalog && set ? sideOfSet(catalog, set) : undefined;
  if (play) {
    return (
      <div className={cx(s.backdrop, view.showCards && s.backdropNarrow)}>
        <Field viewport={cardViewport(play.side)} ballSpot={ballSpot} fit="contain" firstDown={defense ? undefined : 10} className={s.backField} label={`${play.name} on the field`}>
          <PlayArtLayer art={art} showLabels />
        </Field>
      </div>
    );
  }
  if (set && !view.showCards) {
    return (
      <div className={s.backdrop}>
        <AlignmentField set={set} flip={flip} className={s.backField} />
        <span className={s.backCaption}>{side === "defense" ? "Defense" : "Offense"}</span>
      </div>
    );
  }
  return <div className={cx(s.backdrop, view.showCards && s.backdropNarrow)} />;
}

// ───────────────────────────── tabs ─────────────────────────────

function Tabs({ tab, onTab }: { tab: PlayCallTab; onTab(t: PlayCallTab): void }) {
  const pad = usePadConnected();
  const type = usePadType();
  const cap = (pb: PadButton, key: string): ReactNode => (pad ? <Glyph button={pb} mode={type} size="md" /> : <KeyCap label={key} />);
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

// ───────────────────────────── left list ─────────────────────────────

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

// ───────────────────────────── set bar, dots, key players ─────────────────────────────

function Bar({ view, onStep, onOpen, showCards }: { view: View; onStep(d: 1 | -1): void; onOpen(): void; showCards: boolean }) {
  const text = view.bar.sub ? `${view.bar.label} - ${view.bar.sub}` : view.bar.label;
  const sets = view.bar.kind === "sets";
  return (
    <div className={cx(s.setbar, showCards && s.setbarCards)}>
      {sets && (
        <button type="button" className={s.arr} aria-label="Previous set" onClick={() => onStep(-1)} disabled={view.sets.length < 2}>
          <Icon name="chevronLeft" size={26} />
        </button>
      )}
      <button type="button" className={s.barName} onClick={sets ? onOpen : undefined} disabled={!sets}>
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

function Dots({ view, flip, onOpen }: { view: View; flip: boolean; onOpen(): void }) {
  const set = view.set!.set!;
  return (
    <button type="button" className={s.dots} onClick={onOpen} title="Open the plays">
      <AlignmentField set={set} flip={flip} className={s.dotsField} />
    </button>
  );
}

function KeyPlayers({ view, flip }: { view: View; flip: boolean }) {
  const catalog = useCatalog();
  const set = view.set?.set;
  const list = useMemo(() => (set ? keyPlayers(set, catalog ? sideOfSet(catalog, set) : undefined, flip) : []), [set, catalog, flip]);
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

// ───────────────────────────── cards ─────────────────────────────

/** The selected play in words under the set bar: name, type, audible and its heaviest CPU situations. */
function PlayInfo({ item }: { item?: CallPlay }) {
  const play = item?.play;
  if (!item || !play) return <div className={s.info} />;
  const info = playTypeInfo(play.playType);
  const cpu = cpuRows(item.entry.cpu)
    .filter((r) => r.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);
  return (
    <div className={s.info}>
      <h2 className={s.infoName}>{play.name}</h2>
      <div className={s.infoSub}>{item.subtitle}</div>
      <div className={s.infoRow}>
        <span className={s.infoTag} style={{ "--tag": info.color } as CSSProperties}>
          {info.label}
        </span>
        <span className={s.infoLong}>{info.long}</span>
      </div>
      {item.audible && (
        <div className={s.infoRow}>
          <AudibleGlyph slot={item.audible} size="md" />
          <span className={s.infoLong}>{play.side === "defense" ? `Audible ${item.audible}` : AUDIBLE_CATEGORY[item.audible]}</span>
        </div>
      )}
      {cpu.length > 0 && (
        <div className={s.infoCpu}>
          {cpu.map((r) => (
            <div key={r.key} className={s.infoCpuRow}>
              <span>{r.label}</span>
              <span className={s.infoBar}>
                <span style={{ width: `${Math.max(0, Math.min(100, r.weight))}%` }} />
              </span>
              <b>{r.weight}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Cards({
  view,
  st,
  top,
  flip,
  favorites,
  onCard,
  onToggleFavorite,
}: {
  view: View;
  st: ScreenState;
  top: number;
  flip: boolean;
  favorites: ReadonlySet<string>;
  onCard(i: number): void;
  onToggleFavorite(item: CallPlay): void;
}) {
  const ballSpot = useSettings((x) => x.ballSpot);
  const focused = cardsFocused(st);
  const n = view.cards.length;
  if (!n) {
    return (
      <div className={s.cards} data-cards>
        <div className={s.empty}>{view.bar.kind === "sets" ? "Nothing to show for this set" : "No plays here yet"}</div>
      </div>
    );
  }
  // The scroll bar beside the column: thumb = the three cards in view out of all of them.
  const track = 900;
  const thumbH = n <= 3 ? track : (track * 3) / n;
  const thumbTop = n <= 3 ? 0 : ((track - thumbH) * top) / (n - 3);
  return (
    <>
      <div className={s.cards} data-cards>
        <div className={s.cardsInner} style={{ transform: `translateY(${-top * CARD_PITCH}px)` }}>
          {view.cards.map((item, i) => {
            const play = item.play;
            const stat = cardStat(item);
            const info = play ? playTypeInfo(play.playType) : undefined;
            return (
              <div key={item.id} className={cx(s.card, i === st.play && focused && s.cardOn, i === st.play && !focused && s.cardPick)} style={{ top: i * CARD_PITCH }} onClick={() => onCard(i)}>
                {play ? (
                  <PlayCard
                    play={play}
                    size="md"
                    leading={item.audible ? <AudibleGlyph slot={item.audible} size="md" /> : undefined}
                    subtitle={info?.long ?? item.subtitle}
                    flip={flip && play.canFlip}
                    ballSpot={ballSpot}
                    autoBadges={false}
                    stat={stat ? <StatChip stat={stat} /> : undefined}
                    badges={<FavStar on={favorites.has(play.key)} onToggle={() => onToggleFavorite(item)} size={22} />}
                    style={{ "--name-fs": "28px", "--sub-fs": "21px", "--chip-fs": "19px", "--chip-inset": "12px", "--chip-py": "0.38em", "--chip-px": "0.7em", "--meta-pad": "4px 8px 8px", "--meta-gap": "12px" } as CSSProperties}
                  />
                ) : (
                  <div className={s.missing} title={item.problem}>
                    <Icon name="warning" size={26} />
                    <b>{item.name || "(unnamed)"}</b>
                    <i>Play not found</i>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className={s.cardScroll} aria-hidden>
        <div className={s.thumb} style={{ height: thumbH, top: thumbTop }} />
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
