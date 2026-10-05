// Component gallery (#/settings/gallery, a developer page): every UI-kit component, plus the audible glyphs in all
// three audible styles and the keyboard keycaps.
import { useMemo, useState, type ReactNode } from "react";
import { AudibleStyleSwitch } from "../../input/AudibleStyleSwitch";
import { AudibleGlyph, Glyph } from "../../input/glyphs";
import type { InputMode } from "../../input/inputMode";
import { FACE_BUTTONS, padButtonName } from "../../input/keys";
import { PLAY_FAMILIES, familyLabel } from "../../model/playtypes";
import { navigate } from "../../state/router";
import {
  Button,
  Checkbox,
  Chip,
  Divider,
  EmptyState,
  FormRow,
  HelpLink,
  ICON_NAMES,
  Icon,
  IconButton,
  Kbd,
  MenuButton,
  Modal,
  NeedsModTag,
  NumberField,
  Panel,
  PlayTypeTag,
  ProgressBar,
  ScrollShadow,
  SearchSelect,
  Segmented,
  Select,
  Slider,
  Spacer,
  Spinner,
  SplitPane,
  TabBar,
  Tag,
  TextArea,
  TextInput,
  Toggle,
  Toolbar,
  Tooltip,
  VirtualGrid,
  VirtualList,
  confirmDialog,
  promptDialog,
  toast,
  useContextMenu,
  type MenuItem,
  type TagTone,
} from "../../ui";
import s from "./UiGallery.module.css";

const MODES: { mode: InputMode; label: string }[] = [
  { mode: "xbox", label: "Xbox" },
  { mode: "ps", label: "PS5" },
  { mode: "keyboard", label: "Keyboard" },
];

const COMBOS = ["mod+z", "shift+mod+z", "mod+y", "mod+s", "shift+mod+s", "Enter", "Escape", "Delete", "Backspace", "ArrowUp", "PageUp"];

const SAMPLE_TYPES = [
  "OffensePlayType_PassStandard",
  "OffensePlayType_RunInsideZone",
  "OffensePlayType_PlayActionPass",
  "OffensePlayType_Screen",
  "OffensePlayType_RPO_Alert",
  "OffensePlayType_OptionTriple",
  "OffensePlayType_Punt",
  "DefensePlayType_Cover3",
];

const TONES: TagTone[] = ["needsMod", "custom", "neutral", "ok", "warning", "danger", "info"];
const TONE_LABEL: Partial<Record<TagTone, string>> = { needsMod: "Needs Mod", ok: "OK" };

/** "solid" → "Solid" (row labels and demo buttons show enum-ish values in Title Case). */
const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);
const SIZE_LABEL = { sm: "Small", md: "Medium", lg: "Large" } as const;

function Section({ title, eyebrow, children, actions }: { title: string; eyebrow?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <Panel eyebrow={eyebrow ?? "Gallery"} title={title} scroll={false} actions={actions}>
      {children}
    </Panel>
  );
}

function Row({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className={s.row}>
      {label && <div className={s.rowLabel}>{label}</div>}
      <div className={s.rowItems}>{children}</div>
    </div>
  );
}

export function UiGallery() {
  const [modal, setModal] = useState(false);
  const back = () => navigate("#/settings/data");

  return (
    <div className={s.page}>
      <div className={s.inner}>
        <header className={s.header}>
          <Button variant="ghost" icon="chevronLeft" onClick={back}>
            Settings
          </Button>
          <div>
            <div className={s.eyebrow}>Playbook Studio · UI Kit</div>
            <h1 className={s.title}>Component Gallery</h1>
          </div>
        </header>
        <div className={s.stack}>
          <GlyphSection />
          <ButtonSection />
          <TabsSection />
          <TagSection />
          <FormSection />
          <OverlaySection openModal={() => setModal(true)} />
          <ListSection />
          <LayoutSection />
          <IconSection />
        </div>
      </div>
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        eyebrow="Modal"
        title="Rename Play"
        onConfirm={() => {
          setModal(false);
          toast.success("Confirmed");
        }}
        confirmLabel="Rename"
      >
        <p style={{ margin: 0, color: "var(--text-2)" }}>
          Modals block the keys of everything below them: Enter confirms, Esc cancels, and the buttons do the same with the mouse.
        </p>
        <FormRow label="Name">
          <TextInput value="Y Trips Snag" onChange={() => {}} />
        </FormRow>
      </Modal>
    </div>
  );
}

// ─────────────────────────────── glyphs ───────────────────────────────

function GlyphSection() {
  return (
    <Section title="Audible Glyphs & Keycaps" eyebrow="Input" actions={<AudibleStyleSwitch />}>
      <table className={s.glyphTable}>
        <thead>
          <tr>
            <th>Button</th>
            {MODES.map((m) => (
              <th key={m.mode}>{m.label}</th>
            ))}
            <th>Names</th>
          </tr>
        </thead>
        <tbody>
          {FACE_BUTTONS.map((b) => (
            <tr key={b}>
              <td className={s.mono}>{b}</td>
              {MODES.map((m) => (
                <td key={m.mode}>
                  <span className={s.sizes}>
                    <Glyph button={b} mode={m.mode} size="sm" />
                    <Glyph button={b} mode={m.mode} size="md" />
                    <Glyph button={b} mode={m.mode} size="lg" />
                  </span>
                </td>
              ))}
              <td className={s.dim}>
                {padButtonName(b, "xbox")} · {padButtonName(b, "ps")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Divider label="Audible Slots (Settings → Audibles Decides the Button per Slot)" />
      {MODES.map((m) => (
        <Row key={m.mode} label={m.label}>
          {([1, 2, 3, 4] as const).map((slot) => (
            <AudibleGlyph key={slot} slot={slot} mode={m.mode} size="lg" />
          ))}
        </Row>
      ))}
      <Row label="Your Style">
        {([1, 2, 3, 4] as const).map((slot) => (
          <AudibleGlyph key={slot} slot={slot} size="lg" />
        ))}
        <span className={s.dim}>(no `mode`: follows the audible style switch)</span>
      </Row>
      <Divider label="Keycaps (Platform-Aware; Only Universal Keys)" />
      <Row>
        {COMBOS.map((c) => (
          <Glyph key={c} keys={[c]} size="md" />
        ))}
      </Row>
      <Row label="Help Links">
        <HelpLink section="routes" />
        <HelpLink section="routes" label="How Cuts Work" />
      </Row>
    </Section>
  );
}

// ─────────────────────────────── buttons ───────────────────────────────

function ButtonSection() {
  const variants = ["primary", "secondary", "ghost", "danger"] as const;
  const [loading, setLoading] = useState(false);
  return (
    <Section title="Buttons">
      {(["sm", "md", "lg"] as const).map((size) => (
        <Row key={size} label={SIZE_LABEL[size]}>
          {variants.map((v) => (
            <Button key={v} variant={v} size={size}>
              {cap(v)}
            </Button>
          ))}
          <Button size={size} icon="plus">
            With Icon
          </Button>
          <Button size={size} variant="primary" icon="check">
            Select
          </Button>
          <Button size={size} iconRight="chevronRight">
            Next
          </Button>
        </Row>
      ))}
      <Row label="States">
        <Button disabled>Disabled</Button>
        <Button variant="primary" disabled>
          Disabled
        </Button>
        <Button
          variant="primary"
          loading={loading}
          onClick={() => {
            setLoading(true);
            window.setTimeout(() => setLoading(false), 1500);
          }}
        >
          Click to Load
        </Button>
        <Button active>Active</Button>
        <Button variant="secondary" icon="duplicate">
          Duplicate
        </Button>
      </Row>
      <Row label="Icon Buttons">
        {(["undo", "redo", "save", "copy", "paste", "trash", "flip", "eye", "star", "gear"] as const).map((i) => (
          <IconButton key={i} icon={i} title={cap(i)} shortcut={i === "undo" ? { keys: ["mod+z"] } : i === "save" ? { keys: ["mod+s"] } : undefined} />
        ))}
        <IconButton icon="plus" title="Secondary" variant="secondary" />
        <IconButton icon="check" title="Primary" variant="primary" />
        <IconButton icon="trash" title="Danger" variant="danger" />
        <IconButton icon="star" title="Active" active />
        <IconButton icon="lock" title="Small" size="sm" />
        <IconButton icon="lock" title="Large" size="lg" />
      </Row>
    </Section>
  );
}

// ─────────────────────────────── tabs ───────────────────────────────

function TabsSection() {
  const [big, setBig] = useState("formation");
  const [small, setSmall] = useState("routes");
  return (
    <Section title="Tab Bars">
      <div className={s.tabsDemo}>
        <TabBar
          items={[
            { id: "suggest", label: "Coach Suggestions" },
            { id: "formation", label: "Formation" },
            { id: "concept", label: "Concept" },
            { id: "type", label: "Play Type" },
            { id: "custom", label: "Custom", badge: 6 },
            { id: "set", label: "Y Trips Wk", caps: true, title: "caps: a Madden name as the label" },
            { id: "off", label: "Disabled", disabled: true },
          ]}
          active={big}
          onChange={setBig}
        />
      </div>
      <Row label="Small">
        <TabBar
          size="sm"
          items={[
            { id: "routes", label: "Routes", icon: "route" },
            { id: "blocks", label: "Blocks", icon: "block" },
            { id: "motion", label: "Motion", icon: "motion" },
            { id: "steps", label: "Steps", icon: "list" },
          ]}
          active={small}
          onChange={setSmall}
        />
      </Row>
    </Section>
  );
}

// ─────────────────────────────── tags ───────────────────────────────

function TagSection() {
  const [chips, setChips] = useState(["Shotgun", "Mesh", "3rd & Medium"]);
  const [on, setOn] = useState<Record<string, boolean>>({ pass: true });
  return (
    <Section title="Tags & Chips">
      {(["solid", "soft", "outline"] as const).map((variant) => (
        <Row key={variant} label={cap(variant)}>
          {PLAY_FAMILIES.map((f) => (
            <Tag key={f} tone={f} variant={variant}>
              {familyLabel(f)}
            </Tag>
          ))}
          {TONES.map((t) => (
            <Tag key={t} tone={t} variant={variant}>
              {TONE_LABEL[t] ?? cap(t)}
            </Tag>
          ))}
        </Row>
      ))}
      <Row label="Helpers">
        {SAMPLE_TYPES.map((t) => (
          <PlayTypeTag key={t} playType={t} />
        ))}
        <NeedsModTag />
        <Tag tone="custom" size="sm" icon="sparkle">
          Custom
        </Tag>
        <Tag color="var(--art-route)" variant="soft">
          Any Color
        </Tag>
        <Tag tone="neutral" variant="outline" caps title="caps: a Madden name">
          Gun Bunch
        </Tag>
      </Row>
      <Row label="Chips">
        {chips.map((c) => (
          <Chip key={c} onRemove={() => setChips(chips.filter((x) => x !== c))}>
            {c}
          </Chip>
        ))}
        {["pass", "run", "screen"].map((f) => (
          <Chip key={f} caps active={!!on[f]} onClick={() => setOn({ ...on, [f]: !on[f] })} count={f === "pass" ? 412 : 233} color={`var(--${f === "pass" ? "blue" : f === "run" ? "red" : "teal"})`}>
            {f}
          </Chip>
        ))}
        <Chip icon="filter" disabled>
          Disabled
        </Chip>
        {chips.length < 3 && (
          <Button size="sm" variant="ghost" onClick={() => setChips(["Shotgun", "Mesh", "3rd & Medium"])}>
            Reset
          </Button>
        )}
      </Row>
    </Section>
  );
}

// ─────────────────────────────── forms ───────────────────────────────

function FormSection() {
  const [text, setText] = useState("Y Trips Snag");
  const [search, setSearch] = useState("");
  const [area, setArea] = useState("Notes about this play…\nSecond line");
  const [dist, setDist] = useState<number>(7.5);
  const [dir, setDir] = useState<number>(90);
  const [pct, setPct] = useState<number>(100);
  const [sel, setSel] = useState("Normal");
  const [enumVal, setEnumVal] = useState<string>("ReceiverCutAngle_Curl");
  const [asg, setAsg] = useState<string | undefined>(undefined);
  const [tog, setTog] = useState(true);
  const [chk, setChk] = useState(false);
  const [seg, setSeg] = useState("middle");
  const [weight, setWeight] = useState(60);

  const enumOptions = useMemo(
    () => ["Curl", "Hitch", "Post", "Corner", "Out", "In", "Slant", "Comeback", "Flat", "Wheel", "Dig", "Whip", "Sit", "Zig", "Stutter"].map((c) => `ReceiverCutAngle_${c}`),
    [],
  );
  const assignmentOptions = useMemo(
    () =>
      Array.from({ length: 5000 }, (_, i) => {
        const kinds = ["Slant", "Curl", "Post", "Flat", "Drag", "Wheel", "Block", "Corner", "Out", "Go"];
        const k = kinds[i % kinds.length];
        return { value: `RunRoute/WR_${k}_${i}`, label: `WR_${k}_${i}`, hint: k.toUpperCase() };
      }),
    [],
  );

  return (
    <Section title="Form Controls">
      <div className={s.formGrid}>
        <FormRow label="Text Input" hint="Icon, clear button, Esc clears">
          <TextInput value={search} onChange={setSearch} icon="search" clearable placeholder="Search plays…" />
        </FormRow>
        <FormRow label="Invalid + Mono" error="Only [A-Za-z0-9_]">
          <TextInput value={text} onChange={setText} mono invalid suffix="leaf" />
        </FormRow>
        <FormRow label="Number Fields" hint="Drag the label to scrub · arrows step · Shift ×10">
          <div className={s.inlineRow}>
            <NumberField label="Dist" value={dist} onChange={setDist} step={0.5} min={0} max={100} suffix="yd" width={130} />
            <NumberField label="Dir" value={dir} onChange={setDir} step={5} min={0} max={359} suffix="°" width={120} />
            <NumberField value={pct} onChange={setPct} min={0} max={100} suffix="%" width={96} size="sm" />
          </div>
        </FormRow>
        <FormRow label="Select (Native)">
          <Select value={sel} onChange={setSel} options={["Normal", "M1left", "M1right", { value: "SM5right", label: "SM5 Right (Shift)" }]} />
        </FormRow>
        <FormRow label="Search Select · Enum">
          <SearchSelect value={enumVal} onChange={setEnumVal} options={enumOptions} />
        </FormRow>
        <FormRow label="Search Select · 5,000 Assignments" hint="Virtualized; type to filter, click or ↑/↓ + Enter">
          <SearchSelect value={asg} onChange={setAsg} options={assignmentOptions} placeholder="Pick an assignment…" allowCustom />
        </FormRow>
        <FormRow label="Text Area">
          <TextArea value={area} onChange={setArea} autoGrow rows={2} />
        </FormRow>
        <FormRow label="Toggle · Checkbox">
          <div className={s.inlineRow}>
            <Toggle checked={tog} onChange={setTog} label="Show Pass Pro" />
            <Checkbox checked={chk} onChange={setChk} label="Global Only" />
            <Checkbox checked={false} indeterminate onChange={() => {}} label="Mixed" />
          </div>
        </FormRow>
        <FormRow label="Segmented">
          <Segmented
            value={seg}
            onChange={setSeg}
            options={[
              { value: "left", label: "Left Hash" },
              { value: "middle", label: "Middle" },
              { value: "right", label: "Right Hash" },
            ]}
          />
        </FormRow>
        <FormRow label="Slider · CPU Weight">
          <Slider value={weight} onChange={setWeight} aria-label="Weight" />
        </FormRow>
      </div>
      <Divider label="Inline Rows (Settings Style)" />
      <FormRow inline label="Hide Minigame Formations" hint="FormRow with `inline`">
        <Toggle checked={tog} onChange={setTog} />
      </FormRow>
    </Section>
  );
}

// ─────────────────────────────── overlays ───────────────────────────────

const MENU: MenuItem[] = [
  { kind: "heading", label: "Play" },
  { label: "Open in Designer", icon: "route", onSelect: () => toast.info("Open") },
  { label: "Duplicate", icon: "duplicate", shortcut: "mod+d", onSelect: () => toast.info("Duplicate") },
  { label: "Copy", icon: "copy", shortcut: "mod+c", onSelect: () => toast.info("Copy") },
  { label: "Favorite", icon: "star", checked: true, onSelect: () => toast.info("Favorite") },
  {
    label: "Add to Audible",
    icon: "playcall",
    submenu: [
      { label: "Quick Pass", icon: <AudibleGlyph slot={1} size="sm" />, onSelect: () => toast.info("Slot 1") },
      { label: "Run", icon: <AudibleGlyph slot={2} size="sm" />, onSelect: () => toast.info("Slot 2") },
      { label: "Deep Pass", icon: <AudibleGlyph slot={3} size="sm" />, onSelect: () => toast.info("Slot 3") },
      { label: "Play Action", icon: <AudibleGlyph slot={4} size="sm" />, onSelect: () => toast.info("Slot 4") },
    ],
  },
  { kind: "separator" },
  { label: "Disabled Item", icon: "lock", disabled: true },
  { label: "Remove", icon: "trash", danger: true, shortcut: "Delete", onSelect: () => toast.warning("Removed") },
];

function OverlaySection({ openModal }: { openModal(): void }) {
  const cm = useContextMenu();
  return (
    <Section title="Overlays">
      <Row label="Dialogs">
        <Button variant="primary" onClick={openModal}>
          Modal
        </Button>
        <Button
          onClick={async () => {
            const ok = await confirmDialog({ title: "Delete Formation?", body: "Removes GUN TRIPS TE and its 14 plays from this playbook.", confirmLabel: "Delete", danger: true });
            toast.info(ok ? "Confirmed" : "Cancelled");
          }}
        >
          confirmDialog
        </Button>
        <Button
          onClick={async () => {
            const v = await promptDialog({
              title: "New Playbook",
              label: "Name (A–Z, 0–9)",
              initial: "STUDIOTEST",
              mono: true,
              validate: (x) => (/^[A-Z0-9]+$/.test(x) ? undefined : "Use A–Z and 0–9 only"),
            });
            toast.info(v === null ? "Cancelled" : `Created ${v}`);
          }}
        >
          promptDialog
        </Button>
      </Row>
      <Row label="Toasts">
        <Button size="sm" onClick={() => toast.info("Library Loaded", { detail: "11,055 plays · 808 sets" })}>
          Info
        </Button>
        <Button size="sm" onClick={() => toast.success("Saved", { detail: "playbooks/studio-test.json" })}>
          Success
        </Button>
        <Button size="sm" onClick={() => toast.warning("Duplicate Audible", { detail: "Slot 2 is used twice in GUN TRIPS TE" })}>
          Warning
        </Button>
        <Button
          size="sm"
          onClick={() => toast.error("Save Failed", { detail: "EACCES: permission denied", action: { label: "Retry", run: () => toast.success("Retried") } })}
        >
          Error
        </Button>
      </Row>
      <Row label="Tooltip & Menus">
        <Tooltip content="Tooltips show on hover (and keyboard focus)" shortcut={{ keys: ["mod+k"] }}>
          <Button variant="ghost" icon="info">
            Hover Me
          </Button>
        </Tooltip>
        <MenuButton items={MENU} icon="list">
          Menu
        </MenuButton>
        <div className={s.contextArea} onContextMenu={(e) => cm.open(e, MENU)}>
          Right-Click Here
        </div>
        {cm.node}
      </Row>
    </Section>
  );
}

// ─────────────────────────────── lists ───────────────────────────────

function ListSection() {
  const [sel, setSel] = useState(3);
  const [cell, setCell] = useState(0);
  return (
    <Section title="Virtual List & Grid" eyebrow="Click to Select, Double-Click to Open; Arrows Work While the List Has Focus">
      <div className={s.lists}>
        <VirtualList
          className={s.listBox}
          count={5000}
          rowHeight={30}
          selectedIndex={sel}
          onSelect={setSel}
          onActivate={(i) => toast.info(`Activated Row ${i + 1}`)}
          renderRow={(i, st) => (
            <div className={s.listRow}>
              <span className={s.mono}>{String(i + 1).padStart(4, "0")}</span>
              <span>{st.selected ? "Selected row" : `Row ${i + 1}`}</span>
              <Spacer />
              {i % 7 === 0 && <NeedsModTag size="sm" />}
            </div>
          )}
        />
        <VirtualGrid
          className={s.gridBox}
          count={2000}
          cellWidth={120}
          cellHeight={84}
          gap={10}
          stretch
          selectedIndex={cell}
          onSelect={setCell}
          onActivate={(i) => toast.info(`Activated Card ${i + 1}`)}
          renderCell={(i, st) => (
            <div className={s.card} data-selected={st.selected || undefined}>
              <span className={s.cardNum}>{i + 1}</span>
              <span className={s.cardSub}>GUN Y TRIPS</span>
            </div>
          )}
        />
      </div>
    </Section>
  );
}

// ─────────────────────────────── layout ───────────────────────────────

function LayoutSection() {
  return (
    <Section title="Layout & Feedback">
      <Toolbar>
        <Button size="sm" icon="plus">
          Add
        </Button>
        <Divider vertical />
        <IconButton icon="undo" title="Undo" size="sm" />
        <IconButton icon="redo" title="Redo" size="sm" />
        <Spacer />
        <Kbd keys={["mod+z", "shift+mod+z"]} />
      </Toolbar>
      <div className={s.splitBox}>
        <SplitPane initial={220} min={120} max={500} storageKey="pbstudio.gallery.split">
          <ScrollShadow className={s.fill}>
            <div className={s.lorem}>
              {Array.from({ length: 30 }, (_, i) => (
                <div key={i}>Scroll shadow row {i + 1}</div>
              ))}
            </div>
          </ScrollShadow>
          <SplitPane direction="vertical" initial={110} min={60} max={300} sized="end" storageKey="pbstudio.gallery.split2">
            <div className={s.paneFill}>
              <EmptyState compact icon="field" title="No Play Selected" body="Pick a play from the list to see its art." />
            </div>
            <div className={s.paneFill}>
              <Panel title="Nested Panel" eyebrow="Panel" tone="raised" actions={<IconButton icon="close" title="Close" size="sm" />}>
                Panels have an eyebrow, a title, actions and a scrolling body.
              </Panel>
            </div>
          </SplitPane>
        </SplitPane>
      </div>
      <div className={s.progressGrid}>
        <ProgressBar value={0.42} label="plays.json" detail="7.1 / 17.0 MB" />
        <ProgressBar indeterminate label="Indexing" />
        <ProgressBar value={0.9} tone="ok" label="Capacity · Plays" detail="675 / 750" />
        <ProgressBar value={1} tone="danger" label="Weight Rows" detail="2,200 / 2,200" size="sm" />
      </div>
      <Row label="Spinners">
        <Spinner size={14} />
        <Spinner size={20} />
        <Spinner size={28} />
      </Row>
      <EmptyState
        icon="folder"
        title="No Playbooks Yet"
        body="Create one from scratch or start from a stock book. Files land in playbooks/<name>.json."
        action={
          <>
            <Button variant="primary" icon="plus">
              New Playbook
            </Button>
            <Button variant="secondary">Open…</Button>
          </>
        }
      />
    </Section>
  );
}

function IconSection() {
  return (
    <Section title={`Icons · ${ICON_NAMES.length}`}>
      <div className={s.icons}>
        {ICON_NAMES.map((n) => (
          <div key={n} className={s.iconCell} title={n}>
            <span className={s.iconPair}>
              <Icon name={n} size={16} />
              <Icon name={n} size={20} />
            </span>
            <span className={s.iconName}>{n}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

