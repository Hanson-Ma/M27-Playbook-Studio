// "Plays in this set": copy (clone) library plays into the custom set — from its starting set by default, or from any
// set (searchable). Checked plays get an auto name/asset; each play shows the assignments that won't follow your new
// spots (handoff precans, pulls, blocks, absolute motions, fixed starting spots keep the play's original coordinates —
// SetBuilder note), a preview on your alignment, the primary receiver (red route) and "Customize this clone", which
// opens the designer with a new custom play based on the clone.
import { useMemo, useState } from "react";
import { Field, PlayArtLayer } from "../../field";
import { computeArt, emptyArt } from "../../model/art";
import type { LibraryIndex } from "../../model/library";
import { leaf, norm } from "../../model/names";
import { isEligible } from "../../model/positions";
import { cloneEntries, effectiveSet, isValidAsset, playerLabel } from "../../model/sets";
import type { AlignmentPos, CustomFormationSpec, CustomSetSpec, PlayArt, PlayDef, PlaysFile, SetDef } from "../../model/types";
import { useCatalog } from "../../state/library";
import { navigate } from "../../state/router";
import { useSettings } from "../../state/settings";
import { useDocsOfKind } from "../../state/workspace";
import { Button, Checkbox, EmptyState, FormRow, Icon, Modal, PlayTypeTag, Segmented, Select, TextInput, VirtualList, cx, toast } from "../../ui";
import { Advanced } from "./Common";
import { clonableLibraryPlays, cloneKey, cloneWarnings, customSetPath, playSetLabel, type CloneWarning } from "./setModel";
import s from "./ClonePlays.module.css";

type Source = "base" | "all";

const MY_PLAYS = "playbooks/plays/my-plays.json";
type Filter = "all" | "checked" | "safe" | "warn";

export interface ClonePlaysModalProps {
  lib: LibraryIndex;
  base: SetDef;
  spec: CustomSetSpec;
  formations?: CustomFormationSpec[];
  /** The custom set's effective alignment. */
  normal: AlignmentPos[];
  update(fn: (d: CustomSetSpec) => void, label: string, coalesceMs?: number): void;
  onClose(): void;
}

export function ClonePlaysModal(p: ClonePlaysModalProps) {
  const count = Array.isArray(p.spec.plays) ? p.spec.plays.length : 0;
  return (
    <Modal
      open
      onClose={p.onClose}
      eyebrow={
        <>
          {p.spec.name ? <span className="caps">{p.spec.name}</span> : "Custom Set"} · Copy Plays From Any Set
        </>
      }
      title={`Plays in This Set · ${count}`}
      width={1200}
      footer={null}
      scopeId="formations.plays"
      bodyClassName={s.body}
    >
      <ClonePlays {...p} />
    </Modal>
  );
}

function ClonePlays({ lib, base, spec, formations, normal, update, onClose }: ClonePlaysModalProps) {
  const prefix = useSettings((st) => st.assetPrefix);
  const entries = useMemo(() => (Array.isArray(spec.plays) ? spec.plays : []), [spec.plays]);
  const checkedIdx = useMemo(() => {
    const m = new Map<string, number>();
    entries.forEach((e, i) => e?.from && !m.has(e.from) && m.set(e.from, i));
    return m;
  }, [entries]);

  const [source, setSource] = useState<Source>("base");
  const basePlays = useMemo(() => lib.playsBySet.get(base.asset) ?? [], [lib, base]);
  const allPlays = useMemo(() => (source === "all" ? clonableLibraryPlays(lib) : []), [lib, source]);
  // Plays already in the set that come from other sets stay visible in the starting-set view (checked, at the end).
  const pool = useMemo(() => {
    if (source === "all") return allPlays;
    const extra = entries.flatMap((e) => (e?.from && !basePlays.some((p) => p.asset === e.from) ? [lib.playByAsset.get(e.from)].filter((x): x is PlayDef => !!x) : []));
    return [...basePlays, ...extra];
  }, [source, allPlays, basePlays, entries, lib]);

  // Warnings are computed lazily (the "all sets" pool has thousands of plays) and cached per alignment.
  const warnCache = useMemo(() => new Map<string, CloneWarning[]>(), [normal]); // eslint-disable-line react-hooks/exhaustive-deps
  const warningsOf = (pl: PlayDef): CloneWarning[] => {
    let w = warnCache.get(pl.asset);
    if (!w) {
      w = cloneWarnings(lib, pl, normal);
      warnCache.set(pl.asset, w);
    }
    return w;
  };

  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const list = useMemo(() => {
    // Every word must match the play name, its asset leaf or (all sets) its formation / set: "bunch mesh".
    const words = norm(query).split(" ").filter(Boolean);
    return pool.filter((pl) => {
      if (words.length) {
        const hay = `${norm(pl.name)} ${norm(leaf(pl.asset))}${source === "all" ? ` ${norm(playSetLabel(lib, pl))}` : ""}`;
        if (!words.every((w) => hay.includes(w))) return false;
      }
      if (filter === "checked") return checkedIdx.has(pl.asset);
      if (filter === "safe") return warningsOf(pl).length === 0;
      if (filter === "warn") return warningsOf(pl).length > 0;
      return true;
    });
    // warningsOf reads warnCache (memoized on normal).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, query, filter, checkedIdx, warnCache, source, lib]);
  const [cursorAsset, setCursorAsset] = useState<string | undefined>(() => entries[0]?.from ?? basePlays[0]?.asset);
  const found = list.findIndex((pl) => pl.asset === cursorAsset);
  const sel = found >= 0 ? found : list.length ? 0 : -1;
  const current = sel >= 0 ? list[sel] : undefined;

  const toggle = (pl: PlayDef) =>
    update((d) => {
      if ((d.plays ?? []).some((e) => e?.from === pl.asset)) {
        d.plays = (d.plays ?? []).filter((e) => e?.from !== pl.asset);
        if (!d.plays.length) delete d.plays;
      } else {
        const [entry] = cloneEntries([pl], d, prefix);
        (d.plays ??= []).push(entry);
      }
    }, "Plays in set");

  const addAll = (want: PlayDef[]) =>
    update((d) => {
      const have = new Set((d.plays ?? []).map((e) => e?.from));
      const add = want.filter((pl) => !have.has(pl.asset));
      if (!add.length) return;
      (d.plays ??= []).push(...cloneEntries(add, d, prefix));
    }, "Plays in set");

  const removeShown = () =>
    update((d) => {
      if (!d.plays) return;
      const shown = new Set(list.map((pl) => pl.asset));
      d.plays = d.plays.filter((e) => !shown.has(e?.from));
      if (!d.plays.length) delete d.plays;
    }, "Plays in set");

  const safeShown = source === "base" ? list.filter((pl) => warningsOf(pl).length === 0 && !checkedIdx.has(pl.asset)) : [];
  const checkedShown = list.filter((pl) => checkedIdx.has(pl.asset)).length;

  const idx = current ? checkedIdx.get(current.asset) : undefined;
  const entry = idx !== undefined ? entries[idx] : undefined;
  const nameTaken = entry ? entries.some((e, i) => i !== idx && e?.name && norm(e.name) === norm(entry.name ?? "")) : false;
  const assetTaken = entry ? entries.some((e, i) => i !== idx && e?.asset && e.asset.toLowerCase() === (entry.asset ?? "").toLowerCase()) : false;
  const totalWarn = entries.filter((e) => {
    const pl = e?.from ? lib.playByAsset.get(e.from) : undefined;
    return pl ? warningsOf(pl).length > 0 : false;
  }).length;

  const playsDocs = useDocsOfKind<PlaysFile>("plays");
  const lastPlaysFile = useSettings((st) => st.lastPlaysFile);
  const customize = () => {
    if (!entry || idx === undefined) return;
    if (!entry.asset || !isValidAsset(entry.asset)) {
      toast.error("Fix the Play's Asset Name First");
      return;
    }
    // The plays file the user last worked in; otherwise my-plays.json (created by the designer if it doesn't exist) —
    // never just the first file, which may be a test file.
    const target = lastPlaysFile && playsDocs.some((d) => d.path === lastPlaysFile && !d.error) ? lastPlaysFile : MY_PLAYS;
    const set = customSetPath(spec, formations);
    const key = cloneKey(spec, entry.asset, formations);
    if (!set || !key) {
      toast.error("Fix the Set's Asset Name First");
      return;
    }
    onClose();
    navigate(`#/designer/new?set=${encodeURIComponent(set)}&base=${encodeURIComponent(key)}&file=${encodeURIComponent(target)}`);
  };

  return (
    <div className={s.layout}>
      <div className={s.left}>
        <div className={s.tools}>
          <Segmented<Source>
            size="sm"
            value={source}
            onChange={(v) => {
              setSource(v);
              setFilter("all");
            }}
            options={[
              { value: "base", label: `Starting Set · ${basePlays.length}`, title: `Plays of ${base.name}` },
              { value: "all", label: "All Sets", title: "Search every offense play in the game" },
            ]}
            aria-label="Where to copy plays from"
          />
          <TextInput value={query} onChange={setQuery} icon="search" placeholder={source === "all" ? "Search plays or sets…" : "Search plays…"} clearable size="sm" autoFocus aria-label="Search plays" />
        </div>
        <div className={s.tools}>
          <Segmented<Filter>
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "Everything" },
              { value: "checked", label: `In This Set · ${entries.length}` },
              { value: "safe", label: "No Warnings" },
              { value: "warn", label: "Needs a Look" },
            ]}
            aria-label="Filter"
          />
        </div>
        <VirtualList
          className={s.list}
          count={list.length}
          rowHeight={54}
          selectedIndex={sel}
          onSelect={(i) => setCursorAsset(list[i].asset)}
          onActivate={(i) => toggle(list[i])}
          getKey={(i) => list[i].asset}
          empty={<EmptyState compact icon="search" title={source === "all" && !query ? "Type to Search Every Play" : "No Plays Match"} />}
          aria-label="Plays"
          renderRow={(i) => {
            const pl = list[i];
            const k = checkedIdx.get(pl.asset);
            const e = k !== undefined ? entries[k] : undefined;
            const w = warningsOf(pl);
            const other = pl.set !== base.asset;
            return (
              <div className={cx(s.row, e && s.rowOn)}>
                <Checkbox checked={!!e} onChange={() => toggle(pl)} title={e ? "Remove from this set" : "Copy into this set"} />
                <div className={s.rowText}>
                  <span className={s.rowName}>{pl.name}</span>
                  <span className={s.rowSub}>
                    {e ? (
                      <>
                        as “<span className="caps">{e.name}</span>”
                      </>
                    ) : (
                      ""
                    )}
                    {e && other ? " · " : ""}
                    {other ? (
                      <>
                        from <span className="caps">{playSetLabel(lib, pl)}</span>
                      </>
                    ) : !e ? (
                      <span className={s.rowAsset}>{leaf(pl.asset)}</span>
                    ) : (
                      ""
                    )}
                  </span>
                </div>
                {w.length > 0 && (
                  <span className={s.warn} title={w.map((x) => `${x.label}: ${x.reason}`).join("\n")}>
                    <Icon name="warning" size={13} /> {[...new Set(w.map((x) => x.label))].slice(0, 3).join(" ")}
                  </span>
                )}
                <PlayTypeTag playType={pl.offensePlayType} size="sm" />
              </div>
            );
          }}
        />
        <div className={s.leftTools}>
          {source === "base" && (
            <Button size="sm" variant="secondary" icon="plus" disabled={!safeShown.length} onClick={() => addAll(safeShown)} title="Copy every listed play that has no warnings">
              Add All Without Warnings{safeShown.length ? ` (${safeShown.length})` : ""}
            </Button>
          )}
          <Button size="sm" variant="ghost" icon="close" disabled={!checkedShown} onClick={removeShown} title="Remove every listed play from this set">
            Remove Listed{checkedShown ? ` (${checkedShown})` : ""}
          </Button>
          <span className={s.grow} />
          {totalWarn > 0 && <span className={s.warnText}>{totalWarn} copied play{totalWarn === 1 ? " needs" : "s need"} a look</span>}
        </div>
      </div>

      <div className={s.right}>
        {current ? (
          <PlayPreview key={current.asset} lib={lib} base={base} spec={spec} play={current} vip={entry?.vip} warnings={warningsOf(current)} />
        ) : (
          <EmptyState compact icon="field" title="Pick a Play to Preview It" />
        )}
        {current && entry && idx !== undefined ? (
          <div className={s.entryForm}>
            <FormRow label="Name in This Set" error={!entry.name?.trim() ? "Required" : nameTaken ? "Another play in this set has this name" : undefined}>
              <TextInput value={entry.name ?? ""} size="sm" invalid={!entry.name?.trim() || nameTaken} onChange={(v) => update((d) => void (d.plays![idx].name = v), "clone-name", 1500)} aria-label="Play name in this set" />
            </FormRow>
            <FormRow label="Primary Receiver (Red Route)">
              <Select
                size="sm"
                value={entry.vip === undefined ? "" : String(entry.vip)}
                onChange={(v) =>
                  update((d) => {
                    const c = d.plays![idx];
                    if (v === "" || Number(v) === current.vip) delete c.vip;
                    else c.vip = Number(v);
                  }, "clone-vip")
                }
                options={[
                  { value: "", label: `Same as the Original${normal[current.vip] ? ` (${playerLabel(normal[current.vip])})` : ""}` },
                  ...normal.flatMap((a, i) => (isEligible(a) && i !== current.vip ? [{ value: String(i), label: `${playerLabel(a)} · slot ${i}` }] : [])),
                ]}
                aria-label="Primary receiver"
              />
            </FormRow>
            <div className={s.entryActions}>
              <Button size="sm" variant="secondary" icon="route" onClick={customize} title="Open the designer with a new custom play based on this copy (change routes, blocking, reads…)">
                Customize This Play…
              </Button>
              <Button size="sm" variant="ghost" icon="close" onClick={() => toggle(current)}>
                Remove From Set
              </Button>
            </div>
            <Advanced id="clone" hint="Asset name">
              <FormRow label="Asset" error={!isValidAsset(entry.asset ?? "") ? "Letters, digits and _ only" : assetTaken ? "Another play in this set has this asset" : undefined}>
                <TextInput value={entry.asset ?? ""} size="sm" mono invalid={!isValidAsset(entry.asset ?? "") || assetTaken} onChange={(v) => update((d) => void (d.plays![idx].asset = v), "clone-asset", 1500)} aria-label="Clone asset" />
              </FormRow>
              <div className={s.mono}>Copied from {current.asset}</div>
            </Advanced>
          </div>
        ) : current ? (
          <div className={s.entryForm}>
            <div className={s.addRow}>
              <span>Not in this set yet.</span>
              <Button size="sm" variant="primary" icon="plus" onClick={() => toggle(current)}>
                Copy Into This Set
              </Button>
            </div>
          </div>
        ) : null}
        <div className={s.rightFoot}>
          <span className={s.hint}>Copied plays keep their routes; routes are relative, so they move with the receiver.</span>
          <span className={s.grow} />
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

const PREVIEW_VIEWPORT = { minX: -27, maxX: 27, minY: -10, maxY: 22 };

function PlayPreview({ lib, base, spec, play, vip, warnings }: { lib: LibraryIndex; base: SetDef; spec: CustomSetSpec; play: PlayDef; vip?: number; warnings: CloneWarning[] }) {
  const catalog = useCatalog();
  const [view, setView] = useState<"custom" | "original">("custom");
  const resolved = catalog?.get(play.asset);
  const own = lib.setByAsset.get(play.set);
  const art: PlayArt = useMemo(() => {
    if (!resolved) return emptyArt();
    const set = view === "custom" ? effectiveSet(base, spec) : (own ?? base);
    try {
      return computeArt(set, resolved.slots.map((sl) => sl.steps), { vip: vip ?? resolved.vip, runHole: resolved.runHole });
    } catch {
      return emptyArt();
    }
  }, [resolved, view, base, spec, own, vip]);
  const ballSpot = useSettings((st) => st.ballSpot);

  return (
    <div className={s.preview}>
      <div className={s.previewHead}>
        <div>
          <div className={s.previewName}>{play.name}</div>
          <div className={s.previewSub}>{playSetLabel(lib, play)}</div>
        </div>
        <Segmented<"custom" | "original">
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: "custom", label: "In Your Set" },
            { value: "original", label: "Original" },
          ]}
          aria-label="Preview alignment"
        />
      </div>
      <div className={s.previewField}>
        <Field viewport={PREVIEW_VIEWPORT} ballSpot={ballSpot} label={`${play.name} preview`}>
          <PlayArtLayer art={art} showLabels highlightSlot={warnings.find((w) => w.slot !== undefined)?.slot} />
        </Field>
      </div>
      {warnings.length > 0 ? (
        <ul className={s.deps}>
          {warnings.map((d, i) => (
            <li key={i}>
              <Icon name="warning" size={13} />
              <span>
                <b>{d.label}</b> {d.reason}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className={s.safe}>
          <Icon name="check" size={14} /> Nothing in this play depends on where you moved players — routes simply start from the new spots.
        </div>
      )}
    </div>
  );
}
