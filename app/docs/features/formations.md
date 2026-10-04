# Feature: Formation & set editor (`#/formations`)

> **v1 brief (round 2) — partly superseded.** v2 (ARCHITECTURE.md "★ v2 direction") made the app keyboard + mouse
> only: every pad / legend / glyph / bumper / single-letter-key instruction below is obsolete (controller glyphs remain
> only for audible slots), "formation-ambiguous" / special-teams caveats are gone (the game-side builder resolves names
> by side), and custom sets now build. Current behaviour: the in-app Help (`src/views/help/content/`).

Owns: `src/views/formations/**`, `src/model/sets.ts` (+ `sets.test.ts`).
Brief: WEB_APP_PROMPT.md §5. Writes `playbooks/sets/*.json` exactly per FORMATS.md §5. Label the view
"REQUIRES GAME-SIDE SUPPORT (COMING)" (tools/export.ps1 ignores playbooks/sets/ for now) — still write valid files.

## 1. Entry (`#/formations`)
- Sets files (`useDocsOfKind("sets")`) with their custom sets as cards (alignment-only art: players, no routes),
  "New sets file" (promptDialog → `playbooks/sets/<slug>.json` = `{ "sets": [] }`).
- "NEW SET" wizard (pad-drivable Modal): library formation (offense side, hide minigames) → base set (cards with the
  alignment art) → name → asset (prefix + sanitized, unique) → formation: the base's formation, or a new custom
  formation in this file (`{ name, asset, base }` in `formations`). Opens `#/formations/<file>/<index>`.

## 2. Editor (`#/formations/<file>/<index>`)
- Big Field with the effective alignment (base Normal + `positions` overrides) drawn with PlayArtLayer (players only,
  labels on). Changed players get a subtle marker; ghost markers show the base spot.
- Drag players (pointer); d-pad nudges the selected player 0.5 yd (shift/LS held = 0.1); LT/RT select prev/next player.
- Snap: 0.5 yd grid / free (toggle or Alt). Depth presets: on the line (receivers y −0.8; OL −0.6…−1.2), off the line
  (−2.2), backfield (under-center QB −1.4, pistol −4, shotgun −6; HB/FB depths from the base). Split presets relative
  to the OL: "tight (+1 yd outside the tackle)", "wing", "2 yd outside the TE", "slot ±10.5", "numbers ±15.5", "hash",
  "wide ±16.25"; "mirror to the other side".
- Numeric x / y NumberFields (0.1 step), stance (SearchSelect over StanceType), facing. Pad: with a player selected,
  A ("Edit player") moves the cursor into the inspector (Y menu → "Edit set details" without one); the d-pad moves
  between controls, LEFT/RIGHT change value controls (a focused NumberField steps, LT/RT ×10), A presses, B/Esc returns
  to the field.
- Only changed slots are written to `positions` (each `{ slot, x?, y?, stance?, facing? }` with only changed fields).
- Motion presets: selector of the base set's movement keys (M1left…, plus custom keys); dashed preview paths from
  Normal to the preset spot (PlayArtLayer `preset` paths, or draw them); drag where each motion man ends up per preset;
  add / remove presets; written to `movements` (changed slots only).
- Live validation per FORMATS.md §5: exactly 11 players; 7 on the line of scrimmage (y between −1.4 and −0.6); OL keeps
  its spacing (±1.666 / ±3.333 around the center, same depth); QB/HB stay in the base's depth class (under center /
  pistol / shotgun) so handoffs stay valid; no two players on the same spot; the ends of the line should be eligible.
- Plays to clone: the base set's library plays with checkboxes + generated name / asset per play (prefix + set + play,
  unique). Warn per play when its assignments depend on moved players (the moved player's steps include mechanics,
  LeadBlock/RunBlock/PassBlock with alignment-dependent targets, OverrideFormPos or AutoMotion) with the reason.
- Persist via `useWorkspace.getState().update(file, draft => …, { label, coalesceMs })` (coalesce drags); setActive;
  undo/redo; mod+s. Legend: A SELECT, B DESELECT, D-PAD NUDGE, LT/RT PREV/NEXT PLAYER, X MIRROR, Y PRESETS.

## 3. `model/sets.ts` (pure, tested)
CustomSetSpec ⇄ effective alignment (base Normal + `positions`; motion presets merged by (pos, depth) like the art
engine), diff to minimal `positions` / `movements`, validation rules (FORMATS.md §5) returning ValidationIssue[],
name/asset generation and uniqueness, depth-class detection (under center / pistol / shotgun from the QB's y), and
dependency warnings for cloned plays (using the library). Tests with real sets (Shotgun Y Trips Wk, I Form Close…).
