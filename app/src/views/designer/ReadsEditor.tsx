// READS editor: progression order (drag or arrows), pct 0–1, concept, combo. Reads are only written once edited;
// "Reset to base reads" removes the key again (FORMATS.md: rewritten reads showed several red routes in testing).
import { useState } from "react";
import { conceptLabel, effectiveField, eligibleSlots, normalizeReads, setPlayField, slotRoleLabel } from "../../model/designer";
import { slotLabel } from "../../model/positions";
import type { ReadDef } from "../../model/types";
import { Button, IconButton, NumberField, SearchSelect, Slider, cx } from "../../ui";
import { useDesigner } from "./shared";
import s from "./PlayPanel.module.css";

export function ReadsEditor() {
  const d = useDesigner();
  const { state, set, lib } = d;
  const reads = effectiveField<ReadDef[]>(state, "reads") ?? [];
  const explicit = "reads" in state.play;
  const max = state.base?.reads.length ?? 0;
  const eligible = eligibleSlots(set);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const concepts = lib.enumValues("ConceptType");

  const write = (next: ReadDef[], label: string, coalesceMs?: number) => d.edit((st) => setPlayField(st, "reads", normalizeReads(next)), label, coalesceMs);
  const patch = (i: number, p: Partial<ReadDef>, label: string, coalesceMs?: number) => write(reads.map((r, j) => (j === i ? { ...r, ...p } : r)), label, coalesceMs);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= reads.length || from === to) return;
    const next = reads.slice();
    const [r] = next.splice(from, 1);
    next.splice(to, 0, r);
    write(next, "Reorder reads");
  };
  const name = (pos: number) => {
    const a = set.movements.Normal[pos];
    if (!a) return `Slot ${pos}`;
    const l = slotLabel(a.pos, a.depth);
    const r = slotRoleLabel(set, pos);
    return r !== l ? `${l} · ${r}` : l;
  };

  if (max === 0) {
    return (
      <>
        <div className={s.eyebrow}>Reads</div>
        <p className={s.note}>The base play has no read progression (a run play), so there's nothing to order.</p>
      </>
    );
  }

  return (
    <>
      <div className={s.fileHead}>
        <div className={s.eyebrow}>Reads {explicit ? <span className={s.edited}>edited</span> : <span className={s.dim}>· from base</span>}</div>
        <Button size="sm" variant="ghost" icon="undo" disabled={!explicit} onClick={() => d.edit((st) => setPlayField(st, "reads", undefined), "Reset reads")}>
          Use base reads
        </Button>
      </div>
      <div className={s.reads}>
        {reads.map((r, i) => (
          <div
            key={i}
            className={cx(s.read, dragFrom === i && s.dragging)}
            draggable
            onDragStart={(e) => {
              setDragFrom(i);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", String(i));
            }}
            onDragEnd={() => setDragFrom(null)}
            onDragOver={(e) => {
              if (dragFrom !== null) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom !== null) move(dragFrom, i);
              setDragFrom(null);
            }}
          >
            <div className={s.readLine}>
              <span className={s.grip} title="Drag to reorder" aria-hidden>
                ⋮⋮
              </span>
              <span className={s.order}>{i + 1}</span>
              <div className={s.grow}>
                <SearchSelect
                  size="sm"
                  value={String(r.pos)}
                  options={[...eligible.map((p) => ({ value: String(p), label: name(p) })), ...(eligible.includes(r.pos) ? [] : [{ value: String(r.pos), label: name(r.pos) }])]}
                  onChange={(v) => patch(i, { pos: Number(v) }, "Read slot")}
                  width="100%"
                />
              </div>
              <IconButton icon="chevronUp" size="sm" title="Earlier" disabled={i === 0} onClick={() => move(i, i - 1)} />
              <IconButton icon="close" size="sm" title="Remove read" onClick={() => write(reads.filter((_, j) => j !== i), "Remove read")} />
            </div>
            <div className={s.readLine}>
              <Slider value={Math.round((r.pct ?? 0) * 100)} min={0} max={100} step={1} suffix="%" onChange={(v) => patch(i, { pct: v / 100 }, "Read %", 800)} className={s.grow} aria-label="Read percentage" />
              <NumberField size="sm" label="CMB" value={typeof r.combo === "number" ? r.combo : 0} min={0} max={9} step={1} onChange={(v) => patch(i, { combo: v }, "Read combo")} width={78} />
            </div>
            <SearchSelect
              size="sm"
              value={typeof r.concept === "string" ? r.concept : undefined}
              options={concepts}
              placeholder="Concept…"
              onChange={(v) => patch(i, { concept: v }, "Read concept")}
              renderValue={(o, v) => conceptLabel(o?.value ?? v) || "Concept…"}
              width="100%"
            />
          </div>
        ))}
      </div>
      <Button
        size="sm"
        variant="ghost"
        icon="plus"
        disabled={reads.length >= max || eligible.every((p) => reads.some((r) => r.pos === p))}
        onClick={() => {
          const pos = eligible.find((p) => !reads.some((r) => r.pos === p));
          if (pos !== undefined) write([...reads, { pos, pct: 0.5 }], "Add read");
        }}
      >
        Add read ({reads.length}/{max})
      </Button>
      {explicit && (
        <p className={s.note}>
          Heads-up: plays whose reads were rewritten (all combo 0, Concept_Invalid) showed several red routes in testing. Keep the base's reads unless you need
          to change them, and set VIP explicitly when the primary changes.
        </p>
      )}
    </>
  );
}
