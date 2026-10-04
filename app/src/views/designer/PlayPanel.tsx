// Left pane: the play itself — name (live uniqueness check), base play (swap within the set), primary receiver
// (red route), play type, run settings for runs; under "Advanced": the asset name, blocking / run hole for passes and
// the reads (percentages). Then the file's other plays and "Add to playbook…".
import { useMemo, useState } from "react";
import {
  assetProblem,
  baseFieldValue,
  blockingLabel,
  blockingLeaves,
  effectiveField,
  eligibleSlots,
  groupBasePlays,
  BASE_SECTION_LABEL,
  playNameProblem,
  setPlayAsset,
  setPlayField,
  setPlayName,
  slotRoleLabel,
  suggestAsset,
  swapBase,
  swapBaseLosses,
} from "../../model/designer";
import { CONCEPTS_PATH } from "../../model/conceptsDoc";
import { parseJson } from "../../model/json";
import { folder, leaf } from "../../model/names";
import { danglingPlayRefs, playKeyFor, rekeyConcepts, rekeyList, renamePlayInBook, type PlayIdentity } from "../../model/playRefs";
import { playTypeInfo } from "../../model/playtypes";
import { slotLabel } from "../../model/positions";
import type { ConceptsDoc, PlaybookSpec, PlaysFile } from "../../model/types";
import type { Catalog } from "../../model/catalog";
import { comboLabel } from "../../input/keys";
import { href, navigate } from "../../state/router";
import { useSettings } from "../../state/settings";
import { useDoc, useDocsOfKind, useWorkspace } from "../../state/workspace";
import { Button, FormRow, IconButton, SearchSelect, TextInput, confirmDialog, cx, toast } from "../../ui";
import { openAddToPlaybook } from "../library/AddToPlaybook";
import { Disclosure } from "./Disclosure";
import { HolePicker } from "./GapDiagram";
import { ReadsEditor } from "./ReadsEditor";
import { useDesigner } from "./shared";
import s from "./PlayPanel.module.css";

export function PlayPanel() {
  const d = useDesigner();
  const { state, catalog, set, file, index, prefix, lib } = d;
  const self = catalog.custom.find((p) => p.file === file && p.index === index);
  const selfKey = self?.key;

  const name = String(state.play.name ?? "");
  const asset = String(state.play.asset ?? "");
  const autoAsset = asset === suggestAsset(catalog, set.asset, name, prefix, selfKey);
  const nameErr = playNameProblem(catalog, set.asset, name, selfKey);
  const assetErr = assetProblem(catalog, set.asset, asset, selfKey);

  const baseOptions = useMemo(
    () =>
      groupBasePlays(catalog, set.asset).flatMap((g) =>
        g.plays.map((p) => ({ value: p.asset, label: p.name, hint: g.section === "pass" || g.section === "run" ? g.label : BASE_SECTION_LABEL[g.section], group: BASE_SECTION_LABEL[g.section] })),
      ),
    [catalog, set.asset],
  );

  const basePlayType = String(baseFieldValue(state, "playType") ?? "");
  const playTypeOptions = useMemo(
    () => [{ value: "", label: `Inherit · ${playTypeInfo(basePlayType).long}` }, ...lib.enumValues("OffensePlayType").filter((v) => !/_Max$|DontCare/.test(v)).map((v) => ({ value: v, label: playTypeInfo(v).long, hint: playTypeInfo(v).label }))],
    [lib, basePlayType],
  );
  const baseBlocking = String(baseFieldValue(state, "blocking") ?? "");
  const blockingOptions = useMemo(
    () => [{ value: "", label: `Inherit · ${blockingLabel(baseBlocking)}` }, ...blockingLeaves(lib).map((v) => ({ value: v, label: blockingLabel(v), hint: v }))],
    [lib, baseBlocking],
  );
  const eligible = eligibleSlots(set);
  const explicitReads = "reads" in state.play;
  const vip = effectiveField<number>(state, "vip");
  const runHole = effectiveField<number>(state, "runHole");
  const slotName = (i: number) => {
    const a = set.movements.Normal[i];
    const l = slotLabel(a.pos, a.depth);
    const r = slotRoleLabel(set, i);
    return r !== l ? `${l} · ${r}` : l;
  };

  const vipOptions = [
    ...eligible.map((i) => ({ value: String(i), label: slotName(i), hint: `slot ${i}` })),
    ...(eligible.includes(vip) ? [] : [{ value: String(vip), label: `Slot ${vip}` }]),
  ];

  const rename = (v: string) =>
    d.edit((st) => {
      let n = setPlayName(st, v);
      if (autoAsset) n = setPlayAsset(n, suggestAsset(catalog, set.asset, v, prefix, selfKey));
      return n;
    }, "Rename play", 1500);

  const changeBase = async (v: string) => {
    if (v === state.play.base) return;
    const losses = swapBaseLosses(state, catalog, v);
    const target = lib.playByAsset.get(v);
    const ok = await confirmDialog({
      title: `Use "${target?.name}" as the base?`,
      eyebrow: "Swap base play",
      body: (
        <>
          <p>The base supplies the alignment, handoff / play-action mechanics, flags and default reads. Your slot edits carry over where neither base has handoff mechanics.</p>
          {losses.length > 0 && <p>These slots reset to the new base: {losses.map(slotName).join(", ")}.</p>}
        </>
      ),
      confirmLabel: "Swap base",
    });
    if (ok) d.edit((st) => swapBase(st, catalog, v), "Swap base");
  };

  const family = playTypeInfo(effectiveField<string>(state, "playType")).family;
  const isRun = family === "run" || family === "option";

  const assetRow = (
    <FormRow label="File name (asset)" error={assetErr} hint={autoAsset ? "Made from the play name" : "Letters, digits and _ only"}>
      <div className={s.inline}>
        <TextInput size="sm" mono value={asset} invalid={!!assetErr} onChange={(v) => d.edit((st) => setPlayAsset(st, v.replace(/[^A-Za-z0-9_]/g, "")), "Asset", 1500)} />
        <Button size="sm" variant="ghost" disabled={autoAsset} onClick={() => d.edit((st) => setPlayAsset(st, suggestAsset(catalog, set.asset, name, prefix, selfKey)), "Asset")}>
          Auto
        </Button>
      </div>
    </FormRow>
  );
  const blockingRow = (
    <FormRow label="Blocking scheme">
      <SearchSelect
        size="sm"
        value={typeof state.play.blocking === "string" ? state.play.blocking : ""}
        options={blockingOptions}
        onChange={(v) => d.edit((st) => setPlayField(st, "blocking", v || undefined), "Blocking")}
        width="100%"
        menuWidth={300}
      />
    </FormRow>
  );
  const holeRow = (
    <FormRow label={<span className={s.labelRow}>Run hole <span className={s.dim}>{runHole === 0 ? "middle" : runHole % 2 ? "left" : "right"}</span></span>}>
      <div className={s.inline}>
        <HolePicker value={runHole} onChange={(v) => d.edit((st) => setPlayField(st, "runHole", v), "Run hole")} />
        <IconButton icon="undo" size="sm" title="Use the base play's run hole" disabled={!("runHole" in state.play)} onClick={() => d.edit((st) => setPlayField(st, "runHole", undefined), "Run hole")} />
      </div>
    </FormRow>
  );

  return (
    <div className={s.panel}>
      <section className={s.section}>
        <div className={s.eyebrow}>Play</div>
        <FormRow label="Name" error={nameErr}>
          <TextInput size="sm" value={name} invalid={!!nameErr} onChange={rename} />
        </FormRow>
        <RenameRefs catalog={catalog} file={file} index={index} set={set.asset} name={name} asset={asset} blocked={!!nameErr || !!assetErr} />
        <FormRow label="Base play" hint="The play this one starts from: same formation and set, handoffs and protection.">
          <SearchSelect size="sm" value={String(state.play.base)} options={baseOptions} onChange={changeBase} width="100%" menuWidth={320} />
        </FormRow>
      </section>

      <section className={s.section}>
        <div className={s.eyebrow}>Play call</div>
        <FormRow
          label={<span className={s.labelRow}><span className={s.redDot} aria-hidden /> Primary receiver (red route)</span>}
          hint={
            "vip" in state.play && typeof baseFieldValue(state, "vip") === "number" ? (
              // Changed: say from what, with a labelled way back (a bare undo arrow was easy to miss).
              <span className={s.hintRow}>
                Changed from the base play's {slotName(baseFieldValue(state, "vip") as number)}.
                <Button size="sm" variant="ghost" icon="undo" onClick={() => d.edit((st) => setPlayField(st, "vip", undefined), "Primary receiver")} title="Use the base play's primary receiver again">
                  Use base
                </Button>
              </span>
            ) : (
              "The QB's first look. Also: right-click a player → Make primary receiver."
            )
          }
        >
          <SearchSelect size="sm" value={String(vip)} options={vipOptions} onChange={(v) => d.edit((st) => setPlayField(st, "vip", Number(v)), "Primary receiver")} width="100%" />
        </FormRow>
        <FormRow label="Play type">
          <SearchSelect
            size="sm"
            value={typeof state.play.playType === "string" ? state.play.playType : ""}
            options={playTypeOptions}
            onChange={(v) => d.edit((st) => setPlayField(st, "playType", v || undefined), "Play type")}
            width="100%"
            menuWidth={320}
          />
        </FormRow>
        {isRun && holeRow}
        {isRun && blockingRow}
      </section>

      <Disclosure id="play.advanced" title="Advanced" hint={explicitReads ? "reads edited" : "asset, reads"} className={s.advanced}>
        {assetRow}
        {!isRun && blockingRow}
        {!isRun && holeRow}
        <ReadsEditor />
      </Disclosure>

      <section className={s.section}>
        <FilePlays />
        <Button size="sm" icon="playcall" onClick={() => self && openAddToPlaybook(self.key)} disabled={!self}>
          Add to playbook…
        </Button>
      </section>
    </div>
  );
}

function FilePlays() {
  const d = useDesigner();
  const { file, index, catalog, prefix, set } = d;
  const doc = useDoc<PlaysFile>(file);
  const plays = doc?.data?.plays ?? [];
  const resolved = catalog.custom.filter((p) => p.file === file);

  const duplicate = () => {
    const src = plays[index];
    if (!src) return;
    const taken = new Set(catalog.custom.filter((p) => p.set === set.asset).map((p) => p.name.toLowerCase()));
    for (const p of catalog.lib.playsBySet.get(set.asset) ?? []) taken.add(p.name.toLowerCase());
    let nm = `${src.name} copy`;
    for (let i = 2; taken.has(nm.toLowerCase()); i++) nm = `${src.name} copy ${i}`;
    const copy = { ...JSON.parse(JSON.stringify(src)), name: nm, asset: suggestAsset(catalog, set.asset, nm, prefix) };
    useWorkspace.getState().update<PlaysFile>(file, (draft) => void draft.plays.splice(index + 1, 0, copy), { label: "Duplicate play" });
    navigate(href("designer", file, index + 1));
  };

  const remove = async () => {
    const ok = await confirmDialog({ title: `Delete "${plays[index]?.name}"?`, body: "It's removed from the plays file (undo brings it back until you leave).", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    useWorkspace.getState().update<PlaysFile>(file, (draft) => void draft.plays.splice(index, 1), { label: "Delete play" });
    toast.info("Play deleted", { detail: "Save the file to keep the change." });
    navigate("#/designer");
  };

  return (
    <>
      <div className={s.fileHead}>
        <div className={s.eyebrow}>{leaf(file)}</div>
        <div className={s.fileTools}>
          <IconButton icon="duplicate" size="sm" title="Duplicate this play" onClick={duplicate} />
          <IconButton icon="trash" size="sm" title="Delete this play" onClick={remove} />
        </div>
      </div>
      <div className={s.fileList}>
        {plays.map((p, i) => {
          const r = resolved.find((x) => x.index === i);
          return (
            <button key={i} type="button" className={cx(s.fileRow, i === index && s.fileRowOn)} onClick={() => i !== index && navigate(href("designer", file, i))}>
              <span className={s.fileName}>{String(p?.name ?? `Play ${i + 1}`)}</span>
              {r && r.problems.length > 0 && <span className={s.problemDot} title={r.problems.join("\n")} />}
            </button>
          );
        })}
      </div>
    </>
  );
}

// ───────────────────────────── rename everywhere ─────────────────────────────

/**
 * The play as other documents know it: its saved (on-disk) name and asset when the plays file has unsaved edits,
 * else what it is now. Captured when the play opens, so a rename keeps pointing back at the old identity.
 */
function initialIdentity(file: string, index: number, set: string, name: string, asset: string): PlayIdentity {
  const doc = useWorkspace.getState().docs[file];
  if (doc?.dirty && !doc.isNew && doc.savedText) {
    try {
      const savedPlays = parseJson<PlaysFile>(doc.savedText).plays;
      const nowPlays = (doc.data as PlaysFile | null)?.plays;
      // Same slot only when no play was inserted or deleted since the save and it's still the same base play —
      // otherwise the saved play at this index may be another play.
      if (Array.isArray(savedPlays) && Array.isArray(nowPlays) && savedPlays.length === nowPlays.length) {
        const saved = savedPlays[index];
        const now = nowPlays[index];
        if (saved && now && typeof saved.base === "string" && saved.base === now.base && folder(saved.base) === folder(set) && typeof saved.name === "string")
          return { set, name: saved.name, asset: typeof saved.asset === "string" ? saved.asset : asset };
      }
    } catch {
      /* unreadable saved text: fall back to the current identity */
    }
  }
  return { set, name, asset };
}

/**
 * Renaming a play (or changing its asset) breaks playbooks that list it by name and orphans concepts tags, notes and
 * favorites keyed by its PlayKey. Say what still points at the old identity and offer to update it in one step.
 */
function RenameRefs(p: { catalog: Catalog; file: string; index: number; set: string; name: string; asset: string; blocked: boolean }) {
  const [orig, setOrig] = useState(() => initialIdentity(p.file, p.index, p.set, p.name, p.asset));
  const books = useDocsOfKind<PlaybookSpec>("playbook");
  const concepts = useDoc<ConceptsDoc>(CONCEPTS_PATH);
  const favorites = useSettings((st) => st.favorites);
  const recents = useSettings((st) => st.recents);
  const conceptsData = concepts && !concepts.error ? concepts.data : null;
  const refs = useMemo(
    () =>
      orig.set === p.set && (orig.name !== p.name || orig.asset !== p.asset)
        ? danglingPlayRefs(orig, p.catalog, { playbooks: books.filter((b) => !b.error), concepts: conceptsData, favorites, recents })
        : undefined,
    [orig, p.set, p.name, p.asset, p.catalog, books, conceptsData, favorites, recents],
  );
  if (!refs || refs.total === 0) return null;

  const newKey = playKeyFor({ set: p.set, asset: p.asset });
  const oldKey = playKeyFor(orig);
  const parts = [
    ...refs.playbooks.map((b) => `${leaf(b.path)}${b.entries > 1 ? ` (${b.entries} entries)` : ""}`),
    refs.concepts ? `${refs.concepts} concepts entr${refs.concepts === 1 ? "y" : "ies"} (tags / notes)` : "",
    refs.favorite ? "favorites" : "",
    refs.recent ? "recents" : "",
  ].filter(Boolean);

  const updateAll = () => {
    const ws = useWorkspace.getState();
    const touched: string[] = [];
    for (const b of refs.playbooks) {
      ws.update<PlaybookSpec>(b.path, (d) => void renamePlayInBook(d, p.catalog, orig, p.name), { label: "Rename play references" });
      touched.push(leaf(b.path));
    }
    if (refs.concepts && oldKey !== newKey) {
      ws.update<ConceptsDoc>(CONCEPTS_PATH, (d) => void rekeyConcepts(d, oldKey, newKey), { label: "Rename play references" });
      touched.push(leaf(CONCEPTS_PATH));
    }
    if ((refs.favorite || refs.recent) && oldKey !== newKey) {
      const st = useSettings.getState();
      st.set({ favorites: rekeyList(st.favorites, oldKey, newKey), recents: rekeyList(st.recents, oldKey, newKey) });
      touched.push("favorites");
    }
    setOrig({ set: p.set, name: p.name, asset: p.asset });
    toast.success(`Updated "${orig.name}" → "${p.name}"`, {
      detail: `${touched.join(", ")}${touched.some((t) => t.endsWith(".json")) ? ` — unsaved until you save all (${comboLabel("shift+mod+s")})` : ""}`,
    });
  };

  return (
    <div className={s.refs} role="status">
      <p className={s.refsText}>
        <strong>Still uses “{orig.name}”:</strong> {parts.join(" · ")}. Those references won't resolve until they're updated too.
      </p>
      <Button size="sm" variant="secondary" disabled={p.blocked} onClick={updateAll} title={p.blocked ? "Fix the name / asset first" : undefined}>
        Update everywhere
      </Button>
    </div>
  );
}
