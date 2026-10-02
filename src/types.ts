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
  selectionEnabled: boolean;
  selectionShortcut: string;
  selectionClipboardFallback: boolean;
  selectionCloseToTray: boolean;
  selectionTargetLanguage: string;
  selectionOnboarded: boolean;
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
  require_ready?: boolean;
  job_id?: string;
  text: string;
  source_language: string;
  target_language: string;
  style?: string;
}

export interface StreamEvent {
  code?: string;
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

export interface TelemetrySnapshot extends TelemetrySample {
  samples: TelemetrySample[];
  interval: number;
  inference?: InferenceSnapshot;
}

export interface InferenceRecord {
  id: string;
  model: string;
  job_id: string | null;
  segment_index: number | null; // 1-based index within the translation job.
  attempt: number;
  status: "running" | "completed" | "cancelled" | "failed";
  phase: "prefill" | "decode" | "idle";
  started_at: number;
  finished_at: number | null;
  elapsed_ms: number;
  first_token_ms: number | null;
  prompt_tokens: number | null;
  generated_tokens: number | null;
  total_tokens: number | null;
  tokens_complete: boolean;
  tokens_per_second: number | null;
  prompt_tokens_per_second: number | null;
  prompt_ms: number | null;
  decode_ms: number | null;
  output_chars: number;
  token_source: "llama.cpp" | "unknown";
  speed_source: "llama.cpp" | "wall_clock" | "unknown";
}

export interface ModelArchitecture {
  available: boolean;
  source: "gguf" | "unavailable";
  model: string;
  architecture: string | null;
  name: string | null;
  block_count: number | null;
  embedding_length: number | null;
  attention_heads: number | null;
  kv_heads: number | null;
  feed_forward_length: number | null;
  context_length: number | null;
  expert_count: number | null;
  expert_used_count: number | null;
  tensor_count: number | null;
  parameter_count: number | null;
  quantization: string | null;
  vocab_size?: number | null;
  head_dim?: number | null;
  block_tensors?: { layer: number; name: string; shape: number[]; elements: number | null }[];
  block_tensors_truncated?: boolean;
  message: string;
}

export interface InferenceSnapshot {
  session_started_at: number;
  summary: {
    calls: number;
    completed_calls: number;
    cancelled_calls: number;
    failed_calls: number;
    prompt_tokens: number;
    generated_tokens: number;
    total_tokens: number;
    unknown_token_calls: number;
  };
  active: InferenceRecord | null;
  latest: InferenceRecord | null;
  history: InferenceRecord[];
  architecture: ModelArchitecture;
}
