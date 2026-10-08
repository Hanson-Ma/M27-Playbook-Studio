// The playbook as the play-call screen sees it (formations → sets → plays), resolved against the catalog.
// Shared by the play-call preview and the overview.
import { useMemo } from "react";
import type { Catalog } from "../../model/catalog";
import { resolvePlaybook, type BookCounts } from "../../model/resolveBook";
import type { PlaybookSpec } from "../../model/types";
import { useTemplate } from "../../state/template";
import { buildCallBook, type CallBook, type TemplateSource } from "./playcallModel";

export function useCallBook(spec: PlaybookSpec | undefined, catalog: Catalog): { book?: CallBook; counts?: BookCounts; error?: string } {
  // Template sections fill in once the template save is read (it loads once per library).
  const contents = useTemplate().contents;
  return useMemo(() => {
    if (!spec) return {};
    try {
      const resolved = resolvePlaybook(spec, catalog, { template: contents });
      const template: TemplateSource | undefined = contents ? { contents, lib: catalog.lib } : undefined;
      return { book: buildCallBook(resolved, template), counts: resolved.counts };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [spec, catalog, contents]);
}
