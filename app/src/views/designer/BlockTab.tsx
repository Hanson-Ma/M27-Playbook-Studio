// BLOCK tab: pass block (and block-and-release), run block, lead / kickout / trap / wham / crack / stalk (LeadBlock
// technique + gap), pull (pull animation + lead block), screen release (PassBlock ProtectReceiver).
import { useMemo, useState } from "react";
import { MiniRoute } from "../../field";
import { slotSide } from "../../model/designer";
import { isOffensiveLine } from "../../model/positions";
import { BLOCK_FAMILY, BLOCK_TOOLS, PULL_ANIMS, TECHNIQUE_FOR, blockSteps, detectBlockTool, replaceBody, type BlockToolId } from "../../model/routes";
import type { Step } from "../../model/types";
import { NumberField, SearchSelect, cx } from "../../ui";
import { Disclosure } from "./Disclosure";
import { GapPicker } from "./GapDiagram";
import { useDesigner } from "./shared";
import s from "./Inspector.module.css";

const techniqueLabel = (v: string) => v.replace(/^BLOCKINGTECHNIQUE_/, "").replace(/_/g, " ").toLowerCase();
/** "A_GAP_RIGHT" → "A gap right", "RUN_HOLE" → "the play's run hole". */
const gapLabel = (v: string) => (v === "RUN_HOLE" ? "the play's run hole" : v.replace(/_GAP_/, " gap ").replace(/_/g, " ").toLowerCase().replace(/^(\w)/, (c) => c.toUpperCase()));

const GAP_TOOLS = new Set<BlockToolId>(["lead", "kickout", "trap", "wham", "crack", "stalk", "pull"]);
const pullOptions = PULL_ANIMS.map((v) => ({ value: v, label: v.replace(/^MOVETYPE_/, "").replace(/_/g, " ") }));

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
        return { tool: t, steps: replaceBody(steps, built.steps, keep) };
      }),
    [steps, side, lineman, keep],
  );

  const apply = (tool: BlockToolId) => {
    const built = blockSteps(tool, optsFor(tool));
    d.commitSlot(slot, replaceBody(steps, built.steps, keep), `Block: ${BLOCK_TOOLS.find((t) => t.id === tool)!.label}`, {
      routeType: built.routeType,
      family: BLOCK_FAMILY[tool],
    });
  };

  const patch = (pred: (x: Step) => boolean, p: Record<string, unknown>, label: string, coalesceMs?: number) => {
    const next = patchFirst(steps, lock, pred, p);
    if (next) d.commitSlot(slot, next, label, undefined, coalesceMs);
  };

  const techniques = useMemo(
    () =>
      lib
        .enumValues("BlockingTechnique")
        .filter((v) => !/TOTAL|INVALID/.test(v))
        .map((v) => ({ value: v, label: v.replace(/^BLOCKINGTECHNIQUE_/, "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) })),
    [lib],
  );

  return (
    <>
      <section className={s.section}>
        <div className={s.sectionHead}>
          <span className={s.sectionTitle}>Blocking</span>
          {current && <span className={s.muted}>Now: {BLOCK_TOOLS.find((t) => t.id === current)?.label}</span>}
        </div>
        <div className={s.tiles}>
          {tiles.map(({ tool, steps: st }) => (
            <button key={tool.id} type="button" className={cx(s.tile, current === tool.id && s.tileActive)} onClick={() => apply(tool.id)} title={tool.hint}>
              <MiniRoute set={set} slot={slot} steps={st} size={58} />
              <span className={s.tileLabel}>{tool.label}</span>
            </button>
          ))}
        </div>
      </section>

      {current && GAP_TOOLS.has(current) && lead && (
        <section className={s.section}>
          <div className={s.sectionHead}>
            <span className={s.sectionTitle}>Which gap</span>
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
            <span className={s.sectionTitle}>{current === "release" ? "Block, then release" : "Screen release"}</span>
          </div>
          <div className={s.params}>
            <NumberField
              size="sm"
              label="BLOCK"
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
