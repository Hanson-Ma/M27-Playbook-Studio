// Export bundle: a .zip of playbooks/**.json (playbooks, plays/ and sets/) + app-data/*.json built from the CURRENT
// editor state (serializeDoc, so unsaved edits are included and the text matches what Save writes), plus README.txt
// with the game-PC steps.
// For when the repo isn't synced to the game PC: unzip at the repo root, then run tools/export.ps1.
import { strToU8, zipSync, type Zippable } from "fflate";
import { EXPORT_COMMAND, MOD_FILE, SAVES_FOLDER, type ExportSummary } from "./exportSummary";
import { serializeDoc } from "./json";
import { leaf, maddenName } from "./names";
import type { DocKind } from "./types";

export interface BundleDoc {
  path: string;
  kind: DocKind;
  data: unknown;
  /** Load failure: the doc is included as its raw on-disk text (savedText) when there is one. */
  error?: string;
  savedText?: string;
  dirty?: boolean;
  isNew?: boolean;
}

export interface BundleOptions {
  /** Timestamp for README + zip entries (default now). */
  date?: Date;
  /** Adds "what will be built" to the README. */
  summary?: ExportSummary;
}

export interface BundleEntry {
  path: string;
  /** How the text was produced. */
  source: "serialized" | "raw";
  dirty: boolean;
}

/** playbooks/**.json (except playbooks/mod.json, which the app never edits) and app-data/*.json (not .trash). */
export function isBundlePath(path: string): boolean {
  if (/^playbooks\/mod\.json$/i.test(path)) return false;
  if (/^playbooks\/(?:[^/]+\/)*[^/]+\.json$/i.test(path)) return !path.split("/").some((seg) => seg === ".." || seg === ".");
  return /^app-data\/[^/]+\.json$/i.test(path);
}

/** Which docs go into the bundle, sorted by path. */
export function bundleEntries(docs: readonly BundleDoc[]): BundleEntry[] {
  return docs
    .filter((d) => isBundlePath(d.path) && (!d.error || !!d.savedText))
    .map((d): BundleEntry => ({ path: d.path, source: d.error ? "raw" : "serialized", dirty: !!(d.dirty || d.isNew) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

const pad = (n: number) => String(n).padStart(2, "0");
const count = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;
const stamp = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Download file name: pbstudio-export-20261004-1530.zip */
export function bundleFileName(date = new Date()): string {
  return `pbstudio-export-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.zip`;
}

export function bundleReadme(entries: readonly BundleEntry[], opts: BundleOptions = {}): string {
  const date = opts.date ?? new Date();
  const s = opts.summary;
  const lines: string[] = [
    "PLAYBOOK STUDIO - EXPORT BUNDLE",
    `Made ${stamp(date)} from the editor's current state (unsaved edits included).`,
    "",
    "WHAT'S INSIDE",
    ...entries.map((e) => `  ${e.path}${e.source === "raw" ? "   (copied as-is: the editor couldn't parse it)" : e.dirty ? "   (has edits not yet saved in the editor)" : ""}`),
    "  (playbooks/mod.json is not included - the editor never changes it; keep the game PC's copy.)",
    "",
    "ON THE GAME PC",
    "  1. Close Madden NFL 27.",
    "  2. Unzip this bundle into the repo root (the folder with tools\\ and playbooks\\), replacing the files.",
    "     Files you deleted or renamed in the editor are not removed by unzipping - delete the old copies there too.",
    "  3. From the repo root run:",
    `       ${EXPORT_COMMAND}`,
    `  4. Open MMC Mod Manager, add or refresh ${MOD_FILE.replace(/\//g, "\\")}, then Apply and Launch.`,
    `  5. In-game, pick the custom playbook (PBOOKOFF-<NAME>) - -Install copied it to ${SAVES_FOLDER}.`,
    "",
    "WHAT HAPPENS",
    `  - All playbooks\\sets\\*.json (custom formations, sets and the plays cloned into them) and playbooks\\plays\\*.json`,
    `    (custom plays) files are merged into ONE mod, ${MOD_FILE.replace(/\//g, "\\")}, together with any`,
    "    library plays your playbooks use that aren't in the game's global play sheet.",
    "  - Every playbooks\\*.json (except mod.json) becomes one save, PBOOKOFF-<NAME> (PBOOKDEF-<NAME> for defense),",
    "    built into build\\ and installed to the saves folder (the old save is backed up to backups\\).",
    "  - Nothing goes into Frosty Editor by hand. Offline modes only (MMC rules).",
  ];
  if (s) {
    lines.push("", "WILL BE BUILT");
    for (const save of s.saves) {
      lines.push(
        `  ${save.saveName}  <- ${save.file}: ${save.plays} plays in ${save.sets} sets / ${save.formations} formations` +
          (save.templateSections.length ? ` + template: ${save.templateSections.map(maddenName).join(", ")}` : "") +
          (save.willFail ? "  [WILL FAIL - fix the errors in Playbook Studio]" : ""),
      );
      // Why tools/pbook-build.mjs would stop on it (export.ps1 then builds nothing).
      for (const why of save.failures ?? []) lines.push(`      FAILS: ${why}`);
    }
    if (!s.saves.length) lines.push("  (no playbooks)");
    const sets = s.customSets ?? [];
    const forms = s.customFormations ?? [];
    const clones = s.clonedPlays ?? [];
    lines.push(
      `  ${MOD_FILE}: ` +
        (forms.length || sets.length || clones.length
          ? `${count(forms.length, "custom formation")}, ${count(sets.length, "custom set")}, ${count(clones.length, "cloned play")} ` +
            `from ${count((s.setsFiles ?? []).length, "sets file")}; `
          : "") +
        `${count(s.customPlays.length, "custom play")} from ${count(s.playsFiles.length, "plays file")}, ${count(s.pulled.length, "library play")} pulled in`,
    );
    for (const f of forms) lines.push(`      formation ${maddenName(f.name)} (new, from ${f.baseName ? maddenName(f.baseName) : leaf(f.base)})`);
    for (const st of sets) lines.push(`      set ${maddenName(st.formationName)} / ${maddenName(st.name)}${st.clones ? ` - ${count(st.clones, "cloned play")}` : ""}`);
    for (const note of s.notes) lines.push(`  note: ${note}`);
  }
  lines.push("");
  return lines.join("\r\n");
}

/** Build the bundle: { "playbooks/…json": serializeDoc(...), "app-data/…json": …, "README.txt" }. */
export function buildExportZip(docs: readonly BundleDoc[], opts: BundleOptions = {}): Uint8Array {
  const date = opts.date ?? new Date();
  const entries = bundleEntries(docs);
  const byPath = new Map(docs.map((d) => [d.path, d]));
  const files: Zippable = {};
  for (const e of entries) {
    const d = byPath.get(e.path)!;
    const text = e.source === "raw" ? (d.savedText ?? "") : serializeDoc(d.kind, d.data);
    files[e.path] = [strToU8(text), { mtime: date }];
  }
  files["README.txt"] = [strToU8(bundleReadme(entries, { ...opts, date })), { mtime: date }];
  return zipSync(files, { level: 6 });
}
