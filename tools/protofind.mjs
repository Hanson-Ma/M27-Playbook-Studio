// Finds a play (by playId) inside a playbook protobuf and prints it with byte offsets.
// usage: node tools/protofind.mjs <playbook.json> <playId> [positionAssignId]
import { readFileSync } from "node:fs";
import { parse, findMessages, get, dump } from "./protolib.mjs";

const [file, playIdArg, padIdArg] = process.argv.slice(2);
const buf = Buffer.from(JSON.parse(readFileSync(file, "utf8")).root.protobufString, "base64");
const top = parse(buf);
const playId = BigInt(playIdArg);

// A play message: #1 is its name (string) and #2 its playId (varint).
const plays = findMessages(buf, top, s => get(s, 2)?.wt === 0 && get(s, 2).v === playId && get(s, 1)?.wt === 2);
console.log(`found ${plays.length} message(s) with playId ${playId}`);
for (const p of plays) {
  if (!padIdArg) { dump(buf, p.fields, "  "); continue; }
  const pads = p.fields.filter(f => f.field === 28).map(f => ({ f, s: parse(buf, f.at, f.at + f.len) })).filter(x => get(x.s, 1)?.v === BigInt(padIdArg));
  for (const x of pads) { console.log(`  #28 positionAssignId ${padIdArg} @${x.f.at}`); dump(buf, x.s, "    "); }
}
