// #/formations — sets files (playbooks/sets/*.json) in a sidebar, their custom sets as alignment cards, the
// "New set" wizard and "New sets file". Click a card to open it; ⋯ / right-click for Duplicate and Delete.
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import type { LibraryIndex } from "../../model/library";
import { changedSlots, customSetAssets, librarySetLeaves, setNamesInFormation, setsFilePath, suggestAsset, suggestSetName } from "../../model/sets";
import { emptyArt } from "../../model/art";
import type { CustomSetSpec, SetDef, SetsFile, ValidationIssue } from "../../model/types";
import { useLibrary } from "../../state/library";
import { useSettings } from "../../state/settings";
import { useWorkspace } from "../../state/workspace";
import { Button, EmptyState, Icon, IconButton, Spinner, Tag, VirtualGrid, confirmDialog, cx, promptDialog, toast, useContextMenu, type MenuItem } from "../../ui";
import { NewSetWizard } from "./NewSetWizard";
import { SetCard, SET_CARD_ASPECT } from "./SetCard";
import { activate, countIssues, customSetArt, customSubtitle, fileName, openSet, setDisplayIssues, useLib, useSetsDocs, useSetsInputs, useSetsIssues, type SetsDoc } from "./shared";
import s from "./Entry.module.css";

const ALL = "__all__";
const CARD_W = 300;
const CARD_H = Math.round(CARD_W / SET_CARD_ASPECT) + 58; // art + the medium-size name / subtitle lines

interface Item {
  key: string;
  file: string;
  index: number;
  spec: CustomSetSpec;
  base?: SetDef;
  formations: SetsFile["formations"];
  issues: ValidationIssue[];
}

export function EntryScreen() {
  const lib = useLib();
  const ready = useWorkspace((st) => st.ready);
  const libStatus = useLibrary((st) => st.status);

  if (!lib) {
    return (
      <div className={s.center}>
        {libStatus === "loading" ? (
          <Spinner label="Loading the play library…" />
        ) : (
          <EmptyState
            icon="field"
            title="The set editor needs the play library"
            body="Custom sets start from a game set (data/library/sets.json)."
            action={
              <Button variant="primary" onClick={() => void useLibrary.getState().load()}>
                Load library
              </Button>
            }
          />
        )}
      </div>
    );
  }
  if (!ready) {
    return (
      <div className={s.center}>
        <Spinner label="Loading files…" />
      </div>
    );
  }
  return <Entry lib={lib} />;
}

function Entry({ lib }: { lib: LibraryIndex }) {
  const docs = useSetsDocs();
  const issues = useSetsIssues(lib, docs);
  const inputs = useSetsInputs(docs);
  const prefix = useSettings((st) => st.assetPrefix);
  const [filter, setFilter] = useState<string>(ALL);
  const [selectedKey, setSelectedKey] = useState<string>();
  const [wizard, setWizard] = useState(false);
  const cm = useContextMenu();

  const shownFilter = filter === ALL || docs.some((d) => d.path === filter) ? filter : ALL;

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const d of docs) {
      if (shownFilter !== ALL && d.path !== shownFilter) continue;
      if (d.error || !d.data || !Array.isArray(d.data.sets)) continue;
      const fileIssues = issues.filter((i) => i.file === d.path);
      d.data.sets.forEach((spec, index) => {
        if (!spec || typeof spec !== "object") return;
        out.push({
          key: `${d.path}#${index}`,
          file: d.path,
          index,
          spec,
          base: lib.setByAsset.get(spec.base),
          formations: d.data!.formations,
          issues: setDisplayIssues(lib, fileIssues, index, spec, lib.setByAsset.get(spec.base)),
        });
      });
    }
    return out;
  }, [docs, issues, lib, shownFilter]);

  // Per-file counts for the sidebar: the sets' display issues + the file's own (custom formations…).
  const fileDisplayIssues = useMemo(() => {
    const m = new Map<string, ValidationIssue[]>();
    for (const d of docs) {
      if (d.error || !d.data || !Array.isArray(d.data.sets)) continue;
      const fileIssues = issues.filter((i) => i.file === d.path);
      const own = fileIssues.filter((i) => !i.where?.startsWith("/sets/"));
      const sets = d.data.sets.flatMap((spec, index) => (spec && typeof spec === "object" ? setDisplayIssues(lib, fileIssues, index, spec, lib.setByAsset.get(spec.base)) : []));
      m.set(d.path, [...own, ...sets]);
    }
    return m;
  }, [docs, issues, lib]);

  const selIndex = items.findIndex((it) => it.key === selectedKey);
  const selected = selIndex >= 0 ? items[selIndex] : undefined;
  const targetFile = shownFilter !== ALL ? shownFilter : (selected?.file ?? (docs.length === 1 ? docs[0].path : undefined));

  useEffect(() => {
    activate(targetFile);
  }, [targetFile]);

  const newFile = async () => {
    const taken = new Set(docs.map((d) => d.path));
    const name = await promptDialog({
      title: "New sets file",
      body: (
        <>
          Custom sets are saved in <code className={s.pathCode}>playbooks/sets/&lt;name&gt;.json</code>.
        </>
      ),
      label: "File name",
      initial: "custom-sets",
      mono: true,
      confirmLabel: "Create",
      validate: (v) => {
        const p = setsFilePath(v);
        if (!p) return "Enter a name";
        if (taken.has(p)) return `${p} already exists`;
        return undefined;
      },
    });
    const path = name ? setsFilePath(name) : undefined;
    if (!path) return;
    try {
      useWorkspace.getState().create<SetsFile>(path, "sets", { sets: [] });
      setFilter(path);
      activate(path);
      toast.success(`Created ${fileName(path)}`, { detail: "Unsaved until you save it (⌘/Ctrl+S)." });
    } catch (e) {
      toast.error("Couldn't create the file", { detail: e instanceof Error ? e.message : String(e) });
    }
  };

  const duplicate = (it: Item) => {
    if (!it.base) return;
    const name = suggestSetName(it.spec.name || it.base.name, setNamesInFormation(lib, it.spec.formation, inputs));
    const asset = suggestAsset(prefix, name, new Set([...customSetAssets(inputs), ...librarySetLeaves(lib)]));
    // Clones keep their names (they live in another set folder) — only the set itself needs a new name/asset.
    const copy = { ...structuredClone(it.spec), name, asset };
    useWorkspace.getState().update<SetsFile>(it.file, (d) => void d.sets.splice(it.index + 1, 0, copy), { label: "Duplicate set" });
    setSelectedKey(`${it.file}#${it.index + 1}`);
    activate(it.file);
    toast.success(`Duplicated as ${name}`, { detail: "Undo with ⌘/Ctrl+Z." });
  };

  const remove = async (it: Item) => {
    const ok = await confirmDialog({
      title: `Delete ${it.spec.name || "this set"}?`,
      body: `Removes the set${Array.isArray(it.spec.plays) && it.spec.plays.length ? ` and its ${it.spec.plays.length} copied plays` : ""} from ${fileName(it.file)}. Undo with ⌘/Ctrl+Z until you save.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    useWorkspace.getState().update<SetsFile>(it.file, (d) => void d.sets.splice(it.index, 1), { label: "Delete set" });
    activate(it.file);
  };

  const removeFile = async (doc: SetsDoc) => {
    const count = doc.data?.sets?.length ?? 0;
    const ok = await confirmDialog({
      title: `Delete ${fileName(doc.path)}?`,
      body: doc.isNew
        ? "The file was never saved; it is just dropped."
        : `Moves the file${count ? ` and its ${count} set${count === 1 ? "" : "s"}` : ""} to app-data/.trash.`,
      confirmLabel: "Delete file",
      danger: true,
    });
    if (!ok) return;
    try {
      await useWorkspace.getState().remove(doc.path);
      if (filter === doc.path) setFilter(ALL);
      toast.success(`Deleted ${fileName(doc.path)}`);
    } catch (e) {
      toast.error("Delete failed", { detail: e instanceof Error ? e.message : String(e) });
    }
  };

  const menuFor = (it: Item): MenuItem[] => [
    { id: "open", label: "Open", icon: "external", onSelect: () => openSet(it.file, it.index) },
    { id: "dup", label: "Duplicate", icon: "duplicate", disabled: !it.base, onSelect: () => duplicate(it) },
    { kind: "separator" },
    { id: "del", label: "Delete set", icon: "trash", danger: true, onSelect: () => void remove(it) },
  ];

  const totalSets = docs.reduce((n, d) => n + (d.error ? 0 : (d.data?.sets?.length ?? 0)), 0);

  return (
    <div className={s.page}>
      <header className={s.header}>
        <div>
          <div className={s.eyebrow}>Custom formations · playbooks/sets</div>
          <h1 className={s.title}>Formations & sets</h1>
        </div>
        <span className={s.grow} />
        <Button variant="secondary" icon="file" onClick={() => void newFile()}>
          New sets file
        </Button>
        <Button variant="primary" icon="plus" onClick={() => setWizard(true)}>
          New set
        </Button>
      </header>
      <p className={s.intro}>
        <Icon name="info" size={14} />
        Start from any game set, move players, and choose which plays to copy into it. Custom sets are built into the mod with your custom plays, and you add
        them to a playbook like any other set.
      </p>

      <div className={s.body}>
        <aside className={s.sidebar}>
          <div className={s.sideHead}>Files</div>
          <FileRow label="All sets" count={totalSets} active={shownFilter === ALL} onClick={() => setFilter(ALL)} />
          {docs.map((d) => {
            const c = countIssues(fileDisplayIssues.get(d.path) ?? []);
            return (
              <FileRow
                key={d.path}
                label={fileName(d.path)}
                count={d.error ? undefined : (d.data?.sets?.length ?? 0)}
                active={shownFilter === d.path}
                dirty={d.dirty}
                error={d.error}
                errors={c.errors}
                warnings={c.warnings}
                onClick={() => setFilter(d.path)}
                onDelete={() => void removeFile(d)}
              />
            );
          })}
          {docs.length === 0 && <div className={s.sideEmpty}>No files in playbooks/sets/ yet — “New set” creates one for you.</div>}
        </aside>

        <main className={s.main}>
          {(() => {
            const doc = shownFilter !== ALL ? docs.find((d) => d.path === shownFilter) : undefined;
            if (doc?.error) {
              return <EmptyState icon="warning" title={`Can't open ${fileName(doc.path)}`} body={doc.error} />;
            }
            if (!items.length) {
              return (
                <EmptyState
                  icon="field"
                  title={docs.length ? "No custom sets in this file yet" : "No custom sets yet"}
                  body={
                    <ol className={s.steps}>
                      <li>Pick a game set to start from (for example Gun Y Trips Wk).</li>
                      <li>Drag players to their new spots — the checks below the field keep it legal.</li>
                      <li>Choose the plays to copy into the new set.</li>
                    </ol>
                  }
                  action={
                    <Button variant="primary" icon="plus" onClick={() => setWizard(true)}>
                      New set
                    </Button>
                  }
                />
              );
            }
            return (
              <VirtualGrid
                className={s.grid}
                count={items.length}
                cellWidth={CARD_W}
                cellHeight={CARD_H}
                gap={18}
                padding={20}
                stretch
                padEnd={24}
                selectedIndex={selIndex}
                onSelect={(i) => setSelectedKey(items[i].key)}
                onActivate={(i) => openSet(items[i].file, items[i].index)}
                getKey={(i) => items[i].key}
                aria-label="Custom sets"
                renderCell={(i, st) => (
                  <SetItemCard
                    item={items[i]}
                    lib={lib}
                    selected={st.selected}
                    showFile={shownFilter === ALL && docs.length > 1}
                    onOpen={() => openSet(items[i].file, items[i].index)}
                    onMenu={(e) => {
                      setSelectedKey(items[i].key);
                      cm.open(e, menuFor(items[i]));
                    }}
                  />
                )}
              />
            );
          })()}
        </main>
      </div>
      {cm.node}
      {wizard && <NewSetWizard lib={lib} docs={docs} defaultFile={targetFile} onClose={() => setWizard(false)} />}
    </div>
  );
}

function SetItemCard({ item, lib, selected, showFile, onOpen, onMenu }: { item: Item; lib: LibraryIndex; selected: boolean; showFile: boolean; onOpen(): void; onMenu(e: MouseEvent): void }) {
  const { spec, base, issues } = item;
  const art = useMemo(() => (base ? customSetArt(base, spec) : emptyArt()), [base, spec]);
  const c = countIssues(issues);
  const plays = Array.isArray(spec.plays) ? spec.plays.length : 0;
  const moved = useMemo(() => (base ? changedSlots(base, spec).length : 0), [base, spec]);
  return (
    <div data-set-key={item.key} className={s.cardWrap}>
      <SetCard
        fill
        art={art}
        name={spec.name || "(unnamed)"}
        subtitle={(base ? customSubtitle(lib, spec, item.formations) : "STARTING SET MISSING") + (showFile ? ` · ${fileName(item.file)}` : "")}
        selected={selected}
        tag={<>Custom</>}
        stat={[`${moved} moved`, `${plays} play${plays === 1 ? "" : "s"}`].join(" · ")}
        badges={
          <>
            {c.errors > 0 && (
              <Tag tone="danger" size="sm" title={issues.filter((i) => i.level === "error").map((i) => i.message).join("\n")}>
                {c.errors} error{c.errors === 1 ? "" : "s"}
              </Tag>
            )}
            {c.warnings > 0 && (
              <Tag tone="warning" size="sm" icon="warning" title={issues.filter((i) => i.level === "warning").map((i) => i.message).join("\n")}>
                {c.warnings}
              </Tag>
            )}
            {!c.errors && !c.warnings && (
              <Tag tone="ok" size="sm" icon="check">
                Ready
              </Tag>
            )}
          </>
        }
        corner={
          <button
            type="button"
            className={s.more}
            title="More actions"
            aria-label={`More actions for ${spec.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onMenu(e);
            }}
          >
            ⋯
          </button>
        }
        onClick={onOpen}
        onContextMenu={onMenu}
      />
    </div>
  );
}

function FileRow(p: {
  label: string;
  count?: number;
  active: boolean;
  dirty?: boolean;
  error?: string;
  errors?: number;
  warnings?: number;
  onClick(): void;
  onDelete?(): void;
}) {
  return (
    <div className={cx(s.fileRow, p.active && s.fileRowOn)} title={p.error ?? p.label}>
      <button type="button" className={s.fileBtn} onClick={p.onClick} aria-pressed={p.active}>
        {p.error ? <Icon name="warning" size={14} className={s.fileError} /> : <Icon name={p.onDelete ? "file" : "grid"} size={14} />}
        <span className={cx(s.fileLabel, p.onDelete && s.fileLabelMono)}>{p.label}</span>
        {p.dirty && <span className={s.dirtyDot} aria-label="Unsaved changes" title="Unsaved changes" />}
        {!!p.errors && <span className={s.errCount}>{p.errors}</span>}
        {!p.errors && !!p.warnings && <span className={s.warnCount}>{p.warnings}</span>}
        {p.count !== undefined && <span className={s.fileCount}>{p.count}</span>}
      </button>
      {p.onDelete && <IconButton icon="trash" title="Delete file" size="sm" className={s.fileDelete} onClick={p.onDelete} />}
    </div>
  );
}
