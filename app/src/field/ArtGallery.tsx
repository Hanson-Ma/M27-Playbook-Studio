// Renderer test bench (#/settings/art): real library + custom plays drawn by the art engine (computeArt/artForPlay
// via the shared catalog), every cut style (icons, thumbnails, a whole play with the motion area), hand-made fixtures
// as play cards in every size/state, a full interactive field with labels and coordinates, and route thumbnails.
import { useMemo, useState, type ReactNode } from "react";
import { artForPlay, computeArt, cutStyle, CUT_STYLE_INFO, type CutStyle } from "../model/art";
import type { Catalog } from "../model/catalog";
import { prettyAsset } from "../model/names";
import { stepSummary } from "../model/steps";
import { PLAYLIBRARY_ROOT, type ArtKind, type PlayArt, type ResolvedPlay, type SetDef, type Step, type Vec } from "../model/types";
import { useCatalog, useLibrary } from "../state/library";
import { navigate } from "../state/router";
import { useSettings, type BallSpot } from "../state/settings";
import { useDoc } from "../state/workspace";
import { Button, PlayTypeTag, Select, Tag, useHelpTopic } from "../ui";
import { CutIcon } from "./CutIcon";
import { Field, type FieldPointerEvent } from "./Field";
import { formatCoord } from "./fieldMath";
import { ART_FIXTURES, CUT_DEMOS, CUT_SHOWCASE_SLOTS, SAMPLE_ROUTES, SET_Y_TRIPS_WK, mirrorSteps, type ArtFixture } from "./fixtures";
import { MiniRoute } from "./MiniRoute";
import { MotionBounds } from "./MotionBounds";
import { PlayArtLayer } from "./PlayArtLayer";
import { PlayCard, cardSubtitle, type PlayCardSize } from "./PlayCard";
import styles from "./ArtGallery.module.css";

const LIVE_SET = SET_Y_TRIPS_WK.asset;

export function ArtGallery() {
  const back = () => navigate("#/settings");
  // The top bar's "?" explains routes and cuts here (one "?" per screen).
  useHelpTopic("routes");
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Button variant="ghost" icon="chevronLeft" onClick={back}>
          Settings
        </Button>
        <div>
          <div className={styles.eyebrow}>Playbook Studio · renderer bench</div>
          <h1>Play art</h1>
        </div>
      </header>
      <p className={styles.intro}>
        Real plays from the library and <code>playbooks/plays/</code>, drawn by the art engine from their assignment steps,
        then the hand-made fixtures ({ART_FIXTURES.length}) that exercise every path kind, cap and zone.
      </p>
      <RealPlaysSection />
      <CutsSection />
      <CardsSection />
      <FieldSection />
      <MiniSection />
      <WholeSetSection />
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2>{title}</h2>
        {aside && <div className={styles.aside}>{aside}</div>}
      </div>
      {children}
    </section>
  );
}

// ───────────────────────────── cards ─────────────────────────────

const SIZES: { size: PlayCardSize; width: number }[] = [
  { size: "sm", width: 220 },
  { size: "md", width: 300 },
  { size: "lg", width: 420 },
];

function CardsSection() {
  const [selected, setSelected] = useState(ART_FIXTURES[0].id);
  const [flip, setFlip] = useState(false);
  return (
    <Section
      title="Play cards"
      aside={
        <Toggle on={flip} onChange={setFlip}>
          Flip art
        </Toggle>
      }
    >
      {SIZES.map(({ size, width }) => (
        <div key={size}>
          <div className={styles.rowLabel}>
            {size} · {width}px
          </div>
          <div className={styles.cardRow} style={{ gridTemplateColumns: `repeat(auto-fill, ${width}px)` }}>
            {ART_FIXTURES.map((f, i) => (
              <PlayCard
                key={f.id}
                play={f.play}
                art={flip ? flipArt(f.art) : f.art}
                size={size}
                leading={i === 0 ? <span className={styles.rank}>1</span> : undefined}
                stat={f.stat}
                selected={selected === f.id}
                onClick={() => setSelected(f.id)}
                draggable
              />
            ))}
          </div>
        </div>
      ))}
    </Section>
  );
}

/** Visual-only mirror for the fixtures (the engine does this from the steps via opts.flip). */
function flipArt(a: ArtFixture["art"]): ArtFixture["art"] {
  const m = (v: Vec): Vec => ({ x: -v.x, y: v.y });
  return {
    ...a,
    flipped: !a.flipped,
    players: a.players.map((p) => ({ ...p, base: m(p.base), at: m(p.at), snap: m(p.snap) })),
    paths: a.paths.map((p) => ({ ...p, points: p.points.map(m) })),
    zones: a.zones.map((z) => ({ ...z, center: m(z.center) })),
    bounds: { minX: -a.bounds.maxX, maxX: -a.bounds.minX, minY: a.bounds.minY, maxY: a.bounds.maxY },
  };
}

// ───────────────────────────── cuts ─────────────────────────────

const STYLE_ORDER: CutStyle[] = ["speed", "hard", "fake", "turnback", "settle"];
const STYLE_SAMPLE: Record<CutStyle, string> = {
  speed: "RECEIVER_CUT_ANGLE_45",
  hard: "RECEIVER_CUT_ANGLE_90",
  fake: "RECEIVER_CUT_ANGLE_POSTCORNER",
  turnback: "RECEIVER_CUT_ANGLE_CURL",
  settle: "RECEIVER_CUT_ANGLE_DRAG_STOP",
};

/** SLWR motion in the showcase: from its spot (10.5, −2.2) to (4, −3). */
const SHOWCASE_MOTION = { from: { x: 4, y: -3 }, used: Math.hypot(10.5 - 4, -2.2 + 3) };

function CutsSection() {
  const [dir, setDir] = useState<"left" | "right">("left");
  const [motionArea, setMotionArea] = useState(true);
  const [cuts, setCuts] = useState(true);
  const showcase = useMemo(() => computeArt(SET_Y_TRIPS_WK, CUT_SHOWCASE_SLOTS, { vip: 4, side: "offense" }), []);
  const showcasePlay = useMemo(() => ({ ...ART_FIXTURES[0].play, key: "fixture:cuts", name: "Cut showcase" }), []);
  const lib = useLibrary((s) => s.lib);
  const allCuts = useMemo(() => lib?.enumValues("ReceiverCutAngle").filter((v) => !/INVALID|NONEVALUE/.test(v)), [lib]);

  return (
    <Section
      title="Cuts"
      aside={
        <>
          <Toggle on={dir === "left"} onChange={() => setDir("left")}>
            Icons left
          </Toggle>
          <Toggle on={dir === "right"} onChange={() => setDir("right")}>
            Icons right
          </Toggle>
          <span className={styles.sep} />
          <Toggle on={cuts} onChange={setCuts}>
            Cut styles
          </Toggle>
          <Toggle on={motionArea} onChange={setMotionArea}>
            Motion area
          </Toggle>
        </>
      }
    >
      <div className={styles.cutStyles}>
        {STYLE_ORDER.map((st) => (
          <div key={st} className={styles.cutStyle}>
            <CutIcon cutType={STYLE_SAMPLE[st]} dir={dir} size={40} />
            <div>
              <div className={styles.cutStyleName}>{CUT_STYLE_INFO[st].label}</div>
              <div className={styles.muted}>{CUT_STYLE_INFO[st].hint}</div>
            </div>
          </div>
        ))}
      </div>
      <div className={styles.cutFields}>
        <div className={styles.fieldBox}>
          <Field interactive showCoords label="Cut showcase on the field">
            <MotionBounds visible={motionArea} from={SHOWCASE_MOTION.from} usedYards={SHOWCASE_MOTION.used} />
            <PlayArtLayer art={showcase} showLabels cutStyles={cuts} />
          </Field>
        </div>
        <div className={styles.cutCards}>
          <PlayCard play={showcasePlay} art={showcase} size="md" />
          <PlayCard play={showcasePlay} art={showcase} size="sm" />
        </div>
      </div>
      <div className={styles.rowLabel}>Engine routes for WR2 (right) · icon direction follows the toggle</div>
      <div className={styles.cutGrid}>
        {CUT_DEMOS.map((c) => {
          const cut = `RECEIVER_CUT_ANGLE_${c.cut}`;
          const st = cutStyle(cut);
          return (
            <figure key={c.cut} className={styles.cutCell}>
              <div className={styles.cutPair}>
                <span className={styles.cutIconBox}>
                  <CutIcon cutType={cut} dir={dir} size={44} />
                </span>
                <MiniRoute set={SET_Y_TRIPS_WK} slot={4} steps={c.steps} size={96} />
              </div>
              <figcaption>
                <b>{c.name}</b> · {c.cut.replace(/_/g, " ")} {c.dir === "LEFT" ? "L" : "R"}
                <span className={styles.muted}>{st ? CUT_STYLE_INFO[st].label : "plain corner"}</span>
              </figcaption>
            </figure>
          );
        })}
      </div>
      {allCuts && allCuts.length > 0 && (
        <>
          <div className={styles.rowLabel}>Every ReceiverCutAngle ({allCuts.length})</div>
          <div className={styles.iconRow}>
            {allCuts.map((v) => (
              <span key={v} className={styles.iconChip} title={v}>
                <CutIcon cutType={v} dir={dir} size={30} />
                {v.replace("RECEIVER_CUT_ANGLE_", "").replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}

// ───────────────────────────── interactive field ─────────────────────────────

const BALL_SPOTS: BallSpot[] = ["left", "middle", "right"];

function FieldSection() {
  const [id, setId] = useState(ART_FIXTURES[0].id);
  const [labels, setLabels] = useState(true);
  const [coords, setCoords] = useState(true);
  const [dim, setDim] = useState(true);
  const [compact, setCompact] = useState(false);
  const [firstDown, setFirstDown] = useState(true);
  const [ballSpot, setBallSpot] = useState<BallSpot>("middle");
  const [selected, setSelected] = useState<number>();
  const [hover, setHover] = useState<number>();
  const [last, setLast] = useState<string>("");
  const fixture = ART_FIXTURES.find((f) => f.id === id) ?? ART_FIXTURES[0];

  const onFieldPointer = (e: FieldPointerEvent) => {
    if (e.type === "click") {
      setSelected(undefined);
      setLast(`click ${formatCoord(e.field.x)}, ${formatCoord(e.field.y)}`);
    }
  };

  return (
    <Section
      title="Field"
      aside={
        <>
          {ART_FIXTURES.map((f) => (
            <Toggle key={f.id} on={f.id === id} onChange={() => (setId(f.id), setSelected(undefined))}>
              {f.play.name}
            </Toggle>
          ))}
          <span className={styles.sep} />
          <Toggle on={labels} onChange={setLabels}>
            Labels
          </Toggle>
          <Toggle on={coords} onChange={setCoords}>
            Coords
          </Toggle>
          <Toggle on={dim} onChange={setDim}>
            Dim others
          </Toggle>
          <Toggle on={compact} onChange={setCompact}>
            Compact
          </Toggle>
          <Toggle on={firstDown} onChange={setFirstDown}>
            1st down
          </Toggle>
          <span className={styles.sep} />
          {BALL_SPOTS.map((b) => (
            <Toggle key={b} on={ballSpot === b} onChange={() => setBallSpot(b)}>
              Ball {b}
            </Toggle>
          ))}
        </>
      }
    >
      <div className={styles.fieldBox}>
        <Field
          interactive
          showCoords={coords}
          ballSpot={ballSpot}
          firstDown={firstDown ? 10 : undefined}
          onFieldPointer={onFieldPointer}
          label={`${fixture.play.name} on the field`}
        >
          <PlayArtLayer
            art={fixture.detail}
            showLabels={labels}
            dimOthers={dim}
            compact={compact}
            selectedSlot={selected}
            highlightSlot={hover}
            onPlayerPointerDown={(slot) => setSelected(slot)}
            onPlayerHover={setHover}
          />
        </Field>
      </div>
      <div className={styles.hint}>
        {fixture.note}. Wheel / pinch to zoom, drag to pan, double-click to reset. Click a player to select.
        {selected !== undefined && ` Selected: slot ${selected} (${fixture.detail.players.find((p) => p.slot === selected)?.label}).`}
        {last && ` Last ${last}.`}
      </div>
    </Section>
  );
}

// ───────────────────────────── mini routes ─────────────────────────────

function MiniSection() {
  const [picked, setPicked] = useState<string>();
  const lib = useLibrary((s) => s.lib);
  const libSet = lib?.setByAsset.get(LIVE_SET) ?? SET_Y_TRIPS_WK;

  // One assignment per route type (pass routes first), drawn for the left WR.
  const libraryRoutes = useMemo(() => {
    if (!lib) return [];
    const out: { name: string; steps: Step[] }[] = [];
    const types = [...lib.assignmentsByRouteType.keys()].sort((a, b) => Number(!/_RR_/.test(a)) - Number(!/_RR_/.test(b)) || a.localeCompare(b));
    for (const t of types) {
      const asset = lib.assignmentsByRouteType.get(t)?.[0];
      const def = asset ? lib.assignment(asset) : undefined;
      if (def) out.push({ name: `${t.replace(/^AssignRouteType_/, "")} · ${prettyAsset(asset!, 1)}`, steps: def.steps });
      if (out.length >= 60) break;
    }
    return out;
  }, [lib]);

  const row = (key: string, set: SetDef, slot: number, routes: { name: string; steps: Step[] }[], mirror = false, primary = false) => (
    <div className={styles.miniGrid}>
      {routes.map((r) => {
        const k = `${key}:${r.name}`;
        return (
          <figure key={k} className={styles.mini}>
            <MiniRoute
              set={set}
              slot={slot}
              steps={mirror ? mirrorSteps(r.steps) : r.steps}
              primary={primary}
              selected={picked === k}
              onClick={() => setPicked(k)}
              title={r.name}
            />
            <figcaption>{r.name}</figcaption>
          </figure>
        );
      })}
    </div>
  );

  return (
    <Section title="Mini routes" aside={<span className={styles.muted}>Click to select · {SAMPLE_ROUTES.length * 2 + libraryRoutes.length} thumbnails</span>}>
      <div className={styles.rowLabel}>WR2 (right, 16.25 / −2.2)</div>
      {row("r", SET_Y_TRIPS_WK, 4, SAMPLE_ROUTES)}
      <div className={styles.rowLabel}>WR1 (left, −16.25 / −0.8), mirrored, primary</div>
      {row("l", SET_Y_TRIPS_WK, 3, SAMPLE_ROUTES, true, true)}
      {libraryRoutes.length > 0 && (
        <>
          <div className={styles.rowLabel}>Library assignments by route type (WR1)</div>
          {row("lib", libSet, 3, libraryRoutes)}
        </>
      )}
    </Section>
  );
}

// ───────────────────────────── real plays (art engine) ─────────────────────────────

const FORMATIONS = PLAYLIBRARY_ROOT + "Formations/";
const Y_TRIPS = FORMATIONS + "Offense/Shotgun/Y_Trips_Wk/";

/** Library plays that cover the engine's cases: routes + curls, motion, runs, play action, screens, reverses, pulls, zones. */
const SHOWCASE: { asset: string; why: string }[] = [
  { asset: Y_TRIPS + "Curls", why: "Curl hooks + primary route" },
  { asset: Y_TRIPS + "Mtn_Mesh", why: "Motion + mesh crossers" },
  { asset: Y_TRIPS + "HB_Base", why: "Inside run: ballcarrier + run blocks" },
  { asset: Y_TRIPS + "PA_Read", why: "Play action: fake + QB drop" },
  { asset: Y_TRIPS + "WR_Screen", why: "Screen: catch + lead blockers" },
  { asset: Y_TRIPS + "Reverse", why: "Reverse: handoff chain" },
  { asset: FORMATIONS + "Offense/I_Form/Close/Power_O", why: "Power O: pulling guard, lead block" },
  { asset: FORMATIONS + "Defense/4-3/Over/Cover_3_Sky", why: "Cover 3: deep thirds, hook/curl-flat, rush" },
];

/** The six PBS custom plays (FORMATS.md §3 examples). */
const CUSTOM_FILE = "playbooks/plays/pbs-ytrips-v1.json";

const KIND_ORDER: ArtKind[] = ["primary", "route", "run", "qb", "block", "motion", "preset", "option", "realign", "rush", "coverage"];

function kindCounts(art: PlayArt): string {
  const n = new Map<ArtKind, number>();
  for (const p of art.paths) n.set(p.kind, (n.get(p.kind) ?? 0) + 1);
  const parts = KIND_ORDER.filter((k) => n.has(k)).map((k) => `${n.get(k)} ${k}`);
  if (art.zones.length) parts.push(`${art.zones.length} zone${art.zones.length > 1 ? "s" : ""}`);
  return parts.join(" · ") || "no paths";
}

function safeArt(catalog: Catalog, play: ResolvedPlay, opts: Parameters<typeof artForPlay>[2]): { art?: PlayArt; error?: string } {
  try {
    return { art: artForPlay(catalog, play, opts) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function RealPlaysSection() {
  const status = useLibrary((s) => s.status);
  const progress = useLibrary((s) => s.progress);
  const error = useLibrary((s) => s.error);
  const catalog = useCatalog();
  const customDoc = useDoc(CUSTOM_FILE);
  const [picked, setPicked] = useState<string>();
  const [flip, setFlip] = useState(false);

  const library = useMemo(
    () => (catalog ? SHOWCASE.map((s) => ({ ...s, play: catalog.get(s.asset) })).filter((s): s is typeof s & { play: ResolvedPlay } => !!s.play) : []),
    [catalog],
  );
  const missing = catalog ? SHOWCASE.filter((s) => !catalog.get(s.asset)).map((s) => prettyAsset(s.asset, 3)) : [];
  const custom = useMemo(() => (catalog ? catalog.custom.filter((p) => p.file === CUSTOM_FILE) : []), [catalog]);

  if (!catalog) {
    return (
      <Section title="Real plays · art engine">
        <div className={styles.hint}>
          {status === "loading"
            ? `Loading library… ${progress.label} ${progress.total ? Math.round((progress.loaded / progress.total) * 100) + "%" : ""}`
            : status === "error"
              ? `The library failed to load: ${error ?? "unknown error"}.`
              : "Library not loaded."}{" "}
          {status !== "loading" && (
            <button className={styles.button} onClick={() => void useLibrary.getState().load()}>
              Load library
            </button>
          )}
        </div>
      </Section>
    );
  }

  const all = [...library.map((s) => s.play), ...custom];
  const selected = all.find((p) => p.key === picked) ?? all[0];
  const why = new Map(library.map((s) => [s.play.key, s.why]));

  const grid = (plays: ResolvedPlay[]) => (
    <div className={styles.cardRow} style={{ gridTemplateColumns: "repeat(auto-fill, 250px)" }}>
      {plays.map((p) => (
        <PlayCard
          key={p.key}
          play={p}
          size="sm"
          flip={flip}
          stat={p.problems.length ? `${p.problems.length} PROBLEM${p.problems.length > 1 ? "S" : ""}` : undefined}
          selected={selected?.key === p.key}
          onClick={() => setPicked(p.key)}
        />
      ))}
    </div>
  );

  return (
    <Section
      title="Real plays · art engine"
      aside={
        <>
          <Toggle on={flip} onChange={setFlip}>
            Flip
          </Toggle>
          <span className={styles.muted}>Click a card to inspect it below</span>
        </>
      }
    >
      <div className={styles.rowLabel}>Library ({library.length})</div>
      {grid(library.map((s) => s.play))}
      {missing.length > 0 && <div className={styles.hint}>Not in this library: {missing.join(", ")}</div>}
      <div className={styles.rowLabel}>
        Custom · {CUSTOM_FILE} ({custom.length})
      </div>
      {custom.length ? (
        grid(custom)
      ) : (
        <div className={styles.hint}>
          {customDoc?.error ? `Couldn't load ${CUSTOM_FILE}: ${customDoc.error}` : customDoc ? `${CUSTOM_FILE} has no plays.` : `${CUSTOM_FILE} isn't in the workspace.`}
        </div>
      )}
      {selected && <PlayInspector key={selected.key} catalog={catalog} play={selected} flip={flip} why={why.get(selected.key)} />}
    </Section>
  );
}

/** One play on a big interactive field, with per-slot steps (what the engine walked) and resolution problems. */
function PlayInspector({ catalog, play, flip, why }: { catalog: Catalog; play: ResolvedPlay; flip: boolean; why?: string }) {
  const ballSpot = useSettings((s) => s.ballSpot);
  const [passPro, setPassPro] = useState(true);
  const [labels, setLabels] = useState(true);
  const [preset, setPreset] = useState("Normal");
  const [slot, setSlot] = useState<number>();
  const [hover, setHover] = useState<number>();

  const set: SetDef | undefined = catalog.lib.setByAsset.get(play.set);
  const presets = useMemo(() => (set ? Object.keys(set.movements).filter((k) => k !== "Normal") : []), [set]);
  const { art, error } = safeArt(catalog, play, { flip, showPassPro: passPro, preset: preset === "Normal" ? undefined : preset });
  const focus = slot ?? hover;
  const player = art?.players.find((p) => p.slot === focus);
  const resolved = focus !== undefined ? play.slots[focus] : undefined;
  const steps = resolved?.steps.filter((s) => s.type !== "None") ?? [];
  const slotPaths = art?.paths.filter((p) => p.slot === focus) ?? [];

  return (
    <div className={styles.inspector}>
      <div className={styles.inspectorField}>
        <Field interactive showCoords ballSpot={ballSpot} viewport={play.side === "defense" ? { minX: -27, maxX: 27, minY: -8, maxY: 26 } : undefined} label={`${play.name} on the field`}>
          {art && (
            <PlayArtLayer
              art={art}
              showLabels={labels}
              dimOthers
              selectedSlot={slot}
              highlightSlot={hover}
              onPlayerPointerDown={(s) => setSlot((cur) => (cur === s ? undefined : s))}
              onPlayerHover={setHover}
            />
          )}
        </Field>
      </div>
      <aside className={styles.inspectorSide}>
        <div className={styles.inspectorTitle}>
          <PlayTypeTag playType={play.playType} size="sm" />
          {play.source === "custom" && <Tag tone="custom" size="sm">Custom</Tag>}
          {!play.global && play.source === "library" && <Tag tone="needsMod" size="sm">Needs mod</Tag>}
        </div>
        <h3 className={styles.inspectorName}>{play.name}</h3>
        <div className={styles.inspectorSub}>{cardSubtitle(play, catalog)}</div>
        {why && <div className={styles.hint}>{why}</div>}
        <code className={styles.mono}>{play.key}</code>
        {play.base && <div className={styles.muted}>Base: {prettyAsset(play.base, 1)}</div>}
        <div className={styles.controls}>
          <Toggle on={passPro} onChange={setPassPro}>
            Pass pro
          </Toggle>
          <Toggle on={labels} onChange={setLabels}>
            Labels
          </Toggle>
          {presets.length > 0 && (
            <Select size="sm" value={preset} onChange={setPreset} options={["Normal", ...presets]} aria-label="Motion preset" />
          )}
        </div>
        {error ? (
          <div className={styles.problem}>Art engine threw: {error}</div>
        ) : (
          art && <div className={styles.muted}>{kindCounts(art)} · vip slot {play.vip} · run hole {play.runHole}</div>
        )}
        {play.problems.length > 0 && (
          <ul className={styles.problems}>
            {play.problems.map((p, i) => (
              <li key={i} className={styles.problem}>
                {p}
              </li>
            ))}
          </ul>
        )}
        <div className={styles.rowLabel}>{focus === undefined ? "Hover or click a player" : `Slot ${focus} · ${player?.label ?? "?"}`}</div>
        {resolved && (
          <div className={styles.slotInfo}>
            <div className={styles.muted}>
              {resolved.authored ? `authored PBS/${resolved.authored}` : resolved.assignment ? prettyAsset(resolved.assignment, 2) : "—"}
              {resolved.routeType ? ` · ${resolved.routeType.replace(/^AssignRouteType_/, "")}` : ""}
              {resolved.mechanics ? " · mechanics" : ""}
              {resolved.changed ? " · changed" : ""}
            </div>
            <ol className={styles.steps}>
              {steps.map((st: Step, i) => (
                <li key={i}>{stepSummary(st)}</li>
              ))}
            </ol>
            <div className={styles.muted}>Paths: {slotPaths.map((p) => p.kind + (p.label ? ` (${p.label})` : "")).join(", ") || "none"}</div>
          </div>
        )}
      </aside>
    </div>
  );
}

// ───────────────────────────── whole set ─────────────────────────────

function WholeSetSection() {
  const catalog = useCatalog();
  const [open, setOpen] = useState(false);
  const plays = useMemo(() => (catalog && open ? catalog.playsInSet(LIVE_SET) : []), [catalog, open]);
  const drawn = useMemo(() => (catalog ? plays.filter((p) => safeArt(catalog, p, {}).art?.paths.length).length : 0), [catalog, plays]);
  if (!catalog) return null;
  return (
    <Section
      title="Every play in Gun Y Trips Wk"
      aside={
        <>
          <Toggle on={open} onChange={setOpen}>
            {open ? "Hide" : "Show"}
          </Toggle>
          {open && (
            <span className={styles.muted}>
              {drawn}/{plays.length} with art
            </span>
          )}
        </>
      }
    >
      {open && (
        <div className={styles.cardRow} style={{ gridTemplateColumns: "repeat(auto-fill, 220px)" }}>
          {plays.map((p) => (
            <PlayCard key={p.key} play={p} size="sm" />
          ))}
        </div>
      )}
    </Section>
  );
}

// ───────────────────────────── controls ─────────────────────────────

function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <button type="button" className={styles.toggle} data-on={on || undefined} aria-pressed={on} onClick={() => onChange(!on)}>
      {children}
    </button>
  );
}
