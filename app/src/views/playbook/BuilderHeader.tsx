// Builder header: the open playbook (its name opens the Playbooks menu — open another, new, duplicate, rename,
// delete), the in-game save name and file, and the main actions as visible buttons. Saved / unsaved and the Save
// button live in the top bar (App.tsx DocChip) — one save status per screen, the same place on every screen.
import { saveNameFor } from "../../model/playbook";
import { navigate } from "../../state/router";
import { Button, Tooltip } from "../../ui";
import { PlaybooksMenuButton } from "./books";
import { useBuilder } from "./context";
import { useBuilderUi } from "./store";
import s from "./BuilderHeader.module.css";

export function BuilderHeader() {
  const data = useBuilder();
  const name = String(data.spec.name || "Untitled");
  const save = saveNameFor({ name: String(data.spec.name ?? ""), side: data.side });
  const drawer = useBuilderUi((st) => st.drawer);
  return (
    <header className={s.header}>
      <PlaybooksMenuButton path={data.path} label={name} />
      <div className={s.meta}>
        <Tooltip content="What the playbook is called in Madden (the save file the export builds)">
          <span className={s.save}>{save}</span>
        </Tooltip>
        <span className={s.file} title={data.path}>
          {data.path.replace(/^playbooks\//, "")}
        </span>
      </div>
      <div className={s.actions}>
        <Button size="sm" icon="playcall" onClick={() => navigate(`#/playcall/${encodeURIComponent(data.path)}`)} title="See the playbook the way Madden's play-call screen shows it">
          Preview in Game
        </Button>
        <Button size="sm" icon="tag" onClick={() => navigate("#/concepts?from=playbook")} title="Gameplan: your concept categories, play tags, run / pass mix and situations">
          Gameplan
        </Button>
        <Button size="sm" variant="primary" icon="plus" active={drawer} onClick={() => useBuilderUi.getState().setDrawer(!drawer)}>
          Add Plays
        </Button>
      </div>
    </header>
  );
}
