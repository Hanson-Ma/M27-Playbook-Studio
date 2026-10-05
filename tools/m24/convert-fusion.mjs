// Ports the Madden 24 FUSION playbook mod to Madden 27 specs for our builders.
//   in:  build/m24/fusion-m24.json (tools/m24/fusion-analyze.mjs), ../MAMA9/mama9.DB (set alignments), data/library/*
//   out: playbooks/fusion/sets.json (custom sets + their plays -> mod), playbooks/fusion/FUSION.json (playbook spec),
//        build/m24/fusion-report.md (what mapped to what, and every approximation)
// usage: node tools/m24/convert-fusion.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { readTdbBE } from "./tdbbe.mjs";
import { makeSetReader } from "./sets.mjs";

const L = f => JSON.parse(readFileSync("data/library/" + f, "utf8"));
const formations = L("formations.json"), sets = L("sets.json"), plays = L("plays.json"), A = L("assignments.json");
const enums = JSON.parse(readFileSync("research/index/enums.json", "utf8").replace(/^﻿/, ""));
const CUTS = L("enums.json").enums.ReceiverCutAngle;
const situationName = Object.fromEntries(Object.entries(enums.Offense_PlayCallSituation).map(([k, v]) => [v, k.replace("Offense_PlayCallSituation_", "")]));
const playTypeName = Object.fromEntries(Object.entries(enums.OffensePlayType).map(([k, v]) => [v, k]));
const F = JSON.parse(readFileSync("build/m24/fusion-m24.json", "utf8"));
const modAlign = makeSetReader(readTdbBE(readFileSync("../MAMA9/mama9.DB")).byName);

const ROOT = "football/Gameplay/playbooks/PlayLibrary/";
const AROOT = ROOT + "Assignments/";
const report = [];
const log = s => report.push(s);
const clean = s => s.replace(/\*/g, "").replace(/\s+/g, " ").trim();
const leafOf = s => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
const r2 = v => Math.round(v * 100) / 100;

// ---------- M27 lookups ----------
const playsBySet = new Map();
for (const p of plays) { if (!playsBySet.has(p.set)) playsBySet.set(p.set, []); playsBySet.get(p.set).push(p); }
const formByAsset = new Map(formations.map(f => [f.asset, f]));
const offenseForm = name => formations.find(f => f.type === "FormationType_Offense" && f.name === name && f.asset.split("/").at(-1).replace(/_/g, " ").toLowerCase() === name.toLowerCase())
  ?? formations.find(f => f.type === "FormationType_Offense" && f.name === name);
// FUSION formation -> M27 formation that holds its custom sets (null = take the template's special teams).
const FORM_MAP = { "I Form": "I Form", "Goal Line": "Goal Line Offense", "Singleback": "Singleback", "Pistol": "Pistol", "Gun": "Shotgun", "Hail Mary": "Hail Mary" };
const TEMPLATE_FORMS = ["Special", "Kickoff", "Safety Kickoff"];
// Formations whose sets are real game sets (not minigames/drills), usable as bases.
const BASE_FORMS = new Set(["Shotgun", "Singleback", "Pistol", "I Form", "Strong I", "Weak I", "Goal Line Offense", "Full House", "Split Backs", "Hail Mary", "Power I", "Far", "Near", "Maryland I", "Wishbone", "Flexbone"]);
const baseSets = sets.filter(s => { const f = formByAsset.get(s.formation); return f && f.type === "FormationType_Offense" && BASE_FORMS.has(f.name) && f.asset.includes("/Offense/") && s.movements.Normal?.length === 11; });

const typeOf27 = pos => /HB|3DRB|PWHB|FB/.test(pos) ? "B" : /SLWR|_WR/.test(pos) ? "W" : /LASTKEYOFFENSE|_TE/.test(pos) ? "E" : "?";
const typeOf24 = epos => ({ 1: "B", 2: "B", 25: "B", 26: "B", 3: "W", 27: "W", 4: "E" })[epos] ?? "?";
const qbClass = (qb, backs) => qb.y > -2.5 ? "UC" : (qb.y > -5.5 && backs.some(b => Math.abs(b.x) < 0.5 && b.y < qb.y)) ? "PISTOL" : "GUN";
const spotClass = p => p.y > -1.75 ? "LINE" : p.y > -3.5 ? "OFF" : "BACK";

const HANDOFF_STEPS = new Set(["CannedHandoff", "ReceiveHandoff", "HandOffTurn", "HandOffGive", "HandoffFake", "OptionHandoff", "PitchBall", "RecievePitch", "OptionRun", "OptionFollow", "RecUserHandoff"]);
const stepsOf = asset => A[asset]?.steps ?? [];
const hasHandoff = asset => stepsOf(asset).some(s => HANDOFF_STEPS.has(s.type));
const RUN_TYPES = new Set([11, 12, 13, 14, 15, 16, 17, 18, 19, 41, 151, 152, 153, 162, 163, 164, 165, 166, 167, 169, 170, 171, 172, 195, 196, 197, 198, 200, 201, 202, 203, 209]);
const PASS_TYPES = new Set([3, 100, 101, 102, 103, 159, 7]);
const ptVal = p => enums.OffensePlayType[p.offensePlayType] ?? -1;

// ---------- set matching ----------
function permutations(n) { const out = []; const rec = (a, used) => { if (a.length === n) return out.push(a.slice()); for (let i = 0; i < n; i++) if (!used[i]) { used[i] = 1; a.push(i); rec(a, used); a.pop(); used[i] = 0; } }; rec([], []); return out; }
const PERMS = permutations(5);

// Best mapping of M24 skill poso 1..5 onto an M27 set's slots 1..5 (same player type, closest spots).
function matchSlots(m24, set27) {
  const n = set27.movements.Normal;
  let best = null;
  for (const perm of PERMS) {
    let cost = 0, mism = 0;
    for (let i = 0; i < 5; i++) {
      const a = m24[i + 1], b = n[perm[i] + 1];
      const ta = typeOf24(a.epos), tb = typeOf27(b.pos);
      if (ta !== tb) { mism++; cost += ta === "B" || tb === "B" ? 40 : 15; }
      cost += Math.hypot(a.x - b.x, a.y - b.y);
    }
    // the M24 HB (poso 1) should stay the M27 ball carrier slot 1 when it's a back
    if (typeOf24(m24[1].epos) === "B" && perm[0] !== 0) cost += 6;
    if (!best || cost < best.cost) best = { perm, cost, mism };
  }
  return best;
}

function chooseBase(m24, targetForm) {
  const backs24 = m24.slice(1, 6).filter(p => typeOf24(p.epos) === "B");
  const cls = qbClass(m24[0], backs24);
  const ranked = [];
  for (const s of baseSets) {
    const n = s.movements.Normal;
    if (qbClass(n[0], n.slice(1, 6).filter(p => typeOf27(p.pos) === "B")) !== cls) continue;
    const nPlays = (playsBySet.get(s.asset) ?? []).length;
    if (nPlays < 3) continue;
    const m = matchSlots(m24, s);
    const form = formByAsset.get(s.formation).name;
    const score = m.cost + (form === targetForm ? 0 : 3) - Math.min(nPlays, 60) / 20;
    ranked.push({ set: s, ...m, score, form, nPlays });
  }
  ranked.sort((a, b) => a.score - b.score);
  return { cls, best: ranked[0], ranked };
}

// ---------- M24 step decoding ----------
const deg = v => ((r2(v * 2.8125) % 360) + 360) % 360;
const yds = v => r2(v / 8);
const spd = v => Math.max(10, Math.min(100, Math.round((v > 0 ? v : 254) / 254 * 100)));
const OPTION_ROUTES = { 0: "CurlLeft", 1: "CurlRight", 2: "PostRight", 3: "CornerLt", 5: "SlantRt", 6: "FadeStreakLt", 7: "SlantLt", 8: "FadeStreakRt", 9: "InOutRight", 10: "InOutLeft", 11: "FadeStreakLt", 12: "HitchLeft", 13: "HitchRight", 17: "DragRt", 18: "DragLt", 19: "HitchRight", 20: "HitchLeft" };
const MECH = new Set([58, 26, 13, 48, 11, 32, 12, 38, 39, 40, 5, 1, 43, 42]); // handoff/fake/option mechanics (M24)
const isRoute = steps => steps.some(s => s.code === 8 || s.code === 36 || s.code === 9);
const hasMotion = steps => steps.some(s => s.code === 45);

// Converts an M24 receiver chain (from index `from`) to M27 steps. `start` = the player's alignment (for motion waypoints).
function convertSteps(steps, start, warn, { runPlay = false } = {}) {
  const out = [];
  let pos = { ...start }, motion = null;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    switch (s.code) {
      case 45: { // motion waypoint, relative to the previous spot, 1/8 yd
        pos = { x: r2(pos.x + s.val1 / 8), y: r2(pos.y + s.val2 / 8) };
        if (!motion) { motion = { type: "AutoMotion", waypoints: [], startEvent: "AUTOMOTIONSTARTEVENT_SNAP", startDelay: 0, endDelay: 0, automotionOrderTransitID: 1, automotionOrderPlayer: 0, stanceAtTarget: "StanceType_None", useLegacyLocoPathing: false, shouldStopAtTarget: false }; out.push(motion); }
        motion.waypoints.push({ x: pos.x, y: pos.y, speed: spd(s.val3), facingAngle: 0, locoStyle: "AUTOMOTIONLOCOSTYLE_NORMAL", shouldFaceEndPoint: true });
        break;
      }
      case 46: break; // end of motion block (goes at the snap)
      case 8: out.push({ type: runPlay ? "MoveDirection" : "RunRoute", distance: yds(s.val1), direction: deg(s.val2), speed: spd(s.val3) }); break;
      case 3: out.push({ type: "MoveDirection", distance: yds(s.val1), direction: deg(s.val2), speed: spd(s.val3) }); break;
      case 9: {
        const cut = CUTS[s.val2];
        if (!cut || cut.endsWith("INVALID")) { warn(`cut type ${s.val2} unknown, used 45`); }
        out.push({ type: "ReceiverCut", direction: s.val1 === 2 ? "RECEIVER_CUT_DIR_LEFT" : "RECEIVER_CUT_DIR_RIGHT", cutType: cut && !cut.endsWith("INVALID") ? cut : "RECEIVER_CUT_ANGLE_45" });
        break;
      }
      case 36: {
        const cov = steps[i + 1]?.code === 37 ? [steps[i + 1].val1, steps[i + 1].val2, steps[i + 1].val3] : [0, 0, 0];
        const options = [];
        [s.val1, s.val2, s.val3].forEach((code, k) => {
          if (code === 255 || code < 0) return;
          const route = OPTION_ROUTES[code];
          if (!route) { warn(`option route code ${code} has no M27 equivalent (dropped)`); return; }
          options.push({ route, coverage: cov[k] ? String(cov[k]) : "OptionRouteCoverage_Default" });
        });
        if (options.length) out.push({ type: "OptionRoute", options });
        break;
      }
      case 37: break;
      case 10: out.push({ type: "GetOpen" }); break;
      case 25: if (s.val1 > 0) out.push({ type: "Delay", time: r2(s.val1 / 32) }); break;
      case 14: out.push({ type: "PassBlock", time: r2(s.val1 / 32), flags: "PassBlockFlags_None" }); break;
      case 15: out.push(runPlay ? { type: "RunBlock", stalkDistance: 0, slamDuration: 0, time: 0, flags: "RunBlockFlags_None", receiverBlockType: "RECEIVERBLOCKTYPE_STALK" } : { type: "PassBlock", time: 0, flags: "PassBlockFlags_ProtectReceiver" }); break;
      case 18: out.push({ type: "RunBlock", stalkDistance: 0, slamDuration: 0, time: 0, flags: "RunBlockFlags_None", receiverBlockType: "RECEIVERBLOCKTYPE_NORMAL" }); break;
      case 255: i = steps.length; break;
      case 26: case 48: case 35: break; // opening anim / pre-snap shift / look: M27 picks its own
      default: warn(`step code ${s.code} skipped`);
    }
  }
  // A chain that ends mid-route keeps running; finish routes with GetOpen like stock M27 routes.
  const last = out.at(-1);
  if (last && /RunRoute|ReceiverCut|Delay|OptionRoute/.test(last.type) && !out.some(s => s.type === "GetOpen")) out.push({ type: "GetOpen" });
  // Blocking after a release must be the last action.
  return out;
}

// Route category for the play-art/AI (approximate, from the final leg).
function routeType(steps, startX) {
  if (steps.some(s => s.type === "OptionRoute")) return "AssignRouteType_RR_Option_Route";
  const legs = steps.filter(s => s.type === "RunRoute" || s.type === "MoveDirection");
  if (!legs.length) return steps.some(s => s.type === "RunBlock") ? "AssignRouteType_Block_Run" : "AssignRouteType_Block_Pass";
  if (steps.some(s => s.type === "PassBlock") && steps.findIndex(s => s.type === "PassBlock") < steps.findIndex(s => s.type === "RunRoute")) return "AssignRouteType_RR_Block_and_Release";
  let x = 0, y = 0;
  for (const l of legs) { x += l.distance * Math.cos(l.direction * Math.PI / 180); y += l.distance * Math.sin(l.direction * Math.PI / 180); }
  const d = legs.at(-1).direction;
  const inward = startX <= 0 ? Math.cos(d * Math.PI / 180) > 0 : Math.cos(d * Math.PI / 180) < 0;
  const right = Math.cos(d * Math.PI / 180) > 0;
  const curl = steps.some(s => s.type === "ReceiverCut" && /CURL|HITCH|COMEBACK/.test(s.cutType));
  const up = Math.sin(d * Math.PI / 180);
  if (curl) return y > 8 ? "AssignRouteType_RR_Curl_Medium" : "AssignRouteType_RR_Hitch";
  if (up < -0.3) return "AssignRouteType_RR_Comeback";
  if (up > 0.94) return y > 10 ? "AssignRouteType_RR_Streak" : "AssignRouteType_RR_Hitch";
  if (Math.abs(up) < 0.42) {
    if (inward) return y < 4 ? "AssignRouteType_RR_Drag" : y < 12 ? "AssignRouteType_RR_In_Middle" : "AssignRouteType_RR_In_Deep";
    return y < 4 ? (right ? "AssignRouteType_RR_Flat_Rt" : "AssignRouteType_RR_Flat_Lt") : y < 12 ? "AssignRouteType_RR_Out_Middle" : "AssignRouteType_RR_Out_Deep";
  }
  if (inward) return y < 7 ? "AssignRouteType_RR_Slant" : "AssignRouteType_RR_Post_Deep";
  return y < 7 ? (right ? "AssignRouteType_RR_Wheel_Rt" : "AssignRouteType_RR_Wheel_Lt") : "AssignRouteType_RR_Corner_Deep";
}

const assignName = obj => "FUSION/R_" + createHash("sha1").update(JSON.stringify(obj)).digest("hex").slice(0, 10);
function newAssignment(steps, startX, extra = {}) {
  const body = { routeType: routeType(steps, startX), ...extra, steps };
  return { new: assignName(body), ...body };
}

// ---------- play classification (by the M24 QB/HB mechanics, since edited plays kept their old play type) ----------
function kindOf(p) {
  const qb = p.players.find(x => x.poso === 0)?.steps.map(s => s.code) ?? [];
  const hb = p.players.find(x => x.poso === 1)?.steps.map(s => s.code) ?? [];
  const name = clean(p.modName);
  if ([16, 28, 29, 30, 31].includes(qb[0])) return "special";
  if (qb[0] === 7) return p.plyt === 5 && /screen/i.test(name) ? "screen" : "pass";
  if (!qb.includes(7)) {
    if (/jet touch/i.test(name)) return "touch";
    if (/option|read/i.test(name) || qb.includes(42)) return "option";
    return "run";
  }
  // QB fakes/reads then throws: RPO when the back keeps running with the ball, PA otherwise.
  const hbRunsBall = hb.includes(1) && !hb.includes(8);
  if (/jet touch/i.test(name)) return "touch";
  if (hbRunsBall || /RPO/.test(name)) return "rpo";
  return "pa";
}

// ---------- run/option equivalents ----------
const RUN_SYNONYMS = [
  [/tush push|qb sneak/i, ["QB Sneak"]],
  [/fb dive/i, ["FB Dive"]],
  [/jet sweep/i, ["Jet Sweep", "Jet Sweep Wk", "HB Sweep"]],
  [/jet dive/i, ["Jet Dive", "Zone Fake Jet", "Jet Zone", "HB Dive", "Inside Zone"]],
  [/jet counter/i, ["Jet Counter", "Counter", "HB Counter"]],
  [/jet touch/i, ["Jet Touch Pass", "Jet Sweep"]],
  [/zone split wk/i, ["Inside Zone Split", "Zone Split Wk", "Zone Split"]],
  [/zone split/i, ["Inside Zone Split", "Zone Split", "HB Zone Split", "Inside Zone"]],
  [/zone wk/i, ["HB Zone Wk", "Inside Zone Wk", "Zone Wk", "Inside Zone"]],
  [/inside zone/i, ["Inside Zone", "HB Zone"]],
  [/switch zone/i, ["Inside Zone", "Outside Zone"]],
  [/stretch/i, ["HB Stretch", "Outside Zone", "Stretch", "HB Zone Toss", "Wide Zone"]],
  [/toss/i, ["HB Toss", "Toss", "HB Zone Toss", "Strong Toss", "HB Stretch"]],
  [/split/i, ["HB Split O", "Split O", "Power O", "HB Power O"]],
  [/power/i, ["Power O", "HB Power O", "HB Power", "Power", "Duo"]],
  [/trap/i, ["0 1 Trap", "HB Trap", "Trap"]],
  [/counter/i, ["HB Counter", "Counter", "HB Counter Wk", "Counter Y", "HB Counter Str"]],
  [/wham/i, ["HB Wham", "Wham"]],
  [/iso/i, ["HB Iso", "Iso", "HB Lead Dive"]],
  [/dive/i, ["HB Dive", "Dive", "HB Slam", "HB Lead Dive"]],
  [/lead read option|read option lead/i, ["Lead Read Option", "Y Lead Read Option", "F Lead Read Option", "Read Option"]],
  [/power option/i, ["Power Option"]],
  [/speed option/i, ["Speed Option"]],
  [/triple option/i, ["Triple Option"]],
  [/read option/i, ["Read Option", "Zone Read"]],
];
const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Sets whose plays can be cloned into `custom` as-is: same QB class, same player type per slot, backs within 1.5 yd.
function compatibleSets(baseInfo) {
  const n = baseInfo.set.movements.Normal;
  return baseSets.filter(s => {
    const m = s.movements.Normal;
    for (let j = 0; j < 6; j++) {
      if (j > 0 && typeOf27(m[j].pos) !== typeOf27(n[j].pos)) return false;
      if ((j === 0 || typeOf27(n[j].pos) === "B") && Math.hypot(m[j].x - n[j].x, m[j].y - n[j].y) > 1.5) return false;
    }
    return true;
  });
}

// Wider pool for runs: same QB class and ball carrier spot; receivers may differ (they only block).
function looseSets(baseInfo) {
  const n = baseInfo.set.movements.Normal;
  return baseSets.filter(s => {
    const m = s.movements.Normal;
    return Math.hypot(m[0].x - n[0].x, m[0].y - n[0].y) < 1 && typeOf27(m[1].pos) === "B" && typeOf27(n[1].pos) === "B" && Math.hypot(m[1].x - n[1].x, m[1].y - n[1].y) < 1.5;
  });
}

function findRunEquivalent(p, baseInfo, compat, custom) {
  const name = clean(p.modName), stock = clean(p.stockName ?? "");
  let terms = [];
  for (const [re, t] of RUN_SYNONYMS) if (re.test(name)) { terms = t; break; }
  if (!terms.length) for (const [re, t] of RUN_SYNONYMS) if (re.test(stock)) { terms = t; break; }
  const wanted = [...new Set([name, ...terms, stock].map(norm))];
  const tiers = [[baseInfo.set], compat.filter(s => s !== baseInfo.set), looseSets(baseInfo).filter(s => !compat.includes(s))];
  const isRunLike = q => RUN_TYPES.has(ptVal(q)) || ptVal(q) === 208;
  // every non-QB player with ball/handoff mechanics in the source play must be the same kind of player, same side, in our set
  const fits = q => {
    const src = sets.find(x => x.asset === q.set).movements.Normal;
    for (let j = 1; j <= 5; j++) {
      if (!hasHandoff(q.assignments[j]) && !(j > 1 && stepsOf(q.assignments[j]).some(x => x.type === "AutoMotion"))) continue;
      if (typeOf27(src[j].pos) !== typeOf27(custom[j].pos)) return false;
      if (Math.sign(Math.round(src[j].x)) !== Math.sign(Math.round(custom[j].x)) || spotClass(src[j]) !== spotClass(custom[j])) return false;
      if (j === 1 && Math.hypot(src[j].x - custom[j].x, src[j].y - custom[j].y) > 1.5) return false;
    }
    return true;
  };
  const search = test => { for (const w of wanted) for (const tier of tiers) for (const set of tier) { const q = (playsBySet.get(set.asset) ?? []).find(q => isRunLike(q) && test(q, w) && fits(q)); if (q) return q; } };
  let q = search((q, w) => norm(q.name) === w);
  if (q) return { play: q, how: `name "${q.name}"` };
  q = search((q, w) => norm(q.name).includes(w));
  if (q) return { play: q, how: `name ~"${q.name}"` };
  for (const tier of tiers) for (const set of tier) { q = (playsBySet.get(set.asset) ?? []).find(q => ptVal(q) === p.plyt && fits(q)); if (q) return { play: q, how: `type ${q.offensePlayType} "${q.name}"` }; }
  q = (playsBySet.get(baseInfo.set.asset) ?? []).find(q => RUN_TYPES.has(ptVal(q)) && fits(q));
  return q ? { play: q, how: `fallback run "${q.name}"` } : null;
}

// ---------- pass base selection ----------
const TRICK = new Set([1, 2, 157, 158, 161, 208, 212, 213, 214, 215, 104, 105, 106, 107, 38]);
function skillHandoff(q) { return q.assignments.slice(2, 6).some(hasHandoff); }
function choosePassBase(p, kind, baseInfo, custom, compat) {
  const name = clean(p.modName);
  const hbWide = spotClass(custom[1]) !== "BACK" || Math.abs(custom[1].x) > 4;
  const isPA = q => ptVal(q) === 4 || ptVal(q) === 6 || /^PA |PA/.test(q.name) && hasHandoff(q.assignments[1]);
  const isRPO = q => [204, 205, 206, 207].includes(ptVal(q));
  const isScreen = q => ptVal(q) === 5 || /screen/i.test(q.name);
  const prefer = (list, ...tests) => { for (const t of tests) { const f = list.filter(t); if (f.length) return f; } return list; };
  // the base set first, then stock sets with the same slot types and backfield (their plays fit slot for slot)
  const pools = [baseInfo.set, ...compat.filter(x => x !== baseInfo.set)].map(x => ({ set: x, plays: (playsBySet.get(x.asset) ?? []).filter(q => !TRICK.has(ptVal(q)) && !skillHandoff(q) && !RUN_TYPES.has(ptVal(q))) }));
  const want = q => kind === "screen" ? isScreen(q) : kind === "rpo" ? isRPO(q) : kind === "pa" ? isPA(q) : false;
  const order = kind === "screen" ? [q => /slip/i.test(q.name), q => /HB/.test(q.name)]
    : kind === "rpo" ? [q => (/bubble|flat|smoke|alert|screen|stick|corndog/i.test(name) ? ptVal(q) === 207 : ptVal(q) !== 207)]
    : [q => /boot/i.test(name) === /boot/i.test(q.name)];
  const byMotion = list => list.sort((a, b) => a.assignments.slice(1, 6).filter(x => stepsOf(x).some(s => s.type === "AutoMotion")).length - b.assignments.slice(1, 6).filter(x => stepsOf(x).some(s => s.type === "AutoMotion")).length);
  if (kind !== "pass" && !(kind === "pa" && hbWide))
    for (const pool of pools) { const c = pool.plays.filter(want); if (c.length) { const q = byMotion(prefer(c, ...order))[0]; if (pool.set !== baseInfo.set) log(`    - ${name}: ${kind.toUpperCase()} base taken from ${formByAsset.get(pool.set.formation).name} / ${pool.set.name}`); return q; } }
  // plain dropback; for a split-out back avoid anything that hands off or fakes to slot 1
  for (const strict of [true, false]) for (const pool of pools) {
    let d = pool.plays.filter(q => !isRPO(q) && !isScreen(q) && !hasHandoff(q.assignments[1]) && (!strict || !isPA(q) && !/rollout|boot|sprint/i.test(q.name)));
    if (!d.length && !hbWide && !strict) d = pool.plays.filter(q => !isScreen(q));
    if (!d.length) continue;
    if (kind !== "pass") log(`    - ${name}: no ${kind.toUpperCase()} base fits${hbWide ? " (back is split out)" : ""}; used dropback "${d[0].name}"`);
    return byMotion(prefer(d, q => ptVal(q) === p.plyt, q => PASS_TYPES.has(ptVal(q))))[0];
  }
  return null;
}

// ---------- main ----------
const setsSpec = { notes: "FUSION (Madden 24 mod) ported to Madden 27 by tools/m24/convert-fusion.mjs. Regenerate rather than hand-edit.", formations: [], sets: [] };
const book = { name: "FUSION", side: "offense", notes: "FUSION offense, ported from the Madden 24 mod (hansonma.org/projects/fusion).", formations: [] };
const stats = { sets: 0, plays: 0, converted: 0, runs: 0, assignments: new Set(), warnings: 0 };

log(`# FUSION → Madden 27 port report\n\nGenerated by \`tools/m24/convert-fusion.mjs\`. Each FUSION set becomes a custom M27 set cloned from the closest stock set and re-aligned to the M24 mod alignment. Pass plays get their routes rebuilt from the M24 route steps; runs and options use the closest M27 play.\n`);

for (const f of F) {
  const target = FORM_MAP[f.formation];
  if (!target) continue; // special teams / kickoff: template below
  const form27 = offenseForm(target);
  const fspec = { formation: target, sets: [] };
  log(`\n## ${f.formation} → ${target}\n`);
  for (const s of f.sets) {
    const setName = clean(s.modName);
    if (/^ignore$/i.test(setName)) { log(`- skipped set "${s.modName}" (marked IGNORE)`); continue; }
    const m24 = modAlign(s.setl);
    const { cls, best } = chooseBase(m24, target);
    if (!best) { log(`- **${setName}: no M27 base set found (QB ${cls})**`); continue; }
    const baseSet = best.set, n = baseSet.movements.Normal;
    // slot map: M24 poso -> M27 slot
    const slotOf = { 0: 0 }; best.perm.forEach((j, i) => slotOf[i + 1] = j + 1);
    for (let k = 6; k <= 10; k++) slotOf[k] = k;
    // custom alignment (M27 slot order)
    const custom = n.map(p => ({ ...p }));
    const positions = [];
    for (let i = 1; i <= 5; i++) {
      const j = slotOf[i], src = m24[i], b = n[j];
      const moved = Math.hypot(src.x - b.x, src.y - b.y) > 0.05;
      const pos = { slot: j, x: src.x, y: src.y, flipAssign: j };
      if (moved && spotClass(src) !== spotClass(b)) pos.stance = typeOf27(b.pos) === "E" && spotClass(src) === "LINE" && Math.abs(src.x) < 7.5 ? "StanceType_3pt" : "StanceType_2pt";
      custom[j] = { ...b, x: src.x, y: src.y };
      positions.push(pos);
    }
    const onLine = custom.filter((p, j) => j > 0 && p.y > -1.75).length;
    const setLeaf = "FUS_" + leafOf(setName);
    const sspec = { name: setName, asset: setLeaf, base: baseSet.asset, formation: form27.asset, positions, plays: [] };
    log(`### ${setName}  (M24 "${s.stockForm} / ${s.stockName}" mod)\n- base: **${formByAsset.get(baseSet.formation).name} / ${baseSet.name}** (${baseSet.asset.split("/").slice(-3, -1).join("/")}), fit ${r2(best.cost)} yd${best.mism ? `, ${best.mism} position-type mismatch(es)` : ""}${onLine !== 7 ? `, **${onLine} on the line**` : ""}`);
    log(`- slots: ` + [1, 2, 3, 4, 5].map(i => `M24 ${i}→${slotOf[i]} ${n[slotOf[i]].pos.replace("POSITION_", "")} (${m24[i].x},${m24[i].y})`).join(", "));
    const compat = compatibleSets(best);
    const bookSet = { set: setName, plays: [] };
    const usedNames = new Set(), usedLeaves = new Set();

    for (const p of s.plays) {
      const kind = kindOf(p);
      let name = clean(p.modName);
      if (kind === "special") { log(`    - ${name}: special-teams play in an offense set, skipped`); continue; }
      for (let k = 2; usedNames.has(norm(name)); k++) name = clean(p.modName) + " " + k;
      usedNames.add(norm(name));
      let leaf = "FUS_" + leafOf(name); for (let k = 2; usedLeaves.has(leaf); k++) leaf = "FUS_" + leafOf(name) + "_" + k; usedLeaves.add(leaf);
      const warn = msg => { stats.warnings++; log(`    - ${name}: ${msg}`); };
      const entry = { name, asset: leaf };
      const playerOf = poso => p.players.find(x => x.poso === poso);

      if (kind === "run" || kind === "option" || kind === "touch") {
        const eq = findRunEquivalent(p, best, compat, custom);
        if (!eq) { warn(`no M27 run equivalent, dropped`); continue; }
        entry.from = eq.play.asset;
        // keep the M24 pre-snap/at-snap motion fakes on receivers the M27 play leaves without motion
        const players = {};
        const srcSet = sets.find(x => x.asset === eq.play.set);
        for (let i = 2; i <= 5; i++) {
          const pl = playerOf(i); if (!pl || !hasMotion(pl.steps) || pl.steps.some(st => st.code === 58 || st.code === 13)) continue;
          const j = slotOf[i], cur = eq.play.assignments[j];
          if (stepsOf(cur).some(st => st.type === "AutoMotion") || hasHandoff(cur)) continue;
          const steps = convertSteps(pl.steps, { x: m24[i].x, y: m24[i].y }, warn, { runPlay: true });
          if (!steps.some(st => st.type === "RunBlock")) steps.push({ type: "RunBlock", stalkDistance: 0, slamDuration: 0, time: 0, flags: "RunBlockFlags_None", receiverBlockType: "RECEIVERBLOCKTYPE_STALK" });
          players[j] = newAssignment(steps, m24[i].x, { routeType: "AssignRouteType_Block_Run" });
          stats.assignments.add(players[j].new);
        }
        if (Object.keys(players).length) entry.players = players;
        stats.runs++;
        log(`    - ${name} [${kind}] ← M27 ${srcSet ? formByAsset.get(srcSet.formation).name + " / " + srcSet.name : "?"} / ${eq.how}${entry.players ? ` + M24 motion on slot ${Object.keys(players).join(",")}` : ""}`);
      } else {
        const base = choosePassBase(p, kind, best, custom, compat);
        if (!base) { warn(`no M27 pass base in ${baseSet.name}, dropped`); continue; }
        entry.from = base.asset;
        const players = {};
        for (let i = 1; i <= 5; i++) {
          const pl = playerOf(i); if (!pl) continue;
          const j = slotOf[i], baseA = base.assignments[j];
          const st = pl.steps;
          const lastMech = st.reduce((k, x, idx) => MECH.has(x.code) ? idx : k, -1);
          if (i === 1 && hasHandoff(baseA)) {
            // the back's fake/handoff stays M27's; append the M24 route that follows its own fake
            if (kind === "rpo" || kind === "screen") continue;
            const rest = st.slice(lastMech + 1);
            const keep = stepsOf(baseA).findLastIndex(x => HANDOFF_STEPS.has(x.type) || x.type === "AutoMotion") + 1;
            const steps = isRoute(rest) ? convertSteps(rest, { x: m24[i].x, y: m24[i].y }, warn) : [{ type: "PassBlock", time: 0, flags: "PassBlockFlags_None" }];
            players[j] = newAssignment(steps, m24[i].x, { keep, template: baseA.replace(AROOT, "") });
          } else if (hasHandoff(baseA) && kind !== "pass") {
            continue; // RPO/screen mechanics on this slot stay M27's
          } else if (isRoute(st) || hasMotion(st)) {
            const steps = convertSteps(st.slice(st[0]?.code === 58 ? lastMech + 1 : 0), { x: m24[i].x, y: m24[i].y }, warn);
            players[j] = newAssignment(steps, m24[i].x);
          } else {
            const blocks = st.some(x => x.code === 14 || x.code === 15);
            if (!blocks && st.length > 1 && !(i === 1 && kind === "rpo")) warn(`slot ${j}: M24 chain ${st.map(x => x.code).join(",")} not recognized, kept M27 base`);
            if (blocks && !/Block_Pass/.test(A[baseA]?.routeType ?? "")) players[j] = "Blocking/ALL_PassBlock";
            else continue;
          }
          if (typeof players[j] === "object") stats.assignments.add(players[j].new);
        }
        entry.players = players;
        // read progression + red route
        const R = p.reads;
        if (R) {
          const reads = [];
          for (let k = 1; k <= 5; k++) {
            const rcv = R[`rcv${k}`]; if (!rcv || !(rcv in slotOf) || rcv > 5) continue;
            reads.push({ pos: slotOf[rcv], pct: r2(R[`per${k}`] / 100), combo: R[`com${k}`] ?? 0, concept: "Concept_Invalid" });
          }
          const vip = p.vpos && slotOf[p.vpos] && p.vpos <= 5 ? slotOf[p.vpos] : null;
          if (vip) {
            entry.vip = vip;
            const v = reads.find(r => r.pos === vip);
            const top = Math.max(0, ...reads.filter(r => r.pos !== vip).map(r => r.pct));
            if (!v) reads.unshift({ pos: vip, pct: Math.min(1, r2(top + 0.05)) || 0.9, combo: 0, concept: "Concept_Invalid" });
            else if (v.pct <= top) { v.pct = Math.min(1, r2(top + 0.05)); if (v.pct <= top) reads.filter(r => r.pos !== vip && r.pct >= v.pct).forEach(r => r.pct = r2(v.pct - 0.05)); }
          }
          if (reads.length) entry.reads = reads;
        }
        stats.converted++;
        log(`    - ${name} [${kind}] base "${base.name}" (${base.offensePlayType.replace("OffensePlayType_", "")}), rebuilt slots ${Object.keys(players).join(",") || "none"}${entry.vip ? `, red route slot ${entry.vip}` : ""}`);
      }
      sspec.plays.push(entry);
      stats.plays++;
      const bp = { play: name };
      const bit = p.flag; const slot = { 2: 1, 4: 2, 16: 3, 8: 4 }[bit];
      if (slot) bp.audible = slot;
      const cpu = {};
      for (const a of p.ai) { const k = situationName[a.aigr]; if (k && k !== "Invalid") cpu[k] = Math.min(100, a.prct); }
      if (Object.keys(cpu).length) bp.cpu = cpu;
      bookSet.plays.push(bp);
    }
    // in-game audible slots must be unique per set
    const seen = new Set(); for (const bp of bookSet.plays) if (bp.audible) { if (seen.has(bp.audible)) { log(`    - ${bp.play}: duplicate audible slot ${bp.audible} dropped`); delete bp.audible; } else seen.add(bp.audible); }
    if (!sspec.plays.length) continue;
    setsSpec.sets.push(sspec);
    fspec.sets.push(bookSet);
    stats.sets++;
  }
  if (fspec.sets.length) book.formations.push(fspec);
}
for (const t of TEMPLATE_FORMS) book.formations.push({ formation: t, sets: "template" });
log(`\n## Special teams\nKickoff, punt, field goal, kneel and spike come from the stock Madden 27 template (Special, Kickoff, Safety Kickoff), not the M24 mod.\n`);
log(`\n## Totals\n- ${stats.sets} custom sets, ${stats.plays} plays (${stats.converted} pass plays rebuilt, ${stats.runs} runs/options mapped to M27 equivalents)\n- ${stats.assignments.size} new route assignments\n- ${stats.warnings} warnings (listed inline above)\n`);

mkdirSync("playbooks/fusion", { recursive: true });
writeFileSync("playbooks/fusion/sets.json", JSON.stringify(setsSpec, null, 1));
writeFileSync("playbooks/fusion/FUSION.json", JSON.stringify(book, null, 2));
writeFileSync("build/m24/fusion-report.md", report.join("\n") + "\n");
console.log(`${stats.sets} sets, ${stats.plays} plays (${stats.converted} rebuilt passes, ${stats.runs} runs), ${stats.assignments.size} new assignments, ${stats.warnings} warnings`);
