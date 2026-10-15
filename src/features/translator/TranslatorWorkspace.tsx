import { ModelDashboard } from "../model-monitor/ModelDashboard";
import { ModelArchitecturePage } from "../model-architecture/ModelArchitecturePage";
import { Button, DangerButton, Notice } from "../../components/Controls";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cancelTranslation, translateStream } from "../../lib/api";
import { languageName } from "../../lib/languages";
import { normalizeForTranslation } from "../../lib/text";
import { createProgressBatch, unicodeLength } from "../../lib/translationUpdates";
import type {
  LocalStatus,
  StreamEvent,
  TranslationMetrics,
  UserSettings,
} from "../../types";
import { getHistoryStats, updateHistory, type TranslationHistory } from "../../lib/history";
import { Icon, type IconName } from "../../components/Icon";
import { HistoryPage } from "../history/HistoryPage";
import { SettingsPanel } from "./SettingsPanel";
import { TextPane } from "./TextPane";
import type { SelectionTransfer } from "../../lib/selectionIntegration";

interface TranslatorWorkspaceProps {
  status: LocalStatus;
  settings: UserSettings;
  onSettingsChange: (next: Partial<UserSettings>) => void;
  onDisable: () => void;
  modelBusy?: boolean;
  setupContent?: ReactNode;
  modelError?: string;
  selectionTransfer?: SelectionTransfer | null;
  selectionError?: string;
  selectionPaused?: boolean;
  selectionBusy?: boolean;
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
  selectionTransfer,
  selectionError,
  selectionPaused,
  selectionBusy = false,
}: TranslatorWorkspaceProps) {
  const [sourceLanguage, setSourceLanguage] = useState("zh");
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [source, setSource] = useState("");
  const [translation, setTranslation] = useState("");
  const [sourcePreview, setSourcePreview] = useState(false);
  const [targetPreview, setTargetPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState<"translate" | "history" | "settings" | "model" | "architecture">(status.ready ? "translate" : "model");
  useEffect(() => { setPage((current) => current === "architecture" ? current : status.ready ? "translate" : "model"); }, [status.ready]);
  const [historyCount, setHistoryCount] = useState(0);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [historyUpdating, setHistoryUpdating] = useState(false);
  const historyUpdateLock = useRef(false);
  const historyTrimPending = useRef(false);
  const failedHistoryAction = useRef<{ clear: true } | { trim: true } | null>(null);
  const [pendingHistory, setPendingHistory] = useState<TranslationHistory[]>([]);
  const appliedHistoryLimits = useRef([settings.historyLimit ?? 30, settings.historyStorageMiB ?? 64]);
  const [historyError, setHistoryError] = useState("");
  const historyPreferences = useRef(settings);
  historyPreferences.current = settings;
  const controller = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const checkpoint = useRef<{ id: string; identity: string } | null>(null);
  const [resumable, setResumable] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const identity = useMemo(() => JSON.stringify([source, settings.removeLineBreaks, sourceLanguage, targetLanguage, status.active_model || status.model_configured]), [source, settings.removeLineBreaks, sourceLanguage, targetLanguage, status.active_model, status.model_configured]);
  const canResume = resumable && checkpoint.current?.identity === identity;
  function clearCheckpoint() { checkpoint.current = null; setResumable(false); }
  async function cancel() {
    setCancelling(true);
    const activeController = controller.current;
    try {
      if (checkpoint.current) await cancelTranslation(checkpoint.current.id);
      activeController?.abort();
    } catch (error) {
      if (controller.current === activeController) setMessage("取消请求失败，请重试：" + String(error));
    } finally { setCancelling(false); }
  }
  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);
  async function refreshHistory() {
    setHistoryRevision((value) => value + 1);
    try {
      setHistoryCount((await getHistoryStats()).count);
      if (!failedHistoryAction.current) setHistoryError("");
    }
    catch { setHistoryError("无法读取本地历史统计"); }
  }
  useEffect(() => { if (page === "history") void refreshHistory(); }, [page]);
  useEffect(() => {
    const refresh = () => { void refreshHistory(); };
    window.addEventListener("lat-history-changed", refresh);
    return () => window.removeEventListener("lat-history-changed", refresh);
  }, []);
  function finishHistoryUpdate() {
    historyUpdateLock.current = false; setHistoryUpdating(false);
    if (historyTrimPending.current) { historyTrimPending.current = false; void applyHistoryAction({ trim: true }); }
  }
  async function applyHistoryAction(action: { clear: true } | { trim: true }) {
    if (historyUpdateLock.current) { if ("trim" in action) historyTrimPending.current = true; return; }
    historyUpdateLock.current = true; setHistoryUpdating(true);
    try {
      await updateHistory(action, historyPreferences.current.historyLimit ?? 30, (historyPreferences.current.historyStorageMiB ?? 64) * 1048576);
      failedHistoryAction.current = null; setHistoryError(""); await refreshHistory();
    } catch {
      failedHistoryAction.current = action;
      setHistoryError("历史记录更新失败，已有记录仍保留，请重试。");
    } finally { finishHistoryUpdate(); }
  }
  useEffect(() => { void refreshHistory(); }, []);
  useEffect(() => {
    const limits = [settings.historyLimit ?? 30, settings.historyStorageMiB ?? 64];
    if (limits.every((value, index) => value === appliedHistoryLimits.current[index])) return;
    appliedHistoryLimits.current = limits;
    void applyHistoryAction({ trim: true });
  }, [settings.historyLimit, settings.historyStorageMiB]);
  async function removeHistory(id: string) {
    if (busyRef.current || modelBusy || selectionBusy || historyUpdateLock.current) return;
    historyUpdateLock.current = true; setHistoryUpdating(true);
    try {
      await updateHistory({ remove: id }, historyPreferences.current.historyLimit ?? 30, (historyPreferences.current.historyStorageMiB ?? 64) * 1048576);
      setHistoryError(""); await refreshHistory();
    } finally { finishHistoryUpdate(); }
  }
  async function retryHistorySave() {
    const record = pendingHistory[0];
    if (!record || historyUpdateLock.current) return;
    historyUpdateLock.current = true; setHistoryUpdating(true);
    try {
      await updateHistory({ add: record }, historyPreferences.current.historyLimit ?? 30, (historyPreferences.current.historyStorageMiB ?? 64) * 1048576);
      setPendingHistory((current) => current.filter((row) => row.id !== record.id)); setMessage("历史记录已保存到本机"); await refreshHistory();
    } catch { setMessage("历史记录仍未保存，可再次重试；工作区全文保留。"); }
    finally { finishHistoryUpdate(); }
  }
  function restoreHistory(row: TranslationHistory) {
    if (busyRef.current || modelBusy || selectionBusy) return;
    clearCheckpoint();
    setSource(row.source); setTranslation(row.translation);
    setSourceLanguage(row.sourceLanguage); setTargetLanguage(row.targetLanguage);
    setMetrics(row.metrics || null); setProgress(null); setMessage("已恢复历史记录"); setPage("translate");
  }
  const [progress, setProgress] = useState<StreamEvent | null>(null);
  const [metrics, setMetrics] = useState<TranslationMetrics | null>(null);

  const [message, setMessage] = useState("准备就绪");
  const handledTransfer = useRef<number | null>(null);
  useEffect(() => {
    if (!selectionTransfer || handledTransfer.current === selectionTransfer.id) return;
    handledTransfer.current = selectionTransfer.id;
    if (selectionTransfer.text === undefined) { setPage("model"); return; }
    if (busyRef.current || modelBusy) { setMessage("当前任务仍在进行，请完成后再次转入划词内容"); return; }
    if ((source || translation) && !window.confirm("用划词内容替换当前工作区？当前原文和译文将被替换。")) return;
    clearCheckpoint();
    setSource(selectionTransfer.text); setTranslation("");
    setSourceLanguage("auto"); setTargetLanguage(settings.selectionTargetLanguage || "zh");
    setMetrics(null); setProgress(null); setPage("translate"); setMessage("已转入划词内容，可开始翻译");
    if (window.__TAURI_INTERNALS__) void import("@tauri-apps/api/core").then(({ invoke }) => invoke("selection_dismiss")).catch(() => {});
  }, [selectionTransfer]);

  const sourceFontSize = autoFontSize(source, settings.autoFont);
  const targetFontSize = autoFontSize(translation, settings.autoFont);
  const canSwap = !busy && !modelBusy && !selectionBusy;
  const inputLimit = status.max_input_chars || 100000;
  const sourceChars = useMemo(() => unicodeLength(source), [source]);
  const hasSource = useMemo(() => Boolean(source.trim()), [source]);
  const changeSourceLanguage = useCallback((value: string) => { if (!busy) setSourceLanguage(value); }, [busy]);
  const changeTargetLanguage = useCallback((value: string) => { if (!busy) setTargetLanguage(value); }, [busy]);
  const submitRef = useRef<() => void>(() => {});
  submitRef.current = () => { void translate(); };
  const submit = useCallback(() => submitRef.current(), []);

  function swapLanguages() {
    if (!canSwap) return;
    setSourceLanguage(targetLanguage === "auto" ? "en" : targetLanguage);
    setTargetLanguage(sourceLanguage === "auto" ? "zh" : sourceLanguage);
    if (translation) {
      const oldSource = source;
      setSource(translation);
      setTranslation(oldSource);
    }
  }

  async function translate(restart = false) {
    if (!hasSource || busyRef.current || !status.ready || modelBusy || sourceChars > inputLimit) return;
    busyRef.current = true;
    const activeController = new AbortController();
    controller.current = activeController;
    const isCurrent = () => controller.current === activeController;
    const progressBatch = createProgressBatch((event) => {
      if (isCurrent()) setProgress((current) => ({ ...current, ...event }));
    });
    let terminal = false;
    const normalized = normalizeForTranslation(source, settings.removeLineBreaks);
    setBusy(true);
    const resume = !restart && canResume ? checkpoint.current : null;
    if (!resume) { clearCheckpoint(); setTranslation(""); setMetrics(null); setProgress(null); }

    setMessage("模型正在生成译文…");
    try {

      let finalEvent: StreamEvent | null = null;
      await translateStream(
        {
          job_id: resume?.id,
          request_source: "workspace",
          text: normalized,
          source_language: languageName(sourceLanguage),
          target_language: languageName(targetLanguage),
        },
        (event) => {
          if (!isCurrent() || activeController.signal.aborted || terminal) return;
          if (["complete", "cancelled", "error"].includes(event.type)) terminal = true;
          progressBatch.push(event);
          if ((event.type === "plan" || event.type === "waiting") && event.job_id) {
            checkpoint.current = { id: event.job_id, identity }; setResumable(true);
          }
          if (event.type === "plan") {
            setTranslation(event.translation || "");
          }
          if (event.type === "waiting") setMessage(event.message || (event.queue_position != null ? `等待模型空闲 · 排队位置 ${event.queue_position}` : "等待模型空闲"));
          if (event.type === "attempt" || event.type === "segment_complete") setMessage("模型正在生成译文…");
          if (event.type === "cancelled") setMessage(event.message || "已暂停，已完成分段保留，可继续翻译");
          if (event.type === "cancelled" && event.translation !== undefined) setTranslation(event.translation);
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
        activeController.signal,
      );
      const completed = finalEvent as StreamEvent | null;
      if (isCurrent() && completed && (historyPreferences.current.saveHistory ?? true)) {
        const record: TranslationHistory = {
            origin: "workspace",
            id: completed.job_id || crypto.randomUUID(), createdAt: Date.now(), source, submittedText: normalized,
            translation: completed.translation || "", sourceLanguage, targetLanguage,
            model: completed.model || status.active_model || status.model_configured,
            metrics: completed.metrics,
        };
        try {
          await updateHistory({ add: record }, historyPreferences.current.historyLimit ?? 30, (historyPreferences.current.historyStorageMiB ?? 64) * 1048576);
          setPendingHistory((current) => current.filter((row) => row.id !== record.id)); await refreshHistory();
        } catch { setPendingHistory((current) => [...current.filter((row) => row.id !== record.id), record]); setMessage("翻译完成，但历史记录未能保存到本机"); }
      }
    } catch (error) {
      if (isCurrent()) setMessage(activeController.signal.aborted ? "已取消，已完成分段保留，可继续翻译" : error instanceof Error ? error.message : String(error));
    } finally {
      progressBatch.flush();
      progressBatch.dispose();
      if (isCurrent()) {
        setBusy(false);
        busyRef.current = false;
        controller.current = null;
      }
    }
  }

  const speed = progress?.tokens_per_second != null ? Math.round(progress.tokens_per_second) : 0;
  const elapsed = progress?.elapsed_ms
    ? (progress.elapsed_ms / 1000).toFixed(1) + "s"
    : "准备中";

  return (
    <main className="translator-screen" data-page={page}>
      <nav className="side-nav" aria-label="主导航">
        <span className="nav-brand">LAT</span>
        {([['translate', 'translate', '翻译'], ['history', 'history', '历史记录'], ['model', 'model', '模型'], ['architecture', 'architecture', '模型架构'], ['settings', 'settings', '设置']] as const).map(([id, icon, label]) => (
          <Button key={id} className={page === id ? "nav-item active" : "nav-item"} aria-label={label} title={label} aria-current={page === id ? "page" : undefined} onClick={() => setPage(id)}><Icon name={icon as IconName} /><span className="nav-tooltip">{label}</span></Button>
        ))}
      </nav>
      <header className="app-header">
        <div className="brand">
          <span>{{ translate: "翻译工作区", history: "翻译历史", model: "本地模型", architecture: "模型架构", settings: "偏好设置" }[page]}<small>Local AI Translator</small></span>
        </div>
        <div className="active-model">
          <span className={"status-dot " + (status.ready ? "ready" : "")} />
          <span>{status.active_model || status.resolved_model || status.model_configured}<small>{status.ready ? "本地运行 · 已就绪" : "模型未启用"}</small></span>
        </div>
        <div className="header-action">{page === "history" ?
          <DangerButton disabled={!historyCount || busy || modelBusy || selectionBusy || historyUpdating} onClick={() => { if (!busyRef.current && !modelBusy && !selectionBusy && window.confirm("清空全部翻译历史？此操作无法撤销。")) void applyHistoryAction({ clear: true }); }}>清空历史</DangerButton> :
          <DangerButton disabled={busy || modelBusy || selectionBusy || !status.ready} onClick={onDisable}>{modelBusy ? "正在关闭…" : selectionBusy ? "划词翻译中" : "关闭模型"}</DangerButton>}
        </div>
      </header>
      {modelError && <div className="model-error" role="alert">{modelError}</div>}
      {page === "model" && <section className="model-page">{status.ready ? <ModelDashboard interval={settings.telemetryInterval} windowSeconds={settings.telemetryWindow} reduceMotion={settings.reduceMotion} /> : setupContent}</section>}
      {page === "architecture" && <section className="architecture-page"><ModelArchitecturePage interval={settings.telemetryInterval} reduceMotion={settings.reduceMotion} /></section>}
      <div className="translation-page" hidden={page !== "translate"}>
      <div className="workspace-status" role="status">
        {busy || canResume ? `已完成 ${progress?.completed_chunks || 0}/${progress?.total_chunks || "…"} 段 · ${Math.floor((progress?.completed_chars || 0) / Math.max(1, progress?.total_chars || 1) * 100)}% · ${message}` : message}
      </div>
      {pendingHistory.length > 0 && <Notice tone="error">有 {pendingHistory.length} 条完整翻译待保存，可逐条重试；退出应用后未保存的记录将丢失。<Button disabled={busy || historyUpdating} onClick={() => void retryHistorySave()}>重试保存历史</Button></Notice>}
      {(busy || canResume) && <progress className="translation-progress" aria-label="翻译总进度" max={progress?.total_chars || 1} value={progress?.completed_chars || 0} />}
      <div className={"workspace " + settings.layout}>
        <TextPane
          title="原文"
          languageDisabled={busy}
          language={sourceLanguage}
          value={source}
          preview={sourcePreview}
          visible={page === "translate"}
          fontSize={sourceFontSize}
          onLanguageChange={changeSourceLanguage}
          readOnly={busy}
          onChange={setSource}
          onPreviewChange={setSourcePreview}
          onSubmit={submit}
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
          visible={page === "translate"}
          fontSize={targetFontSize}
          readOnly
          onLanguageChange={changeTargetLanguage}
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
          disabled={busy || modelBusy || !status.ready || !hasSource || sourceChars > inputLimit}
          onClick={() => void translate()}
        >
          {busy ? "翻译中…" : canResume ? "继续翻译" : "开始翻译"}
          <span>Ctrl ↵</span>
        </Button>
      </footer>
      </div>
      {page === "settings" && <SettingsPanel settings={settings} onChange={onSettingsChange} onClose={() => setPage("translate")} selectionError={selectionError} selectionPaused={selectionPaused} />}
      {page === "history" && <HistoryPage settings={settings} revision={historyRevision} busy={busy || modelBusy || selectionBusy || historyUpdating} error={historyError} onRetry={() => { if (failedHistoryAction.current) void applyHistoryAction(failedHistoryAction.current); else void refreshHistory(); }} onRestore={restoreHistory} onRemove={removeHistory} />}
    </main>
  );
}
