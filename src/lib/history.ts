export interface TranslationHistory {
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

export const HISTORY_LIMIT = 30;

function openHistory(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("lat.history", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("translations", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("历史数据库被其他窗口占用"));
  });
}

export async function readHistory(): Promise<TranslationHistory[]> {
  const db = await openHistory();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("translations", "readonly");
      const request = tx.objectStore("translations").getAll();
      tx.oncomplete = () => resolve((request.result as TranslationHistory[]).sort((a, b) => b.createdAt - a.createdAt));
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export async function updateHistory(action: { add: TranslationHistory } | { remove: string } | { clear: true }): Promise<void> {
  const db = await openHistory();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("translations", "readwrite");
      const store = tx.objectStore("translations");
      if ("clear" in action) store.clear();
      else if ("remove" in action) store.delete(action.remove);
      else {
        store.put(action.add);
        const request = store.getAll();
        request.onsuccess = () => {
          const rows = (request.result as TranslationHistory[]).sort((a, b) => b.createdAt - a.createdAt);
          for (const row of rows.slice(HISTORY_LIMIT)) store.delete(row.id);
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
