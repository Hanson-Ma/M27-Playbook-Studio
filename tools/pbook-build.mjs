// Builds a Madden 27 custom playbook save (PBOOKOFF-*) from a playbook spec, using an existing save as the template
// (the template supplies the file layout, table capacities, and any "sets": "template" sections).
// Plays can be any game play (research/index/plays.tsv) or one we built (research/index/custom-plays.tsv).
// usage: node tools/pbook-build.mjs <spec.json> <template save> <out file>
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { readTdb, writeTable } from "./tdb.mjs";
import { crcSlots } from "./tdbcrc.mjs";

// In-game audible slot -> PGPL.Flag bit (observed in Madden 27: slot 3 is bit 16, slot 4 is bit 8).
export const AUDIBLE_BITS = { 1: 2, 2: 4, 3: 16, 4: 8 };

const [specFile, templateFile, outFile] = process.argv.slice(2);
const spec = JSON.parse(readFileSync(specFile, "utf8"));
const buf = Buffer.from(readFileSync(templateFile));
const T = Object.fromEntries(readTdb(buf).tables.map(t => [t.name, t]));

const indexDir = new URL("../research/index/", import.meta.url);
const tsv = name => {
  const file = new URL(`${name}.tsv`, indexDir);
  if (!existsSync(file)) return [];
  const [head, ...rows] = readFileSync(file, "utf8").trim().split(/\r?\n/);
  const cols = head.split("\t");
  return rows.map(r => Object.fromEntries(r.split("\t").map((v, i) => [cols[i], v])));
};
const enums = JSON.parse(readFileSync(new URL("enums.json", indexDir), "utf8").replace(/^﻿/, ""));
const norm = s => s.toLowerCase().replace(/[\s_]+/g, " ").trim();

const formations = tsv("formations");
const sets = tsv("sets");
const plays = [...tsv("plays"), ...tsv("custom-plays")];
// Names repeat (minigames reuse "Shotgun"), so prefer the formation whose asset folder is named after it.
const formByName = name => {
  const named = formations.filter(x => norm(x.formationName) === norm(name));
  const f = named.find(x => norm(x.asset.split("/").at(-1)) === norm(name)) ?? named[0];
  if (!f) throw new Error(`unknown formation "${name}"`);
  return f;
};
// Sets are matched by name within the formation's asset folder (set names repeat across formations).
const setByName = (form, name) => {
  const folder = form.asset.slice(0, form.asset.lastIndexOf("/") + 1);
  const s = sets.find(x => x.asset.startsWith(folder) && norm(x.setName) === norm(name));
  if (!s) throw new Error(`unknown set "${name}" in ${form.formationName}`);
  return s;
};
const playInSet = (set, name) => {
  const p = plays.find(x => x.set === set.asset && norm(x.playName) === norm(name));
  if (!p) throw new Error(`unknown play "${name}" in set ${set.setName}`);
  return p;
};
const plyt = p => {
  const type = p.offensePlayType !== "OffensePlayType_DontCare" ? p.offensePlayType : p.defensePlayType;
  const v = enums.OffensePlayType[type] ?? enums.DefensePlayType[type];
  if (v === undefined) throw new Error(`no PLYT for ${type}`);
  return v;
};
const situation = name => {
  const key = `Offense_PlayCallSituation_${name}`;
  if (!(key in enums.Offense_PlayCallSituation)) throw new Error(`unknown situation "${name}"`);
  return enums.Offense_PlayCallSituation[key];
};

const book = T.PGPL.rows[0]?.BOKL ?? 32764;
const out = { PGFM: [], STID: [], PGPL: [], PBAI: [] };

for (const fspec of spec.formations) {
  const form = formByName(fspec.formation);
  const formId = +form.formId;
  out.PGFM.push(T.PGFM.rows.find(r => r.PBFM === formId) ?? { BOKL: book, PBFM: formId, SRFM: formId });

  if (fspec.sets === "template") {
    for (const s of T.STID.rows.filter(r => r.PBFM === formId)) {
      out.STID.push(s);
      const rows = T.PGPL.rows.filter(p => p.SETL === s.SETL).sort((a, b) => a.ord_ - b.ord_);
      rows.forEach((p, i) => out.PGPL.push({ ...p, BOKL: book, ord_: i }));
      out.PBAI.push(...T.PBAI.rows.filter(r => rows.some(p => p.PLYL === r.PLYL)));
    }
    continue;
  }

  for (const sspec of fspec.sets) {
    const set = setByName(form, sspec.set);
    const setId = +set.setId;
    out.STID.push(T.STID.rows.find(r => r.SETL === setId) ?? { BOKL: book, SETL: setId, PBFM: formId, PBST: setId, SPF_: 0 });
    const used = new Set();
    sspec.plays.forEach((pspec, i) => {
      const p = playInSet(set, pspec.play);
      const audible = pspec.audible ?? 0;
      if (audible && !AUDIBLE_BITS[audible]) throw new Error(`${pspec.play}: audible slot must be 1-4`);
      if (audible && used.has(audible)) throw new Error(`${sspec.set}: audible slot ${audible} used twice`);
      used.add(audible);
      out.PGPL.push({ BOKL: book, SETL: setId, PLYL: +p.playId, PBST: setId, PLYT: plyt(p), ord_: i, Flag: audible ? AUDIBLE_BITS[audible] : 0 });
      // CPU situation weights: explicit "cpu" wins, otherwise keep whatever the template had for this play.
      const cpu = pspec.cpu ? Object.entries(pspec.cpu).map(([k, v]) => ({ BOKL: book, PLYL: +p.playId, AIGR: situation(k), prct: v }))
        : T.PBAI.rows.filter(r => r.PLYL === +p.playId);
      out.PBAI.push(...cpu);
    });
  }
}

for (const [name, rows] of Object.entries(out)) writeTable(buf, T[name], rows);

// Save timestamp in the FBCHUNKS header: u16 year, month, day, hour, minute, second at 0x16.
const now = new Date();
[now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()]
  .forEach((v, i) => buf.writeUInt16LE(v, 0x16 + i * 2));

const bad = crcSlots(buf).filter(s => s.stored !== s.computed);
if (bad.length) throw new Error("CRC mismatch after write: " + bad.map(s => s.name).join(", "));
writeFileSync(outFile, buf);
console.log(`wrote ${outFile}: ${out.PGFM.length} formations, ${out.STID.length} sets, ${out.PGPL.length} plays, ${out.PBAI.length} AI rows`);
