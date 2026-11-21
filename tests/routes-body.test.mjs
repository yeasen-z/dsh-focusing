// A GET route that does not declare requestBody makes the Host build a
// streaming Request with a body, which throws for GET and surfaces as an empty
// HTTP 400 from the webserver. That is exactly how the context-records module
// broke, so every registered route must declare its body mode.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { apply } from "../lib/index.mjs";
process.env.DSH_FOCUSING_CODEX_HOME = mkdtempSync(join(tmpdir(), "focusing-codex-empty-"));

function mount({ overrides = {}, events = new Map(), profile = "/tmp/dsh-focusing-routes-body" } = {}) {
  const routes = new Map();
  const services = {
    sessions: { list: () => [], get: () => undefined },
    sessionPersistence: { list: async () => [] },
    sessionQuery: { readSession: async () => undefined },
    agents: { list: () => [], get: () => undefined },
    sessionTitle: { get: () => undefined },
    agentDefaultModel: { currentSelection: () => null },
    llm: { listProviders: () => [], listModels: async () => [], stream: () => {} },
    ...overrides,
  };
  const child = {
    get: name => services[name],
    on: (name, listener) => { events.set(name, listener); }, inject: (keys, cb) => cb(child), effect: fn => fn(),
    connection: { fetch: { register: r => { routes.set(r.path, r); return () => {}; } } },
  };
  const ctx = { get: () => undefined, on: () => {}, inject: (keys, cb) => cb(child), logger: { info: () => {}, warn: () => {} } };
  const previous = process.env.DSH_PROFILE_DIR;
  process.env.DSH_PROFILE_DIR = profile;
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

test('personal todo route mounts without an active session or model selection', () => {
  const route = mount().get('/api/dsh-focusing.todos');
  assert.ok(route);
  assert.ok(route.methods.includes('GET'));
  assert.ok(route.methods.includes('POST'));
  assert.equal(route.requestBody, 'buffered');
});

test("native Ask installs read-only tools before prompting and restores them on Agent resume", async t => {
  const tmp = realpathSync(tmpdir());
  const profile = mkdtempSync(join(tmp, "focusing-native-mount-"));
  t.after(() => {
    const resolved = realpathSync(profile);
    if (resolved === profile && resolved.startsWith(`${tmp}/focusing-native-mount-`)) rmSync(resolved, { recursive: true });
  });
  const events = new Map();
  const makeAgent = () => {
    const definitions = [];
    const guards = [];
    const sections = [];
    const services = {
      tools: {
        register: definition => { definitions.push(definition); return () => {}; },
        guard: guard => { guards.push(guard); return () => {}; },
      },
      systemPrompt: { section: section => { sections.push(section); return () => {}; } },
    };
    return { id: "ask-session", definitions, guards, sections, ctx: { get: name => services[name], effect: setup => setup() } };
  };
  let agent = makeAgent();
  const prompts = [];
  const routes = mount({ events, profile, overrides: {
    sessionController: {
      create: async () => ({ sessionId: agent.id }),
      resolveAgent: async () => ({ agent }),
      prompt: async request => { assert.equal(agent.definitions.length, 3); prompts.push(request); },
      state: async () => ({ running: false, queue: [], cursor: 0 }),
    },
    sessionQuery: { readSession: async () => ({ events: [] }) },
  } });
  const url = "http://test/api/dsh-focusing.native-ask";
  const { fetch } = routes.get(new URL(url).pathname);
  const post = body => fetch(new Request(url, { method: "POST", body: JSON.stringify(body) })).then(response => response.json());
  const started = await post({ question: "Find the relevant work", range: "all" });
  assert.equal(started.ok, true, started.detail);
  assert.equal(agent.guards[0]({ name: "focus_read_session" }), undefined);
  assert.ok(agent.guards[0]({ name: "focus_unrelated" }));
  assert.ok(agent.guards[0]({ name: "bash" }));
  assert.match(agent.sections[0].text, /use that evidence directly/);
  const previous = agent;
  agent = makeAgent();
  await events.get("agent/created")({ agent });
  const continued = await post({ id: started.ask.id, question: "Summarize what you found" });
  assert.equal(continued.ok, true, continued.detail);
  assert.equal(continued.ask.sessionId, started.ask.sessionId);
  assert.equal(agent.definitions.length, 3, "prompt setup does not duplicate resumed registrations");
  assert.equal(previous.definitions.length, 3);
  assert.equal(prompts.length, 2);
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
