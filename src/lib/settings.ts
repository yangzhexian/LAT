import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { UserSettings } from "../types";

const SETTINGS_KEY = "lat.settings.v1";
const DEFAULT_SETTINGS: UserSettings = {
  theme: "light",
  layout: "horizontal",
  autoFont: true,
  removeLineBreaks: false,
  dataDirectory: "",
};

function readSettings(): UserSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    return stored
      ? { ...DEFAULT_SETTINGS, ...(JSON.parse(stored) as Partial<UserSettings>) }
      : DEFAULT_SETTINGS;
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
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  return [settings, setSettings];
}
