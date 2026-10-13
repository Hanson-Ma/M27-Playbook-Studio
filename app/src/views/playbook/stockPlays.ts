// Stock plays a custom set could still take: the plays of its starting set (`base`) and of the stock set it replaced in
// the Madden 24 mod (`was`, e.g. "Gun / Doubles"), minus the ones already cloned into it. The Add Plays drawer lists them
// next to the set's own plays; adding one clones it into the custom set (sets file), then adds the clone to the playbook.
import type { Catalog } from "../../model/catalog";
import { norm } from "../../model/names";
import type { CustomSetSpec, ResolvedPlay, SetsFile } from "../../model/types";
import { cloneEntries } from "../../model/sets";
import { cloneKey } from "../formations/setModel";
import { useWorkspace } from "../../state/workspace";

const CAND = "stock:";
const SEP = "\u0000";
/** Madden 24 formation names that changed in Madden 27. */
const FORMATION_ALIAS: Record<string, string> = { gun: "shotgun" };

/** Drawer-only key for a stock play offered to a custom set (never a catalog key). */
export const candidateKey = (into: string, stockKey: string) => `${CAND}${into}${SEP}${stockKey}`;
export const isCandidate = (key: string) => key.startsWith(CAND);
export const candidateParts = (key: string): { into: string; stockKey: string } => {
  const [into, stockKey] = key.slice(CAND.length).split(SEP);
  return { into, stockKey };
};
/** The catalog key behind a drawer key (concept / category lookups). */
export const realKey = (key: string) => (isCandidate(key) ? candidateParts(key).stockKey : key);

interface Located {
  file: string;
  index: number;
  doc: SetsFile;
  spec: CustomSetSpec;
}

function locate(catalog: Catalog, setAsset: string): Located | undefined {
  const o = catalog.customOrigin.get(setAsset);
  if (o?.kind !== "set") return undefined;
  const doc = useWorkspace.getState().docs[o.file]?.data as SetsFile | null | undefined;
  const spec = doc?.sets?.[o.index];
  return doc && spec ? { file: o.file, index: o.index, doc, spec } : undefined;
}

/** The stock sets a custom set draws from: its starting set, then the stock set its Madden 24 name points at. */
function sourceSets(catalog: Catalog, spec: CustomSetSpec): string[] {
  const out = [spec.base];
  if (typeof spec.was === "string" && spec.was.includes("/")) {
    const [form, set] = spec.was.split("/").map((x) => x.trim());
    const fname = norm(form);
    const f = catalog.lib.data.formations.find((x) => catalog.lib.formationSide(x) === "offense" && norm(x.name) === (FORMATION_ALIAS[fname] ?? fname));
    const st = f ? catalog.lib.setByName(f, set) : undefined;
    if (st && !out.includes(st.asset)) out.push(st.asset);
  }
  return out;
}

/** Stock plays still free to clone into `setAsset` (empty when it isn't a custom set from a sets file). */
export function stockCandidates(catalog: Catalog, setAsset: string): ResolvedPlay[] {
  const loc = locate(catalog, setAsset);
  if (!loc) return [];
  const taken = new Set((loc.spec.plays ?? []).map((e) => e?.from));
  const out: ResolvedPlay[] = [];
  for (const src of sourceSets(catalog, loc.spec))
    for (const p of catalog.playsInSet(src)) {
      if (taken.has(p.asset)) continue;
      taken.add(p.asset);
      out.push({ ...p, key: candidateKey(setAsset, p.key) });
    }
  return out;
}

/** Clone the picked stock plays into their custom sets; returns the new clones' catalog keys (live once the doc re-resolves). */
export function cloneIntoSets(catalog: Catalog, keys: string[], prefix: string): string[] {
  const bySet = new Map<string, string[]>();
  for (const k of keys) {
    const { into, stockKey } = candidateParts(k);
    bySet.set(into, [...(bySet.get(into) ?? []), stockKey]);
  }
  const made: string[] = [];
  for (const [into, stockKeys] of bySet) {
    const loc = locate(catalog, into);
    if (!loc) continue;
    const defs = [...new Map(stockKeys.flatMap((k) => {
      const p = catalog.get(k);
      return p ? [[p.asset, { asset: p.asset, name: p.name }] as const] : [];
    })).values()];
    if (!defs.length) continue;
    // Clone leaves of every picked play, new or already there: a second Add on the same play (double click, a stale
    // picker) must reuse its clone, not make "Name 2" next to it.
    let leaves: string[] = [];
    useWorkspace.getState().update<SetsFile>(
      loc.file,
      (d) => {
        const st = d.sets[loc.index];
        const have = new Map((st.plays ?? []).map((e) => [e?.from, e] as const));
        const fresh = cloneEntries(defs.filter((p) => !have.has(p.asset)), st, prefix);
        // kept: tools/m24/convert-fusion.mjs carries these over when it regenerates the file
        for (const e of fresh) (e as { kept?: boolean }).kept = true;
        (st.plays ??= []).push(...(fresh as never[]));
        const byFrom = new Map(fresh.map((e) => [e.from, e] as const));
        leaves = defs.flatMap((p) => {
          const e = have.get(p.asset) ?? byFrom.get(p.asset);
          return e?.asset ? [e.asset] : [];
        });
      },
      { label: "Copy stock plays into set" },
    );
    for (const leaf of leaves) {
      const k = cloneKey(loc.spec, leaf, loc.doc.formations);
      if (k) made.push(k);
    }
  }
  return made;
}
