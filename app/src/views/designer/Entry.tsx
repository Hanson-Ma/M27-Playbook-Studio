// Designer entry (#/designer): plays files on the left, the selected file's custom plays as cards on the right.
// "New play" opens the wizard, "New plays file" makes a file; click a card to edit it, right-click for more.
import { useEffect, useMemo, useState } from "react";
import { PlayCard } from "../../field";
import { leaf } from "../../model/names";
import type { PlaysFile, ResolvedPlay } from "../../model/types";
import { useCatalog } from "../../state/library";
import { href, navigate } from "../../state/router";
import { useSettings } from "../../state/settings";
import { useDocsOfKind, useWorkspace } from "../../state/workspace";
import { openAddToPlaybook } from "../library/AddToPlaybook";
import { Button, EmptyState, IconButton, Tag, VirtualGrid, confirmDialog, cx, promptDialog, toast, useContextMenu } from "../../ui";
import { NewPlayWizard, type WizardPrefill } from "./NewPlayWizard";
import s from "./Entry.module.css";

export function Entry({ wizard, query }: { wizard?: boolean; query?: URLSearchParams }) {
  const docs = useDocsOfKind<PlaysFile>("plays");
  const catalog = useCatalog()!;
  const last = useSettings((st) => st.lastPlaysFile);
  const [picked, setPicked] = useState<string | undefined>(last);
  const current = docs.find((d) => d.path === picked) ?? docs.find((d) => d.path === last) ?? docs[0];
  const [sel, setSel] = useState(0);
  const [wizardOpen, setWizardOpen] = useState(!!wizard);
  const cm = useContextMenu();

  useEffect(() => setWizardOpen(!!wizard), [wizard, query]);

  const plays = useMemo(
    () => (current ? catalog.custom.filter((p) => p.file === current.path).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)) : []),
    [catalog, current],
  );

  const pickFile = (path: string) => {
    setPicked(path);
    setSel(0);
    useSettings.getState().set({ lastPlaysFile: path });
  };
  const open = (p: ResolvedPlay | undefined) => p && p.file !== undefined && p.index !== undefined && navigate(href("designer", p.file, p.index));

  const newFile = async () => {
    const name = await promptDialog({
      title: "New plays file",
      label: "File name (playbooks/plays/<name>.json)",
      initial: "my-plays",
      mono: true,
      validate: (v) => {
        const slug = slugify(v);
        if (!slug) return "Use letters, digits and dashes";
        if (useWorkspace.getState().docs[`playbooks/plays/${slug}.json`]) return "That file already exists";
        return undefined;
      },
    });
    if (!name) return;
    const path = `playbooks/plays/${slugify(name)}.json`;
    try {
      useWorkspace.getState().create<PlaysFile>(path, "plays", { plays: [] });
      pickFile(path);
      toast.success("Plays file created", { detail: `${path} — save it once it has plays.` });
    } catch (e) {
      toast.error("Couldn't create the file", { detail: e instanceof Error ? e.message : String(e) });
    }
  };

  const closeWizard = () => {
    setWizardOpen(false);
    if (wizard) navigate("#/designer", { replace: true });
  };

  const deletePlay = async (p: ResolvedPlay) => {
    if (!p.file || p.index === undefined) return;
    const ok = await confirmDialog({ title: `Delete "${p.name}"?`, body: `Removes it from ${p.file}. Undo (⌘Z) brings it back.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    const idx = p.index;
    useWorkspace.getState().update<PlaysFile>(p.file, (d) => void d.plays.splice(idx, 1), { label: "Delete play" });
    useWorkspace.getState().setActive(p.file);
  };

  const saveFile = async (path: string) => {
    try {
      await useWorkspace.getState().save(path);
      toast.success("Saved", { detail: path });
    } catch (e) {
      toast.error("Save failed", { detail: e instanceof Error ? e.message : String(e) });
    }
  };

  useEffect(() => {
    if (current) useWorkspace.getState().setActive(current.path);
  }, [current?.path]);

  const prefill = useMemo<WizardPrefill | undefined>(() => {
    if (!query) return current ? { file: current.path } : undefined;
    const slot = query.get("slot");
    return {
      set: query.get("set") ?? undefined,
      base: query.get("base") ?? undefined,
      slot: slot !== null && /^\d+$/.test(slot) ? Number(slot) : undefined,
      assignment: query.get("assignment") ?? undefined,
      file: query.get("file") ?? current?.path,
    };
  }, [query, current?.path]);

  return (
    <div className={s.page}>
      <header className={s.header}>
        <div>
          <div className={s.eyebrow}>Playbook Studio</div>
          <h1 className={s.title}>Play designer</h1>
        </div>
        <p className={s.lede}>
          Make your own plays: start from a play in the game (it gives the formation, where everyone lines up and any handoff), then change routes, blocks and
          motion. Plays are saved in playbooks/plays/ and built into the mod on the game PC.
        </p>
        <div className={s.headerTools}>
          <Button variant="primary" icon="plus" onClick={() => setWizardOpen(true)}>
            New play
          </Button>
          <Button icon="file" onClick={newFile}>
            New plays file
          </Button>
        </div>
      </header>

      <div className={s.body}>
        <aside className={s.files}>
          <div className={s.filesHead}>Plays files</div>
          {docs.length === 0 && <div className={s.noFiles}>No plays files yet.</div>}
          {docs.map((d) => {
            const n = Array.isArray(d.data?.plays) ? d.data.plays.length : 0;
            const on = d.path === current?.path;
            const problems = catalog.custom.filter((p) => p.file === d.path && p.problems.length).length;
            return (
              <div key={d.path} className={cx(s.file, on && s.fileOn)}>
                <button type="button" className={s.fileMain} onClick={() => pickFile(d.path)}>
                  <span className={s.fileName}>{typeof d.data?.title === "string" ? d.data.title : leaf(d.path).replace(/\.json$/, "")}</span>
                  <span className={s.fileMeta}>
                    {d.error ? "can't load" : `${n} play${n === 1 ? "" : "s"}`} · <span className={s.fileMetaPath}>{leaf(d.path)}</span>
                  </span>
                </button>
                <div className={s.fileBadges}>
                  {d.dirty && <span className={s.dirty} title="Unsaved changes" />}
                  {problems > 0 && (
                    <Tag tone="danger" size="sm">
                      {problems}
                    </Tag>
                  )}
                  {d.dirty && <IconButton icon="save" size="sm" title="Save this file" onClick={() => saveFile(d.path)} />}
                </div>
              </div>
            );
          })}
        </aside>

        <main className={s.main}>
          {current?.error ? (
            <EmptyState icon="warning" title="This plays file can't be loaded" body={current.error} />
          ) : !current ? (
            <EmptyState
              icon="route"
              title="No plays files yet"
              body="A plays file holds your custom plays. Create one, then design your first play."
              action={
                <Button variant="primary" icon="file" onClick={newFile}>
                  New plays file
                </Button>
              }
            />
          ) : (
            <>
              <div className={s.mainHead}>
                <span className={s.mainTitle}>{typeof current.data?.title === "string" ? current.data.title : leaf(current.path)}</span>
                <span className={s.mainPath}>{current.path}</span>
              </div>
              {plays.length === 0 ? (
                  <EmptyState
                    icon="route"
                    title="No plays in this file yet"
                    body="Click New play: pick a formation, a set and a play to start from, then make it your own."
                    action={
                      <Button variant="primary" icon="plus" onClick={() => setWizardOpen(true)}>
                        New play
                      </Button>
                    }
                  />
              ) : (
              <VirtualGrid
                count={plays.length}
                cellWidth={268}
                cellHeight={196}
                gap={14}
                padding={4}
                stretch
                selectedIndex={Math.min(sel, plays.length - 1)}
                onSelect={setSel}
                onActivate={(i) => open(plays[i])}
                padEnd={24}
                className={s.grid}
                aria-label="Custom plays"
                renderCell={(i, { selected }) => {
                  const p = plays[i];
                  return (
                    <div
                      className={s.cell}
                      onContextMenu={(e) =>
                        cm.open(e, [
                          { label: "Edit", icon: "route", onSelect: () => open(p) },
                          { label: "Add to playbook…", icon: "playcall", onSelect: () => openAddToPlaybook(p.key) },
                          { kind: "separator" },
                          { label: "Delete…", icon: "trash", danger: true, onSelect: () => deletePlay(p) },
                        ])
                      }
                    >
                      <PlayCard
                        play={p}
                        size="sm"
                        selected={selected}
                        onClick={() => open(p)}
                        badges={
                          p.problems.length > 0 ? (
                            <Tag tone="danger" size="sm" title={p.problems.join("\n")}>
                              {p.problems.length} problem{p.problems.length > 1 ? "s" : ""}
                            </Tag>
                          ) : undefined
                        }
                      />
                    </div>
                  );
                }}
              />
              )}
            </>
          )}
        </main>
      </div>
      {cm.node}
      {wizardOpen && <NewPlayWizard key={query?.toString() ?? ""} prefill={prefill} onClose={closeWizard} />}
    </div>
  );
}

function slugify(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .replace(/\.json$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
