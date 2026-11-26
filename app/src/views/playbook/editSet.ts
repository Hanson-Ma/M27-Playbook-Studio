// "Edit Set" from the playbook builder. A custom set opens straight in the Formations editor. One of the game's own
// sets can't be edited in place (FORMATS.md §5), so it becomes an editable copy: a custom set with the same name that
// stands in for it (model/standInSet.ts), with the plays the playbooks list in it, written to
// playbooks/sets/<playbook>-sets.json and opened in the Formations editor. The playbook itself doesn't change.
// Like "Edit this play", leaving the editor without changing anything takes the copy back out.
import { standInSet, standInSetsFile } from "../../model/standInSet";
import { maddenName } from "../../model/names";
import type { PlaysFile, SetsFile } from "../../model/types";
import { getRoute, href, navigate } from "../../state/router";
import { useSettings } from "../../state/settings";
import { selectDocsOfKind, useWorkspace } from "../../state/workspace";
import { toast } from "../../ui";
import type { BookNode, BuilderData } from "./context";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** A copy made by Edit Set that hasn't been touched yet (see leaveSetCopy). */
interface PendingSetCopy {
  file: string;
  index: number;
  /** The sets file didn't exist before: drop it instead of leaving an empty one. */
  newFile: boolean;
  /** The set's spec as JSON right after it was made: unchanged means the user never edited it. */
  snapshot: string;
}
const pending = new Map<string, PendingSetCopy>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const copyKey = (file: string, index: number) => file + "#" + index;

/** The Formations editor is showing this set (again): don't roll its copy back (React strict mode mounts twice). */
export function staySetCopy(file: string, index: number): void {
  const k = copyKey(file, index);
  const t = timers.get(k);
  if (t) clearTimeout(t);
  timers.delete(k);
}

/** The Formations editor stopped showing this set: if it is still an untouched copy, take it back out. */
export function leaveSetCopy(file: string, index: number): void {
  const k = copyKey(file, index);
  const p = pending.get(k);
  if (!p) return;
  staySetCopy(file, index);
  timers.set(
    k,
    setTimeout(() => {
      timers.delete(k);
      pending.delete(k);
      const ws = useWorkspace.getState();
      const doc = ws.docs[p.file];
      // Saved since it was made: the user kept it on purpose.
      if (!doc || !doc.dirty) return;
      const sets = (doc.data as SetsFile | null | undefined)?.sets;
      // Only an untouched copy, and only when it is the file's last set (later sets' indexes must not shift).
      if (!sets || sets.length !== p.index + 1 || JSON.stringify(sets[p.index]) !== p.snapshot) return;
      if (p.newFile && sets.length === 1 && doc.isNew && !(doc.data as SetsFile).formations?.length) void ws.remove(p.file);
      else ws.update<SetsFile>(p.file, (d) => void d.sets.pop(), { label: "Undo editable copy of the set" });
    }, 0),
  );
}

export function canEditSet(node: BookNode): boolean {
  return node.level === "set" && !!node.rs?.set && !node.rf?.template;
}

/** The Formations editor's hash for a set, remembering the builder it was opened from (its Back button returns there). */
const editorHref = (file: string, index: number) => href("formations", file, index) + `?back=${encodeURIComponent(getRoute().hash)}`;

export function editSet(data: BuilderData, node: BookNode): void {
  const set = node.rs?.set;
  if (!set || node.level !== "set" || node.rf?.template) {
    toast.info("Can't Edit This Set", { detail: "Only sets you listed yourself can be edited (not template sections)." });
    return;
  }
  // Already a custom set: open it.
  const origin = data.catalog.customOrigin.get(set.asset);
  if (origin?.kind === "set") {
    navigate(editorHref(origin.file, origin.index));
    return;
  }

  const ws = useWorkspace.getState();
  const file = standInSetsFile(String(data.spec.name || "playbook"));
  const existing = ws.docs[file];
  if (existing?.error) {
    toast.error("Couldn't Make an Editable Copy", { detail: `${file} can't be read: ${existing.error}` });
    return;
  }
  let plan;
  try {
    plan = standInSet(
      set,
      data.catalog,
      {
        playbooks: selectDocsOfKind(ws, "playbook").map((d) => ({ path: d.path, data: d.data })),
        plays: selectDocsOfKind<PlaysFile | null>(ws, "plays").map((d) => ({ path: d.path, data: d.error ? null : d.data })),
        sets: selectDocsOfKind<SetsFile | null>(ws, "sets").map((d) => ({ path: d.path, data: d.error ? null : d.data })),
      },
      { prefix: useSettings.getState().assetPrefix, first: data.path },
    );
  } catch (e) {
    toast.error("Couldn't Make an Editable Copy", { detail: e instanceof Error ? e.message : String(e) });
    return;
  }

  let index = 0;
  const newFile = !existing;
  try {
    if (existing && existing.data) {
      index = (existing.data as SetsFile).sets?.length ?? 0;
      ws.update<SetsFile>(file, (d) => void (d.sets ??= []).push(plan.spec), { label: `Edit copy of ${set.name}` });
    } else {
      ws.create<SetsFile>(file, "sets", { sets: [plan.spec] });
    }
  } catch (e) {
    toast.error("Couldn't Make an Editable Copy", { detail: e instanceof Error ? e.message : String(e) });
    return;
  }
  const made = (useWorkspace.getState().docs[file]?.data as SetsFile | null | undefined)?.sets?.[index];
  if (made) pending.set(copyKey(file, index), { file, index, newFile, snapshot: JSON.stringify(made) });

  const name = maddenName(set.name);
  const others = plan.books.filter((b) => b !== data.path).length;
  const detail = [
    `Your own ${name} with ${plural(plan.spec.plays?.length ?? 0, "play")}, in ${file}.`,
    others ? `It replaces the game's ${name} in this playbook and ${plural(others, "other playbook")}.` : `It replaces the game's ${name} in this playbook.`,
    plan.missing.length ? `Left out (not found in the set): ${plan.missing.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  toast.success("Editable Copy Made", { detail, duration: plan.missing.length ? 9000 : 5000 });
  navigate(editorHref(file, index));
}
