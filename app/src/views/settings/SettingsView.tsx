// Settings (#/settings[/audibles|/editor|/data]), plus two developer pages reached from Data: the component gallery
// (#/settings/gallery) and the play-art bench (#/settings/art). Mouse first: every setting is a visible control.
import { useEffect, useState } from "react";
import { getStatus, type ServerStatus } from "../../api/client";
import { ArtGallery } from "../../field/ArtGallery";
import { AudibleStyleSwitch, audibleStyleName } from "../../input/AudibleStyleSwitch";
import { Glyph, KeyCap } from "../../input/glyphs";
import { AUDIBLE_CATEGORY, AUDIBLE_KEYS, AUDIBLE_SLOTS, BUTTON_DIAMOND, DEFAULT_AUDIBLE_BUTTONS, type PadButton } from "../../model/audibles";
import type { AudibleSlot } from "../../model/types";
import { lastMainHash, navigate, useRoute } from "../../state/router";
import { useSettings, type BallSpot } from "../../state/settings";
import { useWorkspace } from "../../state/workspace";
import { useStorage } from "../../storage";
import {
  Button,
  FormRow,
  MenuButton,
  Panel,
  Segmented,
  Spinner,
  TabBar,
  Tag,
  TextInput,
  Toggle,
  confirmDialog,
  toast,
  useHelpTopic,
  type TabItem,
} from "../../ui";
import { UiGallery } from "./UiGallery";
import s from "./SettingsView.module.css";

type Section = "audibles" | "editor" | "data";

const SECTIONS: TabItem<Section>[] = [
  { id: "audibles", label: "Audibles" },
  { id: "editor", label: "Editor" },
  { id: "data", label: "Files & data" },
];

const SECTION_HELP: Record<Section, string> = { audibles: "audibles", editor: "getting-started", data: "hosting" };

export function SettingsView() {
  const route = useRoute();
  if (route.parts[0] === "gallery") return <UiGallery />;
  if (route.parts[0] === "art") return <ArtGallery />;
  // v1 links: #/settings/controls → Audibles.
  const section: Section = SECTIONS.some((t) => t.id === route.parts[0]) ? (route.parts[0] as Section) : "audibles";
  return <SettingsPage section={section} />;
}

function SettingsPage({ section }: { section: Section }) {
  const go = (id: Section) => navigate(id === "audibles" ? "#/settings" : `#/settings/${id}`, { replace: true });
  // The top bar's "?" opens the guide section for this settings page.
  useHelpTopic(SECTION_HELP[section]);

  return (
    <div className={s.page}>
      <div className={s.inner}>
        <header className={s.header}>
          <div>
            <div className={s.eyebrow}>Playbook Studio</div>
            <h1 className={s.title}>Settings</h1>
          </div>
          <div className={s.sectionTabs}>
            <TabBar items={SECTIONS} active={section} onChange={go} size="sm" aria-label="Settings sections" />
          </div>
          <Button variant="secondary" icon="check" onClick={() => navigate(lastMainHash())}>
            Done
          </Button>
        </header>
        {section === "audibles" && <AudiblesSection />}
        {section === "editor" && <EditorSection />}
        {section === "data" && <DataSection />}
      </div>
    </div>
  );
}

// ─────────────────────────────── audibles ───────────────────────────────

const DIAMOND_ORDER: PadButton[] = ["Y", "X", "B", "A"];

function AudiblesSection() {
  const style = useSettings((st) => st.audibleStyle);
  const buttons = useSettings((st) => st.audibleButtons);
  const isDefault = AUDIBLE_SLOTS.every((sl) => buttons[sl] === DEFAULT_AUDIBLE_BUTTONS[sl]);
  // The diamond is a controller picture; the keyboard style labels it with Xbox buttons plus the slot's key.
  const padStyle = style === "keyboard" ? "xbox" : style;

  const slotOn = (b: PadButton) => AUDIBLE_SLOTS.find((sl) => buttons[sl] === b);
  // Assigning a slot to a button swaps with whichever button had it, so the mapping stays one-to-one.
  const assign = (button: PadButton, slot: AudibleSlot) => {
    const next = { ...buttons };
    const prevSlot = slotOn(button);
    const prevButton = next[slot];
    next[slot] = button;
    if (prevSlot !== undefined && prevSlot !== slot) next[prevSlot] = prevButton;
    useSettings.getState().set({ audibleButtons: next });
  };

  return (
    <div className={s.stack}>
      <Panel eyebrow="Audibles" title="Button style" scroll={false}>
        <div className={s.styleRow}>
          <AudibleStyleSwitch size="md" />
          <div className={s.stylePreview} aria-label="Preview">
            {AUDIBLE_SLOTS.map((sl) => (
              <span key={sl} className={s.previewSlot}>
                <Glyph button={buttons[sl]} keys={[AUDIBLE_KEYS[sl]]} mode={style} size="md" />
                <span>{AUDIBLE_CATEGORY[sl]}</span>
              </span>
            ))}
          </div>
        </div>
        <p className={s.note}>
          How the four audible slots are drawn in the playbook builder and the play-call preview — pick the controller you play Madden with. Only the look changes;
          the playbook file is the same. The app itself is used with a keyboard and mouse.
        </p>
      </Panel>

      <Panel
        eyebrow="Audibles"
        title="Which button is which slot"
        scroll={false}
        actions={
          <Button size="sm" variant="ghost" icon="refresh" disabled={isDefault} onClick={() => useSettings.getState().resetAudibleButtons()}>
            Reset to default
          </Button>
        }
      >
        <div className={s.audibleLayout}>
          <div className={s.diamond}>
            {DIAMOND_ORDER.map((b) => {
              const slot = slotOn(b);
              return (
                <div key={b} className={s.diamondCell} data-pos={BUTTON_DIAMOND[b]}>
                  <span className={s.diamondGlyphs}>
                    <Glyph button={b} mode={padStyle} size="lg" />
                    {style === "keyboard" && slot && <KeyCap label={AUDIBLE_KEYS[slot]} size="lg" />}
                  </span>
                  <div className={s.diamondCat}>{slot ? AUDIBLE_CATEGORY[slot] : "—"}</div>
                  <MenuButton
                    size="sm"
                    block
                    aria-label={`Audible slot on ${b}`}
                    menuInitialId={slot ? String(slot) : undefined}
                    items={AUDIBLE_SLOTS.map((sl) => ({
                      id: String(sl),
                      label: `Slot ${sl} · ${AUDIBLE_CATEGORY[sl]}`,
                      checked: sl === slot,
                      onSelect: () => assign(b, sl),
                    }))}
                  >
                    {slot ? `Slot ${slot}` : "None"}
                  </MenuButton>
                </div>
              );
            })}
            <div className={s.diamondCenter}>{audibleStyleName(style)}</div>
          </div>
          <div className={s.audibleNotes}>
            <p className={s.note}>
              Each set in a playbook has four audible slots. Madden usually puts <b>1 Quick Pass</b> on □ / X, <b>2 Run</b> on ✕ / A, <b>3 Deep Pass</b> on △ / Y
              and <b>4 Play Action</b> on ○ / B.
            </p>
            <p className={s.note}>
              That hasn't been confirmed in Madden 27 yet. If your game shows them on other buttons, change them here — choosing a slot that another button had swaps
              the two.
            </p>
            {style === "keyboard" && <p className={s.note}>The keyboard style shows each slot's number key (1–4).</p>}
          </div>
        </div>
      </Panel>
    </div>
  );
}

// ─────────────────────────────── editor ───────────────────────────────

const PREFIX_RE = /^[A-Za-z0-9_]*$/;

function prefixError(v: string): string | undefined {
  if (!PREFIX_RE.test(v)) return "Only letters, digits and _ (asset names are [A-Za-z0-9_]).";
  if (v.length > 16) return "Keep it to 16 characters or fewer.";
  if (/^[0-9]/.test(v)) return "Start with a letter or _.";
  return undefined;
}

function EditorSection() {
  const st = useSettings();
  const [prefix, setPrefix] = useState(st.assetPrefix);
  const error = prefixError(prefix);
  const set = useSettings.getState().set;

  return (
    <div className={s.stack}>
      <Panel eyebrow="Editor" title="Field & lists" scroll={false}>
        <div className={s.rows}>
          <FormRow inline label="Ball spot" hint="Which hash the ball sits on in play diagrams. Only changes the picture.">
            <Segmented<BallSpot>
              options={[
                { value: "left", label: "Left hash" },
                { value: "middle", label: "Middle" },
                { value: "right", label: "Right hash" },
              ]}
              value={st.ballSpot}
              onChange={(v) => set({ ballSpot: v })}
              aria-label="Ball spot"
            />
          </FormRow>
          <FormRow inline label="Show pass protection" hint="Draw the offensive line's pass blocks in large diagrams (play cards always hide them).">
            <Toggle checked={st.showPassPro} onChange={(v) => set({ showPassPro: v })} aria-label="Show pass protection" />
          </FormRow>
          <FormRow inline label="Hide minigame formations" hint="Leave out drill and minigame formations (MG_, ST_, NST_, skeleton…) in lists and pickers.">
            <Toggle checked={st.hideMinigames} onChange={(v) => set({ hideMinigames: v })} aria-label="Hide minigame formations" />
          </FormRow>
        </div>
      </Panel>
      <Panel eyebrow="Editor" title="Naming" scroll={false}>
        <FormRow
          inline
          label="Name prefix"
          hint={
            <>
              Added to the internal names of your custom plays and routes so they never clash with the game's, e.g.{" "}
              <code className={s.code}>{(error ? st.assetPrefix : prefix) || ""}Y_Trips_Snag</code>. You rarely need to change it.
            </>
          }
          error={error}
        >
          <TextInput
            value={prefix}
            mono
            invalid={!!error}
            onChange={(v) => {
              setPrefix(v);
              if (!prefixError(v)) set({ assetPrefix: v });
            }}
            onBlur={() => error && setPrefix(st.assetPrefix)}
            wrapperClassName={s.prefixInput}
            aria-label="Name prefix"
          />
        </FormRow>
      </Panel>
    </div>
  );
}

// ─────────────────────────────── data ───────────────────────────────

const fmtMB = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fmtDate = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function StoragePanel() {
  const storage = useStorage();
  const [busy, setBusy] = useState(false);
  const folder = storage.kind === "folder";

  const run = async (what: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await what();
    } catch (e) {
      toast.error("Couldn't change the folder", { detail: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel eyebrow="Files & data" title="Where your files are" scroll={false}>
      <div className={s.storage}>
        <div className={s.storageIcon}>
          <Tag tone={folder ? "info" : "ok"}>{folder ? "Folder in this browser" : "Local server"}</Tag>
        </div>
        <div className={s.storageText}>
          <code className={s.code}>{storage.label || "—"}</code>
          <p className={s.note}>
            {folder
              ? "Folder mode (the hosted app): the browser reads the play library from this folder on this computer and saves your playbooks straight into it. Nothing is uploaded."
              : "Local server mode (npm run dev / npm start): the server reads and writes the 2026 Playbook folder it was started in. To work on another copy, run the app from that copy or use the hosted app."}
          </p>
        </div>
        {storage.canSwitch && (
          <div className={s.storageActions}>
            <Button
              size="sm"
              icon="folder"
              loading={busy}
              onClick={() => void run(() => storage.switchFolder())}
              title="Pick another copy of the 2026 Playbook folder (save your changes first). The app reloads on it."
            >
              Change folder…
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void run(() => storage.forgetFolder())}
              title="Forget this folder in this browser and go back to the start screen. Your files stay where they are."
            >
              Close folder
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}

function DataSection() {
  const favorites = useSettings((st) => st.favorites.length);
  const recents = useSettings((st) => st.recents.length);
  const files = useWorkspace((st) => st.files.length);
  const dirty = useWorkspace((st) => Object.values(st.docs).filter((d) => d.dirty).length);
  const [status, setStatus] = useState<{ loading: boolean; data?: ServerStatus; error?: string }>({ loading: true });
  const [refreshing, setRefreshing] = useState(false);
  const [devOpen, setDevOpen] = useState(false);

  const load = () => {
    setStatus((o) => ({ ...o, loading: true }));
    getStatus().then(
      (data) => setStatus({ loading: false, data }),
      (e: unknown) => setStatus({ loading: false, error: errMsg(e) }),
    );
  };
  useEffect(load, []);

  const clear = async (what: "favorites" | "recents", count: number) => {
    if (!count) return;
    const ok = await confirmDialog({
      title: `Clear ${what}?`,
      body: `Removes ${count} ${what === "favorites" ? "favorite" : "recent"} play${count > 1 ? "s" : ""}. Nothing in playbooks/ changes.`,
      confirmLabel: "Clear",
      danger: true,
    });
    if (ok) {
      useSettings.getState().set({ [what]: [] });
      toast.success(`Cleared ${what}`);
    }
  };

  const reloadFiles = async () => {
    setRefreshing(true);
    try {
      await useWorkspace.getState().refresh();
      toast.success("Files reloaded", { detail: "Changed files on disk were picked up; unsaved edits were kept." });
    } catch (e) {
      toast.error("Reload failed", { detail: errMsg(e) });
    } finally {
      setRefreshing(false);
    }
  };

  const resetPrefs = async () => {
    const ok = await confirmDialog({
      title: "Reset all preferences?",
      body: "Audible style and buttons, name prefix, field options, favorites and recents go back to defaults. Your files are untouched.",
      confirmLabel: "Reset",
      danger: true,
    });
    if (ok) {
      useSettings.setState(useSettings.getInitialState(), true);
      toast.success("Preferences reset");
    }
  };

  const d = status.data;
  return (
    <div className={s.stack}>
      <StoragePanel />
      <div className={s.twoCol}>
        <Panel eyebrow="Files & data" title="Workspace" scroll={false}>
          <div className={s.rows}>
            <FormRow inline label={`Files · ${files}`} hint="Playbooks, custom plays, custom sets and app data.">
              <Button size="sm" variant="ghost" icon="refresh" loading={refreshing} onClick={() => void reloadFiles()}>
                Reload from disk
              </Button>
            </FormRow>
            <FormRow inline label="Unsaved files" hint={dirty ? "Save with ⌘/Ctrl+S (this file) or Shift+⌘/Ctrl+S (all files)." : "Everything is saved."}>
              {dirty ? <Tag tone="needsMod">{dirty} unsaved</Tag> : <Tag tone="ok">All saved</Tag>}
            </FormRow>
          </div>
        </Panel>
        <Panel eyebrow="Files & data" title="Your lists" scroll={false}>
          <div className={s.rows}>
            <FormRow inline label={`Favorites · ${favorites}`} hint="Starred plays (kept in this browser).">
              <Button size="sm" variant="ghost" icon="trash" disabled={!favorites} onClick={() => void clear("favorites", favorites)}>
                Clear
              </Button>
            </FormRow>
            <FormRow inline label={`Recents · ${recents}`} hint="Recently opened plays (last 60).">
              <Button size="sm" variant="ghost" icon="trash" disabled={!recents} onClick={() => void clear("recents", recents)}>
                Clear
              </Button>
            </FormRow>
            <FormRow inline label="Preferences" hint="Everything on these settings pages, kept in this browser.">
              <Button size="sm" variant="ghost" icon="refresh" onClick={() => void resetPrefs()}>
                Reset all
              </Button>
            </FormRow>
          </div>
        </Panel>
      </div>

      <Panel
        eyebrow="Files & data"
        title="Play library"
        scroll={false}
        actions={
          <Button size="sm" variant="ghost" icon="refresh" loading={status.loading} onClick={load}>
            Check again
          </Button>
        }
      >
        {status.loading && !d ? (
          <div className={s.inline}>
            <Spinner /> Checking the files…
          </div>
        ) : status.error ? (
          <div className={s.serverError}>
            <Tag tone="danger">Not reachable</Tag>
            <span>Couldn't read the files: {status.error}</span>
          </div>
        ) : d ? (
          <div className={s.server}>
            <div className={s.inline}>
              <Tag tone={d.hasLibrary ? "ok" : "danger"}>{d.hasLibrary ? "Library found" : "Library missing"}</Tag>
              <span className={s.dim}>data/library in</span>
              <code className={s.code}>{d.root}</code>
            </div>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>File</th>
                  <th className={s.num}>Size</th>
                  <th>Modified</th>
                </tr>
              </thead>
              <tbody>
                {d.library.map((f) => (
                  <tr key={f.name}>
                    <td className={s.mono}>{f.name}</td>
                    <td className={s.num}>{fmtMB(f.size)}</td>
                    <td className={s.dim}>{fmtDate(f.mtime)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>

      <div className={s.advanced}>
        <Button variant="ghost" size="sm" icon={devOpen ? "chevronDown" : "chevronRight"} onClick={() => setDevOpen((o) => !o)} aria-expanded={devOpen}>
          Advanced: developer pages
        </Button>
        {devOpen && (
          <div className={s.advancedBody}>
            <Button size="sm" icon="field" onClick={() => navigate("#/settings/art")}>
              Play-art bench
            </Button>
            <Button size="sm" icon="grid" onClick={() => navigate("#/settings/gallery")}>
              Component gallery
            </Button>
            <span className={s.dim}>Test pages for checking play drawings and UI pieces.</span>
          </div>
        )}
      </div>
    </div>
  );
}
