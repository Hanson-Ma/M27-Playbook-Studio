import { describe, expect, it } from "vitest";
import { COVERAGE_CASE_BY_ID, DEFAULT_COVERAGE, branchCoverages, coverageScenarios, optionReceivers, pickBranch, scenarioLabel } from "./optionCoverage";
import { branchNames } from "./optionRoutes";
import type { Step } from "./types";

const stick: Step = {
  type: "OptionRoute",
  options: [
    { route: "HitchRight", coverage: DEFAULT_COVERAGE },
    { route: "InOutRight", coverage: "15" },
    { route: "SlantLt", coverage: "OptionRouteCoverage_Cover2" },
  ],
};
const lib: Step = {
  type: "OptionRoute",
  optionRouteInfo: [{ optionRouteCoverage: DEFAULT_COVERAGE }, { optionRouteCoverage: "OptionRouteCoverage_Cover4" }],
};

describe("picking a branch", () => {
  it("reads authored and library coverages", () => {
    expect(branchCoverages(stick)).toEqual([DEFAULT_COVERAGE, "15", "OptionRouteCoverage_Cover2"]);
    expect(branchCoverages(lib)).toEqual([DEFAULT_COVERAGE, "OptionRouteCoverage_Cover4"]);
    expect(branchCoverages({ type: "RunRoute" })).toEqual([]);
  });
  it("runs the first branch tagged with the coverage, else the Default", () => {
    const c = branchCoverages(stick);
    expect(pickBranch(c, 2)).toBe(1); // man 1 deep
    expect(pickBranch(c, 16)).toBe(2); // cover 2
    expect(pickBranch(c, 32)).toBe(0); // cover 3: default
    expect(pickBranch(c, 0)).toBe(0);
    expect(pickBranch(["15", DEFAULT_COVERAGE], 64)).toBe(1);
    expect(pickBranch(["15", "16"], 64)).toBe(0);
  });
});

describe("scenarios", () => {
  it("groups coverages by what every option receiver runs", () => {
    const rs = optionReceivers([[], [{ type: "RunRoute", distance: 5, direction: 90 }, stick], [lib], [{ type: "PassBlock" }]]);
    expect(rs.map((r) => r.slot)).toEqual([1, 2]);
    const sc = coverageScenarios(rs);
    const label = (picks: number[]) => scenarioLabel(sc.find((s) => s.picks.join() === picks.join())!.cases);
    expect(sc).toHaveLength(4);
    expect(label([1, 0])).toBe("Any Man");
    expect(label([2, 0])).toBe("Cover 2");
    expect(label([0, 1])).toBe("Cover 4");
    expect(label([0, 0])).toBe("Cover 3 · Blitz · Other");
    expect(scenarioLabel([COVERAGE_CASE_BY_ID.get("other")!])).toBe("Other Coverage");
    expect(coverageScenarios([])).toEqual([]);
  });
  it("names branches by the receiver's side, and guesses library ones from the route type", () => {
    expect(branchNames(stick, "right")).toEqual({ guessed: false, names: ["Hitch", "Out", "Slant"] });
    expect(branchNames(stick, "left").names[1]).toBe("Dig");
    expect(branchNames(lib, "right", "AssignRouteType_RR_Option_Hitch_Fade")).toEqual({ guessed: true, names: ["Hitch", "Fade"] });
  });
});
