# Feature: Concepts, categories and gameplans (`#/concepts`)

> **v1 brief (round 2) — partly superseded.** v2 (ARCHITECTURE.md "★ v2 direction") made the app keyboard + mouse
> only: every pad / legend / glyph / bumper / single-letter-key instruction below is obsolete (controller glyphs remain
> only for audible slots), "formation-ambiguous" / special-teams caveats are gone (the game-side builder resolves names
> by side), and custom sets now build. Current behaviour: the in-app Help (`src/views/help/content/`).

Owns: `src/views/concepts/**`, `src/model/concepts.ts` (+ `concepts.test.ts`).
Brief: WEB_APP_PROMPT.md §3. Editor-only data in `app-data/concepts.json` (`CONCEPTS_PATH`, `ConceptsDoc` in
types.ts; shared read helpers in `model/conceptsDoc.ts`). The game never sees this file.

## 1. Create
If the doc doesn't exist, show a Madden-style empty state with "Create concepts file" seeded with defaults
(`workspace.create(CONCEPTS_PATH, "concepts", doc)`):
- PASS: Mesh, Snag, Smash, Flood, Y-Cross, Dagger, Stick, Spacing, Curl-Flat, Four Verticals, Drive, Levels,
  Shallow Cross, Slants, Spot, China, Divide
- RUN: Inside Zone, Outside Zone, Counter, Power, Duo, Toss, Trap, Draw, ISO, Sweep, Dive, QB Run
- OTHER: Screens, Play Action, RPO, Option, Trick, Goal Line, Two-minute, Red Zone, Shot Play, Base
Distinct, pleasant colors per category (hex values stored in the doc; readable on the dark UI).

## 2. Category manager
PASS / RUN / OTHER columns; add, rename (inline), color (swatch picker), nest (drag onto a parent or "Move under…";
no cycles), reorder, delete (confirm; also removes its tags). Counts per category (incl. descendants).

## 3. Tagging workspace
- Scope picker: a playbook doc (its resolved plays via `resolvePlaybook`), all custom plays, a library formation › set,
  or a search over the catalog.
- Plays as rows (mini PlayCard + name + set) with their tags as colored chips; click a chip to toggle; bulk-tag the
  selected rows; per-play notes (`doc.notes`).
- SUGGESTIONS column, applied ONLY when the user accepts (accept / accept all visible / dismiss), each with its reason:
  - from offensePlayType: RunInsideZone → Inside Zone, RunOutsideZone → Outside Zone, RunPower → Power, RunCounter →
    Counter, RunTrap → Trap, RunDraw → Draw, RunISO → ISO, RunSweep / RunPitch → Toss / Sweep, QBRun / QBSneak → QB Run,
    PassScreen / PAScreenPass → Screens, PassPlayAction → Play Action, RPO* → RPO, Option* → Option;
  - from reads[].concept: Concept_Mesh → Mesh, Concept_Smash → Smash, Concept_Flood → Flood, Concept_Y_Cross → Y-Cross,
    Concept_Dagger → Dagger, Concept_Curl_Flat → Curl-Flat, Concept_Four_Verticals → Four Verticals,
    Concept_Shallow_Cross → Shallow Cross, Concept_Spacing → Spacing, Concept_Stick → Stick, Concept_Levels → Levels,
    Concept_Drive → Drive, Concept_Slant_Flat / Concept_Double_Slant → Slants, Concept_Spot → Spot, Concept_China →
    China, Concept_Divide → Divide, Concept_Shot_Play → Shot Play … (match by normalized name to the user's categories,
    so renamed/added categories still get suggestions);
  - from assignment routeTypes and play names (name contains "Mesh", "Snag", "Dagger", "Counter", "Power"…).

## 4. Gameplan views
- "Run concepts by formation": for a chosen playbook, a matrix of rows = formations › sets, columns = RUN categories,
  cells = counts with a hover list of plays; empty cells highlighted as holes. Same for PASS concepts.
- "What do I have for…": pick a SituationKey (SITUATION_GROUPS / SITUATION_LABELS) → plays in the playbook with a cpu
  weight for it, sorted by weight, with their categories.
- Coverage summary per category: plays count, which formations, audible usage.
- Filter / group / color by category everywhere in this view.

## 5. `model/concepts.ts` (pure, tested)
Seeds, slug ids, the suggestion engine (with reasons), tag ops (toggle / bulk), nesting ops (no cycles), delete with tag
cleanup, gameplan queries over a ResolvedBook. All edits via `useWorkspace.getState().update(CONCEPTS_PATH, …)`.
Deep link: `#/concepts?play=<key>` focuses that play in the tagging workspace.
Legend: A TOGGLE TAG, X ACCEPT SUGGESTION, Y ACCEPT ALL, LT/RT SECTION, B BACK.
