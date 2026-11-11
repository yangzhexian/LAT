import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM, requestInterceptor, VirtualConsole } from 'jsdom';
import { readFile } from 'node:fs/promises';

let bundle;
async function load() {
  if (!bundle) {
    await build({ stdin: { contents: 'export * from "./src/features/model-architecture/ModelArchitecturePage"; export * from "./src/features/model-architecture/ArchitectureFormula";', resolveDir: process.cwd() }, outfile: 'artifacts/validation/architecture-mathjax-test.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', define: { 'import.meta.env.VITE_GATEWAY_URL': 'undefined', 'import.meta.env.DEV': 'false' } });
    bundle = await import(pathToFileURL(resolve('artifacts/validation/architecture-mathjax-test.mjs')).href);
  }
  return bundle;
}
const architecture = { available: true, model: 'formula-fixture', name: 'Formula fixture', architecture: 'hunyuan-dense', block_count: 32, embedding_length: 4096, feed_forward_length: 14336, attention_heads: 32, kv_heads: 8, head_dim: 128, vocab_size: 128167, block_tensors: [] };

test('memoized local MathJax formulas remeasure their scopes once after typeset without following animation or parameter selection', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const frames = new Map(); let sequence = 0; let reads = 0;
  window.requestAnimationFrame = (callback) => { frames.set(++sequence, callback); return sequence; };
  window.cancelAnimationFrame = (id) => frames.delete(id);
  window.Element.prototype.getBoundingClientRect = () => { reads++; return { left: 0, top: 0, width: 100, height: 100 }; };
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { MathJaxBaseContext } = await import('better-react-mathjax');
  const { ArchitectureExplorer, architectureTypesetEvent } = await load();
  const calls = [];
  const context = { version: 3, renderMode: 'post', promise: Promise.resolve({ startup: { promise: Promise.resolve() }, chtmlStylesheet: () => document.createElement("style"), tex2chtmlPromise(tex) { calls.push(tex); const node = document.createElement('mjx-container'); node.textContent = tex; return Promise.resolve(node); } }) };
  const root = createRoot(document.getElementById('root'));
  const flush = async () => React.act(async () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(0)); });
  try {
    await React.act(async () => root.render(React.createElement(MathJaxBaseContext.Provider, { value: context }, React.createElement(ArchitectureExplorer, { architecture }))));
    assert.deepEqual(calls, [String.raw`h \in \mathbb{R}^{4096}`]);
    assert.equal(reads, 13);
    assert.equal(frames.size, 2, 'a nested formula schedules its inner and outer scope once each');
    const formula = document.querySelector('.ma-formula');
    formula.dispatchEvent(new window.Event(architectureTypesetEvent, { bubbles: true }));
    formula.dispatchEvent(new window.Event(architectureTypesetEvent, { bubbles: true }));
    window.dispatchEvent(new window.Event('resize'));
    assert.equal(frames.size, 2, 'typeset and resize share pending frame work');
    await flush();
    assert.equal(reads, 26);
    await React.act(async () => document.querySelectorAll('.ma-step-track button')[1].click());
    await React.act(async () => { const input = document.querySelector('[aria-label="选择参数层编号"]'); Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, '32'); input.dispatchEvent(new window.Event('input', { bubbles: true })); });
    await React.act(async () => document.querySelector('.ma-playback button').click());
    assert.equal(calls.length, 1, 'highlight, parameter and animation state changes never typeset the unchanged formula');
    assert.equal(reads, 26);
    assert.equal(frames.size, 0);
    await React.act(async () => document.querySelector('.ma-layer-attention').click());
    assert.equal(calls.length, 2);
    assert.match(calls[1], /\\frac\{QK\^\{\\mathsf\{T\}\}\}\{\\sqrt\{d_k\}\}/);
    await flush();
    await React.act(async () => document.querySelector('[aria-label="Query head 32"]').click());
    assert.equal(calls.length, 2, 'query head selection leaves the equation unchanged');
    document.querySelector('.ma-formula').dispatchEvent(new window.Event(architectureTypesetEvent, { bubbles: true }));
    assert.equal(frames.size, 1);
    const pending = [...frames.values()];
    await React.act(async () => root.unmount());
    assert.equal(frames.size, 0);
    const before = reads;
    pending.forEach((callback) => callback(0));
    assert.equal(reads, before, 'late geometry work cannot measure a removed view');
  } finally { if (document.querySelector('#root').childNodes.length) await React.act(async () => root.unmount()); dom.window.close(); }
});

test('a late typeset completion after unmount never dispatches layout work', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { MathJaxBaseContext } = await import('better-react-mathjax');
  const { ArchitectureFormula, architectureTypesetEvent } = await load();
  let finish; let events = 0;
  document.addEventListener(architectureTypesetEvent, () => { events++; });
  const context = { version: 3, renderMode: 'post', promise: Promise.resolve({ startup: { promise: Promise.resolve() }, chtmlStylesheet: () => document.createElement("style"), tex2chtmlPromise() { return new Promise((resolve) => { finish = () => resolve(document.createElement('mjx-container')); }); } }) };
  const root = createRoot(document.getElementById('root'));
  await React.act(async () => root.render(React.createElement(MathJaxBaseContext.Provider, { value: context }, React.createElement(ArchitectureFormula, { tex: 'h', label: '隐藏向量' }))));
  await React.act(async () => root.unmount());
  await React.act(async () => finish());
  assert.equal(events, 0);
  dom.window.close();
});

test('real offline MathJax safely handles delayed ready/startup, StrictMode, stale conversions and adaptive CHTML styles', { timeout: 15000 }, async () => {
  const requests = [];
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', (error) => errors.push(error.message));
  const dom = new JSDOM('<!doctype html><div id="root"></div><script src="/mathjax/tex-chtml.js"></script>', {
    url: 'http://lat.local', pretendToBeVisual: true, runScripts: 'dangerously', virtualConsole: console,
    resources: { interceptors: [requestInterceptor(async (request) => {
      const url = new URL(request.url);
      assert.equal(url.origin, 'http://lat.local');
      requests.push(url.pathname);
      return new Response(await readFile(resolve('public', '.' + url.pathname)), { headers: { 'Content-Type': 'application/javascript' } });
    })] },
    beforeParse(window) { window.eval(`window.MathJax = { chtml: { fontURL: '/mathjax/output/chtml/fonts/woff-v2' }, startup: { typeset: false } };`); },
  });
  const deferred = () => { let resolve; const promise = new Promise((finish) => { resolve = finish; }); return { promise, resolve }; };
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { MathJaxBaseContext } = await import('better-react-mathjax');
  const { ArchitectureFormula, architectureTypesetEvent } = await load();
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  let root;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('local MathJax startup timeout')), 10000);
      dom.window.addEventListener('load', () => { clearTimeout(timer); resolve(); });
    });
    const math = dom.window.MathJax;
    await math.startup.promise;
    assert.equal(document.querySelector('mjx-container'), null, 'no translator preview has typeset anything');
    const originalConvert = math.tex2chtmlPromise.bind(math);
    const calls = [];
    math.tex2chtmlPromise = (tex, options) => { calls.push(tex); return originalConvert(tex, options); };
    let events = 0;
    document.addEventListener(architectureTypesetEvent, () => { events++; });
    const formula = (context, tex, label = '公式说明', strict = false) => {
      const child = React.createElement(MathJaxBaseContext.Provider, { value: context }, React.createElement(ArchitectureFormula, { tex, label }));
      return strict ? React.createElement(React.StrictMode, null, child) : child;
    };
    const freshRoot = () => { root = createRoot(document.getElementById('root')); };
    const unmount = async () => { await React.act(async () => root.unmount()); root = null; };
    const settled = async () => React.act(async () => { await math.startup.promise; });

    // Engine script ready has not resolved when the formula leaves the page.
    const ready = deferred();
    freshRoot();
    await React.act(async () => root.render(formula({ version: 3, promise: ready.promise }, 'h')));
    await unmount();
    await React.act(async () => { ready.resolve(math); await ready.promise; });
    await settled();
    assert.deepEqual(calls, []);
    assert.equal(events, 0);

    // Engine exists, but startup is still pending. The queued work must also be cancelled.
    const startup = deferred();
    math.startup.promise = startup.promise;
    const context = { version: 3, promise: Promise.resolve(math) };
    freshRoot();
    await React.act(async () => root.render(formula(context, 'h')));
    await unmount();
    await React.act(async () => { startup.resolve(); await math.startup.promise; });
    assert.deepEqual(calls, []);
    assert.equal(events, 0);

    // First page render, with no earlier document typeset, must install CHTML/font CSS.
    freshRoot();
    await React.act(async () => root.render(formula(context, 'h', '隐藏向量', true)));
    await settled();
    assert.deepEqual(calls, ['h'], 'StrictMode cleans up its cancelled initial effect');
    assert.equal(events, 1);
    assert.equal(document.querySelectorAll('#MJX-CHTML-styles').length, 1);
    const stylesheet = document.querySelector('#MJX-CHTML-styles');
    const rules = () => [...stylesheet.sheet.cssRules].map((rule) => rule.cssText).join('\n');
    assert.match(rules(), /mjx-container/);
    assert.match(rules(), /@font-face/);
    // jsdom's CSSOM omits @font-face src descriptors; verify the actual injected CSS text.
    assert.match(stylesheet.textContent, /src: url\("\/mathjax\/output\/chtml\/fonts\/woff-v2\/MathJax_Zero\.woff"\) format\("woff"\)/);
    assert.match(document.querySelector('.ma-formula').innerHTML, /mjx-container/);
    assert.doesNotMatch(rules(), /mjx-c2208/);
    await React.act(async () => root.render(formula(context, String.raw`h\in\mathbb{R}^{4096}+\frac{QK^{\mathsf{T}}}{\sqrt{d_k}}`, '完整公式', true)));
    await settled();
    assert.equal(document.querySelector('#MJX-CHTML-styles'), stylesheet, 'adaptive CSS updates the existing sheet');
    assert.match(rules(), /mjx-c2208/, 'new membership glyph CSS is added after conversion');
    assert.match(rules(), /mjx-mfrac/, 'new fraction layout CSS is added');
    assert.match(rules(), /mjx-msqrt/, 'new radical layout CSS is added');
    assert.equal(document.querySelectorAll('mjx-merror').length, 0);
    await unmount();

    // A conversion already underway may finish; only the newest live generation can insert it.
    const conversion = deferred();
    math.tex2chtmlPromise = async (tex, options) => {
      calls.push(tex);
      if (tex === 'obsolete') await conversion.promise;
      if (tex === 'failure') throw new Error('fixture conversion failure');
      return originalConvert(tex, options);
    };
    freshRoot();
    const beforeStale = events;
    await React.act(async () => root.render(formula(context, 'obsolete', '旧公式')));
    await React.act(async () => root.render(formula(context, 'x^2', '新公式')));
    assert.equal(document.querySelector('.ma-formula').textContent, '新公式', 'readable fallback is retained while waiting');
    await React.act(async () => { conversion.resolve(); await math.startup.promise; });
    assert.equal(events, beforeStale + 1, 'stale conversion never notifies geometry');
    assert.match(document.querySelector('.ma-formula').innerHTML, /mjx-msup/);
    assert.doesNotMatch(document.querySelector('.ma-formula').innerHTML, /obsolete/);
    await React.act(async () => root.render(formula(context, 'failure', '排版失败时的可读说明')));
    await settled();
    assert.equal(document.querySelector('.ma-formula').textContent, '排版失败时的可读说明');
    await React.act(async () => root.render(formula(context, 'y', '恢复公式')));
    await settled();
    assert.ok(document.querySelector('.ma-formula mjx-container'), 'a failed job does not poison the shared queue');
    assert.equal([...math.startup.document.math].length, 0, 'standalone conversions do not leak registered document MathItems');
    assert.deepEqual(errors, []);
    assert.ok(requests.every((path) => path.startsWith('/mathjax/')));
  } finally { if (root) await React.act(async () => root.unmount()); dom.window.close(); }
});
