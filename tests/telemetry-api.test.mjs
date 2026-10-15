import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

await build({ entryPoints: ['src/lib/api.ts', 'src/lib/gpuSamples.ts'], outdir: 'artifacts/validation/telemetry-api', bundle: true, platform: 'node', format: 'esm', packages: 'external', outExtension: { '.js': '.mjs' }, define: { 'import.meta.env.VITE_GATEWAY_URL': 'undefined', 'import.meta.env.DEV': 'false' } });
const api = await import(pathToFileURL(resolve('artifacts/validation/telemetry-api/api.mjs')).href);
const { mergeGpuSamples } = await import(pathToFileURL(resolve('artifacts/validation/telemetry-api/gpuSamples.mjs')).href);

test('telemetry APIs request independent endpoints and architecture reuses ETags until session invalidation', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const architecture = { available: true, model: 'model-a' };
  let conditional = true;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, headers: init.headers });
    if (url.endsWith('/architecture')) {
      if (init.headers.get('If-None-Match') && conditional) return new Response(null, { status: 304 });
      return Response.json({ architecture }, { headers: { ETag: '"model-a"' } });
    }
    return Response.json({ samples: [] });
  };
  try {
    api.invalidateGatewaySession();
    await api.getGpuTelemetry(undefined, 123.5, 'session one');
    const gpuUrl = new URL(calls.at(-1).url);
    assert.equal(gpuUrl.pathname, '/admin/telemetry/gpu');
    assert.equal(gpuUrl.searchParams.get('since'), '123.5');
    assert.equal(gpuUrl.searchParams.get('session_id'), 'session one');
    await api.getInferenceTelemetry();
    assert.equal(new URL(calls.at(-1).url).pathname, '/admin/telemetry/inference');
    const first = await api.getModelArchitecture();
    assert.deepEqual(first, architecture);
    assert.equal(calls.at(-1).headers.has('If-None-Match'), false);
    assert.equal(await api.getModelArchitecture(), first, '304 preserves object identity, avoiding needless graph rendering');
    assert.equal(calls.at(-1).headers.get('If-None-Match'), '"model-a"');
    conditional = false;
    architecture.model = 'model-b';
    assert.equal((await api.getModelArchitecture()).model, 'model-b', 'changed metadata replaces cache');
    api.invalidateGatewaySession();
    await api.getModelArchitecture();
    assert.equal(calls.at(-1).headers.has('If-None-Match'), false, 'session invalidation clears both metadata and ETag');
  } finally { globalThis.fetch = originalFetch; api.invalidateGatewaySession(); }
});

test('late architecture responses cannot restore invalidated or aborted cache entries', async () => {
  const originalFetch = globalThis.fetch;
  let finish;
  globalThis.fetch = async () => new Promise((resolve) => { finish = resolve; });
  try {
    const stale = api.getModelArchitecture();
    api.invalidateGatewaySession();
    finish(Response.json({ architecture: { model: 'stale' } }, { headers: { ETag: '"stale"' } }));
    await assert.rejects(stale, (error) => error.code === 'session_changed');
    const controller = new AbortController();
    const aborted = api.getModelArchitecture(controller.signal);
    controller.abort();
    finish(Response.json({ architecture: { model: 'aborted' } }, { headers: { ETag: '"aborted"' } }));
    await assert.rejects(aborted, (error) => error.code === 'session_changed');
    globalThis.fetch = async (_url, init) => {
      assert.equal(init.headers.has('If-None-Match'), false);
      return Response.json({ architecture: { model: 'fresh' } });
    };
    assert.equal((await api.getModelArchitecture()).model, 'fresh');
  } finally { globalThis.fetch = originalFetch; api.invalidateGatewaySession(); }
});

test('GPU deltas deduplicate timestamps, retain five minutes, cap 601 samples, and reset across gateway sessions', () => {
  const sample = (timestamp, message = '') => ({ timestamp, message, gpus: [] });
  const snapshot = (samples, fields = {}) => ({ timestamp: samples.at(-1)?.timestamp ?? 0, samples, gpus: [], message: '', interval: .5, session_id: 'a', ...fields });
  const initial = mergeGpuSamples([], snapshot(Array.from({ length: 701 }, (_, i) => sample(i / 2))));
  assert.equal(initial.length, 601);
  assert.equal(initial[0].timestamp, 50);
  const delta = mergeGpuSamples(initial, snapshot([sample(350, 'new duplicate'), sample(351)]), 'a');
  assert.equal(delta.filter((point) => point.timestamp === 350).length, 1);
  assert.equal(delta.find((point) => point.timestamp === 350).message, 'new duplicate');
  assert.equal(delta[0].timestamp, 51);
  assert.deepEqual(mergeGpuSamples(delta, snapshot([], { timestamp: 351 }), 'a'), delta, 'empty delta preserves retained history');
  assert.deepEqual(mergeGpuSamples(delta, snapshot([sample(1)], { session_id: 'b' }), 'a'), [sample(1)]);
  assert.deepEqual(mergeGpuSamples(delta, snapshot([sample(20)], { reset: true }), 'a'), [sample(20)]);
  assert.equal(mergeGpuSamples([], snapshot(Array.from({ length: 1000 }, (_, i) => sample(i / 10)))).length, 601);
});
