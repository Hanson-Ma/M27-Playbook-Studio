// The minimum shape the builder and the Playbooks menu need from a playbook doc (FORMATS.md §2): a JSON object whose
// `formations` is an array. Anything else (valid JSON with the wrong shape, e.g. a hand-edited file) is shown as
// "not a playbook" instead of reaching model code that assumes arrays.
import type { PlaybookSpec } from "../../model/types";

/** Why a parsed playbook doc can't be opened, or undefined when it can. */
export function playbookShapeProblem(data: unknown): string | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "The file isn't a JSON object";
  const formations = (data as { formations?: unknown }).formations;
  if (!Array.isArray(formations)) return formations === undefined ? `"formations" is missing` : `"formations" must be an array`;
  return undefined;
}

export function isPlaybookShape(kind: string, data: unknown): data is PlaybookSpec {
  return kind === "playbook" && !playbookShapeProblem(data);
}
