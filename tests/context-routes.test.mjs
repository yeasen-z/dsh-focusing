import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, realpathSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerContextRoutes } from "../lib/context-routes.mjs";
import { normalizeSettings } from "../lib/settings.mjs";
import { BUILTIN_TEMPLATES } from "../lib/template-store.mjs";

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

function setup(answer, extra = {}) {
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
  const digestFile = extra.digestFile ?? join(dir, `d-${Math.random()}.json`);
  registerContextRoutes(child, { ...extra, settingsStore: { get: () => settings }, digestFile });
  const call = async (path, init) => (await routes.get(path.split("?")[0]).fetch(new Request(`http://x${path}`, init))).json();
  const post = (path, body) => call(path, { method: "POST", body: JSON.stringify(body) });
  return { call, post, reads, prompts, stored, digestFile };
}

async function waitDone(h, id) {
  for (let i = 0; i < 100; i++) {
    const b = await h.call(`/api/dsh-focusing.digest?id=${id}`);
    if (b.digest.status !== "running") return b.digest;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error("digest did not finish");
}

test('snapshot batch retry retains successful calls and frozen scope across restart', async () => {
  const calls = [];
  let failOnce = true;
  const gateway = { complete: async options => {
    calls.push(options.user);
    assert.ok(options.system.length + options.user.length <= 20000);
    if (failOnce) { failOnce = false; return { ok: false, reason: 'timeout', detail: 'test timeout' }; }
    return { ok: true, text: JSON.stringify({ title: 'Saved batch', summary: 'Concrete saved evidence', projects: [] }), model: 'p/m' };
  } };
  const h = setup('', { modelGateway: gateway });
  for (let i = 0; i < 16; i++) {
    const id = `bulk-${i}`;
    h.stored[id] = { header: { id, cwd: '/w/p', createdAt: recentAt }, revision: `bulk:${i}`, events: log(`${i} ${'evidence '.repeat(140)}`, recentAt) };
  }
  const start = await h.post('/api/dsh-focusing.digest', { request: 'today', offset: 480 });
  const partial = await waitDone(h, start.digest.id);
  assert.equal(partial.partial, true);
  assert.equal(partial.retryable, true);
  assert.equal(partial.error.reason, 'timeout');
  assert.ok(partial.progress.completedBatches > 0);
  assert.equal(partial.pipeline, undefined, 'polling never sends private frozen batch inputs');
  assert.equal(partial.frozenSlices, undefined);
  assert.equal(partial.snapshots.length, 17);
  const before = calls.length;
  const successful = new Set(calls.slice(1));
  const saved = JSON.parse(readFileSync(h.digestFile, 'utf8'));
  saved.digests[0].status = 'running'; // persisted process interrupted before final state
  writeFileSync(h.digestFile, JSON.stringify(saved));
  const reopened = setup('', { digestFile: h.digestFile, modelGateway: gateway });
  const restored = (await reopened.call(`/api/dsh-focusing.digest?id=${partial.id}`)).digest;
  assert.equal(restored.status, 'interrupted');
  assert.equal(restored.retryable, true);
  const resumed = await reopened.post('/api/dsh-focusing.digest', { action: 'retry', id: partial.id });
  assert.equal(resumed.digest.id, partial.id);
  const busy = await reopened.post('/api/dsh-focusing.digest', { action: 'retry', id: partial.id });
  assert.equal(busy.reason, 'busy');
  const done = await waitDone(reopened, partial.id);
  assert.equal(done.partial, false);
  assert.equal(done.retryable, false);
  assert.equal(done.progress.completedSessions, 17);
  assert.equal(reopened.reads.length, 0, 'retry does not reread changed live source catalog');
  assert.ok(calls.slice(before).every(prompt => !successful.has(prompt)), 'successful model calls are not repeated');
  assert.deepEqual(done.snapshots, partial.snapshots);
  assert.equal((await reopened.call('/api/dsh-focusing.digests')).digests.length, 1);
});

test('corrupt frozen sources stop follow-ups and retries rather than substitute live data', async () => {
  const h = setup('not json');
  const start = await h.post('/api/dsh-focusing.digest', { request: 'today', offset: 480 });
  const done = await waitDone(h, start.digest.id);
  const snapshotPath = join(`${h.digestFile}.snapshots`, `${done.snapshots[0].id}.json`);
  writeFileSync(snapshotPath, '{}');
  const follow = await h.post('/api/dsh-focusing.followup', { id: done.id, question: 'details?' });
  assert.equal(follow.reason, 'source-unavailable');
  await h.post('/api/dsh-focusing.digest', { action: 'retry', id: done.id });
  const retried = await waitDone(h, done.id);
  assert.equal(retried.status, 'failed');
  assert.equal(h.prompts.length, 1, 'corrupt retained evidence prevents another model call');
});

test("records can filter by multiple workspace paths, with an empty filter meaning all", async () => {
  const h = setup("{}");
  const filtered = await h.call("/api/dsh-focusing.records?range=last-7d&offset=480&cwd=%2Fw%2Fp%0A%2Fw%2Fother");
  assert.deepEqual(filtered.workspaces, ["/w/p"]);
  assert.deepEqual(filtered.records.map(r => r.title), ["recent work"]);
  const all = await h.call("/api/dsh-focusing.records?range=last-7d&offset=480&cwd=");
  assert.deepEqual(all.records.map(r => r.title), ["recent work"]);
});

test("the records list is drawn from the index, counting only the turns inside the span", async () => {
  const h = setup("ok");
  const week = await h.call("/api/dsh-focusing.records?range=last-7d&offset=480");
  assert.deepEqual(week.records.map(r => r.title), ["recent work"]);
  assert.equal(week.records[0].turns, 1, "the one turn inside the span");
  assert.equal(week.records[0].calls, 1);
  assert.ok(week.records[0].cwd === "/w/p", "the row carries the working directory the bars group by");
  assert.equal(week.stats.sessions, 1);

  const allSpan = await h.call("/api/dsh-focusing.records?range=all&offset=480");
  assert.deepEqual(allSpan.records.map(r => r.title), ["recent work", "old work"], "all time reaches the oldest session too");
  assert.equal(allSpan.stats.sessions, 2);
  assert.ok(allSpan.records.every(r => r.lastAt > 0 && typeof r.gist === "string"));

  // Asking again is answered from the index: no transcript is folded twice.
  const before = h.reads.length;
  await h.call("/api/dsh-focusing.records?range=all&offset=480");
  assert.equal(h.reads.length, before, "an unchanged session is not read again");
});

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


test("Codex records participate in listing, detail, digest and follow-up", async () => {
  const path = join(dir, "external.jsonl");
  const row = (type, payload, delta = 0) => JSON.stringify({timestamp: new Date(recentAt + delta).toISOString(), type, payload});
  writeFileSync(path, [
    row("session_meta", {id:"cx", cwd:"/w/external"}),
    row("response_item", {type:"message", role:"user", content:[{type:"input_text", text:"repair Codex fixture"}]}),
    row("event_msg", {type:"task_started"}, 1),
    row("response_item", {type:"message", role:"assistant", content:[{type:"output_text", text:"Codex repair complete"}]}, 2),
    row("event_msg", {type:"task_complete"}, 3),
  ].join("\n"));
  let enabled = true;
  const h = setup('{"title":"Combined","summary":"done"}', {codexChats: async () => enabled ? [{id:"cx", path, updatedAt:recentAt+3}] : []});
  const list = await h.call("/api/dsh-focusing.records?range=last-7d&offset=480");
  assert.equal(list.records.length, 2);
  assert.equal(list.records.find(r=>r.id==='codex:cx').source, 'codex');
  const detail = await h.call("/api/dsh-focusing.records/detail?id=codex:cx");
  assert.equal(detail.record.lastReply, "Codex repair complete");
  const start = await h.post("/api/dsh-focusing.digest", {request:"today", offset:480});
  const digest = await waitDone(h, start.digest.id);
  assert.equal(digest.stats.sessions, 2);
  assert.match(h.prompts[0], /Codex repair complete/);
  const follow = await h.post("/api/dsh-focusing.followup", {id:digest.id, question:"what changed?"});
  assert.equal(follow.ok, true);
  assert.match(h.prompts.at(-1), /Codex repair complete/);
  writeFileSync(path, readFileSync(path, 'utf8').replace('Codex repair complete', 'Codex repair verified after update'));
  const updated = await h.call("/api/dsh-focusing.records/detail?id=codex:cx");
  assert.equal(updated.record.lastReply, 'Codex repair verified after update');
  enabled = false;
  const unavailable = await h.post("/api/dsh-focusing.followup", {id:digest.id, question:"read again"});
  assert.equal(unavailable.ok, true, 'saved digest follow-ups use frozen evidence even after live import is disabled');
  assert.match(h.prompts.at(-1), /Codex repair complete/);
  assert.doesNotMatch(h.prompts.at(-1), /Codex repair verified after update/);
  const disabledList = await h.call("/api/dsh-focusing.records?range=last-7d&offset=480");
  assert.equal(disabledList.records.length, 1);
  const single = await h.post("/api/dsh-focusing.digest", {request:"handoff", session:"codex:cx"});
  assert.equal((await waitDone(h, single.digest.id)).status, "failed");
});

test("Claude records participate in listing, detail and digest through the same source interface", async () => {
  const path = join(dir, "claude.jsonl");
  const row = (type, delta, extra = {}) => JSON.stringify({ type, timestamp: new Date(recentAt + delta).toISOString(), sessionId: "cl", cwd: "/w/claude", ...extra });
  writeFileSync(path, [
    JSON.stringify({ type: "summary", summary: "Claude handoff" }),
    row("user", 0, { message: { role: "user", content: "repair Claude fixture" } }),
    row("assistant", 1, { message: { role: "assistant", content: [{ type: "text", text: "Claude repair complete" }] } }),
  ].join("\n"));
  let enabled = true;
  const h = setup('{"title":"Combined Claude","summary":"done"}', { claudeChats: async () => enabled ? [{ id: "cl", path, updatedAt: recentAt + 1 }] : [] });
  const list = await h.call("/api/dsh-focusing.records?range=last-7d&offset=480");
  assert.equal(list.records.length, 2);
  assert.equal(list.records.find(r => r.id === "claude:cl").source, "claude");
  assert.equal(list.records.find(r => r.id === "claude:cl").title, "Claude handoff");
  const detail = await h.call("/api/dsh-focusing.records/detail?id=claude:cl");
  assert.equal(detail.record.lastReply, "Claude repair complete");
  const started = await h.post("/api/dsh-focusing.digest", { request: "today", offset: 480 });
  const digest = await waitDone(h, started.digest.id);
  assert.equal(digest.stats.sessions, 2);
  assert.match(h.prompts[0], /Claude repair complete/);
  const taggedStart = await h.post("/api/dsh-focusing.digest", { request: "today", offset: 480, tags: ["source:claude", "workspace:/w/claude"] });
  const taggedDigest = await waitDone(h, taggedStart.digest.id);
  assert.equal(taggedDigest.stats.sessions, 1, "a report only reads sessions matching every tag");
  assert.deepEqual(taggedDigest.tags, ["source:claude", "workspace:/w/claude"]);
  assert.deepEqual(taggedDigest.sources[0].tags, ["source:claude", "project:claude", "workspace:/w/claude"]);
  enabled = false;
  const disabled = await h.call("/api/dsh-focusing.records?range=last-7d&offset=480");
  assert.equal(disabled.records.some(r => r.source === "claude"), false);
});

test("the activity calendar combines enabled Codex and Claude sources and reports pending work", async () => {
  const imported = (id, source) => ({ id, source, personal: true, turns: [{ start: recentAt, end: recentAt + 1, calls: 1, requests: [{ time: recentAt }] }] });
  const h = setup("unused", {
    codexRecords: () => ({ enabled: true, ok: true, pending: 2, records: [imported("codex:c", "codex")] }),
    claudeRecords: () => ({ enabled: true, ok: true, pending: 1, records: [imported("claude:c", "claude")] }),
  });
  const body = await h.call("/api/dsh-focusing.activity?days=7&offset=480&external=1");
  assert.equal(body.ok, true);
  assert.equal(body.total, 3);
  assert.equal(body.externalEnabled, true);
  assert.equal(body.externalAvailable, true);
  assert.equal(body.externalPending, 3);
  const active = body.days.find(day => day.turns > 0);
  assert.equal(active.bySource.codex, 1);
  assert.equal(active.bySource.claude, 1);
});

// ---- asking: a short tool loop behind one route -----------------------------
test("Ask retries an unsupported answer, uses ranked matches, and retains coverage across reload and follow-ups", async () => {
  const requests = [];
  const reply = text => [{ type: "text-delta", index: 0, text }, { type: "finish", reason: { kind: "stop" } }];
  const search = [{ type: "block-end", index: 0, block: { type: "tool-call", id: "c1", name: "focus_list_sessions", arguments: '{"query":"needle","limit":1}' } }, { type: "finish", reason: { kind: "tool-calls" } }];
  const reuse = reply("[USE_PRIOR_EVIDENCE]\nTwo matches for needle.");
  const turns = [reply("Unsupported"), search, reply("The archive has two matches for needle."), reuse,
    reply("Guess"), reply("Still guessing"), reuse, reuse, reply("Guess"), reply("Still guessing")];
  const stored = new Map(["one", "two"].map((id, index) => {
    const header = { id, cwd: "/w/p", createdAt: now - 864e5 + index * 1000 };
    const events = log(id, header.createdAt);
    events[4].data.message.content[0].text += ` ${"ordinary words ".repeat(400)}needle`;
    return [id, { header, revision: `rev-${index}`, events }];
  }));
  const services = {
    sessions: { list: () => [], get: () => undefined },
    sessionPersistence: { list: async () => [...stored.values()].map(({ header, revision }) => ({ header, revision })) },
    sessionQuery: { readSession: async id => ({ session: stored.get(id).header, events: stored.get(id).events }) },
    agentDefaultModel: { currentSelection: () => ({ provider: "p", model: "m" }) },
    llm: { stream: async function* (req) { requests.push(structuredClone({ ...req, signal: undefined })); for (const c of turns.shift()) yield c; } },
  };
  const digestFile = join(dir, `a-${Math.random()}.json`);
  const open = () => {
    const routes = new Map();
    const child = { get: n => services[n], effect: fn => fn(), connection: { fetch: { register: r => { routes.set(r.path, r); return () => {}; } } } };
    registerContextRoutes(child, { settingsStore: { get: () => normalizeSettings({}) }, digestFile });
    return async (path, body) => (await routes.get(path.split("?")[0]).fetch(new Request(`http://x${path}`, body ? { method: "POST", body: JSON.stringify(body) } : {}))).json();
  };
  const path = "/api/dsh-focusing.ask";
  const wait = async (call, id) => {
    for (let i = 0; i < 50; i++) {
      const { ask } = await call(`${path}?id=${id}`);
      if (ask.status !== "running") return ask;
      await new Promise(r => setTimeout(r, 10));
    }
    throw new Error("Ask did not finish");
  };
  const call = open();
  const started = await call(path, { question: "Where was needle mentioned?", offset: 480 });
  assert.equal(started.ok, true);
  assert.equal(started.ask.status, "running");
  const id = started.ask.id;
  const ask = await wait(call, id);
  assert.equal(ask.status, "idle", JSON.stringify(ask));
  assert.equal(ask.messages.at(-1).content[0].text, "The archive has two matches for needle.");
  assert.deepEqual(ask.messages.map(m => m.role), ["user", "assistant", "tool", "assistant"]);
  assert.deepEqual(ask.steps.map(x => x.kind), ["call", "answer"]);
  assert.equal(ask.steps[0].name, "focus_list_sessions");
  const page = JSON.parse(ask.steps[0].result);
  assert.equal(page.total, 2);
  assert.equal(page.items.length, 1);
  assert.ok(page.nextCursor);
  assert.ok(page.items[0].matches.some(match => match.eventIndex === 4));
  assert.equal(ask.partial, true);
  assert.deepEqual(ask.rounds, [{ coverage: "partial", reasons: ["list-pagination"], at: 3 }]);
  assert.equal(requests[0].tools.length, 3);
  assert.match(requests[0].system, /UTC\+08:00/);
  assert.match(requests[1].system, /make a tool call now/);

  const reopened = open();
  assert.deepEqual((await reopened(`${path}?id=${id}`)).ask.rounds, ask.rounds);
  await reopened(path, { id, question: "Summarize what you found.", offset: 480 });
  const summary = await wait(reopened, id);
  assert.equal(summary.messages.at(-1).content[0].text, "Two matches for needle.");
  assert.deepEqual(summary.steps.map(step => step.kind), ["answer"]);
  assert.deepEqual(summary.rounds.at(-1), { coverage: "partial", reasons: ["list-pagination"], at: 5, reused: true });
  assert.deepEqual(requests[3].messages.map(message => message.role), ["user", "assistant", "tool", "assistant", "user"]);
  assert.match(requests[3].system, /answer directly without calling tools/);
  assert.equal(requests.length, 4);

  await reopened(path, { id, question: "Which other project?", offset: 480 });
  const follow = await wait(reopened, id);
  assert.equal(follow.reason, "no-evidence");
  assert.deepEqual(follow.rounds.at(-1), { coverage: "no-evidence", reasons: [], at: 6 });
  assert.equal(follow.messages.at(-1).content[0].text, "Which other project?");

  await reopened(path, { id, question: "What did I do all time?", range: "all", offset: 480 });
  const changed = await wait(reopened, id);
  assert.equal(changed.reason, "no-evidence", "a scope change rejects an attempt to reuse evidence");
  assert.doesNotMatch(requests[6].system, /answer directly without calling tools/);
  await reopened(path, { id, question: "Can you narrow that down?", offset: 480 });
  const narrowed = await wait(reopened, id);
  assert.equal(narrowed.range, "all", "follow-ups inherit the selected range when absent");
  assert.deepEqual(requests[6].messages.map(message => message.role), ["user"]);
  assert.ok(!JSON.stringify(requests[8].messages).includes("The archive has two matches"));
  assert.equal(narrowed.rounds[2].at, 6, "each unanswered question keeps its own outcome");
  assert.equal(narrowed.messages[6].content[0].text, "Which other project?");
  assert.equal((await reopened(path, { action: "delete", id })).ok, true);
  assert.equal((await reopened(`${path}?id=${id}`)).reason, "not-found");
});

test("an empty question is refused, and an external endpoint says it is not supported", async () => {
  const s = setup("unused");
  assert.equal((await s.post("/api/dsh-focusing.ask", { question: "   " })).reason, "bad-request");

  const routes = new Map();
  const child = { get: () => undefined, effect: fn => fn(), connection: { fetch: { register: r => { routes.set(r.path, r); return () => {}; } } } };
  const external = normalizeSettings({ source: "external", endpoint: "http://x/v1/chat/completions", externalModel: "m", apiKey: "k" });
  registerContextRoutes(child, { settingsStore: { get: () => external }, digestFile: join(dir, `e-${Math.random()}.json`) });
  const call = async (path, init) => (await routes.get(path.split("?")[0]).fetch(new Request(`http://x${path}`, init))).json();
  const started = await call("/api/dsh-focusing.ask", { method: "POST", body: JSON.stringify({ question: "q" }) });
  let ask;
  for (let i = 0; i < 50; i++) { ask = (await call(`/api/dsh-focusing.ask?id=${started.ask.id}`)).ask; if (ask.status !== "running") break; await new Promise(r => setTimeout(r, 10)); }
  assert.equal(ask.status, "failed");
  assert.equal(ask.reason, "unsupported");
});

// ---- templates --------------------------------------------------------------
test("templates are listed with the shipped ones and can be added, edited and removed", async () => {
  const s = setup("unused", {});
  const list = await s.call("/api/dsh-focusing.templates");
  assert.equal(list.ok, true);
  assert.deepEqual(list.templates.slice(0, 3).map(t => t.id), ["builtin:weekly", "builtin:daily", "builtin:handoff"]);

  const made = await s.post("/api/dsh-focusing.templates", { action: "create", name: "发布复盘", instruction: "总结发布相关的风险", range: "this-week" });
  assert.equal(made.ok, true);
  assert.equal((await s.call("/api/dsh-focusing.templates")).templates.at(-1).name, "发布复盘");

  const edited = await s.post("/api/dsh-focusing.templates", { action: "update", id: made.template.id, name: "发布复盘 v2", instruction: "只看风险" });
  assert.equal(edited.ok, true);
  assert.equal((await s.call("/api/dsh-focusing.templates")).templates.at(-1).name, "发布复盘 v2");

  assert.equal((await s.post("/api/dsh-focusing.templates", { action: "delete", id: made.template.id })).ok, true);
  assert.equal((await s.call("/api/dsh-focusing.templates")).templates.length, 3);
  assert.equal((await s.post("/api/dsh-focusing.templates", { action: "delete", id: "builtin:weekly" })).reason, "read-only");
  assert.equal((await s.post("/api/dsh-focusing.templates", { action: "nope" })).reason, "bad-request");
});

test("a digest can be started from a template instead of typed words", async () => {
  const s = setup(JSON.stringify({
    title: "本周", summary: "s", projects: [], days: [], next: [], sections: [],
  }), {});
  const started = await s.post("/api/dsh-focusing.digest", { templateId: "builtin:weekly", offset: 480, locale: "zh" });
  assert.equal(started.ok, true);
  assert.equal(started.digest.request, BUILTIN_TEMPLATES.find(t => t.id === "builtin:weekly").instruction, "the template's words, not the caller's");
  assert.equal(started.digest.templateId, "builtin:weekly");
  assert.equal(started.digest.range.key, "this-week", "the template's own range applies");
  let done;
  for (let i = 0; i < 100; i++) {
    done = (await s.call(`/api/dsh-focusing.digest?id=${started.digest.id}`)).digest;
    if (done.status !== "running") break;
    await new Promise(r => setTimeout(r, 10));
  }
  assert.equal(done.status, "done");
});

test("an unknown template is refused, and a session-scoped one cannot run from the list", async () => {
  const s = setup("unused", {});
  assert.equal((await s.post("/api/dsh-focusing.digest", { templateId: "tpl-nope" })).reason, "not-found");
  assert.equal((await s.post("/api/dsh-focusing.digest", { templateId: "builtin:handoff" })).reason, "needs-session");
});

test("a question searches a window, not the whole archive, and can be widened on purpose", async () => {
  const s = setup(JSON.stringify({ title: "t", summary: "s", projects: [], days: [], next: [], sections: [] }), {});
  const posted = await s.post("/api/dsh-focusing.ask", { question: "上周做了什么", offset: 480 });
  assert.equal(posted.ok, true);
  assert.equal(posted.ask.range, "last-30d", "the default window is the last 30 days");
  assert.equal(posted.ask.window.key, "last-30d");
  assert.ok(posted.ask.window.start < Date.now() && posted.ask.window.end >= posted.ask.window.start);

  const wide = await s.post("/api/dsh-focusing.ask", { question: "去年做过什么", offset: 480, range: "all" });
  assert.equal(wide.ask.range, "all");
  assert.equal(wide.ask.window, undefined, "no bound at all");

  // Two turns may run at once; the third waits its turn, so start this one in a
  // fresh host to keep the assertion about the key, not about capacity.
  const alone = setup(JSON.stringify({ title: "t", summary: "s", projects: [], days: [], next: [], sections: [] }), {});
  const odd = await alone.post("/api/dsh-focusing.ask", { question: "q", offset: 480, range: "not-a-range" });
  assert.equal(odd.ask.range, "last-30d", "an unknown key falls back to the default rather than opening everything");
});
