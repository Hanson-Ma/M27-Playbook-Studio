// Shared pieces of the concepts view: category chips, the swatch color picker, play thumbnails, the category
// filter bar and the playbook picker.
import { memo, useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { cardViewport, Field, PlayArtLayer } from "../../field";
import { artForPlay } from "../../model/art";
import type { Catalog } from "../../model/catalog";
import { COLOR_SWATCHES, CATEGORY_GROUPS, GROUP_LABEL, conceptIndex, isHexColor } from "../../model/concepts";
import type { ConceptCategory, ConceptsDoc, PlayArt, ResolvedPlay } from "../../model/types";
import { Chip, cx, Floating, Icon, MenuButton, Select, TextInput, type MenuItem } from "../../ui";
import { uiSet, useConceptsUi, type BookOption } from "./store";
import s from "./parts.module.css";

// ───────────────────────────── category chip ─────────────────────────────

export type ChipState = "on" | "off" | "mixed" | "suggested";

export interface CategoryChipProps {
  category: Pick<ConceptCategory, "name" | "color">;
  state?: ChipState;
  size?: "sm" | "md";
  /** Controller cursor (white ring). */
  cursor?: boolean;
  /** Nesting depth: a small leading tick per level. */
  depth?: number;
  count?: number;
  title?: string;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  /** Small × after the label (dismiss / remove). */
  onRemove?: () => void;
  removeTitle?: string;
  className?: string;
}

export const CategoryChip = memo(function CategoryChip({
  category,
  state = "on",
  size = "md",
  cursor,
  depth = 0,
  count,
  title,
  onClick,
  onRemove,
  removeTitle,
  className,
}: CategoryChipProps) {
  const color = isHexColor(String(category.color)) ? category.color : "var(--slate)";
  const style = { "--c": color } as CSSProperties;
  const label = (
    <>
      {state === "suggested" ? <Icon name="plus" size={size === "sm" ? 11 : 12} className={s.chipIcon} /> : <span className={s.chipDot} />}
      {depth > 0 && <span className={s.chipDepth}>{"›".repeat(Math.min(depth, 3))}</span>}
      <span className={s.chipLabel}>{category.name}</span>
      {count !== undefined && <span className={s.chipCount}>{count}</span>}
    </>
  );
  return (
    <span
      className={cx(s.chip, s[`chip_${state}`], s[`chip_${size}`], cursor && s.chipCursor, !onClick && s.chipStatic, className)}
      style={style}
      title={title}
      data-cursor={cursor || undefined}
    >
      {onClick ? (
        <button type="button" className={s.chipMain} onClick={onClick} aria-pressed={state === "on" ? true : state === "mixed" ? "mixed" : false} tabIndex={-1}>
          {label}
        </button>
      ) : (
        <span className={s.chipMain}>{label}</span>
      )}
      {onRemove && (
        <button
          type="button"
          className={s.chipRemove}
          title={removeTitle}
          aria-label={removeTitle ?? "Remove"}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <Icon name="close" size={10} />
        </button>
      )}
    </span>
  );
});

/** Plain color dot (legends, table rows). */
export function ColorDot({ color, size = 10 }: { color: string; size?: number }) {
  return <span className={s.dot} style={{ "--c": isHexColor(color) ? color : "var(--slate)", width: size, height: size } as CSSProperties} />;
}

// ───────────────────────────── color picker ─────────────────────────────

export function ColorPicker({ anchor, value, onPick, onClose }: { anchor: HTMLElement; value: string; onPick(color: string): void; onClose(): void }) {
  const [hex, setHex] = useState(value);
  const valid = isHexColor(hex);
  return (
    <Floating anchor={anchor} placement="bottom-start" onDismiss={onClose} zIndex={1000} className={s.picker}>
      <div className={s.pickerHead}>
        <span className={s.pickerTitle}>Color</span>
        <span className={s.pickerNow} style={{ "--c": isHexColor(value) ? value : "var(--slate)" } as CSSProperties} />
      </div>
      <div className={s.swatches}>
        {COLOR_SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            className={cx(s.swatch, c.toLowerCase() === value.toLowerCase() && s.swatchOn)}
            style={{ "--c": c } as CSSProperties}
            title={c}
            aria-label={c}
            onClick={() => {
              onPick(c);
              onClose();
            }}
          />
        ))}
      </div>
      <div className={s.pickerCustom}>
        <input
          type="color"
          className={s.native}
          value={valid ? hex : "#888888"}
          onChange={(e) => setHex(e.target.value)}
          aria-label="Custom color"
        />
        <TextInput
          size="sm"
          mono
          value={hex}
          invalid={!valid}
          onChange={setHex}
          onKeyDown={(e) => {
            if (e.key === "Enter" && valid) {
              e.preventDefault();
              onPick(hex.toLowerCase());
              onClose();
            }
          }}
          aria-label="Hex color"
          wrapperClassName={s.hexInput}
        />
        <button
          type="button"
          className={s.applyHex}
          disabled={!valid || hex.toLowerCase() === value.toLowerCase()}
          onClick={() => {
            onPick(hex.toLowerCase());
            onClose();
          }}
        >
          Apply
        </button>
      </div>
    </Floating>
  );
}

// ───────────────────────────── play thumbnail ─────────────────────────────

const EMPTY_ART: PlayArt = { players: [], paths: [], zones: [], bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 }, flipped: false };

/** Flat card art without the name block (rows). Art is computed only when the row renders (virtualized lists). */
export const PlayThumb = memo(function PlayThumb({ play, catalog, width, height }: { play: ResolvedPlay; catalog: Catalog; width: number; height: number }) {
  const art = useMemo(() => {
    try {
      return artForPlay(catalog, play);
    } catch {
      return EMPTY_ART;
    }
  }, [catalog, play]);
  return (
    <div className={s.thumb} style={{ width, height }}>
      <Field viewport={cardViewport(play.side)} fit="cover" size={{ width, height }} label={`${play.name} play art`}>
        <PlayArtLayer art={art} compact />
      </Field>
    </div>
  );
});

// ───────────────────────────── category filter ─────────────────────────────

/** Menu items to pick categories (tree order, grouped), with check marks. */
export function categoryMenuItems(doc: ConceptsDoc, isChecked: (id: string) => boolean, onSelect: (id: string) => void): MenuItem[] {
  const ix = conceptIndex(doc);
  const items: MenuItem[] = [];
  for (const g of CATEGORY_GROUPS) {
    const nodes = ix.byGroup[g];
    if (!nodes.length) continue;
    items.push({ kind: "heading", label: GROUP_LABEL[g] });
    for (const n of nodes)
      items.push({
        id: n.cat.id,
        label: (
          <span className={s.menuCat} style={{ paddingLeft: n.depth * 14 }}>
            {n.cat.name}
          </span>
        ),
        icon: <ColorDot color={n.cat.color} />,
        checked: isChecked(n.cat.id),
        onSelect: () => onSelect(n.cat.id),
      });
  }
  return items;
}

/** Category filter: menu to add categories + removable chips. Shared by every section (store.filter). */
export function CategoryFilter({ doc, extra }: { doc: ConceptsDoc; extra?: ReactNode }) {
  const filter = useConceptsUi((st) => st.filter);
  const ix = conceptIndex(doc);
  const toggle = (id: string) => {
    const cur = useConceptsUi.getState().filter;
    uiSet({ filter: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };
  const active = filter.map((id) => ix.byId.get(id)).filter((c): c is ConceptCategory => !!c);
  return (
    <div className={s.filter}>
      <MenuButton
        size="sm"
        variant={active.length ? "primary" : "secondary"}
        icon="filter"
        items={() => categoryMenuItems(doc, (id) => useConceptsUi.getState().filter.includes(id), toggle)}
        menuMinWidth={230}
      >
        {active.length ? `Category · ${active.length}` : "Category"}
      </MenuButton>
      {active.map((c) => (
        <CategoryChip key={c.id} category={c} size="sm" state="on" onRemove={() => toggle(c.id)} removeTitle={`Remove ${c.name} filter`} />
      ))}
      {active.length > 1 && (
        <Chip onClick={() => uiSet({ filter: [] })} title="Clear the category filter">
          Clear
        </Chip>
      )}
      {extra}
    </div>
  );
}

// ───────────────────────────── playbook picker ─────────────────────────────

export function BookPicker({ books, value, onChange, size = "sm" }: { books: BookOption[]; value?: string; onChange(path: string): void; size?: "sm" | "md" }) {
  const options = useMemo(() => books.map((b) => ({ value: b.path, label: b.label, disabled: !b.spec })), [books]);
  if (!books.length) return <span className={s.muted}>No playbooks in playbooks/</span>;
  return <Select size={size} value={value ?? ""} placeholder="Pick a playbook" options={options} onChange={onChange} aria-label="Playbook" wrapperClassName={s.bookPicker} />;
}
