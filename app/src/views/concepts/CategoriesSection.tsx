// Category manager: PASS / RUN / OTHER columns with add, inline rename, swatch colors, nesting (drag onto a row or
// "Move under…", never into its own subtree), reordering, moving between groups and delete with tag cleanup.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent } from "react";
import { useActions } from "../../input/actions";
import {
  CATEGORY_GROUPS,
  GROUP_LABEL,
  NAMED_SWATCHES,
  addCategory,
  categoryNameError,
  conceptIndex,
  deleteCategory,
  forgetPlays,
  groupOf,
  indentCategory,
  moveCategory,
  moveCategoryBy,
  nestTargets,
  orphanKeys,
  outdentCategory,
  renameCategory,
  setCategoryColor,
  siblingsOf,
  tagCounts,
  tagUsage,
  type CategoryNode,
} from "../../model/concepts";
import type { CategoryGroup, ConceptCategory, ConceptsDoc } from "../../model/types";
import { useCatalog } from "../../state/library";
import { navigate } from "../../state/router";
import { Button, EmptyState, Icon, Menu, confirmDialog, cx, promptDialog, toast, type MenuItem } from "../../ui";
import { ColorDot, ColorPicker } from "./parts";
import { editConcepts, getConcepts, sectionHash, uiSet } from "./store";
import s from "./CategoriesSection.module.css";

const DRAG_TYPE = "application/x-pbstudio-category";

type DropZone = "before" | "inside" | "after";

interface Cursor {
  group: CategoryGroup;
  id?: string;
  /** Row index when the cursor was set (where it lands if that category disappears). */
  index?: number;
}

// ───────────────────────────── edits ─────────────────────────────

async function addFlow(group: CategoryGroup, parent?: ConceptCategory): Promise<string | undefined> {
  const doc = getConcepts();
  if (!doc) return;
  const name = await promptDialog({
    title: parent ? `New sub-category of ${parent.name}` : `New ${GROUP_LABEL[group]} category`,
    label: "Name",
    placeholder: group === "run" ? "e.g. Split Zone" : group === "pass" ? "e.g. Sail" : "e.g. 3rd Down",
    confirmLabel: "Add",
    validate: (v) => categoryNameError(getConcepts() ?? doc, v),
  });
  if (!name) return;
  let id: string | undefined;
  editConcepts("add-category", (d) => {
    id = addCategory(d, { name, group, parent: parent?.id }).id;
  });
  return id;
}

async function deleteFlow(cat: ConceptCategory) {
  const doc = getConcepts();
  if (!doc) return;
  const ix = conceptIndex(doc);
  const kids = (ix.node(cat.id)?.childCount ?? 0) > 0 ? ix.descendantsOrSelf(cat.id).size - 1 : 0;
  const usage = tagUsage(doc, cat.id);
  const parentName = ix.parentOf(cat.id) ? ix.byId.get(ix.parentOf(cat.id)!)?.name : undefined;
  const ok = await confirmDialog({
    title: `Delete “${cat.name}”?`,
    body: [
      usage.plays ? `Removes the tag from ${usage.plays} play${usage.plays > 1 ? "s" : ""}.` : "No plays carry it.",
      kids ? `Its ${kids} sub-categor${kids > 1 ? "ies move" : "y moves"} up to ${parentName ?? "the top level"}.` : "",
      "Undo with ⌘/Ctrl+Z.",
    ]
      .filter(Boolean)
      .join(" "),
    confirmLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  editConcepts("delete-category", (d) => {
    deleteCategory(d, cat.id);
  });
  toast.success(`Deleted ${cat.name}`, { detail: usage.plays ? `Untagged ${usage.plays} play${usage.plays > 1 ? "s" : ""}` : undefined });
}

const move = (label: string, fn: (d: ConceptsDoc) => boolean) => {
  let ok = false;
  editConcepts(label, (d) => {
    ok = fn(d);
  });
  return ok;
};

// ───────────────────────────── section ─────────────────────────────

export function CategoriesSection({ doc }: { doc: ConceptsDoc }) {
  const ix = conceptIndex(doc);
  const counts = useMemo(() => tagCounts(doc), [doc.tags, doc.categories]);
  const [cursor, setCursorRaw] = useState<Cursor>(() => ({ group: "pass", id: ix.byGroup.pass[0]?.cat.id, index: 0 }));
  const setCursor = (c: Cursor) => {
    const i = c.id ? conceptIndex(getConcepts() ?? doc).byGroup[c.group].findIndex((n) => n.cat.id === c.id) : -1;
    setCursorRaw({ ...c, index: i >= 0 ? i : c.index });
  };
  const [editing, setEditing] = useState<string>();
  const [menu, setMenu] = useState<{ id: string; el: HTMLElement } | null>(null);
  const [picker, setPicker] = useState<{ id: string; el: HTMLElement } | null>(null);
  const [drag, setDrag] = useState<string>();
  const [drop, setDrop] = useState<{ id: string; zone: DropZone } | { group: CategoryGroup; zone: "end" } | null>(null);
  const rowEls = useRef(new Map<string, HTMLElement>());

  // Keep the cursor on a real row (after deletes / moves between groups).
  const curNode = cursor.id ? ix.node(cursor.id) : undefined;
  const fallback = ix.byGroup[cursor.group];
  const cur: Cursor = curNode
    ? { group: groupOf(curNode.cat), id: curNode.cat.id }
    : { group: cursor.group, id: fallback[Math.max(0, Math.min(fallback.length - 1, cursor.index ?? 0))]?.cat.id };
  useEffect(() => {
    if (cur.id) rowEls.current.get(cur.id)?.scrollIntoView({ block: "nearest" });
  }, [cur.id]);

  const curCat = cur.id ? ix.byId.get(cur.id) : undefined;

  const add = async (group: CategoryGroup, parent?: ConceptCategory) => {
    const id = await addFlow(group, parent);
    if (id) setCursor({ group, id });
  };
  // Universal keys only: Delete / Backspace removes the selected category (asks first).
  useActions("concepts.categories", [
    { id: "del", label: "Delete", keys: ["Delete", "Backspace"], enabled: !!curCat && !editing, run: () => curCat && void deleteFlow(curCat) },
  ]);

  const menuItems = (cat: ConceptCategory): MenuItem[] => {
    const d = getConcepts() ?? doc;
    const i2 = conceptIndex(d);
    const node = i2.node(cat.id);
    const sib = siblingsOf(d, cat.id);
    const si = sib.findIndex((c) => c.id === cat.id);
    const targets = nestTargets(d, cat.id);
    const nestItems: MenuItem[] = [
      { id: "top", label: "Top level", icon: "chevronLeft", disabled: !node?.parent, onSelect: () => move("nest", (x) => moveCategory(x, cat.id, { group: groupOf(cat), parent: null })) },
      { kind: "separator" },
    ];
    for (const g of CATEGORY_GROUPS) {
      const inGroup = targets.filter((n) => groupOf(n.cat) === g);
      if (!inGroup.length) continue;
      nestItems.push({ kind: "heading", label: GROUP_LABEL[g] });
      for (const n of inGroup)
        nestItems.push({
          id: `under-${n.cat.id}`,
          label: <span style={{ paddingLeft: n.depth * 12 }}>{n.cat.name}</span>,
          icon: <ColorDot color={n.cat.color} />,
          checked: node?.parent === n.cat.id,
          onSelect: () => move("nest", (x) => moveCategory(x, cat.id, { group: groupOf(n.cat), parent: n.cat.id })),
        });
    }
    return [
      { kind: "heading", label: cat.name },
      { id: "rename", label: "Rename", icon: "tag", onSelect: () => setEditing(cat.id) },
      {
        id: "color",
        label: "Color",
        icon: <ColorDot color={cat.color} />,
        submenu: [
          ...NAMED_SWATCHES.map(
            (sw): MenuItem => ({
              id: sw.color,
              label: sw.name,
              icon: <ColorDot color={sw.color} />,
              checked: sw.color.toLowerCase() === String(cat.color).toLowerCase(),
              onSelect: () => editConcepts("color", (x) => void setCategoryColor(x, cat.id, sw.color)),
            }),
          ),
          { kind: "separator" },
          {
            id: "custom",
            label: "More colors…",
            icon: "grid",
            onSelect: () => {
              const el = rowEls.current.get(cat.id)?.querySelector<HTMLElement>("[data-swatch]");
              if (el) setPicker({ id: cat.id, el });
            },
          },
        ],
      },
      { id: "sub", label: "Add sub-category", icon: "plus", onSelect: () => void add(groupOf(cat), cat) },
      { kind: "separator" },
      { id: "up", label: "Move up", icon: "chevronUp", disabled: si <= 0, onSelect: () => move("reorder", (x) => moveCategoryBy(x, cat.id, -1)) },
      { id: "down", label: "Move down", icon: "chevronDown", disabled: si < 0 || si >= sib.length - 1, onSelect: () => move("reorder", (x) => moveCategoryBy(x, cat.id, 1)) },
      { id: "indent", label: si > 0 ? `Nest under ${sib[si - 1].name}` : "Nest under previous", icon: "chevronRight", disabled: si <= 0, onSelect: () => move("nest", (x) => indentCategory(x, cat.id)) },
      { id: "outdent", label: "Up a level", icon: "chevronLeft", disabled: !node?.parent, onSelect: () => move("nest", (x) => outdentCategory(x, cat.id)) },
      { id: "under", label: "Move under…", icon: "tree", submenu: nestItems },
      {
        id: "group",
        label: "Move to group",
        icon: "list",
        submenu: CATEGORY_GROUPS.map((g) => ({
          id: g,
          label: GROUP_LABEL[g],
          checked: groupOf(cat) === g && !node?.parent,
          onSelect: () => {
            move("group", (x) => moveCategory(x, cat.id, { group: g, parent: null }));
            setCursor({ group: g, id: cat.id });
          },
        })),
      },
      { kind: "separator" },
      {
        id: "show",
        label: "Show tagged plays",
        icon: "filter",
        onSelect: () => {
          uiSet({ scope: "tagged", filter: [cat.id], untagged: false, suggested: false, checked: [] });
          navigate(sectionHash("tag"), { replace: true });
        },
      },
      { id: "delete", label: "Delete…", icon: "trash", shortcut: "Delete", danger: true, onSelect: () => void deleteFlow(cat) },
    ];
  };

  // ── drag & drop ──
  const dragged = drag ? ix.descendantsOrSelf(drag) : undefined;
  const onRowDragOver = (e: DragEvent<HTMLElement>, n: CategoryNode) => {
    if (!drag) return;
    // Rows own their drop; the category's own subtree is never a target (no preventDefault = "not allowed").
    e.stopPropagation();
    if (dragged?.has(n.cat.id)) {
      setDrop(null);
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    const zone: DropZone = y < 0.28 ? "before" : y > 0.72 ? "after" : "inside";
    setDrop((d) => (d && "id" in d && d.id === n.cat.id && d.zone === zone ? d : { id: n.cat.id, zone }));
  };
  const onRowDrop = (e: DragEvent<HTMLElement>, n: CategoryNode) => {
    e.preventDefault();
    e.stopPropagation();
    const id = drag;
    if (dragged?.has(n.cat.id)) return endDrag();
    const zone = drop && "id" in drop && drop.id === n.cat.id ? drop.zone : "inside";
    endDrag();
    if (!id || id === n.cat.id) return;
    const d = getConcepts();
    if (!d) return;
    const parent = conceptIndex(d).parentOf(n.cat.id) ?? null;
    let ok = false;
    const g = groupOf(n.cat);
    if (zone === "inside") ok = move("nest", (x) => moveCategory(x, id, { group: g, parent: n.cat.id }));
    else if (zone === "before") ok = move("reorder", (x) => moveCategory(x, id, { group: g, parent, before: n.cat.id }));
    else {
      const sib = siblingsOf(d, n.cat.id).filter((c) => c.id !== id);
      const next = sib[sib.findIndex((c) => c.id === n.cat.id) + 1];
      ok = move("reorder", (x) => moveCategory(x, id, { group: g, parent, before: next?.id ?? null }));
    }
    if (ok) setCursor({ group: g, id });
  };
  const onColumnDragOver = (e: DragEvent<HTMLElement>, g: CategoryGroup) => {
    if (!drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDrop((d) => (d && "group" in d && d.group === g ? d : { group: g, zone: "end" }));
  };
  const onColumnDrop = (e: DragEvent<HTMLElement>, g: CategoryGroup) => {
    e.preventDefault();
    const id = drag;
    endDrag();
    if (id && move("group", (x) => moveCategory(x, id, { group: g, parent: null }))) setCursor({ group: g, id });
  };
  const endDrag = () => {
    setDrag(undefined);
    setDrop(null);
  };

  const catalog = useCatalog();
  const orphans = useMemo(() => (catalog ? orphanKeys(doc, (k) => !!catalog.get(k)) : []), [catalog, doc.tags, doc.notes, doc]);

  return (
    <div className={s.page}>
      <div className={s.intro}>
        Drag a category onto another to nest it (top/bottom edge to reorder), or open its <b>▾</b> menu (or right-click it) to rename, recolor, nest or
        delete it. Double-click a name to rename. Counts are tagged plays across the whole library, sub-categories included.
      </div>
      <div className={s.columns}>
        {CATEGORY_GROUPS.map((g) => {
          const nodes = ix.byGroup[g];
          const endHint = drop && "group" in drop && drop.group === g;
          return (
            <section
              key={g}
              className={cx(s.column, cur.group === g && s.columnActive, endHint && s.columnDrop)}
              onDragOver={(e) => onColumnDragOver(e, g)}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null);
              }}
              onDrop={(e) => onColumnDrop(e, g)}
            >
              <header className={s.colHead}>
                <div className={s.colTitle}>
                  {GROUP_LABEL[g]}
                  <span>{nodes.length}</span>
                </div>
                <Button size="sm" variant="ghost" icon="plus" onClick={() => void add(g)}>
                  Add
                </Button>
              </header>
              <div className={s.rows}>
                {nodes.length === 0 && <EmptyState compact icon="tag" title="No categories" body={drag ? "Drop here to move it into this group." : "Add one, or drag one here."} />}
                {nodes.map((n) => {
                  const on = cur.id === n.cat.id;
                  const dz = drop && "id" in drop && drop.id === n.cat.id ? drop.zone : undefined;
                  const count = counts.get(n.cat.id) ?? 0;
                  return (
                    <div
                      key={n.cat.id}
                      ref={(el) => {
                        if (el) rowEls.current.set(n.cat.id, el);
                        else rowEls.current.delete(n.cat.id);
                      }}
                      className={cx(s.row, on && s.rowCursor, drag === n.cat.id && s.rowDragging, dz && s[`drop_${dz}`])}
                      style={{ "--depth": n.depth, "--c": n.cat.color } as CSSProperties}
                      draggable={editing !== n.cat.id}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DRAG_TYPE, n.cat.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDrag(n.cat.id);
                        setCursor({ group: g, id: n.cat.id });
                      }}
                      onDragEnd={endDrag}
                      onDragOver={(e) => onRowDragOver(e, n)}
                      onDrop={(e) => onRowDrop(e, n)}
                      onClick={() => setCursor({ group: g, id: n.cat.id })}
                      onDoubleClick={() => setEditing(n.cat.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setCursor({ group: g, id: n.cat.id });
                        setMenu({ id: n.cat.id, el: e.currentTarget });
                      }}
                    >
                      {n.depth > 0 && <span className={s.guide} aria-hidden />}
                      <Icon name="drag" size={14} className={s.handle} />
                      <button
                        type="button"
                        data-swatch
                        className={s.swatch}
                        title="Color"
                        aria-label={`Color of ${n.cat.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPicker({ id: n.cat.id, el: e.currentTarget });
                        }}
                      />
                      {editing === n.cat.id ? (
                        <RenameInput cat={n.cat} onDone={() => setEditing(undefined)} />
                      ) : (
                        <span className={s.name} title={n.childCount ? `${n.cat.name} · ${n.childCount} sub-categor${n.childCount > 1 ? "ies" : "y"}` : n.cat.name}>
                          {n.cat.name}
                        </span>
                      )}
                      <span className={cx(s.count, !count && s.countZero)} title={`${count} tagged play${count === 1 ? "" : "s"}`}>
                        {count}
                      </span>
                      <button
                        type="button"
                        className={s.more}
                        title="Edit"
                        aria-label={`Edit ${n.cat.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setCursor({ group: g, id: n.cat.id });
                          setMenu({ id: n.cat.id, el: e.currentTarget.parentElement as HTMLElement });
                        }}
                      >
                        <Icon name="chevronDown" size={14} />
                      </button>
                    </div>
                  );
                })}
                {endHint && nodes.length > 0 && <div className={s.endDrop}>Move to the end of {GROUP_LABEL[g]}</div>}
              </div>
            </section>
          );
        })}
      </div>
      {orphans.length > 0 && (
        <div className={s.orphans}>
          <Icon name="warning" size={16} />
          <span>
            {orphans.length} tagged or noted play{orphans.length > 1 ? "s" : ""} no longer resolve{orphans.length > 1 ? "" : "s"} (a custom play renamed or deleted?).
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              const ok = await confirmDialog({
                title: "Forget missing plays?",
                body: `Removes tags, notes and dismissals for ${orphans.length} play key${orphans.length > 1 ? "s" : ""}:\n${orphans.slice(0, 5).join("\n")}${orphans.length > 5 ? "\n…" : ""}`,
                confirmLabel: "Forget",
                danger: true,
              });
              if (ok) editConcepts("forget", (d) => forgetPlays(d, orphans));
            }}
          >
            Clean up
          </Button>
        </div>
      )}
      {menu && ix.byId.get(menu.id) && <Menu items={menuItems(ix.byId.get(menu.id)!)} anchor={menu.el} placement="bottom-end" minWidth={230} onClose={() => setMenu(null)} />}
      {picker && ix.byId.get(picker.id) && (
        <ColorPicker
          anchor={picker.el}
          value={String(ix.byId.get(picker.id)!.color)}
          onPick={(c) => editConcepts("color", (x) => void setCategoryColor(x, picker.id, c))}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

function RenameInput({ cat, onDone }: { cat: ConceptCategory; onDone(): void }) {
  const [value, setValue] = useState(String(cat.name));
  const doc = getConcepts();
  const error = doc ? categoryNameError(doc, value, cat.id) : undefined;
  const done = useRef(false);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    if (!error && value.trim() !== cat.name) editConcepts("rename", (d) => void renameCategory(d, cat.id, value));
    else if (error && value.trim() !== cat.name) toast.warning("Not renamed", { detail: error });
    onDone();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!error) commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      done.current = true;
      onDone();
    }
    e.stopPropagation();
  };
  return (
    <input
      className={cx(s.rename, error && s.renameBad)}
      value={value}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      onClick={(e) => e.stopPropagation()}
      title={error}
      aria-label={`Rename ${cat.name}`}
      aria-invalid={!!error || undefined}
    />
  );
}
