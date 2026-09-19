import type { UserSettings } from "../../types";
import { Button, OptionGroup, SelectField, Switch } from "../../components/Controls";
import { Icon } from "../../components/Icon";

interface SettingsPanelProps {
  settings: UserSettings;
  onChange: (next: Partial<UserSettings>) => void;
  onClose: () => void;
}

export function SettingsPanel({ settings, onChange, onClose }: SettingsPanelProps) {
  function changeHistoryLimit(value: number) {
    if (value < (settings.historyLimit ?? 30) && !window.confirm(`改为 ${value} 条后，超出的旧记录将被删除。继续？`)) return;
    onChange({ historyLimit: value });
  }
  return <div className="settings-page"><section className="settings-panel" aria-label="设置">
    <header className="settings-header">
      <div><p className="settings-kicker">LAT SETTINGS</p><h2>设置</h2><p>让工作区适合你的阅读习惯</p></div>
      <Button className="icon-button" onClick={onClose} aria-label="关闭设置"><Icon name="close" /></Button>
    </header>
    <div className="settings-grid">
      <section className="settings-section"><h3>主题</h3><p>选择工作区的明暗外观</p>
        <OptionGroup label="主题" value={settings.theme} onChange={(theme) => onChange({ theme })} options={[{ value: 'light', label: '浅色', icon: 'sun' }, { value: 'dark', label: '深色', icon: 'moon' }]} />
      </section>
      <section className="settings-section"><h3>排版</h3><p>调整原文和译文的排列方向</p>
        <OptionGroup label="排版" value={settings.layout} onChange={(layout) => onChange({ layout })} options={[{ value: 'horizontal', label: '左右', icon: 'horizontal' }, { value: 'vertical', label: '上下', icon: 'vertical' }]} />
      </section>
      <section className="settings-section"><h3>文本处理</h3>
        <Switch label="自动字体" hint="根据文本长度调整字号" checked={settings.autoFont} onChange={(autoFont) => onChange({ autoFont })} />
        <Switch label="合并换行" hint="合并普通文本换行，保留公式和代码" checked={settings.removeLineBreaks} onChange={(removeLineBreaks) => onChange({ removeLineBreaks })} />
      </section>
      <section className="settings-section"><h3>动态效果</h3>
        <Switch label="减少动态效果" hint="关闭界面过渡和模型状态动画" checked={settings.reduceMotion ?? false} onChange={(reduceMotion) => onChange({ reduceMotion })} />
        <p className="settings-note">系统开启减少动态效果时也会自动生效。</p>
      </section>
      <section className="settings-section"><h3>历史记录</h3>
        <Switch label="保存翻译历史" hint="关闭后不再保存新记录，已有记录保留" checked={settings.saveHistory ?? true} onChange={(saveHistory) => onChange({ saveHistory })} />
        <SelectField label="最多保存" hint="超出上限时淘汰最早的记录" value={settings.historyLimit ?? 30} onChange={changeHistoryLimit}>{[10, 30, 50, 100, 200].map((value) => <option key={value} value={value}>{value} 条</option>)}</SelectField>
      </section>
      <section className="settings-section"><h3>显卡看板</h3>
        <SelectField label="刷新间隔" hint="从应用启动持续采样" value={settings.telemetryInterval ?? 2} onChange={(telemetryInterval) => onChange({ telemetryInterval })}>{[0.5, 1, 2, 5].map((value) => <option key={value} value={value}>{value} 秒</option>)}</SelectField>
        <SelectField label="趋势范围" value={settings.telemetryWindow ?? 120} onChange={(telemetryWindow) => onChange({ telemetryWindow })}>{[60, 120, 300].map((value) => <option key={value} value={value}>最近 {value / 60} 分钟</option>)}</SelectField>
      </section>
    </div>
    <p className="settings-note">设置会自动保存到本机</p>
  </section></div>;
}
