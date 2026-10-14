// "My Routes" in the ROUTE tab: the user's saved routes (app-data/routes.json) drawn from the selected player's
// alignment — mirrored automatically when the player is on the other side — with apply, rename, delete and reorder.
import { useMemo } from "react";
import { MiniRoute } from "../../field";
import { applySavedRoute, slotSide } from "../../model/designer";
import { applySavedRouteSteps, isMotionRoute, isSavedRouteApplied } from "../../model/routeLibrary";
import { hasMechanics, sideOfX } from "../../model/routes";
import type { SavedRoute } from "../../model/types";
import { Disclosure } from "./Disclosure";
import { HelpLink, IconButton, confirmDialog, cx, promptDialog, toast, useContextMenu, type MenuItem } from "../../ui";
import { tileOffField, warnIfOffField } from "./OffField";
import { deleteMyRoute, moveMyRoute, renameMyRoute, useMyRoutes } from "./routesStore";
import { alignmentOf, useDesigner } from "./shared";
import s from "./Inspector.module.css";

export function MyRoutesSection({ slot, lock, query = "", flip = false }: { slot: number; lock: number; query?: string; flip?: boolean }) {
  const d = useDesigner();
  const { state, set, lib, ui, setUi } = d;
  const { routes, error } = useMyRoutes();
  const steps = state.slots[slot].steps;
  const side = slotSide(state, slot);
  const keep = lock > 0 ? lock : undefined;
  const cm = useContextMenu();
  const routeTypes = useMemo(() => new Set(lib.enumValues("AssignRouteType")), [lib]);

  const tiles = useMemo(
    () =>
      routes.map((r) => {
        // A motion route is drawn for the side the player lines up on (a jet crosses the formation); a plain route for the side its legs start on.
        const base = isMotionRoute(r) ? sideOfX(alignmentOf(set, slot).x) : side;
        const eff = flip ? (base === "left" ? "right" : "left") : base;
        const applied = applySavedRouteSteps(steps, r, eff, keep, routeTypes);
        return {
          r,
          // A motion route replaces his motion: it can't go on a player whose handoff precan is kept.
          blocked: isMotionRoute(r) && (!!keep || hasMechanics(steps)),
          steps: applied.steps,
          mirrored: applied.mirrored,
          current: isSavedRouteApplied(steps, r, eff, keep),
          off: tileOffField({ set }, slot, applied.steps),
        };
      }),
    [routes, steps, side, keep, routeTypes, set, slot, flip],
  );

  const apply = (r: SavedRoute) => {
    if (isMotionRoute(r) && (keep || hasMechanics(steps))) {
      toast.info("Motion Routes Aren't Available Here", { detail: "This player's first steps are a handoff, fake or option; they stay as they are." });
      return;
    }
    d.edit((st) => applySavedRoute(st, slot, r, { prefix: d.prefix, keep, routeTypes, flip }), `Route: ${r.name}`);
    setUi((u) => {
      const presets = { ...u.presets };
      delete presets[slot];
      return { presets, vertex: undefined };
    });
    // A route drawn for a slot receiver, mirrored onto a wide receiver, can carry him past the sideline.
    const t = tiles.find((x) => x.r.id === r.id);
    if (t) warnIfOffField(d, slot, t.steps, lock, r.name);
  };

  const rename = async (r: SavedRoute) => {
    const name = await promptDialog({ title: "Rename Route", label: "Route Name", initial: r.name, confirmLabel: "Rename", validate: (v) => (!v.trim() ? "Give the route a name" : undefined) });
    if (name && name.trim() !== r.name && (await renameMyRoute(r.id, name.trim()))) toast.success("Route Renamed", { duration: 2000 });
  };

  const remove = async (r: SavedRoute) => {
    const ok = await confirmDialog({
      title: `Delete "${r.name}" from My Routes?`,
      body: "Plays that already use it keep their route — only the saved copy goes away.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok && (await deleteMyRoute(r.id))) toast.info(`Deleted "${r.name}"`, { duration: 2000 });
  };

  const menu = (r: SavedRoute, i: number): MenuItem[] => [
    { kind: "heading", label: r.name },
    { label: "Use for This Player", icon: "route", onSelect: () => apply(r) },
    { label: "Rename…", onSelect: () => void rename(r) },
    { label: "Move Earlier", icon: "chevronLeft", disabled: i === 0, onSelect: () => void moveMyRoute(r.id, -1) },
    { label: "Move Later", icon: "chevronRight", disabled: i === routes.length - 1, onSelect: () => void moveMyRoute(r.id, 1) },
    { kind: "separator" },
    { label: "Delete…", icon: "trash", danger: true, onSelect: () => void remove(r) },
  ];

  const q = query.trim().toLowerCase();
  // Searching hides the section when none of the saved routes match (the empty-state help isn't a search result).
  if (q && !routes.some((r) => r.name.toLowerCase().includes(q))) return null;
  return (
    <Disclosure
      id="route.mine"
      title="My Routes"
      hint={routes.length ? String(routes.length) : undefined}
      defaultOpen={false}
      forceOpen={!!q}
      right={<HelpLink section="routes" heading="my-routes" label="How It Works" title="Help: My Routes" className={s.helpLink} />}
    >
      {error ? (
        <div className={s.emptyBox}>My Routes couldn't be read ({error}). Fix or remove app-data/routes.json.</div>
      ) : routes.length === 0 ? (
        <div className={s.emptyBox}>
          No saved routes yet. Draw or pick a route, then click <strong>Save Route to My Routes</strong> above — you can reuse it on any play and any player (it flips
          automatically for the other side of the field).
        </div>
      ) : (
        <>
          {[
            { id: "plain", title: "Routes", list: tiles.map((x, i) => ({ x, i })).filter(({ x }) => !isMotionRoute(x.r)) },
            { id: "motion", title: "Motion Routes", list: tiles.map((x, i) => ({ x, i })).filter(({ x }) => isMotionRoute(x.r)) },
          ].map((g) => {
            const shown = g.list.filter(({ x }) => !q || x.r.name.toLowerCase().includes(q));
            if (!shown.length && (q || g.id === "motion")) return null;
            return (
              <div key={g.id} className={s.myGroup}>
                <div className={s.myGroupHead}>
                  {g.title} <span className={s.muted}>{g.list.length}</span>
                </div>
                {shown.length === 0 ? (
                  <div className={s.emptyBox}>No routes saved without motion yet.</div>
                ) : (
                  <div className={s.tiles}>
                    {shown.map(({ x: t, i }) => (
                      <div key={t.r.id} className={s.myTile}>
                        <button
                          type="button"
                          className={cx(s.tile, t.current && s.tileActive)}
                          onClick={() => apply(t.r)}
                          onContextMenu={(e) => cm.open(e, menu(t.r, i))}
                          title={`${t.r.name}${t.mirrored ? " — flipped for this side" : ""}${t.off ? " — runs off the field from this player's spot" : ""}${t.blocked ? " — not available while this player's handoff is kept" : ""}
Click to use · right-click to rename or delete`}
                          style={{ width: "100%", opacity: t.blocked ? 0.45 : undefined }}
                        >
                          <MiniRoute set={set} slot={slot} steps={t.steps} size={58} primary={slot === d.vip} />
                          <span className={s.tileLabel}>{t.r.name}</span>
                          {t.off ? <span className={s.offTag}>Off Field</span> : t.mirrored && <span className={s.mirrorTag}>Flipped</span>}
                        </button>
                        <span className={s.myMenu}>
                          <IconButton
                            icon="list"
                            size="sm"
                            title="Rename, reorder or delete"
                            onClick={(e) => {
                              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              cm.open({ x: r.left, y: r.bottom + 4 }, menu(t.r, i));
                            }}
                          />
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
      {ui.slot === slot && cm.node}
    </Disclosure>
  );
}
