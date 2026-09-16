export type AppScreen = "loading" | "select" | "translator" | "error";
export type LayoutMode = "horizontal" | "vertical";
export type ThemeMode = "dark" | "light";

export interface UserSettings {
  theme: ThemeMode;
  layout: LayoutMode;
  reduceMotion: boolean;
  historyLimit: number;
  saveHistory: boolean;
  telemetryInterval: number;
  telemetryWindow: number;
  autoFont: boolean;
  removeLineBreaks: boolean;
  dataDirectory: string;
}

export interface ModelDetails {
  family?: string;
  families?: string[];
  parameter_size?: string;
  quantization_level?: string;
  format?: string;
  context_length?: number;
}

export interface LocalModel {
  name: string;
  model?: string;
  size?: number;
  digest?: string;
  details?: ModelDetails;
  capabilities?: string[];
}

export interface RuntimeStatus {
  installed: boolean;
  verified: boolean;
  variant?: string;
  root_dir?: string;
}

export interface InstalledModelStatus {
  installed: boolean;
  verified: boolean;
  path?: string;
  size_bytes?: number;
}

export interface LocalStatus {
  max_input_chars?: number;
  backend: "llama.cpp";
  ready: boolean;
  owned_process: boolean;
  model_configured: string;
  active_model?: string | null;
  resolved_model?: string;
  version?: string;
  runtime?: RuntimeStatus;
  model?: InstalledModelStatus;
  models?: LocalModel[];
  running_models?: LocalModel[];
  warning?: string;
}

export interface GpuInfo {
  name: string;
  total_vram_gib: number;
}

export interface ModelOption {
  id: string;
  label: string;
  parameter_size: string;
  quantization: string;
  filename: string;
  size_bytes: number;
  size_gib: number;
  recommended_vram_gib: number;
  quality_rank: number;
  recommended?: boolean;
  fits_total_vram?: boolean;
}

export interface DownloadEnvironment {
  model: string;
  recommended_model: string;
  recommended_vram_gib: number;
  required_vram_gib?: number;
  gpus: GpuInfo[];
  best_gpu?: GpuInfo;
  models: ModelOption[];
  status: "ready" | "insufficient" | "unknown";
  message: string;
  suggestion: string;
}

export interface DownloadState {
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

export interface DownloadEvent {
  type: "download" | "error";
  phase?: "runtime" | "model";
  status?: string;
  percent?: number;
  completed_bytes?: number;
  total_bytes?: number;
  speed_bytes_per_second?: number;
  speed_mib_per_second?: number;
  file_index?: number;
  file_count?: number;
  file_name?: string;
  retry_count?: number;
  digest?: string;
  sha256?: string;
  message?: string;
}

export interface TranslationMetrics {
  generated_tokens?: number | null;
  eval_duration_ns?: number | null;
  load_duration_ns?: number | null;
  elapsed_ms?: number | null;
  tokens_per_second?: number | null;
  done_reason?: string | null;
}

export interface TranslationRequest {
  job_id?: string;
  text: string;
  source_language: string;
  target_language: string;
  style?: string;
}

export interface StreamEvent {
  job_id?: string;
  type: "waiting" | "cancelled" | "plan" | "segment_complete" | "attempt" | "progress" | "retry" | "complete" | "error";
  chunk_index?: number;
  total_chunks?: number;
  completed_chunks?: number;
  completed_chars?: number;
  total_chars?: number;
  attempt?: number;
  max_attempts?: number;
  generated_chars?: number;
  estimated_tokens?: number;
  elapsed_ms?: number;
  tokens_per_second?: number;
  issues?: string[];
  translation?: string;
  model?: string;
  quality_issues?: string[];
  metrics?: TranslationMetrics;
  message?: string;
}

export interface GpuSample {
  id: string;
  name: string;
  memory_used_mib: number | null;
  memory_total_mib: number | null;
  utilization_pct: number | null;
  power_w: number | null;
  power_limit_w: number | null;
  temperature_c: number | null;
}
export interface TelemetrySample {
  timestamp: number;
  gpus: GpuSample[];
  message: string;
}
