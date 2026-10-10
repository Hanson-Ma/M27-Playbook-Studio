// Library view UI state that outlives the grid component (detail view ↔ grid round trips keep scroll, selection,
// tab and filters). Tab, filters, flip and the rail state persist in localStorage; query/selection/scroll don't.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PlayFilters, SideFacet } from "../../model/search";
import type { PlayKey } from "../../model/types";

export type DetailTab = "overview" | "players" | "reads" | "routes";

export type LibTab = "formation" | "concept" | "type" | "favorites" | "recent";

export const LIB_TABS: LibTab[] = ["formation", "concept", "type", "favorites", "recent"];

/** The grid's filters: always one side (Favorites / Recent ignore it). */
export type LibFilters = Omit<PlayFilters, "side" | "hideMinigames"> & { side: SideFacet };

export interface LibraryUiState {
  tab: LibTab;
  query: string;
  filters: LibFilters;
  /** Selected entry id (SearchEntry.id) and its key (detail prev/next, restoring after a re-filter). */
  selectedId?: string;
  selectedKey?: PlayKey;
  flip: boolean;
  railOpen: boolean;
  /** Play detail side-panel tab. */
  detailTab: DetailTab;

  set(partial: Partial<Omit<LibraryUiState, "set" | "setFilters" | "clearFilters">>): void;
  setFilters(partial: Partial<LibFilters>): void;
  /** Everything but the side. */
  clearFilters(): void;
}

export const DEFAULT_FILTERS: LibraryUiState["filters"] = { side: "offense" };

export const useLibraryUi = create<LibraryUiState>()(
  persist(
    (set) => ({
      tab: "formation",
      query: "",
      filters: DEFAULT_FILTERS,
      selectedId: undefined,
      selectedKey: undefined,
      flip: false,
      railOpen: true,
      detailTab: "overview",
      set: (partial) => set(partial),
      setFilters: (partial) => set((s) => ({ filters: { ...s.filters, ...partial } })),
      clearFilters: () => set((s) => ({ filters: { side: s.filters.side } })),
    }),
    {
      name: "pbstudio.library",
      version: 2,
      migrate: (state) => ({ ...(state as object), tab: (state as { tab?: string }).tab === "all" ? "formation" : (state as { tab?: string }).tab }) as never,
      partialize: (s) => ({ tab: s.tab, filters: s.filters, flip: s.flip, railOpen: s.railOpen, detailTab: s.detailTab }),
    },
  ),
);

/** The grid's scroll position (kept outside React state: written on every scroll event, read on mount). */
export const gridScroll = { top: 0 };
