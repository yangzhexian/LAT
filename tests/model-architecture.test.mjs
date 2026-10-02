import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const fixture = () => ({
  available: true, source: 'gguf', model: 'hy-mt2-7b-q6_k', architecture: 'hunyuan-dense', name: 'Fixture Hunyuan Dense',
  block_count: 32, embedding_length: 4096, attention_heads: 32, kv_heads: 8, feed_forward_length: 14336,
  context_length: 262144, expert_count: null, expert_used_count: null, tensor_count: 355, parameter_count: 7504568320,
  quantization: 'Q6_K', message: '', vocab_size: 128167, head_dim: 128, block_tensors_truncated: false,
  block_tensors: [
    { layer: 32, name: 'blk.31.attn_k.weight', shape: [4096, 1024], elements: 4194304 },
    { layer: 32, name: 'blk.31.ffn_down.weight', shape: [14336, 4096], elements: 58720256 },
    { layer: 2, name: 'blk.1.attn_q.weight', shape: [4096, 4096], elements: 16777216 },
  ],
});
let bundle;
async function load() {
  if (!bundle) {
    await build({ stdin: { contents: 'export * from "./src/features/model-architecture/ModelArchitecturePage"; export * from "./src/features/model-architecture/architectureModel";', resolveDir: process.cwd() }, outfile: 'artifacts/validation/model-architecture-test.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', define: { 'import.meta.env.VITE_GATEWAY_URL': 'undefined' } });
    bundle = await import(pathToFileURL(resolve('artifacts/validation/model-architecture-test.mjs')).href);
  }
  return bundle;
}
async function harness(props, page = false) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  let scrolls = 0;
  const motionListeners = new Set();
  const media = { matches: false, addEventListener: (_name, listener) => motionListeners.add(listener), removeEventListener: (_name, listener) => motionListeners.delete(listener) };
  dom.window.matchMedia = () => media;
  dom.window.HTMLElement.prototype.scrollIntoView = () => { scrolls++; };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { ArchitectureExplorer, ModelArchitecturePage } = await load();
  const Component = page ? ModelArchitecturePage : ArchitectureExplorer;
  const root = createRoot(document.getElementById('root'));
  const render = async (next) => React.act(async () => root.render(React.createElement(Component, next)));
  await render(props);
  return { dom, React, render, scrolls: () => scrolls, reduceSystem: async (value) => React.act(async () => { media.matches = value; for (const listener of motionListeners) listener(); }), click: async (selector) => React.act(async () => document.querySelector(selector).click()), close: async () => { await React.act(async () => root.unmount()); dom.window.close(); } };
}
const telemetry = (architecture) => ({ timestamp: Date.now() / 1000, message: '', gpus: [], samples: [], interval: 2, inference: { architecture, active: null, latest: null, history: [], summary: { calls: 0 } } });

test('all actual layers drill into Attention and FFN, restore breadcrumbs, and focus the new view', async () => {
  const architecture = fixture();
  const h = await harness({ architecture });
  try {
    assert.equal(document.querySelectorAll('.ma-layer-tile').length, 32);
    assert.match(document.querySelector('.ma-layer-bank').textContent, /32 个真实层.*Dense Decoder/);
    assert.equal(h.scrolls(), 0);
    await h.click('[aria-label="进入第 32 层"]');
    assert.equal(document.querySelector('.ma-explorer').dataset.level, 'layer');
    assert.match(document.querySelector('.ma-breadcrumb').textContent, /模型框架.*第 32 层/);
    assert.equal(document.activeElement, document.querySelector('.ma-canvas-heading h2'));
    assert.equal(h.scrolls(), 1);
    assert.equal(document.querySelectorAll('.ma-tensors tbody tr').length, 2);
    assert.match(document.querySelector('.ma-tensors').textContent, /14,336 × 4,096.*GGUF 原生存储顺序/);
    await h.click('.ma-layer-attention');
    assert.equal(document.querySelector('.ma-explorer').dataset.level, 'attention');
    assert.equal(document.querySelectorAll('.ma-head-grid button').length, 32);
    await h.click('[aria-label="Query head 32"]');
    assert.match(document.querySelector('.ma-head-explanation').textContent, /Query head 32 → KV group 8.*每组 4.*头维度：128/);
    assert.equal(document.querySelector('.ma-key [data-selected="true"]').textContent, 'K8');
    assert.equal(document.querySelector('.ma-value [data-selected="true"]').textContent, 'V8');
    assert.equal(document.querySelectorAll('.ma-head-grid [data-group="true"]').length, 4);
    await h.React.act(async () => { const select = document.querySelector('.ma-layer-select select'); select.value = '2'; select.dispatchEvent(new window.Event('change', { bubbles: true })); });
    assert.match(document.querySelector('.ma-breadcrumb').textContent, /第 2 层/);
    assert.match(document.querySelector('.ma-tensors').textContent, /blk\.1\.attn_q\.weight/);
    await h.React.act(async () => document.querySelectorAll('.ma-breadcrumb button')[1].click());
    await h.click('.ma-layer-ffn');
    assert.equal(document.querySelector('.ma-explorer').dataset.level, 'ffn');
    assert.match(document.querySelector('.ma-ffn-diagram').textContent, /gate_proj.*up_proj.*down_proj/);
    assert.match(document.querySelector('.ma-ffn-diagram').textContent, /4,096 → 14,336/);
    await h.click('[aria-label="下一步"]');
    assert.match(document.querySelector('.ma-step-explanation').textContent, /激活与门控.*未读取具体激活函数类型/);
    await h.React.act(async () => document.querySelector('.ma-breadcrumb button').click());
    assert.equal(document.querySelector('.ma-explorer').dataset.level, 'overview');
    const navigated = h.scrolls();
    assert.equal(navigated, 6);
    await h.render({ architecture: { ...architecture } });
    assert.equal(h.scrolls(), navigated);
  } finally { await h.close(); }
});

test('embedding lookup and output sampling use explicit examples with actual model dimensions', async () => {
  const h = await harness({ architecture: fixture(), reduceMotion: true });
  try {
    await h.click('.ma-embedding-node');
    assert.match(document.querySelector('.ma-embedding-table').textContent, /128,167 词表 × 4,096 隐藏维度/);
    await h.click('[aria-label="查看示例 token γ"]');
    assert.match(document.querySelector('.ma-embedding-row[data-selected="true"]').textContent, /IDγ/);
    assert.match(document.querySelector('.ma-demo-caption').textContent, /不是当前文本的分词结果或模型权重/);
    await h.click('[aria-label="下一步"]');
    await h.click('[aria-label="下一步"]');
    assert.equal(document.querySelector('.ma-embedding-vector').dataset.active, 'true');
    await h.React.act(async () => document.querySelector('.ma-breadcrumb button').click());
    await h.click('.ma-output-node');
    assert.match(document.querySelector('.ma-output-head').textContent, /4,096 → 128,167/);
    assert.match(document.querySelector('.ma-logits').textContent, /示意分数，非真实概率/);
    await h.click('[aria-label="下一步"]');
    await h.click('[aria-label="下一步"]');
    assert.equal(document.querySelector('.ma-sampled-token').dataset.active, 'true');
    assert.match(document.querySelector('.ma-step-explanation').textContent, /运行配置决定采样策略/);
    assert.doesNotMatch(document.body.textContent, /实时逐参数计算中|当前 token 概率|SiLU|GELU/);
  } finally { await h.close(); }
});

test('teaching animation is independent of inference and stops for pause, reduced motion, hidden and disconnected pages', async () => {
  const h = await harness({ architecture: fixture() });
  const motion = () => document.querySelector('.ma-explorer').dataset.motion;
  try {
    assert.equal(motion(), 'playing');
    assert.match(document.querySelector('.ma-animation-label').textContent, /独立教学时间线 · 非实时参数活动/);
    await h.click('.ma-playback button');
    assert.equal(motion(), 'paused');
    await h.click('[aria-label="下一步"]');
    assert.match(document.querySelector('.ma-step-track [aria-current="step"]').textContent, /逐层处理/);
    await h.click('.ma-playback button');
    assert.equal(motion(), 'playing');
    await h.render({ architecture: fixture(), reduceMotion: true });
    assert.equal(motion(), 'paused');
    assert.equal(document.querySelector('.ma-playback button').disabled, true);
    assert.match(document.querySelector('.ma-animation-label').textContent, /手动查看步骤/);
    await h.click('[aria-label="下一步"]');
    assert.match(document.querySelector('.ma-step-track [aria-current="step"]').textContent, /输出投影/);
    await h.render({ architecture: fixture() });
    await h.click('.ma-playback button');
    await h.reduceSystem(true);
    assert.equal(motion(), 'paused');
    await h.reduceSystem(false);
    assert.equal(motion(), 'playing');
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    await h.React.act(async () => document.dispatchEvent(new window.Event('visibilitychange')));
    assert.equal(motion(), 'paused');
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    await h.React.act(async () => document.dispatchEvent(new window.Event('visibilitychange')));
    assert.equal(motion(), 'playing');
    await h.render({ architecture: fixture(), connected: false });
    assert.equal(motion(), 'paused');
    assert.match(document.querySelector('.ma-animation-label').textContent, /连接中断/);
  } finally { await h.close(); }
});

test('unknown fields, limited descriptor lists and different architectures never fabricate dense model details', async () => {
  const architecture = { ...fixture(), architecture: 'unknown-architecture', embedding_length: null, feed_forward_length: null, vocab_size: null, head_dim: null, block_tensors: [], block_tensors_truncated: true };
  const h = await harness({ architecture, reduceMotion: true });
  try {
    assert.doesNotMatch(document.querySelector('.ma-layer-bank').textContent, /Dense Decoder/);
    await h.click('[aria-label="进入第 1 层"]');
    assert.match(document.querySelector('.ma-layer-inout').textContent, /—/);
    assert.doesNotMatch(document.querySelector('.ma-layer-diagram').textContent, /RMSNorm/);
    assert.match(document.querySelector('.ma-tensors').textContent, /达到读取上限.*列表已截断/);
    await h.click('.ma-layer-ffn');
    assert.doesNotMatch(document.querySelector('.ma-ffn-diagram').textContent, /gate_proj|up_proj|down_proj|密集/);
    assert.match(document.querySelector('.ma-ffn-diagram').textContent, /具体激活类型未读取/);
    await h.render({ architecture: { ...architecture, model: 'different-model', block_count: 4 }, reduceMotion: true });
    assert.equal(document.querySelector('.ma-explorer').dataset.level, 'overview');
    assert.equal(document.querySelectorAll('.ma-layer-tile').length, 4);
    await h.click('[aria-label="进入第 4 层"]');
    await h.click('.ma-layer-attention');
    assert.match(document.querySelector('.ma-head-explanation').textContent, /无法确认均衡 GQA 分组/);
  } finally { await h.close(); }
});

test('large metadata bounds drawings while retaining selectors and honest range messages', async () => {
  const architecture = { ...fixture(), block_count: 1500, attention_heads: 256, kv_heads: 64 };
  const h = await harness({ architecture, reduceMotion: true });
  try {
    assert.equal(document.querySelectorAll('.ma-layer-tile').length, 1024);
    assert.match(document.querySelector('.ma-layer-bank').textContent, /1,500 个真实层.*仅绘制前 1024 层/);
    await h.click('[aria-label="进入第 1 层"]');
    assert.equal(document.querySelector('[aria-label="选择 Transformer 层编号"]').max, '1500');
    await h.React.act(async () => { const input = document.querySelector('[aria-label="选择 Transformer 层编号"]'); Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, '1500'); input.dispatchEvent(new window.Event('input', { bubbles: true })); });
    assert.match(document.querySelector('.ma-canvas-heading').textContent, /第 1500 层/);
    await h.click('.ma-layer-attention');
    assert.equal(document.querySelectorAll('.ma-head-grid button').length, 128);
    assert.match(document.querySelector('.ma-head-selector').textContent, /最多绘制前 128/);
    assert.equal(document.querySelector('[aria-label="选择 Query head 编号"]').max, '256');
    await h.React.act(async () => { const input = document.querySelector('[aria-label="选择 Query head 编号"]'); Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, '256'); input.dispatchEvent(new window.Event('input', { bubbles: true })); });
    assert.match(document.querySelector('.ma-head-explanation').textContent, /Query head 256 → KV group 64/);
    const { gqaGroup } = await load();
    assert.deepEqual(gqaGroup(architecture, 256), { group: 64, queriesPerGroup: 4 });
    assert.equal(gqaGroup(architecture, 257), null);
    assert.equal(gqaGroup({ ...architecture, kv_heads: 63 }, 32), null);
  } finally { await h.close(); }
});

test('architecture page reads actual metadata, switches official config links and retains disconnected data', async () => {
  const originalFetch = globalThis.fetch;
  const architecture = fixture();
  globalThis.fetch = async () => Response.json(telemetry(architecture));
  const h = await harness({ interval: 100 }, true);
  try {
    assert.match(document.querySelector('.ma-model-identity').textContent, /7\.50 B.*262,144.*Q6_K/);
    assert.match(document.querySelector('.ma-sources a:last-child').href, /Hy-MT2-7B/);
    assert.match(document.querySelector('.ma-model-identity [title]').title, /不等于活跃参数/);
    globalThis.fetch = async () => { throw new Error('offline'); };
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    await h.React.act(async () => document.dispatchEvent(new window.Event('visibilitychange')));
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    await h.React.act(async () => document.dispatchEvent(new window.Event('visibilitychange')));
    assert.match(document.querySelector('.ma-notice').textContent, /连接中断.*保留上次元数据/);
    assert.equal(document.querySelectorAll('.ma-layer-tile').length, 32);
    assert.equal(document.querySelector('.ma-explorer').dataset.motion, 'paused');
    globalThis.fetch = async () => Response.json({ timestamp: Date.now() / 1000, gpus: [], samples: [], message: '' });
    await h.render({ interval: 99 });
    assert.equal(document.querySelector('.ma-explorer'), null);
    assert.match(document.querySelector('.ma-unavailable').textContent, /网关尚未提供架构信息.*不会猜测层数/);
  } finally { await h.close(); globalThis.fetch = originalFetch; }
});

test('hidden request cancellation ignores late metadata and cleanup stops polling', async () => {
  const originalFetch = globalThis.fetch;
  let finish;
  let signal;
  let calls = 0;
  globalThis.fetch = async (_url, init) => { calls++; signal = init.signal; return new Promise((resolve) => { finish = resolve; }); };
  const h = await harness({ interval: 100 }, true);
  try {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    await h.React.act(async () => document.dispatchEvent(new window.Event('visibilitychange')));
    assert.equal(signal.aborted, true);
    assert.equal(signal.reason, 'hidden');
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    await h.React.act(async () => { document.dispatchEvent(new window.Event('visibilitychange')); finish(Response.json(telemetry(fixture()))); });
    assert.equal(document.querySelector('.ma-explorer'), null);
    assert.equal(document.querySelector('.ma-notice'), null);
    await h.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; if (document.querySelector('#root')?.childNodes.length) await h.close(); }
});
