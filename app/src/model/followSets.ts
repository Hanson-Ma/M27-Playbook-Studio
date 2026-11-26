// Playbooks name their formations and sets (FORMATS.md §2), but a custom set's identity is its asset. When the user
// renames a custom set, moves it to another formation, or renames a custom formation, the playbook entries that named
// it must follow, or they fall back to the game's set of the old name (a stand-in, see standInSet.ts) or stop
// resolving, and the playbook shows the set twice. These helpers find what changed between two versions of a sets
// file (matched by asset) and rewrite the references: playbook entries, and the PlayKeys of plays cloned into a set
// that moved (custom plays based on a clone, clones copied from it). Pure: no React, no stores.
import type { LibraryIndex } from "./library";
import { folder, norm } from "./names";
import { bookSide } from "./resolveBook";
import { customFormationAsset } from "./sets";
import type { Asset, FormationEntry, PlaybookSpec, PlaysFile, SetEntry, SetsFile } from "./types";

/** A custom set whose name and/or formation changed (same asset). Formations are full asset paths. */
export interface SetMove {
  asset: string;
  from: { formation: Asset; name: string };
  to: { formation: Asset; name: string };
}

/** A custom formation whose name changed (same asset). */
export interface FormationRename {
  asset: Asset;
  from: string;
  to: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const fullFormation = (ref: string) => (ref.includes("/") ? ref : customFormationAsset(ref));
const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

type Ident = { formation: Asset; name: string };

/** A sets file's sets grouped by asset (lowercase), in file order. */
function byAsset(file: SetsFile | null | undefined): Map<string, Ident[]> {
  const out = new Map<string, Ident[]>();
  for (const s of listOf(file?.sets)) {
    if (!isObj(s) || !str(s.asset) || !str(s.formation)) continue;
    const k = str(s.asset).toLowerCase();
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push({ formation: fullFormation(str(s.formation)), name: str(s.name) });
  }
  return out;
}

/**
 * Custom sets whose name or formation differs between two versions of a sets file. A set is matched by its asset; the
 * same asset may be used in several formations (FUSION's FUS_Bunch_TE in Singleback and Shotgun), so those pair up in
 * file order (editing a name or formation never reorders sets), and only while their count is unchanged.
 */
export function setMoves(prev: SetsFile | null | undefined, next: SetsFile | null | undefined): SetMove[] {
  const before = byAsset(prev);
  const out: SetMove[] = [];
  for (const [k, now] of byAsset(next)) {
    const was = before.get(k);
    if (!was || was.length !== now.length) continue;
    now.forEach((to, i) => {
      const from = was[i];
      if (from.formation.toLowerCase() !== to.formation.toLowerCase() || from.name !== to.name) out.push({ asset: k, from, to });
    });
  }
  // Use the asset as written in the file (the set folder's letter case).
  const written = new Map(listOf(next?.sets).flatMap((s) => (isObj(s) && str(s.asset) ? [[str(s.asset).toLowerCase(), str(s.asset)] as const] : [])));
  return out.map((m) => ({ ...m, asset: written.get(m.asset) ?? m.asset }));
}

/** Custom formations (matched by asset) whose name differs between two versions of a sets file. */
export function formationRenames(prev: SetsFile | null | undefined, next: SetsFile | null | undefined): FormationRename[] {
  const before = new Map<string, string>();
  for (const f of listOf(prev?.formations)) if (isObj(f) && str(f.asset)) before.set(str(f.asset).toLowerCase(), str(f.name));
  const out: FormationRename[] = [];
  for (const f of listOf(next?.formations)) {
    if (!isObj(f) || !str(f.asset)) continue;
    const from = before.get(str(f.asset).toLowerCase());
    if (from !== undefined && from !== str(f.name)) out.push({ asset: customFormationAsset(str(f.asset)), from, to: str(f.name) });
  }
  return out;
}

/**
 * Point a playbook's set entries for `move` at the set's new name, and when it changed formation, move them under that
 * formation (an existing entry for it, else a new one right after the old one; an old formation entry left with no sets
 * goes away). `prevLib` resolves the playbook as it was (with the set's old name/formation), `nextLib` as it is now;
 * `formationName` is what the playbook should call the new formation. Mutates `book` (an immer draft or a plain object).
 * Returns the set entries changed.
 */
export function followSetMove(book: PlaybookSpec, move: SetMove, prevLib: LibraryIndex, nextLib: LibraryIndex, formationName: string): number {
  if (!isObj(book) || !Array.isArray(book.formations)) return 0;
  const side = bookSide(book);
  const setAsset = `${folder(move.from.formation)}${move.asset}/${move.asset}`.toLowerCase();
  const sameFormation = move.from.formation.toLowerCase() === move.to.formation.toLowerCase();
  let changed = 0;
  // Walk a snapshot: moving entries edits the list.
  for (const fe of [...book.formations]) {
    if (!isObj(fe) || !Array.isArray(fe.sets)) continue;
    const formation = prevLib.formationByName(str(fe.formation), side);
    if (formation?.asset.toLowerCase() !== move.from.formation.toLowerCase()) continue;
    const moving: SetEntry[] = [];
    for (const se of fe.sets as unknown[]) {
      if (!isObj(se) || norm(str(se.set)) !== norm(move.from.name)) continue;
      // Only entries that were this set (not another custom set that has the same name).
      const was = prevLib.setByName(formation, str(se.set));
      if (was && prevLib.isCustomSet(was.asset) && was.asset.toLowerCase() !== setAsset) continue;
      (se as SetEntry).set = move.to.name;
      changed++;
      if (!sameFormation) moving.push(se as SetEntry);
    }
    if (!moving.length) continue;
    fe.sets = (fe.sets as SetEntry[]).filter((se) => !moving.includes(se));
    let target = book.formations.find(
      (x) => x !== fe && isObj(x) && Array.isArray(x.sets) && nextLib.formationByName(str(x.formation), side)?.asset.toLowerCase() === move.to.formation.toLowerCase(),
    );
    if (!target) {
      target = { formation: formationName, sets: [] } as FormationEntry;
      book.formations.splice(book.formations.indexOf(fe) + 1, 0, target);
    }
    (target.sets as SetEntry[]).push(...moving);
    if (!fe.sets.length) book.formations.splice(book.formations.indexOf(fe), 1);
  }
  return changed;
}

/** Point a playbook's formation entries for a renamed custom formation at its new name. Returns entries changed. */
export function followFormationRename(book: PlaybookSpec, rename: FormationRename, prevLib: LibraryIndex): number {
  if (!isObj(book) || !Array.isArray(book.formations)) return 0;
  const side = bookSide(book);
  let changed = 0;
  for (const fe of book.formations) {
    if (!isObj(fe) || norm(str(fe.formation)) !== norm(rename.from)) continue;
    if (prevLib.formationByName(str(fe.formation), side)?.asset.toLowerCase() !== rename.asset.toLowerCase()) continue;
    fe.formation = rename.to;
    changed++;
  }
  return changed;
}

/** The folder a custom set's clones live in (their PlayKeys start with it). */
export const setFolder = (formation: Asset, asset: string) => `${folder(formation)}${asset}/`;

const moveKey = (key: string, from: string, to: string) => (key.toLowerCase().startsWith(from.toLowerCase()) ? to + key.slice(from.length) : undefined);

/** Custom plays based on a clone of a set that moved: point their base at the clone's new PlayKey. Returns plays changed. */
export function rebasePlays(file: PlaysFile, fromFolder: string, toFolder: string): number {
  let n = 0;
  for (const p of listOf(file?.plays)) {
    if (!isObj(p)) continue;
    const next = moveKey(str(p.base), fromFolder, toFolder);
    if (next !== undefined) {
      p.base = next;
      n++;
    }
  }
  return n;
}

/** Clones copied from a clone of a set that moved: point their `from` at the new PlayKey. Returns clones changed. */
export function rebaseClones(file: SetsFile, fromFolder: string, toFolder: string): number {
  let n = 0;
  for (const s of listOf(file?.sets)) {
    if (!isObj(s)) continue;
    for (const c of listOf(s.plays)) {
      if (!isObj(c)) continue;
      const next = moveKey(str(c.from), fromFolder, toFolder);
      if (next !== undefined) {
        c.from = next;
        n++;
      }
    }
  }
  return n;
}
