// Controller + keyboard glyphs. v2: the app is keyboard + mouse only, so controller glyphs are drawn only where a set
// is forced — audibles (AudibleGlyph, in settings.audibleStyle) and galleries. One visual language for both pads:
// face buttons are filled colored circles with a dark letter/symbol (matches the in-game audible menu),
// bumpers/triggers are white rounded rects, sticks are ringed circles, keyboard keys are keycaps.
//
// Without a forced `mode`, <Glyph> only draws a keycap for a key that actually works (a universal combo such as ⌘Z,
// Esc, Delete — see input/registry.ts); pad buttons and single-letter keys render nothing, so leftover v1 hints
// ("press X") disappear on their own.
import type { CSSProperties, ReactNode } from "react";
import { AUDIBLE_KEYS, type PadButton } from "../model/audibles";
import type { AudibleSlot } from "../model/types";
import { useSettings } from "../state/settings";
import { comboLabel, isDirection, keyName, padButtonName, padButtonShort, type PadType } from "./keys";
import { useAudibleStyle, type InputMode } from "./inputMode";
import { BUTTON_FALLBACK_KEYS, isUniversalCombo } from "./registry";
import s from "./Glyph.module.css";

export { useAudibleStyle };
export type { InputMode };

export type GlyphSize = "sm" | "md" | "lg";

export interface GlyphProps {
  button?: PadButton;
  /** Several buttons in one glyph: directions merge into a single d-pad, anything else renders side by side. */
  buttons?: PadButton[];
  /** Chord modifier held with the button(s): renders "VIEW + LB" in a forced pad mode. */
  hold?: PadButton;
  /** Keyboard combos. Unforced: the first universal one is drawn as a keycap. Forced keyboard mode: keys[0]. */
  keys?: string[];
  size?: GlyphSize;
  title?: string;
  /** Force a glyph set (audibles, galleries). Without it only working keyboard keys are drawn. */
  mode?: InputMode;
  className?: string;
}

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

const FACE_COLOR: Record<PadType, Partial<Record<PadButton, string>>> = {
  xbox: { A: "var(--xb-a)", B: "var(--xb-b)", X: "var(--xb-x)", Y: "var(--xb-y)" },
  ps: { A: "var(--ps-cross)", B: "var(--ps-circle)", X: "var(--ps-square)", Y: "var(--ps-triangle)" },
};

const PS_SYMBOL: Partial<Record<PadButton, ReactNode>> = {
  A: <path d="M7.2 7.2l9.6 9.6M16.8 7.2l-9.6 9.6" />,
  B: <circle cx="12" cy="12" r="5.4" />,
  X: <rect x="6.9" y="6.9" width="10.2" height="10.2" rx="0.8" />,
  Y: <path d="M12 6.1l6.1 10.4H5.9z" />,
};

function FaceGlyph({ button, type }: { button: PadButton; type: PadType }) {
  const style = { "--c": FACE_COLOR[type][button] } as CSSProperties;
  return (
    <span className={cx(s.shape, s.face)} style={style}>
      {type === "ps" ? (
        <svg viewBox="0 0 24 24" className={s.psSymbol} aria-hidden>
          {PS_SYMBOL[button]}
        </svg>
      ) : (
        <span className={s.letter}>{button}</span>
      )}
    </span>
  );
}

const DPAD_ARMS: Record<string, string> = {
  UP: "M9 2.5h6v6.5H9z",
  DOWN: "M9 15h6v6.5H9z",
  LEFT: "M2.5 9H9v6H2.5z",
  RIGHT: "M15 9h6.5v6H15z",
};
const DPAD_ARROWS: Record<string, string> = {
  UP: "M12 4.6l1.9 2.6h-3.8z",
  DOWN: "M12 19.4l1.9-2.6h-3.8z",
  LEFT: "M4.6 12l2.6-1.9v3.8z",
  RIGHT: "M19.4 12l-2.6-1.9v3.8z",
};

function DpadGlyph({ dirs }: { dirs: PadButton[] }) {
  const on = new Set(dirs);
  return (
    <span className={cx(s.shape, s.dpad)}>
      <svg viewBox="0 0 24 24" aria-hidden>
        <path className={s.dpadBase} d="M9 2.5h6V9h6.5v6H15v6.5H9V15H2.5V9H9z" />
        {Object.keys(DPAD_ARMS).map((d) =>
          on.has(d as PadButton) ? (
            <g key={d}>
              <path className={s.dpadOn} d={DPAD_ARMS[d]} />
              <path className={s.dpadArrow} d={DPAD_ARROWS[d]} />
            </g>
          ) : null,
        )}
      </svg>
    </span>
  );
}

function SystemGlyph({ button, type }: { button: "VIEW" | "MENU"; type: PadType }) {
  const icon =
    button === "VIEW" ? (
      type === "ps" ? (
        <path d="M8 6.5l1.2 3M12 5.5v3.4M16 6.5l-1.2 3M7 13h10v4.5H7z" />
      ) : (
        <>
          <rect x="6" y="6" width="8.5" height="8.5" rx="1.2" />
          <rect x="9.5" y="9.5" width="8.5" height="8.5" rx="1.2" />
        </>
      )
    ) : (
      <path d="M6.5 8h11M6.5 12h11M6.5 16h11" />
    );
  return (
    <span className={cx(s.shape, type === "ps" ? s.sysPs : s.sysXbox)}>
      <svg viewBox="0 0 24 24" aria-hidden>
        {icon}
      </svg>
    </span>
  );
}

/** One pad button in a given controller family. */
export function PadGlyph({ button, type }: { button: PadButton; type: PadType }) {
  switch (button) {
    case "A":
    case "B":
    case "X":
    case "Y":
      return <FaceGlyph button={button} type={type} />;
    case "LB":
    case "RB":
      return <span className={cx(s.shape, s.bumper)}>{padButtonShort(button, type)}</span>;
    case "LT":
    case "RT":
      return <span className={cx(s.shape, s.bumper, s.trigger)}>{padButtonShort(button, type)}</span>;
    case "LS":
    case "RS":
      return <span className={cx(s.shape, s.stick)}>{padButtonShort(button, type)}</span>;
    case "VIEW":
    case "MENU":
      return <SystemGlyph button={button} type={type} />;
    default:
      return <DpadGlyph dirs={[button]} />;
  }
}

/** Keyboard keycap for a combo ("mod+z" → ⌘Z / Ctrl+Z). */
export function KeyCap({ combo, label, size = "md", title, className }: { combo?: string; label?: string; size?: GlyphSize; title?: string; className?: string }) {
  const text = label ?? (combo ? comboLabel(combo) : "");
  return (
    <kbd className={cx(s.glyph, s[size], s.keycap, className)} title={title ?? text}>
      {text}
    </kbd>
  );
}

export function Glyph({ button, buttons, hold, keys, size = "md", title, mode: forced, className }: GlyphProps) {
  const list = buttons ?? (button ? [button] : []);

  if (!forced) {
    // The app's own UI: only keys that really do something get a keycap.
    const key = keys?.find(isUniversalCombo);
    return key ? <KeyCap combo={key} size={size} title={title} className={className} /> : null;
  }

  if (forced === "keyboard" || list.length === 0) {
    if (keys?.length) return <KeyCap combo={keys[0]} size={size} title={title} className={className} />;
    // A chord or a button without a universal key has no keyboard equivalent.
    if (!list.length || hold) return null;
    const fallback = list.map((b) => BUTTON_FALLBACK_KEYS[b]);
    if (fallback.some((k) => !k)) return null;
    // Several directions read best as one cap: "↑↓".
    const label = list.every(isDirection) ? fallback.map((k) => keyName(k!)).join("") : comboLabel(fallback[0]!);
    return <KeyCap label={label} size={size} title={title} className={className} />;
  }

  const type: PadType = forced;
  const names = list.map((b) => padButtonName(b, type)).join(" / ");
  const name = title ?? (hold ? `Hold ${padButtonName(hold, type)} + ${names}` : names);
  const body =
    list.length > 1 && list.every(isDirection) ? (
      <DpadGlyph dirs={list} />
    ) : (
      list.map((b) => <PadGlyph key={b} button={b} type={type} />)
    );
  return (
    <span className={cx(s.glyph, s[size], (list.length > 1 || hold) && s.multi, className)} title={name} role="img" aria-label={name}>
      {hold && (
        <>
          <PadGlyph button={hold} type={type} />
          <span className={s.plus} aria-hidden>
            +
          </span>
        </>
      )}
      {body}
    </span>
  );
}

/**
 * The glyph of an audible slot in the user's audible style (settings.audibleStyle, or `mode` to force one): the
 * configured face button (Xbox letter / PS5 symbol), or keys 1–4 in the keyboard style.
 */
export function AudibleGlyph({ slot, size = "md", mode, className }: { slot: AudibleSlot; size?: GlyphSize; mode?: InputMode; className?: string }) {
  const button = useSettings((st) => st.audibleButtons[slot]);
  const style = useAudibleStyle();
  return <Glyph button={button} keys={[AUDIBLE_KEYS[slot]]} size={size} mode={mode ?? style} className={className} />;
}
