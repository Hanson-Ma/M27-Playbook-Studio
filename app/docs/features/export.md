# Feature: Export & validation (`#/export`)

> **v1 brief (round 2) — partly superseded.** v2 (ARCHITECTURE.md "★ v2 direction") made the app keyboard + mouse
> only: every pad / legend / glyph / bumper / single-letter-key instruction below is obsolete (controller glyphs remain
> only for audible slots), "formation-ambiguous" / special-teams caveats are gone (the game-side builder resolves names
> by side), and custom sets now build. Current behaviour: the in-app Help (`src/views/help/content/`).

Owns: `src/views/export/**`, `src/model/validate.ts` (+ test), `src/model/exportSummary.ts` (+ test), `src/model/zip.ts` (+ test).
Brief: WEB_APP_PROMPT.md §6. Validate everything against FORMATS.md and explain the game-PC export.

## 1. `model/validate.ts` — `validateAll({ playbooks, plays, sets, concepts }, catalog) → ValidationIssue[]` (file + where + rule)
- Playbooks: reuse `playbookIssues()` from `model/resolveBook.ts`.
- Plays files (FORMATS.md §3 "Rules the editor must enforce"): `plays` array present; name present and unique within
  its set (vs library + custom); asset `[A-Za-z0-9_]` and unique within the set folder (vs library leaves in that folder
  and other custom plays); base exists and is a library play (the set is implied); playType ∈ OffensePlayType; blocking
  leaf exists among library blocking assets (warning only — e.g. "ReverseBlocking" is valid but unused by library
  plays); runHole integer 0–9; vip a valid eligible slot; `players` keys are integers within the set's slot count;
  string player specs resolve (library assignment or authored `PBS/<name>`); new specs: `new` `[A-Za-z0-9_]`, `steps`
  array, every step type known (prefixes of `enums.fields` keys ∪ step types in assignments.json), every enum field
  value legal (`lib.enumForField` + `lib.enumValues`), numeric fields finite, `keep` ≤ template length, template
  resolves; mechanics pairing: the base slot has mechanics and the new steps drop them (keep < mechanics prefix) →
  error; the same `new` name defined twice with different steps → warning (the builder reuses the first); reads `pos`
  valid slots, `pct` 0–1. Also surface every `ResolvedPlay.problems` from the catalog (dedupe with your own checks).
- Sets files (FORMATS.md §5): base set exists; formation exists or is defined in the file; 11 players; 7 on the line;
  OL spacing; QB/HB depth class; clone plays exist in the base set; names/assets valid. Add one info issue per file:
  "game-side support planned — export.ps1 ignores playbooks/sets/ for now".
- Concepts: tags pointing at unknown categories or unknown plays → warning.

## 2. `model/exportSummary.ts`
`exportSummary(catalog, docs)` → `{ saves: [{ file, saveName ("PBOOKOFF-<NAME>", PBOOKDEF for defense), formations,
sets, plays, templateSections, audibles, cpuRows }], customPlays: [{ file, name, set, asset }], pulled: [{ name, set,
asset, usedBy: book files }], unresolved: [...] }`, mirroring `tools/export.ps1` + `tools/pbook-build.mjs` (read both:
every `playbooks/*.json` except mod.json becomes a save; all `playbooks/plays/*.json` merge into ONE mod; non-global
library plays used by any playbook are pulled into the mod). Note the pbook-build "Special" ambiguity (see
`formation-ambiguous` in resolveBook.ts) in the summary when it applies.

## 3. `model/zip.ts`
Build a .zip (fflate `zipSync`) of `playbooks/**.json` and `app-data/*.json` from the CURRENT docs (`serializeDoc`),
plus a `README.txt` with the export command and next steps. Returns Uint8Array. Test: round-trip with `unzipSync`.

## 4. ExportView (`#/export`)
- Big status header: "READY TO EXPORT" (green) / "3 ERRORS" (red) / warnings count.
- Left: VALIDATE ALL (live; grouped by file then severity with counts, filter by severity). Clicking an issue navigates
  to the owning editor: playbook → `#/playbook/<path>?f=&s=&p=` (from `where`), plays → `#/designer/<file>/<index>`,
  sets → `#/formations/<file>/<index>`, concepts → `#/concepts`. Dirty docs list with "Save all".
- EXPORT button (X) = confirm listing every file it will write (when anything is unsaved), `refresh()` (files changed
  on disk are flagged, never overwritten — the conflict dialog offers reload / overwrite / save a copy), `saveAll()`,
  re-validate, then show the summary. The header is red ("N ERRORS" / "BUILD WOULD FAIL") whenever a save would make
  tools/pbook-build.mjs throw (export.ps1 stops at the first failing playbook, so nothing is built), amber "READY WITH
  WARNINGS" when template sections copy nothing (offense "Special" until pbook-build resolves formations by side).
- Right: summary cards — PLAYBOOK SAVES that will be built, CUSTOM PLAYS the mod will contain, LIBRARY PLAYS the mod
  will pull in, with counts and expandable lists.
- The exact command in a copyable code block: `powershell -ExecutionPolicy Bypass -File tools\export.ps1 -Install`.
- "Download export bundle (.zip)" (for when the repo isn't synced).
- "What happens next": the game PC turns everything into ONE mod `mods/pbstudio.fbmod` (add or refresh it in MMC Mod
  Manager, then Apply); it builds one save per playbook `PBOOKOFF-<NAME>`, installed to `Documents\Madden NFL 27\saves`
  (pick it in-game as a custom playbook); nothing goes into Frosty Editor by hand; offline modes only (MMC rules).
- Legend: A OPEN ISSUE (RIGHT works too), X EXPORT, Y DOWNLOAD ZIP, RS COPY COMMAND, LT/RT FILTER, UP/DOWN SELECT
  ISSUE, LS EXPAND LISTS, B BACK. The right stick scrolls the summary column (`data-pad-scroll`). The result dialog
  uses the same buttons.
- Capacity meters count every row the save gets (template sections as pbook-build resolves them, plus the template CPU
  rows explicit plays without `cpu` inherit); over capacity is an error.
