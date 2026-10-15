import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

test('GPU dashboard charts real samples, distinguishes unavailable data and stops polling', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  await build({ entryPoints: ['src/features/model-monitor/ModelDashboard.tsx'], outfile: 'artifacts/validation/dashboard-test.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', define: { 'import.meta.env.VITE_GATEWAY_URL': 'undefined', 'import.meta.env.DEV': 'false' } });
  const { ModelDashboard } = await import(pathToFileURL(resolve('artifacts/validation/dashboard-test.mjs')).href);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const urls = [];
  const gpu = { id: 'one', name: 'Test GPU', memory_used_mib: 2048, memory_total_mib: 8192, power_w: null, power_limit_w: 200, temperature_c: 54, utilization_pct: 0 };
  globalThis.fetch = async (url) => {
    calls++;
    urls.push(url);
    if (url.endsWith('/telemetry/inference')) return Response.json({ session_started_at: 0, summary: { calls: 0, completed_calls: 0, cancelled_calls: 0, failed_calls: 0, prompt_tokens: 0, generated_tokens: 0, total_tokens: 0, unknown_token_calls: 0 }, active: null, latest: null, history: [] });
    const timestamp = Date.now() / 1000;
    return Response.json({ timestamp, gpus: [gpu], message: '', samples: [
      { timestamp: timestamp - 30, gpus: [gpu], message: '' },
      { timestamp, gpus: [gpu], message: '' },
    ] });
  };
  const root = createRoot(document.getElementById('root'));
  try {
    await React.act(async () => root.render(React.createElement(ModelDashboard, { interval: .02 })));
    await React.act(async () => new Promise((r) => setTimeout(r, 55)));
    assert.equal(document.querySelector('[role="tab"][aria-selected="true"]').textContent, '模型推理');
    assert.equal(document.querySelector('.gpu-section'), null);
    assert.ok(urls.every((url) => url.endsWith('/telemetry/inference')), 'inference tab does not request GPU or architecture');
    const switchedAt = urls.length;
    await React.act(async () => [...document.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === 'GPU 硬件').click());
    assert.equal(document.querySelectorAll('svg[role="img"]').length, 4);
    assert.ok(urls.slice(switchedAt).every((url) => url.includes('/telemetry/gpu')), 'GPU tab only requests GPU');
    assert.doesNotMatch(document.body.textContent, /GPU MONITOR|整卡实时数据，包含其他程序占用/);
    assert.match(document.querySelector('.gpu-heading').textContent, /最近 2 分钟/);
    assert.match(document.querySelector('.metric-chart').textContent, /120 秒/);
    assert.doesNotMatch(document.querySelector('.metric-chart').textContent, /−120/);
    assert.match(document.querySelector('.metric-memory_used_mib').textContent, /2.00 GiB/);
    assert.match(document.querySelector('.metric-power_w').textContent, /暂不可用/);
    assert.match(document.querySelector('.metric-utilization_pct').textContent, /0 %/);
    assert.ok(document.querySelector('.metric-memory_used_mib path').getAttribute('d').includes('L'));
    globalThis.fetch = async () => { calls++; throw new Error('offline'); };
    await React.act(async () => new Promise((r) => setTimeout(r, 40)));
    assert.match(document.querySelector('[role="status"]').textContent, /连接中断/);
    assert.match(document.querySelector('.gpu-heading').textContent, /暂不可用/);
    await React.act(async () => root.unmount());
    const stoppedAt = calls;
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(calls, stoppedAt);
  } finally { globalThis.fetch = originalFetch; dom.window.close(); }
});

test('GPU tab merges incremental samples, displays provider cadence, resets sessions and ignores late tab responses', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { ModelDashboard } = await import(pathToFileURL(resolve('artifacts/validation/dashboard-test.mjs')).href);
  const originalFetch = globalThis.fetch;
  const calls = [];
  const gpu = { id: 'one', name: 'Retained GPU', memory_used_mib: 2048, memory_total_mib: 8192, power_w: 40, power_limit_w: 200, temperature_c: 54, utilization_pct: 10 };
  const point = (timestamp) => ({ timestamp, gpus: [gpu], message: '' });
  let next = { ...point(300), interval: .5, provider: 'nvidia-smi', provider_status: 'fallback', provider_interval: 2, provider_message: 'NVML unavailable', session_id: 'a', cursor: 300, samples: [point(100), point(300)] };
  let finish;
  let pendingSignal;
  let defer = false;
  globalThis.fetch = async (url, init) => {
    calls.push(url);
    if (url.endsWith('/inference')) return Response.json({ session_started_at: 0, summary: { calls: 0 }, active: null, latest: null, history: [] });
    if (defer) { pendingSignal = init.signal; return new Promise((resolve) => { finish = resolve; }); }
    return Response.json(next);
  };
  const root = createRoot(document.getElementById('root'));
  const render = async (windowSeconds = 120) => React.act(async () => root.render(React.createElement(ModelDashboard, { interval: .5, windowSeconds })));
  const tab = async (label) => React.act(async () => [...document.querySelectorAll('[role="tab"]')].find((button) => button.textContent === label).click());
  const refresh = async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    await React.act(async () => document.dispatchEvent(new window.Event('visibilitychange')));
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    await React.act(async () => document.dispatchEvent(new window.Event('visibilitychange')));
  };
  const chart = () => document.querySelector('.metric-memory_used_mib path')?.getAttribute('d') || '';
  try {
    await render();
    assert.equal(calls.length, 1);
    assert.ok(calls[0].endsWith('/telemetry/inference'));
    await tab('GPU 硬件');
    assert.match(document.querySelector('.gpu-heading').textContent, /每 2 秒刷新/);
    assert.match(document.body.textContent, /nvidia-smi.*NVML unavailable/);
    assert.equal(chart().includes('L'), false, 'two minute view filters the older retained sample');
    const rangeCalls = calls.length;
    await render(300);
    assert.equal(calls.length, rangeCalls, 'changing graph range needs no network request');
    assert.equal(chart().includes('L'), true, 'five minute range uses the previously retained sample');
    next = { ...next, ...point(301), cursor: 301, samples: [point(300), point(301)] };
    await refresh();
    assert.equal(new URL(calls.at(-1)).searchParams.get('since'), '300');
    assert.equal(new URL(calls.at(-1)).searchParams.get('session_id'), 'a');
    assert.equal((chart().match(/L/g) || []).length, 2, 'overlapping deltas are deduplicated');
    next = { ...next, ...point(1), session_id: 'b', cursor: 1, reset: true, samples: [point(1)], provider_interval: 5 };
    await refresh();
    assert.equal(chart().includes('L'), false, 'new session clears old history');
    assert.match(document.querySelector('.gpu-heading').textContent, /每 5 秒刷新/);
    defer = true;
    await refresh();
    await tab('模型推理');
    assert.equal(pendingSignal.aborted, true);
    await React.act(async () => finish(Response.json({ ...next, gpus: [{ ...gpu, name: 'STALE GPU' }] })));
    assert.doesNotMatch(document.body.textContent, /STALE GPU/);
    assert.equal(document.querySelector('.gpu-section'), null);
    assert.ok(calls.at(-1).endsWith('/telemetry/inference'));
  } finally { await React.act(async () => root.unmount()); globalThis.fetch = originalFetch; dom.window.close(); }
});
