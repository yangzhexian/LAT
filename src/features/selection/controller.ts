import type { TranslationHistory } from "../../lib/history";
import { languageName } from "../../lib/languages";
import type { SelectionSnapshot } from "../../lib/selection";
import type { LocalStatus, StreamEvent, TranslationRequest } from "../../types";

export const SELECTION_LIMIT = 5000;
export const selectionLength = (text: string): number => Array.from(text).length;

export interface SelectionView {
  requestId: string;
  source: string;
  translation: string;
  phase: "idle" | "translating" | "complete" | "error" | "model-required";
  message: string;
  progress: number | null;
}

export const EMPTY_SELECTION_VIEW: SelectionView = {
  requestId: "", source: "", translation: "", phase: "idle",
  message: "选中文字后使用快捷键，或在此粘贴原文", progress: null,
};

interface Dependencies {
  status: (signal: AbortSignal) => Promise<LocalStatus>;
  translate: (body: TranslationRequest, onEvent: (event: StreamEvent) => void, signal: AbortSignal) => Promise<void>;
  cancel: (id: string) => Promise<unknown>;
  busy: (busy: boolean) => Promise<unknown>;
  save: (requestId: string, row: TranslationHistory) => Promise<unknown>;
  changed: (view: SelectionView) => void;
}

// Owns exactly one popup request. Generation guards also cover native dismissal,
// a pending status request, and old streams that deliver after being aborted.
export class SelectionController {
  view: SelectionView = { ...EMPTY_SELECTION_VIEW };
  private generation = 0;
  private disposed = false;
  private controller: AbortController | null = null;
  private jobId: string | null = null;
  private newestSnapshot = -1n;
  private lastSnapshot = "";
  constructor(private readonly deps: Dependencies) {}

  private update(next: Partial<SelectionView>): void {
    if (this.disposed) return;
    this.view = { ...this.view, ...next };
    this.deps.changed(this.view);
  }

  accept(snapshot: SelectionSnapshot, language: string): boolean {
    if (this.disposed || this.view.phase === "translating" || snapshot.requestId === this.lastSnapshot) return false;
    if (/^\d+$/.test(snapshot.requestId)) {
      const order = BigInt(snapshot.requestId);
      if (order <= this.newestSnapshot) return false;
      this.newestSnapshot = order;
    }
    this.lastSnapshot = snapshot.requestId;
    this.generation++;
    this.update({ ...EMPTY_SELECTION_VIEW, requestId: snapshot.requestId, source: snapshot.text,
      message: snapshot.error || EMPTY_SELECTION_VIEW.message });
    if (snapshot.text.trim()) void this.run(language);
    return true;
  }

  edit(source: string): void {
    if (this.view.phase === "translating") return;
    this.generation++;
    this.update({ source, translation: "", phase: "idle", progress: null, message: "准备翻译" });
  }

  notify(message: string): void { this.update({ message }); }

  async run(language: string): Promise<void> {
    if (this.disposed || this.view.phase === "translating" || !this.view.source.trim()) return;
    if (selectionLength(this.view.source) > SELECTION_LIMIT) {
      this.update({ phase: "idle", message: "原文超过 5,000 字符，请转到主窗口翻译，全文将被保留。" });
      return;
    }
    const generation = ++this.generation;
    const live = () => !this.disposed && generation === this.generation;
    const source = this.view.source;
    const requestId = this.view.requestId;
    const abort = new AbortController();
    this.controller = abort;
    this.jobId = null;
    this.update({ phase: "translating", translation: "", progress: null, message: "正在连接本地模型…" });
    let completed: StreamEvent | null = null;
    let failure: StreamEvent | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await this.deps.busy(true);
      if (!live()) return;
      const status = await Promise.race([this.deps.status(abort.signal), new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          abort.abort();
          reject(new Error("本地网关未响应，请稍后重试"));
        }, 6000);
      })]);
      clearTimeout(timer);
      if (!live()) return;
      if (!status.ready) {
        this.update({ phase: "model-required", message: "模型尚未启用。启用后返回此窗口重试。" });
        return;
      }
      await this.deps.translate({ text: source, source_language: languageName("auto"),
        target_language: languageName(language), require_ready: true, request_source: "selection" }, (event) => {
        if (!live() || completed || failure) return;
        if (event.job_id) this.jobId = event.job_id;
        if (event.total_chars && event.completed_chars != null) {
          this.update({ progress: Math.min(100, event.completed_chars / event.total_chars * 100) });
        }
        if (event.type === "plan") this.update({ translation: event.translation || "", message: "正在翻译…" });
        if (event.type === "waiting") this.update({ message: event.message || (event.queue_position
          ? `正在排队 · 第 ${event.queue_position} 位` : "正在等待当前分段完成…") });
        if (event.type === "attempt") this.update({ message: "正在翻译…" });
        if (event.type === "segment_complete") this.update({ translation: this.view.translation + (event.translation || ""), message: "正在翻译…" });
        if (event.type === "retry") this.update({ message: "正在重新校验当前分段…" });
        if (event.type === "error") failure = event;
        if (event.type === "complete") completed = event;
      }, abort.signal);
      if (!live()) return;
      const finalEvent = completed as StreamEvent | null;
      const errorEvent = failure as StreamEvent | null;
      if (errorEvent) throw Object.assign(new Error(errorEvent.message || "翻译失败"), { code: errorEvent.code });
      if (!finalEvent) throw new Error("翻译已中止，请重试");
      this.jobId = null;
      this.update({ translation: finalEvent.translation || "", phase: "complete", progress: 100,
        message: finalEvent.quality_issues?.length ? "翻译完成，存在质量提示" : "翻译完成" });
      try {
        await this.deps.save(requestId, { id: finalEvent.job_id || crypto.randomUUID(), createdAt: Date.now(),
          source, submittedText: source, translation: finalEvent.translation || "", sourceLanguage: "auto",
          targetLanguage: language, model: finalEvent.model || status.active_model || status.model_configured,
          metrics: finalEvent.metrics, origin: "selection" });
      } catch { if (live()) this.update({ message: "翻译完成，但历史记录未能保存到本机" }); }
    } catch (error) {
      if (!live()) return;
      const code = (failure as StreamEvent | null)?.code || (error as { code?: string })?.code;
      const message = code === "translation_busy" ? "其他翻译已占满等待队列，请稍后重试。"
        : code === "translation_queue_timeout" ? "等待模型的时间过长，请稍后重试。"
        : code === "model_not_ready" ? "模型尚未启用。启用后返回此窗口重试。"
        : error instanceof Error ? error.message : String(error);
      this.update({ phase: code === "model_not_ready" ? "model-required" : "error", message });
    } finally {
      clearTimeout(timer);
      if (live()) {
        this.controller = null;
        this.jobId = null;
        void this.deps.busy(false).catch(() => undefined);
      }
    }
  }

  dismiss(): void {
    this.generation++;
    const job = this.jobId;
    this.jobId = null;
    this.controller?.abort();
    this.controller = null;
    if (job) void this.deps.cancel(job).catch(() => undefined);
    void this.deps.busy(false).catch(() => undefined);
    this.update({ ...EMPTY_SELECTION_VIEW });
  }

  dispose(): void { this.dismiss(); this.disposed = true; }
}
