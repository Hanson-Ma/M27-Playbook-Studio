// Step helpers: guards, mechanics detection, summaries.
import type { RunRouteStep, Step } from "./types";

export const LEG_TYPES = ["RunRoute", "MoveDirection", "ReceiveHandoff", "RecievePitch"] as const;

/** Handoff/fake/option/pitch steps that must stay paired between QB and ballcarrier (FORMATS.md §3). */
export const MECHANICS_TYPES = [
  "CannedHandoff",
  "HandOffTurn",
  "HandOffGive",
  "HandoffFake",
  "OptionHandoff",
  "PitchBall",
  "OptionRun",
  "OptionFollow",
  "RecievePitch",
  "RecUserHandoff",
] as const;

export function isLeg(step: Step): step is RunRouteStep {
  return (LEG_TYPES as readonly string[]).includes(step.type);
}

export function isMechanics(step: Step): boolean {
  return (MECHANICS_TYPES as readonly string[]).includes(step.type);
}

export function hasMechanics(steps: Step[]): boolean {
  return steps.some(isMechanics);
}

/** Steps without the trailing None terminator(s). */
export function stripNone(steps: Step[]): Step[] {
  let end = steps.length;
  while (end > 0 && steps[end - 1].type === "None") end--;
  return steps.slice(0, end);
}

/** Steps with exactly one trailing None. */
export function withNone(steps: Step[]): Step[] {
  return [...stripNone(steps), { type: "None" }];
}

export function cloneSteps(steps: Step[]): Step[] {
  return structuredClone(steps);
}

function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, canon(o[k])]));
  }
  return v;
}

/** Deep equality ignoring key order and trailing None steps. */
export function stepsEqual(a: Step[], b: Step[]): boolean {
  return JSON.stringify(canon(stripNone(a))) === JSON.stringify(canon(stripNone(b)));
}

const n = (v: unknown, d = 1) => (typeof v === "number" ? +v.toFixed(d) : v);
const short = (v: unknown, prefix: RegExp) => String(v ?? "").replace(prefix, "");

/** One-line human summary of a step: "Run 7 yd @ 90° · 100%", "Cut R 45°", "Get open". */
export function stepSummary(step: Step): string {
  const s = step as Record<string, unknown>;
  switch (step.type) {
    case "RunRoute":
      return `Run ${n(s.distance)} yd @ ${n(s.direction, 0)}° · ${n(s.speed, 0)}%`;
    case "MoveDirection":
      return `Move ${n(s.distance)} yd @ ${n(s.direction, 0)}° · ${n(s.speed, 0)}%`;
    case "ReceiveHandoff":
      return `Take handoff ${n(s.distance)} yd @ ${n(s.direction, 0)}°`;
    case "RecievePitch":
      return `Take pitch ${n(s.distance)} yd @ ${n(s.direction, 0)}°`;
    case "ReceiverCut": {
      const dir = String(s.direction).includes("LEFT") ? "L" : String(s.direction).includes("RIGHT") ? "R" : "";
      return `Cut ${dir} ${short(s.cutType, /^RECEIVER_CUT_ANGLE_/).replace(/_/g, " ").toLowerCase()}`.replace(/\s+/g, " ");
    }
    case "GetOpen":
      return "Get open";
    case "Delay":
      return `Delay ${n(s.time, 2)} s`;
    case "PassBlock":
      return `Pass block${s.flags && s.flags !== "PassBlockFlags_None" ? " · " + short(s.flags, /^PassBlockFlags_/) : ""}${
        typeof s.time === "number" && s.time > 0 ? ` · release ${n(s.time, 2)} s` : ""
      }`;
    case "RunBlock":
      return "Run block";
    case "LeadBlock":
      return `Lead block · ${short(s.blockingTechnique, /^BLOCKINGTECHNIQUE_/).toLowerCase().replace(/_/g, " ")} → ${String(
        s.blockingGap ?? "",
      ).replace(/_/g, " ")}`;
    case "InitialAnim":
      return `Start: ${short(s.anim, /^MOVETYPE_/).toLowerCase().replace(/_/g, " ")}${
        typeof s.direction === "number" ? ` @ ${n(s.direction, 0)}°` : ""
      }`;
    case "QBScramble":
      return `QB drop · ${short(s.dropBackType, /^DROP_TYPEENUM_(QBDROP_)?/).toLowerCase().replace(/_/g, " ")}${
        typeof s.distance === "number" && s.distance > 0 ? ` · ${n(s.distance)} yd @ ${n(s.direction, 0)}°` : ""
      }`;
    case "AutoMotion": {
      const w = Array.isArray(s.waypoints) ? s.waypoints.length : 0;
      return `Motion · ${w} waypoint${w === 1 ? "" : "s"} · ${short(s.startEvent, /^AUTOMOTIONSTARTEVENT_/).toLowerCase()}`;
    }
    case "OverrideFormPos":
      return `Align at (${n(s.offsetX)}, ${n(s.offsetY)})`;
    case "RunRouteFakeOut":
      return `Fake: ${String(s.fakeout ?? "")}`;
    case "RunEndZone":
      return "Run to end zone";
    case "CannedHandoff":
      return "Handoff precan";
    case "HandOffTurn":
      return `Handoff turn @ ${n(s.direction, 0)}°`;
    case "HandOffGive":
      return "Hand off";
    case "HandoffFake":
      return "Fake handoff";
    case "None":
      return "End";
    default:
      return step.type.replace(/([a-z])([A-Z])/g, "$1 $2");
  }
}

/**
 * What a `new` assignment spec keeps of its template (tools/PlayDump/PlayBuilder.cs BuildAssignment): `drop` removes
 * those step types first, then `keep` (N ≥ 0 = the first N, −1 = every step before the terminating None) leaves the
 * leading steps; `prepend` steps go in front of everything. Result = [...prepend, ...kept, ...authored, None].
 */
export function templateKept(
  source: Step[] | undefined,
  spec: { keep?: unknown; drop?: unknown },
): { kept: Step[]; real: number; keep: number } {
  const drop = new Set(Array.isArray(spec.drop) ? spec.drop.filter((d): d is string => typeof d === "string") : []);
  const chain = (source ?? []).filter((s) => !drop.has(s.type));
  const real = chain.length - (chain.length && chain[chain.length - 1].type === "None" ? 1 : 0);
  const asked = typeof spec.keep === "number" ? Math.floor(spec.keep) : 0;
  const keep = asked < 0 ? real : Math.max(0, asked);
  return { kept: chain.slice(0, keep).filter((s) => s.type !== "None"), real, keep };
}
