import type { StateCreator } from "zustand";
import { loadThemeMode } from "../../application/runtime/appRuntime";
import type { ThemeMode } from "../../lib/core/uiTypes";

export interface ShellSlice {
  sidebarWidth: number;
  inspectorWidth: number;
  sidebarCollapsed: boolean;
  inspectorCollapsed: boolean;
  themeMode: ThemeMode;
  setSidebarWidth: (width: number) => void;
  setInspectorWidth: (width: number) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setInspectorCollapsed: (collapsed: boolean) => void;
  toggleSidebarCollapsed: () => void;
  toggleInspectorCollapsed: () => void;
  toggleThemeMode: () => void;
}

export const emptyShellState = {
  sidebarWidth: 280,
  inspectorWidth: 372,
  sidebarCollapsed: false,
  inspectorCollapsed: false,
  themeMode: typeof window === "undefined" ? "light" : loadThemeMode()
};

export const createShellSlice: StateCreator<ShellSlice, [], [], ShellSlice> = (set) => ({
  ...emptyShellState,
  setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
  setInspectorWidth: (inspectorWidth) => set({ inspectorWidth }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setInspectorCollapsed: (inspectorCollapsed) => set({ inspectorCollapsed }),
  toggleSidebarCollapsed: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  toggleInspectorCollapsed: () => set((state) => ({ inspectorCollapsed: !state.inspectorCollapsed })),
  toggleThemeMode: () => set((state) => ({ themeMode: state.themeMode === "dark" ? "light" : "dark" }))
});
