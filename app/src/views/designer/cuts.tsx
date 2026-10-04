// Cut catalog for the designer: every ReceiverCutAngle with a plain name, grouped the way players think about them
// (speed / hard / turn back / double move / screen), and a small visual icon per cut (the field's CutIcon: the same
// shapes the play art draws at route corners).
import { CutIcon as FieldCutIcon } from "../../field";
import { CUT_LEFT, CUT_PREFIX, cutLabel } from "../../model/routes";
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
  { id: "speed", label: "Speed cuts", hint: "Rounded — the receiver keeps his speed", cuts: [C("22", "Speed cut 22°"), C("45", "Speed cut 45°")] },
  {
    id: "hard",
    label: "Hard cuts",
    hint: "Plant and turn sharply",
    cuts: [C("67", "Hard cut 67°"), C("90", "Hard cut 90°"), C("90_INSIDE", "Hard cut 90° (inside)")],
  },
  {
    id: "turnback",
    label: "Turn back / sit",
    hint: "Stop and come back to the ball",
    cuts: [
      C("CURL", "Curl"),
      C("HITCH_COMEBACK", "Comeback"),
      C("HITCH_COMEBACK_INSIDE", "Comeback (inside)"),
      C("HINGECOMEBACK", "Hinge comeback"),
      C("180", "Turn back 180°"),
      C("180_PARTIAL", "Partial turn back"),
      C("SMASH", "Smash"),
      C("SMASH_QUICK", "Quick smash"),
      C("DRAG_STOP", "Settle (drag stop)"),
    ],
  },
  {
    id: "double",
    label: "Double moves",
    hint: "Fake one way, then go",
    cuts: [
      C("STUTTER", "Stutter"),
      C("STUTTER_STREAK", "Stutter-go"),
      C("SLANT_AND_GO", "Slant-and-go"),
      C("HITCH_GO_INSIDE", "Hitch-and-go (inside)"),
      C("HITCH_GO_OUTSIDE", "Hitch-and-go (outside)"),
      C("OUT_AND_UP", "Out-and-up"),
      C("STICKNOD", "Stick-nod"),
      C("POSTCORNER", "Post-corner"),
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
      C("BUBBLE_SCREEN", "Bubble screen"),
      C("BUBBLE_SCREEN_SHORT", "Short bubble"),
      C("SCREEN_BACKPEDAL_SHORT", "Backpedal screen (short)"),
      C("SCREEN_BACKPEDAL_LONG", "Backpedal screen (long)"),
    ],
  },
];

const BY_VALUE = new Map(CUT_GROUPS.flatMap((g) => g.cuts.map((c) => [c.value, { ...c, group: g.id }] as const)));

/** Plain name of a cut type ("Speed cut 45°", "Stutter-go"); unknown ones fall back to the enum's words. */
export function cutName(cutType: string | undefined): string {
  if (!cutType) return "No cut";
  return BY_VALUE.get(cutType)?.name ?? cutLabel(cutType);
}

export function cutGroupOf(cutType: string | undefined): CutGroupId {
  return (cutType && BY_VALUE.get(cutType)?.group) || "other";
}

type CutIconProps = { cutType: string; /** ReceiverCut direction (RECEIVER_CUT_DIR_LEFT / _RIGHT). */ dir?: string; size?: number };

/** Visual icon for a cut type: the field's CutIcon (same cut shapes as the play art), in route yellow. */
export function CutIcon({ cutType, dir, size = 28 }: CutIconProps) {
  return <FieldCutIcon cutType={cutType} dir={dir === CUT_LEFT ? "left" : "right"} size={size} className={s.icon} title={cutName(cutType)} />;
}
