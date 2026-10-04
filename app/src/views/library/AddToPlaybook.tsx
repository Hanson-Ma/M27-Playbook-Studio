// "Add to playbook…": pick a playbook doc (or create one) and append the play with addPlayToSpec inside a workspace
// update (one undo step). The host is mounted once by the App shell, so openAddToPlaybook(key) works from any view
// (library grid/detail, designer, …).
import { useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { comboLabel } from "../../input/keys";
import { leaf, sanitizeBookName } from "../../model/names";
import { addPlayProblem, addPlayToSpec, locatePlay, type PlayLocation } from "../../model/playbookOps";
import { newPlaybookSpec, playbookPathFor } from "../../model/playbook";
import { bookSide } from "../../model/resolveBook";
import type { PlaybookSpec, PlayKey, ResolvedPlay, Side } from "../../model/types";
import { getCatalog, useCatalog } from "../../state/library";
import { navigate } from "../../state/router";
import { getTemplate, useTemplate } from "../../state/template";
import { useDocsOfKind, useWorkspace, type DocEntry } from "../../state/workspace";
import { Icon, Modal, PlayTypeTag, Tag, cx, promptDialog, toast } from "../../ui";
import { cardSubtitle } from "../../field";
import s from "./AddToPlaybook.module.css";

// ───────────────────────────── open state ─────────────────────────────

const useAddState = create<{ key?: PlayKey }>(() => ({}));

export function openAddToPlaybook(key: PlayKey): void {
  useAddState.setState({ key });
}

// ───────────────────────────── helpers ─────────────────────────────

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function openBookHref(path: string, loc?: PlayLocation): string {
  const q = loc ? `?f=${loc.f}&s=${loc.s}&p=${loc.p}` : "";
  return `#/playbook/${encodeURIComponent(path)}${q}`;
}

/** Add `key` to the playbook doc at `path` (one undo step); toasts the outcome. */
export function addToBook(path: string, key: PlayKey): boolean {
  const catalog = getCatalog();
  const play = catalog?.get(key);
  const doc = useWorkspace.getState().docs[path] as DocEntry<PlaybookSpec> | undefined;
  if (!catalog || !play || !doc || doc.error || !doc.data) {
    toast.error("Couldn't add the play", { detail: doc?.error ?? "Playbook or play not found" });
    return false;
  }
  const bookName = doc.data.name || leaf(path);
  let loc: (PlayLocation & { added: boolean }) | undefined;
  try {
    useWorkspace.getState().update<PlaybookSpec>(
      path,
      (draft) => {
        loc = addPlayToSpec(draft, catalog, key, undefined, { template: getTemplate().contents });
      },
      { label: "Add play from library" },
    );
  } catch (e) {
    toast.error(`Can't add "${play.name}" to ${bookName}`, { detail: errMsg(e) });
    return false;
  }
  if (!loc) return false;
  const where = loc;
  // The view on screen owns the active doc (its ⌘S / undo target): only claim it when nothing is active.
  const ws = useWorkspace.getState();
  if (!ws.activePath) ws.setActive(path);
  const saveHint = useWorkspace.getState().activePath === path ? `${comboLabel("mod+s")} saves` : `${comboLabel("shift+mod+s")} saves all`;
  const spec = useWorkspace.getState().docs[path]?.data as PlaybookSpec;
  const fe = spec.formations[where.f];
  const setName = Array.isArray(fe.sets) ? fe.sets[where.s]?.set : "";
  const detail = `${fe.formation} › ${setName} · play ${where.p + 1}`;
  const action = { label: "Open", run: () => navigate(openBookHref(path, where)) };
  if (where.added) toast.success(`Added "${play.name}" to ${bookName}`, { detail: `${detail} — unsaved (${saveHint})`, action, duration: 6000 });
  else toast.info(`"${play.name}" is already in ${bookName}`, { detail, action });
  return true;
}

/** Lower-cased paths of every doc and listed file (macOS/Windows treat names differing only in case as one file). */
function takenPaths(): Set<string> {
  const st = useWorkspace.getState();
  return new Set([...Object.keys(st.docs), ...st.files.map((f) => f.path)].map((p) => p.toLowerCase()));
}

/** Names of the `side` playbook docs: a second book with one of them would build the same PBOOKOFF-/PBOOKDEF- save. */
function takenBookNames(side: Side): Set<string> {
  const names = new Set<string>();
  for (const d of Object.values(useWorkspace.getState().docs)) {
    if (d.kind !== "playbook" || d.error || !d.data || typeof d.data !== "object") continue;
    const spec = d.data as PlaybookSpec;
    if (typeof spec.name === "string" && spec.name && bookSide(spec) === side) names.add(sanitizeBookName(spec.name));
  }
  return names;
}

/** First free default name for a new `side` playbook: MYBOOK, MYBOOK2, MYBOOK3… (free as a file and as a save name). */
export function defaultBookName(side: Side, base = "MYBOOK"): string {
  const paths = takenPaths();
  const names = takenBookNames(side);
  for (let i = 1; ; i++) {
    const n = i === 1 ? base : `${base}${i}`;
    if (!paths.has(playbookPathFor(n)) && !names.has(n)) return n;
  }
}

// ───────────────────────────── dialog ─────────────────────────────

export function AddToPlaybookHost() {
  const key = useAddState((st) => st.key);
  const catalog = useCatalog();
  const play = key && catalog ? catalog.get(key) : undefined;
  if (!key) return null;
  const close = () => useAddState.setState({ key: undefined });
  if (!play) {
    return (
      <Modal open title="Add to playbook" onClose={close} width="sm">
        <p className={s.note}>This play isn't in the catalog anymore.</p>
      </Modal>
    );
  }
  return <AddDialog key={key} play={play} onClose={close} />;
}

interface BookRow {
  path: string;
  name: string;
  side?: Side;
  doc: DocEntry<PlaybookSpec>;
  disabled?: string;
  existing?: PlayLocation;
  dirty: boolean;
}

const NEW_ROW = "__new__";

function AddDialog({ play, onClose }: { play: ResolvedPlay; onClose(): void }) {
  const catalog = useCatalog()!;
  const docs = useDocsOfKind<PlaybookSpec>("playbook");
  const activePath = useWorkspace((st) => st.activePath);
  const template = useTemplate().contents;

  const rows = useMemo<BookRow[]>(() => {
    return docs.map((doc) => {
      const row: BookRow = { path: doc.path, name: leaf(doc.path), doc, dirty: doc.dirty };
      if (doc.error || !doc.data || typeof doc.data !== "object") return { ...row, disabled: `Failed to load: ${doc.error ?? "invalid file"}` };
      const side = bookSide(doc.data);
      row.side = side;
      row.name = doc.data.name || row.name;
      if (play.side !== "special" && play.side !== side) return { ...row, disabled: `${side === "offense" ? "Offensive" : "Defensive"} playbook` };
      // Same rule as addPlayToSpec: addressable by name for the game-side builder, and its formation isn't a
      // "template" section of this book (convert it to explicit first).
      const problem = addPlayProblem(doc.data, catalog, play.key, { template });
      if (problem) return { ...row, disabled: problem };
      try {
        row.existing = locatePlay(doc.data, catalog, play.key, { template });
      } catch {
        /* malformed book: still allow adding (addPlayToSpec reports) */
      }
      return row;
    });
  }, [docs, catalog, play, template]);

  const playSide: Side = play.side === "defense" ? "defense" : "offense";
  // A new book starts with the default template sections (goal line, special teams), so check against one.
  const newProblem = useMemo(() => {
    const spec = newPlaybookSpec("NEW", playSide);
    const why = addPlayProblem(spec, catalog, play.key, { template });
    const tpl = why && /^Convert /.test(why) ? spec.formations.find((fe) => why.includes(String(fe.formation))) : undefined;
    return tpl ? `New playbooks keep ${tpl.formation} as a "template" section: create the book, convert ${tpl.formation} to explicit, then add the play` : why;
  }, [catalog, play.key, playSide, template]);
  // Arrow keys skip rows that can't take the play.
  const options = [...rows.filter((r) => !r.disabled).map((r) => r.path), ...(newProblem ? [] : [NEW_ROW])];
  const firstEnabled = () => {
    const preferred = rows.find((r) => !r.disabled && r.path === activePath) ?? rows.find((r) => !r.disabled);
    return preferred?.path ?? NEW_ROW;
  };
  const [choice, setChoice] = useState<string>(firstEnabled);
  const chosen = rows.find((r) => r.path === choice);
  const canConfirm = choice === NEW_ROW ? !newProblem : !!chosen && !chosen.disabled;

  const move = (d: 1 | -1) => {
    if (!options.length) return;
    const i = options.indexOf(choice);
    const next = options[i < 0 ? 0 : (i + d + options.length) % options.length];
    if (next) setChoice(next);
  };

  // The name prompt opens on top of this dialog, which stays open underneath: cancelling it returns here.
  const prompting = useRef(false);
  const confirm = async () => {
    if (!canConfirm || prompting.current) return;
    if (choice !== NEW_ROW) {
      if (addToBook(choice, play.key)) onClose();
      return;
    }
    prompting.current = true;
    let name: string | null;
    try {
      name = await promptDialog({
        title: "New playbook",
        label: `Name (A–Z, 0–9 — the save becomes ${playSide === "defense" ? "PBOOKDEF" : "PBOOKOFF"}-<NAME>)`,
        initial: defaultBookName(playSide),
        placeholder: "MYBOOK",
        confirmLabel: "Create & add",
        body: `A new ${playSide} playbook${playSide === "offense" ? " with goal line and special teams kept as template sections" : ""}. It stays unsaved until you save it.`,
        validate: (v) => {
          const n = sanitizeBookName(v);
          if (!n) return "Use letters A–Z and digits 0–9";
          const path = playbookPathFor(n);
          if (takenPaths().has(path.toLowerCase())) return `${path} already exists`;
          if (takenBookNames(playSide).has(n)) return `Another ${playSide} playbook is already named ${n} (both would build the same save)`;
          return undefined;
        },
      });
    } finally {
      prompting.current = false;
    }
    if (!name) return; // cancelled: back to the list
    const n = sanitizeBookName(name);
    const path = playbookPathFor(n);
    try {
      useWorkspace.getState().create<PlaybookSpec>(path, "playbook", newPlaybookSpec(n, playSide));
    } catch (e) {
      toast.error("Couldn't create the playbook", { detail: errMsg(e) });
      return;
    }
    if (addToBook(path, play.key)) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="Add to playbook"
      title={play.name}
      width="md"
      onConfirm={() => void confirm()}
      confirmLabel={choice === NEW_ROW ? "New playbook…" : chosen?.existing ? "Show in book" : "Add"}
      confirmDisabled={!canConfirm}
      scopeId="library.add.modal"
    >
      <div className={s.summary}>
        <PlayTypeTag playType={play.playType} size="sm" />
        <span className={s.subtitle}>{cardSubtitle(play, catalog)}</span>
        {!play.global && <Tag tone="needsMod" size="sm">{play.source === "custom" ? "Custom · mod" : "Needs mod"}</Tag>}
      </div>
      {!play.global && (
        <p className={s.note}>
          {play.source === "custom"
            ? "Custom plays are built into pbstudio.fbmod; the book needs the mod enabled."
            : "Not in the global play sheet: export pulls it into pbstudio.fbmod, so the book needs the mod enabled."}
        </p>
      )}
      <div
        className={s.list}
        role="listbox"
        aria-label="Playbooks"
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
          e.preventDefault();
          move(e.key === "ArrowDown" ? 1 : -1);
        }}
      >
        {rows.length === 0 && <div className={s.emptyRow}>No playbooks in playbooks/ yet.</div>}
        {rows.map((r) => (
          <button
            key={r.path}
            type="button"
            role="option"
            aria-selected={choice === r.path}
            disabled={!!r.disabled}
            className={cx(s.row, choice === r.path && s.on)}
            onClick={() => setChoice(r.path)}
            onDoubleClick={() => {
              setChoice(r.path);
              if (!r.disabled && addToBook(r.path, play.key)) onClose();
            }}
          >
            <span className={s.rowMain}>
              <span className={s.rowName}>
                {r.name}
                {r.dirty && <span className={s.dirty} title="Unsaved changes" />}
              </span>
              <span className={s.rowPath}>{r.path}</span>
            </span>
            <span className={s.rowMeta}>
              {r.disabled ? (
                <span className={s.reason} title={r.disabled}>
                  <Icon name="warning" size={13} /> {r.disabled}
                </span>
              ) : r.existing ? (
                <Tag tone="ok" variant="soft" size="sm">
                  Already in book
                </Tag>
              ) : null}
              {r.side && (
                <Tag tone="neutral" variant="outline" size="sm">
                  {r.side}
                </Tag>
              )}
            </span>
          </button>
        ))}
        <button
          type="button"
          role="option"
          aria-selected={choice === NEW_ROW}
          disabled={!!newProblem}
          className={cx(s.row, s.newRow, choice === NEW_ROW && s.on)}
          onClick={() => setChoice(NEW_ROW)}
        >
          <span className={s.rowMain}>
            <span className={s.rowName}>
              <Icon name="plus" size={15} /> New {playSide} playbook…
            </span>
            <span className={s.rowPath}>playbooks/&lt;name&gt;.json</span>
          </span>
        </button>
      </div>
      {newProblem && (
        <p className={s.problem}>
          <Icon name="warning" size={14} /> {newProblem}
        </p>
      )}
      <p className={s.hint}>Plays land in their formation › set (created when missing, before the template sections). Double-click a playbook to add right away.</p>
    </Modal>
  );
}
