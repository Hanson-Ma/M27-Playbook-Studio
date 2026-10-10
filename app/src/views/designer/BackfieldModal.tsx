// "Backfield action": take the QB, the back(s) and the line of another play — a different handoff, a play-action fake, a
// dropback — and see the result on this play's own alignment before using it (see model/backfield.ts).
import { useMemo, useState } from "react";
import { Field, PlayArtLayer } from "../../field";
import { computeArt, emptyArt } from "../../model/art";
import { applyBackfieldAction, backfieldActions, type BackfieldAction } from "../../model/backfield";
import { effectiveField } from "../../model/designer";
import { norm } from "../../model/names";
import { playTypeInfo, type PlayFamily } from "../../model/playtypes";
import { useSettings } from "../../state/settings";
import { Button, EmptyState, Icon, Modal, PlayTypeTag, Segmented, TextInput, VirtualList, cx } from "../../ui";
import { playSetLabel } from "../formations/setModel";
import s from "../formations/ClonePlays.module.css";
import { useDesigner } from "./shared";

type Filter = "all" | "run" | "pa" | "pass";
const PREVIEW_VIEWPORT = { minX: -27, maxX: 27, minY: -10, maxY: 22 };

const filterOf = (f: PlayFamily): Filter => (f === "run" || f === "option" ? "run" : f === "pa" || f === "rpo" ? "pa" : "pass");

export function BackfieldModal({ onClose }: { onClose(): void }) {
  const d = useDesigner();
  const { state, catalog, set, lib } = d;
  const ballSpot = useSettings((st) => st.ballSpot);
  const actions = useMemo(() => backfieldActions(state, catalog), [state, catalog]);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<string | undefined>();

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: actions.length, run: 0, pa: 0, pass: 0 };
    for (const a of actions) c[filterOf(a.family)]++;
    return c;
  }, [actions]);
  const list = useMemo(() => {
    const words = norm(query).split(" ").filter(Boolean);
    return actions.filter((a) => {
      if (filter !== "all" && filterOf(a.family) !== filter) return false;
      if (!words.length) return true;
      const hay = a.plays.map((p) => `${norm(p.name)} ${norm(playSetLabel(lib, p))}`).join(" ");
      return words.every((w) => hay.includes(w));
    });
  }, [actions, filter, query, lib]);
  const found = list.findIndex((a) => a.key === cursor);
  const sel = found >= 0 ? found : list.length ? 0 : -1;
  const current: BackfieldAction | undefined = sel >= 0 ? list[sel] : undefined;

  const result = useMemo(() => (current ? applyBackfieldAction(state, current, catalog) : undefined), [current, state, catalog]);
  const art = useMemo(() => {
    if (!result) return emptyArt();
    try {
      return computeArt(set, result.slots.map((sl) => sl.steps), { vip: effectiveField<number>(result, "vip"), runHole: effectiveField<number>(result, "runHole"), side: "offense" });
    } catch {
      return emptyArt();
    }
  }, [result, set]);

  const use = (a: BackfieldAction) => {
    d.edit((st) => applyBackfieldAction(st, a, catalog), "Backfield action");
    onClose();
  };
  const was = playTypeInfo(String(effectiveField(state, "playType"))).label;

  return (
    <Modal open onClose={onClose} eyebrow="Backfield Action" title="Take the Handoff, Fake or Dropback From Another Play" width={1200} footer={null} scopeId="designer.backfield" bodyClassName={s.body}>
      <div className={s.layout}>
        <div className={s.left}>
          <div className={s.tools}>
            <Segmented<Filter>
              size="sm"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: `All · ${counts.all}` },
                { value: "run", label: `Run · ${counts.run}` },
                { value: "pa", label: `Play Action · ${counts.pa}` },
                { value: "pass", label: `Pass · ${counts.pass}` },
              ]}
              aria-label="Kind of play"
            />
          </div>
          <div className={s.tools}>
            <TextInput value={query} onChange={setQuery} icon="search" placeholder="Search plays or sets…" clearable size="sm" autoFocus aria-label="Search backfield actions" />
          </div>
          <VirtualList
            className={s.list}
            count={list.length}
            rowHeight={54}
            selectedIndex={sel}
            onSelect={(i) => setCursor(list[i].key)}
            onActivate={(i) => use(list[i])}
            getKey={(i) => list[i].key}
            empty={
              <EmptyState
                compact
                icon="search"
                title={actions.length ? "No Actions Match" : "Nothing in the Library Fits These Spots"}
                body={actions.length ? undefined : "The QB and the backs have to line up on the spots the handoff was timed for."}
              />
            }
            aria-label="Backfield actions"
            renderRow={(i) => {
              const a = list[i];
              const more = a.plays.length - 1;
              return (
                <div className={cx(s.row, i === sel && s.rowOn)}>
                  <div className={s.rowText}>
                    <span className={s.rowName}>{a.play.name}</span>
                    <span className={s.rowSub}>
                      <span className="caps">{playSetLabel(lib, a.play)}</span>
                      {more > 0 ? ` · +${more} more play${more === 1 ? "" : "s"} like it` : ""}
                    </span>
                  </div>
                  <PlayTypeTag playType={a.playType} size="sm" />
                </div>
              );
            }}
          />
        </div>
        <div className={s.right}>
          {current ? (
            <div className={s.preview}>
              <div className={s.previewHead}>
                <div>
                  <div className={s.previewName}>{current.play.name}</div>
                  <div className={s.previewSub}>Your play with this action</div>
                </div>
              </div>
              <div className={s.previewField}>
                <Field viewport={PREVIEW_VIEWPORT} ballSpot={ballSpot} label="Preview with this backfield action">
                  <PlayArtLayer art={art} showLabels />
                </Field>
              </div>
              <div className={s.safe}>
                <Icon name="check" size={14} /> Replaces the QB, the backs and the line. Play type: {was} → {playTypeInfo(current.playType).label}.
                {current.reads ? " Reads and primary receiver come with it." : ""} Your receivers' routes stay as they are.
              </div>
            </div>
          ) : (
            <EmptyState compact icon="field" title="Pick an Action to Preview It" />
          )}
          <div className={s.rightFoot}>
            <span className={s.hint}>Undo brings your old backfield back.</span>
            <span className={s.grow} />
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" icon="check" disabled={!current} onClick={() => current && use(current)}>
              Use This Action
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
