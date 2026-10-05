// Tiny, safe Markdown parser for the in-app guide (pure: no React/DOM). Produces a small AST that Markdown.tsx
// renders as React elements — never as HTML strings, so guide text can't inject markup.
//
// Supported:
//   # … ###### headings (with unique slug ids)    paragraphs (single newlines join; two trailing spaces = line break)
//   - / * / + and 1. lists (nested by indentation)  > block quotes      --- rules
//   ``` fenced code blocks (optional language)     | tables | with | :--: alignment |
//   :::tip [Title] / :::warning / :::note … ::: callout blocks (any blocks inside)
//   **bold** __bold__ *italic* _italic_ `code` [text](href) ![alt](/guide/x.png) \escapes
//   <!-- comments --> (notes for the guide's writer; never shown)
// Links: in-app hashes ("#/help/routes", "#/designer"), http(s) and mailto. Anything else (javascript:, data:…)
// renders as plain text. Images: only the guide's own pictures, /guide/<name>.(png|jpg|jpeg|gif|webp|svg).

export type Inline =
  | { t: "text"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; external: boolean; c: Inline[] }
  | { t: "img"; src: string; alt: string }
  | { t: "br" };

export type Align = "left" | "center" | "right" | undefined;
export type CalloutKind = "tip" | "warning" | "note";

export type Block =
  | { t: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; id: string; c: Inline[] }
  | { t: "para"; c: Inline[] }
  | { t: "list"; ordered: boolean; start: number; items: Block[][] }
  | { t: "code"; lang?: string; v: string }
  | { t: "table"; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { t: "callout"; kind: CalloutKind; title?: string; c: Block[] }
  | { t: "quote"; c: Block[] }
  | { t: "hr" };

export interface ParsedDoc {
  blocks: Block[];
  /** Headings in order (for an "On This Page" list): level, id, plain text. */
  toc: { level: number; id: string; text: string }[];
  /** Text of the first level-1 heading. */
  title?: string;
}

// ─────────────────────────────── inline ───────────────────────────────

const IMAGE_RE = /^\/?guide\/[A-Za-z0-9._\-/]+\.(png|jpe?g|gif|webp|svg)$/i;

/** Normalized safe href, or undefined when the link must render as text. */
export function safeHref(raw: string): { href: string; external: boolean } | undefined {
  const href = raw.trim();
  if (href.startsWith("#")) return { href, external: false };
  if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) return { href, external: true };
  return undefined;
}

/** Guide image path relative to the site root ("/guide/x.png" → "guide/x.png"), or undefined when not allowed. */
export function safeImage(raw: string): string | undefined {
  const src = raw.trim();
  if (src.includes("..") || !IMAGE_RE.test(src)) return undefined;
  return src.replace(/^\//, "");
}

const isWordChar = (ch: string | undefined) => !!ch && /[A-Za-z0-9]/.test(ch);

/** Index of the `]` matching the `[` at `open` (nested brackets allowed), or -1. */
function closeBracket(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) return i;
  }
  return -1;
}

/** `(href "title")` right after a `]`: returns the href and the index after `)`. */
function linkTarget(s: string, at: number): { href: string; end: number } | undefined {
  if (s[at] !== "(") return undefined;
  let depth = 0;
  for (let i = at; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) {
      const inner = s.slice(at + 1, i).trim();
      const href = inner.replace(/\s+"[^"]*"$/, "").trim();
      return { href, end: i + 1 };
    }
  }
  return undefined;
}

function pushText(out: Inline[], v: string) {
  if (!v) return;
  const last = out[out.length - 1];
  if (last && last.t === "text") last.v += v;
  else out.push({ t: "text", v });
}

/** Parse inline markup in one paragraph's text (newlines already normalized to "\n"). */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    // escapes
    if (ch === "\\" && i + 1 < src.length) {
      if (src[i + 1] === "\n") {
        out.push({ t: "br" });
        i += 2;
        continue;
      }
      if (/[\\`*_[\]()#+\-.!|:>~]/.test(src[i + 1])) {
        pushText(out, src[i + 1]);
        i += 2;
        continue;
      }
    }
    // hard line break (two trailing spaces) / soft break
    if (ch === "\n") {
      const before = src.slice(0, i);
      if (/ {2,}$/.test(before)) {
        const last = out[out.length - 1];
        if (last && last.t === "text") last.v = last.v.replace(/ +$/, "");
        out.push({ t: "br" });
      } else pushText(out, " ");
      i++;
      continue;
    }
    // code span
    if (ch === "`") {
      const ticks = /^`+/.exec(src.slice(i))![0];
      const end = src.indexOf(ticks, i + ticks.length);
      if (end > 0) {
        out.push({ t: "code", v: src.slice(i + ticks.length, end).replace(/\n/g, " ").replace(/^ (.+) $/, "$1") });
        i = end + ticks.length;
        continue;
      }
      pushText(out, ticks);
      i += ticks.length;
      continue;
    }
    // image / link
    if ((ch === "!" && src[i + 1] === "[") || ch === "[") {
      const open = ch === "!" ? i + 1 : i;
      const close = closeBracket(src, open);
      const target = close > 0 ? linkTarget(src, close + 1) : undefined;
      if (target) {
        const label = src.slice(open + 1, close);
        if (ch === "!") {
          const img = safeImage(target.href);
          if (img) out.push({ t: "img", src: img, alt: label });
          else pushText(out, label);
        } else {
          const link = safeHref(target.href);
          const c = parseInline(label);
          if (link) out.push({ t: "link", href: link.href, external: link.external, c });
          else out.push(...c);
        }
        i = target.end;
        continue;
      }
    }
    // strong / em
    if (ch === "*" || ch === "_") {
      const double = src[i + 1] === ch;
      const marker = double ? ch + ch : ch;
      const after = src[i + marker.length];
      // "_" only opens at a word start (snake_case and asset names stay literal); never before whitespace.
      const canOpen = after !== undefined && !/\s/.test(after) && (ch === "*" || !isWordChar(src[i - 1]));
      if (canOpen) {
        let found = -1;
        for (let k = src.indexOf(marker, i + marker.length + 1); k >= 0; k = src.indexOf(marker, k + 1)) {
          // A single marker skips doubles (they belong to a nested strong): "*a **b** c*".
          if (!double && (src[k + 1] === ch || src[k - 1] === ch)) {
            if (src[k + 1] === ch) k++;
            continue;
          }
          if (/\s/.test(src[k - 1])) continue;
          if (ch === "_" && isWordChar(src[k + marker.length])) continue;
          found = k;
          break;
        }
        if (found > 0) {
          const inner = parseInline(src.slice(i + marker.length, found));
          out.push(double ? { t: "strong", c: inner } : { t: "em", c: inner });
          i = found + marker.length;
          continue;
        }
      }
      pushText(out, marker);
      i += marker.length;
      continue;
    }
    // plain run up to the next special character
    const m = /^[^\\`![*_\n]+/.exec(src.slice(i));
    const run = m ? m[0] : ch;
    pushText(out, run);
    i += run.length;
  }
  return out;
}

/** Plain text of inline nodes (heading ids, table of contents, search). */
export function inlineText(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case "text":
        case "code":
          return n.v;
        case "img":
          return n.alt;
        case "br":
          return " ";
        default:
          return inlineText(n.c);
      }
    })
    .join("");
}

/** "Routes & cuts (v2)" → "routes-cuts-v2". */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

// ─────────────────────────────── blocks ───────────────────────────────

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)\s*$/;
const HEADING_RE = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR_RE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const LIST_RE = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const CALLOUT_OPEN_RE = /^ {0,3}:::\s*(tip|warning|note)\b\s*(.*)$/i;
const CALLOUT_CLOSE_RE = /^ {0,3}:::\s*$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const QUOTE_RE = /^ {0,3}>\s?(.*)$/;

const isBlank = (l: string) => l.trim() === "";

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  let inCode = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (ch === "`") {
      inCode = !inCode;
      cur += ch;
    } else if (ch === "|" && !inCode) {
      cells.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function alignOf(cell: string): Align {
  const c = cell.trim();
  const l = c.startsWith(":");
  const r = c.endsWith(":");
  return l && r ? "center" : r ? "right" : l ? "left" : undefined;
}

/** Does `line` start a block other than a paragraph (so a paragraph stops before it)? */
function startsBlock(lines: string[], i: number): boolean {
  const l = lines[i];
  return (
    FENCE_RE.test(l) ||
    HEADING_RE.test(l) ||
    HR_RE.test(l) ||
    CALLOUT_OPEN_RE.test(l) ||
    CALLOUT_CLOSE_RE.test(l) ||
    QUOTE_RE.test(l) ||
    LIST_RE.test(l) ||
    (l.includes("|") && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes("-"))
  );
}

interface Ctx {
  ids: Map<string, number>;
  toc: ParsedDoc["toc"];
}

function uniqueId(ctx: Ctx, text: string): string {
  const base = slugify(text);
  const n = ctx.ids.get(base) ?? 0;
  ctx.ids.set(base, n + 1);
  return n ? `${base}-${n + 1}` : base;
}

function parseBlocks(lines: string[], ctx: Ctx): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }

    // fenced code
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1];
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`).test(lines[i])) body.push(lines[i++]);
      i++; // closing fence (or end of input)
      out.push({ t: "code", lang: fence[2] || undefined, v: body.join("\n") });
      continue;
    }

    // callout
    const callout = CALLOUT_OPEN_RE.exec(line);
    if (callout) {
      const body: string[] = [];
      let depth = 1;
      i++;
      while (i < lines.length) {
        if (CALLOUT_OPEN_RE.test(lines[i])) depth++;
        else if (CALLOUT_CLOSE_RE.test(lines[i]) && --depth === 0) break;
        body.push(lines[i++]);
      }
      i++;
      const title = callout[2].trim() || undefined;
      out.push({ t: "callout", kind: callout[1].toLowerCase() as CalloutKind, title, c: parseBlocks(body, ctx) });
      continue;
    }
    if (CALLOUT_CLOSE_RE.test(line)) {
      i++; // stray closer
      continue;
    }

    // heading
    const h = HEADING_RE.exec(line);
    if (h) {
      const c = parseInline(h[2]);
      const text = inlineText(c);
      const id = uniqueId(ctx, text);
      const level = h[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      ctx.toc.push({ level, id, text });
      out.push({ t: "heading", level, id, c });
      i++;
      continue;
    }

    // rule
    if (HR_RE.test(line)) {
      out.push({ t: "hr" });
      i++;
      continue;
    }

    // table
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map(alignOf);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes("|")) {
        const cells = splitRow(lines[i++]);
        rows.push(head.map((_, k) => parseInline(cells[k] ?? "")));
      }
      out.push({ t: "table", align: head.map((_, k) => align[k]), head: head.map((x) => parseInline(x)), rows });
      continue;
    }

    // block quote
    if (QUOTE_RE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && !isBlank(lines[i])) {
        const q = QUOTE_RE.exec(lines[i]);
        body.push(q ? q[1] : lines[i]);
        i++;
      }
      out.push({ t: "quote", c: parseBlocks(body, ctx) });
      continue;
    }

    // list
    const li = LIST_RE.exec(line);
    if (li) {
      const indent = li[1].length;
      const ordered = /\d/.test(li[2]);
      const start = ordered ? parseInt(li[2], 10) : 1;
      const items: Block[][] = [];
      while (i < lines.length) {
        const m = LIST_RE.exec(lines[i]);
        if (!m || m[1].length !== indent || /\d/.test(m[2]) !== ordered) break;
        // Content column: where the item's text starts; continuation lines indented past the marker belong to it.
        const contentCol = m[1].length + m[2].length + 1;
        const body = [m[3]];
        i++;
        while (i < lines.length) {
          const l = lines[i];
          if (isBlank(l)) {
            // A blank line continues the item only when the next line is indented into it.
            const next = lines[i + 1];
            if (next !== undefined && !isBlank(next) && next.length - next.trimStart().length > indent) {
              body.push("");
              i++;
              continue;
            }
            break;
          }
          const lead = l.length - l.trimStart().length;
          if (lead > indent) {
            body.push(l.slice(Math.min(lead, contentCol)));
            i++;
            continue;
          }
          // Lazy continuation: a plain line right after the item text.
          if (!startsBlock(lines, i) && lead === 0 && body.length && !isBlank(body[body.length - 1])) {
            body.push(l);
            i++;
            continue;
          }
          break;
        }
        items.push(parseBlocks(body, ctx));
        // Allow one blank line between items of the same list.
        if (i < lines.length && isBlank(lines[i])) {
          const m2 = LIST_RE.exec(lines[i + 1] ?? "");
          if (m2 && m2[1].length === indent && /\d/.test(m2[2]) === ordered) i++;
        }
      }
      out.push({ t: "list", ordered, start, items });
      continue;
    }

    // paragraph
    const para: string[] = [line.trim()];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines, i)) para.push(lines[i++].replace(/^\s+/, ""));
    out.push({ t: "para", c: parseInline(para.join("\n")) });
  }
  return out;
}

/** Parse a Markdown document. */
export function parseMarkdown(src: string): ParsedDoc {
  const lines = src
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\t/g, "    ")
    .split("\n");
  const ctx: Ctx = { ids: new Map(), toc: [] };
  const blocks = parseBlocks(lines, ctx);
  const title = ctx.toc.find((h) => h.level === 1)?.text;
  return { blocks, toc: ctx.toc, title };
}

/** Plain text of a document (search). */
export function markdownText(doc: ParsedDoc): string {
  const parts: string[] = [];
  const walk = (blocks: Block[]) => {
    for (const b of blocks) {
      switch (b.t) {
        case "heading":
        case "para":
          parts.push(inlineText(b.c));
          break;
        case "list":
          b.items.forEach(walk);
          break;
        case "code":
          parts.push(b.v);
          break;
        case "table":
          parts.push(b.head.map(inlineText).join(" "), ...b.rows.map((r) => r.map(inlineText).join(" ")));
          break;
        case "callout":
          if (b.title) parts.push(b.title);
          walk(b.c);
          break;
        case "quote":
          walk(b.c);
          break;
      }
    }
  };
  walk(doc.blocks);
  return parts.join("\n");
}
