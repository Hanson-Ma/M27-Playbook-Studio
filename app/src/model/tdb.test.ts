import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCatalog } from "./catalog";
import { loadLibraryData } from "./libFixture";
import { buildLibraryIndex } from "./library";
import { resolvePlaybook } from "./resolveBook";
import {
  audibleFromFlag,
  readBitsLE,
  readTdb,
  templateContents,
  templateFormationCounts,
  templateFormationFor,
  templateFormationProblem,
  templateFormationToEntry,
  templateSectionRows,
  templateSkippedPlays,
  templateToSpecEntries,
} from "./tdb";
import { stockTemplateSpec } from "./playbook";
import { playbookIssues } from "./resolveBook";
import type { PlaybookSpec } from "./types";

const bytes = new Uint8Array(readFileSync(new URL("../../../playbooks/templates/PBOOKOFF-TEMPLATE", import.meta.url)));
const lib = buildLibraryIndex(loadLibraryData());

describe("readBitsLE", () => {
  it("reads little-endian bit-packed fields", () => {
    const rec = new Uint8Array([0b1010_1100, 0b0000_0011, 0xff, 0xff, 0xff, 0xff]);
    expect(readBitsLE(rec, 0, 8)).toBe(0b1010_1100);
    expect(readBitsLE(rec, 2, 4)).toBe(0b1011);
    expect(readBitsLE(rec, 6, 4)).toBe(0b1110);
    expect(readBitsLE(rec, 16, 32)).toBe(0xffffffff);
  });
});

describe("readTdb", () => {
  const db = readTdb(bytes);

  it("lists the playbook tables with their fields", () => {
    expect(db.tables.map((t) => t.name)).toEqual(["PGPL", "PGFM", "STID", "STSP", "PBAU", "PBAI", "SLEP"]);
    const pgpl = db.table("PGPL")!;
    expect(pgpl.fields.map((f) => f.name)).toEqual(["BOKL", "SETL", "PLYL", "PBST", "PLYT", "ord_", "Flag"]);
    expect(pgpl.maxRecords).toBe(750);
    expect(db.table("PBAI")!.maxRecords).toBe(2200);
  });

  it("skips deleted rows (top bit of the last byte)", () => {
    const pgpl = db.table("PGPL")!;
    expect(pgpl.records).toBe(648);
    expect(pgpl.rows.length).toBe(569);
    expect(pgpl.allRows.filter((r) => r.$deleted).length).toBe(79);
    expect(db.table("STID")!.rows.length).toBe(51);
    expect(db.table("PGFM")!.rows.length).toBe(11);
    expect(db.table("PBAI")!.rows.length).toBe(473);
  });

  it("decodes the first play row", () => {
    expect(db.table("PGPL")!.rows[0]).toEqual({ BOKL: 32764, SETL: 323, PLYL: 24036, PBST: 323, PLYT: 102, ord_: 0, Flag: 16 });
  });

  it("rejects files without a DB header", () => {
    expect(() => readTdb(new Uint8Array([1, 2, 3, 4, 5]))).toThrow(/DB header/);
  });

  it("rejects truncated saves", () => {
    expect(() => readTdb(bytes.subarray(0, 400))).toThrow(/Truncated/);
  });
});

describe("audibleFromFlag", () => {
  it("maps PGPL.Flag bits to slots", () => {
    expect(audibleFromFlag(2)).toBe(1);
    expect(audibleFromFlag(4)).toBe(2);
    expect(audibleFromFlag(16)).toBe(3);
    expect(audibleFromFlag(8)).toBe(4);
    expect(audibleFromFlag(0)).toBeUndefined();
  });
});

describe("templateContents", () => {
  const tc = templateContents(bytes, lib);

  it("resolves 11 formations, 51 live sets and 569 live plays against the library", () => {
    expect(tc.unresolved).toEqual([]);
    expect(tc.formations.length).toBe(11);
    expect(tc.formations.reduce((n, f) => n + f.sets.length, 0)).toBe(51);
    expect(tc.formations.reduce((n, f) => n + f.sets.reduce((m, s) => m + s.plays.length, 0), 0)).toBe(569);
  });

  it("starts with Singleback Wing Pair → TE Attack on audible 3", () => {
    const first = tc.formations[0];
    expect(first.formation.name).toBe("Singleback");
    expect(first.sets[0].set.name).toBe("Wing Pair");
    expect(first.sets[0].plays[0].play.name).toBe("TE Attack");
    expect(first.sets[0].plays[0].audible).toBe(3);
  });

  it("orders plays by ord_ and keeps at most one play per audible slot per set", () => {
    for (const f of tc.formations)
      for (const s of f.sets) {
        const slots = s.plays.flatMap((p) => (p.audible ? [p.audible] : []));
        expect(new Set(slots).size, `${f.formation.name}/${s.set.name}`).toBe(slots.length);
        for (const p of s.plays) expect(p.play.set === s.set.asset, `${s.set.name}/${p.play.name}`).toBe(!p.foreign);
      }
    const foreign = tc.formations.flatMap((f) => templateSkippedPlays(f));
    expect(foreign).toEqual(["TRIO / GOAL POST", "NFL ONSIDE KICK 3 / SPEED ONSIDE", "NFL ONSIDE KICK 3 / ONSIDE KICK"]);
  });

  it("maps PBAI rows to CPU weights by situation key", () => {
    const rows = tc.formations.flatMap((f) => f.sets.flatMap((s) => s.plays)).reduce((n, p) => n + Object.keys(p.cpu ?? {}).length, 0);
    expect(rows + tc.unknownSituations).toBe(473);
    const tea = tc.formations[0].sets[0].plays[0];
    expect(tea.cpu).toEqual({ RedZoneFringe: 20 });
  });

  it("has the special-teams formations a playbook keeps as template", () => {
    const names = tc.formations.map((f) => f.formation.name);
    for (const n of ["Special", "Kickoff", "Safety Kickoff", "Goal Line Offense"]) expect(names).toContain(n);
    const special = tc.formations.find((f) => f.formation.name === "Special")!;
    expect(special.formation.formId).toBe(12);
    expect(templateFormationFor(tc, lib.formationByName("Special", "offense"))).toBe(special);
    expect(templateFormationFor(tc, lib.formationByName("Special", "defense"))).toBeUndefined();
    const c = templateFormationCounts(special);
    expect(c.sets).toBe(special.sets.length);
    expect(c.plays).toBeGreaterThan(0);
  });

  it("accepts a parsed database", () => {
    expect(templateContents(readTdb(bytes), lib).formations.length).toBe(11);
  });
});

describe("templateToSpecEntries", () => {
  it("produces explicit entries that resolve back to the same plays", () => {
    const tc = templateContents(bytes, lib);
    const entries = templateToSpecEntries(tc);
    expect(entries.length).toBe(11);
    const spec: PlaybookSpec = { name: "TEMPLATE", side: "offense", formations: entries };
    const cat = buildCatalog(lib, []);
    const rb = resolvePlaybook(spec, cat);
    expect(rb.counts.plays).toBe(566); // 569 minus the 3 plays filed under a foreign set
    expect(rb.counts.sets).toBe(51);
    expect(rb.counts.unresolved).toBe(0);
    // Every formation and set resolves by name to the template's own formation/set.
    rb.formations.forEach((rf, fi) => {
      expect(rf.formation?.formId, rf.entry.formation).toBe(tc.formations[fi].formation.formId);
      rf.sets.forEach((rs, si) => expect(rs.set?.setId, rs.entry.set).toBe(tc.formations[fi].sets[si].set.setId));
    });
    // Plays resolve by name (a handful of names repeat inside a set; those resolve to the first one).
    let same = 0;
    rb.formations.forEach((rf, fi) =>
      rf.sets.forEach((rs, si) => {
        const own = tc.formations[fi].sets[si].plays.filter((p) => !p.foreign);
        rs.plays.forEach((rp, pi) => {
          if (rp.play?.playId === own[pi].play.playId) same++;
        });
      }),
    );
    expect(same).toBeGreaterThan(560);
    expect(entries[0].sets).not.toBe("template");
    const first = (entries[0].sets as { plays: { play: string; audible?: number; cpu?: object }[] }[])[0].plays[0];
    expect(first).toEqual({ play: "TE Attack", audible: 3, cpu: { RedZoneFringe: 20 } });
  });
});

describe("what tools/pbook-build.mjs copies", () => {
  const tc = templateContents(bytes, lib);

  it("counts template sections by formId from the raw tables, plus capacities and per-play CPU rows", () => {
    expect(tc.capacity).toEqual({ formations: 40, sets: 75, plays: 750, cpuRows: 2200 });
    const all = [...tc.sections!.values()];
    expect(all.reduce((n, x) => n + x.sets, 0)).toBe(51);
    expect(all.reduce((n, x) => n + x.plays, 0)).toBe(569);
    expect([...tc.aiRowsByPlay!.values()].reduce((n, x) => n + x, 0)).toBe(473);
    // Offense/Special (12) is in the stock save; Defense/Special (20) — a defense book's "Special" — isn't.
    expect(templateSectionRows(tc, 12)).toEqual({ sets: 5, plays: 18, cpuRows: 21 });
    expect(templateSectionRows(tc, 20)).toEqual({ sets: 0, plays: 0, cpuRows: 0 });
    expect(tc.aiRowsByPlay!.get(24036)).toBe(1); // TE Attack: RedZoneFringe
  });

  it("converts the stock save without swapping or silently dropping plays (catalog-checked)", () => {
    const cat = buildCatalog(lib, []);
    const conv = templateToSpecEntries(tc, cat);
    expect(conv.keptAsTemplate).toEqual([]); // pbook-build resolves names by side: offense "Special" can be explicit
    expect(conv.skipped.map((x) => `${x.set}/${x.asset.split("/").pop()}`)).toEqual([
      "Trips HB Wk/Inside_Cross", // named "Drive" like the set's Drive play (pbook-build would build Drive)
      "Spread Y-Flex/Y_Cross(1)",
      "5WR Trio/Four_Verticals_Sl_Out",
      "Trio/Goal_Post", // filed under a foreign set
      "NFL Onside Kick 3/Speed_Onside",
      "NFL Onside Kick 3/Onside_Kick",
    ]);
    // Every written play resolves by name to exactly the template's play (pbook-build output = template minus skipped).
    const spec = stockTemplateSpec("STOCK", conv);
    const rb = resolvePlaybook(spec, cat, { template: tc });
    // = tools/pbook-build.mjs on the same spec: "11 formations, 51 sets, 565 plays, 467 AI rows".
    expect(rb.counts.saveRows).toMatchObject({ formations: 11, sets: 51, plays: 565, cpuRows: 467 });
    for (const rf of rb.formations) {
      if (rf.template) continue;
      const tf = tc.formations.find((f) => f.formation.formId === rf.formation!.formId)!;
      for (const rs of rf.sets) {
        const ts = tf.sets.find((x) => x.set.asset === rs.set!.asset)!;
        const ids = ts.plays.filter((tp) => !conv.skipped.some((k) => k.asset === tp.play.asset)).map((tp) => tp.play.playId);
        expect(rs.plays.map((rp) => rp.play?.playId), `${rf.entry.formation}/${rs.entry.set}`).toEqual(ids);
      }
    }
    expect(playbookIssues(spec, cat, undefined, { template: tc }).filter((i) => i.rule === "play-duplicate")).toEqual([]);
    // Everything explicit (special teams too): pbook-build "11 formations, 51 sets, 563 plays, 465 AI rows".
    const all: PlaybookSpec = { name: "STOCKALL", side: "offense", formations: conv.entries };
    expect(resolvePlaybook(all, cat, { template: tc }).counts.saveRows).toMatchObject({ formations: 11, sets: 51, plays: 563, cpuRows: 465 });
    expect(playbookIssues(all, cat, undefined, { template: tc }).filter((i) => i.level === "error")).toEqual([]);
  });

  it("converts Special explicitly now, and refuses a formation of the other side", () => {
    const cat = buildCatalog(lib, []);
    const special = tc.formations.find((f) => f.formation.formId === 12)!;
    const c = templateFormationToEntry(special, cat);
    expect(c.problem).toBeUndefined();
    expect(c.skipped).toEqual([]);
    expect((c.entry.sets as unknown[]).length).toBe(5);
    expect(templateSkippedPlays(special, cat)).toEqual([]);
    expect(templateFormationProblem(special, lib)).toBeUndefined();
    expect(templateFormationProblem(special, lib, "offense", { template: tc })).toBeUndefined();
    expect(templateFormationProblem(special, lib, "defense")).toBe("SPECIAL is an offense formation, so a defense playbook can't list it");
    expect(templateFormationToEntry(special, cat, "defense").problem).toMatch(/defense playbook can't list it/);
    // The legacy overload still returns a plain FormationEntry.
    expect(templateFormationToEntry(special).formation).toBe("Special");
  });

  it("lists the template's PGFM formIds (pbook-build prefers formations the template contains)", () => {
    expect(tc.formIds).toEqual([11, 206, 3, 13, 1, 103, 10, 132, 12, 6, 8]);
    expect(tc.formIds).toEqual(tc.formations.map((f) => f.formation.formId));
  });
});
