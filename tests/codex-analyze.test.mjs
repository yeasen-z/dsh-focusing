// A Codex chat can be reviewed in the focus panel: the analyze route reads its
// rollout and folds it through the same foldPanelEvent DSH sessions use.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import assert from "node:assert/strict";

import { apply } from "../lib/index.mjs";

const root = mkdtempSync(join(tmpdir(), "focusing-codex-analyze-"));
after(() => rmSync(root, { recursive: true, force: true }));

function homeWithChat() {
  const home = join(root, "cx");
  const day = join(home, "sessions", "2026", "10", "28");
  mkdirSync(day, { recursive: true });
  writeFileSync(join(day, "rollout-2026-10-28T10-00-00-aaa.jsonl"), [
    JSON.stringify({ timestamp: "2026-10-28T02:00:00.000Z", type: "session_meta", payload: { id: "aaa", cwd: "/w/proj" } }),
    JSON.stringify({ timestamp: "2026-10-28T02:00:01.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "investigate the flaky test" }] } }),
    JSON.stringify({ timestamp: "2026-10-28T02:00:02.000Z", type: "event_msg", payload: { type: "task_started", turn_id: "t1" } }),
    JSON.stringify({ timestamp: "2026-10-28T02:00:03.000Z", type: "response_item", payload: { type: "custom_tool_call", name: "exec", call_id: "c1", input: "{\"command\":\"npm test\"}" } }),
    JSON.stringify({ timestamp: "2026-10-28T02:00:04.000Z", type: "response_item", payload: { type: "custom_tool_call_output", call_id: "c1", output: "Process exited with code 1" } }),
    JSON.stringify({ timestamp: "2026-10-28T02:00:05.000Z", type: "event_msg", payload: { type: "task_complete", turn_id: "t1" } }),
  ].join("\n"));
  return home;
}

function mount(env = {}) {
  const routes = new Map();
  const services = {
    sessions: { list: () => [], get: () => undefined },
    sessionPersistence: { list: async () => [] },
    sessionController: { list: async () => ({ items: [] }) },
    sessionQuery: { readSession: async () => { throw new Error("no dsh history"); } },
    agents: { list: () => [], get: () => undefined },
    sessionTitle: { get: () => undefined },
    agentDefaultModel: { currentSelection: () => null },
    llm: { listProviders: () => [], listModels: async () => [], stream: () => { throw new Error("not used"); } },
  };
  const child = { get: n => services[n], on: () => {}, inject: (k, cb) => cb(child), effect: f => f(), connection: { fetch: { register: r => { routes.set(r.path, r); return () => {}; } } } };
  const ctx = { get: () => undefined, on: () => {}, inject: (k, cb) => cb(child), logger: { info: () => {}, warn: () => {} } };
  const prev = { ...process.env };
  env = { ...env, DSH_PROFILE_DIR: mkdtempSync(join(root, "profile-")) };
  Object.assign(process.env, env);
  let handle;
  try { handle = apply(ctx); } finally { for (const k of Object.keys(env)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } }
  const call = (path, body) => routes.get(path).fetch(new Request("http://h" + path, body ? { method: "POST", body: JSON.stringify(body) } : {})).then(r => r.json());
  return { call, handle };
}

test("analyzing a Codex chat folds its rollout and reports the goal and the failure", async () => {
  process.env.DSH_FOCUSING_CODEX_HOME = homeWithChat();
  const { call, handle } = mount();
  // External source with a stubbed fetch so no real model is called.
  await call("/api/dsh-focusing.settings", { settings: {
    source: "external", endpoint: "https://example.test/v1", externalModel: "m", apiKey: "k",
    codexEnabled: true, activityIncludeExternal: true,
  } });
  // Let the background read finish so the chat is in the index before analyzing.
  await handle.codexIdle();
  const st = await call("/api/dsh-focusing.state");
  for (let i = 0; i < 100 && (st.codexStatus?.pending ?? 0) > 0; i += 1) { await new Promise(r => setTimeout(r, 50)); }
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "VERDICT: STUCK\nThe test fails because of a race in setup." } }] }) });
  let body;
  try { body = await call("/api/dsh-focusing.analyze", { session: "codex:aaa" }); }
  finally { globalThis.fetch = realFetch; await handle?.codexIdle?.(); }
  assert.equal(body.ok, true, JSON.stringify(body));
  assert.match(body.review.reason || "", /race/i);
  assert.equal(body.review.stuck, true, "the STUCK verdict is read");
  assert.equal(body.review.goal, "investigate the flaky test");
  assert.equal(body.review.calls, 1, "one tool call was folded");
  assert.equal(body.reviewTrail, null, "a finished Codex file never has a trail after a review");
});
