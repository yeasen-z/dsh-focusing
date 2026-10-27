import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, realpathSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerRoomRoutes, settingsFor } from "../lib/room-routes.mjs";
import { takeSnapshot, renderSnapshot, buildTurnPrompt, nextSpeaker, draftHandoff } from "../lib/room.mjs";
import { normalizeSettings } from "../lib/settings.mjs";

const dir = realpathSync(mkdtempSync(join(tmpdir(), "focusing-room-test-")));
after(() => { if (dir.startsWith(realpathSync(tmpdir()))) rmSync(dir, { recursive: true, force: true }); });

let seq = 0;
const ev = (type, data) => ({ type, seq: seq++, time: 1000 + seq, data });
const log = (title) => [
  ev("user/message", { source: { kind: "user" }, content: [{ type: "text", text: `build ${title}` }] }),
  ev("turn/start", { turn: 1 }),
  ev("session/title", { title }),
  ev("tool/call", { turn: 1, callId: `c-${title}`, name: "edit", arguments: JSON.stringify({ path: `/w/${title}/api.ts` }) }),
  ev("assistant/message", { turn: 1, message: { content: [{ type: "text", text: `${title}: endpoint /users returns {id,name}` }] } }),
  ev("turn/end", { turn: 1, reason: { kind: "completed" } }),
];

function liveSession(id, events) {
  // Frozen API: anything that would write is a test failure.
  return {
    id, header: { id, cwd: `/w/${id}` }, events,
    get seq() { return this.events.length ? this.events.at(-1).seq + 1 : 0; },
    snapshotEvents(from = 0, to = this.seq) { return this.events.filter(e => e.seq >= from && e.seq < to); },
  };
}

function setup({ answers = [] } = {}) {
  seq = 0;
  const back = liveSession("backend", log("backend"));
  const front = liveSession("frontend", log("frontend"));
  const prompts = [];
  const services = {
    sessions: { get: id => ({ backend: back, frontend: front })[id] },
    sessionTitle: { get: s => ({ title: s.id }) },
    agentDefaultModel: { currentSelection: () => ({ provider: "p", model: "default" }) },
    llm: {
      stream: async function* (req) {
        prompts.push({ model: `${req.provider}/${req.model}`, text: req.messages[0].content[0].text, system: req.system });
        const a = answers.length ? answers.shift() : "ok";
        if (a === null) throw new Error("boom");
        yield { type: "text-delta", text: a };
        yield { type: "finish", reason: { kind: "stop" } };
      },
    },
  };
  const routes = new Map();
  const child = { get: n => services[n], effect: fn => fn(), connection: { fetch: { register: r => { routes.set(r.path, r); return () => {}; } } } };
  const file = join(dir, `rooms-${Math.random()}.json`);
  registerRoomRoutes(child, { settingsStore: { get: () => normalizeSettings({}) }, roomsFile: file });
  const call = async (path, init) => (await routes.get(path.split("?")[0]).fetch(new Request(`http://x${path}`, init))).json();
  const post = body => call("/api/dsh-focusing.room", { method: "POST", body: JSON.stringify(body) });
  const settle = async id => {
    for (let i = 0; i < 200; i++) {
      const b = await call(`/api/dsh-focusing.room?id=${id}`);
      if (!b.room.pending) return b.room;
      await new Promise(r => setTimeout(r, 5));
    }
    throw new Error("room never settled");
  };
  return { back, front, prompts, post, call, settle, file };
}

test("snapshot freezes what a session did, at an offset", () => {
  seq = 0;
  const events = log("backend");
  const snap = takeSnapshot({ id: "b", header: { cwd: "/w/backend" }, events, endSeq: 6, takenAt: 5 });
  assert.equal(snap.seq, 6);
  assert.equal(snap.title, "backend");
  assert.deepEqual(snap.files, ["/w/backend/api.ts"]);
  const text = renderSnapshot(snap);
  assert.match(text, /build backend/);
  assert.match(text, /returns \{id,name\}/);
  assert.match(text, /api\.ts/);
  assert.ok(renderSnapshot({ ...snap, replies: [{ turn: 1, text: "x".repeat(50000) }] }, 2000).length <= 2000);
});

test("a room is created from snapshots, and the sources are never written", async () => {
  const h = setup();
  const before = [h.back.events.length, h.front.events.length];
  const b = await h.post({ action: "create", sessions: ["backend", "frontend"], topic: "对齐接口" });
  assert.equal(b.ok, true);
  assert.deepEqual(b.room.participants.map(p => p.label), ["A", "B"]);
  assert.equal(b.room.messages[0].text, "对齐接口");
  assert.deepEqual([h.back.events.length, h.front.events.length], before);
  assert.deepEqual(b.room.freshness.map(f => f.moved), [false, false]);
  const saved = JSON.parse(readFileSync(h.file, "utf8"));
  assert.equal(saved.rooms[0].participants[0].snapshot.title, "backend");
});

test("a turn speaks from its own snapshot and sees the others' messages; the snapshot stays frozen", async () => {
  const h = setup({ answers: ["A: /users returns {id,name}", "B: frontend expects {id,fullName}"] });
  const { room } = await h.post({ action: "create", sessions: ["backend", "frontend"] });
  // The source keeps working after the snapshot.
  h.back.events.push(ev("tool/call", { turn: 2, callId: "late", name: "bash", arguments: "{}" }));
  await h.post({ action: "turn", id: room.id, speakers: [0, 1] });
  const done = await h.settle(room.id);
  assert.deepEqual(done.messages.map(m => m.speaker), [0, 1]);
  assert.match(h.prompts[0].text, /You are participant A/);
  assert.match(h.prompts[0].text, /build backend/);
  assert.doesNotMatch(h.prompts[0].text, /YOUR SNAPSHOT:[\s\S]*build frontend/);
  assert.match(h.prompts[1].text, /\[A\]: A: \/users returns/);
  assert.equal(done.freshness[0].moved, true, "the source moved on after the snapshot");
  assert.equal(done.freshness[0].toolCalls, 1);
  assert.equal(done.freshness[1].moved, false);
  assert.equal(done.participants[0].snapshot.calls, 1, "snapshot is not updated by later source events");
});

test("each participant can use its own model", async () => {
  const h = setup({ answers: ["one", "two"] });
  const { room } = await h.post({ action: "create", sessions: ["backend", "backend"], routes: [{ provider: "p", model: "m1" }, { provider: "q", model: "m2" }] });
  await h.post({ action: "turn", id: room.id, speakers: [0, 1] });
  await h.settle(room.id);
  assert.deepEqual(h.prompts.map(p => p.model), ["p/m1", "q/m2"]);
  assert.deepEqual(settingsFor({ source: "dsh" }, "external").source, "external");
});

test("a failed turn stops the round and is reported; the moderator can speak without a model call", async () => {
  const h = setup({ answers: [null] });
  const { room } = await h.post({ action: "create", sessions: ["backend", "frontend"] });
  await h.post({ action: "turn", id: room.id, speakers: [0, 1] });
  const done = await h.settle(room.id);
  assert.equal(done.messages.length, 0);
  assert.equal(done.error.speaker, 0);
  assert.equal(h.prompts.length, 1);
  const said = await h.post({ action: "say", id: room.id, text: "先看字段名" });
  assert.equal(said.room.messages.at(-1).role, "user");
  assert.equal(h.prompts.length, 1, "saying something never calls a model");
  assert.equal(nextSpeaker(said.room), 0);
});

test("handoff brief falls back to raw material when the model fails", async () => {
  const h = setup({ answers: [null] });
  const { room } = await h.post({ action: "create", sessions: ["backend", "frontend"], topic: "合并" });
  await h.post({ action: "handoff", id: room.id });
  const done = await h.settle(room.id);
  assert.equal(done.handoff.draft, true);
  assert.match(done.handoff.text, /交接简报/);
  assert.match(done.handoff.text, /build frontend/);
  assert.equal(draftHandoff(done, "en").startsWith("# Handoff brief"), true);
});

test("resnap refreshes one participant only", async () => {
  const h = setup();
  const { room } = await h.post({ action: "create", sessions: ["backend", "frontend"] });
  h.back.events.push(ev("tool/call", { turn: 2, callId: "late", name: "bash", arguments: JSON.stringify({ command: "npm test" }) }));
  const b = await h.post({ action: "resnap", id: room.id, index: 0 });
  assert.equal(b.room.participants[0].snapshot.calls, 2);
  assert.equal(b.room.freshness[0].moved, false);
  assert.equal(b.room.participants[1].snapshot.calls, 1);
});

test("turn prompt names the room purpose and the other participants", () => {
  seq = 0;
  const snap = takeSnapshot({ id: "x", events: log("x"), endSeq: 6 });
  const room = { topic: "T", participants: [{ label: "A", session: "x", title: "X", snapshot: snap }, { label: "B", session: "y", title: "Y", project: "py", snapshot: snap }], messages: [] };
  const { user } = buildTurnPrompt(room, 0);
  assert.match(user, /ROOM TOPIC: T/);
  assert.match(user, /- B: Y \(py\)/);
  assert.match(user, /you speak first/);
});
