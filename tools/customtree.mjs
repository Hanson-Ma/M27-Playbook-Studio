// Prints a custom playbook save (saves/PBOOKOFF-* / PBOOKDEF-*) as Formation > Set > plays, resolved via research/index.
// usage: node tools/customtree.mjs <save> [--ai]
import { readFileSync, existsSync } from "node:fs";
import { readTdb } from "./tdb.mjs";

const [file, flag] = process.argv.slice(2);
const tsv = name => {
  const file = new URL(`../research/index/${name}.tsv`, import.meta.url);
  if (!existsSync(file)) return [];
  const [head, ...rows] = readFileSync(file, "utf8").trim().split(/\r?\n/);
  const cols = head.split("\t");
  return rows.map(r => Object.fromEntries(r.split("\t").map((v, i) => [cols[i], v])));
};
const forms = new Map([...tsv("formations"), ...tsv("custom-formations")].map(f => [+f.formId, f]));
const sets = new Map([...tsv("sets"), ...tsv("custom-sets")].map(s => [+s.setId, s]));
const plays = new Map();
for (const p of [...tsv("plays"), ...tsv("custom-plays")]) (plays.get(+p.playId) ?? plays.set(+p.playId, []).get(+p.playId)).push(p);

const t = Object.fromEntries(readTdb(readFileSync(file)).tables.map(x => [x.name, x.rows]));
const ai = new Map();
for (const r of t.PBAI) (ai.get(r.PLYL) ?? ai.set(r.PLYL, []).get(r.PLYL)).push(`${r.AIGR}:${r.prct}`);

let missing = 0;
for (const fm of t.PGFM) {
  const f = forms.get(fm.PBFM);
  console.log(`\n${f ? f.formationName : "?"} (formId ${fm.PBFM})`);
  for (const st of t.STID.filter(s => s.PBFM === fm.PBFM)) {
    const s = sets.get(st.SETL);
    console.log(`  ${s ? s.setName : "?"} (setId ${st.SETL})`);
    for (const pl of t.PGPL.filter(p => p.SETL === st.SETL).sort((a, b) => a.ord_ - b.ord_)) {
      const cands = plays.get(pl.PLYL) ?? [];
      const match = cands.find(c => sets.get(st.SETL) && c.set === sets.get(st.SETL).asset) ?? cands[0];
      if (!match) missing++;
      console.log(`    ${String(pl.ord_).padStart(2)}. ${match ? match.playName : "?? playId " + pl.PLYL}  [PLYT ${pl.PLYT} Flag ${pl.Flag}]${flag === "--ai" ? "  ai " + (ai.get(pl.PLYL) ?? []).join(" ") : ""}`);
    }
  }
}
console.log(`\naudibles (PBAU): ${JSON.stringify(t.PBAU)}`);
console.log(`plays ${t.PGPL.length}, unresolved ${missing}`);
