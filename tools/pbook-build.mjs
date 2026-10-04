// Builds a Madden 27 custom playbook save (PBOOKOFF-*) from a playbook spec, using an existing save as the template.
// Plays are currently taken from rows already in the template (so their play-type code and CPU weights are known good).
// usage: node tools/pbook-build.mjs <spec.json> <template save> <out file>
import { readFileSync, writeFileSync } from "node:fs";
import { readTdb, writeTable } from "./tdb.mjs";
import { crcSlots } from "./tdbcrc.mjs";

const [specFile, templateFile, outFile] = process.argv.slice(2);
const spec = JSON.parse(readFileSync(specFile, "utf8"));
const buf = Buffer.from(readFileSync(templateFile));
const { tables } = readTdb(buf);
const T = Object.fromEntries(tables.map(t => [t.name, t]));

const tsv = name => {
  const [head, ...rows] = readFileSync(new URL(`../research/index/${name}.tsv`, import.meta.url), "utf8").trim().split(/\r?\n/);
  const cols = head.split("\t");
  return rows.map(r => Object.fromEntries(r.split("\t").map((v, i) => [cols[i], v])));
};
const norm = s => s.toLowerCase().replace(/\s+/g, " ").trim();
const formIdByName = new Map(tsv("formations").map(f => [norm(f.formationName), +f.formId]));
const setNames = new Map(tsv("sets").map(s => [+s.setId, s.setName]));
const playNames = new Map(tsv("plays").map(p => [+p.playId, p.playName]));

const book = T.PGPL.rows[0].BOKL;
const out = { PGFM: [], STID: [], PGPL: [], PBAI: [] };
const usedPlays = new Set();

for (const fspec of spec.formations) {
  const formId = formIdByName.get(norm(fspec.formation));
  const fmRow = T.PGFM.rows.find(r => r.PBFM === formId);
  if (!fmRow) throw new Error(`formation "${fspec.formation}" (${formId}) is not in the template`);
  out.PGFM.push(fmRow);
  const templateSets = T.STID.rows.filter(r => r.PBFM === formId);

  const sets = fspec.sets === "template"
    ? templateSets.map(s => ({ row: s, plays: T.PGPL.rows.filter(p => p.SETL === s.SETL).sort((a, b) => a.ord_ - b.ord_) }))
    : fspec.sets.map(sspec => {
        const row = templateSets.find(s => norm(setNames.get(s.SETL) ?? "") === norm(sspec.set));
        if (!row) throw new Error(`set "${sspec.set}" not found under ${fspec.formation} in the template`);
        const pool = T.PGPL.rows.filter(p => p.SETL === row.SETL);
        const plays = sspec.plays.map(pspec => {
          const hit = pool.find(p => norm(playNames.get(p.PLYL) ?? "") === norm(pspec.play));
          if (!hit) throw new Error(`play "${pspec.play}" not found in ${sspec.set} in the template`);
          const audible = pspec.audible ?? 0;
          if (audible < 0 || audible > 4) throw new Error(`${pspec.play}: audible slot must be 1-4`);
          return { ...hit, Flag: audible ? 1 << audible : 0 }; // slot 1..4 -> bit 2/4/8/16
        });
        const slots = plays.map(p => p.Flag).filter(Boolean);
        if (new Set(slots).size !== slots.length) throw new Error(`${sspec.set}: duplicate audible slot`);
        return { row, plays };
      });

  for (const { row, plays } of sets) {
    out.STID.push(row);
    plays.forEach((p, i) => { out.PGPL.push({ ...p, BOKL: book, ord_: i }); usedPlays.add(p.PLYL); });
  }
}
out.PBAI = T.PBAI.rows.filter(r => usedPlays.has(r.PLYL));

for (const [name, rows] of Object.entries(out)) writeTable(buf, T[name], rows);

// Save timestamp in the FBCHUNKS header: u16 year, month, day, hour, minute, second at 0x16.
const now = new Date();
[now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()]
  .forEach((v, i) => buf.writeUInt16LE(v, 0x16 + i * 2));

const bad = crcSlots(buf).filter(s => s.stored !== s.computed);
if (bad.length) throw new Error("CRC mismatch after write: " + bad.map(s => s.name).join(", "));
writeFileSync(outFile, buf);
console.log(`wrote ${outFile}: ${out.PGFM.length} formations, ${out.STID.length} sets, ${out.PGPL.length} plays, ${out.PBAI.length} AI rows`);
