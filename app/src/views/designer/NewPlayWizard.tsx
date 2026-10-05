// New-play wizard: FORMATION → SET → BASE PLAY (the set's plays, grouped: PASS by concept, RUN TEMPLATES by blocking
// scheme, PLAY ACTION, SCREENS, OTHER; filterable by the user's concept categories from app-data/concepts.json) →
// NAME + target plays file. Custom formations / sets (playbooks/sets/*.json, via the catalog overlay) are listed
// too, with a CUSTOM badge; in a custom set the base plays are its clones. Mouse first; each list step focuses its
// filter (exact name matches first; ↑/↓ + Enter pick a row), arrows / Enter work in a focused list, Enter creates on
// the last step, Esc closes.
// `#/designer/new?set=…&base=…[&slot=n&assignment=path][&file=…]` pre-fills it.
import { useEffect, useMemo, useRef, useState } from "react";
import { Field, PlayArtLayer, PlayCard } from "../../field";
import { computeArt } from "../../model/art";
import { BASE_SECTION_LABEL, assetProblem, assignmentPath, basePlayOf, groupBasePlays, newPlaySpec, playNameProblem, setHasBasePlays, suggestAsset, suggestPlayName, type BaseGroup } from "../../model/designer";
import { CONCEPTS_PATH, categoriesForPlay, categoryWithDescendants } from "../../model/conceptsDoc";
import { HALF_WIDTH } from "../../model/geometry";
import { folder, leaf } from "../../model/names";
import type { Asset, ConceptCategory, ConceptsDoc, FormationDef, PlaysFile, ResolvedPlay } from "../../model/types";
import { useCatalog, useLibrary } from "../../state/library";
import { href, navigate } from "../../state/router";
import { useSettings } from "../../state/settings";
import { useDoc, useDocsOfKind, useWorkspace } from "../../state/workspace";
import { Button, Chip, FormRow, Modal, Select, Tag, TextInput, VirtualList, cx, toast } from "../../ui";
import { titleCase } from "./titleCase";
import s from "./Wizard.module.css";

export interface WizardPrefill {
  set?: Asset;
  base?: Asset;
  slot?: number;
  assignment?: string;
  file?: string;
}

type Step = "formation" | "set" | "base" | "name";
const STEPS: { id: Step; label: string }[] = [
  { id: "formation", label: "Formation" },
  { id: "set", label: "Set" },
  { id: "base", label: "Base Play" },
  { id: "name", label: "Name" },
];

const NEW_FILE = "__new__";

export function NewPlayWizard({ prefill, onClose }: { prefill?: WizardPrefill; onClose(): void }) {
  const catalog = useCatalog()!;
  const lib = catalog.lib;
  // catalog.lib is an overlay that also holds the custom formations / sets (playbooks/sets/*.json).
  const rawLib = useLibrary((st) => st.lib);
  const isCustomSet = (asset: Asset) => (typeof lib.isCustom === "function" ? lib.isCustom(asset) : !!rawLib && rawLib !== lib && !rawLib.setByAsset.has(asset));
  const isCustomFormation = (asset: Asset) =>
    typeof lib.isCustomFormation === "function" ? lib.isCustomFormation(asset) : !!rawLib && rawLib !== lib && !rawLib.formationByAsset.has(asset);
  const hideMinigames = useSettings((st) => st.hideMinigames);
  const prefix = useSettings((st) => st.assetPrefix);
  const lastFile = useSettings((st) => st.lastPlaysFile);
  const docs = useDocsOfKind<PlaysFile>("plays");

  const preSet = prefill?.set ? lib.setByAsset.get(prefill.set) : undefined;
  const preBase = prefill?.base ? basePlayOf(catalog, prefill.base).def : undefined;
  const [formation, setFormation] = useState<Asset | undefined>(preSet?.formation);
  const [setAsset, setSetAsset] = useState<Asset | undefined>(preSet?.asset ?? preBase?.set);
  const [base, setBase] = useState<Asset | undefined>(preBase && (!preSet || preBase.set === preSet.asset) ? preBase.asset : undefined);
  const [step, setStep] = useState<Step>(base ? "name" : setAsset ? "base" : "formation");
  const [query, setQuery] = useState("");
  const wantFile = prefill?.file ?? lastFile;
  const prefillNewFile = !!prefill?.file && !docs.some((d) => d.path === prefill.file) && /^playbooks\/plays\/[a-z0-9][a-z0-9-]*\.json$/.test(prefill.file);
  const [file, setFile] = useState<string>(() =>
    prefillNewFile ? NEW_FILE : wantFile && docs.some((d) => d.path === wantFile && !d.error) ? wantFile : (docs.find((d) => !d.error)?.path ?? NEW_FILE),
  );
  const [newFilePath, setNewFilePath] = useState<string>(prefillNewFile ? prefill!.file! : "playbooks/plays/my-plays.json");
  const defaults = (setA: Asset | undefined, b: Asset | undefined) => {
    if (!b || !setA) return { name: "", asset: "" };
    const n = suggestPlayName(catalog, setA, basePlayOf(catalog, b).def?.name ?? "Play", prefix);
    return { name: n, asset: suggestAsset(catalog, setA, n, prefix) };
  };
  const [name, setName] = useState(() => defaults(setAsset, base).name);
  const [asset, setAssetName] = useState(() => defaults(setAsset, base).asset);
  const [assetTouched, setAssetTouched] = useState(false);

  const formations = useMemo(() => {
    const list = lib.data.formations.filter((f) => lib.formationSide(f) === "offense" && !(hideMinigames && lib.isMinigame(f)) && (lib.setsByFormation.get(f.asset)?.length ?? 0) > 0);
    return list.sort((a, b) => a.name.localeCompare(b.name) || a.asset.localeCompare(b.asset));
  }, [lib, hideMinigames]);
  const filteredFormations = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? byNameMatch(formations.filter((f) => f.name.toLowerCase().includes(q) || leaf(f.asset).toLowerCase().includes(q)), q) : formations;
  }, [formations, query]);
  const sets = useMemo(() => {
    const list = formation ? (lib.setsByFormation.get(formation) ?? []) : [];
    const q = query.trim().toLowerCase();
    return (q ? byNameMatch(list.filter((x) => x.name.toLowerCase().includes(q)), q) : list).filter((x) => setHasBasePlays(catalog, x.asset));
  }, [lib, catalog, formation, query]);
  const allGroups = useMemo(() => (setAsset ? groupBasePlays(catalog, setAsset) : []), [catalog, setAsset]);
  // Concept categories (the user's tags) present among the set's base plays → filter chips.
  const concepts = useDoc<ConceptsDoc>(CONCEPTS_PATH);
  const conceptsDoc = concepts && !concepts.error ? concepts.data : undefined;
  const [category, setCategory] = useState<string | undefined>();
  const categories = useMemo(() => {
    if (!conceptsDoc) return [] as { cat: ConceptCategory; count: number }[];
    const plays = allGroups.flatMap((g) => g.plays);
    const tagged = plays.map((p) => new Set(conceptsDoc.tags?.[p.key] ?? []));
    return (conceptsDoc.categories ?? [])
      .map((cat) => {
        const ids = categoryWithDescendants(conceptsDoc, cat.id);
        return { cat, count: tagged.filter((t) => [...t].some((id) => ids.has(id))).length };
      })
      .filter((c) => c.count > 0);
  }, [conceptsDoc, allGroups]);
  const activeCategory = category && categories.some((c) => c.cat.id === category) ? category : undefined;
  const groups = useMemo(() => {
    if (!activeCategory || !conceptsDoc) return allGroups;
    const ids = categoryWithDescendants(conceptsDoc, activeCategory);
    return allGroups
      .map((g) => ({ ...g, plays: g.plays.filter((p) => (conceptsDoc.tags?.[p.key] ?? []).some((id) => ids.has(id))) }))
      .filter((g) => g.plays.length > 0);
  }, [allGroups, activeCategory, conceptsDoc]);
  const flat = useMemo(() => groups.flatMap((g) => g.plays), [groups]);

  const [cursor, setCursor] = useState(0);
  useEffect(() => {
    // Land on the current choice when a list step opens.
    if (step === "formation" && formation) setCursor(Math.max(0, filteredFormations.findIndex((f) => f.asset === formation)));
    if (step === "set" && setAsset) setCursor(Math.max(0, sets.findIndex((x) => x.asset === setAsset)));
    if (step === "base" && base) setCursor(Math.max(0, flat.findIndex((p) => p.asset === base)));
  }, [step]);

  const chooseFormation = (f: FormationDef | undefined) => {
    if (!f) return;
    if (f.asset !== formation) {
      setSetAsset(undefined);
      setBase(undefined);
    }
    setFormation(f.asset);
    setQuery("");
    setCursor(0);
    setStep("set");
  };
  const chooseSet = (asset: Asset | undefined) => {
    if (!asset) return;
    if (asset !== setAsset) {
      setBase(undefined);
      setCategory(undefined);
    }
    setSetAsset(asset);
    setQuery("");
    setCursor(0);
    setStep("base");
  };
  const chooseBase = (p: ResolvedPlay | undefined) => {
    if (!p) return;
    if (p.asset !== base) {
      const d = defaults(setAsset, p.asset);
      setName(d.name);
      setAssetName(d.asset);
      setAssetTouched(false);
    }
    setBase(p.asset);
    setStep("name");
  };

  const goStep = (next: Step) => {
    setQuery("");
    setCursor(0);
    setStep(next);
  };
  const back = () => {
    const i = STEPS.findIndex((x) => x.id === step);
    if (i <= 0) onClose();
    else goStep(STEPS[i - 1].id);
  };

  const targetPath = file === NEW_FILE ? newFilePath : file;
  const nameErr = setAsset ? playNameProblem(catalog, setAsset, name) : undefined;
  const assetErr = setAsset ? assetProblem(catalog, setAsset, asset) : undefined;
  const fileErr = file === NEW_FILE && (!/^playbooks\/plays\/[a-z0-9][a-z0-9-]*\.json$/.test(newFilePath) ? "Use playbooks/plays/<name>.json" : useWorkspace.getState().docs[newFilePath] ? "That file exists — pick it from the list" : undefined);
  const canCreate = !!base && !!setAsset && !nameErr && !assetErr && !fileErr;

  const create = () => {
    if (!canCreate || !base) return;
    const spec = newPlaySpec({ name: name.trim(), asset, base, slot: prefill?.slot, assignment: prefill?.assignment });
    const ws = useWorkspace.getState();
    let index = 0;
    try {
      if (!ws.docs[targetPath]) ws.create<PlaysFile>(targetPath, "plays", { plays: [spec] });
      else {
        index = (ws.docs[targetPath].data as PlaysFile).plays.length;
        ws.update<PlaysFile>(targetPath, (d) => void d.plays.push(spec), { label: "New play" });
      }
    } catch (e) {
      toast.error("Couldn't Create the Play", { detail: e instanceof Error ? e.message : String(e) });
      return;
    }
    useSettings.getState().set({ lastPlaysFile: targetPath });
    toast.success(`Created ${spec.name}`, { detail: `${targetPath} — save to keep it.` });
    navigate(href("designer", targetPath, index));
  };


  const set = setAsset ? lib.setByAsset.get(setAsset) : undefined;
  const formationDef = formation ? lib.formationByAsset.get(formation) : undefined;
  const basePlay = base ? catalog.get(base) : undefined;
  const stepIndex = STEPS.findIndex((x) => x.id === step);

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="New Play"
      title={
        <span className={s.crumbs}>
          {STEPS.map((x, i) => (
            <button
              key={x.id}
              type="button"
              className={cx(s.crumb, x.id === step && s.crumbOn)}
              disabled={i > stepIndex && !(i === 1 && formation) && !(i === 2 && setAsset) && !(i === 3 && base)}
              onClick={() => goStep(x.id)}
            >
              <span className={s.crumbNo}>{i + 1}</span>
              {x.label}
              {i === 0 && formationDef && <span className={s.crumbVal}>{formationDef.name}</span>}
              {i === 1 && set && <span className={s.crumbVal}>{set.name}</span>}
              {i === 2 && basePlay && <span className={s.crumbVal}>{basePlay.name}</span>}
            </button>
          ))}
        </span>
      }
      width={1120}
      onConfirm={step === "name" ? create : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={back}>
            {step === "formation" ? "Cancel" : "Back"}
          </Button>
          {step === "name" && (
            <Button variant="primary" disabled={!canCreate} onClick={create}>
              Create Play
            </Button>
          )}
        </>
      }
      scopeId="designer.wizard"
      bodyClassName={s.body}
    >
      {step === "formation" && (
        <ListStep
          query={query}
          setQuery={setQuery}
          placeholder="Filter formations…"
          count={filteredFormations.length}
          cursor={cursor}
          setCursor={setCursor}
          onActivate={(i) => chooseFormation(filteredFormations[i])}
          renderRow={(i, on) => {
            const f = filteredFormations[i];
            const nSets = lib.setsByFormation.get(f.asset)?.length ?? 0;
            return (
              <div className={cx(s.row, on && s.rowOn, f.asset === formation && s.rowPicked)}>
                <span className={s.rowName}>{f.name}</span>
                {isCustomFormation(f.asset) && (
                  <Tag tone="custom" size="sm">
                    Custom
                  </Tag>
                )}
                <span className={s.rowMeta}>
                  {nSets} set{nSets === 1 ? "" : "s"} · {leaf(folder(f.asset).slice(0, -1))}
                </span>
              </div>
            );
          }}
        />
      )}
      {step === "set" && (
        <div className={s.split}>
          <ListStep
            query={query}
            setQuery={setQuery}
            placeholder="Filter sets…"
            count={sets.length}
            cursor={cursor}
            setCursor={setCursor}
            onActivate={(i) => chooseSet(sets[i]?.asset)}
            renderRow={(i, on) => {
              const x = sets[i];
              const custom = isCustomSet(x.asset);
              const n = custom ? catalog.playsInSet(x.asset).length : (lib.playsBySet.get(x.asset) ?? []).length;
              return (
                <div className={cx(s.row, on && s.rowOn, x.asset === setAsset && s.rowPicked)}>
                  <span className={s.rowName}>{x.name}</span>
                  {custom && (
                    <Tag tone="custom" size="sm" title="Your custom set (Formations)">
                      Custom Set
                    </Tag>
                  )}
                  <span className={s.rowMeta}>{n} plays</span>
                </div>
              );
            }}
          />
          <SetPreview asset={sets[cursor]?.asset} />
        </div>
      )}
      {step === "base" && setAsset && isCustomSet(setAsset) && (
        <p className={s.note}>This is your custom set: its plays are the ones you cloned into it in Formations. Pick one to start from.</p>
      )}
      {step === "base" && categories.length > 0 && (
        <div className={s.catChips} role="toolbar" aria-label="Concept categories">
          <Chip active={!activeCategory} count={allGroups.reduce((n, g) => n + g.plays.length, 0)} onClick={() => (setCategory(undefined), setCursor(0))}>
            All
          </Chip>
          {categories.map(({ cat, count }) => (
            <Chip key={cat.id} active={activeCategory === cat.id} color={cat.color} count={count} onClick={() => (setCategory(cat.id), setCursor(0))}>
              {cat.name}
            </Chip>
          ))}
        </div>
      )}
      {step === "base" && (
        <BaseStep groups={groups} flat={flat} cursor={cursor} setCursor={setCursor} picked={base} onChoose={chooseBase} concepts={conceptsDoc} />
      )}
      {step === "name" && setAsset && (
        <div className={s.nameStep}>
          <div className={s.nameForm}>
            <FormRow label="Play Name" error={nameErr} hint="Unique within the set (library and custom plays).">
              <TextInput
                autoFocus
                value={name}
                invalid={!!nameErr}
                onChange={(v) => {
                  setName(v);
                  if (!assetTouched) setAssetName(suggestAsset(catalog, setAsset, v, prefix));
                }}
              />
            </FormRow>
            <FormRow
              label="Asset Name"
              error={assetErr}
              hint={`The play's name in the game files (in ${leaf(folder(setAsset).slice(0, -1))}/), made from the play name with letters, digits and underscores only. You can leave it as it is.`}
            >
              <TextInput
                mono
                value={asset}
                invalid={!!assetErr}
                onChange={(v) => {
                  setAssetTouched(true);
                  setAssetName(v.replace(/[^A-Za-z0-9_]/g, ""));
                }}
              />
            </FormRow>
            <FormRow label="Plays File" error={fileErr || undefined}>
              <Select
                value={file}
                options={[...docs.filter((d) => !d.error).map((d) => ({ value: d.path, label: d.path })), { value: NEW_FILE, label: "New Plays File…" }]}
                onChange={setFile}
                className={file === NEW_FILE ? undefined : s.monoSelect}
              />
            </FormRow>
            {file === NEW_FILE && (
              <FormRow label="New File Path">
                <TextInput mono value={newFilePath} onChange={setNewFilePath} />
              </FormRow>
            )}
            {prefill?.slot !== undefined && prefill.assignment && (
              <p className={s.note}>
                Slot {prefill.slot} starts on <span className={s.mono}>{assignmentPath(prefill.assignment)}</span>.
              </p>
            )}
          </div>
          {basePlay && (
            <div className={s.nameCard}>
              <PlayCard play={basePlay} size="md" />
              <p className={s.note}>The base supplies the alignment, handoff / play-action mechanics, flags and reads. You can swap it later within the set.</p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Filter hits ranked: exact name first, then names starting with the query, then the rest (stable). */
function byNameMatch<T extends { name: string }>(list: T[], q: string): T[] {
  const rank = (x: T) => {
    const n = x.name.toLowerCase();
    return n === q ? 0 : n.startsWith(q) ? 1 : 2;
  };
  return list.map((x, i) => ({ x, i, r: rank(x) })).sort((a, b) => a.r - b.r || a.i - b.i).map((e) => e.x);
}

function ListStep(props: {
  query: string;
  setQuery(v: string): void;
  placeholder: string;
  count: number;
  cursor: number;
  setCursor(i: number): void;
  onActivate(i: number): void;
  renderRow(i: number, on: boolean): React.ReactNode;
}) {
  return (
    <div className={s.listStep}>
      <TextInput
        size="sm"
        icon="search"
        value={props.query}
        onChange={(v) => (props.setQuery(v), props.setCursor(0))}
        placeholder={props.placeholder}
        clearable
        onClear={() => props.setQuery("")}
        // Each list step opens ready to type; Enter takes the highlighted row, ↑/↓ move the highlight.
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter" && props.count > 0) {
            e.preventDefault();
            props.onActivate(Math.min(props.cursor, props.count - 1));
          } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && props.count > 0) {
            e.preventDefault();
            props.setCursor(Math.max(0, Math.min(props.count - 1, props.cursor + (e.key === "ArrowDown" ? 1 : -1))));
          }
        }}
      />
      {props.count === 0 ? (
        <div className={s.note}>Nothing matches.</div>
      ) : (
      <VirtualList
        count={props.count}
        rowHeight={44}
        selectedIndex={props.cursor}
        onSelect={props.setCursor}
        onActivate={props.onActivate}
        className={s.list}
        renderRow={(i, { selected }) => (
          <div
            className={s.rowWrap}
            onClick={(e) => {
              // The list's own click would select row i after the step changed (stale cursor on the next step).
              e.stopPropagation();
              props.onActivate(i);
            }}
          >
            {props.renderRow(i, selected)}
          </div>
        )}
      />
      )}
    </div>
  );
}

function SetPreview({ asset }: { asset?: Asset }) {
  const catalog = useCatalog()!;
  const set = asset ? catalog.lib.setByAsset.get(asset) : undefined;
  const art = useMemo(() => (set ? computeArt(set, [], { side: "offense" }) : undefined), [set]);
  if (!set || !art) return <div className={s.preview} />;
  return (
    <div className={s.preview}>
      <Field viewport={{ minX: -HALF_WIDTH, maxX: HALF_WIDTH, minY: -10, maxY: 6 }} fit="contain" markings="minimal" className={s.previewField}>
        <PlayArtLayer art={art} showLabels compact />
      </Field>
      <div className={s.previewName}>{set.name}</div>
    </div>
  );
}

function BaseStep({
  groups,
  flat,
  cursor,
  setCursor,
  picked,
  onChoose,
  concepts,
}: {
  groups: BaseGroup[];
  flat: ResolvedPlay[];
  cursor: number;
  setCursor(i: number): void;
  picked?: Asset;
  onChoose(p: ResolvedPlay): void;
  concepts?: ConceptsDoc | null;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current?.querySelector<HTMLElement>(`[data-i="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);
  if (!flat.length) return <div className={s.note}>This set has no plays to start from.</div>;
  let i = 0;
  let lastSection = "";
  return (
    <div className={s.baseStep} ref={root}>
      {groups.map((g) => {
        const header = g.section !== lastSection ? BASE_SECTION_LABEL[g.section] : undefined;
        lastSection = g.section;
        const showLabel = g.section === "pass" || g.section === "run";
        return (
          <div key={`${g.section}|${g.label}`} className={s.group}>
            {header && <div className={s.sectionHead}>{header}</div>}
            {showLabel && (
              <div className={s.groupHead}>
                {titleCase(g.label)} <span className={s.groupCount}>{g.plays.length}</span>
              </div>
            )}
            <div className={s.cards}>
              {g.plays.map((p) => {
                const idx = i++;
                return (
                  <div key={p.asset} data-i={idx} className={s.cardWrap} onMouseEnter={() => setCursor(idx)}>
                    <LazyCard play={p} selected={idx === cursor || p.asset === picked} onClick={() => onChoose(p)} />
                    <CategoryDots cats={categoriesForPlay(concepts, p.key)} />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className={s.baseHint}>Click a play to start from it · run plays are grouped by blocking scheme (inside zone, power, counter…)</div>
    </div>
  );
}

/** The play's concept categories as small color dots (title = names). */
function CategoryDots({ cats }: { cats: ConceptCategory[] }) {
  if (!cats.length) return null;
  return (
    <span className={s.catDots} title={cats.map((c) => c.name).join(", ")}>
      {cats.map((c) => (
        <span key={c.id} className={s.catDot} style={{ background: c.color }} />
      ))}
    </span>
  );
}

/** Renders the PlayCard (and its art) only once it nears the viewport. */
function LazyCard({ play, selected, onClick }: { play: ResolvedPlay; selected: boolean; onClick(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: "240px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return <div ref={ref}>{seen ? <PlayCard play={play} size="sm" selected={selected} onClick={onClick} /> : <div className={s.cardPh} />}</div>;
}

