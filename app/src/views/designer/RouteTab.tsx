// ROUTE tab: ready-made routes drawn from the player's real alignment (with a few plain parameters), My Routes,
// double moves, the route's points (distance, direction, speed, cut) and the game's own routes.
import { useMemo, useState } from "react";
import { MiniRoute } from "../../field";
import { slotSide } from "../../model/designer";
import {
  DOUBLE_MOVES,
  PRESET_BY_ID,
  ROUTE_PRESETS,
  SCREEN_BLOCKS,
  screenBlockSteps,
  doubleMoveSteps,
  editRoute,
  presetSteps,
  replaceBody,
  routeEnd,
  setRouteEnd,
  type DoubleMoveId,
  type ScreenBlockId,
  type RouteEnd,
  type RouteParams,
  type RoutePresetId,
} from "../../model/routes";
import { stepsEqual } from "../../model/steps";
import { Button, NumberField, Segmented, TextInput, cx } from "../../ui";
import { mirrorRouteType, mirrorSteps } from "../../model/routes";
import type { Step } from "../../model/types";
import { Disclosure } from "./Disclosure";
import { LegTable } from "./LegTable";
import { MyRoutesSection } from "./MyRoutesSection";
import { OptionBranches } from "./OptionBranches";
import { OffFieldNotice, tileOffField, warnIfOffField } from "./OffField";
import { RouteLibrary } from "./RouteLibrary";
import { slotGeometry, useDesigner } from "./shared";
import { titleCase } from "./titleCase";
import s from "./Inspector.module.css";

const RELEASE_OPTS = [
  { value: "none", label: "None" },
  { value: "vertical", label: "Straight" },
  { value: "inside", label: "Inside" },
  { value: "outside", label: "Outside" },
] as const;

const END_OPTS = [
  { value: "getopen", label: "Find Space" },
  { value: "sit", label: "Sit" },
  { value: "none", label: "None" },
] as const;

/** Extra words each route answers to in the search box ("over" finds Cross, "leak" finds Boot Flat). */
const ALIASES: Record<string, string> = {
  stick: "option hitch",
  option: "choice read curl out",
  cross: "over mesh deep over",
  crossflat: "shallow drag across",
  bootflat: "pa boot leak across flat behind line",
  zigin: "zig zag whip",
  zigout: "zig zag whip",
  zig: "zig zag whip",
  drag: "shallow cross",
  in: "dig",
  skinnypost: "post",
  curl: "hook",
  bubble: "screen wr screen",
  wr_out: "screen block stalk bubble",
  wr_in: "screen block stalk",
  lead_out: "screen block lead pull",
  lead_in: "screen block lead pull",
};
const matches = (q: string, ...hay: string[]) => !q || q.split(/\s+/).every((w) => hay.some((h) => h.toLowerCase().includes(w)));

export function RouteTab({ slot, lock }: { slot: number; lock: number }) {
  const d = useDesigner();
  const { state, set, ui, setUi } = d;
  const steps = state.slots[slot].steps;
  const side = slotSide(state, slot);
  const [library, setLibrary] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  // Flip: every tile shows (and puts on the player) the mirror image of the route.
  const [flipped, setFlipped] = useState(false);
  const routeTypes = useMemo(() => new Set(d.lib.enumValues("AssignRouteType")), [d.lib]);
  const fl = <T extends { steps: Step[]; routeType: string }>(b: T): T => (flipped ? { ...b, steps: mirrorSteps(b.steps), routeType: mirrorRouteType(b.routeType, routeTypes) ?? b.routeType } : b);
  const keep = lock > 0 ? lock : undefined;
  // Depth routes count their depth from the line of scrimmage, so they need to know where the player starts.
  const geom = slotGeometry(set, slot, steps, lock);
  const startY = geom.start.y;

  const tiles = useMemo(
    () =>
      ROUTE_PRESETS.map((def) => {
        const built = fl(presetSteps(def.id, { side, startY }));
        const next = replaceBody(steps, built.steps, keep);
        return { def, steps: next, routeType: built.routeType, off: tileOffField({ set }, slot, next) };
      }),
    [steps, side, keep, set, slot, startY, flipped, routeTypes], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const doubles = useMemo(
    () =>
      DOUBLE_MOVES.map((dm) => {
        const built = fl(doubleMoveSteps(dm.id, side));
        const next = replaceBody(steps, built.steps, keep);
        return { dm, steps: next, routeType: built.routeType, off: tileOffField({ set }, slot, next) };
      }),
    [steps, side, keep, set, slot, flipped, routeTypes], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const screens = useMemo(
    () =>
      SCREEN_BLOCKS.map((sb) => {
        const built = fl(screenBlockSteps(sb.id, side));
        const next = replaceBody(steps, built.steps, keep);
        return { sb, steps: next, routeType: built.routeType, off: tileOffField({ set }, slot, next) };
      }),
    [steps, side, keep, set, slot, flipped, routeTypes], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const memo = ui.presets[slot];
  const activePreset = memo && stepsEqual(memo.steps, steps) ? memo : undefined;

  const applyPreset = (id: RoutePresetId, params: Partial<RouteParams>, label: string, coalesceMs?: number) => {
    const built = fl(presetSteps(id, { side, startY }, params));
    const next = replaceBody(steps, built.steps, keep);
    d.commitSlot(slot, next, label, { routeType: built.routeType, family: PRESET_BY_ID[id].family }, coalesceMs);
    setUi((u) => ({ presets: { ...u.presets, [slot]: { id, params, steps: next } }, vertex: undefined }));
    // Tile clicks only (parameter edits show the notice instead of a toast per keystroke).
    if (coalesceMs === undefined) warnIfOffField(d, slot, next, lock, PRESET_BY_ID[id].label);
  };
  const applyScreen = (id: ScreenBlockId) => {
    const t = screens.find((x) => x.sb.id === id)!;
    d.commitSlot(slot, t.steps, `Screen block: ${t.sb.label}`, { routeType: t.routeType, family: "ScreenBlock" });
    setUi((u) => {
      const presets = { ...u.presets };
      delete presets[slot];
      return { presets, vertex: undefined };
    });
  };
  const applyDouble = (id: DoubleMoveId) => {
    const t = doubles.find((x) => x.dm.id === id)!;
    d.commitSlot(slot, t.steps, `Double move: ${t.dm.label}`, { routeType: t.routeType, family: t.dm.family });
    warnIfOffField(d, slot, t.steps, lock, t.dm.label);
    setUi((u) => {
      const presets = { ...u.presets };
      delete presets[slot];
      return { presets, vertex: undefined };
    });
  };

  const shownTiles = tiles.filter((t) => matches(q, t.def.label, t.def.family, ALIASES[t.def.id] ?? ""));
  const shownDoubles = doubles.filter((t) => matches(q, t.dm.label, t.dm.family, ALIASES[t.dm.id] ?? ""));
  const shownScreens = screens.filter((t) => matches(q, t.sb.label, "screen block", ALIASES[t.sb.id] ?? ""));
  const activeScreen = screens.find((t) => stepsEqual(t.steps, steps))?.sb.id;
  const hasLegs = geom.route.legs.length > 0;
  const end = routeEnd(geom.route);
  const setEnd = (e: RouteEnd) => d.commitSlot(slot, editRoute(steps, (r) => setRouteEnd(r, e, geom.start)), "Route end");
  const activeDouble = doubles.find((t) => stepsEqual(t.steps, steps))?.dm.id;

  return (
    <>
      <OffFieldNotice slot={slot} lock={lock} />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <TextInput size="sm" icon="search" value={query} onChange={setQuery} placeholder="Search routes (stick, cross, zig, boot flat…)" clearable onClear={() => setQuery("")} aria-label="Search routes" />
        </div>
        <Button size="sm" variant="ghost" icon="flip" active={flipped} onClick={() => setFlipped((v) => !v)} title="Flip: every route below is shown, and put on the player, as its mirror image (an out becomes an in, a wheel goes the other way)">
          Flip
        </Button>
      </div>
      <Disclosure id="route.pick" title="Pick a Route" hint={`${side === "left" ? "Left side" : "Right side"} · "out" = toward the sideline`} defaultOpen={false} forceOpen={!!q}>
        <div className={s.tiles}>
          {shownTiles.map((t) => (
            <button
              key={t.def.id}
              type="button"
              className={cx(s.tile, activePreset?.id === t.def.id && s.tileActive)}
              onClick={() => applyPreset(t.def.id, {}, `Route: ${t.def.label}`)}
              title={t.off ? `${titleCase(t.def.label)} — runs off the field from this player's spot` : titleCase(t.def.label)}
            >
              <MiniRoute set={set} slot={slot} steps={t.steps} size={58} primary={slot === d.vip} />
              <span className={s.tileLabel}>{titleCase(t.def.label)}</span>
              {t.off && <span className={s.offTag}>Off Field</span>}
            </button>
          ))}
        </div>
        {q && !shownTiles.length && <div className={s.emptyBox}>No ready-made route matches "{query.trim()}".</div>}
      </Disclosure>

      {activePreset && <PresetParams preset={activePreset.id} params={activePreset.params} onChange={(p) => applyPreset(activePreset.id, p, "Route settings", 700)} />}

      <MyRoutesSection slot={slot} lock={lock} query={query} flip={flipped} />

      {(!q || shownDoubles.length > 0) && (
      <Disclosure id="route.double" title="Double Moves" hint="Fake, then go" defaultOpen={!!activeDouble} forceOpen={!!q && shownDoubles.length > 0}>
        <div className={s.tiles}>
          {shownDoubles.map((t) => (
            <button
              key={t.dm.id}
              type="button"
              className={cx(s.tile, activeDouble === t.dm.id && s.tileActive)}
              onClick={() => applyDouble(t.dm.id)}
              title={t.off ? `${titleCase(t.dm.label)} — runs off the field from this player's spot` : titleCase(t.dm.label)}
            >
              <MiniRoute set={set} slot={slot} steps={t.steps} size={58} primary={slot === d.vip} />
              <span className={s.tileLabel}>{titleCase(t.dm.label)}</span>
              {t.off && <span className={s.offTag}>Off Field</span>}
            </button>
          ))}
        </div>
      </Disclosure>
      )}

      {(!q || shownScreens.length > 0) && (
        <Disclosure id="route.screens" title="Screen Blocks" hint="Block for the screen" defaultOpen={!!activeScreen} forceOpen={!!q && shownScreens.length > 0}>
          <div className={s.tiles}>
            {shownScreens.map((t) => (
              <button
                key={t.sb.id}
                type="button"
                className={cx(s.tile, activeScreen === t.sb.id && s.tileActive)}
                onClick={() => applyScreen(t.sb.id)}
                title={t.off ? `${t.sb.label} — runs off the field from this player's spot` : t.sb.hint}
              >
                <MiniRoute set={set} slot={slot} steps={t.steps} size={58} primary={slot === d.vip} />
                <span className={s.tileLabel}>{titleCase(t.sb.label)}</span>
                {t.off && <span className={s.offTag}>Off Field</span>}
              </button>
            ))}
          </div>
        </Disclosure>
      )}

      <section className={s.section}>
        <div className={s.sectionHead}>
          <span className={s.sectionTitle}>Route Points</span>
          {hasLegs && <Segmented size="sm" options={[...END_OPTS]} value={end} onChange={(v) => setEnd(v as RouteEnd)} aria-label="At the end of the route" />}
        </div>
        <LegTable slot={slot} lock={lock} />
        <OptionBranches slot={slot} lock={lock} />
      </section>

      <section className={s.section}>
        <div className={s.sectionHead}>
          <span className={s.sectionTitle}>Game Routes</span>
        </div>
        <p className={s.note}>Use any of the 5,400 routes from the game's own plays, drawn from this player's spot.</p>
        <Button size="sm" icon="list" onClick={() => setLibrary(true)} disabled={lock > 0}>
          Browse Game Routes…
        </Button>
        {lock > 0 && <p className={s.note}>Not available while the handoff is kept.</p>}
      </section>
      {library && <RouteLibrary slot={slot} onClose={() => setLibrary(false)} />}
    </>
  );
}

function PresetParams({ preset, params, onChange }: { preset: RoutePresetId; params: Partial<RouteParams>; onChange(p: Partial<RouteParams>): void }) {
  const def = PRESET_BY_ID[preset];
  const p: RouteParams = { ...def.defaults, ...params };
  const set = <K extends keyof RouteParams>(k: K, v: RouteParams[K]) => onChange({ ...params, [k]: v });
  const has = (k: keyof RouteParams) => def.edit.includes(k);
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <span className={s.sectionTitle}>{titleCase(def.label)}</span>
        <span className={s.muted}>Adjust the shape</span>
      </div>
      <div className={s.params}>
        {has("stem") && <NumberField size="sm" label="Depth" value={p.stem} min={0.5} max={40} step={0.5} suffix="yd" onChange={(v) => set("stem", v)} />}
        {has("breakLength") && <NumberField size="sm" label="After Break" value={p.breakLength} min={0} max={50} step={0.5} suffix="yd" onChange={(v) => set("breakLength", v)} />}
        {has("breakAngle") && <NumberField size="sm" label="Angle" value={p.breakAngle} min={0} max={170} step={5} suffix="°" onChange={(v) => set("breakAngle", v)} />}
      </div>
      <div className={s.paramRows}>
        {has("breakDir") && (
          <div className={s.paramRow}>
            <span className={s.fieldLabel}>Break</span>
            <Segmented
              size="sm"
              options={[
                { value: "in", label: "Inside" },
                { value: "out", label: "Outside" },
              ]}
              value={p.breakDir}
              onChange={(v) => set("breakDir", v as "in" | "out")}
            />
          </div>
        )}
        {has("end") && (
          <div className={s.paramRow}>
            <span className={s.fieldLabel}>At the End</span>
            <Segmented size="sm" options={[...END_OPTS]} value={p.end} onChange={(v) => set("end", v as RouteEnd)} />
          </div>
        )}
      </div>
      {(has("release") || has("stemSpeed") || has("breakSpeed")) && (
        <Disclosure id="route.preset.more" title="More Options" hint="Release, speeds">
          {has("release") && (
            <div className={s.paramRow}>
              <span className={s.fieldLabel}>Release</span>
              <Segmented size="sm" options={[...RELEASE_OPTS]} value={p.release} onChange={(v) => set("release", v as RouteParams["release"])} />
            </div>
          )}
          <div className={s.params}>
            {has("stemSpeed") && <NumberField size="sm" label="Speed Before" value={p.stemSpeed} min={10} max={100} step={5} onChange={(v) => set("stemSpeed", v)} />}
            {has("breakSpeed") && <NumberField size="sm" label="Speed After" value={p.breakSpeed} min={10} max={100} step={5} onChange={(v) => set("breakSpeed", v)} />}
          </div>
        </Disclosure>
      )}
    </section>
  );
}
