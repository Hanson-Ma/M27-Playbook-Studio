// Play-art preview of the FUSION port (approximates the game's art: alignment + route legs from the assignment steps).
// usage: node tools/m24/preview-fusion.mjs  -> build/fusion/preview.html
import { readFileSync, writeFileSync } from "node:fs";

const L = f => JSON.parse(readFileSync("data/library/" + f, "utf8"));
const sets = L("sets.json"), plays = L("plays.json"), A = L("assignments.json");
const spec = JSON.parse(readFileSync("playbooks/fusion/sets.json", "utf8"));
const book = JSON.parse(readFileSync("playbooks/fusion/FUSION.json", "utf8"));
const AROOT = "football/Gameplay/playbooks/PlayLibrary/Assignments/";
const playByAsset = new Map(plays.map(p => [p.asset, p]));
const setByAsset = new Map(sets.map(s => [s.asset, s]));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function stepsFor(entry, slot, src) {
  const a = entry.players?.[slot];
  if (a && typeof a === "object") {
    const kept = a.keep ? (A[AROOT + (a.template ?? "")]?.steps ?? A[src.assignments[slot]]?.steps ?? []).slice(0, a.keep) : [];
    return { steps: [...kept, ...a.steps], fresh: true };
  }
  if (typeof a === "string") return { steps: A[AROOT + a]?.steps ?? [], fresh: false };
  return { steps: A[src.assignments[slot]]?.steps ?? [], fresh: false };
}

// world (yards) -> svg: x in [-27,27], y in [-9,26]
const W = 216, H = 150, sx = x => (x + 27) * W / 54, sy = y => H - (y + 9) * H / 35;
function diagram(s, entry) {
  const src = playByAsset.get(entry.from);
  const n = setByAsset.get(s.base).movements.Normal.map(p => ({ ...p }));
  for (const p of s.positions) Object.assign(n[p.slot], { x: p.x, y: p.y });
  let g = `<line x1="0" y1="${sy(0)}" x2="${W}" y2="${sy(0)}" class="los"/>`;
  for (let j = 0; j < 11; j++) {
    const p = n[j];
    const { steps, fresh } = stepsFor(entry, j, src);
    let x = p.x, y = p.y, pts = [[x, y]], motion = [];
    let cls = "rt";
    for (const st of steps) {
      if (st.type === "AutoMotion") { for (const w of st.waypoints) { const q = w.position ?? w; motion.push([x, y, q.x, q.y]); x = q.x; y = q.y; } pts = [[x, y]]; }
      else if (["RunRoute", "MoveDirection", "ReceiveHandoff"].includes(st.type)) { x += st.distance * Math.cos(st.direction * Math.PI / 180); y += st.distance * Math.sin(st.direction * Math.PI / 180); pts.push([x, y]); }
      else if (st.type === "PassBlock" || st.type === "RunBlock" || st.type === "LeadBlock") cls = pts.length > 1 ? cls : "blk";
      else if (st.type === "OptionRoute") cls = "opt";
    }
    if (j >= 1 && j <= 5) {
      const red = entry.vip === j;
      for (const [a, b, c, d] of motion) g += `<line x1="${sx(a)}" y1="${sy(b)}" x2="${sx(c)}" y2="${sy(d)}" class="mo"/>`;
      if (pts.length > 1) g += `<polyline points="${pts.map(([a, b]) => `${sx(a).toFixed(1)},${sy(Math.min(b, 25)).toFixed(1)}`).join(" ")}" class="${red ? "vip" : cls}${fresh ? "" : " kept"}"/>`;
      else if (cls === "blk") g += `<line x1="${sx(x) - 3}" y1="${sy(y) - 4}" x2="${sx(x) + 3}" y2="${sy(y) - 4}" class="blk"/>`;
    }
    g += `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="${j === 0 ? 2.6 : 2.2}" class="${j >= 6 ? "ol" : j === 0 ? "qb" : "sk"}"/>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(entry.name)}">${g}</svg>`;
}

const audibles = new Map();
for (const f of book.formations) if (Array.isArray(f.sets)) for (const s of f.sets) for (const p of s.plays) if (p.audible) audibles.set(f.formation + "|" + s.set + "|" + p.play, p.audible);
const formOf = new Map(); for (const f of book.formations) if (Array.isArray(f.sets)) for (const s of f.sets) formOf.set(s.set + "|" + f.formation, f.formation);

let body = "";
for (const f of book.formations.filter(f => Array.isArray(f.sets))) {
  body += `<h2>${esc(f.formation)}</h2>`;
  for (const bs of f.sets) {
    const s = spec.sets.find(x => x.name === bs.set && x.formation.split("/").at(-1).replace(/_/g, " ") === f.formation);
    if (!s) continue;
    body += `<h3>${esc(s.name)} <small>base: ${esc(setByAsset.get(s.base).name)}</small></h3><div class="grid">`;
    for (const e of s.plays) {
      const src = playByAsset.get(e.from);
      const aud = audibles.get(f.formation + "|" + s.name + "|" + e.name);
      const isRun = src && /Run|Option|QBSneak|JetSweep|TouchPass/.test(src.offensePlayType) && !/RPO|OptionPass/.test(src.offensePlayType);
      const tag = !isRun && e.players && Object.values(e.players).some(v => typeof v === "object") ? "rebuilt" : "M27";
      body += `<figure>${diagram(s, e)}<figcaption><b>${esc(e.name)}</b>${aud ? ` <span class="aud">A${aud}</span>` : ""}<br><span class="src ${tag}">${tag === "rebuilt" ? "routes from M24" : "M27 play"}: ${esc(src?.name ?? "?")}</span></figcaption></figure>`;
    }
    body += `</div>`;
  }
}

writeFileSync("build/fusion/preview.html", `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FUSION Port Preview</title><style>
:root{--bg:#0f1512;--field:#14321f;--ink:#e8efe9;--muted:#9fb3a6;--route:#f2f2f2;--vip:#ff5a4f;--opt:#ffd34d;--mo:#7cc8ff;--blk:#c9a26b;--ol:#6f8a79}
body{margin:0;padding:16px;background:var(--bg);color:var(--ink);font:13px/1.35 system-ui,sans-serif}
h1{font-size:20px;margin:0 0 4px}h2{margin:28px 0 6px;font-size:18px;border-bottom:1px solid #2a3a30}h3{margin:14px 0 6px;font-size:14px}small{color:var(--muted);font-weight:400}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
figure{margin:0;background:var(--field);border-radius:6px;padding:4px}svg{width:100%;height:auto;display:block}
figcaption{padding:3px 4px 2px}.src{color:var(--muted);font-size:11px}.aud{background:#2e5d43;border-radius:3px;padding:0 4px;font-size:11px}
.los{stroke:#5d7f69;stroke-width:.6}.rt,.vip,.opt,.blk,.mo{fill:none;stroke-width:1.4;stroke-linejoin:round}.rt{stroke:var(--route)}.vip{stroke:var(--vip)}.opt{stroke:var(--opt)}.blk{stroke:var(--blk)}.mo{stroke:var(--mo);stroke-dasharray:2 2}.kept{opacity:.55}
.ol{fill:var(--ol)}.qb{fill:#fff}.sk{fill:#ffe9a8}.legend span{margin-right:12px}
</style></head><body><h1>FUSION → Madden 27 port preview</h1>
<p class="legend"><span style="color:var(--vip)">■ red route (VIP)</span><span style="color:var(--opt)">■ option route stem</span><span style="color:var(--mo)">■ motion</span><span style="color:var(--blk)">■ block</span><span style="opacity:.6">faded = M27 assignment kept</span></p>
${body}</body></html>`);
console.log("wrote build/fusion/preview.html");
