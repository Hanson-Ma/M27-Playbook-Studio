// "Edit this play" from the playbook builder. A custom play from a plays file opens straight in the designer. Any other
// play (a stock library play, or a play cloned into a custom set by tools/m24/convert-fusion.mjs) can't be edited in
// place (FORMATS.md §3), so it becomes an editable copy: a new custom play with the original as its base, written to
// playbooks/plays/<playbook>-edits.json, swapped into the playbook at the same spot (audible and CPU weights stay),
// and opened in the designer.
import { newPlaySpec, playNameProblem, suggestAsset, suggestPlayName } from "../../model/designer";
import { norm } from "../../model/names";
import { slugify } from "../../model/concepts";
import type { PlaybookSpec, PlaysFile } from "../../model/types";
import { getRoute, href, navigate } from "../../state/router";
import { useSettings } from "../../state/settings";
import { useWorkspace } from "../../state/workspace";
import { toast } from "../../ui";
import type { BookNode, BuilderData } from "./context";

/**
 * An editable copy made by "Edit this play" that hasn't been touched yet. Opening a play and leaving without changing
 * anything must leave the playbook exactly as it was (no "Dagger Out 2" swapped in), so leaving the designer with the
 * copy still pristine undoes it (see leaveCopy).
 */
interface PendingCopy {
  file: string;
  index: number;
  bookPath: string;
  original: string;
  copy: string;
  /** The copy's spec as JSON right after it was made: unchanged means the user never edited it. */
  snapshot: string;
}
const pending = new Map<string, PendingCopy>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const copyKey = (file: string, index: number) => file + "#" + index;

/** The designer is showing this play (again): don't roll its copy back (React strict mode mounts twice). */
export function stayCopy(file: string, index: number): void {
  const k = copyKey(file, index);
  const t = timers.get(k);
  if (t) clearTimeout(t);
  timers.delete(k);
}

/** The designer stopped showing this play: if it is still an untouched copy, remove it and put the original back. */
export function leaveCopy(file: string, index: number): void {
  const k = copyKey(file, index);
  const p = pending.get(k);
  if (!p) return;
  stayCopy(file, index);
  timers.set(
    k,
    setTimeout(() => {
      timers.delete(k);
      pending.delete(k);
      const ws = useWorkspace.getState();
      const plays = (ws.docs[p.file]?.data as PlaysFile | null | undefined)?.plays;
      // Only an untouched copy, and only when it is the last play of the file (later plays' indexes must not shift).
      if (!plays || plays.length !== p.index + 1 || JSON.stringify(plays[p.index]) !== p.snapshot) return;
      ws.update<PlaysFile>(p.file, (d) => void d.plays.pop(), { label: `Undo editable copy of ${p.original}` });
      ws.update<PlaybookSpec>(
        p.bookPath,
        (d) => {
          for (const f of d.formations ?? [])
            for (const st of f.sets ?? []) {
              const list = (typeof st === "object" ? st.plays : undefined) as { play?: string }[] | undefined;
              const entry = list?.find((e) => norm(String(e.play ?? "")) === norm(p.copy));
              if (entry) entry.play = p.original;
            }
        },
        { label: `Keep ${p.original}` },
      );
    }, 0),
  );
}

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
  // The copy keeps the original's name and overrides it (playNameProblem allows a play its base's name).
  const name = playNameProblem(data.catalog, play.set, play.name, undefined, play.asset) ? suggestPlayName(data.catalog, play.set, play.name) : play.name;
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
      const plays = (typeof set === "object" ? set.plays : undefined) as { play?: string }[] | undefined;
      // Swap the entry that still names the original play: the one at this spot, else the first one in the set. Never
      // overwrite an entry for another play because the spot moved.
      const same = (e?: { play?: string }) => !!e && norm(String(e.play ?? "")) === norm(play.name);
      const entry = same(plays?.[ref.p!]) ? plays![ref.p!] : plays?.find(same);
      if (entry) entry.play = name;
    });
  } catch (e) {
    toast.error("Couldn't Make an Editable Copy", { detail: e instanceof Error ? e.message : String(e) });
    return;
  }
  const made = (useWorkspace.getState().docs[file]?.data as PlaysFile | null | undefined)?.plays?.[index];
  if (made) pending.set(copyKey(file, index), { file, index, bookPath: data.path, original: play.name, copy: name, snapshot: JSON.stringify(made) });
  toast.success("Editable Copy Made", { detail: `${name} in ${file}. The playbook now uses the copy.`, duration: 4000 });
  navigate(designerHref(file, index));
}
