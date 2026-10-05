// Formation & set editor (#/formations): sets files + custom set cards, and the set editor at
// #/formations/<encodeURIComponent(file)>/<index> (ARCHITECTURE.md "Cross-view URL contract").
import { useRoute } from "../../state/router";
import { EntryScreen } from "./EntryScreen";
import { SetEditorScreen } from "./SetEditor";

export function FormationsView() {
  const route = useRoute();
  const [file, idx] = route.parts;
  const index = idx !== undefined && /^\d+$/.test(idx) ? Number(idx) : undefined;
  if (file && index !== undefined) return <SetEditorScreen key={`${file}#${index}`} file={file} index={index} />;
  return <EntryScreen />;
}
