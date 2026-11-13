import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../lib/index.mjs";

const root = mkdtempSync(join(tmpdir(), "focusing-bridge-lifecycle-"));
const cleanups = [];
after(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  rmSync(root, { recursive: true, force: true });
});

function mount(config = {}) {
  const routes = new Map();
  const disposers = [];
  const services = {
    sessions: { list: () => [], get: () => undefined },
    sessionPersistence: { list: async () => [] },
    sessionController: { list: async () => ({ items: [] }) },
    sessionQuery: { readSession: async () => undefined },
    agents: { list: () => [], get: () => undefined },
    sessionTitle: { get: () => undefined },
    agentDefaultModel: { currentSelection: () => null },
    llm: { listProviders: () => [], listModels: async () => [], stream: () => {} },
  };
  const child = {
    get: name => services[name],
    on: () => {},
    inject: (keys, cb) => cb(child),
    effect: fn => {
      const dispose = fn();
      if (typeof dispose === "function") disposers.push(dispose);
      return dispose;
    },
    connection: {
      browserPeer: { id: "owner-peer" },
      fetch: { register: route => { routes.set(route.path, route); return () => {}; } },
      createSharedFetchHandler: channel => ({
        fetch: async request => {
          assert.equal(channel, "/api");
          const url = new URL(request.url);
          if (url.pathname === "/api/dsh-focusing.state") return Response.json({ sessions: [], settingsSummary: { source: "dsh" } });
          if (url.pathname === "/api/dsh-focusing.settings") return Response.json({ ok: true, settings: { source: "dsh" }, codexStatus: { enabled: false }, claudeStatus: { enabled: false } });
          return Response.json({ ok: true });
        },
      }),
    },
  };
  const ctx = {
    get: () => undefined,
    on: () => {},
    inject: (keys, cb) => cb(child),
    logger: { info: () => {}, warn: () => {} },
  };
  const previous = process.env.DSH_PROFILE_DIR;
  process.env.DSH_PROFILE_DIR = mkdtempSync(join(root, "profile-"));
  let handle;
  try { handle = apply(ctx, config); }
  finally { if (previous === undefined) delete process.env.DSH_PROFILE_DIR; else process.env.DSH_PROFILE_DIR = previous; }
  const cleanup = async () => {
    await handle.stopBridge();
    for (const dispose of disposers.splice(0).reverse()) await dispose();
  };
  cleanups.push(cleanup);
  return { handle, routes, cleanup };
}

test("explicit start returns an authenticated URL, serves the UI and stops cleanly", async () => {
  const { handle } = mount();
  assert.equal(handle.bridgeOrigin(), undefined);
  const url = await handle.startBridge({ host: "127.0.0.1", port: 0, token: "test-token" });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("token"), "test-token");
  const origin = parsed.origin;

  const first = await fetch(url, { redirect: "manual" });
  assert.equal(first.status, 302);
  assert.equal(first.headers.get("location"), "/");
  const cookie = first.headers.get("set-cookie").split(";")[0];
  const page = await fetch(`${origin}/`, { headers: { cookie } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Focusing/);
  const capabilities = await fetch(`${origin}/api/v1/capabilities`, { headers: { cookie } }).then(response => response.json());
  assert.equal(capabilities.capabilities.nativeDsh, true);
  assert.equal(capabilities.capabilities.canAsk, true);

  assert.equal(await handle.startBridge(), url, "a second start reuses the same endpoint");
  const status = await fetch(`${origin}/api/v1/health`, { headers: { cookie } });
  assert.equal(status.status, 200);
  await handle.stopBridge();
  assert.equal(handle.bridgeOrigin(), undefined);
  await assert.rejects(fetch(`${origin}/api/v1/health`), /fetch failed/);
});

test("bridge.enabled starts automatically and the authenticated DSH route exposes start/stop", async () => {
  const { handle, routes } = mount({ bridge: { enabled: true, port: 0, token: "auto-token" } });
  let url;
  for (let i = 0; i < 100 && !url; i += 1) {
    url = handle.bridgeOrigin();
    if (!url) await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.ok(url, "enabled config starts the server");
  const route = routes.get("/api/dsh-focusing.bridge");
  const status = await route.fetch(new Request("http://dsh.local/api/dsh-focusing.bridge")).then(response => response.json());
  assert.equal(status.running, true);
  assert.equal(status.origin, url);
  const stopped = await route.fetch(new Request("http://dsh.local/api/dsh-focusing.bridge", { method: "POST", body: JSON.stringify({ action: "stop" }) })).then(response => response.json());
  assert.equal(stopped.running, false);
  assert.equal(handle.bridgeOrigin(), undefined);

  const started = await route.fetch(new Request("http://dsh.local/api/dsh-focusing.bridge", { method: "POST", body: JSON.stringify({ action: "start", port: 0 }) })).then(response => response.json());
  assert.equal(started.running, true);
  assert.ok(started.origin);
  await handle.stopBridge();
});
