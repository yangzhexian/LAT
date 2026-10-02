import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import 'fake-indexeddb/auto';

async function bundleWorkspace(outfile) {
  await build({
    entryPoints: ['src/features/translator/TranslatorWorkspace.tsx'], outfile, bundle: true, platform: 'node',
    format: 'esm', packages: 'external', jsx: 'automatic', define: { 'import.meta.env.VITE_GATEWAY_URL': 'undefined' },
    plugins: [{
      name: 'workspace-model-page-fixtures',
      setup(builder) {
        builder.onResolve({ filter: /\/(ModelArchitecturePage|ModelDashboard)$/ }, ({ path }) => ({ path: path.split('/').at(-1), namespace: 'model-page-fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'model-page-fixture' }, ({ path }) => ({
          loader: 'tsx', resolveDir: resolve('.'), contents: `export function ${path}({ interval, reduceMotion }) {
            return <div data-model-page="${path}" data-interval={interval} data-reduce-motion={String(reduceMotion)}>Local model page</div>;
          }`,
        }));
      },
    }],
  });
  return import(pathToFileURL(resolve(outfile)).href);
}

test('workspace retains text across navigation, disables conflicts while translating, and shows completed sections', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost' });
  // jsdom does not implement the browser's dialog top layer. Exercise our
  // search/selection state with minimal native-method stubs.
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { TranslatorWorkspace } = await bundleWorkspace('artifacts/validation/workspace-test.mjs');
  const root = createRoot(document.getElementById('root'));
  let disabled = 0;
  const props = { status: { ready: true, model_configured: 'test-model', backend: 'llama.cpp' }, settings: { theme: 'light', layout: 'horizontal', autoFont: true, removeLineBreaks: false, dataDirectory: '' }, onSettingsChange() {}, onDisable() { disabled++; } };
  const originalFetch = globalThis.fetch;
  let streamController;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    if (url.endsWith('/translate/cancel')) return Response.json({ status: 'cancelling' });
    return new Response(new ReadableStream({ start(controller) { streamController = controller; init.signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true }); } }));
  };
  const click = async (selector) => React.act(async () => document.querySelector(selector).click());
  const emit = async (event) => React.act(async () => { streamController.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(event) + '\n\n')); await new Promise((resolve) => setTimeout(resolve, 10)); });
  try {
    await React.act(async () => root.render(React.createElement(TranslatorWorkspace, props)));
    const source = document.querySelector('textarea[aria-label="原文"]');
    await React.act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(source, 'Hello world.'); source.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    await click('[aria-label="设置"]');
    await click('[aria-label="翻译"]');
    assert.equal(document.querySelector('textarea[aria-label="原文"]').value, 'Hello world.');
    await click('.language-trigger');
    assert.equal(document.querySelector('.language-dialog').open, true);
    await React.act(async () => {
      const search = document.querySelector('.language-search');
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(search, 'English');
      search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    await React.act(async () => document.querySelector('.language-search').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    assert.equal(document.querySelector('.language-dialog').open, false);
    assert.match(document.querySelector('.language-trigger').textContent, /English/);
    await click('.translate-button');
    assert.equal(document.querySelector('.danger-button').disabled, true);
    assert.equal(document.querySelector('[aria-label="交换语言和内容"]').disabled, true);
    await emit({ type: 'plan', completed_chars: 0, total_chars: 12, completed_chunks: 0, total_chunks: 2 });
    await emit({ type: 'segment_complete', translation: '你好', completed_chars: 6, total_chars: 12, completed_chunks: 1, total_chunks: 2 });
    assert.equal(document.querySelector('textarea[aria-label="译文"]').value, '你好');
    await emit({ type: 'complete', translation: '你好，世界。', model: 'test-model', completed_chars: 12, total_chars: 12, completed_chunks: 2, total_chunks: 2 });
    await React.act(async () => { streamController.close(); await new Promise((resolve) => setTimeout(resolve, 50)); });
    assert.equal(document.querySelector('.danger-button').disabled, false);
    await click('[aria-label="历史记录"]');
    assert.equal(document.querySelectorAll('.history-card').length, 1);
    assert.equal(document.querySelector('.header-action .danger-button').textContent, '清空历史');
    assert.equal([...document.querySelectorAll('h2')].filter((item) => item.textContent === '翻译历史').length, 0);
    assert.equal(document.querySelectorAll('.history-comparison > section').length, 2);
    await click('[aria-label="翻译"]');
    await click('.translate-button');
    await emit({ type: 'plan', job_id: 'resume-test', translation: '', completed_chunks: 0, total_chunks: 2 });
    await emit({ type: 'segment_complete', translation: '部分译文', completed_chars: 6, total_chars: 12, completed_chunks: 1, total_chunks: 2 });
    await React.act(async () => {
      Array.from(document.querySelectorAll('button')).find((button) => button.textContent === '取消翻译').click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    assert.match(document.querySelector('[role="status"]').textContent, /已取消/);
    assert.equal(document.querySelector('textarea[aria-label="译文"]').value, '部分译文');
    assert.match(document.querySelector('.translate-button').textContent, /继续翻译/);
    assert.equal(requests.at(-1).url.endsWith('/translate/cancel'), true);
    assert.equal(requests.at(-1).body.job_id, 'resume-test');
    await click('.translate-button');
    assert.equal(requests.at(-1).body.job_id, 'resume-test');
    assert.equal(document.querySelector('textarea[aria-label="译文"]').value, '部分译文');
    await emit({ type: 'plan', job_id: 'resume-test', translation: '部分译文', completed_chunks: 1, total_chunks: 2 });
    await emit({ type: 'segment_complete', translation: '剩余译文', completed_chunks: 2, total_chunks: 2 });
    assert.equal(document.querySelector('textarea[aria-label="译文"]').value, '部分译文剩余译文');
    await emit({ type: 'error', message: '模拟连接失败' });
    await React.act(async () => { streamController.close(); await new Promise((resolve) => setTimeout(resolve, 20)); });
    assert.match(document.querySelector('.translate-button').textContent, /继续翻译/);
    await click('[aria-label="历史记录"]');
    assert.equal(document.querySelectorAll('.history-card').length, 1);
    await click('.history-actions .secondary-button');
    await React.act(async () => root.render(React.createElement(TranslatorWorkspace, { ...props, status: { ...props.status, ready: false } })));
    await click('[aria-label="翻译"]');
    assert.equal(document.querySelector('textarea[aria-label="原文"]').value, 'Hello world.');
    assert.equal(document.querySelector('textarea[aria-label="译文"]').value, '你好，世界。');
    assert.equal(document.querySelector('.translate-button').disabled, true);
    assert.equal(disabled, 0);
    window.confirm = () => false;
    await React.act(async () => root.render(React.createElement(TranslatorWorkspace, { ...props, selectionTransfer: { id: 1, text: 'Do not overwrite' } })));
    assert.equal(document.querySelector('textarea[aria-label="原文"]').value, 'Hello world.');
    window.confirm = () => true;
    const fullSelection = 'A'.repeat(16001);
    await React.act(async () => root.render(React.createElement(TranslatorWorkspace, { ...props, settings: { ...props.settings, selectionTargetLanguage: 'zh' }, selectionTransfer: { id: 2, text: fullSelection } })));
    assert.equal(document.querySelector('textarea[aria-label="原文"]').value, fullSelection, 'transfer preserves all text');
    assert.equal(document.querySelector('textarea[aria-label="译文"]').value, '');
    await React.act(async () => root.render(React.createElement(TranslatorWorkspace, { ...props, selectionTransfer: { id: 3 } })));
    assert.ok(document.querySelector('.model-page'), 'no-text transfer opens model panel');
    assert.equal(document.querySelector('textarea[aria-label="原文"]').value, fullSelection);
    await React.act(async () => root.render(React.createElement(TranslatorWorkspace, { ...props, selectionBusy: true })));
    assert.equal(document.querySelector('.header-action .danger-button').disabled, true);
  } finally { await React.act(async () => root.unmount()); globalThis.fetch = originalFetch; dom.window.close(); }
});

test('architecture navigation works with the model off and long model pages use document scrolling', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const style = document.createElement('style');
  style.textContent = await readFile('src/styles.css', 'utf8');
  document.head.append(style);
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { TranslatorWorkspace } = await bundleWorkspace('artifacts/validation/workspace-navigation-test.mjs');
  const root = createRoot(document.getElementById('root'));
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => { requests.push(url); throw new Error('navigation must not start a model'); };
  let disabled = 0;
  const props = {
    status: { ready: false, model_configured: 'local-model', backend: 'llama.cpp' },
    settings: { theme: 'light', layout: 'horizontal', autoFont: true, removeLineBreaks: false, dataDirectory: '', telemetryInterval: 5, reduceMotion: true },
    setupContent: React.createElement('div', { 'data-model-setup': true }, 'Model setup'),
    onSettingsChange() {}, onDisable() { disabled++; },
  };
  const click = async (label) => React.act(async () => document.querySelector(`.side-nav [aria-label="${label}"]`).click());
  const assertDocumentLayout = (page) => {
    const screen = dom.window.getComputedStyle(document.querySelector('.translator-screen'));
    const content = dom.window.getComputedStyle(document.querySelector(`.${page}-page`));
    assert.equal(screen.height, 'auto');
    assert.equal(parseFloat(screen.minHeight), dom.window.innerHeight);
    assert.equal(content.overflow, 'visible', 'model content must grow instead of scrolling inside a constrained container');
  };
  try {
    await React.act(async () => root.render(React.createElement(TranslatorWorkspace, props)));
    assert.ok(document.querySelector('[data-model-setup]'));
    assertDocumentLayout('model');
    await click('模型架构');
    assert.equal(document.querySelector('.translator-screen').dataset.page, 'architecture');
    assert.equal(document.querySelector('.side-nav [aria-label="模型架构"]').getAttribute('aria-current'), 'page');
    assert.match(document.querySelector('.brand').textContent, /^模型架构/);
    const architecture = document.querySelector('[data-model-page="ModelArchitecturePage"]');
    assert.equal(architecture.dataset.interval, '5');
    assert.equal(architecture.dataset.reduceMotion, 'true');
    assert.equal(document.querySelector('.header-action .danger-button').disabled, true);
    assertDocumentLayout('architecture');
    const readyProps = { ...props, status: { ...props.status, ready: true } };
    await React.act(async () => root.render(React.createElement(TranslatorWorkspace, readyProps)));
    assert.equal(document.querySelector('.translator-screen').dataset.page, 'architecture', 'model readiness must not interrupt architecture browsing');
    assert.equal(document.querySelector('.header-action .danger-button').disabled, false);
    await click('翻译');
    const source = document.querySelector('textarea[aria-label="原文"]');
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(source, 'Keep this source through navigation.');
      source.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    assert.equal(parseFloat(dom.window.getComputedStyle(document.querySelector('.translator-screen')).height), dom.window.innerHeight);
    assert.equal(dom.window.getComputedStyle(source).overflow, 'auto', 'long input keeps its local scroll');
    await click('模型架构');
    await click('模型');
    assert.ok(document.querySelector('[data-model-page="ModelDashboard"]'));
    assert.equal(document.querySelector('[data-model-setup]'), null);
    assertDocumentLayout('model');
    await click('历史记录');
    assert.equal(dom.window.getComputedStyle(document.querySelector('.history-page')).overflow, 'auto');
    await click('设置');
    assert.equal(dom.window.getComputedStyle(document.querySelector('.settings-page')).overflow, 'auto');
    await click('翻译');
    assert.equal(document.querySelector('textarea[aria-label="原文"]').value, 'Keep this source through navigation.');
    await click('模型架构');
    await React.act(async () => root.render(React.createElement(TranslatorWorkspace, props)));
    assert.equal(document.querySelector('.translator-screen').dataset.page, 'architecture');
    assert.equal(document.querySelector('.header-action .danger-button').disabled, true);
    await click('模型');
    assert.ok(document.querySelector('[data-model-setup]'));
    assert.deepEqual(requests, []);
    assert.equal(disabled, 0);
  } finally {
    await React.act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    dom.window.close();
  }
});
