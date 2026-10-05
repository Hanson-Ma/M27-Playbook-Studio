// Gameplan views over one playbook: concepts-by-formation matrices (RUN / PASS columns, holes highlighted),
// "what do I have for…" by CPU situation (template sections included, read from the template save), and a coverage
// summary per category.
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AudibleGlyph } from "../../input/glyphs";
import type { Catalog } from "../../model/catalog";
import {
  CATEGORY_GROUPS,
  GROUP_LABEL,
  bookPlayRefs,
  categoryCoverage,
  conceptIndex,
  conceptMatrix,
  groupOf,
  playCategories,
  situationCounts,
  situationPlays,
  type BookPlayRef,
  type CoverageRow,
  type MatrixRow,
} from "../../model/concepts";
import { formationShort } from "../../model/names";
import type { ResolvedBook } from "../../model/resolveBook";
import { SITUATION_GROUPS, SITUATION_LABELS, type SituationKey } from "../../model/situations";
import type { AudibleSlot, CategoryGroup, ConceptCategory, ConceptsDoc, ResolvedPlay } from "../../model/types";
import { href, navigate } from "../../state/router";
import { useTemplate, type TemplateState } from "../../state/template";
import { Button, EmptyState, Floating, Icon, PlayTypeTag, Segmented, Tag, Toggle, cx } from "../../ui";
import { BookPicker, CategoryChip, CategoryFilter, ColorDot } from "./parts";
import { resolvedBook, sectionHash, uiSet, useBookOptions, useConceptsUi, useGameplanBook, type BookOption } from "./store";
import { isTemplateRef, templateSectionsBook } from "./templateBook";
import s from "./GameplanSections.module.css";

// ───────────────────────────── shared ─────────────────────────────

function useBook(catalog: Catalog): { books: BookOption[]; book?: BookOption; rb?: ResolvedBook } {
  const books = useBookOptions();
  const book = useGameplanBook();
  const rb = useMemo(() => (book?.spec ? resolvedBook(book.spec, catalog) : undefined), [book?.spec, catalog]);
  return { books, book, rb };
}

function GameplanBar({ doc, books, book, rb, children }: { doc: ConceptsDoc; books: BookOption[]; book?: BookOption; rb?: ResolvedBook; children?: ReactNode }) {
  return (
    <div className={s.bar}>
      <div className={s.barBook}>
        <span className={s.kicker}>Playbook</span>
        <BookPicker books={books} value={book?.path} onChange={(p) => uiSet({ book: p })} />
        {rb && (
          <span className={s.bookMeta}>
            {rb.counts.plays} plays · {rb.counts.sets} sets
            {rb.counts.templateFormations > 0 && ` · ${rb.counts.templateFormations} template`}
            {rb.counts.unresolved > 0 && <em> · {rb.counts.unresolved} unresolved</em>}
          </span>
        )}
      </div>
      <div className={s.barRight}>
        {children}
        <CategoryFilter doc={doc} />
      </div>
    </div>
  );
}

function NoBook({ books }: { books: BookOption[] }) {
  return (
    <EmptyState
      icon="playcall"
      title={books.length ? "Pick a playbook" : "No playbooks yet"}
      body={books.length ? "Gameplan views read one playbook from playbooks/." : "Create one in the Playbook tab; gameplan views summarize its plays by concept."}
      action={!books.length ? <Button onClick={() => navigate("#/playbook")}>Open Playbook</Button> : undefined}
    />
  );
}

/** Open the tagging workspace on this book, optionally filtered / focused. */
function showInTagging(bookPath: string | undefined, opts: { filter?: string[]; focus?: string; untagged?: boolean } = {}) {
  uiSet({ scope: "book", scopeBook: bookPath, filter: opts.filter ?? [], untagged: !!opts.untagged, suggested: false, checked: [], ...(opts.focus ? { focus: opts.focus } : {}) });
  navigate(sectionHash("tag"), { replace: true });
}


/** Template plays aren't in the playbook file: tag them from their library set instead. */
function showSetInTagging(play: ResolvedPlay) {
  uiSet({ scope: "set", formation: play.formation, setAsset: play.set, filter: [], untagged: false, suggested: false, checked: [], focus: play.key });
  navigate(sectionHash("tag"), { replace: true });
}

const sections = (n: number) => `${n} template section${n === 1 ? "" : "s"}`;

/** Why a book's template sections aren't (yet) part of a gameplan view, or undefined when nothing's missing. */
function templateGap(rb: ResolvedBook, template: TemplateState, counted: boolean): string | undefined {
  const n = rb.counts.templateFormations;
  if (!n) return undefined;
  if (!counted) return `${sections(n)} not counted — their plays come from the template save.`;
  if (template.status === "error") return `Couldn't read the template save (${template.error ?? "unknown error"}), so ${sections(n)} aren't counted.`;
  if (template.status !== "ready") return `Reading the template save for ${sections(n)}…`;
  return undefined;
}

const isSlot = (a: unknown): a is AudibleSlot => a === 1 || a === 2 || a === 3 || a === 4;

function PlayLine({ r, doc, right, template }: { r: BookPlayRef; doc: ConceptsDoc; right?: ReactNode; template?: boolean }) {
  const cats = playCategories(doc, r.play.key);
  return (
    <div className={s.playLine}>
      <div className={s.playText}>
        <div className={s.playName}>{r.play.name}</div>
        <div className={s.playSub}>
          {formationShort(r.formation)} {r.set.toUpperCase()}
        </div>
      </div>
      {template && (
        <Tag tone="neutral" size="sm" icon="lock" title="From a template section: copied from the template save by the game-side builder">
          From Template
        </Tag>
      )}
      <div className={s.playChips}>
        {cats.map((c) => (
          <CategoryChip key={c.id} category={c} size="sm" />
        ))}
      </div>
      {isSlot(r.entry.audible) && (
        <span className={s.aud} title={`Audible ${r.entry.audible}`}>
          <AudibleGlyph slot={r.entry.audible} size="sm" />
        </span>
      )}
      {right}
    </div>
  );
}

// ───────────────────────────── matrix ─────────────────────────────

export function MatrixSection({ group, doc, catalog }: { group: Extract<CategoryGroup, "run" | "pass">; doc: ConceptsDoc; catalog: Catalog }) {
  const { books, book, rb } = useBook(catalog);
  const filter = useConceptsUi((st) => st.filter);
  const topLevelOnly = useConceptsUi((st) => st.topLevelOnly);
  const ix = conceptIndex(doc);
  const nested = ix.byGroup[group].some((n) => n.depth > 0);

  const m = useMemo(() => {
    if (!rb) return undefined;
    const inGroup = filter.filter((id) => ix.byId.has(id) && groupOf(ix.byId.get(id)!) === group);
    const others = filter.filter((id) => ix.byId.has(id) && groupOf(ix.byId.get(id)!) !== group);
    return conceptMatrix(rb, doc, group, { topLevelOnly, only: inGroup, requireAny: others });
  }, [rb, doc, group, topLevelOnly, filter, ix]);

  const [cur, setCur] = useState({ r: 1, c: 0 });
  const [hover, setHover] = useState<{ el: HTMLElement; r: number; c: number } | null>(null);
  const rowCount = m?.rows.length ?? 0;
  const colCount = m?.columns.length ?? 0;
  const r = Math.min(cur.r, rowCount - 1);
  const c = Math.min(cur.c, colCount - 1);
  const tableRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tableRef.current?.querySelector("[data-cursor]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [r, c]);

  const sel = m && r >= 0 && c >= 0 ? { row: m.rows[r], col: m.columns[c], plays: m.rows[r].cells[c] } : undefined;
  // A filled cell opens those plays; a hole opens the library set (or the book's untagged plays) to find one.
  const openCell = (row: MatrixRow, ci: number, plays: BookPlayRef[]) => {
    if (!m) return;
    if (plays.length) return showInTagging(book?.path, { filter: [m.columns[ci].category.id] });
    const set = row.s !== undefined ? rb?.formations[row.f]?.sets[row.s]?.set : undefined;
    if (set) {
      uiSet({ scope: "set", formation: set.formation, setAsset: set.asset, filter: [], untagged: false, suggested: false, checked: [] });
      navigate(sectionHash("tag"), { replace: true });
    } else showInTagging(book?.path, { untagged: true });
  };
  const others = filter.filter((id) => ix.byId.has(id) && groupOf(ix.byId.get(id)!) !== group);


  const label = GROUP_LABEL[group];
  return (
    <div className={s.page}>
      <GameplanBar doc={doc} books={books} book={book} rb={rb}>
        {nested && <Toggle size="sm" checked={topLevelOnly} onChange={(v) => uiSet({ topLevelOnly: v })} label="Top Level Only" />}
      </GameplanBar>
      {!rb || !m ? (
        <NoBook books={books} />
      ) : !m.columns.length ? (
        <EmptyState icon="grid" title={`No ${label} categories`} body={`Add ${GROUP_LABEL[group]} categories in Categories (or clear the filter).`} action={<Button onClick={() => navigate(sectionHash("categories"), { replace: true })}>Categories</Button>} />
      ) : !m.rows.length ? (
        <EmptyState
          icon="grid"
          title="No sets in this playbook"
          body={m.templateSections ? `Only ${sections(m.templateSections)}: their plays come from the template save and aren't in this matrix (see Situations).` : undefined}
        />
      ) : (
        <div className={s.split}>
          <div className={s.tableWrap} ref={tableRef}>
            <table className={s.matrix} style={{ "--cols": m.columns.length } as CSSProperties}>
              <thead>
                <tr>
                  <th className={s.corner}>
                    <div className={s.cornerTitle}>{label} Concepts by Formation</div>
                    <div className={s.cornerHint}>
                      {m.plays} plays
                      {others.length > 0 && ` tagged ${others.map((id) => ix.byId.get(id)?.name).join(" / ")}`}
                      {m.templateSections > 0 && ` · ${m.templateSections} template sections not counted`}
                    </div>
                  </th>
                  <th className={s.numHead}>Plays</th>
                  {m.columns.map((col, ci) => (
                    <th key={col.category.id} className={cx(s.colHead, ci === c && s.colHeadCur)} style={{ "--c": col.category.color } as CSSProperties} title={col.category.name}>
                      <span className={s.colBar} />
                      <span className={s.colName}>
                        {col.depth > 0 && <span className={s.colDepth}>{"›".repeat(col.depth)}</span>}
                        {col.category.name}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {m.rows.map((row, ri) => (
                  <tr key={row.key} className={cx(row.kind === "formation" ? s.fRow : s.sRow, ri === r && s.rowCur)}>
                    <th className={s.rowHead} scope="row">
                      {row.kind === "formation" ? row.label : <span className={s.setName}>{row.label}</span>}
                    </th>
                    <td className={s.num}>
                      {row.total}
                      <span className={s.tagged}>{row.total ? `${row.tagged} tagged` : ""}</span>
                    </td>
                    {row.cells.map((cell, ci) => (
                      <td
                        key={ci}
                        className={cx(s.cell, !cell.length && s.hole, ri === r && ci === c && s.cellCur)}
                        style={{ "--c": m.columns[ci].category.color } as CSSProperties}
                        data-cursor={(ri === r && ci === c) || undefined}
                        onClick={() => setCur({ r: ri, c: ci })}
                        onDoubleClick={() => openCell(row, ci, cell)}
                        onMouseEnter={(e) => setHover({ el: e.currentTarget, r: ri, c: ci })}
                        onMouseLeave={() => setHover(null)}
                      >
                        {cell.length ? <span className={s.cellNum}>{cell.length}</span> : <span className={s.holeMark}>·</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={s.totals}>
                  <th className={s.rowHead} scope="row">
                    Whole Book
                  </th>
                  <td className={s.num}>{m.plays}</td>
                  {m.totals.map((t, ci) => (
                    <td key={ci} className={cx(s.cell, !t.length && s.hole, !t.length && s.holeBook)} style={{ "--c": m.columns[ci].category.color } as CSSProperties} title={t.length ? undefined : `No ${m.columns[ci].category.name} plays in this book`}>
                      {t.length ? <span className={s.cellNum}>{t.length}</span> : <span className={s.holeMark}>0</span>}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
          <aside className={s.detail}>
            {sel ? (
              <CellDetail row={sel.row} category={sel.col.category} plays={sel.plays} doc={doc} onShow={() => openCell(sel.row, c, sel.plays)} />
            ) : (
              <EmptyState compact icon="grid" title="Pick a Cell" />
            )}
          </aside>
          {hover && m.rows[hover.r] && m.columns[hover.c] && (
            <Floating anchor={hover.el} placement="right-start" zIndex={900} className={s.hoverCard}>
              <HoverList row={m.rows[hover.r]} category={m.columns[hover.c].category} plays={m.rows[hover.r].cells[hover.c]} />
            </Floating>
          )}
        </div>
      )}
    </div>
  );
}

function HoverList({ row, category, plays }: { row: MatrixRow; category: ConceptCategory; plays: BookPlayRef[] }) {
  return (
    <>
      <div className={s.hoverHead}>
        <ColorDot color={category.color} /> {category.name} · <span className="caps">{row.label}</span>
      </div>
      {plays.length ? (
        <ul className={s.hoverList}>
          {plays.slice(0, 12).map((p) => (
            <li key={`${p.f}/${p.s}/${p.p}`} className="caps">
              {p.play.name}
              {row.kind === "formation" && <span> · {p.set}</span>}
            </li>
          ))}
          {plays.length > 12 && <li className={s.more}>+{plays.length - 12} more</li>}
        </ul>
      ) : (
        <div className={s.hoverHole}>Hole — no {category.name} plays here</div>
      )}
    </>
  );
}

function CellDetail({ row, category, plays, doc, onShow }: { row: MatrixRow; category: ConceptCategory; plays: BookPlayRef[]; doc: ConceptsDoc; onShow(): void }) {
  return (
    <div className={s.detailInner}>
      <div className={s.detailEyebrow}>{row.kind === "formation" ? "Formation" : "Set"}</div>
      <div className={s.detailTitle}>{row.label}</div>
      <div className={s.detailCat}>
        <CategoryChip category={category} />
        <span className={s.detailCount}>
          {plays.length} of {row.total} play{row.total === 1 ? "" : "s"}
        </span>
      </div>
      {plays.length ? (
        <div className={s.detailList}>
          {plays.map((p) => (
            <PlayLine key={`${p.f}/${p.s}/${p.p}`} r={p} doc={doc} />
          ))}
        </div>
      ) : (
        <div className={s.holeNote}>
          <Icon name="warning" size={16} />
          <span>
            Hole: no {category.name} play in this {row.kind}.{" "}
            {row.kind === "set" ? "Browse the set's library plays to find and tag one, or add one from the Library." : "Tag the plays you already have, or add one from the Library."}
          </span>
        </div>
      )}
      <Button size="sm" variant="secondary" iconRight="chevronRight" onClick={onShow}>
        {plays.length ? "Show in Tag Plays" : row.kind === "set" ? <>Browse <span className="caps">{row.label}</span></> : "Tag Untagged Plays"}
      </Button>
    </div>
  );
}

// ───────────────────────────── situations ─────────────────────────────


export function SituationsSection({ doc, catalog }: { doc: ConceptsDoc; catalog: Catalog }) {
  const { books, book, rb } = useBook(catalog);
  const situation = useConceptsUi((st) => st.situation) as SituationKey;
  const filter = useConceptsUi((st) => st.filter);
  const [groupBy, setGroupBy] = useState<"none" | "category">("none");
  const [cur, setCur] = useState(0);
  // "sets": "template" sections carry CPU weights too (goal line, special teams): read them from the template save.
  const template = useTemplate();
  const tbook = useMemo(
    () => (rb && rb.counts.templateFormations > 0 && template.contents ? templateSectionsBook(rb, template.contents, catalog.lib) : undefined),
    [rb, template.contents, catalog],
  );
  const counts = useMemo(() => {
    const out = rb ? situationCounts(rb) : new Map<string, { plays: number; weight: number }>();
    if (tbook)
      for (const [k, v] of situationCounts(tbook)) {
        const cur = out.get(k);
        out.set(k, cur ? { plays: cur.plays + v.plays, weight: cur.weight + v.weight } : v);
      }
    return out;
  }, [rb, tbook]);
  // Heaviest first; on equal weights the file's own plays come before template plays (stable sort).
  const all = useMemo(
    () => (rb ? (tbook ? [...situationPlays(rb, doc, situation), ...situationPlays(tbook, doc, situation)].sort((a, b) => b.weight - a.weight) : situationPlays(rb, doc, situation)) : []),
    [rb, tbook, doc, situation],
  );
  const fromTemplate = useMemo(() => (rb ? all.filter((x) => isTemplateRef(rb, x.ref)).length : 0), [rb, all]);
  const gap = rb ? templateGap(rb, template, true) : undefined;
  const showRef = (ref: BookPlayRef) => (rb && isTemplateRef(rb, ref) ? showSetInTagging(ref.play) : showInTagging(book?.path, { focus: ref.play.key }));
  const ix = conceptIndex(doc);
  const list = useMemo(() => {
    if (!filter.length) return all;
    const want = new Set(filter.flatMap((id) => [...ix.descendantsOrSelf(id)]));
    return all.filter((x) => x.categories.some((c) => want.has(c.id)));
  }, [all, filter, ix]);
  const mix = useMemo(() => {
    const m = new Map<string, { cat?: ConceptCategory; n: number }>();
    for (const x of all) {
      if (!x.categories.length) m.set("", { n: (m.get("")?.n ?? 0) + 1 });
      for (const c of x.categories) m.set(c.id, { cat: c, n: (m.get(c.id)?.n ?? 0) + 1 });
    }
    return [...m.values()].sort((a, b) => (a.cat ? ix.order(a.cat.id) : 1e9) - (b.cat ? ix.order(b.cat.id) : 1e9));
  }, [all, ix]);
  const grouped = useMemo(() => {
    if (groupBy === "none") return [{ key: "all", cat: undefined as ConceptCategory | undefined, items: list }];
    const out = new Map<string, { key: string; cat?: ConceptCategory; items: typeof list }>();
    for (const x of list) {
      const cats = x.categories.length ? x.categories : [undefined];
      for (const c of cats) {
        const k = c?.id ?? "";
        const g = out.get(k) ?? { key: k || "none", cat: c, items: [] };
        g.items.push(x);
        out.set(k, g);
      }
    }
    return [...out.values()].sort((a, b) => (a.cat ? ix.order(a.cat.id) : 1e9) - (b.cat ? ix.order(b.cat.id) : 1e9));
  }, [list, groupBy, ix]);
  // Cursor walks the rows in display order (a play tagged twice shows under both categories).
  const visual = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);
  const idx = Math.min(cur, visual.length - 1);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector("[data-cursor]")?.scrollIntoView({ block: "nearest" });
  }, [idx, situation]);
  useEffect(() => setCur(0), [situation]);
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    navRef.current?.querySelector("[aria-current='true']")?.scrollIntoView({ block: "nearest" });
  }, [situation]);





  let flat = -1;
  return (
    <div className={s.page}>
      <GameplanBar doc={doc} books={books} book={book} rb={rb}>
        <Segmented<"none" | "category">
          size="sm"
          value={groupBy}
          onChange={setGroupBy}
          options={[
            { value: "none", label: "By Weight" },
            { value: "category", label: "By Category" },
          ]}
          aria-label="Group"
        />
      </GameplanBar>
      {!rb ? (
        <NoBook books={books} />
      ) : (
        <div className={s.sitSplit}>
          <nav className={s.sitNav} aria-label="Situations" ref={navRef}>
            {SITUATION_GROUPS.map((g) => (
              <div key={g.id} className={s.sitGroup}>
                <div className={s.sitGroupHead}>{g.label}</div>
                {g.keys.map((k) => {
                  const n = counts.get(k)?.plays ?? 0;
                  return (
                    <button key={k} type="button" aria-current={k === situation} className={cx(s.sitItem, k === situation && s.sitOn, !n && s.sitEmpty)} onClick={() => uiSet({ situation: k })}>
                      <span>{SITUATION_LABELS[k]}</span>
                      <span className={s.sitCount}>{n || "—"}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
          <section className={s.sitMain}>
            <header className={s.sitHead}>
              <div>
                <div className={s.detailEyebrow}>What Do I Have For</div>
                <h2 className={s.sitTitle}>{SITUATION_LABELS[situation] ?? situation}</h2>
              </div>
              <div className={s.sitStats}>
                <b>{all.length}</b> play{all.length === 1 ? "" : "s"} with a CPU weight
                {fromTemplate > 0 && ` · ${fromTemplate} from template`}
                {filter.length > 0 && ` · ${list.length} match the filter`}
              </div>
            </header>
            {mix.length > 0 && (
              <div className={s.mix}>
                {mix.map((x) =>
                  x.cat ? (
                    <CategoryChip key={x.cat.id} category={x.cat} size="sm" count={x.n} />
                  ) : (
                    <span key="none" className={s.untaggedChip}>
                      Untagged {x.n}
                    </span>
                  ),
                )}
              </div>
            )}
            {gap && all.length > 0 && <div className={s.templateNote}>{gap}</div>}
            <div className={s.sitList} ref={listRef}>
              {!all.length ? (
                <EmptyState
                  compact
                  icon={gap && template.status === "loading" ? "refresh" : "playcall"}
                  title="Nothing weighted for this situation"
                  body={
                    gap ??
                    (rb.counts.templateFormations > 0
                      ? `Neither this playbook's plays nor its ${sections(rb.counts.templateFormations)} (from the template save) carry a CPU weight for ${SITUATION_LABELS[situation] ?? situation}. Set CPU weights per play in the Playbook tab.`
                      : "Set CPU weights per play in the Playbook tab (CPU situation weights).")
                  }
                  action={book ? <Button size="sm" onClick={() => navigate(href("playbook", book.path))}>Open Playbook</Button> : undefined}
                />
              ) : !list.length ? (
                <EmptyState compact icon="filter" title="No Plays Match the Category Filter" />
              ) : (
                grouped.map((g) => (
                  <Fragment key={g.key}>
                    {groupBy === "category" && (
                      <div className={s.sitGroupRow} style={{ "--c": g.cat?.color ?? "var(--line-3)" } as CSSProperties}>
                        <span className={s.groupBar} />
                        {g.cat ? g.cat.name : "Untagged"} <span>{g.items.length}</span>
                      </div>
                    )}
                    {g.items.map((x) => {
                      flat++;
                      const on = flat === idx;
                      const my = flat;
                      return (
                        <div
                          key={`${g.key}|${x.ref.f}/${x.ref.s}/${x.ref.p}`}
                          className={cx(s.sitRow, on && s.sitRowCur)}
                          data-cursor={on || undefined}
                          onClick={() => setCur(my)}
                          onDoubleClick={() => showRef(x.ref)}
                        >
                          <div className={s.weight} style={{ "--w": `${Math.max(0, Math.min(100, x.weight))}%` } as CSSProperties}>
                            <span className={s.weightNum}>{x.weight}</span>
                            <span className={s.weightBar} />
                          </div>
                          <PlayLine
                            r={x.ref}
                            doc={doc}
                            template={isTemplateRef(rb, x.ref)}
                            right={
                              <>
                                <PlayTypeTag playType={x.ref.play.playType} size="sm" />
                                <button
                                  type="button"
                                  className={s.goBtn}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    showRef(x.ref);
                                  }}
                                  title="Show this play in Tag Plays"
                                >
                                  Tags <Icon name="chevronRight" size={13} />
                                </button>
                              </>
                            }
                          />
                        </div>
                      );
                    })}
                  </Fragment>
                ))
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── coverage ─────────────────────────────

export function CoverageSection({ doc, catalog }: { doc: ConceptsDoc; catalog: Catalog }) {
  const { books, book, rb } = useBook(catalog);
  const filter = useConceptsUi((st) => st.filter);
  const ix = conceptIndex(doc);
  const rows = useMemo(() => (rb ? categoryCoverage(rb, doc) : []), [rb, doc]);
  const shown = useMemo(() => {
    if (!filter.length) return rows;
    const want = new Set(filter.flatMap((id) => [...ix.descendantsOrSelf(id)]));
    return rows.filter((r) => want.has(r.category.id));
  }, [rows, filter, ix]);
  const refs = useMemo(() => (rb ? bookPlayRefs(rb) : []), [rb]);
  const untagged = useMemo(() => refs.filter((r) => !(doc.tags?.[r.play.key]?.length ?? 0)).length, [refs, doc.tags]);
  const max = Math.max(1, ...rows.map((r) => r.plays.length));
  const [cur, setCur] = useState(0);
  const idx = Math.min(cur, shown.length - 1);
  const tableRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tableRef.current?.querySelector("[data-cursor]")?.scrollIntoView({ block: "nearest" });
  }, [idx]);


  const tagged = refs.length - untagged;
  let i = -1;
  return (
    <div className={s.page}>
      <GameplanBar doc={doc} books={books} book={book} rb={rb} />
      {!rb ? (
        <NoBook books={books} />
      ) : (
        <div className={s.covWrap} ref={tableRef}>
          <div className={s.covSummary}>
            <Stat label="Plays" value={refs.length} />
            <Stat label="Tagged" value={tagged} sub={refs.length ? `${Math.round((tagged / refs.length) * 100)}%` : undefined} />
            <Stat label="Untagged" value={untagged} warn={untagged > 0} />
            <Stat label="Categories Used" value={rows.filter((r) => r.plays.length).length} sub={`of ${rows.length}`} />
            <Stat label="Holes" value={rows.filter((r) => !r.plays.length).length} warn={rows.some((r) => !r.plays.length)} />
            {untagged > 0 && (
              <Button variant="secondary" icon="tag" onClick={() => showInTagging(book?.path, { untagged: true })}>
                Tag the {untagged} Untagged
              </Button>
            )}
          </div>
          {rb.counts.templateFormations > 0 && <div className={s.templateNote}>{templateGap(rb, { status: "ready" }, false)}</div>}
          {!rows.length ? (
            <EmptyState icon="tag" title="No Categories" body="Add categories first." />
          ) : (
            <table className={s.cov}>
              <thead>
                <tr>
                  <th>Category</th>
                  <th className={s.covNum}>Plays</th>
                  <th>Formations</th>
                  <th className={s.covNum}>Sets</th>
                  <th>Audibles</th>
                  <th className={s.covNum}>CPU</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {CATEGORY_GROUPS.map((g) => {
                  const inGroup = shown.filter((r) => groupOf(r.category) === g);
                  if (!inGroup.length) return null;
                  return (
                    <Fragment key={g}>
                      <tr className={s.covGroup}>
                        <th colSpan={7}>{GROUP_LABEL[g]}</th>
                      </tr>
                      {inGroup.map((r) => {
                        i++;
                        const my = i;
                        return <CoverageLine key={r.category.id} r={r} max={max} cursor={my === idx} onClick={() => setCur(my)} onOpen={() => showInTagging(book?.path, { filter: [r.category.id] })} />;
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, warn }: { label: string; value: number; sub?: string; warn?: boolean }) {
  return (
    <div className={cx(s.stat, warn && s.statWarn)}>
      <div className={s.statValue}>
        {value}
        {sub && <span>{sub}</span>}
      </div>
      <div className={s.statLabel}>{label}</div>
    </div>
  );
}

function CoverageLine({ r, max, cursor, onClick, onOpen }: { r: CoverageRow; max: number; cursor: boolean; onClick(): void; onOpen(): void }) {
  const n = r.plays.length;
  return (
    <tr className={cx(s.covRow, !n && s.covHole, cursor && s.covCur)} data-cursor={cursor || undefined} onClick={onClick} onDoubleClick={onOpen} style={{ "--c": r.category.color } as CSSProperties}>
      <td>
        <span className={s.covCat} style={{ paddingLeft: r.depth * 18 }}>
          <CategoryChip category={r.category} size="sm" depth={r.depth} />
        </span>
      </td>
      <td className={s.covNum}>
        <div className={s.bar2}>
          <span className={s.bar2Fill} style={{ width: `${(n / max) * 100}%` }} />
          <span className={s.bar2Num}>{n || "—"}</span>
        </div>
      </td>
      <td>
        <div className={s.forms}>
          {r.formations.map((f) => (
            <span key={f.name} className={s.form}>
              {formationShort(f.name)} <b>{f.count}</b>
            </span>
          ))}
          {!n && <span className={s.holeText}>Hole</span>}
        </div>
      </td>
      <td className={s.covNum}>{r.sets || ""}</td>
      <td>
        <div className={s.auds}>
          {r.audibles.map((a) => (
            <span key={`${a.ref.f}/${a.ref.s}/${a.ref.p}`} className={s.audItem} title={`${a.ref.play.name} · ${a.ref.set} · audible ${a.slot}`}>
              <AudibleGlyph slot={a.slot} size="sm" />
              {a.ref.play.name}
            </span>
          ))}
        </div>
      </td>
      <td className={s.covNum}>{r.weighted || ""}</td>
      <td className={s.covGo}>
        <button
          type="button"
          className={s.goBtn}
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          title={n ? `Show the ${r.category.name} plays in Tag Plays` : `Find plays to tag ${r.category.name}`}
        >
          {n ? "Show" : "Find"} <Icon name="chevronRight" size={13} />
        </button>
      </td>
    </tr>
  );
}
