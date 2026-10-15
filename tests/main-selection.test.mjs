import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import 'fake-indexeddb/auto';
import { IDBObjectStore } from 'fake-indexeddb';

test('main coordinates native rollback, cross-window history and transfer without duplicate writes', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true });
  window.__TAURI_INTERNALS__ = {};
  const listeners = new Map();
  const emitted = [];
  let nativeConfig;
  let configured = 0;
  globalThis.__selectionBridge = {
    async invoke(command, args) {
      if (command === 'selection_configure') {
        configured++;
        if (args.config.shortcut === 'Ctrl+Alt+X') throw new Error('快捷键已被占用');
        nativeConfig = args.config;
        return nativeConfig;
      }
      if (command === 'selection_get_config') return nativeConfig;
      throw new Error('unexpected command ' + command);
    },
    async listen(name, callback) { listeners.set(name, callback); return () => listeners.delete(name); },
    async emitTo(target, name, payload) { emitted.push({ target, name, payload }); },
  };
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  await build({ stdin: { contents: 'export { useSelectionIntegration } from "./src/lib/selectionIntegration"; export { usePersistentSettings } from "./src/lib/settings"; export { readHistory, updateHistory } from "./src/lib/history";', resolveDir: process.cwd() }, outfile: 'artifacts/validation/main-selection-test.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', plugins: [{ name: 'mock-tauri', setup(builder) {
    builder.onResolve({ filter: /^@tauri-apps\/api\/(core|event)$/ }, (args) => ({ path: args.path, namespace: 'mock' }));
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const {invoke,listen,emitTo} = globalThis.__selectionBridge;', loader: 'js' }));
  } }] });
  const { useSelectionIntegration, usePersistentSettings, readHistory, updateHistory } = await import(pathToFileURL(resolve('artifacts/validation/main-selection-test.mjs')).href);
  await updateHistory({ clear: true });
  let change;
  let current;
  function Harness() {
    const [settings, setSettings] = usePersistentSettings();
    change = (next) => setSettings((old) => ({ ...old, ...next }));
    current = { ...useSelectionIntegration(settings, setSettings), settings };
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 25));
  const send = async (name, payload) => React.act(async () => { listeners.get(name)({ payload }); await settle(); });
  try {
    await React.act(async () => { root.render(React.createElement(Harness)); await settle(); });
    await React.act(settle);
    assert.equal(nativeConfig.enabled, false);
    await React.act(async () => { change({ selectionEnabled: true }); });
    await React.act(settle);
    assert.equal(nativeConfig.enabled, true);
    await React.act(async () => { change({ selectionShortcut: 'Ctrl+Alt+X' }); });
    await React.act(settle);
    await React.act(settle);
    assert.equal(current.settings.selectionShortcut, 'Ctrl+Alt+T');
    assert.match(current.error, /已被占用/);
    assert.ok(configured < 8, 'rollback does not loop');
    await send('selection-paused', { paused: true });
    await send('selection-busy', { busy: true });
    assert.equal(current.paused, true);
    assert.equal(current.busy, true);
    await React.act(async () => { change({ selectionEnabled: false }); });
    await React.act(settle);
    assert.equal(current.paused, false);
    await React.act(async () => { change({ selectionEnabled: true }); });
    await React.act(settle);
    assert.equal(current.paused, false);
    await send('selection-target-language', { language: 'en' });
    assert.equal(current.settings.selectionTargetLanguage, 'en');
    await send('selection-open-main', { text: 'full original' });
    assert.equal(current.transfer.text, 'full original');
    await send('selection-open-main', { text: null });
    assert.equal(current.transfer.text, undefined, 'native Option::None opens model page without inserting null');
    const row = { id: 'selected-job', createdAt: Date.now(), source: 'Hello', submittedText: 'Hello', translation: '你好', sourceLanguage: 'auto', targetLanguage: 'zh', model: 'test' };
    await send('selection-history', { requestId: 'request-1', row });
    await send('selection-history', { requestId: 'request-1', row });
    assert.equal((await readHistory()).length, 1);
    assert.equal((await readHistory())[0].origin, 'selection');
    assert.equal(emitted.filter((item) => item.name === 'selection-history-result').length, 2, 'each duplicate gets an idempotent acknowledgement');
    assert.equal(emitted.at(-1).payload.saved, true);

    const originalPut = IDBObjectStore.prototype.put;
    let writes = 0;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'translations') writes++;
      return originalPut.apply(this, args);
    };
    try {
      await React.act(async () => {
        const concurrent = { ...row, id: 'concurrent' };
        listeners.get('selection-history')({ payload: { requestId: 'concurrent-1', row: concurrent } });
        listeners.get('selection-history')({ payload: { requestId: 'concurrent-2', row: concurrent } });
        await settle();
      });
      assert.equal(writes, 1, 'concurrent duplicate deliveries share the same transaction');
      assert.deepEqual(emitted.slice(-2).map((item) => [item.payload.requestId, item.payload.saved]), [['concurrent-1', true], ['concurrent-2', true]]);
    } finally { IDBObjectStore.prototype.put = originalPut; }

    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'summaries') throw new DOMException('quota exceeded', 'QuotaExceededError');
      return originalPut.apply(this, args);
    };
    const retryRow = { ...row, id: 'retry-after-failure' };
    try {
      await send('selection-history', { requestId: 'failed', row: retryRow });
      assert.equal(emitted.at(-1).payload.saved, false);
      assert.match(emitted.at(-1).payload.error, /未能保存/);
    } finally { IDBObjectStore.prototype.put = originalPut; }
    assert.equal((await readHistory()).some((item) => item.id === retryRow.id), false);
    await send('selection-history', { requestId: 'retried', row: retryRow });
    assert.equal(emitted.at(-1).payload.saved, true);
    assert.equal((await readHistory()).some((item) => item.id === retryRow.id), true);

    await React.act(async () => { change({ historyStorageMiB: 1 / 1024 }); });
    const oversized = { ...row, id: 'oversized', source: 'a'.repeat(2000) };
    await send('selection-history', { requestId: 'oversized', row: oversized });
    assert.equal(emitted.at(-1).payload.saved, false, 'selection respects the configured byte limit');
    assert.equal((await readHistory()).length, 3, 'a rejected record preserves existing history');
    await React.act(async () => { change({ historyStorageMiB: 64 }); });
    await send('selection-history', { requestId: 'oversized-retry', row: oversized });
    assert.equal(emitted.at(-1).payload.saved, true);
    await React.act(async () => { change({ saveHistory: false }); });
    await send('selection-history', { requestId: 'request-2', row: { ...row, id: 'not-saved' } });
    assert.equal((await readHistory()).length, 4);
    assert.equal(emitted.at(-1).payload.saved, false);
  } finally {
    await React.act(async () => root.unmount());
    assert.equal(listeners.size, 0);
    delete globalThis.__selectionBridge;
    dom.window.close();
  }
});
