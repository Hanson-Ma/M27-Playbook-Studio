// Routes that run off the field (model/routeBounds.ts) in the ROUTE tab: a notice with "Fit to field" while the
// selected player's route crosses a sideline (or the back of the end zone), a mark on route tiles that would, and a
// warning toast right after such a route is put on a player — typically a My Routes route drawn for a slot receiver
// and mirrored onto a wide receiver.
import { setSlotSteps } from "../../model/designer";
import { chainOffField, fitChainToField, offFieldText, pointsOffField } from "../../model/routeBounds";
import type { Step } from "../../model/types";
import { Button, Icon, toast } from "../../ui";
import { alignmentOf, slotGeometry, useDesigner, type DesignerCtxValue } from "./shared";
import s from "./Inspector.module.css";

const NOTE = "Ball in the middle of the field.";

/** The fitted chain for a slot's current route (undefined: on the field, or can't be fitted). */
function fittedSteps(d: Pick<DesignerCtxValue, "set">, slot: number, steps: Step[], lock: number): Step[] | undefined {
  const geom = slotGeometry(d.set, slot, steps, lock);
  return fitChainToField(alignmentOf(d.set, slot), steps, geom.firstEditableLeg);
}

/** Notice above the route tools while the selected player's route leaves the field. */
export function OffFieldNotice({ slot, lock }: { slot: number; lock: number }) {
  const d = useDesigner();
  const steps = d.state.slots[slot].steps;
  const off = pointsOffField(slotGeometry(d.set, slot, steps, lock).points);
  if (!off) return null;
  const fitted = fittedSteps(d, slot, steps, lock);
  return (
    <section className={s.offField} role="status">
      <Icon name="warning" size={16} className={s.offFieldIcon} />
      <div className={s.offFieldBody}>
        <div className={s.offFieldTitle}>Off the field: {offFieldText(off)}</div>
        <p className={s.offFieldText}>
          {NOTE}{" "}
          {fitted
            ? "Fit to field shortens the legs that head that way — the depth and the cuts stay."
            : "Shorten the legs that head that way (drag the points, or Route points below)."}
        </p>
      </div>
      {fitted && (
        <Button size="sm" variant="secondary" icon="route" onClick={() => d.commitSlot(slot, fitted, "Fit route to field")}>
          Fit to field
        </Button>
      )}
    </section>
  );
}

/** Whether `steps` (a tile's preview of the chain for this player) would leave the field. */
export function tileOffField(d: Pick<DesignerCtxValue, "set">, slot: number, steps: Step[]): boolean {
  return !!chainOffField(alignmentOf(d.set, slot), steps);
}

/** After putting a route on a player: warn (with a "Fit to field" action) when it runs off the field. */
export function warnIfOffField(d: DesignerCtxValue, slot: number, steps: Step[], lock: number, routeName: string): void {
  const off = chainOffField(alignmentOf(d.set, slot), steps);
  if (!off) return;
  const canFit = !!fittedSteps(d, slot, steps, lock);
  toast.warning(`"${routeName}" ${offFieldText(off)} for this player`, {
    detail: `${NOTE} ${canFit ? "Fit to field shortens the legs that head that way." : "Shorten the legs that head that way."}`,
    duration: 8000,
    action: canFit
      ? {
          label: "Fit to field",
          run: () =>
            d.edit((st) => {
              const cur = st.slots[slot]?.steps;
              const next = cur ? fittedSteps(d, slot, cur, lock) : undefined;
              return next ? setSlotSteps(st, slot, next) : st;
            }, "Fit route to field"),
        }
      : undefined,
  });
}
