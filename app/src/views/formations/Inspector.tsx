// Right-hand inspector of the set editor. Nothing selected: the set (name, formation, plays in the set, players,
// checks; asset names under Advanced). A player selected: where he lines up (x / y, depth and split shortcuts, reset;
// stance, facing, flip partner and motion man under Advanced). In a motion preset: where his motion ends. In the
// flipped view: his flipped spot and flip partner.
import { useMemo, useState, type ReactNode } from "react";
import type { LibraryIndex } from "../../model/library";
import { formationShort, leaf, norm } from "../../model/names";
import { positionCode, positionName } from "../../model/positions";
import {
  SKILL_POSITIONS,
  canChangePosition,
  positionPatch,
  DEPTH_PRESET_LABEL,
  NORMAL,
  SPLIT_PRESET_HINT,
  SPLIT_PRESET_LABEL,
  customFormationAsset,
  customFormationAssets,
  depthPresetY,
  flipPartner,
  flippedAlignment,
  depthPresetsFor,
  isLineman,
  isQB,
  libraryFormationLeaves,
  newCustomFormation,
  playerLabel,
  presetLabel,
  setNamesInFormation,
  splitPreset,
  suggestAsset,
  type SlotPatch,
  type SplitPreset,
} from "../../model/sets";
import type { AlignmentPos, ArtBounds, CustomSetSpec, SetDef, SetsFile, ValidationIssue } from "../../model/types";
import { useSettings } from "../../state/settings";
import { Button, FormRow, Icon, NumberField, SearchSelect, Select, Tag, TextInput, Toggle, cx, promptDialog } from "../../ui";
import { Advanced } from "./Common";
import { findCustomFormation, formationPathOf, refersToFormation, type CloneWarning } from "./setModel";
import { titleCase } from "../designer/titleCase";
import s from "./Editor.module.css";

const SPLITS: SplitPreset[] = ["tight", "wing", "outsideTe", "slot", "numbers", "hash", "wide"];
const fmt = (n: number) => String(Math.round(n * 100) / 100);
const fmtXY = (v: { x: number; y: number }) => `${fmt(v.x)}, ${fmt(v.y)}`;

export function stanceLabel(v: string): string {
  return v.replace(/^StanceType_/, "").replace(/_/g, " ");
}

function slotOptions(normal: AlignmentPos[]) {
  return normal.map((a, i) => ({ value: String(i), label: `${playerLabel(a)} · slot ${i}` }));
}

// ───────────────────────────── player (alignment) ─────────────────────────────

export interface PlayerPanelProps {
  lib: LibraryIndex;
  base: SetDef;
  slot: number;
  /** Effective alignment (incl. flip partners / motion man). */
  normal: AlignmentPos[];
  /** The starting set's spot for this slot. */
  reference?: AlignmentPos;
  changed: boolean;
  /** Cloned plays whose assignments depend on where this player lines up. */
  clones: { name: string; warnings: CloneWarning[] }[];
  /** coalesceMs 0 for discrete clicks (each its own undo step); default merges typing/stepping. */
  onPatch(patch: SlotPatch, label: string, coalesceMs?: number): void;
  onReset(): void;
  onDone(): void;
  /** "Stays put when flipped" on / off (rewires the flip partners). */
  onStayOnFlip?(on: boolean): void;
}

export function PlayerPanel(p: PlayerPanelProps) {
  const { lib, base, slot, normal } = p;
  const a = normal[slot];
  const stanceOptions = useMemo(
    () => lib.enumValues("StanceType").filter((v) => !/_(None|NoneValue|Max)$/.test(v)).map((v) => ({ value: v, label: stanceLabel(v) })),
    [lib],
  );
  const flippedSpot = useMemo(() => flippedAlignment(normal)[slot], [normal, slot]);
  if (!a) return null;
  const qb = isQB(a);
  const ol = isLineman(a);
  const ref = p.reference;
  const dx = ref ? a.x - ref.x : 0;
  const dy = ref ? a.y - ref.y : 0;
  const partner = flipPartner(normal, slot);

  return (
    <div className={s.inspectorBody}>
      <PanelBack onClick={p.onDone} />
      <div className={s.playerHead}>
        <div className={s.playerLabel}>{playerLabel(a)}</div>
        <div className={s.playerMeta}>
          <span>{positionName(a.pos)}</span>
          <span>
            Slot {slot}
            {a.motionMan ? " · Motion Man" : ""}
          </span>
        </div>
        <span className={s.grow} />
        {p.changed ? (
          <Tag tone="warning" size="sm">
            Changed
          </Tag>
        ) : (
          <Tag tone="neutral" size="sm" variant="outline">
            Original
          </Tag>
        )}
      </div>

      {canChangePosition(a) && (
        <Section title="Position">
          <div className={s.chips}>
            {SKILL_POSITIONS.map((x) => {
              const on = positionCode(a.pos) === x.code;
              return (
                <button
                  key={x.code}
                  type="button"
                  className={cx(s.chip, on && s.chipOn)}
                  title={on ? `${playerLabel(a)} is a ${x.label.toLowerCase()}` : `Make this player a ${x.label.toLowerCase()} (the game fills the slot from that spot on the depth chart)`}
                  onClick={() => {
                    const patch = on ? undefined : positionPatch(normal, slot, x.code);
                    if (patch) p.onPatch(patch, `pos:${slot}`, 0);
                  }}
                >
                  {x.code}
                </button>
              );
            })}
          </div>
        </Section>
      )}

      <Section title="Where He Lines Up">
        <div className={s.xy}>
          <NumberField label="X" value={a.x} step={0.1} precision={3} suffix="yd" min={-26.67} max={26.67} onChange={(x) => p.onPatch({ x }, `x:${slot}`)} aria-label="X (yards from the ball, + = right)" title="Yards left (−) or right (+) of the ball" />
          <NumberField label="Y" value={a.y} step={0.1} precision={3} suffix="yd" min={-20} max={0} onChange={(y) => p.onPatch({ y }, `y:${slot}`)} aria-label="Y (yards behind the line)" title="Depth: 0 = line of scrimmage, −0.8 on the line, −2.2 off the line" />
        </div>
        {ref && (
          <div className={s.refLine}>
            <span>
              Original spot <span className={s.coord}>{fmtXY(ref)}</span>
            </span>
            {(Math.abs(dx) > 0.0005 || Math.abs(dy) > 0.0005) && (
              <span className={s.delta}>
                moved{" "}
                <span className={s.coord}>
                  {dx >= 0 ? "+" : ""}
                  {fmt(dx)}, {dy >= 0 ? "+" : ""}
                  {fmt(dy)}
                </span>
              </span>
            )}
          </div>
        )}
      </Section>

      <Section title="Depth">
        <div className={s.chips}>
          {depthPresetsFor(a).map((d) => {
            const y = depthPresetY(d, slot, base, normal);
            const on = y !== undefined && Math.abs(y - a.y) < 0.0005;
            return (
              <button key={d} type="button" className={cx(s.chip, on && s.chipOn)} disabled={y === undefined} onClick={() => y !== undefined && p.onPatch({ y }, `depth:${slot}`, 0)} title={y !== undefined ? `y ${fmt(y)}` : undefined}>
                {titleCase(DEPTH_PRESET_LABEL[d])}
                {y !== undefined && <span className={s.chipVal}>{fmt(y)}</span>}
              </button>
            );
          })}
        </div>
      </Section>

      {!qb && !ol && (
        <Section title="Split">
          <div className={s.chips}>
            {SPLITS.map((sp) => {
              const patch = splitPreset(sp, slot, normal);
              const on = patch?.x !== undefined && Math.abs(patch.x - a.x) < 0.01 && (patch.y === undefined || Math.abs(patch.y - a.y) < 0.01);
              return (
                <button key={sp} type="button" className={cx(s.chip, on && s.chipOn)} title={SPLIT_PRESET_HINT[sp]} onClick={() => patch && p.onPatch(patch, `split:${slot}`, 0)}>
                  {titleCase(SPLIT_PRESET_LABEL[sp])}
                  {patch?.x !== undefined && <span className={s.chipVal}>{fmt(Math.abs(patch.x))}</span>}
                </button>
              );
            })}
          </div>
          <Button
            size="sm"
            variant="secondary"
            icon="flip"
            onClick={() => {
              const patch = splitPreset("mirror", slot, normal);
              if (patch) p.onPatch(patch, `mirror:${slot}`, 0);
            }}
          >
            Move to the Other Side
          </Button>
        </Section>
      )}

      <div className={s.playerActions}>
        <Button size="sm" variant="ghost" icon="refresh" disabled={!p.changed} onClick={p.onReset} title="Back to the starting set's spot, stance, facing and flip partner">
          Reset Player
        </Button>
      </div>

      {p.clones.length > 0 && (
        <Section title={`Copied Plays That Depend on ${playerLabel(a)}`}>
          <ul className={s.depList}>
            {p.clones.map((c) => (
              <li key={c.name}>
                <Icon name="warning" size={13} className={s.warnIcon} />
                <span>
                  <b className="caps">{c.name}</b> — {playerLabel(a)} {c.warnings[0].reason}
                  {c.warnings.length > 1 ? ` (+${c.warnings.length - 1} more)` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Advanced id="player" hint="Stance, facing, flip partner, stay put when flipped, motion man">
        <FormRow label="Stance">
          <SearchSelect value={a.stance} onChange={(v) => p.onPatch({ stance: v }, `stance:${slot}`, 0)} options={stanceOptions} size="sm" aria-label="Stance" renderValue={(o, v) => (o ? o.label : v ? stanceLabel(v) : "—")} />
        </FormRow>
        <FormRow label="Facing" hint="Degrees: 90 = upfield, 0 = toward the right sideline.">
          <NumberField value={a.facing} step={1} precision={0} min={0} max={359} suffix="°" size="sm" width={110} onChange={(facing) => p.onPatch({ facing }, `facing:${slot}`)} aria-label="Facing" />
        </FormRow>
        <FormRow label="Flip Partner" hint={`When the play is flipped, ${playerLabel(a)} takes ${partner === slot ? "his own spot, mirrored" : `${playerLabel(normal[partner])}'s spot, mirrored`}: ${fmtXY(flippedSpot)}.`}>
          <Select size="sm" value={String(partner)} disabled={!!a.stayOnFlip} onChange={(v) => p.onPatch({ flipAssign: Number(v) }, `flip:${slot}`, 0)} options={slotOptions(normal)} aria-label="Flip partner" />
        </FormRow>
        {p.onStayOnFlip && (
          <FormRow label="Stay Put When Flipped" hint="He keeps this spot when the play is flipped and only his route mirrors. In a mirrored formation, turn it on for both players of a pair so neither moves.">
            <Toggle size="sm" checked={!!a.stayOnFlip} onChange={(v) => p.onStayOnFlip?.(v)} label={a.stayOnFlip ? "Yes" : "No"} />
          </FormRow>
        )}
        <FormRow label="Motion Man" hint="The game's primary motion man flag for this player in this set.">
          <Toggle size="sm" checked={!!a.motionMan} onChange={(v) => p.onPatch({ motionMan: v }, `motionman:${slot}`, 0)} label={a.motionMan ? "Yes" : "No"} />
        </FormRow>
      </Advanced>
    </div>
  );
}

// ───────────────────────────── player (motion preset) ─────────────────────────────

export interface PresetPlayerPanelProps {
  presetKey: string;
  slot: number;
  /** The player's alignment spot (where the motion starts). */
  player?: AlignmentPos;
  /** Where the motion ends now (undefined = this preset doesn't move him). */
  spot?: { x: number; y: number };
  /** The starting set's target. */
  baseTarget?: AlignmentPos;
  movers: string;
  distance?: number;
  longMotion: number;
  region: ArtBounds;
  changed: boolean;
  onPatch(patch: SlotPatch, label: string, coalesceMs?: number): void;
  onReset(): void;
  onDone(): void;
}

export function PresetPlayerPanel(p: PresetPlayerPanelProps) {
  const a = p.player;
  if (!a) return null;
  const name = presetLabel(p.presetKey);
  return (
    <div className={s.inspectorBody}>
      <PanelBack onClick={p.onDone} />
      <div className={s.playerHead}>
        <div className={s.playerLabel}>{playerLabel(a)}</div>
        <div className={s.playerMeta}>
          <span>{positionName(a.pos)}</span>
          <span>{name}</span>
        </div>
        <span className={s.grow} />
        {p.spot &&
          (p.changed ? (
            <Tag tone="warning" size="sm">
              Changed
            </Tag>
          ) : (
            <Tag tone="neutral" size="sm" variant="outline">
              Original
            </Tag>
          ))}
      </div>

      {!p.spot || !p.baseTarget ? (
        <div className={s.presetNote}>
          <Icon name="motion" size={14} />
          <span>
            {playerLabel(a)} doesn't move in <b>{name}</b> ({p.movers} does). A motion preset can only change where its own moving player ends up — pick a preset that
            moves {playerLabel(a)}, or switch to <b>Alignment</b> to move him.
          </span>
        </div>
      ) : (
        <>
          <div className={s.presetNote}>
            <Icon name="motion" size={14} />
            <span>
              On <b>{name}</b>, {playerLabel(a)} motions from his spot ({fmtXY(a)}) to here before the snap.
            </span>
          </div>
          <Section title="Where the Motion Ends">
            <div className={s.xy}>
              <NumberField label="X" value={p.spot.x} step={0.1} precision={3} suffix="yd" min={p.region.minX} max={p.region.maxX} onChange={(x) => p.onPatch({ x }, `x:${p.slot}`)} aria-label="Motion end X" />
              <NumberField label="Y" value={p.spot.y} step={0.1} precision={3} suffix="yd" min={p.region.minY} max={p.region.maxY} onChange={(y) => p.onPatch({ y }, `y:${p.slot}`)} aria-label="Motion end Y" />
            </div>
            <div className={s.refLine}>
              <span>
                Game's spot <span className={s.coord}>{fmtXY(p.baseTarget)}</span>
              </span>
              {p.distance !== undefined && (
                <span className={cx(p.distance > p.longMotion && s.delta)}>
                  · {Math.round(p.distance * 10) / 10} yd motion{p.distance > p.longMotion ? " (longer than almost every game motion)" : ""}
                </span>
              )}
            </div>
            <div className={s.muted}>
              The motion can end anywhere behind the line, within {fmt(p.region.maxX)} yd of the ball and up to {fmt(-p.region.minY)} yd deep — the range of the game's
              own presets.
            </div>
          </Section>
          <div className={s.playerActions}>
            <Button size="sm" variant="ghost" icon="refresh" disabled={!p.changed} onClick={p.onReset} title="Back to the game's spot for this preset">
              Reset to the Game's Spot
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ───────────────────────────── player (flipped view) ─────────────────────────────

export function FlippedPlayerPanel({ slot, normal, flipped, onDone, onPartner }: { slot: number; normal: AlignmentPos[]; flipped: AlignmentPos[]; onDone(): void; onPartner(partner: number): void }) {
  const a = normal[slot];
  const f = flipped[slot];
  if (!a || !f) return null;
  const partner = flipPartner(normal, slot);
  return (
    <div className={s.inspectorBody}>
      <PanelBack onClick={onDone} />
      <div className={s.playerHead}>
        <div className={s.playerLabel}>{playerLabel(a)}</div>
        <div className={s.playerMeta}>
          <span>{positionName(a.pos)}</span>
          <span>Flipped</span>
        </div>
      </div>
      <div className={s.presetNote}>
        <Icon name="flip" size={14} />
        <span>
          When the play is flipped, {playerLabel(a)} lines up at <b>{fmtXY(f)}</b> — {partner === slot ? "his own spot" : `${playerLabel(normal[partner])}'s spot (${fmtXY(normal[partner])})`},
          mirrored. The game computes flipped spots from flip partners; you can't drag them.
        </span>
      </div>
      <FormRow label="Flip Partner" hint="Usually the matching player on the other side (WR1 ↔ WR2), or himself.">
        <Select size="sm" value={String(partner)} onChange={(v) => onPartner(Number(v))} options={slotOptions(normal)} aria-label="Flip partner" />
      </FormRow>
    </div>
  );
}

function PanelBack({ onClick }: { onClick(): void }) {
  return (
    <button type="button" className={s.panelBack} onClick={onClick} title="Back to the set (Esc on the field)">
      <Icon name="chevronLeft" size={13} /> Set Details
    </button>
  );
}

// ───────────────────────────── set ─────────────────────────────

export interface SetPanelProps {
  lib: LibraryIndex;
  file: string;
  fileData: SetsFile;
  allFiles: { path: string; data: SetsFile | null }[];
  spec: CustomSetSpec;
  base: SetDef;
  shown: AlignmentPos[];
  changed: ReadonlySet<number>;
  mode: string;
  flipped: boolean;
  /** validateSetsFile issues of this set. */
  issues: ValidationIssue[];
  hover?: number;
  clones: { name: string; warnings: CloneWarning[] }[];
  onSelect(slot: number): void;
  onHover(slot: number | undefined): void;
  update(fn: (d: CustomSetSpec, file: SetsFile) => void, label: string, coalesceMs?: number): void;
  onPlays(): void;
  onResetAll(): void;
}

const NEW_FORMATION = "__new__";

export function SetPanel(p: SetPanelProps) {
  const { lib, spec, base, fileData } = p;
  const prefix = useSettings((st) => st.assetPrefix);
  const baseForm = lib.formationByAsset.get(base.formation);
  const customForms = (fileData.formations ?? []).map((f, i) => ({ f, i })).filter(({ f }) => f && typeof f.asset === "string");
  const custom = findCustomFormation(fileData.formations, spec.formation);
  const libForm = lib.formationByAsset.get(spec.formation);
  const formationPath = formationPathOf(spec, fileData.formations);
  const [showAll, setShowAll] = useState(false);

  // Formation names are Madden names (caps in the trigger); the kind goes in the option's hint.
  const formOptions = [
    { value: base.formation, label: baseForm?.name ?? leaf(base.formation), hint: "Game formation" },
    ...(libForm && spec.formation !== base.formation ? [{ value: spec.formation, label: libForm.name, hint: "Game formation" }] : []),
    ...customForms.map(({ f }) => ({ value: customFormationAsset(f.asset), label: f.name || f.asset, hint: "My formation" })),
    ...(!libForm && !custom ? [{ value: spec.formation, label: spec.formation, hint: "Missing" }] : []),
    { value: NEW_FORMATION, label: "New Formation…", chrome: true },
  ];
  const formValue = custom ? customFormationAsset(custom.cf.asset) : spec.formation;
  const legacyRef = !!custom && spec.formation !== formValue;

  const nameTaken = useMemo(() => {
    if (!spec.name?.trim()) return false;
    const used = setNamesInFormation(lib, formationPath, p.allFiles, spec);
    return [...used].some((n) => norm(n) === norm(spec.name));
  }, [lib, formationPath, p.allFiles, spec]);

  const newFormation = async () => {
    const name = await promptDialog({
      title: "New Formation",
      body: <>It starts as a copy of {baseForm ? <span className="caps">{baseForm.name}</span> : "the starting set's formation"}.</>,
      label: "Formation Name",
      initial: `${baseForm?.name ?? "Formation"} ${prefix.replace(/_+$/, "") || "Custom"}`,
      confirmLabel: "Create",
      validate: (v) => (!v.trim() ? "Enter a name" : lib.data.formations.some((f) => norm(f.name) === norm(v)) ? "A game formation already has this name" : undefined),
    });
    if (!name?.trim()) return;
    const taken = new Set([...customFormationAssets(p.allFiles), ...libraryFormationLeaves(lib)]);
    const asset = suggestAsset(prefix, name.trim(), taken);
    p.update((d, f) => {
      (f.formations ??= []).push(newCustomFormation(base.formation, { name: name.trim(), asset }));
      d.formation = customFormationAsset(asset);
    }, "New formation");
  };

  const errors = p.issues.filter((i) => i.level === "error");
  const warnings = p.issues.filter((i) => i.level === "warning");
  const infos = p.issues.filter((i) => i.level === "info");
  const listed = showAll ? [...errors, ...warnings, ...infos] : [...errors, ...warnings].slice(0, 6);
  const warnClones = p.clones.filter((c) => c.warnings.length > 0).length;
  const preset = p.mode !== NORMAL;

  return (
    <div className={s.inspectorBody}>
      <Section title="Set">
        <FormRow label="Name" error={!spec.name?.trim() ? "Give the set a name" : nameTaken ? "Another set in this formation has this name" : undefined}>
          <TextInput value={spec.name ?? ""} onChange={(v) => p.update((d) => void (d.name = v), "name", 1500)} size="sm" invalid={!spec.name?.trim() || nameTaken} aria-label="Set name" />
        </FormRow>
        <FormRow label="Formation" hint={custom ? "Your own formation — it shows up in the game's formation list." : undefined}>
          <SearchSelect
            size="sm"
            value={formValue}
            options={formOptions}
            onChange={(v) => (v === NEW_FORMATION ? void newFormation() : v !== formValue && p.update((d) => void (d.formation = v), "formation"))}
            caps
            aria-label="Formation"
          />
        </FormRow>
        {custom && (
          <FormRow label="Formation Name">
            <TextInput value={custom.cf.name ?? ""} size="sm" onChange={(v) => p.update((_, f) => void (f.formations![custom.index].name = v), "formation-name", 1500)} aria-label="Formation name" />
          </FormRow>
        )}
        {legacyRef && (
          <div className={s.fixRow}>
            <Icon name="warning" size={13} />
            <span>This set points at its formation by a short name; the game builder needs the full path.</span>
            <Button size="sm" variant="secondary" onClick={() => p.update((d) => void (d.formation = formValue), "Fix formation path")}>
              Fix
            </Button>
          </div>
        )}
        <div className={s.baseLine}>
          <span>Started from</span>
          <b className="caps">
            {formationShort(baseForm?.name ?? "")} {base.name}
          </b>
        </div>
      </Section>

      <Section
        title="Plays in This Set"
        aside={
          <Button size="sm" variant={p.clones.length ? "secondary" : "primary"} icon="list" onClick={p.onPlays}>
            {p.clones.length ? "Add or Remove…" : "Add Plays…"}
          </Button>
        }
      >
        {p.clones.length ? (
          <ul className={s.cloneList}>
            {p.clones.slice(0, 8).map((c, i) => (
              <li key={i} title={c.warnings.map((w) => `${w.label}: ${w.reason}`).join("\n") || undefined}>
                {c.warnings.length > 0 ? <Icon name="warning" size={13} className={s.warnIcon} /> : <Icon name="check" size={13} className={s.okIcon} />}
                <span>{c.name}</span>
              </li>
            ))}
            {p.clones.length > 8 && <li className={s.muted}>+{p.clones.length - 8} more</li>}
          </ul>
        ) : (
          <div className={s.muted}>No plays yet. A set shows up in a playbook with the plays you copy into it — from its starting set or any other set.</div>
        )}
        {warnClones > 0 && (
          <div className={s.warnText}>
            {warnClones} play{warnClones === 1 ? " depends" : "s depend"} on players you moved — open “Plays in This Set” at the top right for details.
          </div>
        )}
      </Section>

      <Section
        title={preset ? `${presetLabel(p.mode)} · Players` : p.flipped ? "Flipped · Players" : `Players · ${p.changed.size} Changed`}
        aside={
          !p.flipped && (
            <Button size="sm" variant="ghost" icon="refresh" disabled={!p.changed.size} onClick={p.onResetAll} title={preset ? "Every player in this preset back to the game's spot" : "Every player back to the starting set"}>
              {preset ? "Reset Motion" : "Reset All"}
            </Button>
          )
        }
      >
        <div className={s.players}>
          {p.shown.map((a, slot) => (
            <button
              key={slot}
              type="button"
              className={cx(s.playerRow, p.hover === slot && s.playerRowHover)}
              onClick={() => p.onSelect(slot)}
              onPointerEnter={() => p.onHover(slot)}
              onPointerLeave={() => p.onHover(undefined)}
            >
              <span className={s.playerRowLabel}>{playerLabel(a)}</span>
              <span className={s.playerRowXY}>{fmtXY(a)}</span>
              {p.changed.has(slot) ? <span className={s.dot} aria-label="Changed" /> : <span className={s.dotOff} />}
            </button>
          ))}
        </div>
      </Section>

      <Section
        title="Checks"
        aside={
          errors.length + warnings.length === 0 ? (
            <Tag tone="ok" size="sm" icon="check">
              All Good
            </Tag>
          ) : (
            <span className={s.counts}>
              {errors.length > 0 && <Tag tone="danger" size="sm">{errors.length} Error{errors.length === 1 ? "" : "s"}</Tag>}
              {warnings.length > 0 && <Tag tone="warning" size="sm">{warnings.length} Warning{warnings.length === 1 ? "" : "s"}</Tag>}
            </span>
          )
        }
      >
        {listed.length ? (
          <ul className={s.issues}>
            {listed.map((i, k) => (
              <li key={k} data-level={i.level}>
                <Icon name={i.level === "info" ? "info" : "warning"} size={13} />
                <span>{i.message.replace(/^[^:]+: /, "")}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className={s.muted}>11 players, 7 on the line, line spacing and backfield depth all match what the game needs.</div>
        )}
        {(errors.length + warnings.length > 6 || infos.length > 0) && (
          <button type="button" className={s.linkBtn} onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show Less" : `Show All (${p.issues.length})`}
          </button>
        )}
      </Section>

      <Advanced id="set" hint="Asset names">
        <FormRow label="Set Asset" hint="The set's folder name in the game files. Renaming it changes the asset of every play copied into it.">
          <TextInput value={spec.asset ?? ""} onChange={(v) => p.update((d) => void (d.asset = v), "asset", 1500)} size="sm" mono aria-label="Set asset" />
        </FormRow>
        {custom && (
          <FormRow label="Formation Asset">
            <TextInput
              value={custom.cf.asset ?? ""}
              size="sm"
              mono
              onChange={(v) =>
                p.update((_, f) => {
                  // Keep every set of this file that points at the formation pointing at it.
                  const cf = f.formations![custom.index];
                  const old = { asset: cf.asset };
                  cf.asset = v;
                  for (const st of f.sets) if (st && refersToFormation(st.formation, old)) st.formation = customFormationAsset(v);
                }, "formation-asset", 1500)
              }
              aria-label="Formation asset"
            />
          </FormRow>
        )}
        <div className={s.monoBlock}>
          <div>
            <span>Starting Set</span> {leaf(base.asset)}
          </div>
          <div>
            <span>File</span> {p.file}
          </div>
        </div>
      </Advanced>
    </div>
  );
}

function Section({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <span>{title}</span>
        {aside}
      </div>
      {children}
    </section>
  );
}
