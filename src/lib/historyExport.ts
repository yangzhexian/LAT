import type { TranslationHistory } from "./history";

export type HistoryExportFormat = "json" | "md";
export type HistoryExportResult = { status: "saved"; path: string } | { status: "cancelled" } | { status: "downloaded"; filename: string };

export function historyMarkdown(rows: TranslationHistory[]): string {
  const fence = (text: string) => "`".repeat((text.match(/`+/g) || []).reduce((length, run) => Math.max(length, run.length + 1), 3));
  return "# 翻译历史\n\n" + rows.map((row) => {
    const delimiter = fence(row.source + row.translation);
    return `## ${new Date(row.createdAt).toISOString()}\n\n${row.sourceLanguage} 译为 ${row.targetLanguage}，${row.model}（${row.origin === "selection" ? "划词翻译" : "工作区"}）\n\n### 原文\n\n${delimiter}text\n${row.source}\n${delimiter}\n\n### 译文\n\n${delimiter}text\n${row.translation}\n${delimiter}\n`;
  }).join("\n");
}

export async function saveHistoryExport(rows: TranslationHistory[], format: HistoryExportFormat): Promise<HistoryExportResult> {
  const content = format === "json" ? JSON.stringify(rows, null, 2) : historyMarkdown(rows);
  if (window.__TAURI_INTERNALS__) {
    const { invoke } = await import("@tauri-apps/api/core");
    // The backend selects the destination itself; no frontend supplied path can be written.
    const path = await invoke<string | null>("save_history_export", { format, content });
    return path === null ? { status: "cancelled" } : { status: "saved", path };
  }
  const filename = `LAT-history-${new Date().toISOString().slice(0, 10)}.${format}`;
  const blob = new Blob([content], { type: format === "json" ? "application/json;charset=utf-8" : "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  try {
    anchor.href = url; anchor.download = filename;
    document.body.append(anchor); anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return { status: "downloaded", filename };
}
