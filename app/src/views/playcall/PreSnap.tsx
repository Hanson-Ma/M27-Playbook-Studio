// Full-screen pre-snap view of a picked play: big field with labeled art (flip mirrors it), the play's name, type,
// audible slot, CPU weights and read progression, with buttons for Flip · Favorite · Open in library · Edit in
// playbook and ‹ › to step through the current list. Esc (or Back) closes it; ← → step while it's open.
import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Field, PlayArtLayer } from "../../field";
import { ActionLayer, useActions } from "../../input/actions";
import { AudibleGlyph } from "../../input/glyphs";
import { AUDIBLE_CATEGORY } from "../../model/audibles";
import { artForPlay } from "../../model/art";
import { HALF_WIDTH } from "../../model/geometry";
import { leaf } from "../../model/names";
import { playTypeInfo } from "../../model/playtypes";
import type { ArtBounds, PlayArt, ResolvedPlay } from "../../model/types";
import { useCatalog } from "../../state/library";
import { href, navigate } from "../../state/router";
import { useSettings } from "../../state/settings";
import { Button, Icon, IconButton, NeedsModTag, PlayTypeTag, Tag, cx } from "../../ui";
import { cpuRows, neighbor, runSchemeLabel, type CallPlay } from "./playcallModel";
import s from "./PreSnap.module.css";

export interface PreSnapProps {
  item: CallPlay & { play: ResolvedPlay };
  /** Plays ◀ ▶ step through (the current page's list). */
  list: CallPlay[];
  /** Playbook file (for "Edit in playbook"). */
  bookPath: string;
  flip: boolean;
  onFlip(): void;
  onStep(item: CallPlay): void;
  onClose(): void;
}

const EMPTY_ART: PlayArt = { players: [], paths: [], zones: [], bounds: { minX: -10, maxX: 10, minY: -8, maxY: 12 }, flipped: false };

/** Sideline to sideline; deep enough for the backfield and the longest route (capped). */
function presnapViewport(b: ArtBounds, defense: boolean): ArtBounds {
  if (defense) return { minX: -HALF_WIDTH, maxX: HALF_WIDTH, minY: Math.min(-6, b.minY - 2), maxY: Math.max(24, Math.min(b.maxY + 3, 45)) };
  return { minX: -HALF_WIDTH, maxX: HALF_WIDTH, minY: Math.min(-11, b.minY - 2.5), maxY: Math.max(18, Math.min(b.maxY + 3, 48)) };
}

const pct = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? `${Math.round(n * 100)}%` : "—");

export function PreSnap(props: PreSnapProps) {
  return createPortal(<PreSnapInner {...props} />, document.body);
}

function PreSnapInner({ item, list, bookPath, flip, onFlip, onStep, onClose }: PreSnapProps) {
  const catalog = useCatalog();
  const play = item.play;
  const showPassPro = useSettings((st) => st.showPassPro);
  const ballSpot = useSettings((st) => st.ballSpot);
  const favorite = useSettings((st) => st.favorites.includes(play.key));
  const flipped = flip && play.canFlip;

  const art = useMemo(() => {
    if (!catalog) return EMPTY_ART;
    try {
      return artForPlay(catalog, play, { flip: flipped, showPassPro });
    } catch {
      return EMPTY_ART;
    }
  }, [catalog, play, flipped, showPassPro]);
  const defense = art.players[0]?.side === "defense" || play.side === "defense";
  const { minX, maxX, minY, maxY } = presnapViewport(art.bounds, defense);
  const viewport = useMemo(() => ({ minX, maxX, minY, maxY }), [minX, maxX, minY, maxY]);

  const prev = neighbor(list, item.id, -1);
  const next = neighbor(list, item.id, 1);
  const index = list.findIndex((x) => x.id === item.id);

  const toggleFavorite = () => useSettings.getState().toggleFavorite(play.key);
  const openLibrary = () => navigate(href("library", "play", play.key));
  // Template plays live in the template save: the builder can only select their (locked) section.
  const editInPlaybook = () => navigate(`${href("playbook", bookPath)}?f=${item.f}${item.template ? "" : `&s=${item.s}&p=${item.p}`}`);

  // A dialog: Esc closes; ← → step through the list (it blocks the view's keys underneath).
  const token = useActions(
    "playcall.presnap",
    [
      { id: "prev", label: "Previous play", keys: ["ArrowLeft"], repeat: true, enabled: !!prev, run: () => prev && onStep(prev) },
      { id: "next", label: "Next play", keys: ["ArrowRight"], repeat: true, enabled: !!next, run: () => next && onStep(next) },
      { id: "back", label: "Back", keys: ["Escape"], run: onClose },
    ],
    { modal: true },
  );

  // Take focus so Enter can't click whatever was focused behind the overlay. Focus isn't handed back to the card on
  // close: the white glow marks it.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, []);

  const info = playTypeInfo(play.playType);
  const cpu = cpuRows(item.entry.cpu);
  const scheme = info.family === "run" || info.family === "option" ? runSchemeLabel(play.blocking) : undefined;
  const reads = (play.reads ?? []).filter((r) => typeof r.pos === "number");
  const labelOf = (slot: number) => art.players.find((p) => p.slot === slot)?.label ?? `#${slot}`;
  const vipLabel = play.vip > 0 && art.players.some((p) => p.slot === play.vip) ? labelOf(play.vip) : undefined;

  return (
    <ActionLayer token={token}>
      <div ref={root} className={s.overlay} role="dialog" aria-modal="true" aria-label={`${play.name} pre-snap`} tabIndex={-1}>
        <div className={s.fieldCol}>
          <div className={s.fieldBox} key={`${item.id}|${flipped}`}>
            <Field
              interactive
              viewport={viewport}
              padding={0.5}
              ballSpot={ballSpot}
              firstDown={defense ? undefined : 10}
              label={`${play.name} on the field`}
              className={s.field}
            >
              <PlayArtLayer art={art} showLabels />
            </Field>
          </div>
          <div className={s.fieldTop}>
            <Button variant="secondary" icon="chevronLeft" onClick={onClose} title="Back to the play call (Esc)">
              Back
            </Button>
            <span className={s.hint}>Scroll to zoom · drag to pan · double-click to reset</span>
          </div>
          {list.length > 1 && (
            <div className={s.stepper}>
              <IconButton icon="chevronLeft" title="Previous play" disabled={!prev} onClick={() => prev && onStep(prev)} />
              <span className={s.stepCount}>
                {index + 1} <span>/ {list.length}</span>
              </span>
              <IconButton icon="chevronRight" title="Next play" disabled={!next} onClick={() => next && onStep(next)} />
            </div>
          )}
        </div>

        <aside className={s.panel} key={item.id}>
          <div className={s.eyebrow}>
            {item.formationName} <span>›</span> {item.setName}
          </div>
          <h1 className={s.name}>{play.name}</h1>
          <div className={s.subtitle}>{item.subtitle}</div>
          <div className={s.tags}>
            <PlayTypeTag playType={play.playType} />
            {play.source === "custom" && <Tag tone="custom">Custom</Tag>}
            {item.template && (
              <Tag tone="neutral" icon="lock" title="Copied from the template save by the game-side builder — read-only here">
                From template
              </Tag>
            )}
            {!play.global && <NeedsModTag />}
            {flipped && (
              <Tag tone="neutral" icon="flip">
                Flipped
              </Tag>
            )}
            {favorite && (
              <Tag tone="needsMod" icon="starFilled">
                Favorite
              </Tag>
            )}
          </div>

          <section className={s.section}>
            <h2 className={s.sectionTitle}>Audible</h2>
            {item.audible ? (
              <div className={s.audible}>
                <AudibleGlyph slot={item.audible} size="lg" />
                <div>
                  <div className={s.audName}>{defense ? `Audible ${item.audible}` : AUDIBLE_CATEGORY[item.audible]}</div>
                  <div className={s.audSub}>{defense ? "Defensive audible" : `Audible slot ${item.audible}`}</div>
                </div>
              </div>
            ) : (
              <div className={s.none}>Not an audible</div>
            )}
          </section>

          <section className={s.section}>
            <h2 className={s.sectionTitle}>
              CPU play calling <span className={s.count}>{cpu.length || ""}</span>
            </h2>
            {cpu.length ? (
              <ul className={s.cpu}>
                {cpu.map((r) => (
                  <li key={r.key} className={cx(!r.known && s.cpuUnknown)} title={r.known ? r.key : `${r.key} is not a known situation`}>
                    <span className={s.cpuLabel}>{r.label}</span>
                    <span className={s.cpuBar}>
                      <span style={{ "--w": `${Math.max(0, Math.min(100, r.weight))}%` } as CSSProperties} />
                    </span>
                    <span className={s.cpuNum}>{r.weight}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className={s.none}>No CPU weights</div>
            )}
          </section>

          {reads.length > 0 && (
            <section className={s.section}>
              <h2 className={s.sectionTitle}>Read progression</h2>
              <ol className={s.reads}>
                {reads.map((r, i) => (
                  <li key={i} data-primary={r.pos === play.vip || undefined}>
                    <span className={s.readNum}>{i + 1}</span>
                    <span className={s.readLabel}>{labelOf(r.pos)}</span>
                    <span className={s.readPct}>{pct(r.pct)}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className={s.section}>
            <h2 className={s.sectionTitle}>Details</h2>
            <dl className={s.details}>
              <dt>Type</dt>
              <dd>{info.long}</dd>
              {vipLabel && (
                <>
                  <dt>Primary receiver</dt>
                  <dd>
                    <span className={s.vipDot} /> {vipLabel}
                  </dd>
                </>
              )}
              {scheme && (
                <>
                  <dt>Scheme</dt>
                  <dd>{scheme}</dd>
                </>
              )}
              <dt>Source</dt>
              <dd>
                {play.source === "custom" ? (
                  <>
                    Custom · <span className={s.code}>{play.file ? leaf(play.file) : ""}</span>
                  </>
                ) : (
                  <>
                    Library · <span className={s.code}>#{play.playId ?? "?"}</span>
                  </>
                )}
                {item.template && " · template save"}
              </dd>
              {!play.canFlip && (
                <>
                  <dt>Flip</dt>
                  <dd>Can't be flipped</dd>
                </>
              )}
            </dl>
          </section>

          {play.problems.length > 0 && (
            <section className={cx(s.section, s.problems)}>
              <h2 className={s.sectionTitle}>
                <Icon name="warning" size={14} /> Problems
              </h2>
              <ul>
                {play.problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </section>
          )}

          <div className={s.actions}>
            <Button variant="secondary" icon="flip" disabled={!play.canFlip} onClick={onFlip} active={flipped} title={play.canFlip ? "Mirror the play" : "This play can't be flipped"}>
              {flipped ? "Unflip" : "Flip"}
            </Button>
            <Button variant="secondary" icon={favorite ? "starFilled" : "star"} onClick={toggleFavorite} active={favorite}>
              {favorite ? "Favorited" : "Favorite"}
            </Button>
            <Button variant="secondary" icon="external" onClick={openLibrary} title="Open this play's detail in the library">
              Open in library
            </Button>
            <Button variant="primary" icon="list" onClick={editInPlaybook} title={item.template ? "Show the template section in the playbook builder" : "Select this play in the playbook builder"}>
              {item.template ? "Show in playbook" : "Edit in playbook"}
            </Button>
          </div>
        </aside>
      </div>
    </ActionLayer>
  );
}
