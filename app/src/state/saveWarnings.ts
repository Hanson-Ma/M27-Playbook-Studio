// Saving is per file (playbook, plays, sets), but the game build reads all of them together: a custom play's base can
// be a stock play copied into a set (sets file), and a playbook lists plays from the plays file. Saving one file while
// another is still unsaved leaves the files on disk out of step, and the build fails ("asset not found"). So a save
// that leaves build files unsaved says so, with a Save All button.
import { toast } from "../ui";
import { useWorkspace } from "./workspace";

const BUILD_KINDS = new Set(["playbook", "plays", "sets"]);

/** Dirty playbook / plays / sets files other than `except`. */
export function unsavedBuildFiles(except?: string): string[] {
  return Object.values(useWorkspace.getState().docs)
    .filter((d) => d.dirty && !d.error && d.path !== except && BUILD_KINDS.has(d.kind))
    .map((d) => d.path);
}

const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);

async function saveEverything(): Promise<void> {
  try {
    await useWorkspace.getState().saveAll();
    toast.success("Saved All Files");
  } catch (e) {
    toast.error("Save All Failed", { detail: e instanceof Error ? e.message : String(e) });
  }
}

/** The toast after a successful save: plain "Saved", or a warning naming the build files still unsaved. */
export function toastSaved(path: string): void {
  const others = unsavedBuildFiles(path);
  if (!others.length) {
    toast.success("Saved", { detail: path });
    return;
  }
  toast.warning(`Saved ${baseName(path)}, but ${others.length === 1 ? "another file is" : `${others.length} other files are`} still unsaved`, {
    detail: `${others.map(baseName).join(", ")}. The mod build reads every file, so a play can point at something that isn't on disk yet.`,
    duration: 0,
    action: { label: "Save All", run: () => void saveEverything() },
  });
}
