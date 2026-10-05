// Playbook clipboard (copy/paste of formations, sets and plays — within and across playbooks) plus a CPU-weights
// clipboard. A vanilla zustand store persisted to sessionStorage (survives reloads, not new tabs); the paste rules
// are pure and tested. React components read the store with `useStore(clipboardStore, selector)`.
import { createStore } from "zustand/vanilla";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Catalog } from "./catalog";
import type { LibraryIndex } from "./library";
import { maddenName, norm } from "./names";
import { deepClone, getFormation, getSet, insertFormations, insertPlays, insertSets, setsOf, type EntryRef } from "./playbook";
import { bookSide } from "./resolveBook";
import type { FormationDef, FormationEntry, PlayEntry, PlaybookSpec, SetEntry, Side } from "./types";

export type ClipKind = "formation" | "set" | "plays";

export type ClipEntry = FormationEntry | SetEntry | PlayEntry;

export interface ClipItem {
  id: string;
  kind: ClipKind;
  /** Playbook the entries were copied from. */
  sourcePath: string;
  /** Short description, e.g. "Shotgun · Y Trips Wk (17 plays)". */
  label: string;
  /** Deep clones of the copied entries (unknown keys included). */
  entries: ClipEntry[];
  /** Where plays/sets came from (display only). */
  from?: string;
  time: number;
}

export interface WeightsClip {
  cpu: Record<string, number>;
  /** Play the weights were copied from. */
  from: string;
}

export interface ClipboardState {
  items: ClipItem[];
  weights?: WeightsClip;
  /** Add an item at the top (oldest dropped past CLIPBOARD_LIMIT). */
  push(item: Omit<ClipItem, "id" | "time">): ClipItem;
  remove(id: string): void;
  clear(): void;
  setWeights(w: WeightsClip | undefined): void;
}

export const CLIPBOARD_LIMIT = 12;

let seq = 0;
const newId = () => `clip-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** Session storage when available (browser); a no-op store elsewhere (tests). */
const storage = createJSONStorage<Pick<ClipboardState, "items" | "weights">>(() =>
  typeof sessionStorage !== "undefined"
    ? sessionStorage
    : { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
);

export const clipboardStore = createStore<ClipboardState>()(
  persist(
    (set, get) => ({
      items: [],
      weights: undefined,
      push(item) {
        const full: ClipItem = { ...item, entries: item.entries.map((e) => deepClone(e)), id: newId(), time: Date.now() };
        set({ items: [full, ...get().items].slice(0, CLIPBOARD_LIMIT) });
        return full;
      },
      remove(id) {
        set({ items: get().items.filter((i) => i.id !== id) });
      },
      clear() {
        set({ items: [], weights: undefined });
      },
      setWeights(w) {
        set({ weights: w ? { cpu: { ...w.cpu }, from: w.from } : undefined });
      },
    }),
    {
      name: "pbstudio.clipboard",
      version: 1,
      storage,
      partialize: (s) => ({ items: s.items, weights: s.weights }),
    },
  ),
);

/** Label for a copied group, e.g. "3 plays" / "Shotgun" / "Y Trips Wk + 1". */
export function clipLabel(kind: ClipKind, entries: ClipEntry[]): string {
  const names = entries.map((e) =>
    kind === "formation" ? (e as FormationEntry).formation : kind === "set" ? (e as SetEntry).set : (e as PlayEntry).play,
  );
  if (kind === "plays") return names.length === 1 ? String(names[0]) : `${names.length} plays`;
  return names.length === 1 ? String(names[0]) : `${names[0]} + ${names.length - 1}`;
}

// ───────────────────────────── paste rules ─────────────────────────────

export interface PasteSkip {
  label: string;
  reason: string;
}

export interface PasteResult {
  /** Refs of inserted entries (new entries only, not merged-into ones). */
  added: EntryRef[];
  /** Plays/sets merged into an existing set/formation of the same name. */
  merged: string[];
  skipped: PasteSkip[];
  /** Audible slots dropped because the target set already uses them. */
  droppedAudibles: string[];
  /** Hard failure (nothing pasted), e.g. "select a set to paste plays into". */
  error?: string;
}

const emptyResult = (): PasteResult => ({ added: [], merged: [], skipped: [], droppedAudibles: [] });

/**
 * Explicit sets need a formation the game-side builder finds by name. Since commit ac54574 tools/pbook-build.mjs
 * resolves formation names by the playbook's side (offense "Special" is Offense/Special), so only a formation that
 * another formation of the same side shadows can't be addressed.
 */
function formationNameProblem(lib: LibraryIndex, formation: FormationDef, side: Side): string | undefined {
  return lib.formationByName(formation.name, side)?.asset === formation.asset
    ? undefined
    : `Formation "${maddenName(formation.name)}" shares its name with another ${side} formation; the game-side builder can't select this one`;
}

/**
 * Paste plays into set (f, s): each play must resolve by name in that set (library or custom); plays already in the
 * set are skipped; audible slots the set already uses are dropped from the pasted entries. Inserts after `afterP`
 * (default: the end). Mutates the spec (draft).
 */
function pastePlaysInto(
  spec: PlaybookSpec,
  catalog: Catalog,
  f: number,
  s: number,
  entries: PlayEntry[],
  afterP: number | undefined,
  out: PasteResult,
): void {
  const lib = catalog.lib;
  const fe = getFormation(spec, f)!;
  const se = getSet(spec, f, s)!;
  const formation = lib.formationByName(String(fe.formation ?? ""), bookSide(spec));
  const set = formation ? lib.setByName(formation, String(se.set ?? "")) : undefined;
  if (!set) {
    out.skipped.push(...entries.map((e) => ({ label: maddenName(String(e.play)), reason: `${maddenName(String(se.set))} doesn't resolve in ${maddenName(String(fe.formation))}` })));
    return;
  }
  const present = new Set(
    (se.plays ?? []).map((e) => catalog.playInSetByName(set.asset, String(e.play ?? ""))?.key ?? `name:${norm(String(e.play ?? ""))}`),
  );
  const usedSlots = new Set((se.plays ?? []).map((e) => e.audible).filter((a) => a !== undefined));
  const accepted: PlayEntry[] = [];
  for (const e of entries) {
    const play = catalog.playInSetByName(set.asset, String(e.play ?? ""));
    if (!play) {
      out.skipped.push({ label: maddenName(String(e.play)), reason: `not a play in ${maddenName(set.name)}` });
      continue;
    }
    if (present.has(play.key)) {
      out.skipped.push({ label: maddenName(String(e.play)), reason: `already in ${maddenName(set.name)}` });
      continue;
    }
    present.add(play.key);
    const c = deepClone(e);
    if (c.audible !== undefined) {
      if (usedSlots.has(c.audible)) {
        out.droppedAudibles.push(`${maddenName(String(c.play))} (audible ${c.audible})`);
        delete c.audible;
      } else usedSlots.add(c.audible);
    }
    accepted.push(c);
  }
  if (!accepted.length) return;
  const at = afterP === undefined ? undefined : afterP + 1;
  const idx = insertPlays(spec, f, s, accepted, at);
  out.added.push(...idx.map((p) => ({ f, s, p })));
}

/**
 * Paste sets into formation f: each set must resolve by name in that formation. A set the formation already has
 * receives the pasted plays instead (merge). Inserts after `afterS` (default: the end).
 */
function pasteSetsInto(
  spec: PlaybookSpec,
  catalog: Catalog,
  f: number,
  entries: SetEntry[],
  afterS: number | undefined,
  out: PasteResult,
): void {
  const lib = catalog.lib;
  const fe = getFormation(spec, f)!;
  if (!Array.isArray(fe.sets)) {
    out.error = `${maddenName(String(fe.formation))} is a template section — convert it to explicit sets before pasting into it`;
    return;
  }
  const formation = lib.formationByName(String(fe.formation ?? ""), bookSide(spec));
  if (!formation) {
    out.error = `Formation "${maddenName(String(fe.formation))}" doesn't resolve`;
    return;
  }
  const addressProblem = formationNameProblem(lib, formation, bookSide(spec));
  if (addressProblem) {
    out.error = addressProblem;
    return;
  }
  let insertAt = afterS === undefined ? fe.sets.length : afterS + 1;
  for (const e of entries) {
    const set = lib.setByName(formation, String(e.set ?? ""));
    if (!set) {
      out.skipped.push({ label: maddenName(String(e.set)), reason: `not a set of ${maddenName(formation.name)}` });
      continue;
    }
    const existing = setsOf(fe).findIndex((x) => lib.setByName(formation, String(x.set ?? ""))?.asset === set.asset);
    if (existing >= 0) {
      const before = out.added.length;
      pastePlaysInto(spec, catalog, f, existing, (e.plays ?? []) as PlayEntry[], undefined, out);
      out.merged.push(`${maddenName(set.name)} (+${out.added.length - before} plays)`);
      continue;
    }
    const [s] = insertSets(spec, f, [e], insertAt);
    insertAt = s + 1;
    out.added.push({ f, s });
  }
}

/**
 * Paste a clipboard item at a selection (FORMATS.md §2 resolution rules):
 * - formations → the formations list (after the selected formation; with the book root selected, before the
 *   template sections). A formation the book already has receives the pasted sets (merge). Formations of the other
 *   side are skipped.
 * - sets → the selected formation (or the selected set/play's formation), if the set resolves there.
 * - plays → the selected set (or the selected play's set), if they resolve in it; others are skipped.
 * Mutates `spec` (an immer draft). Returns what happened, for the toast.
 */
export function pasteInto(spec: PlaybookSpec, catalog: Catalog, item: Pick<ClipItem, "kind" | "entries">, target: EntryRef | undefined): PasteResult {
  const out = emptyResult();
  const lib = catalog.lib;
  const side = bookSide(spec);
  spec.formations ??= [];

  if (item.kind === "formation") {
    let at = target ? target.f + 1 : undefined;
    for (const e of item.entries as FormationEntry[]) {
      const formation = lib.formationByName(String(e.formation ?? ""), side);
      if (!formation) {
        out.skipped.push({ label: maddenName(String(e.formation)), reason: "unknown formation" });
        continue;
      }
      const fSide = lib.formationSide(formation);
      if (fSide !== "special" && fSide !== side) {
        out.skipped.push({ label: maddenName(formation.name), reason: `${fSide} formation in a ${side} playbook` });
        continue;
      }
      // Explicit sets need a formation the game-side builder finds by name; a "template" section is copied by id.
      const addressProblem = e.sets === "template" ? undefined : formationNameProblem(lib, formation, side);
      if (addressProblem) {
        out.skipped.push({ label: maddenName(formation.name), reason: addressProblem });
        continue;
      }
      const existing = spec.formations.findIndex((x) => lib.formationByName(String(x.formation ?? ""), side)?.asset === formation.asset);
      if (existing >= 0) {
        const cur = spec.formations[existing];
        if (e.sets === "template" || cur.sets === "template") {
          out.skipped.push({ label: maddenName(formation.name), reason: "already in this playbook" });
          continue;
        }
        const before = out.added.length;
        pasteSetsInto(spec, catalog, existing, (e.sets ?? []) as SetEntry[], undefined, out);
        out.merged.push(`${maddenName(formation.name)} (+${out.added.length - before})`);
        continue;
      }
      const [f] = insertFormations(spec, [e], at);
      at = f + 1;
      out.added.push({ f });
    }
    return out;
  }

  if (!target) {
    out.error = item.kind === "set" ? "Select a formation to paste sets into" : "Select a set to paste plays into";
    return out;
  }

  if (item.kind === "set") {
    const fe = getFormation(spec, target.f);
    if (!fe) {
      out.error = "Select a formation to paste sets into";
      return out;
    }
    pasteSetsInto(spec, catalog, target.f, item.entries as SetEntry[], target.s, out);
    return out;
  }

  // plays
  if (target.s === undefined || !getSet(spec, target.f, target.s)) {
    out.error = "Select a set to paste plays into";
    return out;
  }
  pastePlaysInto(spec, catalog, target.f, target.s, item.entries as PlayEntry[], target.p, out);
  return out;
}

/** One-line summary of a paste for a toast; undefined when nothing happened. */
export function pasteSummary(r: PasteResult): { message: string; detail?: string; level: "success" | "warning" | "error" } {
  if (r.error) return { message: "Can't Paste Here", detail: r.error, level: "error" };
  const parts: string[] = [];
  if (r.added.length) {
    const n = r.added.length;
    const what = r.added.every((a) => a.p !== undefined) ? "play" : r.added.every((a) => a.s !== undefined) ? "set" : r.added.every((a) => a.s === undefined) ? "formation" : "entry";
    parts.push(`Pasted ${n} ${what === "entry" ? (n === 1 ? "entry" : "entries") : `${what}${n === 1 ? "" : "s"}`}`);
  }
  if (r.merged.length) parts.push(`merged into ${r.merged.join(", ")}`);
  const details: string[] = [];
  if (r.skipped.length) details.push(`Skipped: ${r.skipped.map((s) => `${s.label} — ${s.reason}`).join("; ")}`);
  if (r.droppedAudibles.length) details.push(`Audible slot already used: ${r.droppedAudibles.join(", ")}`);
  if (!parts.length) return { message: "Nothing Pasted", detail: details.join("\n") || undefined, level: "warning" };
  return {
    message: parts.join(", "),
    detail: details.join("\n") || undefined,
    level: details.length ? "warning" : "success",
  };
}
