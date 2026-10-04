// Schema-less protobuf wire-format dumper for PlaybookAsset.protobufString.
// usage: node tools/protodump.mjs <playbook.json> [maxDepth] [maxRepeat]
import { readFileSync } from "node:fs";

const [file, maxDepthArg = "6", maxRepeatArg = "3"] = process.argv.slice(2);
const maxDepth = +maxDepthArg, maxRepeat = +maxRepeatArg;
const b64 = JSON.parse(readFileSync(file, "utf8")).root.protobufString;
const buf = Buffer.from(b64, "base64");
console.log(`decoded ${buf.length} bytes`);

function varint(b, i) {
  let r = 0n, s = 0n;
  for (;;) { const x = b[i++]; r |= BigInt(x & 0x7f) << s; s += 7n; if (!(x & 0x80)) return [r, i]; }
}

// Try to parse bytes as a message; returns fields or null if it isn't a clean message.
function parse(b) {
  const out = []; let i = 0;
  while (i < b.length) {
    let key; try { [key, i] = varint(b, i); } catch { return null; }
    const field = Number(key >> 3n), wt = Number(key & 7n);
    if (field === 0) return null;
    if (wt === 0) { let v; [v, i] = varint(b, i); out.push({ field, wt, v }); }
    else if (wt === 2) { let len; [len, i] = varint(b, i); len = Number(len); if (i + len > b.length) return null; out.push({ field, wt, bytes: b.subarray(i, i + len) }); i += len; }
    else if (wt === 5) { if (i + 4 > b.length) return null; out.push({ field, wt, f32: b.readFloatLE(i) }); i += 4; }
    else if (wt === 1) { if (i + 8 > b.length) return null; out.push({ field, wt, f64: b.readDoubleLE(i) }); i += 8; }
    else return null;
  }
  return out;
}

const printable = s => /^[\x20-\x7e]*$/.test(s);

function show(fields, depth, indent) {
  const seen = {};
  for (const f of fields) {
    seen[f.field] = (seen[f.field] ?? 0) + 1;
    if (seen[f.field] > maxRepeat) { if (seen[f.field] === maxRepeat + 1) console.log(`${indent}#${f.field} ... (more repeats)`); continue; }
    if (f.wt === 0) console.log(`${indent}#${f.field} = ${f.v}`);
    else if (f.wt === 5) console.log(`${indent}#${f.field} = ${f.f32} (f32)`);
    else if (f.wt === 1) console.log(`${indent}#${f.field} = ${f.f64} (f64)`);
    else {
      const s = f.bytes.toString("utf8");
      const sub = depth < maxDepth && f.bytes.length > 0 ? parse(f.bytes) : null;
      if (printable(s) && (!sub || f.bytes.length < 40)) console.log(`${indent}#${f.field} = "${s}"`);
      else if (sub) { console.log(`${indent}#${f.field} {  (${f.bytes.length}b)`); show(sub, depth + 1, indent + "  "); console.log(`${indent}}`); }
      else console.log(`${indent}#${f.field} = <${f.bytes.length} bytes>`);
    }
  }
}

show(parse(buf), 0, "");
