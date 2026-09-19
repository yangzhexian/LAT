import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { JSDOM, requestInterceptor, VirtualConsole } from 'jsdom';

test('offline MathJax renders membership, norm and boldsymbol without errors', { timeout: 15000 }, async () => {
  const requests = [];
  const resources = { interceptors: [requestInterceptor(async (request) => {
    const parsed = new URL(request.url);
    assert.equal(parsed.origin, 'http://lat.local', 'MathJax must remain offline');
    requests.push(parsed.pathname);
    return new Response(await readFile(resolve('public', '.' + parsed.pathname)), { headers: { 'Content-Type': 'application/javascript' } });
  })] };
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', (error) => errors.push(error.message));
  const dom = new JSDOM('<!doctype html><script src="/mathjax/tex-chtml.js"></script>', {
    url: 'http://lat.local', runScripts: 'dangerously', resources, virtualConsole: console,
    beforeParse(window) {
      window.eval(`window.MathJax = { loader: { load: ['[tex]/boldsymbol'] }, tex: { packages: { '[+]': ['boldsymbol'] } }, chtml: { fontURL: '/mathjax/output/chtml/fonts/woff-v2' }, startup: { typeset: false } };`);
    },
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('MathJax offline startup timeout')), 10000);
      dom.window.addEventListener('load', () => { clearTimeout(timer); resolve(); });
    });
    let startupTimer;
    try {
      await Promise.race([dom.window.MathJax.startup.promise, new Promise((_, reject) => { startupTimer = setTimeout(() => reject(new Error(JSON.stringify({ requests, errors }))), 5000); })]);
    } finally { clearTimeout(startupTimer); }
    const node = await dom.window.MathJax.tex2chtmlPromise(String.raw`\boldsymbol{x} \in A, \|x\|^2 + \sum_{j\in J}|h_j|^2`, { display: true });
    assert.equal(node.querySelectorAll('mjx-merror').length, 0);
    assert.match(node.outerHTML, /mjx-c2208/);
    assert.match(node.outerHTML, /mjx-c2016|mjx-c2225/);
    assert.match(node.outerHTML, /TEX-BI/);
    assert.ok(requests.some((path) => path.endsWith('/boldsymbol.js')));
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});
