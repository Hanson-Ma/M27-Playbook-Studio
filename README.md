# M27 Playbook Studio

Design Madden NFL 27 playbooks, formations and custom plays outside the game, then ship them to the game as a Frosty
mod and a custom playbook save. Offline use only: MMC rules forbid mods in online modes.

**Try it online: [playbook.hansonma.org](https://playbook.hansonma.org)**

The project has three parts:

1. **[Playbook Studio](app/)**, the web app in `app/`. This is the main thing: the editor where you build playbooks,
   draw plays and export them. Everything else exists to feed it game data or to turn its output into something the
   game loads.
2. **[Playbook Builder](#2-playbook-builder-app-releasebuilder)**, a small Windows app (`release/builder/`) that turns a
   playbook you made in the Studio into a mod and a playbook save with one click. This is what most people use.
3. **The Frosty Editor build**, the game-side tools in `tools/` that the Builder runs (or that you can run yourself with
   `export.ps1`). They build the app JSON into a `.fbmod` for MMC Mod Manager, plus a `PBOOKOFF-*` save file.

```
 (any machine)                                        │ (game PC: Madden 27 + MMC Editor)
                                                      │
 data/library/*.json ──▶  app/  ──export──▶ playbooks/*.json        ──▶ tools/export.ps1 ──▶ PBOOKOFF-<NAME>  → saves folder
 (the game's play          Playbook Studio   playbooks/plays/*.json   ──▶   PlayDump       ──▶ mods/pbstudio.fbmod → MMC Mod Manager
  library, dumped by                         playbooks/sets/*.json    ──▶   buildplays
  PlayDump library)                          app-data/*.json (editor-only)
```

## Quick start: from idea to playing it

First-time setup (once):

1. **Download this project** (Code → Download ZIP, or `git clone`) and unzip it somewhere you can write to, for example
   `C:\Madden Modding\2026 Playbook`. Keep the folder as it is: the Builder finds the project by looking upward from its
   own location, so `release\builder\` has to stay inside it.
2. **Install the game-side tools**: Madden NFL 27 (PC) and the MMC Modding Tools (MMC Editor + Mod Manager).
3. **Open Madden once in MMC Editor** and let it finish loading, then close it. That creates the cache the Builder reads.
4. **Install Node 22.18+** if you want to run the Studio locally (`cd app && npm install`), or just use the hosted copy
   (link above), which opens your project folder through the browser.

**Create your own playbook first.** The first time you open Playbook Studio it asks you to: *New Playbook* (empty, with goal line
and special teams from the template) or *New From Stock Template* (every stock formation and play, ready to trim). Pick a
name (letters and digits; in-game it shows as `PBOOKOFF-<NAME>`). It is saved as `playbooks/<name>.json`. You can make more later
from the *Playbooks* menu. **FUSION is Hanson Ma's own working playbook**, included as an example: look through it, but build
your own rather than editing it.

Every time you change a playbook:

1. **Design** in Playbook Studio: formations, sets, plays, routes, audibles. Order the formations and the sets inside
   them the way you want them listed in-game. Saving writes the JSON into `playbooks/` (and `app-data/`).
2. **Close Madden.**
3. **Build** with Playbook Builder: pick the playbook, click *Build and install* (about a minute).
4. **In MMC Mod Manager**: add or refresh the new `.fbmod`, tick it, Apply, Launch.
5. **In Madden**, go to an offline mode and pick your playbook as a custom offense.

---

The contract between the two halves is [`docs/FORMATS.md`](docs/FORMATS.md). If the app writes files that match it,
the game side can build them.

---

## 1. Playbook Studio (`app/`)

A React + TypeScript (Vite) app. FUSION (`playbooks/FUSION.json`, Hanson Ma's working playbook) is the example that opens first, and the first-open welcome prompts you to create your own, and a connected Xbox or
PlayStation controller drives every screen. Its own README covers it in full: **[`app/README.md`](app/README.md)**. Module
contracts are in [`app/ARCHITECTURE.md`](app/ARCHITECTURE.md).

What it does:
- **Library**: browse all 11,055 game plays and 5,402 assignment chains, with play art drawn from the assignment steps
  the same way the game draws it.
- **Playbook builder**: Formation → Set → Play tree with drag-and-drop, audibles, CPU weights and a validation strip.
- **Play designer**: draw routes, blocks, motions and reads on a to-scale field; it writes assignment step chains.
- **Formations / sets**: custom alignments and pre-snap motion presets.
- **Play Call**: a preview of the in-game play-call screen, driven by mouse, keyboard or controller.
- **Overview**: the whole playbook on one pan-and-zoom wall (a column per formation, a card per play).
- **Export**: checks for problems, then writes the playbook, play and set JSON (or a downloadable bundle when hosted).

```sh
cd app
npm install
npm run dev          # http://localhost:5178
```

It runs two ways: as a local server that reads and writes this repo, or as a static site (`npm run build:site`, see
[`app/docs/HOSTING.md`](app/docs/HOSTING.md)) that opens your local repo folder through the browser's File System
Access API. Requires Node 22.18+.

---

## 2. Playbook Builder app (`release/builder/`)

`Playbook Builder.exe` is the no-command-line way to run the game-side build. Nothing to install: it sits in
`release\builder\` inside this project and runs `PlayDump.exe` for you. Windows 10/11, with Madden NFL 27 and the MMC
Modding Tools installed. (Rebuild the folder from source with `tools\PlaybookBuilder\publish.ps1`.)

**First run**
1. It auto-detects MMC Editor, Madden 27 and the game key. Anything it can't find shows a red X: click *Locate…* next to
   it and point at `MMCEditor.exe` or `Madden27.exe`.
2. It finds the **playbook folder** (the project root that contains `playbooks/`) by looking upward from where the exe
   is, so it works as long as it stays inside the project. If you moved it, set the folder by hand.
3. It also asks where the mod files go. The default is the project's `mods/` folder.
4. Settings are remembered in `%LOCALAPPDATA%\PlaybookBuilder`.

**Each build** (the order it runs, shown as four steps in the window)
1. *Read your playbooks*: lists every spec in `playbooks/` (one entry per playbook, so you pick which to build) and finds the
   library plays it uses that the game's global play sheet doesn't include.
2. *Build the mod*: PlayDump loads the game headlessly and builds all custom sets and plays into one mod, named after the
   playbook (FUSION makes `fusion.fbmod` and `fusion.fbproject`). It also puts the game's formation and set lists in the
   same order as the playbook, since the game ignores the order stored in the save.
3. *Write playbook saves*: writes the `PBOOKOFF-<NAME>` custom playbook save from a template and recomputes its CRCs.
4. *Copy to Madden saves*: copies it to `Documents\Madden NFL 27\saves`. The old copy goes to `backups/` first.

Close Madden before building (the Builder refuses while it runs). If a build fails, *Show log* opens the details. Only one
playbook mod can be on in Mod Manager at a time, since they edit the same game files: untick any other, including an
old `pbstudio.fbmod`.

---

## 3. Frosty Editor build (`tools/`)

The app only writes JSON. Everything that touches Madden 27 runs on the game PC through one script:

```
powershell -ExecutionPolicy Bypass -File tools\export.ps1 -Install
```

Add `-Bundle <zip>` to first import an export bundle downloaded from the hosted app. It backs up and replaces
`playbooks/` and `app-data/`.

### How the JSON becomes a mod

`tools/PlayDump/` is a .NET Framework 4.8 console tool that loads Madden 27 headlessly through MMC Editor's
FrostySdk, the same asset manager Frosty Editor uses. Instead of making edits by hand in the editor's UI, it does them
in code and writes both a `.fbproject` (to open and inspect in MMC Editor) and a `.fbmod` (to load in Mod Manager).

`export.ps1` runs three passes:

1. **Collect** (`tools/pbook-build.mjs --collect`): finds library plays the playbooks use that aren't in the game's
   global play sheet. Custom playbooks silently drop those plays, so the mod has to register them.
2. **Build the mod** (`PlayDump buildplays`): every file in `playbooks/sets/` and `playbooks/plays/` goes into **one**
   mod, because every play mod edits the shared `GlobalPlaySheet`. `tools/export.ps1` names it `mods/pbstudio.fbmod`; the
     Playbook Builder app builds the playbook you pick and names the mod after it (FUSION makes `fusion.fbmod`).
   - **Sets** (`SetBuilder.cs`): clones a base Formation and Set, rewrites the 11-player alignment and motion presets,
     and clones plays into the new set.
   - **Plays** (`PlayBuilder.cs`): clones a base Play from the same set, which keeps the handoff, blocking and
     protection mechanics tied to that alignment. Then, per player slot, it keeps the base assignment, points at an
     existing `PositionAssignmentDefine`, or authors a new one from the JSON step chain (routes, cuts, blocks,
     motions, reads, VIP).
   - **Registration**: new assets are added to the right bundles and bundle ref tables and registered in
     `GlobalPlaySheet`. Missing dependencies crash the game on load, so the builder checks the closure.
3. **Build the saves** (`tools/pbook-build.mjs`): writes a `PBOOKOFF-<NAME>` custom playbook save per playbook spec,
   using a template save for the layout, and recomputes the save's CRCs. `-Install` copies it to
   `Documents\Madden NFL 27\saves`.

Then add `mods/pbstudio.fbmod` in MMC Mod Manager, Apply, launch, and pick the playbook as a custom offense in an
offline game.

### Other PlayDump commands

| command | what it does |
|---|---|
| `PlayDump library data/library` | dumps the game's play library to JSON for the app |
| `PlayDump types [regex]` | EBX asset counts by type |
| `PlayDump list <Type> [nameRegex]` | asset names |
| `PlayDump dump <outDir> <nameRegex> [--type T] [--max N] [--follow N]` | EBX → JSON (`--follow` inlines referenced assets) |
| `PlayDump oracle <out.fbproject>` | builds the Phase 0 test project |

The Node helpers in `tools/*.mjs` read and write the save format (`tdb.mjs`, `tdbcrc.mjs`) and summarize the dumps.
`tools/m24/` ports the Madden 24 FUSION playbook mod to Madden 27 (`build-fusion.ps1`), using the same builders.

### Requirements (game PC)

.NET 8 SDK (builds net48), Node 20+, MMC Editor (the newest `MMC_Modding_Tools_v*` is auto-detected; currently
v1.1.0.6), and Madden 27 with an existing MMC cache (open the game once in MMC Editor).
`tools/PlayDump/key1.local.bin` (gitignored) holds the profile Key1 that MMC's FrostyCore uses.
Paths default to the author's machine; override them with `MMC_EDITOR_DIR` and `MADDEN27_DIR`.

```
dotnet build tools/PlayDump -c Release
```

---

## Repo layout

| path | contents |
|---|---|
| `app/` | **Playbook Studio**, the web app |
| `docs/` | `FORMATS.md` (the app ⇄ tools data contract) and the original app build prompts |
| `data/library/` | the game's play library as JSON, read by the app |
| `playbooks/` | playbook specs (→ saves), `plays/` and `sets/` (→ the mod), `mod.json` mod settings, `fusion/` the FUSION port |
| `tools/` | PlayDump (C#), Playbook Builder source (`PlaybookBuilder/`), the save builder and helpers (Node), `export.ps1` |
| `release/builder/` | the Playbook Builder app (`Playbook Builder.exe` + `PlayDump.exe`) |
| `research/` | data model notes (`PHASE0_FINDINGS.md`) and id indexes. Raw dumps are gitignored and can be regenerated |
| `mods/` | generated `.fbproject` / `.fbmod` files (build outputs are gitignored) |
