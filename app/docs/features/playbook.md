# Feature: Playbook builder (`#/playbook`)

> **v1 brief (round 2) — partly superseded.** v2 (ARCHITECTURE.md "★ v2 direction") made the app keyboard + mouse
> only: every pad / legend / glyph / bumper / single-letter-key instruction below is obsolete (controller glyphs remain
> only for audible slots), "formation-ambiguous" / special-teams caveats are gone (the game-side builder resolves names
> by side), and custom sets now build. Current behaviour: the in-app Help (`src/views/help/content/`).

Owns: `src/views/playbook/**`, `src/model/playbook.ts` (+ test), `src/model/clipboard.ts`, `src/model/tdb.ts` (+ test).
Brief: WEB_APP_PROMPT.md §2 ("ship this first"). Edits `playbooks/<name>.json` (FORMATS.md §2). Must round-trip
`playbooks/studio-test.json` and `playbooks/studio-lib.json` unchanged in meaning.
Use `resolvePlaybook` / `playbookIssues` / `bookSide` (model/resolveBook.ts) and `addPlayToSpec` / `assignAudible` /
`locatePlay` (model/playbookOps.ts) — don't reimplement them.

## 1. Picker (`#/playbook`)
- Madden-style tiles for every playbook doc: name, side, counts (resolvePlaybook), needs-mod count, dirty dot, notes
  excerpt, error state for docs that failed to load (`data === null`, `error`).
- New playbook (promptDialog → `sanitizeBookName`; file `playbooks/<lowercase name>.json`; side offense; formations =
  `Goal Line Offense`, `Special`, `Kickoff`, `Safety Kickoff` as `"template"`); "New from stock template" (§6); Duplicate;
  Rename (file + `name`); Delete (confirmDialog → `workspace.remove`, a soft delete). Open → `#/playbook/<path>`;
  remember `settings.lastPlaybook`. Pad: d-pad move, A open, X new, Y duplicate.

## 2. Builder (`#/playbook/<path>[?f=&s=&p=]`)
Three resizable panes (SplitPane). Set `workspace.setActive(path)` while open.
- LEFT — tree Formation → Set → Play:
  - drag-and-drop reordering at every level (pointer-based, drop indicator line, auto-scroll). A play belongs to its
    set, so moving a play into a different set is rejected with a toast; sets move only within a formation.
  - expand/collapse, multi-select (shift / mod click), keyboard + pad navigation (up/down, left/right collapse/expand,
    A select), context menu, Delete, mod+c / mod+v / mod+d (copy, paste, duplicate).
  - inline "+ Formation" (SearchSelect of formations on the book's side, hide minigames) and "+ Set" (sets of that
    formation) rows.
  - unresolved entries in red with the reason; `formation-ambiguous` warning icon on formations where the game-side
    builder would pick a different formation (e.g. "Special").
  - `"template"` formations render as locked rows (lock icon) that expand to show the template save's contents
    read-only (§6), with "Convert to explicit" (copies those contents into real entries).
  - Book header: name (validated A–Z0–9, shows the save name PBOOKOFF-<NAME>), side, notes (TextArea).
- MIDDLE — the selected set:
  - its plays in book order as PlayCards (sm), drag to reorder.
  - the AUDIBLE DIAMOND: four drop targets laid out like the face buttons (Y top, X left, B right, A bottom, using
    `settings.audibleButtons`, `AudibleGlyph` and `AUDIBLE_CATEGORY`), each showing the assigned play (mini card) or
    EMPTY. Drop a card on a target, or select a play and click a target; one play per slot (`assignAudible`); clear button.
  - the "toggle list": every play available in this set (`catalog.playsInSet(set.asset)`, library + custom) as a
    compact list with checkboxes (checked = in the book; toggling adds/removes the entry and keeps order), name filter,
    family filter chips, "only included" toggle, NEEDS MOD/CUSTOM badges.
  - selecting a formation shows its sets summary; selecting the book root shows the overview (counts, validation, notes).
- RIGHT — play inspector: PlayCard (md), formation/set, audible segmented (— 1 2 3 4 with glyphs + category), the CPU
  weights editor (SITUATION_GROUPS sections with SITUATION_LABELS; each row Slider 0–100 + NumberField; "only show set
  weights" toggle; copy weights / paste weights to the selected plays (multi-select), clear all), unknown keys of the
  entry shown read-only as JSON (they're preserved), "Open in library" and "Remove from book".

## 3. Add from library
A drawer/modal (LS / "ADD PLAYS") scoped to the selected set (or any set of the book's formations): search, family
and concept-category filters, PlayCards with multi-select, Add (model/playbook.ts ops), and drag from the drawer onto
tree sets. Plays the book can't take (`addPlayProblem`: not addressable by name by tools/pbook-build.mjs, or their
formation is a `"template"` section of this book — convert it first) are disabled with the reason. MENU still opens
Settings (the drawer stays open underneath).

Removing: Delete / Backspace, or the RS options menu (which also has Undo, Redo and Save playbook). Removing a
formation or set asks first ("SHOTGUN with 2 sets and 9 plays…"); removing a play is instant with an undo toast (pad:
hold VIEW + A runs the toast's action, VIEW + LB/RB undo/redo, VIEW + MENU saves). LS never removes anything.

## 4. Copy / paste & clipboard (`model/clipboard.ts`)
In-memory zustand store persisted to sessionStorage: items `{ kind: "formation" | "set" | "plays", sourcePath, entries
(deep clones) }`. Paste at the selection: formations → the formations list; sets → the selected formation if the set
resolves there; plays → the selected set if they resolve in it, otherwise skipped with a toast listing them. Works
across playbooks. Explicit formations / sets are refused when tools/pbook-build.mjs can't find the formation by name
(`formationAddressProblem`: offense "Special" resolves to Defense/Special there). Copying template sets / plays skips
(and lists) template plays a spec can't name. A collapsible Clipboard panel at the bottom of the left pane lists items with paste buttons.

## 5. Validation strip (always visible at the top of the builder)
Capacity meters (plays / 750, formations / 40, sets / 75, CPU rows / 2200; the template save's maxRecords when known)
count every row tools/pbook-build.mjs writes: `resolvePlaybook(spec, catalog, { template })` → `counts.saveRows`
(template sections as the builder resolves them — offense "Special" copies 0 — plus template CPU rows inherited by
explicit plays without `cpu`); over capacity is an error. Special-teams pill ("SPECIAL TEAMS: 1 BUILDS EMPTY" while
pbook-build ignores the side; the summary pill reads NO SPECIAL TEAMS), duplicate audibles, unresolvable plays,
invalid names, needs-mod count. Below ~1340 px "IN-GAME ORDER" collapses to its info icon.
Issues come from `playbookIssues()`; clicking one selects the entry from `ValidationIssue.where`. Info note: "The game
sorts formations by usage and may reorder plays; your order is kept in the file."

## 6. Template save (`model/tdb.ts`, pure, tested)
- Port the READ side of `tools/tdb.mjs` (also read `research/PHASE0_FINDINGS.md`): FBCHUNKS header → EA TDB tables,
  table index, little-endian bit-packed fields, deleted rows (top bit of the last byte; skip them). Pure TS over
  Uint8Array/DataView. Never write saves.
- Bytes come from `fetchTemplateSave()` (src/api/client.ts → `GET /api/template`).
- `templateContents(bytes, lib)` → `{ formations: [{ formation: FormationDef, sets: [{ set: SetDef, plays: [{ play:
  PlayDef, audible?, cpu? }] }] }] }`: PGFM.PBFM → `FormationDef.formId`, STID.SETL → `SetDef.setId`, PGPL.PLYL →
  `PlayDef.playId` (build the playId map locally), PGPL.Flag → audible slot via `AUDIBLE_FLAG_BITS`, PBAI rows
  (PLYL, AIGR, prct) → cpu via `SITUATION_BY_ID`; order sets/plays by `ord_` / table order.
- `templateToSpecEntries(contents, catalog, side)` → `{ entries, skipped, keptAsTemplate }` for "New from stock
  template" and `templateFormationToEntry(tf, catalog, side)` → `{ entry, skipped, problem? }` for "Convert to
  explicit": plays pbook-build can't find by name (name clashes, plays filed under another set) are skipped and
  listed in a dialog before anything is written; a formation it can't address explicitly (offense Special) stays
  `"template"` / can't be converted.
- Tests against the real `playbooks/templates/PBOOKOFF-TEMPLATE`: 11 formations, 51 live sets, 569 live plays; the
  first set is Singleback "Wing Pair" whose first play "TE Attack" has audible slot 3 (Flag 16).

## 7. `model/playbook.ts` (pure, tested)
Ops on PlaybookSpec drafts: move formation / set / play (index-based with before/after), insert entries, remove,
duplicate (deep clone keeping unknown keys), toggle a play in a set, set audible (via `assignAudible`), set / copy /
clear cpu weights, convert a template formation to explicit entries, stable React ids per entry. Tests: both example
playbooks round-trip through `serializeDoc` unchanged in meaning; every op keeps unknown keys.

All edits go through `useWorkspace.getState().update(path, draft => …, { label })` (undo/redo, dirty, mod+s).
Legend examples: A SELECT, X COPY, Y PASTE, B BACK, LT/RT PREV/NEXT SET, LS ADD PLAYS, RS OPTIONS, VIEW SWITCH PANE,
MENU SETTINGS.
New playbook (blank or from stock) pre-fills a free name (MYBOOK, MYBOOK2…), so pad A creates it at once.
