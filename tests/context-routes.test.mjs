import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, realpathSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerContextRoutes } from "../lib/context-routes.mjs";
import { normalizeSettings } from "../lib/settings.mjs";

const dir = realpathSync(mkdtempSync(join(tmpdir(), "focusing-ctx-test-")));
after(() => { if (dir.startsWith(realpathSync(tmpdir()))) rmSync(dir, { recursive: true, force: true }); });

const now = Date.now();
// The digest tests ask for "today" in Beijing time (offset 480). A fixture that
// is simply "an hour ago" falls on yesterday whenever the suite runs between
// 00:00 and 01:00 there, which silently empties the range and skips the model.
// Pin it inside today's local range and always in the past.
const BEIJING_OFFSET_MS = 480 * 60e3;
const startOfToday = Math.floor((now + BEIJING_OFFSET_MS) / 864e5) * 864e5 - BEIJING_OFFSET_MS;
const recentAt = Math.max(startOfToday + 1000, Math.min(startOfToday + 12 * 3600e3, now - 60e3));
const ev = (type, time, data) => ({ type, time, data });
const log = (title, at) => [
  ev("user/message", at, { source: { kind: "user" }, content: [{ type: "text", text: `do ${title}` }] }),
  ev("turn/start", at + 1, { turn: 1 }),
  ev("session/title", at + 2, { title }),
  ev("tool/call", at + 3, { turn: 1, callId: "c", name: "edit", arguments: JSON.stringify({ path: "/w/p/a.js" }) }),
  ev("assistant/message", at + 4, { turn: 1, message: { content: [{ type: "text", text: `${title} done` }] } }),
  ev("turn/end", at + 5, { turn: 1, reason: { kind: "completed" } }),
];

function setup(answer) {
  const stored = {
    old: { header: { id: "old", cwd: "/w/p", createdAt: now - 90 * 864e5 }, revision: `1:2:3:${BigInt(now - 90 * 864e5) * 1000000n}:0`, events: log("old work", now - 90 * 864e5) },
    s1: { header: { id: "s1", cwd: "/w/p", createdAt: recentAt }, revision: `1:2:3:${BigInt(now) * 1000000n}:0`, events: log("recent work", recentAt) },
  };
  const reads = [];
  const prompts = [];
  const services = {
    sessions: { list: () => [], get: () => undefined },
    sessionPersistence: { list: async () => Object.values(stored).map(s => ({ header: s.header, revision: s.revision })) },
    sessionQuery: { readSession: async id => { reads.push(id); return { session: stored[id].header, events: [{ type: "session" }, ...stored[id].events].slice(1) }; } },
    agentDefaultModel: { currentSelection: () => ({ provider: "p", model: "m" }) },
    llm: {
      stream: async function* (req) {
        prompts.push(req.messages[0].content[0].text);
        yield { type: "text-delta", text: answer };
        yield { type: "finish", reason: { kind: "stop" } };
      },
    },
  };
  const routes = new Map();
  const child = {
    get: name => services[name],
    effect: fn => fn(),
    connection: { fetch: { register: r => { routes.set(r.path, r); return () => {}; } } },
  };
  const settings = normalizeSettings({});
  registerContextRoutes(child, { settingsStore: { get: () => settings }, digestFile: join(dir, `d-${Math.random()}.json`) });
  const call = async (path, init) => (await routes.get(path.split("?")[0]).fetch(new Request(`http://x${path}`, init))).json();
  const post = (path, body) => call(path, { method: "POST", body: JSON.stringify(body) });
  return { call, post, reads, prompts };
}

async function waitDone(h, id) {
  for (let i = 0; i < 100; i++) {
    const b = await h.call(`/api/dsh-focusing.digest?id=${id}`);
    if (b.digest.status !== "running") return b.digest;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error("digest did not finish");
}

test("records for this week skip old sessions without reading them", async () => {
  const h = setup("{}");
  const body = await h.call("/api/dsh-focusing.records?range=last-7d&offset=480");
  assert.equal(body.ok, true);
  assert.deepEqual(body.records.map(r => r.title), ["recent work"]);
  assert.deepEqual(h.reads, ["s1"], "a 90-day-old file must not be decompressed");
  await h.call("/api/dsh-focusing.records?range=last-7d&offset=480");
  assert.deepEqual(h.reads, ["s1"], "unchanged sessions are served from the fold cache");
});

test("a digest runs in the background, parses the model JSON and is saved", async () => {
  const h = setup('```json\n{"title":"本周整理","summary":"做了 recent work","projects":[{"name":"p","progress":80,"status":"active","items":[{"state":"done","text":"recent work","sessions":["s1"]}]}],"next":["ship"]}\n```');
  const started = await h.post("/api/dsh-focusing.digest", { request: "整理我这周干了什么，进度如何", offset: 480 });
  assert.equal(started.ok, true);
  assert.equal(started.digest.range.key, "this-week");
  assert.equal(started.digest.kind, "weekly");
  const done = await waitDone(h, started.digest.id);
  assert.equal(done.status, "done");
  assert.equal(done.draft, false);
  assert.equal(done.result.title, "本周整理");
  assert.equal(done.stats.sessions, 1);
  assert.match(h.prompts[0], /recent work done/);
  const list = await h.call("/api/dsh-focusing.digests");
  assert.equal(list.digests[0].id, started.digest.id);

  const fu = setup("ignored");
  void fu;
});

test("a model failure still yields a draft and says why", async () => {
  const h = setup("not json at all");
  const started = await h.post("/api/dsh-focusing.digest", { request: "今天做了什么", offset: 480 });
  const done = await waitDone(h, started.digest.id);
  assert.equal(done.draft, true);
  assert.equal(done.error.reason, "unparsed");
  assert.equal(done.result.projects[0].items[0].text, "recent work");
});

test("follow-ups are answered from the digest and stored on it", async () => {
  const h = setup('{"title":"t","summary":"s","projects":[]}');
  const started = await h.post("/api/dsh-focusing.digest", { request: "本周", offset: 480 });
  await waitDone(h, started.digest.id);
  const answered = await h.post("/api/dsh-focusing.followup", { id: started.digest.id, question: "还差什么？" });
  assert.equal(answered.ok, true);
  assert.equal(answered.digest.followups.length, 1);
  assert.match(h.prompts.at(-1), /QUESTION: 还差什么？/);
});

test("delete removes a saved digest", async () => {
  const h = setup('{"title":"t"}');
  const started = await h.post("/api/dsh-focusing.digest", { request: "本周", offset: 480 });
  await waitDone(h, started.digest.id);
  assert.equal((await h.post("/api/dsh-focusing.digest", { action: "delete", id: started.digest.id })).ok, true);
  assert.equal((await h.call("/api/dsh-focusing.digests")).digests.length, 0);
});
