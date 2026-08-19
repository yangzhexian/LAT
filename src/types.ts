export type AppScreen = "loading" | "select" | "translator" | "error";
export type LayoutMode = "horizontal" | "vertical";
export type ThemeMode = "dark" | "light";

export interface UserSettings {
  theme: ThemeMode;
  layout: LayoutMode;
  autoFont: boolean;
  removeLineBreaks: boolean;
}

export interface ModelDetails {
  family?: string;
  families?: string[];
  parameter_size?: string;
  quantization_level?: string;
  format?: string;
  context_length?: number;
}

export interface OllamaModel {
  name: string;
  model?: string;
  size?: number;
  digest?: string;
  details?: ModelDetails;
  capabilities?: string[];
}

export interface OllamaStatus {
  ollama_url: string;
  ready: boolean;
  owned_process: boolean;
  model_configured: string;
  active_model?: string | null;
  resolved_model?: string;
  version?: string;
  models?: OllamaModel[];
  running_models?: OllamaModel[];
  warning?: string;
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
