// Reader for big-endian EA TDB files (Madden 24 customplaybooks.db / exported .DB).
// usage: node tools/m24/tdbbe.mjs <file.DB> [table] [maxRows]
import { readFileSync } from "node:fs";

export function readTdbBE(buf) {
  if (buf.toString("latin1", 0, 2) !== "DB") throw new Error("no DB header");
  const tableCount = buf.readUInt32BE(16);
  const tables = [];
  let p = 24;
  for (let i = 0; i < tableCount; i++, p += 8)
    tables.push({ name: [...buf.toString("latin1", p, p + 4)].reverse().join(""), offset: buf.readUInt32BE(p + 4) });
  const dataStart = p + 4;
  const byName = {};
  for (const t of tables) {
    let q = dataStart + t.offset;
    t.start = q;
    t.recordBytes = buf.readUInt32BE(q + 4);
    t.recordBits = buf.readUInt32BE(q + 8);
    t.maxRecords = buf.readUInt16BE(q + 16);
    t.records = buf.readUInt16BE(q + 18);
    t.fieldCount = buf[q + 24];
    q += 36;
    t.fields = [];
    for (let f = 0; f < t.fieldCount; f++, q += 16)
      t.fields.push({ type: buf.readUInt32BE(q), bitOffset: buf.readUInt32BE(q + 4),
        name: [...buf.toString("latin1", q + 8, q + 12)].reverse().join(""), bits: buf.readUInt32BE(q + 12) });
    t.dataStart = q;
    t.rows = [];
    for (let r = 0; r < t.records; r++) {
      const rec = buf.subarray(q + r * t.recordBytes, q + (r + 1) * t.recordBytes);
      const row = {};
      for (const f of t.fields) row[f.name] = f.type === 0 ? readString(rec, f) : readBitsBE(rec, f.bitOffset, f.bits, f.type);
      row.$deleted = (rec[0] & 0x80) !== 0 && false;
      t.rows.push(row);
    }
    byName[t.name] = t;
  }
  return { tables, byName };
}

function readBitsBE(rec, off, bits, type) {
  let v = 0n;
  for (let i = 0; i < bits; i++) {
    const b = off + i;
    v = (v << 1n) | BigInt((rec[b >> 3] >> (7 - (b & 7))) & 1);
  }
  let n = Number(v);
  if (type === 2 && bits < 53 && n >= 2 ** (bits - 1)) n -= 2 ** bits; // signed
  return n;
}
function readString(rec, f) {
  const s = rec.subarray(f.bitOffset >> 3, (f.bitOffset + f.bits) >> 3);
  const z = s.indexOf(0);
  return s.toString("latin1", 0, z < 0 ? s.length : z);
}

if (process.argv[1]?.endsWith("tdbbe.mjs")) {
  const [file, only, maxRows = "5"] = process.argv.slice(2);
  const { tables } = readTdbBE(readFileSync(file));
  for (const t of tables) {
    if (only && t.name !== only) continue;
    console.log(`== ${t.name}: ${t.records}/${t.maxRecords} rows, ${t.recordBytes}B  fields: ${t.fields.map(f => `${f.name}:${f.type}/${f.bitOffset}+${f.bits}`).join(" ")}`);
    for (const r of t.rows.slice(0, +maxRows)) { const { $deleted, ...o } = r; console.log("  " + JSON.stringify(o)); }
  }
}
