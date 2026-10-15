// Step 3 — the set's audibles, listed like the in-game panel: X, Y, LB, RB top to bottom (per settings.audibleButtons),
// each row a play preview and the play's name, drawn in the user's audible style (Xbox / PS5 / Keyboard — the switch sits
// right here). Select a play, then click a row; or drag a card onto a row. One play per slot (assignAudible).
import { memo, useMemo } from "react";
import { AudibleStyleSwitch } from "../../input/AudibleStyleSwitch";
import { AudibleGlyph } from "../../input/glyphs";
import { artForPlay } from "../../model/art";
import { audibleListOrder } from "../../model/audibles";
import type { AudibleSlot, ResolvedPlay } from "../../model/types";
import { Field, PlayArtLayer, cardViewport } from "../../field";
import { useSettings } from "../../state/settings";
import { HelpLink, IconButton, cx } from "../../ui";
import { useBuilder, type BookNode } from "./context";
import { setAudibleAt } from "./ops";
import { useBuilderUi } from "./store";
import s from "./AudiblePanel.module.css";

export function AudiblePanel({ setNode }: { setNode: BookNode }) {
  const data = useBuilder();
  const buttons = useSettings((st) => st.audibleButtons);
  const cursor = useBuilderUi((st) => st.cursor);
  const rs = setNode.rs!;
  const ref = setNode.ref!;
  const cursorNode = data.nodes.get(cursor);
  const cursorInSet = cursorNode?.level === "play" && cursorNode.ref?.f === ref.f && cursorNode.ref?.s === ref.s ? cursorNode : undefined;
  const sIds = data.ids.formations[ref.f]?.sets[ref.s!];

  const bySlot = new Map<AudibleSlot, number>();
  rs.plays.forEach((p, i) => {
    const a = p.entry.audible;
    if (a && [1, 2, 3, 4].includes(a) && !bySlot.has(a)) bySlot.set(a, i);
  });
  const selName = cursorInSet ? String(cursorInSet.rp?.entry.play) : undefined;
  const selSlot = cursorInSet?.rp?.entry.audible;

  return (
    <section className={s.wrap} aria-label="Audibles">
      <div className={s.head}>
        <h3 className={s.h3}>Audibles</h3>
        <span className={s.count}>{bySlot.size}/4</span>
        <HelpLink section="audibles" label="How Audibles Work" className={s.help} />
      </div>
      <div className={s.styleRow}>
        <span className={s.styleLabel}>Show As</span>
        <AudibleStyleSwitch size="sm" />
      </div>
      <div className={s.list}>
        {audibleListOrder(buttons).map((slot) => {
          const pi = bySlot.get(slot);
          const rp = pi === undefined ? undefined : rs.plays[pi];
          const pid = pi === undefined ? undefined : sIds?.plays[pi];
          const isCursorPlay = !!pid && pid === cursor;
          const action = cursorInSet
            ? selSlot === slot
              ? `Clear ${selName}'s audible`
              : `Make ${selName} the ${buttons[slot]} audible`
            : rp
              ? `Select ${String(rp.entry.play)}`
              : "Select a play first, then click here";
          return (
            <div
              key={slot}
              className={cx(s.slot, rp && s.slotFilled, isCursorPlay && s.slotCursor, cursorInSet && !isCursorPlay && s.slotTarget)}
              data-drop="audible"
              data-drop-id={`${setNode.id}|${slot}`}
              role="button"
              tabIndex={0}
              title={`${buttons[slot]} — ${action}`}
              onClick={() => {
                if (cursorInSet?.ref) setAudibleAt(data, cursorInSet.ref, selSlot === slot ? undefined : slot);
                else if (pid) useBuilderUi.getState().select(pid);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.currentTarget.click();
                }
              }}
            >
              <span className={s.slotGlyph}>
                <AudibleGlyph slot={slot} size="md" />
              </span>
              {rp?.play ? <MiniArt play={rp.play} /> : <div className={s.miniArt} />}
              <div className={s.slotText}>
                {rp ? <div className={s.slotName}>{String(rp.entry.play)}</div> : <div className={s.slotEmpty}>Empty</div>}
              </div>
              {rp && (
                <IconButton
                  icon="close"
                  title="Clear this audible"
                  size="sm"
                  className={s.slotClear}
                  onClick={(e) => {
                    e.stopPropagation();
                    setAudibleAt(data, { f: ref.f, s: ref.s, p: pi }, undefined);
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      <p className={s.hint}>
        {cursorInSet
          ? selSlot
            ? <><span className="caps">{selName}</span> is the {buttons[selSlot as AudibleSlot]} audible. Click another row to move it, or the same one to clear it.</>
            : <>Click a row to make <span className="caps">{selName}</span> that audible.</>
          : "Select a play of this set (or drag its card here), then click a row. One play per button."}
      </p>
    </section>
  );
}

const MiniArt = memo(function MiniArt({ play }: { play: ResolvedPlay }) {
  const data = useBuilder();
  const art = useMemo(() => {
    try {
      return artForPlay(data.catalog, play);
    } catch {
      return undefined;
    }
  }, [data.catalog, play]);
  return (
    <div className={s.miniArt}>
      {art && (
        <Field viewport={cardViewport(play.side)} fit="cover" markings="minimal" className={s.miniField} label={`${play.name} art`}>
          <PlayArtLayer art={art} compact showLabels={false} />
        </Field>
      )}
    </div>
  );
});
