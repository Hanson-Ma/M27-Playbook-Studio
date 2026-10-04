// Prints a PlaybookAsset dump as Formation > Set > plays (+ audibles, situations).
// usage: node tools/booktree.mjs <playbook.json>
import { readFileSync } from "node:fs";

const root = JSON.parse(readFileSync(process.argv[2], "utf8")).root;
const leaf = ref => ref?.$ext?.split("/").pop() ?? "?";
const sit = list => list.map(s => `${s.situation.replace(/^(Offense|Defense)_PlayCallSituation_/, "")}:${s.weight}`).join(" ");

console.log(`${root.Name}  (Id ${root.Id}, offense=${root.isOffense}, protobuf ${root.protobufString?.length ?? 0} chars)`);
for (const fs of root.Formations) {
  console.log(`\n${leaf(fs.Formation)}${fs.overrideName ? ` "${fs.overrideName}"` : ""}`);
  for (const ss of fs.Sets) {
    console.log(`  ${leaf(ss.Set)}${ss.overrideName ? ` "${ss.overrideName}"` : ""}   audibles: ${ss.audibles.map(a => leaf(a.play)).join(", ") || "-"}`);
    for (const p of ss.plays) {
      const s = sit([...p.OffenseSituations, ...p.DefenseSituations]);
      console.log(`    ${String(p.order).padStart(2)}. ${leaf(p.play)}${p.overrideName ? ` "${p.overrideName}"` : ""}${p.PlaybookTier !== "No_Tier" ? ` [${p.PlaybookTier}]` : ""}${s ? `   {${s}}` : ""}`);
    }
  }
}
