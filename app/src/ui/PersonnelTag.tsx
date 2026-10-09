// Offensive personnel chip ("11", "12", "10"…): backs then tight ends, the way coaches and Madden players name a
// set's personnel. Renders nothing for an unknown personnel (defense, special teams).
import { cx } from "./cx";
import s from "./PersonnelTag.module.css";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "1 back, 2 tight ends, 2 receivers" for a personnel code. */
export function personnelHint(code: string): string {
  const backs = Number(code[0]);
  const tes = Number(code[1]);
  const wrs = 5 - backs - tes;
  return `${code} personnel: ${plural(backs, "back", "backs")}, ${plural(tes, "tight end", "tight ends")}, ${plural(wrs, "receiver", "receivers")}`;
}

/** `spell` writes "Personnel" out in full (headers); the default "PERS" is for cards, and `bare` is just the number (tight rows). */
export function PersonnelTag({ code, size = "sm", spell, bare, className }: { code: string | undefined; size?: "sm" | "md"; spell?: boolean; bare?: boolean; className?: string }) {
  if (!code) return null;
  return (
    <span className={cx(s.tag, className)} data-size={size} title={personnelHint(code)}>
      {code}
      {!bare && <span className={s.unit}>{spell ? "Personnel" : "PERS"}</span>}
    </span>
  );
}
