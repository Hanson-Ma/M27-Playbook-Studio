// Renders the guide's Markdown AST (./markdownAst.ts) as React elements — no HTML strings, so content can't inject
// markup. In-app links ("#/designer") navigate in place; web links open a new tab; images come from public/guide/.
import { useState, type ReactNode } from "react";
import { Icon, cx, toast, type IconName } from "../../ui";
import type { Align, Block, CalloutKind, Inline, ParsedDoc } from "./markdownAst";
import s from "./Markdown.module.css";

const assetUrl = (path: string) => `${import.meta.env.BASE_URL ?? "/"}${path}`;

function renderInline(nodes: Inline[], key = ""): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}${i}`;
    switch (n.t) {
      case "text":
        return n.v;
      case "strong":
        return <strong key={k}>{renderInline(n.c, k + ".")}</strong>;
      case "em":
        return <em key={k}>{renderInline(n.c, k + ".")}</em>;
      case "code":
        return (
          <code key={k} className={s.code}>
            {n.v}
          </code>
        );
      case "br":
        return <br key={k} />;
      case "img":
        return <img key={k} className={s.inlineImg} src={assetUrl(n.src)} alt={n.alt} loading="lazy" />;
      case "link":
        return n.external ? (
          <a key={k} className={s.link} href={n.href} target="_blank" rel="noopener noreferrer">
            {renderInline(n.c, k + ".")}
            <Icon name="external" size={12} className={s.extIcon} />
          </a>
        ) : (
          <a key={k} className={s.link} href={n.href}>
            {renderInline(n.c, k + ".")}
          </a>
        );
    }
  });
}

const CALLOUT: Record<CalloutKind, { icon: IconName; label: string }> = {
  tip: { icon: "sparkle", label: "Tip" },
  warning: { icon: "warning", label: "Heads up" },
  note: { icon: "info", label: "Note" },
};

function CodeBlock({ lang, value }: { lang?: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy", { detail: "Select the text and copy it by hand." });
    }
  };
  return (
    <div className={s.pre}>
      <div className={s.preBar}>
        <span className={s.preLang}>{lang || "text"}</span>
        <button type="button" className={s.copy} onClick={() => void copy()} data-print-hide>
          <Icon name={copied ? "check" : "copy"} size={13} /> {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{value}</code>
      </pre>
    </div>
  );
}

const alignStyle = (a: Align) => (a ? { textAlign: a } : undefined);

/** One list item: a lone paragraph renders inline (tight list), anything else as blocks. */
function ListItem({ blocks, k }: { blocks: Block[]; k: string }) {
  if (blocks.length === 1 && blocks[0].t === "para") return <li>{renderInline(blocks[0].c, k)}</li>;
  if (blocks.length >= 1 && blocks[0].t === "para")
    return (
      <li>
        {renderInline(blocks[0].c, k)}
        {renderBlocks(blocks.slice(1), k + "b")}
      </li>
    );
  return <li>{renderBlocks(blocks, k)}</li>;
}

function renderBlocks(blocks: Block[], key = ""): ReactNode[] {
  return blocks.map((b, i) => {
    const k = `${key}${i}.`;
    switch (b.t) {
      case "heading": {
        const H = `h${b.level}` as "h1";
        return (
          <H key={k} id={b.id} className={s[`h${b.level}`]} data-heading-id={b.id}>
            {renderInline(b.c, k)}
          </H>
        );
      }
      case "para":
        // A paragraph that is only an image becomes a figure with its alt text as the caption.
        if (b.c.length === 1 && b.c[0].t === "img") {
          const img = b.c[0];
          return (
            <figure key={k} className={s.figure}>
              <img src={assetUrl(img.src)} alt={img.alt} loading="lazy" />
              {img.alt && <figcaption>{img.alt}</figcaption>}
            </figure>
          );
        }
        return (
          <p key={k} className={s.p}>
            {renderInline(b.c, k)}
          </p>
        );
      case "list": {
        const items = b.items.map((it, j) => <ListItem key={j} blocks={it} k={`${k}${j}.`} />);
        return b.ordered ? (
          <ol key={k} className={s.list} start={b.start === 1 ? undefined : b.start}>
            {items}
          </ol>
        ) : (
          <ul key={k} className={s.list}>
            {items}
          </ul>
        );
      }
      case "code":
        return <CodeBlock key={k} lang={b.lang} value={b.v} />;
      case "table":
        return (
          <div key={k} className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  {b.head.map((c, j) => (
                    <th key={j} style={alignStyle(b.align[j])}>
                      {renderInline(c, `${k}h${j}.`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((c, j) => (
                      <td key={j} style={alignStyle(b.align[j])}>
                        {renderInline(c, `${k}${r}.${j}.`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "callout": {
        const c = CALLOUT[b.kind];
        return (
          <aside key={k} className={cx(s.callout, s[b.kind])} role="note">
            <div className={s.calloutHead}>
              <Icon name={c.icon} size={15} />
              <span>{b.title ?? c.label}</span>
            </div>
            <div className={s.calloutBody}>{renderBlocks(b.c, k)}</div>
          </aside>
        );
      }
      case "quote":
        return (
          <blockquote key={k} className={s.quote}>
            {renderBlocks(b.c, k)}
          </blockquote>
        );
      case "hr":
        return <hr key={k} className={s.hr} />;
    }
  });
}

/** A parsed guide document. */
export function Markdown({ doc, className }: { doc: ParsedDoc; className?: string }) {
  return <div className={cx(s.md, className)}>{renderBlocks(doc.blocks)}</div>;
}
