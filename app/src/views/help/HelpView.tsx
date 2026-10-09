// Help (#/help[/<section>][?h=<heading id>]): the in-app user guide. Left: search + section list; right: the section
// as a reading column with "On This Page" links and previous/next.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { href, navigate, useRoute } from "../../state/router";
import { Icon, TextInput, cx } from "../../ui";
import { helpSource } from "./content";
import { Markdown } from "./Markdown";
import { inlineText, markdownText, parseMarkdown, type Block, type ParsedDoc } from "./markdownAst";
import { DEFAULT_HELP_SECTION, HELP_SECTIONS, isHelpSection, type HelpSection, type HelpSectionId } from "./sections";
import s from "./HelpView.module.css";

interface LoadedSection extends HelpSection {
  doc: ParsedDoc;
  text: string;
  /** The section split at its level-2+ headings (heading id + that part's text), for search hits. */
  parts: { id?: string; text: string }[];
}

/** Split a document at its subheadings so a search hit can jump to the right one. */
function splitParts(doc: ParsedDoc): LoadedSection["parts"] {
  const parts: LoadedSection["parts"] = [{ text: "" }];
  const current: Block[][] = [[]];
  for (const b of doc.blocks) {
    if (b.t === "heading" && b.level >= 2) {
      parts.push({ id: b.id, text: inlineText(b.c) });
      current.push([]);
    } else current[current.length - 1].push(b);
  }
  return parts.map((p, i) => ({ ...p, text: [p.text, markdownText({ blocks: current[i], toc: [] })].join("\n") }));
}

const MISSING = "# Coming soon\n\nThis part of the guide hasn't been written yet.";

let cache: LoadedSection[] | undefined;
function loadSections(): LoadedSection[] {
  cache ??= HELP_SECTIONS.map((sec) => {
    const doc = parseMarkdown(helpSource(sec.id) ?? MISSING);
    return { ...sec, doc, text: markdownText(doc), parts: splitParts(doc) };
  });
  return cache;
}

/** Up to ~140 chars of `text` around the first hit of every word in `words` (all must match). */
function snippet(text: string, words: string[]): string | undefined {
  const lower = text.toLowerCase();
  if (!words.every((w) => lower.includes(w))) return undefined;
  const at = lower.indexOf(words[0]);
  const start = Math.max(0, at - 50);
  const end = Math.min(text.length, at + 90);
  return (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ").trim() + (end < text.length ? "…" : "");
}

export function HelpView() {
  const route = useRoute();
  const sections = loadSections();
  const id: HelpSectionId = isHelpSection(route.parts[0]) ? route.parts[0] : DEFAULT_HELP_SECTION;
  const index = sections.findIndex((x) => x.id === id);
  const section = sections[index];
  const heading = route.query.get("h") ?? undefined;
  const [query, setQuery] = useState("");
  const reader = useRef<HTMLDivElement>(null);

  const words = useMemo(
    () =>
      query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 1),
    [query],
  );
  // Search hits: sections containing every word, with a snippet and the subheading the first word appears under.
  const results = useMemo(() => {
    if (!words.length) return undefined;
    return sections
      .map((sec) => {
        const hit = snippet(`${sec.title}\n${sec.text}`, words);
        const part = hit ? sec.parts.find((p) => p.id && p.text.toLowerCase().includes(words[0])) : undefined;
        return { sec, hit, heading: part?.id };
      })
      .filter((r) => r.hit);
  }, [sections, words]);

  // New section: back to the top, or to the requested heading.
  useLayoutEffect(() => {
    const el = reader.current;
    if (!el) return;
    const target = heading ? el.querySelector<HTMLElement>(`[data-heading-id="${CSS.escape(heading)}"]`) : null;
    if (target) target.scrollIntoView({ block: "start" });
    else el.scrollTop = 0;
  }, [id, heading]);

  const go = (sec: HelpSectionId, h?: string) => navigate(href("help", sec) + (h ? `?h=${encodeURIComponent(h)}` : ""), { replace: true });
  const prev = sections[index - 1];
  const next = sections[index + 1];
  const toc = section.doc.toc.filter((h) => h.level === 2);

  return (
    <div className={s.page}>
      <aside className={s.nav}>
        <div className={s.navHead}>
          <div className={s.eyebrow}>Help</div>
          <h1 className={s.navTitle}>Guide</h1>
        </div>
        <TextInput value={query} onChange={setQuery} icon="search" placeholder="Search the guide" size="sm" aria-label="Search the guide" />
        <nav className={s.sectionList} aria-label="Guide sections">
          {results && !results.length && <div className={s.noHits}>Nothing found for “{query.trim()}”.</div>}
          {(results ?? sections.map((sec) => ({ sec, hit: undefined as string | undefined, heading: undefined as string | undefined }))).map(({ sec, hit, heading: h }) => {
            const n = sections.indexOf(sec) + 1;
            return (
              <a
                key={sec.id}
                href={href("help", sec.id) + (h ? `?h=${encodeURIComponent(h)}` : "")}
                className={cx(s.sectionLink, sec.id === id && s.sectionOn)}
                aria-current={sec.id === id ? "page" : undefined}
              >
                <span className={s.sectionNum}>{String(n).padStart(2, "0")}</span>
                <span className={s.sectionText}>
                  <span className={s.sectionTitle}>{sec.title}</span>
                  <span className={cx(s.sectionBlurb, hit && s.sectionHit)}>{hit ?? sec.blurb}</span>
                </span>
              </a>
            );
          })}
        </nav>
      </aside>

      <div className={s.reader} ref={reader}>
        <div className={s.readerInner}>
          <article className={s.article}>
            <div className={s.crumb}>
              <Icon name="book" size={14} /> Guide ·{" "}
              <span className={s.crumbNum}>
                {String(index + 1).padStart(2, "0")} / {String(sections.length).padStart(2, "0")}
              </span>
            </div>
            <Markdown doc={section.doc} />
            <footer className={s.pager}>
              {prev ? (
                <a className={s.pagerLink} href={href("help", prev.id)}>
                  <span className={s.pagerDir}>
                    <Icon name="chevronLeft" size={13} /> Previous
                  </span>
                  <span className={s.pagerTitle}>{prev.title}</span>
                </a>
              ) : (
                <span />
              )}
              {next && (
                <a className={cx(s.pagerLink, s.pagerNext)} href={href("help", next.id)}>
                  <span className={s.pagerDir}>
                    Next <Icon name="chevronRight" size={13} />
                  </span>
                  <span className={s.pagerTitle}>{next.title}</span>
                </a>
              )}
            </footer>
          </article>
          {toc.length > 1 && (
            <aside className={s.toc} aria-label="On This Page">
              <div className={s.tocHead}>On This Page</div>
              {toc.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  className={cx(s.tocLink, h.id === heading && s.tocOn)}
                  onClick={() => {
                    reader.current?.querySelector<HTMLElement>(`[data-heading-id="${CSS.escape(h.id)}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
                    go(id, h.id);
                  }}
                >
                  {h.text}
                </button>
              ))}
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
