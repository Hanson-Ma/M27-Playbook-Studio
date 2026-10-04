// My Routes (app-data/routes.json) from the views: read the list, save / rename / delete / reorder routes. Every
// change is written to disk right away (it's the user's library, not part of the play being edited), and creates
// the file on the first save. Pure logic lives in model/routeLibrary.ts.
import { ROUTES_PATH, addRoute, emptyRoutesDoc, moveRoute, removeRoute, renameRoute, routesOf } from "../../model/routeLibrary";
import type { RoutesDoc, SavedRoute } from "../../model/types";
import { useDoc, useWorkspace } from "../../state/workspace";
import { toast } from "../../ui";

/** The saved routes (empty when the file doesn't exist yet or can't be read). */
export function useMyRoutes(): { routes: SavedRoute[]; error?: string } {
  const doc = useDoc<RoutesDoc>(ROUTES_PATH);
  if (!doc) return { routes: [] };
  if (doc.error) return { routes: [], error: doc.error };
  return { routes: routesOf(doc.data) };
}

/** Current routes, non-hook. */
export function getMyRoutes(): SavedRoute[] {
  const doc = useWorkspace.getState().docs[ROUTES_PATH];
  return doc && !doc.error ? routesOf(doc.data as RoutesDoc) : [];
}

async function persist(what: string): Promise<boolean> {
  try {
    await useWorkspace.getState().save(ROUTES_PATH);
    return true;
  } catch (e) {
    toast.error(`Couldn't save My Routes (${what})`, { detail: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

function change(recipe: (d: RoutesDoc) => void, label: string): boolean {
  const ws = useWorkspace.getState();
  const doc = ws.docs[ROUTES_PATH];
  if (doc?.error) {
    toast.error("My Routes can't be changed", { detail: `${ROUTES_PATH} couldn't be read: ${doc.error}` });
    return false;
  }
  if (!doc) ws.create<RoutesDoc>(ROUTES_PATH, "appdata", emptyRoutesDoc());
  ws.update<RoutesDoc>(ROUTES_PATH, recipe, { label });
  return true;
}

/** Add a route and save the file. Resolves to the saved route's name, or null on failure. */
export async function saveToMyRoutes(route: SavedRoute): Promise<boolean> {
  if (!change((d) => addRoute(d, route), "Save route")) return false;
  return persist("save");
}

export async function renameMyRoute(id: string, name: string): Promise<boolean> {
  if (!change((d) => void renameRoute(d, id, name), "Rename route")) return false;
  return persist("rename");
}

export async function deleteMyRoute(id: string): Promise<boolean> {
  if (!change((d) => void removeRoute(d, id), "Delete route")) return false;
  return persist("delete");
}

export async function moveMyRoute(id: string, delta: number): Promise<boolean> {
  if (!change((d) => moveRoute(d, id, delta), "Reorder routes")) return false;
  return persist("reorder");
}
