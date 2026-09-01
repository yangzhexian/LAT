import { useState } from "react";
import { translateStream } from "../../lib/api";
import { languageName } from "../../lib/languages";
import { normalizeForTranslation } from "../../lib/text";
import type {
  LocalStatus,
  StreamEvent,
  TranslationMetrics,
  UserSettings,
} from "../../types";
import { SettingsPanel } from "./SettingsPanel";
import { TextPane } from "./TextPane";

interface TranslatorWorkspaceProps {
  status: LocalStatus;
  settings: UserSettings;
  onSettingsChange: (next: Partial<UserSettings>) => void;
  onDisable: () => void;
}

function autoFontSize(value: string, enabled: boolean): number {
  if (!enabled) return 17;
  return Math.max(14, Math.min(22, 22 - Math.log10(Math.max(1, value.length)) * 2.1));
}

function completedMetrics(metrics: TranslationMetrics | null): string {
  if (!metrics) return "";
  return [
    metrics.tokens_per_second != null ? Math.round(metrics.tokens_per_second) + " tokens/s" : "",
    metrics.elapsed_ms != null ? (metrics.elapsed_ms / 1000).toFixed(1) + "s" : "",
    metrics.generated_tokens != null ? metrics.generated_tokens + " tokens" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function TranslatorWorkspace({
  status,
  settings,
  onSettingsChange,
  onDisable,
}: TranslatorWorkspaceProps) {
  const [sourceLanguage, setSourceLanguage] = useState("zh");
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [source, setSource] = useState("");
  const [translation, setTranslation] = useState("");
  const [sourcePreview, setSourcePreview] = useState(false);
  const [targetPreview, setTargetPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [progress, setProgress] = useState<StreamEvent | null>(null);
  const [metrics, setMetrics] = useState<TranslationMetrics | null>(null);

  const [message, setMessage] = useState("准备就绪");

  const sourceFontSize = autoFontSize(source, settings.autoFont);
  const targetFontSize = autoFontSize(translation, settings.autoFont);
  const canSwap = Boolean(source || translation);

  function swapLanguages() {
    setSourceLanguage(targetLanguage === "auto" ? "en" : targetLanguage);
    setTargetLanguage(sourceLanguage === "auto" ? "zh" : sourceLanguage);
    if (translation) {
      const oldSource = source;
      setSource(translation);
      setTranslation(oldSource);
    }
  }

  async function translate() {
    if (!source.trim() || busy) return;
    setBusy(true);
    setTranslation("");
    setMetrics(null);
    setProgress(null);

    setMessage("模型正在生成译文…");
    try {
      const normalized = normalizeForTranslation(source, settings.removeLineBreaks);
      await translateStream(
        {
          text: normalized,
          source_language: languageName(sourceLanguage),
          target_language: languageName(targetLanguage),
        },
        (event) => {
          if (event.type === "progress") setProgress(event);
          if (event.type === "retry") {
            setProgress(null);
            setMessage("正在安全重试");
          }
          if (event.type === "complete") {
            setTranslation(event.translation || "");
            setMetrics(event.metrics || null);
            setMessage(event.quality_issues?.length ? "完成 存在质量提示" : "翻译完成");
          }
          if (event.type === "error") {
            setMessage(event.message || "翻译失败");
          }
        },
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const speed = progress?.tokens_per_second != null ? Math.round(progress.tokens_per_second) : 0;
  const elapsed = progress?.elapsed_ms
    ? (progress.elapsed_ms / 1000).toFixed(1) + "s"
    : "准备中";

  return (
    <main className="translator-screen">
      <header className="app-header">
        <div className="brand">
          <span>Local AI Translator</span>
        </div>
        <div className="active-model">
          <span className="status-dot ready" />
          {status.active_model || status.resolved_model || status.model_configured}
        </div>
        <button type="button" className="secondary-button" onClick={() => setSettingsOpen(true)}>
          设置
        </button>
        <button type="button" className="secondary-button danger-button" onClick={onDisable}>
          关闭模型
        </button>
      </header>
      <div className="workspace-status">
        {busy ? "生成中 " + (progress?.estimated_tokens || 0) + " tokens" : message}
      </div>
      <div className={"workspace " + settings.layout}>
        <TextPane
          title="原文"
          language={sourceLanguage}
          value={source}
          preview={sourcePreview}
          fontSize={sourceFontSize}
          onLanguageChange={setSourceLanguage}
          onChange={setSource}
          onPreviewChange={setSourcePreview}
          onSubmit={() => void translate()}
        />
        <div className="swap-column">
          <button
            type="button"
            className="swap-button"
            disabled={!canSwap || busy}
            onClick={swapLanguages}
            title="交换语言和内容"
          >
            ⇄
          </button>
        </div>
        <TextPane
          title="译文"
          language={targetLanguage}
          value={translation}
          preview={targetPreview}
          fontSize={targetFontSize}
          readOnly
          onLanguageChange={setTargetLanguage}
          onPreviewChange={setTargetPreview}
        />
      </div>
      <footer className="translation-footer">
        <div className="progress-copy">
          {busy ? speed + " tokens/s · " + elapsed : completedMetrics(metrics)}
        </div>
        <button
          type="button"
          className="primary-button translate-button"
          disabled={busy || !source.trim()}
          onClick={() => void translate()}
        >
          {busy ? "翻译中…" : "开始翻译"}
          <span>Ctrl ↵</span>
        </button>
      </footer>
      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          onChange={onSettingsChange}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </main>
  );
}
