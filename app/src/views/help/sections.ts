// The in-app guide's sections (#/help/<id>), in reading order. Content lives in ./content/<id>.md; the same files, in
// this order, make the PDF guide (npm run guide → app/docs/guide/, copied to public/guide/Playbook-Studio-Guide.pdf).
// The top bar's "?" opens the section for the screen you're on (App.tsx HELP_OF, or a view's useHelpTopic()).

export type HelpSectionId =
  | "getting-started"
  | "playbook"
  | "audibles"
  | "preview"
  | "library"
  | "concepts"
  | "designer"
  | "routes"
  | "formations"
  | "export"
  | "hosting"
  | "faq";

export interface HelpSection {
  id: HelpSectionId;
  /** Short title for the section list. */
  title: string;
  /** One line under the title. */
  blurb: string;
}

export const HELP_SECTIONS: readonly HelpSection[] = [
  { id: "getting-started", title: "Getting started", blurb: "What the app does, the round trip to the game, saving" },
  { id: "playbook", title: "Build a playbook", blurb: "Formations, sets and plays; special teams; limits" },
  { id: "audibles", title: "Audibles & CPU calls", blurb: "The four audible buttons, Xbox / PS5 glyphs, CPU weights" },
  { id: "preview", title: "Preview in game", blurb: "See the playbook like Madden's play-call screen" },
  { id: "library", title: "Find plays", blurb: "Search and filter the library, NEEDS MOD, add to a playbook" },
  { id: "concepts", title: "Gameplan: concepts & tags", blurb: "Tag plays, run / pass matrices, situations" },
  { id: "designer", title: "Design a play", blurb: "Base play, players, blocks, motion, the red route" },
  { id: "routes", title: "Routes, cuts & My Routes", blurb: "Presets, drawing, cut styles, saved routes" },
  { id: "formations", title: "Formations & custom sets", blurb: "Move players, motion presets, copy plays in" },
  { id: "export", title: "Export to the game", blurb: "Check, export, run the command, apply the mod" },
  { id: "hosting", title: "Use it on your website", blurb: "Upload by FTP, open your folder, the Madden PC" },
  { id: "faq", title: "FAQ & troubleshooting", blurb: "Common questions and fixes" },
];

export const DEFAULT_HELP_SECTION: HelpSectionId = "getting-started";

export function isHelpSection(id: string | undefined): id is HelpSectionId {
  return !!id && HELP_SECTIONS.some((s) => s.id === id);
}
