import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { computeArt } from "./art";
import { serializeDoc } from "./json";
import { loadIndexTsv, loadLibraryData, loadSetsDoc } from "./libFixture";
import { buildLibraryIndex } from "./library";
import {
  addPreset,
  alignmentIssues,
  availablePresetKeys,
  backDepth,
  canPatchPreset,
  changedFields,
  changedPresetSlots,
  changedSlots,
  clonablePlays,
  cloneAsset,
  cloneEntries,
  cloneEntry,
  customDefs,
  customFormationAsset,
  customSetAsset,
  depthClass,
  depthPresetY,
  diffPositions,
  effectiveAlignment,
  effectiveNormal,
  effectivePreset,
  effectiveSet,
  flippedAlignment,
  gameId,
  invalidPresetKeys,
  issuesForSet,
  movedSlots,
  newCustomFormation,
  newCustomSet,
  onLine,
  patchPosition,
  patchPreset,
  playDependencies,
  presetIssues,
  presetKeys,
  presetLabel,
  presetSlots,
  removePreset,
  resetPosition,
  resetPresetSlot,
  setAbbrev,
  setDepthClass,
  setsFilePath,
  splitPreset,
  stepDependencies,
  suggestAsset,
  suggestSetName,
  setNamesInFormation,
  validateSetsFile,
  validateSetsFiles,
} from "./sets";
import { PLAYLIBRARY_ROOT, type CustomSetSpec, type SetDef, type SetsFile } from "./types";

const lib = buildLibraryIndex(loadLibraryData());
const OFF = PLAYLIBRARY_ROOT + "Formations/Offense/";
const set = (rel: string): SetDef => {
  const s = lib.setByAsset.get(OFF + rel);
  if (!s) throw new Error(`no set ${rel}`);
  return s;
};
const Y_TRIPS = set("Shotgun/Y_Trips_Wk/Y_Trips_Wk");
const I_CLOSE = set("I_Form/Close/Close");
const FLEXBONE = set("Flexbone/Normal/Normal");
const PLAY = (rel: string) => lib.playByAsset.get(OFF + rel)!;
const SHOTGUN = OFF + "Shotgun/Shotgun";

// Y Trips Wk slots: 0 QB (0,−6) · 1 HB (−2.9,−6) · 2 SL (10.5,−2.2) · 3 WR1 (−16.25,−0.8) · 4 WR2 (16.25,−2.2) ·
// 5 TE (5,−1.4) · 6 LT · 7 LG · 8 C · 9 RG · 10 RT. Flip partners: 3 ↔ 4, 6 ↔ 10, 7 ↔ 9, the rest themselves.
// Presets: M1left/M1right move slot 1, M2* slot 2, M3right slot 3, M4left slot 4, M5left/M5right slots 2 and 5.
const spec = (over: Partial<CustomSetSpec> = {}): CustomSetSpec => ({
  ...newCustomSet(Y_TRIPS, { name: "Trips Stack Wk", asset: "PBS_Trips_Stack_Wk" }),
  ...over,
});
const edit = (s: CustomSetSpec, fn: (d: CustomSetSpec) => void) => produce(s, fn);
const errors = (issues: { level: string; rule?: string }[]) => issues.filter((i) => i.level === "error").map((i) => i.rule);
const warnings = (issues: { level: string; rule?: string }[]) => issues.filter((i) => i.level === "warning").map((i) => i.rule);

describe("effective alignment", () => {
  it("is the base Normal without positions, with overrides applied per slot", () => {
    expect(effectiveNormal(Y_TRIPS, spec())).toEqual(Y_TRIPS.movements.Normal);
    const eff = effectiveNormal(Y_TRIPS, spec({ positions: [{ slot: 3, x: -10 }, { slot: 2, y: -0.8, stance: "StanceType_3pt" }] }));
    expect(eff[3]).toMatchObject({ slot: 3, pos: "POSITION_WR", depth: 1, x: -10, y: -0.8 });
    expect(eff[2]).toMatchObject({ x: 10.5, y: -0.8, stance: "StanceType_3pt" });
    expect(eff[0]).toBe(Y_TRIPS.movements.Normal[0]);
  });

  it("applies flipAssign / motionMan and merges repeated slot entries in order (like the builder)", () => {
    const eff = effectiveNormal(Y_TRIPS, spec({ positions: [{ slot: 2, x: 8, flipAssign: 4, motionMan: false }, { slot: 2, x: 9 }, { slot: 4, flipAssign: 99 }] }));
    expect(eff[2]).toMatchObject({ x: 9, flipAssign: 4, motionMan: false });
    expect(eff[4].flipAssign).toBe(3); // out of range: ignored (validation reports it)
    expect(effectiveAlignment(spec({ positions: [{ slot: 3, x: -12 }] }), lib)![3].x).toBe(-12);
    expect(effectiveAlignment({ base: "nope" }, lib)).toBeUndefined();
  });

  it("flips every player onto his flipAssign partner's spot, mirrored (SetBuilder)", () => {
    const flipped = flippedAlignment(Y_TRIPS.movements.Normal);
    expect(flipped[2]).toMatchObject({ x: -10.5, y: -2.2, facing: 90 }); // self partner: plain mirror
    expect(flipped[3]).toMatchObject({ x: -16.25, y: -2.2 }); // takes WR2's spot (off the line), mirrored
    expect(flipped[4]).toMatchObject({ x: 16.25, y: -0.8 });
    expect(flipped[6]).toMatchObject({ pos: "POSITION_FIRSTOFFENSELINE", x: -3.333, y: -1.2 });
    expect(flipped[8].x).toBe(0);
    expect(Object.is(flipped[8].x, -0)).toBe(false);
    const turned = flippedAlignment(effectiveNormal(Y_TRIPS, spec({ positions: [{ slot: 5, facing: 79, stance: "StanceType_2pt" }] })));
    expect(turned[5]).toMatchObject({ x: -5, facing: 101, stance: "StanceType_2pt" });
  });

  it("classifies depth from the QB", () => {
    expect(depthClass(-6)).toBe("shotgun");
    expect(depthClass(-5)).toBe("shotgun");
    expect(depthClass(-4.75)).toBe("pistol");
    expect(depthClass(-4)).toBe("pistol");
    expect(depthClass(-1.4)).toBe("under-center");
    expect(setDepthClass(Y_TRIPS.movements.Normal)).toBe("shotgun");
    expect(setDepthClass(I_CLOSE.movements.Normal)).toBe("under-center");
    const pistol = lib.setsByFormation.get(lib.formationByName("Pistol", "offense")!.asset)![0];
    expect(setDepthClass(pistol.movements.Normal)).toBe("pistol");
    expect(backDepth(-7.375)).toBe("tailback");
    expect(backDepth(-6)).toBe("gun");
    expect(backDepth(-4.75)).toBe("fullback");
  });

  it("reads presets by slot: only the players each preset moves", () => {
    const s = spec();
    expect(presetSlots(Y_TRIPS, "M1left")).toEqual([1]);
    expect(presetSlots(Y_TRIPS, "M5left")).toEqual([2, 5]);
    expect(presetSlots(Y_TRIPS, "Nope")).toEqual([]);
    expect(presetSlots(Y_TRIPS, "Normal")).toEqual([]);
    const m1 = effectivePreset(Y_TRIPS, s, "M1left");
    expect(m1.map((a, i) => (a ? i : -1)).filter((i) => i >= 0)).toEqual([1]);
    expect(m1[1]).toMatchObject({ x: -10.4, y: -2.2, pos: "POSITION_3DRB", slot: 1 });
    const m5 = effectivePreset(Y_TRIPS, s, "M5left");
    expect(m5[2]).toMatchObject({ x: 10.5, y: -0.8 });
    expect(m5[5]).toMatchObject({ x: -5, y: -2.2 });
    expect(presetKeys(Y_TRIPS, s)).toEqual(Object.keys(Y_TRIPS.movements).filter((k) => k !== "Normal"));
  });
});

describe("edits write minimal positions / movements", () => {
  it("keeps only changed fields and drops entries that match the base", () => {
    let s = edit(spec(), (d) => patchPosition(d, Y_TRIPS, 3, { x: -10.04999 }));
    expect(s.positions).toEqual([{ slot: 3, x: -10.05 }]);
    s = edit(s, (d) => patchPosition(d, Y_TRIPS, 3, { y: -2.2, stance: "StanceType_2pt" }));
    expect(s.positions).toEqual([{ slot: 3, x: -10.05, y: -2.2 }]); // stance equals the base
    s = edit(s, (d) => patchPosition(d, Y_TRIPS, 3, { x: -16.25, y: -0.8 }));
    expect(s.positions).toEqual([]);
    expect(changedSlots(Y_TRIPS, s)).toEqual([]);
  });

  it("writes flipAssign / motionMan and whole-degree facing", () => {
    let s = edit(spec(), (d) => patchPosition(d, Y_TRIPS, 2, { flipAssign: 4, motionMan: false, facing: 80.4 }));
    expect(s.positions).toEqual([{ slot: 2, facing: 80, flipAssign: 4, motionMan: false }]);
    expect(changedFields(Y_TRIPS, s, 2)).toEqual(["facing", "flipAssign", "motionMan"]);
    s = edit(s, (d) => patchPosition(d, Y_TRIPS, 2, { flipAssign: 2, motionMan: true, facing: 90 }));
    expect(s.positions).toEqual([]);
    s = edit(s, (d) => patchPosition(d, Y_TRIPS, 2, { flipAssign: 42 })); // not a slot: ignored
    expect(s.positions).toEqual([]);
  });

  it("preserves unknown keys on entries", () => {
    let s = spec({ positions: [{ slot: 3, x: -10, note: "keep me" }] });
    s = edit(s, (d) => patchPosition(d, Y_TRIPS, 3, { x: -16.25 }));
    expect(s.positions).toEqual([{ slot: 3, note: "keep me" }]);
    s = edit(s, (d) => resetPosition(d, 3));
    expect(s.positions).toEqual([{ slot: 3, note: "keep me" }]);
  });

  it("diffPositions turns an edited alignment into minimal entries (order and unknown keys kept)", () => {
    const base = Y_TRIPS.movements.Normal;
    const edited = base.map((a, i) => (i === 4 ? { ...a, x: 13.5 } : i === 2 ? { ...a, x: 8, motionMan: false } : a));
    expect(diffPositions(base, edited)).toEqual([
      { slot: 2, x: 8, motionMan: false },
      { slot: 4, x: 13.5 },
    ]);
    const existing = [{ slot: 4, x: 1, note: "n" }, { slot: 9, x: 5 }, { slot: 2, y: -0.8 }];
    expect(diffPositions(base, edited, existing)).toEqual([{ slot: 4, x: 13.5, note: "n" }, { slot: 2, x: 8, motionMan: false }]);
    expect(existing[0]).toEqual({ slot: 4, x: 1, note: "n" }); // pure
    expect(diffPositions(base, base, [{ slot: 3, x: 1 }, { slot: 3, y: 2 }])).toEqual([]);
  });

  it("tracks moved vs changed slots", () => {
    const s = edit(spec(), (d) => {
      patchPosition(d, Y_TRIPS, 3, { x: -12 });
      patchPosition(d, Y_TRIPS, 4, { facing: 80 });
    });
    expect(changedSlots(Y_TRIPS, s)).toEqual([3, 4]);
    expect(movedSlots(Y_TRIPS, s)).toEqual([3]);
  });

  it("edits only the targets of the base set's own presets, always writing x and y", () => {
    let s = edit(spec(), (d) => patchPreset(d, Y_TRIPS, "M1left", 1, { x: -8 }));
    expect(s.movements).toEqual({ M1left: [{ slot: 1, x: -8, y: -2.2 }] });
    expect(effectivePreset(Y_TRIPS, s, "M1left")[1]).toMatchObject({ x: -8, y: -2.2 });
    expect(changedPresetSlots(Y_TRIPS, s, "M1left")).toEqual([1]);
    // A slot the preset doesn't move, or a preset the base doesn't have: nothing happens.
    expect(canPatchPreset(Y_TRIPS, "M1left", 4)).toBe(false);
    expect(canPatchPreset(Y_TRIPS, "M5left", 5)).toBe(true);
    s = edit(s, (d) => patchPreset(d, Y_TRIPS, "M1left", 4, { x: 3, y: -2.2 }));
    s = edit(s, (d) => patchPreset(d, Y_TRIPS, "SM1left", 4, { x: 3, y: -2.2 }));
    expect(s.movements).toEqual({ M1left: [{ slot: 1, x: -8, y: -2.2 }] });
    // Back on the base target: the entry goes away.
    s = edit(s, (d) => patchPreset(d, Y_TRIPS, "M1left", 1, { x: -10.4 }));
    expect(s.movements).toBeUndefined();
    s = edit(s, (d) => patchPreset(d, Y_TRIPS, "M5left", 5, { y: -2.5 }));
    expect(s.movements).toEqual({ M5left: [{ slot: 5, x: -5, y: -2.5 }] });
    s = edit(s, (d) => resetPresetSlot(d, Y_TRIPS, "M5left", 5));
    expect(s.movements).toBeUndefined();

    // Presets can't be added; removePreset resets a base preset or drops a key the base doesn't have.
    expect(availablePresetKeys(Y_TRIPS, s)).toEqual([]);
    expect(() => edit(s, (d) => addPreset(d, Y_TRIPS, "SM1left"))).toThrow(/can't be added/);
    const bad = spec({ movements: { SM1left: [{ slot: 4, x: 3, y: -2.2 }], M1left: [{ slot: 1, x: -8, y: -2.2 }] } });
    expect(invalidPresetKeys(Y_TRIPS, bad)).toEqual(["SM1left"]);
    s = edit(bad, (d) => removePreset(d, Y_TRIPS, "SM1left"));
    expect(s.movements).toEqual({ M1left: [{ slot: 1, x: -8, y: -2.2 }] });
    s = edit(s, (d) => removePreset(d, Y_TRIPS, "M1left"));
    expect(s.movements).toBeUndefined();
  });

  it("feeds the art engine: moved players, preset paths from the new Normal spot", () => {
    const s = edit(spec(), (d) => {
      patchPosition(d, Y_TRIPS, 4, { x: 12, y: -0.8 });
      patchPosition(d, Y_TRIPS, 3, { y: -2.2 });
      patchPreset(d, Y_TRIPS, "M4left", 4, { x: -8, y: -2.2 });
    });
    const eff = effectiveSet(Y_TRIPS, s);
    expect(eff.asset).toBe(OFF + "Shotgun/PBS_Trips_Stack_Wk/PBS_Trips_Stack_Wk");
    const art = computeArt(eff, [], { preset: "M4left" });
    expect(art.players).toHaveLength(11);
    expect(art.players[4].base).toEqual({ x: -8, y: -2.2 });
    const preset = art.paths.find((p) => p.kind === "preset" && p.slot === 4)!;
    expect(preset.points).toEqual([
      { x: 12, y: -0.8 },
      { x: -8, y: -2.2 },
    ]);
    // M1left (untouched base preset) still moves the HB.
    expect(computeArt(eff, [], { preset: "M1left" }).players[1].base).toEqual({ x: -10.4, y: -2.2 });
  });

  it("serializes in contract order", () => {
    const file: SetsFile = {
      sets: [edit(spec(), (d) => patchPosition(d, Y_TRIPS, 2, { facing: 80, y: -0.8, x: 7.5, motionMan: false }))],
      formations: [newCustomFormation(Y_TRIPS.formation, { name: "Gun Stack", asset: "PBS_Gun_Stack" })],
    };
    const text = serializeDoc("sets", file);
    expect(text).toContain('{ "slot": 2, "x": 7.5, "y": -0.8, "facing": 80, "motionMan": false }');
    expect(text.indexOf('"sets"')).toBeLessThan(text.indexOf('"formations"'));
  });
});

describe("assets and game ids (SetBuilder / PlayBuilder.NewId)", () => {
  it("builds the builder's asset paths", () => {
    expect(customFormationAsset("PBS_Gun")).toBe(OFF + "PBS_Gun/PBS_Gun");
    expect(customSetAsset({ asset: "PBS_X", formation: SHOTGUN })).toBe(OFF + "Shotgun/PBS_X/PBS_X");
    expect(customSetAsset({ asset: "PBS_X", formation: "PBS_Gun" })).toBeUndefined(); // a bare leaf isn't a path
    expect(cloneAsset(OFF + "Shotgun/PBS_X/PBS_X", "PBS_T_Curls")).toBe(OFF + "Shotgun/PBS_X/PBS_T_Curls");
    // newCustomSet expands a bare custom formation leaf to the full path the builder needs.
    expect(newCustomSet(Y_TRIPS, { name: "A", asset: "PBS_A", formation: "PBS_Gun" }).formation).toBe(OFF + "PBS_Gun/PBS_Gun");
    expect(newCustomSet(Y_TRIPS, { name: "A", asset: "PBS_A" }).formation).toBe(SHOTGUN);
  });

  it("computes the same ids as the last game-side build (research/index/custom-*.tsv)", () => {
    const formTaken = new Set(lib.data.formations.map((f) => f.formId >>> 0));
    const setTaken = new Set(lib.data.sets.map((s) => s.setId >>> 0));
    const playTaken = new Set(lib.data.plays.map((p) => p.playId >>> 0));
    expect(gameId(OFF + "PBS_Gun/PBS_Gun", formTaken) & 0x7fffffff).toBe(1367080964);
    expect(gameId(OFF + "Shotgun/PBS_Y_Trips_Tight_Wk/PBS_Y_Trips_Tight_Wk", setTaken)).toBe(1818248703);
    expect(gameId(OFF + "Shotgun/PBS_Y_Trips_Tight_Wk/PBS_T_Curls", playTaken)).toBe(2459022563);
    const t = new Set<number>();
    const a = gameId("x", t);
    expect(gameId("x", t)).not.toBe(a); // probes past taken ids
    expect(gameId("X")).toBe(a); // case-insensitive
  });

  it("builds pbs-sets-v1.json into the formations and sets the builder created", () => {
    const doc = loadSetsDoc("pbs-sets-v1.json");
    const defs = customDefs(lib, [doc]);
    const tsvForms = loadIndexTsv("custom-formations");
    const tsvSets = loadIndexTsv("custom-sets");
    expect(defs.formations.map((f) => f.def)).toEqual([{ formId: 1367080964, name: "Gun PBS", type: "FormationType_Offense", asset: OFF + "PBS_Gun/PBS_Gun" }]);
    if (tsvForms.length) expect(defs.formations.map((f) => [String(f.def.formId), f.def.name, f.def.asset])).toEqual(tsvForms.map((r) => [r.formId, r.formationName, r.asset]));
    expect(defs.sets.map((s) => [s.def.setId, s.def.name, s.def.formation, s.def.asset])).toEqual([
      [1818248703, "Y Trips Tight Wk", SHOTGUN, OFF + "Shotgun/PBS_Y_Trips_Tight_Wk/PBS_Y_Trips_Tight_Wk"],
      [1591953037, "Trips Open", OFF + "PBS_Gun/PBS_Gun", OFF + "PBS_Gun/PBS_Trips_Open/PBS_Trips_Open"],
    ]);
    if (tsvSets.length) expect(defs.sets.map((s) => [String(s.def.setId), s.def.name, s.def.formation, s.def.asset])).toEqual(tsvSets.map((r) => [r.setId, r.setName, r.formation, r.asset]));
    const tight = defs.sets[0].def;
    expect(tight).toMatchObject({ classification: Y_TRIPS.classification, setType: Y_TRIPS.setType, canFlip: Y_TRIPS.canFlip });
    expect(tight.movements.Normal[2]).toMatchObject({ x: 8, y: -2.2 });
    expect(tight.movements.Normal[4]).toMatchObject({ x: 13.5, y: -2.2 });
    expect(tight.movements.M4left).toEqual([{ ...Y_TRIPS.movements.M4left[0], x: -8, y: -2.2 }]);
    expect(tight.movements.M2left).toBe(Y_TRIPS.movements.M2left); // untouched presets are the base's
    expect(Object.keys(tight.movements)).toEqual(Object.keys(Y_TRIPS.movements));
  });

  it("skips what the builder can't create (bad base, unknown formation, taken asset, bare leaf)", () => {
    const base = Y_TRIPS.asset;
    const data: SetsFile = {
      formations: [{ name: "Gun", asset: "Shotgun", base: SHOTGUN }, { name: "Bad", asset: "PBS_Bad", base: "nope" }],
      sets: [
        { name: "A", asset: "PBS_A", base: "nope", formation: SHOTGUN },
        { name: "B", asset: "PBS_B", base, formation: "nope/nope" },
        { name: "C", asset: "Y_Trips_Wk", base, formation: SHOTGUN },
        { name: "D", asset: "PBS_D", base, formation: "PBS_Bad" },
        { name: "E", asset: "PBS_E", base, formation: SHOTGUN.toUpperCase() },
        { name: "F", asset: "pbs_e", base, formation: SHOTGUN },
      ],
    };
    const defs = customDefs(lib, [{ path: "x", data }]);
    expect(defs.formations).toEqual([]);
    expect(defs.sets.map((s) => s.spec.name)).toEqual(["E"]);
    expect(defs.sets[0].def.formation).toBe(SHOTGUN);
  });
});

describe("validation (FORMATS.md §5, mirrors SetBuilder)", () => {
  const playable = () =>
    lib.data.formations
      .filter((f) => lib.formationSide(f) === "offense" && !lib.isMinigame(f))
      .flatMap((f) => lib.setsByFormation.get(f.asset) ?? []);

  it("accepts library offense sets as their own base, except where the builder's line rule rejects them", () => {
    let checked = 0;
    let rejected = 0;
    for (const s of playable()) {
      const issues = alignmentIssues(s.movements.Normal, s);
      const builderLine = s.movements.Normal.filter((a) => a.pos !== "POSITION_QB" && a.y > -1.5).length;
      expect(errors(issues), s.asset).toEqual(builderLine === 7 ? [] : ["set-line-count"]);
      if (builderLine !== 7) rejected++;
      checked++;
    }
    expect(checked).toBeGreaterThan(400);
    // Tackles at y −1.5 and tight ends at −1.6 count as off the line in SetBuilder: ~130 stock sets can't be a base as-is.
    expect(rejected).toBeGreaterThan(100);
    expect(rejected).toBeLessThan(checked / 2);
    expect(alignmentIssues(Y_TRIPS.movements.Normal, Y_TRIPS)).toEqual([]);
  });

  it("explains the line count and doesn't report the base's own OL splits (Flexbone)", () => {
    const issues = alignmentIssues(FLEXBONE.movements.Normal, FLEXBONE);
    expect(errors(issues)).toEqual(["set-line-count"]);
    expect(issues[0].message).toMatch(/5 players on the line .* LT \(y -1\.5\), RT \(y -1\.5\) count as off the line .* lines up this way too/);
    expect(warnings(issues)).toEqual([]);
  });

  it("flags line count, OL spots, depth classes, overlaps, past-LOS and flip partners", () => {
    const check = (patches: [number, object][], base = Y_TRIPS) => {
      const s = edit(spec({ base: base.asset }), (d) => patches.forEach(([slot, p]) => patchPosition(d, base, slot, p)));
      return alignmentIssues(effectiveNormal(base, s), base);
    };
    expect(errors(check([[3, { y: -2.2 }]]))).toEqual(["set-line-count"]); // WR1 off the line → 6
    expect(errors(check([[2, { y: -0.8 }]]))).toEqual(["set-line-count"]); // slot on the line → 8
    expect(errors(check([[3, { y: -2.2 }], [2, { y: -0.8 }]]))).toEqual([]); // swap: still 7
    expect(errors(check([[5, { y: -1.5 }]]))).toEqual(["set-line-count"]); // −1.5 is OFF the line for the builder
    expect(errors(check([[5, { y: -1.49 }]]))).toEqual([]);
    // OL: SetBuilder's spots (±0.25) are warnings.
    expect(check([[7, { x: -2 }]]).map((i) => [i.rule, i.level])).toEqual([["set-ol-spacing", "warning"]]);
    expect(check([[7, { x: -1.8 }]])).toEqual([]); // within 0.25 of −1.666
    expect(warnings(check([[8, { x: 0.5 }]]))).toContain("set-ol-spacing");
    expect(check([[7, { y: -1.2 }]]).some((i) => i.rule === "set-ol-depth" && i.level === "warning")).toBe(true);
    // QB / HB depth class: warnings.
    expect(warnings(check([[0, { y: -1.4 }], [1, { y: -7 }]]))).toEqual(["set-qb-depth", "set-back-depth"]);
    expect(errors(check([[0, { y: -1.4 }], [1, { y: -7 }]]))).toEqual([]);
    expect(warnings(check([[1, { x: 0, y: -7.375 }]]))).toEqual(["set-back-depth"]); // gun HB → tailback depth
    expect(check([[1, { x: 2.9 }]])).toEqual([]); // offset to the other side: same depth class
    expect(errors(check([[4, { x: 10.6, y: -2.3 }]]))).toEqual(["set-overlap"]);
    expect(errors(check([[4, { y: 1 }]]))).toContain("set-past-los");
    // I Form Close: FB to the tailback spot and the QB into the gun.
    expect(warnings(check([[2, { x: 2, y: -7.4 }]], I_CLOSE))).toEqual(["set-back-depth"]);
    expect(warnings(check([[0, { y: -6 }]], I_CLOSE))).toContain("set-qb-depth");
    // Flip partners: WR1 and the slot both taking WR2's spot collide when flipped; one-way pairs warn.
    const flip = check([[2, { flipAssign: 4 }]]);
    expect(warnings(flip)).toEqual(expect.arrayContaining(["set-flip-overlap", "set-flip-pair"]));
    expect(errors(flip)).toEqual([]);
  });

  it("warns when a lineman ends the line", () => {
    const s = edit(spec(), (d) => {
      patchPosition(d, Y_TRIPS, 5, { y: -2.2 }); // TE off → RT is the right end of the line
      patchPosition(d, Y_TRIPS, 3, { x: -12 });
      patchPosition(d, Y_TRIPS, 2, { x: -10.5, y: -0.8 }); // keep 7 on the line on the left
    });
    const issues = alignmentIssues(effectiveNormal(Y_TRIPS, s), Y_TRIPS);
    expect(errors(issues)).toEqual([]);
    expect(issues.find((i) => i.rule === "set-line-ends")?.message).toMatch(/RT is at the right end/);
  });

  it("accepts pbs-sets-v1.json (the file the builder built) with only dependency warnings", () => {
    const doc = loadSetsDoc("pbs-sets-v1.json");
    const issues = validateSetsFile(doc.data, lib, { file: doc.path });
    expect(errors(issues)).toEqual([]);
    expect(new Set(warnings(issues))).toEqual(new Set(["set-play-depends"]));
    expect(issues.every((i) => i.file === doc.path)).toBe(true);
  });

  it("validates a whole sets file: names, assets, base, formation, entries, clones", () => {
    const good = edit(spec({ plays: cloneEntries([PLAY("Shotgun/Y_Trips_Wk/Curls")], spec(), "PBS_") }), (d) => patchPosition(d, Y_TRIPS, 3, { x: -12 }));
    const file: SetsFile = { sets: [good] };
    expect(validateSetsFile(file, lib, { file: "playbooks/sets/a.json" }).filter((i) => i.level !== "info")).toEqual([]);

    const bad: SetsFile = {
      sets: [
        { ...good, asset: "bad asset", name: "" },
        { ...good, base: OFF + "Nope/Nope" },
        { ...good, asset: "Y_Trips_Wk", name: "Y Trips Wk" }, // library set path + library name in Shotgun
        { ...good, asset: "PBS_A", name: "A", formation: "PBS_Missing" },
        { ...good, asset: "PBS_B", name: "B", positions: [{ slot: 11, x: 1 }, { slot: 3, x: "1" as unknown as number }, { slot: 2, stance: "Nope", flipAssign: 12, motionMan: "yes" as unknown as boolean }] },
        { ...good, asset: "PBS_C", name: "C", plays: [{ from: OFF + "Shotgun/Y_Trips_Wk/Nope", name: "X", asset: "PBS_X" }] },
        { ...good, asset: "PBS_D", name: "D", plays: [{ from: PLAY("Shotgun/Y_Trips_Wk/Curls").asset, name: "Curls", asset: "PBS_X" }, { from: PLAY("Shotgun/Y_Trips_Wk/Curls").asset, name: "curls", asset: "pbs_x" }] },
        { ...good, asset: "PBS_E", name: "E", plays: [{ from: PLAY("Shotgun/Y_Trips_Wk/Curls").asset, name: "Y", asset: "PBS_Y", vip: 11, runHole: 12, playType: "Nope", reads: [{ pos: 20, pct: 1 }], players: { "3": "RunRoute/Nope", "4": { new: "bad name", steps: 3 } as never, "14": "RunRoute/WR_Run90for30" }, blocking: "NoSuchScheme" }] },
      ],
    };
    const issues = validateSetsFile(bad, lib, { file: "f" });
    const rules = (i: number) => issuesForSet(issues, i).filter((x) => x.level === "error").map((x) => x.rule);
    expect(rules(0)).toEqual(expect.arrayContaining(["set-name", "set-asset"]));
    expect(rules(1)).toEqual(["set-base"]);
    expect(rules(2)).toEqual(expect.arrayContaining(["set-asset-duplicate", "set-name-duplicate"]));
    expect(rules(3)).toEqual(["set-formation"]);
    expect(rules(4)).toEqual(expect.arrayContaining(["set-positions", "set-stance", "set-flip-assign", "set-motion-man"]));
    expect(rules(5)).toEqual(["set-play-from"]);
    expect(rules(6)).toEqual(expect.arrayContaining(["set-play-name", "set-play-asset"]));
    expect(new Set(rules(7))).toEqual(new Set(["set-play-vip", "set-play-runhole", "set-play-type", "set-play-reads", "set-play-assignment", "set-play-new", "set-play-players"]));
    expect(issuesForSet(issues, 7).find((x) => x.rule === "set-play-blocking")?.level).toBe("warning");
    expect(issues.every((i) => i.file === "f")).toBe(true);
  });

  it("allows clones from any set (with a slot-order warning) and from other clones", () => {
    const other = { from: PLAY("I_Form/Close/Power_O").asset, name: "Power O", asset: "PBS_TSW_Power_O" };
    const same = { from: PLAY("Shotgun/Bunch/518_Hook").asset, name: "Hook", asset: "PBS_TSW_Hook" };
    const ofClone = { from: OFF + "Shotgun/PBS_Trips_Stack_Wk/PBS_TSW_Hook", name: "Hook 2", asset: "PBS_TSW_Hook2" };
    const issues = validateSetsFile({ sets: [spec({ plays: [other, same, ofClone] })] }, lib);
    expect(errors(issues)).toEqual([]);
    expect(issues.filter((i) => i.rule === "set-play-layout").map((i) => i.where)).toEqual(["/sets/0/plays/0"]);
  });

  it("checks motion presets like SetBuilder: base presets only, their own slots, x and y", () => {
    const s = spec({
      movements: {
        M1left: [{ slot: 1, x: -8 }],
        M2left: [{ slot: 4, x: 1, y: -2.2 }],
        SM1left: [{ slot: 4, x: 1, y: -2.2 }],
        M4left: [{ slot: 4, x: -8, y: -2.2, facing: 80 }],
        Normal: [],
      },
    });
    const issues = validateSetsFile({ sets: [s] }, lib);
    const at = (k: string) => issues.filter((i) => i.where?.startsWith(`/sets/0/movements/${k}`)).map((i) => `${i.level} ${i.rule}`);
    expect(at("M1left")).toEqual(["error set-preset-xy"]);
    expect(at("M2left")).toEqual(["error set-preset-slot"]);
    expect(at("SM1left")).toEqual(["error set-preset-missing"]);
    expect(at("M4left")).toEqual(["warning set-preset-ignored"]);
    expect(at("Normal")).toEqual(["error set-movements"]);
    expect(issues.find((i) => i.rule === "set-preset-slot")?.message).toMatch(/M2 Left doesn't move WR2 \(slot 4\) — a preset can only move its own players \(SL1\)/);
  });

  it("checks custom formations: full paths, names, assets, cross-file", () => {
    const form = newCustomFormation(Y_TRIPS.formation, { name: "Gun Stack", asset: "PBS_Gun_Stack" });
    const full = customFormationAsset("PBS_Gun_Stack");
    const a: SetsFile = { sets: [spec({ formation: full })], formations: [form] };
    expect(validateSetsFile(a, lib).filter((i) => i.level !== "info")).toEqual([]);
    // A bare leaf can't be found by the builder.
    const leafRef = validateSetsFile({ ...a, sets: [spec({ formation: "PBS_Gun_Stack" })] }, lib);
    expect(errors(leafRef)).toEqual(["set-formation-path"]);
    expect(leafRef.find((i) => i.rule === "set-formation-path")?.message).toContain(full);

    const b: SetsFile = {
      sets: [spec({ name: "Other", formation: full })],
      formations: [{ ...form, base: OFF + "Nope/Nope", name: "Shotgun" }, { name: "", asset: "PBS_Gun_Stack", base: Y_TRIPS.formation }, { name: "Gun Stack", asset: "PBS_Gun_Stack2", base: Y_TRIPS.formation }],
    };
    const issues = validateSetsFiles(
      [
        { path: "a", data: a },
        { path: "b", data: b },
      ],
      lib,
    );
    const inB = issues.filter((i) => i.file === "b");
    expect(inB.map((i) => i.rule)).toEqual(
      expect.arrayContaining(["formation-base", "formation-name-taken", "formation-name", "formation-asset-duplicate", "formation-name-duplicate", "set-asset-duplicate"]),
    );
    expect(issues.filter((i) => i.file === "a" && i.rule === "set-asset-duplicate")).toHaveLength(1);
    // The first definition of a name wins: only the later one is flagged.
    expect(issues.filter((i) => i.rule === "formation-name-duplicate").map((i) => [i.file, i.where])).toEqual([["b", "/formations/2"]]);
  });

  it("warns about motion presets that break the line, only when the spec changes them", () => {
    const s = edit(spec(), (d) => patchPreset(d, Y_TRIPS, "M3right", 3, { y: -2.2 })); // WR1 steps off on M3right
    expect(s.movements).toEqual({ M3right: [{ slot: 3, x: -10, y: -2.2 }] });
    expect(presetIssues(Y_TRIPS, s, "M3right").map((i) => [i.rule, i.level])).toEqual([["set-line-count", "warning"]]);
    const issues = validateSetsFile({ sets: [s] }, lib);
    expect(issues.find((i) => i.where === "/sets/0/movements/M3right")?.message).toMatch(/M3 Right: 6 players on the line/);
    expect(errors(issues)).toEqual([]);
  });
});

describe("presets for depth and splits", () => {
  const normal = Y_TRIPS.movements.Normal;
  it("computes depth presets", () => {
    expect(depthPresetY("shotgun", 0, Y_TRIPS, normal)).toBe(-6);
    expect(depthPresetY("under-center", 0, Y_TRIPS, normal)).toBe(-1.4);
    expect(depthPresetY("pistol", 0, Y_TRIPS, normal)).toBe(-4);
    expect(depthPresetY("line", 4, Y_TRIPS, normal)).toBe(-0.8); // WR2 (off in the base)
    expect(depthPresetY("line", 5, Y_TRIPS, normal)).toBe(-1.4); // TE keeps its base line depth
    expect(depthPresetY("line", 7, Y_TRIPS, normal)).toBe(-0.9); // LG
    expect(depthPresetY("line", 6, FLEXBONE, FLEXBONE.movements.Normal)).toBe(-1.2); // LT at −1.5 is off the line for the builder
    expect(depthPresetY("off", 3, Y_TRIPS, normal)).toBe(-2.2);
    expect(depthPresetY("backfield", 1, Y_TRIPS, normal)).toBe(-6); // HB: base depth
    expect(depthPresetY("backfield", 1, I_CLOSE, I_CLOSE.movements.Normal)).toBe(-7.375);
    expect(depthPresetY("backfield", 2, Y_TRIPS, normal)).toBe(-6); // a slot into the gun backfield
  });

  it("computes OL-relative splits on the player's side", () => {
    expect(splitPreset("slot", 3, normal)).toEqual({ x: -10.5 });
    expect(splitPreset("numbers", 3, normal)).toEqual({ x: -15.5 });
    expect(splitPreset("wide", 2, normal)).toEqual({ x: 16.25 });
    expect(splitPreset("tight", 3, normal)!.x).toBeCloseTo(-5, 2);
    expect(splitPreset("wing", 3, normal)).toEqual({ x: expect.closeTo(-6.667, 2), y: -2.2 });
    expect(splitPreset("outsideTe", 2, normal)).toEqual({ x: 7 }); // TE at 5 on the right
    expect(splitPreset("outsideTe", 3, normal)!.x).toBeCloseTo(-7, 2); // no TE on the left: TE spot + 2
    expect(splitPreset("hash", 4, normal)!.x).toBeCloseTo(6.167, 2);
    expect(splitPreset("mirror", 3, normal)).toEqual({ x: 16.25, facing: 90 });
    const n2 = normal.map((a, i) => (i === 3 ? { ...a, facing: 80 } : a));
    expect(splitPreset("mirror", 3, n2)).toEqual({ x: 16.25, facing: 100 });
  });

  it("counts players on the line like SetBuilder (non-QB, y > −1.5)", () => {
    expect(normal.filter(onLine)).toHaveLength(7);
    expect(onLine({ pos: "POSITION_WR", group: "", y: -1.4 })).toBe(true);
    expect(onLine({ pos: "POSITION_WR", group: "", y: -1.5 })).toBe(false);
    expect(onLine({ pos: "POSITION_LASTKEYOFFENSE", group: "", y: -1.6 })).toBe(false);
    expect(onLine({ pos: "POSITION_WR", group: "", y: -2.2 })).toBe(false);
    expect(onLine({ pos: "POSITION_QB", group: "Set_Group_Type_Quarterback", y: -1.4 })).toBe(false);
  });
});

describe("names, clones and dependencies", () => {
  it("generates assets and names", () => {
    expect(setAbbrev("Trips Stack Wk")).toBe("TSW");
    expect(setAbbrev("Bunch")).toBe("Bun");
    expect(setAbbrev("Gun 3x1 Slot")).toBe("G3S");
    expect(suggestAsset("PBS_", "Trips Stack Wk", new Set(["pbs_trips_stack_wk"]))).toBe("PBS_Trips_Stack_Wk_2");
    expect(setsFilePath("Trips Ideas")).toBe("playbooks/sets/trips-ideas.json");
    expect(setsFilePath("  ")).toBeUndefined();
    const taken = setNamesInFormation(lib, Y_TRIPS.formation, []);
    expect(taken.has("Y Trips Wk")).toBe(true);
    expect(suggestSetName("Y Trips Wk", taken)).toBe("Y Trips Wk 2");
    const withCustom = setNamesInFormation(lib, Y_TRIPS.formation, [loadSetsDoc("pbs-sets-v1.json")]);
    expect(withCustom.has("Y Trips Tight Wk")).toBe(true);
    expect(setNamesInFormation(lib, customFormationAsset("PBS_Gun"), [loadSetsDoc("pbs-sets-v1.json")])).toEqual(new Set(["Trips Open"]));
    expect(presetLabel("M1left")).toBe("M1 Left");
    expect(presetLabel("SM5right")).toBe("SM5 Right");
    expect(presetLabel("M3rght")).toBe("M3 Right");
  });

  it("names clones prefix + set abbrev + play leaf, unique", () => {
    const curls = PLAY("Shotgun/Y_Trips_Wk/Curls");
    expect(cloneEntry(curls, { prefix: "PBS_", setName: "Trips Stack Wk", takenNames: new Set(), takenAssets: new Set() })).toEqual({
      from: curls.asset,
      name: curls.name,
      asset: "PBS_TSW_Curls",
    });
    expect(cloneEntry({ asset: curls.asset, name: " Dig  X Comeback" }, { prefix: "", setName: "Bunch", takenNames: new Set(), takenAssets: new Set() }).name).toBe("Dig X Comeback");
    const twice = cloneEntries([curls, curls], spec(), "PBS_");
    expect(twice.map((e) => e.asset)).toEqual(["PBS_TSW_Curls", "PBS_TSW_Curls_2"]);
    expect(twice[1].name).toBe(`${curls.name} 2`);
    expect(clonablePlays(lib, Y_TRIPS).length).toBeGreaterThan(80);
  });

  it("warns when a cloned play depends on moved players", () => {
    const normal = Y_TRIPS.movements.Normal;
    // WR1 (slot 3): Curls is a plain route, Mtn Mesh realigns WR1 with OverrideFormPos, HB Base has him block.
    expect(playDependencies(lib, PLAY("Shotgun/Y_Trips_Wk/Curls"), [3], normal)).toEqual([]);
    expect(playDependencies(lib, PLAY("Shotgun/Y_Trips_Wk/Mtn_Mesh"), [3], normal).map((d) => d.kind)).toEqual(["realign"]);
    expect(playDependencies(lib, PLAY("Shotgun/Y_Trips_Wk/HB_Base"), [3], normal).map((d) => d.kind)).toEqual(expect.arrayContaining(["block"]));
    // HB (slot 1) on a run: handoff mechanics.
    const hb = playDependencies(lib, PLAY("Shotgun/Y_Trips_Wk/Inside_Zone"), [1], normal);
    expect(hb.map((d) => d.kind)).toEqual(expect.arrayContaining(["mechanics", "handoff"]));
    expect(hb[0].label).toBe("HB1");
    // WR2 (slot 4) on a motion play.
    expect(playDependencies(lib, PLAY("Shotgun/Y_Trips_Wk/Mtn_Mesh"), [4], normal).map((d) => d.kind)).toEqual(["motion"]);
    expect(stepDependencies([{ type: "RunRoute", distance: 5, direction: 90, speed: 100 }, { type: "GetOpen" }])).toEqual([]);

    const s = edit(spec({ plays: cloneEntries([PLAY("Shotgun/Y_Trips_Wk/Mtn_Mesh"), PLAY("Shotgun/Y_Trips_Wk/Curls")], spec(), "PBS_") }), (d) =>
      patchPosition(d, Y_TRIPS, 4, { x: 12 }),
    );
    const warn = validateSetsFile({ sets: [s] }, lib).filter((i) => i.rule === "set-play-depends");
    expect(warn).toHaveLength(1);
    expect(warn[0].where).toBe("/sets/0/plays/0");
    expect(warn[0].message).toMatch(/depends on moved WR2: motion waypoints are absolute/);
  });

  it("matches the Formations editor: moved receivers' blocks are safe, fixed starting spots warn (pbs-sets-v1)", () => {
    const doc = loadSetsDoc("pbs-sets-v1.json");
    const warn = validateSetsFile(doc.data, lib, { file: doc.path }).filter((i) => i.rule === "set-play-depends");
    // PBS T Inside Zone / PBS O HB Draw only lead-block with moved receivers (FORMATS.md §5: safe); Mtn Mesh realigns.
    expect(warn.map((i) => i.where)).toEqual(["/sets/1/plays/1"]);
    expect(warn[0].message).toMatch(/Play PBS O MTN MESH: depends on moved WR1, WR2: has a fixed starting spot/);
  });
});
