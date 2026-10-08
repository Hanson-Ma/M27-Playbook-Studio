// User preferences (persisted in localStorage, never written to the repo).
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_AUDIBLE_BUTTONS, type PadButton } from "../model/audibles";
import type { AudibleSlot, PlayKey } from "../model/types";

/**
 * How audible slots are drawn (the only place the app shows controller buttons): Xbox face buttons, PS5 symbols, or
 * keyboard keys 1–4. Matches the device the user plays Madden with; the app itself is keyboard + mouse.
 */
export type AudibleStyle = "xbox" | "ps" | "keyboard";
export type BallSpot = "left" | "middle" | "right";

/** The playbook the app opens by default (FUSION). */
export const DEFAULT_PLAYBOOK = "playbooks/FUSION.json";

export interface SettingsState {
  audibleStyle: AudibleStyle;
  /** Audible slot → face button (Xbox names; PS: A=✕ B=○ X=□ Y=△). */
  audibleButtons: Record<AudibleSlot, PadButton>;
  /** Prefix for generated asset names and authored assignment names. */
  assetPrefix: string;
  /** Visualization only: which hash the ball sits on. */
  ballSpot: BallSpot;
  /** Play cards per row in the builder's set view (3 / 6 / 9; 3 per row = one page of the in-game play-call screen). */
  cardColumns: 3 | 6 | 9;
  /** Draw OL pass protection in detail views. */
  showPassPro: boolean;
  /** Hide minigame / tutorial / skills-trainer formations (MG_, ST_, NST_, skeleton drills) in pickers. */
  hideMinigames: boolean;
  favorites: PlayKey[];
  recents: PlayKey[];
  /** Last opened playbook path (playbooks/<name>.json). Default: STUDIO (playbooks/studio-test.json). */
  lastPlaybook?: string;
  /** Last opened plays file for the designer (playbooks/plays/<name>.json). */
  lastPlaysFile?: string;

  set(partial: Partial<Omit<SettingsState, "set" | "toggleFavorite" | "pushRecent" | "resetAudibleButtons">>): void;
  toggleFavorite(key: PlayKey): void;
  pushRecent(key: PlayKey): void;
  resetAudibleButtons(): void;
}

export const SETTINGS_KEY = "pbstudio.settings";
export const SETTINGS_VERSION = 3;

/**
 * Upgrade persisted settings from an older version (pure; exported for tests).
 * v1 → v2: `inputMode` ("auto" | "xbox" | "ps" | "keyboard", the app-wide glyph set) becomes `audibleStyle`
 * ("ps" → "ps", "keyboard" → "keyboard", anything else → "xbox"); the v1 default book STUDIOLIB (or none) becomes STUDIO.
 * v2 → v3: the builder shows 3 cards per row by default (the control moved to the set header), so a stored 6 resets to 3.
 */
export function migrateSettings(persisted: unknown, version: number): Record<string, unknown> {
  const st: Record<string, unknown> = persisted && typeof persisted === "object" ? { ...(persisted as Record<string, unknown>) } : {};
  if (version < 2) {
    const mode = st.inputMode;
    delete st.inputMode;
    if (st.audibleStyle !== "xbox" && st.audibleStyle !== "ps" && st.audibleStyle !== "keyboard")
      st.audibleStyle = mode === "ps" ? "ps" : mode === "keyboard" ? "keyboard" : "xbox";
    if (st.lastPlaybook === undefined || st.lastPlaybook === null || st.lastPlaybook === "playbooks/studio-lib.json" || st.lastPlaybook === "playbooks/studio-test.json") st.lastPlaybook = DEFAULT_PLAYBOOK;
  }
  if (version < 3) st.cardColumns = 3;
  return st;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      audibleStyle: "xbox",
      audibleButtons: { ...DEFAULT_AUDIBLE_BUTTONS },
      assetPrefix: "PBS_",
      ballSpot: "middle",
      cardColumns: 3,
      showPassPro: true,
      hideMinigames: true,
      favorites: [],
      recents: [],
      lastPlaybook: DEFAULT_PLAYBOOK,
      lastPlaysFile: undefined,

      set: (partial) => set(partial),
      toggleFavorite: (key) => {
        const favs = get().favorites;
        set({ favorites: favs.includes(key) ? favs.filter((k) => k !== key) : [...favs, key] });
      },
      pushRecent: (key) => {
        const next = [key, ...get().recents.filter((k) => k !== key)].slice(0, 60);
        set({ recents: next });
      },
      resetAudibleButtons: () => set({ audibleButtons: { ...DEFAULT_AUDIBLE_BUTTONS } }),
    }),
    {
      name: SETTINGS_KEY,
      version: SETTINGS_VERSION,
      migrate: (persisted, version) => migrateSettings(persisted, version) as unknown as SettingsState,
    },
  ),
);

// Several tabs share one localStorage entry: when another tab writes it, take its state (favorites, recents, audible
// style…) so this tab's next write doesn't silently drop that tab's changes.
if (typeof window !== "undefined" && typeof window.addEventListener === "function")
  window.addEventListener("storage", (e) => {
    if (e.key === SETTINGS_KEY && e.storageArea === window.localStorage) void useSettings.persist.rehydrate();
  });
