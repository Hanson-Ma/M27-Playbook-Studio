// Audible style switch: Xbox / PS5 / Keyboard — how audible slots are drawn (settings.audibleStyle). The only place
// the app shows controller buttons is the audible setup, so this sits next to the audible diamond (playbook builder)
// and in Settings → Audibles.
//   import { AudibleStyleSwitch } from "../../input/AudibleStyleSwitch";
//   <AudibleStyleSwitch size="sm" />
import { useSettings, type AudibleStyle } from "../state/settings";
import { Segmented, type SegmentOption } from "../ui/Form";
import { Glyph, KeyCap } from "./glyphs";

export interface AudibleStyleSwitchProps {
  size?: "sm" | "md";
  /** Stretch to the container width. */
  block?: boolean;
  /** Hide the text labels (glyph icons only; titles keep the names). */
  iconsOnly?: boolean;
  className?: string;
}

const NAMES: Record<AudibleStyle, string> = { xbox: "Xbox", ps: "PS5", keyboard: "Keyboard" };

/** Human name of an audible style ("Xbox", "PS5", "Keyboard"). */
export function audibleStyleName(style: AudibleStyle): string {
  return NAMES[style];
}

export function AudibleStyleSwitch({ size = "sm", block, iconsOnly, className }: AudibleStyleSwitchProps) {
  const style = useSettings((st) => st.audibleStyle);
  const options: SegmentOption<AudibleStyle>[] = [
    { value: "xbox", icon: <Glyph button="A" mode="xbox" size="sm" />, label: iconsOnly ? undefined : "Xbox", title: "Show audibles as Xbox buttons (A B X Y)" },
    { value: "ps", icon: <Glyph button="A" mode="ps" size="sm" />, label: iconsOnly ? undefined : "PS5", title: "Show audibles as PS5 buttons (✕ ○ □ △)" },
    { value: "keyboard", icon: <KeyCap label="1" size="sm" />, label: iconsOnly ? undefined : "Keyboard", title: "Show audibles as keyboard keys 1–4" },
  ];
  return (
    <Segmented<AudibleStyle>
      size={size}
      block={block}
      className={className}
      options={options}
      value={style}
      onChange={(v) => useSettings.getState().set({ audibleStyle: v })}
      aria-label="Audible buttons style"
    />
  );
}
