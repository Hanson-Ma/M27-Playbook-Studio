// Audible slots (PlayEntry.audible 1–4) and the controller buttons they appear on.
//
// Inferred from the stock playbooks in research/notes/custom-PBOOKOFF-TEST.txt (PGPL.Flag per default audible):
//   slot 1 (Flag 2)  → quick passes  (Stick, Slants, Mesh, screens)
//   slot 2 (Flag 4)  → runs          (Inside Zone, HB Dive)
//   slot 3 (Flag 16) → deep passes   (Four Verticals, Dagger, Flood)
//   slot 4 (Flag 8)  → play action   (PA …)
// Madden 27's audible panel lists them top to bottom as X, Y, LB, RB (slot 1..4), with LT Reset Play / RT Flip Play beside it.
// The mapping is a user setting (state/settings.ts).

import type { AudibleSlot } from "./types";

export type PadButton =
  | "A" | "B" | "X" | "Y"
  | "LB" | "RB" | "LT" | "RT"
  | "LS" | "RS"
  | "VIEW" | "MENU"
  | "UP" | "DOWN" | "LEFT" | "RIGHT";

export const AUDIBLE_SLOTS: AudibleSlot[] = [1, 2, 3, 4];

export const AUDIBLE_CATEGORY: Record<AudibleSlot, string> = {
  1: "Quick Pass",
  2: "Run",
  3: "Deep Pass",
  4: "Play Action",
};

/** Xbox-named buttons (PS equivalents: A=✕, B=○, X=□, Y=△, LB=L1, RB=R1). */
export const DEFAULT_AUDIBLE_BUTTONS: Record<AudibleSlot, PadButton> = {
  1: "X",
  2: "Y",
  3: "LB",
  4: "RB",
};

/** The buttons the audible panel can use, in the order its rows are listed. */
export const AUDIBLE_LIST_BUTTONS: PadButton[] = ["X", "Y", "LB", "RB"];

/** Slots in the order the in-game panel lists them: by button (X, Y, LB, RB, then any other), then slot. */
export function audibleListOrder(buttons: Record<AudibleSlot, PadButton>): AudibleSlot[] {
  const rank = (b: PadButton) => {
    const i = AUDIBLE_LIST_BUTTONS.indexOf(b);
    return i < 0 ? AUDIBLE_LIST_BUTTONS.length : i;
  };
  return [...AUDIBLE_SLOTS].sort((a, b) => rank(buttons[a]) - rank(buttons[b]) || a - b);
}

/** Keyboard keys used for audible slots in keyboard mode. */
export const AUDIBLE_KEYS: Record<AudibleSlot, string> = { 1: "1", 2: "2", 3: "3", 4: "4" };

/** PGPL.Flag bit per slot (what tools/pbook-build.mjs writes). Informational only. */
export const AUDIBLE_FLAG_BITS: Record<AudibleSlot, number> = { 1: 2, 2: 4, 3: 16, 4: 8 };

/** Face-button diamond position for laying out the four audible drop targets like the in-game menu. */
export const BUTTON_DIAMOND: Partial<Record<PadButton, "top" | "left" | "right" | "bottom">> = {
  Y: "top",
  X: "left",
  B: "right",
  A: "bottom",
};
