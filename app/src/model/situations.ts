// CPU play-call situations for PlayEntry.cpu (FORMATS.md §2). Keys are exactly the allowed spec keys;
// the game-side builder maps them to Offense_PlayCallSituation_<key>.

export interface SituationGroup {
  id: "down" | "redzone" | "clock" | "special" | "other";
  label: string;
  keys: SituationKey[];
}

export const SITUATION_KEYS = [
  "FieldGoal", "3rdAndShort", "StopClock", "GoalLine", "RedZone", "Insidefive", "2ndAndLong", "3rdAndMedium",
  "3rdAndLong", "Punt", "ConserveTime", "FakePunt", "FakeFieldGoal", "WasteTime", "Kneel", "Kickoff", "KickoffOnside",
  "2ndAndMedium", "KickoffSafety", "PuntMaxProtect", "2ndAndShort", "Hailmary", "GoalLinePass", "SignaturePlays",
  "ConserveTimeSafe", "RedZoneFringe", "RedZone_16_to_20", "RedZone_11_to_15", "RedZone_6_to_10", "StopClockUser",
  "StopClockFakeUser", "4thAndShort", "4thAndMedium", "4thAndLong", "GoFor2", "FirstDown", "Squib", "Playaction",
  "GoFor1", "RedZone_3_to_5", "3RDExtraLong", "4THExtraLong", "SuddenChange", "LastPlay",
] as const;

export type SituationKey = (typeof SITUATION_KEYS)[number];

export const SITUATION_LABELS: Record<SituationKey, string> = {
  FirstDown: "1st Down",
  "2ndAndShort": "2nd & Short",
  "2ndAndMedium": "2nd & Medium",
  "2ndAndLong": "2nd & Long",
  "3rdAndShort": "3rd & Short",
  "3rdAndMedium": "3rd & Medium",
  "3rdAndLong": "3rd & Long",
  "3RDExtraLong": "3rd & Extra Long",
  "4thAndShort": "4th & Short",
  "4thAndMedium": "4th & Medium",
  "4thAndLong": "4th & Long",
  "4THExtraLong": "4th & Extra Long",
  RedZone: "Red Zone",
  RedZoneFringe: "Red Zone Fringe",
  RedZone_16_to_20: "RZ 16–20",
  RedZone_11_to_15: "RZ 11–15",
  RedZone_6_to_10: "RZ 6–10",
  RedZone_3_to_5: "RZ 3–5",
  Insidefive: "Inside 5",
  GoalLine: "Goal Line",
  GoalLinePass: "Goal Line Pass",
  GoFor1: "Go For 1",
  GoFor2: "Go For 2",
  StopClock: "Stop Clock",
  StopClockUser: "Stop Clock (User)",
  StopClockFakeUser: "Fake Spike (User)",
  ConserveTime: "Conserve Time",
  ConserveTimeSafe: "Conserve Time (Safe)",
  WasteTime: "Waste Time",
  Kneel: "Kneel",
  Hailmary: "Hail Mary",
  LastPlay: "Last Play",
  SuddenChange: "Sudden Change",
  FieldGoal: "Field Goal",
  FakeFieldGoal: "Fake FG",
  Punt: "Punt",
  FakePunt: "Fake Punt",
  PuntMaxProtect: "Punt Max Protect",
  Kickoff: "Kickoff",
  KickoffOnside: "Onside Kick",
  KickoffSafety: "Safety Kick",
  Squib: "Squib",
  Playaction: "Play Action",
  SignaturePlays: "Signature Plays",
};

export const SITUATION_GROUPS: SituationGroup[] = [
  {
    id: "down",
    label: "Down & Distance",
    keys: ["FirstDown", "2ndAndShort", "2ndAndMedium", "2ndAndLong", "3rdAndShort", "3rdAndMedium", "3rdAndLong",
      "3RDExtraLong", "4thAndShort", "4thAndMedium", "4thAndLong", "4THExtraLong"],
  },
  {
    id: "redzone",
    label: "Red Zone & Goal Line",
    keys: ["RedZone", "RedZoneFringe", "RedZone_16_to_20", "RedZone_11_to_15", "RedZone_6_to_10", "RedZone_3_to_5",
      "Insidefive", "GoalLine", "GoalLinePass", "GoFor1", "GoFor2"],
  },
  {
    id: "clock",
    label: "Clock",
    keys: ["StopClock", "StopClockUser", "StopClockFakeUser", "ConserveTime", "ConserveTimeSafe", "WasteTime", "Kneel",
      "Hailmary", "LastPlay", "SuddenChange"],
  },
  {
    id: "special",
    label: "Special Teams",
    keys: ["FieldGoal", "FakeFieldGoal", "Punt", "FakePunt", "PuntMaxProtect", "Kickoff", "KickoffOnside",
      "KickoffSafety", "Squib"],
  },
  { id: "other", label: "Other", keys: ["Playaction", "SignaturePlays"] },
];

export function isSituationKey(key: string): key is SituationKey {
  return (SITUATION_KEYS as readonly string[]).includes(key);
}

/** Canonical order for writing `cpu` objects: the order of SITUATION_GROUPS, unknown keys last. */
export const SITUATION_ORDER: string[] = SITUATION_GROUPS.flatMap((g) => g.keys);

/**
 * Offense_PlayCallSituation enum values (research/index/enums.json) = the save's PBAI.AIGR column.
 * Used to read CPU weights out of a playbook save (e.g. the template) into spec keys.
 */
export const SITUATION_IDS: Record<SituationKey, number> = {
  FieldGoal: 0, "3rdAndShort": 1, StopClock: 2, GoalLine: 3, RedZone: 4, Insidefive: 5, "2ndAndLong": 6,
  "3rdAndMedium": 7, "3rdAndLong": 8, Punt: 9, ConserveTime: 10, FakePunt: 11, FakeFieldGoal: 12, WasteTime: 13,
  Kneel: 14, Kickoff: 15, KickoffOnside: 16, "2ndAndMedium": 17, KickoffSafety: 18, PuntMaxProtect: 19,
  "2ndAndShort": 20, Hailmary: 21, GoalLinePass: 22, SignaturePlays: 23, ConserveTimeSafe: 24, RedZoneFringe: 25,
  RedZone_16_to_20: 26, RedZone_11_to_15: 27, RedZone_6_to_10: 28, StopClockUser: 29, StopClockFakeUser: 30,
  "4thAndShort": 31, "4thAndMedium": 32, "4thAndLong": 33, GoFor2: 34, FirstDown: 35, Squib: 36, Playaction: 37,
  GoFor1: 38, RedZone_3_to_5: 39, "3RDExtraLong": 40, "4THExtraLong": 41, SuddenChange: 42, LastPlay: 43,
};

export const SITUATION_BY_ID: Map<number, SituationKey> = new Map(
  (Object.entries(SITUATION_IDS) as [SituationKey, number][]).map(([k, v]) => [v, k]),
);
