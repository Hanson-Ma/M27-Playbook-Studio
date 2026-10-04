// Play search for the library view (pure, no React/DOM): a per-catalog index of every library + custom play with a
// lowercase haystack and facet values, tokenized AND search with facet filters and rail counts, result grouping, and
// the route-type vocabulary shared with the per-player route library (friendly names, families, scopes, Lt/Rt
// variants → inside/outside).
import { resolveLibraryPlay, type Catalog } from "./catalog";
import type { LibraryIndex } from "./library";
import { displayFromLeaf, formationShort, leaf } from "./names";
import { familyColor, familyLabel, PLAY_FAMILIES, playTypeInfo, type PlayFamily } from "./playtypes";
import type { Asset, ConceptsDoc, PlayKey, PlaySource, ResolvedPlay, Side, Step } from "./types";

// ───────────────────────────── route-type vocabulary ─────────────────────────────

const RT_PREFIX = "AssignRouteType_";

/** Exact friendly names where the generic rule reads poorly. Keys without the AssignRouteType_ prefix. */
const ROUTE_LABELS: Record<string, string> = {
  Block_Run: "Run block",
  Block_Pass: "Pass block",
  QB_Pass: "QB drop",
  QB_Handoff: "QB handoff",
  QB_Play_Action: "QB play action",
  QB_Run: "QB run",
  QB_Draw: "QB draw",
  QB_Pitch: "QB pitch",
  QB_Kneel: "QB kneel",
  QB_Spike: "QB spike",
  QB_Fake_Spike: "QB fake spike",
  QB_FG_Hold: "FG holder",
  QB_Shotgun_Read_Option: "QB read option",
  QB_Triple_Option: "QB triple option",
  QB_Speed_Option: "QB speed option",
  QB_Power_Option: "QB power option",
  QB_Option_Give: "QB option give",
  QB_Option_Pass: "QB option pass",
  RR_Curl_Medium: "Curl (medium)",
  RR_Curl_Long: "Curl (long)",
  RR_Slant_Hook: "Slant hook",
  RR_Streak: "Streak",
  RR_WR_Screen: "WR screen",
  RR_RB_Angle: "Angle",
  RR_Cover_2_Corner: "Cover 2 corner",
  RR_Out_N_Up: "Out & up",
  RR_Out_N_Up_Comeback: "Out & up comeback",
  RR_Curl_n_Go: "Curl & go",
  RR_Slant_N_Go: "Slant & go",
  RR_Hitch_N_Go: "Hitch & go",
  RR_In_N_Up: "In & up",
  RR_Post_Corner: "Post-corner",
  RR_Corner_Post: "Corner-post",
  RR_Post_Stop: "Post stop",
  RR_Corner_Stop: "Corner stop",
  RR_Option_Route: "Option route",
  RR_Block_and_Release: "Block & release",
  RB_Slam: "HB slam",
  RB_Sweep: "HB sweep",
  RB_Dive: "HB dive",
  RB_Counter: "HB counter",
  RB_Stretch: "HB stretch",
  RB_Draw: "HB draw",
  RB_Pass: "HB pass",
  RB_Option_Receive: "Option pitch man",
  RB_Option_Follow: "Option lead",
  WR_Reverse: "WR reverse",
  WR_Fake_Reverse: "WR fake reverse",
  WR_Pass: "WR pass",
  DefPass_Rush: "Pass rush",
  DefBlitz: "Blitz",
  DefMan_Coverage: "Man coverage",
  DefQB_Spy: "QB spy",
  DefZone_Deep_Mid_3rd: "Deep middle third",
  DefZone_Deep_Lt_3rd: "Deep third (left)",
  DefZone_Deep_Rt_3rd: "Deep third (right)",
  DefZone_Deep_2_Lt_Half: "Deep half (left)",
  DefZone_Deep_2_Rt_Half: "Deep half (right)",
  DefZone_Deep_4_In_Lt_Qtr: "Deep quarter (left inside)",
  DefZone_Deep_4_Out_Lt_Qtr: "Deep quarter (left outside)",
  DefZone_Deep_4_In_Rt_Qtr: "Deep quarter (right inside)",
  DefZone_Deep_4_Out_Rt_Qtr: "Deep quarter (right outside)",
  K_FG: "Field goal",
  K_FG_Fake: "Fake field goal",
  K_Kickoff: "Kickoff",
  K_Onside_Kick: "Onside kick",
  P_Punt: "Punt",
};

const DIR_WORDS: Record<string, string> = { Lt: "left", Left: "left", Rt: "right", Right: "right", Mid: "middle", Middle: "middle" };
const DEPTH_WORDS: Record<string, string> = { Short: "short", Medium: "medium", Deep: "deep", Long: "long" };
const ACRONYMS = new Set(["QB", "HB", "FB", "WR", "TE", "RB", "FG", "PA", "ST", "FL", "SE", "OL", "RPO"]);

function generic(rest: string, keepDir: boolean): string {
  const tokens = rest.replace(/^RR_/, "").replace(/^DefZone_/, "Zone_").replace(/^Def_Man_(\d)$/, "Man_#$1").split("_").filter(Boolean);
  const words: string[] = [];
  const quals: string[] = [];
  for (const t of tokens) {
    if (DIR_WORDS[t]) {
      if (keepDir) quals.push(DIR_WORDS[t]);
    } else if (DEPTH_WORDS[t]) quals.push(DEPTH_WORDS[t]);
    else if (t === "N" || t === "n") words.push("&");
    else if (t === "ST") words.push("Special teams");
    else words.push(ACRONYMS.has(t.toUpperCase()) && t.length <= 3 ? t.toUpperCase() : t.toLowerCase());
  }
  if (!words.length) words.push(rest);
  let base = words.join(" ");
  base = base.charAt(0).toUpperCase() + base.slice(1);
  return quals.length ? `${base} (${quals.join(", ")})` : base;
}

/** "AssignRouteType_RR_Slant" → "Slant", "…_RR_Curl_Medium" → "Curl (medium)", "…_Block_Run" → "Run block". */
export function routeTypeLabel(routeType: string | undefined): string {
  if (!routeType) return "Unknown";
  const rest = routeType.startsWith(RT_PREFIX) ? routeType.slice(RT_PREFIX.length) : routeType;
  return ROUTE_LABELS[rest] ?? generic(rest, true);
}

/** Group key that merges left/right variants of one route type (RR_Flat_Lt + RR_Flat_Rt → "RR_Flat"). */
export function routeTypeGroup(routeType: string | undefined): string {
  if (!routeType) return "";
  const rest = routeType.startsWith(RT_PREFIX) ? routeType.slice(RT_PREFIX.length) : routeType;
  if (rest.startsWith("DefZone_Deep_")) return rest; // the deep zones keep their side (thirds, halves, quarters)
  return rest
    .split("_")
    .filter((t) => t !== "Lt" && t !== "Rt" && t !== "Left" && t !== "Right")
    .join("_");
}

/** Label for a routeTypeGroup key ("RR_Flat" → "Flat"). */
export function routeGroupLabel(group: string): string {
  if (!group) return "Unknown";
  return ROUTE_LABELS[group] ?? generic(group, false);
}

/** Receiver-route families for the "Route contains" filter, in display order. */
export const ROUTE_FAMILIES = [
  "Slant",
  "Flat",
  "Drag",
  "Cross",
  "Curl",
  "Hook",
  "Hitch",
  "Out",
  "In",
  "Comeback",
  "Corner",
  "Post",
  "Streak",
  "Fade",
  "Wheel",
  "Swing",
  "Angle",
  "Whip",
  "Screen",
  "Option",
  "Double move",
  "Block & release",
] as const;
export type RouteFamily = (typeof ROUTE_FAMILIES)[number];

const FAMILY_RULES: [RegExp, RouteFamily[]][] = [
  [/^RR_(Out_N_Up|Curl_n_Go|Slant_N_Go|Hitch_N_Go|In_N_Up|Post_Corner|Corner_Post|Out_N_Up_Comeback)$/i, ["Double move"]],
  [/^RR_Block_/, ["Block & release"]],
  [/^RR_Option_/, ["Option"]],
  [/^RR_Slant_Hook$/, ["Hook"]],
  [/^RR_Slant$/, ["Slant"]],
  [/^RR_(RB_)?Flat_/, ["Flat"]],
  [/^RR_Drag$/, ["Drag"]],
  [/^RR_Cross$/, ["Cross"]],
  [/^RR_Curl_/, ["Curl"]],
  [/^RR_Hitch$/, ["Hitch"]],
  [/^RR_Out_/, ["Out"]],
  [/^RR_In_/, ["In"]],
  [/^RR_Comeback$/, ["Comeback"]],
  [/^RR_(Corner_|Cover_2_Corner)/, ["Corner"]],
  [/^RR_Post_/, ["Post"]],
  [/^RR_Streak$/, ["Streak"]],
  [/^RR_Fade$/, ["Fade"]],
  [/^RR_Wheel_/, ["Wheel"]],
  [/^RR_Swing_/, ["Swing"]],
  [/^RR_RB_Angle$/, ["Angle"]],
  [/^RR_Whip_/, ["Whip"]],
  [/^RR_(WR_Screen|RB_Screen_)/, ["Screen"]],
];

/** Route families of one routeType (receiver routes only; [] for blocks, runs, defense…). */
export function routeFamilies(routeType: string | undefined): RouteFamily[] {
  if (!routeType) return [];
  const rest = routeType.startsWith(RT_PREFIX) ? routeType.slice(RT_PREFIX.length) : routeType;
  for (const [re, fams] of FAMILY_RULES) if (re.test(rest)) return fams;
  return [];
}

/** "Concept_Four_Verticals" → "Four Verticals"; undefined for Concept_Invalid / Concept_Max / empty. Shared by the
 *  library, play-call and concepts views so read-concept groups are named the same everywhere. */
export function readConceptLabel(concept: string | undefined): string | undefined {
  if (!concept || /^Concept_(Invalid|Max)$/i.test(concept)) return undefined;
  const rest = concept.replace(/^Concept_/, "");
  if (!rest || rest === "Invalid") return undefined;
  return rest
    .split("_")
    .filter(Boolean)
    .map((w) => (w.length <= 2 || ACRONYMS.has(w.toUpperCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

// ───────────────────────────── route scopes + directional variants ─────────────────────────────

export type RouteScope = "routes" | "blocks" | "backs" | "qb" | "defense" | "special" | "all";

/** Which route-library scopes a routeType belongs to ("all" is implied). */
export function routeScopes(routeType: string | undefined): Exclude<RouteScope, "all">[] {
  const rest = (routeType ?? "").replace(RT_PREFIX, "");
  const out = new Set<Exclude<RouteScope, "all">>();
  if (rest.startsWith("RR_")) {
    out.add("routes");
    if (/^RR_Block_/.test(rest)) out.add("blocks");
    if (/^RR_(RB_|Swing_|Option_HB_)/.test(rest)) out.add("backs");
  } else if (rest.startsWith("Block_")) out.add("blocks");
  else if (rest.startsWith("RB_") || /^WR_(Fake_)?Reverse$/.test(rest) || rest === "WR_Pass") out.add("backs");
  else if (rest.startsWith("QB_")) {
    out.add("qb");
    if (/FG|Punt/.test(rest)) out.add("special");
  } else if (/^Def/.test(rest)) out.add("defense");
  else if (/^(ST|K|P)_/.test(rest)) out.add("special");
  return [...out];
}

const ROUTE_WORDS =
  "Curl|Hook|Flats?|Swing|Wheel|Out|In|Slant|Drag|Cross|Corner|Post|Fade|Comeback|Hitch|Screen|Whip|Zig|Angle|Seam|Streak|Shake|Smash|Spot|Stick|Slide|Arrow|Sit|Bubble|Dig|Go";
const WORD_DIR_RE = new RegExp(`(?:${ROUTE_WORDS})_?(Lt|Rt|Left|Right|LT|RT)(?![a-z])`, "g");

/**
 * Break direction of a directional variant from its leaf name (the last route word + Lt/Rt token, e.g. "WR_CurlLt",
 * "Swing_Rt", "SlotFlatsLt"), else from an `_Lt`/`_Rt` routeType suffix (offense only). undefined = not directional.
 */
export function assignmentDirection(asset: string, routeType?: string): "left" | "right" | undefined {
  const rest = (routeType ?? "").replace(RT_PREFIX, "");
  // Defensive names are from the defense's point of view (and zones aren't "breaks").
  if (/^Def/.test(rest) || /\/Defense[A-Za-z]*\//.test(asset)) return undefined;
  const matches = [...leaf(asset).matchAll(WORD_DIR_RE)];
  if (matches.length) return matches[matches.length - 1][1].toLowerCase().startsWith("l") ? "left" : "right";
  const m = rest.match(/_(Lt|Rt|Left|Right)$/);
  return m ? (m[1].startsWith("L") ? "left" : "right") : undefined;
}

/**
 * Inside/outside for a break direction relative to a player's side of the ball (x < 0 = left side: a break toward +x
 * is inside). Players within half a yard of the ball have no side.
 */
export function breakSide(direction: "left" | "right" | undefined, playerX: number): "inside" | "outside" | undefined {
  if (!direction || Math.abs(playerX) < 0.5) return undefined;
  const towardPlus = direction === "right";
  return playerX < 0 === towardPlus ? "inside" : "outside";
}

export interface RouteLibraryItem {
  asset: Asset;
  /** Path under ASSIGNMENT_ROOT ("RunRoute/WR_CurlLt"). */
  path: string;
  routeType: string;
  label: string;
  direction?: "left" | "right";
  side?: "inside" | "outside";
  scopes: Exclude<RouteScope, "all">[];
  steps: Step[];
}

export interface RouteLibraryGroup {
  key: string;
  label: string;
  items: RouteLibraryItem[];
}

export interface RouteLibraryOptions {
  scope: RouteScope;
  /** Free-text filter over the friendly name, the leaf and the folder. */
  filter?: string;
  /** Selected player's x (yards, unflipped) for inside/outside. */
  playerX: number;
}

const libRouteCache = new WeakMap<LibraryIndex, Map<string, RouteLibraryItem[]>>();

/** Assignments of one routeTypeGroup across its Lt/Rt route types (direction resolved; side filled per call). */
function groupItems(lib: LibraryIndex): Map<string, RouteLibraryItem[]> {
  let m = libRouteCache.get(lib);
  if (m) return m;
  m = new Map();
  const root = "football/Gameplay/playbooks/PlayLibrary/Assignments/";
  for (const [routeType, assets] of lib.assignmentsByRouteType) {
    const g = routeTypeGroup(routeType);
    let list = m.get(g);
    if (!list) m.set(g, (list = []));
    for (const asset of assets) {
      const def = lib.data.assignments[asset];
      list.push({
        asset,
        path: asset.startsWith(root) ? asset.slice(root.length) : asset,
        routeType,
        label: routeTypeLabel(routeType),
        direction: assignmentDirection(asset, routeType),
        scopes: routeScopes(routeType),
        steps: def?.steps ?? [],
      });
    }
  }
  for (const list of m.values()) list.sort((a, b) => (a.asset < b.asset ? -1 : a.asset > b.asset ? 1 : 0));
  libRouteCache.set(lib, m);
  return m;
}

const INSIDE_FIRST = /Curl|Hook/i;

/**
 * The per-player route library: assignments grouped by routeType (left/right variants merged), filtered by scope and
 * text, each directional variant labeled inside/outside for the player; curls/hooks list the inside variant first.
 * Groups are sorted by label; items by asset path.
 */
export function routeLibrary(lib: LibraryIndex, opts: RouteLibraryOptions): RouteLibraryGroup[] {
  const tokens = (opts.filter ?? "").toLowerCase().replace(/_/g, " ").split(/\s+/).filter(Boolean);
  const out: RouteLibraryGroup[] = [];
  for (const [key, all] of groupItems(lib)) {
    const scope = opts.scope;
    let items = scope === "all" ? all : all.filter((it) => it.scopes.includes(scope));
    if (!items.length) continue;
    const label = routeGroupLabel(key);
    if (tokens.length) {
      const glabel = label.toLowerCase();
      items = items.filter((it) => {
        const hay = `${glabel} ${it.label.toLowerCase()} ${it.path.toLowerCase().replace(/_/g, " ")}`;
        return tokens.every((t) => hay.includes(t));
      });
    }
    if (!items.length) continue;
    const sided = items.map((it) => {
      const side = breakSide(it.direction, opts.playerX);
      return side === it.side ? it : { ...it, side };
    });
    if (INSIDE_FIRST.test(key)) {
      const rank = (it: RouteLibraryItem) => (it.side === "inside" ? 0 : it.side === "outside" ? 2 : 1);
      sided.sort((a, b) => rank(a) - rank(b)); // stable: path order within each rank
    }
    out.push({ key, label, items: sided });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

/** Default route-library scope for a player position code (QB → qb, OL → blocks, HB/FB → backs, defense → defense). */
export function defaultRouteScope(positionCode: string, side: Side | "special"): RouteScope {
  if (side === "defense") return "defense";
  if (positionCode === "QB") return "qb";
  if (["LT", "LG", "C", "RG", "RT"].includes(positionCode)) return "blocks";
  if (["HB", "FB"].includes(positionCode)) return "backs";
  if (side === "special" && ["K", "P"].includes(positionCode)) return "special";
  return "routes";
}

// ───────────────────────────── search index ─────────────────────────────

export type SideFacet = Side | "special";

export interface PlayFacets {
  side: SideFacet;
  formation: Asset;
  set: Asset;
  family: PlayFamily;
  playType: string;
  /** Read concepts, friendly ("Mesh"), deduped in read order. */
  readConcepts: string[];
  /** Receiver route families present in the play's assignments ("Wheel", "Slant"…). */
  routes: RouteFamily[];
  global: boolean;
  source: PlaySource;
  minigame: boolean;
}

export interface SearchEntry {
  /** Unique within the index (a custom play can collide with a library key; React keys and selection use this). */
  id: string;
  key: PlayKey;
  play: ResolvedPlay;
  facets: PlayFacets;
  /** Lowercase haystack (underscores as spaces). */
  hay: string;
  /** Position in the index: formation › set by name (minigames last), library before custom, data order within. */
  order: number;
}

export interface FormationInfo {
  asset: Asset;
  name: string;
  side: SideFacet;
  minigame: boolean;
  /** Folder under Formations/ without the leaf, to tell same-named formations apart ("Offense/MG_Screen"). */
  folder: string;
  /** Sets with at least one play, in first-seen order. */
  sets: { asset: Asset; name: string }[];
}

export interface SearchIndex {
  entries: SearchEntry[];
  byKey: Map<PlayKey, SearchEntry>;
  formations: Map<Asset, FormationInfo>;
  /** Exact play types present, per side. */
  playTypes: Map<SideFacet, string[]>;
  /** Every read concept label present (sorted by play count, desc). */
  readConcepts: string[];
  /** catalog.version this index was built for. */
  version: number;
}

const norm = (s: string) => s.toLowerCase().replace(/_/g, " ");

function haystack(play: ResolvedPlay, lib: LibraryIndex, facets: PlayFacets, routeLabels: Set<string>): string {
  const formation = lib.formationByAsset.get(play.formation);
  const set = lib.setByAsset.get(play.set);
  const info = playTypeInfo(play.playType);
  const parts = [
    play.name,
    set?.name ?? displayFromLeaf(leaf(play.set)),
    formation?.name ?? "",
    formation ? formationShort(formation.name) : "",
    info.long,
    info.label,
    ...facets.readConcepts,
    ...facets.routes,
    ...routeLabels,
    leaf(play.asset),
    play.playId !== undefined ? String(play.playId) : "",
    play.source === "custom" ? `custom ${play.file ? leaf(play.file).replace(/\.json$/i, "") : ""}` : "",
  ];
  return norm(parts.filter(Boolean).join(" · "));
}

interface Computed {
  facets: PlayFacets;
  hay: string;
}

const libEntryCache = new WeakMap<LibraryIndex, Map<ResolvedPlay, Computed>>();

function compute(play: ResolvedPlay, lib: LibraryIndex): Computed {
  const cache = play.source === "library" ? libEntryCache.get(lib) : undefined;
  const hit = cache?.get(play);
  if (hit) return hit;
  const formation = lib.formationByAsset.get(play.formation);
  const readConcepts: string[] = [];
  for (const r of play.reads ?? []) {
    const label = readConceptLabel(r.concept);
    if (label && !readConcepts.includes(label)) readConcepts.push(label);
  }
  const routes = new Set<RouteFamily>();
  const routeLabels = new Set<string>();
  for (const slot of play.slots) {
    if (!slot.routeType) continue;
    for (const f of routeFamilies(slot.routeType)) routes.add(f);
    routeLabels.add(routeGroupLabel(routeTypeGroup(slot.routeType)));
  }
  const facets: PlayFacets = {
    side: play.side,
    formation: play.formation,
    set: play.set,
    family: playTypeInfo(play.playType).family,
    playType: play.playType,
    readConcepts,
    routes: ROUTE_FAMILIES.filter((f) => routes.has(f)),
    global: play.global,
    source: play.source,
    minigame: formation ? lib.isMinigame(formation) : false,
  };
  const c = { facets, hay: haystack(play, lib, facets, routeLabels) };
  if (play.source === "library") {
    let m = libEntryCache.get(lib);
    if (!m) libEntryCache.set(lib, (m = new Map()));
    m.set(play, c);
  }
  return c;
}

const indexCache = new WeakMap<Catalog, SearchIndex>();

/** Search index for a catalog (memoized per catalog instance; library entries are reused across catalog versions). */
export function buildSearchIndex(catalog: Catalog): SearchIndex {
  const hit = indexCache.get(catalog);
  if (hit) return hit;
  const lib = catalog.lib;
  // Library plays straight from the data (a custom play with a colliding key would shadow them in catalog.get), then
  // plays cloned into custom sets (playbooks/sets/), then custom plays; displayed formation › set (by name, minigames
  // last), library before custom, data order within.
  const raw: ResolvedPlay[] = lib.data.plays.map((p) => resolveLibraryPlay(lib, p));
  raw.push(...catalog.clones, ...catalog.custom);
  const sortKey = new Map<Asset, string>();
  const keyOf = (play: ResolvedPlay): string => {
    let k = sortKey.get(play.set);
    if (k === undefined) {
      const f = lib.formationByAsset.get(play.formation);
      const set = lib.setByAsset.get(play.set);
      k = `${f && lib.isMinigame(f) ? 1 : 0}\u0000${(f?.name ?? "").toLowerCase()}\u0000${play.formation}\u0000${(set?.name ?? leaf(play.set)).toLowerCase()}\u0000${play.set}`;
      sortKey.set(play.set, k);
    }
    return k;
  };
  const plays = raw
    .map((play, i) => ({ play, i, k: keyOf(play) }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.i - b.i))
    .map((x) => x.play);

  const entries: SearchEntry[] = [];
  const byKey = new Map<PlayKey, SearchEntry>();
  const formations = new Map<Asset, FormationInfo>();
  const types = new Map<SideFacet, Map<string, number>>();
  const conceptCounts = new Map<string, number>();
  const seenSet = new Set<Asset>();

  plays.forEach((play) => {
    const { facets, hay } = compute(play, lib);
    const id =
      play.source === "library"
        ? `L:${play.key}`
        : play.clone
          ? `K:${play.clone.file}#${play.clone.setIndex}/${play.clone.index}`
          : `C:${play.file ?? ""}#${play.index ?? 0}`;
    const e: SearchEntry = { id, key: play.key, play, facets, hay, order: entries.length };
    entries.push(e);
    if (play.source === "custom" || !byKey.has(play.key)) byKey.set(play.key, e);

    let fi = formations.get(play.formation);
    if (!fi && play.formation) {
      const f = lib.formationByAsset.get(play.formation);
      const rel = play.formation.replace(/^.*?\/Formations\//, "");
      fi = {
        asset: play.formation,
        name: f?.name ?? displayFromLeaf(leaf(play.formation)),
        side: play.side,
        minigame: facets.minigame,
        folder: rel.slice(0, Math.max(0, rel.lastIndexOf("/"))),
        sets: [],
      };
      formations.set(play.formation, fi);
    }
    if (fi && play.set && !seenSet.has(play.set)) {
      seenSet.add(play.set);
      fi.sets.push({ asset: play.set, name: lib.setByAsset.get(play.set)?.name ?? displayFromLeaf(leaf(play.set)) });
    }
    let t = types.get(facets.side);
    if (!t) types.set(facets.side, (t = new Map()));
    t.set(facets.playType, (t.get(facets.playType) ?? 0) + 1);
    for (const c of facets.readConcepts) conceptCounts.set(c, (conceptCounts.get(c) ?? 0) + 1);
  });

  const playTypes = new Map<SideFacet, string[]>();
  for (const [side, m] of types) playTypes.set(side, [...m.keys()].filter(Boolean).sort());
  const readConcepts = [...conceptCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c);

  const index: SearchIndex = { entries, byKey, formations, playTypes, readConcepts, version: catalog.version };
  indexCache.set(catalog, index);
  return index;
}

// ───────────────────────────── query + filters ─────────────────────────────

export interface ParsedQuery {
  include: string[];
  exclude: string[];
}

/** Lowercase tokens; "quoted phrases" stay together; a leading "-" excludes. Underscores read as spaces. */
export function parseQuery(query: string): ParsedQuery {
  const include: string[] = [];
  const exclude: string[] = [];
  const re = /(-?)"([^"]*)"|(-?)(\S+)/g;
  for (const m of query.matchAll(re)) {
    const neg = (m[1] ?? m[3]) === "-";
    const text = norm((m[2] ?? m[4] ?? "").trim());
    if (!text || text === "-") continue;
    (neg ? exclude : include).push(text);
  }
  return { include, exclude };
}

export type Availability = "all" | "global" | "needsMod";
export type SourceFilter = "all" | PlaySource;

export interface PlayFilters {
  /** undefined / "all" = every side. */
  side?: SideFacet | "all";
  formation?: Asset;
  set?: Asset;
  /** Any of these families (OR). */
  families?: PlayFamily[];
  /** Exact Offense/DefensePlayType. */
  playType?: string;
  /** User concept category ids (OR; a category matches its descendants too). */
  categories?: string[];
  /** Read concept labels ("Mesh") (OR). */
  readConcepts?: string[];
  /** Route families the play must contain (AND). */
  routes?: string[];
  availability?: Availability;
  source?: SourceFilter;
  favoritesOnly?: boolean;
  /** Drop minigame / drill formations entirely (not a facet). */
  hideMinigames?: boolean;
}

export interface SearchContext {
  favorites?: ReadonlySet<PlayKey> | readonly PlayKey[];
  concepts?: ConceptsDoc | null;
}

export interface FacetCounts {
  side: Map<SideFacet, number>;
  formation: Map<Asset, number>;
  set: Map<Asset, number>;
  family: Map<PlayFamily, number>;
  playType: Map<string, number>;
  categories: Map<string, number>;
  readConcepts: Map<string, number>;
  routes: Map<string, number>;
  availability: Record<Availability, number>;
  source: Record<SourceFilter, number>;
  favorites: number;
}

export interface SearchResult {
  entries: SearchEntry[];
  counts: FacetCounts;
  /** Entries considered at all (after hideMinigames). */
  total: number;
}

// Filter dimensions as bits. Text and hideMinigames always apply.
const D_SIDE = 1;
const D_FORMATION = 2;
const D_SET = 4;
const D_FAMILY = 8;
const D_TYPE = 16;
const D_CATEGORY = 32;
const D_CONCEPT = 64;
const D_ROUTE = 128;
const D_AVAIL = 256;
const D_SOURCE = 512;
const D_FAV = 1024;

/** Each count ignores its own dimension (and the ones nested under it), so the rail shows what a click would give. */
const IGNORE = {
  side: D_SIDE | D_FORMATION | D_SET,
  formation: D_FORMATION | D_SET,
  set: D_SET,
  family: D_FAMILY | D_TYPE,
  playType: D_TYPE,
  category: D_CATEGORY,
  concept: D_CONCEPT,
  route: D_ROUTE,
  avail: D_AVAIL,
  source: D_SOURCE,
  fav: D_FAV,
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * The usable categories of a concepts doc: objects with a string id (a hand-edited concepts.json may hold anything —
 * a non-array `categories` or non-object members are ignored instead of crashing the library).
 */
export function conceptCategories(doc: unknown): ConceptsDoc["categories"] {
  if (!isObj(doc) || !Array.isArray(doc.categories)) return [];
  return doc.categories.filter((c): c is ConceptsDoc["categories"][number] => isObj(c) && typeof c.id === "string" && !!c.id);
}

/** PlayKey → category ids of a concepts doc, keeping only arrays of strings (see conceptCategories). */
export function conceptTags(doc: unknown): [PlayKey, string[]][] {
  if (!isObj(doc) || !isObj(doc.tags)) return [];
  const out: [PlayKey, string[]][] = [];
  for (const [key, ids] of Object.entries(doc.tags)) {
    if (!Array.isArray(ids)) continue;
    const list = ids.filter((id): id is string => typeof id === "string" && !!id);
    if (list.length) out.push([key, list]);
  }
  return out;
}

/** Category ids tagged on each play, closed over ancestors (a play tagged "Mesh" also counts for its parent "Pass"). */
function categoryClosure(doc: ConceptsDoc | null | undefined): Map<PlayKey, Set<string>> {
  const out = new Map<PlayKey, Set<string>>();
  const tags = conceptTags(doc);
  if (!tags.length) return out;
  const parent = new Map<string, string | undefined>();
  for (const c of conceptCategories(doc)) parent.set(c.id, typeof c.parent === "string" ? c.parent : undefined);
  for (const [key, ids] of tags) {
    const set = new Set<string>();
    for (const id of ids) {
      let cur: string | undefined = id;
      let guard = 0;
      while (cur && !set.has(cur) && guard++ < 64) {
        set.add(cur);
        cur = parent.get(cur);
      }
    }
    out.set(key, set);
  }
  return out;
}

const bump = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);

/**
 * Filter the index: every query token must appear in the haystack (AND), excluded tokens must not, and every active
 * facet filter must pass. Returns matches in index order plus facet counts for the rail.
 */
export function searchPlays(index: SearchIndex, query: string, filters: PlayFilters = {}, ctx: SearchContext = {}): SearchResult {
  const q = parseQuery(query);
  const favs =
    ctx.favorites instanceof Set
      ? (ctx.favorites as ReadonlySet<PlayKey>)
      : new Set<PlayKey>(Array.isArray(ctx.favorites) ? (ctx.favorites as readonly PlayKey[]) : []);
  const closure = categoryClosure(ctx.concepts);
  const side = filters.side && filters.side !== "all" ? filters.side : undefined;
  const families = filters.families?.length ? new Set(filters.families) : undefined;
  const cats = filters.categories?.length ? filters.categories : undefined;
  const concepts = filters.readConcepts?.length ? filters.readConcepts : undefined;
  const routes = filters.routes?.length ? filters.routes : undefined;
  const avail = filters.availability ?? "all";
  const source = filters.source ?? "all";

  const counts: FacetCounts = {
    side: new Map(),
    formation: new Map(),
    set: new Map(),
    family: new Map(),
    playType: new Map(),
    categories: new Map(),
    readConcepts: new Map(),
    routes: new Map(),
    availability: { all: 0, global: 0, needsMod: 0 },
    source: { all: 0, library: 0, custom: 0 },
    favorites: 0,
  };
  const out: SearchEntry[] = [];
  let total = 0;

  for (const e of index.entries) {
    const f = e.facets;
    if (filters.hideMinigames && f.minigame) continue;
    total++;
    if (q.include.length && !q.include.every((t) => e.hay.includes(t))) continue;
    if (q.exclude.length && q.exclude.some((t) => e.hay.includes(t))) continue;

    const tags = closure.get(e.key);
    const fav = favs.has(e.key);
    let fail = 0;
    if (side && f.side !== side) fail |= D_SIDE;
    if (filters.formation && f.formation !== filters.formation) fail |= D_FORMATION;
    if (filters.set && f.set !== filters.set) fail |= D_SET;
    if (families && !families.has(f.family)) fail |= D_FAMILY;
    if (filters.playType && f.playType !== filters.playType) fail |= D_TYPE;
    if (cats && !(tags && cats.some((c) => tags.has(c)))) fail |= D_CATEGORY;
    if (concepts && !concepts.some((c) => f.readConcepts.includes(c))) fail |= D_CONCEPT;
    if (routes && !routes.every((r) => (f.routes as string[]).includes(r))) fail |= D_ROUTE;
    if ((avail === "global" && !f.global) || (avail === "needsMod" && f.global)) fail |= D_AVAIL;
    if (source !== "all" && f.source !== source) fail |= D_SOURCE;
    if (filters.favoritesOnly && !fav) fail |= D_FAV;

    if (fail === 0) out.push(e);
    const ok = (ignore: number) => (fail & ~ignore) === 0;
    if (ok(IGNORE.side)) bump(counts.side, f.side);
    if (ok(IGNORE.formation)) bump(counts.formation, f.formation);
    if (ok(IGNORE.set)) bump(counts.set, f.set);
    if (ok(IGNORE.family)) bump(counts.family, f.family);
    if (ok(IGNORE.playType)) bump(counts.playType, f.playType);
    if (tags && ok(IGNORE.category)) for (const c of tags) bump(counts.categories, c);
    if (ok(IGNORE.concept)) for (const c of f.readConcepts) bump(counts.readConcepts, c);
    if (ok(IGNORE.route)) for (const r of f.routes) bump(counts.routes, r);
    if (ok(IGNORE.avail)) {
      counts.availability.all++;
      counts.availability[f.global ? "global" : "needsMod"]++;
    }
    if (ok(IGNORE.source)) {
      counts.source.all++;
      counts.source[f.source]++;
    }
    if (fav && ok(IGNORE.fav)) counts.favorites++;
  }
  return { entries: out, counts, total };
}

/** Number of active (non-default) filters, for badges. hideMinigames isn't counted (it's a setting). */
export function activeFilterCount(f: PlayFilters): number {
  let n = 0;
  if (f.formation) n++;
  if (f.set) n++;
  n += f.families?.length ?? 0;
  if (f.playType) n++;
  n += f.categories?.length ?? 0;
  n += f.readConcepts?.length ?? 0;
  n += f.routes?.length ?? 0;
  if (f.availability && f.availability !== "all") n++;
  if (f.source && f.source !== "all") n++;
  if (f.favoritesOnly) n++;
  return n;
}

// ───────────────────────────── grouping ─────────────────────────────

export type GroupMode = "none" | "formation" | "concept" | "family";

export interface ResultSection {
  key: string;
  title: string;
  /** Second line (formation › SET subtitle, family long name…). */
  subtitle?: string;
  /** CSS color (family var / category color) for the header accent. */
  color?: string;
  entries: SearchEntry[];
}

export interface GroupOptions {
  lib?: LibraryIndex;
  concepts?: ConceptsDoc | null;
}

/**
 * Split results into sections. "none" = one untitled section; "formation" = one per formation › set (first-seen
 * order); "concept" = user categories (doc order) then read concepts (most plays first), a play can appear in several,
 * plays without any land in "No concept"; "family" = PASS / RUN / … in PLAY_FAMILIES order.
 */
export function groupResults(entries: SearchEntry[], mode: GroupMode, opts: GroupOptions = {}): ResultSection[] {
  if (mode === "none") return entries.length ? [{ key: "all", title: "", entries }] : [];

  if (mode === "formation") {
    const map = new Map<string, ResultSection>();
    for (const e of entries) {
      const k = e.play.set;
      let sec = map.get(k);
      if (!sec) {
        const lib = opts.lib;
        const formation = lib?.formationByAsset.get(e.play.formation)?.name ?? displayFromLeaf(leaf(e.play.formation));
        const set = lib?.setByAsset.get(e.play.set)?.name ?? displayFromLeaf(leaf(e.play.set));
        sec = { key: `set:${k}`, title: formation, subtitle: set, entries: [] };
        map.set(k, sec);
      }
      sec.entries.push(e);
    }
    return [...map.values()];
  }

  if (mode === "family") {
    const map = new Map<PlayFamily, SearchEntry[]>();
    for (const e of entries) {
      const list = map.get(e.facets.family);
      if (list) list.push(e);
      else map.set(e.facets.family, [e]);
    }
    return PLAY_FAMILIES.filter((f) => map.has(f)).map((f) => ({
      key: `family:${f}`,
      title: familyLabel(f),
      color: familyColor(f),
      entries: map.get(f)!,
    }));
  }

  // concept
  const doc = opts.concepts;
  const closure = categoryClosure(doc);
  const catSections = new Map<string, ResultSection>();
  for (const c of conceptCategories(doc))
    catSections.set(c.id, {
      key: `cat:${c.id}`,
      title: typeof c.name === "string" && c.name ? c.name : c.id,
      color: typeof c.color === "string" ? c.color : undefined,
      subtitle: "Category",
      entries: [],
    });
  const readSections = new Map<string, ResultSection>();
  const none: SearchEntry[] = [];
  for (const e of entries) {
    let placed = false;
    const tags = closure.get(e.key);
    if (tags)
      for (const id of tags) {
        const sec = catSections.get(id);
        if (sec) {
          sec.entries.push(e);
          placed = true;
        }
      }
    for (const c of e.facets.readConcepts) {
      let sec = readSections.get(c);
      if (!sec) readSections.set(c, (sec = { key: `read:${c}`, title: c, subtitle: "Read concept", entries: [] }));
      sec.entries.push(e);
      placed = true;
    }
    if (!placed) none.push(e);
  }
  const reads = [...readSections.values()].sort((a, b) => b.entries.length - a.entries.length || a.title.localeCompare(b.title));
  const out = [...[...catSections.values()].filter((s) => s.entries.length), ...reads];
  if (none.length) out.push({ key: "none", title: "No concept", entries: none });
  return out;
}

/** Entries for the given keys in that order (favorites / recents), skipping keys not in `entries`. */
export function orderByKeys(entries: SearchEntry[], keys: readonly PlayKey[]): SearchEntry[] {
  const byKey = new Map<PlayKey, SearchEntry>();
  for (const e of entries) if (!byKey.has(e.key)) byKey.set(e.key, e);
  const out: SearchEntry[] = [];
  const seen = new Set<PlayKey>();
  if (!Array.isArray(keys)) return out; // persisted favorites / recents may be malformed
  for (const k of keys) {
    const e = byKey.get(k);
    if (e && !seen.has(k)) {
      out.push(e);
      seen.add(k);
    }
  }
  return out;
}
