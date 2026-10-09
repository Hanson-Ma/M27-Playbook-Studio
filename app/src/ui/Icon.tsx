// Inline SVG icon set: 24-unit grid, round caps, strokes held at 1.75 px on screen at any size.
import type { ReactNode, SVGProps } from "react";
import { cx } from "./cx";
import s from "./Icon.module.css";

/** 8-tooth gear outline (generated so the teeth stay symmetric). */
function gearPath(): string {
  const pt = (deg: number, r: number) => {
    const a = (deg * Math.PI) / 180;
    return `${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`;
  };
  const pts: string[] = [];
  for (let k = 0; k < 8; k++) {
    const a = k * 45;
    pts.push(pt(a - 14, 6.7), pt(a - 8, 8.9), pt(a + 8, 8.9), pt(a + 14, 6.7));
  }
  return `M${pts.join("L")}Z`;
}

const dot = (x: number, y: number) => `M${x} ${y}h.01`;
const STAR = "M12 3.8l2.5 5.3 5.8.7-4.3 3.9 1.2 5.8L12 16.6l-5.2 2.9 1.2-5.8-4.3-3.9 5.8-.7z";

const ICONS = {
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  trash: <path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.9 12.2a1.5 1.5 0 0 0 1.5 1.3h6.2a1.5 1.5 0 0 0 1.5-1.3L17.5 7M10 11v6M14 11v6" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
    </>
  ),
  paste: (
    <>
      <path d="M9 5H6.5A1.5 1.5 0 0 0 5 6.5v12.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V6.5A1.5 1.5 0 0 0 17.5 5H15" />
      <rect x="9" y="3.5" width="6" height="3.2" rx="1" />
      <path d="M9 12h6M9 15.5h4" />
    </>
  ),
  duplicate: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5M14 11.5v5M11.5 14h5" />
    </>
  ),
  undo: <path d="M9 14L4.5 9.5 9 5M4.5 9.5h10a5 5 0 0 1 0 10H11" />,
  redo: <path d="M15 14l4.5-4.5L15 5M19.5 9.5h-10a5 5 0 0 0 0 10H13" />,
  save: (
    <>
      <path d="M5.5 4.5h10.5l3.5 3.5v10.5a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4.5 18.5V5.5a1 1 0 0 1 1-1z" />
      <path d="M8 4.5v4h7v-4M7.5 20v-6h9v6" />
    </>
  ),
  folder: <path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h4.2l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5V18a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18z" />,
  file: <path d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5zM13.5 3.5v5h5" />,
  chevronLeft: <path d="M14.5 6l-6 6 6 6" />,
  chevronRight: <path d="M9.5 6l6 6-6 6" />,
  chevronUp: <path d="M6 14.5l6-6 6 6" />,
  chevronDown: <path d="M6 9.5l6 6 6-6" />,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  warning: <path d="M10.7 4.7a1.5 1.5 0 0 1 2.6 0l7.4 13a1.5 1.5 0 0 1-1.3 2.3H4.6a1.5 1.5 0 0 1-1.3-2.3zM12 9.5v4.5M12 17h.01" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d={`M12 11v5.5${dot(12, 7.8)}`} />
    </>
  ),
  gear: (
    <>
      <path d={gearPath()} />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d={`M9.6 9.6a2.5 2.5 0 0 1 4.85.85c0 1.7-2.45 2.2-2.45 3.55${dot(12, 16.6)}`} />
    </>
  ),
  book: <path d="M12 6.5c-1.6-1.3-4-2-7.5-2v13c3.5 0 5.9.7 7.5 2 1.6-1.3 4-2 7.5-2v-13c-3.5 0-5.9.7-7.5 2zM12 6.5v13" />,
  print: (
    <>
      <path d="M7 8.5V4h10v4.5M7 16.5H5A1.5 1.5 0 0 1 3.5 15v-5A1.5 1.5 0 0 1 5 8.5h14a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5h-2" />
      <path d="M7 13.5h10V20H7z" />
    </>
  ),
  drag: (
    <g fill="currentColor" stroke="none">
      {[8.5, 15.5].flatMap((x) => [6, 12, 18].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.35" />))}
    </g>
  ),
  flip: <path d="M12 3.5v17M9 7.5L4 16.5h5zM15 7.5l5 9h-5z" />,
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.4 3.2M6.6 7.2C3.9 8.9 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.4-1.1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M4 4l16 16" />
    </>
  ),
  lock: (
    <>
      <rect x="5.5" y="10.5" width="13" height="9.5" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </>
  ),
  unlock: (
    <>
      <rect x="5.5" y="10.5" width="13" height="9.5" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.8-1.2" />
    </>
  ),
  star: <path d={STAR} />,
  starFilled: <path d={STAR} fill="currentColor" />,
  filter: <path d="M4 5.5h16l-6.2 7.2v5.5l-3.6 1.8v-7.3z" />,
  download: <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14" />,
  upload: <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 19.5h14" />,
  field: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="1.5" />
      <path d="M7.5 5.5v13M12 5.5v13M16.5 5.5v13M9.7 11.2v1.6M14.3 11.2v1.6" />
    </>
  ),
  route: (
    <>
      <circle cx="6.5" cy="19" r="1.6" />
      <path d="M6.5 17.4V11L17 4.5M12.6 4.3l4.4.2-1.6 4.1" />
    </>
  ),
  motion: (
    <>
      <path d="M3.5 17c2.5-6 8-7.5 13.5-4" strokeDasharray="2.4 2.6" />
      <path d="M15.6 9.2l2.4 4.3-4.6 1.2" />
    </>
  ),
  block: <path d="M12 20.5V8M6.5 8h11" />,
  zone: (
    <>
      <ellipse cx="12" cy="12" rx="8.5" ry="5.5" />
      <path d={dot(12, 12)} />
    </>
  ),
  sparkle: (
    <>
      <path d="M11 3.5l1.8 5.2 5.2 1.8-5.2 1.8L11 17.5l-1.8-5.2L4 10.5l5.2-1.8z" />
      <path d="M18 15l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z" />
    </>
  ),
  list: <path d={`M9 6.5h11M9 12h11M9 17.5h11${dot(4.5, 6.5)}${dot(4.5, 12)}${dot(4.5, 17.5)}`} />,
  grid: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
    </>
  ),
  tree: (
    <>
      <rect x="3.5" y="3.5" width="7" height="4.5" rx="1" />
      <rect x="12.5" y="10" width="8" height="4" rx="1" />
      <rect x="12.5" y="16.5" width="8" height="4" rx="1" />
      <path d="M7 8v10.5h5.5M7 12h5.5" />
    </>
  ),
  playcall: (
    <>
      <rect x="2.8" y="5" width="5.4" height="9" rx="1" />
      <rect x="9.3" y="5" width="5.4" height="9" rx="1" />
      <rect x="15.8" y="5" width="5.4" height="9" rx="1" />
      <path d="M3.3 17.5h4.4M9.8 17.5h4.4M16.3 17.5h4.4" />
    </>
  ),
  export: <path d="M12 14.5V3.5M8 7.5l4-4 4 4M8.5 10.5h-2A1.5 1.5 0 0 0 5 12v6.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V12a1.5 1.5 0 0 0-1.5-1.5h-2" />,
  tag: (
    <>
      <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.2 1.2 0 0 1 0 1.7l-6.8 6.8a1.2 1.2 0 0 1-1.7 0z" />
      <circle cx="8" cy="8" r="1.3" />
    </>
  ),
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1.2 1.2M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2" />,
  external: <path d="M14 4.5h5.5V10M19.5 4.5l-8 8M17.5 13.5V18a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V8A1.5 1.5 0 0 1 6 6.5h4.5" />,
  play: <path d="M8.5 5.6v12.8a.6.6 0 0 0 .9.5l10-6.4a.6.6 0 0 0 0-1l-10-6.4a.6.6 0 0 0-.9.5z" />,
  pause: (
    <>
      <rect x="6.5" y="5" width="3.6" height="14" rx="1" />
      <rect x="13.9" y="5" width="3.6" height="14" rx="1" />
    </>
  ),
  refresh: <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" />,
  controller: (
    <>
      <path d="M7.5 7h9a4.5 4.5 0 0 1 4.4 3.6l.9 5a2.6 2.6 0 0 1-4.6 2.1L15.5 15.5h-7l-1.7 2.2a2.6 2.6 0 0 1-4.6-2.1l.9-5A4.5 4.5 0 0 1 7.5 7z" />
      <path d={`M8 9.8v3.4M6.3 11.5h3.4${dot(15.4, 10.4)}${dot(17.6, 12.6)}`} />
    </>
  ),
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d={`${dot(6.5, 10)}${dot(9.5, 10)}${dot(12.5, 10)}${dot(15.5, 10)}${dot(18, 10)}M8 14.2h8`} />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  /** Pixel size (16 and 20 are the design sizes). */
  size?: number;
  title?: string;
}

export function Icon({ name, size = 16, title, className, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={cx(s.icon, className)}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      {...rest}
    >
      {title && <title>{title}</title>}
      {ICONS[name]}
    </svg>
  );
}

/** Accepts an icon name or any node (custom SVG, Glyph…). */
export function renderIcon(icon: IconName | ReactNode | undefined, size = 16): ReactNode {
  if (icon === undefined || icon === null || icon === false) return null;
  return typeof icon === "string" && icon in ICONS ? <Icon name={icon as IconName} size={size} /> : icon;
}
