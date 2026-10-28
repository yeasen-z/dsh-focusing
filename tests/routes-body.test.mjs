// A GET route that does not declare requestBody makes the Host build a
// streaming Request with a body, which throws for GET and surfaces as an empty
// HTTP 400 from the webserver. That is exactly how the context-records module
// broke, so every registered route must declare its body mode.
import test from "node:test";
import assert from "node:assert/strict";
import { apply } from "../lib/index.mjs";

function mount() {
  const routes = new Map();
  const services = {
    sessions: { list: () => [], get: () => undefined },
    sessionPersistence: { list: async () => [] },
    sessionQuery: { readSession: async () => undefined },
    agents: { list: () => [], get: () => undefined },
    sessionTitle: { get: () => undefined },
    agentDefaultModel: { currentSelection: () => null },
    llm: { listProviders: () => [], listModels: async () => [], stream: () => {} },
  };
  const child = {
    get: name => services[name],
    on: () => {}, inject: (keys, cb) => cb(child), effect: fn => fn(),
    connection: { fetch: { register: r => { routes.set(r.path, r); return () => {}; } } },
  };
  const ctx = { get: () => undefined, on: () => {}, inject: (keys, cb) => cb(child), logger: { info: () => {}, warn: () => {} } };
  const previous = process.env.DSH_PROFILE_DIR;
  process.env.DSH_PROFILE_DIR = "/tmp/dsh-focusing-routes-body";
  try { apply(ctx); } finally {
    if (previous === undefined) delete process.env.DSH_PROFILE_DIR;
    else process.env.DSH_PROFILE_DIR = previous;
  }
  return routes;
}

test("every route declares a body mode, so a GET never becomes an empty 400", () => {
  const routes = mount();
  assert.ok(routes.size > 0, "the plugin must register its routes");
  for (const [path, route] of routes) {
    assert.ok(
      route.requestBody === "buffered" || route.requestBody === "streaming",
      `${path} must declare requestBody (got ${JSON.stringify(route.requestBody)})`,
    );
  }
});

test("the context records routes exist and accept GET", () => {
  const routes = mount();
  for (const path of ["/api/dsh-focusing.records", "/api/dsh-focusing.records/detail"]) {
    const route = routes.get(path);
    assert.ok(route, `${path} must be registered`);
    assert.ok(route.methods.includes("GET"), `${path} must accept GET`);
    assert.equal(route.requestBody, "buffered");
  }
});
