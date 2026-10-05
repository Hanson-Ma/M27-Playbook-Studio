import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCatalog } from "../../model/catalog";
import { situationCounts, situationPlays } from "../../model/concepts";
import { loadLibraryData, loadPlaysDoc } from "../../model/libFixture";
import { buildLibraryIndex } from "../../model/library";
import { resolvePlaybook } from "../../model/resolveBook";
import { templateContents } from "../../model/tdb";
import type { PlaybookSpec } from "../../model/types";
import { isTemplateRef, templateSectionsBook } from "./templateBook";

const lib = buildLibraryIndex(loadLibraryData());
const cat = buildCatalog(lib, [loadPlaysDoc("art-test.json"), loadPlaysDoc("pbs-ytrips-v1.json")]);
// A STUDIO-like book (frozen here so edits to playbooks/studio-test.json don't move the expectations).
const spec: PlaybookSpec = {
  name: "STUDIO",
  side: "offense",
  formations: [
    {
      formation: "Shotgun",
      sets: [
        {
          set: "Y Trips Wk",
          plays: [
            { play: "PBS GT Counter", audible: 2, cpu: { FirstDown: 40, "2ndAndShort": 50, "3rdAndShort": 30 } },
            { play: "Inside Zone" },
            { play: "Slants", audible: 1 },
          ],
        },
      ],
    },
    { formation: "Goal Line Offense", sets: "template" },
    { formation: "Special", sets: "template" },
    { formation: "Kickoff", sets: "template" },
    { formation: "Safety Kickoff", sets: "template" },
  ],
} as PlaybookSpec;
const contents = templateContents(new Uint8Array(readFileSync(new URL("../../../../playbooks/templates/PBOOKOFF-TEMPLATE", import.meta.url))), lib);

describe("templateSectionsBook", () => {
  const rb = resolvePlaybook(spec, cat);
  const tb = templateSectionsBook(rb, contents, lib);

  it("fills the template sections the game-side builder copies, keeping the spec's formation index", () => {
    expect(rb.counts.templateFormations).toBe(4);
    // tools/pbook-build.mjs resolves names by side (commit ac54574): offense "Special" copies its punt / field goal sets.
    expect(tb.formations.map((f) => [f.index, String(f.entry.formation)])).toEqual([
      [1, "Goal Line Offense"],
      [2, "Special"],
      [3, "Kickoff"],
      [4, "Safety Kickoff"],
    ]);
    expect(tb.formations.every((f) => !f.template && f.sets.every((s) => s.plays.every((p) => p.play?.source === "library")))).toBe(true);
    expect(templateSectionsBook(rb, contents, lib)).toBe(tb); // memoized per book + contents
  });

  it("lets the gameplan queries see template CPU weights (goal line, special teams)", () => {
    // The file's own plays carry no goal-line weights…
    expect(situationPlays(rb, null, "GoalLine")).toEqual([]);
    // …the Goal Line Offense template section does.
    const gl = situationPlays(tb, null, "GoalLine");
    expect(gl.map((x) => x.ref.play.name).sort()).toEqual(["FB Dive Weak", "HB Power G", "PA Power O", "Strong Toss"]);
    expect(gl.every((x) => isTemplateRef(rb, x.ref) && x.ref.formation === "Goal Line Offense" && x.ref.set === "Normal")).toBe(true);
    expect(situationCounts(tb).get("FieldGoal")?.plays ?? 0).toBeGreaterThan(0); // the Special section's field goals
    expect(situationCounts(tb).get("Kickoff")?.plays).toBeGreaterThan(0);
    // the file's own plays are not template refs
    const own = situationPlays(rb, null, "FirstDown");
    expect(own.length).toBeGreaterThan(0);
    expect(own.some((x) => isTemplateRef(rb, x.ref))).toBe(false);
  });

  it("is empty for books without template sections", () => {
    const plain = resolvePlaybook({ ...spec, formations: spec.formations.filter((f) => f.sets !== "template") }, cat);
    expect(templateSectionsBook(plain, contents, lib).formations).toEqual([]);
  });
});
