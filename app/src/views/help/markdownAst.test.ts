import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inlineText, markdownText, parseInline, parseMarkdown, safeHref, safeImage, slugify, type Block } from "./markdownAst";
import { HELP_SECTIONS } from "./sections";

describe("inline", () => {
  it("parses bold, italic, code and plain text", () => {
    expect(parseInline("a **b** *c* `d` e")).toEqual([
      { t: "text", v: "a " },
      { t: "strong", c: [{ t: "text", v: "b" }] },
      { t: "text", v: " " },
      { t: "em", c: [{ t: "text", v: "c" }] },
      { t: "text", v: " " },
      { t: "code", v: "d" },
      { t: "text", v: " e" },
    ]);
    expect(parseInline("__b__ _i_")).toEqual([
      { t: "strong", c: [{ t: "text", v: "b" }] },
      { t: "text", v: " " },
      { t: "em", c: [{ t: "text", v: "i" }] },
    ]);
  });

  it("nests strong inside em and keeps snake_case literal", () => {
    expect(parseInline("*a **b** c*")).toEqual([{ t: "em", c: [{ t: "text", v: "a " }, { t: "strong", c: [{ t: "text", v: "b" }] }, { t: "text", v: " c" }] }]);
    expect(inlineText(parseInline("Y_Trips_Wk and PBS_Snag_Lt"))).toBe("Y_Trips_Wk and PBS_Snag_Lt");
    expect(parseInline("2 * 3 * 4")).toEqual([{ t: "text", v: "2 * 3 * 4" }]);
  });

  it("keeps markup inside code spans literal", () => {
    expect(parseInline("`**x** [a](b)`")).toEqual([{ t: "code", v: "**x** [a](b)" }]);
  });

  it("makes app, web and mail links; drops unsafe ones to text", () => {
    expect(parseInline("[Routes](#/help/routes)")).toEqual([{ t: "link", href: "#/help/routes", external: false, c: [{ t: "text", v: "Routes" }] }]);
    expect(parseInline("[site](https://example.com/x)")[0]).toMatchObject({ t: "link", external: true });
    expect(parseInline("[x](javascript:alert(1))")).toEqual([{ t: "text", v: "x" }]);
    expect(parseInline("[**b**](#/x)")).toEqual([{ t: "link", href: "#/x", external: false, c: [{ t: "strong", c: [{ t: "text", v: "b" }] }] }]);
    expect(safeHref("data:text/html,hi")).toBeUndefined();
  });

  it("only allows the guide's own images", () => {
    expect(parseInline("![Field](/guide/field.png)")).toEqual([{ t: "img", src: "guide/field.png", alt: "Field" }]);
    expect(parseInline("![x](https://evil.example/x.png)")).toEqual([{ t: "text", v: "x" }]);
    expect(safeImage("/guide/../secret.png")).toBeUndefined();
    expect(safeImage("guide/sub/a-b_c.webp")).toBe("guide/sub/a-b_c.webp");
  });

  it("handles escapes and line breaks", () => {
    expect(parseInline("\\*not em\\*")).toEqual([{ t: "text", v: "*not em*" }]);
    expect(parseInline("a\nb")).toEqual([{ t: "text", v: "a b" }]);
    expect(parseInline("a  \nb")).toEqual([{ t: "text", v: "a" }, { t: "br" }, { t: "text", v: "b" }]);
  });
});

describe("blocks", () => {
  const types = (blocks: Block[]) => blocks.map((b) => b.t);

  it("parses headings with unique ids and a toc", () => {
    const d = parseMarkdown("# Guide\n\n## Cuts\n\ntext\n\n## Cuts\n");
    expect(d.title).toBe("Guide");
    expect(d.toc.map((h) => h.id)).toEqual(["guide", "cuts", "cuts-2"]);
    expect(types(d.blocks)).toEqual(["heading", "heading", "para", "heading"]);
  });

  it("joins paragraph lines and stops at the next block", () => {
    const d = parseMarkdown("one\ntwo\n- item\n");
    expect(d.blocks[0]).toEqual({ t: "para", c: [{ t: "text", v: "one two" }] });
    expect(d.blocks[1]).toMatchObject({ t: "list", ordered: false });
  });

  it("parses nested and ordered lists", () => {
    const d = parseMarkdown("1. First\n2. Second\n   - sub a\n   - sub b\n3. Third\n");
    const list = d.blocks[0] as Extract<Block, { t: "list" }>;
    expect(list.ordered).toBe(true);
    expect(list.items).toHaveLength(3);
    expect(types(list.items[1])).toEqual(["para", "list"]);
    const sub = list.items[1][1] as Extract<Block, { t: "list" }>;
    expect(sub.items.map((it) => inlineText((it[0] as Extract<Block, { t: "para" }>).c))).toEqual(["sub a", "sub b"]);
  });

  it("keeps a list together across one blank line and starts ordered lists at their number", () => {
    const d = parseMarkdown("3. a\n\n4. b\n");
    expect(d.blocks).toHaveLength(1);
    expect(d.blocks[0]).toMatchObject({ t: "list", start: 3 });
  });

  it("parses fenced code verbatim", () => {
    const d = parseMarkdown("```powershell\npowershell -File tools\\export.ps1 -Install\n**not bold**\n```\nafter");
    expect(d.blocks[0]).toEqual({ t: "code", lang: "powershell", v: "powershell -File tools\\export.ps1 -Install\n**not bold**" });
    expect(d.blocks[1].t).toBe("para");
  });

  it("parses tables with alignment and escaped pipes", () => {
    const d = parseMarkdown("| Key | Does |\n|:--|--:|\n| `⌘Z` | Undo |\n| a \\| b | x |\n");
    const t = d.blocks[0] as Extract<Block, { t: "table" }>;
    expect(t.align).toEqual(["left", "right"]);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0][0]).toEqual([{ t: "code", v: "⌘Z" }]);
    expect(inlineText(t.rows[1][0])).toBe("a | b");
  });

  it("parses tip/warning callouts with any blocks inside", () => {
    const d = parseMarkdown(":::tip Save often\nPress **⌘S**.\n\n- one\n:::\n\n:::warning\nCareful\n:::\n");
    expect(d.blocks[0]).toMatchObject({ t: "callout", kind: "tip", title: "Save often" });
    expect(types((d.blocks[0] as Extract<Block, { t: "callout" }>).c)).toEqual(["para", "list"]);
    expect(d.blocks[1]).toMatchObject({ t: "callout", kind: "warning", title: undefined });
  });

  it("drops writer comments", () => {
    expect(markdownText(parseMarkdown("a\n<!-- note\nfor the writer -->\n\nb"))).toBe("a\nb");
  });

  it("parses quotes and rules", () => {
    expect(types(parseMarkdown("> quoted\n> more\n\n---\n").blocks)).toEqual(["quote", "hr"]);
  });

  it("slugifies and extracts plain text", () => {
    expect(slugify("Routes & cuts (v2)")).toBe("routes-cuts-v2");
    expect(markdownText(parseMarkdown("# A\n\n- **b**\n\n:::tip T\nc\n:::"))).toBe("A\nb\nT\nc");
  });
});

describe("guide content", () => {
  const dir = path.join(__dirname, "content");
  it("has a Markdown file for every section, each with a title", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    for (const sec of HELP_SECTIONS) {
      expect(files, sec.id).toContain(`${sec.id}.md`);
      const d = parseMarkdown(readFileSync(path.join(dir, `${sec.id}.md`), "utf8"));
      expect(d.title, sec.id).toBeTruthy();
    }
  });
});
