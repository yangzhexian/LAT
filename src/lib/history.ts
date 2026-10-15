export interface TranslationHistory {
  origin?: "workspace" | "selection";
  id: string;
  createdAt: number;
  source: string;
  submittedText: string;
  translation: string;
  sourceLanguage: string;
  targetLanguage: string;
  model: string;
  metrics?: import("../types").TranslationMetrics;
}

export interface HistoryCursor { createdAt: number; id: string }
export interface HistoryFilters {
  query?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  model?: string;
  origin?: "workspace" | "selection";
}
export interface HistorySummary extends HistoryCursor {
  sourcePreview: string;
  translationPreview: string;
  sourceLanguage: string;
  targetLanguage: string;
  model: string;
  origin?: "workspace" | "selection";
  // UTF-8 bytes of the complete JSON record, excluding IndexedDB implementation overhead.
  bytes: number;
}

export const HISTORY_LIMIT = 30;
export const HISTORY_MAX_BYTES = 64 * 1024 * 1024;
const RECORDS = "translations";
const SUMMARIES = "summaries";
const ORDER = "createdAt_id";
const encoder = new TextEncoder();

function preview(text: string): string {
  let result = "";
  let count = 0;
  for (const character of text) {
    if (count++ === 160) break;
    result += character;
  }
  return result;
}

function summarize(row: TranslationHistory): HistorySummary {
  return {
    id: row.id, createdAt: row.createdAt,
    sourcePreview: preview(row.source ?? ""), translationPreview: preview(row.translation ?? ""),
    sourceLanguage: row.sourceLanguage, targetLanguage: row.targetLanguage, model: row.model,
    origin: row.origin, bytes: encoder.encode(JSON.stringify(row)).byteLength,
  };
}

function openHistory(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("lat.history", 2);
    let abandoned = false;
    let upgradeError: unknown;
    request.onupgradeneeded = () => {
      const db = request.result;
      const tx = request.transaction!;
      try {
        const records = db.objectStoreNames.contains(RECORDS) ? tx.objectStore(RECORDS) : db.createObjectStore(RECORDS, { keyPath: "id" });
        const summaries = db.createObjectStore(SUMMARIES, { keyPath: "id" });
        summaries.createIndex(ORDER, ["createdAt", "id"]);
        // The upgrade transaction preserves v1 full records and builds only their summaries.
        const cursor = records.openCursor();
        cursor.onsuccess = () => {
          try {
            if (!cursor.result) return;
            summaries.put(summarize(cursor.result.value as TranslationHistory));
            cursor.result.continue();
          } catch (error) { upgradeError = error; tx.abort(); }
        };
      } catch (error) { upgradeError = error; tx.abort(); }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Every webview releases its connection when another window upgrades/deletes the database.
      db.onversionchange = () => db.close();
      if (abandoned) db.close(); else resolve(db);
    };
    request.onerror = () => reject(upgradeError ?? request.error);
    request.onblocked = () => {
      abandoned = true;
      reject(new Error("历史数据库被其他窗口占用，请关闭旧版窗口后重试"));
    };
  });
}

async function transaction<T>(mode: IDBTransactionMode, run: (tx: IDBTransaction, result: (value: T) => void, fail: (error: unknown) => void) => void): Promise<T> {
  // A versionchange may close a connection after open succeeds but before transaction starts.
  for (let attempt = 0; ; attempt++) {
    const db = await openHistory();
    let tx: IDBTransaction;
    try { tx = db.transaction([RECORDS, SUMMARIES], mode); }
    catch (error) {
      db.close();
      if (attempt === 0 && error instanceof DOMException && error.name === "InvalidStateError") continue;
      throw error;
    }
    try {
      return await new Promise<T>((resolve, reject) => {
        let value: T;
        let failure: unknown;
        const fail = (error: unknown) => {
          failure = error;
          try { tx.abort(); } catch { reject(error); }
        };
        tx.oncomplete = () => resolve(value);
        tx.onabort = () => reject(failure ?? tx.error ?? new Error("历史数据库事务已取消"));
        // Request errors abort the transaction by default. Wait for abort before reporting failure.
        tx.onerror = () => {};
        try { run(tx, (next) => { value = next; }, fail); } catch (error) { fail(error); }
      });
    } finally { db.close(); }
  }
}

function matches(summary: HistorySummary, filters: HistoryFilters): boolean {
  return (!filters.sourceLanguage || summary.sourceLanguage === filters.sourceLanguage)
    && (!filters.targetLanguage || summary.targetLanguage === filters.targetLanguage)
    && (!filters.model || summary.model === filters.model)
    && (!filters.origin || (summary.origin ?? "workspace") === filters.origin);
}

function contains(row: TranslationHistory, query: string): boolean {
  return [row.source, row.submittedText, row.translation].some((text) => (text ?? "").toLocaleLowerCase().includes(query));
}

export function readHistoryPage(options: HistoryFilters & { limit?: number; before?: HistoryCursor } = {}): Promise<{ items: HistorySummary[]; nextCursor: HistoryCursor | null }> {
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(200, Math.floor(options.limit!))) : 20;
  const query = options.query?.trim().toLocaleLowerCase() ?? "";
  return transaction("readonly", (tx, result, fail) => {
    const items: HistorySummary[] = [];
    result({ items, nextCursor: null });
    const range = options.before ? IDBKeyRange.upperBound([options.before.createdAt, options.before.id], true) : undefined;
    const request = tx.objectStore(SUMMARIES).index(ORDER).openCursor(range, "prev");
    request.onsuccess = () => {
      try {
        const cursor = request.result;
        if (!cursor) return;
        const summary = cursor.value as HistorySummary;
        const accept = (matched: boolean) => {
          if (matched) {
            if (items.length === limit) {
              const last = items[items.length - 1];
              result({ items, nextCursor: { createdAt: last.createdAt, id: last.id } });
              return;
            }
            items.push(summary);
          }
          cursor.continue();
        };
        if (!matches(summary, options)) { cursor.continue(); return; }
        // Full text is fetched only for explicit keyword search, never for ordinary list pages.
        if (query) {
          const record = tx.objectStore(RECORDS).get(summary.id);
          record.onsuccess = () => {
            try { accept(!!record.result && contains(record.result, query)); } catch (error) { fail(error); }
          };
        } else accept(true);
      } catch (error) { fail(error); }
    };
  });
}

export function getHistoryRecord(id: string): Promise<TranslationHistory | undefined> {
  return transaction("readonly", (tx, result) => {
    const request = tx.objectStore(RECORDS).get(id);
    request.onsuccess = () => result(request.result as TranslationHistory | undefined);
  });
}

export function getHistoryStats(): Promise<{ count: number; bytes: number; models: string[] }> {
  return transaction("readonly", (tx, result, fail) => {
    let count = 0;
    let bytes = 0;
    const models = new Set<string>();
    const request = tx.objectStore(SUMMARIES).openCursor();
    request.onsuccess = () => {
      try {
        const cursor = request.result;
        if (!cursor) { result({ count, bytes, models: [...models].sort() }); return; }
        const row = cursor.value as HistorySummary;
        count++;
        bytes += row.bytes;
        if (row.model) models.add(row.model);
        cursor.continue();
      } catch (error) { fail(error); }
    };
  });
}

export function exportHistory(filters: HistoryFilters = {}): Promise<TranslationHistory[]> {
  const query = filters.query?.trim().toLocaleLowerCase() ?? "";
  return transaction("readonly", (tx, result, fail) => {
    const rows: TranslationHistory[] = [];
    result(rows);
    const request = tx.objectStore(SUMMARIES).index(ORDER).openCursor(undefined, "prev");
    request.onsuccess = () => {
      try {
        const cursor = request.result;
        if (!cursor) return;
        if (!matches(cursor.value as HistorySummary, filters)) { cursor.continue(); return; }
        const record = tx.objectStore(RECORDS).get(cursor.primaryKey);
        record.onsuccess = () => {
          try {
            if (record.result && (!query || contains(record.result, query))) rows.push(record.result as TranslationHistory);
            cursor.continue();
          } catch (error) { fail(error); }
        };
      } catch (error) { fail(error); }
    };
  });
}

// Compatibility for callers that explicitly need all full records (for example legacy exports).
export function readHistory(): Promise<TranslationHistory[]> { return exportHistory(); }

export async function updateHistory(action: { add: TranslationHistory } | { remove: string } | { clear: true } | { trim: true }, limit = HISTORY_LIMIT, maxBytes = HISTORY_MAX_BYTES): Promise<void> {
  const countLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : HISTORY_LIMIT;
  const byteLimit = Number.isFinite(maxBytes) ? Math.max(1, Math.floor(maxBytes)) : HISTORY_MAX_BYTES;
  // Snapshot before opening the transaction so a caller cannot mutate a record while open is pending.
  const row = "add" in action ? structuredClone(action.add) : undefined;
  const summary = row ? summarize(row) : undefined;
  if (summary && summary.bytes > byteLimit) throw new Error("单条历史记录超过存储容量，原有记录已保留");
  if (summary && (!summary.id || !Number.isFinite(summary.createdAt))) throw new Error("历史记录标识或时间无效");
  return transaction("readwrite", (tx, result, fail) => {
    result(undefined);
    const records = tx.objectStore(RECORDS);
    const summaries = tx.objectStore(SUMMARIES);
    if ("clear" in action) { records.clear(); summaries.clear(); return; }
    if ("remove" in action) { records.delete(action.remove); summaries.delete(action.remove); return; }
    if (row && summary) { records.put(row); summaries.put(summary); }
    let count = 0;
    let bytes = 0;
    let full = false;
    const request = summaries.index(ORDER).openCursor(undefined, "prev");
    request.onsuccess = () => {
      try {
        const cursor = request.result;
        if (!cursor) return;
        const item = cursor.value as HistorySummary;
        full ||= count >= countLimit || bytes + item.bytes > byteLimit;
        if (full) { records.delete(item.id); cursor.delete(); }
        else { count++; bytes += item.bytes; }
        cursor.continue();
      } catch (error) { fail(error); }
    };
  });
}
