// Guide text: every ./content/<section>.md, bundled as raw strings (Vite ?raw) so the guide works offline and in a
// hosted build. A section without a file shows a "coming soon" note.
import type { HelpSectionId } from "./sections";

const files = import.meta.glob("./content/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** Markdown source of a guide section (undefined when the file is missing). */
export function helpSource(id: HelpSectionId): string | undefined {
  return files[`./content/${id}.md`];
}
