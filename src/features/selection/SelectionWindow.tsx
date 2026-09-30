import { useEffect, useRef, useState } from "react";
import { MathJaxContext } from "better-react-mathjax";
import { Button } from "../../components/Controls";
import { Icon } from "../../components/Icon";
import { LatexPreview } from "../../components/LatexPreview";
import { cancelTranslation, getStatus, translateStream } from "../../lib/api";
import { LANGUAGES } from "../../lib/languages";
import { mathJaxConfig } from "../../lib/mathjax";
import { applySelectionAppearance, DEFAULT_SELECTION_CONFIG, invokeSelection, isSelectionDesktop,
  type SelectionConfig, type SelectionSnapshot } from "../../lib/selection";
import { EMPTY_SELECTION_VIEW, SELECTION_LIMIT, SelectionController, selectionLength } from "./controller";
import "../../styles.css";
import "../../components/controls.css";
import "./selection.css";

function ActionIcon({ name }: { name: "pin" | "copy" | "expand" }) {
  const paths = {
    pin: "m9 3 6 0-1 5 4 4v2H6v-2l4-4-1-5ZM12 14v7",
    copy: "M8 8h12v13H8ZM16 8V3H3v13h5",
    expand: "M14 3h7v7M21 3l-9 9M10 3H3v18h18v-7",
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function SelectionWindow() {
  const [view, setView] = useState(EMPTY_SELECTION_VIEW);
  const [config, setConfig] = useState(DEFAULT_SELECTION_CONFIG);
  const configRef = useRef(config);
  const controllerRef = useRef<SelectionController | null>(null);
  const [pinned, setPinned] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [nativeReady, setNativeReady] = useState(false);
  const busy = view.phase === "translating";
  const overLimit = selectionLength(view.source) > SELECTION_LIMIT;

  useEffect(() => {
    let stopped = false;
    let readVersion = 0;
    let configVersion = 0;
    let configReady = false;
    let pendingSnapshot: SelectionSnapshot | null = null;
    const unlisten: (() => void)[] = [];
    document.documentElement.dataset.selectionWindow = "popup";
    if (!isSelectionDesktop()) {
      setView({ ...EMPTY_SELECTION_VIEW, message: "划词浮窗需要在 LAT 桌面应用中打开" });
      return () => { delete document.documentElement.dataset.selectionWindow; };
    }
    let controller: SelectionController | undefined;
    async function initialize() {
      const { listen, emitTo } = await import("@tauri-apps/api/event");
      if (stopped) return;
      controller = new SelectionController({ status: getStatus, translate: translateStream, cancel: cancelTranslation,
        busy: (value) => invokeSelection("selection_set_busy", { busy: value }),
        save: (requestId, row) => emitTo("main", "selection-history", { requestId, row }),
        changed: (next) => { if (!stopped) setView(next); },
      });
      controllerRef.current = controller;
      const acceptConfig = (next: SelectionConfig) => {
        configRef.current = next;
        setConfig(next);
        applySelectionAppearance(next);
      };
      const attach = async <T,>(event: string, callback: (payload: T) => void) => {
        const off = await listen<T>(event, ({ payload }) => { if (!stopped) callback(payload); });
        if (stopped) off(); else unlisten.push(off);
      };
      await attach<SelectionSnapshot>("selection-ready", (snapshot) => {
        readVersion++;
        if (!configReady) { pendingSnapshot = snapshot; return; }
        if (controller?.accept(snapshot, configRef.current.targetLanguage)) {
          setSourceOpen(!snapshot.text.trim());
          setPreview(false);
        }
      });
      await attach<SelectionConfig>("selection-config", (next) => { configVersion++; acceptConfig(next); });
      await attach("selection-dismissed", () => {
        readVersion++;
        pendingSnapshot = null;
        controller?.dismiss();
        setPinned(false);
      });
      await attach<{ pinned: boolean }>("selection-pinned", (next) => setPinned(next.pinned));
      await attach<{ requestId: string; saved: boolean; error?: string }>("selection-history-result", (result) => {
        if (result.requestId === controller?.view.requestId && controller.view.phase === "complete" && result.error) {
          controller.notify("翻译完成，但历史记录未能保存到本机");
        }
      });
      if (stopped) return;
      const configAtRead = configVersion;
      const nextConfig = await invokeSelection<SelectionConfig>("selection_get_config");
      if (stopped) return;
      if (configVersion === configAtRead) acceptConfig(nextConfig);
      configReady = true;
      if (pendingSnapshot) {
        const pending = pendingSnapshot as SelectionSnapshot;
        if (controller.accept(pending, configRef.current.targetLanguage)) setSourceOpen(!pending.text.trim());
      }
      const selectionAtRead = readVersion;
      const snapshot = await invokeSelection<SelectionSnapshot | null>("selection_snapshot");
      if (stopped) return;
      setNativeReady(true);
      if (readVersion === selectionAtRead && snapshot) {
        if (controller.accept(snapshot, configRef.current.targetLanguage)) setSourceOpen(!snapshot.text.trim());
      }
    }
    void initialize().catch((error) => {
      if (!stopped) setView({ ...EMPTY_SELECTION_VIEW, phase: "error", message: String(error) });
    });
    return () => {
      stopped = true;
      unlisten.forEach((off) => off());
      controller?.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
      delete document.documentElement.dataset.selectionWindow;
    };
  }, []);

  async function close() {
    controllerRef.current?.dismiss();
    try { await invokeSelection("selection_dismiss"); }
    catch (error) { controllerRef.current?.notify(String(error)); }
  }
  async function transfer(text?: string) {
    try { await invokeSelection("selection_open_main", text === undefined ? {} : { text }); }
    catch (error) { controllerRef.current?.notify(String(error)); }
  }
  async function togglePin() {
    try { await invokeSelection("selection_set_pinned", { pinned: !pinned }); setPinned(!pinned); }
    catch (error) { controllerRef.current?.notify(String(error)); }
  }
  async function setLanguage(language: string) {
    const next = { ...configRef.current, targetLanguage: language };
    configRef.current = next;
    setConfig(next);
    try {
      const { emitTo } = await import("@tauri-apps/api/event");
      await emitTo("main", "selection-target-language", { language });
    } catch { controllerRef.current?.notify("目标语言偏好未能保存，本次仍使用所选语言"); }
  }
  async function copy() {
    const active = controllerRef.current;
    const requestId = active?.view.requestId;
    try {
      await invokeSelection("selection_copy", { text: view.translation });
      if (active?.view.requestId === requestId && active?.view.phase === "complete") active.notify("译文已复制");
    } catch (error) {
      if (active?.view.requestId === requestId && active?.view.phase === "complete") active.notify(String(error));
    }
  }

  return <MathJaxContext version={3} config={mathJaxConfig} src="/mathjax/tex-chtml.js">
    <main className="selection-window" onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); void close(); }
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void controllerRef.current?.run(config.targetLanguage); }
    }}>
      <header className="selection-header" data-tauri-drag-region>
        <div className="selection-brand" data-tauri-drag-region><Icon name="translate" /><strong data-tauri-drag-region>划词翻译</strong><span>LAT</span></div>
        <div className="selection-actions">
          <Button className="icon-button" aria-label={pinned ? "取消固定窗口" : "固定窗口"} title={pinned ? "取消固定" : "固定窗口"} aria-pressed={pinned} onClick={() => void togglePin()}><ActionIcon name="pin" /></Button>
          <Button className="icon-button" aria-label="转到主窗口" title="转到主窗口" disabled={busy} onClick={() => void transfer(view.source || undefined)}><ActionIcon name="expand" /></Button>
          <Button className="icon-button" aria-label="关闭划词翻译" title="关闭 · Esc" onClick={() => void close()}><Icon name="close" /></Button>
        </div>
      </header>
      <div className="selection-language-bar"><span>自动检测<Icon name="swap" /></span><label>译为
        <select aria-label="划词目标语言" value={config.targetLanguage} disabled={busy} onChange={(event) => void setLanguage(event.target.value)}>
          {LANGUAGES.filter((language) => language.code !== "auto").map((language) => <option key={language.code} value={language.code}>{language.label} · {language.name}</option>)}
        </select></label></div>
      <div className="selection-content">
        <section className="selection-source">
          <Button className="selection-source-toggle" aria-expanded={sourceOpen || !view.source} onClick={() => setSourceOpen(!sourceOpen)}><span>原文 <small>{selectionLength(view.source).toLocaleString()} 字符</small></span><Icon name="chevron" /></Button>
          {(sourceOpen || !view.source) && <textarea aria-label="划词原文" placeholder="未能读取选区时，请在这里粘贴原文" value={view.source} readOnly={busy} onChange={(event) => controllerRef.current?.edit(event.target.value)} />}
        </section>
        {overLimit && <div className="selection-notice"><p>原文超过 5,000 字符，请使用主窗口的长文本翻译。</p><Button onClick={() => void transfer(view.source)}>保留全文并转到主窗口</Button></div>}
        {!overLimit && <section className="selection-result" aria-label="划词译文">
          <div className="selection-result-header"><strong>译文</strong><div className="selection-view-options" role="group" aria-label="译文显示方式">
            <Button className="text-button" aria-pressed={!preview} onClick={() => setPreview(false)}>文本</Button>
            <Button className="text-button" aria-pressed={preview} onClick={() => setPreview(true)}>LaTeX</Button>
          </div></div>
          {view.translation ? preview ? <LatexPreview value={view.translation} /> : <div className="selection-result-text">{view.translation}</div>
            : <div className="selection-empty">{busy ? <><span className="selection-pulse" />模型正在本地翻译</> : "译文将在这里显示"}</div>}
        </section>}
      </div>
      <footer className="selection-footer">
        {busy && <div className="selection-progress"><progress aria-label="划词翻译进度" max={100} value={view.progress ?? undefined} /></div>}
        <div className="selection-status" role="status">{view.message}</div>
        <div className="selection-footer-actions">
          {view.phase === "model-required" && <Button onClick={() => void transfer()}>前往启用模型</Button>}
          <Button className="icon-button" aria-label="复制译文" title="复制译文" disabled={!view.translation || busy} onClick={() => void copy()}><ActionIcon name="copy" /></Button>
          <Button className="primary-button" disabled={!nativeReady || busy || !view.source.trim() || overLimit} onClick={() => void controllerRef.current?.run(config.targetLanguage)}>{busy ? "翻译中…" : view.phase === "idle" ? "翻译" : "重新翻译"}</Button>
        </div>
      </footer>
    </main>
  </MathJaxContext>;
}

export function SelectionBubble() {
  const [error, setError] = useState("");
  useEffect(() => {
    document.documentElement.dataset.selectionWindow = "bubble";
    let stopped = false;
    let off: (() => void) | undefined;
    let version = 0;
    async function initialize() {
      if (!isSelectionDesktop()) return;
      const { listen } = await import("@tauri-apps/api/event");
      if (stopped) return;
      const unlisten = await listen<SelectionConfig>("selection-config", ({ payload }) => {
        if (!stopped) { version++; applySelectionAppearance(payload); }
      });
      if (stopped) { unlisten(); return; }
      off = unlisten;
      const atRead = version;
      const config = await invokeSelection<SelectionConfig>("selection_get_config");
      if (!stopped && version === atRead) applySelectionAppearance(config);
    }
    void initialize().catch(() => undefined);
    return () => { stopped = true; off?.(); delete document.documentElement.dataset.selectionWindow; };
  }, []);
  return <Button className="selection-bubble" aria-label="翻译所选文字" title={error || "翻译所选文字"} onClick={(event) => {
    // Physical clicks are handled by the native down/up pair, even when WebView2
    // misses the first click. Keep synthetic accessibility activation available.
    if (event.detail !== 0) return;
    void invokeSelection("selection_activate").catch((reason) => setError(String(reason)));
  }}><Icon name="translate" /></Button>;
}
