# M27 Playbook Studio

Design Madden NFL 27 playbooks, formations and custom plays outside the game, then ship them to the game as a Frosty
mod and a custom playbook save. Offline use only: MMC rules forbid mods in online modes.

The project has two parts:

1. **[Playbook Studio](app/)**, the web app in `app/`. This is the main thing: the editor where you build playbooks,
   draw plays and export them. Everything else exists to feed it game data or to turn its output into something the
   game loads.
2. **The Frosty Editor build**, the game-side tools in `tools/`. They take the JSON the app exports and build it into a
   `.fbmod` for MMC Mod Manager, plus a `PBOOKOFF-*` save file for the custom playbook.

```
 (any machine)                                        │ (game PC: Madden 27 + MMC Editor)
                                                      │
 data/library/*.json ──▶  app/  ──export──▶ playbooks/*.json        ──▶ tools/export.ps1 ──▶ PBOOKOFF-<NAME>  → saves folder
 (the game's play          Playbook Studio   playbooks/plays/*.json   ──▶   PlayDump       ──▶ mods/pbstudio.fbmod → MMC Mod Manager
  library, dumped by                         playbooks/sets/*.json    ──▶   buildplays
  PlayDump library)                          app-data/*.json (editor-only)
```

The contract between the two halves is [`docs/FORMATS.md`](docs/FORMATS.md). If the app writes files that match it,
the game side can build them.

---

## 1. Playbook Studio (`app/`)

A React + TypeScript (Vite) app. The default playbook is FUSION (`playbooks/FUSION.json`), and a connected Xbox or
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

## 2. Frosty Editor build (`tools/`)

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
   mod, `mods/pbstudio.fbmod`, because every play mod edits the shared `GlobalPlaySheet`.
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
| `tools/` | PlayDump (C#), the save builder and helpers (Node), `export.ps1` |
| `research/` | data model notes (`PHASE0_FINDINGS.md`) and id indexes. Raw dumps are gitignored and can be regenerated |
| `mods/` | generated `.fbproject` / `.fbmod` files (build outputs are gitignored) |
