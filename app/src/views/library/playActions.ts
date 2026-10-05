// Play-level actions shared by the grid, the context menu and the detail view.
import { leaf } from "../../model/names";
import type { ResolvedPlay, SetsFile } from "../../model/types";
import { href, navigate } from "../../state/router";
import { useSettings } from "../../state/settings";
import { useWorkspace } from "../../state/workspace";
import { toast, type MenuItem } from "../../ui";
import { openAddToPlaybook } from "./AddToPlaybook";

export const playHref = (key: string) => href("library", "play", key);

export function openPlay(key: string): void {
  navigate(playHref(key));
}

export function toggleFavorite(play: ResolvedPlay): void {
  const was = useSettings.getState().favorites.includes(play.key);
  useSettings.getState().toggleFavorite(play.key);
  toast.info(was ? `Removed "${play.name.toUpperCase()}" From Favorites` : `★ Added "${play.name.toUpperCase()}" to Favorites`, { duration: 1800 });
}

/** Library base for designer links: the play itself, or a custom play's base. */
export function designerBase(play: ResolvedPlay): string | undefined {
  return play.source === "library" ? play.asset : play.base;
}

/** `#/designer/new?set=…&base=…[&slot=…&assignment=…]` (cross-view URL contract). */
export function designerNewHref(play: ResolvedPlay, slot?: number, assignmentPath?: string): string | undefined {
  const base = designerBase(play);
  if (!base || !play.set) return undefined;
  const q = new URLSearchParams({ set: play.set, base });
  if (slot !== undefined && assignmentPath) {
    q.set("slot", String(slot));
    q.set("assignment", assignmentPath);
  }
  return `#/designer/new?${q.toString()}`;
}

/** A play cloned into a custom set (it lives in a playbooks/sets/*.json file, edited in Formations). */
export function isSetClone(play: ResolvedPlay): boolean {
  return play.source === "custom" && (!!play.clone || (typeof play.file === "string" && play.file.startsWith("playbooks/sets/")));
}

/** Index of the custom set (in its sets file) that holds a clone. */
function cloneSetIndex(play: ResolvedPlay): number | undefined {
  if (play.clone) return play.clone.setIndex;
  // Fallback: the set whose asset is the play's set leaf.
  const data = play.file ? (useWorkspace.getState().docs[play.file]?.data as SetsFile | null | undefined) : undefined;
  const sets = data && Array.isArray(data.sets) ? data.sets : [];
  const i = sets.findIndex((st) => st && st.asset === leaf(play.set));
  return i >= 0 ? i : undefined;
}

/** `#/designer/<file>/<index>` for custom plays; `#/formations/<file>/<set index>` for clones in a custom set. */
export function designerEditHref(play: ResolvedPlay): string | undefined {
  if (play.source !== "custom" || play.file === undefined) return undefined;
  if (isSetClone(play)) {
    const file = play.clone?.file ?? play.file;
    const si = cloneSetIndex(play);
    return si !== undefined ? href("formations", file, si) : href("formations", file);
  }
  return play.index !== undefined ? href("designer", play.file, play.index) : undefined;
}

/** The play's designer action: edit a custom play (or its custom set), else clone a library play. */
export function designerAction(play: ResolvedPlay): { label: string; enabled: boolean; title?: string; run(): void } {
  if (play.source === "custom") {
    const clone = isSetClone(play);
    return { label: clone ? "Edit in Formations" : "Edit in Designer", enabled: !!designerEditHref(play), run: () => editInDesigner(play) };
  }
  if (play.side === "defense") return { label: "Clone in Designer", enabled: false, title: "The designer builds offensive plays", run: () => {} };
  return { label: "Clone in Designer", enabled: !!designerNewHref(play), run: () => cloneInDesigner(play) };
}

export function cloneInDesigner(play: ResolvedPlay): void {
  const h = designerNewHref(play);
  if (h) navigate(h);
  else toast.warning("This Play Has No Library Base to Clone From");
}

export function editInDesigner(play: ResolvedPlay): void {
  const h = designerEditHref(play);
  if (h) navigate(h);
}

export async function copyText(text: string, what = "Copied"): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(what, { detail: text, duration: 2200 });
  } catch {
    toast.error("Couldn't Copy to the Clipboard", { detail: text });
  }
}

/** Right-click menu for a play card. */
export function playMenuItems(play: ResolvedPlay, opts: { onOpen(): void }): MenuItem[] {
  const fav = useSettings.getState().favorites.includes(play.key);
  const custom = play.source === "custom";
  const design = designerAction(play);
  return [
    { label: "Open", icon: "external", onSelect: opts.onOpen },
    { label: "Add to Playbook…", icon: "plus", onSelect: () => openAddToPlaybook(play.key) },
    { label: design.label, icon: custom ? "route" : "duplicate", disabled: !design.enabled, onSelect: design.run },
    ...(custom && play.base && !isSetClone(play) ? [{ label: "Clone Base in Designer", icon: "duplicate" as const, onSelect: () => cloneInDesigner(play) }] : []),
    { label: fav ? "Remove Favorite" : "Favorite", icon: fav ? "starFilled" : "star", onSelect: () => toggleFavorite(play) },
    { kind: "separator" },
    { label: "Copy Asset Path", icon: "copy", onSelect: () => void copyText(play.asset, "Asset Path Copied") },
    ...(custom && play.file ? [{ label: `Copy File Path (${leaf(play.file)})`, icon: "file" as const, onSelect: () => void copyText(play.file!, "File Path Copied") }] : []),
  ];
}
