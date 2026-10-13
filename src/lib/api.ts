import type {
  DownloadEnvironment,
  DownloadEvent,
  LocalStatus,
  StreamEvent,
  TranslationRequest,
} from "../types";

const GATEWAY_URL = (
  import.meta.env.VITE_GATEWAY_URL || "http://127.0.0.1:8787"
).replace(/\/$/, "");

interface ErrorResponse {
  error?: {
    message?: string;
    code?: string;
  };
}

export class GatewayError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = "GatewayError";
  }
}

function isTauri(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

async function invokeTauri<T>(command: string): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command);
}

interface GatewaySession { url: string; token: string; instance_id: string; protocol_version: number; owned: boolean }
let gatewaySession: GatewaySession | null = null;
let pendingSession: Promise<GatewaySession> | null = null;
let sessionGeneration = 0;

export function invalidateGatewaySession(): void { sessionGeneration++; gatewaySession = null; pendingSession = null; }

async function gatewayFetch(path: string, init?: RequestInit): Promise<Response> {
  let base = GATEWAY_URL;
  let token = import.meta.env?.VITE_GATEWAY_TOKEN || "";
  if (isTauri()) {
    if (!gatewaySession) {
      const generation = sessionGeneration;
      const pending = pendingSession ??= invokeTauri<GatewaySession>("gateway_session");
      try {
        const session = await pending;
        if (generation !== sessionGeneration) throw new GatewayError("网关会话已失效，请重试", "session_changed");
        gatewaySession = session;
      } finally { if (pendingSession === pending) pendingSession = null; }
    }
    base = gatewaySession.url;
    token = gatewaySession.token;
  }
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(base + path, { ...init, headers });
  if (response.status === 401 && isTauri()) invalidateGatewaySession();
  return response;
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const body = (await response.json().catch(() => ({}))) as ErrorResponse;
  return new GatewayError(body.error?.message || fallback + " (" + response.status + ")", body.error?.code);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await gatewayFetch(path, init);
  if (!response.ok) {
    throw await responseError(response, "请求失败");
  }
  return (await response.json()) as T;
}

function eventData(rawEvent: string): string | null {
  const lines = rawEvent
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  if (!lines.length) return null;
  return lines.join("\n");
}

async function readEventStream<T>(
  response: Response,
  onEvent: (event: T) => void,
): Promise<void> {
  if (!response.body) {
    throw new Error("服务没有返回事件流");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consume = (rawEvent: string) => {
    const data = eventData(rawEvent);
    if (!data || data === "[DONE]") return;
    onEvent(JSON.parse(data) as T);
  };

  while (true) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value || new Uint8Array(), {
      stream: !chunk.done,
    });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || "";
    for (const rawEvent of events) {
      consume(rawEvent);
    }
    if (chunk.done) break;
  }

  if (buffer.trim()) {
    consume(buffer);
  }
}

export async function ensureGateway(): Promise<void> {
  if (isTauri()) {
    gatewaySession = await invokeTauri<GatewaySession>("start_gateway");
  }
  const deadline = Date.now() + 30_000;
  let lastError = "翻译网关未响应";
  while (Date.now() < deadline) {
    try {
      const health = await request<{ service: string; protocol_version: number; instance_id: string }>("/health", { signal: AbortSignal.timeout(2000) });
      if (health.service !== "lat-local-translator" || health.protocol_version !== 2) {
        throw new GatewayError("网关协议不兼容，请退出旧版网关后重试", "protocol_mismatch");
      }
      if (gatewaySession && health.instance_id !== gatewaySession.instance_id) {
        throw new GatewayError("网关实例已变化，请退出占用端口的其他网关后重试", "instance_mismatch");
      }
      return;
    } catch (error) {
      if (error instanceof GatewayError && error.code?.endsWith("mismatch")) throw error;
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error(lastError);
}

export function getStatus(signal?: AbortSignal): Promise<LocalStatus> {
  return request<LocalStatus>("/admin/status", { signal });
}

export function getDownloadEnvironment(model?: string): Promise<DownloadEnvironment> {
  const query = model ? "?model=" + encodeURIComponent(model) : "";
  return request<DownloadEnvironment>("/admin/environment" + query);
}

export function setDataDirectory(
  rootDir: string,
): Promise<{ status: string; root_dir: string }> {
  return request("/admin/directory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ root_dir: rootDir }),
  });
}

export async function selectDataDirectory(): Promise<string | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: true,
      multiple: false,
      title: "选择 LAT 数据目录",
    });
    return typeof selected === "string" ? selected : null;
  }
  return window.prompt("输入 LAT 数据目录", "");
}

export function loadModel(model: string): Promise<unknown> {
  return request("/admin/load", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
}

export function unloadModel(model?: string): Promise<unknown> {
  return request("/admin/unload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(model ? { model } : {}),
  });
}

export async function downloadModelStream(
  model: string,
  onEvent: (event: DownloadEvent) => void,
): Promise<"completed" | "cancelled"> {
  const response = await gatewayFetch("/admin/download", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ model }),
  });
  if (!response.ok) {
    throw await responseError(response, "模型下载请求失败");
  }

  let streamError = "";
  let wasCancelled = false;
  let streamCompleted = false;
  await readEventStream<DownloadEvent>(response, (event) => {
    if (event.type === "error") {
      streamError = event.message || "模型下载失败";
    }
    if (event.status === "cancelled") {
      wasCancelled = true;
    }
    if (event.status === "complete") {
      streamCompleted = true;
    }
    onEvent(event);
  });

  if (streamError) throw new Error(streamError);
  if (wasCancelled) return "cancelled";
  if (!streamCompleted) {
    throw new Error("模型下载流提前结束 未收到完成确认");
  }
  return "completed";
}

export function cancelDownload(): Promise<unknown> {
  return request("/admin/download/cancel", { method: "POST" });
}

export function cancelTranslation(jobId: string): Promise<unknown> {
  return request("/translate/cancel", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_id: jobId }),
  });
}

export async function translateStream(
  body: TranslationRequest,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await gatewayFetch("/translate/stream", {
    signal,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await responseError(response, "流式翻译请求失败");
  }
  let completed = false;
  let streamError = "";
  let streamCode: string | undefined;
  await readEventStream<StreamEvent>(response, (event) => {
    if (event.type === "complete" || event.type === "cancelled") completed = true;
    if (event.type === "error") { streamError = event.message || "翻译失败"; streamCode = event.code; }
    onEvent(event);
  });
  if (streamError) throw new GatewayError(streamError, streamCode);
  if (!completed) throw new Error("翻译流提前结束，未收到完成确认");
}

export function getTelemetry(signal?: AbortSignal): Promise<import("../types").TelemetrySnapshot> {
  return request("/admin/telemetry", { signal });
}

export function setTelemetryInterval(interval: number, signal?: AbortSignal): Promise<unknown> {
  return request("/admin/telemetry", { method: "POST", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ interval }) });
}
