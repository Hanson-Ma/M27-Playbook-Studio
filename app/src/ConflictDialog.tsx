// Save conflicts (state/workspace.ts): a save was refused because the file changed on disk since it was loaded (an
// editor, git, the game PC's sync, a second browser tab), or the window-focus re-check flagged a doc with unsaved
// edits as `changedOnDisk`. One dialog at a time with the three ways out — Reload from disk, Overwrite, Save a
// copy — or Later (Esc). App mounts <ConflictHost/> once; refused saves open it on their own, and the DocChip's
// "changed on disk" marker opens it for the active doc (openConflict).
import { useState } from "react";
import { create } from "zustand";
import { comboLabel } from "./input/keys";
import { useWorkspace, type ConflictChoice, type DocConflict } from "./state/workspace";
import { Button, Modal, toast } from "./ui";
import s from "./ConflictDialog.module.css";

interface ConflictUi {
  /** A path the user asked to settle (DocChip marker), shown even without a refused save. */
  requested?: string;
  /** Bumped when a conflict is put off (the dismissed set isn't reactive). */
  tick: number;
}
const useConflictUi = create<ConflictUi>(() => ({ tick: 0 }));
/** Conflict records the user put off with "Later" (a new refused save records a new object, which shows again). */
const dismissed = new WeakSet<DocConflict>();

/** Open the conflict dialog for a doc that has a refused save or is flagged `changedOnDisk`. */
export function openConflict(path: string): void {
  const c = useWorkspace.getState().conflicts[path];
  if (c) dismissed.delete(c);
  useConflictUi.setState({ requested: path });
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The doc the dialog should show: the requested one if it still needs settling, else the first un-dismissed conflict. */
function useCurrent(): { path: string; conflict?: DocConflict } | undefined {
  const requested = useConflictUi((st) => st.requested);
  useConflictUi((st) => st.tick);
  const conflicts = useWorkspace((st) => st.conflicts);
  const requestedOpen = useWorkspace((st) => !!requested && (!!st.conflicts[requested] || !!st.docs[requested]?.changedOnDisk));
  if (requested && requestedOpen) return { path: requested, conflict: conflicts[requested] };
  const path = Object.keys(conflicts)
    .sort()
    .find((p) => !dismissed.has(conflicts[p]));
  return path ? { path, conflict: conflicts[path] } : undefined;
}

export function ConflictHost() {
  const current = useCurrent();
  // Keyed by path so each conflict starts with fresh busy state and focus.
  return current ? <ConflictDialog key={current.path} path={current.path} conflict={current.conflict} /> : null;
}

function ConflictDialog({ path, conflict }: { path: string; conflict?: DocConflict }) {
  const kind = useWorkspace((st) => st.docs[path]?.kind);
  const [busy, setBusy] = useState<ConflictChoice | undefined>();
  const reason = conflict?.reason ?? "changed";
  const caseClash = reason === "exists" && !!conflict?.file && conflict.file.path !== path;

  const close = () => {
    if (conflict) dismissed.add(conflict);
    useConflictUi.setState((st) => ({ requested: undefined, tick: st.tick + 1 }));
  };

  const choose = async (choice: ConflictChoice) => {
    if (busy) return;
    setBusy(choice);
    try {
      const shown = await useWorkspace.getState().resolveConflict(path, choice);
      useConflictUi.setState({ requested: undefined });
      if (choice === "overwrite") toast.success("Overwrote the File on Disk With Your Version", { detail: path });
      else if (choice === "copy")
        toast.success(`Saved Your Version as ${shown}`, {
          detail:
            `${path} now shows what's on disk.` +
            (kind === "playbook" ? " Both files build the same save name until you rename the copy's playbook." : "") +
            (kind === "plays" ? " The copy repeats the same custom plays until you remove them from one file." : ""),
          duration: 8000,
        });
      else if (shown === undefined) toast.info("Closed the Deleted File", { detail: `${path} no longer exists on disk` });
      else if (shown !== path) toast.info(`Showing ${shown}`, { detail: `${path} wasn't saved: ${shown} already exists` });
      else toast.success("Reloaded From Disk", { detail: `${path} — ${comboLabel("mod+z")} brings your edits back as unsaved changes` });
    } catch (e) {
      toast.error("Couldn't Settle the Conflict", { detail: errMsg(e) });
    } finally {
      setBusy(undefined);
    }
  };

  const what =
    reason === "deleted"
      ? "Was Deleted on Disk"
      : reason === "exists"
        ? caseClash
          ? `Can't Be Created: ${conflict!.file!.path} Already Exists`
          : "Already Exists on Disk"
        : "Changed on Disk After It Was Loaded";
  const reloadLabel = reason === "deleted" ? "Discard My Version" : caseClash ? "Open the File on Disk" : "Reload From Disk";

  return (
    <Modal
      open
      onClose={close}
      onConfirm={() => void choose("reload")}
      confirmLabel={reloadLabel}
      cancelLabel="Later"
      eyebrow={conflict ? "Not Saved" : "Changed on Disk"}
      title={<span className={s.title}>{path.slice(path.lastIndexOf("/") + 1)} {what}</span>}
      width="lg"
      scopeId="conflict"
      busy={busy === "reload"}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={!!busy}>
            Later
          </Button>
          <span className={s.spacer} />
          <Button variant="secondary" icon="copy" onClick={() => void choose("copy")} loading={busy === "copy"} disabled={!!busy && busy !== "copy"}>
            Save a Copy
          </Button>
          <Button
            variant="danger"
            onClick={() => void choose("overwrite")}
            loading={busy === "overwrite"}
            disabled={caseClash || (!!busy && busy !== "overwrite")}
          >
            Overwrite
          </Button>
          <Button variant="primary" icon="refresh" onClick={() => void choose("reload")} loading={busy === "reload"} disabled={!!busy && busy !== "reload"}>
            {reloadLabel}
          </Button>
        </>
      }
    >
      <ConflictBody path={path} conflict={conflict} caseClash={caseClash} reloadLabel={reloadLabel} />
    </Modal>
  );
}

function ConflictBody(p: { path: string; conflict?: DocConflict; caseClash: boolean; reloadLabel: string }) {
  const deleted = p.conflict?.reason === "deleted";
  return (
    <div className={s.body}>
      <p className={s.lead}>
        {p.conflict
          ? "Your unsaved edits weren't written, so nothing on disk was lost."
          : "You have unsaved edits here, and saving now would overwrite the newer file on disk."}{" "}
        Something else changed the file — another editor, git, the game PC's sync or a second browser tab.
      </p>
      <code className={s.path}>{p.path}</code>
      {p.caseClash && p.conflict?.message && <p className={s.detail}>{p.conflict.message}</p>}
      <dl className={s.choices}>
        <dt>{p.reloadLabel}</dt>
        <dd>
          {deleted
            ? "Close this file; your version is dropped."
            : p.caseClash
              ? "Drop this unsaved file and open the one on disk."
              : `Take the version on disk. ${comboLabel("mod+z")} brings your edits back as unsaved changes.`}
        </dd>
        <dt>Overwrite</dt>
        <dd>{p.caseClash ? "Not possible: a file whose name differs only in letter case exists." : deleted ? "Write your version back to disk." : "Write your version over the file on disk; the other changes are lost."}</dd>
        <dt>Save a Copy</dt>
        <dd>Save your version next to it as a new file (…-copy.json){deleted ? "." : " and reload the original from disk."}</dd>
      </dl>
    </div>
  );
}
