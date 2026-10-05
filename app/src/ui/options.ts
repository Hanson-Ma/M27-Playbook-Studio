// Option normalization + search for SearchSelect (pure, tested). Enum lists reach 100+ values and assignment
// lists ~5,000, so haystacks are built once per options array.

export interface SearchOption {
  value: string;
  /** Display text (default: value). */
  label?: string;
  /** Dim text on the right (e.g. a route type or file). */
  hint?: string;
  /** Category shown dimmed when there's no hint; also searchable. */
  group?: string;
  /** Extra search terms. */
  keywords?: string;
  disabled?: boolean;
  /** Chrome, not a Madden name: keeps its case in a `caps` SearchSelect (e.g. "New Formation…"). */
  chrome?: boolean;
}

export type OptionInput = string | SearchOption;

export function normalizeOptions(opts: readonly OptionInput[]): SearchOption[] {
  return opts.map((o) => (typeof o === "string" ? { value: o } : o));
}

export const optionLabel = (o: SearchOption): string => o.label ?? o.value;

const hayCache = new WeakMap<readonly SearchOption[], string[]>();

function haystacks(opts: readonly SearchOption[]): string[] {
  let h = hayCache.get(opts);
  if (!h) {
    h = opts.map((o) => {
      const label = optionLabel(o);
      // Spaced variants let "curl" find "ReceiverCutAngle_Curl" and "trips wk" find "Y_Trips_Wk".
      const spaced = `${label} ${o.value}`.replace(/[_/]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
      return `${label} ${o.value} ${spaced} ${o.hint ?? ""} ${o.group ?? ""} ${o.keywords ?? ""}`.toLowerCase();
    });
    hayCache.set(opts, h);
  }
  return h;
}

/** Every whitespace-separated term must appear; label-prefix matches first, then word-prefix, then the rest. */
export function filterOptions(opts: readonly SearchOption[], query: string): SearchOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return opts as SearchOption[];
  const terms = q.split(/\s+/);
  const hay = haystacks(opts);
  const wordStart = new RegExp(`(^|[\\s_/])${escapeRe(terms[0])}`);
  const ranked: { o: SearchOption; rank: number; i: number }[] = [];
  for (let i = 0; i < opts.length; i++) {
    const h = hay[i];
    if (!terms.every((t) => h.includes(t))) continue;
    const label = optionLabel(opts[i]).toLowerCase();
    const rank = label === q ? 0 : label.startsWith(q) ? 1 : wordStart.test(h) ? 2 : 3;
    ranked.push({ o: opts[i], rank, i });
  }
  ranked.sort((a, b) => a.rank - b.rank || a.i - b.i);
  return ranked.map((r) => r.o);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
