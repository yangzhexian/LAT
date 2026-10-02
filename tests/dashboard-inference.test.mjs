import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const architecture = {
  available: true, source: 'gguf', model: 'hy-mt2', architecture: 'hunyuan_v1_dense', name: 'Fixture dense model',
  block_count: 32, embedding_length: 2048, attention_heads: 16, kv_heads: 4, feed_forward_length: 5632,
  context_length: 8192, expert_count: 0, expert_used_count: null, tensor_count: 291, parameter_count: 1800000000,
  quantization: 'Q4_K_M', message: '',
};
const record = {
  id: 'call-one', model: 'hy-mt2', job_id: 'job-one', segment_index: 1, attempt: 1, status: 'running', phase: 'decode',
  started_at: 1700000000, finished_at: null, elapsed_ms: 3200, first_token_ms: 425,
  prompt_tokens: 84, generated_tokens: 0, total_tokens: 84, tokens_complete: false,
  tokens_per_second: 38.75, prompt_tokens_per_second: 456.2, prompt_ms: 184.13, decode_ms: 500,
  output_chars: 32, token_source: 'llama.cpp', speed_source: 'llama.cpp',
};
const snapshot = () => ({
  session_started_at: 1700000000,
  summary: { calls: 3, completed_calls: 1, cancelled_calls: 1, failed_calls: 1, prompt_tokens: 110, generated_tokens: 65, total_tokens: 175, unknown_token_calls: 1 },
  active: { ...record }, latest: null,
  history: [{ ...record, id: 'previous', status: 'completed', phase: 'idle', tokens_per_second: 31, tokens_complete: true }],
  architecture: { ...architecture },
});
let components;
async function loadComponents() {
  if (components) return components;
  await build({
    entryPoints: ['src/features/model-monitor/ModelDashboard.tsx', 'src/features/model-monitor/InferenceDashboard.tsx'],
    outdir: 'artifacts/validation/inference-dashboard-test', bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic',
    define: { 'import.meta.env.VITE_GATEWAY_URL': 'undefined' },
  });
  components = {
    ...(await import(pathToFileURL(resolve('artifacts/validation/inference-dashboard-test/InferenceDashboard.js')).href)),
    ...(await import(pathToFileURL(resolve('artifacts/validation/inference-dashboard-test/ModelDashboard.js')).href)),
  };
  return components;
}
async function harness(props = {}, dashboard = false) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { InferenceDashboard, ModelDashboard } = await loadComponents();
  const Component = dashboard ? ModelDashboard : InferenceDashboard;
  const root = createRoot(document.getElementById('root'));
  const render = async (next) => React.act(async () => root.render(React.createElement(Component, next)));
  await render(props);
  return { dom, React, render, close: async () => { await React.act(async () => root.unmount()); dom.window.close(); } };
}
function metric(name) {
  return [...document.querySelectorAll('.inference-metric')].find((element) => element.querySelector('h3').textContent === name);
}

test('inference dashboard shows actual token counts, timings and bounded GGUF anatomy', async () => {
  const h = await harness({ inference: snapshot() });
  try {
    assert.match(metric('生成速度').textContent, /38\.8tok\/s.*llama\.cpp 推理计时/);
    assert.match(metric('输入处理速度').textContent, /456\.2tok\/s/);
    assert.match(metric('输出 tokens').textContent, /输出 tokens0.*已知部分计数/);
    assert.doesNotMatch(metric('输出 tokens').textContent, /—/);
    assert.match(metric('输入 tokens').textContent, /84/);
    assert.match(metric('首段输出延迟').textContent, /425 ms.*网关观测/);
    assert.match(metric('调用耗时').textContent, /3\.20 s/);
    assert.match(document.querySelector('.inference-heading').textContent, /当前调用.*分段 1.*尝试 1/);
    assert.match(document.querySelector('.inference-block-title').textContent, /× 32/);
    assert.equal(document.querySelectorAll('.inference-layer').length, 4);
    assert.match(document.querySelector('.inference-layer-note').textContent, /中间 28 层省略/);
    assert.match(document.querySelector('.inference-attention').textContent, /16 Q \/ 4 KV heads/);
    assert.match(document.querySelector('.inference-architecture-specs').textContent, /存储参数1\.80 B.*张量数量291.*8,192/);
    assert.match(document.querySelector('.inference-architecture-specs [title]').title, /共享权重只统计一次/);
    assert.equal(document.querySelector('.inference-architecture').dataset.motion, 'running');
    assert.match(document.querySelector('.inference-visual-note').textContent, /每个生成 token 都经过全部 Transformer 层/);
    assert.match(document.querySelector('.inference-session-summary').textContent, /175tokens · 已知下限.*1 次调用统计不完整/);
  } finally { await h.close(); }
});

test('unknown usage and interrupted calls retain missing values and gaps in real call trends', async () => {
  const data = snapshot();
  data.active = { ...record, prompt_tokens: null, generated_tokens: null, total_tokens: null, tokens_per_second: null, prompt_tokens_per_second: null, first_token_ms: null, token_source: 'unknown', speed_source: 'unknown' };
  data.history = [
    { ...record, id: 'known-before', status: 'completed', tokens_per_second: 12 },
    { ...record, id: 'missing', status: 'cancelled', tokens_per_second: null },
    { ...record, id: 'known-after', status: 'completed', tokens_per_second: 18 },
  ];
  const h = await harness({ inference: data });
  try {
    assert.match(metric('输入 tokens').textContent, /—.*未返回 usage/);
    assert.match(metric('生成速度').textContent, /—tok\/s.*等待推理计时/);
    assert.match(metric('首段输出延迟').textContent, /—/);
    const trend = document.querySelector('.inference-call-trend');
    assert.equal(trend.querySelectorAll('circle').length, 2);
    assert.equal((trend.querySelector('path').getAttribute('d').match(/M/g) || []).length, 2);
    assert.doesNotMatch(trend.querySelector('path').getAttribute('d'), /L/);
    assert.match(trend.querySelector('.inference-trend-accessible').textContent, /第 2 次：未知，已取消/);
    assert.doesNotMatch(document.body.textContent, /估算 token|活跃参数数量/);
  } finally { await h.close(); }
});

test('animation stops for pause, reduced motion, hidden page, disconnect, cancellation and a different model', async () => {
  const data = snapshot();
  const h = await harness({ inference: data });
  const motion = () => document.querySelector('.inference-architecture').dataset.motion;
  try {
    await h.React.act(async () => document.querySelector('.inference-motion-button').click());
    assert.equal(motion(), 'stopped');
    assert.equal(document.querySelector('.inference-motion-button').getAttribute('aria-pressed'), 'true');
    await h.React.act(async () => document.querySelector('.inference-motion-button').click());
    assert.equal(motion(), 'running');
    await h.render({ inference: data, reduceMotion: true });
    assert.equal(motion(), 'stopped');
    assert.match(document.querySelector('.inference-stage-note').textContent, /减少动态效果已开启/);
    await h.render({ inference: data, visible: false });
    assert.equal(motion(), 'stopped');
    await h.render({ inference: data, connected: false });
    assert.equal(motion(), 'stopped');
    assert.match(document.querySelector('.inference-heading').textContent, /上次观测.*状态待重新确认.*连接中断/);
    assert.doesNotMatch(document.querySelector('.inference-heading').textContent, /当前调用|推理中/);
    await h.render({ inference: { ...data, active: null, latest: { ...record, status: 'cancelled', phase: 'idle' } } });
    assert.equal(motion(), 'stopped');
    assert.match(document.querySelector('.inference-heading').textContent, /已取消.*待命/);
    await h.render({ inference: { ...data, active: { ...record, model: 'other-model' } } });
    assert.equal(motion(), 'stopped');
    assert.match(document.querySelector('.inference-stage-note').textContent, /当前调用与选中架构不同/);
    await h.render({ inference: data });
    assert.equal(motion(), 'running');
    await h.render({ inference: { ...data, active: { ...record, phase: 'prefill', first_token_ms: null } } });
    assert.equal(motion(), 'running');
    assert.equal(document.querySelector('.inference-architecture').dataset.phase, 'prefill');
    assert.match(document.querySelector('li[aria-current="step"]').textContent, /等待首段输出/);
    assert.match(document.querySelector('.inference-stage-note').textContent, /并非实测 prefill 进度/);
  } finally { await h.close(); }
});

test('module inspection exposes accurate dense calculation explanations without implying live weight telemetry', async () => {
  const h = await harness({ inference: snapshot() });
  try {
    await h.React.act(async () => document.querySelector('.inference-ffn').click());
    assert.equal(document.querySelector('.inference-ffn').getAttribute('aria-pressed'), 'true');
    assert.equal(document.querySelector('.inference-attention').getAttribute('aria-pressed'), 'false');
    assert.match(document.querySelector('.inference-module-detail').textContent, /dense 矩阵计算.*纹理是装饰/);
    await h.React.act(async () => document.querySelector('.inference-endpoint').click());
    assert.match(document.querySelector('.inference-module-detail').textContent, /嵌入矩阵中查表/);
    await h.React.act(async () => document.querySelector('.inference-output').click());
    assert.match(document.querySelector('.inference-module-detail').textContent, /词表 logits.*文本片段与单个 token 并非一一对应/);
    assert.match(document.querySelector('.inference-visual-note').textContent, /不代表逐层、逐参数活动/);
  } finally { await h.close(); }
});

test('legacy gateway and unavailable architecture never fabricate model dimensions', async () => {
  const h = await harness({});
  try {
    assert.match(document.body.textContent, /当前网关尚未提供推理指标/);
    assert.equal(document.querySelector('.inference-anatomy'), null);
    const data = snapshot();
    data.architecture = { ...architecture, available: false, source: 'unavailable', architecture: null, name: null, block_count: null, expert_count: null, message: '未找到 GGUF 文件' };
    await h.render({ inference: data });
    assert.match(document.querySelector('.inference-architecture-empty').textContent, /未找到 GGUF 文件/);
    assert.equal(document.querySelector('.inference-anatomy'), null);
    assert.doesNotMatch(document.querySelector('.inference-architecture').textContent, /Dense Transformer|× 32|1\.80 B/);
  } finally { await h.close(); }
});

test('dashboard stops retained active animations on telemetry disconnection and page hiding', async () => {
  const originalFetch = globalThis.fetch;
  const data = snapshot();
  globalThis.fetch = async () => Response.json({ timestamp: Date.now() / 1000, gpus: [], samples: [], interval: .01, message: '显卡监测暂不可用', inference: data });
  const h = await harness({ interval: .01 }, true);
  try {
    assert.equal(document.querySelector('.inference-architecture').dataset.motion, 'running');
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    await h.React.act(async () => document.dispatchEvent(new window.Event('visibilitychange')));
    assert.equal(document.querySelector('.inference-architecture').dataset.motion, 'stopped');
    globalThis.fetch = async () => { throw new Error('offline'); };
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    await h.React.act(async () => document.dispatchEvent(new window.Event('visibilitychange')));
    await h.React.act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
    assert.equal(document.querySelector('.inference-architecture').dataset.motion, 'stopped');
    assert.match(document.querySelector('.inference-heading').textContent, /状态待重新确认/);
    assert.match(document.querySelector('.monitor-notice').textContent, /监测连接中断/);
  } finally { await h.close(); globalThis.fetch = originalFetch; }
});
