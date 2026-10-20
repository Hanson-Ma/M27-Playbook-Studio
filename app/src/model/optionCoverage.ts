// Option-route coverages (pure, no imports but types, so art.ts can use it without an import cycle): the
// OptionRouteCoverage flags enum, which branch the game picks for a coverage, and a play's coverage SCENARIOS —
// coverages grouped by what every option receiver ends up running against them.
import type { Step } from "./types";

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


// ───────────────────────────── which branch runs ─────────────────────────────

/** A coverage the defense can show: one of COVERAGES, or "other" (none of them: the Default branch runs). */
export interface CoverageCase {
  id: string;
  /** The coverage's flag bit; 0 for "other". */
  bit: number;
  label: string;
  /** Short name for scenario titles ("Cover 1", "2-Man"…). */
  short: string;
  hint: string;
}

const SHORT: Record<string, string> = { man0: "Cover 0", man1: "Cover 1", man2: "2-Man", man3: "Man 3-Deep", blitz: "Blitz" };
export const OTHER_COVERAGE: CoverageCase = { id: "other", bit: 0, label: "Other Coverage", short: "Other", hint: "Anything no branch is picked for: the Default branch runs" };
export const COVERAGE_CASES: CoverageCase[] = [...COVERAGES.map(({ id, bit, label, hint }) => ({ id, bit, label, short: SHORT[id] ?? label, hint })), OTHER_COVERAGE];
export const COVERAGE_CASE_BY_ID = new Map(COVERAGE_CASES.map((c) => [c.id, c]));

/** The coverage value of each branch of an OptionRoute step: authored `options[].coverage` or the library's `optionRouteInfo[].optionRouteCoverage`. */
export function branchCoverages(step: Step | undefined): string[] {
  if (!step || step.type !== "OptionRoute") return [];
  const pick = (list: unknown, key: string): string[] | undefined =>
    Array.isArray(list) && list.length ? list.map((o) => String((o && typeof o === "object" ? (o as Record<string, unknown>)[key] : undefined) ?? DEFAULT_COVERAGE)) : undefined;
  return pick(step.options, "coverage") ?? pick(step.optionRouteInfo, "optionRouteCoverage") ?? [];
}

/**
 * Index of the branch the game runs against a coverage (`bit`, 0 = none of the listed ones): the first branch tagged
 * with it, else the first Default branch, else the first branch.
 */
export function pickBranch(coverages: readonly unknown[], bit: number): number {
  if (bit) {
    const k = coverages.findIndex((c) => coverageFlags(c) & bit);
    if (k >= 0) return k;
  }
  const d = coverages.findIndex((c) => !coverageFlags(c));
  return d >= 0 ? d : 0;
}

// ───────────────────────────── scenarios ─────────────────────────────

export interface OptionReceiver {
  slot: number;
  /** Coverage value of each branch, in step order. */
  coverages: string[];
}

/** The players with an option route (an OptionRoute step with branches), in slot order. */
export function optionReceivers(slots: readonly (readonly Step[] | undefined)[]): OptionReceiver[] {
  const out: OptionReceiver[] = [];
  slots.forEach((steps, slot) => {
    const step = (steps ?? []).find((s) => s && s.type === "OptionRoute");
    const coverages = branchCoverages(step);
    if (coverages.length) out.push({ slot, coverages });
  });
  return out;
}

export interface CoverageScenario {
  /** The coverages that lead here (one bit each; "other" last). */
  cases: CoverageCase[];
  /** Branch index each receiver runs (aligned with the receivers list). */
  picks: number[];
}

/** Coverages grouped by what the option receivers do against them: one scenario per distinct combination of branches. */
export function coverageScenarios(receivers: readonly OptionReceiver[]): CoverageScenario[] {
  const out: CoverageScenario[] = [];
  if (!receivers.length) return out;
  for (const c of COVERAGE_CASES) {
    const picks = receivers.map((r) => pickBranch(r.coverages, c.bit));
    const same = out.find((sc) => sc.picks.every((p, i) => p === picks[i]));
    if (same) same.cases.push(c);
    else out.push({ cases: [c], picks });
  }
  return out;
}

/** "Cover 2 · Cover 3", "Any Man", "Any Man · Blitz"… for a scenario's coverages. */
export function scenarioLabel(cases: readonly CoverageCase[]): string {
  const bits = cases.reduce((a, c) => a | c.bit, 0);
  const parts: string[] = [];
  const manAll = (bits & ALL_MAN) === ALL_MAN;
  const zoneAll = (bits & ALL_ZONE) === ALL_ZONE;
  if (manAll) parts.push("Any Man");
  if (zoneAll) parts.push("Any Zone");
  for (const c of cases) {
    if (!c.bit) continue;
    if (manAll && c.bit & ALL_MAN) continue;
    if (zoneAll && c.bit & ALL_ZONE) continue;
    parts.push(c.short);
  }
  if (cases.some((c) => !c.bit)) parts.push(parts.length ? "Other" : OTHER_COVERAGE.label);
  return cases.length === COVERAGE_CASES.length ? "Every Coverage" : parts.join(" · ");
}
