# Prompt: build the Playbook Studio web app

> Paste everything below the line into Claude Code on the other machine, opened at the repo root (`2026 Playbook/`).

---

You're building **Playbook Studio**, a local web app for designing Madden NFL 27 playbooks and plays. It lives in `app/` in this repo.

## Context — read these first
- `docs/FORMATS.md` — **the contract**: the library data you read, the JSON you write, coordinates, step vocabulary, rules, availability and the verified in-game lessons. Follow it exactly. It's the most important file.
- `README.md` — repo layout and the game-side tools.
- `research/PHASE0_FINDINGS.md` — how Madden 27 stores plays (background).
- `data/library/*.json` — the game's play library: 118 formations, 808 sets with alignments and motion presets, 11,055 plays, 5,402 assignment chains, plus `enums.json` with every legal enum value. `plays.json` is about 17 MB, so load it once and index it in memory.
- In-game-verified examples of the output formats:
  - `playbooks/studio-test.json` and `playbooks/studio-lib.json` (playbooks)
  - `playbooks/plays/pbs-ytrips-v1.json` (six authored plays: counter with G/T pulls, PA, snag, screen, reverse with QB lead, motion pass)
  - `playbooks/plays/art-test.json`
  
  They must round-trip through the app unchanged in meaning.
- `research/notes/sample-play-sheets.txt` and `research/notes/base-plays.txt` — real plays with their exact steps. Use them to check your renderer.

**This machine doesn't have Madden.** Never touch `tools/`, `mods/`, `build/`, `backups/`, or anything game-side. The game PC runs `tools/export.ps1` on whatever you write into `playbooks/`. Your job ends at writing valid JSON files. Ask before changing `docs/FORMATS.md`; it's shared with the game-side tools.

## Stack
Vite + React + TypeScript, plus a tiny Node file server in `app/server/` (Express or Vite middleware) with endpoints to:
- list, read and write `playbooks/**/*.json` and `app-data/*.json`;
- serve `data/library/`.

All writes stay inside the repo. Render everything with SVG. Keep dependencies small. `npm run dev` should start everything. Desktop-first, dark theme by default. Use undo/redo everywhere, plus keyboard shortcuts.

## The field (shared by every view)
- An **accurate-to-scale** field in yards: 53.33 yd wide, yard lines every 5, NFL hash marks (x = ±3.08 from the middle), the LOS, and the numbers. Keep it simple, with flat lines and no textures.
- Zoom and pan. Show coordinates live on hover and while dragging (x, y to 0.1 yd).
- Players draw as position glyphs (O, square for the OL, triangle/X for defense) with the slot number and position label. Draw routes as SVG polylines with arrow, block or zone end caps.
- Colors:
  - route: yellow
  - **primary receiver (`vip`): red**
  - run path / ballcarrier: red
  - blocks: gray with a T cap
  - motion: light blue (dashed for pre-snap presets)
  - QB drop: white
- **No play animation or preview playback is needed.** Static, accurate diagrams are the goal.

## 1. Library and play picker
- A searchable list of every play, with filters for side, formation, set, play type, route/concept tags, `global` (usable without the mod), and custom vs. stock.
- Each card shows auto-drawn play art. Clicking opens a detail view with the alignment, each player's step list, the reads and the VIP.
- **Badge non-global plays "needs mod"** (FORMATS.md, "Availability").
- **Route library per player:** from `assignments.json`, group assignments by `routeType` (slant, curl, post, flat, drag, wheel, block…). Render each one as a mini route from the selected player's actual alignment, so the user can pick an existing route for any player. Flip left/right variants by side where the data has both.

## 2. Playbook builder (ship this first)
- Open, create or save `playbooks/<name>.json`.
- A tree of **Formation → Set → Plays** with drag-and-drop reordering at every level: formation order, set order, play order. Toggle plays in or out, and add formations, sets or plays from the library by search, multi-select or drag.
- **Copy/paste and duplicate** for formations, sets and plays, within a playbook and across playbooks (e.g. copy a whole formation section, or paste a set's plays into another book). Keep a clipboard panel.
- Per set: **4 audible slots** (1–4), one play per slot. Show them as four drop targets.
- Per play: a **CPU situation weights** editor (0–100 per situation key), grouped by down/distance, red zone, clock and special. Allow copying weights between plays.
- Show special-teams `"template"` sections as locked rows that expand to show their contents.
- Show **in-game order caveats**: the game sorts formations by usage and may reorder plays. Keep the user's order in the file anyway.
- Live validation: capacity counters (750 plays, 40 formations, 75 sets, 2200 weight rows), special teams present, duplicate audibles, unresolvable plays, invalid names.

## 3. Concepts and categories (editor-only, `app-data/concepts.json`)
- User-defined categories for **pass concepts** (Mesh, Snag, Smash, Flood, Y-Cross, Dagger…), **run concepts** (Inside Zone, Counter, Power, Duo, Toss, Trap…), and anything else (Screens, PA, Trick, RPO, Goal Line, Two-minute…). Users can add, rename, color, nest and delete them.
- Tag any play, stock or custom. Suggest tags from `offensePlayType`, `reads[].concept` and `routeType`, but only apply them when the user accepts.
- Filter, group and color by category everywhere. Add gameplan views like "run concepts by formation" or "what do I have for 3rd and medium".

## 4. Play designer (custom plays → `playbooks/plays/*.json`)
Start a new play by picking a set, then a **base play from that same set** (FORMATS.md §3). The base supplies the alignment and any handoff, play-action, option or reverse mechanics. Show those slots as **locked** with an explanation, and let the user swap the base. Offer **run-play templates**: all run plays in the set, grouped by blocking scheme (Inside Zone, Power, Counter, Trap…), as starting points.

For each player, the inspector offers:
- **Route picker**: an existing assignment (from the route library above), or a parametric preset from the route tree: slant, flat, out, in/dig, curl, comeback, hitch, corner, post, go/fade, seam, wheel, drag/shallow, whip, snag, arrow, angle, swing, bubble.
  - Parameters: stem depth, break angle and direction, break-leg length, release type, and speed per leg.
  - Direction-aware: the "outside" break for a left-side player is toward -x.
- **Releases**: inside, outside, vertical, plus double moves (stutter, stutter-go, slant-and-go, hitch-and-go in/out, out-and-up, stick-nod, zig). These map to the first legs plus `InitialAnim` / `ReceiverCut` cut types / `RunRouteFakeOut` (FORMATS.md §3).
- **Segment route drawing (not freehand)**: click to add vertices, and each segment becomes one `RunRoute` leg.
  - A curve is just several short segments. Offer snapping (0.5 yd grid and 5° angles), with a free-placement toggle.
  - Each vertex can carry a **cut** (a `ReceiverCut` cut type from `enums.json`) and each leg its own **speed**. Edit the stem and break legs numerically too (distance, direction, speed).
  - End the route with `GetOpen`, a sit, or nothing.
- **Block tools**: pass block (with time-then-release), run block (scheme), lead / kickout / trap / wham / crack / stalk (technique + gap), pull (pull animation + lead block), screen release (`PassBlock` with ProtectReceiver).
- **Motion**: drag waypoints for snap motion (`AutoMotion`). Each waypoint has its own **speed** and **style**: run (`NORMAL`) or shuffle (`STRAFE`). Offer presets for jet, orbit (an arc behind the QB), return/shift and short motion. The route continues from the last waypoint.
- **Raw step table**: an editable list of steps with enum dropdowns from `enums.json`, as an escape hatch.

At the play level:
- name;
- `playType` (dropdown from `OffensePlayType`);
- blocking scheme and run hole for runs;
- **VIP / red route** (pick a slot; recolors live);
- **reads** (order the eligible slots and set percentages). Keep the base's reads untouched unless the user edits them; FORMATS.md explains why.

Save as plays specs exactly per FORMATS.md §3. Generate `asset` names and assignment `new` names automatically, unique, `[A-Za-z0-9_]`, and prefixed with the user's chosen tag (default `PBS_`). Reuse identical authored assignments instead of duplicating them.

## 5. Formation and set editor (→ `playbooks/sets/*.json`, FORMATS.md §5 — supported game-side)
- Clone an existing set or formation as a starting point. **Drag players on the field**, with exact x/y readouts and a numeric edit box. Choose snap mode (0.5 yd grid, LOS/off-ball depth presets, OL-relative splits like "2 yd outside the TE") or free placement. Set stance and facing per player.
- Edit the set's **pre-snap motion presets** (`movements`: each preset holds only its motion man's target spot; editable per FORMATS.md §5), and show the flipped alignment (from `flipAssign`) as a toggle.
- Validation per FORMATS.md §5: 11 players, 7 on the line, OL spacing, QB/HB depth class.
- Choose which plays to clone into the new set, and warn about plays whose assignments depend on the moved players.
- Write the set's cloned plays into the same set spec (`plays: [{from, name, asset, ...overrides}]`), and let new custom plays use those clones as their base.

## 6. Export panel
- **Validate all** against every FORMATS.md rule, across `playbooks/`, `playbooks/plays/` and `playbooks/sets/`.
- **Export** writes the JSON files and shows a summary:
  - which playbook saves will be built;
  - which custom plays the mod will contain;
  - which library plays the mod will pull in (non-global plays used by playbooks).
- Show the exact command to run on the game PC: `powershell -ExecutionPolicy Bypass -File tools\export.ps1 -Install`
- Offer **Download export bundle (.zip)** with `playbooks/` and `app-data/`, for when the repo isn't synced.
- Explain what happens next:
  - The game PC turns everything into **one** mod, `mods/pbstudio.fbmod` (add or refresh it in MMC Mod Manager, then Apply).
  - It also builds one save per playbook, `PBOOKOFF-<NAME>`, installed to `Documents\Madden NFL 27\saves`; you pick it in-game as a custom playbook.
  - **Nothing goes into Frosty Editor by hand.**

## Conventions
- Never lose data the app doesn't understand: preserve unknown JSON keys on save.
- File writes must be pretty-printed with a stable key order (git-diffable).
- Separate the model layer (pure TS: geometry, route compilation to and from steps, validation) from the UI, and unit-test it. Route ⇄ steps conversion must round-trip all the example plays.

## Milestones (commit after each, with a short note in `app/README.md`)
1. File server, library loading, scale field, and play-art renderer verified against the sample play sheets.
2. Playbook builder (tree, reorder, copy/paste, audibles, CPU weights) that round-trips both example playbooks.
3. Concepts and categories, plus library filters, badges and the per-player route library.
4. Play designer: base and templates, route picker and presets, segment drawing with cuts and speeds, releases, blocks, motion, VIP and reads. It must round-trip `pbs-ytrips-v1.json`.
5. Formation/set editor.
6. Export panel and validation.
