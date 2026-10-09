// Tiny hash router. Routes look like "#/<view>/<part>/<part>?query".
//   #/playbook                      playbook picker     #/playbook/<encodeURIComponent(path)>         builder (default view)
//   #/library                       library grid        #/library/play/<encodeURIComponent(PlayKey)>  play detail
//   #/playcall                      play-call preview   #/playcall/<encodeURIComponent(path)>         (no top tab: PLAYBOOK)
//   #/overview                      whole-playbook wall #/overview/<encodeURIComponent(path)>[?flip=1] (no top tab: PLAYBOOK)
//   #/designer                      plays files/list    #/designer/<encodeURIComponent(file)>/<index> edit a custom play
//                                                       #/designer/new?set=<SetAsset>&base=<PlayAsset>&file=<path>
//   #/formations                    sets files/list     #/formations/<encodeURIComponent(file)>/<index>
//   #/situations[/<encodeURIComponent(path)>][?s=<situation>]  CPU play-call situations of a playbook
//   #/concepts (no top tab: LIBRARY)   #/export   #/settings[/editor|/data]   #/help[/<section>][?h=<heading id>]
import { useSyncExternalStore } from "react";

export type ViewId = "library" | "playbook" | "playcall" | "overview" | "designer" | "formations" | "situations" | "concepts" | "export" | "settings" | "help";

export const VIEW_IDS: ViewId[] = ["library", "playbook", "playcall", "overview", "designer", "formations", "situations", "concepts", "export", "settings", "help"];

/** Where the app opens and where unknown routes land. */
export const DEFAULT_VIEW: ViewId = "playbook";

/** Views that are overlays on the workflow (top-bar icons), not places to return to. */
const UTILITY_VIEWS: ReadonlySet<ViewId> = new Set<ViewId>(["settings", "help"]);

export interface Route {
  view: ViewId;
  /** Decoded path parts after the view id. */
  parts: string[];
  query: URLSearchParams;
  hash: string;
}

/** Parse a hash ("#/playbook/playbooks%2Fx.json?f=1") into a Route (empty or unknown views → playbook). */
export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "");
  const [path, qs = ""] = raw.split("?");
  const segs = path.split("/").filter(Boolean);
  const view = (VIEW_IDS as string[]).includes(segs[0]) ? (segs[0] as ViewId) : DEFAULT_VIEW;
  return {
    view,
    parts: segs.slice(1).map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    }),
    query: new URLSearchParams(qs),
    hash,
  };
}

let current = parseRoute(typeof location !== "undefined" ? location.hash : "");
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    current = parseRoute(location.hash);
    listeners.forEach((l) => l());
  });
}

export function getRoute(): Route {
  return current;
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

/** Build a hash: href("playbook", "playbooks/FUSION.json") → "#/playbook/playbooks%2FFUSION.json". */
export function href(view: ViewId, ...parts: (string | number)[]): string {
  const p = parts.map((x) => encodeURIComponent(String(x))).join("/");
  return `#/${view}${p ? "/" + p : ""}`;
}

export function navigate(hashOrView: string, opts: { replace?: boolean } = {}): void {
  const hash = hashOrView.startsWith("#") ? hashOrView : `#/${hashOrView}`;
  const here = current.hash || href(current.view);
  if (!opts.replace && hash !== here && trail[trail.length - 1] !== here) {
    trail.push(here);
    if (trail.length > TRAIL_MAX) trail.shift();
  }
  if (opts.replace) history.replaceState(null, "", hash);
  else history.pushState(null, "", hash);
  current = parseRoute(location.hash);
  listeners.forEach((l) => l());
}

// ─────────────────────────────── remembered tab routes ───────────────────────────────
// Each main tab remembers its last sub-route (e.g. the open playbook) so switching tabs lands where you were and
// closing Settings / Help returns to the last main view. App calls rememberRoute on every route change; renames/deletes of
// workspace files must rewrite/forget the routes that name them (rewriteRememberedPath), or a tab reopens a path that
// no longer exists.

// Map order = recency, so lastMainHash() finds the most recent main view.
const remembered = new Map<ViewId, string>();

export function rememberRoute(route: Route): void {
  remembered.delete(route.view);
  remembered.set(route.view, route.hash || `#/${route.view}`);
}

/** The last hash seen for a view (undefined when it was never visited or its file went away). */
export function rememberedHash(view: ViewId): string | undefined {
  return remembered.get(view);
}

/** The most recent hash outside Settings and Help (where closing them goes). */
export function lastMainHash(): string {
  for (const [view, hash] of [...remembered].reverse()) if (!UTILITY_VIEWS.has(view)) return hash;
  return `#/${DEFAULT_VIEW}`;
}

/**
 * A hash with every path part / query value equal to `from` replaced by `to`. Returns the hash unchanged when it
 * doesn't mention `from`, and null when it does and `to` is undefined (the file was deleted: forget the route).
 */
export function rewriteHashPath(hash: string, from: string, to?: string): string | null {
  const r = parseRoute(hash);
  let hit = false;
  const parts = r.parts.map((p) => {
    if (p !== from) return p;
    hit = true;
    return to ?? p;
  });
  const query = new URLSearchParams();
  for (const [k, v] of r.query) {
    if (v === from) hit = true;
    query.append(k, v === from && to !== undefined ? to : v);
  }
  if (!hit) return hash;
  if (to === undefined) return null;
  const qs = query.toString();
  return href(r.view, ...parts) + (qs ? `?${qs}` : "");
}

/**
 * Follow a workspace rename (`to`) or delete (`to` undefined) in every remembered tab route. A deleted file's tab
 * falls back to the view's root (keeping its place in the recency order).
 */
export function rewriteRememberedPath(from: string, to?: string): void {
  for (const [view, hash] of remembered) {
    const next = rewriteHashPath(hash, from, to) ?? `#/${view}`;
    if (next !== hash) remembered.set(view, next);
  }
  for (let i = trail.length - 1; i >= 0; i--) {
    const next = rewriteHashPath(trail[i], from, to);
    if (next === null) trail.splice(i, 1);
    else trail[i] = next;
  }
}

// ─────────────────────────────── where you came from ───────────────────────────────
// Back buttons return to the view that opened the current one (Overview → Play Call → Back lands on the Overview,
// not always the builder). navigate() records the hash it leaves whenever the view changes; a screen asks for its
// back target with a fallback for when it was opened directly (a link, a reload). Entries in the same view are
// skipped unless asked for (a library play detail goes back to the grid, a different view of the same name).

const trail: string[] = [];
const TRAIL_MAX = 40;

const VIEW_LABELS: Record<ViewId, string> = {
  library: "Library",
  playbook: "Playbook",
  playcall: "Play Call",
  overview: "Overview",
  designer: "Designer",
  formations: "Formations",
  situations: "Situations",
  concepts: "Concepts",
  export: "Export",
  settings: "Settings",
  help: "Help",
};

export const viewLabel = (view: ViewId): string => VIEW_LABELS[view];

export interface BackTarget {
  hash: string;
  /** "Playbook", "Overview"… (the destination's name). */
  label: string;
  view: ViewId;
}

/** Where Back goes from `view`: the most recent other view in the trail, else `fallback`. */
export function backTarget(view: ViewId, fallback: string, sameView = false): BackTarget {
  for (let i = trail.length - 1; i >= 0; i--) {
    const r = parseRoute(trail[i]);
    if ((sameView || r.view !== view) && !UTILITY_VIEWS.has(r.view)) return { hash: trail[i], label: VIEW_LABELS[r.view], view: r.view };
  }
  const r = parseRoute(fallback);
  return { hash: fallback, label: VIEW_LABELS[r.view], view: r.view };
}

/** Go back to `backTarget(view, fallback)` and drop the trail down to it (so Back doesn't ping-pong). */
export function goBack(view: ViewId, fallback: string, sameView = false): void {
  const t = backTarget(view, fallback, sameView);
  for (let i = trail.length - 1; i >= 0; i--) {
    if (trail[i] === t.hash) {
      trail.length = i;
      break;
    }
  }
  navigate(t.hash, { replace: true });
}

/** The back target of the current screen, re-read on every route change (for button labels). */
export function useBackTarget(view: ViewId, fallback: string, sameView = false): BackTarget {
  useRoute();
  return backTarget(view, fallback, sameView);
}
