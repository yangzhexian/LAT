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
  await build({ entryPoints: ['src/features/model-monitor/ModelDashboard.tsx'], outfile: 'artifacts/validation/dashboard-test.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', define: { 'import.meta.env.VITE_GATEWAY_URL': 'undefined' } });
  const { ModelDashboard } = await import(pathToFileURL(resolve('artifacts/validation/dashboard-test.mjs')).href);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const gpu = { id: 'one', name: 'Test GPU', memory_used_mib: 2048, memory_total_mib: 8192, power_w: null, power_limit_w: 200, temperature_c: 54, utilization_pct: 0 };
  globalThis.fetch = async () => {
    calls++;
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
    assert.equal(document.querySelectorAll('svg[role="img"]').length, 4);
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
