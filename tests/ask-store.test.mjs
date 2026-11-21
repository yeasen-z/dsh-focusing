import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, realpathSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAskStore, STORED_TEXT_LIMIT } from "../lib/ask-store.mjs";
import { registerContextRoutes } from "../lib/context-routes.mjs";
import { normalizeSettings } from "../lib/settings.mjs";

const dir = realpathSync(mkdtempSync(join(tmpdir(), "focusing-ask-test-")));
after(() => { if (dir.startsWith(realpathSync(tmpdir()))) rmSync(dir, { recursive: true, force: true }); });
const wait = ms => new Promise(r => setTimeout(r, ms));

test("the store keeps conversations across a restart, latest activity first, and removes only on request", async () => {
  const file = join(dir, "a.json");
  const one = createAskStore({ file });
  await one.put({ id: "a", title: "第一个", status: "idle", messages: [], steps: [], createdAt: 1 });
  await one.put({ id: "b", title: "第二个", status: "idle", messages: [], steps: [], createdAt: 2 });
  await one.put({ id: "a", title: "第一个", status: "idle", messages: [{ role: "user", content: [{ type: "text", text: "追问" }] }], steps: [], createdAt: 1 });
  const two = createAskStore({ file });                       // a fresh process
  assert.deepEqual((await two.list()).map(a => a.id), ["a", "b"], "the one just continued moves to the top");
  assert.equal((await two.get("a")).messages.length, 1);
  assert.equal(await two.remove("a"), true);
  assert.deepEqual((await createAskStore({ file }).list()).map(a => a.id), ["b"]);
});

test("huge text is capped on disk, in steps and in messages, and the cap is recorded", async () => {
  const file = join(dir, "big.json");
  const store = createAskStore({ file });
  const big = "x".repeat(STORED_TEXT_LIMIT + 500);
  const saved = await store.put({
    id: "a", title: "q", status: "idle", createdAt: 1,
    steps: [{ kind: "call", result: big }],
    messages: [{ role: "tool", content: [{ type: "text", text: big }] }, { role: "user", content: [{ type: "text", text: "short" }] }],
  });
  assert.equal(saved.steps[0].result.length, STORED_TEXT_LIMIT);
  assert.equal(saved.steps[0].storedTruncated, STORED_TEXT_LIMIT + 500);
  assert.equal(saved.messages[0].content[0].text.length, STORED_TEXT_LIMIT);
  assert.equal(saved.messages[0].storedTruncated, true);
  assert.equal(saved.messages[1].storedTruncated, undefined, "short messages are untouched");
});

// ---- through the route ------------------------------------------------------
function host({ file, turns, events = [] }) {
  const routes = new Map();
  const services = {
    sessions: { list: () => [], get: () => undefined },
    sessionPersistence: { list: async () => events.length ? [{ header: { id: "history", cwd: "/project", createdAt: events[0].time } }] : [] },
    sessionQuery: { readSession: async () => ({ session: {}, events }) },
    agentDefaultModel: { currentSelection: () => ({ provider: "p", model: "m" }) },
    llm: { stream: async function* (req) { sent.push(structuredClone({ ...req, signal: undefined })); const t = turns.shift(); if (typeof t === "function") { yield* t(req); return; } for (const c of t) yield c; } },
  };
  const child = { get: n => services[n], effect: fn => fn(), connection: { fetch: { register: r => { routes.set(r.path, r); return () => {}; } } } };
  const settings = normalizeSettings({});
  registerContextRoutes(child, { settingsStore: { get: () => settings }, digestFile: file });
  const call = async (path, init) => (await routes.get(path.split("?")[0]).fetch(new Request(`http://x${path}`, init))).json();
  const post = body => call("/api/dsh-focusing.ask", { method: "POST", body: JSON.stringify(body) });
  const sent = [];
  const get = id => call(`/api/dsh-focusing.ask${id ? `?id=${id}` : ""}`);
  const settled = async id => { for (let i = 0; i < 100; i++) { const a = (await get(id)).ask; if (a.status !== "running") return a; await wait(10); } throw new Error("never settled"); };
  return { post, get, settled, sent };
}
const answer = text => [{ type: "text-delta", index: 0, text }, { type: "finish", reason: { kind: "stop" } }];
const askTool = (id, name, args) => [
  { type: "block-end", index: 0, block: { type: "tool-call", id, name, arguments: JSON.stringify(args) } },
  { type: "finish", reason: { kind: "tool-calls" } },
];
const checkRecords = id => askTool(id, "focus_list_sessions", {});


test("a finished conversation is on disk and listed after a restart", async () => {
  const file = join(dir, "r.json");
  const first = host({ file, turns: [checkRecords("c1"), answer("没有找到当时的会话。")] });
  const { ask } = await first.post({ question: "上周做了什么" });
  const done = await first.settled(ask.id);
  assert.equal(done.status, "idle");
  assert.ok(existsSync(`${file}.asks.json`), "written next to the digests");
  assert.deepEqual(done.messages.map(m => m.role), ["user", "assistant", "tool", "assistant"]);

  const after = host({ file, turns: [] });                    // restart: new memory, same disk
  const listed = (await after.get()).asks;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].title, "上周做了什么");
  assert.equal(listed[0].messages.at(-1).content[0].text, "没有找到当时的会话。");
});

test("Ask follows a search hit into intact raw pages and retains the evidence after restart", async () => {
  const time = Date.now() - 60000;
  const output = `${'x'.repeat(14000)}\nresolved with the canary rollback`;
  const events = [
    { type: "user/message", time, data: { content: [{ type: "text", text: "Check the rollout" }] } },
    { type: "turn/start", time: time + 1, data: { turn: 1 } },
    { type: "tool/result", time: time + 2, data: { message: { content: [{ type: "text", text: output }] } } },
    { type: "turn/end", time: time + 3, data: { turn: 1 } },
  ];
  const file = join(dir, "evidence.json");
  const fragments = [];
  const getResult = req => {
    const json = req.messages.at(-1).content[0].text;
    assert.ok(json.length <= 12000);
    return JSON.parse(json);
  };
  const readArgs = { sessionId: "history", startEventIndex: 2, limit: 50 };
  const followCursor = async function* (req) {
    const result = getResult(req);
    fragments.push(...result.items.filter(item => item.eventIndex === 2));
    if (result.nextCursor) yield* askTool(`read-${result.pageOffset}`, "focus_read_session", { ...readArgs, cursor: result.nextCursor });
    else {
      assert.deepEqual(JSON.parse(fragments.map(item => item.text).join("")), events[2]);
      yield* answer("The rollout was resolved with the canary rollback.");
    }
  };
  const h = host({ file, events, turns: [
    askTool("search", "focus_list_sessions", { query: "canary rollback" }),
    async function* (req) {
      const [match] = getResult(req).items[0].matches;
      assert.equal(match.eventIndex, readArgs.startEventIndex);
      assert.match(match.text, /canary rollback/);
      yield* askTool("read", "focus_read_session", readArgs);
    },
    followCursor, followCursor, followCursor, followCursor,
  ] });
  const { ask } = await h.post({ question: "How was the canary rollout resolved?", range: "all" });
  const done = await h.settled(ask.id);
  assert.equal(done.status, "idle", done.detail);
  assert.equal(done.rounds.at(-1).coverage, "checked");
  assert.ok(h.sent.length >= 4, "the model received more than one raw page");
  const restored = (await host({ file, turns: [] }).get(ask.id)).ask;
  assert.deepEqual(restored.rounds, done.rounds);
  assert.match(restored.messages.at(-1).content[0].text, /canary rollback/);
});

test("a follow-up joins the same conversation and the model sees the earlier turns", async () => {
  const file = join(dir, "chat.json");
  const h = host({ file, turns: [checkRecords("first"), answer("未发现匹配会话。"), checkRecords("followup"), answer("也无法确认项目。")] });
  const { ask } = await h.post({ question: "上周做了什么" });
  await h.settled(ask.id);
  const second = await h.post({ id: ask.id, question: "具体哪个项目？" });
  assert.equal(second.ask.id, ask.id, "the same conversation, not a new one");
  const done = await h.settled(ask.id);
  assert.deepEqual(done.messages.map(m => m.role), ["user", "assistant", "tool", "assistant", "user", "assistant", "tool", "assistant"]);
  assert.equal(h.sent[2].messages.length, 5, "the follow-up receives the earlier question, evidence and answer");
  assert.equal(h.sent[2].messages[3].content[0].text, "未发现匹配会话。");
  assert.equal((await h.get()).asks.length, 1, "still one conversation");
  assert.equal(done.title, "上周做了什么", "the title stays the first question");
});

test("asking without an id starts a new conversation next to the old one", async () => {
  const file = join(dir, "new.json");
  const h = host({ file, turns: [checkRecords("first"), answer("一"), checkRecords("second"), answer("二")] });
  const a = await h.post({ question: "第一个话题" });
  await h.settled(a.ask.id);
  const b = await h.post({ question: "第二个话题" });
  await h.settled(b.ask.id);
  assert.notEqual(a.ask.id, b.ask.id);
  const listed = (await h.get()).asks;
  assert.deepEqual(listed.map(c => c.title), ["第二个话题", "第一个话题"], "latest first");
  assert.equal(h.sent[2].messages.length, 1, "the new conversation does not inherit the old one");
});

test("continuing a conversation that does not exist is refused, not silently started anew", async () => {
  const h = host({ file: join(dir, "ghost.json"), turns: [] });
  const out = await h.post({ id: "ask-nope", question: "还在吗" });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "not-found");
});

test("the question is on disk before the model is even called", async () => {
  const peek = host({ file: join(dir, "early.json"), turns: [] });
  let onDiskWhenModelCalled;
  const h = host({ file: join(dir, "early2.json"), turns: [async function* () {
    onDiskWhenModelCalled = readFileSync(join(dir, "early2.json.asks.json"), "utf8");
    yield* answer("ok");
  }] });
  void peek;
  const { ask } = await h.post({ question: "别丢了这个问题" });
  await h.settled(ask.id);
  assert.match(onDiskWhenModelCalled, /别丢了这个问题/);
  assert.match(onDiskWhenModelCalled, /"status": "running"/);
});

test("a turn still running at a restart comes back as interrupted, with the thread intact", async () => {
  const file = join(dir, "crash.json");
  const never = host({ file, turns: [async function* () { await new Promise(() => {}); }] });
  const { ask } = await never.post({ question: "跑到一半" });
  await wait(30);
  const after = host({ file, turns: [] });
  const seen = (await after.get(ask.id)).ask;
  assert.equal(seen.status, "interrupted");
  assert.equal(seen.messages[0].content[0].text, "跑到一半");
  assert.match(seen.detail, /restarted/);
  assert.equal((await after.get()).asks[0].status, "interrupted");
});

test("stop keeps the conversation; delete forgets it", async () => {
  const file = join(dir, "stop.json");
  const h = host({ file, turns: [async function* (req) { await new Promise((_, rej) => req.signal?.addEventListener("abort", () => rej(new Error("aborted")))); }] });
  const { ask } = await h.post({ question: "会被停掉" });
  await wait(20);
  assert.equal((await h.post({ action: "stop", id: ask.id })).ok, true);
  const stopped = await h.settled(ask.id);
  assert.equal(stopped.status, "cancelled");
  assert.equal((await h.get()).asks.length, 1, "still listed after stopping");
  assert.equal((await host({ file, turns: [] }).get(ask.id)).ask.status, "cancelled", "and after a restart");

  assert.equal((await h.post({ action: "delete", id: ask.id })).ok, true);
  assert.equal((await h.get()).asks.length, 0);
  assert.equal((await host({ file, turns: [] }).get(ask.id)).reason, "not-found", "gone from disk too");
});

test("a failed turn keeps the conversation and its reason, and a follow-up can retry", async () => {
  const file = join(dir, "fail.json");
  const h = host({ file, turns: [
    [{ type: "finish", reason: { kind: "error", failure: { code: "rate_limit", message: "slow down" } } }],
    checkRecords("retry"), answer("这次查过记录了。"),
  ] });
  const { ask } = await h.post({ question: "会失败" });
  const failed = await h.settled(ask.id);
  assert.equal(failed.status, "failed");
  assert.match(failed.detail, /rate_limit/);
  assert.deepEqual(failed.messages.map(m => m.role), ["user"], "the question stays, nothing half-finished");

  const retry = await h.post({ id: ask.id, question: "再试一次" });
  assert.equal(retry.ok, true);
  const done = await h.settled(ask.id);
  assert.equal(done.status, "idle");
  assert.equal(h.sent[1].messages.length, 1, "the two unanswered questions go out as one user message");
  assert.match(h.sent[1].messages[0].content[0].text, /会失败[\s\S]*再试一次/);
});

test("a turn cut short leaves no tool call without its result in the thread", async () => {
  const file = join(dir, "cut.json");
  const callTurn = [{ type: "block-end", index: 0, block: { type: "tool-call", id: "c1", name: "focus_activity", arguments: "{}" } }, { type: "finish", reason: { kind: "tool-calls" } }];
  const h = host({ file, turns: [callTurn, async function* (req) { await new Promise((_, rej) => req.signal?.addEventListener("abort", () => rej(new Error("aborted")))); }] });
  const { ask } = await h.post({ question: "查一下" });
  await wait(60);
  await h.post({ action: "stop", id: ask.id });
  const stopped = await h.settled(ask.id);
  assert.equal(stopped.status, "cancelled");
  assert.deepEqual(stopped.messages.map(m => m.role), ["user"], "cut back to the question");
});

test("at most 300 conversations are kept; the oldest are pruned", async () => {
  const store = createAskStore({ file: join(dir, "cap.json") });
  for (let i = 0; i < 305; i++) await store.put({ id: `c${i}`, title: `t${i}`, status: "idle", messages: [], steps: [], createdAt: i + 1 });
  const list = await store.list();
  assert.equal(list.length, 300);
  assert.equal(list.some(c => c.title === "t0"), false, "the oldest five are gone");
  assert.equal(list.find(c => c.title === "t304").id, "c304", "the newest is there");
  const disk = JSON.parse(readFileSync(join(dir, "cap.json"), "utf8"));
  assert.equal(disk.asks.length, 300, "and the file holds no more either");
});
