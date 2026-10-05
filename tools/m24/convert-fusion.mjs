// Ports the Madden 24 FUSION playbook mod to Madden 27 specs for our builders.
//   in:  build/m24/fusion-m24.json (tools/m24/fusion-analyze.mjs), ../MAMA9/mama9.DB (set alignments + motion presets), data/library/*
//   out: playbooks/fusion/sets.json (custom sets + their plays -> mod), playbooks/fusion/FUSION.json (playbook spec),
//        build/m24/fusion-report.md (what mapped to what, every approximation, and a terminology audit)
// usage: node tools/m24/convert-fusion.mjs
//
// How plays are rebuilt:
//  - QB/HB mechanics (handoffs, fakes, boots, RPO reads, options) come from an M27 play with the SAME handoff animation
//    pair as the M24 play (M24 step 58 = M27 CannedHandoff handoffAnim/flippedHandoffAnim; the ids carried over),
//    cloned only from sets whose backfield matches exactly, so the mesh lines up and boots roll the same way.
//  - Receivers get their M24 routes, blocks and motions. Runs keep M27 receivers, plus M24 motions where M27 has none.
//  - Cloned assignments lose M27's OverrideFormPos shifts (our alignment stays put); M24 shifts (code 48: PM, Tush Push) are added.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { readTdbBE } from "./tdbbe.mjs";
import { makeSetReader } from "./sets.mjs";

const L = f => JSON.parse(readFileSync("data/library/" + f, "utf8"));
const formations = L("formations.json"), sets = L("sets.json"), plays = L("plays.json"), A = L("assignments.json");
const enums = JSON.parse(readFileSync("research/index/enums.json", "utf8").replace(/^﻿/, ""));
const CUTS = L("enums.json").enums.ReceiverCutAngle;
const F = JSON.parse(readFileSync("build/m24/fusion-m24.json", "utf8"));
const modDb = readTdbBE(readFileSync("../MAMA9/mama9.DB")).byName;
const modAlign = makeSetReader(modDb);
const presetNames = new Map();
for (const r of modDb.SGFF.rows) { if (!presetNames.has(r.SETL)) presetNames.set(r.SETL, []); presetNames.get(r.SETL).push(r.name); }

const AROOT = "football/Gameplay/playbooks/PlayLibrary/Assignments/";
const report = [], audit = [];
const log = s => report.push(s);
const clean = s => s.replace(/\*/g, "").replace(/\s+/g, " ").trim();
const leafOf = s => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
const r2 = v => Math.round(v * 100) / 100;
const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ---------- M27 lookups ----------
const playsBySet = new Map();
for (const p of plays) { if (!playsBySet.has(p.set)) playsBySet.set(p.set, []); playsBySet.get(p.set).push(p); }
const setByAsset = new Map(sets.map(s => [s.asset, s]));
const formByAsset = new Map(formations.map(f => [f.asset, f]));
const offenseForm = name => formations.find(f => f.type === "FormationType_Offense" && f.name === name && f.asset.split("/").at(-1).replace(/_/g, " ").toLowerCase() === name.toLowerCase())
  ?? formations.find(f => f.type === "FormationType_Offense" && f.name === name);
const FORM_MAP = { "I Form": "I Form", "Goal Line": "Goal Line Offense", "Singleback": "Singleback", "Pistol": "Pistol", "Gun": "Shotgun", "Hail Mary": "Hail Mary" };
// Home menu order (user's request): Singleback, I-Form, Pistol, Shotgun, Goal Line, Hail Mary, then special teams.
const MENU_ORDER = ["Singleback", "I Form", "Pistol", "Shotgun", "Goal Line Offense", "Hail Mary"];
const TEMPLATE_FORMS = ["Special", "Kickoff", "Safety Kickoff"];
const BASE_FORMS = new Set(["Shotgun", "Singleback", "Pistol", "I Form", "Strong I", "Weak I", "Goal Line Offense", "Full House", "Split Backs", "Hail Mary", "Power I", "Far", "Near", "Maryland I", "Wishbone", "Flexbone"]);
const baseSets = sets.filter(s => { const f = formByAsset.get(s.formation); return f && f.type === "FormationType_Offense" && BASE_FORMS.has(f.name) && f.asset.includes("/Offense/") && s.movements.Normal?.length === 11; });

const typeOf27 = pos => /HB|3DRB|PWHB|FB/.test(pos) ? "B" : /SLWR|_WR/.test(pos) ? "W" : /LASTKEYOFFENSE|_TE/.test(pos) ? "E" : "?";
const typeOf24 = epos => ({ 1: "B", 2: "B", 25: "B", 26: "B", 3: "W", 27: "W", 4: "E" })[epos] ?? "?";
const qbClass = (qb, backs) => qb.y > -2.5 ? "UC" : (qb.y > -5.5 && backs.some(b => Math.abs(b.x) < 0.5 && b.y < qb.y)) ? "PISTOL" : "GUN";
const spotClass = p => p.y > -1.75 ? "LINE" : p.y > -3.5 ? "OFF" : "BACK";

const HANDOFF_STEPS = new Set(["CannedHandoff", "ReceiveHandoff", "HandOffTurn", "HandOffGive", "HandoffFake", "OptionHandoff", "PitchBall", "RecievePitch", "OptionRun", "OptionFollow", "RecUserHandoff"]);
const stepsOf = asset => A[asset]?.steps ?? [];
const hasHandoff = asset => stepsOf(asset).some(s => HANDOFF_STEPS.has(s.type));
const hasMotion27 = asset => stepsOf(asset).some(s => s.type === "AutoMotion");
const hasOFP = asset => stepsOf(asset).some(s => s.type === "OverrideFormPos");
const RUN_TYPES = new Set([11, 12, 13, 14, 15, 16, 17, 18, 19, 41, 151, 152, 153, 162, 163, 164, 165, 166, 167, 169, 170, 171, 172, 195, 196, 197, 198, 200, 201, 202, 203, 209]);
const RPO_TYPES = new Set([204, 205, 206, 207]);
const PASS_TYPES = new Set([3, 100, 101, 102, 103, 159, 7]);
const TRICK = new Set([1, 2, 157, 158, 161, 208, 212, 213, 214, 215, 104, 105, 106, 107, 38]);
const ptVal = p => enums.OffensePlayType[p.offensePlayType] ?? -1;
const qbAnim27 = p => { const s = stepsOf(p.assignments[0]).find(s => s.type === "CannedHandoff"); return s ? `${s.handoffAnim}/${s.flippedHandoffAnim}` : null; };
const isRollout27 = p => stepsOf(p.assignments[0]).some(s => (s.type === "HandoffFake" && /ROLL/.test(s.handoffExit)) || (s.type === "QBScramble" && /NONE/.test(s.dropBackType) && s.distance >= 2));
const hasPull27 = p => p.assignments.slice(6, 11).some(a => stepsOf(a).some(s => s.type === "InitialAnim" && /PULL/.test(s.anim) && !/SCREEN/.test(s.anim)));
const passBlockers27 = p => p.assignments.slice(1, 6).filter(a => /Block_Pass/.test(A[a]?.routeType ?? "") || (stepsOf(a).some(s => s.type === "PassBlock") && !stepsOf(a).some(s => s.type === "RunRoute"))).length;

// ---------- set matching ----------
function permutations(n) { const out = []; const rec = (a, used) => { if (a.length === n) return out.push(a.slice()); for (let i = 0; i < n; i++) if (!used[i]) { used[i] = 1; a.push(i); rec(a, used); a.pop(); used[i] = 0; } }; rec([], []); return out; }
const PERMS = permutations(5);
function matchSlots(m24, set27) {
  const n = set27.movements.Normal;
  let best = null;
  for (const perm of PERMS) {
    let cost = 0, mism = 0;
    for (let i = 0; i < 5; i++) {
      const a = m24[i + 1], b = n[perm[i] + 1];
      const ta = typeOf24(a.epos), tb = typeOf27(b.pos);
      if (ta !== tb) { mism++; cost += ta === "B" || tb === "B" ? 40 : 15; }
      cost += dist(a, b);
    }
    if (typeOf24(m24[1].epos) === "B" && perm[0] !== 0) cost += 6;
    if (!best || cost < best.cost) best = { perm, cost, mism };
  }
  return best;
}
function chooseBase(m24, targetForm) {
  const cls = qbClass(m24[0], m24.slice(1, 6).filter(p => typeOf24(p.epos) === "B"));
  const ranked = [];
  for (const s of baseSets) {
    const n = s.movements.Normal;
    if (qbClass(n[0], n.slice(1, 6).filter(p => typeOf27(p.pos) === "B")) !== cls) continue;
    const nPlays = (playsBySet.get(s.asset) ?? []).length;
    if (nPlays < 3) continue;
    const m = matchSlots(m24, s);
    const form = formByAsset.get(s.formation).name;
    // the QB spot must match (snap/handoff animations depend on it), so it weighs heavily
    const score = m.cost + 8 * dist(n[0], m24[0]) + (form === targetForm ? 0 : 3) - Math.min(nPlays, 60) / 20;
    ranked.push({ set: s, ...m, score, form, nPlays });
  }
  ranked.sort((a, b) => a.score - b.score);
  return { cls, best: ranked[0] };
}

// ---------- M24 step decoding ----------
const deg = v => ((r2(v * 2.8125) % 360) + 360) % 360;
const yds = v => r2(v / 8);
const spd = v => Math.max(10, Math.min(100, Math.round((v > 0 ? v : 254) / 254 * 100)));
const quarter = v => r2(v / 4); // motion/shift spots: absolute field position in 1/4 yd
const OPTION_ROUTES = { 0: "CurlLeft", 1: "CurlRight", 2: "PostRight", 3: "CornerLt", 5: "SlantRt", 6: "FadeStreakLt", 7: "SlantLt", 8: "FadeStreakRt", 9: "InOutRight", 10: "InOutLeft", 11: "FadeStreakLt", 12: "HitchLeft", 13: "HitchRight", 17: "DragRt", 18: "DragLt", 19: "HitchRight", 20: "HitchLeft" };
const MECH = new Set([58, 26, 13, 11, 32, 12, 38, 39, 40, 5, 1, 43, 42]); // handoff/fake/option mechanics (M24)
const isRoute = steps => steps.some(s => s.code === 8 || s.code === 36 || s.code === 9);
const hasMotion = steps => steps.some(s => s.code === 45);
const shiftOf = steps => { const s = steps.find(x => x.code === 48); return s ? { x: quarter(s.val1), y: quarter(s.val2) } : null; };
const ofpStance = (type, spot) => type === "W" ? "Receiver" : type === "B" && spot.y < -3.5 ? "HB" : spot.y > -1.75 ? "ThreePoint" : "TwoPoint";
const RUNBLOCK = { type: "RunBlock", stalkDistance: 0, slamDuration: 0, time: 0, flags: "RunBlockFlags_None", receiverBlockType: "RECEIVERBLOCKTYPE_STALK" };

// M24 chain -> M27 steps. 45 = motion to an absolute spot (1/4 yd) starting at the snap; 46 ends the motion;
// a waypoint past the line (y > -1) is the post-snap path, so it becomes MoveDirection legs.
function convertSteps(steps, start, type, warn, { runPlay = false } = {}) {
  const out = [];
  let pos = { ...start }, motion = null, motionDone = false;
  const shift = shiftOf(steps);
  if (shift) { out.push({ type: "OverrideFormPos", stance: ofpStance(type, shift), offsetX: shift.x, offsetY: shift.y }); pos = { ...shift }; }
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    switch (s.code) {
      case 45: {
        const to = { x: quarter(s.val1), y: quarter(s.val2) };
        if (!motionDone && to.y <= -1) {
          if (!motion) { motion = { type: "AutoMotion", waypoints: [], startEvent: "AUTOMOTIONSTARTEVENT_SNAP", startDelay: 0, endDelay: 0, automotionOrderTransitID: 1, automotionOrderPlayer: 0, stanceAtTarget: "StanceType_None", useLegacyLocoPathing: false, shouldStopAtTarget: false }; out.push(motion); }
          motion.waypoints.push({ x: to.x, y: to.y, speed: spd(s.val3), facingAngle: 0, locoStyle: "AUTOMOTIONLOCOSTYLE_NORMAL", shouldFaceEndPoint: true });
        } else {
          motionDone = true;
          const d = dist(pos, to);
          if (d > 0.1) out.push({ type: runPlay ? "MoveDirection" : "RunRoute", distance: r2(d), direction: r2(((Math.atan2(to.y - pos.y, to.x - pos.x) * 180 / Math.PI) + 360) % 360), speed: spd(s.val3) });
        }
        pos = to;
        break;
      }
      case 46: motionDone = true; break;
      case 8: out.push({ type: runPlay ? "MoveDirection" : "RunRoute", distance: yds(s.val1), direction: deg(s.val2), speed: spd(s.val3) }); break;
      case 3: out.push({ type: "MoveDirection", distance: yds(s.val1), direction: deg(s.val2), speed: spd(s.val3) }); break;
      case 9: {
        const cut = CUTS[s.val2];
        if (!cut || cut.endsWith("INVALID")) warn(`cut type ${s.val2} unknown, used 45`);
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
      case 37: case 48: case 26: case 35: break;
      case 10: out.push({ type: "GetOpen" }); break;
      case 25: if (s.val1 > 0) out.push({ type: "Delay", time: r2(s.val1 / 32) }); break;
      case 14: out.push({ type: "PassBlock", time: r2(s.val1 / 32), flags: "PassBlockFlags_None" }); break;
      case 15: out.push(runPlay ? RUNBLOCK : { type: "PassBlock", time: 0, flags: "PassBlockFlags_ProtectReceiver" }); break;
      case 18: out.push({ ...RUNBLOCK, receiverBlockType: "RECEIVERBLOCKTYPE_NORMAL" }); break;
      case 255: i = steps.length; break;
      default: warn(`step code ${s.code} skipped`);
    }
  }
  const last = out.at(-1);
  if (last && /RunRoute|ReceiverCut|Delay|OptionRoute/.test(last.type) && !out.some(s => s.type === "GetOpen")) out.push({ type: "GetOpen" });
  return out;
}

function routeType(steps, startX) {
  if (steps.some(s => s.type === "OptionRoute")) return "AssignRouteType_RR_Option_Route";
  const legs = steps.filter(s => s.type === "RunRoute" || s.type === "MoveDirection");
  if (!legs.length) return steps.some(s => s.type === "RunBlock") ? "AssignRouteType_Block_Run" : "AssignRouteType_Block_Pass";
  if (steps.some(s => s.type === "PassBlock") && steps.findIndex(s => s.type === "PassBlock") < steps.findIndex(s => s.type === "RunRoute")) return "AssignRouteType_RR_Block_and_Release";
  let y = 0;
  for (const l of legs) y += l.distance * Math.sin(l.direction * Math.PI / 180);
  const d = legs.at(-1).direction, c = Math.cos(d * Math.PI / 180), up = Math.sin(d * Math.PI / 180);
  const inward = startX <= 0 ? c > 0 : c < 0, right = c > 0;
  if (steps.some(s => s.type === "ReceiverCut" && /CURL|HITCH|COMEBACK/.test(s.cutType))) return y > 8 ? "AssignRouteType_RR_Curl_Medium" : "AssignRouteType_RR_Hitch";
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
const newAssignment = (steps, startX, extra = {}) => { const body = { routeType: routeType(steps, startX), ...extra, steps }; return { new: assignName(body), ...body }; };
// A kept M27 assignment, minus its alignment shift (and with an M24 shift in front when there is one).
const keptAssignment = (asset, prepend = []) => { const body = { template: asset.replace(AROOT, ""), keep: -1, drop: ["OverrideFormPos"], prepend, steps: [] }; return { new: assignName(body), ...body }; };

// ---------- play classification (by M24 QB/HB mechanics: edited plays kept their old play type) ----------
function kindOf(p) {
  const qb = p.players.find(x => x.poso === 0)?.steps.map(s => s.code) ?? [];
  const hb = p.players.find(x => x.poso === 1)?.steps.map(s => s.code) ?? [];
  const name = clean(p.modName);
  if ([16, 28, 29, 30, 31].includes(qb[0])) return "special";
  if (qb[0] === 7) return p.plyt === 5 && /screen/i.test(name) ? "screen" : "pass";
  if (/jet touch/i.test(name)) return "touch";
  if (!qb.includes(7)) return /option|read/i.test(name) || qb.includes(42) ? "option" : "run";
  return (hb.includes(1) && !hb.includes(8)) || /RPO/.test(name) ? "rpo" : "pa";
}
const qbInfo24 = p => {
  const st = p.players.find(x => x.poso === 0)?.steps ?? [];
  const h = st.find(s => s.code === 58), drop = st.find(s => s.code === 7);
  return { anim: h ? `${h.val1}/${h.val2}` : null, rollout: !!(h && drop && drop.val2 !== 0) };
};
const tokensOf = name => name.split(" ");
const runPlayKind = kind => kind === "run" || kind === "option" || kind === "touch";

// ---------- base play search ----------
// Tiers of sets whose plays can be cloned into our custom set: the base set, sets with the same player type in every
// slot, then any set; all with the QB on the same spot and every back within 0.3 yd (precans need exact spots).
function setTiers(info, custom, hbSpot, needBacks = true) {
  const n = info.set.movements.Normal;
  const backsOk = m => !needBacks || [1, 2, 3, 4, 5].every(j => typeOf27(custom[j].pos) !== "B" || typeOf27(m[j].pos) !== "B" || (j === 1 && hbSpot ? dist(m[j], hbSpot) < 1.3 : dist(m[j], custom[j]) < 0.3));
  const qbOk = m => dist(m[0], n[0]) < 0.1;
  const typesOk = m => [1, 2, 3, 4, 5].every(j => typeOf27(m[j].pos) === typeOf27(n[j].pos));
  const t1 = [], t2 = [];
  for (const s of baseSets) {
    if (s === info.set) continue;
    const m = s.movements.Normal;
    if (!qbOk(m) || (needBacks && typeOf27(m[1].pos) !== typeOf27(n[1].pos)) || !backsOk(m)) continue;
    (typesOk(m) ? t1 : t2).push(s);
  }
  const t0 = qbOk(n) && backsOk(n) ? [info.set] : [];
  return [t0, t1, t2];
}
// Ball carriers / motion men in the source play must be the same kind of player on the same side in our set.
function carriersFit(q, custom) {
  const src = setByAsset.get(q.set).movements.Normal;
  for (let j = 2; j <= 5; j++) {
    if (!hasHandoff(q.assignments[j])) continue;
    if (typeOf27(src[j].pos) !== typeOf27(custom[j].pos) || Math.sign(Math.round(src[j].x)) !== Math.sign(Math.round(custom[j].x)) || spotClass(src[j]) !== spotClass(custom[j])) return false;
  }
  return true;
}
let preferClean = null; // set per play: candidates without motions the M24 play doesn't have
function search(tiers, accept, rankers = []) {
  // a clean base from any tier beats one that brings along a motion the M24 play doesn't have
  if (preferClean) { const clean = preferClean; preferClean = null; const q = search(tiers, q => accept(q) && clean(q), rankers); preferClean = clean; if (q) return q; }
  for (const tier of tiers) {
    const cand = [];
    for (const s of tier) for (const q of playsBySet.get(s.asset) ?? []) if (accept(q)) cand.push(q);
    if (!cand.length) continue;
    for (const r of rankers) { const f = cand.filter(r); if (f.length) return f[0]; }
    return cand[0];
  }
  return null;
}

const RUN_SYNONYMS = [
  [/tush push|qb sneak/i, ["QB Sneak"]], [/fb dive/i, ["FB Dive"]],
  [/jet sweep/i, ["Jet Sweep", "Jet Sweep Wk", "HB Sweep"]], [/jet dive/i, ["Jet Dive", "Zone Fake Jet", "Jet Zone", "HB Dive", "Inside Zone"]],
  [/jet counter/i, ["Jet Counter", "Counter", "HB Counter"]], [/jet touch/i, ["Jet Touch Pass"]],
  [/zone split wk/i, ["Inside Zone Split", "Zone Split Wk", "Zone Split"]], [/zone split/i, ["Inside Zone Split", "Zone Split", "HB Zone Split", "Inside Zone"]],
  [/zone wk/i, ["HB Zone Wk", "Inside Zone Wk", "Zone Wk", "Inside Zone"]], [/inside zone/i, ["Inside Zone", "HB Zone"]],
  [/switch zone/i, ["Inside Zone", "Outside Zone", "HB Zone"]], [/stretch/i, ["HB Stretch", "Outside Zone", "Stretch", "HB Zone Toss", "Wide Zone"]],
  [/toss/i, ["HB Toss", "Toss", "HB Zone Toss", "Strong Toss", "HB Stretch"]], [/split/i, ["HB Split O", "Split O", "Power O", "HB Power O"]],
  [/power option/i, ["Power Option"]], [/power/i, ["Power O", "HB Power O", "HB Power", "Power", "Duo"]],
  [/trap/i, ["0 1 Trap", "HB Trap", "Trap"]], [/counter/i, ["HB Counter", "Counter", "HB Counter Wk", "Counter Y", "HB Counter Str"]],
  [/wham/i, ["HB Wham", "Wham"]], [/iso/i, ["HB Iso", "Iso", "HB Lead Dive"]], [/dive/i, ["HB Dive", "Dive", "HB Slam", "HB Lead Dive"]],
  [/lead read option|read option lead/i, ["Lead Read Option", "Y Lead Read Option", "F Lead Read Option", "Read Option"]],
  [/speed option/i, ["Speed Option"]], [/triple option/i, ["Triple Option"]], [/read option/i, ["Read Option", "Zone Read"]],
];
function nameRankers(p) {
  const name = clean(p.modName).replace(/^(PM|FMO|BM|YM|RZ|J[WFRB]?)\s+/, ""), stock = clean(p.stockName ?? "");
  let terms = [];
  for (const [re, t] of RUN_SYNONYMS) if (re.test(name)) { terms = t; break; }
  if (!terms.length) for (const [re, t] of RUN_SYNONYMS) if (re.test(stock)) { terms = t; break; }
  // the renamed play's own words first; the M24 stock name it was edited from only as a last resort
  const wanted = [...new Set([name, ...terms].map(norm))], old = norm(stock);
  return [...wanted.map(w => q => norm(q.name) === w), ...wanted.map(w => q => norm(q.name).includes(w)), q => norm(q.name) === old];
}

function findBase(p, kind, info, custom, hbShift, slotOf) {
  const { anim, rollout } = qbInfo24(p);
  const name = clean(p.modName), toks = tokensOf(name);
  const tiers = setTiers(info, custom, hbShift, kind !== "pass" && kind !== "touch");
  const hbWide = spotClass(custom[1]) !== "BACK" || Math.abs(custom[1].x) > 4;
  const sameAnim = q => anim && qbAnim27(q) === anim;
  // runs: the M24 ball carrier (the player who receives the handoff) must be the M27 play's ball carrier too
  const carrier24 = (kind === "run" || kind === "option" || kind === "touch") ? [1, 2, 3, 4, 5].find(i => p.players.find(x => x.poso === i)?.steps.some(x => x.code === 13)) : null;
  const takesBall = (q, j) => stepsOf(q.assignments[j]).some(x => x.type === "ReceiveHandoff" || x.type === "RecievePitch");
  const sameCarrier = q => !carrier24 || takesBall(q, slotOf[carrier24]) && [1, 2, 3, 4, 5].every(j => j === slotOf[carrier24] || !takesBall(q, j) || j === 1 && kind === "option");
  const fit = q => carriersFit(q, custom) && sameCarrier(q);
  const wantPull = toks.includes("P");
  if (kind === "run" || kind === "option" || kind === "touch") {
    const runLike = q => RUN_TYPES.has(ptVal(q)) || ptVal(q) === 208 || (kind === "touch" && /touch/i.test(q.name));
    // the play name is the intent (Tush Push = QB sneak), the handoff animation the mechanics: name+handoff, name, handoff, type
    const named = nameRankers(p);
    const byName = test => { for (const r of named) { const q = search(tiers, q => runLike(q) && fit(q) && test(q) && r(q)); if (q) return q; } return null; };
    let q = byName(sameAnim);
    if (q) return { q, how: `name + same handoff ${anim}` };
    q = byName(() => true);
    if (q) return { q, how: anim ? `name; no same-named M27 play shares handoff ${anim}` : "name" };
    q = search(tiers, q => runLike(q) && sameAnim(q) && fit(q), [q => ptVal(q) === p.plyt]);
    if (q) return { q, how: `same handoff ${anim}, no name match` };
    q = search(tiers, q => runLike(q) && fit(q), [q => ptVal(q) === p.plyt]);
    if (q) return { q, how: "play type only" };
    // next: a same-named play whose carrier is a nearby teammate of the same type on the same side (never the back)
    if (carrier24) {
      const c = custom[slotOf[carrier24]];
      const near = q => { const j = [1, 2, 3, 4, 5].find(j => takesBall(q, j)); return j && typeOf27(custom[j].pos) === typeOf27(c.pos) && Math.sign(custom[j].x) === Math.sign(c.x) && dist(custom[j], c) <= 3; };
      for (const r of named) { q = search(tiers, q => runLike(q) && near(q) && r(q)); if (q) return { q, how: "name; ball carrier is the teammate next to the M24 one" }; }
    }
    // last resort: a same-named play with a different ball carrier
    for (const r of named) { q = search(tiers, q => runLike(q) && carriersFit(q, custom) && r(q)); if (q) return { q, how: "name; DIFFERENT BALL CARRIER than M24" }; }
    return null;
  }
  if (kind === "pa" || kind === "rpo") {
    const passLike = q => !RUN_TYPES.has(ptVal(q)) && !TRICK.has(ptVal(q));
    const rolls = q => isRollout27(q) === rollout;
    const pull = q => hasPull27(q) === wantPull;
    const rpoFirst = kind === "rpo" ? [q => RPO_TYPES.has(ptVal(q)) && rolls(q) && pull(q), q => RPO_TYPES.has(ptVal(q))] : [q => !RPO_TYPES.has(ptVal(q)) && rolls(q) && pull(q), q => !RPO_TYPES.has(ptVal(q)) && rolls(q), q => rolls(q)];
    if (!hbWide && kind === "rpo") {
      // an RPO must stay an RPO: same handoff first, then any RPO meshing on the same spots, before a PA with the same handoff
      let q = search(tiers, q => RPO_TYPES.has(ptVal(q)) && sameAnim(q) && fit(q), [q => rolls(q)]);
      if (q) return { q, how: `same handoff ${anim}` };
      q = search(tiers, q => RPO_TYPES.has(ptVal(q)) && fit(q), [q => /bubble|flat|smoke|alert|screen|corndog/i.test(name) === (ptVal(q) === 207)]);
      if (q) return { q, how: `RPO on the same mesh; no M27 RPO shares handoff ${anim}` };
    }
    if (!hbWide) {
      let q = search(tiers, q => passLike(q) && sameAnim(q) && fit(q), rpoFirst);
      if (q) return { q, how: `same handoff ${anim}${isRollout27(q) ? (rollout ? ", boot" : "") : ""}` };
      q = search(tiers, q => passLike(q) && (kind === "rpo" ? RPO_TYPES.has(ptVal(q)) : ptVal(q) === 4) && fit(q), [q => rolls(q)]);
      if (q) return { q, how: `no M27 play shares handoff ${anim}; nearest ${kind.toUpperCase()}` };
    }
  }
  // dropback (and the fallback for a split-out back): no handoff/fake on slot 1; only the QB spot has to match
  const dropTiers = kind === "pass" ? tiers : setTiers(info, custom, null, false);
  const isScreen = q => ptVal(q) === 5 || /screen/i.test(q.name);
  const drop = q => !RUN_TYPES.has(ptVal(q)) && !TRICK.has(ptVal(q)) && !RPO_TYPES.has(ptVal(q)) && !q.assignments.slice(1, 6).some(hasHandoff);
  if (kind === "screen") { const q = search(tiers, q => isScreen(q) && !RPO_TYPES.has(ptVal(q)), [q => /slip/i.test(q.name)]); if (q) return { q, how: "screen" }; }
  const q = search(dropTiers, q => drop(q) && !isScreen(q), [q => ptVal(q) === p.plyt && !/rollout|boot|sprint|PA/i.test(q.name), q => PASS_TYPES.has(ptVal(q)) && !/rollout|boot|sprint|PA/i.test(q.name), q => PASS_TYPES.has(ptVal(q))]);
  return q ? { q, how: kind === "pass" || kind === "screen" ? "dropback" : `${kind.toUpperCase()} fell back to a dropback${hbWide ? " (back split out)" : ""}` } : null;
}

// "P" (pull blocking): M24 got its pull from the blocking scheme; M27 writes pulls into the linemen's assignments,
// so borrow the line from a stock play-action with a pulling lineman, same QB spot, fake going the same way.
const fakeSide = q => { const r = stepsOf(q.assignments[1]).find(x => x.type === "ReceiveHandoff"); return r ? Math.sign(Math.round(Math.cos(r.direction * Math.PI / 180) * 10)) : 0; };
function pullDonor(base, qbSpot) {
  const c = plays.filter(q => ptVal(q) === 4 && !/screen/i.test(q.name) && hasPull27(q) && qbAnim27(q) && dist(setByAsset.get(q.set).movements.Normal[0], qbSpot) < 0.1);
  return c.find(q => fakeSide(q) === fakeSide(base)) ?? c[0] ?? null;
}

// ---------- situational play calling (CPU weights by situation) ----------
function passDepth(entry, custom) {
  // the concept name says it best; route geometry is the fallback (a slant's last leg is long but the throw is quick)
  const nm = entry.name.replace(/^(RZ|J[WFRB]?|YM|YEM|EM|BM|RM|HBM|FM[EHO]?|M|SC|SD|CC|CZ|PM|PA|P)s+/g, "");
  if (/slant|stick|snag|spot|flat|bubble|smoke|hitch|quick|bullet|angle|dragon|drag|shallow|mesh|follow|return|zig/i.test(nm)) return "quick";
  if (/vert|post|go'?s|seam|sluggo|fade|shot|wheel|sail|deep|corner|comeback/i.test(nm)) return "deep";
  const a = entry.players?.[entry.vip];
  if (!a || typeof a !== "object") return "mid";
  if (a.steps.some(s => s.type === "OptionRoute")) return "quick";
  let y = custom[entry.vip]?.y ?? 0;
  for (const s of a.steps) { if (s.type === "AutoMotion") y = s.waypoints.at(-1).y; if (/RunRoute|MoveDirection/.test(s.type)) y += Math.min(s.distance, 30) * Math.sin(s.direction * Math.PI / 180); }
  return y < 7 ? "quick" : y > 15 ? "deep" : "mid";
}
function situational(kind, name, form, depth, entry) {
  const toks = tokensOf(name);
  const w = {};
  const add = o => { for (const [k, v] of Object.entries(o)) w[k] = Math.max(w[k] ?? 0, v); };
  if (/tush push|sneak/i.test(name)) add({ "3rdAndShort": 80, "4thAndShort": 85, GoalLine: 60, Insidefive: 50, GoFor2: 25 });
  else if (kind === "run") add({ FirstDown: 35, "2ndAndShort": 45, "3rdAndShort": 35, "4thAndShort": 30, ConserveTime: 45, WasteTime: 40, RedZone: 20, Insidefive: 25, GoalLine: 25 });
  else if (kind === "option") add({ FirstDown: 30, "2ndAndShort": 35, "2ndAndMedium": 25, "3rdAndShort": 30, RedZone: 25, ConserveTime: 25 });
  else if (kind === "touch") add({ FirstDown: 30, "2ndAndShort": 30, "2ndAndMedium": 25 });
  else if (kind === "screen") add({ "2ndAndLong": 40, "3rdAndLong": 35, "3RDExtraLong": 40, FirstDown: 15 });
  else if (kind === "rpo") add({ FirstDown: 40, "2ndAndMedium": 40, "2ndAndShort": 30, "3rdAndShort": 25 });
  else {
    if (kind === "pa") add({ FirstDown: 35, "2ndAndShort": 40, Playaction: 70 });
    if (depth === "quick") add({ "2ndAndMedium": 30, "3rdAndShort": 35, "3rdAndMedium": 40, "4thAndShort": 30, "4thAndMedium": 30 });
    if (depth === "mid") add({ "2ndAndLong": 30, "3rdAndMedium": 40, "3rdAndLong": 40, "4thAndMedium": 35, "4thAndLong": 25 });
    if (depth === "deep") add({ "2ndAndShort": 30, FirstDown: 15, "3rdAndLong": 35, "3RDExtraLong": 30, "4thAndLong": 40, "4THExtraLong": 45, SuddenChange: 50 });
    const vip = entry.players?.[entry.vip];
    if (vip && typeof vip === "object" && /Out|Corner|Comeback|Flat/.test(vip.routeType)) add({ StopClock: 40 });
    if (toks.includes("M")) add({ SuddenChange: 45, "3rdAndLong": 40 });
  }
  if (toks.includes("RZ")) {
    for (const k of ["SuddenChange", "3RDExtraLong", "4THExtraLong", "2ndAndLong", "3rdAndLong"]) delete w[k];
    add({ RedZone: 70, RedZone_16_to_20: 50, RedZone_11_to_15: 60, RedZone_6_to_10: 70, RedZone_3_to_5: 60, Insidefive: 50, GoalLinePass: 50, GoFor2: 50, RedZoneFringe: 40 });
  }
  if (form === "Goal Line Offense") add(kind === "run" || kind === "option" ? { GoalLine: 60, Insidefive: 60, GoFor2: 30 } : { GoalLinePass: 60, Insidefive: 45, GoFor2: 45 });
  if (form === "Hail Mary") { for (const k of Object.keys(w)) delete w[k]; add({ Hailmary: 100, LastPlay: 100 }); }
  // the save holds 2200 weight rows (template special teams included): keep each play's 6 strongest situations
  return Object.fromEntries(Object.entries(w).sort((x, y) => y[1] - x[1]).slice(0, 6));
}

// M24 stance codes (SETG anm/fanm): 1 two-point, 2 three-point, 3 two-point (flex/wing look)
const stance24 = a => ({ 1: "StanceType_2pt", 2: "StanceType_3pt", 3: "StanceType_2pt" })[a] ?? null;
// Flip partner: M24 flipped spots are partner swaps (X<->Z): the player whose mirrored spot is my flipped spot.
function flipPartner(norm24, i) {
  const me = norm24.find(z => z.poso === i);
  const hit = k => { const o = norm24.find(z => z.poso === k); return o && Math.abs(-o.x - me.fx) < 0.05 && Math.abs(o.y - me.fy) < 0.05; };
  if (hit(i)) return i;
  return [1, 2, 3, 4, 5].find(hit) ?? i;
}
const same = (a, b) => Math.abs(a - b) < 0.05;

// ---------- M24 motion presets -> M27 ----------
function portPresets(setl, norm24, slotOf, custom) {
  const out = {};
  for (const name of presetNames.get(setl) ?? []) {
    const m = name.match(/^M(\d)(le|ri)$/) ?? name.match(/^SM(\d)(l|r)$/);
    if (!m) continue;
    const k = +m[1]; if (k < 1 || k > 5) continue;
    const dir = m[2].startsWith("l") ? "left" : "right";
    const at = modAlign(setl, name);
    // a preset entry matters when the player moves in the normal OR the flipped play (some FUSION presets only move on a flip)
    const movers = at.filter(q => q.poso >= 1 && q.poso <= 5 && q.x !== null).filter(q => { const o = norm24.find(z => z.poso === q.poso); return o && !(same(o.x, q.x) && same(o.y, q.y) && same(o.fx, q.fx) && same(o.fy, q.fy)); });
    if (!movers.length) continue;
    const entries = movers.map(q => {
      const j = slotOf[q.poso];
      const e = { slot: j, x: q.x, y: q.y, fx: q.fx, fy: q.fy, motionMan: q.poso === k };
      if (stance24(q.anm)) e.stance = stance24(q.anm);
      if (stance24(q.fanm)) e.fstance = stance24(q.fanm);
      return e;
    });
    if (!entries.some(e => e.motionMan)) entries[0].motionMan = true;
    out[`${name.startsWith("S") ? "S" : ""}M${slotOf[k]}${dir}`] = entries;
  }
  return out;
}

// ---------- main ----------
const setsSpec = { notes: "FUSION (Madden 24 mod) ported to Madden 27 by tools/m24/convert-fusion.mjs. Regenerate rather than hand-edit.", formations: [], sets: [] };
const book = { name: "FUSION", side: "offense", notes: "FUSION offense, ported from the Madden 24 mod (hansonma.org/projects/fusion).", formations: [] };
const stats = { sets: 0, plays: 0, passes: 0, runs: 0, animMatched: 0, animMissed: 0, assignments: new Set(), warnings: 0 };
log(`# FUSION → Madden 27 port report\n\nGenerated by \`tools/m24/convert-fusion.mjs\`. Each FUSION set is a custom M27 set (closest stock set, re-aligned to the M24 mod alignment, with the M24 motion presets). QB/HB mechanics come from an M27 play with the same handoff animation as the M24 play; receivers get the M24 routes, blocks and motions.\n`);

const byForm = new Map();
for (const f of F) {
  const target = FORM_MAP[f.formation];
  if (!target) continue;
  const form27 = offenseForm(target);
  const fspec = byForm.get(target) ?? { formation: target, sets: [] };
  byForm.set(target, fspec);
  log(`\n## ${f.formation} → ${target}\n`);
  for (const s of f.sets) {
    const setName = clean(s.modName);
    if (/^ignore$/i.test(setName)) { log(`- skipped set "${s.modName}" (marked IGNORE)`); continue; }
    const m24 = modAlign(s.setl);
    const { cls, best } = chooseBase(m24, target);
    if (!best) { log(`- **${setName}: no M27 base set found (QB ${cls})**`); continue; }
    const baseSet = best.set, n = baseSet.movements.Normal;
    const slotOf = { 0: 0 }; best.perm.forEach((j, i) => slotOf[i + 1] = j + 1);
    for (let k = 6; k <= 10; k++) slotOf[k] = k;
    const typeAt = j => typeOf27(n[j].pos);
    const custom = n.map(p => ({ ...p }));
    const positions = [];
    for (let i = 1; i <= 5; i++) {
      const j = slotOf[i], src = m24[i], b = n[j];
      // M24's own stance and flipped spot (partner swaps like X<->Z, not always a mirror of himself)
      const pos = { slot: j, x: src.x, y: src.y, flipAssign: slotOf[flipPartner(m24, i)], fx: src.fx, fy: src.fy };
      if (stance24(src.anm)) pos.stance = stance24(src.anm);
      if (stance24(src.fanm)) pos.fstance = stance24(src.fanm);
      custom[j] = { ...b, x: src.x, y: src.y };
      positions.push(pos);
    }
    const presets = portPresets(s.setl, m24, slotOf, custom);
    const setLeaf = "FUS_" + leafOf(setName);
    const sspec = { name: setName, asset: setLeaf, base: baseSet.asset, formation: form27.asset, positions, presets, plays: [] };
    log(`### ${setName}  (M24 "${s.stockForm} / ${s.stockName}" mod)\n- base: **${formByAsset.get(baseSet.formation).name} / ${baseSet.name}**, fit ${r2(best.cost)} yd${best.mism ? `, ${best.mism} position-type mismatch(es)` : ""}${dist(n[0], m24[0]) > 0.05 ? `, QB at (${n[0].x},${n[0].y}) vs M24 (${m24[0].x},${m24[0].y})` : ""}`);
    log(`- slots: ` + [1, 2, 3, 4, 5].map(i => `M24 ${i}→${slotOf[i]} ${n[slotOf[i]].pos.replace("POSITION_", "")} (${m24[i].x},${m24[i].y})`).join(", "));
    log(`- motion presets: ${Object.keys(presets).join(" ") || "none"}`);
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
      const chainOf = poso => p.players.find(x => x.poso === poso)?.steps ?? [];
      // a shifted back only steers the search when he takes the handoff (PM); Tush Push backs just push
      const hbShift = chainOf(1).some(x => x.code === 58) ? shiftOf(chainOf(1)) : null;

      const m24MotionSlots = new Set([1, 2, 3, 4, 5].filter(i => hasMotion(chainOf(i))).map(i => slotOf[i]));
      // players with M27 mechanics are kept as-is, so their built-in motion would survive: avoid bases that add one
      preferClean = q => [1, 2, 3, 4, 5].every(j => m24MotionSlots.has(j) || !(hasMotion27(q.assignments[j]) && (hasHandoff(q.assignments[j]) || runPlayKind(kind))));
      const found = findBase(p, kind, best, custom, hbShift, slotOf);
      preferClean = null;
      if (!found) { warn(`no M27 base play found, dropped`); continue; }
      const { q: base, how } = found;
      const { anim } = qbInfo24(p);
      if (anim && kind !== "pass" && kind !== "screen") { if (qbAnim27(base) === anim) stats.animMatched++; else stats.animMissed++; }
      const src = setByAsset.get(base.set), srcN = src.movements.Normal;
      const entry = { name, asset: leaf, from: base.asset };
      const players = {};
      const runPlay = kind === "run" || kind === "option" || kind === "touch";

      for (let i = 1; i <= 5; i++) {
        const j = slotOf[i], baseA = base.assignments[j], st = chainOf(i);
        const shift = shiftOf(st);
        const mechanics = hasHandoff(baseA);
        const lastMech = st.reduce((k, x, idx) => MECH.has(x.code) ? idx : k, -1);
        // M24 shift for a ball carrier: go to the source play's spot so the precan lines up (PM = back on the other side)
        const shiftStep = spot => ({ type: "OverrideFormPos", stance: ofpStance(typeAt(j), spot), offsetX: spot.x, offsetY: spot.y });
        const carrierShift = shift && mechanics ? (dist(srcN[j], shift) < 1.5 ? srcN[j] : shift) : shift;
        if (runPlay || mechanics || (kind === "rpo" && i === 1) || (kind === "screen" && i === 1)) {
          // M27 keeps this player (run blocking, handoff/fake/read mechanics) - unless M24 gave a receiver a motion to keep
          if (runPlay && !mechanics && i >= 2 && hasMotion(st) && !hasMotion27(baseA) && !st.some(x => x.code === 58 || x.code === 13)) {
            const steps = convertSteps(st, { x: m24[i].x, y: m24[i].y }, typeAt(j), warn, { runPlay: true });
            if (!steps.some(x => /Block/.test(x.type))) steps.push(RUNBLOCK);
            players[j] = newAssignment(steps, m24[i].x, { routeType: "AssignRouteType_Block_Run" });
          } else if (!runPlay && mechanics && i === 1 && kind === "pa" && st.length && isRoute(st.slice(lastMech + 1))) {
            // PA back: M27 fake, then the M24 route that follows the M24 fake
            const keep = stepsOf(baseA).findLastIndex(x => HANDOFF_STEPS.has(x.type) || x.type === "AutoMotion") + 1;
            const steps = convertSteps(st.slice(lastMech + 1), { x: m24[i].x, y: m24[i].y }, typeAt(j), warn);
            players[j] = newAssignment(steps, m24[i].x, { keep, template: baseA.replace(AROOT, ""), drop: ["OverrideFormPos"], prepend: carrierShift ? [shiftStep(carrierShift)] : [] });
          } else if (carrierShift || hasOFP(baseA)) {
            players[j] = keptAssignment(baseA, carrierShift ? [shiftStep(carrierShift)] : []);
          }
        } else if (isRoute(st) || hasMotion(st)) {
          const steps = convertSteps(st.slice(st[0]?.code === 58 ? lastMech + 1 : 0), { x: m24[i].x, y: m24[i].y }, typeAt(j), warn);
          if (shift && !steps.some(x => x.type === "OverrideFormPos")) steps.unshift(shiftStep(shift));
          players[j] = newAssignment(steps, m24[i].x);
        } else if (st.some(x => x.code === 14 || x.code === 15 || x.code === 18)) {
          players[j] = kind === "rpo" ? "Blocking/RunBlock_All" : "Blocking/ALL_PassBlock";
        } else if (hasOFP(baseA)) {
          players[j] = keptAssignment(baseA);
          if (st.length > 1) warn(`slot ${j}: M24 chain ${st.map(x => x.code).join(",")} not recognized, kept M27 (minus its shift)`);
        } else if (st.length > 1) warn(`slot ${j}: M24 chain ${st.map(x => x.code).join(",")} not recognized, kept M27`);
        if (typeof players[j] === "object") stats.assignments.add(players[j].new);
      }
      if (kind === "pa" && tokensOf(name).includes("P") && !hasPull27(base)) {
        const donor = pullDonor(base, n[0]);
        if (donor) { for (let j = 6; j <= 10; j++) players[j] = donor.assignments[j].replace(AROOT, ""); log(`    - ${name}: pulling line borrowed from "${donor.name}" (${setByAsset.get(donor.set).name})`); }
      }
      if (Object.keys(players).length) entry.players = players;

      if (!runPlay) {
        const R = p.reads;
        const routeSlots = new Set(Object.entries(players).filter(([, a]) => typeof a === "object" && a.steps?.some(x => /RunRoute|OptionRoute/.test(x.type))).map(([j]) => +j));
        if (R) {
          const reads = [];
          for (let k = 1; k <= 5; k++) {
            const rcv = R[`rcv${k}`]; if (!rcv || rcv > 5) continue;
            const pos = slotOf[rcv];
            // RPO: only route runners are pass options; everyone else is a run blocker
            const pct = kind === "rpo" && !routeSlots.has(pos) ? 0 : r2(R[`per${k}`] / 100);
            reads.push({ pos, pct, combo: R[`com${k}`] ?? 0, concept: "Concept_Invalid" });
          }
          const vip = p.vpos && p.vpos <= 5 ? slotOf[p.vpos] : null;
          if (vip) {
            entry.vip = vip;
            const v = reads.find(r => r.pos === vip);
            const top = Math.max(0, ...reads.filter(r => r.pos !== vip).map(r => r.pct));
            if (!v) reads.unshift({ pos: vip, pct: Math.min(1, r2(top + 0.05)) || 0.9, combo: 0, concept: "Concept_Invalid" });
            else if (v.pct <= top) { v.pct = Math.min(1, r2(top + 0.05)); if (v.pct <= top) reads.filter(r => r.pos !== vip && r.pct >= v.pct).forEach(r => r.pct = r2(v.pct - 0.05)); }
          }
          // M27 RPOs throw to one (Alert) or two (Read/Peek) pass options; the rest keep their routes as decoys
          if (kind === "rpo" && RPO_TYPES.has(ptVal(base))) {
            const max = ptVal(base) === 207 ? 1 : 2;
            const keepPos = new Set([...reads].filter(r => r.pct > 0).sort((a, b) => (b.pos === vip) - (a.pos === vip) || b.pct - a.pct).slice(0, max).map(r => r.pos));
            for (const r of reads) if (!keepPos.has(r.pos)) r.pct = 0;
          }
          if (reads.length) entry.reads = reads;
        }
        stats.passes++;
      } else stats.runs++;

      const depth = runPlay ? null : passDepth({ ...entry, name }, custom);
      log(`    - ${name} [${kind}${depth ? "/" + depth : ""}] ← ${formByAsset.get(src.formation).name} / ${src.name} / "${base.name}" (${how})${entry.players ? `; rebuilt ${Object.keys(players).join(",")}` : ""}${entry.vip ? `; red ${entry.vip}` : ""}`);
      sspec.plays.push(entry);
      stats.plays++;

      // terminology audit
      const toks = tokensOf(name);
      const finalA = j => players[j] ?? base.assignments[j];
      const motionSlots = [1, 2, 3, 4, 5].filter(j => { const a = finalA(j); return typeof a === "object" ? a.steps.some(x => x.type === "AutoMotion") || (a.keep === -1 && hasMotion27(AROOT + a.template)) : hasMotion27(typeof a === "string" && !a.startsWith("football") ? AROOT + a : a); });
      const issues = [];
      // an M27 motion that survived on a player whose M24 chain has none (or a different one)
      const stock27 = [1, 2, 3, 4, 5].filter(j => { const a = finalA(j); const asset = typeof a === "object" ? (a.keep === -1 ? AROOT + a.template : null) : (typeof a === "string" && !a.startsWith("football") ? AROOT + a : a); return asset && hasMotion27(asset); });
      const m24Motion = new Set([1, 2, 3, 4, 5].filter(i => hasMotion(chainOf(i))).map(i => slotOf[i]));
      const foreign = stock27.filter(j => !m24Motion.has(j));
      if (foreign.length) issues.push(`M27 motion kept on slot ${foreign.join(",")}`);
      const shifted = Object.values(players).some(a => typeof a === "object" && (a.prepend?.length || a.steps?.some(x => x.type === "OverrideFormPos")));
      if (toks.some(t => /^(J[WFRB]?|YM|EM|YEM|BM|RM|HBM)$/.test(t)) && !motionSlots.length && !shifted) issues.push("no motion");
      if (toks.includes("PM") && !Object.values(players).some(a => typeof a === "object" && (a.prepend?.length || a.steps?.some(x => x.type === "OverrideFormPos")))) issues.push("no pre-motion shift");
      if (toks.includes("P") && !hasPull27(base) && typeof players[7] !== "string" && typeof players[9] !== "string") issues.push("no pulling lineman");
      if (/\bboot\b/i.test(name) && !isRollout27(base)) issues.push("QB doesn't roll out");
      if ((kind === "pa" || kind === "rpo" || runPlay) && anim && qbAnim27(base) !== anim) issues.push(`handoff ${anim} not matched (got ${qbAnim27(base)})`);
      audit.push(`| ${target} | ${setName} | ${name} | ${kind} | ${motionSlots.join(",") || "-"} | ${issues.join("; ") || "ok"} |`);

      const bp = { play: name };
      const slot = { 2: 1, 4: 2, 16: 3, 8: 4 }[p.flag];
      if (slot) bp.audible = slot;
      bp.cpu = situational(kind, name, target, depth, entry);
      bookSet.plays.push(bp);
    }
    const seen = new Set(); for (const bp of bookSet.plays) if (bp.audible) { if (seen.has(bp.audible)) { log(`    - ${bp.play}: duplicate audible slot ${bp.audible} dropped`); delete bp.audible; } else seen.add(bp.audible); }
    if (!sspec.plays.length) continue;
    setsSpec.sets.push(sspec);
    fspec.sets.push(bookSet);
    stats.sets++;
  }
}
for (const name of MENU_ORDER) if (byForm.get(name)?.sets.length) book.formations.push(byForm.get(name));
for (const t of TEMPLATE_FORMS) book.formations.push({ formation: t, sets: "template" });

log(`\n## Special teams\nKickoff, punt, field goal, kneel and spike come from the stock Madden 27 template (Special, Kickoff, Safety Kickoff).\n`);
log(`\n## Terminology audit\nRZ red zone · FM/FME/FMH/FMO force motion (you motion pre-snap with the set's presets) · PM pre-motioned · BM burst · RM return · EM exit · YEM Y exit · YM Y motion · M max protect · JB/JW/JF/JR jet block/wheel/flat/return · P pull blocking. Checked: motion on J/YM/EM/BM/RM/HBM plays, a shift on PM plays, a pulling lineman on P plays, a rolling QB on boots, and the M24 handoff animation on PA/RPO/runs.\n\n| formation | set | play | kind | motion slots | check |\n|---|---|---|---|---|---|\n${audit.join("\n")}\n`);
log(`\n## Totals\n- ${stats.sets} custom sets, ${stats.plays} plays (${stats.passes} passes rebuilt, ${stats.runs} runs/options)\n- handoff animation matched on ${stats.animMatched} of ${stats.animMatched + stats.animMissed} PA/RPO/run plays\n- ${stats.assignments.size} new assignments\n- ${stats.warnings} warnings (inline above)\n`);

mkdirSync("playbooks/fusion", { recursive: true });
writeFileSync("playbooks/fusion/sets.json", JSON.stringify(setsSpec, null, 1));
writeFileSync("playbooks/fusion/FUSION.json", JSON.stringify(book, null, 2));
writeFileSync("build/m24/fusion-report.md", report.join("\n") + "\n");
const flagged = audit.filter(l => !l.endsWith("| ok |")).length;
console.log(`${stats.sets} sets, ${stats.plays} plays (${stats.passes} passes, ${stats.runs} runs); handoff anim matched ${stats.animMatched}/${stats.animMatched + stats.animMissed}; ${stats.assignments.size} new assignments; ${stats.warnings} warnings; audit flags ${flagged}`);
