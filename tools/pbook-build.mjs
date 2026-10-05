// Builds a Madden 27 custom playbook save (PBOOKOFF-*) from a playbook spec, using an existing save as the template
// (the template supplies the file layout, table capacities, and any "sets": "template" sections).
// Plays can be any game play (research/index/plays.tsv) or one we built (research/index/custom-plays.tsv).
// usage: node tools/pbook-build.mjs [--collect] [--index <dir>] <spec.json> <template save> <out file>
//   --index: folder holding this build's custom-*.tsv manifests and pull-plays.json (default research/index + build/)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { readTdb, writeTable } from "./tdb.mjs";
import { crcSlots } from "./tdbcrc.mjs";

// In-game audible slot -> PGPL.Flag bit (observed in Madden 27: slot 3 is bit 16, slot 4 is bit 8).
export const AUDIBLE_BITS = { 1: 2, 2: 4, 3: 16, 4: 8 };

// --collect: only record library plays that need pulling into the global play sheet (custom plays may not exist yet).
const argv = process.argv.slice(2);
const collect = argv.includes("--collect");
const indexAt = argv.indexOf("--index");
const customDir = indexAt >= 0 ? pathToFileURL(resolve(argv[indexAt + 1]) + sep) : null;
const [specFile, templateFile, outFile] = argv.filter((a, i) => a !== "--collect" && (indexAt < 0 || (i !== indexAt && i !== indexAt + 1)));
const spec = JSON.parse(readFileSync(specFile, "utf8"));
const buf = Buffer.from(readFileSync(templateFile));
const T = Object.fromEntries(readTdb(buf).tables.map(t => [t.name, t]));

const indexDir = new URL("../research/index/", import.meta.url);
const tsv = (name, dir = indexDir) => {
  const file = new URL(`${name}.tsv`, dir);
  if (!existsSync(file)) return [];
  const [head, ...rows] = readFileSync(file, "utf8").trim().split(/\r?\n/);
  const cols = head.split("\t");
  return rows.map(r => Object.fromEntries(r.split("\t").map((v, i) => [cols[i], v])));
};
const enums = JSON.parse(readFileSync(new URL("enums.json", indexDir), "utf8").replace(/^﻿/, ""));
const norm = s => s.toLowerCase().replace(/[\s_]+/g, " ").trim();

const customIndex = customDir ?? indexDir;
const formations = [...tsv("formations"), ...tsv("custom-formations", customIndex)];
// Custom sets first: a custom set may reuse a stock set's name in the same formation (FUSION's "Bunch TE").
const sets = [...tsv("custom-sets", customIndex), ...tsv("sets")];
const plays = [...tsv("plays"), ...tsv("custom-plays", customIndex)];
// Names repeat (minigames reuse "Shotgun"), so prefer the formation whose asset folder is named after it.
// Also "Special" exists for both offense (12) and defense (20), so filter by the playbook's side, then prefer a
// formation the template already contains, then a folder named after it.
const defenseTypes = new Set(["FormationType_Defense", "FormationType_KickReturn", "FormationType_Safety_KickReturn"]);
const sideOk = f => (spec.side === "defense") === defenseTypes.has(f.formationType);
const formByName = name => {
  const named = formations.filter(x => norm(x.formationName) === norm(name) && sideOk(x));
  const f = named.find(x => T.PGFM.rows.some(r => r.PBFM === +x.formId))
    ?? named.find(x => norm(x.asset.split("/").at(-1)) === norm(name)) ?? named[0];
  if (!f && collect) return null;
  if (!f) throw new Error(`unknown formation "${name}"`);
  return f;
};
// Sets are matched by name within the formation's asset folder (set names repeat across formations).
const setByName = (form, name) => {
  const folder = form.asset.slice(0, form.asset.lastIndexOf("/") + 1);
  const s = sets.find(x => x.asset.startsWith(folder) && norm(x.setName) === norm(name));
  if (!s && collect) return null;
  if (!s) throw new Error(`unknown set "${name}" in ${form.formationName}`);
  return s;
};
const playInSet = (set, name) => {
  const p = plays.find(x => x.set === set.asset && norm(x.playName) === norm(name));
  if (!p && collect) return null;
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
  if (!form) continue; // collect pass: custom formation not built yet
  const formId = +form.formId;
  out.PGFM.push(T.PGFM.rows.find(r => r.PBFM === formId) ?? { BOKL: book, PBFM: formId, SRFM: formId });

  if (fspec.sets === "template") {
    if (!T.STID.rows.some(r => r.PBFM === formId))
      throw new Error(`"${fspec.formation}" (formId ${formId}) has no sets in the template, so "template" would drop it`);
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
    if (!set) continue; // collect pass: custom set not built yet
    const setId = +set.setId;
    out.STID.push(T.STID.rows.find(r => r.SETL === setId) ?? { BOKL: book, SETL: setId, PBFM: formId, PBST: setId, SPF_: 0 });
    const used = new Set();
    sspec.plays.forEach((pspec, i) => {
      const p = playInSet(set, pspec.play);
      if (!p) return;
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

// The game drops library plays that aren't in the global play sheet, so the mod build must pull them in.
// Collected across all playbooks into build/pull-plays.json (tools/export.ps1 clears it first).
const pullFile = customDir ? new URL("pull-plays.json", customDir) : new URL("../build/pull-plays.json", import.meta.url);
const pull = new Set(existsSync(pullFile) ? JSON.parse(readFileSync(pullFile, "utf8")) : []);
for (const row of out.PGPL) {
  const p = plays.find(x => +x.playId === row.PLYL && x.global !== undefined);
  if (p && p.global === "0") { pull.add(p.asset); console.log(`note: "${p.playName}" (${p.asset.split("/").slice(-2).join("/")}) isn't in the global play sheet; the mod will pull it in`); }
}
writeFileSync(pullFile, JSON.stringify([...pull], null, 2));
if (collect) process.exit(0);

// Save timestamp in the FBCHUNKS header: u16 year, month, day, hour, minute, second at 0x16.
const now = new Date();
[now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()]
  .forEach((v, i) => buf.writeUInt16LE(v, 0x16 + i * 2));

const bad = crcSlots(buf).filter(s => s.stored !== s.computed);
if (bad.length) throw new Error("CRC mismatch after write: " + bad.map(s => s.name).join(", "));
writeFileSync(outFile, buf);
console.log(`wrote ${outFile}: ${out.PGFM.length} formations, ${out.STID.length} sets, ${out.PGPL.length} plays, ${out.PBAI.length} AI rows`);
