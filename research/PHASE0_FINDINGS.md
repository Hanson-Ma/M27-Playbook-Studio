# Phase 0 findings — Madden 27 play data

Last updated 2026-10-03. Source: headless dumps via `tools/PlayDump` (reads the game through MMC Editor's FrostySdk).

## Scale
11,055 `Play` · 808 `Set` · 118 `Formation` · 5,399 `PositionAssignmentDefine` · 304 `PlaybookAsset` · 136 `HotRouteDefine` · 39 `OptionRouteDefine` · 70 `BlockingSchemeDefine` · 1 `GlobalPlaySheet`

## Coordinates and units
- Positions are **yards** relative to the ball: X = lateral (+ = right), Y = depth (- = offensive backfield). QB under center is at Y = -1.4; in shotgun, Y = -6.
- `direction` / `facing` are **degrees**: 0 = toward +X (right), 90 = straight upfield, 180 = toward -X (left).
- `distance` is in yards. `speed` is 0–100 (percent).

## Play (`Play`)
- `Set` → the alignment. `positionAssignmentDefines[i]` is the assignment for the player in slot `i` of the set's "Normal" `preSnapMovements` entry (QB, RB, …, OL).
- Each `PositionAssignmentDefine` is a **shared, reusable** asset: `positionAssignId`, `routeType`, and an ordered chain `positionAssignment[]`, always terminated by `NoneAssignment`.
- `passData[]`: read progression (`position`, `percentage`, `concept` such as `Concept_Mesh`, `combo`).
- Run plays: `BlockingSchemeDefine` (BTPower, BTInsideZone, BTOutsideZone…), `runHole`.
- **No stored play art.** Play-call diagrams appear to be generated from the assignments (to confirm in-game).

## Assignment chain vocabulary (observed)
| Concept | Encoding |
|---|---|
| Pass route | `RunRoute(distance, direction, speed)` segments + `ReceiverCut(dir, cutType: 45/67/90/CURL/POSTCORNER/BUBBLE_SCREEN…)` → `GetOpen` |
| QB drop | `QBScramble(dropBackType=…5_STEP…, direction, distance)` |
| Handoff | QB and RB share a `CannedHandoff(handoffAnim pair)`; QB: `HandOffTurn` → `HandOffGive(exit)`; RB: `InitialAnim` → `ReceiveHandoff(distance, direction)` → `RunEndZone` |
| Play action | QB: `HandoffFake(exit=ROLLRIGHT…)` → `QBScramble`; RB: `ReceiveHandoff` → `PassBlock` |
| Pulling guard | `InitialAnim(MOVETYPE_POWER_PULL)` → `LeadBlock(LEAD_THROUGH_HOLE, RUN_HOLE)` |
| Kickout / lead | `LeadBlock(KICKOUT, D_GAP_RIGHT)` → `RunBlock` |
| WR stalk | `RunRoute(5, 90)` → `LeadBlock(STALK_BLOCK, RUN_HOLE)` → `RunBlock` |
| Jet / snap motion | `AutoMotion(waypoints=[{position, speed, facingAngle}], startEvent=SNAP)` |
| RPO | play type `RPOAlert`; QB: `CannedHandoff` → `QBScramble`; the game handles the read |
| Screen | `PassBlock(time)` → `RunRoute`… or `ReceiverCut(BUBBLE_SCREEN)` |

## Playbook (`PlaybookAsset`)
`Formations[] FormationSection{Formation, Sets[], overrideName, order}` → `SetSection{Set, plays[], audibles[] (4 per set), defaultSetPackage, excludedPackages}` → `PlaySheet{play, overrideName, order, PlaybookTier, OffenseSituations[]/DefenseSituations[] {situation, weight}}`.

### ⚠ `protobufString` — a compiled copy of the whole playbook
Base64 protobuf (432 KB for the Seahawks offense) holding sets, alignments, every play and **every assignment chain**, denormalized per play. It's probably the output of EA's PlayMaker→Playbook converter (`PlayMakerToPlaybookConverterParams` exists in the SDK). If the game reads this rather than the EBX tree, our bridge must regenerate it.
- Play message: `#1` name, `#2` playId, `#24` pass data, `#28` assignment define {`#1` positionAssignId, `#2` routeType, `#3`[] assignments {`#1` opcode (GameAssignmentDefs), `#<n>` payload}}.
- RunRoute = opcode 8, payload `#6 {#1 distance, #2 direction, #3 speed, #5 facing}` (f32).
- Tools: `tools/protodump.mjs` (tree), `tools/protofind.mjs` (find a play / assignment with byte offsets).

## Oracle result (2026-10-03, in-game, Seahawks Practice)
- **Slants (EBX-only edit): changed.** The play-call art shows the left WR running a go, and the on-field route matches.
- **Curls (protobuf-only edit): unchanged** in both the art and on the field.
- ⇒ **The game builds plays and play art from the EBX tree.** `protobufString` isn't used for on-field play or the play-call art, at least in Practice. Plan: treat the EBX as the source of truth and decide later whether to keep the protobuf in sync (other modes may read it).
- Play art is generated from the assignments, so the designer never has to draw art separately.

## Bundles
- Each `PlaybookAsset` lives in its own bundle: `win32/football/gameplay/playbooks/gamesheets/<book>_playbooks_brt`.
- Each Play, Set and PositionAssignmentDefine is a member of the bundle of every book that uses it, plus `globalplaybooksheet_playbooks_brt` for most plays. Examples: Slants is in 17 bundles; Bunch Mesh in 3 (not Seahawks); `WR_Run90for30` in 551, which is why the oracle swap worked with no bundle change.
- ⇒ When a book references a play, set or assignment that isn't already in its bundle, the bridge must add that asset and its dependencies to the book's bundle (what PlayBundleAddPlugin does, but only for our one book). Check: `PlayDump bundles <asset>...`.

## Custom playbook saves (`Documents\Madden NFL 27\saves\PBOOKOFF-<name>`)
- `FBCHUNKS` container: magic, version, fixed sizes (0xF000), save timestamp (y/m/d h:m:s as u16s), build string `Madden-27-RL2_5-9171402`, then an EA **TDB** database zero-padded to 61,440 bytes. No container checksum seen.
- TDB tables (fixed capacity; current/max rows from PBOOKOFF-TEST):
  | table | rows | fields | meaning |
  |---|---|---|---|
  | PGPL | 648/750 | BOKL SETL PLYL PBST PLYT ord_ Flag | play entries: book, setId, **playId**, set, play-type code, order in set, **Flag = audible slot bit (2/4/8/16)** |
  | PGFM | 11/40 | BOKL PBFM SRFM | formations (formId) |
  | STID | 56/75 | BOKL SETL PBFM PBST SPF_ | sets in each formation |
  | STSP | 0/75 | BOKL SETL | ? |
  | PBAU | 5/50 | BOKL PBPL FTYP PBAU Flag | audible-related (5 slots, all PBPL 0 here) |
  | PBAI | 1336/2200 | BOKL PLYL AIGR prct | CPU situation weights: playId, situation group, percent |
  | SLEP | 0/10 | SETL SPF_ | ? |
- **IDs are the game's own**: PLYL = `Play.playId`, SETL = `Set.setId`, PBFM = `Formation.formId`. All 648 entries resolve via `research/index/*.tsv`.
- Field bits are little-endian bit-packed. **CRCs: CRC-32/MPEG-2** (poly 04C11DB7, MSB-first, init FFFFFFFF, no xorout). DB header `[db, db+20)`, table index, each table header `[t, t+32)`, and each table body `[t+36, end of max-size records)`. All 16 verify (`tools/tdbcrc.mjs`).
- ⇒ We can generate custom playbook saves directly, with no Frosty mod needed, as long as the plays exist in the game. Not yet proven: whether the game accepts a file we write.
- TODO: map AIGR → situation names and PLYT → play type; figure out PBAU/STSP/SLEP and the BOKL value (32764).

## Oracle test (as designed)
`mods/phase0-oracle.fbproject`, Seahawks offense, Shotgun → Y Trips Wk:
- **Slants**: EBX-only edit. Left outside WR is pointed at `WR_Run90for30` (a go) instead of his slant.
- **Curls**: protobuf-only edit. Left outside WR's curl stem is 10 → 30 yds. The EBX is unchanged.

| Result | Meaning |
|---|---|
| Slants changed, Curls didn't | Game reads the EBX tree; protobuf is stale or unused |
| Curls changed, Slants didn't | Game reads the protobuf; the bridge must regenerate it |
| Both changed | Mixed (e.g. art from one, on-field AI from the other) — note which screen showed what |
| Neither | Playbook data comes from elsewhere at runtime (cache/DB); investigate |

Also note whether the **play-call art** matches the on-field behavior for each play.
