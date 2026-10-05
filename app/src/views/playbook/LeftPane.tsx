// Step 1 — pick a set: the Formation → Set → Play tree, a toolbar for the selection (copy, paste, duplicate, move,
// remove — the same commands as the right-click menu) and the collapsible clipboard.
import { useStore } from "zustand";
import { clipboardStore, type ClipItem } from "../../model/clipboard";
import { Icon, IconButton, cx } from "../../ui";
import { useBuilder, type BookNode } from "./context";
import { clipCount, copySelection, duplicateSelection, labelOf, nudgeSelection, pasteAtSelection, removeSelection } from "./ops";
import { StepHeader } from "./parts";
import { useBuilderUi } from "./store";
import { Tree } from "./Tree";
import s from "./LeftPane.module.css";

export function LeftPane() {
  return (
    <div className={s.pane}>
      <StepHeader step={1} title="Pick a Set" hint="Formations hold sets; sets hold plays" />
      <SelectionBar />
      <Tree />
      <ClipboardPanel />
    </div>
  );
}

const LEVEL_LABEL: Record<string, string> = {
  book: "Selected",
  formation: "Formation",
  set: "Set",
  play: "Play",
  tset: "Template Set",
  tplay: "Template Play",
};

/** What's selected, with visible buttons for every tree command. */
function SelectionBar() {
  const data = useBuilder();
  const cursor = useBuilderUi((st) => st.cursor);
  const count = useBuilderUi((st) => st.selected.length);
  const clipTop = useStore(clipboardStore, (st) => st.items[0]);
  const node: BookNode | undefined = data.nodes.get(cursor);
  const level = node?.level ?? "book";
  const editable = level === "formation" || level === "set" || level === "play";
  const template = level === "tset" || level === "tplay" || (level === "formation" && !!node?.rf?.template);
  const what = !node ? "" : count > 1 ? `${count} ${level}s` : level === "book" ? "Whole Playbook" : labelOf(node);
  // a single formation / set / play is a Madden name (caps); "Whole Playbook" and "3 sets" are chrome
  const whatIsName = !!node && count <= 1 && level !== "book";
  const canPaste = !!clipTop && level !== "tset" && level !== "tplay" && !(template && clipTop.kind !== "formation");
  return (
    <div className={s.selBar} role="toolbar" aria-label="Selection">
      <span className={s.selWhat} title={what}>
        <span className={s.selLevel}>{LEVEL_LABEL[level] ?? level}</span>
        <span className={cx(s.selName, whatIsName && "caps")}>{what}</span>
      </span>
      <IconButton icon="copy" size="sm" title={level === "book" ? "Copy every formation" : "Copy"} onClick={() => copySelection(data)} />
      <IconButton
        icon="paste"
        size="sm"
        title={clipTop ? `Paste ${clipTop.label} here` : "Paste (copy something first)"}
        disabled={!canPaste}
        onClick={() => pasteAtSelection(data)}
      />
      <IconButton icon="duplicate" size="sm" title="Duplicate" disabled={!editable} onClick={() => duplicateSelection(data)} />
      <IconButton icon="chevronUp" size="sm" title="Move up" disabled={!editable} onClick={() => nudgeSelection(data, -1)} />
      <IconButton icon="chevronDown" size="sm" title="Move down" disabled={!editable} onClick={() => nudgeSelection(data, 1)} />
      <IconButton
        icon="trash"
        size="sm"
        title={level === "play" ? "Remove from playbook" : "Remove… (asks first)"}
        disabled={!editable}
        className={s.selRemove}
        onClick={() => void removeSelection(data)}
      />
    </div>
  );
}

function ClipboardPanel() {
  const data = useBuilder();
  const items = useStore(clipboardStore, (st) => st.items);
  const weights = useStore(clipboardStore, (st) => st.weights);
  const open = useBuilderUi((st) => st.clipboardOpen);
  const count = items.length + (weights ? 1 : 0);
  return (
    <section className={cx(s.clip, open && s.clipOpen)}>
      <div className={s.clipHeadRow}>
        <button type="button" className={s.clipHead} onClick={() => useBuilderUi.getState().set({ clipboardOpen: !open })} aria-expanded={open}>
          <Icon name={open ? "chevronDown" : "chevronRight"} size={14} />
          <span className={s.clipTitle}>Clipboard</span>
          <span className={s.clipCount}>{count}</span>
        </button>
        {count > 0 && open && (
          <button type="button" className={s.clipClear} onClick={() => clipboardStore.getState().clear()}>
            Clear
          </button>
        )}
      </div>
      {open && (
        <div className={s.clipBody}>
          {!count && <div className={s.clipEmpty}>Copied formations, sets and plays wait here — paste them into this or another playbook.</div>}
          {weights && (
            <div className={s.clipItem}>
              <Icon name="sparkle" size={14} className={s.clipKind} />
              <div className={s.clipText}>
                <div className={s.clipLabel}>CPU Weights</div>
                <div className={s.clipSub}>
                  {Object.keys(weights.cpu).length} situations · from {weights.from}
                </div>
              </div>
              <IconButton icon="close" title="Forget weights" size="sm" onClick={() => clipboardStore.getState().setWeights(undefined)} />
            </div>
          )}
          {items.map((it) => (
            <ClipRow key={it.id} item={it} onPaste={() => pasteAtSelection(data, it)} />
          ))}
        </div>
      )}
    </section>
  );
}

const KIND_ICON = { formation: "field", set: "grid", plays: "playcall" } as const;

function ClipRow({ item, onPaste }: { item: ClipItem; onPaste(): void }) {
  const fromOther = useBuilder().path !== item.sourcePath;
  return (
    <div className={s.clipItem}>
      <Icon name={KIND_ICON[item.kind]} size={14} className={s.clipKind} />
      <div className={s.clipText}>
        <div className={cx(s.clipLabel, !(item.kind === "plays" && item.entries.length > 1) && "caps")}>{item.label}</div>
        <div className={s.clipSub}>
          {clipCount(item)}
          {fromOther ? ` · ${item.sourcePath.replace(/^playbooks\//, "")}` : item.from ? ` · ${item.from}` : ""}
        </div>
      </div>
      <IconButton icon="paste" title="Paste at the selection" size="sm" onClick={onPaste} />
      <IconButton icon="close" title="Remove from clipboard" size="sm" onClick={() => clipboardStore.getState().remove(item.id)} />
    </div>
  );
}
