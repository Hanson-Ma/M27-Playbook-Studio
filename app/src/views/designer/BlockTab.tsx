// BLOCK tab: pass block (and block-and-release), run block, lead / kickout / trap / wham / crack / stalk (LeadBlock
// technique + gap), pull (pull animation + lead block), screen release (PassBlock ProtectReceiver), and the path a
// blocker runs before his block (MoveDirection legs). A block keeps the player's motion: motion, then lead.
import { useMemo, useState } from "react";
import { MiniRoute } from "../../field";
import { slotSide } from "../../model/designer";
import { isOffensiveLine } from "../../model/positions";
import {
  BLOCK_FAMILY,
  BLOCK_PATH_PRESETS,
  BLOCK_PATH_TOOLS,
  BLOCK_TOOLS,
  PULL_ANIMS,
  RELEASE_ROUTES,
  TECHNIQUE_FOR,
  blockPath,
  blockPathLeg,
  blockPathPreset,
  blockSteps,
  detectBlockTool,
  keptPrefixLength,
  releaseRouteSteps,
  replaceBody,
  withBlockPath,
  type BlockToolId,
  type ReleaseRouteId,
} from "../../model/routes";
import { stripNone } from "../../model/steps";
import type { Step } from "../../model/types";
import { Button, IconButton, NumberField, SearchSelect, cx } from "../../ui";
import { Disclosure } from "./Disclosure";
import { GapPicker } from "./GapDiagram";
import { useDesigner } from "./shared";
import { titleCase } from "./titleCase";
import s from "./Inspector.module.css";

/** "BLOCKINGTECHNIQUE_LEAD_BLOCK" → "Lead block" (a caption: sentence case). */
const techniqueLabel = (v: string) => v.replace(/^BLOCKINGTECHNIQUE_/, "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
/** "A_GAP_RIGHT" → "A gap right", "RUN_HOLE" → "the play's run hole". */
const gapLabel = (v: string) => (v === "RUN_HOLE" ? "the play's run hole" : v.replace(/_GAP_/, " gap ").replace(/_/g, " ").toLowerCase().replace(/^(\w)/, (c) => c.toUpperCase()));

const GAP_TOOLS = new Set<BlockToolId>(["lead", "kickout", "trap", "wham", "crack", "stalk", "pull"]);
const pullOptions = PULL_ANIMS.map((v) => ({ value: v, label: titleCase(v.replace(/^MOVETYPE_/, "").replace(/_/g, " ").toLowerCase()) }));

/** Replace the first step (at or after `from`) matching `pred` with a patched copy. */
function patchFirst(steps: Step[], from: number, pred: (s: Step) => boolean, patch: Record<string, unknown>): Step[] | undefined {
  const i = steps.findIndex((x, j) => j >= from && pred(x));
  if (i < 0) return undefined;
  const out = steps.slice();
  out[i] = { ...steps[i], ...patch };
  return out;
}

export function BlockTab({ slot, lock }: { slot: number; lock: number }) {
  const d = useDesigner();
  const { state, set, lib } = d;
  const steps = state.slots[slot].steps;
  const side = slotSide(state, slot);
  const lineman = isOffensiveLine(set.movements.Normal[slot].pos);
  const keep = lock > 0 ? lock : undefined;
  const body = steps.slice(lock);
  const current = detectBlockTool(body);
  // The block part: after his motion / handoff (kept when a block is picked), then the path legs and the block.
  const prefix = keptPrefixLength(steps, keep);
  const blockBody = useMemo(() => stripNone(steps.slice(prefix) as Step[]), [steps, prefix]);
  const path = useMemo(() => blockPath(blockBody), [blockBody]);
  const withMotion = (bodySteps: Step[]) => replaceBody(steps, bodySteps, keep, { keepMotion: true });
  const builtWithPath = (tool: BlockToolId, built: Step[]) => (BLOCK_PATH_TOOLS.has(tool) && path.length ? withBlockPath(built, path) : built);

  const lead = body.find((x) => x.type === "LeadBlock");
  const pull = body.find((x) => x.type === "InitialAnim" && /PULL/.test(String(x.anim ?? "")));
  const timed = body.find((x) => x.type === "PassBlock" && typeof x.time === "number" && (x.time as number) > 0);
  const screenLeg = body.find((x) => x.type === "MoveDirection");

  const [gap, setGap] = useState<string>(String(lead?.blockingGap ?? "RUN_HOLE"));
  const [anim, setAnim] = useState<string>(String(pull?.anim ?? "MOVETYPE_COUNTER_PULL"));
  const [time, setTime] = useState<number>(typeof timed?.time === "number" ? (timed.time as number) : 1);

  const optsFor = (tool: BlockToolId) => ({
    side,
    gap: GAP_TOOLS.has(tool) ? (lead ? String(lead.blockingGap) : gap) : undefined,
    technique: tool === "pull" && lead && /LEAD|KICKOUT|TRAP|OUTSIDE/.test(String(lead.blockingTechnique)) ? String(lead.blockingTechnique) : TECHNIQUE_FOR[tool],
    anim,
    time,
    lineman,
  });

  const tiles = useMemo(
    () =>
      BLOCK_TOOLS.map((t) => {
        const built = blockSteps(t.id, { side, lineman });
        return { tool: t, steps: withMotion(builtWithPath(t.id, built.steps)) };
      }),
    [steps, side, lineman, keep, path], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Block, then release: pass block for a beat (the Block time below), then a ready-made route.
  const releaseTime = typeof timed?.time === "number" ? (timed.time as number) : time;
  const releaseTiles = useMemo(
    () =>
      RELEASE_ROUTES.map((r) => {
        const built = releaseRouteSteps(r.id, side, releaseTime);
        return { route: r, built, steps: withMotion(built.steps) };
      }),
    [steps, side, keep, releaseTime], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const bodyKey = JSON.stringify(blockBody);
  const applyRelease = (id: ReleaseRouteId) => {
    const r = releaseTiles.find((x) => x.route.id === id)!;
    d.commitSlot(slot, r.steps, `Block & release: ${titleCase(r.route.label)}`, { routeType: r.built.routeType, family: BLOCK_FAMILY.release });
  };

  const apply = (tool: BlockToolId) => {
    const built = blockSteps(tool, optsFor(tool));
    d.commitSlot(slot, withMotion(builtWithPath(tool, built.steps)), `Block: ${BLOCK_TOOLS.find((t) => t.id === tool)!.label}`, {
      routeType: built.routeType,
      family: BLOCK_FAMILY[tool],
    });
  };

  const setPath = (legs: Step[], label: string, coalesceMs?: number) =>
    d.commitSlot(slot, [...steps.slice(0, prefix), ...withBlockPath(blockBody, legs), { type: "None" }], label, undefined, coalesceMs);
  const setLeg = (k: number, p: Record<string, unknown>) => setPath(path.map((l, i) => (i === k ? { ...l, ...p } : l)), "Path to the block", 700);

  const patch = (pred: (x: Step) => boolean, p: Record<string, unknown>, label: string, coalesceMs?: number) => {
    const next = patchFirst(steps, lock, pred, p);
    if (next) d.commitSlot(slot, next, label, undefined, coalesceMs);
  };

  const techniques = useMemo(
    () =>
      lib
        .enumValues("BlockingTechnique")
        .filter((v) => !/TOTAL|INVALID/.test(v))
        .map((v) => ({ value: v, label: titleCase(v.replace(/^BLOCKINGTECHNIQUE_/, "").replace(/_/g, " ").toLowerCase()) })),
    [lib],
  );

  return (
    <>
      <section className={s.section}>
        <div className={s.sectionHead}>
          <span className={s.sectionTitle}>Blocking</span>
          {current && <span className={s.muted}>Now: {titleCase(BLOCK_TOOLS.find((t) => t.id === current)?.label ?? "")}</span>}
        </div>
        <div className={s.tiles}>
          {tiles.map(({ tool, steps: st }) => (
            <button key={tool.id} type="button" className={cx(s.tile, current === tool.id && s.tileActive)} onClick={() => apply(tool.id)} title={tool.hint}>
              <MiniRoute set={set} slot={slot} steps={st} size={58} />
              <span className={s.tileLabel}>{titleCase(tool.label)}</span>
            </button>
          ))}
        </div>
      </section>

      {!lineman && (
        <section className={s.section}>
          <div className={s.sectionHead}>
            <span className={s.sectionTitle}>Block, Then Release</span>
          </div>
          <div className={s.tiles}>
            {releaseTiles.map(({ route, built, steps: st }) => (
              <button
                key={route.id}
                type="button"
                className={cx(s.tile, JSON.stringify(built.steps) === bodyKey && s.tileActive)}
                onClick={() => applyRelease(route.id)}
                title={`${route.hint}. Blocks for ${releaseTime}s first.`}
              >
                <MiniRoute set={set} slot={slot} steps={st} size={58} />
                <span className={s.tileLabel}>{titleCase(route.label)}</span>
              </button>
            ))}
          </div>
          <p className={s.note}>Pass blocks first, then runs the route. Change how long he blocks under Block, Then Release below once one is picked; tweak the route in the Route tab.</p>
        </section>
      )}

      {current && GAP_TOOLS.has(current) && lead && (
        <section className={s.section}>
          <div className={s.sectionHead}>
            <span className={s.sectionTitle}>Which Gap</span>
            <span className={s.muted}>{gapLabel(String(lead.blockingGap))}</span>
          </div>
          <GapPicker
            value={String(lead.blockingGap)}
            onChange={(v) => {
              setGap(v);
              patch((x) => x.type === "LeadBlock", { blockingGap: v }, "Block gap");
            }}
          />
          <Disclosure id="block.technique" title="Technique" hint={techniqueLabel(String(lead.blockingTechnique))}>
            <SearchSelect
              size="sm"
              value={String(lead.blockingTechnique)}
              options={techniques}
              onChange={(v) => patch((x) => x.type === "LeadBlock", { blockingTechnique: v }, "Block technique")}
              width="100%"
            />
          </Disclosure>
        </section>
      )}

      {current && BLOCK_PATH_TOOLS.has(current) && (
        <section className={s.section}>
          <div className={s.sectionHead}>
            <span className={s.sectionTitle}>Path to the Block</span>
            <span className={s.muted}>{path.length ? `${path.length} leg${path.length === 1 ? "" : "s"}` : "Blocks from where he is"}</span>
          </div>
          <div className={s.tiles}>
            {BLOCK_PATH_PRESETS.map((pr) => {
              const legs = blockPathPreset(pr.id, side);
              return (
                <button
                  key={pr.id}
                  type="button"
                  className={cx(s.tile, JSON.stringify(legs) === JSON.stringify(path) && s.tileActive)}
                  onClick={() => setPath(legs, `Path to the block: ${pr.label}`)}
                  title={pr.hint}
                >
                  <MiniRoute set={set} slot={slot} steps={[...steps.slice(0, prefix), ...withBlockPath(blockBody, legs), { type: "None" }]} size={58} />
                  <span className={s.tileLabel}>{pr.label}</span>
                </button>
              );
            })}
          </div>
          {path.map((leg, k) => (
            <div key={k} className={s.params}>
              <NumberField size="sm" label="YD" value={Number(leg.distance)} min={0.5} max={30} step={0.5} onChange={(v) => setLeg(k, { distance: v })} />
              <NumberField size="sm" label="DIR" suffix="°" value={Number(leg.direction)} min={0} max={359} step={5} onChange={(v) => setLeg(k, { direction: v })} />
              <IconButton icon="trash" size="sm" title="Remove this leg" onClick={() => setPath(path.filter((_, i) => i !== k), "Remove path leg")} />
            </div>
          ))}
          <div className={s.params}>
            <Button size="sm" icon="plus" onClick={() => setPath([...path, blockPathLeg(3, 90)], "Add path leg")}>
              Add Leg
            </Button>
            {path.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setPath([], "Clear path to the block")}>
                Block From Where He Is
              </Button>
            )}
          </div>
          <p className={s.note}>He runs these legs after the snap (and after any motion), then makes his block. Direction: 90° = straight upfield, 0° = toward the right sideline.</p>
        </section>
      )}

      {current === "pull" && pull && (
        <section className={s.section}>
          <div className={s.sectionHead}>
            <span className={s.sectionTitle}>Pull</span>
          </div>
          <SearchSelect
            size="sm"
            value={String(pull.anim)}
            options={pullOptions}
            onChange={(v) => {
              setAnim(v);
              patch((x) => x.type === "InitialAnim" && /PULL/.test(String(x.anim ?? "")), { anim: v }, "Pull animation");
            }}
            width="100%"
          />
        </section>
      )}

      {(current === "release" || current === "screen") && (
        <section className={s.section}>
          <div className={s.sectionHead}>
            <span className={s.sectionTitle}>{current === "release" ? "Block, Then Release" : "Screen Release"}</span>
          </div>
          <div className={s.params}>
            <NumberField
              size="sm"
              label="Block"
              suffix="s"
              value={typeof timed?.time === "number" ? (timed.time as number) : 0}
              min={0}
              max={6}
              step={0.25}
              onChange={(v) => {
                setTime(v);
                patch((x) => x.type === "PassBlock" && !/ProtectReceiver/.test(String(x.flags ?? "")), { time: v }, "Block time", 700);
              }}
            />
            {current === "screen" && screenLeg && (
              <>
                <NumberField
                  size="sm"
                  label="YD"
                  value={Number(screenLeg.distance)}
                  min={0.5}
                  max={20}
                  step={0.5}
                  onChange={(v) => patch((x) => x.type === "MoveDirection", { distance: v }, "Screen release", 700)}
                />
                <NumberField
                  size="sm"
                  label="DIR"
                  suffix="°"
                  value={Number(screenLeg.direction)}
                  min={0}
                  max={359}
                  step={5}
                  onChange={(v) => patch((x) => x.type === "MoveDirection", { direction: v }, "Screen release", 700)}
                />
              </>
            )}
          </div>
          <p className={s.note}>
            {current === "release"
              ? "Blocks for this long, then runs the route after it (edit it on the field or in the Route tab)."
              : "Screen blocking: sell pass protection, release, then lead the receiver."}
          </p>
        </section>
      )}
      {!current && <p className={cx(s.note, s.padded)}>This player doesn't block yet. Pick a block above — any motion or handoff in front of it stays.</p>}
    </>
  );
}
