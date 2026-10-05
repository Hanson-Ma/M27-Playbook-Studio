// The route's points as a list: distance, direction and speed of each leg, the cut at its end (icon + plain name;
// opens the cut picker), delete. Rows select the matching point on the field. The leg's step type (RunRoute,
// MoveDirection…) is shown only when it isn't a plain route leg; change it in ADVANCED → Raw steps.
import { cutAt, editRoute, removeVertex, setLeg } from "../../model/routes";
import { stepSummary } from "../../model/steps";
import { IconButton, NumberField, cx } from "../../ui";
import { CutIcon, cutName } from "./cuts";
import { slotGeometry, useDesigner } from "./shared";
import s from "./Inspector.module.css";

const LEG_NAMES: Record<string, string> = { MoveDirection: "Move", ReceiveHandoff: "Take handoff", RecievePitch: "Take pitch", HeadTurnRunRoute: "Look back" };

export function LegTable({ slot, lock }: { slot: number; lock: number }) {
  const d = useDesigner();
  const { state, set, ui, setUi } = d;
  const steps = state.slots[slot].steps;
  const geom = slotGeometry(set, slot, steps, lock);
  const { route } = geom;

  const patch = (k: number, p: Parameters<typeof setLeg>[2], label: string) => d.commitSlot(slot, editRoute(steps, (r) => setLeg(r, k, p)), label, undefined, 700);

  const before = route.prefix.filter((x) => x.type !== "None").map(stepSummary);
  const after = route.suffix.filter((x) => x.type !== "None" && !(x.type === "ReceiverCut" && route.legs.length)).map(stepSummary);

  return (
    <div className={s.legs}>
      {before.length > 0 && <div className={s.legAside}>Before: {before.join(" · ")}</div>}
      {route.legs.length === 0 && (
        <div className={s.legEmpty}>No route yet — pick one above, or turn on “Draw route” over the field and click to add points.</div>
      )}
      {route.legs.map((leg, k) => {
        const locked = k < geom.firstEditableLeg;
        const selected = ui.vertex?.kind === "leg" && ui.vertex.k === k;
        const cut = cutAt(route, k);
        return (
          <div key={k} className={cx(s.legRow, selected && s.legSel, locked && s.legLocked)} onClick={() => setUi({ vertex: { kind: "leg", k } })}>
            <div className={s.legLine}>
              <span className={s.legNo} title={`Point ${k + 1}`}>
                {k + 1}
              </span>
              <span className={s.legSummary}>{leg.type !== "RunRoute" ? (LEG_NAMES[leg.type] ?? leg.type) : `Leg ${k + 1}`}</span>
              <button
                type="button"
                className={cx(s.cutBtn, cut && s.cutOn)}
                disabled={locked}
                title="The cut at the end of this leg — click to change"
                onClick={(e) => {
                  e.stopPropagation();
                  setUi({ vertex: { kind: "leg", k } });
                  const r = e.currentTarget.getBoundingClientRect();
                  d.openCutMenu(k, { x: r.left, y: r.bottom + 4 });
                }}
              >
                {cut ? (
                  <span className={s.cutBtnInner}>
                    <CutIcon cutType={String(cut.cutType)} dir={String(cut.direction)} size={16} />
                    {cutName(String(cut.cutType))}
                  </span>
                ) : (
                  "No cut"
                )}
              </button>
              <IconButton
                icon="trash"
                size="sm"
                title="Delete this point"
                disabled={locked}
                onClick={(e) => {
                  e.stopPropagation();
                  d.commitSlot(slot, editRoute(steps, (r) => removeVertex(r, geom.start, k)), "Delete point");
                  setUi({ vertex: undefined });
                }}
              />
            </div>
            <div className={s.legNums}>
              <NumberField size="sm" label="YD" value={leg.distance} min={0} max={80} step={0.5} precision={2} disabled={locked} onChange={(v) => patch(k, { distance: v }, "Leg distance")} />
              <NumberField size="sm" label="DIR" value={leg.direction} min={0} max={359.99} step={5} precision={2} suffix="°" disabled={locked} onChange={(v) => patch(k, { direction: v }, "Leg direction")} />
              <NumberField size="sm" label="SPD" title="Speed (% of full speed)" value={leg.speed} min={0} max={100} step={5} disabled={locked || leg.speed === undefined} onChange={(v) => patch(k, { speed: v }, "Leg speed")} />
            </div>
          </div>
        );
      })}
      {after.length > 0 && <div className={s.legAside}>After: {after.join(" · ")}</div>}
      {route.legs.length > 0 && <div className={s.legAside}>Direction: 90° = straight upfield, 0° = toward the right sideline, 180° = left.</div>}
    </div>
  );
}
