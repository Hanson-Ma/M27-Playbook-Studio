// Derives save-file code tables by joining a custom playbook save with the game index:
//   PLYT (PGPL play-type code) <-> Play.offensePlayType / defensePlayType
// usage: node tools/derive-codes.mjs <save> [more saves...]
import { readFileSync } from "node:fs";
import { readTdb } from "./tdb.mjs";

const [head, ...rows] = readFileSync(new URL("../research/index/plays.tsv", import.meta.url), "utf8").trim().split(/\r?\n/);
const cols = head.split("\t");
const plays = new Map();
for (const r of rows) { const p = Object.fromEntries(r.split("\t").map((v, i) => [cols[i], v])); plays.set(+p.playId, p); }

const byType = new Map(); // playType -> Map(PLYT -> count)
for (const file of process.argv.slice(2)) {
  const T = Object.fromEntries(readTdb(readFileSync(file)).tables.map(t => [t.name, t.rows]));
  for (const r of T.PGPL) {
    const p = plays.get(r.PLYL);
    if (!p) continue;
    const type = p.offensePlayType !== "OffensePlayType_DontCare" ? p.offensePlayType : p.defensePlayType;
    const m = byType.get(type) ?? byType.set(type, new Map()).get(type);
    m.set(r.PLYT, (m.get(r.PLYT) ?? 0) + 1);
  }
}
const out = {};
for (const [type, m] of [...byType].sort()) {
  const ranked = [...m].sort((a, b) => b[1] - a[1]);
  out[type] = ranked[0][0];
  console.log(`${type.padEnd(40)} -> PLYT ${ranked.map(([k, n]) => `${k}(x${n})`).join(", ")}`);
}
console.log(JSON.stringify(out));
