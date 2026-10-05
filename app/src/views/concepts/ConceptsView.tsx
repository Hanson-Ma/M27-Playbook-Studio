// Concepts & categories (#/concepts): editor-only categories in app-data/concepts.json, play tagging with suggestions,
// and gameplan views over a playbook. Sections (clickable tabs): Tag Plays · Categories · Run Matrix · Pass Matrix ·
// Situations · Coverage. Opened from the playbook ("Gameplan") or the library ("Gameplan"); `?from=library|
// playbook` picks the header's back link. Deep link: #/concepts?play=<key> focuses a play in the tagging workspace.
import { useEffect, useState, type CSSProperties } from "react";
import { CATEGORY_GROUPS, GROUP_LABEL, SEED_CATEGORIES, groupOf, seedConcepts } from "../../model/concepts";
import { CONCEPTS_PATH, emptyConcepts } from "../../model/conceptsDoc";
import type { ConceptsDoc } from "../../model/types";
import { useCatalog, useLibrary } from "../../state/library";
import { href, navigate, rememberedHash, useRoute } from "../../state/router";
import { useSettings } from "../../state/settings";
import { useWorkspace } from "../../state/workspace";
import { Button, EmptyState, Spinner, TabBar, cx, toast } from "../../ui";
import { CategoriesSection } from "./CategoriesSection";
import { CoverageSection, MatrixSection, SituationsSection } from "./GameplanSections";
import { SECTIONS, sectionHash, uiSet, useConceptsEntry, useConceptsUi, type Section } from "./store";
import { TagSection } from "./TagSection";
import s from "./ConceptsView.module.css";

const isSection = (x: string | undefined): x is Section => SECTIONS.some((t) => t.id === x);

export function ConceptsView() {
  const route = useRoute();
  const section: Section = isSection(route.parts[0]) ? route.parts[0] : "tag";
  const ready = useWorkspace((st) => st.ready);
  const wsError = useWorkspace((st) => st.error);
  const entry = useConceptsEntry();
  const catalog = useCatalog();
  const libStatus = useLibrary((st) => st.status);
  const hasDoc = !!entry && !entry.error && !!entry.data;

  // Global undo/redo/save act on the concepts file while this view is open.
  useEffect(() => {
    if (hasDoc) useWorkspace.getState().setActive(CONCEPTS_PATH);
  }, [hasDoc]);

  // ?from=library|playbook (the links that open Concepts) picks the back link; it's stripped with ?play= below.
  const from = route.query.get("from");
  // Entering the view (mount) resets it, so a later visit from elsewhere doesn't keep a stale back link.
  useEffect(() => {
    uiSet({ backTo: from === "library" || from === "playbook" ? from : undefined });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (from === "library" || from === "playbook") uiSet({ backTo: from });
    if (from && !route.query.get("play")) navigate(sectionHash(section), { replace: true });
  }, [from]); // eslint-disable-line react-hooks/exhaustive-deps

  // #/concepts?play=<key>: focus that play in the tagging workspace (in its own set, so it's always listed).
  const deepPlay = route.query.get("play");
  useEffect(() => {
    if (!deepPlay || !catalog) return;
    const play = catalog.get(deepPlay);
    if (play) {
      const formation = catalog.lib.setByAsset.get(play.set)?.formation;
      uiSet({ scope: "set", formation, setAsset: play.set, focus: play.key, checked: [], filter: [], untagged: false, suggested: false, cameFrom: "deeplink" });
    } else toast.warning("That Play Isn't in the Library or Any Plays File", { detail: deepPlay });
    navigate("#/concepts", { replace: true });
  }, [deepPlay, catalog]);

  const go = (id: Section) => navigate(sectionHash(id), { replace: true });

  let body;
  if (!ready) {
    body = wsError ? (
      <EmptyState icon="warning" title="Workspace Unavailable" body={wsError} action={<Button onClick={() => void useWorkspace.getState().init()}>Retry</Button>} />
    ) : (
      <div className={s.center}>
        <Spinner size={22} /> Loading workspace…
      </div>
    );
  } else if (!entry) body = <CreateConcepts />;
  else if (entry.error || !entry.data) body = <BrokenConcepts error={entry.error ?? "The file is empty"} />;
  else if (section === "categories") body = <CategoriesSection doc={entry.data} />;
  else if (!catalog)
    body = (
      <EmptyState
        icon="warning"
        title="Play library not loaded"
        body={libStatus === "loading" ? "Loading data/library…" : "Tagging and gameplan views need the play library (data/library/*.json)."}
        action={
          <Button variant="primary" loading={libStatus === "loading"} onClick={() => void useLibrary.getState().load()}>
            Load Library
          </Button>
        }
      />
    );
  else if (section === "tag") body = <TagSection doc={entry.data} catalog={catalog} />;
  else if (section === "run" || section === "pass") body = <MatrixSection key={section} group={section} doc={entry.data} catalog={catalog} />;
  else if (section === "situations") body = <SituationsSection doc={entry.data} catalog={catalog} />;
  else body = <CoverageSection doc={entry.data} catalog={catalog} />;

  return (
    <div className={s.page}>
      <header className={s.header}>
        <BackLink />
        <div className={s.titles}>
          <div className={s.eyebrow}>Concepts &amp; Tags · Editor Only</div>
          <h1 className={s.title}>Gameplan</h1>
        </div>
        <TabBar items={SECTIONS} active={section} onChange={go} size="sm" className={s.tabs} aria-label="Gameplan sections" />
        <DocCounts />
      </header>
      <div className={s.body}>{body}</div>
    </div>
  );
}

/** "‹ Playbook" / "‹ Library": back to the view that opened Concepts (its last route), default the playbook. */
function BackLink() {
  const backTo = useConceptsUi((st) => st.backTo);
  const lastBook = useSettings((st) => st.lastPlaybook);
  const target = backTo ?? (rememberedHash("playbook") || !rememberedHash("library") ? "playbook" : "library");
  const hash = rememberedHash(target) ?? (target === "playbook" && lastBook ? href("playbook", lastBook) : `#/${target}`);
  return (
    <Button variant="ghost" icon="chevronLeft" onClick={() => navigate(hash)} className={s.back} title={`Back to the ${target}`}>
      {target === "playbook" ? "Playbook" : "Library"}
    </Button>
  );
}

/** What's in the concepts file. Saved / unsaved and Save are the top bar's (one save status per screen). */
function DocCounts() {
  const entry = useConceptsEntry();
  if (!entry || entry.error || !entry.data) return <div className={s.status} />;
  const doc = entry.data;
  const tagged = Object.values(doc.tags ?? {}).filter((t) => Array.isArray(t) && t.length).length;
  return (
    <div className={s.status}>
      <span className={s.counts}>
        {(doc.categories ?? []).length} categories · {tagged} tagged plays
      </span>
    </div>
  );
}

function CreateConcepts() {
  const create = (seeded: boolean) => {
    const doc: ConceptsDoc = seeded ? seedConcepts() : emptyConcepts();
    try {
      useWorkspace.getState().create<ConceptsDoc>(CONCEPTS_PATH, "concepts", doc);
      useWorkspace.getState().setActive(CONCEPTS_PATH);
      toast.success(seeded ? `Created ${doc.categories.length} Categories` : "Created an Empty Concepts File", {
        detail: `${CONCEPTS_PATH} — not written yet: save with ⌘/Ctrl+S.`,
      });
    } catch (e) {
      toast.error("Couldn't Create the Concepts File", { detail: e instanceof Error ? e.message : String(e) });
    }
  };
  const seed = seedConcepts();
  return (
    <div className={s.create}>
      <div className={s.createCard}>
        <div className={s.createPath}>app-data/concepts.json</div>
        <h2 className={s.createTitle}>Build Your Concept Tree</h2>
        <p className={s.createBody}>
          Categories for pass concepts, run schemes and everything else. Tag any play — stock or custom — accept suggestions from the game's own play types and read
          concepts, then see what your playbook has for every situation. Editor-only: the game never reads this file.
        </p>
        <div className={s.seedCols}>
          {CATEGORY_GROUPS.map((g) => (
            <div key={g} className={s.seedCol}>
              <div className={s.seedHead}>
                {GROUP_LABEL[g]} <span>{SEED_CATEGORIES[g].length}</span>
              </div>
              <div className={s.seedChips}>
                {seed.categories
                  .filter((c) => groupOf(c) === g)
                  .map((c) => (
                    <span key={c.id} className={s.seedChip} style={{ "--c": c.color } as CSSProperties}>
                      {c.name}
                    </span>
                  ))}
              </div>
            </div>
          ))}
        </div>
        <div className={s.createActions}>
          <Button variant="primary" size="lg" icon="plus" onClick={() => create(true)}>
            Create Concepts File
          </Button>
          <Button variant="secondary" size="lg" onClick={() => create(false)}>
            Start Empty
          </Button>
        </div>
        <div className={s.createHint}>{seed.categories.length} default categories · rename, recolor, nest or delete them any time.</div>
      </div>
    </div>
  );
}

function BrokenConcepts({ error }: { error: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <EmptyState
      icon="warning"
      title="concepts.json can't be read"
      body={
        <>
          <code className={cx(s.code)}>{error}</code>
          <br />
          Fix the file on disk (it's read-only here until it parses), then reload.
        </>
      }
      action={
        <Button
          loading={busy}
          icon="refresh"
          onClick={async () => {
            setBusy(true);
            await useWorkspace.getState().refresh();
            setBusy(false);
          }}
        >
          Reload From Disk
        </Button>
      }
    />
  );
}
