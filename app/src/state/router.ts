// Tiny hash router. Routes look like "#/<view>/<part>/<part>?query".
//   #/playbook                      playbook picker     #/playbook/<encodeURIComponent(path)>         builder (default view)
//   #/library                       library grid        #/library/play/<encodeURIComponent(PlayKey)>  play detail
//   #/playcall                      play-call preview   #/playcall/<encodeURIComponent(path)>         (no top tab: PLAYBOOK)
//   #/overview                      whole-playbook wall #/overview/<encodeURIComponent(path)>[?flip=1] (no top tab: PLAYBOOK)
//   #/designer                      plays files/list    #/designer/<encodeURIComponent(file)>/<index> edit a custom play
//                                                       #/designer/new?set=<SetAsset>&base=<PlayAsset>&file=<path>
//   #/formations                    sets files/list     #/formations/<encodeURIComponent(file)>/<index>
//   #/concepts (no top tab: LIBRARY)   #/export   #/settings[/editor|/data]   #/help[/<section>][?h=<heading id>]
import { useSyncExternalStore } from "react";

export type ViewId = "library" | "playbook" | "playcall" | "overview" | "designer" | "formations" | "concepts" | "export" | "settings" | "help";

export const VIEW_IDS: ViewId[] = ["library", "playbook", "playcall", "overview", "designer", "formations", "concepts", "export", "settings", "help"];

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
}
