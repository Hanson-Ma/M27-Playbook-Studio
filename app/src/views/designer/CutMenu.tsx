// Cut picker for one route point (right-click a point, the "Cut" button on the field toolbar, or a leg row): every
// cut drawn as an icon with a plain name, grouped (speed / hard / turn back / double move / screen), plus the turn
// direction (auto from the turn, overridable), the next leg's speed and "delete point". A loaded RunRouteFakeOut (no
// library instance, so the builder can't author it) can only be removed here.
import { useActions } from "../../input/actions";
import {
  CUT_LEFT,
  CUT_RIGHT,
  autoCutDir,
  cutAt,
  cutFor,
  editRoute,
  fakeAt,
  removeFakeAt,
  removeVertex,
  setCutAt,
  setLeg,
  type EditableRoute,
} from "../../model/routes";
import { Button, Floating, Segmented, cx } from "../../ui";
import { CUT_GROUPS, CutIcon, cutName } from "./cuts";
import { lockOf, slotGeometry, useDesigner } from "./shared";
import s from "./Cuts.module.css";

const SPEEDS = [100, 90, 80, 70, 60];

export function CutMenu({ slot, k, at, onClose }: { slot: number; k: number; at: { x: number; y: number }; onClose(): void }) {
  const d = useDesigner();
  const { state, set, lib, ui } = d;
  useActions("designer.cut", [{ id: "close", label: "Close", keys: ["Escape"], allowInInput: true, run: onClose }], { modal: true });
  const lock = lockOf(state, ui, slot);
  const steps = state.slots[slot]?.steps ?? [];
  const geom = slotGeometry(set, slot, steps, lock ?? 0);
  const route = geom.route;
  const leg = route.legs[k];
  if (!leg || lock === null || k < geom.firstEditableLeg) return null;

  const cut = cutAt(route, k);
  const fake = fakeAt(route, k);
  const next = route.legs[k + 1];
  const isEnd = !next;
  const auto = next ? cutFor(leg.direction, next.direction) : undefined;
  const autoDir = autoCutDir(route, k, geom.start);

  const apply = (fn: (r: EditableRoute) => EditableRoute, label: string) => d.commitSlot(slot, editRoute(steps, fn), label);
  const setCut = (cutType: string, direction?: string) => apply((r) => setCutAt(r, k, { cutType, direction }, geom.start), "Set cut");
  const pick = (cutType: string) => {
    setCut(cutType, cut ? String(cut.direction) : undefined);
    onClose();
  };

  const known = new Set(lib.enumValues("ReceiverCutAngle"));
  const groups = CUT_GROUPS.map((g) => ({ ...g, cuts: g.cuts.filter((c) => known.size === 0 || known.has(c.value)) })).filter((g) => g.cuts.length);
  const listed = new Set(groups.flatMap((g) => g.cuts.map((c) => c.value)));
  const other = [...known].filter((v) => !listed.has(v) && !/INVALID|NONEVALUE/.test(v));
  const dir = cut ? String(cut.direction) : undefined;
  // The leg the speed applies to: the one leaving this point (the last point has none — its own leg then).
  const speedLeg = next ? k + 1 : k;
  const speed = route.legs[speedLeg]?.speed;

  return (
    <Floating anchor={at} placement="bottom-start" onDismiss={onClose} zIndex={1200} className={s.picker} role="dialog">
      <div className={s.head}>
        <div>
          <div className={s.title}>Cut at point {k + 1}</div>
          <div className={s.sub}>
            {cut ? `${cutName(String(cut.cutType))}${dir === CUT_LEFT ? " · turns left" : dir === CUT_RIGHT ? " · turns right" : ""}` : "No cut — the route just bends here"}
            {isEnd ? " · end of the route" : ""}
          </div>
        </div>
        <Button size="sm" variant="ghost" icon="close" onClick={onClose} aria-label="Close" />
      </div>

      <div className={s.quick}>
        <button type="button" className={cx(s.cut, !cut && s.cutOn)} onClick={() => (apply((r) => setCutAt(r, k, null), "Remove cut"), onClose())}>
          <span className={s.cutName}>No cut</span>
        </button>
        {auto && (
          <button type="button" className={s.cut} title="The cut that fits this turn" onClick={() => (setCut(String(auto.cutType), String(auto.direction)), onClose())}>
            <CutIcon cutType={String(auto.cutType)} dir={String(auto.direction)} size={24} />
            <span className={s.cutName}>Fit the turn: {cutName(String(auto.cutType))}</span>
          </button>
        )}
      </div>

      {groups.map((g) => (
        <div key={g.id} className={s.group}>
          <div className={s.groupHead}>
            <span className={s.groupLabel}>{g.label}</span>
            <span className={s.groupHint}>{g.hint}</span>
          </div>
          <div className={s.grid}>
            {g.cuts.map((c) => (
              <button key={c.value} type="button" className={cx(s.cut, cut?.cutType === c.value && s.cutOn)} onClick={() => pick(c.value)} title={c.value}>
                <CutIcon cutType={c.value} dir={dir ?? autoDir} size={26} />
                <span className={s.cutName}>{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {other.length > 0 && (
        <div className={s.group}>
          <div className={s.groupHead}>
            <span className={s.groupLabel}>Other</span>
          </div>
          <div className={s.grid}>
            {other.map((v) => (
              <button key={v} type="button" className={cx(s.cut, cut?.cutType === v && s.cutOn)} onClick={() => pick(v)} title={v}>
                <CutIcon cutType={v} dir={dir ?? autoDir} size={26} />
                <span className={s.cutName}>{cutName(v)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={s.rows}>
        {cut && (
          <div className={s.row}>
            <span className={s.rowLabel}>Turn</span>
            <Segmented
              size="sm"
              options={[
                { value: "auto", label: "Auto" },
                { value: CUT_LEFT, label: "Left" },
                { value: CUT_RIGHT, label: "Right" },
              ]}
              value={dir === autoDir ? "auto" : (dir ?? "auto")}
              onChange={(v) => setCut(String(cut.cutType), v === "auto" ? autoDir : v)}
              aria-label="Cut direction"
            />
          </div>
        )}
        {speed !== undefined && (
          <div className={s.row}>
            <span className={s.rowLabel}>{next ? "Next leg speed" : "Leg speed"}</span>
            <Segmented
              size="sm"
              options={[...new Set([...SPEEDS, speed])].sort((a, b) => b - a).map((v) => ({ value: String(v), label: <span className={s.num}>{v}</span> }))}
              value={String(speed)}
              onChange={(v) => apply((r) => setLeg(r, speedLeg, { speed: Number(v) }), "Leg speed")}
              aria-label="Leg speed"
            />
          </div>
        )}
        <div className={s.actions}>
          {fake && (
            <Button size="sm" variant="danger" onClick={() => (apply((r) => removeFakeAt(r, k), "Remove fake-out"), onClose())} title="RunRouteFakeOut has no library instance, so it can't be built">
              Remove fake-out
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            icon="trash"
            onClick={() => {
              apply((r) => removeVertex(r, geom.start, k), "Delete point");
              d.setUi({ vertex: undefined });
              onClose();
            }}
          >
            Delete point
          </Button>
        </div>
      </div>
    </Floating>
  );
}
