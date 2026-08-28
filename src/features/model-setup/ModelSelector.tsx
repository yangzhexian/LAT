import { formatBytes } from "../../lib/text";
import type { DownloadState, LocalModel, LocalStatus } from "../../types";

interface ModelSelectorProps {
  status: LocalStatus | null;
  selectedModel: string;
  loading: boolean;
  error: string;
  dataDirectory: string;
  defaultDataDirectory: string;
  directoryDraft: string;
  customDirectoryOpen: boolean;
  download: DownloadState;
  onSelect: (value: string) => void;
  onEnable: () => void;
  onDownload: () => void;
  onCancelDownload: () => void;
  onOpenCustomDirectory: () => void;
  onDirectoryDraftChange: (value: string) => void;
  onApplyDirectory: () => void;
  onChooseDirectory: () => void;
  onRefresh: () => void;
}

function modelLabel(model: LocalModel): string {
  const quantization = model.details?.quantization_level;
  return quantization ? model.name + " · " + quantization : model.name;
}

export function ModelSelector({
  status,
  selectedModel,
  loading,
  error,
  dataDirectory,
  defaultDataDirectory,
  directoryDraft,
  customDirectoryOpen,
  download,
  onSelect,
  onEnable,
  onDownload,
  onCancelDownload,
  onOpenCustomDirectory,
  onDirectoryDraftChange,
  onApplyDirectory,
  onChooseDirectory,
  onRefresh,
}: ModelSelectorProps) {
  const models = status?.models || [];
  const installed = Boolean(status?.model?.verified);
  const displayedDirectory = dataDirectory || defaultDataDirectory;
  const fileProgress =
    download.fileCount > 0
      ? "第 " + Math.max(1, download.fileIndex) + "/" + download.fileCount + " 项 · "
      : "";

  return (
    <section className="select-screen">
      <img className="hero-icon" src="/lat-icon.svg" alt="LAT" />
      <p className="eyebrow">LOCAL TRANSLATION WORKSPACE</p>
      <h1>选择本地模型</h1>
      <p className="subtitle">模型不会离开本机 启用后即可进入 LAT 翻译工作区</p>
      <div className="service-pill">
        <span className={"status-dot " + (status?.runtime?.installed ? "ready" : "")} />
        {status?.runtime?.installed
          ? "llama.cpp " + (status.version || "已安装")
          : "需要安装 llama.cpp"}
        <button type="button" className="text-button" onClick={onRefresh}>
          刷新
        </button>
      </div>
      <div className="model-list">
        {models.map((model) => (
          <button
            type="button"
            key={model.name}
            className={"model-card " + (selectedModel === model.name ? "selected" : "")}
            onClick={() => onSelect(model.name)}
          >
            <span className="model-icon">◈</span>
            <span className="model-copy">
              <strong>{modelLabel(model)}</strong>
              <small>{formatBytes(model.size)} · GGUF</small>
            </span>
            <span className="model-check">{selectedModel === model.name ? "✓" : ""}</span>
          </button>
        ))}
      </div>

      {!installed && (
        <div className="download-card">
          <div className="download-card-header">
            <div>
              <strong>安装 llama.cpp 并下载 Hy-MT2 Q6_K</strong>
              <small>运行时和模型会保存到本机数据目录</small>
            </div>
          </div>
          {download.environment && (
            <div className={"environment-note " + download.environment.status}>
              <strong>{download.environment.message}</strong>
              {download.environment.best_gpu && (
                <small>
                  {download.environment.best_gpu.name} · 总显存{" "}
                  {download.environment.best_gpu.total_vram_gib.toFixed(2)} GiB
                </small>
              )}
              {download.environment.suggestion && <span>{download.environment.suggestion}</span>}
            </div>
          )}
          {(download.error || error) && (
            <div className="error-banner">{download.error || error}</div>
          )}
          {download.busy && (
            <div className="download-progress">
              <div className="download-progress-label">
                <span>
                  {download.phase ? download.phase + " · " : ""}
                  {download.status || "准备下载"}
                  {download.fileName ? " · " + download.fileName : ""}
                </span>
                <span>
                  {fileProgress}
                  {download.percent.toFixed(1)}% · {download.speedMiB.toFixed(2)} MiB/s
                </span>
              </div>
              <div className="progress-track">
                <span style={{ width: Math.max(2, download.percent) + "%" }} />
              </div>
            </div>
          )}
          <div className="download-action-row">
            <button
              type="button"
              className="custom-directory-toggle"
              disabled={loading || download.busy}
              onClick={onOpenCustomDirectory}
            >
              {customDirectoryOpen ? "收起自定义模型路径" : "自定义模型路径"}
            </button>
            <button
              type="button"
              className={download.busy ? "cancel-button" : "secondary-button download-button"}
              disabled={download.cancelRequested}
              onClick={download.busy ? onCancelDownload : onDownload}
            >
              {download.busy
                ? download.cancelRequested
                  ? "正在停止…"
                  : "终止下载"
                : "开始下载"}
            </button>
          </div>
          {customDirectoryOpen && (
            <div className="custom-directory-panel">
              <div className="directory-input-row">
                <input
                  className="directory-input"
                  value={directoryDraft}
                  placeholder={defaultDataDirectory || ".lat-runtime"}
                  disabled={loading || download.busy}
                  onChange={(event) => onDirectoryDraftChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") onApplyDirectory();
                  }}
                  aria-label="自定义模型路径"
                />
                <button
                  type="button"
                  className="folder-button"
                  disabled={loading || download.busy}
                  onClick={onChooseDirectory}
                  aria-label="选择模型目录"
                  title="选择目录"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3.5 6.5h6l1.7 2h9.3v9.8a1.2 1.2 0 0 1-1.2 1.2H4.7a1.2 1.2 0 0 1-1.2-1.2z" />
                    <path d="M3.5 6.5V5.8a1.3 1.3 0 0 1 1.3-1.3h4.2l1.6 2h8.7a1.2 1.2 0 0 1 1.2 1.2v.8" />
                  </svg>
                </button>
              </div>
              <div className="custom-directory-footer">
                <small>
                  {displayedDirectory
                    ? "当前目录 " + displayedDirectory
                    : "默认目录为安装路径下的 .lat-runtime"}
                </small>
                <button
                  type="button"
                  className="text-button"
                  disabled={loading || download.busy}
                  onClick={onApplyDirectory}
                >
                  应用路径
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        className="primary-button enable-button"
        disabled={!selectedModel || loading || !models.length}
        onClick={onEnable}
      >
        {loading ? "正在启用模型…" : "启用模型"}
      </button>
      <p className="caption">当前针对 Hy-MT2 翻译策略进行了优化 其他模型仍可发现和尝试</p>
    </section>
  );
}
