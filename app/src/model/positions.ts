// Position enum → labels and glyphs. The dumper printed aliased enum names (e.g. POSITION_FIRSTOFFENSELINE is LT),
// so this table maps every alias to the real position.
import type { AlignmentPos, PlayerGlyph } from "./types";

const ALIAS: Record<string, string> = {
  POSITION_FIRST: "QB",
  POSITION_QB: "QB",
  POSITION_HB: "HB",
  POSITION_3DRB: "HB",
  POSITION_PWHB: "HB",
  POSITION_FB: "FB",
  POSITION_WR: "WR",
  POSITION_SLWR: "SL",
  POSITION_TE: "TE",
  POSITION_LASTKEYOFFENSE: "TE",
  POSITION_LT: "LT",
  POSITION_FIRSTOFFENSELINE: "LT",
  POSITION_LG: "LG",
  POSITION_C: "C",
  POSITION_RG: "RG",
  POSITION_RT: "RT",
  POSITION_LASTOFFENSE: "RT",
  POSITION_LASTOFFENSELINE: "RT",
  POSITION_LE: "LE",
  POSITION_FIRSTDEFENSELINE: "LE",
  POSITION_FIRSTDEFENSE: "LE",
  POSITION_RE: "RE",
  POSITION_DT: "DT",
  POSITION_LASTDEFENSELINE: "DT",
  POSITION_RLE: "LE",
  POSITION_RRE: "RE",
  POSITION_RDT: "DT",
  POSITION_NT: "NT",
  POSITION_LOLB: "LOLB",
  POSITION_FIRSTDEFENSELB: "LOLB",
  POSITION_FIRSTDEFENSESEC: "LOLB",
  POSITION_MLB: "MLB",
  POSITION_ROLB: "ROLB",
  POSITION_LASTDEFENSELB: "ROLB",
  POSITION_SLB: "SLB",
  POSITION_CB: "CB",
  POSITION_FIRSTDEFENSEDB: "CB",
  POSITION_SLCB: "NB",
  POSITION_FS: "FS",
  POSITION_SS: "SS",
  POSITION_LASTDEFENSE: "SS",
  POSITION_LASTDEFENSESEC: "SS",
  POSITION_LASTDEFENSEDB: "SS",
  POSITION_K: "K",
  POSITION_FIRSTKP: "K",
  POSITION_P: "P",
  POSITION_LASTKP: "P",
  POSITION_LS: "LS",
  POSITION_LASTNORMAL: "LS",
  POSITION_KR: "KR",
  // Aliases follow the value they share in the Position enum (enums.json order): MAXNORMAL/FIRSTSPECIAL/FIRSTKPRETURN = KR,
  // LASTKPRETURN = PR, LASTSPECIAL = SLCB (nickel).
  POSITION_MAXNORMAL: "KR",
  POSITION_FIRSTSPECIAL: "KR",
  POSITION_FIRSTKPRETURN: "KR",
  POSITION_PR: "PR",
  POSITION_LASTKPRETURN: "PR",
  POSITION_LASTSPECIAL: "NB",
  POSITION_KOS: "KOS",
  POSITION_GAD: "GAD",
};

/** Names for the enum values the aliases fold together (a Third Down Back is not just "Halfback"). */
const RAW_NAMES: Record<string, string> = {
  POSITION_3DRB: "Third Down Back",
  POSITION_PWHB: "Power Back",
  POSITION_SLWR: "Slot Receiver",
  POSITION_SLCB: "Nickel Cornerback",
};

const NAMES: Record<string, string> = {
  QB: "Quarterback",
  HB: "Halfback",
  FB: "Fullback",
  WR: "Wide Receiver",
  SL: "Slot Receiver",
  TE: "Tight End",
  LT: "Left Tackle",
  LG: "Left Guard",
  C: "Center",
  RG: "Right Guard",
  RT: "Right Tackle",
  LE: "Left Defensive End",
  RE: "Right Defensive End",
  DT: "Defensive Tackle",
  NT: "Nose Tackle",
  LOLB: "Left Outside Linebacker",
  MLB: "Middle Linebacker",
  ROLB: "Right Outside Linebacker",
  SLB: "Linebacker",
  CB: "Cornerback",
  NB: "Nickel Cornerback",
  FS: "Free Safety",
  SS: "Strong Safety",
  K: "Kicker",
  P: "Punter",
  LS: "Long Snapper",
  KR: "Kick Returner",
  PR: "Punt Returner",
  KOS: "Kickoff Specialist",
  GAD: "Gadget",
};

const OL = new Set(["LT", "LG", "C", "RG", "RT"]);
const DEF = new Set(["LE", "RE", "DT", "NT", "LOLB", "MLB", "ROLB", "SLB", "CB", "NB", "FS", "SS"]);
const NUMBERED = new Set(["WR", "SL", "TE", "HB", "FB", "CB", "DT", "SS", "FS", "SLB", "MLB", "NB"]);

/** Base position code ("WR", "LT", "CB"…). */
export function positionCode(pos: string): string {
  return ALIAS[pos] ?? pos.replace(/^POSITION_/, "");
}

/** Short label with depth for repeated positions: "WR1", "WR2", "TE1", "QB", "LT". */
export function slotLabel(pos: string, depth: number): string {
  const code = positionCode(pos);
  return NUMBERED.has(code) && depth > 0 ? `${code}${depth}` : code;
}

export function positionName(pos: string): string {
  const code = positionCode(pos);
  return RAW_NAMES[pos] ?? NAMES[code] ?? code;
}

/**
 * Identity of a position for "did it change": aliased enum names are the same position (POSITION_LASTKEYOFFENSE is a
 * TE), but the Third Down Back and Power Back are their own positions even though both draw as a halfback.
 */
export function positionKey(pos: string): string {
  return pos === "POSITION_3DRB" || pos === "POSITION_PWHB" ? pos : positionCode(pos);
}

/** "Wide Receiver 2" for a player: the spelled-out position, numbered when the set has several of it. */
export function playerFullName(a: { pos: string; depth: number }, normal?: readonly { pos: string; depth: number }[]): string {
  const name = positionName(a.pos);
  if (!NUMBERED.has(positionCode(a.pos)) || a.depth <= 0) return name;
  const same = normal ? normal.filter((p) => positionKey(p.pos) === positionKey(a.pos)).length : 2;
  return same > 1 ? `${name} ${a.depth}` : name;
}

export function isOffensiveLine(pos: string): boolean {
  return OL.has(positionCode(pos));
}

export function isDefense(pos: string): boolean {
  return DEF.has(positionCode(pos));
}

export function glyphFor(a: Pick<AlignmentPos, "pos" | "group">): PlayerGlyph {
  const code = positionCode(a.pos);
  if (code === "C") return "center";
  if (OL.has(code) || a.group === "Set_Group_Type_Linemen") return "ol";
  if (code === "QB" || a.group === "Set_Group_Type_Quarterback") return "qb";
  if (DEF.has(code) || /Defens|Linebackers/.test(a.group)) return "def";
  return "skill";
}

/** Eligible non-QB skill slot (reads/vip use these). */
export function isEligible(a: Pick<AlignmentPos, "pos" | "group">): boolean {
  const g = glyphFor(a);
  return g === "skill";
}
