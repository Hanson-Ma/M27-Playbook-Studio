# 2026 Playbook

Tooling to design Madden 27 plays and playbooks outside the game and ship them as Frosty mods.
Offline use only — MMC rules forbid mods in online modes.

## Layout
- `tools/PlayDump/`: .NET Framework 4.8 console tool that loads Madden 27 headlessly through MMC Editor's FrostySdk.
  - `PlayDump types [regex]` — EBX asset counts by type
  - `PlayDump list <Type> [nameRegex]` — asset names
  - `PlayDump dump <outDir> <nameRegex> [--type T] [--max N] [--follow N]` — EBX → JSON (`--follow` inlines referenced assets)
  - `PlayDump oracle <out.fbproject>` — builds the Phase 0 test project
- `tools/*.mjs`: Node helpers for the dumps (`summarize`, `booktree`, `protodump`, `protofind`)
- `research/PHASE0_FINDINGS.md`: data model notes. Dumps and decompiled code are gitignored and can be regenerated.
- `mods/`: generated `.fbproject` / `.fbmod` files
- `playbooks/`: playbook specs (→ custom playbook saves), `playbooks/plays/` play specs (→ one mod), `playbooks/mod.json` mod settings
- `data/library/`: the game's play library as JSON (`PlayDump library data/library`) for the web editor
- `docs/FORMATS.md`: the data contract between the web editor and these tools; `docs/WEB_APP_PROMPT.md`: the editor build prompt; `docs/WEB_APP_HOSTING_PROMPT.md`: follow-up for the hosted static version

## Export (game PC)
```
powershell -ExecutionPolicy Bypass -File tools\export.ps1 -Install
```
Add `-Bundle <zip>` to first import an export bundle downloaded from the hosted Playbook Studio. It backs up and replaces `playbooks/` and `app-data/`.

Builds `mods/pbstudio.fbmod` from `playbooks/plays/*.json` (add it in MMC Mod Manager) and a `PBOOKOFF-<NAME>` save per playbook spec (installed to `Documents\Madden NFL 27\saves`).

## Requirements
.NET 8 SDK (builds net48), Node 20+, MMC Editor (newest `MMC_Modding_Tools_v*` is auto-detected; currently v1.1.0.6), and Madden 27 with an existing MMC cache (open the game once in MMC Editor).
`tools/PlayDump/key1.local.bin` (gitignored) holds the profile Key1 that MMC's FrostyCore uses.

Paths default to this machine; override them with `MMC_EDITOR_DIR` and `MADDEN27_DIR`.

```
dotnet build tools/PlayDump -c Release
```
