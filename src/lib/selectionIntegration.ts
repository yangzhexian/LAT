import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { UserSettings } from "../types";
import type { SelectionConfig } from "./selection";
import { LANGUAGES } from "./languages";
import { updateHistory, type TranslationHistory } from "./history";

export interface SelectionTransfer { id: number; text?: string }

export function selectionConfig(settings: UserSettings): SelectionConfig {
  return { enabled: settings.selectionEnabled, shortcut: settings.selectionShortcut,
    clipboardFallback: settings.selectionClipboardFallback, closeToTray: settings.selectionCloseToTray,
    targetLanguage: settings.selectionTargetLanguage, theme: settings.theme, reduceMotion: settings.reduceMotion };
}

function nativeSettings(config: SelectionConfig): Partial<UserSettings> {
  return { selectionEnabled: config.enabled, selectionShortcut: config.shortcut,
    selectionClipboardFallback: config.clipboardFallback, selectionCloseToTray: config.closeToTray,
    selectionTargetLanguage: config.targetLanguage };
}

// Only the main webview mounts this hook. All native configuration writes run
// serially so rapid UI changes cannot register an obsolete shortcut last.
export function useSelectionIntegration(settings: UserSettings, setSettings: Dispatch<SetStateAction<UserSettings>>) {
  const [error, setError] = useState("");
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [transfer, setTransfer] = useState<SelectionTransfer | null>(null);
  const latest = useRef(settings);
  latest.current = settings;
  const configureQueue = useRef(Promise.resolve());
  const revision = useRef(0);
  const transferId = useRef(0);
  const failedRollback = useRef("");
  const desired = JSON.stringify(selectionConfig(settings));

  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) {
      setError(settings.selectionEnabled ? "划词翻译仅在 Windows 桌面版中可用" : "");
      return;
    }
    const current = ++revision.current;
    let active = true;
    configureQueue.current = configureQueue.current.catch(() => {}).then(async () => {
      if (!active || current !== revision.current) return;
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        await invoke("selection_configure", { config: JSON.parse(desired) });
        if (active && current === revision.current && !JSON.parse(desired).enabled) setPaused(false);
        if (active && current === revision.current && desired !== failedRollback.current) setError("");
      } catch (reason) {
        if (!active || current !== revision.current) return;
        setError("划词设置未生效：" + String(reason));
        try {
          const config = await invoke<SelectionConfig>("selection_get_config");
          if (active && current === revision.current) {
            failedRollback.current = JSON.stringify(selectionConfig({ ...latest.current, ...nativeSettings(config) }));
            setSettings((previous) => ({ ...previous, ...nativeSettings(config) }));
          }
        } catch { /* Keep the visible error if native state is unavailable. */ }
      }
    });
    return () => { active = false; };
  }, [desired, setSettings]);

  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return;
    let active = true;
    const remove: (() => void)[] = [];
    const seen = new Set<string>();
    void (async () => {
      const { listen, emitTo } = await import("@tauri-apps/api/event");
      const attach = async <T,>(name: string, callback: (payload: T) => void) => {
        const unlisten = await listen<T>(name, (event) => { if (active) callback(event.payload); });
        if (active) remove.push(unlisten); else unlisten();
      };
      await attach<{ text?: string | null }>("selection-open-main", (payload) => setTransfer({ id: ++transferId.current, text: typeof payload.text === "string" ? payload.text : undefined }));
      await attach<{ paused: boolean }>("selection-paused", (payload) => setPaused(payload.paused));
      await attach<{ busy: boolean }>("selection-busy", (payload) => setBusy(payload.busy));
      await attach<string>("selection-native-error", (message) => setError(message));
      await attach<{ language: string }>("selection-target-language", (payload) => {
        if (LANGUAGES.some((item) => item.code !== "auto" && item.code === payload.language)) setSettings((previous) => ({ ...previous, selectionTargetLanguage: payload.language }));
      });
      await attach<{ requestId: string; row: TranslationHistory }>("selection-history", (payload) => {
        const historyId = payload.row?.id;
        if (!historyId || seen.has(historyId)) return;
        seen.add(historyId);
        if (seen.size > 200) seen.delete(seen.values().next().value!);
        const preferences = latest.current;
        void (async () => {
          let saved = false;
          let failure: string | undefined;
          try {
            if (preferences.saveHistory) {
              const row = payload.row;
              if (!row || typeof row.source !== "string" || typeof row.translation !== "string" || !row.id) throw new Error("历史内容无效");
              await updateHistory({ add: { ...row, origin: "selection" } }, preferences.historyLimit);
              saved = true;
              window.dispatchEvent(new Event("lat-history-changed"));
            }
          } catch { failure = "译文已完成，但历史记录未能保存到本机"; }
          await emitTo("selection", "selection-history-result", { requestId: payload.requestId, saved, error: failure });
        })().catch(() => {});
      });
    })().catch((reason) => { if (active) setError("划词窗口通信失败：" + String(reason)); });
    return () => { active = false; remove.forEach((unlisten) => unlisten()); };
  }, [setSettings]);

  return { error, paused, transfer, busy };
}
