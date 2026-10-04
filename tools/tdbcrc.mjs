// CRC layout of EA TDB files as found in Madden 27 saves (CRC-32/MPEG-2: poly 04C11DB7, MSB-first, init FFFFFFFF, no final xor).
//   DB header crc   @db+20  = crc(db .. db+20)
//   index crc       @idxEnd = crc(db+24 .. idxEnd)
//   table hdr crc   @t+32   = crc(t .. t+32)
//   table data crc  @end    = crc(t+36 .. end)  i.e. field definitions + the full (max-size) records block
// Verified on PBOOKOFF-TEST with `node tools/tdbcrc.mjs <save>`.
import { readFileSync } from "node:fs";

const T = new Uint32Array(256).map((_, n) => { let c = n << 24; for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1; return c >>> 0; });
export const crc = b => { let c = 0xffffffff; for (const x of b) c = (T[((c >>> 24) ^ x) & 0xff] ^ (c << 8)) >>> 0; return c; };

// Returns every CRC slot with its covered range, stored value and computed value.
export function crcSlots(buf) {
  const db = buf.indexOf(Buffer.from("DB\0\x08", "latin1"));
  const n = buf.readUInt32LE(db + 16), idxEnd = db + 24 + n * 8;
  const slots = [{ name: "dbHeader", at: db + 20, from: db, to: db + 20 }, { name: "index", at: idxEnd, from: db + 24, to: idxEnd }];
  for (let i = 0; i < n; i++) {
    const p = db + 24 + i * 8, name = buf.toString("latin1", p, p + 4), t = idxEnd + 4 + buf.readUInt32LE(p + 4);
    const recBytes = buf.readUInt32LE(t + 4), max = buf.readUInt16LE(t + 16), fields = buf[t + 24];
    const data = t + 36 + fields * 16, end = data + max * recBytes;
    slots.push({ name: name + ".hdr", at: t + 32, from: t, to: t + 32 });
    slots.push({ name: name + ".data", at: end, from: t + 36, to: end });
  }
  for (const s of slots) { s.stored = s.at + 4 <= buf.length ? buf.readUInt32LE(s.at) : null; s.computed = crc(buf.subarray(s.from, s.to)); }
  return slots;
}

if (process.argv[1]?.endsWith("tdbcrc.mjs")) {
  const buf = readFileSync(process.argv[2]);
  for (const s of crcSlots(buf))
    console.log(`${s.name.padEnd(10)} [${s.from}, ${s.to}) @${s.at}  stored ${s.stored?.toString(16).padStart(8, "0")}  computed ${s.computed.toString(16).padStart(8, "0")}  ${s.stored === s.computed ? "OK" : "MISMATCH"}`);
  console.log(`file length ${buf.length}`);
}
