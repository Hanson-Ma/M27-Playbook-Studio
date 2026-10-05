# Playbook Studio — architecture & contributor contract

Playbook Studio is a web app (Vite + React 19 + TypeScript) that edits the JSON specs in `../playbooks/` and
`../app-data/`, reading the game library from `../data/library/` — either through the local Node/Vite server
(`npm run dev` / `npm start`) or, when the static build is hosted on a website, straight from the user's "2026 Playbook"
folder opened in Chrome/Edge (see Storage below and docs/HOSTING.md). The data contract is **`../docs/FORMATS.md`**
— read it first; it wins over anything here. The product brief is `../docs/WEB_APP_PROMPT.md`.

Hard rules
- Never touch `../tools/`, `../mods/`, `../build/`, `../backups/`, `../docs/FORMATS.md`, or anything game-side.
  The app only reads `../data/library/` and reads/writes `../playbooks/**.json` (except `playbooks/mod.json`) and `../app-data/*.json`.
- All repo files live outside `app/`; the server resolves them relative to the repo root (`app/..`).
- Never lose unknown JSON keys: every spec type allows `[key: string]: unknown`; edit objects in place (immer drafts)
  instead of rebuilding them from known fields.
- Pure model code (`src/model/**`) has no React/DOM imports and is unit-tested with vitest (`*.test.ts` next to the file).
- `npm run typecheck`, `npm test` and `npm run build` must pass. Don't add dependencies beyond package.json
  (react, react-dom, zustand, immer, fflate; dev: vite, vitest, typescript) without a strong reason.

## ★ v2 direction (2026-10-04) — overrides anything below that conflicts
Status: implemented (v2 integration pass, 2026-10-04). The sections below are updated to match; where an older
sentence still conflicts, this section wins.
The user reviewed v1 and asked for a **simpler, purely keyboard-and-mouse web app**:
- **No controller layer.** Remove gamepad polling, the bottom glyph legend bar, bumper glyphs on tab bars (LB/RB/LT/RT
  pills), face-button glyphs on cards, pad focus walks and chords. Every action is a visible, clickable control.
  Keyboard: only universal web conventions — ⌘/Ctrl+Z undo, ⇧⌘Z / Ctrl+Y redo, ⌘/Ctrl+S save, Esc closes dialogs/menus,
  Enter submits a dialog, Delete/Backspace removes the selected item in an editor, arrow keys inside lists/grids that
  already have keyboard focus. No single-letter shortcuts, no "press X to …" hints. `useActions` may remain only as
  an internal keyboard registry for those universal keys.
- **Controller glyphs only for audibles.** `settings.audibleStyle: "xbox" | "ps" | "keyboard"` (default "xbox")
  decides how `AudibleGlyph` draws audible slots; the switch lives next to the audible setup (builder audible diamond)
  and in Settings — not in the top bar. `settings.audibleButtons` (slot → Xbox button name) stays.
- **Simpler navigation.** Top tabs, in workflow order: PLAYBOOK · LIBRARY · DESIGNER · FORMATIONS · EXPORT, plus Help
  (?) and Settings (gear) icons. `#/playcall` (in-game preview) opens from the playbook ("Preview") and `#/concepts`
  from the playbook and the library (both buttons say "Gameplan"; the screen's title is GAMEPLAN, the tab it was
  opened from stays lit); both keep their routes but have no top tab.
  The app opens on PLAYBOOK with the default book **STUDIO = playbooks/studio-test.json** (`settings.lastPlaybook`
  default), not studio-lib.
- **Plain language + progressive disclosure.** "Primary receiver (red route)" not "VIP"; advanced controls (raw steps,
  reads percentages, asset names, release angles, keep/template) live behind "Advanced" disclosures. Empty states say
  what to do next. **One "?" per screen:** the top bar's "?" opens the Help section for the screen you're on
  (`HELP_OF` in App.tsx; a view that needs a more specific section, e.g. the play-call Audibles tab or a Settings page,
  calls `useHelpTopic(section, heading?)` instead of drawing its own "?"). Views may add *labelled* contextual links
  (`<HelpLink section label="How audibles work"/>`) that lead somewhere else, never a second icon-only "?".
- **One save status per screen:** the top bar's doc chip (App.tsx `DocChip`) is the only Saved / unsaved indicator and
  Save button: the file ⌘S saves (the view's active doc), a dot while it (filled) or another file (hollow) has unsaved
  changes, then a **Save** button or "✓ Saved". View headers don't draw their own status, Save or undo/redo buttons
  (lists of files may still mark which files are unsaved).
- **Help** (`#/help[/<section>][?h=<heading>]`): the in-app user guide (`src/views/help/content/*.md`, one file per
  section in `HELP_SECTIONS`); "Open the PDF guide" opens the printable guide built from the same Markdown
  (`npm run guide` → `public/guide/Playbook-Studio-Guide.pdf`, screenshots in `public/guide/`).
- **Game side caught up (commit ac54574):** tools/pbook-build.mjs resolves formation names BY SIDE (defense types =
  FormationType_Defense/KickReturn/Safety_KickReturn; preferring a formation the template contains, then the folder
  leaf, then the first) and includes custom formations/sets. "Special" is fine now — remove every "formation-ambiguous"
  / "special teams missing" rule and the no-side refusal. A `"template"` section whose formation has no sets in the
  template is now a hard error in pbook-build. Custom sets (FORMATS.md §5) BUILD into the same mod: new formations
  `Formations/Offense/<asset>/<asset>`, new sets `<formation folder>/<asset>/<asset>`, clones `<set folder>/<asset>`;
  playbooks reference them by name; custom plays may use a clone as `base`. Library `sets.json` now carries
  `slot` and `flipAssign` per position; presets list only the moved players, identified by `slot`.
- **Catalog overlay.** `catalog.lib` is an overlay LibraryIndex that also contains the custom formations, sets
  (effective alignment = base Normal + positions; presets = base presets with overrides; flipped spots via flipAssign)
  from every sets doc, and `catalog` resolves clones as ResolvedPlays (source "custom", in their custom set). Views
  keep using `catalog.lib` and automatically see custom formations/sets.
- **My Routes** (`app-data/routes.json`, `RoutesDoc` in types.ts, path constant `ROUTES_PATH` in model/routeLibrary.ts):
  save a drawn route from the designer, reuse it on any play/player (mirrored to the player's side).
- **Motion limits (measured from the 2,099 library motions):** waypoints stay behind the LOS (y ≤ −0.6) and no deeper
  than −11; |x| ≤ 18; 1–5 waypoints; path ≤ 25 yd (warn) / 35 yd (max); one motion man per play (warn on more); the OL
  never motions. The designer clamps drags to that region and shades it.
- **Cuts are visible.** Art draws cut style at route corners: speed cuts (22/45) rounded, hard cuts (67/90/90_INSIDE)
  sharp, double moves (STUTTER, STUTTER_STREAK, SHAKE, OUT_AND_UP, HITCH_GO_*, STICKNOD, SLANT_AND_GO, POSTCORNER) get a
  small fake mark at the vertex, turnbacks (CURL, HITCH_COMEBACK*, HINGECOMEBACK, 180*, SMASH*, SCREEN*) hook, DRAG_STOP
  ends in a settle bar. The cut picker shows the same shapes as icons.
- **Storage for hosting.** `src/api/client.ts` keeps its exports but dispatches to a backend: "server" (local Node/Vite
  API, as today) or "folder" (File System Access API on the user's "2026 Playbook" folder — reads data/library and the
  template from it, writes playbooks/** and app-data/** into it; Chrome/Edge). `src/storage/StorageGate.tsx` picks the
  backend before boot. A static `npm run build` can then be hosted on any website without uploading game data.

## Layout and ownership

```
app/
  server/            file API + library serving (node:http handlers), vite plugin, production server
  src/
    main.tsx         <StorageGate><App/></StorageGate>: pick the storage backend, then boot the app
    App.tsx          shell: top tab bar (PLAYBOOK · LIBRARY · DESIGNER · FORMATIONS · EXPORT + Help/Settings icons),
                     view switch (views are lazy-loaded chunks), global keys (undo/redo/save), loading screen, dialogs
    styles/          tokens.css (design tokens) + base.css. Read tokens.css before styling anything.
    model/           PURE TS. types.ts is the shared contract (do not change existing names; add, don't break)
    state/           zustand stores: workspace (docs + undo/redo + save), library (load + index + catalog), settings,
                     router, template
    storage/         storage backends (local server or a user-picked folder), StorageGate start screen, path rules
    input/           keyboard action registry (universal keys only) + audible glyphs (Xbox / PS5 / keyboard)
    api/             client for the file API (dispatches to the active storage backend)
    ui/              generic components (buttons, tabs, inputs, modal, virtual grid, HelpLink…) — CSS modules
    field/           Field (scaled SVG field, zoom/pan), PlayArtLayer, PlayCard, MiniRoute, CutIcon, MotionBounds
    views/<feature>/ one folder per feature view, entry component `<Name>View.tsx` (help/ holds the user guide)
```

Styling: CSS Modules (`Foo.module.css`) for every component so parallel work never collides; global CSS only in
`src/styles/`. Use the CSS variables from `tokens.css` (colors, fonts, radii, spacing) — no hard-coded colors except
inside tokens.css.

## Visual language (Madden 27 play-call screen)
Reference: the in-game play-call screen — near-black blurred-stadium background, a top tab row
`[LB] COACH SUGGESTIONS  FORMATION  CONCEPT  PLAY TYPE … [RB]` with the active tab as a light-gray rounded pill
with near-black text; play cards with a flat dark field, yellow routes, one red primary route, light-blue motion,
white player marks; under each card a colored controller glyph + the PLAY NAME in bold uppercase white +
the FORMATION/SET in uppercase gray; a blue `PASS` tag bottom-left of the art and a dark stat chip
bottom-right (`0 CALLS | 0.0 AVG YDS`); a translucent bottom legend bar listing glyph + action pairs
(`□ ✕ △ [DOUBLE TAP] ADD/REMOVE FAVORITE   R2 FLIP PLAY   L3 SUPER SIM`).
- Fonts (2026-10-04): **NB International Pro** is the one text family (`--font-sans`; `--font-display` and
  `--font-body` both point at it — keep using whichever fits the role) and **DM Mono** sets numbers and code
  (`--font-num`; `--font-mono` is the same face). Fallbacks: Helvetica Neue → Helvetica → Arial; ui-monospace → Menlo.
  - **License rule (hard):** NB International Pro is a commercial Neubau font under a print/desktop license. The app
    only NAMES it — it renders on computers where it is installed. Never put the .otf files, a webfont conversion or
    a data-URL copy in the repo, `public/`, `dist/`, a CSS file or anything uploaded. tokens.css maps each weight with
    `@font-face { src: local(...) }` rules (family "NB International Pro Local") that point at the installed copy only
    (they hold no font data; Book is weight 400 inside its file like Regular, so it maps to 350). The PDF guide may
    embed subsets (the font's embedding flag is "Print & preview"): `scripts/build-guide.mjs` hands the local files to
    the headless print page in memory. For screenshots, `scripts/qa.mjs --local-fonts` (or the `{ "localFonts": true }`
    step) loads them into the headless test browser only. DM Mono (OFL) comes from Google Fonts (`index.html`).
  - Weights: NB has 300 / 350 (Book) / 400 / 500 / 700 — use 500 (Medium) for small labels, tabs, buttons and 700
    (Bold) for names, titles, active tabs; never 600/800 (they'd snap to 700). DM Mono: 400/500.
  - **Casing (2026-10-04):** ALL CAPS only for what shows in Madden — formation and set names, play names, play types
    (keep `text-transform: uppercase` on those rules, or the global `caps` class; `Tag`/`Chip`/`TabItem` take a `caps`
    prop, `SearchSelect` takes `caps` (value + menu options) or `caps="options"`, and `SearchOption.chrome` opts an
    option out). Everything else is written in the source as it should show: Title Case for titles, tabs, buttons,
    labels, eyebrows, toast and empty-state titles; sentence case for body text, captions, hints and tooltips. Don't
    add caps tracking to mixed-case text (letter-spacing 0–0.01em).
  - Display scale `--fd-xs…--fd-3xl` (10 / 11 / 12.5 / 14 / 17 / 22 / 31 px) for labels, tabs, names and titles; the
    body scale `--fs-*` (11 … 40 px) stays for running text, inputs and menus. NB caps are ~35 % wider than the old
    Barlow Condensed, so display type runs a step smaller. Tracking for caps (Madden names): small (≤ 12.5 px)
    +0.03–0.08em, 14–17 px ≤ 0.02em, bigger titles 0 or slightly negative. No `padding-top` nudges in flex boxes (NB
    centres on its own).
  - DM Mono (`var(--font-num)` + `font-variant-numeric: tabular-nums`, letter-spacing 0) for small numbers and code:
    counts and meters (`77/750`, tree counts, tab badges, filter counts), the stat chip on play cards (`ID 4706`),
    ids, asset paths and file names, coordinate readouts, NumberField inputs, page counters, percentages. Headline
    numbers (stat tiles, `8,641 PLAYS`, the play-call count) stay in NB Bold with tabular figures; painted yard numbers
    and player labels on the field stay in NB.
- Selection = white outline + soft white glow (`--focus`). Hover = slight lift/brighten. Transitions 120–200 ms.
- Dense desktop layout, dark only. Panels `--bg-1`, cards `--bg-2`, inputs `--bg-3`, hairlines `--line`.
- Play-type tags: PASS blue, RUN red, PLAY ACTION purple, SCREEN teal, OPTION/RPO orange, SPECIAL slate, NEEDS MOD amber.
- v2: the app borrows the look, not the controller chrome — no legend bar, no bumper pills, no face-button glyphs on
  cards. The only controller glyph left is the audible slot (`AudibleGlyph`, in the user's `audibleStyle`).

## Input model — keyboard + mouse (src/input)
The app is used with a keyboard and mouse; every action is a visible, clickable control. Controller glyphs exist only
to show audible slots the way the user's pad shows them.

```ts
export interface ActionDef {
  id: string;
  label: string;
  keys?: string[];            // "mod+z" (mod = ⌘ on mac, Ctrl elsewhere), "shift+mod+z", "Enter", "Escape", "Delete",
                              // "ArrowUp"… Only universal keys ever fire: combos with ⌘/Ctrl/Alt and named keys (Enter,
                              // Esc, Delete, Backspace, arrows, PageUp/Down, Home/End, F-keys). Single printable keys
                              // ("x", "1", "?", "shift+q") are dropped.
  run: (ctx: { source: "pad" | "key" | "click"; repeat: boolean }) => void;
  enabled?: boolean;          // default true; disabled actions don't fire but still claim their keys
  repeat?: boolean;           // auto-repeat while held (arrows)
  allowInInput?: boolean;     // also fire while a text field has focus (mod+s, Escape); printable keys never do
  button?/hold?/legend?/order?/group?  // @deprecated v1 fields, ignored (an action with only `button` falls back to
                              // A → Enter, B → Escape, d-pad → arrows: BUTTON_FALLBACK_KEYS)
}
// Register while mounted (pass a fresh array every render). Later scopes win conflicts; `modal: true` blocks every
// lower scope (dialogs, menus); `front: true` moves the scope to the top while true. Returns the scope token.
export function useActions(scopeId: string, actions: ActionDef[], opts?: { modal?: boolean; front?: boolean }): number;
export function ActionLayer(p: { token: number; children: ReactNode }): JSX.Element;  // keep child scopes of an overlay active
export function runAction(token, id, ctx?): boolean; export function ensureInput(): void;
// glyphs.tsx
export function AudibleGlyph(p: { slot: 1 | 2 | 3 | 4; size?: "sm" | "md" | "lg"; mode?: InputMode }): JSX.Element;
       // settings.audibleButtons (slot → Xbox button) drawn in settings.audibleStyle ("xbox" | "ps" | "keyboard" = keys 1–4)
export function Glyph(p: { button?; buttons?; keys?; size?; title?; mode?: InputMode; className? }): JSX.Element | null;
       // without `mode`: only a keycap for a key that really works (universal combo), else nothing
export function PadGlyph(p: { button: PadButton; type: "xbox" | "ps" }); export function KeyCap(p: { combo?; label?; size? });
// inputMode.ts: useAudibleStyle(), getAudibleStyle(); AudibleStyleSwitch.tsx: <AudibleStyleSwitch size? block? iconsOnly?/>
```
- Keyboard rules (v2): ⌘/Ctrl+Z undo, ⇧⌘Z / Ctrl+Y redo, ⌘/Ctrl+S save, ⇧⌘S save all (App); Esc closes dialogs /
  menus / clears a selection; Enter submits a dialog (⌘↵ from a text field); Delete/Backspace removes the selected
  item in an editor; arrow keys only inside a list, grid, tab bar or field that already has keyboard focus. No
  single-letter shortcuts and no "press X" hints.
- The audible style switch sits next to the builder's audible diamond (step 3) and in Settings → Audibles — not in
  the top bar. `isUniversalCombo(combo)` / `bindingSignature(actions)` live in registry.ts.

Audible slots (`src/model/audibles.ts`): slot 1 Quick Pass (X/□), 2 Run (A/✕), 3 Deep Pass (Y/△), 4 Play Action (B/○)
by default, configurable in Settings. Show audibles as a face-button diamond (Y top, X left, B right, A bottom).

## Foundation APIs (implemented in round 1, consumed by every feature)

### Server (server/) — `npm run dev` serves the app and the API from one Vite process
- `GET /api/status` → `{ app: "playbook-studio" (STATUS_APP — lets a hosted copy tell our server from any other
  site's /api/status), root, library: {name,size,mtime}[], hasLibrary: boolean }`
- `GET /api/files` → `{ files: FileInfo[] }` — `playbooks/*.json` (kind "playbook", excluding `mod.json`),
  `playbooks/plays/*.json` ("plays"), `playbooks/sets/*.json` ("sets"), `app-data/concepts.json` ("concepts"),
  other `app-data/*.json` ("appdata"). Sorted by path.
- `GET /api/file?path=<repo-relative>` → file text (404 if missing)
- `PUT /api/file?path=…` (body = JSON text) → must parse; path must match an allowed pattern above; creates folders;
  atomic write (tmp + rename) → `{ ok: true, file: FileInfo }`. `GET /api/file` sends `ETag: "<mtime>-<size>"`; PUT
  honours `If-Match` (409 when the file changed or was deleted) and `If-None-Match: *` (409 when it — or a name that
  differs only in letter case — exists); nothing is written on a 409 (body `{ error, conflict, path, file? }`).
  Writes, deletes and renames run one at a time.
- `DELETE /api/file?path=…` → soft delete: moves the file to `app-data/.trash/<yyyymmdd-hhmmss>-<basename>` → `{ ok: true }`
- `POST /api/rename` `{ from, to }` → `{ ok: true, file }` (both paths allowed, `to` must not exist; honours `If-Match`
  on the source → 409 when it changed)
- `GET /library/<name>.json` → `../data/library/<name>.json` with gzip (cached in memory), ETag/304, and
  `X-Uncompressed-Length` (progress). plays.json (18 MB) goes over the wire as ~1 MB.
- PUT/POST must send `Content-Type: application/json` (the client does). Cross-origin writes → 403;
  `playbooks/mod.json` → 403 (any case); the production server only answers loopback `Host`s.
- Paths are validated (no `..`, no absolute paths, `.json` only, inside the allowed folders). The rules live in
  `src/storage/paths.ts` (`checkPath`, `pathKind`, `PathError`, `LIBRARY_FILES`, `TEMPLATE_SAVE`, `TRASH_DIR`…), shared by
  the server and the folder backend.
- `npm start` runs `server/serve.ts` (node http: dist/ + the same API) after `npm run build`.

### API client — `src/api/client.ts`
`listFiles(): Promise<FileInfo[]>`, `readText(path): Promise<string>`, `readFile(path): Promise<{ text; version? }>`,
`writeText(path, text, precondition?: { ifMatch?: FileVersion; ifAbsent?: boolean }): Promise<FileInfo>` (a refused
write rejects with `ConflictError { path, reason: "changed" | "deleted" | "exists", file? }`),
`deleteFile(path): Promise<void>`, `renameFile(from, to, precondition?: { ifMatch?: FileVersion }): Promise<FileInfo>`,
`getStatus(): Promise<ServerStatus>` (`{ app?, backend?, root, library, hasLibrary }`), `fetchLibraryFile<T>(name,
onProgress?: (loaded, total) => void): Promise<T>`, `fetchTemplateSave(): Promise<Uint8Array>`.
Every export goes to the active backend: `type StorageKind = "server" | "folder"`, `interface StorageBackend`,
`serverBackend`, `setStorageBackend(b | undefined)`, `getStorageBackend()`. Errors are `Error`s carrying the message.

### Storage (hosting) — `src/storage/`
- `StorageGate` (wraps App in main.tsx) picks the backend before boot: the local server when `/api/status` answers
  with `app: "playbook-studio"`, else the folder backend — a start screen asks for the user's "2026 Playbook" folder
  (File System Access API; desktop Chrome/Edge over https or localhost), with Reconnect for the folder remembered in
  IndexedDB (`handleStore.ts`) and wrong-folder hints (`checkFolder`). `?storage=folder|server` forces a mode.
- `createFolderBackend(root, opts?)` reads `data/library/*` and the template save from the folder and writes
  `playbooks/**` + `app-data/**` under the same path rules, conflict checks (`ConflictError`) and soft-delete trash as
  the server; writes are serialized across tabs (Web Locks). Rename = copy + delete.
- `useStorage(): { kind, label, canSwitch, switchFolder(), forgetFolder() }` (Settings → Files & data).
- `vite.config.ts` `base: "./"`: `npm run build` → `dist/` works from any sub-path of any static host; no game data is
  in the bundle. User walkthrough: docs/HOSTING.md (and the Help section "Use it from another PC").

### JSON — `src/model/json.ts`
- `parseJson<T>(text): T` (strips a BOM).
- `formatJson(value, { width = 110 }?): string` — stable, git-diffable pretty printer: objects/arrays print on one
  line when they fit in `width` (with `{ "a": 1, "b": [1, 2] }` spacing), otherwise one member per line, 2-space
  indent, trailing newline. Key order = insertion order (callers canonicalize).
- `canonicalPlaybook(spec)`, `canonicalPlaysFile(f)`, `canonicalSetsFile(f)`, `canonicalConcepts(d)` return copies with
  known keys in contract order (FORMATS.md field order; e.g. PlayEntry: play, audible, cpu; cpu keys in
  SITUATION_ORDER) and unknown keys preserved after them in their original order. Top-level files keep unknown keys
  (title, version, notes, …) first and the main array (`formations` / `plays` / `sets`) last.
- `serializeDoc(kind, data): string` = canonical + formatJson. Saving an unmodified example file must round-trip to
  the same parsed value.

### Names — `src/model/names.ts`
`norm(s)` (same as tools/pbook-build.mjs: lowercase, `[\s_]+`→" ", trim), `leaf(asset)`, `folder(asset)` (with trailing
"/"), `sanitizeBookName(s)` (A–Z0–9), `sanitizeAssetLeaf(s)` ([A-Za-z0-9_]), `uniqueName(base, taken: Set<string>)`,
`displayFromLeaf(leaf)` ("Y_Trips_Wk" → "Y Trips Wk"), `formationShort(name)` ("Shotgun" → "GUN", "Singleback" →
"SINGLEBACK", "Pistol" → "PISTOL", "I Form" → "I FORM", …) and `playSubtitle(formationName, setName)` → "GUN Y TRIPS WK".

### Workspace store — `src/state/workspace.ts` (zustand + immer)
```ts
interface DocEntry<T = unknown> { path: string; kind: DocKind; data: T /* null when error is set */; savedText: string;
  dirty: boolean; past: T[]; future: T[]; error?: string /* load failure: read-only */; isNew?: boolean }
interface WorkspaceState {
  ready: boolean; loading: boolean; files: FileInfo[]; docs: Record<string, DocEntry>; activePath?: string;
  error?: string;                         // last init()/refresh() failure
  init(): Promise<void>;                  // list files + load every doc (they're small); safe to call twice; never rejects
  refresh(): Promise<void>;               // re-list; load new/changed files; dirty docs untouched; never rejects
  setActive(path?: string): void;         // the doc that global undo/redo/save act on
  create<T>(path: string, kind: DocKind, data: T): void;     // new unsaved (dirty) doc
  update<T>(path: string, recipe: (draft: T) => void, opts?: { label?: string; coalesceMs?: number }): void;
  replace<T>(path: string, data: T, opts?: { label?: string }): void;
  undo(path?: string): void; redo(path?: string): void;      // default: activePath
  save(path?: string): Promise<void>; saveAll(): Promise<void>;
  revert(path: string): void; remove(path: string): Promise<void>; rename(from: string, to: string): Promise<void>;
}
export const useWorkspace: UseBoundStore<StoreApi<WorkspaceState>>;
export function useDoc<T>(path?: string): DocEntry<T> | undefined;
export function useDocsOfKind<T>(kind: DocKind): DocEntry<T>[];   // stable order by path; memoized (safe selector)
export function selectDocsOfKind<T>(s, kind): DocEntry<T>[];      // same, non-hook
export function docKindForPath(path): DocKind; export function anyDirty(): boolean; export function useAnyDirty(): boolean;
export const HISTORY_LIMIT = 200, DEFAULT_COALESCE_MS = 1000;
```
Conflicts: each doc keeps the disk version it was loaded/saved as (`disk`); `save()` only overwrites that version (a
never-saved doc only creates a file that doesn't exist in any letter case). A refused save records
`conflicts[path]`, flags the doc `changedOnDisk` and rejects with a ConflictError; `saveAll()` rejects with a
`SaveAllError` (`.failures`, `.conflicts`) and overwrites nothing. `refresh()` also runs on window focus / tab
visibility (≤ 1/s): clean docs whose file changed reload, edited ones get `changedOnDisk`.
`resolveConflict(path, "reload" | "overwrite" | "copy")` settles it (reload keeps your edits one undo away; copy saves
`<name>-copy.json`). The App's ConflictDialog (src/ConflictDialog.tsx) opens on every refused save — Reload from
disk, Overwrite, Save a copy, Later (buttons) — and the DocChip shows a "CHANGED ON DISK" marker that reopens it.
`create`/`rename` refuse a path that matches an existing doc or file ignoring letter case.
History: up to 200 snapshots per doc (immer structural sharing); consecutive updates with the same `label` inside
`coalesceMs` (default 1000, sliding) merge into one undo step (drags, typing). `dirty` = serialized data ≠ savedText.
- Doc data is **deep-frozen**: mutate only through `update`/`replace` (whatever you pass to `create`/`replace` is frozen too).
- Docs that failed to load have `data === null` + `error`; `useDocsOfKind` still returns them — check `error` first.
- `save()` is a no-op for clean docs and rejects with the server message on failure; `saveAll()` rejects listing every
  failure. `revert` is undoable. `rename` saves a dirty doc first; history + activePath follow it. `create` throws if
  the path exists. The store registers the `beforeunload` unsaved-changes prompt itself.

### Library + catalog — `src/model/library.ts`, `src/model/catalog.ts`, `src/model/sets.ts`, `src/state/library.ts`
```ts
interface LibraryIndex {
  data: LibraryData;
  formationByAsset: Map<Asset, FormationDef>; setByAsset: Map<Asset, SetDef>; playByAsset: Map<Asset, PlayDef>;
  setsByFormation: Map<Asset, SetDef[]>; playsBySet: Map<Asset, PlayDef[]>;   // library plays only (clones: catalog)
  assignmentsByRouteType: Map<string, Asset[]>;
  formationOfSet(set): FormationDef | undefined; assignment(assetOrPath): AssignmentDef | undefined;
  enumValues(enumName): string[]; enumForField(stepType, field): string | undefined;
  formationByName(name, side?, opts?: { preferFormIds?: ReadonlySet<number> }): FormationDef | undefined;
      // = tools/pbook-build.mjs formByName: filter by side (defense = FormationType_Defense / _KickReturn /
      // _Safety_KickReturn, everything else offense), then a formId the template save contains, then the folder-leaf
      // match, then the first. No side = every side (old behaviour).
  setByName(formation, name): SetDef | undefined;   // inside the formation's folder; stock before custom
  formationSide(f): Side | "special"; isMinigame(f): boolean;
  stock: LibraryIndex;                 // the plain game library (the index itself when not an overlay)
  customAssets: ReadonlySet<Asset>; isCustom(a); isCustomFormation(a); isCustomSet(a);
}
function buildLibraryIndex(data: LibraryData): LibraryIndex;
function overlayLibraryIndex(base, { formations?, sets? }): LibraryIndex;   // custom formations/sets resolve like stock
                                                                            // ones (stock first); plays/assignments shared
const DEFENSE_FORMATION_TYPES; function formationBookSide(f): Side;

interface Catalog {
  lib: LibraryIndex;                   // the OVERLAY (stock + custom formations/sets of every sets doc); the same object
                                       // while only plays docs change
  get(key): ResolvedPlay | undefined;  // clones, then custom plays, then library
  playsInSet(set): ResolvedPlay[];     // library (data order), clones, custom plays (file order)
  playInSetByName(set, name);          // norm() compare; library beats clone beats custom (pbook-build order)
  custom: ResolvedPlay[];              // custom plays (playbooks/plays/)
  clones: ResolvedPlay[]; cloneByKey;  // plays cloned into custom sets (source "custom", ResolvedPlay.clone =
                                       // { file: sets file, setIndex, index }; play.index is undefined for clones)
  customAssets; customOrigin: Map<Asset, { kind: "formation" | "set"; file; index }>; customDefs;
  authored: Map<string, AuthoredAssignment>;   // `new` name → first definition (clones are built first)
  version: number;
}
function buildCatalog(lib, playsDocs: { path; data: PlaysFile }[], setsDocs?: { path; data: SetsFile }[]): Catalog;
function catalogOverlay(lib, setsDocs): CatalogOverlay;
function resolveCustomPlay(lib, spec, file, index, authored, clones?): ResolvedPlay;  // base may be a clone
function resolveLibraryPlay(lib, p): ResolvedPlay;   // memoized per stock index: stable identity across overlays
// state/library.ts
useLibrary(): { status; progress; lib?: LibraryIndex /* stock */; error?; load() }
useCatalog(): Catalog | undefined;   // one shared instance from the plays AND sets docs in the workspace
getCatalog(): Catalog | undefined;   // same instance, non-hook
```
- Views use `catalog.lib` and automatically see custom formations/sets (CUSTOM / CUSTOM SET badges via
  `lib.isCustomFormation/isCustomSet` or `catalog.customAssets`).
- `model/sets.ts` mirrors tools/PlayDump/SetBuilder.cs (FORMATS.md §5): `effectiveAlignment`, `flippedAlignment`,
  `flipPartner`, `flippedSet`, `presetSlots`, `canPatchPreset`, `patchPosition`, `patchPreset` (only slots the base
  preset already moves; presets can't be added — `availablePresetKeys` is `[]`), `diffPositions`,
  `customFormationAsset(leaf)` (`Formations/Offense/<leaf>/<leaf>`), `customSetAsset(spec)`, `cloneAsset(set, leaf)`,
  `gameId(name, taken?)` (formId/setId/playId exactly as the builder), `buildCustomSetDef`, `customDefs`,
  `alignmentIssues` (errors: not 11 players, not exactly 7 non-QB players with y > −1.5 (`LINE_Y`); warnings: OL off
  `OL_SPOTS` ± `OL_SPOT_TOLERANCE`, OL depth changed by > `OL_DEPTH_TOLERANCE`, QB/back depth class, flip partners),
  `cloneWarnings(lib, play, normal)` (alignment-dependent assignments measured against the play's OWN set; blocks only
  for QB/backs/line — moving receivers is safe), and `validateSetsFile` — THE §5 rulebook (Formations editor and Export).
- `setsByFormation` only holds sets inside the formation's folder (5on5 flag sets are only in `setByAsset`).
- Library `ResolvedSlot.steps` point at the library's arrays — never mutate them.
- Catalog problems: unknown base (library play or clone), base in another set (or filed outside its set folder), bad
  slot keys, missing assignments/templates, `keep` past the template, dropped handoff mechanics, duplicate asset/name
  (custom vs custom, vs clones and vs library), bad leaf names, vip/runHole out of range, extra reads, conflicting
  `new` redefinitions.
Custom play resolution follows FORMATS.md §3 exactly: slots start from the base play's assignments; a string
player spec → library assignment at ASSIGNMENT_ROOT + path (or an authored "PBS/<name>"); a `new` spec → the first
`keep` steps of (`template` ?? base slot), then `steps`, then a trailing None. vip/reads/playType/runHole fall back to
the base; `blocking` leaf → BLOCKING_ROOT + leaf. Custom PlayKey = folder(base.set) + spec.asset.
`mechanics` = slot contains CannedHandoff/HandOffTurn/HandOffGive/HandoffFake/OptionHandoff/PitchBall/OptionRun/
RecievePitch/RecUserHandoff steps.

### Steps & geometry — `src/model/steps.ts`, `src/model/geometry.ts`, `src/model/positions.ts`, `src/model/playtypes.ts`
- steps.ts: `isLeg(step)` (RunRoute/MoveDirection/ReceiveHandoff/RecievePitch), `MECHANICS_TYPES`, `hasMechanics(steps)`,
  `stripNone(steps)`, `withNone(steps)`, `stepSummary(step): string` (e.g. "Run 7 yd @ 90° · 100%", "Cut R 45°",
  "Get open"), `cloneSteps(steps)`, `stepsEqual(a, b)`.
- geometry.ts: `polar(deg, dist): Vec`, `add`, `sub`, `len`, `angleDeg(dx, dy)` (0..360), `normDeg`, `mirrorX(v)`,
  `mirrorDeg(d)` (180 − d), `snapGrid(v, step)`, `snapAngle(deg, step)`, `round1(n)`.
- positions.ts: `slotLabel(pos, depth)` (QB, HB, FB, WR1, SL1, TE1, LT, LG, C, RG, RT, LE, DT, RE, LOLB, MLB, ROLB,
  CB1, FS, SS, K, P…; aliases: FIRSTOFFENSELINE=LT, LASTOFFENSELINE/LASTOFFENSE=RT, LASTKEYOFFENSE=TE, 3DRB/PWHB=HB,
  SLWR=SL, FIRSTDEFENSELINE/FIRSTDEFENSE=LE, LASTDEFENSELINE=DT, FIRSTDEFENSELB/FIRSTDEFENSESEC=LOLB,
  LASTDEFENSELB=ROLB, FIRSTDEFENSEDB=CB, LASTDEFENSE*/LASTDEFENSESEC/LASTDEFENSEDB=SS, LASTNORMAL=LS,
  MAXNORMAL/FIRSTSPECIAL/FIRSTKPRETURN=KR, LASTKPRETURN=PR, LASTSPECIAL=SLCB=NB, SLB, NT…),
  `positionName(pos)`, `glyphFor(alignment): PlayerGlyph`, `isEligible(slot, alignment)`.
- playtypes.ts: `playTypeInfo(type) → { label: "PASS"|"RUN"|"PLAY ACTION"|"SCREEN"|"RPO"|"OPTION"|"SPECIAL"|"DEFENSE"…,
  family: "pass"|"run"|"pa"|"screen"|"option"|"rpo"|"special"|"defense"|"other", color: CSS var name, long: string }`.

### Play art — `src/model/art.ts`, `src/model/zones.ts`
`computeArt(set: SetDef, slots: Step[][], opts?: ArtOptions): PlayArt` and `artForPlay(catalog, play, opts?)`
(memoized by key + catalog.version + opts). Rules (FORMATS.md "Play art is generated by the game from these steps"):
start at the Normal alignment (or the chosen preset), apply `OverrideFormPos` (absolute x/y), walk the steps:
`RunRoute`/`MoveDirection`/`ReceiveHandoff`/`RecievePitch`/`HeadTurnRunRoute` are vectors (distance @ direction);
`AutoMotion` waypoints are absolute (motion, light blue; the route continues from the last waypoint); `ReceiverCut`
marks a vertex (curl/hitch/180 cuts at the end of a route draw a short hook back); `GetOpen`/`Delay` end or pause;
`RunEndZone` extends the ballcarrier upfield; `PassBlock`/`RunBlock` = short gray T; `LeadBlock` = gray path to the
gap (A–E/OUTSIDE or RUN_HOLE via runHole; odd = left, even = right) with a T cap (after a `*_PULL` InitialAnim it
pulls flat behind the line first); `QBScramble` = white drop by dropBackType (or rollout direction/distance);
handoff steps = short white QB path to the mesh. Kinds/colors per types.ts ArtKind: routes yellow, vip red, ballcarrier
red, blocks gray, motion light blue (presets dashed), QB white. Defense: zones (ZoneNum → ellipse), PassRush/blitz red,
man coverage marker. `flip` mirrors x, directions (180 − d), cut L/R, gap Left/Right and runHole odd/even.

ArtPath conventions (as built; the renderer and designer depend on them):
- Paths are grouped by slot in slot order; within a slot: `preset` (Normal → preset spot, dashed, arrow) → `realign`
  (OverrideFormPos / DefMovement, dotted) → `motion` (AutoMotion waypoints; consecutive motions merge) → the main
  path → `option` (pitch man, dashed). Each path starts where the previous one ended.
- Main kinds: `run` = ballcarrier (RunEndZone runner who receives the ball, or an option QB); `qb` = drops / handoff
  turns / rollouts; `block` (cap "block" = T) = any path ending in Pass/Run/Lead/WedgeBlock (`label "PULL"` after a
  *_PULL); `route`, or `primary` for the vip slot (offense only). Defense: `rush` (PassRush, ≥ 2.5 yd), `coverage`
  (defender → zone centre, cap none; ManCoverage = 1.5 yd stub, cap "dot", label "MAN") + an `ArtZone` per zone step.
- Vertices: one per leg end (`step` set), one per ReceiverCut/RunRouteFakeOut (same point index, `cut` + `cutDir`),
  one per motion waypoint (waypoint k = points[k+1]). Generated geometry (hooks, run extensions, pulls, stubs) has none.
- OL PassBlock is hidden unless `showPassPro` (cards hide it). Bounds are unpadded and can be large (routes up to
  ~58 yd) — cards use a fixed viewport (`cardViewport(side)`), not the bounds.
- Extra exports: `emptyArt(flipped?)`, `isTurnBackCut`, `holeX`, `gapX`, `GAP_X`, `qbDropVector`, `findBallcarriers`,
  `artSideForPlay(catalog, play)` (offense/defense for art; special teams by formation type — what artForPlay uses);
  zones.ts: `zoneSpec(zoneNum)`, `ZONE_STEPS`, `spyZone(from)`.
- Known gaps: OptionHandoff/PitchBall/FaceDirection/DefAlignment draw nothing; WedgeBlock ignores offsets; field goals
  and a few minigame plays have no art; defenders are drawn at the set alignment (no adjustment to receivers).
- v2 cut styles: every cut / fake-out vertex carries `style?: CutStyle` ("speed" | "hard" | "fake" | "turnback" |
  "settle"; `cutStyle(cutType)`, `CUT_STYLE_INFO` labels + hints). Speed cuts (22/45) draw rounded, hard cuts
  (67/90/90_INSIDE) sharp with a tick, double moves (STUTTER, SHAKE, OUT_AND_UP, HITCH_GO_*, STICKNOD, SLANT_AND_GO,
  POSTCORNER, Juke*/FakeOut) a small zig, turn-backs hook, DRAG_STOP ends on an arrow + settle bar ("→|").
- Motion presets match players by `slot` (`matchPreset`), falling back to (pos, depth).
- Flipped plays: `artForPlay` applies the set's flipAssign partners (`withFlipPartners(art, set)`: same mirrored
  geometry, but the player drawn on each spot is the partner — e.g. flipped Y Trips Wk keeps WR1 on the left).
  `computeArt({ flip })` stays a pure mirror (the designer's "Flip view").

### Field rendering — `src/field/`
```tsx
<Field viewport?: FieldViewport (ArtBounds + optional `depth`; default sideline±1, y −12…24); depth?: DepthScale;
       padding?: number; fit?: "contain"|"cover"; coordsPosition?: "top-left"|"top-right"|"bottom-left"|"bottom-right";
       interactive?: boolean (wheel/pinch zoom at cursor, drag pan, double-click reset); ballSpot?: BallSpot;
       showCoords?: boolean; firstDown?: number; losYardLine?: number (35); markings?: "full"|"minimal"|"none";
       size?: { width; height } (skip measuring; otherwise the parent must have a size); minZoom? (0.4); maxZoom? (14);
       onFieldPointer?: (e: FieldPointerEvent) => void; onFieldDoubleClick?: (field: Vec, e: MouseEvent) => void;
       className?; style?; label?; children (SVG in yard coords)>
// FieldPointerEvent { type: "down"|"move"|"up"|"click"|"cancel"|"leave"; field: Vec; raw: PointerEvent }. Pointers are
// captured; e.raw.preventDefault() on "down" stops the pan; "click" only fires for presses no child claimed.
// A new viewport value resets zoom/pan.
// The SVG user unit is one yard. SVG y points down, field y points up: children convert with toSvg(v) / sy(y)
// from field/fieldMath.ts (sy(y) = -y) so text stays upright.
// useFieldTransform() inside children → { toSvg(v), toField(clientX, clientY): Vec, pxPerYard, depth } (pxPerYard
// tracks the rendered size/zoom so caps, glyphs and labels can be sized in screen pixels). Cards compress depth
// (`cardViewport(side).depth`): true to scale to 8 yd past the line, then eased toward the top edge (the deep backfield
// likewise), so every library route ends inside the card; paths past a sideline stop 0.6 yd inside it. Anything drawn
// on a card field must go through `toSvg` / `depth` (true field yards in, compressed SVG out).
<PlayArtLayer art: PlayArt; highlightSlot?; selectedSlot?; onPlayerPointerDown?(slot, e); onPlayerHover?(slot | undefined);
              showLabels?; dimOthers?; compact?; showPlayers? (true); showZones? (true);
              showSlots? ("3·WR1" labels; default !compact); cutStyles? (true: cut geometry from field/cutGeometry.ts) />
// only players are hit-testable. Labels draw last on opaque pills, each placed at one of eight spots that avoids its
// own path, other players/labels/routes and the view edge. Detail marks scale with the zoom: artMetrics(compact, ppy)
// (k = clamp(ppy/14, 1, 1.9)). Cards never draw OL pass pro (whatever showPassPro says).
<PlayCard play: ResolvedPlay; art?: PlayArt (default artForPlay(catalog, play, { flip })); leading?: ReactNode (left of the
          name, e.g. an AudibleGlyph; nothing by default); subtitle?: string;
          selected?; size?: "sm"|"md"|"lg"; stat?: ReactNode; badges?: ReactNode; autoBadges? (true: CUSTOM / NEEDS MOD);
          flip?: boolean; ballSpot?; muted?; onClick?(e); onDoubleClick?(e); draggable?; onDragStart?; onDragEnd?; className?; style? />
// width follows the container (set widths in your grid); CARD_ASPECT = 2.15; cardSubtitle(play, catalog?);
// cardViewport(side) returns the same frozen object per side (safe to pass inline to <Field viewport>)
<MiniRoute set: SetDef; slot: number; steps: Step[]; size? (72); flip?; primary?; preset?; selected?; title?; onClick?;
           compressDepth? (false: true scale keeps break angles readable) />
// miniRouteArt(set, slot, steps, opts) = engine art for one slot (falls back to lightSlotArt)
<CutIcon cutType: string; dir?: "left" | "right"; size? (28); title?; className? />   // stem + turn/fake/hook icon
<MotionBounds visible? (true); from?: Vec; usedYards?: number; label?; className? />
// shaded motion area (|x| ≤ 18, y −11…−0.6) + reach rings (25 yd warn / 35 yd max minus yards used): motionReach()
// cutGeometry.ts: cutCorners(path), drawCutPath(points, corners, sizes, opts?), cutSizes(metrics, ppy, compact?)
```
Also exported from `field/index.ts`: `PathShape`, `fieldMarkings`, `useFieldTransform`, `FieldContext`,
`staticFieldTransform(vb, w, h)` (box-relative px), `lightSlotArt`, `ArtGallery`, and everything in `fieldMath.ts`
(`sy`, `toSvg`, `fromSvg`, `fitViewBox`, `boundsToViewBox`, `zoomAt`, `panBy`, `formatCoord`, `unionBounds`, …).
Field look: flat `--field-bg` with subtle alternating 5-yard bands, yard lines every 5 (major every 10),
NFL hash ticks at x = ±3.08 (relative to the middle; ball on the left/right hash shifts the field), side numbers
(10, 20, … rotated like painted field numbers), LOS line, optional first-down line (muted orange, under the paths), sidelines.
Accurate scale (53.33 yd wide). Coordinates readout (x, y to 0.1 yd) on hover/drag when `showCoords`.

### Router, settings, UI kit
- `state/router.ts`: `useRoute(): Route` (`{ view: ViewId; parts: string[] (decoded); query: URLSearchParams; hash }`),
  `getRoute()`, `navigate(hashOrView, { replace? })`, `href(view, ...parts)` (encodes each part), `VIEW_IDS`
  (incl. "help"), `DEFAULT_VIEW = "playbook"` (unknown and empty routes land there). Each tab's last sub-route is
  remembered (`rememberRoute`, `rememberedHash(view)`, `lastMainHash()`; clicking the active tab → its root); closing
  Settings or Help returns to the last main view; App rewrites remembered routes when a doc is renamed and drops them
  when it's deleted (`rewriteRememberedPath(from, to?)`).
- `state/settings.ts` (`useSettings`, persisted in localStorage `pbstudio.settings` (`SETTINGS_KEY`), version 2,
  re-read when another tab writes it): `audibleStyle` ("xbox" | "ps" | "keyboard", default "xbox"),
  `audibleButtons: Record<AudibleSlot, PadButton>`, `assetPrefix` ("PBS_"), `ballSpot`, `showPassPro`,
  `hideMinigames`, `favorites`, `recents` (60), `lastPlaybook?` (default `DEFAULT_PLAYBOOK` =
  "playbooks/studio-test.json"), `lastPlaysFile?`; `set(partial)`, `toggleFavorite(key)`, `pushRecent(key)`,
  `resetAudibleButtons()`. `migrateSettings(persisted, version)`: v1 `inputMode` → `audibleStyle`; a missing or
  studio-lib `lastPlaybook` → STUDIO.
- `ui/index.ts` barrel (CSS modules, controlled components: `value` + `onChange(value)` — a value, not an event):
  `Button` (variant/size/icon/iconRight/loading/active/block), `IconButton` (icon, title, shortcut — only universal keys
  are shown), `TabBar` (items, active, onChange, size; ←/→/Home/End move between tabs while one has focus),
  `Tag`/`PlayTypeTag`/`NeedsModTag`/`Chip`, `Panel`/`Toolbar`/`Spacer`/`Divider`/`Kbd`/`ScrollShadow`,
  `FormRow`/`TextInput`/`TextArea`/`Select`/`Toggle`/`Checkbox`/`Segmented`/`Slider`, `NumberField` (scrub,
  precision), `SearchSelect` (pass a memoized options array; `variant="chrome"`), `Modal` (open, onClose, onConfirm →
  Enter + ⌘↵, Esc closes; `footer={null}` hides it), `confirmDialog`/`promptDialog` (need App's `<DialogHost/>`),
  `toast.info|success|warning|error(msg, { detail, duration, action })`, `Tooltip`/`useTooltip`, `Menu`/`MenuButton`/
  `useContextMenu()` (`{ open(e, items), node }`; ↑/↓, Enter, Esc), `Floating`, `VirtualList`/`VirtualGrid` (arrow keys
  only while the list itself has focus; ref `scrollToIndex`, `focus()`), `SplitPane`, `EmptyState`/`Spinner`/
  `ProgressBar`, `ErrorBoundary`, `HelpLink` (`<HelpLink section heading? label? title?/>` → `#/help/<section>[?h=]`;
  labelled contextual links only — the screen's "?" is the top bar's), `helpHref(section, heading?)`,
  `useHelpTopic(section?, heading?)` (while mounted, the top bar's "?" opens that section; latest mount wins) /
  `useScreenHelpTopic()` (App reads it), `cx`, `Icon`.
  - `Menu`: choosing an item inside a submenu closes the whole menu chain (internal `onChoose` prop).
  - `VirtualList`/`VirtualGrid`: re-measure when switching between the `empty` placeholder and rows.
  - `Modal`: the body is `flex: 1 1 auto`, so a height set through `bodyClassName` is respected (it still shrinks and
    scrolls inside the dialog's max height). `[autofocus]`/`[data-autofocus]` picks the initially focused element.

## Shared feature helpers (written before round 2 — use them, don't reimplement)
- `src/model/resolveBook.ts`: `resolvePlaybook(spec, catalog, { template }?) → ResolvedBook { formations: [{ entry, index, formation?,
  template, problem?, custom?, wrongSide?, templateMissing?, sets: [{ entry, index, set?, custom?, problem?, plays: [{ entry,
  index, play?, problem? }] }] }], counts: { formations, sets, plays, cpuRows, templateFormations, pulled, custom,
  customFormations, customSets, unresolved } }`; never throws on wrong-shaped JSON (`malformed` / rule "book-shape");
  with `{ template }` (useTemplate().contents) `counts.saveRows` holds every row tools/pbook-build.mjs writes, `limits`
  the table capacities, and template sections get `templateRows`. Pass `{ template }` wherever capacity, template
  sections or formation names matter (builder, export, play-call, add-to-playbook).
  `playbookIssues(spec, catalog, file?, { template }?) → ValidationIssue[]` (FORMATS.md §2: names, side, unknown or
  other-side formation (`formation-side`), unknown set/play, duplicates, audible range/duplicates, cpu keys/weights,
  capacity vs `BOOK_LIMITS`, a `"template"` section the template has no sets for (`template-empty`, an error: the
  game-side builder stops), info notes for missing special teams / goal line, `needs-mod` per custom play / clone /
  pulled play, `custom-formation` / `custom-set` notes).
  Formation names resolve like pbook-build: `bookFormation(lib, name, side, { template })` (side first, then a formId
  the template contains, then the folder leaf). Also `otherSideFormation`, `templateFormIdsOf(template)`,
  `isCustomFormation(lib, f)`, `isCustomSet(lib, s)`, `isClonePlay(play)`, `templateMissingMessage(name, formId)`,
  `bookSide(spec)`; `BOOK_LIMITS`, `SPECIAL_TEAMS_FORMATIONS`, `RECOMMENDED_FORMATIONS`.
- `src/model/playbookOps.ts` (every function takes an optional `opts: { template }` last): `locatePlay(spec, catalog,
  key)`, `nameAddressProblem(catalog, key, side?)` (formation addressable by name on this side, set in the formation,
  library plays before clones before custom), `formationAddressProblem(lib, formation, side?)` (refuses other-side
  formations), `addPlayProblem(spec, catalog, key)` (plus: the formation is a `"template"` section of the book →
  "Convert … to explicit first"; use it to disable add targets), `addPlayToSpec(draftSpec, catalog, key, extra?) → { f,
  s, p, added, audibleDropped? }` (creates formation/set entries before the template sections; throws on
  addPlayProblem; drops an audible slot already taken in that set), `assignAudible(setEntry, playIndex, slot|undefined)`.
- `src/model/playRefs.ts`: `danglingPlayRefs(old, catalog, docs)`, `renamePlayInBook`, `rekeyConcepts`, `rekeyList`,
  `playKeyFor` — what still points at a renamed custom play (designer "Update everywhere").
- `src/model/routeLibrary.ts` (My Routes, `app-data/routes.json`, `ROUTES_PATH`): `routesOf(doc)`, `makeSavedRoute`,
  `canSaveRoute(steps, keep?)` (only the route part: no motion, realign or precans), `savedRouteFor(route, side)` /
  `applySavedRouteSteps(slotSteps, route, side, keep?)` (mirrored to the player's side via `model/routes.ts`
  `mirrorSteps`), `savedRouteNameBase(prefix, name, mirroredTo?)` (authored `new` name, `_Lt`/`_Rt` when mirrored),
  `addRoute`/`renameRoute`/`removeRoute`/`moveRoute`. Views: `views/designer/routesStore.ts` (`useMyRoutes`,
  `saveToMyRoutes`, …; every change saves the file at once), library Routes tab shows them read-only.
  `model/designer.ts` `applySavedRoute(state, slot, route, { prefix })` writes an authored assignment named after it.
- `src/model/routeBounds.ts` (routes that run off the field; ball in the middle, LOS on the offense's 35 —
  `LOS_YARD_LINE` in geometry.ts, shared with the field): `pointsOffField(points)`, `chainPoints(alignment, steps)`,
  `chainOffField(alignment, steps) → { edge: "left"|"right"|"deep", by, at }`, `offFieldText(o)`,
  `fitChainToField(alignment, steps, firstLeg?)` (shortens only the legs heading toward the crossed edge, by one factor:
  directions, stems and cuts stay; ends `FIT_MARGIN` = 1 yd inside). Designer: `views/designer/OffField.tsx` (Route
  tab notice + "Fit to field", "off field" marks on preset / double-move / My Routes tiles, a warning toast with a Fit
  action after applying such a route). Validation: rule `route-off-field` (warning, offense plays).
- `src/model/conceptsDoc.ts`: `CONCEPTS_PATH = "app-data/concepts.json"`, `emptyConcepts()`, `categoriesForPlay(doc, key)`,
  `categoryWithDescendants(doc, id)`, `playsInCategory(doc, id)`.
- `src/model/situations.ts`: `SITUATION_KEYS`, `SITUATION_LABELS`, `SITUATION_GROUPS`, `SITUATION_ORDER`,
  `SITUATION_IDS` / `SITUATION_BY_ID` (save PBAI.AIGR ⇄ spec key), `isSituationKey`.
- `src/model/audibles.ts`: `AUDIBLE_SLOTS`, `AUDIBLE_CATEGORY`, `DEFAULT_AUDIBLE_BUTTONS`, `AUDIBLE_FLAG_BITS` (save PGPL.Flag), `BUTTON_DIAMOND`.
- Server `GET /api/template` + client `fetchTemplateSave(): Promise<Uint8Array>` — the template playbook save
  (`playbooks/templates/PBOOKOFF-TEMPLATE`, read-only TDB) the game-side builder copies `"template"` sections from.

- `src/state/template.ts`: `useTemplate(): { status, contents?: TemplateContents, error? }` (fetches + parses the
  template save once per library), `loadTemplate(lib)`, `getTemplate()`. Pure parsing in `src/model/tdb.ts`
  (`templateContents`, `templateFormationFor`, `templateFormationCounts`, `templateSectionRows`, `templatePlayProblem`,
  `templateFormationProblem`, `templateSkippedPlays`, and the catalog-checked conversions `templateFormationToEntry(tf,
  catalog, side, { template }?) → { entry, skipped, problem? }` / `templateToSpecEntries(contents, catalog, side) → { entries, skipped,
  keptAsTemplate }` — show `skipped` to the user; `convertTemplateFormation` throws on `problem`).
  Template sections copy the template's sets of the formation `bookFormation` resolves the name to (by side, preferring
  the template's own formIds); offense "Special" converts and builds like any other section.

### Cross-view URL contract
- `#/library/play/<encodeURIComponent(key)>` — play detail.
- `#/playbook` — the last playbook, else STUDIO (`playbooks/studio-test.json`), else the first (the app's home).
- `#/playbook/<encodeURIComponent(path)>[?f=<i>&s=<i>&p=<i>]` — open a playbook, optionally selecting an entry.
- `#/help[/<section>][?h=<heading id>]` — the user guide (sections in `views/help/sections.ts`).
- `#/playcall/<encodeURIComponent(path)>` — play-call preview of a playbook.
- `#/designer/new?set=<SetAsset>&base=<PlayAsset or clone key>[&slot=<n>&assignment=<path under ASSIGNMENT_ROOT>][&file=<plays path>]`
  — start a new custom play (pre-filled wizard; optional slot assignment; a custom set + one of its clones works).
- `#/designer/<encodeURIComponent(file)>/<index>` — edit a custom play. `#/formations/<encodeURIComponent(file)>/<index>` — edit a custom set.
- `#/concepts` (`?play=<key>` focuses a play's tags; it survives creating the concepts file; `?from=library|playbook`
  sets the back link), sections
  `#/concepts/<categories|run|pass|situations|coverage>`, `#/export`.
- `#/playcall/<path>?tab=&at=&pg=&play=&flip=1` (view state; all optional), `#/settings[/editor|/data|/gallery|/art]`.
- Any view can open the Add-to-playbook dialog: `openAddToPlaybook(key)` from `views/library/AddToPlaybook.tsx` (the
  host is mounted once by App). It adds via `addPlayToSpec` in one `update`, makes the book the active doc, toasts an
  Open link to `#/playbook/<path>?f=&s=&p=`, and can create a new playbook (`newPlaybookSpec` / `playbookPathFor`).

## Feature views (round 2) — each owns `src/views/<feature>/` plus the model files listed
| view | route | owns |
|---|---|---|
| Library + play detail + route library | `#/library` | views/library, model/search.ts |
| Playbook builder | `#/playbook` | views/playbook, model/playbook.ts, model/clipboard.ts |
| Play-call preview (in-game style; opened from the playbook's "Preview in game") | `#/playcall` | views/playcall |
| Play designer + My Routes | `#/designer` | views/designer, model/routes.ts, model/designer.ts, model/routeLibrary.ts |
| Formation & set editor | `#/formations` | views/formations, model/sets.ts |
| Concepts & categories + gameplan views | `#/concepts` | views/concepts, model/concepts.ts |
| Export & validation | `#/export` | views/export, model/validate.ts, model/exportSummary.ts, model/zip.ts |
| Settings (+ `#/settings/editor`, `#/settings/data`, component gallery `#/settings/gallery`, play-art bench `#/settings/art`) | `#/settings` | views/settings (foundation) |
| Help / user guide | `#/help` | views/help (content/*.md, markdownAst.ts — a safe markdown subset) |

Features must not edit foundation files. If a foundation API is missing or broken, put a local helper in your
feature folder and list the gap in your final report.

## Round 2 integration notes (shared helpers — use these, don't copy them)
- Single sources of truth after the feature round:
  - `model/playbook.ts`: `newPlaybookSpec`, `playbookPathFor`, `saveNameFor` (exactly tools/export.ps1 `OutName`:
    PBOOKOFF-/PBOOKDEF- + name upper-cased, not sanitized; `validate.ts` re-exports it).
  - `model/sets.ts` `validateSetsFile` is THE §5 rulebook: the Formations editor and Export (`validate.setsFileIssues`,
    which only adds the unreadable/shape checks and clone catalog problems) report the same issues. The editor shows
    `set-play-depends` per copied play as `set-clone-depends` (same `cloneWarnings` logic, plus personnel notes).
  - `model/catalog.ts` `classifyPlayProblem(text) → { rule, level }` and `playProblemLevel(problems)` sit next to the
    problem texts; `playbookIssues()` (builder strip, play-call) and Export (`validate.ts`) use the same severity, so a
    custom play with only warning-level problems (e.g. a reused `new` name) is a warning everywhere.
  - `model/search.ts` `readConceptLabel` ("Concept_Four_Verticals" → "Four Verticals") is used by library, play-call
    and concepts; `model/art.ts` `artSideForPlay`.
- `ConceptsDoc.dismissed?: { [playKey]: categoryId[] }` — suggestions the user dismissed (editor-only; written after
  `notes`, keys sorted).
- Views are `React.lazy` chunks behind a `Suspense` fallback inside the view's ErrorBoundary: a view that fails to
  import shows an error in its own tab instead of breaking the shell.
- Feature model APIs (pure, tested): `search.ts` (library index/filters/route library), `playbook.ts` + `clipboard.ts` +
  `tdb.ts` (builder ops, clipboard, template save reader), `routes.ts` + `designer.ts` (route ⇄ steps, editor state ⇄
  CustomPlaySpec), `sets.ts` (custom sets), `concepts.ts` (categories, tags, suggestions, gameplan queries),
  `validate.ts` + `exportSummary.ts` + `zip.ts` (Export). `views/playcall/playcallModel.ts` holds the play-call paging/
  grouping model. Read each file's header comment for its API.
