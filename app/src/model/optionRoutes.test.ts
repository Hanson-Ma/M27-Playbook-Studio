import { describe, expect, it } from "vitest";
import {
  ALL_MAN,
  ALL_ZONE,
  BRANCH_TYPES,
  COVERAGES,
  DEFAULT_COVERAGE,
  branchDir,
  branchLeaf,
  branchProblems,
  branchesOf,
  coverageFlags,
  coverageSummary,
  coverageValue,
  defaultBranches,
  optionRouteTypes,
  orderBranches,
  parseBranch,
  suggestOptionRouteType,
  withBranches,
} from "./optionRoutes";
import { presetSteps } from "./routes";

describe("coverage flags", () => {
  it("reads enum names, flag sums and Default", () => {
    expect(coverageFlags(DEFAULT_COVERAGE)).toBe(0);
    expect(coverageFlags("OptionRouteCoverage_Cover2")).toBe(16);
    expect(coverageFlags("15")).toBe(ALL_MAN);
    expect(coverageFlags(143)).toBe(143);
  });
  it("writes the enum member for one coverage and the sum for several", () => {
    expect(coverageValue(0)).toBe(DEFAULT_COVERAGE);
    expect(coverageValue(16)).toBe("OptionRouteCoverage_Cover2");
    expect(coverageValue(ALL_MAN)).toBe("15");
    for (const c of COVERAGES) expect(coverageFlags(coverageValue(c.bit))).toBe(c.bit);
  });
  it("summarizes", () => {
    expect(coverageSummary(DEFAULT_COVERAGE)).toBe("Default");
    expect(coverageSummary("15")).toBe("Any Man");
    expect(coverageSummary(String(ALL_MAN | ALL_ZONE))).toBe("Any Man + Any Zone");
    expect(coverageSummary(16 + 32)).toBe("Cover 2 + Cover 3");
  });
});

describe("branch leaves", () => {
  it("names leaves by field direction and inverts them", () => {
    const hitch = BRANCH_TYPES.find((t) => t.id === "hitch")!;
    expect(branchLeaf(hitch, "right", "out")).toBe("HitchRight");
    expect(branchLeaf(hitch, "right", "in")).toBe("HitchLeft");
    expect(branchLeaf(hitch, "left", "out")).toBe("HitchLeft");
    for (const t of BRANCH_TYPES)
      for (const side of ["left", "right"] as const)
        for (const dir of ["in", "out"] as const) {
          const leaf = branchLeaf(t, side, dir);
          if (!leaf) continue;
          const p = parseBranch(leaf)!;
          expect(p.type.id).toBe(t.id);
          expect(branchDir(side, p.field)).toBe(dir);
        }
  });
  it("only has one side for Corner and Post, like the game", () => {
    const corner = BRANCH_TYPES.find((t) => t.id === "corner")!;
    const post = BRANCH_TYPES.find((t) => t.id === "post")!;
    expect([branchLeaf(corner, "left", "out"), branchLeaf(corner, "right", "out")]).toEqual(["CornerLt", undefined]);
    expect([branchLeaf(post, "left", "in"), branchLeaf(post, "right", "in")]).toEqual(["PostRight", undefined]);
  });
});

describe("the OptionRoute step", () => {
  it("puts the Default branch first", () => {
    const o = orderBranches([
      { route: "SlantLt", coverage: "15" },
      { route: "HitchLeft", coverage: DEFAULT_COVERAGE },
    ]);
    expect(o.map((b) => b.route)).toEqual(["HitchLeft", "SlantLt"]);
  });
  it("replaces the branches of a preset's step and leaves chains without one alone", () => {
    const { steps } = presetSteps("stick", { side: "right" });
    const next = withBranches(steps, [{ route: "CurlRight", coverage: DEFAULT_COVERAGE }]);
    expect(branchesOf(next.find((s) => s.type === "OptionRoute"))).toEqual([{ route: "CurlRight", coverage: DEFAULT_COVERAGE }]);
    const plain = presetSteps("slant", { side: "right" }).steps;
    expect(withBranches(plain, defaultBranches("right"))).toEqual(plain);
  });
});

describe("checks and route type", () => {
  const exists = (l: string) => !!parseBranch(l);
  it("flags no Default, repeated coverage and unknown leaves", () => {
    expect(branchProblems([], exists)[0].level).toBe("error");
    expect(branchProblems([{ route: "SlantLt", coverage: "15" }], exists).some((p) => /Default/.test(p.message))).toBe(true);
    expect(
      branchProblems(
        [
          { route: "HitchLeft", coverage: DEFAULT_COVERAGE },
          { route: "SlantLt", coverage: "15" },
          { route: "CurlLeft", coverage: "3" },
        ],
        exists,
      ).some((p) => p.level === "warning"),
    ).toBe(true);
    expect(branchProblems([{ route: "Nope", coverage: DEFAULT_COVERAGE }], exists).some((p) => p.level === "error")).toBe(true);
    expect(branchProblems(defaultBranches("left"), exists)).toEqual([]);
  });
  it("suggests the game's option route type", () => {
    const b = (...routes: string[]) => routes.map((route, i) => ({ route, coverage: i ? "15" : DEFAULT_COVERAGE }));
    expect(suggestOptionRouteType(b("HitchRight", "InOutRight"), "right")).toBe("AssignRouteType_RR_Option_Hitch_Out");
    expect(suggestOptionRouteType(b("CurlRight", "InOutLeft"), "right")).toBe("AssignRouteType_RR_Option_Curl_Dig");
    expect(suggestOptionRouteType(b("HitchRight", "FadeStreakRt", "SlantLt"), "right")).toBe("AssignRouteType_RR_Option_Hitch_Fade_Slant");
    expect(suggestOptionRouteType(b("DragLt"), "right")).toBe("AssignRouteType_RR_Option_Route");
  });
  it("lists the option route types with the generic one first", () => {
    const all = ["AssignRouteType_RR_Hitch", "AssignRouteType_RR_Option_Curl_Dig", "AssignRouteType_RR_Option_Route", "AssignRouteType_RR_Option_Hitch_Out"];
    expect(optionRouteTypes(all)).toEqual(["AssignRouteType_RR_Option_Route", "AssignRouteType_RR_Option_Curl_Dig", "AssignRouteType_RR_Option_Hitch_Out"]);
  });
});
