import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

test('settings capsules update preferences and reduced motion survives remount', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true });
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  await build({ stdin: { contents: 'export { SettingsPanel } from "./src/features/translator/SettingsPanel"; export { usePersistentSettings } from "./src/lib/settings";', resolveDir: process.cwd() }, outfile: 'artifacts/validation/settings-test.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic' });
  const { SettingsPanel, usePersistentSettings } = await import(pathToFileURL(resolve('artifacts/validation/settings-test.mjs')).href);
  function Harness() {
    const [settings, setSettings] = usePersistentSettings();
    return React.createElement(SettingsPanel, { settings, onChange: (next) => setSettings((previous) => ({ ...previous, ...next })), onClose() {} });
  }
  let root = createRoot(document.getElementById('root'));
  try {
    await React.act(async () => root.render(React.createElement(Harness)));
    const motion = [...document.querySelectorAll('label')].find((label) => label.textContent.includes('减少动态效果')).querySelector('input');
    await React.act(async () => motion.click());
    assert.equal(document.documentElement.dataset.reduceMotion, 'true');
    assert.equal(JSON.parse(localStorage.getItem('lat.settings.v1')).reduceMotion, true);
    await React.act(async () => [...document.querySelectorAll('button')].find((button) => button.textContent === '深色').click());
    assert.equal(document.documentElement.dataset.theme, 'dark');
    await React.act(async () => [...document.querySelectorAll('button')].find((button) => button.textContent === '上下').click());
    assert.equal(JSON.parse(localStorage.getItem('lat.settings.v1')).layout, 'vertical');
    await React.act(async () => document.querySelector('[aria-label="保存翻译历史"]').click());
    assert.equal(JSON.parse(localStorage.getItem('lat.settings.v1')).saveHistory, false);
    await React.act(async () => {
      const select = [...document.querySelectorAll('select')].find((item) => item.closest('label').textContent.includes('最多保存'));
      select.value = '100'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    assert.equal(JSON.parse(localStorage.getItem('lat.settings.v1')).historyLimit, 100);
    await React.act(async () => root.unmount());
    root = createRoot(document.getElementById('root'));
    await React.act(async () => root.render(React.createElement(Harness)));
    assert.equal(document.querySelector('[aria-label="减少动态效果"]').checked, true);
    assert.equal(document.querySelectorAll('[aria-pressed="true"]').length, 2);
  } finally { await React.act(async () => root.unmount()); dom.window.close(); }
});
