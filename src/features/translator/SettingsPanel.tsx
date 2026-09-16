import type { UserSettings } from "../../types";

interface SettingsPanelProps {
  settings: UserSettings;
  onChange: (next: Partial<UserSettings>) => void;
  onClose: () => void;
}

export function SettingsPanel({ settings, onChange, onClose }: SettingsPanelProps) {
  return (
    <div className="settings-page">
      <section
        className="settings-panel"
        aria-label="设置"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <div>
            <p className="settings-kicker">LAT SETTINGS</p>
            <h2>设置</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭设置">
            ×
          </button>
        </header>
        <div className="settings-section">
          <h3>主题</h3>
          <div className="segmented-control">
            <button
              type="button"
              className={settings.theme === "dark" ? "active" : ""}
              onClick={() => onChange({ theme: "dark" })}
            >
              深色
            </button>
            <button
              type="button"
              className={settings.theme === "light" ? "active" : ""}
              onClick={() => onChange({ theme: "light" })}
            >
              浅色
            </button>
          </div>
        </div>
        <div className="settings-section">
          <h3>排版</h3>
          <div className="segmented-control">
            <button
              type="button"
              className={settings.layout === "horizontal" ? "active" : ""}
              onClick={() => onChange({ layout: "horizontal" })}
            >
              左右
            </button>
            <button
              type="button"
              className={settings.layout === "vertical" ? "active" : ""}
              onClick={() => onChange({ layout: "vertical" })}
            >
              上下
            </button>
          </div>
        </div>
        <div className="settings-section">
          <h3>文本处理</h3>
          <label className="setting-toggle">
            <span>自动字体</span>
            <input
              type="checkbox"
              checked={settings.autoFont}
              onChange={(event) => onChange({ autoFont: event.target.checked })}
            />
          </label>
          <label className="setting-toggle">
            <span>合并换行</span>
            <input
              type="checkbox"
              checked={settings.removeLineBreaks}
              onChange={(event) => onChange({ removeLineBreaks: event.target.checked })}
            />
          </label>
        </div>
        <p className="settings-note">设置会自动保存到本机</p>
      </section>
    </div>
  );
}
