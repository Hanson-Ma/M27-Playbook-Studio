// Cut catalog for the designer: every ReceiverCutAngle with a plain name, grouped the way players think about them
// (speed / hard / turn back / double move / screen), and a small visual icon per cut (the field's CutIcon: the same
// shapes the play art draws at route corners).
import { CutIcon as FieldCutIcon } from "../../field";
import { CUT_LEFT, CUT_PREFIX, cutLabel } from "../../model/routes";
import { titleCase } from "./titleCase";
import s from "./Cuts.module.css";

export type CutGroupId = "speed" | "hard" | "turnback" | "double" | "screen" | "other";

export interface CutGroup {
  id: CutGroupId;
  label: string;
  hint: string;
  cuts: { value: string; name: string }[];
}

const C = (short: string, name: string) => ({ value: CUT_PREFIX + short, name });

export const CUT_GROUPS: CutGroup[] = [
  { id: "speed", label: "Speed Cuts", hint: "Rounded — the receiver keeps his speed", cuts: [C("22", "Speed Cut 22°"), C("45", "Speed Cut 45°")] },
  {
    id: "hard",
    label: "Hard Cuts",
    hint: "Plant and turn sharply",
    cuts: [C("67", "Hard Cut 67°"), C("90", "Hard Cut 90°"), C("90_INSIDE", "Hard Cut 90° (Inside)")],
  },
  {
    id: "turnback",
    label: "Turn Back / Sit",
    hint: "Stop and come back to the ball",
    cuts: [
      C("CURL", "Curl"),
      C("HITCH_COMEBACK", "Comeback"),
      C("HITCH_COMEBACK_INSIDE", "Comeback (Inside)"),
      C("HINGECOMEBACK", "Hinge Comeback"),
      C("180", "Turn Back 180°"),
      C("180_PARTIAL", "Partial Turn Back"),
      C("SMASH", "Smash"),
      C("SMASH_QUICK", "Quick Smash"),
      C("DRAG_STOP", "Settle (Drag Stop)"),
    ],
  },
  {
    id: "double",
    label: "Double Moves",
    hint: "Fake one way, then go",
    cuts: [
      C("STUTTER", "Stutter"),
      C("STUTTER_STREAK", "Stutter-Go"),
      C("SLANT_AND_GO", "Slant-and-Go"),
      C("HITCH_GO_INSIDE", "Hitch-and-Go (Inside)"),
      C("HITCH_GO_OUTSIDE", "Hitch-and-Go (Outside)"),
      C("OUT_AND_UP", "Out-and-Up"),
      C("STICKNOD", "Stick-Nod"),
      C("POSTCORNER", "Post-Corner"),
      C("ZIG", "Zig"),
      C("SHAKE", "Shake"),
      C("HESITATION", "Hesitation"),
    ],
  },
  {
    id: "screen",
    label: "Screens",
    hint: "Turn and catch behind the line",
    cuts: [
      C("SCREEN", "Screen"),
      C("BUBBLE_SCREEN", "Bubble Screen"),
      C("BUBBLE_SCREEN_SHORT", "Short Bubble"),
      C("SCREEN_BACKPEDAL_SHORT", "Backpedal Screen (Short)"),
      C("SCREEN_BACKPEDAL_LONG", "Backpedal Screen (Long)"),
    ],
  },
];

const BY_VALUE = new Map(CUT_GROUPS.flatMap((g) => g.cuts.map((c) => [c.value, { ...c, group: g.id }] as const)));

/** Plain name of a cut type ("Speed Cut 45°", "Stutter-Go"); unknown ones fall back to the enum's words. */
export function cutName(cutType: string | undefined): string {
  if (!cutType) return "No Cut";
  return BY_VALUE.get(cutType)?.name ?? titleCase(cutLabel(cutType));
}

export function cutGroupOf(cutType: string | undefined): CutGroupId {
  return (cutType && BY_VALUE.get(cutType)?.group) || "other";
}

type CutIconProps = { cutType: string; /** ReceiverCut direction (RECEIVER_CUT_DIR_LEFT / _RIGHT). */ dir?: string; size?: number };

/** Visual icon for a cut type: the field's CutIcon (same cut shapes as the play art), in route yellow. */
export function CutIcon({ cutType, dir, size = 28 }: CutIconProps) {
  return <FieldCutIcon cutType={cutType} dir={dir === CUT_LEFT ? "left" : "right"} size={size} className={s.icon} title={cutName(cutType)} />;
}
