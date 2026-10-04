// Release details (ADVANCED tab): inside / outside / straight releases = a short first leg plus an optional
// WRSTART animation. Double moves live in the ROUTE tab (ReceiverCut cut types such as SLANT_AND_GO). No
// RunRouteFakeOut: the library has no instance of it, so the game-side builder can't author one (a loaded one is
// flagged by the inspector and can be removed there).
import { slotSide } from "../../model/designer";
import { detectRelease, editRoute, releaseAnim, setRelease, type ReleaseKind } from "../../model/routes";
import { NumberField, Segmented } from "../../ui";
import { slotGeometry, useDesigner } from "./shared";
import s from "./Inspector.module.css";

const KINDS: { value: ReleaseKind; label: string }[] = [
  { value: "none", label: "None" },
  { value: "vertical", label: "Straight" },
  { value: "inside", label: "Inside" },
  { value: "outside", label: "Outside" },
];

const ANIMS = [
  { value: "", label: "None" },
  { value: "MOVETYPE_WRSTART", label: "Receiver start" },
  { value: "MOVETYPE_WRSTART_QUICK", label: "Quick start" },
];

export function ReleaseSection({ slot, lock }: { slot: number; lock: number }) {
  const d = useDesigner();
  const { state, set } = d;
  const steps = state.slots[slot].steps;
  const side = slotSide(state, slot);
  const geom = slotGeometry(set, slot, steps, lock);
  const route = geom.route;
  const kind = detectRelease(route, side);
  const anim = releaseAnim(route) ?? "";
  const relLen = kind !== "none" ? route.legs[0].distance : 1.5;
  const lockedFirst = geom.firstEditableLeg > 0;

  const applyRelease = (k: ReleaseKind, a: string | null | undefined, length = relLen) =>
    d.commitSlot(slot, editRoute(steps, (r) => setRelease(r, geom.start, side, k, { length, anim: a })), "Release");

  return (
    <>
      <p className={s.note}>The first step off the line · inside = toward the ball.</p>
      {route.legs.length === 0 ? (
        <p className={s.note}>Draw or pick a route first — the release is its first short leg.</p>
      ) : lockedFirst ? (
        <p className={s.note}>The first leg belongs to the kept handoff.</p>
      ) : (
        <>
          <Segmented block size="sm" options={KINDS} value={kind} onChange={(v) => applyRelease(v, undefined)} aria-label="Release" />
          <div className={s.paramRows}>
            {kind !== "none" && (
              <div className={s.paramRow}>
                <span className={s.fieldLabel}>Length</span>
                <NumberField size="sm" value={relLen} min={0.5} max={2.5} step={0.25} suffix="yd" onChange={(v) => applyRelease(kind, undefined, v)} />
              </div>
            )}
            <div className={s.paramRow}>
              <span className={s.fieldLabel}>Start anim</span>
              <Segmented size="sm" options={ANIMS} value={anim} onChange={(v) => applyRelease(kind, v || null)} aria-label="Release animation" />
            </div>
          </div>
          <p className={s.note}>
            A release is a short first leg (≤ 2.5 yd) angled before the stem: right-side players release inside at ~105°, left-side at ~75°. The rest of the
            route stays where it is.
          </p>
        </>
      )}
    </>
  );
}
