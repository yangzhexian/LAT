import { useEffect, useRef, useState, type ReactNode } from "react";
import { MathJaxContext } from "better-react-mathjax";
import { ModelSelector } from "./features/model-setup/ModelSelector";
import { TranslatorWorkspace } from "./features/translator/TranslatorWorkspace";
import {
  cancelDownload,
  downloadModelStream,
  ensureGateway,
  getDownloadEnvironment,
  getStatus,
  loadModel,
  selectDataDirectory,
  setDataDirectory,
  unloadModel,
} from "./lib/api";
import { usePersistentSettings } from "./lib/settings";
import type {
  AppScreen,
  DownloadEvent,
  DownloadState,
  LocalStatus,
} from "./types";
import "./styles.css";

const DEFAULT_DOWNLOAD_MODEL = "hy-mt2-7b:q6_k";
const EMPTY_DOWNLOAD_STATE: DownloadState = {
  busy: false,
  percent: 0,
  phase: "",
  status: "",
  error: "",
  speedMiB: 0,
  fileIndex: 0,
  fileCount: 0,
  fileName: "",
  cancelRequested: false,
  environment: null,
};

const mathJaxConfig = {
  loader: { load: ["[tex]/boldsymbol"] },
  tex: {
    packages: { "[+]": ["boldsymbol"] },
    inlineMath: [["$", "$"], ["\\(", "\\)"]],
    displayMath: [["$$", "$$"], ["\\[", "\\]"]],
    processEscapes: true,
  },
  chtml: { mtextInheritFont: true, fontURL: "/mathjax/output/chtml/fonts/woff-v2" },
  options: {
    skipHtmlTags: ["script", "noscript", "style", "textarea", "pre", "code"],
  },
};

export default function App() {
  const [screen, setScreen] = useState<AppScreen>("loading");
  const [status, setStatus] = useState<LocalStatus | null>(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [downloadModel, setDownloadModel] = useState(DEFAULT_DOWNLOAD_MODEL);
  const [settings, setSettings] = usePersistentSettings();
  const [busy, setBusy] = useState(false);
  const [download, setDownload] = useState<DownloadState>(EMPTY_DOWNLOAD_STATE);
  const cancelRequestedRef = useRef(false);
  const [customDirectoryOpen, setCustomDirectoryOpen] = useState(false);
  const [directoryDraft, setDirectoryDraft] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    const next = await getStatus();
    setStatus(next);
    setSelectedModel((current) => {
      const available = next.models?.some((model) => model.name === current);
      if (current && available) return current;
      if (next.active_model) return next.active_model;
      if (next.model?.verified && next.resolved_model) return next.resolved_model;
      return next.models?.[0]?.name || next.resolved_model || "";
    });
    return next;
  }

  async function refreshSetup() {
    const next = await refresh();
    try {
      const environment = await getDownloadEnvironment(next.resolved_model || downloadModel);
      setDownload((current) => ({ ...current, environment }));
      if (!downloadModel && environment.recommended_model) {
        setDownloadModel(environment.recommended_model);
      }
    } catch {
      // The download card can still render its installed-model state if GPU probing is unavailable.
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        setScreen("loading");
        await ensureGateway();
        if (settings.dataDirectory) {
          await setDataDirectory(settings.dataDirectory);
        }
        const next = await refresh();
        try {
          const environment = await getDownloadEnvironment(next.resolved_model || DEFAULT_DOWNLOAD_MODEL);
          setDownload((current) => ({ ...current, environment }));
          setDownloadModel(environment.recommended_model || next.resolved_model || DEFAULT_DOWNLOAD_MODEL);
        } catch {
          // GPU probing is advisory; model discovery remains usable if nvidia-smi is unavailable.
        }
        setScreen(next.running_models?.length ? "translator" : "select");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
        setScreen("error");
      }
    })();
  }, []);

  function toggleCustomDirectory() {
    setCustomDirectoryOpen((current) => {
      const next = !current;
      if (next) {
        setDirectoryDraft(settings.dataDirectory || status?.runtime?.root_dir || ".lat-runtime");
      }
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
      await refreshSetup();
      setDownload((current) => ({ ...current, error: "" }));
      return true;
    } catch (reason) {
      setDownload((current) => ({
        ...current,
        error: reason instanceof Error ? reason.message : String(reason),
      }));
      return false;
    }
  }

  async function chooseDirectory() {
    try {
      const selected = await selectDataDirectory();
      if (selected) {
        await applyDirectory(selected);
      }
    } catch (reason) {
      setDownload((current) => ({
        ...current,
        error: reason instanceof Error ? reason.message : String(reason),
      }));
    }
  }

  async function ensureDataDirectory(): Promise<boolean> {
    const root =
      settings.dataDirectory ||
      directoryDraft.trim() ||
      status?.runtime?.root_dir ||
      ".lat-runtime";
    if (root === settings.dataDirectory && settings.dataDirectory) {
      return true;
    }
    return applyDirectory(root);
  }

  async function enableSelectedModel() {
    setBusy(true);
    setError("");
    try {
      await loadModel(selectedModel);
      const next = await refresh();
      setStatus(next);
      setScreen("translator");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function disableModel() {
    setBusy(true);
    try {
      await unloadModel(status?.active_model || selectedModel);
      const next = await refresh();
      setStatus(next);
      setScreen("select");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function stopDownload() {
    if (!download.busy || download.cancelRequested) return;
    cancelRequestedRef.current = true;
    setDownload((current) => ({
      ...current,
      cancelRequested: true,
      status: "正在请求停止",
    }));
    try {
      await cancelDownload();
    } catch (reason) {
      cancelRequestedRef.current = false;
      setDownload((current) => ({
        ...current,
        cancelRequested: false,
        error: reason instanceof Error ? reason.message : String(reason),
      }));
    }
  }

  async function downloadHyModel() {
    cancelRequestedRef.current = false;
    setBusy(true);
    setDownload((current) => ({
      ...current,
      busy: true,
      percent: 0,
      phase: "",
      status: "正在检测 GPU 总显存",
      error: "",
      speedMiB: 0,
      fileIndex: 0,
      fileCount: 0,
      fileName: "",
      cancelRequested: false,
    }));
    setError("");
    try {
      if (!(await ensureDataDirectory()) || cancelRequestedRef.current) {
        setDownload((current) => ({ ...current, busy: false, status: "已取消" }));
        return;
      }
      const environment = await getDownloadEnvironment(downloadModel);
      setDownload((current) => ({ ...current, environment, status: "准备下载" }));
      if (environment.status !== "ready") {
        const detail = [environment.message, environment.suggestion, "仍要继续下载吗？"]
          .filter(Boolean)
          .join("\n\n");
        if (!window.confirm(detail) || cancelRequestedRef.current) {
          setDownload((current) => ({ ...current, busy: false, status: "已取消" }));
          return;
        }
      }
      const outcome = await downloadModelStream(downloadModel, (event: DownloadEvent) => {
        if (event.type === "error") {
          setDownload((current) => ({ ...current, error: event.message || "模型下载失败" }));
          return;
        }
        setDownload((current) => ({
          ...current,
          phase: event.phase || current.phase,
          percent: event.percent ?? current.percent,
          status: event.message || event.status || current.status,
          speedMiB: event.speed_mib_per_second ?? current.speedMiB,
          fileIndex: event.file_index ?? current.fileIndex,
          fileCount: event.file_count ?? current.fileCount,
          fileName: event.file_name ?? current.fileName,
          cancelRequested: event.status === "cancelled" ? false : current.cancelRequested,
        }));
      });
      if (outcome === "cancelled") {
        cancelRequestedRef.current = false;
        setDownload((current) => ({ ...current, status: "已取消", cancelRequested: false }));
        return;
      }
      const downloaded = await refresh();
      if (!downloaded.runtime?.verified || !downloaded.model?.verified) {
        setDownload((current) => ({
          ...current,
          status: "下载未完成",
          error: "下载流已结束 但运行时或模型校验未通过",
        }));
        return;
      }
      await loadModel(downloadModel);
      const next = await refresh();
      if (!next.ready) {
        setDownload((current) => ({
          ...current,
          status: "模型启动失败",
          error: "模型文件已校验 但 llama.cpp 未能启动 请查看日志",
        }));
        return;
      }
      setStatus(next);
      setSelectedModel(downloadModel);
      setScreen("translator");
    } catch (reason) {
      setDownload((current) => ({
        ...current,
        error: reason instanceof Error ? reason.message : String(reason),
      }));
    } finally {
      cancelRequestedRef.current = false;
      setBusy(false);
      setDownload((current) => ({ ...current, busy: false, cancelRequested: false }));
    }
  }

  let content: ReactNode;
  if (screen === "loading") {
    content = (
      <section className="loading-screen">
        <div className="spinner" />
        <h1>正在启动本地服务</h1>
        <p>检测 llama.cpp 和本地模型…</p>
      </section>
    );
  } else if (screen === "error") {
    content = (
      <section className="loading-screen">
        <div className="error-icon">!</div>
        <h1>无法启动 LAT</h1>
        <p>{error}</p>
        <button type="button" className="primary-button" onClick={() => window.location.reload()}>
          重新连接
        </button>
      </section>
    );
  } else if (screen === "select") {
    content = (
      <ModelSelector
        status={status}
        selectedModel={selectedModel}
        downloadModel={downloadModel}
        loading={busy}
        error={error}
        dataDirectory={settings.dataDirectory}
        defaultDataDirectory={status?.runtime?.root_dir || ".lat-runtime"}
        directoryDraft={directoryDraft}
        customDirectoryOpen={customDirectoryOpen}
        onSelect={setSelectedModel}
        onSelectDownloadModel={setDownloadModel}
        onEnable={() => void enableSelectedModel()}
        onDownload={() => void downloadHyModel()}
        onCancelDownload={() => void stopDownload()}
        onOpenCustomDirectory={toggleCustomDirectory}
        onDirectoryDraftChange={setDirectoryDraft}
        onApplyDirectory={() => void applyDirectory()}
        onChooseDirectory={() => void chooseDirectory()}
        onRefresh={() => {
          setError("");
          void refreshSetup().catch((reason) => {
            setError(reason instanceof Error ? reason.message : String(reason));
          });
        }}
        download={download}
      />
    );
  } else {
    content = status ? (
      <TranslatorWorkspace
        status={status}
        settings={settings}
        onSettingsChange={(next) => setSettings((current) => ({ ...current, ...next }))}
        onDisable={() => void disableModel()}
      />
    ) : null;
  }

  return (
    <MathJaxContext version={3} config={mathJaxConfig} src="/mathjax/tex-chtml.js">
      {content}
    </MathJaxContext>
  );
}
