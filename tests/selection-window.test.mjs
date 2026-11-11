import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

async function loadSelectionWindow() {
  const outfile = 'artifacts/validation/selection-window-test.mjs';
  await build({ entryPoints: ['src/features/selection/SelectionWindow.tsx'], outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' }, define: { 'import.meta.env.VITE_GATEWAY_URL': 'undefined', 'import.meta.env.DEV': 'false' }, plugins: [{ name: 'native-selection-test', setup(build) {
    build.onResolve({ filter: /^@tauri-apps\/api\/(core|event)$/ }, ({ path }) => ({ path, namespace: 'mock' }));
    build.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({ contents: path.endsWith('/core')
      ? 'export const invoke = (...args) => globalThis.__selectionTest.invoke(...args);'
      : 'export const listen = (...args) => globalThis.__selectionTest.listen(...args); export const emitTo = (...args) => globalThis.__selectionTest.emitTo(...args);' }));
    build.onResolve({ filter: /^better-react-mathjax$/ }, () => ({ path: 'mathjax', namespace: 'math' }));
    build.onLoad({ filter: /.*/, namespace: 'math' }, () => ({ contents: 'export const MathJaxContext = ({children}) => children; export const MathJax = ({children}) => children;' }));
  } }] });
  return import(pathToFileURL(resolve(outfile)).href);
}

test('popup listens before handshake, waits for remembered target, and cleans up StrictMode listeners', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/?window=selection' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  window.__TAURI_INTERNALS__ = {};
  const listeners = new Map();
  const calls = [];
  const emitted = [];
  let configResolve;
  let snapshotResolve;
  let streamController;
  const configRead = new Promise((resolve) => { configResolve = resolve; });
  const snapshotRead = new Promise((resolve) => { snapshotResolve = resolve; });
  globalThis.__selectionTest = {
    async invoke(command, args) {
      calls.push({ command, args });
      if (command === 'gateway_session') return { url: 'http://127.0.0.1:8787', token: 'session-test', instance_id: 'instance', protocol_version: 2 };
      if (command === 'selection_get_config') return configRead;
      if (command === 'selection_snapshot') return snapshotRead;
      return undefined;
    },
    async listen(event, callback) {
      const set = listeners.get(event) || new Set();
      set.add(callback);
      listeners.set(event, set);
      return () => set.delete(callback);
    },
    async emitTo(target, event, payload) { emitted.push({ target, event, payload }); },
  };
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(init.headers.get('Authorization'), 'Bearer session-test');
    if (url.endsWith('/admin/status')) return Response.json({ ready: true, model_configured: 'model', backend: 'llama.cpp' });
    if (url.endsWith('/translate/cancel')) return Response.json({ status: 'cancelling' });
    requests.push(JSON.parse(init.body));
    return new Response(new ReadableStream({ start(controller) {
      streamController = controller;
      init.signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
    } }));
  };
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { SelectionWindow } = await loadSelectionWindow();
  const root = createRoot(document.getElementById('root'));
  const wait = () => new Promise((resolve) => setTimeout(resolve, 20));
  const event = async (name, payload) => React.act(async () => {
    for (const callback of listeners.get(name) || []) callback({ payload });
    await wait();
  });
  try {
    await React.act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(SelectionWindow))); await wait(); });
    assert.equal(listeners.get('selection-ready').size, 1);
    assert.equal(listeners.get('selection-dismissed').size, 1);
    await event('selection-ready', { requestId: '102', text: 'Bonjour' });
    assert.equal(requests.length, 0, 'selection must not translate with default language while config is pending');
    await React.act(async () => {
      configResolve({ enabled: true, shortcut: 'Ctrl+Alt+T', clipboardFallback: true, closeToTray: true, theme: 'dark', reduceMotion: true, targetLanguage: 'en' });
      await wait();
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].target_language, 'English');
    assert.equal(requests[0].require_ready, true);
    assert.equal(document.documentElement.dataset.theme, 'dark');
    await React.act(async () => { snapshotResolve({ requestId: '101', text: 'Old source' }); await wait(); });
    assert.match(document.querySelector('.selection-source-toggle').textContent, /7 字符/);
    await React.act(async () => {
      streamController.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ type: 'plan', job_id: 'only-this-job' }) + '\n\n'));
      await wait();
    });
    await event('selection-dismissed');
    assert.equal(document.querySelector('textarea').value, '');
    assert.equal(emitted.filter(({ event }) => event === 'selection-history').length, 0);
    await React.act(async () => root.unmount());
    for (const set of listeners.values()) assert.equal(set.size, 0);
  } finally {
    await React.act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    delete globalThis.__selectionTest;
    dom.window.close();
  }
});

test('bubble leaves physical clicks to native capture and preserves accessible activation', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/?window=selection-bubble' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  window.__TAURI_INTERNALS__ = {};
  const calls = [];
  const listeners = new Set();
  globalThis.__selectionTest = {
    async invoke(command) {
      calls.push(command);
      if (command === 'selection_get_config') return { theme: 'light', reduceMotion: false };
    },
    async listen(_event, callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { SelectionBubble } = await loadSelectionWindow();
  const root = createRoot(document.getElementById('root'));
  try {
    await React.act(async () => {
      root.render(React.createElement(React.StrictMode, null, React.createElement(SelectionBubble)));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    assert.equal(listeners.size, 1);
    const button = document.querySelector('[aria-label="翻译所选文字"]');
    for (const detail of [1, 2]) {
      await React.act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, detail })));
    }
    assert.equal(calls.filter((command) => command === 'selection_activate').length, 0, 'DOM mouse clicks must not duplicate the native request');
    await React.act(async () => button.click());
    assert.equal(calls.filter((command) => command === 'selection_activate').length, 1);
  } finally {
    await React.act(async () => root.unmount());
    assert.equal(listeners.size, 0);
    delete globalThis.__selectionTest;
    dom.window.close();
  }
});

test('unpinned popup drags from title, icon and header while controls retain their actions', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/?window=selection' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  window.__TAURI_INTERNALS__ = {};
  const calls = [];
  const listeners = new Set();
  globalThis.__selectionTest = {
    async invoke(command, args) {
      calls.push({ command, args });
      if (command === 'selection_get_config') return { theme: 'light', reduceMotion: false, targetLanguage: 'zh' };
      if (command === 'selection_snapshot') return null;
    },
    async listen(_event, callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    async emitTo() {},
  };
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { SelectionWindow } = await loadSelectionWindow();
  const root = createRoot(document.getElementById('root'));
  const press = (element, button = 0) => React.act(async () => element.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button, detail: 1 })));
  const dragCount = () => calls.filter(({ command }) => command === 'selection_start_dragging').length;
  try {
    await React.act(async () => {
      root.render(React.createElement(React.StrictMode, null, React.createElement(SelectionWindow)));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const pin = document.querySelector('[aria-label="固定窗口"]');
    assert.equal(pin.getAttribute('aria-pressed'), 'false');
    for (const selector of ['.selection-header', '.selection-brand strong', '.selection-brand span', '.selection-brand svg path']) {
      await press(document.querySelector(selector));
    }
    assert.equal(dragCount(), 4);
    assert.equal(pin.getAttribute('aria-pressed'), 'false', 'dragging must not pin the window');
    assert.equal(calls.filter(({ command }) => command === 'selection_set_pinned').length, 0);
    await press(document.querySelector('.selection-brand strong'), 1);
    await press(document.querySelector('.selection-brand strong'), 2);
    for (const button of document.querySelectorAll('.selection-actions button')) {
      await press(button);
      await press(button.querySelector('path'));
    }
    assert.equal(dragCount(), 4, 'right/middle clicks and action buttons must not drag');
    await React.act(async () => pin.click());
    assert.deepEqual(calls.find(({ command }) => command === 'selection_set_pinned').args, { pinned: true });
    await press(document.querySelector('.selection-brand strong'));
    assert.equal(dragCount(), 5, 'pinned windows are also draggable');
  } finally {
    await React.act(async () => root.unmount());
    assert.equal(listeners.size, 0);
    delete globalThis.__selectionTest;
    dom.window.close();
  }
});
