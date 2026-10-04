// Play detail side panels: OVERVIEW (identity, availability, primary receiver, concept tags; asset ids behind
// "Advanced"), PLAYERS (alignment + assignment per slot, expandable steps and raw JSON) and READS (progression with
// percentages, the primary receiver in red).
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { categoriesForPlay } from "../../model/conceptsDoc";
import type { Catalog } from "../../model/catalog";
import { displayFromLeaf, leaf } from "../../model/names";
import { positionName } from "../../model/positions";
import { playTypeInfo } from "../../model/playtypes";
import { readConceptLabel, routeTypeLabel } from "../../model/search";
import { stepSummary, stripNone } from "../../model/steps";
import type { PlayArt, ResolvedPlay, SetDef } from "../../model/types";
import { navigate } from "../../state/router";
import { useLibraryUi } from "./libraryStore";
import { Chip, Icon, IconButton, Tag, cx } from "../../ui";
import { copyText, designerAction, isSetClone, playHref } from "./playActions";
import { fmtYd, stanceLabel } from "./format";
import { useConceptsDoc } from "./useLibraryResults";
import s from "./PlayDetail.module.css";

// ───────────────────────────── overview ─────────────────────────────

const GAP = ["", "A", "A", "B", "B", "C", "C", "D", "D", "E"];

/** runHole: 0 middle, odd = left (1 A, 3 B, 5 C, 7 D, 9 E), even = right (2 A, 4 B, 6 C, 8 D). */
export function runHoleLabel(h: number): string {
  if (!h) return "0 · middle";
  const gap = GAP[h] ?? "?";
  return `${h} · ${gap} gap ${h % 2 ? "left" : "right"}`;
}

function KV({ k, children, mono }: { k: string; children: ReactNode; mono?: boolean }) {
  return (
    <>
      <dt className={s.k}>{k}</dt>
      <dd className={cx(s.v, mono && s.mono)}>{children}</dd>
    </>
  );
}

const yesNo = (b: boolean) => (b ? "Yes" : "No");

export function OverviewPanel({ play, catalog }: { play: ResolvedPlay; catalog: Catalog }) {
  const lib = catalog.lib;
  const formation = lib.formationByAsset.get(play.formation);
  const set = lib.setByAsset.get(play.set);
  const info = playTypeInfo(play.playType);
  const concepts = useConceptsDoc();
  const cats = categoriesForPlay(concepts, play.key);
  const reads = [...new Set(play.reads.map((r) => readConceptLabel(r.concept)).filter((x): x is string => !!x))];
  const vipSlot = set?.movements.Normal?.[play.vip];
  const base = play.base ? catalog.get(play.base) : undefined;
  const custom = play.source === "custom";
  const design = designerAction(play);

  const browseSet = () => {
    useLibraryUi.getState().setFilters({ side: play.side, formation: play.formation, set: play.set });
    useLibraryUi.getState().set({ tab: "all", query: "" });
    navigate("#/library");
  };

  return (
    <div className={s.stack}>
      <section className={s.block}>
        <div className={s.bigName}>{play.name}</div>
        <div className={s.typeLine}>
          <span className={s.typeDot} style={{ "--c": info.color } as CSSProperties} />
          {info.long}
        </div>
        <button type="button" className={s.linkBtn} onClick={browseSet} title="Show every play in this set">
          {formation?.name ?? displayFromLeaf(leaf(play.formation))} › {set?.name ?? displayFromLeaf(leaf(play.set))}
          <Icon name="chevronRight" size={13} />
        </button>
      </section>

      <section className={cx(s.avail, custom ? s.availCustom : play.global ? s.availOk : s.availMod)}>
        <div className={s.availTitle}>
          <Icon name={play.global ? "check" : "warning"} size={15} />
          {custom ? "Custom play · needs the mod" : play.global ? "Global · works without the mod" : "Needs mod"}
        </div>
        <p className={s.availBody}>
          {custom
            ? "Custom plays are built into pbstudio.fbmod by tools/export.ps1. A playbook that uses this play needs the mod enabled in MMC."
            : play.global
              ? "This play is in the game's global play sheet, so a custom playbook can use it with no mod."
              : "Not in the global play sheet: the game silently drops it from a custom playbook. Export detects it and pbstudio.fbmod pulls it in, so it works once the mod is enabled."}
        </p>
      </section>

      <dl className={s.kv}>
        {play.side !== "defense" && (
          <KV k="Primary receiver">
            <span className={s.vipValue}>
              <span className={s.vipDot} />
              {vipSlot ? `${positionName(vipSlot.pos)} (slot ${play.vip})` : `Slot ${play.vip}`} · red route
            </span>
            {design.enabled && (
              <button type="button" className={s.linkBtn} onClick={design.run} title="The primary receiver is set per play in the designer (Play → Primary receiver)">
                {custom ? "Change in designer" : "Change it on a copy"} <Icon name="chevronRight" size={13} />
              </button>
            )}
          </KV>
        )}
        {(info.family === "run" || info.family === "option" || play.runHole > 0) && <KV k="Run hole">{runHoleLabel(play.runHole)}</KV>}
        <KV k="Can flip">{yesNo(play.canFlip)}</KV>
        <KV k="Hot routes">{yesNo(play.allowHotRoutes)}</KV>
        <KV k="Source">{custom ? (isSetClone(play) ? "Cloned into a custom set" : "Custom play") : "Stock library"}</KV>
        {custom && (
          <KV k={isSetClone(play) ? "Cloned from" : "Base play"}>
            {base ? (
              <button type="button" className={s.linkBtn} onClick={() => navigate(playHref(base.key))}>
                {base.name} <Icon name="chevronRight" size={13} />
              </button>
            ) : (
              <span className={s.mono}>{play.base ? leaf(play.base) : "—"}</span>
            )}
          </KV>
        )}
      </dl>

      <details className={s.advanced}>
        <summary>Advanced</summary>
        <dl className={s.kv}>
          {play.playId !== undefined && <KV k="Play ID">{play.playId}</KV>}
          <KV k="Asset" mono>
            <span className={s.assetLine}>
              <span className={s.assetText} title={play.asset}>
                {play.asset.replace("football/Gameplay/playbooks/PlayLibrary/", "…/")}
              </span>
              <IconButton icon="copy" title="Copy asset path" size="sm" onClick={() => void copyText(play.asset, "Asset path copied")} />
            </span>
          </KV>
          <KV k="Play type" mono>
            {play.playType.replace(/^(Offense|Defense)PlayType_/, "")}
          </KV>
          <KV k="Blocking" mono>
            {play.blocking ? leaf(play.blocking) : "—"}
          </KV>
          <KV k="Run hole">{runHoleLabel(play.runHole)}</KV>
          {custom && (
            <KV k="File" mono>
              {play.clone ? `${play.clone.file} · set #${play.clone.setIndex + 1} · clone #${play.clone.index + 1}` : `${play.file} #${(play.index ?? 0) + 1}`}
            </KV>
          )}
          {custom && play.base && (
            <KV k="Base asset" mono>
              {play.base}
            </KV>
          )}
        </dl>
      </details>

      <section className={s.block}>
        <div className={s.blockHead}>
          <span>Concepts</span>
          <button type="button" className={s.linkBtn} onClick={() => navigate(`#/concepts?play=${encodeURIComponent(play.key)}&from=library`)}>
            Edit tags <Icon name="chevronRight" size={13} />
          </button>
        </div>
        <div className={s.chips}>
          {cats.map((c) => (
            <Chip key={c.id} color={c.color}>
              {c.name}
            </Chip>
          ))}
          {reads.map((r) => (
            <Tag key={r} tone="neutral" variant="outline" size="sm">
              Read · {r}
            </Tag>
          ))}
          {!cats.length && !reads.length && <span className={s.dimText}>No concept tags or read concepts</span>}
        </div>
      </section>

      {play.problems.length > 0 && (
        <section className={s.block}>
          <div className={s.blockHead}>
            <span>Problems</span>
          </div>
          <ul className={s.problems}>
            {play.problems.map((p, i) => (
              <li key={i}>
                <Icon name="warning" size={13} /> {p}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ───────────────────────────── players ─────────────────────────────

interface PlayersPanelProps {
  play: ResolvedPlay;
  art: PlayArt;
  set?: SetDef;
  selectedSlot?: number;
  onSelect(slot: number): void;
  onHover(slot: number | undefined): void;
  expanded: Set<number>;
  onToggle(slot: number): void;
}

export function PlayersPanel({ play, art, set, selectedSlot, onSelect, onHover, expanded, onToggle }: PlayersPanelProps) {
  const rows = set?.movements.Normal ?? [];
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    if (selectedSlot !== undefined) refs.current[selectedSlot]?.scrollIntoView({ block: "nearest" });
  }, [selectedSlot]);

  return (
    <div className={s.players}>
      {rows.map((a, i) => {
        const p = art.players.find((x) => x.slot === i);
        const slot = play.slots[i];
        const on = selectedSlot === i;
        const open = expanded.has(i);
        const name = slot?.assignment ? leaf(slot.assignment) : slot?.authored ? `PBS/${slot.authored}` : "—";
        const isVip = play.vip === i && play.side !== "defense";
        return (
          <div
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            className={cx(s.player, on && s.playerOn)}
            onPointerEnter={() => onHover(i)}
            onPointerLeave={() => onHover(undefined)}
          >
            <button type="button" className={s.playerMain} onClick={() => onSelect(i)} aria-pressed={on}>
              <span className={cx(s.slotNum, isVip && s.slotVip)}>{i}</span>
              <span className={s.playerText}>
                <span className={s.playerTop}>
                  <span className={s.playerLabel}>{p?.label ?? a.pos}</span>
                  <span className={s.playerPos}>{positionName(a.pos)}</span>
                  <span className={s.playerXY}>
                    {fmtYd(p?.at.x ?? a.x)}, {fmtYd(p?.at.y ?? a.y)}
                  </span>
                  <span className={s.playerStance}>{stanceLabel(a.stance)}</span>
                </span>
                <span className={s.playerBottom}>
                  <span className={s.assign} title={slot?.assignment ?? slot?.authored}>
                    {name}
                  </span>
                  {slot?.routeType && <span className={s.routeType}>{routeTypeLabel(slot.routeType)}</span>}
                </span>
              </span>
              <span className={s.playerFlags}>
                {slot?.mechanics && (
                  <span className={s.lock} title="Handoff / fake / option mechanics: paired with the ballcarrier, locked in the designer">
                    <Icon name="lock" size={13} />
                  </span>
                )}
                {slot?.changed && (
                  <Tag tone="custom" size="sm">
                    Changed
                  </Tag>
                )}
                {isVip && (
                  <Tag tone="run" size="sm" title="Primary receiver (red route)">
                    Primary
                  </Tag>
                )}
              </span>
            </button>
            <button type="button" className={s.expand} onClick={() => onToggle(i)} aria-expanded={open} title={open ? "Hide steps" : "Show steps"}>
              <Icon name={open ? "chevronUp" : "chevronDown"} size={15} />
            </button>
            {open && slot && <StepsView steps={slot.steps} />}
          </div>
        );
      })}
    </div>
  );
}


function StepsView({ steps }: { steps: ResolvedPlay["slots"][number]["steps"] }) {
  const real = stripNone(steps);
  return (
    <div className={s.steps}>
      <ol className={s.stepList}>
        {real.map((st, i) => (
          <li key={i}>
            <span className={s.stepIdx}>{i + 1}</span>
            <span className={s.stepType}>{st.type}</span>
            <span className={s.stepSum}>{stepSummary(st)}</span>
          </li>
        ))}
        {!real.length && <li className={s.dimText}>No steps</li>}
      </ol>
      <details className={s.raw}>
        <summary>Raw steps JSON</summary>
        <pre>{JSON.stringify(steps, null, 2)}</pre>
      </details>
    </div>
  );
}

// ───────────────────────────── reads ─────────────────────────────

export function ReadsPanel({
  play,
  art,
  selectedSlot,
  onSelect,
  onHover,
}: {
  play: ResolvedPlay;
  art: PlayArt;
  selectedSlot?: number;
  onSelect(slot: number): void;
  onHover(slot: number | undefined): void;
}) {
  const vip = art.players.find((p) => p.slot === play.vip);
  if (!play.reads.length) {
    return (
      <div className={s.stack}>
        <p className={s.dimText}>No read progression{play.side === "defense" ? " (defense)" : " — usually a run or a scripted play"}.</p>
        {play.side !== "defense" && vip && (
          <div className={s.vipLine}>
            <span className={s.vipDot} /> Primary receiver (red route): {vip.label}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className={s.stack}>
      <ol className={s.reads}>
        {play.reads.map((r, i) => {
          const p = art.players.find((x) => x.slot === r.pos);
          const isVip = r.pos === play.vip;
          const pct = Math.max(0, Math.min(1, Number(r.pct) || 0));
          const on = selectedSlot === r.pos;
          return (
            <li key={i}>
              <button
                type="button"
                className={cx(s.read, on && s.readOn, isVip && s.readVip)}
                onClick={() => onSelect(r.pos)}
                onPointerEnter={() => onHover(r.pos)}
                onPointerLeave={() => onHover(undefined)}
              >
                <span className={s.readOrder}>{i + 1}</span>
                <span className={s.readWho}>
                  <span className={s.readLabel}>{p?.label ?? `#${r.pos}`}</span>
                  <span className={s.readSlot}>slot {r.pos}</span>
                </span>
                <span className={s.readBarWrap}>
                  <span className={s.readBar} style={{ width: `${pct * 100}%` }} />
                  <span className={s.readPct}>{Math.round(pct * 100)}%</span>
                </span>
                <span className={s.readMeta}>
                  <span>{readConceptLabel(r.concept) ?? "—"}</span>
                  <span className={s.readCombo}>combo {r.combo ?? 0}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className={s.vipLine}>
        <span className={s.vipDot} /> Primary receiver (red route): {vip?.label ?? `slot ${play.vip}`}
        {play.reads.every((r) => r.pos !== play.vip) && <span className={s.dimText}> (not in the progression)</span>}
      </div>
      {play.source === "custom" && play.base && (
        <p className={s.dimText}>Custom play: reads come from the spec when it sets them, otherwise from the base play.</p>
      )}
    </div>
  );
}
