import { useEffect, useRef, useState } from "react";
import { Button, EmptyState, Notice } from "../../components/Controls";
import { exportHistory, getHistoryRecord, getHistoryStats, readHistoryPage, type HistoryCursor, type HistoryFilters, type HistorySummary, type TranslationHistory } from "../../lib/history";
import { LANGUAGES, languageName } from "../../lib/languages";
import type { UserSettings } from "../../types";
import "./history.css";

interface HistoryPageProps {
  settings: UserSettings;
  revision: number;
  busy: boolean;
  error?: string;
  onRetry: () => void;
  onRestore: (row: TranslationHistory) => void;
  onRemove: (id: string) => Promise<void>;
}

export function historyMarkdown(rows: TranslationHistory[]): string {
  const fence = (text: string) => "`".repeat((text.match(/`+/g) || []).reduce((length, run) => Math.max(length, run.length + 1), 3));
  return "# 翻译历史\n\n" + rows.map((row) => {
    const delimiter = fence(row.source + row.translation);
    return `## ${new Date(row.createdAt).toISOString()}\n\n${row.sourceLanguage} → ${row.targetLanguage} · ${row.model} · ${row.origin === "selection" ? "划词翻译" : "工作区"}\n\n### 原文\n\n${delimiter}text\n${row.source}\n${delimiter}\n\n### 译文\n\n${delimiter}text\n${row.translation}\n${delimiter}\n`;
  }).join("\n");
}

function RecordBody({ id }: { id: string }) {
  const [row, setRow] = useState<TranslationHistory>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    void getHistoryRecord(id).then((record) => {
      if (!active) return;
      if (record) setRow(record);
      else setError("记录已不存在，请刷新列表。");
    }).catch(() => { if (active) setError("无法读取完整记录"); });
    return () => { active = false; };
  }, [id, attempt]);
  if (error) return <Notice tone="error">{error}<Button onClick={() => setAttempt((value) => value + 1)}>重试读取</Button></Notice>;
  if (!row) return <Notice>正在读取完整记录…</Notice>;
  return <div className="history-comparison"><section><h3>原文 · {languageName(row.sourceLanguage)}</h3><div className="history-text">{row.source}</div></section><section><h3>译文 · {languageName(row.targetLanguage)}</h3><div className="history-text">{row.translation}</div></section></div>;
}

export function HistoryPage({ settings, revision, busy, error: mutationError, onRetry, onRestore, onRemove }: HistoryPageProps) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<HistoryFilters>({});
  const [cursors, setCursors] = useState<(HistoryCursor | undefined)[]>([undefined]);
  const [items, setItems] = useState<HistorySummary[]>([]);
  const [nextCursor, setNextCursor] = useState<HistoryCursor | null>();
  const [stats, setStats] = useState({ count: 0, bytes: 0, models: [] as string[] });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [working, setWorking] = useState(false);
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const locked = useRef(false);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const searchPending = query.trim() !== (filters.query || "");
  useEffect(() => {
    if (!searchPending) return;
    const timer = window.setTimeout(() => {
      setFilters((current) => (current.query || "") === query.trim() ? current : { ...current, query: query.trim() });
      setCursors([undefined]);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, searchPending]);
  useEffect(() => { setCursors((current) => current.length === 1 ? current : [undefined]); setExpanded(null); }, [revision]);
  useEffect(() => {
    const request = ++generation.current;
    let active = true;
    setLoading(true); setError(""); setExpanded(null); setItems([]);
    // Invalidate the previous request as soon as typing begins, before debounce settles.
    if (searchPending) return () => { active = false; };
    void Promise.all([readHistoryPage({ ...filters, limit: 20, before: cursors.at(-1) }), getHistoryStats()]).then(([page, totals]) => {
      if (!active || generation.current !== request) return;
      setItems(page.items); setNextCursor(page.nextCursor); setStats(totals); setLoading(false);
    }).catch(() => { if (active && generation.current === request) { setError("无法读取本地历史记录"); setLoading(false); } });
    return () => { active = false; };
  }, [filters, cursors, revision, reload, searchPending]);
  function changeFilter(key: keyof HistoryFilters, value: string) {
    setFilters((current) => ({ ...current, [key]: value || undefined })); setCursors([undefined]);
  }
  function clearFilters() { setQuery(""); setFilters({}); setCursors([undefined]); }
  async function recordAction(id: string, restore: boolean) {
    if (busyRef.current || locked.current) return;
    locked.current = true; setWorking(true); setActionError("");
    try {
      if (restore) {
        const row = await getHistoryRecord(id);
        if (!row) throw new Error("记录已不存在，请刷新列表。");
        if (!busyRef.current) onRestore(row);
      } else {
        await onRemove(id);
        setCursors([undefined]); setReload((value) => value + 1);
      }
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : "历史操作失败，请重试"); }
    finally { locked.current = false; setWorking(false); }
  }
  async function download(format: "json" | "md") {
    if (locked.current || searchPending || loading) return;
    locked.current = true; setWorking(true); setActionError("");
    try {
      const rows = await exportHistory(filters);
      const blob = new Blob([format === "json" ? JSON.stringify(rows, null, 2) : historyMarkdown(rows)], { type: format === "json" ? "application/json;charset=utf-8" : "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `LAT-history-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.append(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setActionError("导出失败，请重试导出。"); }
    finally { locked.current = false; setWorking(false); }
  }
  const filtered = Object.values(filters).some(Boolean) || Boolean(query);
  return <section className="history-page" aria-label="历史记录列表">
    <p className="history-description" title="完整记录 JSON 的 UTF-8 字节数，不含 IndexedDB 索引和磁盘开销">仅保存在本机 · 共 {stats.count} 条 · 内容容量 {(stats.bytes / 1048576).toFixed(2)} / {settings.historyStorageMiB ?? 64} MiB · 最多 {settings.historyLimit ?? 30} 条{settings.saveHistory === false ? " · 已暂停保存新记录" : ""}</p>
    {(stats.bytes > (settings.historyStorageMiB ?? 64) * 1048576 || stats.count > (settings.historyLimit ?? 30)) && <Notice>已有历史超过当前保留上限。下次保存成功或调整上限时，将淘汰最旧记录；可先导出保留。</Notice>}
    <div className="history-filters">
      <label className="history-search"><span>搜索全文</span><input type="search" value={query} placeholder="搜索原文和译文" onChange={(event) => setQuery(event.target.value)} /></label>
      {([['sourceLanguage', '原文语言'], ['targetLanguage', '译文语言']] as const).map(([key, label]) => <label key={key}><span>{label}</span><select value={filters[key] || ""} onChange={(event) => changeFilter(key, event.target.value)}><option value="">全部语言</option>{LANGUAGES.filter((language) => key === "sourceLanguage" || language.code !== "auto").map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}</select></label>)}
      <label><span>模型</span><select value={filters.model || ""} onChange={(event) => changeFilter("model", event.target.value)}><option value="">全部模型</option>{[...new Set([...stats.models, ...(filters.model ? [filters.model] : [])])].map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
      <label><span>来源</span><select value={filters.origin || ""} onChange={(event) => changeFilter("origin", event.target.value)}><option value="">全部来源</option><option value="workspace">工作区</option><option value="selection">划词翻译</option></select></label>
    </div>
    <div className="history-toolbar"><Button disabled={!filtered} onClick={clearFilters}>清除筛选</Button><span>导出当前筛选的完整记录</span><Button disabled={working || loading || Boolean(error)} onClick={() => void download("json")}>导出 JSON</Button><Button disabled={working || loading || Boolean(error)} onClick={() => void download("md")}>导出 Markdown</Button></div>
    {mutationError && <Notice tone="error">{mutationError}<Button onClick={onRetry}>重试更新</Button></Notice>}
    {actionError && <Notice tone="error">{actionError}</Notice>}
    {error ? <Notice tone="error">{error}<Button onClick={() => setReload((value) => value + 1)}>重试读取</Button></Notice> : loading ? <Notice>正在读取历史记录…</Notice> : !items.length ? <EmptyState title={filtered ? "没有符合筛选条件的记录" : "还没有翻译历史"} action={filtered ? <Button onClick={clearFilters}>清除筛选</Button> : undefined}>{filtered ? "尝试其他关键词、语言、模型或来源。" : "完成翻译后，记录会出现在这里。"}</EmptyState> : <>
      <p className="history-page-count" role="status">第 {cursors.length} 页 · 本页 {items.length} 条{filtered ? " · 已应用筛选" : ""}</p>
      <div className="history-grid">{items.map((row) => <article className={"history-card" + (expanded === row.id ? " is-expanded" : "")} key={row.id}>
        <div className="history-meta">{row.origin === "selection" ? "划词翻译" : "工作区"} · {new Date(row.createdAt).toLocaleString()} · {row.sourceLanguage} → {row.targetLanguage} · {row.model}</div>
        <p className="history-excerpt">{row.sourcePreview}</p><p className="history-excerpt history-translation-excerpt">{row.translationPreview}</p>
        <Button className="history-expand mini-button" aria-expanded={expanded === row.id} onClick={() => setExpanded((current) => current === row.id ? null : row.id)}>{expanded === row.id ? "收起完整记录" : "查看完整记录"}</Button>
        {expanded === row.id && <RecordBody id={row.id} />}
        <div className="history-actions"><Button disabled={busy || working} onClick={() => void recordAction(row.id, true)}>恢复到工作区</Button><Button className="mini-button" disabled={busy || working} onClick={() => void recordAction(row.id, false)}>删除</Button></div>
      </article>)}</div>
      <nav className="history-pagination" aria-label="历史分页"><Button disabled={loading || cursors.length === 1} onClick={() => setCursors((current) => current.slice(0, -1))}>上一页</Button><span>第 {cursors.length} 页</span><Button disabled={loading || !nextCursor} onClick={() => { if (nextCursor) setCursors((current) => [...current, nextCursor]); }}>下一页</Button></nav>
    </>}
  </section>;
}
