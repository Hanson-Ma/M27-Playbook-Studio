// Set inspector → "Packages": the set's personnel packages (the in-game Packages menu at the play call), in menu order.
// Reorder with the arrows, rename / change who lines up in each slot in the editor, add or remove packages. The first
// edit copies the starting set's list into the custom set (CustomSetSpec.packages); "Use Starting Set's" drops it again.
import { useMemo, useState } from "react";
import type { LibraryIndex } from "../../model/library";
import { isOffenseSet, movePackage, newPackage, packageChanges, packagePositionOptions, packageSlots, packagesOf, uniquePackageName } from "../../model/packages";
import { playerFullName } from "../../model/positions";
import type { AlignmentPos, CustomSetSpec, SetDef, SetPackage } from "../../model/types";
import { Button, FormRow, IconButton, Modal, Select, TextInput, confirmDialog } from "../../ui";
import s from "./Packages.module.css";

export interface PackagesProps {
  lib: LibraryIndex;
  base: SetDef;
  spec: CustomSetSpec;
  /** The custom set's Normal alignment (who the slots are). */
  normal: AlignmentPos[];
  update(fn: (d: CustomSetSpec) => void, label: string): void;
}

const DEPTHS = [1, 2, 3, 4].map((d) => ({ value: String(d), label: ["Starter", "2nd", "3rd", "4th"][d - 1] }));

export function Packages({ lib, base, spec, normal, update }: PackagesProps) {
  const list = packagesOf(base, spec);
  const own = Array.isArray(spec.packages);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const write = (next: SetPackage[], label: string) => update((d) => void (d.packages = next), label);

  const remove = async (i: number) => {
    const ok = await confirmDialog({ title: `Remove "${list[i].name}"?`, body: "It's taken out of this set's Packages menu.", confirmLabel: "Remove", danger: true });
    if (ok) write(list.filter((_, k) => k !== i), "Remove package");
  };

  return (
    <div className={s.wrap}>
      {list.length ? (
        <ol className={s.list}>
          {list.map((pk, i) => {
            const changes = packageChanges(pk, normal);
            return (
              <li key={`${pk.name}-${i}`} className={s.row}>
                <span className={s.num}>{i + 1}</span>
                <button type="button" className={s.main} onClick={() => setEditing(i)} title="Edit this package">
                  <span className={s.name}>{pk.name}</span>
                  <span className={s.changes}>{changes.length ? changes.join(" · ") : "Same players as the set"}</span>
                </button>
                <IconButton icon="chevronUp" size="sm" title="Move up" disabled={i === 0} onClick={() => write(movePackage(list, i, -1), "Move package")} />
                <IconButton icon="chevronDown" size="sm" title="Move down" disabled={i === list.length - 1} onClick={() => write(movePackage(list, i, 1), "Move package")} />
                <IconButton icon="trash" size="sm" title="Remove this package" onClick={() => void remove(i)} />
              </li>
            );
          })}
        </ol>
      ) : (
        <div className={s.muted}>No packages: the set always plays its starters.</div>
      )}
      <div className={s.actions}>
        <Button size="sm" icon="plus" onClick={() => setEditing("new")}>
          Add Package
        </Button>
        {own && (
          <Button size="sm" variant="ghost" icon="refresh" onClick={() => update((d) => void delete d.packages, "Reset packages")} title="Go back to the starting set's packages">
            Use Starting Set's
          </Button>
        )}
      </div>
      <p className={s.note}>The order here is the order of the in-game Packages menu.</p>
      {editing !== null && (
        <PackageEditor
          lib={lib}
          normal={normal}
          initial={editing === "new" ? newPackage(normal, uniquePackageName(list)) : list[editing]}
          isNew={editing === "new"}
          taken={list.filter((_, k) => k !== editing).map((p) => p.name)}
          onClose={() => setEditing(null)}
          onSave={(pk) => {
            write(editing === "new" ? [...list, pk] : list.map((p, k) => (k === editing ? pk : p)), editing === "new" ? "Add package" : "Edit package");
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function PackageEditor(p: { lib: LibraryIndex; normal: AlignmentPos[]; initial: SetPackage; isNew: boolean; taken: string[]; onClose(): void; onSave(pk: SetPackage): void }) {
  const [name, setName] = useState(p.initial.name);
  const [slots, setSlots] = useState(() => packageSlots(p.initial, p.normal));
  const offense = isOffenseSet({ movements: { Normal: p.normal } });
  const options = useMemo(() => packagePositionOptions(p.lib, offense), [p.lib, offense]);
  const nameErr = !name.trim() ? "Give the package a name" : p.taken.some((t) => t.trim().toLowerCase() === name.trim().toLowerCase()) ? "Another package has this name" : undefined;
  const set = (slot: number, patch: { pos?: string; depth?: number }) => setSlots((cur) => cur.map((q) => (q.slot === slot ? { ...q, ...patch } : q)));
  return (
    <Modal
      open
      onClose={p.onClose}
      eyebrow="Package"
      title={p.isNew ? "New Package" : `Edit "${p.initial.name}"`}
      width="md"
      onConfirm={() => !nameErr && p.onSave({ name: name.trim(), positions: slots })}
      confirmDisabled={!!nameErr}
      confirmLabel={p.isNew ? "Add Package" : "Save"}
      cancelLabel="Cancel"
    >
      <FormRow label="Name" error={nameErr}>
        <TextInput value={name} onChange={setName} size="sm" invalid={!!nameErr} aria-label="Package name" />
      </FormRow>
      <div className={s.grid}>
        <span className={s.head}>Slot</span>
        <span className={s.head}>Who Lines Up</span>
        <span className={s.head}>Depth</span>
        {slots.map((q) => {
          const a = p.normal[q.slot];
          const changed = !!a && (a.pos !== q.pos || (a.depth || 1) !== q.depth);
          return (
            <div key={q.slot} className={s.gridRow} data-changed={changed || undefined}>
              <span className={s.slot}>{a ? playerFullName(a, p.normal) : `Slot ${q.slot}`}</span>
              <Select size="sm" value={q.pos} options={options} onChange={(v) => set(q.slot, { pos: v })} aria-label={`Position in slot ${q.slot}`} />
              <Select size="sm" value={String(q.depth)} options={DEPTHS} onChange={(v) => set(q.slot, { depth: Number(v) })} aria-label={`Depth in slot ${q.slot}`} />
            </div>
          );
        })}
      </div>
      <p className={s.note}>Depth picks from the depth chart: Starter is the first player at that position, 2nd the backup, and so on.</p>
    </Modal>
  );
}
