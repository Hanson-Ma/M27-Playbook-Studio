import { describe, expect, it } from "vitest";
import { movePackage, newPackage, packageChanges, packagesOf, packageSlots, uniquePackageName } from "./packages";
import type { AlignmentPos, SetPackage } from "./types";

const A = (pos: string, depth = 1): AlignmentPos => ({ pos, depth, x: 0, y: 0 }) as AlignmentPos;
const normal = [A("POSITION_QB"), A("POSITION_HB"), A("POSITION_WR", 1), A("POSITION_SLWR"), A("POSITION_LASTKEYOFFENSE"), A("POSITION_WR", 2)];

describe("packages", () => {
  it("a new package is the Normal alignment; changes list only the swapped slots", () => {
    const pk = newPackage(normal, "HB Sub");
    expect(pk.positions).toHaveLength(6);
    expect(packageChanges(pk, normal)).toEqual([]);
    pk.positions[1] = { slot: 1, pos: "POSITION_HB", depth: 2 };
    pk.positions[3] = { slot: 3, pos: "POSITION_GAD", depth: 1 };
    expect(packageChanges(pk, normal)).toEqual(["HB1 → HB2", "SL1 → GAD"]);
  });

  it("aliases of one position aren't a change (POSITION_TE = POSITION_LASTKEYOFFENSE)", () => {
    const pk: SetPackage = { name: "x", positions: [{ slot: 4, pos: "POSITION_TE", depth: 1 }] };
    expect(packageChanges(pk, normal)).toEqual([]);
    expect(packageSlots(pk, normal).map((q) => q.pos)).toEqual(["POSITION_QB", "POSITION_HB", "POSITION_WR", "POSITION_SLWR", "POSITION_TE", "POSITION_WR"]);
  });

  it("custom list wins over the starting set's; reorder and unique names", () => {
    const a = { name: "A", positions: [] }, b = { name: "B", positions: [] };
    expect(packagesOf({ packages: [a] }, {})).toEqual([a]);
    expect(packagesOf({ packages: [a] }, { packages: [b] })).toEqual([b]);
    expect(movePackage([a, b], 1, -1).map((p) => p.name)).toEqual(["B", "A"]);
    expect(movePackage([a, b], 0, -1).map((p) => p.name)).toEqual(["A", "B"]);
    expect(uniquePackageName([{ name: "Package", positions: [] }])).toBe("Package 2");
  });
});
