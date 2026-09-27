import { create } from "zustand";

export interface ContextSelection {
  type: "activity" | "node" | "log" | null;
  id?: number | string;
}

interface UiState {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  context: ContextSelection;
  commandOpen: boolean;
  setSidebarWidth: (w: number) => void;
  toggleSidebar: () => void;
  setContext: (c: ContextSelection) => void;
  setCommandOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarWidth: 220,
  sidebarCollapsed: false,
  context: { type: null },
  commandOpen: false,
  setSidebarWidth: (w) => set({ sidebarWidth: Math.min(360, Math.max(180, w)) }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setContext: (context) => set({ context }),
  setCommandOpen: (commandOpen) => set({ commandOpen }),
}));
