import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import 'fake-indexeddb/auto';

async function loadTS(file, transform = (s) => s) {
  const source = transform(await readFile(new URL('../' + file, import.meta.url), 'utf8'));
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}
const history = await loadTS('src/lib/history.ts');
const text = await loadTS('src/lib/text.ts');
const api = await loadTS('src/lib/api.ts', (s) => s.replace('import.meta.env.VITE_GATEWAY_URL', 'undefined'));

test('history persists newest 30 records, supports deletion and clear', async () => {
  await history.updateHistory({ clear: true });
  await Promise.all(Array.from({ length: 35 }, (_, i) => history.updateHistory({ add: {
    id: String(i), createdAt: i, source: '原文'.repeat(17000), submittedText: '原文', translation: 'translation', sourceLanguage: 'zh', targetLanguage: 'en', model: 'test',
  } })));
  let rows = await history.readHistory();
  assert.equal(rows.length, 30);
  assert.equal(rows[0].id, '34');
  assert.equal(rows.at(-1).id, '5');
  assert.equal(rows[0].source.length, 34000);
  await history.updateHistory({ remove: '34' });
  assert.equal((await history.readHistory()).length, 29);
  await history.updateHistory({ clear: true });
  assert.deepEqual(await history.readHistory(), []);
});

test('line joining preserves math backslashes', () => {
  const formula = String.raw`$$\boldsymbol{x} \in A, \|x\|^2$$`;
  assert.equal(text.normalizeForTranslation('one\ntwo\n\n' + formula, true), 'one two\n\n' + formula);
});

test('SSE completion, error and truncated transport are distinguished', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('data: {"type":"progress"}\n\n');
    await assert.rejects(api.translateStream({}, () => {}), /提前结束/);
    globalThis.fetch = async () => new Response('data: {"type":"error","message":"failed"}\n\n');
    await assert.rejects(api.translateStream({}, () => {}), /failed/);
    globalThis.fetch = async () => new Response('data: {"type":"complete","translation":"完成"}\n\n');
    const events = [];
    await api.translateStream({}, (event) => events.push(event));
    assert.equal(events[0].translation, '完成');
    const controller = new AbortController();
    globalThis.fetch = async (_url, init) => { assert.equal(init.signal, controller.signal); throw new DOMException('Aborted', 'AbortError'); };
    await assert.rejects(api.translateStream({}, () => {}, controller.signal), { name: 'AbortError' });
  } finally { globalThis.fetch = originalFetch; }
});
