// A one-line legend of what the controller buttons do on this screen. It only shows while a controller is connected,
// in the connected pad's glyphs (Xbox letters or PlayStation symbols).
import type { PadButton } from "../model/audibles";
import { Glyph } from "./glyphs";
import { usePadConnected, usePadType } from "./gamepad";
import s from "./PadHints.module.css";

export interface PadHint {
  buttons: PadButton[];
  label: string;
}

export function PadHints({ hints, className }: { hints: PadHint[]; className?: string }) {
  const connected = usePadConnected();
  const type = usePadType();
  if (!connected) return null;
  return (
    <div className={[s.hints, className].filter(Boolean).join(" ")} aria-label="Controller">
      {hints.map((h) => (
        <span key={h.label} className={s.hint}>
          <Glyph buttons={h.buttons} mode={type} size="sm" />
          <span>{h.label}</span>
        </span>
      ))}
    </div>
  );
}
