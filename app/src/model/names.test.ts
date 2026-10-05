import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  displayFromLeaf,
  folder,
  formationShort,
  leaf,
  norm,
  playSubtitle,
  prettyAsset,
  sanitizeAssetLeaf,
  sanitizeBookName,
  uniqueName,
} from "./names";

const REPO = path.resolve(import.meta.dirname, "../../..");
const SAMPLES = [
  "Y Trips Wk",
  "Y_Trips_Wk",
  "  Gun   Bunch  ",
  "PBS GT Counter",
  "I_Form__Tight\tPair",
  "Mtn PA Smash Scissors",
  "HB Slip Screen",
  "Shotgun",
  "SHOTGUN",
  "Goal Line Offense",
  "Weak_I_Twins",
  "",
  " _ ",
  "Ünïcode Formation",
  "3-4 Odd",
];

/** tools/pbook-build.mjs's own `norm`, extracted from its source so the two can't drift apart silently. */
function toolNorm(): ((s: string) => string) | undefined {
  let src: string;
  try {
    src = readFileSync(path.join(REPO, "tools/pbook-build.mjs"), "utf8");
  } catch {
    return undefined;
  }
  const m = /const norm = (s => [^\n]+);/.exec(src);
  if (!m) throw new Error("tools/pbook-build.mjs: `const norm = s => …;` not found — update this test");
  return new Function(`return (${m[1]})`)() as (s: string) => string;
}

describe("norm", () => {
  it("matches the documented pbook-build rule", () => {
    const rule = (s: string) => s.toLowerCase().replace(/[\s_]+/g, " ").trim();
    for (const s of SAMPLES) expect(norm(s)).toBe(rule(s));
    expect(norm("Y_Trips_Wk")).toBe("y trips wk");
    expect(norm("  Gun   Bunch  ")).toBe("gun bunch");
    expect(norm("I_Form__Tight\tPair")).toBe("i form tight pair");
  });

  it("matches tools/pbook-build.mjs exactly", () => {
    const ref = toolNorm();
    if (!ref) return; // tools/ not present next to the app
    for (const s of SAMPLES) expect(norm(s)).toBe(ref(s));
  });
});

describe("asset paths", () => {
  const asset = "football/Gameplay/playbooks/PlayLibrary/Formations/Offense/Shotgun/Y_Trips_Wk/Curls";
  it("leaf / folder / prettyAsset", () => {
    expect(leaf(asset)).toBe("Curls");
    expect(folder(asset)).toBe("football/Gameplay/playbooks/PlayLibrary/Formations/Offense/Shotgun/Y_Trips_Wk/");
    expect(leaf("Curls")).toBe("Curls");
    expect(folder("Curls")).toBe("");
    expect(prettyAsset(asset)).toBe("Y_Trips_Wk/Curls");
    expect(prettyAsset(asset, 3)).toBe("Shotgun/Y_Trips_Wk/Curls");
  });
});

describe("sanitizers", () => {
  it("sanitizeBookName keeps A–Z0–9, uppercased", () => {
    expect(sanitizeBookName("Studio Lib-2!")).toBe("STUDIOLIB2");
    expect(sanitizeBookName("abc_123")).toBe("ABC123");
  });

  it("sanitizeAssetLeaf keeps [A-Za-z0-9_] and collapses separators", () => {
    expect(sanitizeAssetLeaf("PBS GT Counter")).toBe("PBS_GT_Counter");
    expect(sanitizeAssetLeaf("  Mtn - PA / Smash.v2 ")).toBe("Mtn_PA_Smash_v2");
    expect(sanitizeAssetLeaf("__a__b__")).toBe("a_b");
    expect(sanitizeAssetLeaf("Snag (Wk)!")).toBe("Snag_Wk");
  });

  it("uniqueName appends _2, _3… case-insensitively", () => {
    expect(uniqueName("PBS_Snag", new Set())).toBe("PBS_Snag");
    expect(uniqueName("PBS_Snag", new Set(["pbs_snag"]))).toBe("PBS_Snag_2");
    expect(uniqueName("PBS_Snag", new Set(["PBS_Snag", "PBS_Snag_2"]))).toBe("PBS_Snag_3");
    expect(uniqueName("Snag", new Set(["Snag"]), " ")).toBe("Snag 2");
  });
});

describe("display names", () => {
  it("displayFromLeaf", () => {
    expect(displayFromLeaf("Y_Trips_Wk")).toBe("Y Trips Wk");
    expect(displayFromLeaf("_Gun__Bunch_")).toBe("Gun Bunch");
  });

  it("formationShort", () => {
    expect(formationShort("Shotgun")).toBe("GUN");
    expect(formationShort("Singleback")).toBe("SINGLEBACK");
    expect(formationShort("Pistol")).toBe("PISTOL");
    expect(formationShort("I Form")).toBe("I FORM");
    expect(formationShort("I_Form")).toBe("I FORM");
    expect(formationShort("Goal Line Offense")).toBe("GOAL LINE");
    expect(formationShort("Nickel")).toBe("NICKEL");
  });

  it("playSubtitle", () => {
    expect(playSubtitle("Shotgun", "Y Trips Wk")).toBe("GUN Y TRIPS WK");
    expect(playSubtitle("Shotgun", "Shotgun")).toBe("GUN");
    expect(playSubtitle("Singleback", "Ace")).toBe("SINGLEBACK ACE");
  });
});
