// Shared types for Playbook Studio. This file is the contract between every module.
// Source of truth for the data formats: docs/FORMATS.md (repo root). Keep these types in sync with it.
//
// Conventions
// - Field coordinates are yards relative to the ball: +x = offense's right, +y = upfield (LOS = 0).
// - Angles are absolute degrees: 0 = +x (right), 90 = upfield, 180 = left, 270 = back.
// - Library things are identified by `asset` (full EBX path), never by display name alone.

/** Full EBX asset path, e.g. "football/Gameplay/playbooks/PlayLibrary/Formations/Offense/Shotgun/Y_Trips_Wk/Curls". */
export type Asset = string;

export const PLAYLIBRARY_ROOT = "football/Gameplay/playbooks/PlayLibrary/";
/** Player specs reference assignments by path under this root, e.g. "RunRoute/WR_Run90for30". */
export const ASSIGNMENT_ROOT = "football/Gameplay/playbooks/PlayLibrary/Assignments/";
/** Custom play specs reference blocking schemes by leaf name under this root, e.g. "BTCounter". */
export const BLOCKING_ROOT = "football/Gameplay/playbooks/PlayLibrary/Blocking/";
/** Authored (`new`) assignments are built under ASSIGNMENT_ROOT + AUTHORED_FOLDER + name. */
export const AUTHORED_FOLDER = "PBS/";

export interface Vec {
  x: number;
  y: number;
}

// ───────────────────────────── Library (data/library/*.json, read-only) ─────────────────────────────

export type FormationType =
  | "FormationType_Offense"
  | "FormationType_Defense"
  | "FormationType_Kickoff"
  | "FormationType_KickReturn"
  | "FormationType_SafetyKickoff"
  | "FormationType_Safety_KickReturn"
  | (string & {});

export interface FormationDef {
  formId: number;
  name: string;
  type: FormationType;
  asset: Asset;
}

/** One player's alignment inside a set movement (pre-snap preset). */
export interface AlignmentPos {
  /** Slot index (= assignment index). Present in the 2026-10-04 library export; identifies preset entries. */
  slot?: number;
  pos: string; // Position enum, e.g. "POSITION_WR"
  depth: number; // depth-chart index (WR1, WR2…)
  /** Slot whose spot this player takes, mirrored, when the play is flipped (FORMATS.md §1). */
  flipAssign?: number;
  x: number;
  y: number;
  facing: number;
  stance: string; // StanceType enum
  group: string; // setGroupType enum, e.g. "Set_Group_Type_MotionMan2"
  motionMan: boolean;
  /** Custom sets: the player keeps his own spot when the play is flipped (only his route mirrors). */
  stayOnFlip?: boolean;
}

export interface SetDef {
  setId: number;
  name: string;
  asset: Asset;
  formation: Asset;
  classification: string; // SetClassification enum
  setType: string; // SetType enum
  canFlip: boolean;
  /**
   * "Normal" is the base alignment (slot order = assignment order).
   * Other keys (M1left, M1right … SM5right, defensive shifts…) are pre-snap motion presets; they list only the players
   * that move, matched to Normal slots by (pos, depth).
   */
  movements: Record<string, AlignmentPos[]>;
}

export interface ReadDef {
  pos: number; // slot number (1–5 = eligible non-QB skill slots)
  pct: number; // 0–1
  concept?: string; // ConceptType enum
  combo?: number;
  [key: string]: unknown;
}

export interface PlayDef {
  playId: number;
  name: string;
  asset: Asset;
  set: Asset;
  offensePlayType: string;
  defensePlayType: string;
  blocking: Asset; // full asset of the BlockingSchemeDefine
  runHole: number; // 0 middle, odd = left (1 A, 3 B, 5 C, 7 D, 9 E), even = right (2 A, 4 B, 6 C, 8 D)
  vip: number; // slot of the primary receiver (red route)
  allowHotRoutes: boolean;
  canFlip: boolean;
  global: boolean; // false = needs the mod to show up in a custom playbook
  assignments: Asset[]; // one PositionAssignmentDefine per slot
  reads: ReadDef[];
}

/** One step of an assignment chain. `type` is the step class; other fields depend on it (see FORMATS.md). */
export interface Step {
  type: string;
  [field: string]: unknown;
}

export interface AssignmentDef {
  id: number;
  routeType: string; // AssignRouteType enum
  steps: Step[]; // always terminated by { type: "None" } in library data
}

export interface EnumsFile {
  /** "StepType.field" → enum name, e.g. "ReceiverCut.cutType" → "ReceiverCutAngle". */
  fields: Record<string, string>;
  enums: Record<string, string[]>;
}

export interface LibraryData {
  formations: FormationDef[];
  sets: SetDef[];
  plays: PlayDef[];
  assignments: Record<Asset, AssignmentDef>;
  enums: EnumsFile;
}

// Typed views of the common step types (all are `Step`s; use the guards in model/steps.ts).
export interface RunRouteStep extends Step {
  type: "RunRoute" | "MoveDirection" | "ReceiveHandoff" | "RecievePitch";
  distance: number;
  direction: number;
  speed: number;
}
export interface ReceiverCutStep extends Step {
  type: "ReceiverCut";
  direction: "RECEIVER_CUT_DIR_LEFT" | "RECEIVER_CUT_DIR_RIGHT" | "RECEIVER_CUT_DIR_INVALID" | (string & {});
  cutType: string; // ReceiverCutAngle enum
}
export interface AutoMotionWaypoint {
  position: Vec; // absolute field position
  speed: number;
  facingAngle: number;
  locoStyle: "AUTOMOTIONLOCOSTYLE_NORMAL" | "AUTOMOTIONLOCOSTYLE_STRAFE" | (string & {});
  shouldFaceEndPoint: boolean;
  transitID: number;
  [key: string]: unknown;
}
export interface AutoMotionStep extends Step {
  type: "AutoMotion";
  waypoints: AutoMotionWaypoint[];
  startEvent: string; // AutomotionStartEvent enum
  startDelay?: number;
  endDelay?: number;
  stanceAtTarget?: string;
}

// ───────────────────────────── Specs written by the app (playbooks/**) ─────────────────────────────
// Every spec interface allows unknown keys: the app must preserve keys it doesn't understand.

export type Side = "offense" | "defense";
export type AudibleSlot = 1 | 2 | 3 | 4;

/** playbooks/<name>.json → custom playbook save PBOOKOFF-<NAME> (FORMATS.md §2). */
export interface PlaybookSpec {
  name: string; // A–Z0–9 only
  side: Side;
  notes?: string;
  formations: FormationEntry[];
  [key: string]: unknown;
}

export interface FormationEntry {
  formation: string; // display name, resolved like tools/pbook-build.mjs formByName
  sets: SetEntry[] | "template"; // "template" = copy from the template save (special teams)
  [key: string]: unknown;
}

export interface SetEntry {
  set: string; // display name, resolved inside the formation's asset folder
  plays: PlayEntry[];
  [key: string]: unknown;
}

export interface PlayEntry {
  play: string; // display name, resolved inside the set (library or custom play)
  audible?: AudibleSlot;
  cpu?: Record<string, number>; // situation key → weight 0–100 (keys: model/situations.ts)
  [key: string]: unknown;
}

/** playbooks/plays/*.json → merged into mods/pbstudio.fbmod (FORMATS.md §3). */
export interface PlaysFile {
  plays: CustomPlaySpec[];
  [key: string]: unknown; // e.g. title, version, description, notes, bundles, brtRef
}

export interface CustomPlaySpec {
  name: string; // in-game name, unique within its set
  asset: string; // leaf name, [A-Za-z0-9_], unique within the set folder
  base: Asset; // library play IN THE SAME SET
  playType?: string; // OffensePlayType enum; defaults to base's
  blocking?: string; // blocking scheme leaf under BLOCKING_ROOT
  runHole?: number;
  vip?: number;
  /** Slot number as a string key → assignment. Only slots that change. */
  players?: Record<string, PlayerSpec>;
  reads?: ReadDef[]; // replaces the base's reads
  [key: string]: unknown;
}

/** Either a path under ASSIGNMENT_ROOT (reuse an existing assignment) or a new authored assignment. */
export type PlayerSpec = string | NewAssignmentSpec;

export interface NewAssignmentSpec {
  new: string; // asset leaf under Assignments/PBS/; reused if the same name repeats
  routeType?: string; // AssignRouteType enum
  template?: string; // path under ASSIGNMENT_ROOT; default = the base play's assignment for this slot
  keep?: number; // keep the first N steps of the template (1 = an AutoMotion, 2 = a handoff precan); -1 = every step
  drop?: string[]; // step types removed from the template first (e.g. ["OverrideFormPos"])
  prepend?: Step[]; // steps placed before everything else (e.g. an OverrideFormPos realignment)
  steps: Step[]; // without the trailing None (added by the builder)
  [key: string]: unknown;
}

/** playbooks/sets/*.json → custom formations, sets and set clones (FORMATS.md §5; built into the same mod by SetBuilder). */
export interface SetsFile {
  sets: CustomSetSpec[];
  formations?: CustomFormationSpec[];
  [key: string]: unknown;
}

export interface CustomSetSpec {
  name: string;
  asset: string;
  base: Asset; // existing Set asset (cloned)
  formation: Asset; // existing Formation asset, or the asset of a new formation in this file
  positions?: SlotPosition[]; // changed slots only
  /** Edit an EXISTING preset's target spot for a slot that preset already moves (SetBuilder can't add or remove presets). */
  movements?: Record<string, SlotPosition[]>;
  /** Plays cloned into the new set (built game-side, FORMATS.md §5). */
  plays?: CloneSpec[];
  [key: string]: unknown;
}

/**
 * A play cloned into a custom set: keeps the `from` play's assignments (from ANY set), new name/asset/set.
 * May carry any §3 play fields to modify the clone. Its asset becomes <custom set folder>/<asset>.
 */
export interface CloneSpec {
  from: Asset;
  name: string;
  asset: string;
  players?: Record<string, PlayerSpec>;
  reads?: ReadDef[];
  vip?: number;
  playType?: string;
  blocking?: string;
  runHole?: number;
  [key: string]: unknown;
}

export interface SlotPosition {
  slot: number;
  x?: number;
  y?: number;
  stance?: string;
  facing?: number;
  /** positions only: flip partner slot (the builder recomputes flipped spots from it). */
  flipAssign?: number;
  /** positions only: primaryMotionMan. */
  motionMan?: boolean;
  /** positions only: the player's position (Position enum, e.g. "POSITION_TE"): who the game puts in this slot. */
  pos?: string;
  /** positions only: depth-chart index for `pos` (1 = TE1, 2 = TE2…). */
  depth?: number;
  /** positions only: keep this spot when the play is flipped (the builder writes it as the flipped spot). */
  stayOnFlip?: boolean;
  [key: string]: unknown;
}

export interface CustomFormationSpec {
  name: string;
  asset: string;
  base: Asset;
  [key: string]: unknown;
}

// ───────────────────────────── Editor-only data (app-data/*.json) ─────────────────────────────

export type CategoryGroup = "pass" | "run" | "other";

export interface ConceptCategory {
  id: string; // stable slug
  name: string;
  group: CategoryGroup;
  color: string; // CSS color
  parent?: string; // id of the parent category (nesting)
  [key: string]: unknown;
}

/** app-data/concepts.json */
export interface ConceptsDoc {
  version: 1;
  categories: ConceptCategory[];
  /** PlayKey → category ids. */
  tags: Record<string, string[]>;
  /** PlayKey → free-text note. */
  notes?: Record<string, string>;
  /** PlayKey → suggested category ids the user dismissed (the concepts view hides those suggestions). */
  dismissed?: Record<string, string[]>;
  [key: string]: unknown;
}

/**
 * app-data/routes.json — the user's saved custom routes ("My Routes"), reusable on any play and player.
 * Steps are the route part only (release/legs/cuts/end; no motion or handoff prefix), authored for `side`; applying a
 * route to a player on the other side of the ball mirrors it (direction → 180 − d, cut LEFT ↔ RIGHT).
 */
export interface SavedRoute {
  id: string;
  name: string;
  /** Side of the ball the route was drawn for: "left" = x < 0. */
  side: "left" | "right";
  steps: Step[];
  routeType?: string;
  /** Free-form tags ("quick", "red zone"…). */
  tags?: string[];
  notes?: string;
  createdAt?: string;
  source?: { play?: PlayKey; slot?: number; label?: string };
  [key: string]: unknown;
}

export interface RoutesDoc {
  version: 1;
  routes: SavedRoute[];
  [key: string]: unknown;
}

// ───────────────────────────── Resolved catalog (library + custom plays) ─────────────────────────────

/**
 * Unique play identity across library and custom plays: the full asset path.
 * Custom plays: set folder + "/" + spec.asset (what the game-side builder creates).
 */
export type PlayKey = string;

export type PlaySource = "library" | "custom";

export interface ResolvedSlot {
  /** Steps as the game will run them (trailing None included). */
  steps: Step[];
  /** Library assignment asset when the slot uses an existing assignment. */
  assignment?: Asset;
  /** Authored assignment name (NewAssignmentSpec.new) when the slot was authored. */
  authored?: string;
  routeType?: string;
  /** True when this slot carries handoff/fake/option/pitch mechanics that must stay paired (designer locks it). */
  mechanics?: boolean;
  /** True when the custom play changes this slot relative to its base. */
  changed?: boolean;
}

export interface ResolvedPlay {
  key: PlayKey;
  source: PlaySource;
  name: string;
  asset: Asset;
  set: Asset;
  formation: Asset;
  side: Side | "special";
  playType: string; // offensePlayType, or defensePlayType for defense
  blocking: Asset;
  runHole: number;
  vip: number;
  reads: ReadDef[];
  canFlip: boolean;
  allowHotRoutes: boolean;
  /** Usable in a custom playbook without the mod. Custom plays are never global. */
  global: boolean;
  playId?: number; // library plays only
  slots: ResolvedSlot[];
  /**
   * Custom plays: the base play key, the plays file path, and the index inside that file.
   * Clones (plays cloned into a custom set, FORMATS.md §5): base = the `from` play, file = the sets file, no index.
   */
  base?: PlayKey;
  file?: string;
  index?: number;
  /**
   * Set for plays cloned into a custom set (built from playbooks/sets/*.json, edited in the Formations view):
   * the sets file, the custom set's index in its `sets`, and the clone's index in that set's `plays`.
   */
  clone?: { file: string; setIndex: number; index: number };
  /** Resolution problems (unknown base, missing assignment…). Empty when OK. */
  problems: string[];
}

// ───────────────────────────── Play art (output of model/art.ts) ─────────────────────────────

export type ArtKind =
  | "route" // pass route (yellow)
  | "primary" // the VIP's route (red)
  | "run" // ballcarrier path (red)
  | "block" // blocking (gray, T cap)
  | "motion" // snap motion / AutoMotion (light blue)
  | "preset" // pre-snap motion preset (light blue, dashed)
  | "qb" // QB drop / rollout / handoff path (white)
  | "option" // option/pitch relationship (white dashed)
  | "rush" // defensive pass rush / blitz (red)
  | "coverage" // defender → zone or man (thin, zone color)
  | "realign"; // OverrideFormPos realignment (thin dotted)

export type ArtCap = "arrow" | "block" | "none" | "dot";

export interface ArtVertex {
  /** Index into ArtPath.points. */
  index: number;
  /** ReceiverCut cutType (or other marker) at this vertex. */
  cut?: string;
  cutDir?: string;
  /** Index of the step that produced this vertex in the slot's step list. */
  step?: number;
}

export interface ArtPath {
  slot: number;
  kind: ArtKind;
  points: Vec[];
  cap: ArtCap;
  dashed?: boolean;
  vertices?: ArtVertex[];
  /** Short label drawn near the end (e.g. "SIT", "BLOCK", "PULL"). */
  label?: string;
  /** One branch of an option route the receiver doesn't run by default (the coverage picks it): never run in playback. */
  alt?: boolean;
  /** Color family the game uses instead of the kind's: "release" = a route that starts with a block (block and release: dark blue). */
  tone?: "release";
  /** Option-route branch this path draws (its OptionRoutes leaf). */
  option?: string;
}

export type ZoneKind = "deep" | "hook" | "flat" | "curlflat" | "spy";

export interface ArtZone {
  slot: number;
  kind: ZoneKind;
  center: Vec;
  rx: number;
  ry: number;
  label?: string;
}

export type PlayerGlyph = "qb" | "center" | "ol" | "skill" | "def";

export interface ArtPlayer {
  slot: number;
  pos: string;
  depth: number;
  /** Short label: QB, HB, FB, WR1, SL, TE, LT, LG, C, RG, RT, CB, FS… */
  label: string;
  glyph: PlayerGlyph;
  /** Alignment from the set (Normal or the chosen preset). */
  base: Vec;
  /** Where the player lines up for this play (after OverrideFormPos). */
  at: Vec;
  /** Where the play starts for this player at the snap (after pre-snap motion presets). */
  snap: Vec;
  facing: number;
  stance: string;
  isVip: boolean;
  isBallcarrier: boolean;
  motionMan: boolean;
  side: Side;
}

export interface ArtBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface PlayArt {
  players: ArtPlayer[];
  paths: ArtPath[];
  zones: ArtZone[];
  bounds: ArtBounds;
  flipped: boolean;
}

export interface ArtOptions {
  vip?: number;
  runHole?: number;
  /** Mirror left/right (visualization only). */
  flip?: boolean;
  /** Show a pre-snap motion preset (key of SetDef.movements other than "Normal"). */
  preset?: string;
  /** Draw OL pass protection (hidden on small cards, shown in detail views). */
  showPassPro?: boolean;
  side?: Side;
  /** AssignRouteType per slot: option routes draw their branches from its name (RR_Option_Hitch_Fade → hitch, fade). */
  routeTypes?: (string | undefined)[];
  /** Steps of an option-route branch by its OptionRoutes leaf ("CurlRight", "InOutLeft"…), from the library. */
  optionRoute?: (leaf: string) => Step[] | undefined;
}

// ───────────────────────────── Workspace / documents ─────────────────────────────

export type DocKind = "playbook" | "plays" | "sets" | "concepts" | "appdata";

/** A file under playbooks/ or app-data/ as listed by the server. */
export interface FileInfo {
  path: string; // repo-relative with forward slashes, e.g. "playbooks/plays/pbs-ytrips-v1.json"
  kind: DocKind;
  size: number;
  mtime: number;
}

export interface ValidationIssue {
  level: "error" | "warning" | "info";
  message: string;
  /** Repo-relative file path the issue belongs to. */
  file?: string;
  /** JSON-pointer-ish location inside the file, e.g. "/formations/0/sets/1/plays/3". */
  where?: string;
  /** Rule id, e.g. "audible-duplicate". */
  rule?: string;
}
