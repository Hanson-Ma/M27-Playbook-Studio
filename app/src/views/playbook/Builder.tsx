// Playbook builder (#/playbook/<path>[?f=&s=&p=]) — the app's home screen. Header (Playbooks menu, Save, Preview in
// game, Gameplan, Add plays, help), a compact validation strip, then the three steps side by side:
//   1 Pick a set (Formation → Set → Play tree) · 2 Add & order plays (the set's plays) · 3 Audibles & CPU (inspector)
// plus the add-plays drawer. Every edit goes through the workspace store (undo/redo, dirty, ⌘S). Keyboard + mouse only:
// every action is a visible control; keys are the universal ones (see ARCHITECTURE.md "v2 direction").
import { Component, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { useActions } from "../../input/actions";
import type { Catalog } from "../../model/catalog";
import { bookIds, parseWhere, whereOf, type EntryRef } from "../../model/playbook";
import { playbookIssues, resolvePlaybook } from "../../model/resolveBook";
import type { PlaybookSpec } from "../../model/types";
import { useCatalog, useLibrary } from "../../state/library";
import { navigate, useRoute } from "../../state/router";
import { useSettings } from "../../state/settings";
import { useDoc, useWorkspace } from "../../state/workspace";
import { Button, EmptyState, Menu, Spinner, SplitPane, toast, type MenuItem } from "../../ui";
import { BuilderContext, DragHandlersContext, MenuOpener, buildNodes, type BookNode, type BuilderData } from "./context";
import { customMarkers } from "./custom";
import { DragLayer, halfOf, type DragHandlers, type DragPayload, type DropCheck, type DropTargetInfo } from "./dnd";
import { AddPlaysDrawer } from "./AddPlays";
import { BuilderHeader } from "./BuilderHeader";
import { PlaybooksMenuButton } from "./books";
import { Inspector } from "./Inspector";
import { LeftPane } from "./LeftPane";
import { nodeMenu } from "./menus";
import { MiddlePane } from "./MiddlePane";
import { addPlays, moveEntries, setAudibleAt } from "./ops";
import { BOOK_ID, parentOf, useBuilderUi } from "./store";
import { useTemplate } from "./template";
import { isPlaybookShape, playbookShapeProblem } from "./shape";
import { ValidationStrip } from "./ValidationStrip";
import s from "./Builder.module.css";

export function Builder({ path }: { path: string }) {
  const ready = useWorkspace((st) => st.ready);
  const loading = useWorkspace((st) => st.loading);
  const doc = useDoc<PlaybookSpec>(path);
  const catalog = useCatalog();
  const libStatus = useLibrary((st) => st.status);

  useEffect(() => {
    useBuilderUi.getState().open(path);
  }, [path]);

  const exists = !!doc && !doc.error && isPlaybookShape(doc.kind, doc.data);
  useEffect(() => {
    if (!exists) return;
    useWorkspace.getState().setActive(path);
    useSettings.getState().set({ lastPlaybook: path });
    return () => {
      if (useWorkspace.getState().activePath === path) useWorkspace.getState().setActive(undefined);
    };
  }, [path, exists]);

  if (!ready || loading)
    return (
      <div className={s.center}>
        <Spinner size={28} label="Loading playbooks" />
      </div>
    );
  const reload = (
    <Button icon="refresh" onClick={() => void useWorkspace.getState().refresh()}>
      Reload files
    </Button>
  );
  const other = <PlaybooksMenuButton label="Open another playbook" />;
  if (!doc)
    return (
      <div className={s.center}>
        <EmptyState icon="file" title="Playbook not found" body={<code className={s.code}>{path}</code>} action={other} />
      </div>
    );
  if (doc.error)
    return (
      <div className={s.center}>
        <EmptyState
          icon="warning"
          title="This playbook couldn't be loaded"
          body={
            <>
              <code className={s.code}>{doc.error}</code>
              <p>Fix the file on disk; it reloads when the workspace refreshes.</p>
            </>
          }
          action={
            <>
              {reload}
              {other}
            </>
          }
        />
      </div>
    );
  if (!isPlaybookShape(doc.kind, doc.data))
    return (
      <div className={s.center}>
        <EmptyState
          icon="file"
          title="Not a playbook"
          body={
            <>
              <code className={s.code}>{path}</code>
              {doc.kind === "playbook" && <p>{playbookShapeProblem(doc.data)}.</p>}
              <p>
                The builder edits playbooks/&lt;name&gt;.json files (FORMATS.md §2): an object with a <code>formations</code> list. Fix the file on
                disk; it reloads when the workspace refreshes.
              </p>
            </>
          }
          action={
            <>
              {reload}
              {other}
            </>
          }
        />
      </div>
    );
  if (!catalog)
    return (
      <div className={s.center}>
        {libStatus === "loading" ? (
          <Spinner size={28} label="Loading the play library" />
        ) : (
          <EmptyState icon="warning" title="The play library isn't loaded" body="The builder looks up formations, sets and plays in the game's play library. Reload once it's available." />
        )}
      </div>
    );
  // A hand-edited file can still be malformed below `formations`; keep the error inside this playbook (it resets when
  // the doc changes, e.g. after the file is fixed and the workspace refreshes).
  return (
    <BuilderBoundary resetKey={doc.data}>
      <LoadedBuilder path={path} spec={doc.data} catalog={catalog} />
    </BuilderBoundary>
  );
}

/** Keeps a crash inside this playbook; resets when the doc changes. */
class BuilderBoundary extends Component<{ resetKey: unknown; children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[playbook builder] crashed", error, info.componentStack);
  }
  componentDidUpdate(prev: { resetKey: unknown }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: undefined });
  }
  render() {
    return this.state.error ? <BuilderCrashed error={this.state.error} onRetry={() => this.setState({ error: undefined })} /> : this.props.children;
  }
}

function BuilderCrashed({ error, onRetry }: { error: Error; onRetry(): void }) {
  return (
    <div className={s.center}>
      <EmptyState
        icon="warning"
        title="This playbook couldn't be shown"
        body={
          <>
            <code className={s.code}>{error.message}</code>
            <p>The file probably has an unexpected shape (FORMATS.md §2). Fix it on disk; the builder reloads it when the workspace refreshes.</p>
          </>
        }
        action={
          <>
            <Button icon="refresh" onClick={() => void useWorkspace.getState().refresh()}>
              Reload files
            </Button>
            <Button onClick={onRetry}>Try again</Button>
            <PlaybooksMenuButton label="Open another playbook" />
          </>
        }
      />
    </div>
  );
}

function LoadedBuilder({ path, spec, catalog }: { path: string; spec: PlaybookSpec; catalog: Catalog }) {
  const template = useTemplate();
  // With the template save, counts and capacity checks include every row the game-side builder writes (template
  // sections, CPU rows explicit plays inherit).
  const tplContents = template.contents;
  const book = useMemo(() => resolvePlaybook(spec, catalog, { template: tplContents }), [spec, catalog, tplContents]);
  // Validation trails edits slightly so slider drags stay smooth on big books.
  const deferredSpec = useDeferredValue(spec);
  const issues = useMemo(() => playbookIssues(deferredSpec, catalog, path, { template: tplContents }), [deferredSpec, catalog, path, tplContents]);
  const ids = useMemo(() => bookIds(spec), [spec]);
  const nodes = useMemo(() => buildNodes(book, ids, template), [book, ids, template]);
  const custom = useMemo(() => customMarkers(catalog), [catalog]);
  const edit = useCallback<BuilderData["edit"]>(
    (label, recipe, opts) => useWorkspace.getState().update<PlaybookSpec>(path, recipe, { label, coalesceMs: opts?.coalesceMs }),
    [path],
  );
  const data = useMemo<BuilderData>(
    () => ({ path, spec, catalog, lib: catalog.lib, side: spec.side === "defense" ? "defense" : "offense", book, ids, nodes, issues, template, custom, edit }),
    [path, spec, catalog, book, ids, nodes, issues, template, custom, edit],
  );
  const dataRef = useRef(data);
  dataRef.current = data;

  useSelectionGuard(data);
  useUrlSync(data);

  // ── context menu ──
  const [menu, setMenu] = useState<{ items: MenuItem[]; at: { x: number; y: number } } | null>(null);
  const openMenu = useCallback((node: BookNode, at: { x: number; y: number }, expanded?: boolean) => {
    // Memoized rows may hold a node from an earlier render; menus act on the current one.
    const d = dataRef.current;
    const fresh = d.nodes.get(node.id);
    if (fresh) setMenu({ items: nodeMenu(d, fresh, { expanded }), at });
  }, []);

  // ── drag and drop ──
  const dragHandlers = useMemo<DragHandlers>(() => makeDragHandlers(() => dataRef.current), []);

  // ── keys: only Esc here (drops a multi-selection); copy/paste/delete live on the focused tree and card grid ──
  const drawer = useBuilderUi((st) => st.drawer);
  const multi = useBuilderUi((st) => st.selected.length > 1);
  useActions(
    "playbook",
    drawer || !multi
      ? []
      : [
          {
            id: "single",
            label: "Select one",
            keys: ["Escape"],
            run: () => {
              const ui = useBuilderUi.getState();
              ui.selectMany([ui.cursor], ui.cursor);
            },
          },
        ],
  );

  return (
    <BuilderContext.Provider value={data}>
      <MenuOpener.Provider value={openMenu}>
        <DragHandlersContext.Provider value={dragHandlers}>
          <div className={s.builder}>
            <BuilderHeader />
            <ValidationStrip />
            <div className={s.body}>
              <SplitPane initial={300} min={240} max={560} storageKey="pbstudio.split.playbook.tree" className={s.split}>
                <LeftPane />
                <SplitPane initial={372} min={320} max={620} sized="end" storageKey="pbstudio.split.playbook.inspector2" className={s.split}>
                  <div className={s.paneFrame}>
                    <MiddlePane />
                  </div>
                  <div className={s.paneFrame}>
                    <Inspector />
                  </div>
                </SplitPane>
              </SplitPane>
              {drawer && <AddPlaysDrawer />}
            </div>
            <DragLayer />
            {menu && <Menu items={menu.items} anchor={menu.at} placement="bottom-start" onClose={() => setMenu(null)} scopeId="playbook.menu" />}
          </div>
        </DragHandlersContext.Provider>
      </MenuOpener.Provider>
    </BuilderContext.Provider>
  );
}

// ───────────────────────────── selection guard + URL sync ─────────────────────────────

/** Keep the selection pointing at existing nodes after edits/undo (fall back to the nearest ancestor). */
function useSelectionGuard(data: BuilderData) {
  useEffect(() => {
    const ui = useBuilderUi.getState();
    const valid = ui.selected.filter((id) => data.nodes.has(id));
    let cursor = ui.cursor;
    while (cursor !== BOOK_ID && !data.nodes.has(cursor)) cursor = parentOf(cursor);
    if (cursor === ui.cursor && valid.length === ui.selected.length) return;
    useBuilderUi.setState({ cursor, selected: valid.includes(cursor) ? valid : [cursor] });
  }, [data.nodes]);
}

/** ?f=&s=&p= ⇄ the cursor (cross-view contract: #/playbook/<path>?f=&s=&p=). */
function useUrlSync(data: BuilderData) {
  const route = useRoute();
  const cursor = useBuilderUi((st) => st.cursor);
  const q = route.query;
  const fq = q.get("f");
  const sq = q.get("s");
  const pq = q.get("p");
  const lastApplied = useRef<string | null>(null);
  // The builder resets the UI store for this path in a parent effect (which runs after ours), so wait for it.
  const storePath = useBuilderUi((st) => st.path);

  // URL → selection (on open and when another view links here).
  useEffect(() => {
    if (storePath !== data.path) return;
    const key = `${fq}|${sq}|${pq}`;
    if (lastApplied.current === key) return;
    lastApplied.current = key;
    if (fq === null) return;
    const ref: EntryRef = { f: Number(fq) };
    if (sq !== null) ref.s = Number(sq);
    if (pq !== null && sq !== null) ref.p = Number(pq);
    const r = parseWhere(whereOf(ref));
    if (!r) return;
    const ids = data.ids;
    const f = ids.formations[r.f];
    const id = r.s === undefined ? f?.id : r.p === undefined ? f?.sets[r.s]?.id : f?.sets[r.s]?.plays[r.p];
    if (id && id !== useBuilderUi.getState().cursor) useBuilderUi.getState().select(id);
    requestAnimationFrame(() => document.querySelector(`[data-node-id="${CSS.escape(id ?? "")}"]`)?.scrollIntoView({ block: "nearest" }));
  }, [fq, sq, pq, data.ids, data.path, storePath]);

  // selection → URL (debounced replace; keeps the per-tab last route meaningful).
  useEffect(() => {
    if (storePath !== data.path) return;
    const t = window.setTimeout(() => {
      const node = data.nodes.get(cursor);
      const ref = node && (node.level === "formation" || node.level === "set" || node.level === "play") ? node.ref : node?.ref ? { f: node.ref.f } : undefined;
      const qs = ref ? `?f=${ref.f}${ref.s !== undefined ? `&s=${ref.s}` : ""}${ref.p !== undefined ? `&p=${ref.p}` : ""}` : "";
      const hash = `#/playbook/${encodeURIComponent(data.path)}${qs}`;
      if (location.hash !== hash) {
        lastApplied.current = ref ? `${ref.f}|${ref.s ?? null}|${ref.p ?? null}` : "null|null|null";
        navigate(hash, { replace: true });
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [cursor, data.nodes, data.path, storePath]);
}

// ───────────────────────────── drag handlers ─────────────────────────────

function makeDragHandlers(get: () => BuilderData): DragHandlers {
  const refuse = (reason: string): DropCheck => ({ ok: false, place: "into", reason });

  const check = (payload: DragPayload, t: DropTargetInfo): DropCheck | undefined => {
    const data = get();
    if (t.zone === "audible") {
      const [setId] = t.id.split("|");
      if (payload.kind === "plays" && payload.refs.length === 1) {
        const node = data.nodes.get(setId);
        const r = payload.refs[0];
        if (node?.ref && node.ref.f === r.f && node.ref.s === r.s) return { ok: true, place: "into" };
        return refuse("Audibles hold plays of this set");
      }
      if (payload.kind === "plays") return refuse("One play per audible slot");
      return undefined;
    }
    const node = data.nodes.get(t.id);
    if (!node) return undefined;

    if (payload.kind === "formations") {
      if (t.zone !== "tree-formation") return undefined;
      return { ok: true, place: halfOf(t), axis: "h" };
    }
    if (payload.kind === "sets") {
      if (t.zone !== "tree-set" && t.zone !== "set-card") return undefined;
      if (node.ref?.f !== payload.refs[0].f) return refuse("Sets move only within their formation");
      return { ok: true, place: halfOf(t, t.zone === "set-card" ? "v" : "h"), axis: t.zone === "set-card" ? "v" : "h" };
    }
    if (payload.kind === "plays") {
      const r = payload.refs[0];
      const sameSet = (n: BookNode) => n.ref?.f === r.f && n.ref?.s === r.s;
      if (t.zone === "tree-play" || t.zone === "card") {
        if (!sameSet(node)) return refuse("A play belongs to its set — copy and paste it instead");
        const axis = t.zone === "card" ? "v" : "h";
        return { ok: true, place: halfOf(t, axis), axis };
      }
      if (t.zone === "tree-set") return sameSet(node) ? undefined : refuse("A play belongs to its set — copy and paste it instead");
      return undefined;
    }
    // library plays from the drawer
    const keys = payload.keys ?? [];
    const setOf = (n: BookNode) => n.rs?.set;
    if (t.zone === "tree-set" || t.zone === "set-grid" || t.zone === "tree-play" || t.zone === "card") {
      const set = setOf(node);
      if (!set) return refuse("This set doesn't resolve");
      const fits = keys.filter((k) => data.catalog.get(k)?.set === set.asset).length;
      if (!fits) return refuse(`Not plays of ${set.name}`);
      if (t.zone === "tree-play" || t.zone === "card") {
        const axis = t.zone === "card" ? "v" : "h";
        return { ok: true, place: halfOf(t, axis), axis };
      }
      return { ok: true, place: "into" };
    }
    if (t.zone === "tree-formation") return refuse("Drop on a set");
    return undefined;
  };

  const drop = (payload: DragPayload, t: DropTargetInfo, c: DropCheck) => {
    const data = get();
    if (t.zone === "audible") {
      const slot = Number(t.id.split("|")[1]) as 1 | 2 | 3 | 4;
      setAudibleAt(data, payload.refs[0], slot);
      return;
    }
    const node = data.nodes.get(t.id);
    if (!node?.ref) return;
    if (payload.kind === "library") {
      const r = node.ref;
      if (r.s === undefined) return;
      const at = r.p === undefined ? undefined : c.place === "before" ? r.p : r.p + 1;
      addPlays(data, payload.keys ?? [], { f: r.f, s: r.s, at });
      return;
    }
    if (c.place === "into") return;
    moveEntries(data, payload.refs, node.ref, c.place);
  };

  const refused = (_payload: DragPayload, c: DropCheck) => {
    if (c.reason) toast.warning("Can't drop there", { detail: c.reason, duration: 3500 });
  };

  return { check, drop, refused };
}
