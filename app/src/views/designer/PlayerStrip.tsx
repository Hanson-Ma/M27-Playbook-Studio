// Player strip above the field: every player as a chip (receivers left to right, then the QB, then the line) —
// click to select, right-click for the player menu. Marks: red dot = primary receiver (red route), lock = handoff
// player, blue dot = changed from the base play, "moved" = lines up somewhere else in this play.
import { useMemo } from "react";
import { isSlotChanged, isSlotLocked, startOverride } from "../../model/designer";
import { isEligible, isOffensiveLine, positionCode, slotLabel } from "../../model/positions";
import { slotRoleLabel } from "../../model/designer";
import { Icon, cx } from "../../ui";
import { useDesigner, type EditorUi } from "./shared";
import s from "./PlayerStrip.module.css";

export function PlayerStrip() {
  const d = useDesigner();
  const { set, state, ui, setUi } = d;
  const normal = set.movements.Normal;
  const groups = useMemo(() => {
    const idx = normal.map((_, i) => i);
    const byX = (a: number, b: number) => normal[a].x - normal[b].x;
    const elig = idx.filter((i) => isEligible(normal[i])).sort(byX);
    const line = idx.filter((i) => isOffensiveLine(normal[i].pos)).sort(byX);
    const rest = idx.filter((i) => !elig.includes(i) && !line.includes(i)).sort(byX);
    return [
      { id: "skill", label: "Receivers & backs", slots: elig },
      { id: "qb", label: "QB", slots: rest },
      { id: "line", label: "Line", slots: line },
    ].filter((g) => g.slots.length);
  }, [normal]);

  const select = (slot: number) => {
    if (slot === ui.slot) return;
    const eligible = isEligible(normal[slot]);
    const tab: EditorUi["tab"] = !eligible && ui.tab === "route" ? "block" : eligible && ui.tab === "block" && !isOffensiveLine(normal[slot].pos) ? "route" : ui.tab;
    setUi({ slot, vertex: undefined, moveStart: undefined, tab, drawing: false });
  };

  return (
    <div className={s.strip} role="toolbar" aria-label="Players">
      {groups.map((g) => (
        <div key={g.id} className={cx(s.group, g.id === "line" && s.line)}>
          {g.slots.map((slot) => {
            const a = normal[slot];
            const label = slotLabel(a.pos, a.depth);
            const role = slotRoleLabel(set, slot);
            const on = ui.slot === slot;
            const primary = slot === d.vip && isEligible(a);
            const locked = isSlotLocked(state, slot);
            const changed = isSlotChanged(state, slot);
            const moved = !!startOverride(state.slots[slot]?.steps ?? []);
            const tip = [
              `${label}${role !== label ? ` (${role})` : ""} — slot ${slot}`,
              primary ? "Primary receiver: red route" : "",
              locked ? "Handoff player: their handoff steps are locked" : "",
              changed ? "Changed from the base play" : "",
              moved ? "Lines up somewhere else in this play" : "",
              "Right-click for more",
            ]
              .filter(Boolean)
              .join("\n");
            return (
              <button
                key={slot}
                type="button"
                className={cx(s.chip, on && s.on, primary && s.primary, positionCode(a.pos) === "QB" && s.qb)}
                onClick={() => select(slot)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  select(slot);
                  d.openPlayerMenu(slot, { x: e.clientX, y: e.clientY });
                }}
                title={tip}
                aria-pressed={on}
              >
                {primary && <span className={s.red} aria-label="Primary receiver" />}
                <span className={s.label}>{label}</span>
                {role !== label && g.id !== "line" && <span className={s.role}>{role}</span>}
                {locked && <Icon name="lock" size={12} className={s.lock} />}
                {moved && <span className={s.moved}>moved</span>}
                {changed && !locked && <span className={s.changed} aria-label="Changed" />}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
