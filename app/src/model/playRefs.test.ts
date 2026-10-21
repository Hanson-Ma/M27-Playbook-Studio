import { readFileSync } from "node:fs";
import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { buildCatalog } from "./catalog";
import { loadLibraryData, loadPlaysDoc } from "./libFixture";
import { buildLibraryIndex } from "./library";
import { addPlayAfterInBook, danglingPlayRefs, playKeyFor, rekeyConcepts, rekeyList, renamePlayInBook } from "./playRefs";
import type { ConceptsDoc, PlaybookSpec, PlaysFile } from "./types";

const SET = "football/Gameplay/playbooks/PlayLibrary/Formations/Offense/Shotgun/Y_Trips_Wk/Y_Trips_Wk";
const lib = buildLibraryIndex(loadLibraryData());
const plays = loadPlaysDoc("pbs-ytrips-v1.json");
const book: PlaybookSpec = JSON.parse(readFileSync(new URL("../../test-fixtures/studio-test.json", import.meta.url), "utf8"));
const old = { set: SET, name: "PBS PA Yankee", asset: "PBS_PA_Yankee" };

/** The catalog after renaming the Yankee play (name + asset, like the designer's AUTO asset). */
function renamed(name: string, asset: string) {
  const data = produce(plays.data as PlaysFile, (d) => {
    const p = d.plays.find((x) => x.asset === old.asset)!;
    p.name = name;
    p.asset = asset;
  });
  return buildCatalog(lib, [{ path: plays.path, data }]);
}

describe("play references for rename-everywhere", () => {
  it("sees nothing while the play still resolves", () => {
    const cat = buildCatalog(lib, [{ path: plays.path, data: plays.data as PlaysFile }]);
    expect(cat.lib.setByAsset.has(SET)).toBe(true);
    const r = danglingPlayRefs(old, cat, { playbooks: [{ path: "playbooks/studio-test.json", data: book }] });
    expect(r.total).toBe(0);
  });

  it("finds playbook entries, concepts and favorites left on the old name/key, and updates them", () => {
    const cat = renamed("PBS PA Yankee 2", "PBS_PA_Yankee_2");
    const oldKey = playKeyFor(old);
    const newKey = playKeyFor({ set: SET, asset: "PBS_PA_Yankee_2" });
    expect(cat.get(newKey)).toBeTruthy();
    const concepts: ConceptsDoc = { version: 1, categories: [], tags: { [oldKey]: ["pa"], [newKey]: ["deep"] }, notes: { [oldKey]: "note" } };
    const r = danglingPlayRefs(old, cat, { playbooks: [{ path: "playbooks/studio-test.json", data: book }], concepts, favorites: [oldKey], recents: [] });
    expect(r.playbooks).toEqual([{ path: "playbooks/studio-test.json", entries: 1 }]);
    expect(r.concepts).toBe(2);
    expect(r.favorite).toBe(true);
    expect(r.total).toBe(4);

    let changed = 0;
    const next = produce(book, (d) => {
      changed = renamePlayInBook(d, cat, old, "PBS PA Yankee 2");
    });
    expect(changed).toBe(1);
    const nextConcepts = produce(concepts, (d) => {
      rekeyConcepts(d, oldKey, newKey);
    });
    expect(nextConcepts.tags[newKey]).toEqual(["deep", "pa"]);
    expect(nextConcepts.tags[oldKey]).toBeUndefined();
    expect(nextConcepts.notes?.[newKey]).toBe("note");
    const after = danglingPlayRefs(old, cat, {
      playbooks: [{ path: "playbooks/studio-test.json", data: next }],
      concepts: nextConcepts,
      favorites: rekeyList([oldKey], oldKey, newKey),
    });
    expect(after.total).toBe(0);
  });

  it("keeps the key when only the name changes", () => {
    const cat = renamed("PBS PA Yankee 2", "PBS_PA_Yankee");
    const r = danglingPlayRefs(old, cat, { playbooks: [{ path: "p.json", data: book }], favorites: [playKeyFor(old)] });
    expect(r.playbooks).toHaveLength(1);
    expect(r.favorite).toBe(false);
  });

  it("ignores wrong-shaped books", () => {
    const cat = renamed("X", "X");
    expect(danglingPlayRefs(old, cat, { playbooks: [{ path: "a", data: { formations: { x: 1 } } }, { path: "b", data: null }] }).total).toBe(0);
  });
});

describe("renaming a play that overrode its original", () => {
  it("still finds the entries that named it, although the name resolves to the original again", () => {
    // The playbook lists "Curls"; an edited copy of Curls took the name Curls (overriding it), then got renamed.
    const spec: PlaybookSpec = { name: "ZZ", side: "offense", formations: [{ formation: "Shotgun", sets: [{ set: "Y Trips Wk", plays: [{ play: "Curls" }] }] }] };
    const cat = buildCatalog(lib, [{ path: "playbooks/plays/x.json", data: { plays: [{ name: "Curls Mine", asset: "ZZ_Curls_Mine", base: SET.replace(/Y_Trips_Wk$/, "Curls") }] } }]);
    const was = { set: SET, name: "Curls", asset: "ZZ_Curls_Mine" };
    expect(danglingPlayRefs(was, cat, { playbooks: [{ path: "b.json", data: spec }] }).total).toBe(0);
    expect(danglingPlayRefs({ ...was, overrode: true }, cat, { playbooks: [{ path: "b.json", data: spec }] }).playbooks).toEqual([{ path: "b.json", entries: 1 }]);
  });
  it("can keep the original and list the renamed copy right after it", () => {
    const spec: PlaybookSpec = { name: "ZZ", side: "offense", formations: [{ formation: "Shotgun", sets: [{ set: "Y Trips Wk", plays: [{ play: "Curls", audible: 2 }, { play: "Mesh" }] }] }] };
    const cat = buildCatalog(lib, [{ path: "playbooks/plays/x.json", data: { plays: [{ name: "Curls Mine", asset: "ZZ_Curls_Mine", base: SET.replace(/Y_Trips_Wk$/, "Curls") }] } }]);
    const was = { set: SET, name: "Curls", asset: "ZZ_Curls_Mine", overrode: true };
    expect(addPlayAfterInBook(spec, cat, was, "Curls Mine")).toBe(1);
    expect((spec.formations[0].sets[0] as { plays: unknown[] }).plays).toEqual([{ play: "Curls", audible: 2 }, { play: "Curls Mine" }, { play: "Mesh" }]);
    expect(addPlayAfterInBook(spec, cat, was, "Curls Mine")).toBe(0); // already listed
  });
});
