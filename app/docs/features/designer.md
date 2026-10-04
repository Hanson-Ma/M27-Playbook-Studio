# Feature: Play designer (`#/designer`)

> **v1 brief (round 2) — partly superseded.** v2 (ARCHITECTURE.md "★ v2 direction") made the app keyboard + mouse
> only: every pad / legend / glyph / bumper / single-letter-key instruction below is obsolete (controller glyphs remain
> only for audible slots), "formation-ambiguous" / special-teams caveats are gone (the game-side builder resolves names
> by side), and custom sets now build. Current behaviour: the in-app Help (`src/views/help/content/`).

Owns: `src/views/designer/**`, `src/model/routes.ts` (+ `routes.test.ts`), `src/model/designer.ts` (+ `designer.test.ts`).
Brief: WEB_APP_PROMPT.md §4. Authors custom plays into `playbooks/plays/*.json` exactly per FORMATS.md §3.
Must round-trip `playbooks/plays/pbs-ytrips-v1.json` and `art-test.json` unchanged in meaning.

## Verified conventions (from the example plays and library data)
- ReceiverCut direction = the turn's rotation sense: `RECEIVER_CUT_DIR_RIGHT` = clockwise (heading angle decreases,
  e.g. 90° → 45° toward +x), `RECEIVER_CUT_DIR_LEFT` = counter-clockwise (90° → 160°). Examples: PBS Snag slot 2
  (right slot, 90 → 45 corner) uses RIGHT; PBS PA Yankee slot 4 (right WR, 90 → 160 over) uses LEFT; Curls' left WR
  "CurlRt" hooks back toward +x with RIGHT.
- ReceiverCut cutType ≈ the magnitude of the turn: ~22° → _22, ~35–50° → _45, ~60–75° → _67, ~90° → _90; curls,
  comebacks, 180s and double moves use their named cut types (see `enums.json` ReceiverCutAngle).
- Leg = `RunRoute` (receivers), `MoveDirection` (non-route movement), `ReceiveHandoff` (ballcarrier through the mesh).
  Each leg starts where the previous ended. Speeds per leg (80 on a stem, 100 after the break is common).
- Releases are the first 1–2 yd leg angled inside or outside, optionally preceded by `InitialAnim` MOVETYPE_WRSTART /
  _WRSTART_QUICK. "Inside" means toward the ball: for a player at x > 0 an inside release heads 95–110° (toward −x;
  e.g. PBS Snag slot 5, the TE at x = 5: 1 yd @ 90° then 5 yd @ 105°), for x < 0 it heads 70–85°. (FORMATS.md's
  "95–110° for a left-side player" reads mirrored; trust the data.)
- AutoMotion waypoints are ABSOLUTE field positions; each waypoint has speed and locoStyle (NORMAL run / STRAFE
  shuffle); startEvent AUTOMOTIONSTARTEVENT_SNAP for snap motion; the route continues from the last waypoint.
- Custom play key = folder(base.set) + asset. Authored assignments live at Assignments/PBS/<new>.
- `keep` keeps the first N steps of the template (default template = the base play's slot): 1 keeps an AutoMotion,
  2 keeps a handoff precan (see PBS Mtn Drive slot 4 and PBS Reverse QB Lead slot 0).

## 1. Entry (`#/designer`)
- Left: plays files (`useDocsOfKind("plays")`) with their plays as PlayCards (sm grid; NEEDS MOD/CUSTOM badges
  automatic; problems from `ResolvedPlay.problems` shown as a red chip). "New plays file" (promptDialog →
  `playbooks/plays/<slug>.json` = `{ "plays": [] }`). Remember `settings.lastPlaysFile`.
- "NEW PLAY" (X) wizard (Modal with steps, all pad-drivable): Formation (offense side, hide minigames) → Set → Base
  play: every library play in the set as cards grouped into PASS (by read concept), RUN TEMPLATES grouped by blocking
  scheme leaf (BTInsideZone → "Inside Zone", BTOutsideZone, BTPower, BTCounter, BTTrap, …), PLAY ACTION, SCREENS,
  OTHER → name (unique within the set, vs library + custom) → target plays file. URL entry
  `#/designer/new?set=…&base=…[&slot=n&assignment=path][&file=…]` pre-fills the wizard and, when given, sets that slot
  to the string assignment. Creating appends `{ name, asset, base }` (+ players) to the plays doc and navigates to
  `#/designer/<file>/<index>`.

## 2. Editor (`#/designer/<file>/<index>`), three panes
- LEFT (play): name (unique in set, live check); asset (auto = prefix + sanitized name, editable, `[A-Za-z0-9_]`, unique
  in the set folder incl. library leaves); base play (swap within the same set; warn that slot edits carry over only
  where compatible; mechanics slots reset); playType (SearchSelect over OffensePlayType, "Inherit from base" clears the
  key); blocking scheme (SearchSelect over unique blocking leaves from library plays, "Inherit"); runHole (0–9 with a
  hole diagram: odd left, even right); VIP / red route (pick an eligible slot; art recolors live); READS editor (order
  eligible slots by drag, pct sliders 0–1, concept SearchSelect over ConceptType, combo NumberField; reads are written
  only when edited — "Reset to base reads" removes the key; show the FORMATS.md note about multiple red routes when
  reads are rewritten); the file's other plays (switch, duplicate, delete with confirm); "Add to playbook…"
  (`addPlayToSpec` into a chosen playbook doc).
- CENTER: big interactive Field + PlayArtLayer (labels) with editing overlays.
  - Select a slot by clicking a player or with LT/RT (prev/next player); the inspector shows that slot.
  - Route editing (segment drawing, not freehand): handles on every leg end; drag to move (snap to the 0.5 yd grid and
    5° angles unless the FREE toggle is on or Alt is held); click empty field to append a vertex (a new leg of the slot's
    leg type); Delete removes the selected vertex; double-click or Enter ends drawing; right-click a vertex (or Y) opens
    its cut menu (ReceiverCutAngle values from enums; direction auto-computed from the turn, overridable) and the
    leg's speed. While dragging, show the leg's distance/angle next to the cursor; the Field shows coordinates.
  - Motion waypoints are draggable handles too (absolute positions); X adds a waypoint when the MOTION tab is active.
  - Locked mechanics slots (`ResolvedSlot.mechanics` on the base slot) show a lock badge and can't be dragged; the
    inspector explains why (handoffs/fakes/options/pitches stay paired — change them by choosing another base, or with
    `keep` on both slots) and offers "Edit after the precan (keep N)".
  - Drags must stay fast: keep a local draft during the drag and commit once on pointerup (or update with
    `coalesceMs`), never rebuild the whole catalog per mouse move. Use `computeArt(set, slots, opts)` directly on the
    editor state for the live art.
- RIGHT (player inspector) tabs, cycled with VIEW (key V). Pad zones: LS goes field → inspector, then toggles
  inspector ⇄ play panel (left); LEFT at the inspector's left edge enters the play panel and RIGHT at the play panel's
  right edge comes back; B returns to the field. UP/DOWN move spatially (`moveFocus`), LEFT/RIGHT stay in the row,
  step segmented controls and sliders in place; a focused NumberField takes LEFT/RIGHT (step) and LT/RT (×10).
  Entering a zone or switching tabs lands on the last control used in that tab.
  - ROUTE — preset picker as MiniRoute tiles from the player's real alignment: slant, flat, out, in/dig, curl,
    comeback, hitch, corner, post, go/fade, seam, wheel, drag/shallow, whip, snag, arrow, angle, swing, bubble.
    Parameters: stem depth, break angle, break direction (in/out, direction-aware: "out" for a left-side player is −x),
    break-leg length, release type, speed per leg, end (GetOpen / sit = curl-style cut + GetOpen / none). Leg table
    (distance, direction, speed; cut per vertex) editable numerically. "Use an existing assignment": route-library list
    (MiniRoutes grouped by routeType) — choosing one sets the slot to the string path.
  - RELEASE — inside / outside / vertical releases (first leg + optional InitialAnim), double moves: stutter,
    stutter-go, slant-and-go, hitch-and-go in/out, out-and-up, stick-nod, zig (ReceiverCut types
    RECEIVER_CUT_ANGLE_STUTTER, _STUTTER_STREAK, _SLANT_AND_GO, _HITCH_GO_INSIDE/_OUTSIDE, _OUT_AND_UP, _STICKNOD, _ZIG).
    No juke / "fake-out at vertex": RunRouteFakeOut has no instance in assignments.json, so PlayBuilder can't author it
    (it copies each step's opcode from a library assignment). A loaded fake-out can only be removed (cut menu).
    Only step types that occur in assignments.json are offered anywhere (STEPS tab included); a loaded step the
    builder can't make is flagged ("Can't build" chip, slot error panel, red mark on the field) and validation reports
    it as an error (`step-unbuildable`).
  - BLOCK — pass block (time-then-release), run block, lead / kickout / trap / wham / crack / stalk (LeadBlock technique
    + gap, gap picker drawn as a mini line with A–E/OUTSIDE gaps and RUN_HOLE), pull (InitialAnim pull type +
    LeadBlock), screen release (PassBlock flags PassBlockFlags_ProtectReceiver).
  - MOTION — AutoMotion editor: waypoint list (x, y, speed, style run/shuffle, facing), presets jet (across the
    formation just behind the LOS to the far side), orbit (arc of several waypoints behind the QB), return/shift (out
    and back), short (2–3 yd); remove motion.
  - STEPS — raw step table (escape hatch): every step with a type dropdown and per-field editors (enum fields →
    SearchSelect of `lib.enumValues(lib.enumForField(type, field))`; numbers → NumberField; booleans → Toggle;
    waypoints → sub-table); add / remove / reorder steps; the trailing None is implicit.
  - INFO — the slot's ResolvedSlot (library assignment or authored name), routeType SearchSelect over AssignRouteType
    for authored steps, changed flag, "Reset to base".

## 3. `model/routes.ts` (pure, tested)
- Presets → Step[] for `{ start: Vec, side: "left" | "right" (x < 0 → left), params }`; releases; double moves.
- Editable route: `toEditableRoute(steps)` splits a chain into `{ prefix (InitialAnim / AutoMotion / OverrideFormPos /
  mechanics…), legs: [{ distance, direction, speed, type, cutBefore?: ReceiverCut step, …extra fields preserved }],
  suffix (GetOpen / Delay / blocks / None…) }` and `fromEditableRoute` rebuilds it. Byte-for-byte round trip of EVERY
  assignment chain in data/library/assignments.json (test all 5,402: `fromEditableRoute(toEditableRoute(s))` deep-equals
  `s`, including key order and untouched numbers).
- Points ⇄ legs (dragging a vertex recomputes only the two adjacent legs, 0.01 precision; untouched legs keep their
  exact numbers), snapping helpers (0.5 yd, 5°), `cutFor(prevHeading, nextHeading)` per the verified conventions.
- Block and motion step builders + motion presets.

## 4. `model/designer.ts` (pure, tested)
- Editor state ⇄ CustomPlaySpec. State = spec-level fields + per-slot full step chains (incl. None) starting from the
  resolved base.
- `specFromState` emits the MINIMAL spec: `players` only for slots that differ from the base; steps equal to a library
  assignment → string path relative to ASSIGNMENT_ROOT; equal to an authored assignment already defined in any plays
  file (`catalog.authored`) → reuse that `new` name with identical steps; otherwise a NewAssignmentSpec with a generated
  unique `new` name (prefix + sanitized "<SlotLabel>_<Family><depth>", e.g. PBS_Slot_Corner7; unique across all authored
  names), routeType (from the preset or the user), and `keep` = the number of leading template (base slot) steps kept
  (1 for a kept AutoMotion, 2 for a kept precan) exactly like the examples. playType / blocking / runHole / vip / reads
  are written only when they differ from the base or were explicitly present in the loaded spec. Unknown keys of the
  play spec and of each player spec are preserved.
- `stateFromSpec(spec, catalog)` is the reverse.
- Tests: every play in pbs-ytrips-v1.json and art-test.json → stateFromSpec → specFromState deep-equals the original
  (ignoring key order), and both resolve (via `resolveCustomPlay`) to identical per-slot steps; generated names are
  unique and `[A-Za-z0-9_]`.

## 5. Persistence and input
- All writes via `useWorkspace.getState().update(filePath, draft => …, { label, coalesceMs })`; `setActive(filePath)`;
  mod+s saves; undo/redo works between drags.
- Legend: A SELECT, B BACK / DESELECT, X ADD VERTEX (or waypoint), Y CUT MENU, LT/RT PREV/NEXT PLAYER, RS FLIP VIEW,
  VIEW INSPECTOR TAB, LS INSPECTOR / PLAY PANEL, plus mod+z / shift+mod+z (pad: hold VIEW + LB/RB). ⌘S (VIEW+MENU)
  saves the plays file while the designer is open (it is the active doc; leaving the designer clears it).
- The editor follows the play, not its index: undo/redo of an insert/delete re-navigates to the play's new index, or
  shows "This play was removed" with Undo (X) / Redo (Y) / Back.
- Right-click on a vertex opens the cut menu (right/middle presses never start a drag).
- Names: applying a preset regenerates a generated-looking assignment name (a name the user picked is kept); a hand
  edit that changes the inferred routeType re-infers it on write.
- Rename everywhere: changing the play's Name (or asset) shows what still points at the old identity — playbooks
  listing it by name in its set, concepts.json tags / notes / dismissed keyed by its PlayKey, favorites / recents — with
  "Update everywhere" (model/playRefs.ts; each doc gets its own undo step, saved with ⇧⌘S).
- NewPlayWizard base-play step: concept-category chips (LT/RT cycle) and category colour dots on the cards.
