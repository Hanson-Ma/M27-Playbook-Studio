// Playbook builder (app/docs/features/playbook.md, v2): the app's home screen. #/playbook opens the last / default
// playbook (FUSION = playbooks/FUSION.json) straight away; #/playbook/<path>[?f=&s=&p=] is the builder.
// Other playbooks open from the "Playbooks" menu in the builder header (there is no separate picker page).
import { useEffect, useMemo } from "react";
import { defaultPlaybookPath } from "../../model/playbook";
import type { PlaybookSpec } from "../../model/types";
import { navigate, useRoute } from "../../state/router";
import { useSettings } from "../../state/settings";
import { useDocsOfKind, useWorkspace } from "../../state/workspace";
import { Button, EmptyState, Spinner } from "../../ui";
import { Builder } from "./Builder";
import { bookHref, newPlaybook } from "./books";
import s from "./Builder.module.css";

export function PlaybookView() {
  const route = useRoute();
  const path = route.parts[0];
  return path ? <Builder key={path} path={path} /> : <OpenDefaultBook />;
}

/** #/playbook: jump to the last opened playbook (else FUSION, else the first one); offer to create one when none exist. */
function OpenDefaultBook() {
  const ready = useWorkspace((st) => st.ready);
  const docs = useDocsOfKind<PlaybookSpec>("playbook");
  const last = useSettings((st) => st.lastPlaybook);
  const paths = useMemo(() => docs.map((d) => d.path), [docs]);
  const target = ready ? defaultPlaybookPath(last, paths) : undefined;
  useEffect(() => {
    if (target) navigate(bookHref(target), { replace: true });
  }, [target]);
  if (!ready || target)
    return (
      <div className={s.center}>
        <Spinner size={28} label="Opening your playbook" />
      </div>
    );
  return (
    <div className={s.center}>
      <EmptyState
        icon="tree"
        title="No Playbooks Yet"
        body="A playbook is the list of formations, sets and plays you'll see in Madden. Start empty, or start from the game's stock playbook and trim it down."
        action={
          <>
            <Button variant="primary" icon="plus" onClick={() => void newPlaybook(false)}>
              New Playbook
            </Button>
            <Button icon="download" onClick={() => void newPlaybook(true)}>
              New From Stock Template
            </Button>
          </>
        }
      />
    </div>
  );
}
