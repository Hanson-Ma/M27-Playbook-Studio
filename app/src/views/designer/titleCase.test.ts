import { describe, expect, it } from "vitest";
import { titleCase } from "./titleCase";

describe("titleCase", () => {
  it("capitalizes words but not minor ones in the middle", () => {
    expect(titleCase("pass block")).toBe("Pass Block");
    expect(titleCase("block & release")).toBe("Block & Release");
    expect(titleCase("return / shift")).toBe("Return / Shift");
    expect(titleCase("on the line")).toBe("On the Line");
    expect(titleCase("off the line")).toBe("Off the Line");
  });
  it("handles hyphens, parentheses, acronyms and units", () => {
    expect(titleCase("Hitch-and-Go (in)")).toBe("Hitch-and-Go (In)");
    expect(titleCase("pre-snap motion")).toBe("Pre-Snap Motion");
    expect(titleCase("2 yd outside TE")).toBe("2 yd Outside TE");
    expect(titleCase("90° inside")).toBe("90° Inside");
    expect(titleCase("RR curl")).toBe("RR Curl");
  });
});
