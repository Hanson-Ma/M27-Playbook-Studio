import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "../ui";
import { toastSaved, unsavedBuildFiles } from "./saveWarnings";
import { useWorkspace } from "./workspace";

const doc = (path: string, kind: string, dirty: boolean, error?: string) => [path, { path, kind, dirty, error, data: {} }] as const;
const setDocs = (...entries: (readonly [string, unknown])[]) => useWorkspace.setState({ docs: Object.fromEntries(entries) as never });

afterEach(() => {
  vi.restoreAllMocks();
  setDocs();
});

describe("save warnings", () => {
  it("lists dirty playbook / plays / sets files other than the one just saved", () => {
    setDocs(
      doc("playbooks/FUSION.json", "playbook", false),
      doc("playbooks/sets/fusion-sets.json", "sets", true),
      doc("playbooks/plays/fusion-edits.json", "plays", true),
      doc("app-data/routes.json", "appdata", true),
    );
    expect(unsavedBuildFiles("playbooks/plays/fusion-edits.json")).toEqual(["playbooks/sets/fusion-sets.json"]);
    expect(unsavedBuildFiles()).toEqual(["playbooks/sets/fusion-sets.json", "playbooks/plays/fusion-edits.json"]);
  });

  it("says plain 'Saved' when everything else is saved", () => {
    setDocs(doc("playbooks/FUSION.json", "playbook", false), doc("playbooks/sets/fusion-sets.json", "sets", false));
    const ok = vi.spyOn(toast, "success").mockImplementation(() => undefined as never);
    const warn = vi.spyOn(toast, "warning").mockImplementation(() => undefined as never);
    toastSaved("playbooks/FUSION.json");
    expect(ok).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns, naming the unsaved files, with a Save All action", () => {
    setDocs(doc("playbooks/plays/fusion-edits.json", "plays", false), doc("playbooks/sets/fusion-sets.json", "sets", true));
    const warn = vi.spyOn(toast, "warning").mockImplementation(() => undefined as never);
    toastSaved("playbooks/plays/fusion-edits.json");
    expect(warn).toHaveBeenCalledOnce();
    const [message, opts] = warn.mock.calls[0];
    expect(String(message)).toContain("fusion-edits.json");
    expect(opts?.detail).toContain("fusion-sets.json");
    expect(opts?.action?.label).toBe("Save All");
  });
});
