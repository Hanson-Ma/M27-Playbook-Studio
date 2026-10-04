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
- `mods/`: generated `.fbproject` files

## Requirements
.NET 8 SDK (builds net48), Node 20+, MMC Editor v1.1.0.4, and Madden 27 with an existing MMC cache (open the game once in MMC Editor).
`tools/PlayDump/key1.local.bin` (gitignored) holds the profile Key1 that MMC's FrostyCore uses.

Paths default to this machine; override them with `MMC_EDITOR_DIR` and `MADDEN27_DIR`.

```
dotnet build tools/PlayDump -c Release
```
