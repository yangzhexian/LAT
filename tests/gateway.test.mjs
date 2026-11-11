import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const outfile = "artifacts/validation/gateway-test.mjs";
await build({ entryPoints: ["src/lib/api.ts"], outfile, bundle: true, platform: "node", format: "esm", packages: "external",
  define: { "import.meta.env": "{}" }, plugins: [{ name: "native", setup(build) {
    build.onResolve({ filter: /^@tauri-apps\/api\/core$/ }, () => ({ path: "core", namespace: "mock" }));
    build.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: "export const invoke = (...args) => globalThis.__gatewayTest.invoke(...args)" }));
  } }] });
const api = await import(pathToFileURL(resolve(outfile)).href);

test("desktop requests use instance credentials and reacquire after invalidation", async () => {
  const original = globalThis.fetch;
  globalThis.window = { __TAURI_INTERNALS__: {} };
  let token = "first", calls = 0;
  globalThis.__gatewayTest = { invoke: async () => { calls++; return { url: "http://127.0.0.1:8787", token, instance_id: "current", protocol_version: 2 }; } };
  const headers = [];
  globalThis.fetch = async (_url, init) => { headers.push(init.headers.get("Authorization")); return Response.json({ ready: true }); };
  try {
    api.invalidateGatewaySession();
    await api.getStatus(); await api.getTelemetry();
    assert.equal(calls, 1);
    token = "second"; api.invalidateGatewaySession();
    await api.getStatus();
    assert.deepEqual(headers, ["Bearer first", "Bearer first", "Bearer second"]);
  } finally { globalThis.fetch = original; delete globalThis.window; api.invalidateGatewaySession(); }
});

test("handshake rejects an old protocol or a different gateway instance", async () => {
  const original = globalThis.fetch;
  globalThis.window = { __TAURI_INTERNALS__: {} };
  globalThis.__gatewayTest = { invoke: async () => ({ url: "http://127.0.0.1:8787", token: "session", instance_id: "owned", protocol_version: 2 }) };
  try {
    for (const [protocol_version, instance_id, code] of [[1, "owned", "protocol_mismatch"], [2, "foreign", "instance_mismatch"]]) {
      globalThis.fetch = async () => Response.json({ service: "lat-local-translator", protocol_version, instance_id });
      await assert.rejects(api.ensureGateway(), (error) => error.code === code);
    }
  } finally { globalThis.fetch = original; delete globalThis.window; api.invalidateGatewaySession(); }
});


test("a disconnected session cannot be restored by a late native reply", async () => {
  const original = globalThis.fetch;
  globalThis.window = { __TAURI_INTERNALS__: {} };
  let reply;
  globalThis.__gatewayTest = { invoke: () => new Promise((resolve) => { reply = resolve; }) };
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; return Response.json({}); };
  try {
    api.invalidateGatewaySession();
    const request = api.getStatus();
    const rejected = assert.rejects(request, (error) => error.code === "session_changed");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(typeof reply, "function");
    api.invalidateGatewaySession();
    reply({ url: "http://127.0.0.1:8787", token: "expired", instance_id: "old", protocol_version: 2 });
    await rejected;
    assert.equal(fetches, 0);
  } finally { globalThis.fetch = original; delete globalThis.window; api.invalidateGatewaySession(); }
});


test("production bundles discard the development bearer credential", async () => {
  const result = await build({ entryPoints: ["src/lib/api.ts"], bundle: true, platform: "browser", format: "esm", packages: "external", write: false, minify: true,
    define: { "import.meta.env.DEV": "false", "import.meta.env.VITE_GATEWAY_URL": "undefined", "import.meta.env.VITE_GATEWAY_TOKEN": JSON.stringify("development-only-secret-sentinel") } });
  assert.equal(result.outputFiles[0].text.includes("development-only-secret-sentinel"), false);
});
