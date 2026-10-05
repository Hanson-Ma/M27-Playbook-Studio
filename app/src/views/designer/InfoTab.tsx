// Assignment info (ADVANCED tab): where the slot's assignment comes from (base / library path / authored name), its
// routeType (editable for authored steps), the authored name, keep / template, the alignment and "Reset to base".
import { useMemo, useState } from "react";
import { assignmentPath, authoredUses, isAuthoredSlot, isSlotChanged, resetSlot, setSlotInfo } from "../../model/designer";
import { hasMechanics, stepSummary } from "../../model/steps";
import type { NewAssignmentSpec, PlaysFile } from "../../model/types";
import { useDocsOfKind } from "../../state/workspace";
import { Button, SearchSelect, Tag, TextInput } from "../../ui";
import { useDesigner } from "./shared";
import s from "./Inspector.module.css";

const rt = (v?: string) => (v ?? "").replace(/^AssignRouteType_/, "").replace(/_/g, " ");

export function InfoTab({ slot }: { slot: number }) {
  const d = useDesigner();
  const { state, lib, set, catalog, file, index } = d;
  const docs = useDocsOfKind<PlaysFile>("plays");
  const sl = state.slots[slot];
  const a = set.movements.Normal[slot];
  const changed = isSlotChanged(state, slot);
  const authored = isAuthoredSlot(state, lib, slot);
  const resolved = catalog.custom.find((p) => p.file === file && p.index === index)?.slots[slot];
  const baseAsset = state.baseAssets[slot];
  const baseRt = lib.assignment(baseAsset ?? "")?.routeType;
  const spec = sl.spec;
  const name = typeof spec === "object" && spec ? (spec as NewAssignmentSpec).new : sl.name;
  const uses = useMemo(() => (name ? (authoredUses(docs.map((x) => ({ path: x.path, data: x.data })))).get(name) ?? [] : []), [docs, name]);
  const [rename, setRename] = useState<string | null>(null);
  const routeTypes = lib.enumValues("AssignRouteType");

  const source = !changed
    ? { label: "Base Assignment", value: assignmentPath(baseAsset ?? "") }
    : typeof spec === "string"
      ? { label: "Library Assignment", value: spec }
      : authored
        ? { label: "Authored Assignment", value: `PBS/${name ?? "(new)"}` }
        : { label: "Library Assignment", value: resolved?.assignment ? assignmentPath(resolved.assignment) : "(matches a library chain)" };

  return (
    <>
      <section className={s.section}>
        <div className={s.sectionHead}>
          <span className={s.sectionTitle}>Assignment</span>
          {changed ? <Tag tone="custom" size="sm">Changed</Tag> : <Tag size="sm">Base</Tag>}
        </div>
        <dl className={s.kv}>
          <dt>{source.label}</dt>
          <dd className={s.mono}>{source.value}</dd>
          <dt>Base</dt>
          <dd className={s.mono}>
            {assignmentPath(baseAsset ?? "")} <span className={s.muted}>· {rt(baseRt)}</span>
          </dd>
          <dt>Route Type</dt>
          <dd>{rt(resolved?.routeType ?? sl.routeType ?? baseRt) || "—"}</dd>
          <dt>Mechanics</dt>
          <dd>{hasMechanics(sl.steps) ? "Handoff / option steps (paired)" : "None"}</dd>
          {typeof spec === "object" && spec && (
            <>
              <dt>Keep</dt>
              <dd>
                {Number((spec as NewAssignmentSpec).keep ?? 0) > 0
                  ? `First ${(spec as NewAssignmentSpec).keep} step(s) of ${(spec as NewAssignmentSpec).template ?? "the base slot"} kept`
                  : "Nothing kept — all steps authored"}
              </dd>
              {(spec as NewAssignmentSpec).template && (
                <>
                  <dt>Template</dt>
                  <dd className={s.mono}>{String((spec as NewAssignmentSpec).template)}</dd>
                </>
              )}
            </>
          )}
          {name && authored && (
            <>
              <dt>Used By</dt>
              <dd>
                {uses.length
                  ? uses.map((u, k) => (
                      <span key={k}>
                        {k > 0 && ", "}
                        <span className="caps">{u.play || "?"}</span> · slot {u.slot}
                      </span>
                    ))
                  : "Only this play"}
              </dd>
            </>
          )}
        </dl>
        {changed && (
          <Button size="sm" variant="ghost" icon="undo" onClick={() => d.edit((st) => resetSlot(st, slot), "Reset slot")}>
            Reset to the Base Play
          </Button>
        )}
      </section>

      {authored && (
        <section className={s.section}>
          <div className={s.sectionHead}>
            <span className={s.sectionTitle}>Authored Assignment</span>
          </div>
          <div className={s.paramRows}>
            <div className={s.paramRow}>
              <span className={s.fieldLabel}>Name</span>
              <TextInput
                size="sm"
                mono
                value={rename ?? name ?? ""}
                placeholder="Generated on save"
                onChange={(v) => setRename(v.replace(/[^A-Za-z0-9_]/g, ""))}
                onBlur={() => {
                  if (rename !== null && rename && rename !== name) d.edit((st) => setSlotInfo(st, slot, { name: rename }), "Rename assignment");
                  setRename(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                }}
              />
            </div>
            <div className={s.paramRow}>
              <span className={s.fieldLabel}>Route Type</span>
              <SearchSelect
                size="sm"
                value={sl.routeType ?? (typeof spec === "object" ? (spec as NewAssignmentSpec)?.routeType : undefined)}
                options={routeTypes}
                placeholder="Inherit from template"
                onChange={(v) => d.edit((st) => setSlotInfo(st, slot, { routeType: v }), "Route type")}
                renderValue={(o, v) => rt(o?.value ?? v)}
                width="100%"
              />
            </div>
          </div>
          <p className={s.note}>Built as Assignments/PBS/&lt;name&gt;. A name shared with other plays is never redefined — editing forks a new name.</p>
        </section>
      )}

      <section className={s.section}>
        <div className={s.sectionHead}>
          <span className={s.sectionTitle}>Alignment</span>
        </div>
        <dl className={s.kv}>
          <dt>Position</dt>
          <dd className={s.num}>
            {a.x.toFixed(2)}, {a.y.toFixed(2)}
          </dd>
          <dt>Stance</dt>
          <dd>{a.stance.replace(/^StanceType_/, "")}</dd>
          <dt>Motion Man</dt>
          <dd>{a.motionMan ? "Yes" : "No"}</dd>
        </dl>
      </section>

      <section className={s.section}>
        <div className={s.sectionHead}>
          <span className={s.sectionTitle}>Steps</span>
        </div>
        <ol className={s.summary}>
          {sl.steps
            .filter((x) => x.type !== "None")
            .map((x, i) => (
              <li key={i}>{stepSummary(x)}</li>
            ))}
        </ol>
      </section>
    </>
  );
}
