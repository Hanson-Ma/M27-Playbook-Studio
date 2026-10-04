// Reader for EA "DB" (TDB) tables inside a Madden 27 FBCHUNKS save (e.g. saves/PBOOKOFF-*).
// usage: node tools/tdb.mjs <save> [table] [maxRows]
import { readFileSync } from "node:fs";
import { crc } from "./tdbcrc.mjs";

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
    // @20 u16 deleted count, @22 u16 first deleted row (65535 = none). Deleted rows have the top bit of their
    // last byte set and their first 32 bits reused as the next-deleted index.
    t.deletedCount = buf.readUInt16LE(t.start + 20);
    t.firstDeleted = buf.readUInt16LE(t.start + 22);
    t.rows = [];
    t.allRows = [];
    for (let r = 0; r < t.records; r++) {
      const rec = buf.subarray(q + r * t.recordBytes, q + (r + 1) * t.recordBytes);
      const row = {};
      for (const f of t.fields) row[f.name] = f.type === 0 ? readString(rec, f) : readBitsLE(rec, f.bitOffset, f.bits);
      const deleted = (rec[t.recordBytes - 1] & 0x80) !== 0;
      t.allRows.push({ ...row, $deleted: deleted });
      if (!deleted) t.rows.push(row);
    }
  }
  return { dbOffset: db, tables };
}

// Rewrites one table in place with `rows` (compacted, no deleted rows) and refreshes its two CRCs.
export function writeTable(buf, t, rows) {
  if (rows.length > t.maxRecords) throw new Error(`${t.name}: ${rows.length} rows exceeds capacity ${t.maxRecords}`);
  buf.fill(0, t.dataStart, t.dataStart + t.maxRecords * t.recordBytes);
  rows.forEach((row, r) => {
    const rec = buf.subarray(t.dataStart + r * t.recordBytes, t.dataStart + (r + 1) * t.recordBytes);
    for (const f of t.fields) {
      if (f.type === 0) throw new Error(`${t.name}.${f.name}: string fields not supported yet`);
      if (!(f.name in row)) throw new Error(`${t.name}: row ${r} missing ${f.name}`);
      writeBitsLE(rec, f.bitOffset, f.bits, row[f.name]);
    }
  });
  buf.writeUInt16LE(rows.length, t.start + 18);
  buf.writeUInt16LE(0, t.start + 20);
  buf.writeUInt16LE(0xffff, t.start + 22);
  buf.writeUInt32LE(crc(buf.subarray(t.start, t.start + 32)), t.start + 32);
  const end = t.dataStart + t.maxRecords * t.recordBytes;
  buf.writeUInt32LE(crc(buf.subarray(t.start + 36, end)), end);
}

function writeBitsLE(rec, off, bits, value) {
  const v = BigInt(value);
  if (v < 0n || v >= 1n << BigInt(bits)) throw new Error(`value ${value} does not fit in ${bits} bits`);
  for (let i = 0; i < bits; i++) {
    const bit = off + i, mask = 1 << (bit & 7);
    if ((v >> BigInt(i)) & 1n) rec[bit >> 3] |= mask; else rec[bit >> 3] &= ~mask;
  }
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
    console.log(`\n== ${t.name}: ${t.rows.length} live (${t.records} used, ${t.deletedCount} deleted)/${t.maxRecords} rows, ${t.recordBytes}B (${t.recordBits} bits)  fields: ${t.fields.map(f => `${f.name}:${f.type}/${f.bitOffset}+${f.bits}`).join(" ")}`);
    for (const r of t.rows.slice(0, +maxRows)) console.log("  " + JSON.stringify(r));
  }
}
