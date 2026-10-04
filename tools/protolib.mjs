// Minimal schema-less protobuf walker that keeps absolute byte offsets, so values can be patched in place.

export function varint(b, i) {
  let r = 0n, s = 0n;
  for (;;) { const x = b[i++]; if (x === undefined) throw new Error("eof"); r |= BigInt(x & 0x7f) << s; s += 7n; if (!(x & 0x80)) return [r, i]; }
}

// Parses b[start,end) as a message. Returns fields with absolute offsets, or null if not a clean message.
export function parse(b, start = 0, end = b.length) {
  const out = []; let i = start;
  while (i < end) {
    let key; try { [key, i] = varint(b, i); } catch { return null; }
    const field = Number(key >> 3n), wt = Number(key & 7n);
    if (field === 0) return null;
    const at = i;
    if (wt === 0) { let v; try { [v, i] = varint(b, i); } catch { return null; } out.push({ field, wt, at, v }); }
    else if (wt === 2) { let len; try { [len, i] = varint(b, i); } catch { return null; } len = Number(len); if (i + len > end) return null; out.push({ field, wt, at: i, len }); i += len; }
    else if (wt === 5) { if (i + 4 > end) return null; out.push({ field, wt, at, f32: b.readFloatLE(i) }); i += 4; }
    else if (wt === 1) { if (i + 8 > end) return null; out.push({ field, wt, at, f64: b.readDoubleLE(i) }); i += 8; }
    else return null;
    if (i > end) return null;
  }
  return out;
}

export const sub = (b, f) => parse(b, f.at, f.at + f.len);
export const str = (b, f) => b.toString("utf8", f.at, f.at + f.len);
export const get = (fields, n) => fields?.find(f => f.field === n);
export const all = (fields, n) => fields?.filter(f => f.field === n) ?? [];

// Depth-first search for length-delimited fields whose parsed content satisfies pred(fields).
export function findMessages(b, fields, pred, depth = 0, maxDepth = 8, acc = []) {
  if (!fields || depth > maxDepth) return acc;
  for (const f of fields) {
    if (f.wt !== 2 || f.len === 0) continue;
    const s = sub(b, f);
    if (!s) continue;
    if (pred(s, f)) acc.push({ field: f, fields: s });
    findMessages(b, s, pred, depth + 1, maxDepth, acc);
  }
  return acc;
}

export function dump(b, fields, indent = "", depth = 0) {
  for (const f of fields) {
    if (f.wt === 0) console.log(`${indent}#${f.field} = ${f.v}   @${f.at}`);
    else if (f.wt === 5) console.log(`${indent}#${f.field} = ${f.f32} (f32)   @${f.at}`);
    else if (f.wt === 1) console.log(`${indent}#${f.field} = ${f.f64} (f64)   @${f.at}`);
    else {
      const s = f.len ? sub(b, f) : null;
      const text = str(b, f);
      if (/^[\x20-\x7e]*$/.test(text) && (!s || f.len < 40)) console.log(`${indent}#${f.field} = "${text}"`);
      else if (s && depth < 10) { console.log(`${indent}#${f.field} {   @${f.at} len ${f.len}`); dump(b, s, indent + "  ", depth + 1); console.log(`${indent}}`); }
      else console.log(`${indent}#${f.field} = <${f.len} bytes>`);
    }
  }
}
