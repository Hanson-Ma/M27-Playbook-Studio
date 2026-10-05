// Left filter rail: side, formation (searchable, counts), set, play-type families + exact type, concept categories and
// read concepts, "route contains", availability, source and favorites. Counts come from searchPlays (each facet
// ignores its own filter, so a count is what clicking it would show).
import { memo, useMemo, useState, type ReactNode, type Ref } from "react";
import { categoryWithDescendants } from "../../model/conceptsDoc";
import { familyColor, familyLabel, PLAY_FAMILIES, playTypeInfo, type PlayFamily } from "../../model/playtypes";
import { ROUTE_FAMILIES, type FacetCounts, type PlayFilters, type SearchIndex, type SideFacet } from "../../model/search";
import type { ConceptsDoc } from "../../model/types";
import { Chip, Icon, SearchSelect, Segmented, TextInput, Toggle, cx, type SearchOption, type SegmentOption } from "../../ui";
import type { LibFilters } from "./libraryStore";
import s from "./FilterRail.module.css";

export interface FilterRailProps {
  index: SearchIndex;
  counts?: FacetCounts;
  filters: LibFilters;
  setFilters(partial: Partial<LibFilters>): void;
  /** Favorites / Recent tabs ignore side, formation and set. */
  personal: boolean;
  hideMinigames: boolean;
  concepts: ConceptsDoc | null;
  ref?: Ref<HTMLDivElement>;
}

const SIDE_OPTIONS: SegmentOption<SideFacet>[] = [
  { value: "offense", label: "Offense" },
  { value: "defense", label: "Defense" },
  { value: "special", label: "Special" },
];

const OFFENSE_FAMILIES: PlayFamily[] = ["pass", "run", "pa", "screen", "rpo", "option", "special"];
const DEFENSE_FAMILIES: PlayFamily[] = ["defense", "special", "other"];
const SPECIAL_FAMILIES: PlayFamily[] = ["special", "pass", "run", "defense", "other"];

const fmt = (n: number | undefined) => (n ?? 0).toLocaleString("en-US");

function Section({ title, children, aside, dim }: { title: ReactNode; children: ReactNode; aside?: ReactNode; dim?: boolean }) {
  return (
    <section className={cx(s.section, dim && s.dim)}>
      <header className={s.sectionHead}>
        <h3 className={s.sectionTitle}>{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

interface RadioRow<T extends string> {
  value: T;
  label: string;
  count?: number;
  title?: string;
  color?: string;
}

function RadioList<T extends string>({ rows, value, onChange, label }: { rows: RadioRow<T>[]; value: T; onChange(v: T): void; label: string }) {
  return (
    <div className={s.radios} role="radiogroup" aria-label={label}>
      {rows.map((r) => {
        const on = r.value === value;
        return (
          <button key={r.value} type="button" role="radio" aria-checked={on} title={r.title} className={cx(s.item, on && s.itemOn)} onClick={() => onChange(r.value)}>
            <span className={s.itemName}>
              <span className={cx(s.radio, on && s.radioOn)} style={r.color ? { borderColor: r.color } : undefined} />
              {r.label}
            </span>
            {r.count !== undefined && <span className={s.itemCount}>{fmt(r.count)}</span>}
          </button>
        );
      })}
    </div>
  );
}

function ClearLink({ onClick }: { onClick(): void }) {
  return (
    <button type="button" className={s.clear} onClick={onClick}>
      Clear
    </button>
  );
}

export const FilterRail = memo(function FilterRail({ index, counts, filters, setFilters, personal, hideMinigames, concepts, ref }: FilterRailProps) {
  const side = filters.side;
  const [formationQuery, setFormationQuery] = useState("");
  const [allConcepts, setAllConcepts] = useState(false);

  const formations = useMemo(() => {
    const list = [...index.formations.values()].filter((f) => f.side === side && !(hideMinigames && f.minigame));
    // Same-named formations (a minigame "Shotgun") get their folder as a hint.
    const dup = new Map<string, number>();
    for (const f of list) dup.set(f.name.toLowerCase(), (dup.get(f.name.toLowerCase()) ?? 0) + 1);
    return list
      .map((f) => ({ ...f, hint: (dup.get(f.name.toLowerCase()) ?? 0) > 1 || f.minigame ? f.folder : undefined }))
      .sort((a, b) => a.name.localeCompare(b.name) || Number(a.minigame) - Number(b.minigame));
  }, [index, side, hideMinigames]);

  const shownFormations = useMemo(() => {
    const q = formationQuery.trim().toLowerCase();
    return q ? formations.filter((f) => `${f.name} ${f.folder}`.toLowerCase().includes(q)) : formations;
  }, [formations, formationQuery]);

  const formation = filters.formation ? index.formations.get(filters.formation) : undefined;
  const families = personal ? PLAY_FAMILIES : side === "offense" ? OFFENSE_FAMILIES : side === "defense" ? DEFENSE_FAMILIES : SPECIAL_FAMILIES;
  const famSet = new Set(filters.families ?? []);

  const typeOptions = useMemo<SearchOption[]>(() => {
    const sides: SideFacet[] = personal ? ["offense", "defense", "special"] : [side];
    const types = new Set<string>();
    for (const sd of sides) for (const t of index.playTypes.get(sd) ?? []) types.add(t);
    return [...types]
      .map((t) => {
        const info = playTypeInfo(t);
        // The menu renders in a portal (no .caps wrapper reaches it): play types are uppercased here, display only.
        return { value: t, label: info.long.toUpperCase(), hint: `${info.label} · ${fmt(counts?.playType.get(t))}`, group: info.label };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [index, side, personal, counts]);

  const toggleIn = <T,>(list: T[] | undefined, v: T): T[] => {
    const cur = list ?? [];
    return cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
  };

  // Concept categories: roots first with their children indented (one level is plenty for chips).
  const categories = useMemo(() => {
    const cats = concepts?.categories ?? [];
    const out: { id: string; name: string; color: string; depth: number }[] = [];
    const visit = (parent: string | undefined, depth: number) => {
      for (const c of cats) if ((c.parent ?? undefined) === parent && !out.some((o) => o.id === c.id)) {
        out.push({ id: c.id, name: c.name, color: c.color, depth });
        if (depth < 6) visit(c.id, depth + 1);
      }
    };
    visit(undefined, 0);
    for (const c of cats) if (!out.some((o) => o.id === c.id)) out.push({ id: c.id, name: c.name, color: c.color, depth: 0 });
    return out;
  }, [concepts]);
  const catActive = new Set(filters.categories ?? []);

  const readConcepts = useMemo(() => {
    const list = index.readConcepts.filter((c) => (counts?.readConcepts.get(c) ?? 0) > 0 || filters.readConcepts?.includes(c));
    return list;
  }, [index, counts, filters.readConcepts]);
  const shownConcepts = allConcepts ? readConcepts : readConcepts.slice(0, 14);

  const availOptions: RadioRow<NonNullable<PlayFilters["availability"]>>[] = [
    { value: "all", label: "All", count: counts?.availability.all },
    { value: "global", label: "Works Without Mod", count: counts?.availability.global, title: "Global plays: usable in a custom playbook without the mod" },
    { value: "needsMod", label: "Needs Mod", count: counts?.availability.needsMod, title: "Not global: the export pulls them into pbstudio.fbmod", color: "var(--amber)" },
  ];
  const sourceOptions: RadioRow<NonNullable<PlayFilters["source"]>>[] = [
    { value: "all", label: "All", count: counts?.source.all },
    { value: "library", label: "Stock", count: counts?.source.library },
    { value: "custom", label: "Custom", count: counts?.source.custom, title: "Plays from playbooks/plays/*.json" },
  ];

  return (
    <div
      ref={ref}
      className={s.rail}
      aria-label="Filters"
      onMouseDown={(e) => {
        // Mouse clicks shouldn't park keyboard focus on a rail button (Enter / arrows keep driving the grid).
        const t = e.target as HTMLElement;
        if (t.closest("button") && !t.closest("input")) e.preventDefault();
      }}
    >
      <Section title="Side" dim={personal}>
        <Segmented
          options={SIDE_OPTIONS.map((o) => ({ ...o, title: `${fmt(counts?.side.get(o.value))} plays` }))}
          value={side}
          onChange={(v) => setFilters({ side: v, formation: undefined, set: undefined, families: undefined, playType: undefined })}
          size="sm"
          block
          aria-label="Side"
        />
        {personal && <p className={s.note}>Favorites and Recent span every side, formation and set.</p>}
      </Section>

      <Section
        title="Formation"
        dim={personal}
        aside={filters.formation ? <ClearLink onClick={() => setFilters({ formation: undefined, set: undefined })} /> : <span className={s.count}>{formations.length}</span>}
      >
        <TextInput
          value={formationQuery}
          onChange={setFormationQuery}
          placeholder="Find formation"
          icon="search"
          size="sm"
          clearable
          aria-label="Find formation"
        />
        <div className={s.list} role="listbox" aria-label="Formations">
          {shownFormations.map((f) => {
            const n = counts?.formation.get(f.asset) ?? 0;
            const on = filters.formation === f.asset;
            return (
              <button
                key={f.asset}
                type="button"
                role="option"
                aria-selected={on}
                className={cx(s.item, on && s.itemOn, !n && !on && s.itemEmpty)}
                onClick={() => setFilters({ formation: on ? undefined : f.asset, set: undefined })}
                title={f.asset}
              >
                <span className={cx(s.itemName, "caps")}>
                  {f.name}
                  {f.hint && <span className={s.itemHint}>{f.hint}</span>}
                </span>
                <span className={s.itemCount}>{fmt(n)}</span>
              </button>
            );
          })}
          {!shownFormations.length && <div className={s.none}>No formation matches</div>}
        </div>
      </Section>

      {formation && (
        <Section title={<>Set · <span className="caps">{formation.name}</span></>} dim={personal} aside={filters.set ? <ClearLink onClick={() => setFilters({ set: undefined })} /> : <span className={s.count}>{formation.sets.length}</span>}>
          <div className={cx(s.list, s.listTall)} role="listbox" aria-label="Sets">
            {formation.sets.map((st) => {
              const n = counts?.set.get(st.asset) ?? 0;
              const on = filters.set === st.asset;
              return (
                <button
                  key={st.asset}
                  type="button"
                  role="option"
                  aria-selected={on}
                  className={cx(s.item, on && s.itemOn, !n && !on && s.itemEmpty)}
                  onClick={() => setFilters({ set: on ? undefined : st.asset })}
                  title={st.asset}
                >
                  <span className={cx(s.itemName, "caps")}>{st.name}</span>
                  <span className={s.itemCount}>{fmt(n)}</span>
                </button>
              );
            })}
          </div>
        </Section>
      )}

      <Section title="Play Type" aside={filters.families?.length || filters.playType ? <ClearLink onClick={() => setFilters({ families: undefined, playType: undefined })} /> : undefined}>
        <div className={s.chips}>
          {families.map((f) => {
            const n = counts?.family.get(f) ?? 0;
            const on = famSet.has(f);
            if (!n && !on) return null;
            return (
              <Chip key={f} caps active={on} color={familyColor(f)} count={n} onClick={() => setFilters({ families: toggleIn(filters.families, f), playType: undefined })}>
                {familyLabel(f)}
              </Chip>
            );
          })}
        </div>
        <SearchSelect
          value={filters.playType}
          onChange={(v) => setFilters({ playType: v || undefined })}
          options={typeOptions}
          placeholder="Exact play type…"
          searchPlaceholder="Search play types"
          size="sm"
          width="100%"
          aria-label="Exact play type"
        />
      </Section>

      <Section title="Concept" aside={filters.categories?.length || filters.readConcepts?.length ? <ClearLink onClick={() => setFilters({ categories: undefined, readConcepts: undefined })} /> : undefined}>
        {categories.length > 0 && (
          <>
            <div className={s.subhead}>Your Categories</div>
            <div className={s.chips}>
              {categories.map((c) => {
                const on = catActive.has(c.id);
                return (
                  <Chip
                    key={c.id}
                    active={on}
                    color={c.color}
                    count={counts?.categories.get(c.id) ?? 0}
                    className={c.depth ? s.childChip : undefined}
                    title={concepts ? `${[...categoryWithDescendants(concepts, c.id)].length - 1} subcategories` : undefined}
                    onClick={() => setFilters({ categories: toggleIn(filters.categories, c.id) })}
                  >
                    {c.name}
                  </Chip>
                );
              })}
            </div>
          </>
        )}
        <div className={s.subhead}>Read Concepts</div>
        <div className={s.chips}>
          {shownConcepts.map((c) => (
            <Chip
              key={c}
              active={filters.readConcepts?.includes(c)}
              count={counts?.readConcepts.get(c) ?? 0}
              onClick={() => setFilters({ readConcepts: toggleIn(filters.readConcepts, c) })}
            >
              {c}
            </Chip>
          ))}
          {!readConcepts.length && <span className={s.none}>No read concepts in these plays</span>}
          {readConcepts.length > 14 && (
            <button type="button" className={s.more} onClick={() => setAllConcepts(!allConcepts)}>
              {allConcepts ? "Fewer" : `+${readConcepts.length - 14} More`}
            </button>
          )}
        </div>
      </Section>

      {(side !== "defense" || personal) && (
        <Section title="Route Contains" aside={filters.routes?.length ? <ClearLink onClick={() => setFilters({ routes: undefined })} /> : undefined}>
          <div className={s.chips}>
            {ROUTE_FAMILIES.map((r) => {
              const n = counts?.routes.get(r) ?? 0;
              const on = !!filters.routes?.includes(r);
              if (!n && !on) return null;
              return (
                <Chip key={r} active={on} count={n} icon={on ? "check" : undefined} onClick={() => setFilters({ routes: toggleIn(filters.routes, r) })}>
                  {r}
                </Chip>
              );
            })}
          </div>
          {(filters.routes?.length ?? 0) > 1 && <p className={s.note}>Plays must contain every selected route.</p>}
        </Section>
      )}

      <Section title="Availability">
        <RadioList rows={availOptions} value={filters.availability ?? "all"} onChange={(v) => setFilters({ availability: v === "all" ? undefined : v })} label="Availability" />
      </Section>

      <Section title="Source">
        <RadioList rows={sourceOptions} value={filters.source ?? "all"} onChange={(v) => setFilters({ source: v === "all" ? undefined : v })} label="Source" />
      </Section>

      <Section title="Favorites">
        <Toggle checked={!!filters.favoritesOnly} onChange={(v) => setFilters({ favoritesOnly: v || undefined })} label={`Favorites Only · ${fmt(counts?.favorites)}`} size="sm" />
      </Section>

      <p className={s.footnote}>
        <Icon name="info" size={13} /> {hideMinigames ? "Minigame and drill formations are hidden (Settings › Editor)." : "Minigame and drill formations are shown."}
      </p>
    </div>
  );
});
