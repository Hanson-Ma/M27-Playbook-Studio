// ROUTES tab: the per-player route library. Every library assignment, grouped by routeType (left/right variants
// merged, labeled inside/outside for this player), drawn as a MiniRoute from the player's real alignment. Clicking a
// route previews it on the main field; "Use" opens the designer with that slot pre-filled. When app-data/routes.json
// exists, a "My Routes" source lists the user's saved routes (read-only here, mirrored to the player's side).
import { useEffect, useMemo, useRef, useState } from "react";
import { MiniRoute } from "../../field";
import { positionName } from "../../model/positions";
import { ROUTES_PATH, routesOf, savedRouteFor } from "../../model/routeLibrary";
import { replaceBody, sideOfX } from "../../model/routes";
import { routeLibrary, type RouteLibraryGroup, type RouteLibraryItem, type RouteScope } from "../../model/search";
import type { PlayArt, ResolvedPlay, RoutesDoc, SavedRoute, SetDef, Step } from "../../model/types";
import { useCatalog } from "../../state/library";
import { useDoc } from "../../state/workspace";
import { Button, EmptyState, IconButton, Segmented, Tag, TextInput, cx, type SegmentOption } from "../../ui";
import { fmtCount, fmtYd } from "./format";
import type { Preview } from "./PlayDetail";
import { SectionGrid, type GridSection, type SectionGridHandle } from "./SectionGrid";
import s from "./PlayDetail.module.css";

interface RoutesPanelProps {
  play: ResolvedPlay;
  set: SetDef;
  art: PlayArt;
  slot?: number;
  flip: boolean;
  preset?: string;
  preview?: Preview;
  onPreview(p: Preview | undefined): void;
  onStepSlot(d: 1 | -1): void;
  onUse(): void;
  /** "Use in designer" is available (offense / special plays). */
  canUse: boolean;
  defaultScope(slot: number): RouteScope;
}

const OFFENSE_SCOPES: SegmentOption<RouteScope>[] = [
  { value: "routes", label: "Routes" },
  { value: "blocks", label: "Blocks" },
  { value: "backs", label: "Backs" },
  { value: "qb", label: "QB" },
  { value: "all", label: "All" },
];
const DEFENSE_SCOPES: SegmentOption<RouteScope>[] = [
  { value: "defense", label: "Defense" },
  { value: "all", label: "All" },
];
const SPECIAL_SCOPES: SegmentOption<RouteScope>[] = [
  { value: "special", label: "Special" },
  { value: "routes", label: "Routes" },
  { value: "blocks", label: "Blocks" },
  { value: "defense", label: "Defense" },
  { value: "all", label: "All" },
];

type Source = "library" | "mine";

const ROW_H = 74;

/** The saved routes when app-data/routes.json loaded (undefined when the file doesn't exist or can't be read). */
function useMyRoutes(): SavedRoute[] | undefined {
  const doc = useDoc<RoutesDoc>(ROUTES_PATH);
  return useMemo(() => (doc && !doc.error && doc.data ? routesOf(doc.data) : undefined), [doc]);
}

export function RoutesPanel({ play, set, art, slot, flip, preset, preview, onPreview, onStepSlot, onUse, canUse, defaultScope }: RoutesPanelProps) {
  const catalog = useCatalog()!;
  const myRoutes = useMyRoutes();
  const [source, setSource] = useState<Source>("library");
  const [scope, setScope] = useState<RouteScope>(() => (slot !== undefined ? defaultScope(slot) : "routes"));
  const [filter, setFilter] = useState("");
  const grid = useRef<SectionGridHandle>(null);
  const showMine = source === "mine" && !!myRoutes;

  // A new player gets their natural scope.
  const lastSlot = useRef(slot);
  useEffect(() => {
    if (slot !== undefined && slot !== lastSlot.current) setScope(defaultScope(slot));
    lastSlot.current = slot;
  }, [slot, defaultScope]);

  const player = slot !== undefined ? art.players.find((p) => p.slot === slot) : undefined;
  const alignment = slot !== undefined ? set.movements.Normal?.[slot] : undefined;
  // Inside/outside is mirror-invariant: use the unflipped x.
  const playerX = player ? (flip ? -player.snap.x : player.snap.x) : 0;
  const roundedX = Math.round(playerX * 2) / 2;

  const groups = useMemo<RouteLibraryGroup[]>(
    () => (showMine ? [] : routeLibrary(catalog.lib, { scope, filter, playerX: roundedX })),
    [catalog.lib, scope, filter, roundedX, showMine],
  );
  const sections = useMemo<GridSection<RouteLibraryItem>[]>(() => groups.map((g) => ({ key: g.key, items: g.items })), [groups]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const total = flat.length;

  const current = slot !== undefined ? play.slots[slot]?.assignment : undefined;
  const currentIdx = useMemo(() => (current ? flat.findIndex((it) => it.asset === current) : -1), [flat, current]);
  const selected = preview && preview.slot === slot && !preview.item.saved ? flat.findIndex((it) => it.asset === preview.item.asset) : -1;

  // Bring the player's current assignment into view when the player or the list changes.
  useEffect(() => {
    if (selected < 0 && currentIdx >= 0) requestAnimationFrame(() => grid.current?.scrollToFlat(currentIdx, "center"));
  }, [slot, currentIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (i: number) => {
    const item = flat[i];
    if (item && slot !== undefined) onPreview({ slot, item });
  };

  if (slot === undefined || !player || !alignment) {
    return <EmptyState icon="route" title="Pick a player" body="Click a player on the field to browse routes from their alignment." compact />;
  }

  const scopes = play.side === "defense" ? DEFENSE_SCOPES : play.side === "special" ? SPECIAL_SCOPES : OFFENSE_SCOPES;
  const sideText = Math.abs(playerX) < 0.5 ? "over the ball" : playerX < 0 ? "left side" : "right side";
  const primary = slot === play.vip && play.side !== "defense";

  return (
    <div className={s.routes}>
      <div className={s.routesHead}>
        <div className={s.routesPlayer}>
          <IconButton icon="chevronLeft" title="Previous player" size="sm" onClick={() => onStepSlot(-1)} />
          <span className={s.routesWho}>
            <span className={s.slotNum}>{slot}</span>
            <span className={s.playerLabel}>{player.label}</span>
            <span className={s.playerPos}>{positionName(alignment.pos)}</span>
          </span>
          <span className={s.routesX}>
            x <span className={s.routesXNum}>{fmtYd(player.snap.x)}</span> · {sideText}
          </span>
          <IconButton icon="chevronRight" title="Next player" size="sm" onClick={() => onStepSlot(1)} />
        </div>
        {myRoutes && (
          <Segmented
            options={[
              { value: "library", label: "Library routes" },
              { value: "mine", label: `My Routes · ${myRoutes.length}` },
            ]}
            value={source}
            onChange={(v) => setSource(v as Source)}
            size="sm"
            block
            aria-label="Route source"
          />
        )}
        {!showMine && (
          <Segmented options={scopes} value={scopes.some((o) => o.value === scope) ? scope : "all"} onChange={(v) => setScope(v as RouteScope)} size="sm" block aria-label="Route scope" />
        )}
        <TextInput
          value={filter}
          onChange={setFilter}
          placeholder={showMine ? "Filter my routes (name, tag…)" : "Filter routes (curl, wheel, WR_Run90…)"}
          icon="search"
          size="sm"
          clearable
          aria-label="Filter routes"
        />
        {!showMine && (
          <div className={s.routesCount}>
            {fmtCount(total)} assignment{total === 1 ? "" : "s"} · {groups.length} type{groups.length === 1 ? "" : "s"}
            {preset ? " · from the motion preset" : ""}
          </div>
        )}
      </div>
      {showMine ? (
        <MyRoutesList
          routes={myRoutes!}
          filter={filter}
          set={set}
          slot={slot}
          slotSteps={play.slots[slot]?.steps ?? []}
          playerX={playerX}
          flip={flip}
          preset={preset}
          primary={primary}
          previewId={preview && preview.slot === slot ? preview.item.saved : undefined}
          onPreview={(item) => onPreview({ slot, item })}
        />
      ) : (
        <SectionGrid
          ref={grid}
          key={`${slot}|${scope}`}
          sections={sections}
          columns={1}
          minCellWidth={200}
          cellHeight={() => ROW_H}
          headerHeight={34}
          gap={0}
          rowGap={4}
          padding={8}
          sectionGap={10}
          selected={selected}
          onSelect={choose}
          onActivate={(i) => {
            choose(i);
            if (canUse) onUse();
          }}
          getKey={(it) => it.asset}
          padEnd={8}
          renderHeader={(sec, i) => (
            <div className={s.routeGroup}>
              <span>{groups[i]?.label ?? sec.key}</span>
              <span className={s.routeGroupCount}>{sec.items.length}</span>
            </div>
          )}
          renderCell={(it, i, st) => (
            <RouteRow
              item={it}
              set={set}
              slot={slot}
              flip={flip}
              preset={preset}
              primary={primary}
              selected={st.selected}
              current={i === currentIdx}
              onUse={canUse ? onUse : undefined}
            />
          )}
          empty={<EmptyState icon="search" title="No assignments" body={filter ? `Nothing matches “${filter}” in this scope.` : "Nothing in this scope."} compact />}
          aria-label="Route library"
          className={s.routeList}
        />
      )}
    </div>
  );
}

function RouteRow({
  item,
  set,
  slot,
  flip,
  preset,
  primary,
  selected,
  current,
  onUse,
}: {
  item: RouteLibraryItem;
  set: SetDef;
  slot: number;
  flip: boolean;
  preset?: string;
  primary: boolean;
  selected: boolean;
  current: boolean;
  onUse?(): void;
}) {
  return (
    <div className={cx(s.routeRow, selected && s.routeRowOn)} title={item.path}>
      <MiniRoute set={set} slot={slot} steps={item.steps} size={64} flip={flip} preset={preset} primary={primary} selected={selected} />
      <div className={s.routeText}>
        <div className={s.routeTop}>
          <span className={s.routeName}>{item.label}</span>
          {item.side && (
            <Tag tone={item.side === "inside" ? "info" : "neutral"} variant="soft" size="sm">
              {item.side}
            </Tag>
          )}
          {current && (
            <Tag tone="ok" variant="soft" size="sm">
              Current
            </Tag>
          )}
        </div>
        <div className={s.routePath}>{item.path}</div>
      </div>
      {selected && onUse && (
        <Button
          size="sm"
          variant="primary"
          onClick={(e) => {
            e.stopPropagation();
            onUse();
          }}
          className={s.useBtn}
          title="Open a new play in the designer with this route on the player"
        >
          Use in designer
        </Button>
      )}
    </div>
  );
}

// ───────────────────────────── My Routes ─────────────────────────────

interface MineItem {
  route: SavedRoute;
  steps: Step[];
  mirrored: boolean;
}

function MyRoutesList({
  routes,
  filter,
  set,
  slot,
  slotSteps,
  playerX,
  flip,
  preset,
  primary,
  previewId,
  onPreview,
}: {
  routes: SavedRoute[];
  filter: string;
  set: SetDef;
  slot: number;
  slotSteps: Step[];
  playerX: number;
  flip: boolean;
  preset?: string;
  primary: boolean;
  previewId?: string;
  onPreview(item: Preview["item"]): void;
}) {
  const side = sideOfX(playerX);
  const items = useMemo<MineItem[]>(() => {
    const q = filter.trim().toLowerCase();
    return routes
      .filter((r) => !q || r.name.toLowerCase().includes(q) || (r.tags ?? []).some((t) => String(t).toLowerCase().includes(q)))
      .map((r) => {
        const forSide = savedRouteFor(r, side);
        // Keep the player's own motion / realignment in front, like applying it in the designer does.
        let steps: Step[];
        try {
          steps = replaceBody(slotSteps, forSide.steps);
        } catch {
          steps = forSide.steps;
        }
        return { route: r, steps, mirrored: forSide.mirrored };
      });
  }, [routes, filter, side, slotSteps]);

  if (!routes.length)
    return (
      <EmptyState
        icon="route"
        title="No saved routes yet"
        body="Draw a route in the designer and choose “Save route to My Routes” — it shows up here for every player."
        compact
      />
    );
  if (!items.length) return <EmptyState icon="search" title="No routes match" body={`Nothing matches “${filter}”.`} compact />;

  return (
    <div className={s.mineList} role="listbox" aria-label="My Routes">
      {items.map(({ route, steps, mirrored }) => {
        const on = previewId === route.id;
        return (
          <div
            key={route.id}
            role="option"
            aria-selected={on}
            tabIndex={0}
            className={cx(s.routeRow, s.mineRow, on && s.routeRowOn)}
            title={route.notes || route.name}
            onClick={() => onPreview({ asset: `my-routes:${route.id}`, path: "", routeType: route.routeType ?? "", label: route.name, scopes: ["routes"], steps, saved: route.id })}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.currentTarget.click();
              }
            }}
          >
            <MiniRoute set={set} slot={slot} steps={steps} size={64} flip={flip} preset={preset} primary={primary} selected={on} />
            <div className={s.routeText}>
              <div className={s.routeTop}>
                <span className={s.routeName}>{route.name}</span>
                {mirrored && (
                  <Tag tone="info" variant="soft" size="sm" title={`Drawn for the ${route.side} side — mirrored for this player`}>
                    Mirrored
                  </Tag>
                )}
              </div>
              <div className={s.mineMeta}>
                {(route.tags ?? []).length > 0 ? (route.tags ?? []).join(" · ") : `Drawn for the ${route.side} side`}
                {route.source?.label ? ` · from ${route.source.label}` : ""}
              </div>
            </div>
          </div>
        );
      })}
      <p className={s.mineNote}>Preview only — apply saved routes to a player in the designer (Route → My Routes).</p>
    </div>
  );
}
