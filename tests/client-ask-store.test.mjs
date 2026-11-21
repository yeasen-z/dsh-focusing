// Conversations are kept on the Host; the page's store is only a view of them.
// The Workbench component unmounts when another sidebar entry is shown, so the
// store must keep polling a running turn and still hold it on return. Sending
// continues the active conversation; "new chat" makes the next send start afresh.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SOURCE = fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

function load(host) {
  let captured;
  globalThis.window = { __ModuleLoader__: { load: d => { captured = d; } } };
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(url, "http://x");
    assert.equal(u.pathname, "/api/dsh-focusing.native-ask");
    const method = options.method ?? "GET";
    const body = options.body ? JSON.parse(options.body) : {};
    calls.push({ method, search: u.search, body });
    return { ok: true, json: async () => host(u, method, body) };
  };
  new Function(SOURCE)();
  const React = { createElement: () => null, Fragment: "F", useEffect: () => {}, useRef: v => ({ current: v }), useCallback: f => f, useState: i => [i, () => {}] };
  const mod = captured.factory(() => React);
  let Workbench;
  mod.apply({ locale: { bind: () => k => k, register: () => () => {}, subscribe: () => () => {} }, effect: f => f(), get: () => undefined, slots: { inject: (n, f) => f(), register: (o, c) => { if (o.name === "focusing.panel.body") Workbench = c; return () => {}; } } });
  return { store: Workbench.askStore, calls };
}

// A tiny stand-in Host that keeps conversations like the real route does.
const user = text => ({ role: "user", content: [{ type: "text", text }] });
function fakeHost(initial = []) {
  const asks = new Map(initial.map(a => [a.id, a]));
  const host = (u, method, body) => {
    const id = u.searchParams.get("id");
    if (method === "POST") {
      if (body.action === "stop") {
        const a = asks.get(body.id);
        if (a && ["queued", "running"].includes(a.status)) a.status = "cancelled";
        return { ok: !!a };
      }
      if (body.action === "delete") return { ok: asks.delete(body.id) };
      if (body.action === "archive") {
        const a = asks.get(body.id);
        if (a?.native) a.archived = true;
        return { ok: !!a?.archived, ask: a };
      }
      let a = body.id ? asks.get(body.id) : undefined;
      if (body.id && !a) return { ok: false, reason: "not-found" };
      if (a?.readOnly) return { ok: false, reason: "read-only" };
      if (a && ((body.range && body.range !== a.range) || (body.tags && String(body.tags) !== String(a.tags)))) return { ok: false, reason: "scope-fixed" };
      if (!a) {
        a = { native: true, id: `ask-${asks.size + 1}`, title: body.question, range: body.range, tags: body.tags, messages: [], createdAt: Date.now() };
        asks.set(a.id, a);
      }
      a.messages = [...a.messages, user(body.question)];
      a.status = "queued"; a.updatedAt = Date.now();
      return { ok: true, ask: { ...a } };
    }
    if (id) { const a = asks.get(id); return a ? { ok: true, ask: { ...a } } : { ok: false, reason: "not-found" }; }
    return { ok: true, asks: [...asks.values()].map(a => ({ ...a })).sort((x, y) => (y.updatedAt ?? y.createdAt) - (x.updatedAt ?? x.createdAt)) };
  };
  return { asks, host };
}

test("past conversations come back from the Host when the page opens", async () => {
  const { host } = fakeHost([
    { id: "a", title: "上周做了什么", status: "idle", messages: [user("上周做了什么")], steps: [], createdAt: 2 },
    { id: "b", title: "更早的问题", status: "idle", messages: [user("更早的问题")], steps: [], createdAt: 1 },
  ]);
  const { store } = load(host);
  const leave = store.subscribe(() => {});
  await tick(30);
  assert.deepEqual(store.get().map(a => a.id), ["a", "b"], "latest first, with their messages");
  assert.equal(store.get()[0].messages.length, 1);
  assert.equal(store.active(), undefined, "nothing is open until one is picked or asked");
  leave();
});

test("the next question continues the open conversation; new chat starts another", async () => {
  const { asks, host } = fakeHost();
  const { store, calls } = load(host);
  await store.reload();
  store.setTags(["project:app"]);
  await store.send("第一个问题");
  assert.equal(store.activeId(), "ask-1", "the new conversation becomes the open one");
  const posts = () => calls.filter(call => call.method === "POST").map(call => call.body);
  const time = { offset: -new Date().getTimezoneOffset(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  assert.deepEqual(posts()[0], { question: "第一个问题", range: "last-30d", tags: ["project:app"], ...time });

  asks.get("ask-1").status = "idle";
  await store.reload();
  store.setRange("all");
  store.setTags([]);
  assert.equal(store.range(), "last-30d");
  assert.deepEqual(store.tags(), ["project:app"]);
  assert.equal(await store.send("追问"), true);
  assert.deepEqual(posts()[1], { question: "追问", id: "ask-1", ...time });
  assert.equal(asks.size, 1, "a follow-up joins the same conversation");
  assert.equal(asks.get("ask-1").messages.length, 2);

  store.newChat();
  assert.equal(store.active(), undefined, "nothing is open");
  store.setRange("all");
  store.setTags([]);
  assert.equal(await store.send("换个话题"), true);
  assert.deepEqual(posts()[2], { question: "换个话题", range: "all", tags: [], ...time });
  assert.equal(asks.size, 2, "now it is a second conversation");
  assert.equal(store.activeId(), "ask-2");

  store.pick("ask-1");
  assert.equal(store.active().title, "第一个问题", "switching back shows the first thread");
  assert.equal(store.range(), "last-30d");
  await store.stop("ask-1");
  await store.stop("ask-2");
});

test("a running turn keeps being polled after every subscriber has left", async () => {
  const { asks, host } = fakeHost();
  const { store, calls } = load(host);
  const leave = store.subscribe(() => {});
  await tick(10);
  await store.send("上周做了什么");
  assert.equal(store.get()[0].status, "queued");

  leave();                                              // the Workbench unmounted
  const toolCall = { type: "tool-call", id: "call-1", name: "focus_list_sessions", arguments: {} };
  asks.get("ask-1").status = "running";
  asks.get("ask-1").messages = [user("上周做了什么"), { role: "assistant", content: [toolCall] }];
  await tick(1100);
  assert.equal(store.get()[0].status, "running");
  assert.deepEqual(store.get()[0].messages[1].content, [toolCall], "native tool messages were recorded while away");
  assert.ok(calls.some(call => call.method === "GET" && call.search === "?id=ask-1"));

  Object.assign(asks.get("ask-1"), { status: "idle", messages: [user("上周做了什么"), { role: "assistant", content: [{ type: "text", text: "做了登录修复。" }] }] });
  await tick(1100);
  assert.equal(store.get()[0].messages.length, 2, "the answer is there when the page comes back");
  const after = calls.length;
  await tick(1100);
  assert.equal(calls.length, after, "polling stops once nothing is running");
});

test("stop keeps the conversation; native archive hides it after Host success", async () => {
  const { asks, host } = fakeHost();
  const { store, calls } = load(host);
  await store.send("q");
  await Promise.all([store.stop("ask-1"), store.stop("ask-1")]);
  assert.equal(store.get()[0].status, "cancelled", "still listed after stopping");
  assert.ok(asks.has("ask-1"), "still on the Host");

  await store.remove("ask-1");
  assert.equal(store.get().length, 0);
  assert.equal(store.active(), undefined, "the open one is closed with it");
  assert.equal(asks.get("ask-1").archived, true);
  assert.deepEqual(calls.filter(call => call.body.action).map(call => call.body.action), ["stop", "archive"]);
  await store.reload();
  assert.equal(store.get().length, 0, "an archived conversation stays off the list");
});

test("a legacy chat can be read or deleted without submitting a continuation", async () => {
  const legacy = { id: "old", title: "Past question", status: "idle", readOnly: true, messages: [user("Past question")] };
  const { asks, host } = fakeHost([legacy]);
  const { store, calls } = load(host);
  await store.reload();
  store.pick("old");
  assert.equal(store.active().messages[0].content[0].text, "Past question");
  assert.equal(await store.send("follow-up"), false);
  assert.ok(calls.every(call => call.method === "GET"));
  await store.remove("old");
  assert.deepEqual(calls.at(-1).body, { action: "delete", id: "old" });
  assert.equal(asks.has("old"), false);
});

test("overlapping submissions send only once and do not switch away from a newly selected chat", async () => {
  const { host } = fakeHost();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { store, calls } = load(async (u, method, body) => {
    if (body.question) await gate;
    return host(u, method, body);
  });
  const first = store.send("q");
  assert.equal(await store.send("q"), false);
  store.newChat();
  release();
  assert.equal(await first, true);
  assert.equal(store.active(), undefined);
  assert.equal(calls.filter(call => call.body.question).length, 1);
  await store.stop("ask-1");
});

test("a question the Host refuses is shown as failed, stays open, and keeps the typed text", async () => {
  const { store } = load(() => ({ ok: false, reason: "busy" }));
  const leave = store.subscribe(() => {});
  await tick(10);
  const sent = await store.send("q");
  assert.equal(sent, false, "the caller learns the send did not happen");
  assert.equal(store.get()[0].status, "failed");
  assert.equal(store.get()[0].detail, "busy");
  assert.equal(store.get()[0].messages[0].content[0].text, "q", "what was typed is still shown");
  assert.equal(store.active()?.id, store.get()[0].id, "a refused turn stays on screen instead of a blank new chat");
  leave();
});
