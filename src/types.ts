export type AppScreen = "loading" | "select" | "translator" | "error";
export type LayoutMode = "horizontal" | "vertical";
export type ThemeMode = "dark" | "light";

export interface UserSettings {
  theme: ThemeMode;
  layout: LayoutMode;
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

export interface DownloadEnvironment {
  model: string;
  recommended_vram_gib: number;
  required_vram_gib?: number;
  gpus: GpuInfo[];
  best_gpu?: GpuInfo;
  status: "ready" | "insufficient" | "unknown";
  message: string;
  suggestion: string;
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
  text: string;
  source_language: string;
  target_language: string;
  style?: string;
}

export interface StreamEvent {
  type: "attempt" | "progress" | "retry" | "complete" | "error";
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