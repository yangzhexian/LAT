import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

let bundle;
async function load() {
  if (!bundle) {
    await build({ stdin: { contents: 'export * from "./src/features/model-architecture/TensorWeightsPanel"; export * from "./src/features/model-architecture/tensorPresentation";', resolveDir: process.cwd() }, outfile: 'artifacts/validation/tensor-weights-test.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic' });
    bundle = await import(pathToFileURL(resolve('artifacts/validation/tensor-weights-test.mjs')).href);
  }
  return bundle;
}
const fixture = () => ({
  model: 'hy-mt2-7b:q6_k', block_tensors_truncated: false, block_tensors: [
    { layer: 1, name: 'blk.0.ffn_down.weight', shape: [14336, 4096], elements: 58720256 },
    { layer: 1, name: 'blk.0.attn_q_norm.weight', shape: [128], elements: 128 },
    { layer: 1, name: 'blk.0.attn_q.weight', shape: [4096, 4096], elements: 16777216 },
    { layer: 2, name: 'blk.1.attn_k.weight', shape: [4096, 1024], elements: 4194304 },
  ],
});
async function harness(architecture, layer = 1) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { TensorWeightsPanel } = await load();
  const root = createRoot(document.getElementById('root'));
  const render = async (next, nextLayer = layer) => React.act(async () => root.render(React.createElement(TensorWeightsPanel, { architecture: next, layer: nextLayer })));
  await render(architecture);
  return { React, render, click: async (selector) => React.act(async () => document.querySelector(selector).click()), close: async () => { await React.act(async () => root.unmount()); dom.window.close(); } };
}

test('parameter selection shows stored dimensions and exact vector elements without multiplying by heads', async () => {
  const h = await harness(fixture());
  try {
    assert.match(document.querySelector('.ma-weight-info').textContent, /Q 投影.*blk\.0\.attn_q\.weight/);
    assert.equal(document.querySelectorAll('.ma-weight-grid > i').length, 96);
    await h.click('[aria-label="查看 blk.0.attn_q_norm.weight"]');
    assert.equal(document.querySelector('.ma-weight-grid').dataset.vector, 'true');
    assert.equal(document.querySelectorAll('.ma-weight-grid > i').length, 16);
    assert.equal(document.querySelectorAll('.ma-weight-info dd')[1].textContent, '128');
    assert.match(document.querySelector('.ma-weight-share strong').textContent, /0\.00017%/);
    await h.click('[aria-label="查看 blk.0.ffn_down.weight"]');
    assert.match(document.querySelector('.ma-weight-blueprint').getAttribute('aria-label'), /14,336 × 4,096.*不包含权重数值/);
    assert.equal(document.querySelector('.ma-weight-axis-top strong').textContent, '14,336');
    assert.equal(document.querySelector('.ma-weight-axis-side strong').textContent, '4,096');
    assert.match(document.querySelector('.ma-weights').textContent, /占本层已读取元素.*GGUF 原生存储顺序.*不编码权重大小/);
  } finally { await h.close(); }
});

test('parameter tabs work by keyboard and reset selection only when model or layer changes', async () => {
  const h = await harness(fixture());
  try {
    await h.click('[aria-label="查看 blk.0.ffn_down.weight"]');
    const matrixTab = document.querySelector('[role="tab"]');
    await h.React.act(async () => matrixTab.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    assert.equal(document.activeElement.textContent, '张量列表');
    assert.equal(document.querySelectorAll('tbody tr').length, 3);
    assert.match(document.querySelector('table').textContent, /14,336 × 4,096/);
    assert.equal(document.querySelector('.ma-weight-detail'), null);
    await h.render({ ...fixture() });
    assert.equal(document.querySelector('[role="tab"][aria-selected="true"]').textContent, '张量列表');
    await h.React.act(async () => document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
    assert.match(document.querySelector('.ma-weight-info').textContent, /Down 投影/);
    await h.render(fixture(), 2);
    assert.match(document.querySelector('.ma-weight-info').textContent, /blk\.1\.attn_k\.weight/);
    assert.doesNotMatch(document.querySelector('.ma-weight-info').textContent, /ffn_down/);
    await h.click('[role="tab"]:nth-child(2)');
    await h.render({ ...fixture(), model: 'different-model' }, 1);
    assert.equal(document.querySelector('[role="tab"][aria-selected="true"]').textContent, '矩阵视图');
    assert.match(document.querySelector('.ma-weight-info').textContent, /Q 投影/);
  } finally { await h.close(); }
});

test('unknown and truncated tensors retain honest local totals and bounded shape diagrams', async () => {
  const { matrixLayout, tensorSummary, tensorShare, tensorRole } = await load();
  const unknown = { layer: 1, name: 'blk.0.custom.weight', shape: [20, 30, 40], elements: null };
  const known = { layer: 1, name: 'blk.0.attn_q_norm.weight', shape: [128], elements: 128 };
  assert.equal(matrixLayout([0, 1]), null);
  assert.equal(matrixLayout([Number.MAX_SAFE_INTEGER + 1, 1]), null);
  assert.equal(matrixLayout([1, 999999]).columns * matrixLayout([1, 999999]).rows, 96);
  assert.deepEqual(tensorSummary([unknown, known]), { elements: 128, incomplete: true });
  assert.equal(tensorShare(unknown, 128), null);
  assert.equal(tensorRole(unknown.name).group, '其他');
  const h = await harness({ model: 'unknown', block_tensors_truncated: true, block_tensors: [unknown, known] });
  try {
    await h.click('[aria-label="查看 blk.0.custom.weight"]');
    assert.match(document.querySelector('.ma-weights').textContent, /部分描述.*专属计算用途尚未确认/);
    assert.match(document.querySelector('.ma-weight-extra-axes').textContent, /存储轴 3：40/);
    assert.equal(document.querySelector('.ma-weight-share strong').textContent, '—');
    assert.match(document.querySelector('.ma-weights').textContent, /列表已截断.*部分元素数量未知/);
    await h.render({ model: 'empty', block_tensors: [], block_tensors_truncated: true }, 99);
    assert.match(document.body.textContent, /该层形状可能未包含/);
    assert.equal(document.querySelector('.ma-weight-grid'), null);
    assert.equal(document.querySelector('[role="tablist"]'), null);
  } finally { await h.close(); }
});
