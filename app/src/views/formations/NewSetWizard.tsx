// "New set" wizard, two steps: (1) pick the game set to start from (formation list + that formation's set cards),
// (2) name it — formation (keep the starting set's, or a new custom formation) and the sets file it's saved in, with the
// asset names under "Advanced". Creates the set and opens it in the editor.
import { useMemo, useState, type KeyboardEvent } from "react";
import type { LibraryIndex } from "../../model/library";
import { formationShort, leaf, norm } from "../../model/names";
import {
  DEPTH_CLASS_LABEL,
  customFormationAssets,
  customSetAssets,
  isValidAsset,
  libraryFormationLeaves,
  librarySetLeaves,
  newCustomFormation,
  newCustomSet,
  customFormationAsset,
  setDepthClass,
  setNamesInFormation,
  setsFilePath,
  suggestAsset,
  suggestSetName,
} from "../../model/sets";
import type { CustomFormationSpec, FormationDef, SetDef, SetsFile } from "../../model/types";
import { useSettings } from "../../state/settings";
import { useWorkspace } from "../../state/workspace";
import { Button, EmptyState, FormRow, Modal, Segmented, Select, TextInput, VirtualGrid, VirtualList, toast } from "../../ui";
import { Advanced } from "./Common";
import { SetCard, SET_CARD_ASPECT } from "./SetCard";
import { activate, fileName, openSet, setArt, type SetsDoc } from "./shared";
import s from "./Wizard.module.css";

type Step = "pick" | "details";

const NEW_FILE = "__new__";

export interface NewSetWizardProps {
  lib: LibraryIndex;
  docs: SetsDoc[];
  /** Preselected target file (the sidebar selection). */
  defaultFile?: string;
  /** Start from a known base set (skips to the details step). */
  initialBase?: SetDef;
  onClose(): void;
}

export function NewSetWizard({ lib, docs, defaultFile, initialBase, onClose }: NewSetWizardProps) {
  const [step, setStep] = useState<Step>(initialBase ? "details" : "pick");
  const [base, setBase] = useState<SetDef | undefined>(initialBase);

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow={`New set · step ${step === "pick" ? 1 : 2} of 2`}
      title={step === "pick" ? "Pick a set to start from" : "Name your set"}
      width={1040}
      footer={null}
      scopeId="formations.wizard"
      bodyClassName={s.body}
    >
      {step === "pick" && (
        <PickStep
          lib={lib}
          initial={base}
          onCancel={onClose}
          onPick={(b) => {
            setBase(b);
            setStep("details");
          }}
        />
      )}
      {step === "details" && base && <DetailsStep lib={lib} docs={docs} base={base} defaultFile={defaultFile} onBack={() => setStep("pick")} onDone={onClose} />}
    </Modal>
  );
}

/** Name/asset-leaf search: exact names first, then prefixes, then substrings (stable within each rank). */
function searchByName<T extends { name: string; asset: string }>(items: T[], query: string): T[] {
  const q = norm(query);
  if (!q) return items;
  const rank = (x: T) => {
    const n = norm(x.name);
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    if (n.includes(q)) return 2;
    return norm(leaf(x.asset)).includes(q) ? 3 : -1;
  };
  return items
    .map((x, i) => ({ x, i, r: rank(x) }))
    .filter((e) => e.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((e) => e.x);
}

// ───────────────────────────── step 1: formation + set ─────────────────────────────

const CARD_W = 220;
const CARD_H = Math.round(CARD_W / SET_CARD_ASPECT) + 48;

function PickStep({ lib, initial, onPick, onCancel }: { lib: LibraryIndex; initial?: SetDef; onPick(s: SetDef): void; onCancel(): void }) {
  const hideMinigames = useSettings((st) => st.hideMinigames);
  const formations = useMemo(
    () =>
      lib.data.formations
        .filter((f) => lib.formationSide(f) === "offense" && (!hideMinigames || !lib.isMinigame(f)) && (lib.setsByFormation.get(f.asset)?.length ?? 0) > 0)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [lib, hideMinigames],
  );
  const [formQuery, setFormQuery] = useState("");
  const formList = useMemo(() => searchByName(formations, formQuery), [formations, formQuery]);
  const [formation, setFormation] = useState<FormationDef | undefined>(() =>
    initial ? lib.formationByAsset.get(initial.formation) : (formations.find((f) => norm(f.name) === "shotgun") ?? formations[0]),
  );
  const formIndex = formation ? formList.findIndex((f) => f.asset === formation.asset) : -1;

  const allSets = formation ? (lib.setsByFormation.get(formation.asset) ?? []) : [];
  const [setQuery, setSetQuery] = useState("");
  const sets = useMemo(() => searchByName(allSets, setQuery), [allSets, setQuery]);
  const [picked, setPicked] = useState<string | undefined>(initial?.asset);
  const setIndex = sets.findIndex((x) => x.asset === picked);
  const current = setIndex >= 0 ? sets[setIndex] : undefined;
  const next = () => current && onPick(current);

  const chooseFormation = (f: FormationDef | undefined) => {
    if (!f || f.asset === formation?.asset) return;
    setFormation(f);
    setSetQuery("");
    setPicked(undefined);
  };

  const formKeys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = Math.max(0, Math.min(formList.length - 1, formIndex + (e.key === "ArrowDown" ? 1 : -1)));
    chooseFormation(formList[i]);
  };

  return (
    <div className={s.stepBody}>
      <div className={s.pick}>
        <div className={s.pickCol}>
          <div className={s.colHead}>Formation</div>
          <TextInput
            value={formQuery}
            onChange={(v) => {
              setFormQuery(v);
              // Follow the search: when the chosen formation drops out of the list, pick the best match.
              const next = searchByName(formations, v);
              if (next.length && !next.some((f) => f.asset === formation?.asset)) chooseFormation(next[0]);
            }}
            icon="search" placeholder="Search formations…" clearable autoFocus onKeyDown={formKeys} aria-label="Search formations" size="sm" />
          <VirtualList
            className={s.list}
            count={formList.length}
            rowHeight={40}
            selectedIndex={formIndex}
            onSelect={(i) => chooseFormation(formList[i])}
            getKey={(i) => formList[i].asset}
            empty={<EmptyState compact icon="search" title="No formations match" />}
            aria-label="Formations"
            renderRow={(i) => {
              const f = formList[i];
              const count = lib.setsByFormation.get(f.asset)?.length ?? 0;
              return (
                <div className={s.formRow}>
                  <span className={s.formName}>{f.name}</span>
                  <span className={s.grow} />
                  <span className={s.formMeta}>{count}</span>
                </div>
              );
            }}
          />
        </div>
        <div className={s.pickCol}>
          <div className={s.colHead}>
            {formation ? `${formation.name} sets` : "Sets"}
            {formation && (() => {
              const cls = setDepthClass(allSets[0]?.movements?.Normal ?? []);
              return cls ? <span className={s.colMeta}>{DEPTH_CLASS_LABEL[cls]}</span> : null;
            })()}
          </div>
          <TextInput value={setQuery} onChange={setSetQuery} icon="search" placeholder={`Filter ${allSets.length} sets…`} clearable size="sm" aria-label="Filter sets" />
          <VirtualGrid
            className={s.grid}
            count={sets.length}
            cellWidth={CARD_W}
            cellHeight={CARD_H}
            gap={14}
            padding={10}
            stretch
            selectedIndex={setIndex}
            onSelect={(i) => setPicked(sets[i].asset)}
            onActivate={(i) => onPick(sets[i])}
            getKey={(i) => sets[i].asset}
            empty={<EmptyState compact icon="search" title={formation ? "No sets match" : "Pick a formation"} />}
            aria-label="Sets"
            renderCell={(i, st) => {
              const set = sets[i];
              const plays = lib.playsBySet.get(set.asset)?.length ?? 0;
              return (
                <SetCard
                  fill
                  art={setArt(set)}
                  name={set.name}
                  subtitle={`${formation ? formationShort(formation.name) : ""} · ${plays} plays`}
                  selected={st.selected}
                  onClick={() => setPicked(set.asset)}
                  onDoubleClick={() => onPick(set)}
                />
              );
            }}
          />
        </div>
      </div>
      <div className={s.footer}>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <span className={s.footNote}>{current ? `Starting from ${formation ? formationShort(formation.name) : ""} ${current.name.toUpperCase()}` : "Click a set (double-click to continue)"}</span>
        <span className={s.grow} />
        <Button variant="primary" iconRight="chevronRight" onClick={next} disabled={!current}>
          Next
        </Button>
      </div>
    </div>
  );
}

// ───────────────────────────── step 2: details ─────────────────────────────

type FormationMode = "base" | "new" | string; // string = full path of a custom formation in the target file

function DetailsStep({ lib, docs, base, defaultFile, onBack, onDone }: { lib: LibraryIndex; docs: SetsDoc[]; base: SetDef; defaultFile?: string; onBack(): void; onDone(): void }) {
  const prefix = useSettings((st) => st.assetPrefix);
  const usable = docs.filter((d) => !d.error && d.data && Array.isArray(d.data.sets));
  const inputs = useMemo(() => docs.map((d) => ({ path: d.path, data: d.error ? null : d.data })), [docs]);
  const baseForm = lib.formationByAsset.get(base.formation);
  const baseFormName = baseForm?.name ?? leaf(base.formation);

  const [file, setFile] = useState(() => (defaultFile && usable.some((d) => d.path === defaultFile) ? defaultFile : (usable[0]?.path ?? NEW_FILE)));
  const [newFile, setNewFile] = useState(() => {
    const taken = new Set(docs.map((d) => d.path));
    let name = "my-sets";
    for (let i = 2; taken.has(setsFilePath(name)!); i++) name = `my-sets-${i}`;
    return name;
  });
  const targetPath = file === NEW_FILE ? setsFilePath(newFile) : file;
  const targetDoc = usable.find((d) => d.path === file);
  const fileForms: CustomFormationSpec[] = useMemo(() => (targetDoc?.data?.formations ?? []).filter((f) => f && typeof f.asset === "string"), [targetDoc]);

  const takenSetAssets = useMemo(() => new Set([...customSetAssets(inputs), ...librarySetLeaves(lib)]), [inputs, lib]);
  const takenFormAssets = useMemo(() => new Set([...customFormationAssets(inputs), ...libraryFormationLeaves(lib)]), [inputs, lib]);

  const [formMode, setFormMode] = useState<FormationMode>("base");
  const mode = formMode === "base" || formMode === "new" || fileForms.some((f) => customFormationAsset(f.asset) === formMode) ? formMode : "base";
  const [formName, setFormName] = useState(() => `${baseFormName} ${prefix.replace(/_+$/, "") || "Custom"}`.trim());
  const [formAsset, setFormAsset] = useState<string | undefined>(undefined);
  const formAssetShown = formAsset ?? suggestAsset(prefix, formName, takenFormAssets);
  const formationPath = mode === "base" ? base.formation : mode === "new" ? customFormationAsset(formAssetShown) : mode;

  const namesTaken = useMemo(() => setNamesInFormation(lib, formationPath, inputs), [lib, formationPath, inputs]);
  const [name, setName] = useState(() => suggestSetName(base.name, setNamesInFormation(lib, base.formation, inputs)));
  const [asset, setAsset] = useState<string | undefined>(undefined);
  const assetShown = asset ?? suggestAsset(prefix, name, takenSetAssets);

  const errors = {
    name: !name.trim() ? "Give the set a name" : [...namesTaken].some((n) => norm(n) === norm(name)) ? "Another set in this formation already has this name" : undefined,
    asset: !isValidAsset(assetShown) ? "Letters, digits and _ only" : [...takenSetAssets].some((a) => a.toLowerCase() === assetShown.toLowerCase()) ? "Already used by another set" : undefined,
    formName:
      mode !== "new"
        ? undefined
        : !formName.trim()
          ? "Give the formation a name"
          : lib.data.formations.some((f) => norm(f.name) === norm(formName)) || fileForms.some((f) => norm(f.name) === norm(formName))
            ? "A formation already has this name — playbooks find formations by name"
            : undefined,
    formAsset:
      mode !== "new"
        ? undefined
        : !isValidAsset(formAssetShown)
          ? "Letters, digits and _ only"
          : [...takenFormAssets].some((a) => a.toLowerCase() === formAssetShown.toLowerCase())
            ? "Already used"
            : undefined,
    file: !targetPath ? "Enter a file name" : file === NEW_FILE && docs.some((d) => d.path === targetPath) ? "That file already exists" : undefined,
  };
  const valid = !Object.values(errors).some(Boolean);
  const advancedError = errors.asset || errors.formAsset;

  const create = () => {
    if (!valid || !targetPath) return;
    const spec = newCustomSet(base, { name: name.trim(), asset: assetShown, formation: formationPath });
    if (Array.isArray(spec.positions) && !spec.positions.length) delete spec.positions;
    const form = mode === "new" ? newCustomFormation(base.formation, { name: formName.trim(), asset: formAssetShown }) : undefined;
    const ws = useWorkspace.getState();
    let index = 0;
    try {
      if (file === NEW_FILE) {
        const data: SetsFile = form ? { formations: [form], sets: [spec] } : { sets: [spec] };
        ws.create<SetsFile>(targetPath, "sets", data);
      } else {
        index = targetDoc?.data?.sets.length ?? 0;
        ws.update<SetsFile>(
          targetPath,
          (d) => {
            d.sets.push(spec);
            if (form) (d.formations ??= []).push(form);
          },
          { label: "New set" },
        );
      }
    } catch (e) {
      toast.error("Couldn't create the set", { detail: e instanceof Error ? e.message : String(e) });
      return;
    }
    activate(targetPath);
    toast.success(`Created ${spec.name}`, { detail: `In ${fileName(targetPath)} — save with ⌘/Ctrl+S.` });
    onDone();
    openSet(targetPath, index);
  };

  const enterCreates = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      create();
    }
  };

  const fileOptions = [...usable.map((d) => ({ value: d.path, label: `${fileName(d.path)} · ${d.data!.sets.length} set${d.data!.sets.length === 1 ? "" : "s"}` })), { value: NEW_FILE, label: "New file…" }];
  const formOptions = [
    { value: "base", label: `Keep it in ${baseFormName}` },
    ...fileForms.map((f) => ({ value: customFormationAsset(f.asset), label: `${f.name} (my formation)` })),
    { value: "new", label: "New formation…" },
  ];
  const plays = lib.playsBySet.get(base.asset)?.length ?? 0;

  return (
    <div className={s.stepBody}>
      <div className={s.details}>
        <div className={s.preview}>
          <SetCard art={setArt(base)} name={base.name} subtitle={`${formationShort(baseFormName)} · ${plays} plays`} />
          <p className={s.hint}>
            Your set starts as an exact copy of this one: same players, same motion presets. Next you'll move players and choose which of its plays (or plays from any
            other set) to copy in.
          </p>
        </div>
        <div className={s.form}>
          <FormRow label="Set name" error={errors.name} hint="The name you'll see in the game and use in playbooks.">
            <TextInput value={name} onChange={setName} invalid={!!errors.name} autoFocus onKeyDown={enterCreates} aria-label="Set name" />
          </FormRow>
          <FormRow label="Formation" hint={mode === "new" ? `A new formation based on ${baseFormName}; it shows up in the formation list like a game formation.` : "Which formation the set appears under in the game."}>
            <Select value={mode} onChange={setFormMode} options={formOptions} aria-label="Formation" />
          </FormRow>
          {mode === "new" && (
            <FormRow label="Formation name" error={errors.formName}>
              <TextInput value={formName} onChange={setFormName} invalid={!!errors.formName} onKeyDown={enterCreates} aria-label="Formation name" />
            </FormRow>
          )}
          <FormRow label="Save in" error={errors.file} hint={file === NEW_FILE ? `Creates ${targetPath ?? "playbooks/sets/<name>.json"} (unsaved until ⌘/Ctrl+S).` : undefined}>
            <div className={s.fileRow}>
              <Segmented<"existing" | "new">
                size="sm"
                value={file === NEW_FILE ? "new" : "existing"}
                onChange={(v) => setFile(v === "new" ? NEW_FILE : (usable[0]?.path ?? NEW_FILE))}
                options={[
                  { value: "existing", label: "Existing file", disabled: !usable.length },
                  { value: "new", label: "New file" },
                ]}
                aria-label="File"
              />
              {file === NEW_FILE ? (
                <TextInput value={newFile} onChange={setNewFile} mono suffix=".json" invalid={!!errors.file} onKeyDown={enterCreates} aria-label="New file name" />
              ) : (
                <Select value={file} onChange={setFile} options={fileOptions.filter((o) => o.value !== NEW_FILE)} aria-label="Sets file" />
              )}
            </div>
          </FormRow>
          <Advanced id="wizard" hint={advancedError ? "fix the asset name" : "asset names (generated)"}>
            <FormRow label="Set asset" error={errors.asset} hint={asset === undefined ? `Generated from the prefix "${prefix}" and the name.` : "Asset leaf name, [A-Za-z0-9_]."}>
              <TextInput value={assetShown} onChange={(v) => setAsset(v)} mono invalid={!!errors.asset} onKeyDown={enterCreates} aria-label="Set asset" />
            </FormRow>
            {mode === "new" && (
              <FormRow label="Formation asset" error={errors.formAsset}>
                <TextInput value={formAssetShown} onChange={(v) => setFormAsset(v)} mono invalid={!!errors.formAsset} onKeyDown={enterCreates} aria-label="Formation asset" />
              </FormRow>
            )}
            <div className={s.hint}>
              Starting set: <span className={s.mono}>{leaf(base.asset)}</span>
            </div>
          </Advanced>
        </div>
      </div>
      <div className={s.footer}>
        <Button variant="ghost" icon="chevronLeft" onClick={onBack}>
          Back
        </Button>
        <span className={s.grow} />
        <Button variant="primary" onClick={create} disabled={!valid} title={valid ? "Create the set and open it" : Object.values(errors).find(Boolean)}>
          Create set
        </Button>
      </div>
    </div>
  );
}
