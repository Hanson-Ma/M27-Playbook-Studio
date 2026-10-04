// References to a custom play from other documents, for "rename play everywhere" (designer Name / Asset fields).
// Playbooks list plays by display name inside their set (FORMATS.md §2); concepts.json tags / notes / dismissed
// suggestions and the settings favorites / recents are keyed by PlayKey (set folder + asset). Renaming a play, or
// changing its asset, leaves those references pointing at nothing. Pure: no React, no stores.
import type { Catalog } from "./catalog";
import { folder, norm } from "./names";
import { bookSide } from "./resolveBook";
import type { Asset, ConceptsDoc, PlayKey, PlaybookSpec } from "./types";

/** The play's identity before the edit (what other documents still point at). */
export interface PlayIdentity {
  /** The play's set asset (custom plays live in their base play's set). */
  set: Asset;
  name: string;
  /** Asset leaf (spec.asset). */
  asset: string;
}

export interface PlayRefs {
  /** Playbooks with explicit entries naming the old play in its set (and the number of entries). */
  playbooks: { path: string; entries: number }[];
  /** concepts.json entries keyed by the old PlayKey: tags, notes, dismissed suggestions. */
  concepts: number;
  favorite: boolean;
  recent: boolean;
  /** Sum of everything above (0 = nothing points at the old identity). */
  total: number;
}

export const playKeyFor = (id: Pick<PlayIdentity, "set" | "asset">): PlayKey => folder(id.set) + id.asset;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * Visit every explicit play entry of `spec` that names `name` inside the set `setAsset` (names resolve like
 * tools/pbook-build.mjs: formation by name for the book's side, set inside the formation, play name via norm()).
 */
function forEachEntry(spec: unknown, catalog: Catalog, setAsset: Asset, name: string, visit: (entry: Record<string, unknown>) => void): void {
  if (!isObj(spec) || !Array.isArray(spec.formations)) return;
  const lib = catalog.lib;
  const side = bookSide(spec as PlaybookSpec);
  const want = norm(name);
  for (const fe of spec.formations as unknown[]) {
    if (!isObj(fe) || !Array.isArray(fe.sets)) continue;
    const formation = lib.formationByName(str(fe.formation), side);
    if (!formation) continue;
    for (const se of fe.sets as unknown[]) {
      if (!isObj(se) || !Array.isArray(se.plays)) continue;
      if (lib.setByName(formation, str(se.set))?.asset !== setAsset) continue;
      for (const pe of se.plays as unknown[]) if (isObj(pe) && norm(str(pe.play)) === want) visit(pe);
    }
  }
}

/**
 * What still points at `old` although it no longer resolves (the play was renamed or its asset changed). A name that
 * still resolves in the set (renamed back, or another play took it) isn't counted, nor is a key the catalog still has.
 */
export function danglingPlayRefs(
  old: PlayIdentity,
  catalog: Catalog,
  docs: { playbooks: readonly { path: string; data: unknown }[]; concepts?: ConceptsDoc | null; favorites?: readonly string[]; recents?: readonly string[] },
): PlayRefs {
  const out: PlayRefs = { playbooks: [], concepts: 0, favorite: false, recent: false, total: 0 };
  if (old.name.trim() && !catalog.playInSetByName(old.set, old.name)) {
    for (const b of docs.playbooks) {
      let n = 0;
      forEachEntry(b.data, catalog, old.set, old.name, () => n++);
      if (n) out.playbooks.push({ path: b.path, entries: n });
    }
  }
  const key = playKeyFor(old);
  if (old.asset && !catalog.get(key)) {
    const c = docs.concepts;
    if (isObj(c)) for (const field of ["tags", "notes", "dismissed"] as const) if (isObj(c[field]) && key in (c[field] as object)) out.concepts++;
    out.favorite = !!docs.favorites?.includes(key);
    out.recent = !!docs.recents?.includes(key);
  }
  out.total = out.playbooks.reduce((a, b) => a + b.entries, 0) + out.concepts + (out.favorite ? 1 : 0) + (out.recent ? 1 : 0);
  return out;
}

/** Point a playbook's entries for `old` at `newName` (immer draft or plain object). Returns the entries changed. */
export function renamePlayInBook(spec: PlaybookSpec, catalog: Catalog, old: PlayIdentity, newName: string): number {
  let n = 0;
  forEachEntry(spec, catalog, old.set, old.name, (pe) => {
    pe.play = newName;
    n++;
  });
  return n;
}

/** Move concepts.json tags / notes / dismissed from `oldKey` to `newKey` (merging tag lists). Returns entries moved. */
export function rekeyConcepts(doc: ConceptsDoc, oldKey: PlayKey, newKey: PlayKey): number {
  if (oldKey === newKey) return 0;
  let n = 0;
  for (const field of ["tags", "notes", "dismissed"] as const) {
    const rec = doc[field] as Record<string, unknown> | undefined;
    if (!isObj(rec) || !(oldKey in rec)) continue;
    const moving = rec[oldKey];
    const there = rec[newKey];
    if (Array.isArray(moving) && Array.isArray(there)) rec[newKey] = [...there, ...moving.filter((x) => !there.includes(x))];
    else if (typeof moving === "string" && typeof there === "string" && there) rec[newKey] = `${there}\n${moving}`;
    else if (there === undefined) rec[newKey] = moving;
    delete rec[oldKey];
    n++;
  }
  return n;
}

/** Replace `oldKey` with `newKey` in a key list (favorites / recents), keeping order and dropping duplicates. */
export function rekeyList(list: readonly PlayKey[], oldKey: PlayKey, newKey: PlayKey): PlayKey[] {
  const out: PlayKey[] = [];
  for (const k of list) {
    const v = k === oldKey ? newKey : k;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}
