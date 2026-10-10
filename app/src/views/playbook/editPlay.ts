// "Edit this play" from the playbook builder. A custom play from a plays file opens straight in the designer. Any other
// play (a stock library play, or a play cloned into a custom set by tools/m24/convert-fusion.mjs) can't be edited in
// place (FORMATS.md §3), so it becomes an editable copy: a new custom play with the original as its base, written to
// playbooks/plays/<playbook>-edits.json, swapped into the playbook at the same spot (audible and CPU weights stay),
// and opened in the designer.
import { suggestAsset, suggestPlayName, newPlaySpec } from "../../model/designer";
import { slugify } from "../../model/concepts";
import type { PlaybookSpec, PlaysFile } from "../../model/types";
import { getRoute, href, navigate } from "../../state/router";
import { useSettings } from "../../state/settings";
import { useWorkspace } from "../../state/workspace";
import { toast } from "../../ui";
import type { BookNode, BuilderData } from "./context";

export function canEditPlay(node: BookNode): boolean {
  return node.level === "play" && !!node.rp?.play && !node.rf?.template;
}

/** The designer's hash for a play, remembering the builder it was opened from (its Back button returns there). */
const designerHref = (file: string, index: number) => href("designer", file, index) + `?back=${encodeURIComponent(getRoute().hash)}`;

export function editPlay(data: BuilderData, node: BookNode): void {
  const play = node.rp?.play;
  const ref = node.ref;
  if (!play || !ref || ref.s === undefined || ref.p === undefined) {
    toast.info("Can't Edit This Play", { detail: "Only plays you listed yourself can be edited (not template sections)." });
    return;
  }
  // Already a custom play in a plays file: open it.
  if (play.source === "custom" && play.file?.startsWith("playbooks/plays/") && play.index !== undefined) {
    navigate(designerHref(play.file, play.index));
    return;
  }
  const ws = useWorkspace.getState();
  const prefix = useSettings.getState().assetPrefix;
  const name = suggestPlayName(data.catalog, play.set, play.name);
  const asset = suggestAsset(data.catalog, play.set, name, prefix);
  const file = `playbooks/plays/${slugify(String(data.spec.name || "playbook"))}-edits.json`;
  const spec = newPlaySpec({ name, asset, base: play.asset });
  let index = 0;
  try {
    const existing = ws.docs[file];
    if (existing && !existing.error && existing.data) {
      index = (existing.data as PlaysFile).plays.length;
      ws.update<PlaysFile>(file, (d) => void d.plays.push(spec), { label: `Edit copy of ${play.name}` });
    } else {
      ws.create<PlaysFile>(file, "plays", { plays: [spec] });
    }
    // Swap the copy into the playbook where the original was.
    data.edit(`Use edited copy of ${play.name}`, (d: PlaybookSpec) => {
      const set = d.formations?.[ref.f]?.sets?.[ref.s!];
      const entry = (typeof set === "object" ? set.plays?.[ref.p!] : undefined) as { play?: string } | undefined;
      if (entry) entry.play = name;
    });
  } catch (e) {
    toast.error("Couldn't Make an Editable Copy", { detail: e instanceof Error ? e.message : String(e) });
    return;
  }
  toast.success("Editable Copy Made", { detail: `${name} in ${file}. The playbook now uses the copy.`, duration: 4000 });
  navigate(designerHref(file, index));
}
