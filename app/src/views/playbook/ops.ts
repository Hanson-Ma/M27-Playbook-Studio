// Builder commands shared by the buttons, context menus, editor keys and drag-and-drop. Each edit is one undo step
// through the workspace store; selection follows the edited entries by their stable ids.
import { createElement, type KeyboardEvent } from "react";
import { IS_MAC, comboLabel } from "../../input/keys";
import { clipboardStore, clipLabel, pasteInto, pasteSummary, type ClipEntry, type ClipItem, type ClipKind, type PasteResult } from "../../model/clipboard";
import { addPlayProblem, addPlayToSpec, nameAddressProblem } from "../../model/playbookOps";
import {
  addFormation,
  addSet,
  bookIds,
  convertTemplateFormation,
  cpuOf,
  deepClone,
  duplicateRefs,
  getFormation,
  getSet,
  idOf,
  insertPlays,
  moveFormations,
  movePlays,
  moveSets,
  removeRefs,
  setAudible,
  setCpuWeights,
  type DropWhere,
  type EntryRef,
} from "../../model/playbook";
import { templatePlayProblem, templateFormationToEntry, type TemplateSkip } from "../../model/tdb";
import type { AudibleSlot, FormationEntry, PlayEntry, PlayKey, PlaybookSpec, SetEntry } from "../../model/types";
import { navigate } from "../../state/router";
import { useWorkspace } from "../../state/workspace";
import { confirmDialog, toast } from "../../ui";
import type { BookNode, BuilderData } from "./context";
import { SkippedList, skippedLine } from "./skipped";
import { BOOK_ID, levelOf, parentOf, useBuilderUi } from "./store";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function latestSpec(path: string): PlaybookSpec | undefined {
  const d = useWorkspace.getState().docs[path];
  return d && !d.error ? (d.data as PlaybookSpec) : undefined;
}

/** Select entries by ref in the current (just edited) spec. */
export function selectRefs(path: string, refs: EntryRef[], cursor?: EntryRef): void {
  const spec = latestSpec(path);
  if (!spec || !refs.length) return;
  const ids = bookIds(spec);
  const list = refs.map((r) => idOf(ids, r)).filter((x): x is string => !!x);
  const c = cursor ? idOf(ids, cursor) : list[list.length - 1];
  if (list.length) useBuilderUi.getState().selectMany(list, c);
}

/** Selected nodes, in selection order (falls back to the cursor). */
export function selectedNodes(data: BuilderData): BookNode[] {
  const ui = useBuilderUi.getState();
  const list = ui.selected.map((id) => data.nodes.get(id)).filter((n): n is BookNode => !!n);
  if (list.length) return list;
  const c = data.nodes.get(ui.cursor);
  return c ? [c] : [];
}

/** Refs of the selected book entries (no book root, no template rows). */
export function selectedRefs(data: BuilderData): EntryRef[] {
  return selectedNodes(data)
    .filter((n) => n.level === "formation" || n.level === "set" || n.level === "play")
    .map((n) => n.ref!)
    .filter(Boolean);
}

export function cursorNode(data: BuilderData): BookNode | undefined {
  return data.nodes.get(useBuilderUi.getState().cursor) ?? data.nodes.get(BOOK_ID);
}

// ───────────────────────────── copy / paste ─────────────────────────────

/** A template set as an explicit entry (plays a spec can't list by name are left out and reported). */
function templateSetEntry(data: BuilderData, n: BookNode, skipped: TemplateSkip[]): SetEntry | undefined {
  if (!n.tf || !n.ts) return undefined;
  const conv = templateFormationToEntry({ formation: n.tf.formation, sets: [n.ts] }, data.catalog, data.side, { template: data.template.contents });
  skipped.push(...conv.skipped);
  return Array.isArray(conv.entry.sets) ? conv.entry.sets[0] : undefined;
}

/** Copy the selection (or the cursor's entries) to the clipboard. */
export function copySelection(data: BuilderData): ClipItem | undefined {
  const nodes = selectedNodes(data);
  if (!nodes.length) return undefined;
  const level = nodes[0].level;
  let kind: ClipKind;
  let entries: ClipEntry[] = [];
  let from: string | undefined;
  const skipped: TemplateSkip[] = [];
  if (level === "book") {
    kind = "formation";
    entries = (data.spec.formations ?? []).map((e) => deepClone(e));
    from = String(data.spec.name ?? "");
  } else if (level === "formation") {
    kind = "formation";
    entries = nodes.map((n) => deepClone(getFormation(data.spec, n.ref!.f)!)).filter(Boolean);
  } else if (level === "set") {
    kind = "set";
    entries = nodes.map((n) => deepClone(getSet(data.spec, n.ref!.f, n.ref!.s!)!)).filter(Boolean);
    from = nodes[0].rf?.entry.formation;
  } else if (level === "play") {
    kind = "plays";
    entries = nodes.map((n) => deepClone(n.rp!.entry));
    from = `${nodes[0].rf?.entry.formation} · ${nodes[0].rs?.entry.set}`;
  } else if (level === "tset") {
    kind = "set";
    entries = nodes.map((n) => templateSetEntry(data, n, skipped)).filter((e): e is SetEntry => !!e);
    from = `${nodes[0].tf?.formation.name} (template)`;
  } else {
    kind = "plays";
    entries = nodes
      .filter((n) => {
        const why = n.tp && n.ts ? templatePlayProblem(n.ts, n.tp, data.catalog, data.side, { template: data.template.contents }) : "not a template play";
        if (why && n.tp && n.ts && n.tf)
          skipped.push({ formation: n.tf.formation.name, set: n.ts.set.name, play: n.tp.play.name, asset: n.tp.play.asset, reason: why });
        return !why;
      })
      .map((n) => {
        const e: PlayEntry = { play: n.tp!.play.name };
        if (n.tp!.audible) e.audible = n.tp!.audible;
        if (n.tp!.cpu) e.cpu = { ...n.tp!.cpu };
        return e;
      });
    from = `${nodes[0].tf?.formation.name} · ${nodes[0].ts?.set.name} (template)`;
  }
  const leftOut = skipped.length ? `Left out (can't be listed by name): ${skippedLine(skipped)}` : undefined;
  if (!entries.length) {
    toast.info("Nothing to copy", { detail: leftOut });
    return undefined;
  }
  const item = clipboardStore.getState().push({ kind, sourcePath: data.path, label: clipLabel(kind, entries), entries, from });
  const count = kind === "plays" ? undefined : `${plural(entries.length, kind === "formation" ? "formation" : "set")}`;
  toast.success(`Copied ${item.label}`, { detail: [count, leftOut].filter(Boolean).join("\n") || undefined, duration: leftOut ? 6000 : 2200 });
  return item;
}

/** Paste a clipboard item (default: the newest) at the cursor. */
export function pasteAtSelection(data: BuilderData, item?: ClipItem): void {
  const it = item ?? clipboardStore.getState().items[0];
  if (!it) {
    toast.info("The clipboard is empty", { detail: "Copy formations, sets or plays first (right-click → Copy)." });
    return;
  }
  const node = cursorNode(data);
  if (node && (node.level === "tset" || node.level === "tplay" || (node.level === "formation" && node.rf?.template && it.kind !== "formation"))) {
    toast.error("Can't paste into a template section", { detail: "Convert it to explicit sets first." });
    return;
  }
  const target = node?.ref;
  let result: PasteResult | undefined;
  data.edit(`Paste ${it.label}`, (d) => {
    result = pasteInto(d, data.catalog, it, target);
  });
  if (!result) return;
  const sum = pasteSummary(result);
  toast[sum.level](sum.message, { detail: sum.detail });
  if (result.added.length) selectRefs(data.path, result.added);
}

// ───────────────────────────── remove / duplicate ─────────────────────────────

/** What removing these nodes takes out of the book, e.g. "SHOTGUN with 2 sets and 9 plays". */
function removalSummary(nodes: BookNode[]): string {
  const first = nodes[0];
  let sets = 0;
  let plays = 0;
  let template = 0;
  for (const n of nodes) {
    if (n.level === "formation" && n.rf) {
      if (n.rf.template) template++;
      sets += n.rf.sets.length;
      plays += n.rf.sets.reduce((k, rs) => k + rs.plays.length, 0);
    } else if (n.level === "set" && n.rs) plays += n.rs.plays.length;
  }
  const what = nodes.length === 1 ? labelOf(first) : plural(nodes.length, first.level);
  const parts = [sets ? plural(sets, "set") : "", plays ? plural(plays, "play") : ""].filter(Boolean);
  const tpl = template ? ` (${template === nodes.length && nodes.length === 1 ? "a template section" : plural(template, "template section")})` : "";
  return parts.length ? `${what}${tpl} with ${parts.join(" and ")}` : `${what}${tpl}`;
}

/**
 * Remove the selected entries. Plays go at once (with an undo toast); formations and sets ask first, because one
 * click takes a whole branch out of the book.
 */
export async function removeSelection(data: BuilderData): Promise<void> {
  const nodes = selectedNodes(data).filter((n) => n.level === "formation" || n.level === "set" || n.level === "play");
  if (!nodes.length) return;
  const first = nodes[0];
  if (nodes.some((n) => n.level !== "play")) {
    const ok = await confirmDialog({
      title: `Remove ${nodes.length === 1 ? labelOf(first) : plural(nodes.length, first.level)}?`,
      body: `${removalSummary(nodes)} leaves this playbook. Undo (${comboLabel("mod+z")}) brings it back until you close the app.`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    // The book may have changed while the dialog was open: only remove entries that are still where they were.
    const spec = latestSpec(data.path);
    if (!spec) return;
    const ids = bookIds(spec);
    if (nodes.some((n) => idOf(ids, n.ref!) !== n.id)) {
      toast.warning("Nothing removed", { detail: "The playbook changed while the dialog was open. Select the entries again." });
      return;
    }
  }
  const refs = nodes.map((n) => n.ref!);
  let removed = 0;
  data.edit(`Remove ${plural(nodes.length, first.level)}`, (d) => {
    removed = removeRefs(d, refs);
  });
  if (!removed) return;
  // Select what now sits where the first removed entry was (so repeated removes walk the list), else the parent.
  const spec = latestSpec(data.path);
  const r0 = first.ref!;
  let next: EntryRef | undefined;
  if (spec) {
    if (first.level === "play") {
      const n = getSet(spec, r0.f, r0.s!)?.plays?.length ?? 0;
      const at = Math.min(...refs.filter((r) => r.f === r0.f && r.s === r0.s).map((r) => r.p!));
      if (n > 0) next = { f: r0.f, s: r0.s, p: Math.min(at, n - 1) };
      else next = { f: r0.f, s: r0.s };
    } else if (first.level === "set") {
      const fe = getFormation(spec, r0.f);
      const n = Array.isArray(fe?.sets) ? fe.sets.length : 0;
      const at = Math.min(...refs.filter((r) => r.f === r0.f).map((r) => r.s!));
      next = n > 0 ? { f: r0.f, s: Math.min(at, n - 1) } : { f: r0.f };
    } else {
      const n = spec.formations?.length ?? 0;
      const at = Math.min(...refs.map((r) => r.f));
      if (n > 0) next = { f: Math.min(at, n - 1) };
    }
  }
  if (next) selectRefs(data.path, [next]);
  else useBuilderUi.getState().select(BOOK_ID);
  const label = nodes.length === 1 ? labelOf(first) : plural(nodes.length, first.level);
  toast.info(`Removed ${label}`, {
    detail: `Undo: ${comboLabel("mod+z")}`,
    action: { label: "Undo", run: () => useWorkspace.getState().undo(data.path) },
    duration: 6000,
  });
}

/** Move the selection one step up/down among its siblings (the Move up / Move down buttons). */
export function nudgeSelection(data: BuilderData, dir: -1 | 1): void {
  const nodes = selectedNodes(data).filter((n) => n.level === "formation" || n.level === "set" || n.level === "play");
  if (!nodes.length) return;
  const parent = parentOf(nodes[0].id);
  const same = nodes.filter((n) => parentOf(n.id) === parent);
  const refs = same.map((n) => n.ref!);
  const idx = refs.map((r) => (r.p ?? r.s ?? r.f) as number).sort((a, b) => a - b);
  const r0 = refs[0];
  const len =
    nodes[0].level === "play"
      ? (getSet(data.spec, r0.f, r0.s!)?.plays?.length ?? 0)
      : nodes[0].level === "set"
        ? (Array.isArray(getFormation(data.spec, r0.f)?.sets) ? (getFormation(data.spec, r0.f)!.sets as SetEntry[]).length : 0)
        : (data.spec.formations?.length ?? 0);
  const target = dir < 0 ? idx[0] - 1 : idx[idx.length - 1] + 1;
  if (target < 0 || target >= len) return;
  const t: EntryRef = nodes[0].level === "play" ? { f: r0.f, s: r0.s, p: target } : nodes[0].level === "set" ? { f: r0.f, s: target } : { f: target };
  moveEntries(data, refs, t, dir < 0 ? "before" : "after");
}

export function duplicateSelection(data: BuilderData): void {
  const refs = selectedRefs(data);
  if (!refs.length) return;
  let out: EntryRef[] = [];
  data.edit("Duplicate", (d) => {
    out = duplicateRefs(d, refs);
  });
  if (out.length) {
    selectRefs(data.path, out);
    const lvl = levelOf(useBuilderUi.getState().cursor);
    toast.info(`Duplicated ${plural(out.length, lvl === "play" ? "play" : lvl)}`, {
      detail: lvl === "play" ? "Copies drop the audible slot. A play listed twice in a set is a validation warning." : undefined,
      duration: 3000,
    });
  }
}

export function labelOf(n: BookNode): string {
  if (n.level === "book") return "Playbook";
  if (n.level === "formation") return String(n.rf?.entry.formation ?? "Formation");
  if (n.level === "set") return String(n.rs?.entry.set ?? "Set");
  if (n.level === "play") return String(n.rp?.entry.play ?? "Play");
  if (n.level === "tset") return n.ts?.set.name ?? "Set";
  return n.tp?.play.name ?? "Play";
}

// ───────────────────────────── template sections ─────────────────────────────

/**
 * "Convert to editable": copy a template section's sets, plays, audibles and CPU weights into editable entries.
 * Plays a playbook can't list by name (filed under another set in the stock save, or a name that resolves to another
 * play) are left out — listed first, so the user can cancel.
 */
export async function convertTemplate(data: BuilderData, f: number): Promise<void> {
  const node = [...data.nodes.values()].find((n) => n.level === "formation" && n.ref?.f === f);
  const tf = node?.tf;
  if (!node?.rf?.template) return;
  const name = String(node.rf.entry.formation);
  if (!tf) {
    const why =
      data.template.status === "error"
        ? `The template playbook couldn't be read: ${data.template.error}`
        : data.template.status === "ready"
          ? `The template playbook has no "${name}" sets`
          : "The template playbook is still loading";
    toast.error("Can't convert", { detail: why });
    return;
  }
  const conv = templateFormationToEntry(tf, data.catalog, data.side, { template: data.template.contents });
  if (conv.problem) {
    toast.error(`Can't convert ${name}`, { detail: conv.problem, duration: 9000 });
    return;
  }
  if (conv.skipped.length) {
    const ok = await confirmDialog({
      title: `Make ${tf.formation.name} editable?`,
      body: createElement(
        "div",
        null,
        `${plural(conv.skipped.length, "template play")} can't be listed by name in a playbook, so the converted section leaves ` +
          `${conv.skipped.length === 1 ? "it" : "them"} out. Keep the section as a template section to keep them.`,
        createElement(SkippedList, { skipped: conv.skipped }),
      ),
      confirmLabel: "Convert",
    });
    if (!ok) return;
    // Only convert what the dialog described: the section must still be the same template entry.
    const spec = latestSpec(data.path);
    const ids = spec ? bookIds(spec) : undefined;
    if (!spec || !ids || idOf(ids, { f }) !== node.id || getFormation(spec, f)?.sets !== "template") {
      toast.warning("Nothing converted", { detail: "The playbook changed while the dialog was open." });
      return;
    }
  }
  const sets = Array.isArray(conv.entry.sets) ? conv.entry.sets : [];
  data.edit(`Make ${tf.formation.name} editable`, (d) => convertTemplateFormation(d, f, conv.entry));
  const plays = sets.reduce((k, x) => k + (x.plays?.length ?? 0), 0);
  toast.success(`${tf.formation.name}: ${plural(sets.length, "set")} · ${plural(plays, "play")} now editable`, {
    detail: conv.skipped.length ? `Left out ${conv.skipped.length}: ${skippedLine(conv.skipped)}` : undefined,
    duration: conv.skipped.length ? 8000 : 3000,
  });
  useBuilderUi.getState().expand(node.id, true);
}

// ───────────────────────────── add ─────────────────────────────

export function addFormationByAsset(data: BuilderData, asset: string): void {
  const formation = data.lib.formationByAsset.get(asset);
  if (!formation) return;
  let f = -1;
  data.edit(`Add ${formation.name}`, (d) => {
    f = addFormation(d, formation.name);
  });
  if (f >= 0) selectRefs(data.path, [{ f }]);
}

export function addSetByAsset(data: BuilderData, f: number, asset: string): void {
  const set = data.lib.setByAsset.get(asset);
  if (!set) return;
  let s = -1;
  data.edit(`Add ${set.name}`, (d) => {
    s = addSet(d, f, set.name);
  });
  if (s >= 0) selectRefs(data.path, [{ f, s }]);
}

/**
 * Add catalog plays to the book (creating formation/set entries as needed, FORMATS.md name rules). With `into`, only
 * plays of that set are added there, at `at` (default: the end). Returns how many were added.
 */
export function addPlays(data: BuilderData, keys: PlayKey[], into?: { f: number; s: number; at?: number }): number {
  const skipped: string[] = [];
  const already: string[] = [];
  const added: EntryRef[] = [];
  const intoSet = into ? data.book.formations[into.f]?.sets[into.s]?.set : undefined;
  data.edit(`Add ${plural(keys.length, "play")}`, (d) => {
    let at = into?.at;
    for (const key of keys) {
      const play = data.catalog.get(key);
      if (!play) continue;
      // Into a chosen set: only the name rule. Otherwise addPlayToSpec's rule (it throws on a play whose formation is
      // a "template" section of the book — convert it to explicit first).
      const problem = into ? nameAddressProblem(data.catalog, key, data.side, { template: data.template.contents }) : addPlayProblem(d, data.catalog, key, { template: data.template.contents });
      if (problem) {
        skipped.push(`${play.name} — ${problem}`);
        continue;
      }
      if (into) {
        if (!intoSet || play.set !== intoSet.asset) {
          skipped.push(`${play.name} — belongs to ${data.lib.setByAsset.get(play.set)?.name ?? "another set"}`);
          continue;
        }
        const se = getSet(d, into.f, into.s)!;
        if (se.plays?.some((e) => data.catalog.playInSetByName(intoSet.asset, String(e.play ?? ""))?.key === key)) {
          already.push(play.name);
          continue;
        }
        const [p] = insertPlays(d, into.f, into.s, [{ play: play.name }], at);
        if (at !== undefined) at = p + 1;
        added.push({ f: into.f, s: into.s, p });
        continue;
      }
      const loc = addPlayToSpec(d, data.catalog, key, undefined, { template: data.template.contents });
      if (loc.added) added.push({ f: loc.f, s: loc.s, p: loc.p });
      else already.push(play.name);
    }
  });
  const details = [
    skipped.length ? `Skipped: ${skipped.join("; ")}` : "",
    already.length ? `Already in the book: ${already.join(", ")}` : "",
  ].filter(Boolean);
  if (added.length) {
    toast.success(`Added ${plural(added.length, "play")}`, { detail: details.join("\n") || undefined, duration: details.length ? 6000 : 2500 });
    selectRefs(data.path, added);
  } else toast.warning("Nothing added", { detail: details.join("\n") || undefined });
  return added.length;
}

// ───────────────────────────── moves (drag and drop) ─────────────────────────────

export function moveEntries(data: BuilderData, refs: EntryRef[], target: EntryRef, where: DropWhere): void {
  if (!refs.length) return;
  const level = refs[0].p !== undefined ? "play" : refs[0].s !== undefined ? "set" : "formation";
  let out: number[] = [];
  data.edit(`Move ${plural(refs.length, level)}`, (d) => {
    if (level === "formation") out = moveFormations(d, refs.map((r) => r.f), target.f, where);
    else if (level === "set") out = moveSets(d, target.f, refs.map((r) => r.s!), target.s!, where);
    else out = movePlays(d, target.f, target.s!, refs.map((r) => r.p!), target.p!, where);
  });
  if (!out.length) return;
  const newRefs = out.map((i) => (level === "formation" ? { f: i } : level === "set" ? { f: target.f, s: i } : { f: target.f, s: target.s, p: i }));
  selectRefs(data.path, newRefs);
}

// ───────────────────────────── audibles / weights ─────────────────────────────

export function setAudibleAt(data: BuilderData, ref: EntryRef, slot: AudibleSlot | undefined): void {
  if (ref.s === undefined || ref.p === undefined) return;
  data.edit(slot ? `Audible ${slot}` : "Clear audible", (d) => {
    const se = getSet(d, ref.f, ref.s!);
    if (se) setAudible(se, ref.p!, slot);
  });
}

export function copyWeights(data: BuilderData, n: BookNode): void {
  const cpu = n.rp ? cpuOf(n.rp.entry) : n.tp?.cpu ?? {};
  const name = n.rp?.entry.play ?? n.tp?.play.name ?? "";
  clipboardStore.getState().setWeights({ cpu, from: String(name) });
  toast.success(`Copied ${plural(Object.keys(cpu).length, "weight")}`, { detail: String(name), duration: 2000 });
}

export function pasteWeights(data: BuilderData, refs: EntryRef[]): void {
  const w = clipboardStore.getState().weights;
  if (!w) {
    toast.info("No weights copied yet");
    return;
  }
  const plays = refs.filter((r) => r.p !== undefined);
  if (!plays.length) return;
  data.edit(`Paste weights to ${plural(plays.length, "play")}`, (d) => {
    for (const r of plays) {
      const e = getSet(d, r.f, r.s!)?.plays?.[r.p!];
      if (e) setCpuWeights(e, w.cpu);
    }
  });
  toast.success(`Pasted weights from ${w.from} to ${plural(plays.length, "play")}`, { duration: 2500 });
}

export function clearWeights(data: BuilderData, refs: EntryRef[]): void {
  const plays = refs.filter((r) => r.p !== undefined);
  data.edit(`Clear weights`, (d) => {
    for (const r of plays) {
      const e = getSet(d, r.f, r.s!)?.plays?.[r.p!];
      if (e) setCpuWeights(e, undefined);
    }
  });
}

// ───────────────────────────── navigation ─────────────────────────────

export function openInLibrary(key: PlayKey): void {
  navigate(`#/library/play/${encodeURIComponent(key)}`);
}

/** Explicit formation entries of the clipboard item kinds (for the clipboard panel's preview). */
export function clipCount(item: ClipItem): string {
  if (item.kind === "plays") return plural(item.entries.length, "play");
  if (item.kind === "set") {
    const n = (item.entries as SetEntry[]).reduce((k, e) => k + (e.plays?.length ?? 0), 0);
    return `${plural(item.entries.length, "set")} · ${plural(n, "play")}`;
  }
  const sets = (item.entries as FormationEntry[]).reduce((k, e) => k + (Array.isArray(e.sets) ? e.sets.length : 0), 0);
  return `${plural(item.entries.length, "formation")} · ${plural(sets, "set")}`;
}

// ───────────────────────────── editor keys ─────────────────────────────

/**
 * Universal editor keys for the focused tree / card grid: Delete / Backspace remove, ⌘/Ctrl+C copy, ⌘/Ctrl+V paste,
 * ⌘/Ctrl+D duplicate, Esc drops a multi-selection. Returns true when the key was handled (the caller prevents the
 * default). Every one of these also has a visible button or menu item.
 */
export function editorKey(data: BuilderData, e: KeyboardEvent): boolean {
  const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  const key = e.key.toLowerCase();
  if (e.altKey) return false;
  if (!mod && !e.shiftKey && (e.key === "Delete" || e.key === "Backspace")) {
    void removeSelection(data);
    return true;
  }
  if (!mod && e.key === "Escape") {
    const ui = useBuilderUi.getState();
    if (ui.selected.length < 2) return false;
    ui.selectMany([ui.cursor], ui.cursor);
    return true;
  }
  if (!mod || e.shiftKey) return false;
  if (key === "c") copySelection(data);
  else if (key === "v") pasteAtSelection(data);
  else if (key === "d") duplicateSelection(data);
  else return false;
  return true;
}
