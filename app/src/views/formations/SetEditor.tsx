// #/formations/<file>/<index> — the custom set editor: big field with the alignment (drag players with the mouse;
// arrow keys nudge while the field has focus), the base set's motion presets (edit where the moving player ends up —
// presets can't be added or removed), a "Show flipped" view computed like the game-side builder, live checks and the
// plays copied into the set. Every edit goes through the workspace store (undo/redo, ⌘/Ctrl+S) and writes only what
// changed (model/sets.ts patchPosition / patchPreset).
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { LibraryIndex } from "../../model/library";
import {
  DEPTH_CLASS_LABEL,
  LINE_COUNT,
  LINE_Y,
  NORMAL,
  alignmentIssues,
  basePresetKeys,
  changedPresetSlots,
  changedSlots,
  effectiveNormal,
  effectivePreset,
  flippedAlignment,
  isQB,
  normalOf,
  onLine,
  patchPosition,
  patchPreset,
  playerLabel,
  presetAlignment,
  presetLabel,
  presetSlots,
  removePreset,
  resetPosition,
  resetPresetSlot,
  setDepthClass,
  type SlotPatch,
} from "../../model/sets";
import type { AlignmentPos, CustomSetSpec, PlayDef, SetDef, SetsFile } from "../../model/types";
import { navigate } from "../../state/router";
import { useDoc, useWorkspace } from "../../state/workspace";
import { Button, EmptyState, Icon, IconButton, Menu, Segmented, Spinner, Tag, Toggle, cx } from "../../ui";
import { ClonePlaysModal } from "./ClonePlaysModal";
import { ALIGN_REGION, EditorField, type Ghost } from "./EditorField";
import { FlippedPlayerPanel, PlayerPanel, PresetPlayerPanel, SetPanel } from "./Inspector";
import { checkGroups, cloneWarnings, presetTarget, type CheckGroup, type CloneWarning } from "./setModel";
import { FLIPPED, activate, customSetArt, customSubtitle, fileName, formationNameOf, setDisplayIssues, useLib, useSetsDocs, useSetsIssues } from "./shared";
import s from "./Editor.module.css";

const back = () => navigate("#/formations");

export function SetEditorScreen({ file, index }: { file: string; index: number }) {
  const lib = useLib();
  const ready = useWorkspace((st) => st.ready);
  const doc = useDoc<SetsFile | null>(file);
  const spec = doc && !doc.error ? doc.data?.sets?.[index] : undefined;
  const base = spec && lib ? lib.setByAsset.get(spec.base) : undefined;

  let problem: { title: string; body?: string } | undefined;
  if (!lib) problem = { title: "The set editor needs the play library" };
  else if (!ready) problem = undefined;
  else if (!doc) problem = { title: `${file} isn't open`, body: "It may have been deleted or renamed." };
  else if (doc.error) problem = { title: `Can't open ${fileName(file)}`, body: doc.error };
  else if (!Array.isArray(doc.data?.sets)) problem = { title: `${fileName(file)} has no "sets" list` };
  else if (!spec || typeof spec !== "object") problem = { title: `Set ${index + 1} doesn't exist in ${fileName(file)}`, body: `The file has ${doc.data!.sets.length} set(s).` };
  else if (!base) problem = { title: "Starting set not found", body: `${spec.base || "(no base)"} isn't in the game library — fix the "base" in ${file}.` };

  if (!ready && !problem) {
    return (
      <div className={s.center}>
        <Spinner label="Loading files…" />
      </div>
    );
  }
  if (problem || !lib || !doc || !spec || !base) {
    return (
      <div className={s.center}>
        <EmptyState
          icon="warning"
          title={problem?.title ?? "Can't open this set"}
          body={problem?.body}
          action={
            <Button variant="secondary" icon="chevronLeft" onClick={back}>
              Back to sets
            </Button>
          }
        />
      </div>
    );
  }
  return <SetEditor key={`${file}#${index}`} lib={lib} file={file} index={index} fileData={doc.data!} spec={spec} base={base} />;
}

// ───────────────────────────── editor ─────────────────────────────

function useStoredBool(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : raw === "1";
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: boolean) => {
      setV(next);
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        /* private mode */
      }
    },
    [key],
  );
  return [v, set];
}

interface EditorProps {
  lib: LibraryIndex;
  file: string;
  index: number;
  fileData: SetsFile;
  spec: CustomSetSpec;
  base: SetDef;
}

/** Where a motion preset may end (the library's preset targets stay within |x| ≤ 23 and −7.75 … −0.2). */
const PRESET_REGION = { minX: -23, maxX: 23, minY: -8, maxY: -0.2 };
/** Motions longer than this are longer than 95 % of the game's own presets. */
const LONG_MOTION_YD = 26;
const NUDGE = 0.5;
const NUDGE_FINE = 0.1;
const same = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) < 0.0005 && Math.abs(a.y - b.y) < 0.0005;
const clampTo = (r: typeof PRESET_REGION, v: { x: number; y: number }) => ({ x: Math.min(r.maxX, Math.max(r.minX, v.x)), y: Math.min(r.maxY, Math.max(r.minY, v.y)) });

function SetEditor({ lib, file, index, fileData, spec, base }: EditorProps) {
  const docs = useSetsDocs();
  const allIssues = useSetsIssues(lib, docs);
  const issues = useMemo(() => setDisplayIssues(lib, allIssues.filter((i) => i.file === file), index, spec, base), [lib, allIssues, file, index, spec, base]);

  const [selected, setSelected] = useState<number>();
  const [hover, setHover] = useState<number>();
  const [view, setView] = useState<string>(NORMAL);
  const [flipped, setFlipped] = useState(false);
  const [snap, setSnap] = useStoredBool("pbstudio.formations.snap", true);
  const [ghosts, setGhosts] = useStoredBool("pbstudio.formations.ghosts", true);
  const [playsOpen, setPlaysOpen] = useState(false);
  const [presetMenu, setPresetMenu] = useState<HTMLElement | null>(null);

  useEffect(() => activate(file), [file]);

  const keys = useMemo(() => basePresetKeys(base), [base]);
  const mode = !flipped && keys.includes(view) ? view : NORMAL;
  const normal = useMemo(() => effectiveNormal(base, spec), [base, spec]);
  const flippedNow = useMemo(() => flippedAlignment(normal), [normal]);
  const flippedBase = useMemo(() => flippedAlignment(normalOf(base)), [base]);
  const movers = useMemo(() => new Set(mode === NORMAL ? [] : presetSlots(base, mode)), [base, mode]);
  const preset = useMemo(() => (mode === NORMAL ? undefined : effectivePreset(base, spec, mode)), [base, spec, mode]);
  const art = useMemo(() => customSetArt(base, spec, flipped ? FLIPPED : mode), [base, spec, flipped, mode]);

  /** Where each player is drawn in the current view. */
  const shown = useMemo<AlignmentPos[]>(() => (flipped ? flippedNow : presetAlignment(base, spec, mode)), [flipped, flippedNow, base, spec, mode]);

  const changed = useMemo(() => {
    if (flipped) return new Set(flippedNow.flatMap((a, i) => (flippedBase[i] && !same(a, flippedBase[i]) ? [i] : [])));
    if (mode !== NORMAL) return new Set(changedPresetSlots(base, spec, mode));
    return new Set(changedSlots(base, spec));
  }, [flipped, flippedNow, flippedBase, mode, base, spec]);

  const ghostList = useMemo<Ghost[]>(
    () =>
      [...changed].flatMap((slot) => {
        const from = flipped ? flippedBase[slot] : mode === NORMAL ? normalOf(base)[slot] : presetTarget(base, mode, slot);
        const to = shown[slot];
        return from && to && !same(from, to) ? [{ slot, from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y } }] : [];
      }),
    [changed, flipped, flippedBase, mode, base, shown],
  );

  // ── checks: the strip shows the alignment on the field (the flipped one is checked against the flipped base) ──
  const strip = useMemo<CheckGroup[]>(() => {
    if (flipped) return checkGroups(flippedNow, alignmentIssues(flippedNow, { ...base, movements: { [NORMAL]: flippedBase } }));
    return checkGroups(normal, alignmentIssues(normal, base));
  }, [flipped, flippedNow, flippedBase, normal, base]);
  // One-click fix for sets whose tackles / tight ends sit at −1.5 or a bit deeper (the game's own pistol and
  // under-center sets do): the builder only counts y > −1.5 as on the line.
  const lineFix = useMemo(() => {
    if (flipped) return undefined;
    const on = normal.filter(onLine).length;
    if (on >= LINE_COUNT) return undefined;
    const near = normal.flatMap((a, slot) => (!isQB(a) && a.y <= LINE_Y && a.y > LINE_Y - 0.3 ? [slot] : []));
    return on + near.length === LINE_COUNT ? near : undefined;
  }, [flipped, normal]);
  const fixLine = () =>
    lineFix &&
    update((d) => {
      for (const slot of lineFix) patchPosition(d, base, slot, { y: -1.4 });
      tidy(d);
    }, "Move players onto the line");


  // Clone warnings (per cloned play), for the player panel and the set panel.
  const cloneInfo = useMemo(() => {
    const stock = lib.stock ?? lib;
    const out: { name: string; play?: PlayDef; warnings: CloneWarning[] }[] = [];
    for (const c of Array.isArray(spec.plays) ? spec.plays : []) {
      if (!c) continue;
      const play = c.from ? stock.playByAsset.get(c.from) : undefined;
      out.push({ name: c.name || (play?.name ?? "?"), play, warnings: play ? cloneWarnings(lib, play, normal) : [] });
    }
    return out;
  }, [lib, spec.plays, normal]);

  const errors = issues.filter((p) => p.level === "error").length;
  const warnings = issues.filter((p) => p.level === "warning").length;
  const warningText = issues.filter((p) => p.level === "warning").map((p) => p.message).join("\n");

  // ── edits ──
  const update = useCallback(
    (fn: (d: CustomSetSpec, f: SetsFile) => void, label: string, coalesceMs?: number) =>
      useWorkspace.getState().update<SetsFile>(
        file,
        (d) => {
          const st = d.sets?.[index];
          if (st) fn(st, d);
        },
        { label, coalesceMs },
      ),
    [file, index],
  );
  const latest = (): CustomSetSpec | undefined => (useWorkspace.getState().docs[file]?.data as SetsFile | null)?.sets?.[index];
  const tidy = (d: CustomSetSpec) => {
    if (Array.isArray(d.positions) && !d.positions.length) delete d.positions;
  };

  /** Move / restyle a player in the current view (Normal → positions, preset → that preset's target). */
  const applyPatch = (slot: number, patch: SlotPatch, label: string, coalesceMs = 1000) => {
    if (flipped) return;
    if (mode === NORMAL)
      return update(
        (d) => {
          patchPosition(d, base, slot, patch);
          tidy(d);
        },
        `${label}@normal`,
        coalesceMs,
      );
    if (!movers.has(slot)) return;
    update((d) => patchPreset(d, base, mode, slot, patch), `${label}@${mode}`, coalesceMs);
  };

  const resetSlot = (slot: number) =>
    update((d) => {
      if (mode === NORMAL) {
        resetPosition(d, slot);
        tidy(d);
      } else resetPresetSlot(d, base, mode, slot);
    }, "Reset player");

  const resetAll = () =>
    update(
      (d) => {
        if (mode !== NORMAL) return removePreset(d, base, mode);
        for (let slot = 0; slot < normal.length; slot++) resetPosition(d, slot);
        tidy(d);
      },
      mode === NORMAL ? "Reset all players" : "Reset motion preset",
    );

  const nudge = (dx: number, dy: number, fine: boolean) => {
    if (selected === undefined || flipped) return;
    const cur = latest();
    if (!cur) return;
    const at = mode === NORMAL ? effectiveNormal(base, cur)[selected] : effectivePreset(base, cur, mode)[selected];
    if (!at) return;
    const step = fine ? NUDGE_FINE : NUDGE;
    applyPatch(selected, clampTo(mode === NORMAL ? ALIGN_REGION : PRESET_REGION, { x: at.x + dx * step, y: at.y + dy * step }), `nudge:${selected}`, 900);
  };

  const moverLabel = (k: string) =>
    presetSlots(base, k)
      .map((slot) => ({ slot, man: !!presetTarget(base, k, slot)?.motionMan }))
      .sort((a, b) => Number(b.man) - Number(a.man))
      .map(({ slot }) => (normal[slot] ? playerLabel(normal[slot]) : `#${slot}`))
      .join(" + ");

  const pickView = (k: string) => {
    setView(k);
    if (k === NORMAL) return;
    setFlipped(false);
    // Select the player this preset moves (the motion man first) so he's ready to drag.
    const slots = presetSlots(base, k);
    const man = slots.find((slot) => presetTarget(base, k, slot)?.motionMan) ?? slots[0];
    if (man !== undefined) setSelected(man);
  };

  const sel = selected !== undefined && shown[selected] ? selected : undefined;
  const cls = setDepthClass(normal);
  const plays = Array.isArray(spec.plays) ? spec.plays.length : 0;
  const form = formationNameOf(lib, spec, fileData.formations);
  const spot = sel !== undefined && preset ? preset[sel] : undefined;
  const motionDist = spot && sel !== undefined && normal[sel] ? Math.hypot(spot.x - normal[sel].x, spot.y - normal[sel].y) : undefined;
  const normalEdited = changedSlots(base, spec).length > 0;

  const fieldHint = flipped
    ? "Flipped view (read-only): the game puts every player on his flip partner's spot, mirrored. Change flip partners in a player's Advanced section."
    : mode !== NORMAL
      ? `Drag ${moverLabel(mode) || "the moving player"} to where the ${presetLabel(mode)} motion should end. Click the field first, then the arrow keys nudge the selected player (Shift = 0.1 yd).`
      : "Drag players with the mouse. Click the field, then the arrow keys nudge the selected player 0.5 yd (Shift = 0.1 yd); Esc clears the selection. Hold Alt while dragging to switch between grid and free placement. Scroll to zoom, double-click to reset the view.";

  return (
    <div className={s.page}>
      <header className={s.header}>
        <IconButton icon="chevronLeft" title="Back to all sets" onClick={back} />
        <div className={s.titles}>
          <div className={s.eyebrow}>
            <span className={s.eyebrowFile}>{fileName(file)}</span>
            <span className={s.sep}>·</span>
            set {index + 1} of {fileData.sets.length}
          </div>
          <h1 className={s.title}>{spec.name || "(unnamed set)"}</h1>
          <div className={s.subtitle}>
            {customSubtitle(lib, spec, fileData.formations)}
            {form.custom && <span className={s.sep}>·</span>}
            {form.custom && "my formation"}
            {cls && <span className={s.sep}>·</span>}
            {cls && DEPTH_CLASS_LABEL[cls]}
          </div>
        </div>
        <span className={s.grow} />
        {errors + warnings === 0 ? (
          <Tag tone="ok" icon="check" title="Passes every check the game-side builder makes">
            Ready to build
          </Tag>
        ) : (
          <>
            {errors > 0 && (
              <Tag tone="danger" title={issues.filter((p) => p.level === "error").map((p) => p.message).join("\n")}>
                {errors} error{errors === 1 ? "" : "s"}
              </Tag>
            )}
            {warnings > 0 && (
              <Tag tone="warning" variant="soft" title={warningText}>
                {warnings} warning{warnings === 1 ? "" : "s"}
              </Tag>
            )}
          </>
        )}
        <Button variant={plays ? "secondary" : "primary"} icon="list" onClick={() => setPlaysOpen(true)}>
          {`Plays in this set · ${plays}`}
        </Button>
      </header>

      <div className={s.toolbar}>
        <div className={s.presetPills} role="tablist" aria-label="Alignment and motion presets">
          <span className={s.toolLabel}>Show</span>
          <span className={cx(s.pill, mode === NORMAL && s.pillOn)}>
            <button type="button" role="tab" aria-selected={mode === NORMAL} className={s.pillBtn} onClick={() => setView(NORMAL)} title="Where every player lines up">
              Alignment
              {normalEdited && <span className={s.pillDot} aria-label="edited" />}
            </button>
          </span>
          {keys.length > 0 && (
            <span className={cx(s.pill, mode !== NORMAL && s.pillOn)}>
              <button
                type="button"
                role="tab"
                aria-selected={mode !== NORMAL}
                aria-haspopup="menu"
                className={s.pillBtn}
                onClick={(e) => setPresetMenu(presetMenu ? null : e.currentTarget)}
                title="Motion presets come from the starting set. Pick one to change where its moving player ends up. Presets can't be added or removed — the game-side builder only edits the targets of existing presets."
              >
                {mode === NORMAL ? `Motion presets · ${keys.length}` : presetLabel(mode)}
                {mode !== NORMAL && <span className={s.pillSub}>{moverLabel(mode)}</span>}
                {keys.some((k) => changedPresetSlots(base, spec, k).length > 0) && <span className={s.pillDot} aria-label="edited" />}
                <Icon name="chevronDown" size={12} />
              </button>
            </span>
          )}
          {presetMenu && (
            <Menu
              anchor={presetMenu}
              placement="bottom-start"
              minWidth={280}
              initialId={mode}
              onClose={() => setPresetMenu(null)}
              items={[
                { kind: "heading", label: "Pre-snap motion presets (from the starting set)" },
                ...keys.map((k) => ({
                  id: k,
                  label: presetLabel(k),
                  hint: `${moverLabel(k)} moves${changedPresetSlots(base, spec, k).length ? " · edited" : ""}`,
                  checked: k === mode,
                  onSelect: () => pickView(k),
                })),
                { kind: "separator" },
                { id: NORMAL, label: "Back to the alignment", icon: "field", onSelect: () => setView(NORMAL) },
              ]}
            />
          )}
        </div>
        <span className={s.grow} />
        <Toggle
          size="sm"
          checked={flipped}
          onChange={(v) => {
            setFlipped(v);
            if (v) setView(NORMAL);
          }}
          label="Show flipped"
          title="Show where everyone lines up when the play is flipped, as the game computes it from each player's flip partner"
        />
        <Segmented
          size="sm"
          value={snap ? "grid" : "free"}
          onChange={(v) => setSnap(v === "grid")}
          options={[
            { value: "grid", label: "Snap 0.5 yd", title: "Drags move in 0.5 yd steps and stick to standard depths and splits (hold Alt for free placement)" },
            { value: "free", label: "Free", title: "Free placement (hold Alt to snap)" },
          ]}
          aria-label="Snap"
        />
        <Toggle size="sm" checked={ghosts} onChange={setGhosts} label="Original spots" title="Show where moved players started (dashed rings)" />
      </div>

      <div className={s.main}>
        <div className={s.fieldCol}>
          <div className={s.fieldBox}>
            <EditorField
              art={art}
              ghosts={ghostList}
              changed={changed}
              showGhosts={ghosts}
              selected={sel}
              hover={hover}
              snap={snap}
              canDrag={(slot) => !flipped && (mode === NORMAL || movers.has(slot))}
              region={mode === NORMAL ? ALIGN_REGION : PRESET_REGION}
              showRegion={mode !== NORMAL}
              readOnly={flipped}
              onSelect={setSelected}
              onHover={setHover}
              onDrag={(slot, to, id) => applyPatch(slot, to, `drag:${id}`, 60_000)}
              onNudge={nudge}
              hint={fieldHint}
              label={`${spec.name} alignment`}
            />
            <div className={cx(s.fieldHint, flipped && s.fieldHintFlip)}>
              {flipped ? (
                <>
                  <b>Flipped view</b> · read-only — set flip partners per player (Advanced)
                </>
              ) : mode !== NORMAL ? (
                <>
                  <b>{presetLabel(mode)}</b> · drag {moverLabel(mode) || "the moving player"} to where the motion ends
                </>
              ) : (
                <>
                  Drag players · <b>arrow keys</b> nudge the selected player (click the field first) · <b>Alt</b> {snap ? "free" : "snap"}
                </>
              )}
            </div>
          </div>
          <ChecksStrip
            checks={strip}
            flipped={flipped}
            motionDist={motionDist}
            fix={
              lineFix && mode === NORMAL ? (
                <Button size="sm" variant="secondary" icon="check" onClick={fixLine} title="The game-side builder counts a player as on the line only above y −1.5; this moves them to −1.4">
                  Move {lineFix.map((slot) => playerLabel(normal[slot])).join(", ")} onto the line
                </Button>
              ) : undefined
            }
          />
        </div>
        <aside className={s.inspector}>
          {sel !== undefined && flipped ? (
            <FlippedPlayerPanel key={`f${sel}`} slot={sel} normal={normal} flipped={flippedNow} onDone={() => setSelected(undefined)} onPartner={(p) => update((d) => patchPosition(d, base, sel, { flipAssign: p }), "Flip partner")} />
          ) : sel !== undefined && mode !== NORMAL ? (
            <PresetPlayerPanel
              key={`p${mode}${sel}`}
              presetKey={mode}
              slot={sel}
              player={normal[sel]}
              spot={spot}
              baseTarget={presetTarget(base, mode, sel)}
              movers={moverLabel(mode)}
              distance={motionDist}
              longMotion={LONG_MOTION_YD}
              region={PRESET_REGION}
              changed={changed.has(sel)}
              onPatch={(patch, label, coalesceMs) => applyPatch(sel, patch, label, coalesceMs)}
              onReset={() => resetSlot(sel)}
              onDone={() => setSelected(undefined)}
            />
          ) : sel !== undefined ? (
            <PlayerPanel
              key={`n${sel}`}
              lib={lib}
              base={base}
              slot={sel}
              normal={normal}
              reference={normalOf(base)[sel]}
              changed={changed.has(sel)}
              clones={cloneInfo.flatMap((c) => {
                const w = c.warnings.filter((x) => x.slot === sel);
                return w.length ? [{ name: c.name, warnings: w }] : [];
              })}
              onPatch={(patch, label, coalesceMs) => applyPatch(sel, patch, label, coalesceMs)}
              onReset={() => resetSlot(sel)}
              onDone={() => setSelected(undefined)}
            />
          ) : (
            <SetPanel
              lib={lib}
              file={file}
              fileData={fileData}
              allFiles={docs.map((d) => ({ path: d.path, data: d.error ? null : d.data }))}
              spec={spec}
              base={base}
              shown={shown}
              changed={changed}
              mode={mode}
              flipped={flipped}
              issues={issues}
              hover={hover}
              clones={cloneInfo}
              onSelect={setSelected}
              onHover={setHover}
              update={update}
              onPlays={() => setPlaysOpen(true)}
              onResetAll={resetAll}
            />
          )}
        </aside>
      </div>

      {playsOpen && <ClonePlaysModal lib={lib} base={base} spec={spec} formations={fileData.formations} normal={normal} update={update} onClose={() => setPlaysOpen(false)} />}
    </div>
  );
}

// ───────────────────────────── checks strip ─────────────────────────────

function ChecksStrip({ checks, flipped, motionDist, fix }: { checks: CheckGroup[]; flipped: boolean; motionDist?: number; fix?: ReactNode }) {
  const first = checks.find((c) => c.level === "error") ?? checks.find((c) => c.level === "warning");
  return (
    <div className={s.strip} role="status">
      <span className={s.stripLabel}>{flipped ? "Flipped checks" : "Game checks"}</span>
      {checks.map((c) => (
        <span key={c.id} className={s.check} data-level={c.level} title={c.messages.join("\n") || "OK"}>
          <Icon name={c.level === "ok" ? "check" : "warning"} size={13} />
          {c.label}
        </span>
      ))}
      {motionDist !== undefined && (
        <span className={s.check} data-level={motionDist > LONG_MOTION_YD ? "warning" : "ok"} title={motionDist > LONG_MOTION_YD ? "Longer than 95% of the game's own motion presets" : "How far the motion goes"}>
          <Icon name="motion" size={13} />
          Motion {Math.round(motionDist * 10) / 10} yd
        </span>
      )}
      {fix}
      {first && !fix && <span className={s.stripMsg}>{first.messages[0]}</span>}
    </div>
  );
}
