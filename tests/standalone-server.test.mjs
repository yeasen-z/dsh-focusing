import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStandaloneServer } from "../lib/standalone-server.mjs";

const root = mkdtempSync(join(tmpdir(), "focusing-standalone-test-"));
const dataDir = join(root, "data");
const now = Date.now();
const iso = offset => new Date(now + offset).toISOString();
const codexHome = join(root, "codex");
const claudeHome = join(root, "claude");
const codexDay = join(codexHome, "sessions", "2026", "11", "12");
mkdirSync(codexDay, { recursive: true });
mkdirSync(join(claudeHome, "projects", "-w-claude"), { recursive: true });
writeFileSync(join(codexDay, "rollout-standalone.jsonl"), [
  JSON.stringify({ timestamp: iso(0), type: "session_meta", payload: { id: "codex-1", cwd: "/w/shared" } }),
  JSON.stringify({ timestamp: iso(1), type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "standalone codex task" }] } }),
  JSON.stringify({ timestamp: iso(2), type: "event_msg", payload: { type: "task_started" } }),
  JSON.stringify({ timestamp: iso(3), type: "response_item", payload: { type: "custom_tool_call", call_id: "cx-call", name: "shell", input: "{\"command\":\"npm test\"}" } }),
  JSON.stringify({ timestamp: iso(4), type: "response_item", payload: { type: "custom_tool_call_output", call_id: "cx-call", output: "Process exited with code 0" } }),
  JSON.stringify({ timestamp: iso(5), type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Codex standalone done" }] } }),
  JSON.stringify({ timestamp: iso(6), type: "event_msg", payload: { type: "task_complete" } }),
].join("\n"));
writeFileSync(join(codexHome, "session_index.jsonl"), `${JSON.stringify({ id: "codex-1", thread_name: "Codex standalone" })}\n`);
writeFileSync(join(claudeHome, "projects", "-w-claude", "claude-1.jsonl"), [
  JSON.stringify({ type: "summary", summary: "Claude standalone" }),
  JSON.stringify({ type: "user", sessionId: "claude-1", cwd: "/w/claude", timestamp: iso(0), message: { role: "user", content: "standalone claude task" } }),
  JSON.stringify({ type: "assistant", sessionId: "claude-1", cwd: "/w/claude", timestamp: iso(1), message: { role: "assistant", content: [{ type: "tool_use", id: "cl-call", name: "Bash", input: { command: "npm test" } }] } }),
  JSON.stringify({ type: "user", sessionId: "claude-1", cwd: "/w/claude", timestamp: iso(2), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "cl-call", content: "Process exited with code 0" }] } }),
  JSON.stringify({ type: "assistant", sessionId: "claude-1", cwd: "/w/claude", timestamp: iso(3), message: { role: "assistant", content: [{ type: "text", text: "Claude standalone done" }] } }),
].join("\n"));

let running;
after(async () => {
  await running?.close();
  rmSync(root, { recursive: true, force: true });
});
async function start() {
  running = await startStandaloneServer({ host: "127.0.0.1", port: 0, dataDir, codexHome, claudeHome });
  return running.origin;
}
async function request(path, init) {
  const response = await fetch(`${running.origin}${path}`, init);
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { response, body };
}
const get = path => request(path);
const postSettings = settings => request("/api/v1/settings", { method: "POST", body: JSON.stringify({ settings }) });

test("the server exposes health and static web assets, and refuses non-loopback hosts", async () => {
  const origin = await start();
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal((await get("/api/v1/health")).body.ok, true);
  const capabilities = (await get("/api/v1/capabilities")).body.capabilities;
  assert.equal(capabilities.nativeDsh, false);
  assert.equal(capabilities.canReport, true);
  assert.equal(capabilities.canAnalyze, true);
  const html = await get("/");
  assert.equal(html.response.status, 200);
  assert.match(html.body, /preact\.umd\.js[\s\S]*preact-hooks\.umd\.js[\s\S]*preact-compat\.umd\.js/);
  assert.match(html.body, /Focusing/);
  assert.match(html.body, /\/focusing-client\.js/);
  for (const asset of ["/standalone-shell.js", "/standalone-boot.js", "/focusing-client.js", "/theme.css", "/vendor/preact.umd.js", "/vendor/preact-hooks.umd.js", "/vendor/preact-compat.umd.js", "/icon.svg"]) {
    assert.equal((await get(asset)).response.status, 200, asset);
  }
  await assert.rejects(startStandaloneServer({ host: "0.0.0.0", port: 0, dataDir }), /loopback/);
});

test("both imported sources are opt-in and index in the background", async () => {
  const initial = await get("/api/v1/sources");
  assert.ok(initial.body.sources.every(source => source.enabled === false));
  const saved = await postSettings({ codexEnabled: true, claudeEnabled: true, activityIncludeExternal: true });
  assert.equal(saved.body.settings.codexEnabled, true);
  assert.equal(saved.body.settings.claudeEnabled, true);
  assert.ok(saved.body.sources.every(source => !("rows" in source)));

  let sources;
  for (let i = 0; i < 100; i += 1) {
    sources = (await get("/api/v1/sources")).body.sources;
    if (sources.every(source => source.sessions === 1 && !source.pending)) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.deepEqual(sources.map(source => [source.id, source.sessions]), [["codex", 1], ["claude", 1]]);
  assert.ok(sources.every(source => source.capabilities.readOnly && !source.capabilities.canContinueInDsh));
});

test("sessions support source, text and workspace filters plus folded detail and raw events", async () => {
  const claude = await get("/api/v1/sessions?range=all&sources=claude");
  assert.equal(claude.body.records.length, 1);
  assert.equal(claude.body.records[0].id, "claude:claude-1");
  assert.equal(claude.body.records[0].title, "Claude standalone");

  const search = await get("/api/v1/sessions?range=all&sources=codex,claude&q=standalone");
  assert.equal(search.body.records.length, 2);
  const workspace = await get("/api/v1/sessions?range=all&cwd=%2Fw%2Fclaude");
  assert.deepEqual(workspace.body.records.map(record => record.id), ["claude:claude-1"]);

  const detail = await get("/api/v1/sessions/claude%3Aclaude-1?range=all");
  assert.equal(detail.body.record.lastReply, "Claude standalone done");
  assert.equal(detail.body.record.readOnly, true);
  const events = await get("/api/v1/sessions/claude%3Aclaude-1/events?offset=0&limit=2");
  assert.equal(events.body.items.length, 2);
  assert.equal(events.body.total > 2, true);
  assert.ok(events.body.nextCursor);
  const more = await get(`/api/v1/sessions/claude%3Aclaude-1/events?offset=${events.body.nextCursor}&limit=100`);
  const all = [...events.body.items, ...more.body.items];
  assert.ok(all.some(event => event.type === "tool/call" && event.data.callId === "cl-call"));
  assert.ok(all.some(event => event.type === "tool/result" && event.data.message.toolCallId === "cl-call"));
});

test("tags index sessions and apply AND scopes to lists, activity and validation", async () => {
  const tags = await get("/api/v1/tags?range=all");
  assert.ok(tags.body.tags.some(tag => tag.id === "source:claude" && tag.count === 1));
  assert.ok(tags.body.tags.some(tag => tag.id === "workspace:/w/shared" && tag.count === 1));
  const scoped = await get("/api/v1/sessions?range=all&tag=source%3Aclaude&tag=workspace%3A%2Fw%2Fclaude");
  assert.deepEqual(scoped.body.records.map(record => record.id), ["claude:claude-1"]);
  assert.deepEqual(scoped.body.tags, ["source:claude", "workspace:/w/claude"]);
  const mismatch = await get("/api/v1/sessions?range=all&tag=source%3Acodex&tag=workspace%3A%2Fw%2Fclaude");
  assert.equal(mismatch.body.records.length, 0);
  const activity = await get("/api/v1/activity?days=7&tag=source%3Aclaude");
  assert.equal(activity.body.total, 1);
  const badSource = await get("/api/v1/sessions?range=all&sources=unknown");
  assert.equal(badSource.response.status, 400);
  const badTag = await get("/api/v1/sessions?range=all&tag=unknown%3Ax");
  assert.equal(badTag.response.status, 400);
});

test("the existing Focusing preview, review, export and digest APIs work standalone", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://model.test/")) {
      const requestBody = JSON.parse(init.body);
      const digest = requestBody.messages?.[0]?.content?.includes("JSON") && !requestBody.messages?.[0]?.content?.includes("VERDICT");
      return { ok: true, json: async () => ({ choices: [{ message: { content: digest ? '{"title":"Standalone digest","summary":"done","projects":[]}' : "VERDICT: NORMAL" }, finish_reason: "stop" }] }) };
    }
    return realFetch(url, init);
  };
  try {
    const saved = await request("/api/dsh-focusing.settings", { method: "POST", body: JSON.stringify({ settings: {
      source: "external", endpoint: "https://model.test/v1/chat/completions", externalModel: "m", apiKey: "secret",
    } }) });
    assert.equal(saved.body.ok, true);
    const preview = await get("/api/dsh-focusing.preview?session=claude%3Aclaude-1");
    assert.equal(preview.body.ok, true);
    assert.match(preview.body.user, /standalone claude task/);

    const analyzed = await request("/api/dsh-focusing.analyze", { method: "POST", body: JSON.stringify({ session: "claude:claude-1" }) });
    assert.equal(analyzed.body.ok, true, JSON.stringify(analyzed.body));
    assert.equal(analyzed.body.review.stuck, false);
    const state = await get("/api/dsh-focusing.state?session=claude%3Aclaude-1");
    assert.equal(state.body.review.stuck, false);
    assert.equal(state.body.sessions.find(row => row.id === "claude:claude-1").reviewed, true);

    const markdown = await get("/api/dsh-focusing.export?session=claude%3Aclaude-1&format=md");
    assert.equal(markdown.response.status, 200);
    assert.match(markdown.body, /Claude standalone/);
    const exported = await get("/api/dsh-focusing.export?session=claude%3Aclaude-1&format=json");
    assert.equal(exported.body.session, "claude:claude-1");

    const started = await request("/api/dsh-focusing.digest", { method: "POST", body: JSON.stringify({ request: "today", offset: 0, tags: ["source:claude"] }) });
    let digest;
    for (let i = 0; i < 100; i += 1) {
      digest = (await get(`/api/dsh-focusing.digest?id=${started.body.digest.id}`)).body.digest;
      if (digest.status !== "running") break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(digest.status, "done");
    assert.equal(digest.stats.sessions, 1);
    assert.equal(digest.result.title, "Standalone digest");
    assert.deepEqual(digest.tags, ["source:claude"]);
  } finally { globalThis.fetch = realFetch; }
});

test("shared Workbench routes honor tags and bound buffered requests", async () => {
  const records = await get("/api/dsh-focusing.records?range=all&tag=source%3Aclaude&tag=workspace%3A%2Fw%2Fclaude");
  assert.deepEqual(records.body.records.map(row => row.id), ["claude:claude-1"]);
  const denied = await get("/api/dsh-focusing.records/detail?id=codex%3Acodex-1&range=all&tag=source%3Aclaude");
  assert.equal(denied.body.reason, "no-session");
  const calendar = await get("/api/dsh-focusing.activity?days=7&external=1&tag=source%3Aclaude");
  assert.equal(calendar.body.total, 1);
  const oversized = await request("/api/dsh-focusing.digest", { method: "POST", body: JSON.stringify({ request: "x".repeat(70000) }) });
  assert.equal(oversized.response.status, 413);
});

test("standalone connection tests report failure and retain unrelated settings", async () => {
  const previous = (await get("/api/dsh-focusing.settings")).body.settings;
  const saved = await request("/api/dsh-focusing.settings", { method: "POST", body: JSON.stringify({ settings: { endpoint: "invalid", persona: "keep this reviewer" }, test: true }) });
  assert.equal(saved.body.test.ok, false);
  assert.equal(saved.body.reverted, true);
  assert.equal(saved.body.settings.endpoint, previous.endpoint);
  assert.equal(saved.body.settings.persona, "keep this reviewer");
  assert.equal(saved.body.settings.apiKey, undefined);
});

test("activity separates both sources and exclusion does not include imported turns", async () => {
  const included = await get("/api/v1/activity?days=7&offset=0&external=1");
  assert.equal(included.body.total, 2);
  const active = included.body.days.find(day => day.turns > 0);
  assert.equal(active.bySource.codex, 1);
  assert.equal(active.bySource.claude, 1);
  const excluded = await get("/api/v1/activity?days=7&offset=0&external=0");
  assert.equal(excluded.body.total, 0);
  assert.equal(excluded.body.externalEnabled, true);
  assert.equal(excluded.body.externalPending, 0);
});

test("a broken optional source does not hide healthy sessions", async () => {
  await running.close();
  running = await startStandaloneServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "isolated-data"), claudeHome });
  await postSettings({
    codexEnabled: true, codexPathMode: "manual", codexPath: join(root, "missing-codex"),
    claudeEnabled: true,
  });
  let listed;
  for (let i = 0; i < 100; i += 1) {
    listed = await get("/api/v1/sessions?range=all");
    if (listed.body.records.length) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.deepEqual(listed.body.records.map(record => record.id), ["claude:claude-1"]);
  assert.ok(listed.body.errors.some(error => error.includes("codex")));
  await running.close();
  await start();
});

test("cross-origin writes are rejected and settings survive an independent restart", async () => {
  const rebinding = await fetch(`${running.origin}/api/v1/health`, {
    headers: { host: `evil.example:${running.port}`, origin: `http://evil.example:${running.port}` },
  });
  assert.equal(rebinding.status, 403, "matching malicious Host and Origin cannot bypass the loopback allowlist");
  const crossSiteRead = await fetch(`${running.origin}/api/v1/sessions?range=all`, { headers: { "sec-fetch-site": "cross-site" } });
  assert.equal(crossSiteRead.status, 403);

  const rejected = await fetch(`${running.origin}/api/v1/settings`, {
    method: "POST",
    headers: { origin: "https://evil.example", "content-type": "application/json" },
    body: JSON.stringify({ settings: { claudeEnabled: false } }),
  });
  assert.equal(rejected.status, 403);
  assert.equal((await get("/api/v1/settings")).body.settings.claudeEnabled, true);

  await running.close();
  await start();
  const restored = await get("/api/v1/settings");
  assert.equal(restored.body.settings.codexEnabled, true);
  assert.equal(restored.body.settings.claudeEnabled, true);
  const rows = await get("/api/v1/sessions?range=all&sources=codex,claude");
  assert.equal(rows.body.records.length, 2, "durable indexes are reusable after restart");
});
