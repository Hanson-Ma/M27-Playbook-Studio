// Condenses a PlayDump JSON (dumped with --follow 2) into a readable play sheet:
// alignment per player + the assignment chain each player runs.
// usage: node tools/summarize.mjs <play.json> [more.json...]
import { readFileSync } from "node:fs";

const SKIP = new Set(["$type", "$id", "__Id", "__InstanceGuid", "opCodeEX", "Name"]);

function compact(v) {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "[" + v.map(compact).join(", ") + "]";
  if (typeof v === "object") {
    if (v.$ext) return "→" + v.$ext.split("/").pop();
    if ("x" in v && "y" in v) return `(${["x", "y", "z"].filter(k => k in v).map(k => +v[k].toFixed(2)).join(",")})`;
    return "{" + Object.entries(v).filter(([k]) => !SKIP.has(k)).map(([k, x]) => `${k}=${compact(x)}`).join(" ") + "}";
  }
  if (typeof v === "number") return String(+v.toFixed(3));
  return String(v);
}

function assignment(a) {
  const fields = Object.entries(a)
    .filter(([k, v]) => !SKIP.has(k) && v !== false && v !== -1 && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => `${k}=${compact(v)}`);
  return `${a.$type.replace(/Assignment$/, "")}(${fields.join(" ")})`;
}

for (const file of process.argv.slice(2)) {
  const root = JSON.parse(readFileSync(file, "utf8")).root;
  const set = root.Set?.$inline;
  console.log(`\n=== ${root.playName}  [${root.offensePlayType ?? ""} ${root.defensePlayType ?? ""}]  playId=${root.playId}`);
  console.log(`set: ${set?.setName} (setId ${set?.setId}, ${set?.Classification}, ${set?.setType})  formation: ${set?.form?.$ext?.split("/").pop()}`);
  console.log(`blocking: ${root.BlockingSchemeDefine?.$ext?.split("/").pop() ?? "-"}  runHole=${root.runHole}  VIP=${root.VIPPosition}`);
  for (const p of root.passData ?? []) console.log(`pass read: combo=${p.combo} pos=${p.position} ${p.concept} ${p.percentage}`);

  const normal = set?.preSnapMovements?.find(m => m.__Id === "Normal") ?? set?.preSnapMovements?.[0];
  const spots = normal?.PlayerPosition ?? [];
  console.log(`preSnapMovements: ${(set?.preSnapMovements ?? []).map(m => m.__Id).join(", ")}`);

  root.positionAssignmentDefines.forEach((ref, i) => {
    const def = ref.$inline;
    const s = spots[i];
    const where = s ? `${s.depthPosition.replace("POSITION_", "")}${s.depth} @(${s.XPos},${s.YPos}) f${s.facing} ${s.anim.replace("StanceType_", "")}` : "?";
    console.log(`\n [${i}] ${where}`);
    console.log(`     def: ${ref.$ext.replace(/^.*Assignments\//, "")}  (id ${def?.positionAssignId}, ${def?.routeType})`);
    (def?.positionAssignment ?? []).forEach((a, k) => console.log(`       ${k + 1}. ${assignment(a)}`));
  });
}
