// Checks the built FUSION sets (PBS_DUMP_NEW dump in build/fusion/added) against the M24 mod: every skill player's
// normal + flipped spot, and every motion preset's motion man (normal + flipped spot), mapped through the converter's slot map.
// usage: node tools/m24/verify-fusion-sets.mjs
import { readFileSync, readdirSync } from "node:fs";
import { readTdbBE } from "./tdbbe.mjs";
import { makeSetReader } from "./sets.mjs";
const db = readTdbBE(readFileSync("../MAMA9/mama9.DB")).byName;
const A = makeSetReader(db);
const names = new Map(); for (const r of db.SGFF.rows) { if (!names.has(r.SETL)) names.set(r.SETL, []); names.get(r.SETL).push(r.name); }
const F = JSON.parse(readFileSync("build/m24/fusion-m24.json", "utf8"));
const spec = JSON.parse(readFileSync("playbooks/sets/fusion-sets.json", "utf8"));
const report = readFileSync("build/m24/fusion-report.md", "utf8");
const D = "build/fusion/added/", files = readdirSync(D);
const eq = (a, b) => Math.abs(a - b) < 0.01;
let checked = 0, bad = 0;
const fail = m => { bad++; console.log("  MISMATCH " + m); };
for (const f of F) for (const s of f.sets) {
  const name = s.modName.replace(/\*/g, "").trim();
  const folder = { "I Form": "I_Form", "Goal Line": "Goal_Line_Offense", "Singleback": "Singleback", "Pistol": "Pistol", "Gun": "Shotgun", "Hail Mary": "Hail_Mary" }[f.formation];
  const sp = spec.sets.find(x => x.name === name && x.formation.split("/").at(-2) === folder);
  if (!sp) continue;
  // slot map from the report line "M24 i→j"
  const sec = report.slice(report.indexOf(`### ${name}  (M24 "${s.stockForm} / ${s.stockName}"`));
  const slotOf = {}; for (const m of sec.split("\n")[2].matchAll(/M24 (\d)→(\d)/g)) slotOf[+m[1]] = +m[2];
  const dump = JSON.parse(readFileSync(D + files.find(x => x.endsWith(`__${folder}__${sp.asset}__${sp.asset}.json`)), "utf8")).root;
  const mv = Object.fromEntries(dump.preSnapMovements.map(m => [m.__Id, m.PlayerPosition]));
  const norm = A(s.setl);
  for (const p of norm.filter(p => p.poso >= 1 && p.poso <= 5)) {
    const e = mv.Normal.find(q => q.posOrder === slotOf[p.poso]); checked++;
    if (!(eq(e.XPos, p.x) && eq(e.YPos, p.y) && eq(e.flippedXPos, p.fx) && eq(e.flippedYPos, p.fy))) fail(`${name} Normal M24 ${p.poso}: built (${e.XPos},${e.YPos}) flip (${e.flippedXPos},${e.flippedYPos}) vs M24 (${p.x},${p.y}) flip (${p.fx},${p.fy})`);
  }
  for (const pn of names.get(s.setl) ?? []) {
    const m = pn.match(/^(S?)M(\d)(le|ri|l|r)$/); if (!m) continue;
    const k = +m[2], m27 = `${m[1]}M${slotOf[k]}${m[3].startsWith("l") ? "left" : "right"}`;
    // only the motion man moves (by design: no other player shifts during a motion)
    for (const p of A(s.setl, pn).filter(p => p.poso === k && p.x !== null)) {
      const o = norm.find(z => z.poso === p.poso);
      if (eq(o.x, p.x) && eq(o.y, p.y) && eq(o.fx, p.fx) && eq(o.fy, p.fy)) continue; // doesn't move in this preset
      checked++;
      const e = (mv[m27] ?? []).find(q => q.posOrder === slotOf[p.poso]);
      if (!e) { fail(`${name} ${pn}→${m27}: M24 ${p.poso} missing`); continue; }
      if (!(eq(e.XPos, p.x) && eq(e.YPos, p.y) && eq(e.flippedXPos, p.fx) && eq(e.flippedYPos, p.fy))) fail(`${name} ${pn}→${m27} M24 ${p.poso}: built (${e.XPos},${e.YPos}) flip (${e.flippedXPos},${e.flippedYPos}) vs M24 (${p.x},${p.y}) flip (${p.fx},${p.fy})`);
    }
  }
  // no leftover presets the M24 set doesn't have
  for (const id of Object.keys(mv)) if (id !== "Normal" && !(id in sp.presets)) fail(`${name}: extra preset ${id}`);
}
console.log(`${checked} spots checked, ${bad} mismatches`);
