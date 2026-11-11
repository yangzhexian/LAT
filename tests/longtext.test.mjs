import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'esbuild';

await build({ entryPoints: ['src/lib/translationUpdates.ts', 'src/lib/previewText.ts'], outdir: 'artifacts/validation/longtext', bundle: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' } });
const { createProgressBatch, unicodeLength } = await import(pathToFileURL(resolve('artifacts/validation/longtext/translationUpdates.mjs')).href);
const { boundedPreview, PREVIEW_CHAR_LIMIT } = await import(pathToFileURL(resolve('artifacts/validation/longtext/previewText.mjs')).href);

test('progress bursts are bounded while validated segments and all terminal events flush immediately', async () => {
  const published = [];
  const batch = createProgressBatch((event) => published.push(event), 20);
  for (let index = 0; index < 1000; index++) batch.push({ type: 'progress', generated_chars: index });
  assert.equal(published.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(published.length, 1);
  assert.equal(published[0].generated_chars, 999);
  batch.push({ type: 'progress', completed_chars: 400 });
  batch.push({ type: 'segment_complete', translation: '完整段落' });
  assert.deepEqual(published.at(-1), { type: 'segment_complete', completed_chars: 400, translation: '完整段落' });
  for (const type of ['cancelled', 'complete', 'error']) {
    batch.push({ type: 'progress', generated_chars: 100 });
    batch.push({ type, translation: 'authoritative final output' });
    assert.equal(published.at(-1).type, type);
    assert.equal(published.at(-1).translation, 'authoritative final output');
  }
  batch.push({ type: 'progress', generated_chars: 101 });
  batch.flush();
  assert.equal(published.at(-1).generated_chars, 101, 'transport cancellation flushes pending progress');
  const count = published.length;
  batch.push({ type: 'progress', generated_chars: 102 });
  batch.dispose();
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(published.length, count, 'disposed timers never publish stale updates');
});

test('100,000 Unicode characters are counted without losing astral characters', () => {
  const source = '文😀'.repeat(50000);
  assert.equal(unicodeLength(source), 100000);
  const preview = boundedPreview(source);
  assert.ok(preview.text.length <= PREVIEW_CHAR_LIMIT);
  assert.equal(preview.truncated, true);
  assert.equal(preview.text.isWellFormed(), true);
  assert.equal(source.length, 150000);
});

test('preview bounds text and formula density without passing cut formulas to MathJax', () => {
  for (const [open, close] of [['$', '$'], ['$$', '$$'], ['\\(', '\\)'], ['\\[', '\\]']]) {
    const prefix = '正文 '.repeat(1200);
    const value = prefix + open + 'x'.repeat(1000) + close;
    assert.deepEqual(boundedPreview(value), { text: prefix, truncated: true });
    assert.deepEqual(boundedPreview('before ' + open + 'x+y' + close + ' after'), { text: 'before ' + open + 'x+y' + close + ' after', truncated: false });
  }
  assert.equal(boundedPreview('$x$ '.repeat(1000)).text.match(/\$x\$/g).length, 40);
  assert.equal(boundedPreview('a'.repeat(3996) + '$$x$$').text, 'a'.repeat(3996), 'a closing delimiter cannot cross the cap');
  assert.equal(boundedPreview('Cost \\$5 and $x$').truncated, false);
  assert.deepEqual(boundedPreview('text with $unfinished'), { text: 'text with ', truncated: true });
});
