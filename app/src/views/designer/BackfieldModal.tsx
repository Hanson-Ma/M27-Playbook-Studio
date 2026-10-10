// "Backfield action": take the QB, the back(s) and the line of another play — a different handoff, a play-action fake, a
// dropback — and see the result on this play's own alignment before using it (see model/backfield.ts). Presets name the
// common ones, FUSION lists the ones only FUSION has, Custom is every play in the game and in FUSION that fits.
import { useMemo, useState } from "react";
import { Field, PlayArtLayer } from "../../field";
import { computeArt, emptyArt } from "../../model/art";
import { BACKFIELD_PRESETS, applyBackfieldAction, backfieldActions, presetFits, type BackfieldAction } from "../../model/backfield";
import { effectiveField } from "../../model/designer";
import { norm } from "../../model/names";
import { playTypeInfo, type PlayFamily } from "../../model/playtypes";
import { useSettings } from "../../state/settings";
import { Button, EmptyState, Icon, IconButton, Modal, PlayTypeTag, Segmented, Tag, TextInput, VirtualList, cx } from "../../ui";
import { playSetLabel } from "../formations/setModel";
import s from "../formations/ClonePlays.module.css";
import { useDesigner } from "./shared";

type Tab = "presets" | "fusion" | "custom";
type Filter = "all" | "run" | "pa" | "pass";
const PREVIEW_VIEWPORT = { minX: -27, maxX: 27, minY: -10, maxY: 22 };

const filterOf = (f: PlayFamily): Filter => (f === "run" || f === "option" ? "run" : f === "pa" || f === "rpo" ? "pa" : "pass");

/** One row of the list: a preset (its fitting packages are the variants) or a single package. */
interface Item {
  id: string;
  title: string;
  sub: string;
  playType?: string;
  group?: string;
  actions: BackfieldAction[];
}

export function BackfieldModal({ onClose }: { onClose(): void }) {
  const d = useDesigner();
  const { state, catalog, set, lib } = d;
  const ballSpot = useSettings((st) => st.ballSpot);
  const actions = useMemo(() => backfieldActions(state, catalog), [state, catalog]);
  const [tab, setTab] = useState<Tab>("presets");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<string | undefined>();
  const [variant, setVariant] = useState(0);

  const fusion = useMemo(() => actions.filter((a) => a.fusion), [actions]);
  const items = useMemo<Item[]>(() => {
    const words = norm(query).split(" ").filter(Boolean);
    const matches = (text: string) => words.every((w) => norm(text).includes(w));
    if (tab === "presets") {
      const fits = presetFits(actions);
      return BACKFIELD_PRESETS.filter((p) => matches(p.label)).map((p) => {
        const a = fits.get(p.id) ?? [];
        return { id: p.id, title: p.label, group: p.group, sub: a.length ? `${a[0].play.name} · ${a.length} way${a.length === 1 ? "" : "s"} to run it` : "Nothing fits these spots", actions: a };
      });
    }
    const pool = tab === "fusion" ? fusion : actions;
    return pool
      .filter((a) => (tab === "custom" && filter !== "all" ? filterOf(a.family) === filter : true))
      .filter((a) => matches(a.plays.map((p) => `${p.name} ${playSetLabel(lib, p)}`).join(" ")))
      .map((a) => {
        const more = a.plays.length - 1;
        return { id: a.key, title: a.play.name, playType: a.playType, sub: `${playSetLabel(lib, a.play)}${more > 0 ? ` · +${more} more play${more === 1 ? "" : "s"} like it` : ""}`, actions: [a] };
      });
  }, [tab, actions, fusion, filter, query, lib]);

  const found = items.findIndex((i) => i.id === cursor);
  const sel = found >= 0 ? found : items.length ? 0 : -1;
  const item: Item | undefined = sel >= 0 ? items[sel] : undefined;
  const current: BackfieldAction | undefined = item?.actions[Math.min(variant, Math.max(0, item.actions.length - 1))];

  const result = useMemo(() => (current ? applyBackfieldAction(state, current, catalog) : undefined), [current, state, catalog]);
  const art = useMemo(() => {
    if (!result) return emptyArt();
    try {
      return computeArt(set, result.slots.map((sl) => sl.steps), { vip: effectiveField<number>(result, "vip"), runHole: effectiveField<number>(result, "runHole"), side: "offense" });
    } catch {
      return emptyArt();
    }
  }, [result, set]);

  const use = (a: BackfieldAction | undefined) => {
    if (!a) return;
    d.edit((st) => applyBackfieldAction(st, a, catalog), "Backfield action");
    onClose();
  };
  const was = playTypeInfo(String(effectiveField(state, "playType"))).label;
  const emptyNote =
    tab === "fusion"
      ? { title: "No FUSION Packages Fit These Spots", body: "FUSION's own handoffs and fakes are timed to its sets' spots for the QB and back." }
      : { title: actions.length ? "Nothing Matches" : "Nothing Fits These Spots", body: actions.length ? undefined : "The QB and the backs have to line up on the spots the handoff was timed for." };

  return (
    <Modal open onClose={onClose} eyebrow="Backfield Action" title="Take the Handoff, Fake or Dropback From Another Play" width={1200} footer={null} scopeId="designer.backfield" bodyClassName={s.body}>
      <div className={s.layout}>
        <div className={s.left}>
          <div className={s.tools}>
            <Segmented<Tab>
              size="sm"
              value={tab}
              onChange={(t) => {
                setTab(t);
                setCursor(undefined);
                setVariant(0);
              }}
              options={[
                { value: "presets", label: "Presets" },
                { value: "fusion", label: `FUSION · ${fusion.length}`, title: "Handoffs and fakes only FUSION has" },
                { value: "custom", label: `Custom · ${actions.length}`, title: "Every play in the game and in FUSION that fits these spots" },
              ]}
              aria-label="Where to pick from"
            />
          </div>
          {tab === "custom" && (
            <div className={s.tools}>
              <Segmented<Filter>
                size="sm"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "All" },
                  { value: "run", label: "Run" },
                  { value: "pa", label: "Play Action" },
                  { value: "pass", label: "Pass" },
                ]}
                aria-label="Kind of play"
              />
            </div>
          )}
          {tab !== "presets" && (
            <div className={s.tools}>
              <TextInput value={query} onChange={setQuery} icon="search" placeholder="Search plays or sets…" clearable size="sm" autoFocus aria-label="Search backfield actions" />
            </div>
          )}
          <VirtualList
            className={s.list}
            count={items.length}
            rowHeight={54}
            selectedIndex={sel}
            onSelect={(i) => {
              setCursor(items[i].id);
              setVariant(0);
            }}
            onActivate={(i) => use(items[i].actions[0])}
            getKey={(i) => items[i].id}
            empty={<EmptyState compact icon="search" title={emptyNote.title} body={emptyNote.body} />}
            aria-label="Backfield actions"
            renderRow={(i) => {
              const it = items[i];
              const none = !it.actions.length;
              return (
                <div className={cx(s.row, i === sel && s.rowOn)} style={none ? { opacity: 0.45 } : undefined}>
                  <div className={s.rowText}>
                    <span className={s.rowName}>{it.title}</span>
                    <span className={s.rowSub}>{it.sub}</span>
                  </div>
                  {it.group && (
                    <Tag size="sm" tone="neutral" variant="outline">
                      {it.group}
                    </Tag>
                  )}
                  {it.playType && <PlayTypeTag playType={it.playType} size="sm" />}
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
                  <div className={s.previewName}>{item?.title ?? current.play.name}</div>
                  <div className={s.previewSub}>
                    {current.play.name} · {playSetLabel(lib, current.play)}
                    {current.fusion ? " · FUSION" : ""}
                  </div>
                </div>
                {item && item.actions.length > 1 && (
                  <div className={s.tools}>
                    <IconButton icon="chevronLeft" size="sm" title="Previous way" onClick={() => setVariant((v) => (v + item.actions.length - 1) % item.actions.length)} />
                    <span className={s.hint}>
                      {variant + 1} of {item.actions.length}
                    </span>
                    <IconButton icon="chevronRight" size="sm" title="Next way" onClick={() => setVariant((v) => (v + 1) % item.actions.length)} />
                  </div>
                )}
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
            <EmptyState compact icon="field" title={item ? "Nothing Fits These Spots" : "Pick an Action to Preview It"} body={item ? "No play in the game has this handoff with the QB and backs on these spots." : undefined} />
          )}
          <div className={s.rightFoot}>
            <span className={s.hint}>Undo brings your old backfield back.</span>
            <span className={s.grow} />
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" icon="check" disabled={!current} onClick={() => use(current)}>
              Use This Action
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
