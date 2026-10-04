// Library feature (#/library): the play grid, play detail (#/library/play/<key>) with the per-player route library,
// and the Add-to-playbook dialog (AddToPlaybook.tsx, hosted by App). See app/docs/features/library.md.
import { useRoute } from "../../state/router";
import { LibraryGrid } from "./LibraryGrid";
import { PlayDetail } from "./PlayDetail";

export function LibraryView() {
  const route = useRoute();
  const key = route.parts[0] === "play" ? route.parts.slice(1).join("/") : undefined;
  // The Add-to-playbook dialog host is mounted by the App shell (it's shared with the designer).
  return key ? <PlayDetail playKey={key} /> : <LibraryGrid />;
}
