// The play-select screen as Madden 27 draws it, in this app's style. Everything sits on the game's 1920-ish layout (a
// 2000 × 1125 stage scaled to fit): the tab row with its LB / RB hints, the formation list on the left with its scroll
// bar, the set bar (‹ SET - 9 plays ›) with the formation dots under it and KEY PLAYERS to the right, the play cards
// (three at a time) with a page strip, and the hint pill at the bottom. A big field above shows what is selected.
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
import { ROWS_VISIBLE, VISIBLE, cardsLeft, listTop, type ScreenState, type View } from "./gameScreenModel";
import { PLAYCALL_TABS, cardStat, type CallPlay, type PlayCallTab } from "./playcallModel";
import s from "./GameScreen.module.css";

const STAGE_W = 2000;
const STAGE_H = 1125;
const ROW_PITCH = 68;
const CARD_W = 370;
const CARD_GAP = 25;

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
  /** Wheel: a step along the current axis. `list` when the pointer is over the formation list. */
  onWheelStep(delta: 1 | -1, list: boolean): void;
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
  const left = useRef(0);
  const cardsKey = `${st.tab}|${view.row}|${view.setIndex}`;
  const lastKey = useRef(cardsKey);
  if (lastKey.current !== cardsKey) {
    lastKey.current = cardsKey;
    left.current = 0;
  }
  left.current = cardsLeft(left.current, st.play, view.cards.length);

  const wheel = useRef({ acc: 0 });
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    wheel.current.acc += e.deltaY;
    if (Math.abs(wheel.current.acc) < 60) return;
    const d = Math.sign(wheel.current.acc) as 1 | -1;
    wheel.current.acc = 0;
    p.onWheelStep(d, !!(e.target as Element).closest("[data-list]"));
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
        {view.showCards && (
          <Cards view={view} st={st} left={left.current} flip={p.flip} favorites={p.favorites} onCard={p.onCard} onToggleFavorite={p.onToggleFavorite} />
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
      <div className={s.backdrop}>
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
  return <div className={s.backdrop} />;
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

function Cards({
  view,
  st,
  left,
  flip,
  favorites,
  onCard,
  onToggleFavorite,
}: {
  view: View;
  st: ScreenState;
  left: number;
  flip: boolean;
  favorites: ReadonlySet<string>;
  onCard(i: number): void;
  onToggleFavorite(item: CallPlay): void;
}) {
  const ballSpot = useSettings((x) => x.ballSpot);
  const n = view.cards.length;
  const pages = Math.max(1, Math.ceil(n / VISIBLE));
  if (!n) {
    return (
      <div className={s.cards}>
        <div className={s.empty}>{view.bar.kind === "sets" ? "Nothing to show for this set" : "No plays here yet"}</div>
      </div>
    );
  }
  return (
    <>
      <div className={s.cards}>
        <div className={s.cardsInner} style={{ transform: `translateX(${-left * (CARD_W + CARD_GAP)}px)` }}>
          {view.cards.map((item, i) => {
            const play = item.play;
            const stat = cardStat(item);
            const info = play ? playTypeInfo(play.playType) : undefined;
            return (
              <div key={item.id} className={cx(s.card, i === st.play && s.cardOn)} style={{ left: i * (CARD_W + CARD_GAP) }} onClick={() => onCard(i)}>
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
                    badges={<FavStar on={favorites.has(play.key)} onToggle={() => onToggleFavorite(item)} size={18} />}
                    style={{ "--name-fs": "26px", "--sub-fs": "17px", "--chip-fs": "15px", "--chip-inset": "10px" } as CSSProperties}
                  />
                ) : (
                  <div className={s.missing} title={item.problem}>
                    <Icon name="warning" size={22} />
                    <b>{item.name || "(unnamed)"}</b>
                    <i>Play not found</i>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className={s.pager} aria-hidden>
        {pages > 1 && Array.from({ length: pages }, (_, i) => <span key={i} className={cx(Math.floor(st.play / VISIBLE) === i && s.pagerOn)} />)}
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
