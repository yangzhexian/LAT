import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

await build({ entryPoints: ['src/features/selection/controller.ts'], outfile: 'artifacts/validation/selection-controller-test.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external' });
const { SelectionController, selectionLength } = await import(pathToFileURL(resolve('artifacts/validation/selection-controller-test.mjs')).href);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const ready = { ready: true, model_configured: 'test-model', backend: 'llama.cpp' };
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(overrides = {}) {
  const history = [];
  const cancelled = [];
  const busy = [];
  const requests = [];
  const streams = [];
  const controller = new SelectionController({ status: async () => ready,
    translate(body, callback, signal) { const done = deferred(); requests.push(body); streams.push({ callback, signal, ...done }); return done.promise; },
    cancel: async (id) => cancelled.push(id), busy: async (value) => busy.push(value),
    save: async (requestId, row) => history.push({ requestId, row }), changed() {}, ...overrides,
  });
  return { controller, history, cancelled, busy, requests, streams };
}

test('selection validates Unicode cap, protects full source and requires an already active model', async () => {
  assert.equal(selectionLength('A😀中'), 3);
  const h = harness();
  const full = '😀'.repeat(5001);
  h.controller.accept({ requestId: '1', text: full }, 'zh');
  await tick();
  assert.equal(h.controller.view.source, full);
  assert.equal(h.requests.length, 0);
  assert.match(h.controller.view.message, /5,000/);
  h.controller.accept({ requestId: '2', text: 'Hello' }, 'fr');
  await tick();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].require_ready, true);
  assert.equal(h.requests[0].request_source, 'selection');
  assert.equal(h.requests[0].source_language, 'Auto Detect');
  assert.equal(h.requests[0].target_language, 'French');
  h.controller.dispose();
  h.streams[0].resolve();
  const disabled = harness({ status: async () => ({ ...ready, ready: false }) });
  disabled.controller.accept({ requestId: '3', text: 'Hello' }, 'zh');
  await tick();
  assert.equal(disabled.controller.view.phase, 'model-required');
  assert.equal(disabled.requests.length, 0);
  assert.equal(disabled.controller.view.source, 'Hello');
  disabled.controller.dispose();
});

test('dismissal cancels only the popup job and ignores all late output and history', async () => {
  const h = harness();
  h.controller.accept({ requestId: '10', text: 'Hello' }, 'zh');
  await tick();
  const old = h.streams[0];
  old.callback({ type: 'plan', job_id: 'popup-job', total_chars: 5, completed_chars: 0 });
  old.callback({ type: 'segment_complete', translation: '你', completed_chars: 2, total_chars: 5 });
  assert.equal(h.controller.view.translation, '你');
  assert.equal(h.controller.view.progress, 40);
  h.controller.dismiss();
  assert.equal(old.signal.aborted, true);
  assert.deepEqual(h.cancelled, ['popup-job']);
  h.controller.accept({ requestId: '11', text: 'New text' }, 'en');
  await tick();
  old.callback({ type: 'complete', job_id: 'popup-job', translation: 'LATE OLD RESULT' });
  old.resolve();
  await tick();
  assert.equal(h.controller.view.source, 'New text');
  assert.equal(h.controller.view.translation, '');
  assert.equal(h.controller.view.phase, 'translating');
  assert.equal(h.history.length, 0);
  assert.equal(h.busy.at(-1), true, 'old finally must not release the new request busy state');
  h.streams[1].callback({ type: 'complete', job_id: 'new-job', translation: 'Fresh' });
  h.streams[1].resolve();
  await tick();
  assert.equal(h.controller.view.translation, 'Fresh');
  assert.equal(h.history.length, 1);
  assert.equal(h.history[0].row.origin, 'selection');
  assert.equal(h.history[0].row.sourceLanguage, 'auto');
  h.controller.dispose();
  assert.deepEqual(h.cancelled, ['popup-job'], 'completed jobs must not be cancelled later');
});

test('pending status is invalidated on dispose, and out-of-order snapshots cannot replace current selection', async () => {
  const status = deferred();
  let statusSignal;
  const h = harness({ status: (signal) => { statusSignal = signal; return status.promise; } });
  h.controller.accept({ requestId: '100', text: 'Pending' }, 'zh');
  await tick();
  h.controller.dispose();
  assert.equal(statusSignal.aborted, true, 'dismissal must abort the pending status network request');
  status.resolve(ready);
  await tick();
  assert.equal(h.requests.length, 0);
  assert.equal(h.history.length, 0);
  const next = harness();
  next.controller.accept({ requestId: '102', text: '' }, 'zh');
  next.controller.accept({ requestId: '101', text: 'Stale handshake' }, 'zh');
  next.controller.accept({ requestId: '102', text: 'Duplicate event' }, 'zh');
  await tick();
  assert.equal(next.requests.length, 0);
  assert.equal(next.controller.view.source, '');
  next.controller.edit('Manual paste');
  void next.controller.run('zh');
  await tick();
  next.controller.accept({ requestId: '103', text: 'Ignored while busy' }, 'zh');
  assert.equal(next.controller.view.source, 'Manual paste');
  next.controller.dismiss();
  next.streams[0].resolve();
  next.controller.dispose();
});

test('busy errors offer retry, partial failures do not enter history, successful retries save once', async () => {
  const h = harness();
  h.controller.accept({ requestId: '1', text: 'Hello' }, 'zh');
  await tick();
  h.streams[0].callback({ type: 'error', code: 'translation_busy', message: 'Busy' });
  h.streams[0].reject(new Error('Busy'));
  await tick();
  assert.equal(h.controller.view.phase, 'error');
  assert.match(h.controller.view.message, /其他翻译/);
  assert.equal(h.history.length, 0);
  void h.controller.run('zh');
  await tick();
  h.streams[1].callback({ type: 'segment_complete', translation: '部分' });
  h.streams[1].reject(new Error('Disconnected'));
  await tick();
  assert.equal(h.controller.view.translation, '部分');
  assert.equal(h.history.length, 0);
  void h.controller.run('zh');
  await tick();
  h.streams[2].callback({ type: 'complete', translation: '你好', job_id: 'ok' });
  h.streams[2].resolve();
  await tick();
  assert.equal(h.controller.view.phase, 'complete');
  assert.equal(h.history.length, 1);
  h.controller.accept({ requestId: '1', text: 'Hello' }, 'zh');
  await tick();
  assert.equal(h.requests.length, 3);
  h.controller.dispose();
});

test('dismissal before job acknowledgement aborts connection without cancelling another job', async () => {
  const h = harness();
  h.controller.accept({ requestId: '1', text: 'Hello' }, 'zh');
  await tick();
  h.controller.dismiss();
  h.streams[0].callback({ type: 'plan', job_id: 'too-late' });
  h.streams[0].resolve();
  await tick();
  assert.equal(h.streams[0].signal.aborted, true);
  assert.deepEqual(h.cancelled, []);
  assert.equal(h.history.length, 0);
  h.controller.dispose();
});

test('queued selection has a cancellable identity and timeout can be retried', async () => {
  const h = harness();
  h.controller.accept({ requestId: '1', text: 'Queued selection' }, 'zh');
  await tick();
  h.streams[0].callback({ type: 'waiting', job_id: 'queued-popup', queue_position: 2 });
  assert.match(h.controller.view.message, /第 2 位/);
  h.controller.dismiss();
  assert.deepEqual(h.cancelled, ['queued-popup']);
  h.streams[0].resolve();
  await tick();
  h.controller.accept({ requestId: '2', text: 'Retry selection' }, 'zh');
  await tick();
  h.streams[1].callback({ type: 'waiting', job_id: 'retry-popup', queue_position: 1 });
  h.streams[1].callback({ type: 'error', code: 'translation_queue_timeout', message: 'Timeout' });
  h.streams[1].callback({ type: 'segment_complete', translation: 'stale' });
  h.streams[1].resolve();
  await tick();
  assert.equal(h.controller.view.phase, 'error');
  assert.equal(h.controller.view.translation, '');
  assert.match(h.controller.view.message, /等待模型的时间过长/);
  assert.equal(h.history.length, 0);
  void h.controller.run('zh');
  await tick();
  h.streams[2].callback({ type: 'waiting', job_id: 'successful-popup', queue_position: 1 });
  h.streams[2].callback({ type: 'attempt' });
  assert.equal(h.controller.view.message, '正在翻译…');
  h.streams[2].callback({ type: 'complete', job_id: 'successful-popup', translation: '结果' });
  h.streams[2].resolve();
  await tick();
  assert.equal(h.controller.view.phase, 'complete');
  assert.equal(h.history.length, 1);
  h.controller.dispose();
});
