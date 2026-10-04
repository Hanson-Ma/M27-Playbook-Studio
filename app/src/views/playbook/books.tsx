// Playbook files: new, new from stock template, duplicate, rename, delete — and the "Playbooks" menu in the builder
// header that opens any playbook (v2: there is no separate picker page; #/playbook opens the last / default book).
import { comboLabel } from "../../input/keys";
import { sanitizeBookName, uniqueName } from "../../model/names";
import { deepClone, newPlaybookSpec, playbookPathFor, saveNameFor, stockTemplateSpec } from "../../model/playbook";
import { templateToSpecEntries, type TemplateSkip } from "../../model/tdb";
import type { PlaybookSpec } from "../../model/types";
import { getCatalog, useLibrary } from "../../state/library";
import { navigate } from "../../state/router";
import { useSettings } from "../../state/settings";
import { selectDocsOfKind, useDocsOfKind, useWorkspace, type DocEntry } from "../../state/workspace";
import { MenuButton, confirmDialog, promptDialog, toast, type MenuItem } from "../../ui";
import { SkippedList, skippedLine } from "./skipped";
import { getTemplate, loadTemplate } from "./template";
import s from "./books.module.css";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const bookHref = (path: string) => `#/playbook/${encodeURIComponent(path)}`;
export const openBook = (path: string) => navigate(bookHref(path));

function takenPaths(): Set<string> {
  const st = useWorkspace.getState();
  return new Set([...Object.keys(st.docs), ...st.files.map((f) => f.path)].map((p) => p.toLowerCase()));
}

/** Book names (upper-case file names) already used by playbooks/<name>.json files. */
function takenBookNames(): Set<string> {
  return new Set([...takenPaths()].map((p) => p.replace(/^playbooks\//, "").replace(/\.json$/, "").toUpperCase()));
}

function validateName(v: string, except?: string): string | undefined {
  const n = sanitizeBookName(v);
  if (!n) return "Use letters A–Z and digits 0–9";
  const path = playbookPathFor(n);
  if (path.toLowerCase() !== except?.toLowerCase() && takenPaths().has(path.toLowerCase())) return `${path} already exists`;
  return undefined;
}

const nameBody = (
  <>
    In game the playbook is called <b>PBOOKOFF-&lt;NAME&gt;</b>, so use letters A–Z and digits 0–9 only (anything else is dropped). The file
    is <code>playbooks/&lt;name&gt;.json</code>.
  </>
);

export async function newPlaybook(stock = false): Promise<void> {
  const name = await promptDialog({
    title: stock ? "New playbook from the stock template" : "New playbook",
    label: "Name",
    // A unique default, so Enter creates the playbook right away.
    initial: uniqueName("MYBOOK", takenBookNames(), ""),
    placeholder: "MYBOOK",
    body: stock ? (
      <>
        Starts with every formation, set, play, audible and CPU weight of the game's stock template playbook, ready to edit (special teams
        stay template sections). {nameBody}
      </>
    ) : (
      <>
        Starts empty, with goal line and special teams copied from the template (punt, field goal, kickoff). {nameBody}
      </>
    ),
    confirmLabel: "Create",
    validate: (v) => validateName(v),
  });
  if (!name) return;
  const n = sanitizeBookName(name);
  const path = playbookPathFor(n);
  let spec = newPlaybookSpec(n);
  let leftOut: TemplateSkip[] = [];
  if (stock) {
    const lib = useLibrary.getState().lib;
    const catalog = getCatalog();
    if (!lib || !catalog) {
      toast.error("The play library isn't loaded");
      return;
    }
    await loadTemplate(lib);
    const st = getTemplate();
    if (!st.contents) {
      toast.error("Couldn't read the template playbook", { detail: st.error });
      return;
    }
    // Plays a playbook can't list by name are left out: say which before creating, so nothing is silently dropped.
    const conv = templateToSpecEntries(st.contents, catalog, "offense");
    leftOut = conv.skipped;
    if (conv.skipped.length) {
      const ok = await confirmDialog({
        title: `Create ${saveNameFor({ name: n, side: "offense" })}?`,
        body: (
          <>
            {conv.skipped.length} template play{conv.skipped.length === 1 ? "" : "s"} can't be listed by name in a playbook, so the new
            playbook leaves {conv.skipped.length === 1 ? "it" : "them"} out.
            <SkippedList skipped={conv.skipped} kept={conv.keptAsTemplate} />
          </>
        ),
        confirmLabel: "Create",
      });
      if (!ok) return;
      if (takenPaths().has(path.toLowerCase())) {
        toast.error("Couldn't create the playbook", { detail: `${path} already exists` });
        return;
      }
    }
    spec = stockTemplateSpec(n, conv.entries);
  }
  try {
    useWorkspace.getState().create(path, "playbook", spec);
  } catch (e) {
    toast.error("Couldn't create the playbook", { detail: errMsg(e) });
    return;
  }
  toast.success(`Created ${saveNameFor(spec)}`, {
    detail: `Not saved yet — press Save (${comboLabel("mod+s")}) to write ${path}` + (leftOut.length ? `\nLeft out ${leftOut.length}: ${skippedLine(leftOut)}` : ""),
    duration: leftOut.length ? 8000 : undefined,
  });
  openBook(path);
}

export async function duplicatePlaybook(doc: DocEntry<PlaybookSpec>): Promise<void> {
  if (!doc.data) return;
  const base = sanitizeBookName(String(doc.data.name ?? "")) || "PLAYBOOK";
  const name = await promptDialog({
    title: `Duplicate ${base}`,
    label: "Name of the copy",
    initial: uniqueName(`${base}COPY`, takenBookNames(), ""),
    body: nameBody,
    confirmLabel: "Duplicate",
    validate: (v) => validateName(v),
  });
  if (!name) return;
  const n = sanitizeBookName(name);
  const path = playbookPathFor(n);
  const copy = deepClone(doc.data);
  copy.name = n;
  try {
    useWorkspace.getState().create(path, "playbook", copy);
  } catch (e) {
    toast.error("Couldn't duplicate", { detail: errMsg(e) });
    return;
  }
  toast.success(`Duplicated as ${saveNameFor(copy)}`, { detail: `Not saved yet — press Save (${comboLabel("mod+s")}) to write ${path}` });
  openBook(path);
}

export async function renamePlaybook(doc: DocEntry<PlaybookSpec>): Promise<void> {
  if (!doc.data) return;
  const from = doc.path;
  const name = await promptDialog({
    title: "Rename playbook",
    label: "New name",
    initial: String(doc.data.name ?? ""),
    body: <>Renames the file and the in-game name. {nameBody}</>,
    confirmLabel: "Rename",
    validate: (v) => validateName(v, from),
  });
  if (!name) return;
  const n = sanitizeBookName(name);
  const to = playbookPathFor(n);
  const ws = useWorkspace.getState();
  const wasNew = !!ws.docs[from]?.isNew;
  try {
    if (to !== from) await ws.rename(from, to);
    useWorkspace.getState().update<PlaybookSpec>(to, (d) => void (d.name = n), { label: "Rename playbook" });
    if (!wasNew) await useWorkspace.getState().save(to);
    if (useSettings.getState().lastPlaybook === from) useSettings.getState().set({ lastPlaybook: to });
    toast.success(`Renamed to ${saveNameFor({ name: n, side: doc.data.side })}`, { detail: to });
    if (to !== from) navigate(bookHref(to), { replace: true });
  } catch (e) {
    toast.error("Rename failed", { detail: errMsg(e) });
  }
}

export async function deletePlaybook(doc: DocEntry<PlaybookSpec>, opts: { open?: boolean } = {}): Promise<void> {
  const label = doc.data?.name ? String(doc.data.name) : doc.path;
  const ok = await confirmDialog({
    title: `Delete ${label}?`,
    body: doc.isNew ? "This playbook was never saved; it's discarded." : `${doc.path} moves to app-data/.trash/ (you can restore it from there by hand).`,
    confirmLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  try {
    await useWorkspace.getState().remove(doc.path);
    if (useSettings.getState().lastPlaybook === doc.path) useSettings.getState().set({ lastPlaybook: undefined });
    toast.info(`Deleted ${label}`, { detail: doc.isNew ? undefined : "Moved to app-data/.trash/" });
    // The open playbook is gone: #/playbook opens the default one.
    if (opts.open) navigate("#/playbook", { replace: true });
  } catch (e) {
    toast.error("Delete failed", { detail: errMsg(e) });
  }
}

/** The "Playbooks" menu: open another playbook, create, duplicate / rename / delete the open one. */
export function playbooksMenu(docs: DocEntry<PlaybookSpec>[], current?: DocEntry<PlaybookSpec>): MenuItem[] {
  const ok = !!current && !current.error && !!current.data;
  const items: MenuItem[] = [{ kind: "heading", label: "Open a playbook" }];
  for (const d of docs) {
    const file = d.path.replace(/^playbooks\//, "");
    const name = d.data && typeof d.data === "object" && d.data.name ? String(d.data.name) : file;
    items.push({
      id: d.path,
      label: name,
      icon: "tree",
      checked: d.path === current?.path,
      hint: d.error ? "can't be read" : `${file}${d.dirty ? " · unsaved" : ""}`,
      onSelect: () => d.path !== current?.path && openBook(d.path),
    });
  }
  items.push(
    { kind: "separator" },
    { label: "New playbook…", icon: "plus", onSelect: () => void newPlaybook(false) },
    { label: "New from stock template…", icon: "download", hint: "every stock formation and play", onSelect: () => void newPlaybook(true) },
  );
  if (current)
    items.push(
      { kind: "separator" },
      { label: "Duplicate this playbook…", icon: "duplicate", disabled: !ok, onSelect: () => void duplicatePlaybook(current) },
      { label: "Rename this playbook…", icon: "file", disabled: !ok, onSelect: () => void renamePlaybook(current) },
      { label: "Delete this playbook…", icon: "trash", danger: true, onSelect: () => void deletePlaybook(current, { open: true }) },
    );
  return items;
}

/** Header button: the open playbook's name with the Playbooks menu. */
export function PlaybooksMenuButton({ path, label }: { path?: string; label?: string }) {
  const docs = useDocsOfKind<PlaybookSpec>("playbook");
  const current = path ? docs.find((d) => d.path === path) : undefined;
  return (
    <MenuButton
      className={s.menuBtn}
      icon="tree"
      items={() => {
        // Built when the menu opens, from the latest docs.
        const latest = selectDocsOfKind<PlaybookSpec>(useWorkspace.getState(), "playbook");
        return playbooksMenu(latest, latest.find((d) => d.path === path) ?? current);
      }}
      menuMinWidth={300}
      menuInitialId={path}
      title="Open, create, rename or delete playbooks"
    >
      {label ?? "Playbooks"}
    </MenuButton>
  );
}
