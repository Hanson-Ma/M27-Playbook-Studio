import { readFileSync } from "node:fs";
import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { buildCatalog } from "./catalog";
import { parseJson, serializeDoc } from "./json";
import { loadLibraryData, loadPlaysDoc, studioV1 } from "./libFixture";
import { buildLibraryIndex } from "./library";
import {
  addFormation,
  addSet,
  bookIds,
  clampWeight,
  convertTemplateFormation,
  cpuOf,
  deepClone,
  duplicateRefs,
  entryAt,
  formationInsertIndex,
  idOf,
  insertFormations,
  insertPlays,
  insertSets,
  insertionIndex,
  moveBlock,
  moveFormations,
  movePlays,
  moveSets,
  newPlaybookSpec,
  nextAudible,
  parseWhere,
  playbookPathFor,
  refLevel,
  removeRefs,
  saveNameFor,
  setAudible,
  setCpuWeight,
  setCpuWeights,
  stockTemplateSpec,
  togglePlay,
  topLevelRefs,
  unknownKeys,
  whereOf,
  COMMON_CPU_KEYS,
  DEFAULT_PLAYBOOK_PATH,
  DEFAULT_TEMPLATE_FORMATIONS,
  PLAY_ENTRY_KEYS,
  cpuEditorGroups,
  defaultPlaybookPath,
} from "./playbook";
import { playbookIssues, resolvePlaybook } from "./resolveBook";
import { templateContents, templateFormationFor, templateFormationToEntry, templateToSpecEntries } from "./tdb";
import type { PlayEntry, PlaybookSpec, SetEntry } from "./types";

const lib = buildLibraryIndex(loadLibraryData());
const cat = buildCatalog(lib, [loadPlaysDoc("art-test.json"), loadPlaysDoc("pbs-ytrips-v1.json")]);
const text = (name: string) => readFileSync(new URL(`../../../playbooks/${name}`, import.meta.url), "utf8");
const book = (name: string): PlaybookSpec => parseJson<PlaybookSpec>(text(name));
const templateBytes = new Uint8Array(readFileSync(new URL("../../../playbooks/templates/PBOOKOFF-TEMPLATE", import.meta.url)));

/** A spec with unknown keys at every level. */
function tagged(): PlaybookSpec {
  const spec = studioV1();
  spec.version = 7;
  const f0 = spec.formations[0];
  f0.color = "red";
  const sets = f0.sets as SetEntry[];
  sets[0].note = "set note";
  sets[0].plays[0].tag = { a: [1, 2] };
  sets[0].plays[6].hot = true;
  sets[1].plays[0].x = 1;
  return spec;
}

const sets0 = (spec: PlaybookSpec) => spec.formations[0].sets as SetEntry[];
const names = (se: SetEntry) => se.plays.map((p) => p.play);

describe("round trip", () => {
  it("both example playbooks serialize back to the same meaning", () => {
    for (const name of ["studio-test.json", "studio-lib.json"]) {
      const spec = book(name);
      const out = serializeDoc("playbook", spec);
      expect(parseJson(out)).toEqual(spec);
      // A no-op edit through immer keeps the exact text.
      const same = produce(spec, (d) => {
        moveFormations(d, [0], 0, "before");
      });
      expect(serializeDoc("playbook", same)).toBe(out);
    }
  });

  it("moving an entry away and back restores the file", () => {
    for (const name of ["studio-test.json", "studio-lib.json"]) {
      const spec = book(name);
      const moved = produce(spec, (d) => {
        expect(movePlays(d, 0, 0, [0], 5, "after")).toEqual([5]);
        expect(moveFormations(d, [0], 3, "after")).toEqual([3]);
      });
      expect(serializeDoc("playbook", moved)).not.toBe(serializeDoc("playbook", spec));
      const back = produce(moved, (d) => {
        moveFormations(d, [3], 0, "before");
        movePlays(d, 0, 0, [5], 0, "before");
      });
      expect(serializeDoc("playbook", back)).toBe(serializeDoc("playbook", spec));
    }
  });
});

describe("refs & ids", () => {
  it("parses ValidationIssue.where", () => {
    expect(parseWhere("/formations/2")).toEqual({ f: 2 });
    expect(parseWhere("/formations/0/sets/1")).toEqual({ f: 0, s: 1 });
    expect(parseWhere("/formations/0/sets/1/plays/3")).toEqual({ f: 0, s: 1, p: 3 });
    expect(parseWhere(undefined)).toBeUndefined();
    expect(parseWhere("/name")).toBeUndefined();
    expect(whereOf({ f: 1, s: 2, p: 3 })).toBe("/formations/1/sets/2/plays/3");
    expect(refLevel({ f: 1, s: 2 })).toBe("set");
  });

  it("gives every entry a stable id that follows it through reorders", () => {
    const spec = studioV1();
    const ids = bookIds(spec);
    expect(bookIds(spec)).toBe(ids); // memoized per object
    const iz = idOf(ids, { f: 0, s: 0, p: 6 })!;
    expect(iz).toBe("F:shotgun#0/S:y trips wk#0/P:inside zone#0");
    expect(ids.refs.get(iz)).toEqual({ f: 0, s: 0, p: 6 });
    const moved = produce(spec, (d) => {
      movePlays(d, 0, 0, [6], 0, "before");
    });
    const ids2 = bookIds(moved);
    expect(ids2.refs.get(iz)).toEqual({ f: 0, s: 0, p: 0 });
    // Distinct ids for duplicates.
    const dup = produce(spec, (d) => {
      duplicateRefs(d, [{ f: 0, s: 1, p: 0 }]);
    });
    const d3 = bookIds(dup);
    expect(d3.formations[0].sets[1].plays).toEqual([
      "F:shotgun#0/S:bunch#0/P:mesh#0",
      "F:shotgun#0/S:bunch#0/P:mesh#1",
      "F:shotgun#0/S:bunch#0/P:reverse#0",
    ]);
    expect(new Set(d3.refs.keys()).size).toBe(d3.refs.size);
  });
});

describe("moveBlock", () => {
  const run = (from: number[], target: number, where: "before" | "after") => {
    const list = ["a", "b", "c", "d", "e"];
    const idx = moveBlock(list, from, target, where);
    return { list: list.join(""), idx };
  };
  it("moves single items and blocks, keeping relative order", () => {
    expect(run([0], 3, "after")).toEqual({ list: "bcdae", idx: [3] });
    expect(run([4], 0, "before")).toEqual({ list: "eabcd", idx: [0] });
    expect(run([3, 1], 4, "after")).toEqual({ list: "acebd", idx: [3, 4] });
    expect(run([0, 4], 2, "before")).toEqual({ list: "baecd", idx: [1, 2] });
  });
  it("is a no-op for a contiguous block dropped on itself and gathers a scattered one", () => {
    expect(run([1, 2], 2, "after")).toEqual({ list: "abcde", idx: [1, 2] });
    expect(run([1, 3], 3, "after")).toEqual({ list: "acbde", idx: [2, 3] });
  });
  it("ignores bad indices", () => {
    expect(run([9], 0, "before").list).toBe("abcde");
    expect(run([1], 9, "before").list).toBe("abcde");
  });
});

describe("moves keep unknown keys", () => {
  it("formations, sets and plays", () => {
    const spec = tagged();
    const next = produce(spec, (d) => {
      moveFormations(d, [0], 4, "after");
      moveSets(d, 4, [1], 0, "before");
      movePlays(d, 4, 1, [0, 6], 16, "after");
    });
    expect(next.version).toBe(7);
    const f = next.formations[4];
    expect(f.formation).toBe("Shotgun");
    expect(f.color).toBe("red");
    const [bunch, ytw] = f.sets as SetEntry[];
    expect(bunch.set).toBe("Bunch");
    expect(bunch.plays[0].x).toBe(1);
    expect(ytw.note).toBe("set note");
    expect(ytw.plays.slice(-2).map((p) => p.play)).toEqual(["PBS GT Counter", "Inside Zone"]);
    expect(ytw.plays[15].tag).toEqual({ a: [1, 2] });
    expect(ytw.plays[16].hot).toBe(true);
    expect(ytw.plays[15].audible).toBe(2);
    expect(ytw.plays[15].cpu).toEqual({ FirstDown: 40, "2ndAndShort": 50, "3rdAndShort": 30 });
    // the original is untouched (immer)
    expect(spec.formations[0].formation).toBe("Shotgun");
  });
});

describe("insert / remove / duplicate", () => {
  it("adds formations before the template sections and sets at the end", () => {
    const next = produce(book("studio-lib.json"), (d) => {
      expect(formationInsertIndex(d)).toBe(1);
      const f = addFormation(d, "Pistol");
      expect(f).toBe(1);
      const s = addSet(d, f, "Ace");
      expect(s).toBe(0);
      expect(() => addSet(d, 2, "Goal Line")).toThrow(/template/);
    });
    expect(next.formations.map((f) => f.formation)).toEqual(["Shotgun", "Pistol", "Goal Line Offense", "Special", "Kickoff", "Safety Kickoff"]);
    expect(next.formations[1].sets).toEqual([{ set: "Ace", plays: [] }]);
  });

  it("inserts deep clones and drops audibles already used in the set", () => {
    const src: PlayEntry = { play: "Mesh", audible: 2, cpu: { FirstDown: 10 }, extra: { deep: true } };
    const next = produce(book("studio-lib.json"), (d) => {
      const idx = insertPlays(d, 0, 0, [src, { play: "Drive", audible: 3 }], 1);
      expect(idx).toEqual([1, 2]);
    });
    const ps = sets0(next)[0].plays;
    expect(ps[1]).toEqual({ play: "Mesh", cpu: { FirstDown: 10 }, extra: { deep: true } }); // slot 2 is Inside Zone's
    expect(ps[1].extra).not.toBe(src.extra);
    expect(ps[2]).toEqual({ play: "Drive" }); // slot 3 is HB Slip Screen's
    const withSlot = produce(book("studio-lib.json"), (d) => {
      (sets0(d)[0].plays as PlayEntry[]).forEach((p) => delete p.audible);
      insertPlays(d, 0, 0, [{ play: "A", audible: 3 }, { play: "B", audible: 3 }]);
    });
    expect(sets0(withSlot)[0].plays.slice(-2)).toEqual([{ play: "A", audible: 3 }, { play: "B" }]);
    const fs = produce(book("studio-lib.json"), (d) => {
      insertFormations(d, [{ formation: "Pistol", sets: [], z: 1 }]);
      insertSets(d, 0, [{ set: "Trips", plays: [], q: 2 }], 0);
    });
    expect(fs.formations[1]).toEqual({ formation: "Pistol", sets: [], z: 1 });
    expect(sets0(fs)[0]).toEqual({ set: "Trips", plays: [], q: 2 });
  });

  it("removes any mix of entries (children of removed parents are ignored)", () => {
    const refs = [{ f: 0, s: 0, p: 0 }, { f: 0, s: 0, p: 2 }, { f: 0, s: 1 }, { f: 0, s: 1, p: 0 }, { f: 4 }];
    expect(topLevelRefs(refs)).toEqual([{ f: 0, s: 0, p: 0 }, { f: 0, s: 0, p: 2 }, { f: 0, s: 1 }, { f: 4 }]);
    const next = produce(tagged(), (d) => {
      expect(removeRefs(d, refs)).toBe(4);
    });
    expect(next.formations.map((f) => f.formation)).toEqual(["Shotgun", "Goal Line Offense", "Special", "Kickoff"]);
    const ytw = sets0(next);
    expect(ytw.length).toBe(1);
    expect(ytw[0].note).toBe("set note");
    expect(names(ytw[0]).slice(0, 2)).toEqual(["PBS PA Yankee", "PBS Bubble Go"]);
  });

  it("duplicates plays (without audible), sets and formations, keeping unknown keys", () => {
    const spec = tagged();
    let clones: ReturnType<typeof duplicateRefs> = [];
    const next = produce(spec, (d) => {
      clones = duplicateRefs(d, [{ f: 0, s: 0, p: 0 }, { f: 0, s: 0, p: 6 }]);
    });
    expect(clones).toEqual([{ f: 0, s: 0, p: 7 }, { f: 0, s: 0, p: 8 }]);
    const ps = sets0(next)[0].plays;
    expect(ps[7]).toEqual({ play: "PBS GT Counter", cpu: { FirstDown: 40, "2ndAndShort": 50, "3rdAndShort": 30 }, tag: { a: [1, 2] } });
    expect(ps[8]).toEqual({ play: "Inside Zone", hot: true });
    expect(ps[0].audible).toBe(2);

    const s2 = produce(spec, (d) => {
      expect(duplicateRefs(d, [{ f: 0, s: 1 }])).toEqual([{ f: 0, s: 2 }]);
      expect(duplicateRefs(d, [{ f: 0 }])).toEqual([{ f: 1 }]);
    });
    expect(sets0(s2)[2]).toEqual(sets0(spec)[1]);
    expect(s2.formations[1]).toEqual(s2.formations[0]);
    expect(s2.formations[1]).not.toBe(s2.formations[0]);
    expect(s2.formations[1].color).toBe("red");
  });

  it("duplicates a mixed selection with consistent refs", () => {
    let out: ReturnType<typeof duplicateRefs> = [];
    const next = produce(tagged(), (d) => {
      out = duplicateRefs(d, [{ f: 0 }, { f: 2 }]);
    });
    // A multi-selection duplicates as one block after its last member.
    expect(out).toEqual([{ f: 3 }, { f: 4 }]);
    expect(next.formations.map((f) => f.formation)).toEqual([
      "Shotgun", "Goal Line Offense", "Special", "Shotgun", "Special", "Kickoff", "Safety Kickoff",
    ]);
    let mixed: ReturnType<typeof duplicateRefs> = [];
    const m = produce(tagged(), (d) => {
      mixed = duplicateRefs(d, [{ f: 0, s: 1, p: 1 }, { f: 2 }]);
    });
    expect(mixed).toEqual([{ f: 3 }, { f: 0, s: 1, p: 2 }]);
    expect(names(sets0(m)[1])).toEqual(["Mesh", "Reverse", "Reverse"]);
    for (const r of out) expect(entryAt(next, r)).toBeDefined();
  });

  it("deepClone works on immer drafts", () => {
    produce(tagged(), (d) => {
      const c = deepClone(d.formations[0]);
      expect(c).toEqual(JSON.parse(JSON.stringify(d.formations[0])));
      (c.sets as SetEntry[])[0].plays.length = 0;
      expect(sets0(d)[0].plays.length).toBe(17);
    });
  });
});

describe("toggle plays", () => {
  it("inserts in library order when the set follows it, else appends", () => {
    expect(insertionIndex(["B", "D"], ["A", "B", "C", "D"], "C")).toBe(1);
    expect(insertionIndex(["B", "D"], ["A", "B", "C", "D"], "A")).toBe(0);
    expect(insertionIndex(["B", "D"], ["A", "B", "C", "D"], "E")).toBe(2);
    expect(insertionIndex(["D", "B"], ["A", "B", "C", "D"], "C")).toBe(2);
    expect(insertionIndex([], ["A"], "A")).toBe(0);
  });

  it("adds and removes entries by name, keeping the rest of the order and keys", () => {
    const next = produce(tagged(), (d) => {
      const se = sets0(d)[0];
      expect(togglePlay(se, "Inside Zone", false)).toBe(6);
      expect(togglePlay(se, "Inside Zone", false)).toBe(-1);
      expect(togglePlay(se, "Curls", true, ["Curls"])).toBe(16); // book order isn't library order: append
      expect(togglePlay(se, "curls", true)).toBe(-1); // already there (norm compare)
    });
    const se = sets0(next)[0];
    expect(names(se)).not.toContain("Inside Zone");
    expect(se.plays[16]).toEqual({ play: "Curls" });
    expect(se.plays[0].tag).toEqual({ a: [1, 2] });
  });
});

describe("audibles & CPU weights", () => {
  it("moves an audible slot between plays", () => {
    const next = produce(book("studio-lib.json"), (d) => {
      const se = sets0(d)[0];
      setAudible(se, 1, 2); // Mtn Mesh takes Inside Zone's slot
      setAudible(se, 6, undefined); // Slants clears slot 1
      setAudible(se, 99, 1); // ignored
    });
    const ps = sets0(next)[0].plays;
    expect(ps[0].audible).toBeUndefined();
    expect(ps[1].audible).toBe(2);
    expect(ps[6].audible).toBeUndefined();
    expect(playbookIssues(next, cat).filter((i) => i.rule === "audible-duplicate")).toEqual([]);
    expect([nextAudible(undefined), nextAudible(1), nextAudible(3), nextAudible(4)]).toEqual([1, 2, 4, undefined]);
  });

  it("sets, copies and clears weights", () => {
    const next = produce(book("studio-lib.json"), (d) => {
      const ps = sets0(d)[0].plays;
      setCpuWeight(ps[1], "3rdAndLong", 33.6);
      setCpuWeight(ps[1], "FirstDown", 140);
      setCpuWeight(ps[0], "FirstDown", undefined);
      setCpuWeight(ps[0], "2ndAndShort", undefined); // last key → cpu removed
      setCpuWeights(ps[2], cpuOf(ps[1]));
      setCpuWeights(ps[3], undefined);
    });
    const ps = sets0(next)[0].plays;
    expect(ps[1].cpu).toEqual({ "3rdAndLong": 34, FirstDown: 100 });
    expect("cpu" in ps[0]).toBe(false);
    expect(ps[2].cpu).toEqual({ "3rdAndLong": 34, FirstDown: 100 });
    expect(ps[2].cpu).not.toBe(ps[1].cpu);
    expect("cpu" in ps[3]).toBe(false);
    expect(clampWeight(-3)).toBe(0);
    expect(clampWeight(NaN)).toBe(0);
    expect(cpuOf({ play: "x", cpu: [] as unknown as Record<string, number> })).toEqual({});
  });
});

describe("template sections", () => {
  const tc = templateContents(templateBytes, lib);

  it("converts a template formation to explicit entries in place", () => {
    const spec = book("studio-lib.json");
    spec.formations[1].keep = "me";
    const gl = templateFormationFor(tc, lib.formationByName("Goal Line Offense", "offense"))!;
    const next = produce(spec, (d) => {
      convertTemplateFormation(d, 1, templateFormationToEntry(gl));
      expect(() => convertTemplateFormation(d, 0, templateFormationToEntry(gl))).toThrow(/not a template/);
    });
    const f = next.formations[1];
    expect(f.keep).toBe("me");
    expect(Array.isArray(f.sets)).toBe(true);
    expect((f.sets as SetEntry[]).length).toBe(gl.sets.length);
    const rb = resolvePlaybook(next, cat);
    expect(rb.counts.unresolved).toBe(0);
    expect(rb.formations[1].sets.length).toBe(gl.sets.length);
  });

  it("creates new playbooks", () => {
    const fresh = newPlaybookSpec("my book!");
    expect(fresh).toEqual({
      name: "MYBOOK",
      side: "offense",
      formations: [
        { formation: "Goal Line Offense", sets: "template" },
        { formation: "Special", sets: "template" },
        { formation: "Kickoff", sets: "template" },
        { formation: "Safety Kickoff", sets: "template" },
      ],
    });
    expect(playbookIssues(fresh, cat).filter((i) => i.level === "error")).toEqual([]);
    expect(playbookPathFor("My Book 2")).toBe("playbooks/mybook2.json");
    expect(saveNameFor({ name: "abc", side: "offense" })).toBe("PBOOKOFF-ABC");
    expect(saveNameFor({ name: "D1", side: "defense" })).toBe("PBOOKDEF-D1");

    const stock = stockTemplateSpec("stock", templateToSpecEntries(tc));
    expect(stock.formations.length).toBe(11);
    expect(stock.formations.filter((f) => f.sets === "template").map((f) => f.formation)).toEqual(["Special", "Kickoff", "Safety Kickoff"]);
    const rb = resolvePlaybook(stock, cat);
    expect(rb.counts.unresolved).toBe(0);
    expect(rb.counts.sets).toBe(51 - tc.formations.filter((f) => ["Special", "Kickoff", "Safety Kickoff"].includes(f.formation.name)).reduce((n, f) => n + f.sets.length, 0));
    expect(playbookIssues(stock, cat).filter((i) => i.level === "error")).toEqual([]);
  });

  it("converts offense Special (formations resolve by side since ac54574), refuses a conversion with a problem", () => {
    const special = tc.formations.find((f) => f.formation.formId === 12)!;
    const spec = newPlaybookSpec("X");
    const sp = spec.formations.findIndex((f) => f.formation === "Special");
    const conv12 = templateFormationToEntry(special, cat);
    expect(conv12.problem).toBeUndefined();
    const converted = produce(spec, (d) => convertTemplateFormation(d, sp, conv12));
    expect((converted.formations[sp].sets as SetEntry[]).length).toBeGreaterThan(0);
    expect(() => produce(spec, (d) => convertTemplateFormation(d, sp, { ...conv12, problem: "can't address it" }))).toThrow(/can't address it/);
    const gl = templateFormationFor(tc, lib.formationByName("Goal Line Offense", "offense"))!;
    const gi = spec.formations.findIndex((f) => f.formation === "Goal Line Offense");
    const next = produce(spec, (d) => convertTemplateFormation(d, gi, templateFormationToEntry(gl, cat)));
    expect((next.formations[gi].sets as SetEntry[]).length).toBe(gl.sets.length);

    const conv = templateToSpecEntries(tc, cat);
    const stock = stockTemplateSpec("stock", conv);
    expect(stock.formations.filter((f) => f.sets === "template").map((f) => f.formation)).toEqual(["Special", "Kickoff", "Safety Kickoff"]);
    expect(playbookIssues(stock, cat, undefined, { template: tc }).filter((i) => i.level === "error")).toEqual([]);
  });

  it("lists unknown keys", () => {
    expect(unknownKeys({ play: "x", audible: 1, z: 2, q: [1] }, PLAY_ENTRY_KEYS)).toEqual({ z: 2, q: [1] });
    expect(unknownKeys(undefined, PLAY_ENTRY_KEYS)).toEqual({});
  });
});

describe("bookIds on hand-edited JSON", () => {
  it("never throws on wrong shapes (formations / plays not arrays, null entries)", () => {
    const bad = [
      { name: "X", formations: { x: 1 } },
      { name: "X", formations: [null, { formation: "Shotgun", sets: [{ set: "Bunch", plays: { a: 1 } }, null, { set: "Y", plays: "x" }] }] },
    ] as unknown as PlaybookSpec[];
    expect(bookIds(bad[0]).formations).toEqual([]);
    const ids = bookIds(bad[1]);
    expect(ids.formations).toHaveLength(2);
    expect(ids.formations[1].sets.map((s) => s.plays)).toEqual([[], [], []]);
  });
});

describe("builder home (v2)", () => {
  it("opens the last playbook, else STUDIO, else the first one", () => {
    const paths = ["playbooks/studio-lib.json", "playbooks/studio-test.json", "playbooks/aaa.json"];
    expect(DEFAULT_PLAYBOOK_PATH).toBe("playbooks/studio-test.json");
    expect(defaultPlaybookPath(undefined, paths)).toBe("playbooks/studio-test.json");
    expect(defaultPlaybookPath("playbooks/studio-lib.json", paths)).toBe("playbooks/studio-lib.json");
    // A deleted last playbook falls back to STUDIO; letter case follows the existing file.
    expect(defaultPlaybookPath("playbooks/gone.json", paths)).toBe("playbooks/studio-test.json");
    expect(defaultPlaybookPath("playbooks/AAA.json", paths)).toBe("playbooks/aaa.json");
    expect(defaultPlaybookPath(undefined, ["playbooks/b.json", "playbooks/a.json"])).toBe("playbooks/a.json");
    expect(defaultPlaybookPath("playbooks/x.json", [])).toBeUndefined();
  });

  it("new playbooks still start with goal line + special teams template sections", () => {
    expect(DEFAULT_TEMPLATE_FORMATIONS).toEqual(["Goal Line Offense", "Special", "Kickoff", "Safety Kickoff"]);
    expect(newPlaybookSpec("x").formations.every((f) => f.sets === "template")).toBe(true);
  });
});

describe("cpuEditorGroups", () => {
  it("shows the common situations plus every set weight, unknown keys last", () => {
    const groups = cpuEditorGroups({ FirstDown: 40, Kneel: 10, Bogus: 5 }, false);
    const keys = groups.flatMap((g) => g.rows.map((r) => r.key));
    for (const k of COMMON_CPU_KEYS) expect(keys).toContain(k);
    // A set weight outside the common list is never hidden.
    expect(keys).toContain("Kneel");
    expect(keys).not.toContain("Punt");
    expect(groups[groups.length - 1]).toMatchObject({ id: "unknown", label: "Unknown Keys", set: 1, rows: [{ key: "Bogus", known: false }] });
    expect(groups.find((g) => g.id === "down")?.set).toBe(1);
    // Groups without rows are dropped (no special-teams weights set, none common).
    expect(groups.some((g) => g.id === "special")).toBe(false);
  });

  it("shows every situation when asked", () => {
    const groups = cpuEditorGroups({}, true);
    expect(groups.flatMap((g) => g.rows).length).toBe(44);
    expect(groups.map((g) => g.id)).toEqual(["down", "redzone", "clock", "special", "other"]);
    expect(groups.every((g) => g.set === 0)).toBe(true);
  });
});
