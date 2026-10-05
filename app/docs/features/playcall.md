# Feature: Play-call preview (`#/playcall`)

> **v1 brief (round 2) — partly superseded.** v2 (ARCHITECTURE.md "★ v2 direction") made the app keyboard + mouse
> only: every pad / legend / glyph / bumper / single-letter-key instruction below is obsolete (controller glyphs remain
> only for audible slots), "formation-ambiguous" / special-teams caveats are gone (the game-side builder resolves names
> by side), and custom sets now build. Current behaviour: the in-app Help (`src/views/help/content/`).

Owns: `src/views/playcall/**`.
Goal: preview a playbook exactly like the Madden 27 in-game play-call screen, fully drivable with an Xbox controller
(and keyboard/mouse). This is the "wow" screen — match the reference screenshot closely (see ARCHITECTURE.md "Visual
language"): near-black blurred-stadium background, top tab row with bumper pills, 3 big play cards per page with the
face-button glyph left of each play name, the formation/set subtitle in gray, a blue PASS tag bottom-left of the art,
a dark stat chip bottom-right, a page count top-right ("12 PLAYS"), and the bottom legend bar.

- Playbook picker (top-left SearchSelect of playbook docs; default `settings.lastPlaybook` or the first one; route
  `#/playcall/<encodeURIComponent(path)>`). Resolve with `resolvePlaybook` (model/resolveBook.ts). Template sections
  are filled from the template save (`buildCallBook(book, { contents, lib })`) and open like any formation, with FROM
  TEMPLATE badges; they show exactly what tools/pbook-build.mjs copies — the template's sets of the formation it
  resolves the name to WITHOUT the side — so offense "Special" (→ Defense/Special, no sets in the template) shows
  "FROM TEMPLATE · BUILDS EMPTY" until the builder resolves by side. A route to a playbook that no longer exists
  toasts and replace-navigates to the last valid one.
- Top: a big TabBar of play-call tabs: FORMATION · CONCEPT · PLAY TYPE · AUDIBLES · FAVORITES · RECENT. LB/RB belong
  to the main nav, so this bar uses LT/RT (`bumperButtons={["LT","RT"]}`). Right side: count of plays in the current
  list ("12 PLAYS").
- FORMATION tab: level 1 = formation tiles (formation name huge + set count + a mini alignment diagram of its first
  set), level 2 = set tiles (set name + play count + alignment-only art), level 3 = the plays, 3 per page as large
  PlayCards with the face-button glyphs X / A / Y (□ ✕ △) — pressing that button picks that card (keys 1/2/3); d-pad
  left/right (and RT/LT when not used by tabs: use the d-pad) pages, page dots, B backs up a level, breadcrumb
  "SHOTGUN › Y TRIPS WK".
- CONCEPT tab: groups by the concept categories of app-data/concepts.json (`CONCEPTS_PATH`, `categoriesForPlay`),
  falling back to read concepts (Concept_Mesh → "Mesh") when no categories exist; then 3-up plays.
- PLAY TYPE tab: PASS / RUN / PLAY ACTION / SCREEN / RPO / OPTION / SPECIAL groups (playTypeInfo family).
- AUDIBLES tab: per formation › set, the four audibles in the face-button diamond with the category names
  (`AUDIBLE_CATEGORY`, `settings.audibleButtons`, `AudibleGlyph`).
- FAVORITES / RECENT: `settings.favorites` / `settings.recents` restricted to plays in this playbook.
- Picking a play opens a full-screen pre-snap view with an enter animation: big Field + PlayArtLayer (labels), play
  name/subtitle, PlayTypeTag, audible slot if any, CPU weights summary; legend: RS FLIP PLAY, Y FAVORITE, X OPEN IN
  LIBRARY, B BACK. Flip mirrors the art (`ArtOptions.flip`).
- Card stat chip: the audible as its glyph + category ("[A] RUN | 3 CPU"); the X / A / Y glyphs left of the names
  only pick cards.
- Bottom legend mirrors the game: "X A Y  SELECT PLAY · ×2 FAVORITE" (double-tap a face button), "RS FLIP PLAY",
  "◀ ▶ PAGE", "B BACK", "VIEW PLAYBOOKS"; keyboard mode adds "F FAVORITE".
- Subtle caveat line: "The game sorts formations by usage; this preview uses your file order."
- Snappy 120–180 ms transitions; the selected card has the white focus glow; everything also works with the mouse.
- Empty state when there are no playbooks (button → #/playbook).
