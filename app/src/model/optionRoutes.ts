// Option routes (pure): a stem, then the game picks one of several BRANCHES by the coverage it sees. A branch is one of
// the game's OptionRoutes assets (CurlRight, InOutLeft, SlantLt…, art.ts OPTION_ROUTE_ROOT) plus the coverages it's for.
//
// The step is { type: "OptionRoute", options: [{ route: <leaf>, coverage: <OptionRouteCoverage name | flag sum> }] }
// (FORMATS.md §3; PlayBuilder writes it as optionRouteInfo). Coverage is a flags enum: Default = 0 (nothing else
// matches), ManDeep0/1/2/AndUp3 = 1/2/4/8, Cover2/3/4 = 16/32/64, HotBlitz = 128. A branch can serve several coverages:
// the stock Stick is Default + "15" (every man coverage) + Cover2. Branch leaves are named for the FIELD direction they
// break to (HitchLeft, SlantRt), so inside/outside depends on which side of the formation the player is on.
import { mirrorOptionLeaf, type RouteSide } from "./routes";
import type { Step } from "./types";

export const OPTION_ROUTE_TYPE_PREFIX = "AssignRouteType_RR_Option_";
export const GENERIC_OPTION_ROUTE_TYPE = "AssignRouteType_RR_Option_Route";

// ───────────────────────────── coverages ─────────────────────────────

export interface CoverageDef {
  id: string;
  /** OptionRouteCoverage_* enum member. */
  enumName: string;
  bit: number;
  label: string;
  hint: string;
}

/** The situations a branch can be for (everything but Default, which is "none of these"). */
export const COVERAGES: CoverageDef[] = [
  { id: "man0", enumName: "OptionRouteCoverage_ManDeep0", bit: 1, label: "Man · No Deep Help", hint: "Man coverage with no safety over the top" },
  { id: "man1", enumName: "OptionRouteCoverage_ManDeep1", bit: 2, label: "Man · 1 Deep", hint: "Man free: one deep safety (Cover 1)" },
  { id: "man2", enumName: "OptionRouteCoverage_ManDeep2", bit: 4, label: "Man · 2 Deep", hint: "Man under, two safeties deep" },
  { id: "man3", enumName: "OptionRouteCoverage_ManDeepAndUp3", bit: 8, label: "Man · 3+ Deep", hint: "Man with three or more deep defenders" },
  { id: "c2", enumName: "OptionRouteCoverage_Cover2", bit: 16, label: "Cover 2", hint: "Two-deep zone (also Tampa 2 shells)" },
  { id: "c3", enumName: "OptionRouteCoverage_Cover3", bit: 32, label: "Cover 3", hint: "Three-deep zone" },
  { id: "c4", enumName: "OptionRouteCoverage_Cover4", bit: 64, label: "Cover 4", hint: "Quarters" },
  { id: "blitz", enumName: "OptionRouteCoverage_HotBlitz", bit: 128, label: "Hot Blitz", hint: "The defense sends extra rushers" },
];
export const DEFAULT_COVERAGE = "OptionRouteCoverage_Default";
export const ALL_MAN = 15;
export const ALL_ZONE = 16 + 32 + 64;

const BY_ENUM = new Map(COVERAGES.map((c) => [c.enumName, c.bit]));

/** Flag bits of a coverage value: an enum member name, a flag sum ("15"), or a number. Default = 0. */
export function coverageFlags(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v | 0;
  const s = String(v ?? "");
  if (s === DEFAULT_COVERAGE || s === "") return 0;
  if (/^\d+$/.test(s)) return Number(s);
  return BY_ENUM.get(s) ?? 0;
}

/** The value stored for these flags: the Default member for 0, the enum name for a single coverage, else the flag sum. */
export function coverageValue(flags: number): string {
  if (!flags) return DEFAULT_COVERAGE;
  const one = COVERAGES.find((c) => c.bit === flags);
  return one ? one.enumName : String(flags);
}

/** "Default", "Any man", "Cover 2 + Cover 3"… for a branch's coverage. */
export function coverageSummary(v: unknown): string {
  const f = coverageFlags(v);
  if (!f) return "Default";
  const parts: string[] = [];
  let rest = f;
  if ((rest & ALL_MAN) === ALL_MAN) (parts.push("Any Man"), (rest &= ~ALL_MAN));
  if ((rest & ALL_ZONE) === ALL_ZONE) (parts.push("Any Zone"), (rest &= ~ALL_ZONE));
  for (const c of COVERAGES) if (rest & c.bit) parts.push(c.label);
  return parts.join(" + ");
}

// ───────────────────────────── branch types ─────────────────────────────

export interface BranchType {
  id: string;
  label: string;
  hint: string;
  /** The OptionRoutes leaf for a break toward the field's left / right (undefined: the game has no asset for that side). */
  leaf: { left?: string; right?: string };
  /** Which way it breaks when first added. */
  dir: "in" | "out";
}

export const BRANCH_TYPES: BranchType[] = [
  { id: "hitch", label: "Hitch", hint: "Sit down at the stem", leaf: { left: "HitchLeft", right: "HitchRight" }, dir: "in" },
  { id: "curl", label: "Curl", hint: "Curl back at the stem", leaf: { left: "CurlLeft", right: "CurlRight" }, dir: "in" },
  { id: "deepcurl", label: "Deep Curl", hint: "10 more yards up, then curl", leaf: { left: "CurlLeftLong", right: "CurlRightLong" }, dir: "in" },
  { id: "inside", label: "Inside Curl", hint: "Break inside, then curl", leaf: { left: "InsideCurlLt", right: "InsideCurlRt" }, dir: "in" },
  { id: "inout", label: "Out / Dig", hint: "A 90° break and 20 yd across (an out or a dig by direction)", leaf: { left: "InOutLeft", right: "InOutRight" }, dir: "out" },
  { id: "slant", label: "Slant", hint: "22° break, 15 yd at 30°", leaf: { left: "SlantLt", right: "SlantRt" }, dir: "in" },
  { id: "drag", label: "Drag", hint: "Straight across, 15 yd", leaf: { left: "DragLt", right: "DragRt" }, dir: "in" },
  { id: "dragspot", label: "Drag & Settle", hint: "Across, then sit down", leaf: { left: "DragSpotLt", right: "DragSpotRt" }, dir: "in" },
  { id: "optioncurl", label: "Option Curl", hint: "67° break, then settle", leaf: { left: "OptionCurlLt", right: "OptionCurlRt" }, dir: "in" },
  { id: "corner", label: "Corner", hint: "45° break to the corner (left side only in the game)", leaf: { left: "CornerLt" }, dir: "out" },
  { id: "post", label: "Post", hint: "45° break to the post (right side only in the game)", leaf: { right: "PostRight" }, dir: "in" },
  { id: "skinnypost", label: "Skinny Post", hint: "Narrow break to the post", leaf: { left: "SkinnyPostLt", right: "SkinnyPostRt" }, dir: "in" },
  { id: "comeback", label: "Comeback", hint: "Hitch-comeback toward the sideline or middle", leaf: { left: "ComebackLT", right: "ComebackRT" }, dir: "out" },
  { id: "fade", label: "Fade / Go", hint: "Release and run it deep", leaf: { left: "FadeStreakLt", right: "FadeStreakRt" }, dir: "out" },
  { id: "outstreak", label: "Outside Release Go", hint: "Fake outside, then go", leaf: { left: "OutsideReleaseStreakLt", right: "OutsideReleaseStreakRt" }, dir: "out" },
];

export const BRANCH_TYPE_BY_ID = new Map(BRANCH_TYPES.map((t) => [t.id, t]));

/** Field direction a player on `side` breaks toward when going "in" (toward the ball) or "out" (toward the sideline). */
export const fieldDir = (side: RouteSide, dir: "in" | "out"): "left" | "right" => ((side === "right") === (dir === "out") ? "right" : "left");

/** The leaf for `type` breaking `dir` from a player on `side`; undefined when the game has no asset for that side. */
export function branchLeaf(type: BranchType, side: RouteSide, dir: "in" | "out"): string | undefined {
  return type.leaf[fieldDir(side, dir)];
}

/** Which branch type and field direction a leaf is (undefined for leaves the picker doesn't know). */
export function parseBranch(leaf: string): { type: BranchType; field: "left" | "right" } | undefined {
  for (const type of BRANCH_TYPES) {
    if (type.leaf.left === leaf) return { type, field: "left" };
    if (type.leaf.right === leaf) return { type, field: "right" };
  }
  return undefined;
}

/** In / out for a leaf from a player on `side` (the inverse of branchLeaf). */
export function branchDir(side: RouteSide, field: "left" | "right"): "in" | "out" {
  return fieldDir(side, "out") === field ? "out" : "in";
}

// ───────────────────────────── the step ─────────────────────────────

export interface Branch {
  route: string;
  coverage: string;
}

export const isOptionStep = (s: Step | undefined): s is Step & { options: Branch[] } => !!s && s.type === "OptionRoute";

export function optionStepIndex(steps: readonly Step[]): number {
  return steps.findIndex((s) => s.type === "OptionRoute");
}

/** The branches of the chain's OptionRoute step (empty when it has none). */
export function branchesOf(step: Step | undefined): Branch[] {
  if (!step || step.type !== "OptionRoute" || !Array.isArray(step.options)) return [];
  return (step.options as unknown[]).flatMap((o) => {
    const r = o && typeof o === "object" ? (o as { route?: unknown; coverage?: unknown }) : undefined;
    return r && typeof r.route === "string" ? [{ route: r.route, coverage: String(r.coverage ?? DEFAULT_COVERAGE) }] : [];
  });
}

/** Default branch first (the game reads the first entry as the one the player runs), then the others in order. */
export function orderBranches(list: readonly Branch[]): Branch[] {
  const def = list.filter((b) => !coverageFlags(b.coverage));
  return [...def.slice(0, 1), ...list.filter((b) => coverageFlags(b.coverage)), ...def.slice(1)];
}

/** A chain with its OptionRoute step's branches replaced (`steps` unchanged when it has no OptionRoute step). */
export function withBranches(steps: readonly Step[], branches: readonly Branch[]): Step[] {
  const i = optionStepIndex(steps);
  if (i < 0) return steps.slice();
  const next = steps.slice();
  next[i] = { ...steps[i], options: orderBranches(branches).map((b) => ({ route: b.route, coverage: b.coverage })) };
  return next;
}

/** A stem plus an OptionRoute step, for turning any route into an option route. */
export function optionStep(branches: readonly Branch[]): Step {
  return { type: "OptionRoute", options: orderBranches(branches).map((b) => ({ ...b })) };
}

/** Mirror a branch to the other side of the field (CurlRight ⇄ CurlLeft…). */
export const mirrorBranch = (b: Branch): Branch => ({ ...b, route: mirrorOptionLeaf(b.route) });

export interface BranchProblem {
  level: "error" | "warning";
  message: string;
}

/** What's wrong with a set of branches: no branches, no Default, coverage listed twice, a leaf the game doesn't have. */
export function branchProblems(branches: readonly Branch[], exists: (leaf: string) => boolean): BranchProblem[] {
  const out: BranchProblem[] = [];
  if (!branches.length) {
    out.push({ level: "error", message: "An option route needs at least one branch." });
    return out;
  }
  const defaults = branches.filter((b) => !coverageFlags(b.coverage)).length;
  if (defaults === 0) out.push({ level: "error", message: "No branch is the Default: the game has nothing to run when no coverage matches." });
  if (defaults > 1) out.push({ level: "warning", message: "Two branches are the Default; only the first is used." });
  let seen = 0;
  for (const b of branches) {
    const f = coverageFlags(b.coverage);
    if (f & seen) {
      const dup = COVERAGES.filter((c) => f & seen & c.bit).map((c) => c.label);
      out.push({ level: "warning", message: `${dup.join(", ")} is picked by more than one branch; the earlier one wins.` });
      break;
    }
    seen |= f;
  }
  for (const b of branches) if (!exists(b.route)) out.push({ level: "error", message: `The game has no option branch called ${b.route}.` });
  return out;
}

// ───────────────────────────── route type ─────────────────────────────

/** The AssignRouteType (what the play-call card calls the route) that best fits these branches. */
export function suggestOptionRouteType(branches: readonly Branch[], side: RouteSide): string {
  const parsed = branches.map((b) => parseBranch(b.route)).filter((p): p is NonNullable<typeof p> => !!p);
  const ids = new Set(parsed.map((p) => p.type.id));
  const has = (...x: string[]) => x.every((i) => ids.has(i));
  const inoutDir = parsed.find((p) => p.type.id === "inout") ? branchDir(side, parsed.find((p) => p.type.id === "inout")!.field) : undefined;
  const T = (leaf: string) => OPTION_ROUTE_TYPE_PREFIX + leaf;
  if (has("hitch", "fade", "slant")) return T("Hitch_Fade_Slant");
  if (has("inout", "fade", "slant")) return T("Out_Fade_Slant");
  if (has("hitch", "fade")) return T("Hitch_Fade");
  if (has("curl", "fade")) return T("Curl_Fade");
  if (has("comeback", "fade")) return T("Comeback_Fade");
  if (has("inout", "fade") && inoutDir === "out") return T("Out_Fade");
  if (has("curl", "corner")) return T("Curl_Corner");
  if (has("comeback", "corner")) return T("Comeback_Corner");
  if (has("post", "corner")) return T("Post_Corner");
  if (has("curl", "inout") && inoutDir === "in") return T("Curl_Dig");
  if (has("inout", "post") && inoutDir === "in") return T("Dig_Post");
  if (has("slant", "inout") && inoutDir === "out") return T("Slant_Out");
  if (has("hitch", "drag")) return T("Drag_Hitch");
  if (has("hitch", "inout") && inoutDir === "out") return T("Hitch_Out");
  if (has("hitch", "inout")) return T("Hitch_In_Out");
  return GENERIC_OPTION_ROUTE_TYPE;
}

/** Every option AssignRouteType in the enum, generic one first. */
export function optionRouteTypes(all: readonly string[]): string[] {
  const rest = all.filter((t) => t.startsWith(OPTION_ROUTE_TYPE_PREFIX) && t !== GENERIC_OPTION_ROUTE_TYPE).sort();
  return all.includes(GENERIC_OPTION_ROUTE_TYPE) ? [GENERIC_OPTION_ROUTE_TYPE, ...rest] : rest;
}

/** "Option_Curl_Dig" → "Curl / Dig". */
export function optionRouteTypeLabel(t: string): string {
  const s = t.slice(OPTION_ROUTE_TYPE_PREFIX.length).replace(/_/g, " ").trim();
  return t === GENERIC_OPTION_ROUTE_TYPE ? "Generic Option" : s;
}

/** Starting branches for a new option route: a hitch that sits by default and an out against man and the zones. */
export function defaultBranches(side: RouteSide): Branch[] {
  const hitch = BRANCH_TYPE_BY_ID.get("hitch")!;
  const inout = BRANCH_TYPE_BY_ID.get("inout")!;
  return [
    { route: branchLeaf(hitch, side, "in")!, coverage: DEFAULT_COVERAGE },
    { route: branchLeaf(inout, side, "out")!, coverage: coverageValue(ALL_MAN | ALL_ZONE) },
  ];
}
