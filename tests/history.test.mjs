import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { IDBFactory, IDBObjectStore, IDBDatabase, IDBCursor } from 'fake-indexeddb';
import 'fake-indexeddb/auto';

const source = await readFile(new URL('../src/lib/history.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const history = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
const fresh = () => { globalThis.indexedDB = new IDBFactory(); };
const row = (id, createdAt = 1, extra = {}) => ({ id, createdAt, source: 'Hello', submittedText: 'Hello', translation: '你好', sourceLanguage: 'en', targetLanguage: 'zh', model: 'test', ...extra });
const bytes = (record) => new TextEncoder().encode(JSON.stringify(record)).byteLength;
function open(version, upgrade) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('lat.history', version);
    request.onupgradeneeded = () => upgrade?.(request.result, request.transaction);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function seedV1(records) {
  return open(1, (db) => {
    const store = db.createObjectStore('translations', { keyPath: 'id' });
    for (const record of records) store.put(record);
  });
}
function noFullReads() {
  const original = {};
  for (const name of ['get', 'getAll', 'openCursor']) {
    original[name] = IDBObjectStore.prototype[name];
    IDBObjectStore.prototype[name] = function (...args) {
      assert.notEqual(this.name, 'translations', 'ordinary pages, stats and pruning must not fetch full records');
      return original[name].apply(this, args);
    };
  }
  return () => { Object.assign(IDBObjectStore.prototype, original); };
}

test('200 long records paginate summaries and expanding one fetches exactly one full record', async () => {
  fresh();
  const source = 'a'.repeat(100_000);
  const translation = 'b'.repeat(100_000);
  for (let index = 0; index < 200; index++) {
    await history.updateHistory({ add: row(String(index).padStart(3, '0'), index, { source, submittedText: source, translation }) }, 200);
  }
  const restore = noFullReads();
  const ids = [];
  try {
    let before;
    do {
      const page = await history.readHistoryPage({ before });
      assert.equal(page.items.length, 20);
      for (const summary of page.items) {
        assert.equal(summary.sourcePreview.length, 160);
        assert.equal(summary.translationPreview.length, 160);
        assert.equal('source' in summary, false);
        assert.equal('submittedText' in summary, false);
        assert.equal('translation' in summary, false);
      }
      ids.push(...page.items.map((summary) => summary.id));
      before = page.nextCursor;
    } while (before);
    assert.equal(new Set(ids).size, 200);
    assert.deepEqual(ids, Array.from({ length: 200 }, (_, i) => String(199 - i).padStart(3, '0')));
    assert.equal((await history.getHistoryStats()).count, 200);
    await history.updateHistory({ trim: true }, 200);
  } finally { restore(); }
  const original = IDBObjectStore.prototype.get;
  let reads = 0;
  IDBObjectStore.prototype.get = function (...args) { if (this.name === 'translations') reads++; return original.apply(this, args); };
  try {
    const expanded = await history.getHistoryRecord('199');
    assert.equal(expanded.source, source);
    assert.equal(expanded.submittedText, source);
    assert.equal(expanded.translation, translation);
    assert.equal(reads, 1);
  } finally { IDBObjectStore.prototype.get = original; }
});

test('v1 migration preserves full Unicode text, all metadata and records beyond default retention', async () => {
  fresh();
  const source = '😀𠮷汉字'.repeat(1000);
  const records = Array.from({ length: 40 }, (_, i) => row(String(i), i, { source, submittedText: source + ' normalized', translation: source + ' translated', metrics: { total_tokens: 123, extra: 'preserved' }, customMetadata: { value: 'kept' } }));
  const legacy = await seedV1(records);
  let released = false;
  legacy.onversionchange = () => { released = true; legacy.close(); };
  const page = await history.readHistoryPage();
  assert.equal(released, true);
  assert.equal(page.items.length, 20);
  assert.equal([...page.items[0].sourcePreview].length, 160);
  assert.equal(page.items[0].sourcePreview, [...source].slice(0, 160).join(''));
  assert.deepEqual(await history.getHistoryRecord('39'), records[39]);
  assert.deepEqual(await history.readHistory(), records.toReversed());
  assert.deepEqual(await history.getHistoryStats(), { count: 40, bytes: records.reduce((sum, item) => sum + bytes(item), 0), models: ['test'] });
});

test('stable time plus id cursor has no duplicates or omissions across equal timestamps', async () => {
  fresh();
  for (const id of ['a', 'b', 'c', 'd', 'e']) await history.updateHistory({ add: row(id, 42) });
  const first = await history.readHistoryPage({ limit: 2 });
  assert.deepEqual(first.items.map((item) => item.id), ['e', 'd']);
  assert.deepEqual(first.nextCursor, { createdAt: 42, id: 'd' });
  await history.updateHistory({ add: row('newer', 43) });
  await history.updateHistory({ remove: 'd' });
  const second = await history.readHistoryPage({ limit: 2, before: first.nextCursor });
  const third = await history.readHistoryPage({ limit: 2, before: second.nextCursor });
  assert.deepEqual(second.items.map((item) => item.id), ['c', 'b']);
  assert.deepEqual(third.items.map((item) => item.id), ['a']);
  assert.equal(third.nextCursor, null);
});

test('full-text search includes tails and submitted text and combines language/model/origin filters', async () => {
  fresh();
  const tail = 'ordinary '.repeat(100) + 'Needle𠮷';
  const records = [
    row('source', 3, { source: tail, model: 'm2' }),
    row('translation', 2, { translation: tail, origin: 'selection', targetLanguage: 'ja', model: 'm2' }),
    row('submitted', 1, { submittedText: tail, sourceLanguage: 'fr' }),
    row('other', 0, { model: 'unmatched' }),
  ];
  for (const record of records) await history.updateHistory({ add: record });
  const page = await history.readHistoryPage({ query: 'nEeDlE𠮷', limit: 2 });
  assert.deepEqual(page.items.map((item) => item.id), ['source', 'translation']);
  assert.deepEqual((await history.readHistoryPage({ query: 'needle𠮷', before: page.nextCursor })).items.map((item) => item.id), ['submitted']);
  const filters = { query: 'needle𠮷', model: 'm2', origin: 'selection', sourceLanguage: 'en', targetLanguage: 'ja' };
  assert.deepEqual((await history.readHistoryPage(filters)).items.map((item) => item.id), ['translation']);
  assert.deepEqual(await history.exportHistory(filters), [records[1]]);
  assert.deepEqual((await history.readHistoryPage({ origin: 'workspace', query: 'needle𠮷' })).items.map((item) => item.id), ['source', 'submitted']);
  assert.deepEqual((await history.getHistoryStats()).models, ['m2', 'test', 'unmatched']);
  assert.deepEqual(await history.exportHistory({ query: 'missing' }), []);
});

test('byte and count limits remove oldest complete records; oversized replacement preserves original database', async () => {
  fresh();
  const records = [row('a', 1), row('b', 2), row('c', 3)];
  const capacity = bytes(records[1]) + bytes(records[2]);
  for (const record of records) await history.updateHistory({ add: record }, 200, capacity);
  assert.deepEqual(await history.readHistory(), [records[2], records[1]]);
  assert.equal(await history.getHistoryRecord('a'), undefined);
  assert.equal((await history.getHistoryStats()).bytes, capacity);
  await assert.rejects(history.updateHistory({ add: { ...records[2], source: '😀'.repeat(capacity) } }, 200, capacity), /单条历史记录/);
  assert.deepEqual(await history.readHistory(), [records[2], records[1]]);
  await history.updateHistory({ trim: true }, 1, capacity);
  assert.deepEqual(await history.readHistory(), [records[2]]);
  await history.updateHistory({ clear: true });
  assert.deepEqual(await history.getHistoryStats(), { count: 0, bytes: 0, models: [] });
  assert.equal(await history.getHistoryRecord('c'), undefined);
});

test('record writes and pruning roll back atomically on transaction failure', async () => {
  fresh();
  const original = row('original', 1);
  await history.updateHistory({ add: original });
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    if (this.name === 'summaries') throw new DOMException('disk full', 'QuotaExceededError');
    return put.apply(this, args);
  };
  try { await assert.rejects(history.updateHistory({ add: row('new', 2) }), { name: 'QuotaExceededError' }); }
  finally { IDBObjectStore.prototype.put = put; }
  assert.deepEqual(await history.readHistory(), [original]);
  assert.equal(await history.getHistoryRecord('new'), undefined);
  const cursorDelete = IDBCursor.prototype.delete;
  IDBCursor.prototype.delete = function () { throw new Error('pruning failed'); };
  try { await assert.rejects(history.updateHistory({ add: row('new', 2) }, 1), /pruning failed/); }
  finally { IDBCursor.prototype.delete = cursorDelete; }
  assert.deepEqual(await history.readHistory(), [original]);
  assert.equal(await history.getHistoryRecord('new'), undefined);
  assert.equal((await history.getHistoryStats()).count, 1);
});

test('failed v1 upgrade retains the original store and can migrate on retry', async () => {
  fresh();
  const original = row('legacy', 1, { source: '😀完整内容' });
  (await seedV1([original])).close();
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    if (this.name === 'summaries') throw new Error('migration interrupted');
    return put.apply(this, args);
  };
  try { await assert.rejects(history.readHistoryPage(), /migration interrupted/); }
  finally { IDBObjectStore.prototype.put = put; }
  const legacy = await open(1);
  assert.deepEqual([...legacy.objectStoreNames], ['translations']);
  legacy.close();
  assert.deepEqual(await history.readHistory(), [original]);
});

test('asynchronous transaction abort and failed delete/clear preserve both stores', async () => {
  fresh();
  const original = row('original');
  await history.updateHistory({ add: original });
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    const request = put.apply(this, args);
    if (this.name === 'translations') request.addEventListener('success', () => this.transaction.abort());
    return request;
  };
  try { await assert.rejects(history.updateHistory({ add: row('aborted', 2) })); }
  finally { IDBObjectStore.prototype.put = put; }
  assert.equal(await history.getHistoryRecord('aborted'), undefined);
  for (const [method, action] of [['delete', { remove: 'original' }], ['clear', { clear: true }]]) {
    const operation = IDBObjectStore.prototype[method];
    IDBObjectStore.prototype[method] = function (...args) {
      if (this.name === 'summaries') throw new Error(method + ' interrupted');
      return operation.apply(this, args);
    };
    try { await assert.rejects(history.updateHistory(action), new RegExp(method + ' interrupted')); }
    finally { IDBObjectStore.prototype[method] = operation; }
    assert.deepEqual(await history.getHistoryRecord('original'), original);
    assert.deepEqual(await history.getHistoryStats(), { count: 1, bytes: bytes(original), models: ['test'] });
  }
});

test('blocked upgrade rejects safely, closes late success and allows subsequent retry/delete', async () => {
  fresh();
  const original = row('legacy');
  const legacy = await seedV1([original]);
  await assert.rejects(history.readHistoryPage(), /其他窗口占用/);
  legacy.close();
  assert.deepEqual(await history.readHistory(), [original]);
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('lat.history');
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('abandoned open leaked a connection'));
  });
});

test('connection invalidated before transaction begins reopens once; concurrent mutations stay coherent', async () => {
  fresh();
  await history.getHistoryStats();
  const transaction = IDBDatabase.prototype.transaction;
  let invalidated = false;
  IDBDatabase.prototype.transaction = function (...args) {
    if (!invalidated && Array.isArray(args[0])) {
      invalidated = true;
      this.close();
    }
    return transaction.apply(this, args);
  };
  try { await history.updateHistory({ add: row('first', 0) }); }
  finally { IDBDatabase.prototype.transaction = transaction; }
  assert.equal(invalidated, true);
  await Promise.all(Array.from({ length: 40 }, (_, i) => history.updateHistory({ add: row(String(i).padStart(2, '0'), i + 1) }, 10)));
  const records = await history.readHistory();
  assert.equal(records.length, 10);
  assert.deepEqual(records.map((record) => record.id), Array.from({ length: 10 }, (_, i) => String(39 - i)));
  assert.equal((await history.getHistoryStats()).bytes, records.reduce((sum, record) => sum + bytes(record), 0));
});
