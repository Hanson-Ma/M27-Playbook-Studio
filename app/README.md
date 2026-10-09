# Playbook Studio

A web app for designing Madden NFL 27 playbooks and custom plays. It edits the JSON specs in this repo;
the game PC turns them into a custom playbook save and one mod. The data contract is
[`../docs/FORMATS.md`](../docs/FORMATS.md), and the contributor guide is [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Two ways to run it

| mode | how | files | browsers |
|---|---|---|---|
| **Local server** | `npm run dev` (or `npm run build && npm start`) in `app/` → http://localhost:5178 | the repo the server runs in | any |
| **Hosted / folder** | `npm run build:site`, upload the contents of `app/dist/` to your website (FTP, e.g. `/public_html/playbook/`) and open it over https | the "2026 Playbook" folder you open in the browser — nothing is uploaded | Chrome or Edge (desktop) |

The app picks the mode by itself on start: if `/api/status` answers like the local server, it uses it; otherwise it
shows **Open your 2026 Playbook folder** (File System Access API), remembers the folder, and reads the library and
template save from it and saves into `playbooks/` and `app-data/` — the same files, same format, same conflict checks
as the server. Use it from the Mac and the Madden PC alike. Step-by-step publishing, browser requirements, syncing the
two computers and security notes: **[`docs/HOSTING.md`](docs/HOSTING.md)**. (Force a mode with `?storage=folder` or
`?storage=server` before the `#` in the address, e.g. http://localhost:5178/?storage=folder to try folder mode.)

## Run it locally

Requires **Node 22.18 or newer** on a supported line (22.18+, 24, 26+); developed and checked on Node 26.7.
`npm start` runs `server/serve.ts` with Node's built-in TypeScript type stripping, which is on by default from
22.18; Vite 8 needs 20.19 / 22.12+ and vitest 5 supports 22.12+, 24 and 26+ (not 23 or 25). Check with `node -v`.

```sh
cd app
npm install
npm run dev          # app + file API on http://localhost:5178
```

The port is fixed: if 5178 is already taken (say, a second copy of the app), `npm run dev` stops with an error
instead of moving to another port. Run a second copy with `npx vite --port 5179`, or `PORT=5179 npm start`.

| command | what it does |
|---|---|
| `npm run dev` | Vite dev server with the file API mounted (one process) → http://localhost:5178 |
| `npm test` | unit tests (vitest): model, store, server API |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | type-check + production build to `dist/` — a static site that works from any path (relative URLs, hash routes) |
| `npm run build:site` | `npm run build`, then checks `dist/` is ready to upload (relative links, no game data) and prints what to upload — the FTP walkthrough is [`docs/HOSTING.md`](docs/HOSTING.md) |
| `npm run preview:site` | serves the built `dist/` at http://localhost:4178/playbook/ (static, folder mode — exactly like your website) |
| `npm start` | after a build: `node server/serve.ts` serves `dist/` + the file API on port 5178 (`PORT=…` / `HOST=…` to change) |

Both servers bind to `localhost` only. The API refuses cross-origin writes and requests whose `Host` isn't a
loopback name or IP address. (To use the app from another computer, host `dist/` instead — see above.)

## Fonts

Text is set in **Public Sans** and numbers and code in **DM Mono**. Both are free (SIL Open Font License) and load from
Google Fonts, so the app needs a network connection the first time it runs; offline it falls back to the system UI
font and monospace and works the same.

## What it reads and writes

All paths are relative to the repo root (the parent of `app/`) — or, in hosted mode, to the folder you opened. The
rules are the same in both modes (`src/storage/paths.ts` is shared by the server and the browser).

| path | access | what |
|---|---|---|
| `data/library/*.json` | read | The game's play library (formations, sets, plays, assignments, enums), served gzipped from memory. Regenerate on the game PC with `PlayDump library data/library` after a game patch, then reload the app. |
| `playbooks/<name>.json` | read/write | Custom playbooks → `PBOOKOFF-<NAME>` saves (FORMATS.md §2) |
| `playbooks/plays/*.json` | read/write | Custom plays → merged into `mods/pbstudio.fbmod` (FORMATS.md §3) |
| `playbooks/sets/*.json` | read/write | Custom formations, sets and play clones (FORMATS.md §5) → built into the same mod |
| `app-data/*.json` | read/write | Editor-only data: `concepts.json` (categories and tags), notes |
| `playbooks/templates/PBOOKOFF-TEMPLATE` | read | The template playbook save ("template" sections) |
| `app-data/.trash/` | write | Deleting a file in the app moves it here as `<yyyymmdd-hhmmss>-<name>`. Restore by moving it back. |

The app never touches `playbooks/mod.json` (owned by the game-side tools), `tools/`, `mods/`, `build/` or
`backups/`.

Files are written atomically (temp file, then rename; in hosted mode the browser's own swap file) as stable,
git-diffable JSON: 2-space indent, containers
on one line when they fit in 110 columns, known keys in the FORMATS.md order, and **every unknown key preserved**.
Saving a file you didn't change rewrites nothing, and saving keeps the meaning of the in-game-verified examples
(`playbooks/studio-*.json`, `playbooks/plays/*.json`) intact (`npm test` checks this).

Files can change while the app is open (an editor, `git pull`, the game PC's sync, a second browser tab). The app
re-reads the file list whenever its window gets focus: files you haven't edited reload, files you have edited are
marked "changed on disk". Saving never overwrites a file that changed since the app loaded it (or creates one over
an existing file, including a name that differs only in letter case): the save stops, and you choose to reload the
disk version (your edits stay one undo away), overwrite it, or save your version as `<name>-copy.json`.

## Export to the game (game PC)

The app only writes JSON. On the game PC, with this repo synced, run from the repo root:

```
powershell -ExecutionPolicy Bypass -File tools\export.ps1 -Install
```

This builds one mod, `mods/pbstudio.fbmod`, from every `playbooks/plays/*.json` (add or refresh it in MMC Mod Manager,
then Apply), and one `PBOOKOFF-<NAME>` save per playbook, installed to `Documents\Madden NFL 27\saves` (pick it
in-game as a custom playbook). Nothing goes into Frosty Editor by hand. Offline modes only.

## Layout

```
server/   api.ts (file API + library), plugin.ts (Vite plugin), serve.ts (production server)
src/      model/ (pure TS + tests), state/ (zustand stores), api/ (file client: dispatches to the active backend),
          storage/ (backend choice, start screen, browser-folder backend, shared path rules), input/, ui/, field/, views/
docs/     HOSTING.md (putting the app on your website over FTP), htaccess.txt (optional Apache settings), features/
scripts/  qa.mjs (headless-Chrome QA driver), serve-dist.mjs (preview / check the built site)
```

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the module contracts.

## Milestones

Status on 2026-10-04 (after the feature round, integration, the review fixes and their verification). `npm run
typecheck`, `npm test` (42 files, 553 tests at the time of writing) and `npm run build` pass; every view was
smoke-tested in the browser (1280×800 to 1920×1080, keyboard and virtual Xbox pad) with no console errors.
`node scripts/qa.mjs <steps.json>` drives a headless Chrome for such checks (it emulates window focus and accepts the
unsaved-changes prompt).

1. **File server, library loading, scale field, play-art renderer** — done. One Vite process serves the app, the file
   API (list/read/atomic write that refuses to overwrite files changed on disk/soft delete to `app-data/.trash`/rename,
   read-only template save) and the gzipped
   library (11,055 plays, 5,402 assignment chains). The field is to scale with zoom/pan and live coordinates; the art
   engine draws routes, VIP, runs, blocks, pulls, motion, QB drops and defense zones from the steps and is checked
   against the sample play sheets (`#/settings/art` bench). Gaps: OptionHandoff/PitchBall/FaceDirection/DefAlignment
   draw nothing, WedgeBlock ignores offsets, field goals and a few minigame plays have no art, defenders aren't
   adjusted to receivers.
2. **Playbook builder** — done, and round-trips both example playbooks (tests). Picker (new, new from the stock
   template, duplicate, rename, soft delete), Formation → Set → Play tree with drag-and-drop at every level, multi-select,
   clipboard panel with copy/paste/duplicate across books, audible diamond, CPU-weight editor with copy/paste, an
   add-plays drawer, template sections read from the template save (locked, expandable, "Convert to explicit") and a
   live validation strip. Also built: the **Play Call** preview (`#/playcall`), the in-game 3-card screen driven by the
   controller. Gaps: the stock template files 3 plays under a set they don't belong to, so Convert / New from stock
   template skip them (471 of 473 CPU rows); the in-game-order caveat is a tooltip/overview note, not a banner; the
   play-call screen has no usage sort or call stats.
3. **Concepts and categories, library filters, badges, route library** — done. `#/concepts`: seeded or empty
   `app-data/concepts.json`, category manager (add, rename, color, nest, reorder, delete with tag cleanup), tagging
   workspace with accept-only suggestions (play type, read concepts, route types, names), run/pass matrices,
   situations and coverage. `#/library`: virtualized grid of library + custom plays with the filter rail (side,
   formation, set, play type, categories, read concepts, route contains, availability, source, favorites), NEEDS MOD /
   CUSTOM badges, play detail and the per-player route library. Gaps: concepts.json gains an editor-only `dismissed`
   key; the tag workspace lists at most 3,000 search results; the Pass Matrix scrolls sideways at 1440 px; a formation
   filter chip doesn't show the folder when two formations share a name.
4. **Play designer** — done, and round-trips `pbs-ytrips-v1.json` and `art-test.json` (every assignment chain in the
   library also rebuilds byte for byte). New-play wizard (formation → set → base play grouped by concept / run
   scheme → name/file, URL prefill), three-pane editor with segment drawing, snapping, cuts, per-leg speed, route
   presets, releases, double moves, block tools, motion presets and waypoints, a raw step table, VIP, reads, base
   swap and locked handoff slots; the play panel, inspector and number fields work from the pad, and renaming a play
   offers to update the playbooks, tags and favorites that use it. Gaps: wizard d-pad up/down moves by three cards
   across group boundaries; swapping the base keeps play-level fields
   you already set; the route library hides chains with handoff mechanics.
5. **Formation/set editor** — done (labelled "requires game-side support (coming)": `tools/export.ps1` ignores
   `playbooks/sets/`). New-set wizard, drag/nudge with grid or free snap, depth and split presets, stance/facing,
   motion-preset editing, live §5 checks shared with Export, and a plays-to-clone picker with dependency warnings.
   Gaps: base motion presets can only be reset (FORMATS.md has no way to remove one); only library plays from the
   base set can be cloned.
6. **Export panel and validation** — done. Live validate-all over playbooks, plays, sets and concepts (grouped,
   filterable, each issue opens its editor), the build summary (saves, custom plays in the one mod, pulled-in
   non-global plays, every row each save gets incl. template sections), the exact command, Save all + Export, the zip
   bundle and "what happens next"; a save that would make the game-side build fail turns the header red. Gaps: catalog
   problems are classified by their text (kept next to the texts in `model/catalog.ts`); the game-side
   `tools/pbook-build.mjs` resolves "Special" without the book's side, so every offense save loses its special teams
   (flagged everywhere — builder, play-call "BUILDS EMPTY", export banner — until that tool is fixed).
