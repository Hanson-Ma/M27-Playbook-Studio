// Small display helpers shared by the library views.

/** "M1left" → "Motion 1 · left", "SM2right" → "Shift 2 · right". */
export function presetLabel(key: string): string {
  const m = key.match(/^(S?M)(\d+)(left|right)$/i);
  if (!m) return key;
  return `${m[1].toUpperCase() === "SM" ? "Shift" : "Motion"} ${m[2]} · ${m[3].toLowerCase()}`;
}

/** "StanceType_2pt_UpRight" → "2pt UpRight". */
export const stanceLabel = (stance: string) => (stance ?? "").replace(/^StanceType_/, "").replace(/_/g, " ");

/** Yards to one decimal with a real minus sign. */
export const fmtYd = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace("-", "−");

export const fmtCount = (n: number | undefined) => (n ?? 0).toLocaleString("en-US");

/**
 * True for a set that only exists in the catalog overlay (a custom set from playbooks/sets/*.json): the catalog lists
 * it in `customAssets` (fallback: the stock library index doesn't have it).
 */
export function isCustomSetAsset(
  lib: { setByAsset: Map<string, unknown> } | undefined,
  catalog: { lib: { setByAsset: Map<string, unknown> }; customAssets?: ReadonlySet<string> } | undefined,
  asset: string,
): boolean {
  if (!catalog) return false;
  if (catalog.customAssets) return catalog.customAssets.has(asset);
  return !!lib && lib !== catalog.lib && !lib.setByAsset.has(asset) && catalog.lib.setByAsset.has(asset);
}
