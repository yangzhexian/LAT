import { ModelDashboard } from "../model-monitor/ModelDashboard";
import { Button, DangerButton } from "../../components/Controls";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cancelTranslation, translateStream } from "../../lib/api";
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
  const historyPreferences = useRef(settings);
  historyPreferences.current = settings;
  const controller = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const checkpoint = useRef<{ id: string; identity: string } | null>(null);
  const [resumable, setResumable] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const normalized = normalizeForTranslation(source, settings.removeLineBreaks);
  const identity = JSON.stringify([normalized, sourceLanguage, targetLanguage, status.active_model || status.model_configured]);
  const canResume = resumable && checkpoint.current?.identity === identity;
  function clearCheckpoint() { checkpoint.current = null; setResumable(false); }
  async function cancel() {
    setCancelling(true);
    const activeController = controller.current;
    try {
      if (checkpoint.current) await cancelTranslation(checkpoint.current.id);
      activeController?.abort();
    } catch (error) {
      setMessage("取消请求失败，请重试：" + String(error));
    } finally { setCancelling(false); }
  }
  useEffect(() => () => controller.current?.abort(), []);
  async function refreshHistory() {
    try { setHistory(await readHistory()); setHistoryError(""); }
    catch { setHistoryError("无法读取本地历史记录"); }
  }
  useEffect(() => { if (page === "history") void refreshHistory(); }, [page]);
  useEffect(() => {
    void updateHistory({ trim: true }, settings.historyLimit ?? 30).then(refreshHistory).catch(() => setHistoryError("历史上限应用失败"));
  }, [settings.historyLimit]);
  async function removeHistory(id?: string) {
    try { await updateHistory(id ? { remove: id } : { clear: true }); await refreshHistory(); }
    catch { setHistoryError("历史记录更新失败"); }
  }
  function restoreHistory(row: TranslationHistory) {
    if (busyRef.current) return;
    clearCheckpoint();
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

  async function translate(restart = false) {
    if (!source.trim() || busyRef.current || !status.ready || modelBusy || sourceChars > inputLimit) return;
    busyRef.current = true;
    controller.current = new AbortController();
    setBusy(true);
    const resume = !restart && canResume ? checkpoint.current : null;
    if (!resume) { clearCheckpoint(); setTranslation(""); setMetrics(null); setProgress(null); }

    setMessage("模型正在生成译文…");
    try {

      let finalEvent: StreamEvent | null = null;
      await translateStream(
        {
          job_id: resume?.id,
          text: normalized,
          source_language: languageName(sourceLanguage),
          target_language: languageName(targetLanguage),
        },
        (event) => {
          if (event.type === "plan") {
            if (event.job_id) { checkpoint.current = { id: event.job_id, identity }; setResumable(true); }
            setTranslation(event.translation || "");
          }
          if (event.type === "waiting" || event.type === "cancelled") setMessage(event.message || "已暂停");
          if (event.type === "cancelled") setTranslation(event.translation || "");
          if (["plan", "attempt", "progress", "retry", "segment_complete", "cancelled", "complete"].includes(event.type)) setProgress((current) => ({ ...current, ...event }));
          if (event.type === "segment_complete") setTranslation((current) => current + (event.translation || ""));
          if (event.type === "retry") {
            setMessage("当前分段正在安全重试");
          }
          if (event.type === "complete") {
            finalEvent = event;
            clearCheckpoint();
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
      if (completed && (historyPreferences.current.saveHistory ?? true)) {
        try {
          await updateHistory({ add: {
            id: completed.job_id || crypto.randomUUID(), createdAt: Date.now(), source, submittedText: normalized,
            translation: completed.translation || "", sourceLanguage, targetLanguage,
            model: completed.model || status.active_model || status.model_configured,
            metrics: completed.metrics,
          } }, historyPreferences.current.historyLimit ?? 30);
          await refreshHistory();
        } catch { setMessage("翻译完成，但历史记录未能保存到本机"); }
      }
    } catch (error) {
      setMessage(controller.current?.signal.aborted ? "已取消，已完成分段保留，可继续翻译" : error instanceof Error ? error.message : String(error));
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
          <Button key={id} className={page === id ? "nav-item active" : "nav-item"} aria-label={label} title={label} aria-current={page === id ? "page" : undefined} onClick={() => setPage(id)}><Icon name={icon as IconName} /><span className="nav-tooltip">{label}</span></Button>
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
        <div className="header-action">{page === "history" ?
          <DangerButton disabled={!history.length} onClick={() => { if (window.confirm("清空全部翻译历史？此操作无法撤销。")) void removeHistory(); }}>清空历史</DangerButton> :
          <DangerButton disabled={busy || modelBusy || !status.ready} onClick={onDisable}>{modelBusy ? "正在关闭…" : "关闭模型"}</DangerButton>}
        </div>
      </header>
      {modelError && <div className="model-error" role="alert">{modelError}</div>}
      {page === "model" && <section className="model-page">{status.ready ? <ModelDashboard interval={settings.telemetryInterval} windowSeconds={settings.telemetryWindow} /> : setupContent}</section>}
      <div className="translation-page" hidden={page !== "translate"}>
      <div className="workspace-status" role="status">
        {busy || canResume ? `已完成 ${progress?.completed_chunks || 0}/${progress?.total_chunks || "…"} 段 · ${Math.floor((progress?.completed_chars || 0) / Math.max(1, progress?.total_chars || 1) * 100)}% · ${message}` : message}
      </div>
      {(busy || canResume) && <progress className="translation-progress" aria-label="翻译总进度" max={progress?.total_chars || 1} value={progress?.completed_chars || 0} />}
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
          <Button
            type="button"
            className="swap-button"
            disabled={!canSwap || busy}
            onClick={swapLanguages}
            title="交换语言和内容"
            aria-label="交换语言和内容"
          >
            <Icon name="swap" />
          </Button>
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
        {busy && <Button className="secondary-button" disabled={cancelling} onClick={() => void cancel()}>{cancelling ? "正在取消…" : "取消翻译"}</Button>}
        {canResume && !busy && <Button className="secondary-button" onClick={() => void translate(true)}>重新翻译</Button>}
        <Button
          type="button"
          className="primary-button translate-button"
          disabled={busy || modelBusy || !status.ready || !source.trim() || sourceChars > inputLimit}
          onClick={() => void translate()}
        >
          {busy ? "翻译中…" : canResume ? "继续翻译" : "开始翻译"}
          <span>Ctrl ↵</span>
        </Button>
      </footer>
      </div>
      {page === "settings" && <SettingsPanel settings={settings} onChange={onSettingsChange} onClose={() => setPage("translate")} />}
      {page === "history" && <section className="history-page">
        <p className="history-description">仅保存在本机 · 最近 {settings.historyLimit ?? 30} 条{settings.saveHistory === false ? " · 已暂停保存新记录" : ""}</p>
        {historyError && <p role="alert">{historyError}</p>}
        {!history.length && <p className="empty-hint">完成翻译后，记录会出现在这里。</p>}
        <div className="history-grid">{history.map((row) => <article className="history-card" key={row.id}>
          <div className="history-meta">{new Date(row.createdAt).toLocaleString()} · {row.sourceLanguage} → {row.targetLanguage} · {row.model}</div>
          <p className="history-excerpt">{row.source.slice(0, 180)}{row.source.length > 180 ? "…" : ""}</p>
          <details><summary>查看完整记录</summary><div className="history-comparison"><section><h3>原文 · {languageName(row.sourceLanguage)}</h3><div className="history-text">{row.source}</div></section><section><h3>译文 · {languageName(row.targetLanguage)}</h3><div className="history-text">{row.translation}</div></section></div></details>
          <div className="history-actions"><Button className="secondary-button" disabled={busy} onClick={() => restoreHistory(row)}>恢复到工作区</Button><Button className="mini-button" onClick={() => void removeHistory(row.id)}>删除</Button></div>
        </article>)}</div>
      </section>}
    </main>
  );
}
