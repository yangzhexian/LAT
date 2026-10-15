import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

test('history pages keep 200 long records out of DOM, isolate stale search, and export complete filtered records', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const rows = Array.from({ length: 200 }, (_, index) => ({ id: String(index), createdAt: 200 - index, source: `source ${index}\n` + '长'.repeat(100000), submittedText: 'submitted', translation: `translation ${index}\n` + '译'.repeat(100000), sourceLanguage: 'zh', targetLanguage: 'en', model: 'test-model', origin: index % 2 ? 'selection' : 'workspace' }));
  const summary = (row) => ({ id: row.id, createdAt: row.createdAt, sourcePreview: row.source.slice(0, 180), translationPreview: row.translation.slice(0, 180), sourceLanguage: row.sourceLanguage, targetLanguage: row.targetLanguage, model: row.model, origin: row.origin, bytes: 600000 });
  let fullReads = 0;
  let failPage = false;
  let resolveOldSearch;
  let exportFilters;
  const pageCalls = [];
  globalThis.historyPageFixture = {
    async readHistoryPage(options) {
      pageCalls.push(options);
      if (failPage) throw new Error('read failure');
      if (options.query === 'old') return new Promise((resolve) => { resolveOldSearch = resolve; });
      if (options.query === 'new') return { items: [summary(rows[199])], nextCursor: null };
      if (options.query === 'missing') return { items: [], nextCursor: null };
      const start = options.before ? Number(options.before.id) + 1 : 0;
      const selected = rows.slice(start, start + options.limit);
      return { items: selected.map(summary), nextCursor: start + options.limit < rows.length ? { id: selected.at(-1).id, createdAt: selected.at(-1).createdAt } : null };
    },
    async getHistoryStats() { return { count: 200, bytes: 200 * 600000, models: ['test-model'] }; },
    async getHistoryRecord(id) { fullReads++; return rows.find((row) => row.id === id); },
    async exportHistory(filters) { exportFilters = filters; return rows.filter((row) => !filters.origin || row.origin === filters.origin); },
  };
  await build({ entryPoints: ['src/features/history/HistoryPage.tsx'], outfile: 'artifacts/validation/history-page-test.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', plugins: [{ name: 'history-fixture', setup(builder) {
    builder.onResolve({ filter: /\/lib\/history$/ }, () => ({ path: 'history', namespace: 'history-fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'history-fixture' }, () => ({ contents: 'export const readHistoryPage = (...args) => globalThis.historyPageFixture.readHistoryPage(...args); export const getHistoryStats = (...args) => globalThis.historyPageFixture.getHistoryStats(...args); export const getHistoryRecord = (...args) => globalThis.historyPageFixture.getHistoryRecord(...args); export const exportHistory = (...args) => globalThis.historyPageFixture.exportHistory(...args);', loader: 'js' }));
  } }] });
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { HistoryPage, historyMarkdown } = await import(pathToFileURL(resolve('artifacts/validation/history-page-test.mjs')).href);
  const root = createRoot(document.getElementById('root'));
  const restored = [];
  const removed = [];
  let props = { settings: { historyLimit: 200, historyStorageMiB: 128 }, revision: 0, busy: false, onRetry() {}, onRestore: (row) => restored.push(row), onRemove: async (id) => removed.push(id) };
  const render = async (next = {}) => { props = { ...props, ...next }; await React.act(async () => root.render(React.createElement(HistoryPage, props))); };
  const settle = async (duration = 0) => React.act(async () => { await new Promise((resolve) => setTimeout(resolve, duration)); });
  const click = async (text) => React.act(async () => [...document.querySelectorAll('button')].find((button) => button.textContent === text).click());
  const search = async (value) => React.act(async () => { const input = document.querySelector('input[type="search"]'); Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const blobs = [];
  URL.createObjectURL = (blob) => { blobs.push(blob); return 'blob:test'; };
  URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = function () {};
  try {
    await render();
    assert.equal(document.querySelectorAll('.history-card').length, 20);
    assert.equal(fullReads, 0);
    assert.equal(document.querySelectorAll('.history-text').length, 0);
    assert.ok(document.body.textContent.length < 15000, '200 full records never enter the list DOM');
    assert.match(document.querySelector('.history-description').textContent, /共 200 条.*128 MiB/);
    await click('查看完整记录');
    assert.equal(fullReads, 1);
    assert.equal(document.querySelectorAll('.history-text').length, 2);
    assert.equal(document.querySelector('.history-text').textContent, rows[0].source);
    await click('查看完整记录');
    assert.equal(fullReads, 2);
    assert.equal(document.querySelectorAll('.history-text').length, 2, 'only one expanded record is mounted');
    await click('收起完整记录');
    assert.equal(document.querySelectorAll('.history-text').length, 0);
    await click('下一页');
    assert.equal(document.querySelectorAll('.history-card').length, 20);
    assert.match(document.querySelector('.history-excerpt').textContent, /^source 20/);
    await click('上一页');
    assert.match(document.querySelector('.history-excerpt').textContent, /^source 0/);
    await render({ busy: true });
    await click('恢复到工作区'); await click('删除');
    assert.equal(restored.length, 0); assert.equal(removed.length, 0);
    await render({ busy: false });
    await click('恢复到工作区');
    assert.equal(restored[0].source, rows[0].source);
    await click('删除'); assert.deepEqual(removed, ['0']);
    await search('old'); await settle(280);
    assert.ok(resolveOldSearch);
    await search('new'); await settle(280);
    assert.equal(document.querySelectorAll('.history-card').length, 1);
    assert.match(document.querySelector('.history-excerpt').textContent, /^source 199/);
    await React.act(async () => resolveOldSearch({ items: [summary(rows[0])], nextCursor: null }));
    assert.match(document.querySelector('.history-excerpt').textContent, /^source 199/, 'late old query cannot overwrite latest results');
    await search('missing'); await settle(280);
    assert.match(document.body.textContent, /没有符合筛选条件/);
    await click('清除筛选');
    assert.equal(document.querySelectorAll('.history-card').length, 20);
    await React.act(async () => { const select = [...document.querySelectorAll('label')].find((label) => label.textContent.startsWith('来源')).querySelector('select'); select.value = 'selection'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    await click('导出 JSON');
    const exported = JSON.parse(await blobs.at(-1).text());
    assert.equal(exportFilters.origin, 'selection');
    assert.equal(exported.length, 100, 'export includes every filtered page');
    assert.equal(exported[0].translation, rows[1].translation);
    await click('导出 Markdown');
    assert.ok((await blobs.at(-1).text()).includes(rows[199].source));
    assert.ok(historyMarkdown([{ ...rows[0], source: '```\nbody\n```', translation: 'result' }]).includes('````text\n```\nbody\n```\n````'), 'Markdown fences preserve source containing fences');
    failPage = true; await render({ revision: 1 });
    assert.match(document.body.textContent, /无法读取本地历史记录/);
    failPage = false; await click('重试读取');
    assert.equal(document.querySelectorAll('.history-card').length, 20);
    assert.ok(pageCalls.every((call) => call.limit === 20));
  } finally {
    await React.act(async () => root.unmount());
    URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
    delete globalThis.historyPageFixture; dom.window.close();
  }
});
