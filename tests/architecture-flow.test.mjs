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
    await build({ stdin: { contents: 'export * from "./src/features/model-architecture/ModelArchitecturePage"; export * from "./src/features/model-architecture/ArchitectureFlow";', resolveDir: process.cwd() }, outfile: 'artifacts/validation/architecture-flow-test.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', define: { 'import.meta.env.VITE_GATEWAY_URL': 'undefined' } });
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
  await render(props);
  return { React, render, click: async (selector) => React.act(async () => document.querySelector(selector).click()), close: async () => { await React.act(async () => root.unmount()); dom.window.close(); } };
}
function extractionTimers() {
  const originalSet = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  const timers = new Map();
  let sequence = 0;
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay >= 400 && delay <= 600) { const id = `book-${++sequence}`; timers.set(id, { callback: () => callback(...args), delay }); return id; }
    return originalSet(callback, delay, ...args);
  };
  globalThis.clearTimeout = (id) => { if (timers.has(id)) timers.delete(id); else originalClear(id); };
  return { timers, finish: () => { const entry = timers.entries().next().value; assert.ok(entry, 'a book transition is pending'); timers.delete(entry[0]); entry[1].callback(); }, restore: () => { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; } };
}
function assertPortsExist() {
  for (const path of document.querySelectorAll('.ma-connections > path')) {
    assert.ok(document.querySelector(`[data-flow-node="${path.dataset.from}"]`), `source ${path.dataset.from} exists`);
    assert.ok(document.querySelector(`[data-flow-node="${path.dataset.to}"]`), `target ${path.dataset.to} exists`);
  }
}

test('bookshelf preserves all layer connections through eight and four column snake layouts', async () => {
  const { bookFlowEdges, connectionPath } = await load();
  for (const columns of [8, 4]) {
    const edges = bookFlowEdges(32, columns);
    assert.equal(edges[0].from, 'embedding'); assert.equal(edges[0].to, 'book-1');
    for (let layer = 1; layer < 32; layer++) {
      const edge = edges.find((item) => item.from === `book-${layer}`);
      assert.equal(edge.to, `book-${layer + 1}`);
      if (layer % columns === 0) assert.equal(edge.source, edge.target, 'row turn joins the same side of consecutive rows');
    }
    assert.ok(edges.some((edge) => edge.from === 'book-32' && edge.to === 'output'));
    assert.ok(edges.some((edge) => edge.from === 'output' && edge.to === 'embedding' && edge.kind === 'feedback'));
    const turn = edges.find((edge) => edge.from === `book-${columns}`);
    const path = connectionPath(turn, { [turn.from]: { left: 100, top: 20, width: 40, height: 100 }, [turn.to]: { left: 100, top: 150, width: 40, height: 100 }, output: { left: 1000, top: 20, width: 100, height: 100 } });
    assert.equal(path, 'M140,70 H146 V200 H140', 'row turns stay adjacent to the books even with a distant output node');
  }
  const h = await harness({ architecture: fixture(), reduceMotion: true });
  try {
    assert.equal(document.querySelectorAll('.ma-book-circuit').length, 32);
    assertPortsExist();
    for (const [width, columns] of [[1024, 8], [700, 4]]) {
      window.innerWidth = width;
      await h.React.act(async () => window.dispatchEvent(new window.Event('resize')));
      const first = document.querySelector('[data-flow-node="book-1"]');
      const nextRow = document.querySelector(`[data-flow-node="book-${columns + 1}"]`);
      assert.equal(first.style.gridColumn, '1');
      assert.equal(nextRow.style.gridColumn, String(columns));
      assert.equal(nextRow.style.gridRow, '2');
    }
  } finally { await h.close(); }
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
    await h.click('[aria-label="进入第 32 层"]');
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
      const index = node?.startsWith('book-') ? Number(node.slice(5)) : 0;
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
    const first = overlay.querySelector('[data-connection="embedding-to-first-layer"]');
    assert.ok(first.getAttribute('d').startsWith('M60,190'), 'mounted source port is measured rather than a null parent ref');
    assert.ok([...overlay.querySelectorAll(':scope > path')].every((path) => path.getAttribute('d')), 'all actual ports have a drawn path');
    scale = 1.5;
    await h.React.act(async () => window.dispatchEvent(new window.Event('resize')));
    assert.equal(overlay.getAttribute('viewBox'), '0 0 1200 900');
    assert.ok(first.getAttribute('d').startsWith('M90,285'));
  } finally { await h.close(); }
});

test('book activation extracts the selected book before navigation and blocks overlapping requests', async () => {
  const h = await harness({ architecture: fixture() });
  const clock = extractionTimers();
  try {
    await h.React.act(async () => document.querySelector('[aria-label="进入第 32 层"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 0 })));
    assert.equal(document.querySelector('.ma-explorer').dataset.level, 'overview');
    assert.equal(document.querySelector('.ma-explorer').dataset.extracting, 'true');
    assert.equal(document.querySelector('[aria-label="进入第 32 层"]').dataset.pulling, 'true');
    assert.equal(document.querySelectorAll('.ma-layer-tile:disabled').length, 32);
    assert.equal(clock.timers.size, 1);
    await h.click('[aria-label="进入第 2 层"]');
    assert.equal(clock.timers.size, 1);
    await h.React.act(async () => clock.finish());
    assert.equal(document.querySelector('.ma-explorer').dataset.level, 'layer');
    assert.match(document.querySelector('.ma-canvas-heading h2').textContent, /第 32 层/);
    assert.equal(document.activeElement, document.querySelector('.ma-canvas-heading h2'));
    assert.equal(document.querySelector('.ma-explorer').dataset.extracting, 'false');
  } finally { await h.close(); clock.restore(); }
});

test('reduced motion skips extraction and hidden, disconnected or newly reduced pages finish it safely', async () => {
  const reduced = await harness({ architecture: fixture(), reduceMotion: true });
  const reducedClock = extractionTimers();
  try { await reduced.click('[aria-label="进入第 1 层"]'); assert.equal(document.querySelector('.ma-explorer').dataset.level, 'layer'); assert.equal(reducedClock.timers.size, 0); }
  finally { await reduced.close(); reducedClock.restore(); }
  for (const reason of ['hidden', 'disconnected', 'reduced']) {
    const h = await harness({ architecture: fixture() });
    const clock = extractionTimers();
    try {
      await h.click('[aria-label="进入第 8 层"]');
      if (reason === 'hidden') {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        await h.React.act(async () => document.dispatchEvent(new window.Event('visibilitychange')));
      } else await h.render({ architecture: fixture(), connected: reason !== 'disconnected', reduceMotion: reason === 'reduced' });
      assert.equal(clock.timers.size, 0, `${reason} clears extraction timeout`);
      assert.equal(document.querySelector('.ma-explorer').dataset.level, 'layer');
      assert.equal(document.querySelector('.ma-explorer').dataset.motion, 'paused');
      assert.match(document.querySelector('.ma-canvas-heading h2').textContent, /第 8 层/);
    } finally { await h.close(); clock.restore(); }
  }
});

test('model changes cancel old book selection and unmount clears pending transition callbacks', async () => {
  const h = await harness({ architecture: fixture() });
  const clock = extractionTimers();
  try {
    await h.click('[aria-label="进入第 32 层"]');
    const late = [...clock.timers.values()][0].callback;
    await h.render({ architecture: { ...fixture(), model: 'other-model', block_count: 4 } });
    assert.equal(clock.timers.size, 0);
    await h.React.act(async () => late());
    assert.equal(document.querySelector('.ma-explorer').dataset.level, 'overview');
    assert.equal(document.querySelectorAll('.ma-layer-tile').length, 4);
    await h.click('[aria-label="进入第 4 层"]');
    assert.equal(clock.timers.size, 1);
    await h.React.act(async () => late());
    assert.equal(document.querySelector('.ma-explorer').dataset.level, 'overview', 'an old callback cannot finish a new extraction');
    assert.equal(clock.timers.size, 1);
    await h.close();
    assert.equal(clock.timers.size, 0);
  } finally { clock.restore(); }
});

test('close-up graphs connect the attention fork, normalized FFN input, residual merge and output feedback', async () => {
  const h = await harness({ architecture: fixture(), reduceMotion: true });
  try {
    await h.click('[aria-label="进入第 1 层"]');
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
    assert.ok(document.querySelector('[aria-label="下一步"] svg'));
    assert.doesNotMatch(document.querySelector('.ma-playback-buttons').textContent, /[←→]/);
  } finally { await h.close(); }
});
