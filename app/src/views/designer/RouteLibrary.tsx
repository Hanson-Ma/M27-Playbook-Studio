// Route library picker: every library assignment chain (filtered by AssignRouteType / name), drawn as MiniRoutes
// from the selected player's real alignment. Choosing one sets the slot to that assignment's path.
import { useMemo, useState } from "react";
import { MiniRoute } from "../../field";
import { assignmentPath, setSlotAssignment, slotSide } from "../../model/designer";
import { leaf } from "../../model/names";
import { hasMechanics } from "../../model/steps";
import { Modal, Select, TextInput, Toggle, VirtualGrid, cx } from "../../ui";
import { useDesigner } from "./shared";
import s from "./Inspector.module.css";

const rtLabel = (rt: string) => rt.replace(/^AssignRouteType_/, "").replace(/_/g, " ");

export function RouteLibrary({ slot, onClose }: { slot: number; onClose(): void }) {
  const d = useDesigner();
  const { lib, set, state } = d;
  const side = slotSide(state, slot);
  const current = lib.assignment(state.baseAssets[slot] ?? "")?.routeType;
  const [type, setType] = useState<string>(() => (current && /RR_/.test(current) ? current : "all"));
  const [q, setQ] = useState("");
  const [noMotion, setNoMotion] = useState(true);
  const [sel, setSel] = useState(0);

  const typeOptions = useMemo(
    () => [
      { value: "all", label: "All route types" },
      ...[...lib.assignmentsByRouteType.entries()]
        .filter(([rt]) => !/^AssignRouteType_(Def|K_|P_|ST_)/.test(rt))
        .sort((a, b) => rtLabel(a[0]).localeCompare(rtLabel(b[0])))
        .map(([rt, list]) => ({ value: rt, label: `${rtLabel(rt)} (${list.length})` })),
    ],
    [lib],
  );

  const list = useMemo(() => {
    const assets = type === "all" ? Object.keys(lib.data.assignments) : (lib.assignmentsByRouteType.get(type) ?? []);
    const query = q.trim().toLowerCase().replace(/\s+/g, "_");
    const sideWord = side === "left" ? /(Lt|Left)(_|$)/ : /(Rt|Right)(_|$)/;
    const otherWord = side === "left" ? /(Rt|Right)(_|$)/ : /(Lt|Left)(_|$)/;
    const out = assets.filter((asset) => {
      const a = lib.data.assignments[asset];
      if (!a || hasMechanics(a.steps)) return false;
      if (/Assignments\/(Defense|Kicker|Punter|Precan)\//.test(asset)) return false;
      if (noMotion && a.steps.some((st) => st.type === "AutoMotion" || st.type === "OverrideFormPos")) return false;
      if (query && !asset.toLowerCase().includes(query)) return false;
      return true;
    });
    // The side's own variants first (…Rt for a right-side player), then neutral ones, then the mirror ones.
    const rank = (asset: string) => (sideWord.test(leaf(asset)) ? 0 : otherWord.test(leaf(asset)) ? 2 : 1);
    return out.sort((a, b) => rank(a) - rank(b));
  }, [lib, type, q, noMotion, side]);

  const choose = (i: number) => {
    const asset = list[i];
    if (!asset) return;
    d.edit((st) => setSlotAssignment(st, lib, slot, assignmentPath(asset)), "Use game route");
    d.setUi((u) => {
      const presets = { ...u.presets };
      delete presets[slot];
      return { presets, vertex: undefined };
    });
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="Use a route from the game's plays"
      title="Game routes"
      width="xl"
      onConfirm={() => choose(sel)}
      confirmLabel="Use this route"
      confirmDisabled={!list.length}
      scopeId="designer.library"
      bodyClassName={s.libBody}
    >
      <div className={s.libBar}>
        <Select size="sm" value={type} options={typeOptions} onChange={(v) => (setType(v), setSel(0))} wrapperClassName={s.libType} />
        <TextInput size="sm" icon="search" value={q} onChange={(v) => (setQ(v), setSel(0))} placeholder="Filter by name…" clearable onClear={() => setQ("")} />
        <Toggle size="sm" checked={noMotion} onChange={(v) => (setNoMotion(v), setSel(0))} label="Hide routes with motion" />
        <span className={s.muted}>{list.length} routes · click one, then “Use this route” (or double-click)</span>
      </div>
      {list.length === 0 ? (
        <div className={s.legEmpty}>No routes match — try another route type or clear the filter.</div>
      ) : (
      <VirtualGrid
        count={list.length}
        cellWidth={150}
        cellHeight={176}
        gap={10}
        stretch
        selectedIndex={sel}
        onSelect={setSel}
        onActivate={choose}
        className={s.libGrid}
        renderCell={(i, { selected }) => {
          const asset = list[i];
          const a = lib.data.assignments[asset];
          return (
            <div className={cx(s.libTile, selected && s.libTileSel)} title={assignmentPath(asset)}>
              <MiniRoute set={set} slot={slot} steps={a.steps} size={118} primary={slot === d.vip} />
              <span className={s.libName}>{leaf(asset)}</span>
              <span className={s.libType2}>{rtLabel(a.routeType)}</span>
            </div>
          );
        }}
      />
      )}
    </Modal>
  );
}
