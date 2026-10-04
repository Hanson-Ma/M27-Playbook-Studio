# Prompt: build the Playbook Studio web app

> Paste everything below the line into Claude Code on the other machine, opened at the repo root (`2026 Playbook/`).

---

You're building **Playbook Studio**, a local web app for designing Madden NFL 27 playbooks and plays. It lives in `app/` in this repo.

## Context — read these first
- `README.md` — repo layout and the game-side tools.
- `docs/FORMATS.md` — **the contract**: the library data you read, the JSON you write, coordinates, step vocabulary, and the rules. Follow it exactly.
- `research/PHASE0_FINDINGS.md` — how Madden 27 stores plays (background).
- `data/library/*.json` — the game's full play library (118 formations, 808 sets, 11,055 plays, 5,402 assignment chains), exported from the game. `plays.json` is about 17 MB, so load it once and index it in memory.
- `playbooks/studio-test.json` and `playbooks/plays/pbs-ytrips-v1.json` — real, in-game-verified examples of both output formats. They must round-trip through the app unchanged in meaning.

**This machine doesn't have Madden.** Never touch `tools/`, `mods/`, `build/`, or anything game-side. The game PC runs `tools/export.ps1` on whatever you write into `playbooks/`. Your job ends at writing valid JSON files.

## Stack
Vite + React + TypeScript, plus a tiny Node file server in `app/server/`: Express or a Vite middleware with endpoints to list/read/write `playbooks/**/*.json` and `app-data/*.json`, and to serve `data/library/`. All writes stay inside the repo. Render plays with SVG, with no canvas libraries unless needed. Keep dependencies small. `npm run dev` should start everything.

## What to build

### 1. Library browser
- Filter by side, formation, set, play type (`offensePlayType`), your concept tags, and name text.
- Grid of play cards with **auto-drawn play art**: set alignment (`movements.Normal`) plus each slot's assignment chain, drawn as legs (`distance` at `direction`, in yards; see FORMATS.md). Use colors by role: routes yellow, primary read red, blocks gray with a block cap, handoff/run path red, motion blue dashed (`AutoMotion` waypoints are absolute).
- Click a play to open a larger view: per-player step list, read progression, play type and blocking scheme.

### 2. Playbook builder (most important — ship this first)
- Open, create or save `playbooks/<name>.json`.
- Left: a tree of Formation → Set → Plays with **drag-and-drop reordering** at every level. Add formations, sets or plays from the library (search, multi-select, drag in) and remove them.
- Per set: **4 audible slots**. Assign a play to slot 1–4, with at most one play per slot.
- Per play: **CPU situation weights**. Show an editor with a 0–100 value per situation key (list in FORMATS.md), grouped by down/distance, red zone, clock and special.
- "Template" sections for special teams: show them as locked rows that expand to show the template's contents.
- Live validation: capacity counters (750 plays, 40 formations, 75 sets, 2200 weight rows), special teams present, duplicate audible slots, plays resolving to the library or to custom plays, names valid.

### 3. Concepts and categories (editor-only, stored in `app-data/concepts.json`)
- Users define categories for **pass concepts** (Mesh, Snag, Smash, Flood, Y-Cross…), **run concepts** (Inside Zone, Counter, Power, Duo, Toss…), and anything else (Screens, PA, Trick, RPO, Goal Line…). They can add, rename, color, nest and delete them.
- Tag plays, library or custom, with one or more categories. Seed suggested tags from `offensePlayType` and `reads[].concept` (e.g. `Concept_Mesh`), but only apply them when the user accepts.
- Filter, group and color by category in the library and the builder. Use them for gameplan views like "show my run concepts by formation".

### 4. Play designer (custom plays → `playbooks/plays/*.json`)
- **New play**: pick a set, then pick a **base play from that same set**. The base supplies alignment and the handoff/protection mechanics.
- Field canvas with the alignment. Click a player to edit their assignment:
  - **Route tool**: click waypoints on the field. Convert them to `RunRoute` legs (distance/direction from consecutive points, snapped to 0.5 yd and 1°) and insert `ReceiverCut` steps at sharp corners (choose the cut angle from the turn). End with `GetOpen`.
  - **Route tree presets**: slant, flat, out, in/dig, curl, comeback, corner, post, go, wheel, seam, drag, snag, whip. Each is parameterized by depth and break, and is direction-aware for the player's side of the ball.
  - **Block tools**: pass block, run block, lead or kickout or trap (technique and gap), pull (InitialAnim pull + LeadBlock), screen release (PassBlock with ProtectReceiver).
  - **Motion**: drag a motion path for snap motion (`AutoMotion` waypoints in absolute coordinates, `startEvent` SNAP), with the route continuing from the motion end.
  - **Reuse**: pick any existing assignment from `assignments.json`, filtered by `routeType` and previewed on the player.
  - Raw step editor as an escape hatch: an editable table of steps with enum dropdowns built from values seen in `assignments.json`.
- Handoff, play-action, option and reverse mechanics come from the base play. Show them as locked unless the user swaps the base, and explain why.
- Read progression editor: order the eligible slots and set percentages.
- **Animate**: a timeline that moves players along their paths at `speed`, for sanity-checking spacing (approximate is fine).
- Save as a plays spec, either one file per play or grouped, matching FORMATS.md §3 exactly. Generate `asset` names and assignment `new` names automatically, and keep them unique.

### 5. Export panel
- **Validate all**: run every FORMATS.md rule across `playbooks/` and `playbooks/plays/`.
- **Export**: write the JSON files. Show a summary of what changed and which playbook saves and custom plays the game PC will build. Show the exact command to run there: `powershell -ExecutionPolicy Bypass -File tools\export.ps1 -Install`.
- Also offer **Download export bundle (.zip)** with `playbooks/` and `app-data/`, for when the repo isn't synced.
- Explain what happens next. The game PC turns `playbooks/plays/*.json` into **one** mod, `mods/pbstudio.fbmod`; you add or refresh it in MMC Mod Manager, then Apply. It also turns each `playbooks/<name>.json` into a save, `PBOOKOFF-<NAME>`, in `Documents\Madden NFL 27\saves`, which you pick in-game as a custom playbook. Plays that only use library plays need no mod at all.

## Conventions
- Never lose data the app doesn't understand: preserve unknown JSON keys on save.
- Every file write must be a pretty-printed, stable key order (git-diffable).
- Undo/redo in the builder and designer.
- Desktop-first layout, dark theme by default (football-field green accents), keyboard shortcuts for common actions.

## Milestones (commit after each, with a short note in `app/README.md`)
1. File server and library loading, with the play-art renderer verified against 10 known plays. Compare with `research/notes/sample-play-sheets.txt`, a text dump of real plays and their exact steps.
2. Playbook builder that round-trips `playbooks/studio-test.json`.
3. Concepts and categories.
4. Play designer that round-trips `playbooks/plays/pbs-ytrips-v1.json` and authors a new route.
5. Export panel and validation.

Ask me before changing anything in `docs/FORMATS.md`. That file is shared with the game-side tools.
