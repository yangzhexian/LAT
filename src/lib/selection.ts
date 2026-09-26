import type { ThemeMode } from "../types";

export interface SelectionSnapshot {
  requestId: string;
  text: string;
  error?: string;
  method?: string;
}

export interface SelectionConfig {
  enabled: boolean;
  shortcut: string;
  clipboardFallback: boolean;
  closeToTray: boolean;
  theme: ThemeMode;
  reduceMotion: boolean;
  targetLanguage: string;
}

export const DEFAULT_SELECTION_CONFIG: SelectionConfig = {
  enabled: false,
  shortcut: "Ctrl+Alt+T",
  clipboardFallback: true,
  closeToTray: false,
  theme: "light",
  reduceMotion: false,
  targetLanguage: "zh",
};

export function isSelectionDesktop(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

export async function invokeSelection<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isSelectionDesktop()) throw new Error("划词翻译需要在 LAT 桌面应用中使用");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export function applySelectionAppearance(config: SelectionConfig): void {
  document.documentElement.dataset.theme = config.theme;
  document.documentElement.dataset.reduceMotion = String(config.reduceMotion);
}
