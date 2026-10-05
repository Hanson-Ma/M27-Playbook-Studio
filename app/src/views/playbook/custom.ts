// Custom formations / sets (FORMATS.md §5) as the builder sees them: the catalog overlay (`catalog.lib`) holds them next
// to the stock ones, so the builder only needs to tell them apart (CUSTOM SET badges) and link to their editor.
import type { Catalog } from "../../model/catalog";

export interface CustomMarkers {
  set(asset: string | undefined): boolean;
  formation(asset: string | undefined): boolean;
  /** #/formations/<file>/<index> for a custom set (the Formations editor), else undefined. */
  editHref(asset: string | undefined): string | undefined;
}

export function customMarkers(catalog: Catalog): CustomMarkers {
  const lib = catalog.lib;
  return {
    set: (asset) => !!asset && lib.isCustomSet(asset),
    formation: (asset) => !!asset && lib.isCustomFormation(asset),
    editHref(asset) {
      const o = asset ? catalog.customOrigin.get(asset) : undefined;
      return o?.kind === "set" ? `#/formations/${encodeURIComponent(o.file)}/${o.index}` : undefined;
    },
  };
}
