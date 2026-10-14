// ROUTE tab → "Option Route": the stem is the route's legs; the branches (what the player does once the game reads the
// coverage) are listed here. Each branch is one of the game's OptionRoutes assets, a direction, and the coverages it's
// for (Default = whatever isn't picked on another branch). Not an option route yet? One click turns the route into one.
import { useMemo } from "react";
import { MiniRoute } from "../../field";
import { OPTION_ROUTE_ROOT } from "../../model/art";
import { slotSide } from "../../model/designer";
import {
  ALL_MAN,
  ALL_ZONE,
  BRANCH_TYPES,
  BRANCH_TYPE_BY_ID,
  COVERAGES,
  DEFAULT_COVERAGE,
  branchDir,
  branchLeaf,
  branchProblems,
  branchesOf,
  coverageFlags,
  coverageSummary,
  coverageValue,
  defaultBranches,
  optionRouteTypeLabel,
  optionRouteTypes,
  optionStep,
  optionStepIndex,
  parseBranch,
  suggestOptionRouteType,
  withBranches,
  type Branch,
} from "../../model/optionRoutes";
import { presetSteps, replaceBody, routeBody } from "../../model/routes";
import type { Step } from "../../model/types";
import { Button, Chip, IconButton, Segmented, Select } from "../../ui";
import { slotGeometry, useDesigner } from "./shared";
import s from "./OptionBranches.module.css";
import i from "./Inspector.module.css";

export function OptionBranches({ slot, lock }: { slot: number; lock: number }) {
  const d = useDesigner();
  const { state, set, lib } = d;
  const steps = state.slots[slot].steps;
  const side = slotSide(state, slot);
  const keep = lock > 0 ? lock : undefined;
  const idx = optionStepIndex(steps);
  const isOption = idx >= 0;
  const branches = useMemo(() => branchesOf(steps[idx]), [steps, idx]);
  const problems = useMemo(
    () => (isOption ? branchProblems(branches, (leaf) => !!lib.assignment(OPTION_ROUTE_ROOT + leaf)) : []),
    [isOption, branches, lib],
  );
  const allTypes = useMemo(() => optionRouteTypes(lib.enumValues("AssignRouteType")), [lib]);
  const suggested = suggestOptionRouteType(branches, side);
  const currentType = state.slots[slot].routeType;
  const typeValue = currentType && allTypes.includes(currentType) ? currentType : "";
  const startY = slotGeometry(set, slot, steps, lock).start.y;

  const commitBranches = (next: Branch[], label: string) => {
    d.commitSlot(slot, withBranches(steps, next), label, { routeType: suggestOptionRouteType(next, side), family: "Option" });
  };
  const update = (k: number, patch: Partial<Branch>) => commitBranches(branches.map((b, n) => (n === k ? { ...b, ...patch } : b)), "Option branch");

  const makeOption = () => {
    // Keep the player's route as the stem (minus the cut / find-space that ended it: each branch brings its own);
    // a player with no route yet gets the Option preset's stem.
    const own = routeBody(steps, keep).slice();
    while (own.length && ["GetOpen", "ReceiverCut", "Delay", "RunRouteFakeOut"].includes(own[own.length - 1].type)) own.pop();
    const fresh = presetSteps("option", { side, startY }).steps.filter((x) => x.type !== "OptionRoute" && x.type !== "GetOpen");
    const stem = own.some((x) => x.type === "RunRoute") ? own : fresh;
    const bs = defaultBranches(side);
    const chain: Step[] = [...stem, optionStep(bs), { type: "GetOpen" }];
    d.commitSlot(slot, replaceBody(steps, chain, keep, { keepMotion: true }), "Make option route", { routeType: suggestOptionRouteType(bs, side), family: "Option" });
  };

  const addBranch = () => {
    const used = branches.reduce((a, b) => a | coverageFlags(b.coverage), 0);
    const free = COVERAGES.reduce((a, c) => a | c.bit, 0) & ~used;
    const type = BRANCH_TYPE_BY_ID.get("inout")!;
    const leaf = branchLeaf(type, side, "out") ?? branchLeaf(type, side, "in")!;
    commitBranches([...branches, { route: leaf, coverage: coverageValue(free || 32) }], "Add option branch");
  };

  const typeOptions = [{ value: "", label: `Auto · ${optionRouteTypeLabel(suggested)}` }, ...allTypes.map((t) => ({ value: t, label: optionRouteTypeLabel(t) }))];

  if (!isOption)
    return (
      <div className={s.block}>
        <div className={s.blockHead}>Option Route</div>
        <p className={i.note}>
          An option route runs one stem, then the game picks the finish from the coverage it sees: a hitch against zone, an out against man, a go against Cover 2. This
          keeps the route he has now as the stem, and you choose each finish and the coverages it's for.
        </p>
        <Button size="sm" icon="route" onClick={makeOption} disabled={lock > 0}>
          Make This an Option Route
        </Button>
      </div>
    );

  return (
    <div className={s.block}>
      <div className={s.blockHead}>
        Option Route <span className={i.muted}>{branches.length} branch{branches.length === 1 ? "" : "es"}</span>
      </div>
      <div className={i.paramRows}>
        <div className={i.paramRow}>
          <span className={i.fieldLabel}>Type</span>
          <Select
            size="sm"
            value={typeValue}
            options={typeOptions}
            onChange={(v) => d.commitSlot(slot, steps, "Option route type", { routeType: v || suggested, family: "Option" })}
            aria-label="Option route type"
          />
        </div>
      </div>
      <p className={i.note}>The legs above are the stem. Each branch below is what he does after it, for the coverages ticked on it.</p>
      <div className={s.cards}>
        {branches.map((b, k) => {
          const parsed = parseBranch(b.route);
          const flags = coverageFlags(b.coverage);
          const dir = parsed ? branchDir(side, parsed.field) : "out";
          const other = dir === "in" ? "out" : "in";
          const previewSteps = withBranches(steps, [{ ...b, coverage: DEFAULT_COVERAGE }]);
          const setFlags = (f: number) => update(k, { coverage: coverageValue(f) });
          return (
            <div key={`${b.route}-${k}`} className={s.card}>
              <MiniRoute set={set} slot={slot} steps={previewSteps} size={58} primary={slot === d.vip} />
              <div className={s.cardBody}>
                <div className={s.cardTop}>
                  <Select
                    size="sm"
                    value={parsed?.type.id ?? b.route}
                    options={[
                      ...(parsed ? [] : [{ value: b.route, label: b.route, disabled: true }]),
                      ...BRANCH_TYPES.map((t) => ({ value: t.id, label: t.label })),
                    ]}
                    onChange={(id) => {
                      const t = BRANCH_TYPE_BY_ID.get(id);
                      // Keep the direction when the game has that side; otherwise the only side it has.
                      const leaf = t ? (branchLeaf(t, side, dir) ?? branchLeaf(t, side, other)) : undefined;
                      if (leaf) update(k, { route: leaf });
                    }}
                    title={parsed?.type.hint}
                    aria-label="Branch route"
                  />
                  <IconButton
                    icon="trash"
                    size="sm"
                    title={branches.length === 1 ? "An option route needs at least one branch" : "Remove this branch"}
                    disabled={branches.length === 1}
                    onClick={() => commitBranches(branches.filter((_, n) => n !== k), "Remove option branch")}
                  />
                </div>
                {parsed && (
                  <Segmented
                    size="sm"
                    value={dir}
                    options={[
                      { value: "in", label: "Inside", disabled: !branchLeaf(parsed.type, side, "in") },
                      { value: "out", label: "Outside", disabled: !branchLeaf(parsed.type, side, "out") },
                    ]}
                    onChange={(v) => {
                      const leaf = branchLeaf(parsed.type, side, v);
                      if (leaf) update(k, { route: leaf });
                    }}
                    aria-label="Break direction"
                  />
                )}
                <div className={s.label}>Runs against</div>
                <div className={s.chips}>
                  <Chip active={flags === 0} onClick={() => setFlags(0)} title="The finish when none of the coverages picked on the other branches show up">
                    Default
                  </Chip>
                  {COVERAGES.map((c) => (
                    <Chip key={c.id} active={(flags & c.bit) !== 0} onClick={() => setFlags(flags & c.bit ? flags & ~c.bit : flags | c.bit)} title={c.hint}>
                      {c.label}
                    </Chip>
                  ))}
                </div>
                <div className={s.quick}>
                  <Button size="sm" variant="ghost" onClick={() => setFlags((flags & ALL_MAN) === ALL_MAN ? flags & ~ALL_MAN : flags | ALL_MAN)}>
                    Any Man
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setFlags((flags & ALL_ZONE) === ALL_ZONE ? flags & ~ALL_ZONE : flags | ALL_ZONE)}>
                    Any Zone
                  </Button>
                  <span className={s.summary}>{coverageSummary(b.coverage)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {problems.length > 0 && (
        <div className={s.problems}>
          {problems.map((p) => (
            <div key={p.message} className={p.level === "error" ? s.error : s.warning}>
              {p.message}
            </div>
          ))}
        </div>
      )}
      <div className={s.actions}>
        <Button size="sm" icon="plus" onClick={addBranch} disabled={lock > 0}>
          Add Branch
        </Button>
      </div>
    </div>
  );
}
