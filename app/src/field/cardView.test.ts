// The card window against the whole library: every route ends inside the card with room for its arrowhead, every
// player and zone is drawn inside, and depth near the LOS stays true to scale.
import { describe, expect, it } from "vitest";
import { artSideForPlay, computeArt } from "../model/art";
import { buildCatalog } from "../model/catalog";
import { HALF_WIDTH } from "../model/geometry";
import { loadLibraryData } from "../model/libFixture";
import { buildLibraryIndex } from "../model/library";
import { CARD_ASPECT, cardDepth, cardViewport } from "./cardView";
import { projectArt } from "./fieldMath";

const data = loadLibraryData();
const lib = buildLibraryIndex(data);
const cat = buildCatalog(lib, []);

describe("card viewport", () => {
  it("has the card aspect, carries its depth scale and is stable", () => {
    for (const side of ["offense", "defense"] as const) {
      const v = cardViewport(side);
      expect((v.maxX - v.minX) / (v.maxY - v.minY)).toBeCloseTo(CARD_ASPECT, 6);
      expect(v.depth).toBe(cardDepth(side));
      expect(cardViewport(side)).toBe(v);
      expect(Object.isFrozen(v)).toBe(true);
      // True scale through the short area: hitches, slants, flats and the line look exactly as on the field.
      for (const y of [-2, 0, 3, 6, 8]) expect(v.depth!.map(y)).toBe(y);
    }
    expect(cardViewport("special")).toBe(cardViewport("offense"));
  });

  it("draws every library route, player and zone inside the card (arrowheads included)", () => {
    const ARROW_ROOM = 0.35; // yd between an arrow tip and the card edge
    const problems: string[] = [];
    let checked = 0;
    for (const p of data.plays) {
      const rp = cat.get(p.asset)!;
      const set = lib.setByAsset.get(p.set);
      const formation = lib.formationByAsset.get(rp.formation);
      if (!set || (formation && lib.isMinigame(formation))) continue;
      const side = artSideForPlay(cat, rp);
      if (side === undefined) continue;
      const vp = cardViewport(rp.side);
      const art = projectArt(computeArt(set, rp.slots.map((s) => s.steps), { vip: rp.vip, runHole: rp.runHole, side }), vp.depth!);
      checked++;
      const bad = (what: string) => problems.length < 12 && problems.push(`${p.name} (${p.asset.split("/").slice(-3).join("/")}): ${what}`);
      for (const pl of art.players) {
        if (Math.abs(pl.at.x) > HALF_WIDTH) continue; // lined up out of bounds: nothing to fit
        if (pl.at.y < vp.minY || pl.at.y > vp.maxY) bad(`player ${pl.label} at y ${pl.at.y.toFixed(2)}`);
      }
      for (const path of art.paths) {
        if (Math.abs(path.points[0].x) > HALF_WIDTH) continue;
        for (const v of path.points) if (v.y < vp.minY || v.y > vp.maxY) bad(`${path.kind} point y ${v.y.toFixed(2)}`);
        if (path.cap !== "arrow") continue;
        const tip = path.points[path.points.length - 1];
        if (tip.y > vp.maxY - ARROW_ROOM || tip.y < vp.minY + ARROW_ROOM) bad(`${path.kind} arrow tip y ${tip.y.toFixed(2)}`);
        if (Math.abs(tip.x) > HALF_WIDTH - ARROW_ROOM) bad(`${path.kind} arrow tip x ${tip.x.toFixed(2)}`);
      }
      for (const z of art.zones) {
        if (z.center.y + z.ry > vp.maxY - 0.2 || z.center.y - z.ry < vp.minY) bad(`${z.kind} zone ${z.center.y.toFixed(2)}±${z.ry.toFixed(2)}`);
      }
    }
    expect(checked).toBeGreaterThan(9000);
    expect(problems).toEqual([]);
  }, 120_000);
});
