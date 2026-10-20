// Option routes against each coverage: the coverages a defense can show, grouped by what every option receiver runs
// against them (one card per combination), so plays with several option routes show how the branches pair up. Click a
// card to show that coverage on the big field; CoverageSelect is the same choice as a dropdown for field toolbars.
import { useMemo } from "react";
import { COVERAGE_CASES, COVERAGE_CASE_BY_ID, coverageScenarios, optionReceivers, scenarioLabel } from "../model/optionCoverage";
import { branchNames } from "../model/optionRoutes";
import { sideOfX } from "../model/routes";
import type { PlayArt, Step } from "../model/types";
import { Select, cx } from "../ui";
import { cardViewport } from "./cardView";
import { Field } from "./Field";
import { PlayArtLayer } from "./PlayArtLayer";
import s from "./CoverageScenarios.module.css";

/** Does any player run an option route? */
export const hasOptionRoutes = (slots: readonly (readonly Step[] | undefined)[]): boolean => optionReceivers(slots).length > 0;

export interface CoverageScenariosProps {
  /** Each slot's steps (unflipped). */
  slots: readonly (readonly Step[] | undefined)[];
  /** AssignRouteType per slot (library option routes name their branches only there). */
  routeTypes?: readonly (string | undefined)[];
  /** Label (WR1, SL…) and unflipped lateral spot of each slot. */
  players: readonly { label: string; x: number }[];
  /** The art against one coverage (an OptionRouteCoverage bit, 0 = none of them). */
  artFor: (bit: number) => PlayArt;
  /** Coverage case shown on the big field (COVERAGE_CASES id), if any. */
  active?: string;
  onPick?: (caseId: string | undefined) => void;
  className?: string;
}

export function CoverageScenarios({ slots, routeTypes, players, artFor, active, onPick, className }: CoverageScenariosProps) {
  const receivers = useMemo(() => optionReceivers(slots), [slots]);
  const scenarios = useMemo(() => coverageScenarios(receivers), [receivers]);
  const names = useMemo(
    () =>
      receivers.map((r) => {
        const step = slots[r.slot]?.find((x) => x?.type === "OptionRoute");
        return branchNames(step, sideOfX(players[r.slot]?.x ?? 1), routeTypes?.[r.slot]);
      }),
    [receivers, slots, routeTypes, players],
  );
  const guessed = names.some((n) => n.guessed);

  if (!receivers.length) return <p className={s.empty}>No player on this play runs an option route.</p>;

  return (
    <div className={cx(s.wrap, className)}>
      <p className={s.intro}>
        {receivers.length === 1 ? "One option route" : `${receivers.length} option routes`} · {scenarios.length} scenario{scenarios.length === 1 ? "" : "s"}. Each card is
        what the option receivers run against those coverages{onPick ? "; click one to show it on the field" : ""}.
      </p>
      {guessed && <p className={s.note}>Library option routes don't say which branch is which: names and shapes (dashed) are guessed from the route type.</p>}
      <div className={s.grid}>
        {scenarios.map((sc) => {
          const on = !!active && sc.cases.some((c) => c.id === active);
          const pick = () => onPick?.(on ? undefined : sc.cases[0].id);
          return (
            <div
              key={sc.cases.map((c) => c.id).join()}
              className={cx(s.card, on && s.on, onPick && s.clickable)}
              role={onPick ? "button" : undefined}
              tabIndex={onPick ? 0 : undefined}
              aria-pressed={onPick ? on : undefined}
              onClick={onPick ? pick : undefined}
              onKeyDown={
                onPick
                  ? (e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      e.stopPropagation();
                      pick();
                    }
                  : undefined
              }
            >
              <div className={s.title} title={sc.cases.map((c) => `${c.label}: ${c.hint}`).join("\n")}>
                {scenarioLabel(sc.cases)}
              </div>
              <ScenarioArt artFor={artFor} bit={sc.cases[0].bit} />
              <ul className={s.list}>
                {receivers.map((r, i) => (
                  <li key={r.slot} className={s.row}>
                    <span className={s.player}>{players[r.slot]?.label ?? `#${r.slot}`}</span>
                    <span className={s.branch}>{names[i].names[sc.picks[i]] ?? `Branch ${sc.picks[i] + 1}`}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScenarioArt({ artFor, bit }: { artFor: (bit: number) => PlayArt; bit: number }) {
  const art = useMemo(() => artFor(bit), [artFor, bit]);
  return (
    <div className={s.art}>
      <Field viewport={cardViewport("offense")} fit="cover" className={s.field} label="Play art against this coverage">
        <PlayArtLayer art={art} compact />
      </Field>
    </div>
  );
}

/** "All Branches" or one coverage, for a field toolbar. */
export function CoverageSelect({ value, onChange }: { value: string | undefined; onChange: (caseId: string | undefined) => void }) {
  return (
    <Select
      size="sm"
      value={value ?? ""}
      onChange={(v) => onChange(v || undefined)}
      options={[{ value: "", label: "All Branches" }, ...COVERAGE_CASES.map((c) => ({ value: c.id, label: `vs ${c.label}` }))]}
      aria-label="Show option routes against a coverage"
    />
  );
}

/** The ArtOptions.coverage bit for a coverage case id (undefined: every branch). */
export const coverageBit = (caseId: string | undefined): number | undefined => (caseId ? COVERAGE_CASE_BY_ID.get(caseId)?.bit : undefined);
