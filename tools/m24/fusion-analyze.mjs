// Joins the FUSION save with the stock M24 DB and the modded M24 DB; writes build/m24/fusion-m24.json
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { readTdbBE } from "./tdbbe.mjs";
import { readTdb } from "../tdb.mjs";
const save = readTdb(readFileSync("../MAMA9/release/PBOOKOFF-FUSION"));
const mod = readTdbBE(readFileSync("../MAMA9/mama9.DB")).byName;
const stock = readTdbBE(readFileSync("../MAMA9/customplaybooks.DB")).byName;
const T = n => save.tables.find(t => t.name === n).rows;
const idx = (t, k) => new Map(t.rows.map(r => [r[k], r]));
const group = (t, k) => { const m = new Map(); for (const r of t.rows) { if (!m.has(r[k])) m.set(r[k], []); m.get(r[k]).push(r); } return m; };
const modPlays = idx(mod.PBPL, "PLYL"), stockPlays = idx(stock.PBPL, "PLYL");
const modSets = idx(mod.SETL, "SETL"), stockSets = idx(stock.SETL, "SETL");
const modForms = idx(mod.PBFM, "PBFM");
const modPlys = group(mod.PLYS, "PLYL"), stockPlys = group(stock.PLYS, "PLYL");
const modPslo = group(mod.PSLO, "PSAL"), stockPslo = group(stock.PSLO, "PSAL");
const modPlpd = idx(mod.PLPD, "PLYL"), stockPlpd = idx(stock.PLPD, "PLYL");
const modPlrd = idx(mod.PLRD, "PLYL"), stockPlrd = idx(stock.PLRD, "PLYL");
// formation name for a stock SETL: via any STID row in the stock DB
const stockStid = group(stock.STID, "SETL"), stockForms = idx(stock.PBFM, "PBFM");
const formNameOf = setl => { for (const s of stockStid.get(setl) || []) { const f = stockForms.get(s.PBFM); if (f) return f.name; } };
const steps = (pslo, psal) => (pslo.get(psal) || []).sort((a, b) => a.step - b.step).map(({ code, val1, val2, val3 }) => ({ code, val1, val2, val3 }));
const out = [];
for (const f of T("PGFM")) {
  const F = { formation: modForms.get(f.PBFM)?.name, pbfm: f.PBFM, ftyp: modForms.get(f.PBFM)?.FTYP, sets: [] };
  for (const s of T("STID").filter(s => s.PBFM === f.PBFM)) {
    const S = { setl: s.SETL, modName: modSets.get(s.SETL)?.name, stockName: stockSets.get(s.SETL)?.name, stockForm: formNameOf(s.SETL), form: modSets.get(s.SETL)?.FORM, plays: [] };
    for (const p of T("PGPL").filter(p => p.SETL === s.SETL).sort((a, b) => a.ord_ - b.ord_)) {
      const mp = modPlays.get(p.PLYL), sp = stockPlays.get(p.PLYL);
      const players = (modPlys.get(p.PLYL) || []).sort((a, b) => a.poso - b.poso).map(r => {
        const st = (stockPlys.get(p.PLYL) || []).find(x => x.poso === r.poso);
        const ms = steps(modPslo, r.PSAL), ss = st ? steps(stockPslo, st.PSAL) : null;
        return { poso: r.poso, psal: r.PSAL, artl: r.ARTL, plrr: r.PLRR, stockPsal: st?.PSAL, changed: !st || JSON.stringify(ms) !== JSON.stringify(ss), steps: ms };
      });
      S.plays.push({ plyl: p.PLYL, ord: p.ord_, flag: p.Flag, plyt: p.PLYT, modName: mp?.name, stockName: sp?.name, vpos: mp?.vpos, stockVpos: sp?.vpos, srmm: mp?.SRMM,
        hole: modPlrd.get(p.PLYL)?.hole, stockHole: stockPlrd.get(p.PLYL)?.hole, reads: modPlpd.get(p.PLYL), stockReads: stockPlpd.get(p.PLYL),
        ai: T("PBAI").filter(a => a.PLYL === p.PLYL).map(a => ({ aigr: a.AIGR, prct: a.prct })), players });
    }
    F.sets.push(S);
  }
  out.push(F);
}
mkdirSync("build/m24", { recursive: true });
writeFileSync("build/m24/fusion-m24.json", JSON.stringify(out, null, 1));
for (const F of out) { console.log(`# ${F.formation} (ftyp ${F.ftyp})`);
  for (const S of F.sets) { console.log(`  ## ${S.modName} <= stock "${S.stockForm} / ${S.stockName}" (${S.setl}) ${S.plays.length} plays`);
    for (const P of S.plays) console.log(`     ${P.plyl} ${P.stockName} -> ${P.modName}  chg=[${P.players.filter(x => x.changed).map(x => x.poso)}]${P.vpos !== P.stockVpos ? " vip " + P.stockVpos + "->" + P.vpos : ""}`); } }
