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

test('inference dashboard shows token usage, timings, segment index and session totals without architecture controls', async () => {
  const h = await harness({ inference: snapshot() });
  try {
    assert.match(metric('生成速度').textContent, /38\.8tok\/s.*llama\.cpp 推理计时/);
    assert.match(metric('输入处理速度').textContent, /456\.2tok\/s/);
    assert.match(metric('输出 tokens').textContent, /输出 tokens0.*已知部分计数/);
    assert.doesNotMatch(metric('输出 tokens').textContent, /—/);
    assert.match(metric('输入 tokens').textContent, /84/);
    assert.match(metric('首段输出延迟').textContent, /425 ms.*网关观测/);
    assert.match(metric('调用耗时').textContent, /3\.20 s/);
    assert.match(document.querySelector('.inference-heading').textContent, /当前调用.*分段 1.*尝试 1.*生成输出/);
    assert.match(document.querySelector('.inference-session-summary').textContent, /175tokens · 已知下限.*1 次调用统计不完整/);
    assert.equal(document.querySelector('.inference-architecture'), null);
    assert.equal(document.querySelector('.inference-motion-button'), null);
    assert.equal(document.querySelector('.inference-stage-bar'), null);
    assert.doesNotMatch(document.body.textContent, /真实计数|计算路径|架构剖面|暂停动画|继续动画/);
    const complete = snapshot();
    complete.active = null;
    complete.latest = { ...record, status: 'completed', phase: 'idle', tokens_complete: true };
    complete.summary.unknown_token_calls = 0;
    await h.render({ inference: complete });
    assert.match(metric('输入 tokens').textContent, /llama\.cpp token 用量/);
    assert.match(document.querySelector('.inference-session-summary').textContent, /llama\.cpp token 用量/);
  } finally { await h.close(); }
});

test('unknown usage and interrupted calls retain missing values and gaps in call trends', async () => {
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

test('inference phase distinguishes current, disconnected and terminal calls', async () => {
  const data = snapshot();
  const h = await harness({ inference: data });
  try {
    await h.render({ inference: data, connected: false });
    assert.match(document.querySelector('.inference-heading').textContent, /上次观测.*状态待重新确认.*连接中断/);
    assert.doesNotMatch(document.querySelector('.inference-heading').textContent, /当前调用|推理中/);
    assert.match(metric('调用耗时').textContent, /上次观测/);
    await h.render({ inference: { ...data, active: null, latest: { ...record, status: 'cancelled', phase: 'idle' } } });
    assert.match(document.querySelector('.inference-heading').textContent, /已取消.*待命/);
    await h.render({ inference: { ...data, active: { ...record, phase: 'prefill', first_token_ms: null } } });
    assert.match(document.querySelector('.inference-phase-pill').textContent, /等待首段输出/);
    assert.match(document.querySelector('.inference-stage-note').textContent, /并非实测 prefill 进度/);
  } finally { await h.close(); }
});

test('legacy gateway leaves inference metrics unavailable without architecture dependencies', async () => {
  const h = await harness({});
  try {
    assert.match(document.body.textContent, /当前网关尚未提供推理指标/);
    assert.equal(document.querySelector('.inference-metrics'), null);
    const data = snapshot();
    delete data.architecture;
    await h.render({ inference: data });
    assert.match(metric('生成速度').textContent, /38\.8/);
    assert.equal(document.querySelector('.inference-architecture'), null);
  } finally { await h.close(); }
});

test('monitor tabs show one view and share a single telemetry poll with accessible keyboard navigation', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ timestamp: Date.now() / 1000, gpus: [{ id: 'gpu', name: 'Tab test GPU', memory_used_mib: 1024, memory_total_mib: 8192, power_w: 50, power_limit_w: 100, utilization_pct: 15, temperature_c: 40 }], message: '', inference: snapshot() });
  };
  const h = await harness({ interval: 10 }, true);
  try {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    assert.equal(tabs.length, 2);
    assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
    assert.equal(tabs[0].tabIndex, 0);
    assert.equal(tabs[1].tabIndex, -1);
    assert.equal(document.querySelectorAll('[role="tabpanel"]:not([hidden])').length, 1);
    assert.equal(document.querySelector('.gpu-section'), null);
    assert.ok(document.querySelector('.inference-dashboard'));
    for (const tab of tabs) {
      const panel = document.getElementById(tab.getAttribute('aria-controls'));
      assert.equal(panel.getAttribute('aria-labelledby'), tab.id);
    }
    await h.React.act(async () => tabs[1].click());
    assert.ok(document.querySelector('.gpu-section'));
    assert.equal(document.querySelector('.inference-dashboard'), null);
    await h.React.act(async () => tabs[1].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
    assert.equal(document.activeElement, tabs[0]);
    assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
    await h.React.act(async () => tabs[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })));
    assert.equal(document.activeElement, tabs[1]);
    await h.React.act(async () => tabs[1].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
    assert.equal(document.activeElement, tabs[0]);
    await h.React.act(async () => tabs[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true })));
    assert.equal(document.activeElement, tabs[1]);
    assert.equal(document.querySelectorAll('[role="tabpanel"]:not([hidden])').length, 1);
    assert.equal(calls, 1);
  } finally { await h.close(); globalThis.fetch = originalFetch; }
});

test('dashboard preserves metrics on disconnect and resumes one poll after hiding aborts its request', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let signal;
  globalThis.fetch = async (_url, options) => {
    calls++;
    signal = options.signal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  };
  const h = await harness({ interval: .01 }, true);
  try {
    assert.equal(calls, 1);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    await h.React.act(async () => document.dispatchEvent(new window.Event('visibilitychange')));
    assert.equal(signal.aborted, true);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(calls, 1);
    globalThis.fetch = async () => { calls++; return Response.json({ timestamp: Date.now() / 1000, gpus: [], samples: [], message: '显卡监测暂不可用', inference: snapshot() }); };
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    await h.React.act(async () => document.dispatchEvent(new window.Event('visibilitychange')));
    assert.ok(document.querySelector('.inference-dashboard'));
    assert.equal(document.querySelector('.monitor-notice'), null);
    const restored = calls;
    globalThis.fetch = async () => { calls++; throw new Error('offline'); };
    await h.React.act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
    assert.ok(calls > restored);
    assert.match(document.querySelector('.inference-heading').textContent, /状态待重新确认/);
    assert.match(document.querySelector('.monitor-notice').textContent, /监测连接中断/);
    assert.match(metric('输入 tokens').textContent, /84/);
  } finally { await h.close(); globalThis.fetch = originalFetch; }
});
