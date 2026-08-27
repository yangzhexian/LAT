import { useEffect, useRef, useState, type ReactNode } from "react";
import { MathJaxContext } from "better-react-mathjax";
import { LatexPreview } from "./components/LatexPreview";
import { cancelDownload, downloadModelStream, ensureGateway, getDownloadEnvironment, getStatus, loadModel, selectDataDirectory, setDataDirectory, translateStream, unloadModel } from "./lib/api";
import { LANGUAGES, languageName } from "./lib/languages";
import { formatBytes, normalizeForTranslation } from "./lib/text";
import type { AppScreen, DownloadEnvironment, DownloadEvent, LocalModel, LocalStatus, StreamEvent, TranslationMetrics, UserSettings } from "./types";
import "./styles.css";

const SETTINGS_KEY = "lat.settings.v1";
const DOWNLOAD_MODEL = "hy-mt2-7b:q6_k";
const DEFAULT_SETTINGS: UserSettings = { theme: "light", layout: "horizontal", autoFont: true, removeLineBreaks: false, dataDirectory: "" };

const mathJaxConfig = {
  tex: { inlineMath: [["$", "$"], ["\\(", "\\)"]], displayMath: [["$$", "$$"], ["\\[", "\\]"]], processEscapes: true },
  chtml: { mtextInheritFont: true },
  options: { skipHtmlTags: ["script", "noscript", "style", "textarea", "pre", "code"] },
};

function readSettings(): UserSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    return stored ? { ...DEFAULT_SETTINGS, ...(JSON.parse(stored) as Partial<UserSettings>) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function useAutoFontSize(value: string, enabled: boolean): number {
  if (!enabled) return 17;
  return Math.max(14, Math.min(22, 22 - Math.log10(Math.max(1, value.length)) * 2.1));
}

function modelLabel(model: LocalModel): string {
  const quant = model.details?.quantization_level;
  return quant ? model.name + " · " + quant : model.name;
}

interface DownloadState {
  busy: boolean;
  percent: number;
  phase: string;
  status: string;
  error: string;
  speedMiB: number;
  fileIndex: number;
  fileCount: number;
  fileName: string;
  cancelRequested: boolean;
  environment: DownloadEnvironment | null;
}

function LanguageSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)}>{LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.label} · {language.name}</option>)}</select>;
}

function ModelSelector({ status, selectedModel, loading, dataDirectory, defaultDataDirectory, directoryDraft, customDirectoryOpen, onSelect, onEnable, onDownload, onCancelDownload, onOpenCustomDirectory, onDirectoryDraftChange, onApplyDirectory, onChooseDirectory, onRefresh, download }: {
  status: LocalStatus | null; selectedModel: string; loading: boolean; dataDirectory: string; defaultDataDirectory: string; directoryDraft: string; customDirectoryOpen: boolean;
  onSelect: (value: string) => void; onEnable: () => void; onDownload: () => void; onCancelDownload: () => void; onOpenCustomDirectory: () => void; onDirectoryDraftChange: (value: string) => void; onApplyDirectory: () => void; onChooseDirectory: () => void; onRefresh: () => void; download: DownloadState;
}) {
  const models = status?.models || [];
  const installed = Boolean(status?.model?.verified);
  const displayedDirectory = dataDirectory || defaultDataDirectory;
  return (
    <section className="select-screen">
      <img className="hero-icon" src="/lat-icon.svg" alt="LAT" />
      <p className="eyebrow">LOCAL TRANSLATION WORKSPACE</p>
      <h1>选择本地模型</h1>
      <p className="subtitle">模型不会离开本机 启用后即可进入 LAT 翻译工作区</p>
      <div className="service-pill"><span className={"status-dot " + (status?.runtime?.installed ? "ready" : "")} />{status?.runtime?.installed ? "llama.cpp " + (status.version || "已安装") : "需要安装 llama.cpp"}<button className="text-button" onClick={onRefresh}>刷新</button></div>
      <div className="model-list">
        {models.map((model) => <button key={model.name} className={"model-card " + (selectedModel === model.name ? "selected" : "")} onClick={() => onSelect(model.name)}><span className="model-icon">◈</span><span className="model-copy"><strong>{modelLabel(model)}</strong><small>{formatBytes(model.size)} · GGUF</small></span><span className="model-check">{selectedModel === model.name ? "✓" : ""}</span></button>)}
      </div>

      {!installed && <div className="download-card">
        <div className="download-card-header"><div><strong>安装 llama.cpp 并下载 Hy-MT2 Q6_K</strong><small>运行时和模型会保存到本机数据目录</small></div></div>
        {download.environment && <div className={"environment-note " + download.environment.status}><strong>{download.environment.message}</strong>{download.environment.best_gpu && <small>{download.environment.best_gpu.name} · 总显存 {download.environment.best_gpu.total_vram_gib.toFixed(2)} GiB</small>}{download.environment.suggestion && <span>{download.environment.suggestion}</span>}</div>}
        {download.error && <div className="error-banner">{download.error}</div>}
        {download.busy && <div className="download-progress"><div className="download-progress-label"><span>{download.phase ? download.phase + " · " : ""}{download.status || "准备下载"}{download.fileName ? " · " + download.fileName : ""}</span><span>{download.fileCount > 0 ? "共 " + download.fileCount + " 项 · " : ""}{download.percent.toFixed(1)}% · {download.speedMiB.toFixed(2)} MiB/s</span></div><div className="progress-track"><span style={{ width: Math.max(2, download.percent) + "%" }} /></div></div>}
        <div className="download-action-row"><button className="custom-directory-toggle" disabled={loading || download.busy} onClick={onOpenCustomDirectory}>{customDirectoryOpen ? "收起自定义模型路径" : "自定义模型路径"}</button><button className={download.busy ? "cancel-button" : "secondary-button download-button"} disabled={download.cancelRequested} onClick={download.busy ? onCancelDownload : onDownload}>{download.busy ? (download.cancelRequested ? "正在停止…" : "终止下载") : "开始下载"}</button></div>
        {customDirectoryOpen && <div className="custom-directory-panel"><div className="directory-input-row"><input className="directory-input" value={directoryDraft} placeholder={defaultDataDirectory || ".lat-runtime"} disabled={loading || download.busy} onChange={(event) => onDirectoryDraftChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onApplyDirectory(); }} aria-label="自定义模型路径" /><button className="folder-button" disabled={loading || download.busy} onClick={onChooseDirectory} aria-label="选择模型目录" title="选择目录"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5h6l1.7 2h9.3v9.8a1.2 1.2 0 0 1-1.2 1.2H4.7a1.2 1.2 0 0 1-1.2-1.2z" /><path d="M3.5 6.5V5.8a1.3 1.3 0 0 1 1.3-1.3h4.2l1.6 2h8.7a1.2 1.2 0 0 1 1.2 1.2v.8" /></svg></button></div><div className="custom-directory-footer"><small>{displayedDirectory ? "当前目录 " + displayedDirectory : "默认目录为安装路径下的 .lat-runtime"}</small><button className="text-button" disabled={loading || download.busy} onClick={onApplyDirectory}>应用路径</button></div></div>}
      </div>}

      <button className="primary-button enable-button" disabled={!selectedModel || loading || !models.length} onClick={onEnable}>{loading ? "正在启用模型…" : "启用模型"}</button>
      <p className="caption">当前针对 Hy-MT2 翻译策略进行了优化 其他模型仍可发现和尝试</p>
    </section>
  );
}
function TextPane({ title, language, value, preview, fontSize, readOnly, onLanguageChange, onChange, onPreviewChange }: {
  title: string; language: string; value: string; preview: boolean; fontSize: number; readOnly?: boolean;
  onLanguageChange: (value: string) => void; onChange?: (value: string) => void; onPreviewChange: (value: boolean) => void;
}) {
  return <section className="text-pane"><header className="pane-header"><div><span className="pane-title">{title}</span><LanguageSelect value={language} onChange={onLanguageChange} /></div><div className="pane-actions"><button className={"mini-button " + (!preview ? "active" : "")} onClick={() => onPreviewChange(false)}>文本</button><button className={"mini-button " + (preview ? "active" : "")} onClick={() => onPreviewChange(true)}>LaTeX 预览</button></div></header>{preview ? <LatexPreview value={value} /> : <textarea className="text-editor" style={{ fontSize }} value={value} readOnly={readOnly} onChange={(event) => onChange?.(event.target.value)} placeholder={readOnly ? "译文会显示在这里" : "输入或粘贴需要翻译的文本"} spellCheck={false} />}</section>;
}

function SettingsPanel({ settings, onChange, onClose }: { settings: UserSettings; onChange: (next: Partial<UserSettings>) => void; onClose: () => void }) {
  return <div className="settings-backdrop" onMouseDown={onClose}><section className="settings-panel" role="dialog" aria-modal="true" aria-label="设置" onMouseDown={(event) => event.stopPropagation()}><header className="settings-header"><div><p className="settings-kicker">LAT SETTINGS</p><h2>设置</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭设置">×</button></header><div className="settings-section"><h3>主题</h3><div className="segmented-control"><button className={settings.theme === "dark" ? "active" : ""} onClick={() => onChange({ theme: "dark" })}>深色</button><button className={settings.theme === "light" ? "active" : ""} onClick={() => onChange({ theme: "light" })}>浅色</button></div></div><div className="settings-section"><h3>排版</h3><div className="segmented-control"><button className={settings.layout === "horizontal" ? "active" : ""} onClick={() => onChange({ layout: "horizontal" })}>左右</button><button className={settings.layout === "vertical" ? "active" : ""} onClick={() => onChange({ layout: "vertical" })}>上下</button></div></div><div className="settings-section"><h3>文本处理</h3><label className="setting-toggle"><span>自动字体</span><input type="checkbox" checked={settings.autoFont} onChange={(event) => onChange({ autoFont: event.target.checked })} /></label><label className="setting-toggle"><span>合并换行</span><input type="checkbox" checked={settings.removeLineBreaks} onChange={(event) => onChange({ removeLineBreaks: event.target.checked })} /></label></div><p className="settings-note">设置会自动保存到本机</p></section></div>;
}

function TranslatorWorkspace({ status, settings, onSettingsChange, onDisable }: { status: LocalStatus; settings: UserSettings; onSettingsChange: (next: Partial<UserSettings>) => void; onDisable: () => void }) {
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
  const sourceFontSize = useAutoFontSize(source, settings.autoFont);
  const targetFontSize = useAutoFontSize(translation, settings.autoFont);
  const canSwap = Boolean(source || translation);
  const sourceName = languageName(sourceLanguage);
  const targetName = languageName(targetLanguage);

  function swapLanguages() {
    setSourceLanguage(targetLanguage === "auto" ? "en" : targetLanguage);
    setTargetLanguage(sourceLanguage === "auto" ? "zh" : sourceLanguage);
    if (translation) { const oldSource = source; setSource(translation); setTranslation(oldSource); }
  }

  async function translate() {
    if (!source.trim() || busy) return;
    setBusy(true); setTranslation(""); setMetrics(null); setProgress(null); setMessage("模型正在生成译文…");
    try {
      const normalized = normalizeForTranslation(source, settings.removeLineBreaks);
      await translateStream({ text: normalized, source_language: sourceName, target_language: targetName }, (event) => {
        setProgress(event);
        if (event.type === "retry") setMessage("正在安全重试");
        if (event.type === "complete") { setTranslation(event.translation || ""); setMetrics(event.metrics || null); setMessage(event.quality_issues?.length ? "完成 存在质量提示" : "翻译完成"); }
        if (event.type === "error") setMessage(event.message || "翻译失败");
      });
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  }

  const speed = progress?.tokens_per_second?.toFixed(2) || "0.00";
  const elapsed = progress?.elapsed_ms ? (progress.elapsed_ms / 1000).toFixed(1) + "s" : "准备中";
  const doneMetrics = metrics?.tokens_per_second ? metrics.tokens_per_second.toFixed(2) + " tokens/s · " + (metrics.generated_tokens || 0) + " tokens" : "";

  return <main className="translator-screen"><header className="app-header"><div className="brand"><span>Local AI Translator</span></div><div className="active-model"><span className="status-dot ready" />{status.active_model || status.resolved_model || status.model_configured}</div><button className="secondary-button" onClick={() => setSettingsOpen(true)}>设置</button><button className="secondary-button danger-button" onClick={onDisable}>关闭模型</button></header><div className="workspace-status">{busy ? "生成中 " + (progress?.estimated_tokens || 0) + " tokens" : message}</div><div className={"workspace " + settings.layout}><TextPane title="原文" language={sourceLanguage} value={source} preview={sourcePreview} fontSize={sourceFontSize} onLanguageChange={setSourceLanguage} onChange={setSource} onPreviewChange={setSourcePreview} /><div className="swap-column"><button className="swap-button" disabled={!canSwap || busy} onClick={swapLanguages} title="交换语言和内容">⇄</button></div><TextPane title="译文" language={targetLanguage} value={translation} preview={targetPreview} fontSize={targetFontSize} readOnly onLanguageChange={setTargetLanguage} onPreviewChange={setTargetPreview} /></div><footer className="translation-footer"><div className="progress-copy">{busy ? speed + " tokens/s · " + elapsed : doneMetrics}</div><button className="primary-button translate-button" disabled={busy || !source.trim()} onClick={translate}>{busy ? "翻译中…" : "开始翻译"}<span>Ctrl ↵</span></button></footer>{settingsOpen && <SettingsPanel settings={settings} onChange={onSettingsChange} onClose={() => setSettingsOpen(false)} />}</main>;
}

export default function App() {
  const [screen, setScreen] = useState<AppScreen>("loading");
  const [status, setStatus] = useState<LocalStatus | null>(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [settings, setSettings] = useState<UserSettings>(readSettings);
  const [busy, setBusy] = useState(false);
  const [download, setDownload] = useState<DownloadState>({ busy: false, percent: 0, phase: "", status: "", error: "", speedMiB: 0, fileIndex: 0, fileCount: 0, fileName: "", cancelRequested: false, environment: null });
  const cancelRequestedRef = useRef(false);
  const [customDirectoryOpen, setCustomDirectoryOpen] = useState(false);
  const [directoryDraft, setDirectoryDraft] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { document.documentElement.dataset.theme = settings.theme; localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }, [settings]);

  async function refresh() {
    const next = await getStatus();
    setStatus(next);
    setSelectedModel((current) => current || next.active_model || next.resolved_model || next.models?.[0]?.name || "");
    return next;
  }

  useEffect(() => {
    void (async () => {
      try {
        setScreen("loading");
        await ensureGateway();
        if (settings.dataDirectory) await setDataDirectory(settings.dataDirectory);
        const next = await refresh();
        setScreen(next.running_models?.length ? "translator" : "select");
      } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setScreen("error"); }
    })();
  }, []);

  function toggleCustomDirectory() {
    setCustomDirectoryOpen((current) => {
      const next = !current;
      if (next) setDirectoryDraft(settings.dataDirectory || status?.runtime?.root_dir || ".lat-runtime");
      return next;
    });
  }

  async function applyDirectory(path = directoryDraft): Promise<boolean> {
    const root = path.trim();
    if (!root) {
      setDownload((current) => ({ ...current, error: "模型路径不能为空" }));
      return false;
    }
    try {
      await setDataDirectory(root);
      setDirectoryDraft(root);
      setSettings((current) => ({ ...current, dataDirectory: root }));
      await refresh();
      setDownload((current) => ({ ...current, error: "" }));
      return true;
    } catch (reason) {
      setDownload((current) => ({ ...current, error: reason instanceof Error ? reason.message : String(reason) }));
      return false;
    }
  }

  async function chooseDirectory() {
    const selected = await selectDataDirectory();
    if (selected) await applyDirectory(selected);
  }

  async function ensureDataDirectory(): Promise<boolean> {
    const root = settings.dataDirectory || directoryDraft.trim() || status?.runtime?.root_dir || ".lat-runtime";
    if (root === settings.dataDirectory && settings.dataDirectory) return true;
    return applyDirectory(root);
  }
  async function enableSelectedModel() {
    setBusy(true); setError("");
    try { await loadModel(selectedModel); const next = await refresh(); setStatus(next); setScreen("translator"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function disableModel() {
    setBusy(true);
    try { await unloadModel(status?.active_model || selectedModel); const next = await refresh(); setStatus(next); setScreen("select"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function stopDownload() {
    if (!download.busy || download.cancelRequested) return;
    cancelRequestedRef.current = true;
    setDownload((current) => ({ ...current, cancelRequested: true, status: "正在请求停止" }));
    try {
      await cancelDownload();
    } catch (reason) {
      cancelRequestedRef.current = false;
      setDownload((current) => ({ ...current, cancelRequested: false, error: reason instanceof Error ? reason.message : String(reason) }));
    }
  }
  async function downloadHyModel() {
    cancelRequestedRef.current = false;
    setBusy(true); setDownload({ busy: true, percent: 0, phase: "", status: "正在检测 GPU 总显存", error: "", speedMiB: 0, fileIndex: 0, fileCount: 0, fileName: "", cancelRequested: false, environment: null }); setError("");
    try {
      if (!await ensureDataDirectory() || cancelRequestedRef.current) { setDownload((current) => ({ ...current, busy: false, status: "已取消" })); return; }
      const environment = await getDownloadEnvironment();
      if (cancelRequestedRef.current) { setDownload((current) => ({ ...current, busy: false, status: "已取消" })); return; }
      setDownload((current) => ({ ...current, environment, status: "准备下载" }));
      if (environment.status !== "ready") {
        const detail = [environment.message, environment.suggestion, "仍要继续下载吗？"].filter(Boolean).join("\n\n");
        if (!window.confirm(detail)) { setDownload((current) => ({ ...current, busy: false, status: "已取消" })); return; }
      }
      if (cancelRequestedRef.current) { setDownload((current) => ({ ...current, busy: false, status: "已取消" })); return; }
      const outcome = await downloadModelStream(DOWNLOAD_MODEL, (event: DownloadEvent) => {
        if (event.type === "error") { setDownload((current) => ({ ...current, error: event.message || "模型下载失败" })); return; }
        setDownload((current) => ({ ...current, phase: event.phase || current.phase, percent: event.percent ?? current.percent, status: event.message || event.status || current.status, speedMiB: event.speed_mib_per_second ?? current.speedMiB, fileIndex: event.file_index ?? current.fileIndex, fileCount: event.file_count ?? current.fileCount, fileName: event.file_name ?? current.fileName, cancelRequested: event.status === "cancelled" ? false : current.cancelRequested }));
      });
      if (outcome === "cancelled") { cancelRequestedRef.current = false; setDownload((current) => ({ ...current, status: "已取消", cancelRequested: false })); return; }
      const downloaded = await refresh();
      if (!downloaded.runtime?.verified || !downloaded.model?.verified) {
        setDownload((current) => ({ ...current, status: "下载未完成", error: "下载流已结束 但运行时或模型校验未通过" }));
        return;
      }
      await loadModel(DOWNLOAD_MODEL);
      const next = await refresh();
      if (!next.ready) {
        setDownload((current) => ({ ...current, status: "模型启动失败", error: "模型文件已校验 但 llama.cpp 未能启动 请查看日志" }));
        return;
      }
      setStatus(next); setSelectedModel(DOWNLOAD_MODEL); setScreen("translator");
    } catch (reason) { const message = reason instanceof Error ? reason.message : String(reason); setDownload((current) => ({ ...current, error: message })); }
    finally { cancelRequestedRef.current = false; setBusy(false); setDownload((current) => ({ ...current, busy: false, cancelRequested: false })); }
  }

  let content: ReactNode;
  if (screen === "loading") content = <section className="loading-screen"><div className="spinner" /><h1>正在启动本地服务</h1><p>检测 llama.cpp 和本地模型…</p></section>;
  else if (screen === "error") content = <section className="loading-screen"><div className="error-icon">!</div><h1>无法启动 LAT</h1><p>{error}</p><button className="primary-button" onClick={() => window.location.reload()}>重新连接</button></section>;
  else if (screen === "select") content = <ModelSelector status={status} selectedModel={selectedModel} loading={busy} dataDirectory={settings.dataDirectory} defaultDataDirectory={status?.runtime?.root_dir || ".lat-runtime"} directoryDraft={directoryDraft} customDirectoryOpen={customDirectoryOpen} onSelect={setSelectedModel} onEnable={enableSelectedModel} onDownload={() => void downloadHyModel()} onCancelDownload={() => void stopDownload()} onOpenCustomDirectory={toggleCustomDirectory} onDirectoryDraftChange={setDirectoryDraft} onApplyDirectory={() => void applyDirectory()} onChooseDirectory={() => void chooseDirectory()} onRefresh={() => void refresh()} download={download} />;
  else content = status ? <TranslatorWorkspace status={status} settings={settings} onSettingsChange={(next) => setSettings((current) => ({ ...current, ...next }))} onDisable={() => void disableModel()} /> : null;

  return <MathJaxContext version={3} config={mathJaxConfig} src="/mathjax/tex-chtml.js">{content}</MathJaxContext>;
}