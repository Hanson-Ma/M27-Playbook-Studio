// A cheap play card for the overview when zoomed out: one small <svg> of just the routes and players (no field
// markings, labels or cut marks) plus the name. A few dozen nodes instead of hundreds, so 300+ of them pan and zoom
// smoothly; zoom in and the full PlayCard takes over.
import { memo, useMemo } from "react";
import { artForPlay } from "../../model/art";
import { playTypeInfo } from "../../model/playtypes";
import type { ArtKind, PlayArt, ResolvedPlay } from "../../model/types";
import { useCatalog } from "../../state/library";
import s from "./LiteCard.module.css";

const STROKE: Partial<Record<ArtKind, string>> = {
  route: "var(--art-route)",
  primary: "var(--art-primary)",
  run: "var(--art-run)",
  block: "var(--art-block)",
  motion: "var(--art-motion)",
  preset: "var(--art-motion)",
  qb: "var(--art-qb)",
  option: "var(--art-option)",
};

// What the card frames (yards): sideline to sideline-ish, the backfield to deep.
const X0 = -20;
const W = 40;
const Y0 = -18; // -(max y)
const H = 29;

const arts = new WeakMap<ResolvedPlay, Map<boolean, PlayArt>>();

export const LiteCard = memo(function LiteCard({ play, flip }: { play: ResolvedPlay; flip: boolean }) {
  const catalog = useCatalog();
  const art = useMemo(() => {
    if (!catalog) return undefined;
    let m = arts.get(play);
    if (!m) arts.set(play, (m = new Map()));
    let a = m.get(flip);
    if (!a) {
      try {
        a = artForPlay(catalog, play, { flip });
      } catch {
        return undefined;
      }
      m.set(flip, a);
    }
    return a;
  }, [catalog, play, flip]);
  const type = playTypeInfo(play.playType);
  return (
    <div className={s.card}>
      <svg className={s.art} viewBox={`${X0} ${Y0} ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
        <line className={s.los} x1={X0} x2={X0 + W} y1={0} y2={0} />
        {art?.paths.map((p, i) => {
          const stroke = STROKE[p.kind];
          if (!stroke || p.points.length < 2) return null;
          return <polyline key={i} points={p.points.map((v) => `${v.x.toFixed(1)},${(-v.y).toFixed(1)}`).join(" ")} stroke={stroke} className={p.kind === "motion" || p.kind === "preset" ? s.dashed : s.path} />;
        })}
        {art?.players.map((pl) => (
          <circle key={pl.slot} cx={pl.at.x} cy={-pl.at.y} r={pl.glyph === "ol" || pl.glyph === "center" ? 0.7 : 1} className={pl.glyph === "qb" ? s.qb : s.dot} />
        ))}
      </svg>
      <span className={s.tag} style={{ background: type.color }} />
      <span className={`${s.name} caps`}>{play.name}</span>
    </div>
  );
});
