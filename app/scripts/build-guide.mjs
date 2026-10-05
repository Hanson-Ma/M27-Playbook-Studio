// Builds the printable user guide from the in-app Help (dev tool; needs Google Chrome or Edge).
//   npm run guide            (= node scripts/build-guide.mjs)
//   node scripts/build-guide.mjs [--html-only] [--letter|--a4]
//
// Reads the guide's sections in order (src/views/help/sections.ts → content/<id>.md), parses them with the app's own
// Markdown parser (src/views/help/markdownAst.ts, so the PDF says exactly what the Help view shows), and writes:
//   docs/guide/guide.html                    one self-contained, print-ready page (images inlined from public/guide/)
//   docs/guide/Playbook-Studio-Guide.pdf      printed by headless Chrome (Page.printToPDF), page numbers in the footer
//   public/guide/Playbook-Studio-Guide.pdf    the same PDF, shipped with the site (Help → "Open the PDF Guide")
// Every section starts on a new page. Page numbers (footer and table of contents) come from the printed PDF itself:
// the guide is printed, each section's page is read back from the PDF's named destinations, and the contents page is
// filled in and printed again until the numbers settle (usually two prints). The footer uses CSS page-margin boxes.
// Needs Chrome 131 or newer.
// Chrome: $CHROME, else the usual install paths on macOS / Windows / Linux. It runs headless with a throwaway profile
// on a free port and is closed when the script ends.
// Fonts: NB International Pro (text) + DM Mono (code, numbers; Google Fonts). NB International Pro is a licensed desktop
// font with the "Print & preview" embedding flag: the printed PDF may embed subsets of it, but its files must never be
// copied, converted or written anywhere. So guide.html only NAMES the family; while printing, the .otf files from
// $NB_FONT_DIR (default: ~/Desktop/Joby Identity/Fonts/NB International Pro) are handed to the headless browser in
// memory (FontFace objects registered with Page.addScriptToEvaluateOnNewDocument) and Chrome embeds the subsets it
// uses in the PDF. Without that folder the guide prints in Helvetica (a warning says so).
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HELP = path.join(APP, "src/views/help");
const PUBLIC_GUIDE = path.join(APP, "public/guide");
const OUT_DIR = path.join(APP, "docs/guide");
const PDF_NAME = "Playbook-Studio-Guide.pdf";
const args = process.argv.slice(2);
const HTML_ONLY = args.includes("--html-only");
const PAPER = args.includes("--a4") ? { name: "A4", w: 8.27, h: 11.69 } : { name: "Letter", w: 8.5, h: 11 };
const MARGIN = { top: 0.6, bottom: 0.72, side: 0.7 }; // inches
const CONTENT_W = Math.floor((PAPER.w - 2 * MARGIN.side) * 96); // CSS px
const MAX_IMG_H = Math.floor(5.6 * 96);

const { parseMarkdown, inlineText } = await import(pathToUrl(path.join(HELP, "markdownAst.ts")));

function pathToUrl(p) {
  return new URL(`file://${p.startsWith("/") ? "" : "/"}${p.replace(/\\/g, "/")}`).href;
}

// ───────────────────────────── sections ─────────────────────────────

/** HELP_SECTIONS from sections.ts (id, title, blurb), in order. */
function readSections() {
  const src = readFileSync(path.join(HELP, "sections.ts"), "utf8");
  const list = src.slice(src.indexOf("HELP_SECTIONS"));
  const re = /\{\s*id:\s*"([^"]+)",\s*title:\s*"([^"]+)",\s*blurb:\s*"([^"]+)"\s*\}/g;
  const out = [];
  for (let m; (m = re.exec(list)); ) out.push({ id: m[1], title: m[2], blurb: m[3] });
  if (!out.length) throw new Error("No sections found in sections.ts");
  return out.map((s, i) => {
    const file = path.join(HELP, "content", `${s.id}.md`);
    if (!existsSync(file)) throw new Error(`Missing guide section: content/${s.id}.md`);
    const doc = parseMarkdown(readFileSync(file, "utf8"));
    return { ...s, n: i + 1, doc, topics: doc.toc.filter((h) => h.level === 2) };
  });
}

// ───────────────────────────── Markdown AST → HTML ─────────────────────────────

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const images = new Map(); // src → { uri, w, h }

function pngSize(buf) {
  if (buf.toString("ascii", 1, 4) !== "PNG") return undefined;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function image(src) {
  if (images.has(src)) return images.get(src);
  const file = path.join(APP, "public", src);
  if (!existsSync(file)) {
    console.warn(`  ! missing image ${src}`);
    images.set(src, undefined);
    return undefined;
  }
  const buf = readFileSync(file);
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime = ext === "svg" ? "image/svg+xml" : ext === "jpg" ? "image/jpeg" : `image/${ext}`;
  const size = pngSize(buf) ?? { w: CONTENT_W, h: Math.round(CONTENT_W * 0.6) };
  // Screenshots are 1× device pixels unless the name ends in -2x. On paper they print at 80 % of their on-screen
  // size (full-window shots shrink to the column), never taller than MAX_IMG_H.
  const scale = /-2x\.\w+$/.test(src) ? 2 : 1;
  // Full-window shots (1440 px wide) get 90 % of the column so a heading and a few lines fit next to them on a page.
  const maxW = size.w / scale >= 1400 ? Math.round(CONTENT_W * 0.9) : CONTENT_W;
  let w = Math.min(maxW, (size.w / scale) * 0.8);
  let h = (w * size.h) / size.w;
  if (h > MAX_IMG_H) {
    h = MAX_IMG_H;
    w = (h * size.w) / size.h;
  }
  const img = { uri: `data:${mime};base64,${buf.toString("base64")}`, w: Math.round(w), h: Math.round(h) };
  images.set(src, img);
  return img;
}

/** In-app links → PDF anchors: #/help/<id>[?h=<heading>] → #<id>[--<heading>]; other app routes become plain text. */
function linkTarget(href, sections) {
  const m = /^#\/help\/([\w-]+)(?:\?h=([\w-]+))?/.exec(href);
  if (m && sections.some((s) => s.id === m[1])) return `#${m[1]}${m[2] ? `--${m[2]}` : ""}`;
  if (href.startsWith("#")) return undefined;
  return href;
}

function inline(nodes, ctx) {
  return nodes
    .map((n) => {
      switch (n.t) {
        case "text":
          return esc(n.v);
        case "strong":
          return `<strong>${inline(n.c, ctx)}</strong>`;
        case "em":
          return `<em>${inline(n.c, ctx)}</em>`;
        case "code":
          return `<code>${esc(n.v)}</code>`;
        case "br":
          return "<br>";
        case "img": {
          const img = image("/" + n.src);
          return img ? `<img class="inline" src="${img.uri}" alt="${esc(n.alt)}">` : esc(n.alt);
        }
        case "link": {
          const href = linkTarget(n.href, ctx.sections);
          const body = inline(n.c, ctx);
          if (!href) return `<span class="applink">${body}</span>`;
          const ext = !href.startsWith("#");
          return `<a class="${ext ? "ext" : "xref"}" href="${esc(href)}">${body}</a>`;
        }
        default:
          return "";
      }
    })
    .join("");
}

const CALLOUT_LABEL = { tip: "Tip", warning: "Heads Up", note: "Note" };
const CALLOUT_ICON = {
  tip: '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1L5 10.5l5.1-1.9z"/>',
  warning: '<path d="M12 4l9 15.5H3z"/><path d="M12 10v4.2M12 16.8v.2"/>',
  note: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.2M12 7.8v.2"/>',
};

function blocks(list, ctx) {
  return list
    .map((b) => {
      switch (b.t) {
        case "heading": {
          if (b.level === 1) return ""; // the chapter opener shows the title
          const id = `${ctx.sec.id}--${b.id}`;
          return `<h${b.level} id="${id}">${inline(b.c, ctx)}</h${b.level}>`;
        }
        case "para": {
          if (b.c.length === 1 && b.c[0].t === "img") {
            const img = image("/" + b.c[0].src);
            if (!img) return "";
            const cap = b.c[0].alt;
            return `<figure><img src="${img.uri}" alt="${esc(cap)}" style="width:${img.w}px">${cap ? `<figcaption>${esc(cap)}</figcaption>` : ""}</figure>`;
          }
          return `<p>${inline(b.c, ctx)}</p>`;
        }
        case "list": {
          const items = b.items.map((it) => `<li>${it.length === 1 && it[0].t === "para" ? inline(it[0].c, ctx) : blocks(it, ctx)}</li>`).join("");
          return b.ordered ? `<ol${b.start !== 1 ? ` start="${b.start}"` : ""}>${items}</ol>` : `<ul>${items}</ul>`;
        }
        case "code":
          return `<div class="code"><div class="code-bar">${esc(b.lang || "text")}</div><pre>${esc(b.v)}</pre></div>`;
        case "table": {
          const al = (j) => (b.align[j] ? ` style="text-align:${b.align[j]}"` : "");
          const head = b.head.map((c, j) => `<th${al(j)}>${inline(c, ctx)}</th>`).join("");
          const rows = b.rows.map((r) => `<tr>${r.map((c, j) => `<td${al(j)}>${inline(c, ctx)}</td>`).join("")}</tr>`).join("");
          // Short tables stay on one page; long ones may break between rows (the header repeats).
          return `<table${b.rows.length <= 8 ? ' class="keep"' : ""}><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
        }
        case "callout":
          return `<aside class="callout ${b.kind}"><div class="callout-head"><svg viewBox="0 0 24 24">${CALLOUT_ICON[b.kind]}</svg>${esc(
            b.title ?? CALLOUT_LABEL[b.kind],
          )}</div>${blocks(b.c, ctx)}</aside>`;
        case "quote":
          return `<blockquote>${blocks(b.c, ctx)}</blockquote>`;
        case "hr":
          return "<hr>";
        default:
          return "";
      }
    })
    .join("\n");
}

// ───────────────────────────── the document ─────────────────────────────

// DM Mono (OFL) from Google Fonts. NB International Pro is never linked or embedded here: see "Fonts" at the top.
const FONTS = "https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&display=swap";
const SANS = `"NB International Pro", "NB International", "Helvetica Neue", Helvetica, Arial, sans-serif`;
const MONO = `"DM Mono", ui-monospace, Menlo, Consolas, monospace`;

const CSS = /* css */ `
@page { size: ${PAPER.name}; margin: ${MARGIN.top}in ${MARGIN.side}in ${MARGIN.bottom}in;
  @bottom-left { content: "Playbook Studio · User Guide"; vertical-align: top; padding-top: 0.2in; font: 500 6.8pt ${SANS}; color: #8a909b; }
  @bottom-right { content: counter(page) " / " counter(pages); vertical-align: top; padding-top: 0.2in; font: 400 7.5pt ${MONO}; color: #5b616c; }
}
@page cover { margin: 0; @bottom-left { content: none; } @bottom-right { content: none; } }
:root {
  --ink: #16181d; --ink-2: #353a44; --ink-3: #6b7280; --rule: #dfe2e7; --paper: #ffffff; --tint: #f4f5f7;
  --night: #0c0e12; --night-2: #161a21; --night-3: #232833;
  --yellow: #e8c547; --red: #e5484d; --blue: #3e7bfa; --green: #1f9d55; --amber: #c27c0e; --info: #2f6fe0;
  --display: ${SANS};
  --body: ${SANS};
  --mono: ${MONO};
}
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; background: var(--paper); color: var(--ink-2); font: 400 9.8pt/1.55 var(--body); }
@media screen {
  body { background: #e9ebef; }
  .page-sheet { width: ${PAPER.w}in; margin: 24px auto; background: var(--paper); box-shadow: 0 4px 24px rgba(0,0,0,.15); padding: ${MARGIN.top}in ${MARGIN.side}in ${MARGIN.bottom}in; }
  .cover.page-sheet { padding: 0; }
}

/* ── cover ── */
.cover { page: cover; position: relative; width: ${PAPER.w}in; height: ${PAPER.h}in; overflow: hidden; color: #fff;
  background:
    radial-gradient(60% 45% at 0% 0%, rgba(62,123,250,.38), transparent 70%),
    radial-gradient(55% 45% at 100% 0%, rgba(229,72,77,.32), transparent 70%),
    radial-gradient(80% 40% at 50% 100%, rgba(232,197,71,.10), transparent 70%),
    linear-gradient(180deg, #11141a 0%, var(--night) 100%);
  break-after: page; }
.cover-lines { position: absolute; inset: 0; background-image: repeating-linear-gradient(0deg, transparent 0 47px, rgba(255,255,255,.035) 47px 48px); }
.cover-inner { position: relative; padding: 1.15in 0.85in 0; }
.cover .eyebrow { font: 500 9.5pt var(--display); letter-spacing: .01em; color: #9aa3b2; }
.cover .title { margin: .12in 0 0; font: 700 56pt/0.92 var(--display); letter-spacing: -.02em; color: #fff; }
.cover .title span { color: #8b93a1; }
.cover .subtitle { margin-top: .22in; font: 500 16pt var(--display); color: #e9ecf1; }
.cover .subtitle b { color: var(--yellow); font-weight: 700; }
.cover .lede { margin-top: .16in; max-width: 5.6in; font: 400 11pt/1.5 var(--body); color: #b9c0cc; }
.cover .hero { position: absolute; left: .85in; right: .85in; bottom: 1.25in; border-radius: 10px; overflow: hidden;
  box-shadow: 0 18px 50px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.08); }
.cover .hero img { display: block; width: 100%; }
.cover .foot { position: absolute; left: .85in; right: .85in; bottom: .55in; display: flex; justify-content: space-between;
  font: 500 7.5pt var(--display); color: #7d8696; }
.cover .stripe { position: absolute; left: 0; right: 0; bottom: 0; height: 6px; background: linear-gradient(90deg, var(--blue), var(--blue) 33%, var(--yellow) 33%, var(--yellow) 66%, var(--red) 66%); }

/* ── contents ── */
.toc { break-after: page; }
.toc h1 { margin: 0 0 .03in; font: 700 24pt/1 var(--display); color: var(--ink); }
.toc .toc-sub { margin: 0 0 .14in; color: var(--ink-3); }
.toc ol { list-style: none; margin: 0; padding: 0; }
.toc li { padding: 5px 0 6px; border-bottom: 1px solid var(--rule); break-inside: avoid; }
.toc .row { display: flex; align-items: baseline; gap: 10px; }
.toc .num { width: 30px; flex: none; font: 400 10.5pt var(--mono); color: #b5bcc8; }
.toc .title { font: 700 10.5pt var(--display); color: var(--ink); text-decoration: none; }
.toc .blurb { color: var(--ink-3); font-size: 9.2pt; }
.toc .dots { flex: 1; border-bottom: 1.5px dotted #c3c8d1; transform: translateY(-4px); min-width: 20px; }
.toc .pg { font: 500 10pt var(--mono); color: var(--ink); min-width: 22px; text-align: right; }
.toc .topics { margin: 1px 0 0 40px; font-size: 8.2pt; line-height: 1.4; color: #7a8190; }
.toc .topics a { color: inherit; text-decoration: none; }
.toc .topics .sep { padding: 0 5px; color: #b9bfc9; }

/* ── chapters ── */
.chapter { break-before: page; }
.opener { position: relative; margin: 0 0 .26in; padding: .26in .3in .24in; border-radius: 10px; color: #fff; overflow: hidden;
  background: radial-gradient(70% 120% at 0% 0%, rgba(62,123,250,.30), transparent 60%), radial-gradient(60% 120% at 100% 0%, rgba(229,72,77,.24), transparent 60%), var(--night); }
.opener .kicker { font: 500 7.5pt var(--display); color: #9aa3b2; }
.opener h1 { margin: .04in 0 .05in; font: 700 26pt/0.98 var(--display); letter-spacing: -.01em; color: #fff; }
.opener .blurb { font: 400 10.5pt var(--body); color: #c7cdd7; }
.opener .topics { margin-top: .12in; padding-top: .1in; border-top: 1px solid rgba(255,255,255,.12); font: 500 7.5pt var(--display);
  color: #8f98a8; }
.opener .topics a { color: #dfe3ea; text-decoration: none; }
.opener .topics span.sep { color: #4b5361; padding: 0 .07in; }
.opener::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: linear-gradient(90deg, var(--blue) 0 33%, var(--yellow) 33% 66%, var(--red) 66%); }

h2, h3, h4 { color: var(--ink); font-family: var(--display); break-after: avoid; page-break-after: avoid; }
h2 { margin: .24in 0 .07in; padding-top: .07in; font-size: 14.5pt; font-weight: 700; line-height: 1.08; border-top: 2px solid var(--ink); }
h3 { margin: .16in 0 .04in; font-size: 10.8pt; font-weight: 700; }
h4 { margin: .12in 0 .03in; font-size: 9.8pt; font-weight: 700; color: var(--ink-2); }
h2 + *, h3 + *, h4 + * { break-before: avoid; }
p { margin: 0 0 .085in; orphans: 3; widows: 3; }
strong { color: var(--ink); font-weight: 500; }
em { font-style: italic; }
a.xref { color: #1f55c9; text-decoration: none; border-bottom: 1px solid rgba(31,85,201,.35); }
a.ext { color: #1f55c9; text-decoration: none; }
.applink { font-weight: 500; color: var(--ink); }
code { font: 400 0.86em var(--mono); font-variant-ligatures: none; background: #eef0f3; border: 1px solid #e0e3e8; border-radius: 4px; padding: 0 4px; color: #1d2027; white-space: nowrap; }
ul, ol { margin: 0 0 .09in; padding-left: .24in; }
li { margin: .03in 0; }
li > p { margin-bottom: .04in; }
ol > li::marker { font: 400 0.92em var(--mono); color: var(--ink); }
ul > li::marker { color: #9aa1ad; }
li > ul, li > ol { margin: .03in 0 .04in; }

figure { margin: .08in 0 .14in; break-inside: avoid; page-break-inside: avoid; text-align: center; }
figure img { display: block; max-width: 100%; height: auto; margin: 0 auto; border-radius: 6px; border: 1px solid #c9ced6; }
figcaption { margin: .07in auto 0; max-width: 92%; font-size: 8.8pt; line-height: 1.4; color: var(--ink-3); font-style: italic; }
li figure { margin: .06in 0 .1in; }
img.inline { height: 1.3em; vertical-align: middle; }

table { width: 100%; margin: .06in 0 .14in; border-collapse: separate; border-spacing: 0; font-size: 9.4pt; line-height: 1.38;
  border: 1px solid var(--rule); border-radius: 7px; overflow: hidden; break-inside: auto; }
table.keep { break-inside: avoid; page-break-inside: avoid; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
th { background: var(--night-2); color: #e9ecf1; text-align: left; padding: 6px 9px; font: 500 7.6pt var(--display); }
td { padding: 5.5px 9px; border-top: 1px solid var(--rule); vertical-align: top; }
tbody tr:nth-child(even) td { background: var(--tint); }
td code { white-space: normal; }

.callout { margin: .08in 0 .14in; padding: .1in .14in .06in; border-radius: 7px; border: 1px solid; border-left-width: 4px; break-inside: avoid; }
.callout.tip { border-color: #bfe3cc; border-left-color: var(--green); background: #f1faf4; }
.callout.warning { border-color: #f1d9a8; border-left-color: var(--amber); background: #fdf7ea; }
.callout.note { border-color: #c9d9f6; border-left-color: var(--info); background: #f2f6fd; }
.callout-head { display: flex; align-items: center; gap: 6px; margin-bottom: .04in; font: 700 8.5pt var(--display); }
.callout-head svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.callout.tip .callout-head { color: #157a41; }
.callout.warning .callout-head { color: #9a5f06; }
.callout.note .callout-head { color: #2459bd; }
.callout p:last-child, .callout ul:last-child, .callout ol:last-child { margin-bottom: .04in; }

.code { margin: .06in 0 .14in; border-radius: 7px; overflow: hidden; background: var(--night); break-inside: avoid; }
.code-bar { padding: 3px 10px; background: var(--night-3); font: 400 7.5pt var(--mono); color: #8f98a8; }
.code pre { margin: 0; padding: 8px 12px 9px; font: 400 8.2pt/1.5 var(--mono); font-variant-ligatures: none; color: #e9ecf1; white-space: pre-wrap; word-break: break-word; }
blockquote { margin: 0 0 .1in; padding-left: .14in; border-left: 3px solid var(--rule); color: var(--ink-3); }
hr { border: 0; border-top: 1px solid var(--rule); margin: .16in 0; }
`;

function topicsLine(sec, cls = "topics") {
  if (!sec.topics.length) return "";
  return `<div class="${cls}">${sec.topics.map((t) => `<a href="#${sec.id}--${t.id}">${esc(t.text)}</a>`).join('<span class="sep">·</span>')}</div>`;
}

function chapterHtml(sec, sections) {
  const ctx = { sec, sections };
  return `<section class="chapter page-sheet" id="${sec.id}">
<header class="opener"><div class="kicker">Section ${String(sec.n).padStart(2, "0")}</div><h1>${esc(sec.doc.title ?? sec.title)}</h1><div class="blurb">${esc(sec.blurb)}</div>${topicsLine(sec)}</header>
${blocks(sec.doc.blocks, ctx)}
</section>`;
}

function coverHtml() {
  const hero = image("/guide/playbook-set.png");
  const date = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return `<section class="cover page-sheet">
<div class="cover-lines"></div>
<div class="cover-inner">
  <div class="eyebrow">Madden NFL 27</div>
  <div class="title">Playbook <span>Studio</span></div>
  <div class="subtitle">User Guide · <b>Madden NFL 27</b></div>
  <p class="lede">Build custom playbooks, design your own plays, routes and formations, and send them to the game: a step-by-step guide to every screen.</p>
</div>
${hero ? `<div class="hero"><img src="${hero.uri}" alt=""></div>` : ""}
<div class="foot"><span>Edit · Export · Play</span><span>${esc(date)}</span></div>
<div class="stripe"></div>
</section>`;
}

function tocHtml(sections, pages) {
  const rows = sections
    .map(
      (s) => `<li><div class="row"><span class="num">${String(s.n).padStart(2, "0")}</span><a class="title" href="#${s.id}">${esc(s.title)}</a><span class="blurb">${esc(
        s.blurb,
      )}</span><span class="dots"></span><span class="pg">${pages?.[s.id] ?? "00"}</span></div>${topicsLine(s)}</li>`,
    )
    .join("\n");
  return `<section class="toc page-sheet"><h1>Contents</h1><p class="toc-sub">Every section starts on a new page. In the app, the same text is under Help (the ? at the top right).</p><ol>${rows}</ol></section>`;
}

function documentHtml(body, title = "Playbook Studio — User Guide · Madden NFL 27") {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONTS}" rel="stylesheet">
<style>${CSS}</style></head>
<body>
${body}
</body></html>`;
}

// ───────────────────────────── Chrome ─────────────────────────────

function findChrome() {
  const cands = [
    process.env.CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  const found = cands.find((c) => existsSync(c));
  if (!found) throw new Error("Chrome or Edge not found — set CHROME=/path/to/chrome");
  return found;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NB_FONT_DIR = process.env.NB_FONT_DIR ?? path.join(os.homedir(), "Desktop/Joby Identity/Fonts/NB International Pro");
/** NB International Pro files → FontFace descriptors (Book is weight 400 inside the file, like Regular: map it to 350). */
const NB_FACES = [
  ["Lig", 300, "normal"], ["LigIta", 300, "italic"],
  ["Boo", 350, "normal"], ["BooIta", 350, "italic"],
  ["Reg", 400, "normal"], ["Ita", 400, "italic"],
  ["Med", 500, "normal"], ["MedIta", 500, "italic"],
  ["Bol", 700, "normal"], ["BolIta", 700, "italic"],
];

/**
 * A page script that registers the locally installed NB International Pro files as FontFaces (print page only: the
 * bytes go from this process straight into the headless browser's memory; nothing is written to disk). Returns
 * undefined when the folder has no NBInternationalProReg.otf.
 */
function nbFontsScript() {
  const faces = [];
  for (const [suffix, weight, style] of NB_FACES) {
    const file = path.join(NB_FONT_DIR, `NBInternationalPro${suffix}.otf`);
    if (existsSync(file)) faces.push({ weight: String(weight), style, b64: readFileSync(file).toString("base64") });
  }
  if (!faces.some((f) => f.weight === "400" && f.style === "normal")) return undefined;
  return `(() => {
    if (!document.fonts) return;
    for (const f of ${JSON.stringify(faces)}) {
      const bin = atob(f.b64), buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      document.fonts.add(new FontFace("NB International Pro", buf, { weight: f.weight, style: f.style }));
    }
  })();`;
}

async function startChrome() {
  const profile = mkdtempSync(path.join(os.tmpdir(), "pbstudio-guide-"));
  const proc = spawn(findChrome(), ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], {
    stdio: "ignore",
  });
  const portFile = path.join(profile, "DevToolsActivePort");
  for (let i = 0; i < 80 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) throw new Error("Chrome didn't start");
  const port = Number(readFileSync(portFile, "utf8").split("\n")[0]);
  let page;
  for (let i = 0; i < 40 && !page; i++) {
    try {
      page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
    } catch {}
    if (!page) await sleep(100);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d);
      pending.delete(d.id);
    } else listeners.forEach((l) => l(d));
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, (d) => (d.error ? rej(new Error(`${method}: ${d.error.message}`)) : res(d.result)));
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const close = () => {
    try {
      ws.close();
    } catch {}
    proc.kill();
    setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
  };
  await send("Page.enable");
  await send("Runtime.enable");
  const fonts = nbFontsScript();
  if (fonts) await send("Page.addScriptToEvaluateOnNewDocument", { source: fonts });
  else console.warn(`  ! NB International Pro not found in ${NB_FONT_DIR} (set NB_FONT_DIR): the PDF falls back to Helvetica`);
  return { send, close, on: (fn) => listeners.add(fn) };
}

/** Load an HTML file, wait for fonts and images, and print it. Returns the PDF bytes. */
async function printPdf(chrome, file) {
  const loaded = new Promise((res) => {
    const fn = (d) => {
      if (d.method === "Page.loadEventFired") res();
    };
    chrome.on(fn);
  });
  await chrome.send("Page.navigate", { url: pathToUrl(file) });
  await Promise.race([loaded, sleep(20000)]);
  await chrome.send("Runtime.evaluate", {
    expression: "Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 8000))]).then(() => Promise.all([...document.images].map(i => i.decode().catch(() => 0))))",
    awaitPromise: true,
  });
  const params = {
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: false,
    paperWidth: PAPER.w,
    paperHeight: PAPER.h,
    generateDocumentOutline: true,
  };
  let res;
  try {
    res = await chrome.send("Page.printToPDF", params);
  } catch {
    delete params.generateDocumentOutline; // older Chrome
    res = await chrome.send("Page.printToPDF", params);
  }
  return Buffer.from(res.data, "base64");
}

// ───────────────────────────── reading the PDF back ─────────────────────────────

/** Chrome (Skia) PDFs: plain-text object dictionaries. Returns the text of object `n`. */
function pdfObject(src, n) {
  const at = src.search(new RegExp(`(^|[\\r\\n])${n} 0 obj\\b`));
  if (at < 0) return "";
  return src.slice(at, src.indexOf("endobj", at));
}

/** Page count and, for each named destination (element ids that internal links point to), its 1-based page. */
function pdfPages(pdf) {
  const src = pdf.toString("latin1");
  const ci = src.search(/\/Type\s*\/Catalog\b/);
  const catalog = ci < 0 ? "" : src.slice(ci, src.indexOf("endobj", ci));
  const pagesRef = /\/Pages\s+(\d+)\s+0\s+R/.exec(catalog)?.[1];
  const order = [];
  const walk = (n, depth = 0) => {
    const obj = pdfObject(src, n);
    if (depth > 20 || !obj) return;
    if (/\/Type\s*\/Pages\b/.test(obj)) {
      const kids = /\/Kids\s*\[([^\]]*)\]/.exec(obj)?.[1] ?? "";
      for (const m of kids.matchAll(/(\d+)\s+0\s+R/g)) walk(m[1], depth + 1);
    } else order.push(String(n));
  };
  if (pagesRef) walk(pagesRef);
  const pageOf = new Map(order.map((n, i) => [n, i + 1]));
  const dests = {};
  const destsRef = /\/Dests\s+(\d+)\s+0\s+R/.exec(catalog)?.[1];
  const dict = destsRef ? pdfObject(src, destsRef) : "";
  for (const m of dict.matchAll(/\/([^\s/\[]+)\s*\[\s*(\d+)\s+0\s+R/g)) dests[m[1]] = pageOf.get(m[2]);
  return { count: order.length, dests };
}

// ───────────────────────────── main ─────────────────────────────

const sections = readSections();
mkdirSync(OUT_DIR, { recursive: true });
const htmlFile = path.join(OUT_DIR, "guide.html");
const pdfFile = path.join(OUT_DIR, PDF_NAME);
const chapters = sections.map((s) => chapterHtml(s, sections)).join("\n");
const build = (pages) => documentHtml(coverHtml() + "\n" + tocHtml(sections, pages) + "\n" + chapters);

let chrome;
try {
  let pages;
  let html = build(pages);
  writeFileSync(htmlFile, html);
  if (HTML_ONLY) console.log(`Wrote ${path.relative(APP, htmlFile)} (${(html.length / 1e6).toFixed(1)} MB, ${images.size} images)`);
  else {
    chrome = await startChrome();
    let pdf;
    for (let pass = 1; pass <= 4; pass++) {
      pdf = await printPdf(chrome, htmlFile);
      const { count, dests } = pdfPages(pdf);
      const found = Object.fromEntries(sections.map((s) => [s.id, dests[s.id]]));
      const missing = sections.filter((s) => !found[s.id]).map((s) => s.id);
      if (missing.length) throw new Error(`Couldn't find these sections in the PDF: ${missing.join(", ")}`);
      const settled = pages && sections.every((s) => pages[s.id] === found[s.id]);
      console.log(`Pass ${pass}: ${count} pages${settled ? " — page numbers settled" : ""}`);
      if (settled) break;
      pages = found;
      html = build(pages);
      writeFileSync(htmlFile, html);
    }
    for (const s of sections) console.log(`  ${String(s.n).padStart(2, "0")} ${s.title.padEnd(30)} p. ${pages[s.id]}`);
    writeFileSync(pdfFile, pdf);
    mkdirSync(PUBLIC_GUIDE, { recursive: true });
    copyFileSync(pdfFile, path.join(PUBLIC_GUIDE, PDF_NAME));
    console.log(`Wrote ${path.relative(APP, htmlFile)} (${(html.length / 1e6).toFixed(1)} MB, ${images.size} images)`);
    console.log(`Wrote ${path.relative(APP, pdfFile)} (${pdfPages(pdf).count} pages, ${(pdf.length / 1e6).toFixed(1)} MB) and public/guide/${PDF_NAME}`);
  }
} finally {
  chrome?.close();
}
