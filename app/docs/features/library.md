# Feature: Library, play detail, route library (`#/library`)

> **v1 brief (round 2) — partly superseded.** v2 (ARCHITECTURE.md "★ v2 direction") made the app keyboard + mouse
> only: every pad / legend / glyph / bumper / single-letter-key instruction below is obsolete (controller glyphs remain
> only for audible slots), "formation-ambiguous" / special-teams caveats are gone (the game-side builder resolves names
> by side), and custom sets now build. Current behaviour: the in-app Help (`src/views/help/content/`).

Owns: `src/views/library/**`, `src/model/search.ts` (+ `search.test.ts`).
Brief: WEB_APP_PROMPT.md §1. Browse all 11,055 library plays plus the custom plays like the in-game play-call
screen, inspect any play, browse the per-player route library, and send plays to a playbook or the designer.

## 1. Library grid (`#/library`)
- Header row: a small sub-tab bar (TabBar size "sm") — ALL · FORMATION · CONCEPT · PLAY TYPE · FAVORITES · RECENT —
  cycled with LT/RT (`bumperButtons={["LT","RT"]}`; LB/RB stay the main app tabs); a search field (`/` focuses it,
  Esc clears/blurs); a right-aligned big condensed count like the game's "12 PLAYS" (e.g. "11,055 PLAYS").
- Left filter rail (SplitPane, collapsible, remembers width): Side (Offense / Defense / Special; default Offense);
  Formation (searchable list with counts, respects `settings.hideMinigames`); Set (inside the chosen formation, with
  counts); play-type family chips (PASS / RUN / PLAY ACTION / SCREEN / RPO / OPTION / SPECIAL in their playtypes colors)
  plus an exact play-type SearchSelect; concept categories (app-data/concepts.json via `useDoc(CONCEPTS_PATH)` +
  `categoriesForPlay`) and read concepts (`reads[].concept`, e.g. Concept_Mesh → "Mesh"); "Route contains" (route
  families present in the play's assignments, e.g. "has a Wheel", from routeType); Availability (All / Works without
  mod (`global`) / Needs mod); Source (Stock / Custom); Favorites only. Active filters render as removable Chips above
  the grid with "Clear all".
- Grouping per sub-tab: ALL = flat; FORMATION = sticky section headers per formation › set; CONCEPT = per concept;
  PLAY TYPE = per family; FAVORITES / RECENT = `settings.favorites` / `settings.recents` (most recent first).
- Grid: virtualized PlayCards (md) that stay smooth with 11k items (`VirtualGrid`; card art via `artForPlay`, which is
  memoized — never compute art for off-screen cards). No face-button glyphs on library cards (X / A / Y act on the
  selected card only, unlike the play-call screen where they pick one of three cards). Stat chip: "ID 7663" for
  stock, the plays file name for custom. Automatic NEEDS MOD / CUSTOM badges; a ★ badge for favorites.
- Input (useActions + legend): d-pad/arrows move selection (repeat); A/Enter open detail; Y toggle favorite
  ("★ FAVORITE"); X "ADD TO PLAYBOOK"; RS (key R) flip art; LT/RT sub-tabs; VIEW (key V) focus the filter rail (UP/DOWN
  walk it in reading order with `moveFocus`, LEFT/RIGHT change segments / toggles or move along a chip row). Mouse:
  click select, double-click open, right-click context menu (Open, Add to playbook…, Clone in designer, Favorite,
  Copy asset path).
- Empty / loading / no-results states with the Madden feel.

## 2. Play detail (`#/library/play/<encodeURIComponent(key)>`)
- Large interactive Field + PlayArtLayer (labels on, `showPassPro` from settings), flip toggle (RS / R), motion
  preset selector (set.movements keys other than Normal; `ArtOptions.preset`), ball spot from settings.
- Side panel tabs: OVERVIEW (name, PlayTypeTag, formation/set, playId, asset path (mono + copy), blocking scheme leaf,
  run hole, VIP, canFlip, allowHotRoutes, global vs. needs-mod explanation from FORMATS.md "Availability", concept
  tags); PLAYERS (one row per slot: #, label, positionName, x/y, stance, assignment leaf + routeType, mechanics lock
  icon; selecting a row highlights the player on the field and vice versa (`selectedSlot`, `dimOthers`); expand a row
  for `stepSummary()` of every step and the raw step JSON); READS (progression order with pct bars, concept, combo;
  VIP marked red); ROUTES (the per-player route library, §3).
- Actions: Add to playbook… (dialog: pick a playbook doc from `useDocsOfKind("playbook")` or create one; uses
  `addPlayToSpec` from `model/playbookOps.ts` inside `useWorkspace.getState().update(path, draft => …)`; toast with the
  location + "Open" action that navigates to `#/playbook/<path>?f=&s=&p=`; show `nameAddressProblem` errors);
  Clone in designer (`#/designer/new?set=<set asset>&base=<play asset>`); Favorite; Back (B/Esc → grid, keeping the
  grid's scroll/selection). Call `settings.pushRecent(key)` on open. LT/RT = previous/next play in the current results.
- Custom plays open here too (source "custom": show the plays file and an "Edit in designer" action →
  `#/designer/<file>/<index>`).

## 3. Route library per player (ROUTES tab)
- From `lib.assignmentsByRouteType`, list assignments grouped by routeType with friendly names
  (AssignRouteType_RR_Slant → "Slant", RR_Curl_Medium → "Curl (medium)", Block_Run → "Run block", QB_Pass → "QB drop"…),
  group headers with counts, a filter box, and a scope toggle: receiver routes / blocks / backs / QB / all.
- Each assignment renders as a MiniRoute from the SELECTED player's actual alignment (memoize; virtualize the list).
- Directional variants: leaves containing Lt/Rt (WR_CurlLt / WR_CurlRt, Swing_Lt / Swing_Rt, Flat_Lt / Flat_Rt…) —
  label each "inside" or "outside" relative to the selected player's side of the ball (x < 0 = left side: a break
  toward +x is inside) and list the inside-breaking variant first for curls/hooks.
- Clicking a route previews it on the main field (that slot's steps replaced, drawn normally, with a "PREVIEW" chip
  and Esc to clear); "Use in designer" navigates to
  `#/designer/new?set=<set>&base=<play>&slot=<n>&assignment=<path relative to ASSIGNMENT_ROOT>`.

## 4. `model/search.ts` (pure, tested)
- Build a search index once per catalog version: per ResolvedPlay a lowercase haystack (name, set name, formation name,
  playTypeInfo long name, read concepts, assignment routeType words, asset leaf) + facet values (side, formation asset,
  set asset, family, play type, concepts, route families, global, source).
- `searchPlays(index, query, filters)`: tokenized AND match + facet filters; facet counts for the rail; grouping
  helpers. 11k plays filter in < 30 ms after the index build. Tests with the real library (libFixture).
