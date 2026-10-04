// One-line summary of a playbook spec for pickers ("Offense · 19 plays · 1 formation (+4 template)"); no catalog needed.
import type { PlaybookSpec } from "../../model/types";

export function bookSummary(spec: PlaybookSpec | null | undefined): string {
  if (!spec || !Array.isArray(spec.formations)) return "Not a playbook";
  let plays = 0;
  let formations = 0;
  let templates = 0;
  for (const f of spec.formations) {
    if (f?.sets === "template") templates++;
    else {
      formations++;
      if (Array.isArray(f?.sets)) for (const st of f.sets) plays += Array.isArray(st?.plays) ? st.plays.length : 0;
    }
  }
  const side = spec.side === "defense" ? "Defense" : "Offense";
  return `${side} · ${plays} play${plays === 1 ? "" : "s"} · ${formations} formation${formations === 1 ? "" : "s"}${templates ? ` (+${templates} template)` : ""}`;
}
