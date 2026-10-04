// Library index: lookups over data/library/*.json (read-only game data). Name resolution mirrors tools/pbook-build.mjs
// so the editor resolves playbook display names exactly like the game-side builder does.
//
// An index can also be an OVERLAY (overlayLibraryIndex): the stock library plus the custom formations and sets the
// game-side builder creates from playbooks/sets/*.json (FORMATS.md §5). An overlay answers every lookup like the stock
// index (custom ones after the stock ones, the order pbook-build reads formations.tsv + custom-formations.tsv); plays,
// assignments and enums are shared with the stock index. `catalog.lib` is such an overlay (model/catalog.ts).
import { folder, leaf, norm } from "./names";
import {
  ASSIGNMENT_ROOT,
  PLAYLIBRARY_ROOT,
  type Asset,
  type AssignmentDef,
  type FormationDef,
  type FormationType,
  type LibraryData,
  type PlayDef,
  type SetDef,
  type Side,
} from "./types";

export interface FormationByNameOptions {
  /**
   * formIds to prefer (the template save's PGFM rows): tools/pbook-build.mjs picks a same-named formation the template
   * already contains before the folder-leaf rule.
   */
  preferFormIds?: ReadonlySet<number>;
}

export interface LibraryIndex {
  data: LibraryData;
  formationByAsset: Map<Asset, FormationDef>;
  setByAsset: Map<Asset, SetDef>;
  playByAsset: Map<Asset, PlayDef>;
  /**
   * Sets per formation asset, in data order: sets whose `formation` is this formation AND that live in its asset folder
   * (what a playbook can resolve by name). The 5on5 flag sets under Formations/Flag/ are only in setByAsset.
   */
  setsByFormation: Map<Asset, SetDef[]>;
  /** Plays per set asset, in data order (library plays only; clones in custom sets are catalog plays). */
  playsBySet: Map<Asset, PlayDef[]>;
  /** AssignRouteType → assignment assets (data order). */
  assignmentsByRouteType: Map<string, Asset[]>;
  formationOfSet(set: Asset): FormationDef | undefined;
  /** Full asset, or a path under ASSIGNMENT_ROOT ("RunRoute/WR_Run90for30"). */
  assignment(assetOrPath: string): AssignmentDef | undefined;
  enumValues(enumName: string): string[];
  enumForField(stepType: string, field: string): string | undefined;
  /**
   * tools/pbook-build.mjs `formByName`. Candidates: formations whose name matches (norm) and — with `side` — that are on
   * that side (defense ⇔ type FormationType_Defense / _KickReturn / _Safety_KickReturn; every other type is offense,
   * so offense "Special" is the punt/FG unit and "Kickoff" only exists for offense). Then: one whose formId is in
   * `opts.preferFormIds` (the template's PGFM), else one whose asset leaf normalizes to the name ("Shotgun" →
   * Offense/Shotgun/Shotgun, not the MG_Screen minigame), else the first. Without `side` every side is a candidate
   * (the builder's old behaviour; "Special" then picks the defensive one).
   */
  formationByName(name: string, side?: Side, opts?: FormationByNameOptions): FormationDef | undefined;
  /** pbook-build rule: first set inside the formation's asset folder whose name matches (norm); stock before custom. */
  setByName(formation: FormationDef, name: string): SetDef | undefined;
  formationSide(f: FormationDef): Side | "special";
  /** Minigames, skills trainers, tutorials, drills and pass skeletons — never in a real playbook. */
  isMinigame(f: FormationDef): boolean;

  /** The plain game library under this index (the index itself when it isn't an overlay). */
  stock: LibraryIndex;
  /** Assets of the custom formations and sets in this overlay (empty for the stock index). */
  customAssets: ReadonlySet<Asset>;
  /** True for a custom formation or set asset (from playbooks/sets/, built into the mod). */
  isCustom(asset: Asset): boolean;
  isCustomFormation(asset: Asset): boolean;
  isCustomSet(asset: Asset): boolean;
}

const FORMATIONS_ROOT = PLAYLIBRARY_ROOT + "Formations/";

/** tools/pbook-build.mjs `defenseTypes`: a defensive playbook's formations; every other type belongs to offense. */
export const DEFENSE_FORMATION_TYPES: ReadonlySet<FormationType> = new Set([
  "FormationType_Defense",
  "FormationType_KickReturn",
  "FormationType_Safety_KickReturn",
]);

/** The playbook side whose saves can hold this formation (pbook-build `sideOk`). */
export function formationBookSide(f: Pick<FormationDef, "type">): Side {
  return DEFENSE_FORMATION_TYPES.has(f.type) ? "defense" : "offense";
}

// Matched against the formation's folder and leaf names (e.g. "MG_Screen", "ST_Combine_Drills", "Cover0_PS").
const MINIGAME_RE = /^(MG|ST|NST)_|^Combine|Skeleton|^Small_Sided$|^Direct_Snaps$|_PS$/i;

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** ".../Formations/Offense/MG_Screen/MG_Screen" → ["Offense", "MG_Screen", "MG_Screen"]. */
function formationSegments(f: FormationDef): string[] {
  const rel = f.asset.startsWith(FORMATIONS_ROOT) ? f.asset.slice(FORMATIONS_ROOT.length) : f.asset;
  return rel.split("/");
}

export function formationSide(f: FormationDef): Side | "special" {
  const seg = formationSegments(f);
  // Offense/Special (punt, FG, kneel) and Defense/Special (returns, blocks) are special teams despite their type.
  if (seg.length > 2 && seg[1] === "Special") return "special";
  if (f.type === "FormationType_Offense") return "offense";
  if (f.type === "FormationType_Defense") return "defense";
  return "special";
}

export function isMinigame(f: FormationDef): boolean {
  const seg = formationSegments(f);
  const names = seg.length > 2 ? [seg[1], seg[seg.length - 1]] : [seg[seg.length - 1]];
  return names.some((n) => MINIGAME_RE.test(n));
}

/** Maps an overlay shares with its stock index (plays and assignments never change). */
interface Shared {
  playByAsset: Map<Asset, PlayDef>;
  playsBySet: Map<Asset, PlayDef[]>;
  assignmentsByRouteType: Map<string, Asset[]>;
}

const EMPTY_SET: ReadonlySet<Asset> = new Set();

function makeIndex(data: LibraryData, shared: Shared | undefined, stock: LibraryIndex | undefined, custom: ReadonlySet<Asset>): LibraryIndex {
  const formationByAsset = new Map<Asset, FormationDef>();
  for (const f of data.formations) if (!formationByAsset.has(f.asset)) formationByAsset.set(f.asset, f);

  const setByAsset = new Map<Asset, SetDef>();
  const setsByFormation = new Map<Asset, SetDef[]>();
  for (const s of data.sets) {
    if (setByAsset.has(s.asset)) continue; // a custom set never shadows a stock one (validation reports the clash)
    setByAsset.set(s.asset, s);
    if (s.asset.startsWith(folder(s.formation))) push(setsByFormation, s.formation, s);
  }

  let playByAsset: Map<Asset, PlayDef>;
  let playsBySet: Map<Asset, PlayDef[]>;
  let assignmentsByRouteType: Map<string, Asset[]>;
  if (shared) ({ playByAsset, playsBySet, assignmentsByRouteType } = shared);
  else {
    playByAsset = new Map();
    playsBySet = new Map();
    for (const p of data.plays) {
      playByAsset.set(p.asset, p);
      push(playsBySet, p.set, p);
    }
    assignmentsByRouteType = new Map();
    for (const asset in data.assignments) push(assignmentsByRouteType, data.assignments[asset].routeType, asset);
  }

  // Name lookups are hot in the playbook view (every row resolves its formation/set), so cache them per index.
  const byNormName = new Map<string, FormationDef[]>();
  for (const f of data.formations) push(byNormName, norm(f.name), f);
  const setsInFolder = new Map<string, SetDef[]>();
  const setsInFolderOf = (form: FormationDef): SetDef[] => {
    const dir = folder(form.asset);
    let list = setsInFolder.get(dir);
    if (!list) {
      list = data.sets.filter((s) => s.asset.startsWith(dir));
      setsInFolder.set(dir, list);
    }
    return list;
  };

  const emptyEnum: string[] = [];

  const index: LibraryIndex = {
    data,
    formationByAsset,
    setByAsset,
    playByAsset,
    setsByFormation,
    playsBySet,
    assignmentsByRouteType,

    formationOfSet(set) {
      const s = setByAsset.get(set);
      return s ? formationByAsset.get(s.formation) : undefined;
    },

    assignment(assetOrPath) {
      const asset = assetOrPath.startsWith(PLAYLIBRARY_ROOT) ? assetOrPath : ASSIGNMENT_ROOT + assetOrPath.replace(/^\/+/, "");
      return data.assignments[asset];
    },

    enumValues(enumName) {
      return data.enums?.enums?.[enumName] ?? emptyEnum;
    },

    enumForField(stepType, field) {
      return data.enums?.fields?.[`${stepType}.${field}`];
    },

    formationByName(name, side, opts) {
      const key = norm(String(name ?? ""));
      let named = byNormName.get(key) ?? [];
      if (side) named = named.filter((f) => formationBookSide(f) === side);
      const prefer = opts?.preferFormIds;
      return (
        (prefer?.size ? named.find((f) => prefer.has(f.formId)) : undefined) ??
        named.find((f) => norm(leaf(f.asset)) === key) ??
        named[0]
      );
    },

    setByName(formation, name) {
      const key = norm(String(name ?? ""));
      return setsInFolderOf(formation).find((s) => norm(s.name) === key);
    },

    formationSide,
    isMinigame,

    stock: undefined as unknown as LibraryIndex,
    customAssets: custom,
    isCustom: (asset) => custom.has(asset),
    isCustomFormation: (asset) => custom.has(asset) && formationByAsset.has(asset),
    isCustomSet: (asset) => custom.has(asset) && setByAsset.has(asset),
  };
  index.stock = stock ?? index;
  return index;
}

export function buildLibraryIndex(data: LibraryData): LibraryIndex {
  return makeIndex(data, undefined, undefined, EMPTY_SET);
}

/**
 * The stock library plus custom formations and sets (already built FormationDefs / SetDefs, in builder order — see
 * model/sets.ts `customDefs`). Lookups see them like stock ones, after the stock ones: formationByName/setByName,
 * setsByFormation, setByAsset, formationByAsset, formationOfSet, data.formations/data.sets. Plays, assignments and
 * enums are the stock index's (shared maps). Entries whose asset is already taken are skipped. With nothing to add the
 * stock index itself is returned.
 */
export function overlayLibraryIndex(base: LibraryIndex, extra: { formations?: readonly FormationDef[]; sets?: readonly SetDef[] }): LibraryIndex {
  const stock = base.stock ?? base;
  const formations = (extra.formations ?? []).filter((f) => f && !stock.formationByAsset.has(f.asset));
  const sets = (extra.sets ?? []).filter((s) => s && !stock.setByAsset.has(s.asset));
  if (!formations.length && !sets.length) return stock;
  const custom = new Set<Asset>([...formations.map((f) => f.asset), ...sets.map((s) => s.asset)]);
  const data: LibraryData = {
    ...stock.data,
    formations: [...stock.data.formations, ...formations],
    sets: [...stock.data.sets, ...sets],
  };
  return makeIndex(data, { playByAsset: stock.playByAsset, playsBySet: stock.playsBySet, assignmentsByRouteType: stock.assignmentsByRouteType }, stock, custom);
}
