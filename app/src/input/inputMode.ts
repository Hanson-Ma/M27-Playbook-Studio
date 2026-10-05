// Glyph sets. v2: the app itself is keyboard + mouse only; controller glyphs are drawn only for audibles, in the style
// the user picks (settings.audibleStyle). `InputMode` is the glyph set a <Glyph mode=…> is forced to.
import { useSettings, type AudibleStyle } from "../state/settings";
import type { PadType } from "./keys";

export type InputMode = "xbox" | "ps" | "keyboard";
export type { AudibleStyle, PadType };

/** How audible slots are drawn (settings.audibleStyle): Xbox face buttons, PS5 symbols or keys 1–4. */
export function useAudibleStyle(): AudibleStyle {
  return useSettings((s) => s.audibleStyle);
}

/** Non-hook variant. */
export function getAudibleStyle(): AudibleStyle {
  return useSettings.getState().audibleStyle;
}
