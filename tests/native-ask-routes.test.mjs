import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerNativeAskRoutes, ROUTE_NATIVE_ASK } from "../lib/native-ask-routes.mjs";

const dir = realpathSync(mkdtempSync(join(tmpdir(), "focusing-native-ask-")));
after(() => rmSync(dir, { recursive: true, force: true }));
const text = value => ({ type: "text", text: value });

function setup({ legacy = [], owned = [], onPrompt, onArchive, onRead } = {}) {
  const metadata = join(mkdtempSync(join(dir, "test-")), "sessions.json");
  const legacyFile = `${metadata}.legacy.json`;
  if (legacy.length) writeFileSync(legacyFile, JSON.stringify({ version: 1, asks: legacy }));
  if (owned.length) writeFileSync(metadata, JSON.stringify({ version: 1, sessions: owned }));
  const events = new Map(owned.map(entry => [entry.sessionId, []]));
  const states = new Map();
  const prompts = [];
  const cancellations = [];
  const archiveCalls = [];
  const prepared = [];
  const archived = new Set();
  let count = 0;
  function append(sessionId, type, data) {
    const log = events.get(sessionId);
    log.push({ type, data, seq: log.length, time: Date.now() });
  }
  function answer(request) {
    const { sessionId, requestId } = request;
    const turn = prompts.filter(item => item.sessionId === sessionId).length;
    append(sessionId, "turn/start", { turn });
    append(sessionId, "user/message", { role: "user", source: { kind: "user", rpcId: requestId }, content: request.content });
    for (const kind of ["runtime-context", "skill-catalog", "time-context"]) {
      append(sessionId, "user/message", { role: "user", source: { kind }, content: [text(kind)] });
    }
    append(sessionId, "assistant/message", { turn, step: 1, message: { content: [text("answer")] } });
    append(sessionId, "turn/end", { turn, reason: { kind: "completed" } });
  }
  const controller = {
    create: async () => {
      const sessionId = `s${++count}`;
      events.set(sessionId, []);
      return { sessionId };
    },
    resolveAgent: async sessionId => ({ agent: { id: sessionId, ctx: {} } }),
    async prompt(request, signal) {
      signal.throwIfAborted();
      prompts.push(request);
      if (onPrompt) await onPrompt(request, { append, answer, states });
      else answer(request);
      return { accepted: true };
    },
    async state({ sessionId }, signal) {
      signal.throwIfAborted();
      return { cursor: events.get(sessionId).length - 1, active: true, running: false, queue: [], ...states.get(sessionId) };
    },
    cancel(request) {
      cancellations.push(request);
      if (states.get(request.sessionId)?.active === false) throw Object.assign(new Error("detached"), { code: "session/not-found" });
      states.delete(request.sessionId);
      append(request.sessionId, "turn/end", { reason: { kind: "aborted" } });
      return { accepted: true };
    },
  };
  const services = {
    sessionController: controller,
    sessionQuery: { async readSession(sessionId) {
      await onRead?.(sessionId);
      return { events: [...events.get(sessionId)] };
    } },
    workspaceRegistry: {
      get archivedSessionIds() { return [...archived]; },
      async archiveSession(sessionId, options) {
        archiveCalls.push({ sessionId, options });
        await onArchive?.(sessionId);
        archived.add(sessionId);
      },
      async unarchiveSession(sessionId) { archived.delete(sessionId); },
    },
  };
  let route;
  const child = {
    get: name => services[name], effect: fn => fn(),
    connection: { fetch: { register: value => { route = value; return () => {}; } } },
  };
  function mount() {
    return registerNativeAskRoutes(child, {
      file: metadata, legacyFile, setupAgent: async (_ctx, agent, entry) => prepared.push({ id: agent.id, scope: entry.scope }),
    }).store;
  }
  const store = mount();
  const request = async (search = "", init) => {
    const response = await route.fetch(new Request(`http://x${ROUTE_NATIVE_ASK}${search}`, init));
    return { status: response.status, ...await response.json() };
  };
  const post = body => request("", { method: "POST", body: JSON.stringify(body) });
  const get = id => request(id ? `?id=${encodeURIComponent(id)}` : "");
  return { get, post, prompts, cancellations, archiveCalls, prepared, events, states, append, answer, route, archived, metadata, store, mount };
}

function barrier() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}

test("registers a buffered GET and POST route", () => {
  const { route } = setup();
  assert.equal(route.path, ROUTE_NATIVE_ASK);
  assert.deepEqual(route.methods, ["GET", "POST"]);
  assert.equal(route.requestBody, "buffered");
});

test("native questions and follow-ups keep a single session and persist only fixed ownership metadata", async () => {
  const h = setup();
  const tags = ["source:dsh", "workspace:/work/project"];
  const first = await h.post({ question: "上周做了什么", range: "last-7d", offset: 480, tags, timeZone: "Asia/Shanghai" });
  assert.equal(first.ok, true);
  assert.equal(first.ask.native, true);
  assert.equal(first.ask.sessionId, "s1");
  assert.equal(first.ask.status, "idle");
  assert.equal(h.prompts[0].clientTimeZone, "Asia/Shanghai");
  const next = await h.post({ id: first.ask.id, question: "and tests?", offset: 0, tags: ["workspace:/work/project/", "source:dsh"] });
  assert.deepEqual(h.prompts.map(request => request.sessionId), ["s1", "s1"]);
  assert.deepEqual(next.ask.tags, tags);
  assert.deepEqual(next.ask.window, first.ask.window);
  assert.deepEqual(h.prepared[0].scope, h.prepared[1].scope);
  assert.deepEqual(next.ask.messages.map(message => message.content[0].text), ["上周做了什么", "answer", "and tests?", "answer"]);
  const { sessions } = JSON.parse(readFileSync(h.metadata, "utf8"));
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].messages, undefined);
  assert.equal(sessions[0].scope.offsetMinutes, 480);
});

test("rejects explicit scope changes and validates new scope before creating native sessions", async () => {
  const h = setup();
  assert.equal((await h.post({ question: "invalid", range: "unknown" })).status, 400);
  assert.equal((await h.post({ question: "invalid", tags: ["outside"] })).status, 400);
  assert.equal((await h.post({ question: "invalid", offset: "garbage" })).status, 400);
  assert.equal(h.events.size, 0);
  const { ask } = await h.post({ question: "first", range: "all", tags: ["workspace:/work"] });
  for (const scope of [{ range: "last-7d" }, { tags: [] }, { tags: ["workspace:/other"] }]) {
    const response = await h.post({ id: ask.id, question: "narrow", ...scope });
    assert.equal(response.reason, "scope-mismatch");
    assert.equal(response.status, 409);
  }
  assert.equal(h.prompts.length, 1);
});

test("folds durable native messages and tool results without repeating assistant tool blocks", async () => {
  const h = setup({ onPrompt(request, { append }) {
    const { sessionId, requestId } = request;
    const first = { type: "tool-call", id: "c1", name: "focus_list_sessions", arguments: '{"query":"test"}' };
    append(sessionId, "turn/start", { turn: 1 });
    append(sessionId, "user/message", { role: "user", source: { kind: "user", rpcId: requestId }, content: request.content });
    append(sessionId, "user/message", { role: "user", source: { kind: "skill-catalog" }, content: [text("hidden")] });
    append(sessionId, "assistant/message", { turn: 1, step: 1, message: { content: [{ type: "reasoning", text: "hidden" }, text("I will check."), first] } });
    append(sessionId, "tool/call", { turn: 1, step: 1, callId: first.id, name: first.name, arguments: first.arguments });
    append(sessionId, "tool/result", { turn: 1, step: 1, message: { toolCallId: "c1", content: [text('{"total":1}')] } });
    append(sessionId, "tool/call", { turn: 1, step: 2, callId: "c2", name: "focus_read_session", arguments: "{}" });
    append(sessionId, "tool/result", { turn: 1, step: 2, message: { source: { callId: "c2" }, content: [text("No output")] }, error: { code: "tool-error" } });
    append(sessionId, "assistant/message", { turn: 1, step: 3, message: { content: [text("actual answer")] } });
    append(sessionId, "turn/end", { turn: 1, reason: { kind: "completed" } });
  } });
  const { ask } = await h.post({ question: "actual question" });
  h.states.set(ask.sessionId, { active: false, queue: null });
  assert.deepEqual((await h.get(ask.id)).ask.messages, [
    { role: "user", content: [text("actual question")] },
    { role: "assistant", content: [text("I will check."), { type: "tool-call", id: "c1", name: "focus_list_sessions", arguments: '{"query":"test"}' }] },
    { role: "tool", toolCallId: "c1", content: [text('{"total":1}')] },
    { role: "assistant", content: [{ type: "tool-call", id: "c2", name: "focus_read_session", arguments: "{}" }] },
    { role: "tool", toolCallId: "c2", content: [text("No output")], isError: true },
    { role: "assistant", content: [text("actual answer")] },
  ]);
  assert.equal(h.prepared.length, 1, "reading a cold session does not resolve an Agent");
});

test("polling survives a prompt acknowledgement before the native state and history include it", async () => {
  const h = setup({ onPrompt() {} });
  const { ask } = await h.post({ question: "queued question" });
  assert.equal(ask.status, "running");
  assert.deepEqual(ask.messages, []);
  assert.equal((await h.get(ask.id)).ask.status, "running");
  const input = h.prompts[0];
  h.append(ask.sessionId, "agent/inbox/spliced", {
    inserted: [{ source: { kind: "user", rpcId: input.requestId }, content: input.content }],
  });
  h.states.set(ask.sessionId, { cursor: -1 });
  assert.equal((await h.get(ask.id)).ask.status, "running", "history can contain the receipt before the state snapshot does");
  h.states.set(ask.sessionId, { queue: [{ placement: "queued", rpcId: input.requestId }] });
  assert.equal((await h.get(ask.id)).ask.status, "running");
  h.states.set(ask.sessionId, { running: true });
  assert.equal((await h.get(ask.id)).ask.status, "running");
  h.answer(input);
  h.states.delete(ask.sessionId);
  const done = await h.get(ask.id);
  assert.equal(done.ask.status, "idle");
  assert.deepEqual(done.ask.messages.map(message => message.content[0].text), ["queued question", "answer"]);
});

test("an unavailable log read after acknowledgement still returns the new native conversation to poll", async () => {
  let available = false;
  const h = setup({ onRead() { if (!available) throw new Error("try later"); } });
  const created = await h.post({ question: "admitted" });
  assert.equal(created.ok, true);
  assert.equal(created.ask.status, "running");
  assert.equal((await h.get(created.ask.id)).status, 500);
  available = true;
  assert.equal((await h.get(created.ask.id)).ask.messages[0].content[0].text, "admitted");
  assert.equal(h.prompts.length, 1);
});

test("stopping targets the live turn, and an already-detached session stays readable", async () => {
  const h = setup();
  const { ask } = await h.post({ question: "q" });
  const { sessionId } = ask;
  h.append(sessionId, "turn/start", { turn: 2 });
  h.states.set(sessionId, { running: true });
  const stopped = await h.post({ action: "stop", id: ask.id });
  assert.deepEqual(h.cancellations, [{ sessionId }]);
  assert.equal(stopped.ask.status, "cancelled");
  h.states.set(sessionId, { active: false, queue: null });
  assert.equal((await h.post({ action: "stop", id: ask.id })).ok, true);
  assert.equal((await h.get(ask.id)).ask.status, "cancelled");
  h.append(sessionId, "turn/start", { turn: 3 });
  assert.equal((await h.get(ask.id)).ask.status, "interrupted");
  h.append(sessionId, "turn/end", { turn: 3, reason: { kind: "error", error: { message: "provider error" } } });
  const failed = (await h.get(ask.id)).ask;
  assert.equal(failed.status, "failed");
  assert.equal(failed.detail, "provider error");
});

test("legacy asks are readable, cannot be continued or stopped, and still support delete", async () => {
  const h = setup({ legacy: [{ id: "old", title: "old", status: "running", messages: [], createdAt: 1 }] });
  const [list, detail] = await Promise.all([h.get(), h.get("old")]);
  assert.equal(list.asks[0].readOnly, true);
  assert.equal(detail.ask.legacy, true);
  assert.equal(detail.ask.status, "interrupted");
  assert.equal((await h.post({ id: "old", question: "continue" })).reason, "read-only");
  assert.equal((await h.post({ id: "old", action: "stop" })).reason, "read-only");
  assert.equal((await h.post({ id: "missing", question: "continue" })).status, 404);
  assert.equal((await h.post({ id: "old", action: "delete" })).ok, true);
  assert.equal((await h.get("old")).status, 404);
});

test("native archive and delete both hide the entry while retaining its authority and scope across reload", async () => {
  const h = setup();
  const { ask } = await h.post({ question: "找个结论" });
  for (const action of ["archive", "delete"]) {
    assert.equal((await h.post({ action, id: ask.id })).ok, true);
    assert.deepEqual(h.archiveCalls.at(-1), { sessionId: ask.sessionId, options: { stopActivity: true } });
    const reloaded = h.mount();
    assert.equal((await reloaded.get(ask.sessionId)).archived, true);
    assert.deepEqual((await h.get()).asks, []);
    assert.equal((await h.get(ask.id)).ask.readOnly, true);
    assert.equal((await h.post({ id: ask.id, question: "continue" })).reason, "read-only");
    assert.equal((await h.post({ action: "unarchive", id: ask.id })).ask.archived, false);
  }
});

test("restoring in the DSH workspace also restores the Ask entry", async () => {
  const h = setup();
  const { ask } = await h.post({ question: "retain ownership", range: "all" });
  assert.ok((await h.post({ action: "archive", id: ask.id })).ok);
  h.archived.delete(ask.sessionId);
  const restored = (await h.get()).asks[0];
  assert.equal(restored.id, ask.id);
  assert.equal(restored.range, "all");
  assert.equal(restored.readOnly, false);
});

test("archive failures leave the conversation visible and retryable", async () => {
  let shouldFail = true;
  const h = setup({ onArchive() { if (shouldFail) throw new Error("registry write failed"); } });
  const { ask } = await h.post({ question: "still here" });
  for (const action of ["delete", "archive"]) {
    const failed = await h.post({ action, id: ask.id });
    assert.equal(failed.status, 500);
    assert.equal((await h.get()).asks[0].id, ask.id);
  }
  shouldFail = false;
  assert.equal((await h.post({ action: "delete", id: ask.id })).ok, true);
  assert.deepEqual((await h.get()).asks, []);
});

test("Host archival remains effective when the metadata write needs a retry", async () => {
  const h = setup();
  const { ask } = await h.post({ question: "archive durably" });
  const blocked = `${h.metadata}.tmp`;
  mkdirSync(blocked);
  assert.equal((await h.post({ action: "archive", id: ask.id })).status, 500);
  assert.equal(h.archived.has(ask.sessionId), true);
  assert.equal((await h.store.get(ask.id)).archived, undefined);
  assert.deepEqual((await h.get()).asks, []);
  assert.equal((await h.post({ id: ask.id, question: "cannot continue" })).reason, "read-only");
  rmSync(blocked, { recursive: true });
  assert.equal((await h.post({ action: "archive", id: ask.id })).ok, true);
  assert.equal((await h.mount().get(ask.id)).archived, true);
});

test("concurrent first requests preserve all previously owned and newly created sessions", async () => {
  const owned = Array.from({ length: 301 }, (_, n) => ({ id: `focus-old-${n}`, sessionId: `old-${n}`, createdAt: n }));
  const h = setup({ owned });
  const created = await Promise.all(Array.from({ length: 5 }, (_, n) => h.post({ question: `q ${n}` })));
  assert.equal(new Set(created.map(response => response.ask.sessionId)).size, 5);
  const reloaded = h.mount();
  assert.equal((await reloaded.list()).length, 306);
  assert.equal((await reloaded.get("old-0")).id, "focus-old-0");
});

test("metadata write failures never admit an unowned prompt and can be retried", async () => {
  const h = setup();
  const blocked = `${h.metadata}.tmp`;
  mkdirSync(blocked);
  assert.equal((await h.post({ question: "not admitted" })).status, 500);
  assert.equal(h.prompts.length, 0);
  assert.deepEqual([...h.archived], ["s1"]);
  assert.deepEqual(await h.store.list(), []);
  rmSync(blocked, { recursive: true });
  assert.equal((await h.post({ question: "retry" })).ok, true);
});

test("serializes prompt and archive across either ID spelling", async () => {
  const started = barrier();
  const resume = barrier();
  const h = setup({ async onPrompt(request, { answer }) {
    if (request.content[0].text === "pending") {
      started.release();
      await resume.promise;
    }
    answer(request);
  } });
  const { ask } = await h.post({ question: "first" });
  const followUp = h.post({ id: ask.id, question: "pending" });
  await started.promise;
  const archived = h.post({ id: ask.sessionId, action: "archive" });
  resume.release();
  assert.equal((await followUp).ok, true);
  assert.equal((await archived).ask.archived, true);
  assert.equal((await h.post({ id: ask.id, question: "third" })).reason, "read-only");
  assert.equal((await h.store.get(ask.id)).archived, true);
  assert.equal(h.prompts.length, 2);
});
