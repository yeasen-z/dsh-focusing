import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerNativeAskRoutes } from "../lib/native-ask-routes.mjs";

const dir = realpathSync(mkdtempSync(join(tmpdir(), "focusing-native-ask-")));
after(() => rmSync(dir, { recursive: true, force: true }));

function setup({ legacy = [] } = {}) {
  const metadata = join(dir, `${Math.random()}.sessions.json`);
  const legacyFile = `${metadata}.legacy.json`;
  if (legacy.length) writeFileSync(legacyFile, JSON.stringify({ version: 1, asks: legacy }));
  const events = new Map();
  const calls = [];
  let count = 0;
  const controller = {
    create: async () => { const sessionId = `s${++count}`; events.set(sessionId, []); return { sessionId }; },
    resolveAgent: async sessionId => ({ agent: { id: sessionId, ctx: {} } }),
    prompt: async request => {
      calls.push(request);
      const log = events.get(request.sessionId);
      const now = Date.now();
      log.push(
        { type: "user/message", time: now, data: { id: "h", role: "user", source: { kind: "user" }, content: request.content } },
        // What DSH adds for the model: never part of the conversation a reader sees.
        { type: "user/message", time: now, data: { id: "r", role: "user", source: { kind: "runtime-context", form: "snapshot" }, content: [{ type: "text", text: "Current runtime context: cwd is /x" }] } },
        { type: "user/message", time: now, data: { id: "s", role: "user", source: { kind: "skill-catalog", form: "catalog" }, content: [{ type: "text", text: "<system-reminder>skills</system-reminder>" }] } },
        { type: "user/message", time: now, data: { id: "t", role: "user", source: { kind: "time-context", form: "snapshot" }, content: [{ type: "text", text: "Time sampled while preparing turn 1" }] } },
        { type: "turn/start", time: now, data: {} },
        { type: "assistant/message", time: now, data: { message: { role: "assistant", source: { kind: "model" }, content: [{ type: "text", text: "answer" }] } } },
      );
    },
    cancel: request => calls.push({ cancel: request }),
    inspect: async sessionId => ({ events: events.get(sessionId) ?? [] }),
  };
  const routes = new Map();
  const archived = new Set();
  const workspaceRegistry = {
    archiveSession: async (sessionId, options) => { archived.add(sessionId); calls.push({ archive: sessionId, options }); },
    unarchiveSession: async sessionId => { archived.delete(sessionId); calls.push({ unarchive: sessionId }); },
  };
  const child = { get: name => name === "sessionController" ? controller : name === "workspaceRegistry" ? workspaceRegistry : undefined, effect: fn => fn(), connection: { fetch: { register: route => { routes.set(route.path, route); return () => {}; } } } };
  const prepared = [];
  registerNativeAskRoutes(child, { file: metadata, legacyFile, setupAgent: async (_ctx, agent) => prepared.push(agent.id) });
  const call = async (path, init) => (await routes.get("/api/dsh-focusing.native-ask").fetch(new Request(`http://x${path}`, init))).json();
  const post = body => call("/api/dsh-focusing.native-ask", { method: "POST", body: JSON.stringify(body) });
  return { call, post, calls, prepared, events, routes, archived };
}

test("the route declares its methods, so the Host routers actually match it", () => {
  // A registered route with no method list is not routed: the panel saw a plain
  // 404 for a path the Host had registered.
  const route = setup().routes.get("/api/dsh-focusing.native-ask");
  assert.ok(route, "the native ask route is registered");
  assert.deepEqual(route.methods, ["GET", "POST"]);
  assert.equal(route.requestBody, "buffered");
});

test("new questions create Focusing-owned native sessions without storing messages", async () => {
  const h = setup();
  const created = await h.post({ question: "上周做了什么", range: "last-7d", offset: 480 });
  assert.equal(created.ok, true);
  assert.equal(created.ask.native, true);
  assert.equal(created.ask.sessionId, "s1");
  assert.deepEqual(h.prepared, ["s1"]);
  assert.equal(h.calls[0].sessionId, "s1");
  assert.equal(created.ask.messages[0].content[0].text, "上周做了什么");
});

test("follow-ups reuse the native DSH session and stop delegates to it", async () => {
  const h = setup();
  const first = await h.post({ question: "q" });
  await h.post({ id: first.ask.id, question: "follow up" });
  assert.equal(h.calls[1].sessionId, "s1");
  const stopped = await h.post({ action: "stop", id: first.ask.id });
  assert.equal(stopped.ok, true);
  assert.deepEqual(h.calls.at(-1).cancel, { sessionId: "s1" });
});

test("legacy asks are listed read-only and cannot be continued", async () => {
  const h = setup({ legacy: [{ id: "old", title: "old", status: "idle", messages: [], steps: [], createdAt: 1 }] });
  const list = await h.call("/api/dsh-focusing.native-ask");
  assert.equal(list.asks[0].readOnly, true);
  const continued = await h.post({ id: "old", question: "continue" });
  assert.equal(continued.ok, false);
  assert.equal(continued.reason, "read-only");
});

test("archive uses the Host archive verb and survives a reload of the list", async () => {
  const h = setup();
  const created = await h.post({ question: "找个结论" });
  const id = created.ask.id;
  const done = await h.post({ action: "archive", id });
  assert.equal(done.ok, true);
  assert.equal(done.ask.archived, true);
  assert.deepEqual([...h.archived], [created.ask.sessionId], "the native session is archived in the Host too");
  assert.equal(h.calls.find(c => c.archive).options.stopActivity, true, "archiving a running turn stops it rather than failing");
  const listed = await h.call("/api/dsh-focusing.native-ask");
  assert.equal(listed.asks.find(a => a.id === id).archived, true, "the state is kept, not just returned once");
  const back = await h.post({ action: "unarchive", id });
  assert.equal(back.ask.archived, false);
  assert.equal(h.archived.size, 0);
});

test("deleting archives the native session first, so no orphan is left in the session list", async () => {
  const h = setup();
  const created = await h.post({ question: "待删的问题" });
  const sessionId = created.ask.sessionId;
  const gone = await h.post({ action: "delete", id: created.ask.id });
  assert.equal(gone.ok, true);
  assert.ok(h.archived.has(sessionId), "the log is archived instead of being orphaned");
  const listed = await h.call("/api/dsh-focusing.native-ask");
  assert.equal(listed.asks.length, 0, "Focusing forgets it");
});

test("only the person's own words are shown; DSH's own context injections are not", async () => {
  const h = setup();
  const created = await h.post({ question: "上周做了什么" });
  const text = created.ask.messages.map(m => m.content.map(b => b.text).join("")).join("|");
  assert.equal(created.ask.messages.length, 2, "one question, one answer");
  assert.equal(created.ask.messages[0].content[0].text, "上周做了什么");
  assert.equal(created.ask.messages[1].content[0].text, "answer");
  assert.ok(!/runtime context/i.test(text), "the runtime-context snapshot stays out of the thread");
  assert.ok(!/system-reminder/.test(text), "the skill catalog stays out of the thread");
  assert.ok(!/Time sampled/.test(text), "the time context stays out of the thread");
});
