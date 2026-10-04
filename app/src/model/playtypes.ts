// Play-type tags for cards and filters (Madden's PASS / RUN / … chips).

export type PlayFamily = "pass" | "run" | "pa" | "screen" | "option" | "rpo" | "special" | "defense" | "other";

export interface PlayTypeInfo {
  /** Short tag text, uppercase. */
  label: string;
  family: PlayFamily;
  /** CSS custom property for the tag color, e.g. "var(--blue)". */
  color: string;
  /** Human-readable full name, e.g. "Pass · Shotgun". */
  long: string;
}

const FAMILY_COLOR: Record<PlayFamily, string> = {
  pass: "var(--blue)",
  run: "var(--red)",
  pa: "var(--purple)",
  screen: "var(--teal)",
  option: "var(--orange)",
  rpo: "var(--orange)",
  special: "var(--slate)",
  defense: "var(--slate)",
  other: "var(--slate)",
};

const FAMILY_LABEL: Record<PlayFamily, string> = {
  pass: "PASS",
  run: "RUN",
  pa: "PLAY ACTION",
  screen: "SCREEN",
  option: "OPTION",
  rpo: "RPO",
  special: "SPECIAL",
  defense: "DEFENSE",
  other: "OTHER",
};

function family(type: string): PlayFamily {
  const t = type.replace(/^(Offense|Defense)PlayType_/, "");
  if (type.startsWith("DefensePlayType_")) return t === "DontCare" ? "other" : "defense";
  if (/^RPO/.test(t)) return "rpo";
  if (/^Option/.test(t)) return "option";
  if (/Screen/.test(t)) return "screen";
  if (/PlayAction|^PassFake|QBPlayActionRun|FleaFlicker|JetSweepFake|RunPlayAction/.test(t)) return "pa";
  if (/FieldGoal|Punt|KickOff|SafetyKick|OnsideKick|QBRunKneel|PassStopClock|FakeFG|FakePunt|FakeSpike/.test(t)) return "special";
  if (/^Pass|HailMary|TouchPass|HandoffPass|DoublePass|ReversePass/.test(t)) return "pass";
  if (/^Run|QBRun|QBSneak|JetSweep|Statue/.test(t)) return "run";
  return "other";
}

function words(t: string): string {
  return t
    .replace(/^(Offense|Defense)PlayType_/, "")
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .trim();
}

export function playTypeInfo(type: string): PlayTypeInfo {
  const fam = family(type);
  return { label: FAMILY_LABEL[fam], family: fam, color: FAMILY_COLOR[fam], long: words(type) };
}

export const PLAY_FAMILIES: PlayFamily[] = ["pass", "run", "pa", "screen", "rpo", "option", "special", "defense", "other"];
export const familyLabel = (f: PlayFamily) => FAMILY_LABEL[f];
export const familyColor = (f: PlayFamily) => FAMILY_COLOR[f];
