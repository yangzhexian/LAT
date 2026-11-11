import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const fixtures = {
  api: `const call = (name, ...args) => globalThis.__appRecovery.api[name]?.(...args);
    export const ensureGateway = () => call("ensureGateway");
    export const invalidateGatewaySession = () => call("invalidateGatewaySession");
    export const getStatus = () => call("getStatus");
    export const getDownloadEnvironment = async () => ({});
    export const loadModel = (model) => call("loadModel", model);
    export const setTelemetryInterval = async () => {};
    export const cancelDownload = async () => {};
    export const downloadModelStream = async () => {};
    export const selectDataDirectory = async () => {};
    export const setDataDirectory = async () => {};
    export const unloadModel = async () => {};`,
  settings: `import {useState} from "react"; export const usePersistentSettings = () => useState({telemetryInterval: 2, dataDirectory: ""});`,
  selectionIntegration: `export const useSelectionIntegration = () => ({busy: false});`,
  mathjax: `export const mathJaxConfig = {};`,
  "better-react-mathjax": `export const MathJaxContext = ({children}) => children;`,
  "@tauri-apps/api/event": `export const listen = async (name, callback) => {
    globalThis.__appRecovery.listeners.set(name, callback);
    return () => globalThis.__appRecovery.listeners.delete(name);
  };`,
  ModelSelector: `export function ModelSelector({onEnable, loading}) { return <button id="enable-model" disabled={loading} onClick={onEnable}>启用模型</button>; }`,
  TranslatorWorkspace: `import {useState} from "react";
    export function TranslatorWorkspace({status, setupContent, modelError}) {
      const [text, setText] = useState("");
      return <div data-ready={String(status.ready)}><textarea value={text} onChange={e => setText(e.target.value)} />{setupContent}<p role="alert">{modelError}</p></div>;
    }`,
};
const outfile = "artifacts/validation/app-recovery-test.mjs";
await build({ entryPoints: ["src/App.tsx"], outfile, bundle: true, platform: "node", format: "esm", packages: "external", jsx: "automatic", loader: {".css": "empty"}, plugins: [{
  name: "app-boundaries", setup(builder) {
    builder.onResolve({filter: /.*/}, ({path}) => {
      const key = Object.hasOwn(fixtures, path) ? path : path.split("/").at(-1);
      if (Object.hasOwn(fixtures, key)) return {path: key, namespace: "fixture"};
    });
    builder.onLoad({filter: /.*/, namespace: "fixture"}, ({path}) => ({contents: fixtures[path], loader: "tsx", resolveDir: resolve(".")}));
  },
}] });

test("gateway termination exposes reload action without unmounting the workspace", async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {url: "http://localhost"});
  Object.assign(globalThis, {window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true});
  window.__TAURI_INTERNALS__ = {};
  const React = await import("react");
  const {createRoot} = await import("react-dom/client");
  const {default: App} = await import(pathToFileURL(resolve(outfile)).href);
  const root = createRoot(document.getElementById("root"));
  const calls = [];
  globalThis.__appRecovery = { listeners: new Map(), api: {
    ensureGateway: async () => calls.push("connect"),
    invalidateGatewaySession: () => calls.push("invalidate"),
    getStatus: async () => ({ready: true, models: [{name: "hy-mt2-1.8b:q8_0"}], active_model: "hy-mt2-1.8b:q8_0", running_models: [{}]}),
    loadModel: async model => calls.push("load:" + model),
  }};
  try {
    await React.act(async () => root.render(React.createElement(App)));
    const source = document.querySelector("textarea");
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value").set.call(source, "Preserve my work");
      source.dispatchEvent(new dom.window.Event("input", {bubbles: true}));
    });
    await React.act(async () => globalThis.__appRecovery.listeners.get("gateway-terminated")());
    assert.equal(document.querySelector("textarea"), source);
    assert.equal(source.value, "Preserve my work");
    assert.match(document.querySelector('[role="alert"]').textContent, /断开/);
    assert.ok(document.getElementById("enable-model"));
    assert.equal(document.querySelector('[data-ready]').dataset.ready, "false");
    await React.act(async () => document.getElementById("enable-model").click());
    assert.equal(source.value, "Preserve my work");
    assert.equal(document.querySelector('[data-ready]').dataset.ready, "true");
    assert.deepEqual(calls, ["connect", "invalidate", "connect", "load:hy-mt2-1.8b:q8_0"]);
  } finally {
    await React.act(async () => root.unmount());
    assert.equal(globalThis.__appRecovery.listeners.size, 0);
    dom.window.close();
    delete globalThis.__appRecovery;
  }
});
