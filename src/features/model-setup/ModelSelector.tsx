import { useEffect, useState } from "react";
import { formatBytes } from "../../lib/text";
import type { DownloadState, LocalStatus, ModelOption } from "../../types";

interface ModelSelectorProps {
  status: LocalStatus | null;
  selectedModel: string;
  downloadModel: string;
  loading: boolean;
  error: string;
  dataDirectory: string;
  defaultDataDirectory: string;
  directoryDraft: string;
  customDirectoryOpen: boolean;
  download: DownloadState;
  onSelect: (value: string) => void;
  onSelectDownloadModel: (value: string) => void;
  onEnable: () => void;
  onDownload: () => void;
  onCancelDownload: () => void;
  onOpenCustomDirectory: () => void;
  onDirectoryDraftChange: (value: string) => void;
  onApplyDirectory: () => void;
  onChooseDirectory: () => void;
  onRefresh: () => void;
}

function optionLabel(option: ModelOption): string {
  return option.label + " · " + option.size_gib.toFixed(2) + " GiB";
}

export function ModelSelector({
  status,
  selectedModel,
  downloadModel,
  loading,
  error,
  dataDirectory,
  defaultDataDirectory,
  directoryDraft,
  customDirectoryOpen,
  download,
  onSelect,
  onSelectDownloadModel,
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
  const hasModels = models.length > 0;
  const [downloadOpen, setDownloadOpen] = useState(!hasModels);
  const [modelSelectionOpen, setModelSelectionOpen] = useState(false);
  const downloadOptions = download.environment?.models || [];
  const selectedOption = downloadOptions.find((option) => option.id === downloadModel);
  const recommendedOption = downloadOptions.find((option) => option.recommended);
  const selectedModelName =
    models.find((model) => model.name === selectedModel)?.name || "请选择模型";
  const displayedDirectory = dataDirectory || defaultDataDirectory;
  const fileProgress =
    download.fileCount > 0
      ? "第 " + Math.max(1, download.fileIndex) + "/" + download.fileCount + " 项 · "
      : "";

  useEffect(() => {
    setDownloadOpen(!hasModels);
    setModelSelectionOpen(false);
  }, [hasModels]);

  return (
    <section className="select-screen">
      <img className="hero-icon" src="/lat-icon.svg" alt="LAT" />
      <p className="eyebrow">LOCAL TRANSLATION WORKSPACE</p>
      <h1>选择本地模型</h1>
      <div className="service-pill">
        <span className={"status-dot " + (status?.runtime?.installed ? "ready" : "")} />
        {status?.runtime?.installed
          ? "llama.cpp " + (status.version || "已安装")
          : "需要安装 llama.cpp"}
        <button type="button" className="text-button" onClick={onRefresh}>
          刷新
        </button>
      </div>
      {hasModels && (
        <details
          className="model-selection-card collapsible-card"
          open={modelSelectionOpen}
          onToggle={(event) => setModelSelectionOpen(event.currentTarget.open)}
        >
          <summary className="download-card-header">
            <div>
              <strong>选择模型</strong>
              <small>{selectedModelName}</small>
            </div>
            <span className="collapsible-chevron" aria-hidden="true" />
          </summary>
          <div className="model-list">
            {models.map((model) => (
              <button
                type="button"
                key={model.name}
                className={"model-card " + (selectedModel === model.name ? "selected" : "")}
                onClick={() => {
                  onSelect(model.name);
                  setModelSelectionOpen(false);
                }}
              >
                <span className="model-icon">◈</span>
                <span className="model-copy">
                  <strong>{model.name}</strong>
                  <small>{model.size ? formatBytes(model.size) : "未知大小"} · GGUF</small>
                </span>
              </button>
            ))}
          </div>
        </details>
      )}

      <details
        className="download-card collapsible-card"
        open={downloadOpen}
        onToggle={(event) => setDownloadOpen(event.currentTarget.open)}
      >
        <summary className="download-card-header">
          <div>
            <strong>下载 Hy-MT2 GGUF 模型</strong>
          </div>
          <span className="collapsible-chevron" aria-hidden="true" />
        </summary>
        {downloadOptions.length > 0 && (
          <div className="model-download-picker">
            <label htmlFor="download-model">下载版本</label>
            <select
              id="download-model"
              value={downloadModel}
              disabled={loading || download.busy}
              onChange={(event) => onSelectDownloadModel(event.target.value)}
            >
              {downloadOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {optionLabel(option)}
                  {option.recommended ? " · 推荐" : ""}
                </option>
              ))}
            </select>
            {selectedOption && (
              <small className="model-download-meta">
                {selectedOption.parameter_size} 参数 · {selectedOption.quantization} · 建议总显存 {
                  selectedOption.recommended_vram_gib
                } GiB
                {download.environment?.best_gpu && (
                  <>
                    {" · "}
                    当前设备 {download.environment.best_gpu.name} 总显存{" "}
                    {download.environment.best_gpu.total_vram_gib.toFixed(2)} GiB
                  </>
                )}
              </small>
            )}
            {recommendedOption && recommendedOption.id !== downloadModel && (
              <button
                type="button"
                className="recommendation-button"
                disabled={loading || download.busy}
                onClick={() => onSelectDownloadModel(recommendedOption.id)}
              >
                使用硬件推荐版本 {recommendedOption.label}
              </button>
            )}
          </div>
        )}
        {download.environment && download.environment.status !== "ready" && (
          <div className={"environment-note " + download.environment.status}>
            <strong>{download.environment.message}</strong>
            {download.environment.suggestion && <span>{download.environment.suggestion}</span>}
          </div>
        )}
        {(download.error || error) && <div className="error-banner">{download.error || error}</div>}
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
      </details>

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
