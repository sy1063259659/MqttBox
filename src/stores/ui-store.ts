import { create } from "zustand";

export type AppTheme = "graphite" | "midnight";
export type OverlayView =
  | "connections"
  | "topics"
  | "message"
  | "agent"
  | "settings"
  | "parsers"
  | null;

interface UiStore {
  activeOverlay: OverlayView;
  commandPaletteOpen: boolean;
  connectionSidebarCollapsed: boolean;
  publishPanelHeight: number;
  theme: AppTheme;
  isBootstrapping: boolean;
  isAppReady: boolean;
  isWindowMaximized: boolean;
  windowSize: {
    width: number;
    height: number;
  } | null;
  openSettings: () => void;
  closeSettings: () => void;
  openOverlay: (view: Exclude<OverlayView, null>) => void;
  closeOverlay: () => void;
  setConnectionSidebarCollapsed: (collapsed: boolean) => void;
  toggleConnectionSidebarCollapsed: () => void;
  setPublishPanelHeight: (height: number) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setTheme: (theme: AppTheme) => void;
  toggleTheme: () => void;
  setBootstrapping: (bootstrapping: boolean) => void;
  setAppReady: (ready: boolean) => void;
  setWindowState: (state: {
    isWindowMaximized: boolean;
    windowSize: {
      width: number;
      height: number;
    } | null;
  }) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  activeOverlay: null,
  commandPaletteOpen: false,
  connectionSidebarCollapsed: false,
  publishPanelHeight: 280,
  theme: "graphite",
  isBootstrapping: true,
  isAppReady: false,
  isWindowMaximized: false,
  windowSize: null,
  openSettings() {
    set({ activeOverlay: "settings", commandPaletteOpen: false });
  },
  closeSettings() {
    set((state) => ({
      activeOverlay: state.activeOverlay === "settings" ? null : state.activeOverlay,
    }));
  },
  openOverlay(view) {
    set({ activeOverlay: view });
  },
  closeOverlay() {
    set({ activeOverlay: null });
  },
  setConnectionSidebarCollapsed(connectionSidebarCollapsed) {
    set({ connectionSidebarCollapsed });
  },
  toggleConnectionSidebarCollapsed() {
    set((state) => ({
      connectionSidebarCollapsed: !state.connectionSidebarCollapsed,
    }));
  },
  setPublishPanelHeight(publishPanelHeight) {
    set({ publishPanelHeight });
  },
  setCommandPaletteOpen(open) {
    set({ commandPaletteOpen: open });
  },
  setTheme(theme) {
    set({ theme });
  },
  toggleTheme() {
    set((state) => ({
      theme: state.theme === "graphite" ? "midnight" : "graphite",
    }));
  },
  setBootstrapping(isBootstrapping) {
    set({ isBootstrapping });
  },
  setAppReady(isAppReady) {
    set({ isAppReady });
  },
  setWindowState({ isWindowMaximized, windowSize }) {
    set({
      isWindowMaximized,
      windowSize,
    });
  },
}));
