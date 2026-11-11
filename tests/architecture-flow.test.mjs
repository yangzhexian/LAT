import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const fixture = () => ({
  available: true, source: 'gguf', model: 'hy-mt2-7b-q6_k', architecture: 'hunyuan-dense', name: 'Flow fixture',
  block_count: 32, embedding_length: 4096, attention_heads: 32, kv_heads: 8, feed_forward_length: 14336,
  context_length: 262144, expert_count: null, expert_used_count: null, tensor_count: 355, parameter_count: 7504568320,
  quantization: 'Q6_K', message: '', vocab_size: 128167, head_dim: 128, block_tensors: [],
});
let bundle;
async function load() {
  if (!bundle) {
    await build({ stdin: { contents: 'export * from "./src/features/model-architecture/ModelArchitecturePage"; export * from "./src/features/model-architecture/ArchitectureFlow";', resolveDir: process.cwd() }, outfile: 'artifacts/validation/architecture-flow-test.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', define: { 'import.meta.env.VITE_GATEWAY_URL': 'undefined', 'import.meta.env.DEV': 'false' } });
    bundle = await import(pathToFileURL(resolve('artifacts/validation/architecture-flow-test.mjs')).href);
  }
  return bundle;
}
async function harness(props, setup) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  setup?.(dom.window);
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { ArchitectureExplorer } = await load();
  const root = createRoot(document.getElementById('root'));
  const render = async (next) => React.act(async () => root.render(React.createElement(ArchitectureExplorer, next)));
  const selectLayer = async (layer) => React.act(async () => {
    const control = document.querySelector('[aria-label="选择参数层编号"]');
    assert.ok(control, 'the actual layer selector exists');
    if (control.tagName === 'SELECT') { control.value = String(layer); control.dispatchEvent(new window.Event('change', { bubbles: true })); }
    else { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(control, String(layer)); control.dispatchEvent(new window.Event('input', { bubbles: true })); }
  });
  const enterLayer = async (layer) => { await selectLayer(layer); await React.act(async () => document.querySelector('[aria-label="查看层结构"]').click()); };
  const explainNext = async () => React.act(async () => { const buttons = [...document.querySelectorAll('.ma-step-track button')]; const index = buttons.findIndex((button) => button.getAttribute('aria-pressed') === 'true'); buttons[(index + 1) % buttons.length].click(); });
  await render(props);
  return { React, render, selectLayer, enterLayer, explainNext, click: async (selector) => React.act(async () => document.querySelector(selector).click()), close: async () => { await React.act(async () => root.unmount()); dom.window.close(); } };
}
function assertPortsExist() {
  for (const path of document.querySelectorAll('.ma-connections > path')) {
    assert.ok(document.querySelector(`[data-flow-node="${path.dataset.from}"]`), `source ${path.dataset.from} exists`);
    assert.ok(document.querySelector(`[data-flow-node="${path.dataset.to}"]`), `target ${path.dataset.to} exists`);
  }
}

test('stack overview connects embedding, one complete repeated layer and output with an outside feedback route', async () => {
  const { overviewFlowEdges, connectionPath } = await load();
  const edges = overviewFlowEdges(32);
  assert.deepEqual(edges.map((edge) => [edge.from, edge.to]), [['embedding', 'stack'], ['stack', 'output'], ['output', 'embedding']]);
  assert.deepEqual(overviewFlowEdges(0), []);
  const rectangles = { embedding: { left: 200, top: 0, width: 200, height: 100 }, stack: { left: 0, top: 150, width: 600, height: 500 }, output: { left: 200, top: 700, width: 200, height: 100 } };
  assert.equal(connectionPath(edges[0], rectangles), 'M300,100 V125 H300 V150');
  assert.equal(connectionPath(edges[2], rectangles), 'M400,750 H618 V50 H400', 'feedback runs outside the wide layer page rather than crossing its contents');
  const h = await harness({ architecture: fixture(), reduceMotion: true });
  try {
    assert.equal(document.querySelectorAll('.ma-layer-diagram').length, 1);
    assert.equal(document.querySelectorAll('.ma-stack-back').length, 2);
    assertPortsExist();
    const overview = document.querySelector('.ma-overview-diagram');
    const embedding = document.querySelector('.ma-embedding-node');
    const stack = document.querySelector('.ma-layer-stack');
    await h.selectLayer(32);
    assert.equal(document.querySelector('[aria-label="选择参数层编号"]').value, '32');
    assert.match(document.querySelector('.ma-layer-input').textContent, /隐藏表示输入/);
    assert.match(document.querySelector('.ma-layer-exit').textContent, /传入后续层或最终输出/);
    assert.equal(document.querySelector('.ma-overview-diagram'), overview, 'only the selected detailed layer is replaced');
    assert.equal(document.querySelector('.ma-embedding-node'), embedding);
    assert.equal(document.querySelector('.ma-layer-stack'), stack);
    assertPortsExist();
  } finally { await h.close(); }
});

test('automatic connections follow stacked compact nodes without changing explicit residual ports', async () => {
  const { connectionPath } = await load();
  const rectangles = { activation: { left: 50, top: 20, width: 100, height: 60 }, down: { left: 40, top: 120, width: 120, height: 100 } };
  assert.equal(connectionPath({ id: 'compact-ffn', from: 'activation', to: 'down' }, rectangles), 'M100,80 V100 H100 V120', 'compact activation exits below and enters down projection from above');
  assert.equal(connectionPath({ id: 'upward', from: 'down', to: 'activation' }, rectangles), 'M100,120 V100 H100 V80');
  assert.equal(connectionPath({ id: 'explicit-residual', from: 'activation', to: 'down', source: 'left', target: 'left', route: 'left', kind: 'residual', offset: 10 }, rectangles), 'M50,50 H30 V170 H40', 'explicit side ports remain intact');
  assert.equal(connectionPath({ id: 'wide', from: 'activation', to: 'down' }, { ...rectangles, down: { left: 200, top: 20, width: 120, height: 60 } }), 'M150,50 H175 V50 H200', 'wide layouts keep horizontal ports');
});

test('layer main route and both residuals join the actual sum nodes', async () => {
  const { layerFlowEdges, connectionPath } = await load();
  const edges = layerFlowEdges();
  const main = edges.filter((edge) => !edge.kind);
  const sequence = ['input', 'norm-1', 'attention', 'sum-1', 'norm-2', 'ffn', 'sum-2', 'output'];
  assert.deepEqual(main.map((edge) => edge.from), sequence.slice(0, -1));
  assert.deepEqual(main.map((edge) => edge.to), sequence.slice(1));
  assert.deepEqual(edges.filter((edge) => edge.kind === 'residual').map((edge) => [edge.from, edge.to]), [['input', 'sum-1'], ['sum-1', 'sum-2']]);
  const rectangles = { input: { left: 20, top: 50, width: 50, height: 80 }, 'sum-1': { left: 250, top: 60, width: 26, height: 26 }, 'sum-2': { left: 100, top: 200, width: 26, height: 26 } };
  assert.equal(connectionPath(edges.find((edge) => edge.id === 'input-residual'), rectangles), 'M45,50 V25 H263 V60');
  assert.equal(connectionPath(edges.find((edge) => edge.id === 'ffn-residual'), rectangles), 'M276,73 H294 V244 H113 V226');
  const h = await harness({ architecture: fixture(), reduceMotion: true });
  try {
    await h.enterLayer(32);
    assertPortsExist();
    assert.equal(document.querySelector('[data-flow-node="sum-1"]').tagName.toLowerCase(), 'circle');
    assert.equal(document.querySelector('[data-flow-node="sum-2"]').tagName.toLowerCase(), 'circle');
    assert.equal(document.querySelectorAll('.ma-connections > path[data-kind="residual"]').length, 2);
  } finally { await h.close(); }
});

test('connections measure attached parent refs on first mount and refresh SVG paths on resize', async () => {
  let scale = 1;
  const h = await harness({ architecture: fixture(), reduceMotion: true }, (surface) => {
    surface.Element.prototype.getBoundingClientRect = function () {
      const node = this.getAttribute('data-flow-node');
      const index = node === 'stack' ? 1 : 0;
      const left = !node ? 0 : node === 'embedding' ? 20 : node === 'output' ? 650 : 140 + ((index - 1) % 8) * 50;
      const top = node ? index ? 30 + Math.floor((index - 1) / 8) * 130 : 140 : 0;
      const width = node ? 40 : 800;
      const height = node ? 100 : 600;
      return { x: left * scale, y: top * scale, left: left * scale, top: top * scale, width: width * scale, height: height * scale, right: (left + width) * scale, bottom: (top + height) * scale, toJSON() {} };
    };
  });
  try {
    const overlay = document.querySelector('.ma-connections');
    assert.equal(overlay.getAttribute('viewBox'), '0 0 800 600');
    const first = overlay.querySelector('[data-connection="embedding-to-layers"]');
    assert.ok(first.getAttribute('d').startsWith('M40,240'), 'mounted source port is measured rather than a null parent ref');
    assert.ok([...overlay.querySelectorAll(':scope > path')].every((path) => path.getAttribute('d')), 'all actual ports have a drawn path');
    scale = 1.5;
    await h.React.act(async () => { window.dispatchEvent(new window.Event('resize')); await new Promise((resolve) => window.requestAnimationFrame(resolve)); });
    assert.equal(overlay.getAttribute('viewBox'), '0 0 1200 900');
    assert.ok(first.getAttribute('d').startsWith('M60,360'));
  } finally { await h.close(); }
});

test('keyboard activation enters the selected layer immediately without extraction timers', async () => {
  const h = await harness({ architecture: fixture() });
  const originalTimeout = globalThis.setTimeout;
  let extractionTimers = 0;
  globalThis.setTimeout = (callback, delay, ...args) => { if (delay === 480) extractionTimers++; return originalTimeout(callback, delay, ...args); };
  try {
    await h.selectLayer(32);
    await h.React.act(async () => document.querySelector('[aria-label="查看层结构"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 0 })));
    assert.equal(document.querySelector('.ma-explorer').dataset.level, 'layer');
    assert.equal(document.activeElement, document.querySelector('.ma-canvas-heading h2'));
    assert.match(document.querySelector('.ma-canvas-heading h2').textContent, /共享层结构/);
    assert.equal(extractionTimers, 0);
    assert.equal(document.querySelector('[data-extracting], [data-pulling]'), null);
  } finally { await h.close(); globalThis.setTimeout = originalTimeout; }
});

test('hidden, reduced and disconnected pages keep immediate navigation while pausing teaching animation', async () => {
  for (const reason of ['hidden', 'disconnected', 'reduced']) {
    const h = await harness({ architecture: fixture() });
    try {
      await h.selectLayer(8);
      if (reason === 'hidden') {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        await h.React.act(async () => document.dispatchEvent(new window.Event('visibilitychange')));
      } else await h.render({ architecture: fixture(), connected: reason !== 'disconnected', reduceMotion: reason === 'reduced' });
      await h.click('[aria-label="查看层结构"]');
      assert.equal(document.querySelector('.ma-explorer').dataset.level, 'layer');
      assert.equal(document.querySelector('.ma-explorer').dataset.motion, 'paused');
      assert.match(document.querySelector('.ma-canvas-heading h2').textContent, /共享层结构/);
    } finally { await h.close(); }
  }
});

test('model changes invalidate the old selected layer and keep exactly one replacement structure', async () => {
  const h = await harness({ architecture: fixture() });
  try {
    await h.selectLayer(32);
    await h.render({ architecture: { ...fixture(), model: 'other-model', block_count: 4 } });
    assert.equal(document.querySelector('.ma-explorer').dataset.level, 'overview');
    assert.equal(document.querySelector('[aria-label="选择参数层编号"]').value, '1');
    assert.equal(document.querySelectorAll('.ma-layer-diagram').length, 1);
    await h.enterLayer(4);
    assert.equal(document.querySelector('.ma-explorer').dataset.level, 'layer');
    assert.equal(document.querySelector('[aria-label="选择参数层编号"]').value, '4');
  } finally { await h.close(); }
});

test('close-up graphs connect the attention fork, normalized FFN input, residual merge and output feedback', async () => {
  const h = await harness({ architecture: fixture(), reduceMotion: true });
  try {
    await h.enterLayer(1);
    await h.click('.ma-layer-attention');
    assertPortsExist();
    assert.deepEqual([...document.querySelectorAll('[data-from="attention-input"]')].map((path) => path.dataset.to), ['query', 'key', 'value']);
    assert.ok(document.querySelector('[data-from="key"][data-to="cache"]'));
    assert.ok(document.querySelector('[data-from="value"][data-to="cache"]'));
    await h.React.act(async () => document.querySelectorAll('.ma-breadcrumb button')[1].click());
    await h.click('.ma-layer-ffn');
    assertPortsExist();
    assert.ok(document.querySelector('[data-from="ffn-input"][data-to="ffn-norm"]'));
    assert.equal(document.querySelectorAll('[data-from="ffn-norm"]').length, 2);
    assert.ok(document.querySelector('[data-from="ffn-input"][data-to="ffn-sum"][data-kind="residual"]'));
    assert.ok(document.querySelector('[data-from="down"][data-to="ffn-sum"]'));
    assert.match(document.querySelector('.ma-ffn-diagram').textContent, /残差 1 输出.*RMSNorm.*接回归一化前表示/);
    await h.React.act(async () => document.querySelector('.ma-breadcrumb button').click());
    await h.click('.ma-output-node');
    assertPortsExist();
    assert.ok(document.querySelector('[data-from="sample"][data-to="next-token"][data-kind="feedback"]'));
    assert.ok(document.querySelector('[data-from="next-token"][data-to="final-norm"][data-kind="feedback"]'));
    assert.equal(document.querySelector('[aria-label="下一步"]'), null);
    assert.doesNotMatch(document.querySelector('.ma-playback').textContent, /[←→]/);
  } finally { await h.close(); }
});

test('geometry coalesces resize, observer and fonts per frame; highlights never measure and cleanup cancels late work', async () => {
  let measurements = 0;
  const perNodeReads = new Map();
  let nextFrame = 0;
  let fontReady;
  const frames = new Map();
  const observers = [];
  let fonts;
  let fontsRemoved = 0;
  const h = await harness({ architecture: fixture(), reduceMotion: true }, (surface) => {
    surface.requestAnimationFrame = (callback) => { const id = ++nextFrame; frames.set(id, callback); return id; };
    surface.cancelAnimationFrame = (id) => frames.delete(id);
    surface.ResizeObserver = class {
      constructor(callback) { this.callback = callback; this.disconnected = false; this.nodes = []; observers.push(this); }
      observe(node) { this.nodes.push(node); }
      disconnect() { this.disconnected = true; }
    };
    fonts = new surface.EventTarget();
    fonts.status = 'loading';
    fonts.ready = new Promise((resolve) => { fontReady = resolve; });
    const remove = fonts.removeEventListener.bind(fonts);
    fonts.removeEventListener = (...args) => { fontsRemoved++; remove(...args); };
    Object.defineProperty(surface.document, 'fonts', { value: fonts });
    surface.Element.prototype.getBoundingClientRect = function () {
      measurements++;
      perNodeReads.set(this, (perNodeReads.get(this) ?? 0) + 1);
      const node = this.getAttribute('data-flow-node');
      const index = node === 'output' ? this.closest('.ma-layer-diagram') ? 2 : 34 : 0;
      return { left: index * 50, top: 30, width: node ? 40 : 1800, height: node ? 100 : 600 };
    };
  });
  const flush = async () => h.React.act(async () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(0)); });
  try {
    const initial = measurements;
    assert.equal(initial, 13, 'outer container + 3 endpoints and inner container + 8 endpoints, without duplicate reads');
    assert.equal(frames.size, 0, 'no redundant unconditional mount frame');
    assert.ok([...perNodeReads.values()].every((reads) => reads === 1), 'nested ports are not measured again by the outer graph');
    const outer = document.querySelector('.ma-overview-diagram');
    const outerObserver = observers.find((observer) => observer.nodes.includes(outer));
    assert.deepEqual(outerObserver.nodes.map((node) => node.dataset.flowNode ?? 'container'), ['container', 'embedding', 'stack', 'output']);
    assert.match(outer.querySelector(':scope > .ma-connections [data-connection="next-token-feedback"]').getAttribute('d'), /^M1740,50/, 'outer output endpoint is not overwritten by the nested output');
    const originalPaths = [...document.querySelectorAll('.ma-connections > path')].map((path) => path.getAttribute('d'));
    await h.explainNext();
    await h.render({ architecture: { ...fixture() }, reduceMotion: true });
    assert.equal(measurements, initial, 'step highlight and unchanged metadata never read rectangles');
    assert.deepEqual([...document.querySelectorAll('.ma-connections > path')].map((path) => path.getAttribute('d')), originalPaths);
    assert.equal(document.querySelector('[data-connection="input-to-norm"]').dataset.active, 'true');
    await h.React.act(async () => {
      window.dispatchEvent(new window.Event('resize'));
      window.dispatchEvent(new window.Event('resize'));
      observers.forEach((observer) => observer.callback());
      fonts.dispatchEvent(new window.Event('loadingdone'));
      fontReady();
      await Promise.resolve();
    });
    assert.equal(measurements, initial);
    assert.equal(frames.size, 2, 'all notifications share one scheduled refresh per diagram');
    await flush();
    assert.equal(measurements, initial * 2);
    assert.equal(frames.size, 0);
    window.dispatchEvent(new window.Event('resize'));
    assert.equal(frames.size, 2);
    const staleCallback = [...frames.values()][0];
    await h.close();
    assert.equal(frames.size, 0, 'unmount cancels pending frame');
    assert.ok(observers.every((observer) => observer.disconnected));
    assert.equal(fontsRemoved, 2);
    staleCallback();
    observers.forEach((observer) => observer.callback());
    fontReady();
    await Promise.resolve();
    assert.equal(measurements, initial * 2, 'queued callbacks do not measure after unmount');
    assert.equal(frames.size, 0);
  } finally { if (document.querySelector('#root')?.childNodes.length) await h.close(); }
});

test('route and anchor changes invalidate geometry without losing arrow or residual semantics', async () => {
  const { ArchitectureConnections } = await load();
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let reads = 0;
  dom.window.Element.prototype.getBoundingClientRect = function () {
    reads++;
    return this.getAttribute('data-flow-node') === 'b' ? { left: 200, top: 100, width: 40, height: 40 } : { left: 0, top: 0, width: 80, height: 60 };
  };
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  function Fixture({ route, active }) {
    const ref = React.useRef(null);
    return React.createElement('div', { ref }, React.createElement(ArchitectureConnections, { containerRef: ref, edges: [{ id: 'residual', from: 'a', to: 'b', source: 'top', target: 'top', route, active, kind: 'residual' }] }), React.createElement('div', { 'data-flow-node': 'a' }), React.createElement('div', { 'data-flow-node': 'b' }), React.createElement('div', { 'data-flow-node': 'unused' }), React.createElement('div', { 'data-flow-scope': true }, React.createElement('div', { 'data-flow-node': 'a' })));
  }
  try {
    await React.act(async () => root.render(React.createElement(Fixture, { route: 'above' })));
    const path = document.querySelector('[data-connection="residual"]');
    const before = path.getAttribute('d');
    assert.equal(reads, 3);
    await React.act(async () => root.render(React.createElement(Fixture, { route: 'above', active: true })));
    assert.equal(reads, 3);
    await React.act(async () => root.render(React.createElement(Fixture, { route: 'below', active: true })));
    assert.equal(reads, 6);
    assert.notEqual(path.getAttribute('d'), before);
    assert.equal(path.dataset.kind, 'residual');
    assert.match(path.getAttribute('marker-end'), /^url\(#/);
  } finally { await React.act(async () => root.unmount()); dom.window.close(); }
});

test('changing the parameter layer preserves both shared diagram scopes and model changes clean up observers', async () => {
  const observers = [];
  const h = await harness({ architecture: fixture(), reduceMotion: true }, (surface) => {
    surface.ResizeObserver = class {
      constructor(callback) { this.callback = callback; this.nodes = []; this.disconnected = false; observers.push(this); }
      observe(node) { this.nodes.push(node); }
      disconnect() { this.disconnected = true; }
    };
  });
  try {
    const outer = document.querySelector('.ma-overview-diagram');
    const oldInner = document.querySelector('.ma-layer-diagram');
    const outerObserver = observers.find((observer) => observer.nodes.includes(outer));
    const innerObserver = observers.find((observer) => observer.nodes.includes(oldInner));
    await h.selectLayer(32);
    assert.equal(innerObserver.disconnected, false);
    assert.equal(oldInner.isConnected, true);
    assert.equal(outerObserver.disconnected, false);
    assert.ok(outerObserver.nodes.every((node) => node.isConnected), 'cached outer nodes survive the inner layer replacement');
    const newInner = document.querySelector('.ma-layer-diagram');
    assert.equal(newInner, oldInner, 'parameter selection does not remount shared architecture');
    assert.ok(observers.some((observer) => !observer.disconnected && observer.nodes.includes(newInner)));
    await h.render({ architecture: { ...fixture(), model: 'replacement-model' }, reduceMotion: true });
    assert.equal(outerObserver.disconnected, true);
    assert.equal(outer.isConnected, false);
  } finally { await h.close(); assert.ok(observers.every((observer) => observer.disconnected)); }
});
