import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { UserSettings } from "../types";

const SETTINGS_KEY = "lat.settings.v1";
const DEFAULT_SETTINGS: UserSettings = {
  theme: "light",
  layout: "horizontal",
  reduceMotion: false,
  historyLimit: 30,
  saveHistory: true,
  telemetryInterval: 2,
  telemetryWindow: 120,
  autoFont: true,
  removeLineBreaks: false,
  dataDirectory: "",
};

function readSettings(): UserSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    const settings = { ...DEFAULT_SETTINGS, ...(stored ? JSON.parse(stored) : {}) };
    for (const [key, values] of Object.entries({ historyLimit: [10, 30, 50, 100, 200], telemetryInterval: [0.5, 1, 2, 5], telemetryWindow: [60, 120, 300] })) {
      if (!values.includes(settings[key])) settings[key] = DEFAULT_SETTINGS[key as keyof UserSettings];
    }
    if (typeof settings.saveHistory !== "boolean") settings.saveHistory = true;
    return settings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function usePersistentSettings(): [
  UserSettings,
  Dispatch<SetStateAction<UserSettings>>,
] {
  const [settings, setSettings] = useState<UserSettings>(readSettings);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.reduceMotion = String(settings.reduceMotion);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  return [settings, setSettings];
}
