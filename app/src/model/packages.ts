// Personnel packages of a set (EBX Set.packages → SetPackage { name, packagePositions [{ order, position, Depth }] }).
// In game they are the Packages menu at the play call: each one swaps who lines up in some slots ("HB Sub" puts HB2 at
// halfback, "Slot Gadget" a gadget player in the slot). The list order is the menu order. A custom set can replace the
// whole list (CustomSetSpec.packages); SetBuilder writes it into the set it builds.
import type { LibraryIndex } from "./library";
import { positionCode, positionKey, positionName, slotLabel } from "./positions";
import type { AlignmentPos, CustomSetSpec, PackagePosition, SetDef, SetPackage } from "./types";

/** The packages a custom set ends up with: its own list, else the starting set's. */
export function packagesOf(base: Pick<SetDef, "packages">, spec?: Pick<CustomSetSpec, "packages">): SetPackage[] {
  return Array.isArray(spec?.packages) ? spec!.packages! : (base.packages ?? []);
}

/** A new package: everyone as in the set's Normal alignment (then the user swaps the slots that change). */
export function newPackage(normal: readonly AlignmentPos[], name: string): SetPackage {
  return { name, positions: normal.map((a, slot) => ({ slot, pos: a.pos, depth: a.depth || 1 })) };
}

/** The package's positions in slot order, filling slots it doesn't list from the Normal alignment. */
export function packageSlots(pkg: SetPackage, normal: readonly AlignmentPos[]): PackagePosition[] {
  return normal.map((a, slot) => pkg.positions.find((q) => q.slot === slot) ?? { slot, pos: a.pos, depth: a.depth || 1 });
}

/** What the package changes against Normal: "HB1 → HB2", "SL1 → GAD1"… (empty = same players). */
export function packageChanges(pkg: SetPackage, normal: readonly AlignmentPos[]): string[] {
  const out: string[] = [];
  for (const q of packageSlots(pkg, normal)) {
    const a = normal[q.slot];
    if (!a) continue;
    if (positionKey(a.pos) === positionKey(q.pos) && (a.depth || 1) === q.depth) continue;
    out.push(`${packageLabel(a.pos, a.depth || 1)} → ${packageLabel(q.pos, q.depth)}`);
  }
  return out;
}

/** Short label for a package slot: "HB2", "QB2" (a backup QB), "Power HB", "3rd Down HB", "GAD". */
export function packageLabel(pos: string, depth: number): string {
  if (pos === "POSITION_PWHB") return depth > 1 ? `Power HB${depth}` : "Power HB";
  if (pos === "POSITION_3DRB") return depth > 1 ? `3rd Down HB${depth}` : "3rd Down HB";
  const l = slotLabel(pos, depth);
  return depth > 1 && !/\d$/.test(l) ? `${l}${depth}` : l;
}

/** A free package name ("Package", "Package 2"…). */
export function uniquePackageName(list: readonly SetPackage[], base = "Package"): string {
  const taken = new Set(list.map((p) => p.name.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

/** Move a package up (-1) or down (+1) in the menu order. */
export function movePackage(list: readonly SetPackage[], index: number, by: -1 | 1): SetPackage[] {
  const to = index + by;
  if (to < 0 || to >= list.length) return [...list];
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

const OFFENSE_CODES = new Set(["QB", "HB", "FB", "WR", "SL", "TE", "GAD", "LT", "LG", "C", "RG", "RT"]);

const isOffenseSet = (s: Pick<SetDef, "movements">) => (s.movements.Normal ?? []).some((a) => a.pos === "POSITION_QB");

/**
 * Positions a package can put in a slot: every position the game's own packages (and alignments) use on this side of
 * the ball, as the raw enum values the game uses (POSITION_LASTKEYOFFENSE for the tight end, POSITION_GAD…).
 */
export function packagePositionOptions(lib: LibraryIndex, offense: boolean): { value: string; label: string }[] {
  const seen = new Set<string>();
  for (const s of lib.data.sets) {
    if (isOffenseSet(s) !== offense) continue;
    for (const pk of s.packages ?? []) for (const q of pk.positions) seen.add(q.pos);
    for (const a of s.movements.Normal ?? []) seen.add(a.pos);
  }
  // Offense: skill players and the line only (special-teams sets also hold a QB, so their K / LS / defenders leak in).
  if (offense) for (const pos of [...seen]) if (!OFFENSE_CODES.has(positionCode(pos))) seen.delete(pos);
  // One option per position: the game spells some several ways (POSITION_TE / POSITION_LASTKEYOFFENSE); keep the
  // spelling its packages use most, i.e. the first one met in package data.
  const byKey = new Map<string, string>();
  for (const pos of seen) {
    const key = positionKey(pos);
    if (!byKey.has(key)) byKey.set(key, pos);
  }
  return [...byKey.values()].map((pos) => ({ value: pos, label: `${positionName(pos)} (${slotLabel(pos, 0)})` })).sort((a, b) => a.label.localeCompare(b.label));
}

export { isOffenseSet };
