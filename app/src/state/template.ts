// The template playbook save (playbooks/templates/PBOOKOFF-TEMPLATE), loaded once per session and read into
// library terms (model/tdb.ts). Shared by every view that needs template-section contents: the builder (locked
// rows, meters, convert), play-call (open template sections), concepts (situations), export (capacity).
import { useSyncExternalStore } from "react";
import { fetchTemplateSave } from "../api/client";
import type { LibraryIndex } from "../model/library";
import { templateContents, type TemplateContents } from "../model/tdb";
import { useLibrary } from "./library";

export interface TemplateState {
  status: "idle" | "loading" | "ready" | "error";
  contents?: TemplateContents;
  error?: string;
}

let state: TemplateState = { status: "idle" };
let forLib: LibraryIndex | undefined;
const listeners = new Set<() => void>();

function setState(next: TemplateState) {
  state = next;
  listeners.forEach((l) => l());
}

/** Start (or reuse) the template load for a library index. Never rejects; failures land in state.error. */
export function loadTemplate(lib: LibraryIndex): Promise<void> {
  if (forLib === lib && state.status !== "error") return Promise.resolve();
  forLib = lib;
  setState({ status: "loading" });
  return fetchTemplateSave()
    .then((bytes) => {
      if (forLib !== lib) return;
      setState({ status: "ready", contents: templateContents(bytes, lib) });
    })
    .catch((err: unknown) => {
      if (forLib !== lib) return;
      setState({ status: "error", error: err instanceof Error ? err.message : String(err) });
    });
}

export function getTemplate(): TemplateState {
  return state;
}

/** Template contents once the library is loaded (kicks off the fetch on first use). */
export function useTemplate(): TemplateState {
  const lib = useLibrary((s) => s.lib);
  const st = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
  if (lib && forLib !== lib) queueMicrotask(() => void loadTemplate(lib));
  return lib ? st : { status: "idle" };
}
