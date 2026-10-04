// Reader for EA "DB" (TDB) tables inside a Madden 27 FBCHUNKS save (e.g. saves/PBOOKOFF-*).
// usage: node tools/tdb.mjs <save> [table] [maxRows]
import { readFileSync } from "node:fs";

export function readTdb(buf) {
  const db = buf.indexOf(Buffer.from("DB\0\x08", "latin1"));
  if (db < 0) throw new Error("no DB header");
  const tableCount = buf.readUInt32LE(db + 16);
  const tables = [];
  let p = db + 24;
  for (let i = 0; i < tableCount; i++, p += 8)
    tables.push({ name: buf.toString("latin1", p, p + 4), offset: buf.readUInt32LE(p + 4) });
  const dataStart = p + 4; // 4-byte CRC follows the table index
  for (const t of tables) {
    let q = dataStart + t.offset;
    t.start = q;
    // header: u32 ?, u32 recordBytes, u32 recordBits, u32 0, u16 maxRecords, u16 records, u32 ?, u8 fieldCount, u8 indexCount, u16 0, u32 0, u32 crc
    t.recordBytes = buf.readUInt32LE(q + 4);
    t.recordBits = buf.readUInt32LE(q + 8);
    t.maxRecords = buf.readUInt16LE(q + 16);
    t.records = buf.readUInt16LE(q + 18);
    t.fieldCount = buf[q + 24];
    q += 36;
    t.fields = [];
    for (let f = 0; f < t.fieldCount; f++, q += 16)
      t.fields.push({ type: buf.readUInt32LE(q), bitOffset: buf.readUInt32LE(q + 4), name: buf.toString("latin1", q + 8, q + 12), bits: buf.readUInt32LE(q + 12) });
    t.dataStart = q;
    t.rows = [];
    for (let r = 0; r < t.records; r++) {
      const rec = buf.subarray(q + r * t.recordBytes, q + (r + 1) * t.recordBytes);
      const row = {};
      for (const f of t.fields) row[f.name] = f.type === 0 ? readString(rec, f) : readBitsLE(rec, f.bitOffset, f.bits);
      t.rows.push(row);
    }
  }
  return { dbOffset: db, tables };
}

// Little-endian bit order: bit 0 is the LSB of byte 0.
function readBitsLE(rec, off, bits) {
  let v = 0n;
  for (let i = 0; i < bits; i++) {
    const bit = off + i;
    if ((rec[bit >> 3] >> (bit & 7)) & 1) v |= 1n << BigInt(i);
  }
  return Number(v);
}

function readString(rec, f) {
  const s = rec.subarray(f.bitOffset >> 3, (f.bitOffset + f.bits) >> 3).toString("latin1");
  return s.replace(/\0.*$/s, "");
}

if (process.argv[1]?.endsWith("tdb.mjs")) {
  const [file, only, maxRows = "8"] = process.argv.slice(2);
  const { tables } = readTdb(readFileSync(file));
  for (const t of tables) {
    if (only && only !== "*" && t.name !== only) continue;
    console.log(`\n== ${t.name}: ${t.records}/${t.maxRecords} rows, ${t.recordBytes}B (${t.recordBits} bits)  fields: ${t.fields.map(f => `${f.name}:${f.type}/${f.bitOffset}+${f.bits}`).join(" ")}`);
    for (const r of t.rows.slice(0, +maxRows)) console.log("  " + JSON.stringify(r));
  }
}
