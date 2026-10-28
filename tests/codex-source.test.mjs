// Importing Codex chats is a setting: off by default, then either discovered
// (CODEX_HOME, then ~/.codex) or read from a path the person types. Whatever
// the Host finds -- a directory and a count, or why nothing was found -- is
// reported so the settings surface can show it.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../lib/index.mjs";

delete process.env.DSH_FOCUSING_CODEX_HOME;
const STATE = "/api/dsh-focusing.state";
const SETTINGS = "/api/dsh-focusing.settings";
const root = mkdtempSync(join(tmpdir(), "focusing-codex-source-"));
after(() => rmSync(root, { recursive: true, force: true }));

function codexHome(name, ids) {
  const home = join(root, name);
  const day = join(home, "sessions", "2026", "10", "28");
  mkdirSync(day, { recursive: true });
  for (const id of ids) {
    writeFileSync(join(day, `rollout-2026-10-28T10-00-00-${id}.jsonl`), [
      JSON.stringify({ timestamp: "2026-10-28T02:00:00.000Z", type: "session_meta", payload: { id, cwd: "/w/proj" } }),
      JSON.stringify({ timestamp: "2026-10-28T02:00:01.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: `hello ${id}` }] } }),
    ].join("\n"));
  }
  return home;
}

function mount() {
  const routes = new Map();
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
    get: name => services[name], on: () => {}, inject: (keys, cb) => cb(child), effect: fn => fn(),
    connection: { fetch: { register: r => { routes.set(r.path, r); return () => {}; } } },
  };
  const ctx = { get: () => undefined, on: () => {}, inject: (keys, cb) => cb(child), logger: { info: () => {}, warn: () => {} } };
  const previous = process.env.DSH_PROFILE_DIR;
  process.env.DSH_PROFILE_DIR = mkdtempSync(join(root, "profile-"));
  try { apply(ctx); } finally {
    if (previous === undefined) delete process.env.DSH_PROFILE_DIR; else process.env.DSH_PROFILE_DIR = previous;
  }
  const state = async () => (await routes.get(STATE).fetch(new Request(`http://host${STATE}`))).json();
  const save = async settings => (await routes.get(SETTINGS).fetch(new Request(`http://host${SETTINGS}`, { method: "POST", body: JSON.stringify({ settings }) }))).json();
  return { state, save };
}

test("off by default: no Codex rows, and the status says so", async () => {
  process.env.CODEX_HOME = codexHome("default-off", ["a1"]);
  const { state } = mount();
  const body = await state();
  assert.equal(body.sessions.filter(s => s.source === "codex").length, 0);
  assert.equal(body.codexStatus.enabled, false);
});

test("discovery finds CODEX_HOME and lists its chats", async () => {
  process.env.CODEX_HOME = codexHome("discovered", ["d1", "d2"]);
  const { state, save } = mount();
  const saved = await save({ codexEnabled: true });
  assert.equal(saved.codexStatus.ok, true, "saving reports what was found at once");
  assert.equal(saved.codexStatus.sessions, 2);
  assert.equal(saved.codexStatus.via, "env");
  const body = await state();
  assert.deepEqual(body.sessions.filter(s => s.source === "codex").map(s => s.sourceId).sort(), ["d1", "d2"]);
  assert.equal(body.codexStatus.path, process.env.CODEX_HOME);
});

test("a typed path is used as given, and its sessions folder works too", async () => {
  process.env.CODEX_HOME = join(root, "nothing-here");
  const home = codexHome("manual", ["m1"]);
  const { state, save } = mount();
  await save({ codexEnabled: true, codexPathMode: "manual", codexPath: join(home, "sessions") });
  const body = await state();
  assert.equal(body.codexStatus.ok, true);
  assert.equal(body.codexStatus.via, "manual");
  assert.deepEqual(body.sessions.filter(s => s.source === "codex").map(s => s.sourceId), ["m1"]);
});

test("a wrong path is reported, not hidden, and lists nothing", async () => {
  const { state, save } = mount();
  const saved = await save({ codexEnabled: true, codexPathMode: "manual", codexPath: join(root, "does-not-exist") });
  assert.equal(saved.codexStatus.ok, false);
  assert.equal(saved.codexStatus.reason, "missing");
  const empty = await save({ codexPath: "" });
  assert.equal(empty.codexStatus.reason, "no-path", "an empty manual path says so");
  assert.equal((await state()).sessions.filter(s => s.source === "codex").length, 0);
});

test("the status never carries the rows themselves", async () => {
  process.env.CODEX_HOME = codexHome("lean", ["l1"]);
  const { save } = mount();
  const saved = await save({ codexEnabled: true, codexPathMode: "auto" });
  assert.equal("rows" in saved.codexStatus, false);
});
