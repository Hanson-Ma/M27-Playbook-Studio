// Full-screen pre-snap view of a picked play: big field with labeled art (flip mirrors it), the play's name, type,
// audible slot, CPU weights and read progression, with buttons for Flip · Favorite · Open in library · Edit in
// playbook and ‹ › to step through the current list. Esc (or Back) closes it; ← → step while it's open.
// The play starts paused: A (Enter, click) starts it, again pauses / resumes. Controller: ◀ ▶ (or LB / RB) step, X audibles,
// B selects a player (B again cycles; hold B and flick the left stick to pick the player to the left / right) and ◀ ▶ then
// motion that player to his spot on that side, RT flips, Y favorites, VIEW closes, ▲ ▼ and the right stick scroll the panel.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Field, PlayArtLayer } from "../../field";
import { usePlayback } from "../../field/usePlayback";
import { useArtTween } from "../../field/useArtTween";
import { ActionLayer, useActions } from "../../input/actions";
import { isPadHeld, usePadConnected, usePadHandler, type PadFrame, type PadPress } from "../../input/gamepad";
import { PadHints, type PadHint } from "../../input/PadHints";
import { AudibleGlyph } from "../../input/glyphs";
import { AUDIBLE_CATEGORY } from "../../model/audibles";
import { artForPlay, matchPreset } from "../../model/art";
import { HALF_WIDTH } from "../../model/geometry";
import { leaf } from "../../model/names";
import { playTypeInfo } from "../../model/playtypes";
import type { ArtBounds, AudibleSlot, PlayArt, ResolvedPlay } from "../../model/types";
import { useCatalog } from "../../state/library";
import { href, navigate } from "../../state/router";
import { useSettings } from "../../state/settings";
import { Button, Icon, IconButton, PlayTypeTag, Tag, cx } from "../../ui";
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
  /** The set's audibles (slot order): X opens the audible menu, the slot's button picks one. */
  audibles?: { slot: AudibleSlot; item: CallPlay }[];
}

const EMPTY_ART: PlayArt = { players: [], paths: [], zones: [], bounds: { minX: -10, maxX: 10, minY: -8, maxY: 12 }, flipped: false };

/** Sideline to sideline; deep enough for the backfield and the longest route (capped). */
function presnapViewport(b: ArtBounds, defense: boolean): ArtBounds {
  if (defense) return { minX: -HALF_WIDTH, maxX: HALF_WIDTH, minY: Math.min(-6, b.minY - 2), maxY: Math.max(24, Math.min(b.maxY + 3, 45)) };
  return { minX: -HALF_WIDTH, maxX: HALF_WIDTH, minY: Math.min(-11, b.minY - 2.5), maxY: Math.max(18, Math.min(b.maxY + 3, 48)) };
}

const PAD_HINTS: PadHint[] = [
  { buttons: ["LEFT", "RIGHT"], label: "Previous / Next" },
  { buttons: ["A"], label: "Start / Pause" },
  { buttons: ["X"], label: "Audibles" },
  { buttons: ["B"], label: "Select Player" },
  { buttons: ["RT"], label: "Flip" },
  { buttons: ["Y"], label: "Favorite" },
  { buttons: ["VIEW"], label: "Back" },
];

const pct = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? `${Math.round(n * 100)}%` : "—");

export function PreSnap(props: PreSnapProps) {
  return createPortal(<PreSnapInner {...props} />, document.body);
}

function PreSnapInner({ item, list, bookPath, flip, onFlip, onStep, onClose, audibles = [] }: PreSnapProps) {
  const audibleButtons = useSettings((st) => st.audibleButtons);
  // The audible menu (B): the set's audibles on their buttons, like calling an audible at the line.
  const [audMenu, setAudMenu] = useState(false);
  const pickAudible = (it: CallPlay) => {
    setAudMenu(false);
    if (it.id !== item.id) onStep(it);
  };
  const catalog = useCatalog();
  const play = item.play;
  const showPassPro = useSettings((st) => st.showPassPro);
  const ballSpot = useSettings((st) => st.ballSpot);
  const favorite = useSettings((st) => st.favorites.includes(play.key));
  const flipped = flip && play.canFlip;

  // Select a player (B) and motion him left or right (◀ ▶) to the spots the set gives him: its pre-snap motion presets.
  const [sel, setSel] = useState<number | undefined>(undefined);
  const [preset, setPreset] = useState<string | undefined>(undefined);
  useEffect(() => {
    setSel(undefined);
    setPreset(undefined);
  }, [item.id, flipped]);

  const art = useMemo(() => {
    if (!catalog) return EMPTY_ART;
    try {
      return artForPlay(catalog, play, { flip: flipped, showPassPro, preset });
    } catch {
      return EMPTY_ART;
    }
  }, [catalog, play, flipped, showPassPro, preset]);
  // Per motion man: the preset that sends him left / right (as the set stores them, before any flip). A preset is the
  // game's own motion: its `motionMan` entry is the player who goes, any others in it slide over to make room.
  const moves = useMemo(() => {
    const out = new Map<number, { left?: string; right?: string }>();
    const set = catalog?.lib.setByAsset.get(play.set);
    const normal = set?.movements?.Normal;
    if (!set || !normal || play.side === "defense") return out;
    for (const [key, list] of Object.entries(set.movements)) {
      if (key === "Normal" || !Array.isArray(list)) continue;
      matchPreset(normal, list).forEach((pre, slot) => {
        const n = normal[slot];
        if (!pre || !pre.motionMan || !n || typeof pre.x !== "number" || typeof n.x !== "number") return;
        const dx = pre.x - n.x;
        // The key names the side ("M1left"); a key without one goes by where he ends up.
        const named = /left$/i.test(key) ? "left" : /right$/i.test(key) ? "right" : undefined;
        if (!named && Math.abs(dx) < 0.3) return;
        const e = out.get(slot) ?? {};
        const dir = named ?? (dx < 0 ? "left" : "right");
        if (!e[dir]) e[dir] = key;
        out.set(slot, e);
      });
    }
    return out;
  }, [catalog, play]);
  // Players who can be selected, left to right as drawn.
  const order = useMemo(() => art.players.filter((p) => moves.has(p.slot)).sort((a, b) => a.at.x - b.at.x).map((p) => p.slot), [art, moves]);
  const cycleSel = () =>
    setSel((cur) => {
      if (!order.length) return undefined;
      const i = cur === undefined ? 0 : order.indexOf(cur) + 1;
      return i >= order.length ? undefined : order[i];
    });
  const stepSel = (d: 1 | -1) =>
    setSel((cur) => {
      if (!order.length) return undefined;
      if (cur === undefined) return order[d > 0 ? 0 : order.length - 1];
      return order[Math.max(0, Math.min(order.length - 1, order.indexOf(cur) + d))];
    });
  // A new selection drops the previous player's motion (one motion at a time).
  useEffect(() => {
    setPreset((cur) => {
      if (cur === undefined || sel === undefined) return sel === undefined ? undefined : cur;
      const mv = moves.get(sel);
      return mv && (mv.left === cur || mv.right === cur) ? cur : undefined;
    });
  }, [sel, moves]);
  const motion = (dir: "left" | "right") => {
    const mv = sel === undefined ? undefined : moves.get(sel);
    if (!mv) return;
    const L = flipped ? mv.right : mv.left;
    const R = flipped ? mv.left : mv.right;
    setPreset((cur) => (dir === "right" ? (cur === L ? undefined : (R ?? cur)) : cur === R ? undefined : (L ?? cur)));
  };
  const selLabel = sel === undefined ? undefined : art.players.find((p) => p.slot === sel)?.label;
  // The play only runs when asked (click the field, A on the controller, Enter or the Run button): players run their
  // routes and freeze at the end. Opening a play or stepping to the next one starts at the pre-snap look.
  const playback = usePlayback(art, `${item.id}|${flipped}|${preset ?? ""}`, false);
  // Stepping to another play (or flipping) slides the players to their new spots, like the game; nothing fades.
  const tweened = useArtTween(art, `${item.id}|${flipped}`, preset ?? "");
  const padOn = usePadConnected();
  // The game's camera: behind the offense, tilted. Flat view allows zoom / pan.
  const [tilt, setTilt] = useState(true);
  const press = useRef<{ x: number; y: number } | undefined>(undefined);
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
      { id: "prev", label: sel !== undefined ? "Motion left" : "Previous play", keys: ["ArrowLeft"], repeat: true, enabled: sel !== undefined || !!prev, run: () => (sel !== undefined ? motion("left") : prev && onStep(prev)) },
      { id: "next", label: sel !== undefined ? "Motion right" : "Next play", keys: ["ArrowRight"], repeat: true, enabled: sel !== undefined || !!next, run: () => (sel !== undefined ? motion("right") : next && onStep(next)) },
      { id: "replay", label: "Start / pause the play", keys: ["Enter"], run: () => playback.toggle() },
      { id: "back", label: "Back", keys: ["Escape"], run: () => (audMenu ? setAudMenu(false) : sel !== undefined ? setSel(undefined) : onClose()) },
      { bareKeys: true, id: "run", label: "Start / pause the play", keys: ["a"], enabled: !audMenu, run: () => playback.toggle() },
      { bareKeys: true, id: "audibles", label: "Audibles", keys: ["x"], enabled: audibles.length > 0, run: () => setAudMenu((v) => !v) },
      { bareKeys: true, id: "selectPlayer", label: "Select a player to motion", keys: ["b"], enabled: !audMenu && order.length > 0, run: cycleSel },
      { bareKeys: true, id: "aud1", label: "Audible 1", keys: ["1"], enabled: audMenu, run: () => audibles.find((a) => a.slot === 1) && pickAudible(audibles.find((a) => a.slot === 1)!.item) },
      { bareKeys: true, id: "aud2", label: "Audible 2", keys: ["2"], enabled: audMenu, run: () => audibles.find((a) => a.slot === 2) && pickAudible(audibles.find((a) => a.slot === 2)!.item) },
      { bareKeys: true, id: "aud3", label: "Audible 3", keys: ["3"], enabled: audMenu, run: () => audibles.find((a) => a.slot === 3) && pickAudible(audibles.find((a) => a.slot === 3)!.item) },
      { bareKeys: true, id: "aud4", label: "Audible 4", keys: ["4"], enabled: audMenu, run: () => audibles.find((a) => a.slot === 4) && pickAudible(audibles.find((a) => a.slot === 4)!.item) },
    ],
    { modal: true },
  );

  // The pre-snap view owns the controller while it's open (it's a pad-owning overlay, see input/gamepad.ts).
  const scrollPanel = (dy: number) => {
    const aside = root.current?.querySelector("aside");
    if (aside) aside.scrollTop += dy;
  };
  usePadHandler(
    {
      press: (p: PadPress) => {
        if (audMenu) {
          // Audible menu: each slot's button picks it; B (when it isn't an audible button) or VIEW closes the menu.
          const hit = audibles.find((a) => audibleButtons[a.slot] === p.button);
          if (hit) pickAudible(hit.item);
          else if (p.button === "B" || p.button === "VIEW") setAudMenu(false);
          return true;
        }
        switch (p.button) {
          case "X":
            if (audibles.length) setAudMenu(true);
            break;
          case "B":
            cycleSel();
            break;
          case "VIEW":
            onClose();
            break;
          case "RT":
            if (play.canFlip) onFlip();
            break;
          case "LEFT":
            // B held: pick the player to the left; a player selected: motion him left; otherwise the previous play.
            if (isPadHeld("B")) stepSel(-1);
            else if (sel !== undefined) motion("left");
            else if (prev) onStep(prev);
            break;
          case "RIGHT":
            if (isPadHeld("B")) stepSel(1);
            else if (sel !== undefined) motion("right");
            else if (next) onStep(next);
            break;
          case "LB":
            if (prev) onStep(prev);
            break;
          case "RB":
            if (next) onStep(next);
            break;
          case "Y":
            toggleFavorite();
            break;
          case "A":
            playback.toggle();
            break;
          case "UP":
            scrollPanel(-160);
            break;
          case "DOWN":
            scrollPanel(160);
            break;
        }
        return true; // nothing leaks to the screens underneath
      },
      analog: (f: PadFrame) => {
        if (!f.ry) return false;
        scrollPanel(f.ry * 900 * f.dt);
        return true;
      },
    },
    { priority: 20, overlays: "own" },
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
      <div ref={root} className={s.overlay} role="dialog" aria-modal="true" data-pad-own aria-label={`${play.name} pre-snap`} tabIndex={-1}>
        <div className={s.fieldCol}>
          <div
            className={cx(s.fieldBox, tilt && s.tilted)}
            onPointerDown={(e) => (press.current = { x: e.clientX, y: e.clientY })}
            onPointerUp={(e) => {
              const p = press.current;
              press.current = undefined;
              // A click (not a drag to pan) runs the play.
              if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5) playback.toggle();
            }}
          >
            <Field
              interactive={!tilt}
              viewport={viewport}
              padding={0.5}
              ballSpot={ballSpot}
              firstDown={defense ? undefined : 10}
              label={`${play.name} on the field`}
              className={s.field}
            >
              <PlayArtLayer art={playback.started ? playback.art : tweened} showLabels={!playback.running} selectedSlot={sel} />
            </Field>
          </div>
          <div className={s.fieldTop}>
            <Button variant="secondary" icon="chevronLeft" onClick={onClose} title="Back to the play call (Esc)">
              Back
            </Button>
            <Button
              variant="secondary"
              icon={playback.running ? "pause" : "play"}
              disabled={!playback.canRun}
              onClick={playback.toggle}
              title="Start or pause the play (A, Enter, or click the field)"
            >
              {playback.running ? "Pause" : !playback.started ? "Run Play" : (playback.time ?? 0) < playback.duration ? "Resume" : "Replay"}
            </Button>
            {playback.started && <IconButton icon="refresh" title="Back to the pre-snap look" aria-label="Reset the play" onClick={() => playback.seek(undefined)} />}
            {audibles.length > 0 && (
              <Button variant="secondary" active={audMenu} onClick={() => setAudMenu((v) => !v)} title="The set's audibles (X)">
                Audibles
              </Button>
            )}
            <Button variant="secondary" icon={tilt ? "grid" : "field"} onClick={() => setTilt((v) => !v)} title={tilt ? "Flat top-down view (zoom and pan)" : "The game's tilted camera"}>
              {tilt ? "Flat View" : "Game View"}
            </Button>
            <span className={s.hint}>
              {selLabel
                ? `${selLabel} selected · ◀ ▶ motion · B next player · Esc to deselect`
                : tilt
                  ? "Click the field to start the play"
                  : "Click the field to start the play · Scroll to zoom · drag to pan"}
            </span>
            <PadHints hints={PAD_HINTS} className={s.hint} />
          </div>
          {!playback.started && playback.canRun && !audMenu && (
            <div className={s.paused} aria-live="polite">
              <Icon name="pause" size={18} /> Paused · press {padOn ? "A" : "Enter"} to start
            </div>
          )}
          {audMenu && (
            <div className={s.audMenu} role="menu" aria-label="Audibles">
              <div className={s.audMenuTitle}>Audibles</div>
              {audibles.map((a) => (
                <button key={a.slot} type="button" role="menuitem" className={cx(s.audItem, a.item.id === item.id && s.audItemOn)} onClick={() => pickAudible(a.item)}>
                  <AudibleGlyph slot={a.slot} size="md" />
                  <span>
                    <b className="caps">{a.item.name}</b>
                    <i>{AUDIBLE_CATEGORY[a.slot]}</i>
                  </span>
                </button>
              ))}
            </div>
          )}
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
          <h1 className={cx(s.name, "caps")}>{play.name}</h1>
          <div className={s.subtitle}>{item.subtitle}</div>
          <div className={s.tags}>
            <PlayTypeTag playType={play.playType} />
            {play.source === "custom" && <Tag tone="custom">Custom</Tag>}
            {item.template && (
              <Tag tone="neutral" icon="lock" title="Copied from the template save by the game-side builder — read-only here">
               From Template
              </Tag>
            )}
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
              CPU Play Calling <span className={s.count}>{cpu.length || ""}</span>
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
              <h2 className={s.sectionTitle}>Read Progression</h2>
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
              <dd className="caps">{info.long}</dd>
              {vipLabel && (
                <>
                  <dt>Primary Receiver</dt>
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
              Open in Library
            </Button>
            <Button variant="primary" icon="list" onClick={editInPlaybook} title={item.template ? "Show the template section in the playbook builder" : "Select this play in the playbook builder"}>
              {item.template ? "Show in Playbook" : "Edit in Playbook"}
            </Button>
          </div>
        </aside>
      </div>
    </ActionLayer>
  );
}
