// App shell: Madden-style loading screen, top bar (wordmark · tab row in workflow order · active document, undo/redo,
// Help and Settings), the routed view, toasts and dialogs. Keyboard + mouse only: every action is a visible control;
// the only global keys are ⌘/Ctrl+Z undo, ⇧⌘Z / Ctrl+Y redo, ⌘/Ctrl+S save and ⇧⌘S save all.
import { Suspense, lazy, useEffect, useRef, useState, type ComponentType } from "react";
import { useActions, type ActionDef } from "./input/actions";
import { comboLabel } from "./input/keys";
import { useLibrary } from "./state/library";
import { href, lastMainHash, navigate, rememberRoute, rememberedHash, rewriteRememberedPath, useRoute, type Route, type ViewId } from "./state/router";
import { useWorkspace } from "./state/workspace";
import { Button, DialogHost, ErrorBoundary, cx, helpHref, Icon, IconButton, ProgressBar, TabBar, Toaster, toast, useScreenHelpTopic, type TabItem } from "./ui";
import { HELP_SECTIONS } from "./views/help/sections";
import { AddToPlaybookHost } from "./views/library/AddToPlaybook";
import { ConflictHost, openConflict } from "./ConflictDialog";
import s from "./App.module.css";

// Views load on demand (one chunk each): the first paint stays small, and a broken view can't take down the shell —
// its import error lands in the view's ErrorBoundary instead.
const ConceptsView = lazy(() => import("./views/concepts/ConceptsView").then((m) => ({ default: m.ConceptsView })));
const DesignerView = lazy(() => import("./views/designer/DesignerView").then((m) => ({ default: m.DesignerView })));
const ExportView = lazy(() => import("./views/export/ExportView").then((m) => ({ default: m.ExportView })));
const FormationsView = lazy(() => import("./views/formations/FormationsView").then((m) => ({ default: m.FormationsView })));
const HelpView = lazy(() => import("./views/help/HelpView").then((m) => ({ default: m.HelpView })));
const LibraryView = lazy(() => import("./views/library/LibraryView").then((m) => ({ default: m.LibraryView })));
const PlaybookView = lazy(() => import("./views/playbook/PlaybookView").then((m) => ({ default: m.PlaybookView })));
const PlayCallView = lazy(() => import("./views/playcall/PlayCallView").then((m) => ({ default: m.PlayCallView })));
const SettingsView = lazy(() => import("./views/settings/SettingsView").then((m) => ({ default: m.SettingsView })));

/** Views with a top tab, in workflow order. Play Call lives under PLAYBOOK, Concepts under LIBRARY. */
type TabView = "playbook" | "library" | "designer" | "formations" | "export";

const MAIN_TABS: TabItem<TabView>[] = [
  { id: "playbook", label: "Playbook", title: "Build a playbook: formations, sets, plays and audibles" },
  { id: "library", label: "Library", title: "Every play in the game, plus your custom plays" },
  { id: "designer", label: "Designer", title: "Draw custom plays: routes, blocks and motion" },
  { id: "formations", label: "Formations", title: "Custom formations and sets: move players, motion presets" },
  { id: "export", label: "Export", title: "Check everything and send it to the game PC" },
];

/** The top tab a view belongs to (Help and Settings have none). Gameplan (concepts) keeps the tab it was opened from. */
const TAB_OF: Partial<Record<ViewId, TabView>> = {
  playbook: "playbook",
  playcall: "playbook",
  library: "library",
  concepts: "playbook",
  designer: "designer",
  formations: "formations",
  export: "export",
};

/**
 * The guide section that explains a view. The top bar's "?" is the one help button on every screen: it opens this
 * section, or a more specific one the view names with useHelpTopic() (ui/HelpLink.tsx).
 */
const HELP_OF: Record<ViewId, string> = {
  playbook: "playbook",
  playcall: "preview",
  library: "library",
  concepts: "concepts",
  designer: "designer",
  formations: "formations",
  export: "export",
  settings: "audibles",
  help: "getting-started",
};

const VIEWS: Record<ViewId, ComponentType> = {
  library: LibraryView,
  playbook: PlaybookView,
  playcall: PlayCallView,
  designer: DesignerView,
  formations: FormationsView,
  concepts: ConceptsView,
  export: ExportView,
  settings: SettingsView,
  help: HelpView,
};

const VIEW_NAMES: Record<ViewId, string> = {
  library: "Library",
  playbook: "Playbook",
  playcall: "Play Call",
  designer: "Designer",
  formations: "Formations",
  concepts: "Gameplan",
  export: "Export",
  settings: "Settings",
  help: "Help",
};

// ─────────────────────────────── workspace helpers ───────────────────────────────

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);

async function saveDoc(path: string): Promise<void> {
  try {
    await useWorkspace.getState().save(path);
    const err = useWorkspace.getState().docs[path]?.error;
    if (err) toast.error("Save failed", { detail: `${path}: ${err}` });
    else toast.success("Saved", { detail: path });
  } catch (e) {
    toast.error("Save failed", { detail: `${path}: ${errMsg(e)}` });
  }
}

async function saveActive(): Promise<void> {
  const { activePath, docs } = useWorkspace.getState();
  if (!activePath) return;
  if (!docs[activePath]?.dirty) {
    toast.info("No changes to save", { detail: activePath, duration: 2000 });
    return;
  }
  await saveDoc(activePath);
}

async function saveAll(): Promise<void> {
  const dirty = Object.values(useWorkspace.getState().docs).filter((d) => d.dirty).length;
  if (!dirty) return;
  try {
    await useWorkspace.getState().saveAll();
    const failed = Object.values(useWorkspace.getState().docs).filter((d) => d.dirty && d.error);
    if (failed.length) toast.error(`${failed.length} file${failed.length > 1 ? "s" : ""} failed to save`, { detail: failed.map((d) => d.path).join(", ") });
    else toast.success(`Saved ${dirty} file${dirty > 1 ? "s" : ""}`);
  } catch (e) {
    toast.error("Save all failed", { detail: errMsg(e) });
  }
}

// ─────────────────────────────── boot ───────────────────────────────

function boot() {
  const ws = useWorkspace.getState();
  if (!ws.ready && !ws.loading) {
    // init() never rejects; failures land in state.error.
    void ws.init().then(() => {
      const err = useWorkspace.getState().error;
      if (err) toast.error("Couldn't load the workspace files", { detail: err });
    });
  }
  const lib = useLibrary.getState();
  if (lib.status === "idle") void lib.load();
}

export function App() {
  const status = useLibrary((st) => st.status);
  // The library is needed by almost every view, but Settings and Help work without it.
  const [skipped, setSkipped] = useState(false);

  // The unsaved-changes prompt on close is registered by state/workspace.ts.
  useEffect(boot, []);
  useEffect(followWorkspacePaths, []);

  return (
    <>
      <div className={s.stadium} aria-hidden />
      {status === "ready" || skipped ? <Shell /> : <LoadingScreen onSkip={() => setSkipped(true)} />}
      {status === "ready" && <AddToPlaybookHost />}
      {(status === "ready" || skipped) && <ConflictHost />}
      <Toaster />
      <DialogHost />
    </>
  );
}

// ─────────────────────────────── loading screen ───────────────────────────────

const TIPS: string[] = [
  "Start in PLAYBOOK: open STUDIO, add plays from the library and set the four audibles per set",
  `Every edit can be undone: ${comboLabel("mod+z")} undo, ${comboLabel("shift+mod+z")} redo`,
  `${comboLabel("mod+s")} saves the file you're editing to playbooks/`,
  "Draw a route once, save it to My Routes, and reuse it on any play and player",
  "The red route is the primary receiver — pick it in the designer's Play panel",
  "Plays tagged NEEDS MOD aren't global — the Playbook Studio mod pulls them in",
  "Custom plays start from a base play in the same set; handoff and option mechanics stay locked",
  "The game PC turns everything into one mod, pbstudio.fbmod, plus one save per playbook",
  "New here? The ? at the top right opens the guide for the screen you're on",
];

function formatProgress(loaded: number, total: number): string | undefined {
  if (total <= 0) return undefined;
  // Byte counts (the 17 MB plays file) read better as MB; small totals are item counts.
  if (total >= 65536) return `${(loaded / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`;
  return `${loaded} / ${total}`;
}

function LoadingScreen({ onSkip }: { onSkip(): void }) {
  const { status, progress, error } = useLibrary();
  const [tip, setTip] = useState(() => Math.floor(Math.random() * TIPS.length));
  useEffect(() => {
    const t = window.setInterval(() => setTip((i) => (i + 1) % TIPS.length), 4500);
    return () => window.clearInterval(t);
  }, []);

  const failed = status === "error";
  const retry = () => void useLibrary.getState().load();
  const value = progress.total > 0 ? progress.loaded / progress.total : undefined;
  return (
    <div className={s.loading}>
      <div className={s.loadingCenter}>
        <div className={s.eyebrow}>Madden NFL 27</div>
        <h1 className={s.wordmark}>
          Playbook <span>Studio</span>
        </h1>
        {failed ? (
          <div className={s.loadError}>
            <div className={s.loadErrorTitle}>
              <Icon name="warning" size={20} /> Couldn't load the play library
            </div>
            <code className={s.loadErrorMsg}>{error ?? "Unknown error"}</code>
            <div className={s.loadErrorHint}>
              The app reads data/library/*.json from your “2026 Playbook” folder — through the local server (`npm run dev` in app/) or the folder you
              opened. Check that the files exist, then retry.
            </div>
            <div className={s.loadErrorActions}>
              <Button variant="primary" size="lg" icon="refresh" onClick={retry} autoFocus>
                Retry
              </Button>
              <Button variant="secondary" size="lg" onClick={onSkip}>
                Continue without library
              </Button>
            </div>
          </div>
        ) : (
          <div className={s.loadProgress}>
            <ProgressBar
              value={value}
              indeterminate={value === undefined}
              label={progress.label || (status === "idle" ? "Starting" : "Loading library")}
              detail={formatProgress(progress.loaded, progress.total)}
            />
          </div>
        )}
      </div>
      <div className={s.tip} key={tip}>
        <span className={s.tipBadge}>Tip</span>
        <span>{TIPS[tip]}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────── shell ───────────────────────────────

/**
 * Where a top tab goes. Clicking the tab you're on returns to its start screen; otherwise each tab reopens where you
 * left it (state/router.ts remembers it). From the play-call preview, PLAYBOOK opens the same book in the builder.
 */
function tabTarget(id: TabView, current: Route): string {
  if (current.view === id) return `#/${id}`;
  if (id === "playbook" && current.view === "playcall" && current.parts[0]) return href("playbook", current.parts[0]);
  return rememberedHash(id) ?? `#/${id}`;
}

/**
 * Keep remembered tab routes pointing at real files: when a workspace doc is renamed (its entry moves to a new key
 * with the same data and history) rewrite the routes that name it; when it's deleted, forget them. Returns the
 * unsubscribe function (an effect cleanup).
 */
function followWorkspacePaths(): () => void {
  return useWorkspace.subscribe((st, prev) => {
    if (st.docs === prev.docs) return;
    const gone = Object.keys(prev.docs).filter((p) => !(p in st.docs));
    if (!gone.length) return;
    const added = Object.keys(st.docs).filter((p) => !(p in prev.docs));
    for (const from of gone) {
      const old = prev.docs[from];
      const to = added.find((p) => st.docs[p].past === old.past && st.docs[p].data === old.data);
      rewriteRememberedPath(from, to);
    }
  });
}

function ViewLoading({ name }: { name: string }) {
  return (
    <div className={s.viewLoading}>
      <ProgressBar indeterminate label={`Loading ${name}`} />
    </div>
  );
}

function Shell() {
  const route = useRoute();
  const activePath = useWorkspace((st) => st.activePath);
  const canUndo = useWorkspace((st) => !!st.activePath && (st.docs[st.activePath]?.past.length ?? 0) > 0);
  const canRedo = useWorkspace((st) => !!st.activePath && (st.docs[st.activePath]?.future.length ?? 0) > 0);
  const dirtyCount = useWorkspace((st) => Object.values(st.docs).filter((d) => d.dirty).length);

  useEffect(() => rememberRoute(route), [route]);

  const onSettings = route.view === "settings";
  const onHelp = route.view === "help";
  const toggleSettings = () => navigate(onSettings ? lastMainHash() : "#/settings");
  const topic = useScreenHelpTopic();
  const helpSection = topic?.section ?? HELP_OF[route.view];
  const helpTitle = HELP_SECTIONS.find((h) => h.id === helpSection)?.title;
  const toggleHelp = () => navigate(onHelp ? lastMainHash() : helpHref(helpSection, topic?.heading));

  const undo = () => useWorkspace.getState().undo();
  const redo = () => useWorkspace.getState().redo();
  const globalActions: ActionDef[] = [
    { id: "undo", label: "Undo", keys: ["mod+z"], enabled: canUndo, run: undo },
    { id: "redo", label: "Redo", keys: ["shift+mod+z", "mod+y"], enabled: canRedo, run: redo },
    { id: "save", label: "Save", keys: ["mod+s"], allowInInput: true, enabled: !!activePath, run: () => void saveActive() },
    { id: "save-all", label: "Save all", keys: ["shift+mod+s"], allowInInput: true, enabled: dirtyCount > 0, run: () => void saveAll() },
  ];
  useActions("global", globalActions);

  // Gameplan opens from the playbook and from the library: keep the tab you came from lit.
  const lastTab = useRef<TabView>("playbook");
  const activeTab = route.view === "concepts" ? lastTab.current : TAB_OF[route.view];
  if (route.view !== "concepts" && activeTab) lastTab.current = activeTab;

  const View = VIEWS[route.view];
  return (
    <div className={s.app}>
      <header className={s.topbar}>
        <a className={s.brand} href="#/playbook" aria-label="Playbook Studio home">
          <span className={s.brandEyebrow}>Madden NFL 27</span>
          {/* Narrow windows show "PB STUDIO": a bare "PLAYBOOK" next to the PLAYBOOK tab reads like a duplicate tab. */}
          <span className={s.brandMark}>
            <span className={s.brandLong}>Playbook</span>
            <span className={s.brandShort}>PB</span> <span className={s.brandStudio}>Studio</span>
          </span>
        </a>
        <TabBar className={s.nav} items={MAIN_TABS} active={activeTab} onChange={(id) => navigate(tabTarget(id, route))} aria-label="Main" />
        <div className={s.tools}>
          <DocChip dirtyCount={dirtyCount} />
          <div className={s.toolGroup}>
            <IconButton icon="undo" title="Undo" shortcut={{ keys: ["mod+z"] }} disabled={!canUndo} onClick={undo} />
            <IconButton icon="redo" title="Redo" shortcut={{ keys: ["shift+mod+z"] }} disabled={!canRedo} onClick={redo} />
          </div>
          <span className={s.toolDivider} aria-hidden />
          <div className={s.toolGroup}>
            <IconButton icon="help" title={onHelp ? "Close help" : helpTitle ? `Help: ${helpTitle}` : "Help & guide"} active={onHelp} onClick={toggleHelp} />
            <IconButton icon="gear" title={onSettings ? "Close settings" : "Settings"} active={onSettings} onClick={toggleSettings} />
          </div>
        </div>
      </header>
      <main className={s.content}>
        <ErrorBoundary resetKey={route.hash} name={VIEW_NAMES[route.view]}>
          <div className={s.view} key={route.view}>
            <Suspense fallback={<ViewLoading name={VIEW_NAMES[route.view]} />}>
              <View />
            </Suspense>
          </div>
        </ErrorBoundary>
      </main>
    </div>
  );
}

/**
 * The one save status on every screen: the file ⌘S saves (the view's active document), a dot while it (filled) or
 * another file (hollow) has unsaved changes, and Save / "Saved". Views don't draw their own.
 */
function DocChip({ dirtyCount }: { dirtyCount: number }) {
  const activePath = useWorkspace((st) => st.activePath);
  const dirty = useWorkspace((st) => (st.activePath ? !!st.docs[st.activePath]?.dirty : false));
  const error = useWorkspace((st) => (st.activePath ? st.docs[st.activePath]?.error : undefined));
  // A refused save, or unsaved edits to a file that changed on disk since it was loaded (focus re-check).
  const conflict = useWorkspace((st) => (st.activePath ? !!st.conflicts[st.activePath] || !!st.docs[st.activePath]?.changedOnDisk : false));
  const otherConflicts = useWorkspace((st) => Object.keys(st.conflicts).filter((p) => p !== st.activePath).length);
  const [saving, setSaving] = useState(false);
  if (!activePath) return null;

  const others = dirtyCount - (dirty ? 1 : 0);
  const save = async () => {
    setSaving(true);
    try {
      await saveDoc(activePath);
    } finally {
      setSaving(false);
    }
  };
  const status = [
    dirty ? "Unsaved changes" : "Saved",
    others > 0 ? `${others} other file${others > 1 ? "s" : ""} unsaved (${comboLabel("shift+mod+s")} saves all)` : "",
    conflict ? "Changed on disk since it was loaded: saving won't overwrite it until you choose" : "",
    otherConflicts > 0 ? `${otherConflicts} other file${otherConflicts > 1 ? "s" : ""} couldn't be saved (changed on disk)` : "",
  ];
  return (
    <div className={s.doc} title={[activePath, error, ...status].filter(Boolean).join("\n")}>
      {error && <Icon name="warning" size={15} className={s.docError} />}
      {conflict && (
        <button type="button" className={s.diskChanged} onClick={() => openConflict(activePath)} title="Changed on disk — reload, overwrite or save a copy">
          <Icon name="warning" size={13} /> Changed on disk
        </button>
      )}
      <span className={s.docName}>{basename(activePath)}</span>
      {(dirty || others > 0) && <span className={cx(s.dirtyDot, !dirty && s.dirtyOthers)} aria-label={status.filter(Boolean).join(". ")} />}
      {dirty ? (
        <Button size="sm" variant="primary" icon="save" loading={saving} onClick={() => void save()} title={`Save ${basename(activePath)} (${comboLabel("mod+s")})`}>
          Save
        </Button>
      ) : (
        <span className={s.docSaved}>
          <Icon name="check" size={13} /> Saved
        </span>
      )}
    </div>
  );
}
