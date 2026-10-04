// Raw steps (ADVANCED tab, escape hatch): the raw step chain with a type picker and per-field editors — enum fields are
// SearchSelects over enums.json, numbers NumberFields, booleans Toggles, waypoints a sub-table. The trailing None is
// implicit. Steps inside a kept precan are read-only.
// The type list holds only step types the library's assignments use: the game-side PlayBuilder copies each step
// class's opcode from a library instance, so enum-only types (RunRouteFakeOut, RunRouteTurbo…) can't be built.
// A loaded chain that carries one keeps it and shows an error chip on that step.
import { useMemo, useState } from "react";
import { libraryStepTypes, unbuildableReason } from "../../model/designer";
import type { LibraryIndex } from "../../model/library";
import { LOCO_RUN, LOCO_SHUFFLE } from "../../model/routes";
import { stepSummary, stripNone } from "../../model/steps";
import type { Step } from "../../model/types";
import { Button, IconButton, NumberField, SearchSelect, Segmented, Tag, TextArea, TextInput, Toggle, cx } from "../../ui";
import { useDesigner } from "./shared";
import s from "./Inspector.module.css";

interface StepCatalog {
  types: string[];
  templates: Map<string, Step>;
}

const catalogCache = new WeakMap<LibraryIndex, StepCatalog>();

/** Every step type the library's assignments use (= what the builder can author), with the first instance as a template. */
function stepCatalog(lib: LibraryIndex): StepCatalog {
  let c = catalogCache.get(lib);
  if (c) return c;
  const templates = new Map<string, Step>();
  for (const a of Object.values(lib.data.assignments)) for (const st of a.steps) if (!templates.has(st.type)) templates.set(st.type, st);
  const types = new Set<string>(libraryStepTypes(lib));
  types.delete("None");
  c = { types: [...types].sort(), templates };
  catalogCache.set(lib, c);
  return c;
}

/** A fresh step of a type: the library's first instance (authored-style for legs), else just the type. */
function templateFor(cat: StepCatalog, type: string): Step {
  if (["RunRoute", "MoveDirection", "ReceiveHandoff", "RecievePitch"].includes(type)) return { type, distance: 5, direction: 90, speed: 100 };
  const t = cat.templates.get(type);
  return t ? (JSON.parse(JSON.stringify(t)) as Step) : { type };
}

const LOCO_OPTIONS = [
  { value: LOCO_RUN, label: "Run" },
  { value: LOCO_SHUFFLE, label: "Shuffle" },
];

const NUM_STEP: Record<string, number> = { distance: 0.5, direction: 5, speed: 5, time: 0.05, offsetX: 0.5, offsetY: 0.5, startDelay: 0.125, endDelay: 0.125 };

export function StepsTab({ slot, lock, bare }: { slot: number; lock: number; bare?: boolean }) {
  const d = useDesigner();
  const { state, lib } = d;
  const steps = useMemo(() => stripNone(state.slots[slot].steps), [state, slot]);
  const cat = stepCatalog(lib);
  const [adding, setAdding] = useState("RunRoute");
  const typeOptions = useMemo(() => cat.types, [cat]);

  const commit = (next: Step[], label: string, coalesceMs?: number) => d.commitSlot(slot, next, label, undefined, coalesceMs);
  const patch = (i: number, field: string, v: unknown) => {
    const next = steps.slice();
    next[i] = { ...steps[i], [field]: v };
    commit(next, "Edit step", 700);
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < lock || j >= steps.length) return;
    const next = steps.slice();
    [next[i], next[j]] = [next[j], next[i]];
    commit(next, "Reorder steps");
  };

  return (
    <section className={bare ? undefined : s.section}>
      {!bare && (
        <div className={s.sectionHead}>
          <span className={s.sectionTitle}>Raw steps</span>
          <span className={s.muted}>{steps.length} + None</span>
        </div>
      )}
      <div className={s.stepList}>
        {steps.map((st, i) => {
          const locked = i < lock;
          const fields = Object.keys(st).filter((k) => k !== "type");
          const unbuildable = !cat.templates.has(st.type);
          return (
            <div key={i} className={cx(s.stepCard, locked && s.legLocked, unbuildable && s.stepBad)}>
              {unbuildable && (
                <div className={s.stepError} role="alert">
                  <Tag tone="danger" size="sm" icon="warning" title={unbuildableReason(st.type)}>
                    Can't build
                  </Tag>
                  <span>{unbuildableReason(st.type)}</span>
                </div>
              )}
              <div className={s.stepHead}>
                <span className={s.legNo}>{i + 1}</span>
                <SearchSelect
                  size="sm"
                  value={st.type}
                  options={typeOptions}
                  disabled={locked}
                  onChange={(t) => {
                    if (t === st.type) return;
                    const next = steps.slice();
                    next[i] = templateFor(cat, t);
                    commit(next, "Change step type");
                  }}
                  width={150}
                />
                <span className={s.stepSum}>{stepSummary(st)}</span>
                <IconButton icon="chevronUp" size="sm" title="Move up" disabled={locked || i - 1 < lock} onClick={() => move(i, -1)} />
                <IconButton icon="chevronDown" size="sm" title="Move down" disabled={locked || i + 1 >= steps.length} onClick={() => move(i, 1)} />
                <IconButton icon="trash" size="sm" title="Delete step" disabled={locked} onClick={() => commit(steps.filter((_, j) => j !== i), "Delete step")} />
              </div>
              {fields.length > 0 && (
                <div className={s.stepFields}>
                  {fields.map((f) => (
                    <FieldEditor key={f} type={st.type} field={f} value={st[f]} disabled={locked} onChange={(v) => patch(i, f, v)} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className={s.addStep}>
        <SearchSelect size="sm" value={adding} options={typeOptions} onChange={setAdding} width={180} />
        <Button size="sm" icon="plus" onClick={() => commit([...steps, templateFor(cat, adding)], "Add step")}>
          Add step
        </Button>
      </div>
    </section>
  );
}

function FieldEditor({ type, field, value, disabled, onChange }: { type: string; field: string; value: unknown; disabled: boolean; onChange(v: unknown): void }) {
  const { lib } = useDesigner();
  const enumName = lib.enumForField(type, field);
  const label = <span className={s.fieldLabel}>{field}</span>;
  if (enumName && typeof value === "string") {
    return (
      <div className={s.fieldRow}>
        {label}
        <SearchSelect size="sm" value={value} options={lib.enumValues(enumName)} disabled={disabled} onChange={onChange} allowCustom width="100%" />
      </div>
    );
  }
  if (typeof value === "number") {
    return (
      <div className={s.fieldRow}>
        {label}
        <NumberField size="sm" value={value} step={NUM_STEP[field] ?? 1} precision={3} disabled={disabled} onChange={onChange} />
      </div>
    );
  }
  if (typeof value === "boolean") {
    return (
      <div className={s.fieldRow}>
        {label}
        <Toggle size="sm" checked={value} disabled={disabled} onChange={onChange} />
      </div>
    );
  }
  if (typeof value === "string") {
    return (
      <div className={s.fieldRow}>
        {label}
        <TextInput size="sm" value={value} disabled={disabled} onChange={onChange} mono />
      </div>
    );
  }
  if (field === "waypoints" && Array.isArray(value)) {
    return (
      <div className={s.fieldRowWide}>
        {label}
        <div className={s.subTable}>
          {(value as { position?: { x: number; y: number }; speed?: number; locoStyle?: string }[]).map((w, j) => (
            <div key={j} className={s.subRow}>
              <span className={s.legNo}>{j + 1}</span>
              <NumberField size="sm" label="X" value={w.position?.x} step={0.5} precision={2} disabled={disabled} onChange={(x) => onChange(value.map((o, k) => (k === j ? { ...o, position: { ...o.position, x } } : o)))} />
              <NumberField size="sm" label="Y" value={w.position?.y} step={0.5} precision={2} disabled={disabled} onChange={(y) => onChange(value.map((o, k) => (k === j ? { ...o, position: { ...o.position, y } } : o)))} />
              <NumberField size="sm" label="SPD" value={w.speed} step={5} disabled={disabled} onChange={(sp) => onChange(value.map((o, k) => (k === j ? { ...o, speed: sp } : o)))} />
              <Segmented
                size="sm"
                options={disabled ? LOCO_OPTIONS.map((o) => ({ ...o, disabled: true })) : LOCO_OPTIONS}
                value={w.locoStyle === LOCO_SHUFFLE ? LOCO_SHUFFLE : LOCO_RUN}
                onChange={(st) => onChange(value.map((o, k) => (k === j ? { ...o, locoStyle: st } : o)))}
                aria-label="Loco style"
              />
            </div>
          ))}
        </div>
      </div>
    );
  }
  return <JsonField field={field} value={value} disabled={disabled} onChange={onChange} />;
}

function JsonField({ field, value, disabled, onChange }: { field: string; value: unknown; disabled: boolean; onChange(v: unknown): void }) {
  const text = JSON.stringify(value);
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  return (
    <div className={s.fieldRowWide}>
      <span className={s.fieldLabel}>{field}</span>
      <TextArea
        mono
        rows={2}
        value={draft ?? text}
        disabled={disabled}
        invalid={bad}
        onChange={(v) => {
          setDraft(v);
          setBad(false);
        }}
        onBlur={() => {
          if (draft === null) return;
          try {
            onChange(JSON.parse(draft));
            setDraft(null);
          } catch {
            setBad(true);
          }
        }}
      />
    </div>
  );
}
