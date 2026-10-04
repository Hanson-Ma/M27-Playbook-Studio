// MOTION tab: pre-snap motion (AutoMotion) — presets (jet, orbit, return / shift, short), the motion points
// (absolute x / y, speed, run / shuffle) and how far a player can go (model/motionLimits.ts: behind the line, inside
// the numbers, up to 5 points, the OL never motions), with problems shown inline. Start event, delays and facing
// are under "More options". The route continues from the last motion point.
import { useMemo } from "react";
import { MOTION_LIMITS, canMotion, clampMotionPoint, motionIssues, motionPathLength } from "../../model/motionLimits";
import { LOCO_RUN, LOCO_SHUFFLE, MOTION_PRESETS, makeWaypoint, motionIndex, motionPresetWaypoints, motionStep, setMotion, setWaypoints, type MotionPresetId } from "../../model/routes";
import { isOffensiveLine } from "../../model/positions";
import { startOverride } from "../../model/designer";
import type { AutoMotionWaypoint, Step } from "../../model/types";
import { Button, IconButton, NumberField, SearchSelect, Segmented, Toggle, cx } from "../../ui";
import { Disclosure } from "./Disclosure";
import { alignmentOf, useDesigner } from "./shared";
import s from "./Inspector.module.css";

const L = MOTION_LIMITS;

export function MotionTab({ slot, lock }: { slot: number; lock: number }) {
  const d = useDesigner();
  const { state, set, lib, ui, setUi } = d;
  const steps = state.slots[slot].steps;
  const pos = set.movements.Normal[slot]?.pos ?? "";
  const mi = motionIndex(steps);
  const motion = mi >= 0 ? steps[mi] : undefined;
  const locked = mi >= 0 && mi < lock;
  const wps = (motion?.waypoints as AutoMotionWaypoint[] | undefined) ?? [];
  const start = startOverride(steps) ?? alignmentOf(set, slot);
  const qbY = set.movements.Normal.find((p) => /QB/.test(p.pos))?.y;
  const motionMen = state.slots.filter((sl) => sl.steps.some((x) => x.type === "AutoMotion")).length;
  const issues = useMemo(
    () => (motion ? motionIssues(start, wps.map((w) => w.position), { pos, motionMen }) : []),
    [motion, start, wps, pos, motionMen],
  );
  const length = motion ? motionPathLength(start, wps.map((w) => w.position)) : 0;
  const events = useMemo(() => lib.enumValues("AutomotionStartEvent").map((v) => ({ value: v, label: v.replace(/^AUTOMOTIONSTARTEVENT_/, "").replace(/_/g, " ").toLowerCase() })), [lib]);

  if (!canMotion(pos) || isOffensiveLine(pos)) {
    return (
      <section className={s.section}>
        <div className={s.sectionHead}>
          <span className={s.sectionTitle}>Motion</span>
        </div>
        <p className={s.note}>Linemen never go in motion — the line has to stay set before the snap. Pick a receiver, tight end or back.</p>
      </section>
    );
  }

  const commit = (next: Step[], label: string, coalesceMs?: number) => d.commitSlot(slot, next, label, undefined, coalesceMs);
  const clampWps = (list: AutoMotionWaypoint[]) => list.slice(0, L.maxWaypoints).map((w) => ({ ...w, position: clampMotionPoint(w.position) }));

  const applyPreset = (id: MotionPresetId) => {
    const w = clampWps(motionPresetWaypoints(id, start, { qbY }));
    const keepEvent = motion ? { startEvent: String(motion.startEvent), startDelay: Number(motion.startDelay ?? 0), endDelay: Number(motion.endDelay ?? 0) } : {};
    commit(motion ? setWaypoints(steps, w) : setMotion(steps, motionStep(w, keepEvent)), `Motion: ${id}`);
    setUi({ vertex: undefined });
  };

  const patchWp = (j: number, patch: Partial<AutoMotionWaypoint>, label: string, coalesceMs = 700) => {
    const next = wps.map((w, i) => (i === j ? { ...w, ...patch, position: clampMotionPoint({ ...w.position, ...(patch.position ?? {}) }) } : w));
    commit(setWaypoints(steps, next), label, coalesceMs);
  };

  const patchStep = (patch: Record<string, unknown>, label: string) => {
    if (mi < 0) return;
    const next = steps.slice();
    next[mi] = { ...steps[mi], ...patch };
    commit(next, label, 700);
  };

  const addPoint = () => {
    const last = wps[wps.length - 1]?.position ?? start;
    const sgn = last.x < 0 ? -1 : 1;
    const p = clampMotionPoint({ x: last.x - sgn * 3, y: Math.min(last.y, -2.2) });
    commit(setWaypoints(steps, [...wps, makeWaypoint(p, wps[wps.length - 1]?.speed ?? 80)]), wps.length ? "Add motion point" : "Add motion");
    setUi({ vertex: { kind: "wp", step: mi >= 0 ? mi : motionIndex(setWaypoints(steps, [])), wp: wps.length } });
  };

  return (
    <>
      <section className={s.section}>
        <div className={s.sectionHead}>
          <span className={s.sectionTitle}>Motion</span>
          <span className={s.muted}>before the snap</span>
        </div>
        <div className={s.btnGrid}>
          {MOTION_PRESETS.map((p) => (
            <Button key={p.id} size="sm" disabled={locked} onClick={() => applyPreset(p.id)} title={p.hint}>
              {p.label}
            </Button>
          ))}
        </div>
        <p className={s.limits}>
          How far a player can motion (measured from the game's own plays): behind the line of scrimmage, no deeper than {Math.abs(L.minY)} yd, inside the numbers
          (±{L.maxAbsX} yd), up to {L.maxWaypoints} points and about {L.warnPathYards} yd in total. Points you drag stay inside the shaded area on the field.
        </p>
      </section>

      {motion ? (
        <section className={s.section}>
          <div className={s.sectionHead}>
            <span className={s.sectionTitle}>
              Motion points <span className={s.muted}>· {length.toFixed(1)} yd</span>
            </span>
            <Button size="sm" variant="ghost" icon="trash" disabled={locked} onClick={() => (commit(setMotion(steps, null), "Remove motion"), setUi({ vertex: undefined }))}>
              Remove motion
            </Button>
          </div>
          {issues.length > 0 && (
            <ul className={s.issues} role="status">
              {issues.map((i, k) => (
                <li key={k} className={i.level === "error" ? s.issueError : s.issueWarning}>
                  {i.message}
                </li>
              ))}
            </ul>
          )}
          <div className={s.wpList}>
            {wps.map((w, j) => {
              const selected = ui.vertex?.kind === "wp" && ui.vertex.step === mi && ui.vertex.wp === j;
              return (
                <div key={j} className={cx(s.wpRow, selected && s.legSel)} onClick={() => setUi({ vertex: { kind: "wp", step: mi, wp: j } })}>
                  <div className={s.legLine}>
                    <span className={s.legNo}>{j + 1}</span>
                    <Segmented
                      size="sm"
                      options={[
                        { value: LOCO_RUN, label: "Run" },
                        { value: LOCO_SHUFFLE, label: "Shuffle" },
                      ]}
                      value={w.locoStyle === LOCO_SHUFFLE ? LOCO_SHUFFLE : LOCO_RUN}
                      onChange={(v) => patchWp(j, { locoStyle: v }, "Motion style", 0)}
                    />
                    <span className={s.legSummary} />
                    <IconButton
                      icon="trash"
                      size="sm"
                      title="Delete this motion point"
                      disabled={locked}
                      onClick={(e) => {
                        e.stopPropagation();
                        commit(wps.length <= 1 ? setMotion(steps, null) : setWaypoints(steps, wps.filter((_, i) => i !== j)), "Delete motion point");
                        setUi({ vertex: undefined });
                      }}
                    />
                  </div>
                  <div className={s.legNums}>
                    <NumberField size="sm" label="X" value={w.position.x} step={0.5} precision={2} min={-L.maxAbsX} max={L.maxAbsX} disabled={locked} onChange={(v) => patchWp(j, { position: { x: v, y: w.position.y } }, "Motion point x")} />
                    <NumberField size="sm" label="Y" value={w.position.y} step={0.5} precision={2} min={L.minY} max={L.maxY} disabled={locked} onChange={(v) => patchWp(j, { position: { x: w.position.x, y: v } }, "Motion point y")} />
                    <NumberField size="sm" label="SPEED" value={w.speed} step={5} min={5} max={100} disabled={locked} onChange={(v) => patchWp(j, { speed: v }, "Motion speed")} />
                  </div>
                </div>
              );
            })}
          </div>
          <Button size="sm" icon="plus" disabled={locked || wps.length >= L.maxWaypoints} onClick={addPoint} title={wps.length >= L.maxWaypoints ? `Real plays use at most ${L.maxWaypoints} motion points` : undefined}>
            Add motion point
          </Button>
          {locked && <p className={s.note}>This motion is part of the kept handoff.</p>}
          <Disclosure id="motion.more" title="More options" hint="start, delays, facing">
            <div className={s.paramRows}>
              <div className={s.paramRow}>
                <span className={s.fieldLabel}>Starts</span>
                <SearchSelect size="sm" value={String(motion.startEvent ?? "")} options={events} disabled={locked} onChange={(v) => patchStep({ startEvent: v }, "Motion start")} width="100%" />
              </div>
            </div>
            <div className={s.params}>
              <NumberField size="sm" label="DELAY" suffix="s" value={Number(motion.startDelay ?? 0)} min={0} max={10} step={0.125} precision={3} disabled={locked} onChange={(v) => patchStep({ startDelay: v }, "Motion delay")} />
              <NumberField size="sm" label="END DELAY" suffix="s" value={Number(motion.endDelay ?? 0)} min={0} max={10} step={0.125} precision={3} disabled={locked} onChange={(v) => patchStep({ endDelay: v }, "Motion end delay")} />
            </div>
            {wps.map((w, j) => (
              <div key={j} className={s.paramRow}>
                <span className={s.fieldLabel}>Point {j + 1} facing</span>
                <div className={s.legLine}>
                  <Toggle size="sm" checked={!!w.shouldFaceEndPoint} onChange={(v) => patchWp(j, { shouldFaceEndPoint: v }, "Motion facing", 0)} label="Face where he's going" />
                  <NumberField size="sm" suffix="°" value={w.facingAngle} step={15} min={0} max={359} disabled={locked || !!w.shouldFaceEndPoint} onChange={(v) => patchWp(j, { facingAngle: v }, "Motion facing")} />
                </div>
              </div>
            ))}
          </Disclosure>
        </section>
      ) : (
        <section className={s.section}>
          <p className={s.note}>No motion yet. Pick a preset above, or click inside the shaded area on the field to drop the first motion point.</p>
          <div>
            <Button size="sm" icon="plus" onClick={addPoint}>
              Add motion point
            </Button>
          </div>
        </section>
      )}
    </>
  );
}
