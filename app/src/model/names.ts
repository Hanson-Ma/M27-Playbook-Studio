// Name helpers shared by every module. `norm` must match tools/pbook-build.mjs (game-side name resolution).

/** Same normalization the game-side builder uses to match display names. */
export function norm(s: string): string {
  return s.toLowerCase().replace(/[\s_]+/g, " ").trim();
}

/** Last path segment of an asset. */
export function leaf(asset: string): string {
  const i = asset.lastIndexOf("/");
  return i < 0 ? asset : asset.slice(i + 1);
}

/** Folder of an asset, with a trailing "/". */
export function folder(asset: string): string {
  const i = asset.lastIndexOf("/");
  return i < 0 ? "" : asset.slice(0, i + 1);
}

/** Playbook save names: A–Z0–9 only (uppercased). */
export function sanitizeBookName(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Asset leaf names: [A-Za-z0-9_] (spaces and dashes become underscores, runs collapse). */
export function sanitizeAssetLeaf(s: string): string {
  return s
    .trim()
    .replace(/[\s\-./]+/g, "_")
    .replace(/[^A-Za-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** `base`, or `base_2`, `base_3`… — the first one not in `taken` (compared case-insensitively). */
export function uniqueName(base: string, taken: Set<string>, sep = "_"): string {
  const lower = new Set([...taken].map((t) => t.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const cand = `${base}${sep}${i}`;
    if (!lower.has(cand.toLowerCase())) return cand;
  }
}

/** "Y_Trips_Wk" → "Y Trips Wk". */
export function displayFromLeaf(leafName: string): string {
  return leafName.replace(/_+/g, " ").trim();
}

const FORMATION_SHORT: Record<string, string> = {
  shotgun: "GUN",
  singleback: "SINGLEBACK",
  pistol: "PISTOL",
  "i form": "I FORM",
  "strong i": "STRONG I",
  "weak i": "WEAK I",
  "power i": "POWER I",
  "maryland i": "MARYLAND I",
  "full house": "FULL HOUSE",
  "split backs": "SPLIT BACKS",
  "goal line offense": "GOAL LINE",
  "hail mary": "HAIL MARY",
  wildcat: "WILDCAT",
  flexbone: "FLEXBONE",
  wishbone: "WISHBONE",
  "split t": "SPLIT T",
  "direct snaps": "DIRECT SNAP",
};

/** Madden-style short formation name for card subtitles ("Shotgun" → "GUN"). */
export function formationShort(name: string): string {
  return FORMATION_SHORT[norm(name)] ?? name.toUpperCase();
}

/** Card subtitle: "GUN Y TRIPS WK". Skips the set name when it repeats the formation. */
export function playSubtitle(formationName: string, setName: string): string {
  const f = formationShort(formationName);
  if (norm(setName) === norm(formationName)) return f;
  return `${f} ${setName.toUpperCase()}`;
}

/** Last two asset segments, for compact display: ".../Y_Trips_Wk/Curls" → "Y_Trips_Wk/Curls". */
export function prettyAsset(asset: string, segments = 2): string {
  return asset.split("/").slice(-segments).join("/");
}
