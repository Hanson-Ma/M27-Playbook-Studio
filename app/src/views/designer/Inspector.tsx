// Right pane: the selected player. Header (name, primary-receiver badge, one-click actions), where they line up,
// the handoff lock, then the tabs ROUTE · BLOCK · MOTION · ADVANCED (release details, raw steps, assignment info).
import { useMemo } from "react";
import {
  clearStartOverride,
  isSlotChanged,
  isSlotLocked,
  libraryStepTypes,
  precanChain,
  precanLength,
  resetSlot,
  setSlotSteps,
  startLock,
  startOverride,
  unbuildableReason,
  unbuildableSteps,
} from "../../model/designer";
import { canSaveRoute } from "../../model/routeLibrary";
import { isEligible, positionName, slotLabel } from "../../model/positions";
import { stepSummary } from "../../model/steps";
import { slotRoleLabel } from "../../model/designer";
import { href } from "../../state/router";
import { Button, EmptyState, Tag, cx } from "../../ui";
import { AdvancedTab } from "./AdvancedTab";
import { BlockTab } from "./BlockTab";
import { MotionTab } from "./MotionTab";
import { RouteTab } from "./RouteTab";
import { INSPECTOR_TABS, alignmentOf, lockOf, useDesigner } from "./shared";
import s from "./Inspector.module.css";

export function Inspector() {
  const { ui, setUi } = useDesigner();
  return (
    <div className={s.inspector}>
      <div className={s.tabsRow} role="tablist" aria-label="Player inspector">
        {INSPECTOR_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={ui.tab === t.id}
            title={t.title}
            className={cx(s.tab, ui.tab === t.id && s.tabOn, t.id === "advanced" && s.tabAdvanced)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setUi({ tab: t.id, vertex: ui.tab === t.id ? ui.vertex : undefined })}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className={s.scroll}>{ui.slot === undefined ? <NoSlot /> : <SlotInspector slot={ui.slot} />}</div>
    </div>
  );
}

function NoSlot() {
  return (
    <div className={s.empty}>
      <EmptyState
        compact
        icon="route"
        title="Pick a Player"
        body="Click a player on the field or in the row above it. Then choose a route, draw one point by point, set up blocking or motion — or right-click the player for quick actions."
      />
      <ol className={s.steps}>
        <li>
          <strong>Route</strong> — pick a ready-made route, one of My Routes, or draw your own.
        </li>
        <li>
          <strong>Primary receiver</strong> — the red route; one click in the player's header.
        </li>
        <li>
          <strong>Save</strong> — ⌘S / Ctrl+S, or Save at the top right, writes the plays file.
        </li>
      </ol>
    </div>
  );
}

function SlotInspector({ slot }: { slot: number }) {
  const d = useDesigner();
  const { state, set, ui } = d;
  const a = set.movements.Normal[slot];
  const lock = lockOf(state, ui, slot);
  const changed = isSlotChanged(state, slot);
  const lockedBase = isSlotLocked(state, slot);
  const role = slotRoleLabel(set, slot);
  const label = slotLabel(a.pos, a.depth);
  const steps = state.slots[slot].steps;
  const bad = unbuildableSteps(steps, d.lib);
  const eligible = isEligible(a);
  const primary = eligible && slot === d.vip;
  const canSave = lock !== null && canSaveRoute(steps, lock || undefined);

  return (
    <>
      <header className={s.slotHead}>
        <div className={s.slotTitles}>
          <div className={s.eyebrow}>
            {positionName(a.pos)} · Slot {slot}
          </div>
          <h2 className={s.slotTitle}>
            {label}
            {role !== label && <span className={s.role}>{role}</span>}
          </h2>
        </div>
        <div className={s.slotTags}>
          {primary && (
            <Tag tone="danger" size="sm" title="The primary receiver's route is drawn red: the QB's first look">
              Primary Receiver
            </Tag>
          )}
          {changed && (
            <Tag tone="custom" size="sm" title="Different from the base play">
              Changed
            </Tag>
          )}
          {lockedBase && (
            <Tag tone="needsMod" size="sm" icon="lock" title="Handoff player: the handoff steps come from the base play">
              Handoff
            </Tag>
          )}
          {bad.length > 0 && (
            <Tag tone="danger" size="sm" icon="warning" title={bad.map((b) => unbuildableReason(b.type)).join("\n")}>
              Can't Build
            </Tag>
          )}
        </div>
      </header>

      <div className={s.quickRow}>
        {eligible && !primary && (
          <Button size="sm" variant="secondary" onClick={() => d.makePrimary(slot)} title="Make this player's route the red one (the QB's first look)">
            <span className={s.redDot} aria-hidden /> Make Primary Receiver
          </Button>
        )}
        {canSave && (
          <Button size="sm" variant="secondary" icon="star" onClick={() => d.saveRoute(slot)} title="Keep this route to reuse it on any play and player">
            Save Route to My Routes
          </Button>
        )}
        {changed && (
          <Button size="sm" variant="ghost" icon="undo" onClick={() => d.edit((st) => resetSlot(st, slot), "Reset player")} title="Back to what this player does in the base play">
            Reset Player
          </Button>
        )}
      </div>

      {bad.length > 0 && <BuildError slot={slot} types={[...new Set(bad.map((b) => b.type))]} />}
      <StartSpot slot={slot} />
      {lockedBase && <LockPanel slot={slot} lock={lock} />}
      {lock === null ? (
        <div className={s.lockedBody}>
          <div className={s.sectionTitle}>What This Player Does (Locked)</div>
          <ol className={s.summary}>
            {steps
              .filter((x) => x.type !== "None")
              .map((x, i) => (
                <li key={i}>{stepSummary(x)}</li>
              ))}
          </ol>
        </div>
      ) : ui.tab === "route" ? (
        <RouteTab slot={slot} lock={lock} />
      ) : ui.tab === "block" ? (
        <BlockTab slot={slot} lock={lock} />
      ) : ui.tab === "motion" ? (
        <MotionTab slot={slot} lock={lock} />
      ) : (
        <AdvancedTab slot={slot} lock={lock} />
      )}
    </>
  );
}

/** Where the player lines up: the formation spot (fixed), or a spot moved for this play only (OverrideFormPos). */
function StartSpot({ slot }: { slot: number }) {
  const d = useDesigner();
  const { state, set, ui, setUi } = d;
  const lockInfo = useMemo(() => startLock(state, slot), [state, slot]);
  const home = alignmentOf(set, slot);
  const moved = startOverride(state.slots[slot].steps);
  const xy = (p: { x: number; y: number }) => <span className={s.num}>{`${p.x.toFixed(1)}, ${p.y.toFixed(1)}`}</span>;
  const formations = <a href={href("formations")}>Formations</a>;
  if (!lockInfo.movable) {
    if (lockInfo.reason === "mechanics") return null; // the handoff panel explains it
    return (
      <p className={s.spotNote}>
        <span className={s.spotIcon} aria-hidden>
          ⌖
        </span>
        <span>
          {lockInfo.reason === "line"
            ? "Linemen line up where the formation puts them. Change splits in "
            : lockInfo.reason === "qb"
              ? "The QB's spot comes from the formation (under center, pistol or shotgun). Change it in "
              : "This player's spot comes from the formation. Change it in "}
          {formations}.
        </span>
      </p>
    );
  }
  return (
    <div className={cx(s.spot, (moved || ui.moveStart === slot) && s.spotOn)}>
      <div className={s.spotText}>
        <span className={s.spotIcon} aria-hidden>
          ⌖
        </span>
        {moved ? (
          <span>
            <strong>Moved for this play:</strong> lines up at {xy(moved)} instead of {xy(home)}. Drag the ring on the field to adjust.
          </span>
        ) : ui.moveStart === slot ? (
          <span>Drag the ring on the field to where this player lines up in this play.</span>
        ) : (
          <span>
            Lines up where the formation puts them ({xy(home)}). To move them in every play, edit the set in {formations}.
          </span>
        )}
      </div>
      <div className={s.spotActions}>
        {moved ? (
          <Button size="sm" variant="ghost" icon="undo" onClick={() => (d.edit((st) => clearStartOverride(st, slot), "Reset start spot"), setUi({ moveStart: undefined }))}>
            Reset to Formation Spot
          </Button>
        ) : ui.moveStart === slot ? (
          <Button size="sm" variant="ghost" onClick={() => setUi({ moveStart: undefined })}>
            Cancel
          </Button>
        ) : (
          <Button size="sm" variant="ghost" icon="drag" onClick={() => setUi({ moveStart: slot, vertex: undefined, drawing: false })}>
            Move This Player for This Play Only
          </Button>
        )}
      </div>
    </div>
  );
}

/** The slot carries step types the game-side builder can't author (e.g. a loaded RunRouteFakeOut). */
function BuildError({ slot, types }: { slot: number; types: string[] }) {
  const d = useDesigner();
  const remove = () =>
    d.edit((st) => {
      const known = libraryStepTypes(d.lib);
      const steps = st.slots[slot]?.steps ?? [];
      return setSlotSteps(st, slot, steps.filter((x) => known.has(x.type)));
    }, "Remove unbuildable steps");
  return (
    <div className={s.buildError} role="alert">
      <div className={s.buildErrorTitle}>Can't Build This Player's Assignment</div>
      <p className={s.note}>
        {types.join(", ")} {types.length > 1 ? "have" : "has"} no example in the game's library, so the game-side builder can't make {types.length > 1 ? "them" : "it"} and the
        export would stop. Remove {types.length > 1 ? "them" : "it"} (a double move can use a cut such as Stutter or Slant-and-Go instead).
      </p>
      <div className={s.buildErrorActions}>
        <Button size="sm" variant="danger" icon="trash" onClick={remove}>
          Remove {types.length > 1 ? "These Steps" : types[0]}
        </Button>
      </div>
    </div>
  );
}

function LockPanel({ slot, lock }: { slot: number; lock: number | null }) {
  const d = useDesigner();
  const chain = precanChain(d.state, slot);
  const n = precanLength(chain);
  const precan = chain.slice(0, n).map(stepSummary).join(" → ");
  return (
    <div className={cx(s.lockPanel, lock !== null && s.lockOpen)}>
      <div className={s.lockTitle}>{lock === null ? "Handoff Player — Locked" : "Editing After the Handoff"}</div>
      <p className={s.note}>
        This player's first steps ({precan || "the handoff"}) are paired with the QB — a handoff, fake, option or pitch — so they always come from the base play, and so
        does where they line up. To change the handoff itself, pick another base play or use Backfield Action on the left.
        {lock === null ? " You can still change what this player does after it." : " What happens after it is yours to change."}
      </p>
      {lock === null ? (
        <Button size="sm" icon="unlock" onClick={() => d.setUi((u) => ({ unlocked: { ...u.unlocked, [slot]: n }, drawing: false }))}>
          Edit What Happens After the Handoff
        </Button>
      ) : d.ui.unlocked[slot] === undefined ? null : (
        <Button
          size="sm"
          variant="ghost"
          icon="lock"
          onClick={() =>
            d.setUi((u) => {
              const unlocked = { ...u.unlocked };
              delete unlocked[slot];
              return { unlocked, vertex: undefined, drawing: false };
            })
          }
        >
          Lock Again
        </Button>
      )}
    </div>
  );
}
