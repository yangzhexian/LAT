import { useEffect, useRef, useState, type ReactNode } from "react";
import { translateStream } from "../../lib/api";
import { languageName } from "../../lib/languages";
import { normalizeForTranslation } from "../../lib/text";
import type {
  LocalStatus,
  StreamEvent,
  TranslationMetrics,
  UserSettings,
} from "../../types";
import { readHistory, updateHistory, type TranslationHistory } from "../../lib/history";
import { Icon, type IconName } from "../../components/Icon";
import { SettingsPanel } from "./SettingsPanel";
import { TextPane } from "./TextPane";

interface TranslatorWorkspaceProps {
  status: LocalStatus;
  settings: UserSettings;
  onSettingsChange: (next: Partial<UserSettings>) => void;
  onDisable: () => void;
  modelBusy?: boolean;
  setupContent?: ReactNode;
  modelError?: string;
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
  modelBusy = false,
  setupContent,
  modelError,
}: TranslatorWorkspaceProps) {
  const [sourceLanguage, setSourceLanguage] = useState("zh");
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [source, setSource] = useState("");
  const [translation, setTranslation] = useState("");
  const [sourcePreview, setSourcePreview] = useState(false);
  const [targetPreview, setTargetPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState<"translate" | "history" | "settings" | "model">(status.ready ? "translate" : "model");
  useEffect(() => { setPage(status.ready ? "translate" : "model"); }, [status.ready]);
  const [history, setHistory] = useState<TranslationHistory[]>([]);
  const [historyError, setHistoryError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  useEffect(() => () => controller.current?.abort(), []);
  async function refreshHistory() {
    try { setHistory(await readHistory()); setHistoryError(""); }
    catch { setHistoryError("无法读取本地历史记录"); }
  }
  useEffect(() => { if (page === "history") void refreshHistory(); }, [page]);
  async function removeHistory(id?: string) {
    try { await updateHistory(id ? { remove: id } : { clear: true }); await refreshHistory(); }
    catch { setHistoryError("历史记录更新失败"); }
  }
  function restoreHistory(row: TranslationHistory) {
    if (busyRef.current) return;
    setSource(row.source); setTranslation(row.translation);
    setSourceLanguage(row.sourceLanguage); setTargetLanguage(row.targetLanguage);
    setMetrics(row.metrics || null); setProgress(null); setMessage("已恢复历史记录"); setPage("translate");
  }
  const [progress, setProgress] = useState<StreamEvent | null>(null);
  const [metrics, setMetrics] = useState<TranslationMetrics | null>(null);

  const [message, setMessage] = useState("准备就绪");

  const sourceFontSize = autoFontSize(source, settings.autoFont);
  const targetFontSize = autoFontSize(translation, settings.autoFont);
  const canSwap = !busy;
  const inputLimit = status.max_input_chars || 100000;
  const sourceChars = Array.from(source).length;

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
    if (!source.trim() || busyRef.current || !status.ready || modelBusy || sourceChars > inputLimit) return;
    busyRef.current = true;
    controller.current = new AbortController();
    setBusy(true);
    setTranslation("");
    setMetrics(null);
    setProgress(null);

    setMessage("模型正在生成译文…");
    try {
      const normalized = normalizeForTranslation(source, settings.removeLineBreaks);
      let finalEvent: StreamEvent | null = null;
      await translateStream(
        {
          text: normalized,
          source_language: languageName(sourceLanguage),
          target_language: languageName(targetLanguage),
        },
        (event) => {
          if (["plan", "attempt", "progress", "segment_complete", "complete"].includes(event.type)) setProgress((current) => ({ ...current, ...event }));
          if (event.type === "segment_complete") setTranslation((current) => current + (event.translation || ""));
          if (event.type === "retry") {
            setMessage("当前分段正在安全重试");
          }
          if (event.type === "complete") {
            finalEvent = event;
            setTranslation(event.translation || "");
            setMetrics(event.metrics || null);
            setMessage(event.quality_issues?.length ? "完成 存在质量提示" : "翻译完成");
          }
          if (event.type === "error") {
            setMessage(event.message || "翻译失败");
          }
        },
        controller.current.signal,
      );
      const completed = finalEvent as StreamEvent | null;
      if (completed) {
        try {
          await updateHistory({ add: {
            id: crypto.randomUUID(), createdAt: Date.now(), source, submittedText: normalized,
            translation: completed.translation || "", sourceLanguage, targetLanguage,
            model: completed.model || status.active_model || status.model_configured,
            metrics: completed.metrics,
          } });
          await refreshHistory();
        } catch { setMessage("翻译完成，但历史记录未能保存到本机"); }
      }
    } catch (error) {
      setMessage(controller.current?.signal.aborted ? "已取消，保留已完成分段（译文未完成）" : error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      busyRef.current = false;
      controller.current = null;
    }
  }

  const speed = progress?.tokens_per_second != null ? Math.round(progress.tokens_per_second) : 0;
  const elapsed = progress?.elapsed_ms
    ? (progress.elapsed_ms / 1000).toFixed(1) + "s"
    : "准备中";

  return (
    <main className="translator-screen">
      <nav className="side-nav" aria-label="主导航">
        <span className="nav-brand">LAT</span>
        {([['translate', 'translate', '翻译'], ['history', 'history', '历史记录'], ['model', 'model', '模型'], ['settings', 'settings', '设置']] as const).map(([id, icon, label]) => (
          <button key={id} className={page === id ? "nav-item active" : "nav-item"} aria-label={label} title={label} aria-current={page === id ? "page" : undefined} onClick={() => setPage(id)}><Icon name={icon as IconName} /><span className="nav-tooltip">{label}</span></button>
        ))}
      </nav>
      <header className="app-header">
        <div className="brand">
          <span>{{ translate: "翻译工作区", history: "翻译历史", model: "本地模型", settings: "偏好设置" }[page]}<small>Local AI Translator</small></span>
        </div>
        <div className="active-model">
          <span className={"status-dot " + (status.ready ? "ready" : "")} />
          <span>{status.active_model || status.resolved_model || status.model_configured}<small>{status.ready ? "本地运行 · 已就绪" : "模型未启用"}</small></span>
        </div>
        <button type="button" className="secondary-button danger-button" disabled={busy || modelBusy || !status.ready} onClick={onDisable}>
          {modelBusy ? "正在关闭…" : "关闭模型"}
        </button>
      </header>
      {modelError && <div className="model-error" role="alert">{modelError}</div>}
      {page === "model" && <section className="model-page">{setupContent || <p className="empty-hint">模型已启用。关闭当前模型后，可选择其他模型。</p>}</section>}
      <div className="translation-page" hidden={page !== "translate"}>
      <div className="workspace-status" role="status">
        {busy ? `已完成 ${progress?.completed_chunks || 0}/${progress?.total_chunks || "…"} 段 · ${Math.floor((progress?.completed_chars || 0) / Math.max(1, progress?.total_chars || 1) * 100)}% · ${message}` : message}
      </div>
      {busy && <progress className="translation-progress" aria-label="翻译总进度" max={progress?.total_chars || 1} value={progress?.completed_chars || 0} />}
      <div className={"workspace " + settings.layout}>
        <TextPane
          title="原文"
          languageDisabled={busy}
          language={sourceLanguage}
          value={source}
          preview={sourcePreview}
          fontSize={sourceFontSize}
          onLanguageChange={(value) => { if (!busy) setSourceLanguage(value); }}
          readOnly={busy}
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
            aria-label="交换语言和内容"
          >
            <Icon name="swap" />
          </button>
        </div>
        <TextPane
          title="译文"
          languageDisabled={busy}
          language={targetLanguage}
          value={translation}
          preview={targetPreview}
          fontSize={targetFontSize}
          readOnly
          onLanguageChange={(value) => { if (!busy) setTargetLanguage(value); }}
          onPreviewChange={setTargetPreview}
        />
      </div>
      <footer className="translation-footer">
        <div className="progress-copy">
          <span>{sourceChars.toLocaleString()} / {inputLimit.toLocaleString()} 字符{sourceChars > inputLimit ? " · 超过输入上限" : ""}</span><br />
          {busy ? "约 " + speed + " tokens/s · " + elapsed : completedMetrics(metrics)}
        </div>
        {busy && <button className="secondary-button" onClick={() => controller.current?.abort()}>取消翻译</button>}
        <button
          type="button"
          className="primary-button translate-button"
          disabled={busy || modelBusy || !status.ready || !source.trim() || sourceChars > inputLimit}
          onClick={() => void translate()}
        >
          {busy ? "翻译中…" : "开始翻译"}
          <span>Ctrl ↵</span>
        </button>
      </footer>
      </div>
      {page === "settings" && <SettingsPanel settings={settings} onChange={onSettingsChange} onClose={() => setPage("translate")} />}
      {page === "history" && <section className="history-page">
        <header className="settings-header"><div><p className="settings-kicker">LOCAL HISTORY</p><h2>翻译历史</h2><p>仅保存在本机 · 最近 30 条</p></div>
          <button className="secondary-button" disabled={!history.length} onClick={() => { if (window.confirm("清空全部翻译历史？此操作无法撤销。")) void removeHistory(); }}>清空历史</button></header>
        {historyError && <p role="alert">{historyError}</p>}
        {!history.length && <p className="empty-hint">完成翻译后，记录会出现在这里。</p>}
        {history.map((row) => <article className="history-card" key={row.id}>
          <div className="history-meta">{new Date(row.createdAt).toLocaleString()} · {row.sourceLanguage} → {row.targetLanguage} · {row.model}</div>
          <p>{row.source.slice(0, 180)}{row.source.length > 180 ? "…" : ""}</p>
          <details><summary>查看完整记录</summary><div className="history-text">{row.source}</div><hr /><div className="history-text">{row.translation}</div></details>
          <div className="history-actions"><button className="secondary-button" disabled={busy} onClick={() => restoreHistory(row)}>恢复到工作区</button><button className="mini-button" onClick={() => void removeHistory(row.id)}>删除</button></div>
        </article>)}
      </section>}
    </main>
  );
}
