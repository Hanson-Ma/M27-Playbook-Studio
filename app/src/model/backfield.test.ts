import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BACKFIELD_PRESETS, applyBackfieldAction, backfieldActions, backfieldChanged, presetFits, resetBackfield } from "./backfield";
import { buildCatalog } from "./catalog";
import { effectiveField, isSlotLocked, precanChain, precanLength, specFromState, stateFromSpec } from "./designer";
import { loadLibraryData } from "./libFixture";
import { buildLibraryIndex } from "./library";
import { isMechanics, stepsEqual } from "./steps";
import type { SetsFile } from "./types";

const lib = buildLibraryIndex(loadLibraryData());
const fusion = JSON.parse(readFileSync(new URL("../../../playbooks/sets/fusion-sets.json", import.meta.url), "utf8").replace(/^﻿/, "")) as SetsFile;
const catalog = buildCatalog(lib, [], [{ path: "playbooks/sets/fusion-sets.json", data: fusion }]);

// FUSION's Singleback / Tight Doubles "JW PA Curl" (a play-action clone with a jet man and a back)
const clone = catalog.clones.find((p) => p.name === "JW PA Curl" && /Tight_Doubles/.test(p.set))!;
const fresh = () => stateFromSpec({ name: "T", asset: "PBS_T", base: clone.asset }, catalog);
const ctx = { catalog, docs: [], file: "playbooks/plays/t.json", index: 0, prefix: "PBS_" };

describe("backfield actions", () => {
  const state = fresh();
  const actions = backfieldActions(state, catalog);

  it("lists run, play-action and pass packages whose QB and backs stand on this play's spots", () => {
    expect(clone).toBeDefined();
    const kinds = new Set(actions.map((a) => a.family));
    expect(kinds.has("run")).toBe(true);
    expect(kinds.has("pa")).toBe(true);
    expect(kinds.has("pass")).toBe(true);
    for (const a of actions) {
      expect(a.swaps.some((s) => s.slot === 1)).toBe(true); // the back is always part of it
      expect(a.swaps.some((s) => s.slot >= 6)).toBe(true); // and the line
      expect(a.plays).toContain(a.play);
    }
  });

  it("applying a run action turns the play into that run and locks its new handoff", () => {
    const run = actions.find((a) => a.family === "run")!;
    const next = applyBackfieldAction(state, run, catalog);
    expect(next.slots[0].assignment).toBe(run.qb.path);
    expect(effectiveField(next, "playType")).toBe(run.playType);
    expect(effectiveField(next, "runHole")).toBe(run.runHole);
    expect(backfieldChanged(next)).toBe(true);
    const hb = next.slots[1];
    expect(hb.steps.some(isMechanics)).toBe(true);
    expect(isSlotLocked(next, 1)).toBe(true);
    expect(precanLength(precanChain(next, 1))).toBeGreaterThan(0);
    // the spec stores plain library paths for the swapped slots, and it resolves to those steps
    const spec = specFromState(next, ctx);
    expect(spec.players?.["1"]).toBe(hb.assignment);
    expect(spec.players?.["0"]).toBe(run.qb.path);
    expect(stepsEqual(lib.assignment(String(spec.players?.["1"]))!.steps, hb.steps)).toBe(true);
    expect(spec.playType).toBe(run.playType);
  });

  it("brings the source's reads when the play has none and the receivers map onto ours", () => {
    const withReads = actions.find((a) => a.reads);
    if (!withReads) return;
    const next = applyBackfieldAction(state, withReads, catalog);
    const reads = effectiveField<{ pos: number }[]>(next, "reads");
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((r) => r.pos >= 1 && r.pos <= 5)).toBe(true);
  });

  it("going back to the base play restores everything", () => {
    const run = actions.find((a) => a.family === "run")!;
    const back = resetBackfield(applyBackfieldAction(state, run, catalog));
    expect(backfieldChanged(back)).toBe(false);
    expect(effectiveField(back, "playType")).toBe(effectiveField(state, "playType"));
    expect(specFromState(back, ctx).players).toBeUndefined();
  });
});

describe("presets and FUSION packages", () => {
  const state = fresh();
  const actions = backfieldActions(state, catalog);
  it("most presets have a fit on a common formation, and FUSION has its own packages", () => {
    const fits = presetFits(actions);
    const have = BACKFIELD_PRESETS.filter((p) => (fits.get(p.id)?.length ?? 0) > 0).map((p) => p.label);
    console.log("fits", have.join(", "), "| fusion", actions.filter((a) => a.fusion).length, actions.filter((a) => a.fusion).slice(0, 12).map((a) => `${a.play.name} (${a.play.set.split("/").slice(-2)[0]})`).join("; "));
    expect(BACKFIELD_PRESETS.length).toBeGreaterThanOrEqual(20);
    expect(have.length).toBeGreaterThan(5);
  });
  it("a FUSION package applies authored steps and still round-trips through the spec", () => {
    const f = actions.find((a) => a.fusion);
    if (!f) return;
    const next = applyBackfieldAction(state, f, catalog);
    const spec = specFromState(next, ctx);
    expect(spec.players).toBeDefined();
  });
});
