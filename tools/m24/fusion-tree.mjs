// Prints the FUSION custom book (M24 save) with names resolved from the M24 play DB.
import { readFileSync } from "node:fs";
import { readTdbBE } from "./tdbbe.mjs";
import { readTdb } from "../tdb.mjs";
const [saveFile, dbFile] = process.argv.slice(2);
const save = readTdb(readFileSync(saveFile));
const db = readTdbBE(readFileSync(dbFile)).byName;
const T = n => save.tables.find(t => t.name === n).rows;
const plays = new Map(db.PBPL.rows.map(r => [r.PLYL, r]));
const sets = new Map(db.SETL.rows.map(r => [r.SETL, r]));
const forms = new Map(db.PBFM.rows.map(r => [r.PBFM, r]));
for (const f of T("PGFM")) {
  console.log(`# ${forms.get(f.PBFM)?.name} (PBFM ${f.PBFM} FTYP ${forms.get(f.PBFM)?.FTYP})`);
  for (const s of T("STID").filter(s => s.PBFM === f.PBFM)) {
    const S = sets.get(s.SETL);
    console.log(`  ## ${S?.name} (SETL ${s.SETL} FORM ${S?.FORM})`);
    const ps = T("PGPL").filter(p => p.SETL === s.SETL).sort((a, b) => a.ord_ - b.ord_);
    for (const p of ps) { const P = plays.get(p.PLYL); console.log(`     ${p.PLYL}\t${P?.name}\tPLYT ${p.PLYT}\tset ${P?.SETL}${p.Flag ? "\tAUD " + p.Flag : ""}`); }
  }
}
