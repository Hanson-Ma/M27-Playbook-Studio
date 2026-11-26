// "Edit Set" on one of the game's own sets. A library set can't be changed in place (FORMATS.md §5), so editing it
// makes a custom set that STANDS IN for it: same name, same formation, the library set as its base. Set names resolve
// custom-first inside a formation (library.ts setByName, tools/pbook-build.mjs setByName), so every playbook entry
// that named the library set now gets the custom one, with no change to the playbook.
//
// A playbook entry's plays then resolve inside the custom set, which only has the plays cloned into it. So the copy
// clones every play the playbooks list in that set: a library play as a plain clone, an edited copy (a custom play in
// playbooks/plays/) as a clone of its base carrying its edits (players, reads, vip…), under the same in-game name.
// Pure: no React, no stores.
import type { Catalog } from "./catalog";
import { slugify } from "./concepts";
import { leaf, norm } from "./names";
import { bookSide } from "./resolveBook";
import { cloneEntries, librarySetLeaves, customSetAssets, suggestAsset } from "./sets";
import type { CloneSpec, CustomPlaySpec, CustomSetSpec, PlaysFile, SetDef, SetsFile } from "./types";

export interface StandInDocs {
  /** Every playbook (path + parsed spec); `first` is listed first so its plays come first in the set. */
  playbooks: readonly { path: string; data: unknown }[];
  /** playbooks/plays/*.json (to copy an edited play's changes into its clone). */
  plays: readonly { path: string; data: PlaysFile | null | undefined }[];
  /** playbooks/sets/*.json (asset names already taken). */
  sets: readonly { path: string; data: SetsFile | null | undefined }[];
}

export interface StandInPlan {
  spec: CustomSetSpec;
  /** Playbooks that list the set (they all get the copy). */
  books: string[];
  /** Clones of edited plays (custom plays), carrying their changes. */
  edited: number;
  /** Play names a playbook lists in the set that don't resolve there (left out; they were already broken). */
  missing: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Play names listed for `set` in a playbook (explicit entries only; template sections aren't editable). */
function namesInBook(spec: unknown, catalog: Catalog, set: SetDef): string[] {
  if (!isObj(spec) || !Array.isArray(spec.formations)) return [];
  const lib = catalog.lib;
  const side = bookSide(spec as never);
  const out: string[] = [];
  for (const fe of spec.formations as unknown[]) {
    if (!isObj(fe) || !Array.isArray(fe.sets)) continue;
    const formation = lib.formationByName(str(fe.formation), side);
    if (!formation) continue;
    for (const se of fe.sets as unknown[]) {
      if (!isObj(se) || !Array.isArray(se.plays)) continue;
      if (lib.setByName(formation, str(se.set))?.asset !== set.asset) continue;
      for (const pe of se.plays as unknown[]) if (isObj(pe) && str(pe.play).trim()) out.push(str(pe.play));
    }
  }
  return out;
}

/**
 * The custom set that stands in for library set `set`, cloning the plays every playbook lists in it. `first` (the
 * playbook "Edit Set" was clicked in) is read first, so its plays lead the list. Throws when `set` isn't a library set.
 */
export function standInSet(set: SetDef, catalog: Catalog, docs: StandInDocs, opts: { prefix: string; first?: string }): StandInPlan {
  const stock = catalog.lib.stock ?? catalog.lib;
  if (!stock.setByAsset.has(set.asset) || catalog.lib.isCustomSet(set.asset)) throw new Error(`${set.name} isn't one of the game's sets`);

  const books = [...docs.playbooks].sort((a, b) => Number(b.path === opts.first) - Number(a.path === opts.first));
  const seen = new Set<string>();
  const names: string[] = [];
  const using: string[] = [];
  for (const b of books) {
    const listed = namesInBook(b.data, catalog, set);
    if (listed.length) using.push(b.path);
    for (const n of listed) {
      const k = norm(n);
      if (seen.has(k)) continue;
      seen.add(k);
      names.push(n);
    }
  }

  const playsDoc = new Map(docs.plays.map((d) => [d.path, d.data]));
  const missing: string[] = [];
  const sources: { asset: string; name: string; from: string; extra?: Record<string, unknown> }[] = [];
  for (const n of names) {
    const rp = catalog.playInSetByName(set.asset, n);
    if (!rp) {
      missing.push(n);
      continue;
    }
    if (rp.source === "library") {
      sources.push({ asset: rp.asset, name: rp.name, from: rp.asset });
      continue;
    }
    // An edited copy: clone its base and carry its changes (every §3 field it has; name/asset/base are the clone's own).
    const spec: CustomPlaySpec | undefined = rp.file && rp.index !== undefined ? playsDoc.get(rp.file)?.plays?.[rp.index] : undefined;
    if (!spec || typeof spec.base !== "string") {
      missing.push(n);
      continue;
    }
    const { name, asset, base, ...extra } = spec;
    sources.push({ asset: str(asset) || leaf(base), name: str(name) || rp.name, from: base, extra });
  }

  const taken = new Set([...customSetAssets([...docs.sets]), ...librarySetLeaves(stock)]);
  const asset = suggestAsset(opts.prefix, set.name, taken);
  const spec: CustomSetSpec = { name: set.name, asset, base: set.asset, formation: set.formation };
  const entries = cloneEntries(sources, { name: set.name, plays: [] }, opts.prefix);
  const plays: CloneSpec[] = entries.map((e, i) => ({ from: sources[i].from, name: e.name, asset: e.asset, ...sources[i].extra }));
  if (plays.length) spec.plays = plays;
  return { spec, books: using, edited: sources.filter((s) => s.extra).length, missing };
}

/** Where "Edit Set" writes the copy: the sets file named after the playbook (FUSION → playbooks/sets/fusion-sets.json). */
export function standInSetsFile(bookName: string): string {
  return `playbooks/sets/${slugify(String(bookName || "playbook")) || "playbook"}-sets.json`;
}
