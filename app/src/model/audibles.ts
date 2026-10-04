// Audible slots (PlayEntry.audible 1–4) and the controller buttons they appear on.
//
// Inferred from the stock playbooks in research/notes/custom-PBOOKOFF-TEST.txt (PGPL.Flag per default audible):
//   slot 1 (Flag 2)  → quick passes  (Stick, Slants, Mesh, screens)
//   slot 2 (Flag 4)  → runs          (Inside Zone, HB Dive)
//   slot 3 (Flag 16) → deep passes   (Four Verticals, Dagger, Flood)
//   slot 4 (Flag 8)  → play action   (PA …)
// Madden's audible menu puts Quick Pass on □/X, Run on ✕/A, Deep Pass on △/Y and Play Action on ○/B.
// The mapping is a user setting (state/settings.ts) because it hasn't been confirmed in Madden 27 yet.

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

/** Xbox-named buttons (PS equivalents: A=✕, B=○, X=□, Y=△). */
export const DEFAULT_AUDIBLE_BUTTONS: Record<AudibleSlot, PadButton> = {
  1: "X",
  2: "A",
  3: "Y",
  4: "B",
};

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
