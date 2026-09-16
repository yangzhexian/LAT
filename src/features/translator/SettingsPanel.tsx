import type { UserSettings } from "../../types";
import { Icon } from "../../components/Icon";

interface SettingsPanelProps {
  settings: UserSettings;
  onChange: (next: Partial<UserSettings>) => void;
  onClose: () => void;
}

export function SettingsPanel({ settings, onChange, onClose }: SettingsPanelProps) {
  return <div className="settings-page"><section className="settings-panel" aria-label="设置">
    <header className="settings-header">
      <div><p className="settings-kicker">LAT SETTINGS</p><h2>设置</h2><p>让工作区适合你的阅读习惯</p></div>
      <button type="button" className="icon-button" onClick={onClose} aria-label="关闭设置"><Icon name="close" /></button>
    </header>
    <div className="settings-grid">
      <section className="settings-section"><h3>主题</h3><p>选择工作区的明暗外观</p>
        <div className="preference-options">
          {([['light', '浅色', 'sun'], ['dark', '深色', 'moon']] as const).map(([value, label, icon]) =>
            <button key={value} className="preference-pill" aria-pressed={settings.theme === value} onClick={() => onChange({ theme: value })}><Icon name={icon} /><span>{label}</span></button>)}
        </div>
      </section>
      <section className="settings-section"><h3>排版</h3><p>调整原文和译文的排列方向</p>
        <div className="preference-options">
          {([['horizontal', '左右'], ['vertical', '上下']] as const).map(([value, label]) =>
            <button key={value} className="preference-pill" aria-pressed={settings.layout === value} onClick={() => onChange({ layout: value })}><Icon name={value} /><span>{label}</span></button>)}
        </div>
      </section>
      <section className="settings-section"><h3>文本处理</h3>
        {([['autoFont', '自动字体', '根据文本长度调整字号'], ['removeLineBreaks', '合并换行', '合并普通文本换行，保留公式和代码']] as const).map(([key, label, hint]) =>
          <label className="setting-toggle" key={key}><span>{label}<small>{hint}</small></span><input className="capsule-switch" role="switch" type="checkbox" checked={settings[key]} onChange={(event) => onChange({ [key]: event.target.checked })} /></label>)}
      </section>
      <section className="settings-section"><h3>动态效果</h3>
        <label className="setting-toggle"><span>减少动态效果<small>关闭界面过渡和模型状态动画</small></span><input className="capsule-switch" role="switch" type="checkbox" checked={settings.reduceMotion ?? false} onChange={(event) => onChange({ reduceMotion: event.target.checked })} /></label>
        <p className="settings-note">系统开启减少动态效果时也会自动生效。</p>
      </section>
    </div>
    <p className="settings-note">设置会自动保存到本机</p>
  </section></div>;
}
