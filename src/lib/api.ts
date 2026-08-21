import type { DownloadEnvironment, DownloadEvent, LocalStatus, StreamEvent, TranslationRequest } from "../types";

const GATEWAY_URL = (import.meta.env.VITE_GATEWAY_URL || "http://127.0.0.1:8787").replace(/\/$/, "");

function isTauri(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

async function invokeTauri<T>(command: string): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(GATEWAY_URL + path, init);
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || "请求失败 (" + response.status + ")");
  return body;
}

export async function ensureGateway(): Promise<void> {
  if (isTauri()) await invokeTauri("start_gateway");
  const deadline = Date.now() + 30_000;
  let lastError = "翻译网关未响应";
  while (Date.now() < deadline) {
    try {
      await request<{ status: string }>("/health");
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error(lastError);
}

export function getStatus(): Promise<LocalStatus> {
  return request<LocalStatus>("/admin/status");
}

export function getDownloadEnvironment(): Promise<DownloadEnvironment> {
  return request<DownloadEnvironment>("/admin/environment");
}

export function setDataDirectory(rootDir: string): Promise<{ status: string; root_dir: string }> {
  return request("/admin/directory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ root_dir: rootDir }),
  });
}

export async function selectDataDirectory(): Promise<string | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ directory: true, multiple: false, title: "选择 LAT 数据目录" });
    return typeof selected === "string" ? selected : null;
  }
  return window.prompt("输入 LAT 数据目录", "");
}

export function startEngine(): Promise<unknown> {
  return request("/admin/start", { method: "POST" });
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

export async function downloadModelStream(model: string, onEvent: (event: DownloadEvent) => void): Promise<"completed" | "cancelled"> {
  const response = await fetch(GATEWAY_URL + "/admin/download", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ model }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body.error?.message || "模型下载请求失败 (" + response.status + ")");
  }
  if (!response.body) throw new Error("模型下载没有返回流");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamError = "";
  let wasCancelled = false;
  while (true) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";
    for (const raw of events) {
      const line = raw.split("\n").find((item) => item.startsWith("data: "));
      if (line) {
        const event = JSON.parse(line.slice(6)) as DownloadEvent;
        if (event.type === "error") streamError = event.message || "模型下载失败";
        if (event.status === "cancelled") wasCancelled = true;
        onEvent(event);
      }
    }
    if (chunk.done) break;
  }
  if (streamError) throw new Error(streamError);
  return wasCancelled ? "cancelled" : "completed";
}

export function cancelDownload(): Promise<unknown> {
  return request("/admin/download/cancel", { method: "POST" });
}
export async function shutdownGateway(): Promise<void> {
  try {
    await request("/admin/shutdown", { method: "POST" });
  } finally {
    if (isTauri()) {
      try { await invokeTauri("stop_gateway"); } catch { /* already stopped */ }
    }
  }
}

export async function translateStream(body: TranslationRequest, onEvent: (event: StreamEvent) => void): Promise<void> {
  const response = await fetch(GATEWAY_URL + "/translate/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) throw new Error("流式翻译请求失败 (" + response.status + ")");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";
    for (const raw of events) {
      const line = raw.split("\n").find((item) => item.startsWith("data: "));
      if (!line) continue;
      onEvent(JSON.parse(line.slice(6)) as StreamEvent);
    }
    if (chunk.done) break;
  }
}