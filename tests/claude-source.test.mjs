// Host integration for Claude Code import: independent opt-in, status, roster,
// panel metadata and manual review all use the same SourceAdapter lifecycle.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../lib/index.mjs";

const root = mkdtempSync(join(tmpdir(), "focusing-claude-source-"));
const previousClaudeHome = process.env.DSH_FOCUSING_CLAUDE_HOME;
const mounted = [];
after(async () => {
  await Promise.allSettled(mounted.map(handle => handle?.importedIdle?.()));
  if (previousClaudeHome === undefined) delete process.env.DSH_FOCUSING_CLAUDE_HOME;
  else process.env.DSH_FOCUSING_CLAUDE_HOME = previousClaudeHome;
  rmSync(root, { recursive: true, force: true });
});

function homeWithChat(name = "claude-home") {
  const home = join(root, name);
  const project = join(home, "projects", "-w-app");
  mkdirSync(project, { recursive: true });
  const row = (type, second, extra) => JSON.stringify({ type, timestamp: `2026-11-01T02:00:0${second}.000Z`, sessionId: "claude-1", cwd: "/w/app", ...extra });
  writeFileSync(join(project, "claude-1.jsonl"), [
    JSON.stringify({ type: "summary", summary: "Claude review fixture" }),
    row("user", 1, { message: { role: "user", content: "investigate the Claude failure" } }),
    row("assistant", 2, { message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_c", name: "Bash", input: { command: "npm test" } }] } }),
    row("user", 3, { message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_c", content: "Process exited with code 1", is_error: true }] } }),
    row("assistant", 4, { message: { role: "assistant", content: [{ type: "text", text: "The test failed" }] } }),
  ].join("\n"));
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
    llm: { listProviders: () => [], listModels: async () => [], stream: () => { throw new Error("not used"); } },
  };
  const child = {
    get: name => services[name], on: () => {}, inject: (keys, cb) => cb(child), effect: fn => fn(),
    connection: { fetch: { register: route => { routes.set(route.path, route); return () => {}; } } },
  };
  const ctx = { get: () => undefined, on: () => {}, inject: (keys, cb) => cb(child), logger: { info() {}, warn() {} } };
  const previous = process.env.DSH_PROFILE_DIR;
  process.env.DSH_PROFILE_DIR = mkdtempSync(join(root, "profile-"));
  let handle;
  try { handle = apply(ctx); }
  finally { if (previous === undefined) delete process.env.DSH_PROFILE_DIR; else process.env.DSH_PROFILE_DIR = previous; }
  mounted.push(handle);
  const request = async path => routes.get(path.split("?")[0]).fetch(new Request(`http://host${path}`));
  const call = async (path, body) => (await routes.get(path.split("?")[0]).fetch(new Request(`http://host${path}`, body ? { method: "POST", body: JSON.stringify(body) } : {}))).json();
  const state = async id => call(`/api/dsh-focusing.state${id ? `?session=${encodeURIComponent(id)}` : ""}`);
  return { call, request, state, handle, save: settings => call("/api/dsh-focusing.settings", { settings }) };
}

test("Claude import is independently opt-in and its status never leaks roster rows", async () => {
  process.env.DSH_FOCUSING_CLAUDE_HOME = homeWithChat();
  const { save, state, handle } = mount();
  const initial = await state();
  assert.equal(initial.claudeStatus.enabled, false);
  assert.equal(initial.sessions.filter(s => s.source === "claude").length, 0);

  const saved = await save({ claudeEnabled: true });
  assert.equal(saved.claudeStatus.ok, true);
  assert.equal(saved.claudeStatus.via, "env");
  assert.equal("rows" in saved.claudeStatus, false);
  await handle.claudeIdle();
  let body = await state();
  for (let i = 0; i < 100 && !body.sessions.some(s => s.id === "claude:claude-1"); i += 1) {
    await new Promise(resolve => setTimeout(resolve, 20));
    body = await state();
  }
  const row = body.sessions.find(s => s.id === "claude:claude-1");
  assert.equal(row.source, "claude");
  assert.equal(row.title, "Claude review fixture");
  assert.equal(row.turns, 1);
  assert.equal(body.codexStatus.enabled, false, "enabling Claude does not enable Codex");
  await handle.importedIdle();
});

test("a Claude chat can be opened and manually analyzed, then becomes unavailable when disabled", async () => {
  process.env.DSH_FOCUSING_CLAUDE_HOME = homeWithChat();
  const { call, save, state, handle } = mount();
  await save({
    claudeEnabled: true,
    source: "external", endpoint: "https://example.test/v1", externalModel: "m", apiKey: "k",
  });
  // No explicit idle here: selecting immediately must settle the initial index
  // instead of losing the race against the background roster rebuild.
  const selected = await state("claude:claude-1");
  assert.equal(selected.title, "Claude review fixture");
  assert.equal(selected.goal, "investigate the Claude failure");
  assert.equal(selected.totalToolCalls, 1);

  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "VERDICT: STUCK\nEVIDENCE: the test failed" } }] }) });
  let reviewed;
  try { reviewed = await call("/api/dsh-focusing.analyze", { session: "claude:claude-1" }); }
  finally { globalThis.fetch = realFetch; }
  assert.equal(reviewed.ok, true, JSON.stringify(reviewed));
  assert.equal(reviewed.review.stuck, true);
  assert.equal(reviewed.review.goal, "investigate the Claude failure");
  assert.equal(reviewed.review.calls, 1);
  assert.equal(reviewed.reviewTrail, null);
  const afterReview = await state();
  const marked = afterReview.sessions.find(s => s.id === "claude:claude-1");
  assert.equal(marked.reviewed, true, "the imported roster receives the saved review marker");
  assert.equal(marked.reviewCount, 1);

  await save({ claudeEnabled: false });
  assert.equal((await state()).sessions.some(s => s.source === "claude"), false);
  const disabled = await call("/api/dsh-focusing.analyze", { session: "claude:claude-1" });
  assert.equal(disabled.ok, false);
  assert.equal(disabled.reason, "no-session");
  await handle.importedIdle();
});

test("Claude preview and Markdown/JSON exports use the imported event stream", async () => {
  process.env.DSH_FOCUSING_CLAUDE_HOME = homeWithChat();
  const { call, request, save, handle } = mount();
  await save({ claudeEnabled: true });
  const preview = await call("/api/dsh-focusing.preview?session=claude%3Aclaude-1");
  assert.equal(preview.ok, true, JSON.stringify(preview));
  assert.match(preview.user, /investigate the Claude failure/);
  assert.match(preview.user, /npm test/);

  const markdown = await request("/api/dsh-focusing.export?session=claude%3Aclaude-1&format=md");
  assert.equal(markdown.status, 200);
  const text = await markdown.text();
  assert.match(text, /Claude review fixture/);
  assert.match(text, /investigate the Claude failure/);
  assert.match(text, /npm test/);
  assert.match(text, /Process exited with code 1/);

  const exported = await request("/api/dsh-focusing.export?session=claude%3Aclaude-1&format=json");
  assert.equal(exported.status, 200);
  const body = await exported.json();
  assert.equal(body.session, "claude:claude-1");
  assert.equal(body.title, "Claude review fixture");
  const messages = body.turns.flatMap(turn => turn.messages);
  assert.ok(messages.some(message => message.role === "user" && message.text.includes("investigate")));
  assert.ok(messages.some(message => message.role === "tool" && message.name === "Bash" && message.isError));
  await handle.importedIdle();
});

test("an earlier subagent sharing the parent id cannot replace its roster or selected context", async () => {
  const home = homeWithChat("claude-sidechain-home");
  const project = join(home, "projects", "-w-app");
  const agent = JSON.stringify({
    type: "user", sessionId: "claude-1", cwd: "/agent/work", isSidechain: true,
    timestamp: "2026-11-01T01:00:00.000Z",
    message: { role: "user", content: "private agent task" },
  });
  writeFileSync(join(project, "000-agent.jsonl"), agent);
  const agents = join(project, "000-parent", "subagents");
  mkdirSync(agents, { recursive: true });
  writeFileSync(join(agents, "agent.jsonl"), agent);
  process.env.DSH_FOCUSING_CLAUDE_HOME = home;
  const { call, save, state, handle } = mount();
  await save({ claudeEnabled: true });
  await handle.importedIdle();
  const rows = (await state()).sessions.filter(row => row.id === "claude:claude-1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Claude review fixture");
  assert.equal(rows[0].turns, 1);
  const selected = await state("claude:claude-1");
  assert.equal(selected.goal, "investigate the Claude failure");
  assert.equal(selected.totalToolCalls, 1);
  const preview = await call("/api/dsh-focusing.preview?session=claude%3Aclaude-1");
  assert.equal(preview.ok, true);
  assert.match(preview.user, /investigate the Claude failure/);
  assert.doesNotMatch(preview.user, /private agent task/);
  await handle.importedIdle();
});

test("a wrong Claude path has a source-specific explanation", async () => {
  delete process.env.DSH_FOCUSING_CLAUDE_HOME;
  const { save, handle } = mount();
  const missing = await save({ claudeEnabled: true, claudePathMode: "manual", claudePath: join(root, "missing") });
  assert.equal(missing.claudeStatus.ok, false);
  assert.equal(missing.claudeStatus.reason, "missing");
  const empty = await save({ claudePath: "" });
  assert.equal(empty.claudeStatus.reason, "no-path");
  await handle.importedIdle();
});
