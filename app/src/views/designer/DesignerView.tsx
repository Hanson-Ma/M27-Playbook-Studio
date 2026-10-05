// Play designer (#/designer): plays files + their plays (entry), the new-play wizard (#/designer/new?…) and the
// three-pane editor (#/designer/<file>/<index>). Writes custom plays into playbooks/plays/*.json (FORMATS.md §3).
import { useLibrary, useCatalog } from "../../state/library";
import { useRoute } from "../../state/router";
import { useWorkspace } from "../../state/workspace";
import { EmptyState, ProgressBar } from "../../ui";
import { Editor } from "./Editor";
import { Entry } from "./Entry";
import s from "./Designer.module.css";

export function DesignerView() {
  const route = useRoute();
  const status = useLibrary((st) => st.status);
  const error = useLibrary((st) => st.error);
  const ready = useWorkspace((st) => st.ready);
  const catalog = useCatalog();

  if (status === "error") {
    return (
      <div className={s.center}>
        <EmptyState icon="warning" title="The Play Library Didn't Load" body={error ?? "Check the server and data/library/."} />
      </div>
    );
  }
  if (!catalog || !ready) {
    return (
      <div className={s.center}>
        <div className={s.loading}>
          <ProgressBar indeterminate label="Loading the designer" />
        </div>
      </div>
    );
  }

  const [first, second] = route.parts;
  if (first === "new") return <Entry wizard query={route.query} />;
  if (first && second !== undefined && /^\d+$/.test(second)) return <Editor file={first} index={Number(second)} />;
  return <Entry />;
}
