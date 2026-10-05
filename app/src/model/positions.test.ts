import { describe, expect, it } from "vitest";
import { loadLibraryData } from "./libFixture";
import { glyphFor, positionCode, positionName, slotLabel } from "./positions";

describe("positions", () => {
  it("maps every Position value used by a library set to a real position code", () => {
    const unknown = new Set<string>();
    for (const set of loadLibraryData().sets) {
      for (const a of set.movements.Normal ?? []) {
        const code = positionCode(a.pos);
        if (positionName(a.pos) === code) unknown.add(`${a.pos} → ${code}`);
      }
    }
    expect([...unknown]).toEqual([]);
  });

  it("resolves enum aliases to the value they share", () => {
    expect(slotLabel("POSITION_FIRSTOFFENSELINE", 0)).toBe("LT");
    expect(slotLabel("POSITION_LASTNORMAL", 1)).toBe("LS");
    expect(slotLabel("POSITION_MAXNORMAL", 1)).toBe("KR");
    expect(slotLabel("POSITION_LASTKPRETURN", 1)).toBe("PR");
    expect(slotLabel("POSITION_LASTSPECIAL", 2)).toBe("NB2");
    expect(glyphFor({ pos: "POSITION_LASTSPECIAL", group: "Set_Group_Type_Defensive_Backs" })).toBe("def");
    expect(slotLabel("POSITION_WR", 2)).toBe("WR2");
  });
});
