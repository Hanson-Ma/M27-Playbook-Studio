// "My Routes" (pure): the user's saved custom routes in app-data/routes.json (RoutesDoc / SavedRoute in types.ts).
// A saved route is the ROUTE PART of a chain only — release, legs, cuts, end (routes.ts routeBody: no motion,
// realignment or handoff precan) — drawn for one side of the ball. Applying it to a player on the other side mirrors it
// (direction → 180 − d, cut LEFT ⇄ RIGHT; cut types keep their inside/outside meaning), and it replaces only the
// player's route part: their motion / realignment / kept precan stay in front (routes.ts replaceBody).
//
// Doc edits (addRoute / renameRoute / removeRoute / setRouteTags) mutate a draft in place (workspace.update recipes).
import { sanitizeAssetLeaf } from "./names";
import { keptPrefixLength, mirrorRouteType, mirrorSteps, replaceBody, routeBody, toEditableRoute, type RouteSide } from "./routes";
import type { PlayKey, RoutesDoc, SavedRoute, Step } from "./types";

/** Where My Routes live (app-data = editor-only; the game never reads it). */
export const ROUTES_PATH = "app-data/routes.json";

export function emptyRoutesDoc(): RoutesDoc {
  return { version: 1, routes: [] };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A usable saved route (id, name, side, steps); anything else in the file is skipped by `routesOf`. */
export function isSavedRoute(v: unknown): v is SavedRoute {
  return (
    isObj(v) &&
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    (v.side === "left" || v.side === "right") &&
    Array.isArray(v.steps) &&
    v.steps.every((s) => isObj(s) && typeof s.type === "string")
  );
}

/** The doc's routes, tolerant of a malformed file (bad entries are skipped). */
export function routesOf(doc: RoutesDoc | null | undefined): SavedRoute[] {
  return isObj(doc) && Array.isArray(doc.routes) ? doc.routes.filter(isSavedRoute) : [];
}

/** The route part of a slot chain (what "Save route to My Routes" stores). */
export function routePartOf(steps: readonly Step[], keepLeading?: number): Step[] {
  return routeBody(steps, keepLeading);
}

/** A chain can be saved when its route part has at least one leg. */
export function canSaveRoute(steps: readonly Step[], keepLeading?: number): boolean {
  return toEditableRoute(routePartOf(steps, keepLeading)).legs.length > 0;
}

/** Stable id for a new route: slug of the name, unique among `taken`. */
export function newRouteId(name: string, taken: Iterable<string>): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "route";
  const ids = new Set(taken);
  if (!ids.has(slug)) return slug;
  for (let i = 2; ; i++) if (!ids.has(`${slug}-${i}`)) return `${slug}-${i}`;
}

/** A display name not used by another saved route ("Deep over", "Deep over 2"). Case-insensitive. */
export function uniqueRouteName(name: string, routes: readonly SavedRoute[], exceptId?: string): string {
  const base = name.trim() || "My route";
  const taken = new Set(routes.filter((r) => r.id !== exceptId).map((r) => r.name.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

export interface SaveRouteInput {
  name: string;
  /** Side of the ball the route starts on (designer.ts slotSide). */
  side: RouteSide;
  /** The slot's full chain; only its route part is stored. */
  steps: readonly Step[];
  /** Leading steps kept as a precan (lockOf) — they are not part of the route. */
  keepLeading?: number;
  routeType?: string;
  source?: { play?: PlayKey; slot?: number; label?: string };
  /** ISO timestamp (createdAt); omitted when not given (keeps the function pure / testable). */
  createdAt?: string;
  /** Routes already saved (id and name uniqueness). */
  existing?: readonly SavedRoute[];
}

/** A SavedRoute for a slot's chain. Throws when the chain has no route legs to save. */
export function makeSavedRoute(input: SaveRouteInput): SavedRoute {
  const steps = routePartOf(input.steps, input.keepLeading);
  if (!toEditableRoute(steps).legs.length) throw new Error("This player has no route to save yet");
  const existing = input.existing ?? [];
  const name = uniqueRouteName(input.name, existing);
  const r: SavedRoute = {
    id: newRouteId(name, existing.map((x) => x.id)),
    name,
    side: input.side,
    steps: JSON.parse(JSON.stringify(steps)) as Step[],
  };
  if (input.routeType) r.routeType = input.routeType;
  if (input.createdAt) r.createdAt = input.createdAt;
  if (input.source && Object.keys(input.source).length) r.source = { ...input.source };
  return r;
}

export interface RouteForSide {
  /** Route part for the target side (mirrored when the sides differ). */
  steps: Step[];
  routeType?: string;
  mirrored: boolean;
}

/** The saved route as it runs for a player on `side`: mirrored when the route was drawn for the other side. */
export function savedRouteFor(route: SavedRoute, side: RouteSide, validRouteTypes?: ReadonlySet<string>): RouteForSide {
  const steps = route.steps.filter((s) => s.type !== "None");
  if (route.side === side) return { steps: steps.map((s) => ({ ...s })), routeType: route.routeType, mirrored: false };
  return { steps: mirrorSteps(steps), routeType: mirrorRouteType(route.routeType, validRouteTypes), mirrored: true };
}

/**
 * A slot chain with its route part replaced by the saved route (mirrored to `side` when needed): the slot's motion /
 * realignment / kept precan (`keepLeading`) stays in front; a trailing None is added.
 */
export function applySavedRouteSteps(slotSteps: readonly Step[], route: SavedRoute, side: RouteSide, keepLeading?: number, validRouteTypes?: ReadonlySet<string>): { steps: Step[]; routeType?: string; mirrored: boolean } {
  const r = savedRouteFor(route, side, validRouteTypes);
  return { steps: replaceBody(slotSteps, r.steps, keepLeading), routeType: r.routeType, mirrored: r.mirrored };
}

/** Whether a slot's route part already equals the saved route for its side (the tile shows as current). */
export function isSavedRouteApplied(slotSteps: readonly Step[], route: SavedRoute, side: RouteSide, keepLeading?: number): boolean {
  const cur = routePartOf(slotSteps, keepLeading);
  const want = savedRouteFor(route, side).steps;
  return JSON.stringify(canon(cur)) === JSON.stringify(canon(want));
}

function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (isObj(v))
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canon(v[k])]),
    );
  return v;
}

/**
 * Authored assignment name base for a saved route applied to a slot: prefix + the route's name ("PBS_Deep_Over"),
 * with the side when it was mirrored ("PBS_Deep_Over_Lt") so both versions can exist side by side.
 */
export function savedRouteNameBase(prefix: string, routeName: string, mirroredTo?: RouteSide): string {
  const p = sanitizeAssetLeaf(prefix);
  const words = routeName
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("_");
  const body = sanitizeAssetLeaf(words) || "Route";
  const withPrefix = p && !body.toLowerCase().startsWith(p.toLowerCase().replace(/_+$/, "")) ? `${p.replace(/_+$/, "")}_${body}` : body;
  return mirroredTo ? `${withPrefix}_${mirroredTo === "left" ? "Lt" : "Rt"}` : withPrefix;
}

// ───────────────────────────── doc edits (mutate a draft) ─────────────────────────────

function ensureRoutes(draft: RoutesDoc): SavedRoute[] {
  if (!Array.isArray(draft.routes)) draft.routes = [];
  return draft.routes;
}

export function addRoute(draft: RoutesDoc, route: SavedRoute): void {
  if (draft.version === undefined) draft.version = 1;
  ensureRoutes(draft).push(route);
}

/** Rename a saved route (kept unique among the others). Returns the name written, or undefined (unknown id). */
export function renameRoute(draft: RoutesDoc, id: string, name: string): string | undefined {
  const list = ensureRoutes(draft);
  const r = list.find((x) => x?.id === id);
  if (!r) return undefined;
  r.name = uniqueRouteName(name, routesOf(draft), id);
  return r.name;
}

export function removeRoute(draft: RoutesDoc, id: string): boolean {
  const list = ensureRoutes(draft);
  const i = list.findIndex((x) => x?.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  return true;
}

/** Move a route up/down in the list (the order the designer shows). */
export function moveRoute(draft: RoutesDoc, id: string, delta: number): void {
  const list = ensureRoutes(draft);
  const i = list.findIndex((x) => x?.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  const [r] = list.splice(i, 1);
  list.splice(j, 0, r);
}

/** How many leading steps of a chain are not part of its route (re-export for views). */
export { keptPrefixLength };
