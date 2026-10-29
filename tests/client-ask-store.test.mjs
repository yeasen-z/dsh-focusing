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
    calls.push(`${options.method ?? "GET"} ${u.search || ""}`.trim());
    const body = options.body ? JSON.parse(options.body) : {};
    return { ok: true, json: async () => host(u, options.method ?? "GET", body) };
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
      if (body.action === "stop") { const a = asks.get(body.id); if (a?.status === "running") a.status = "cancelled"; return { ok: !!a }; }
      if (body.action === "delete") return { ok: asks.delete(body.id) };
      let a = body.id ? asks.get(body.id) : undefined;
      if (body.id && !a) return { ok: false, reason: "not-found" };
      if (!a) { a = { id: `ask-${asks.size + 1}`, title: body.question, steps: [], messages: [], createdAt: Date.now() }; asks.set(a.id, a); }
      a.messages = [...a.messages, user(body.question)];
      a.status = "running"; a.updatedAt = Date.now();
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
  const { store } = load(host);
  const leave = store.subscribe(() => {});
  await tick(10);
  await store.send("第一个问题");
  assert.equal(store.activeId(), "ask-1", "the new conversation becomes the open one");

  asks.get("ask-1").status = "idle";
  await store.send("追问");
  assert.equal(asks.size, 1, "a follow-up joins the same conversation");
  assert.equal(asks.get("ask-1").messages.length, 2);
  assert.equal(store.get().length, 1);

  store.newChat();
  assert.equal(store.active(), undefined, "nothing is open");
  await store.send("换个话题");
  assert.equal(asks.size, 2, "now it is a second conversation");
  assert.equal(store.activeId(), "ask-2");

  store.pick("ask-1");
  assert.equal(store.active().title, "第一个问题", "switching back shows the first thread");
  leave();
});

test("a running turn keeps being polled after every subscriber has left", async () => {
  const { asks, host } = fakeHost();
  const { store, calls } = load(host);
  const leave = store.subscribe(() => {});
  await tick(10);
  await store.send("上周做了什么");
  assert.equal(store.get()[0].status, "running");

  leave();                                              // the Workbench unmounted
  asks.get("ask-1").steps = [{ kind: "call", name: "focus_list_sessions", status: "done" }];
  await tick(1100);
  assert.equal(store.get()[0].steps.length, 1, "progress was recorded while away");

  Object.assign(asks.get("ask-1"), { status: "idle", messages: [user("上周做了什么"), { role: "assistant", content: [{ type: "text", text: "做了登录修复。" }] }] });
  await tick(1100);
  assert.equal(store.get()[0].messages.length, 2, "the answer is there when the page comes back");
  const after = calls.length;
  await tick(1100);
  assert.equal(calls.length, after, "polling stops once nothing is running");
});

test("stop keeps the conversation; delete removes it here and on the Host", async () => {
  const { asks, host } = fakeHost();
  const { store } = load(host);
  const leave = store.subscribe(() => {});
  await tick(10);
  await store.send("q");
  await store.stop("ask-1");
  await tick(20);
  assert.equal(store.get()[0].status, "cancelled", "still listed after stopping");
  assert.ok(asks.has("ask-1"), "still on the Host");

  await store.remove("ask-1");
  assert.equal(store.get().length, 0);
  assert.equal(store.active(), undefined, "the open one is closed with it");
  assert.equal(asks.size, 0);
  leave();
});

test("a question the Host refuses is shown as failed, and does not become the open conversation", async () => {
  const { store } = load(() => ({ ok: false, reason: "busy" }));
  const leave = store.subscribe(() => {});
  await tick(10);
  await store.send("q");
  assert.equal(store.get()[0].status, "failed");
  assert.equal(store.get()[0].detail, "busy");
  assert.equal(store.get()[0].messages[0].content[0].text, "q", "what was typed is still shown");
  leave();
});
