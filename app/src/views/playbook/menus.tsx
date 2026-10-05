// Options menu for builder nodes (right-click on a tree row or card, or its "⋯" button).
import { clipboardStore } from "../../model/clipboard";
import { AUDIBLE_CATEGORY, AUDIBLE_SLOTS } from "../../model/audibles";
import type { AudibleSlot } from "../../model/types";
import { navigate } from "../../state/router";
import type { MenuItem } from "../../ui";
import type { BookNode, BuilderData } from "./context";
import {
  clearWeights,
  convertTemplate,
  copySelection,
  copyWeights,
  duplicateSelection,
  nudgeSelection,
  openInLibrary,
  pasteAtSelection,
  pasteWeights,
  removeSelection,
  selectedRefs,
  setAudibleAt,
} from "./ops";
import { BOOK_ID, useBuilderUi } from "./store";

export function nodeMenu(data: BuilderData, node: BookNode, opts: { expanded?: boolean } = {}): MenuItem[] {
  const ui = useBuilderUi.getState();
  const clip = clipboardStore.getState();
  const editable = node.level === "formation" || node.level === "set" || node.level === "play";
  const multi = ui.selected.length > 1 ? ` (${ui.selected.length})` : "";
  const items: MenuItem[] = [];

  if (node.level === "set" && node.rs)
    items.push(
      {
        label: "Add Plays to This Set…",
        icon: "plus",
        onSelect: () => {
          useBuilderUi.getState().select(node.id);
          useBuilderUi.getState().setDrawer(true);
        },
      },
      { kind: "separator" },
    );

  items.push(
    { label: `Copy${multi}`, icon: "copy", shortcut: "mod+c", onSelect: () => copySelection(data) },
    {
      label: clip.items[0] ? `Paste ${clip.items[0].label}` : "Paste",
      icon: "paste",
      shortcut: "mod+v",
      disabled: !clip.items[0] || node.level === "tset" || node.level === "tplay",
      onSelect: () => pasteAtSelection(data),
    },
  );
  if (editable) {
    items.push(
      { label: `Duplicate${multi}`, icon: "duplicate", shortcut: "mod+d", onSelect: () => duplicateSelection(data) },
      { label: "Move Up", icon: "chevronUp", onSelect: () => nudgeSelection(data, -1) },
      { label: "Move Down", icon: "chevronDown", onSelect: () => nudgeSelection(data, 1) },
      {
        label: node.level === "play" ? `Remove From Playbook${multi}` : `Remove${multi}…`,
        icon: "trash",
        shortcut: "Delete",
        danger: true,
        hint: node.level === "play" ? undefined : "asks first",
        onSelect: () => void removeSelection(data),
      },
    );
  }

  if (node.level === "formation" && node.rf) {
    items.push({ kind: "separator" });
    if (node.rf.template)
      items.push({
        label: "Convert to Editable Sets",
        icon: "unlock",
        hint: "copies the template's sets and plays in",
        disabled: !node.tf,
        onSelect: () => void convertTemplate(data, node.ref!.f),
      });
    else if (node.rf.sets.length)
      items.push({
        label: "Select All Sets",
        icon: "list",
        onSelect: () => {
          const fid = data.ids.formations[node.ref!.f];
          if (fid) useBuilderUi.getState().selectMany(fid.sets.map((x) => x.id));
        },
      });
    items.push({ label: opts.expanded ? "Collapse" : "Expand", icon: opts.expanded ? "chevronUp" : "chevronDown", onSelect: () => useBuilderUi.getState().expand(node.id, !opts.expanded) });
  }

  if (node.level === "set" && node.rs) {
    items.push(
      { kind: "separator" },
      {
        label: "Select All Plays",
        icon: "list",
        disabled: !node.rs.plays.length,
        onSelect: () => {
          const r = node.ref!;
          const sid = data.ids.formations[r.f]?.sets[r.s!];
          if (sid?.plays.length) useBuilderUi.getState().selectMany(sid.plays);
        },
      },
      { label: opts.expanded ? "Collapse" : "Expand", icon: opts.expanded ? "chevronUp" : "chevronDown", onSelect: () => useBuilderUi.getState().expand(node.id, !opts.expanded) },
    );
  }

  if (node.level === "play" && node.rp) {
    const r = node.ref!;
    const play = node.rp.play;
    const cur = node.rp.entry.audible;
    items.push(
      { kind: "separator" },
      {
        label: "Audible",
        icon: "playcall",
        disabled: !!multi,
        submenu: [
          { label: "None", checked: cur === undefined, onSelect: () => setAudibleAt(data, r, undefined) },
          ...AUDIBLE_SLOTS.map((slot: AudibleSlot) => ({
            label: `${slot} · ${AUDIBLE_CATEGORY[slot]}`,
            checked: cur === slot,
            onSelect: () => setAudibleAt(data, r, slot),
          })),
        ],
      },
      { label: "Copy CPU Weights", icon: "copy", disabled: !!multi, onSelect: () => copyWeights(data, node) },
      {
        label: `Paste CPU Weights${multi}`,
        icon: "paste",
        disabled: !clip.weights,
        hint: clip.weights ? `from ${clip.weights.from}` : undefined,
        onSelect: () => pasteWeights(data, selectedRefs(data)),
      },
      { label: `Clear CPU Weights${multi}`, icon: "close", onSelect: () => clearWeights(data, selectedRefs(data)) },
    );
    if (play) {
      items.push({ kind: "separator" }, { label: "Open in Library", icon: "external", onSelect: () => openInLibrary(play.key) });
      if (play.source === "custom" && !play.clone && play.file !== undefined && play.index !== undefined)
        items.push({ label: "Edit in Designer", icon: "route", onSelect: () => navigate(`#/designer/${encodeURIComponent(play.file!)}/${play.index}`) });
      const setHref = play.clone ? data.custom.editHref(play.set) : undefined;
      if (setHref) items.push({ label: "Edit Its Custom Set", icon: "field", onSelect: () => navigate(setHref) });
    }
  }

  if ((node.level === "tset" || node.level === "tplay") && node.rf) {
    items.push({ kind: "separator" }, { label: "Convert Section to Editable Sets", icon: "unlock", disabled: !node.tf, onSelect: () => void convertTemplate(data, node.ref!.f) });
    if (node.tp) items.push({ label: "Open in Library", icon: "external", onSelect: () => openInLibrary(node.tp!.play.asset) });
  }

  if (node.id === BOOK_ID) {
    items.push(
      { kind: "separator" },
      {
        label: "Expand All",
        icon: "chevronDown",
        onSelect: () => {
          const ui2 = useBuilderUi.getState();
          const exp = { ...ui2.expanded };
          data.ids.formations.forEach((f) => {
            exp[f.id] = true;
            f.sets.forEach((x) => (exp[x.id] = true));
          });
          useBuilderUi.setState({ expanded: exp });
        },
      },
      {
        label: "Collapse All",
        icon: "chevronUp",
        onSelect: () => {
          const exp: Record<string, boolean> = {};
          data.ids.formations.forEach((f) => (exp[f.id] = false));
          useBuilderUi.setState({ expanded: exp });
        },
      },
      { label: "Preview in Game", icon: "playcall", onSelect: () => navigate(`#/playcall/${encodeURIComponent(data.path)}`) },
    );
  }
  return items;
}
