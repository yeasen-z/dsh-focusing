// Focus panel roster: stored (unloaded) sessions, the reviewed flag, analysis
// of an unloaded session, and the external-endpoint model catalogue.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../lib/index.mjs";
import { modelsUrl, chooseKey, fetchExternalModels, pickStoredRows, storedRow, foldStored, createStoredRoster } from "../lib/roster.mjs";
process.env.DSH_FOCUSING_CODEX_HOME = mkdtempSync(join(tmpdir(), "focusing-codex-empty-"));

const owned = [];
after(() => {
  const root = realpathSync(tmpdir());
  for (const d of owned) if (d.startsWith(`${root}/focusing-roster-test-`)) rmSync(d, { recursive: true, force: true });
});

const ev = (seq, type, data, time = 1000 + seq) => ({ seq, type, time, data });
const storedLog = [
  ev(0, "user/message", { source: { kind: "user" }, content: [{ type: "text", text: "fix the old bug" }] }),
  ev(1, "turn/start", { turn: 1 }),
  ev(2, "tool/call", { turn: 1, step: 1, callId: "c1", name: "bash", arguments: JSON.stringify({ command: "npm test" }) }),
  ev(3, "tool/result", { turn: 1, message: { toolCallId: "c1", content: [{ type: "text", text: "ok" }] } }),
  ev(4, "turn/end", { turn: 1, reason: { kind: "completed" } }),
];

function liveSession(id) {
  const events = [
    { type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "live work" }] }, time: 1 },
    { type: "turn/start", data: { turn: 1 }, time: 2 },
  ];
  return { id, header: { cwd: "/w/live", createdAt: 1 }, seq: events.length, snapshotEvents: (a, b) => events.slice(a, b) };
}

function harness({ controller = true, streamText = "VERDICT: NORMAL\nEVIDENCE: fine" } = {}) {
  const live = liveSession("live1");
  const reads = [];
  const prompts = [];
  const items = [
    { sessionId: "live1", updatedAt: 9000, cwd: "/w/live", projections: { values: { title: "Live chat" } } },
    { sessionId: "old1", updatedAt: 5000, cwd: "/w/proj", projections: { values: { title: "Old chat" } } },
    { sessionId: "kid", updatedAt: 6000, cwd: "/w/proj", parentSessionId: "old1", origin: "subagent" },
    { sessionId: "blank1", updatedAt: 7000, cwd: "/w/proj", blank: true },
  ];
  const services = {
    sessions: { list: () => [live], get: id => (id === "live1" ? live : undefined) },
    agents: { list: () => [], get: () => undefined },
    sessionTitle: { get: () => ({ title: "Live chat" }) },
    agentDefaultModel: { currentSelection: () => ({ provider: "p", model: "m" }) },
    sessionController: controller ? { list: async () => ({ items }) } : undefined,
    sessionPersistence: {
      list: async () => [
        { header: { id: "old1", cwd: "/w/proj", createdAt: 100 }, revision: "1:2:3:1793080906683000000:0" },
        { header: { id: "kid", cwd: "/w/proj", createdAt: 100, parentSession: "old1", origin: "subagent", delegationDepth: 1 }, revision: "r" },
      ],
    },
    sessionQuery: {
      readSession: async (id) => {
        reads.push(id);
        if (id !== "old1") throw new Error("not found");
        return { session: { id: "old1", cwd: "/w/proj", createdAt: 100 }, inheritedEventCount: 0, events: storedLog };
      },
    },
    llm: {
      stream: async function* (req) {
        prompts.push(req.messages[0].content[0].text);
        yield { type: "text-delta", text: streamText };
        yield { type: "finish", reason: { kind: "stop" } };
      },
    },
  };
  const routes = new Map();
  const ctx = {
    get: () => undefined,
    on: () => {},
    inject: (keys, cb) => {
      if (!keys.includes("connection")) return;
      cb({
        connection: { fetch: { register: (v) => { routes.set(v.path, v); return () => {}; } } },
        get: name => services[name],
        effect: fn => fn(),
      });
    },
  };
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "focusing-roster-test-")));
  owned.push(dir);
  const previous = process.env.DSH_PROFILE_DIR;
  process.env.DSH_PROFILE_DIR = dir;
  try { apply(ctx); } finally {
    if (previous === undefined) delete process.env.DSH_PROFILE_DIR; else process.env.DSH_PROFILE_DIR = previous;
  }
  const call = async (path, init) => (await routes.get(path.split("?")[0]).fetch(new Request(`http://x${path}`, init))).json();
  return {
    reads, prompts, routes,
    state: id => call(`/api/dsh-focusing.state${id ? `?session=${id}` : ""}`),
    analyze: id => call("/api/dsh-focusing.analyze", { method: "POST", body: JSON.stringify({ session: id }) }),
  };
}

test("the roster lists stored sessions, excludes children and blanks, and live rows win", async () => {
  const h = harness();
  const body = await h.state();
  const ids = body.sessions.map(s => s.id);
  assert.deepEqual(ids.sort(), ["live1", "old1"]);
  const live = body.sessions.find(s => s.id === "live1");
  const old = body.sessions.find(s => s.id === "old1");
  assert.equal(live.loaded, true);
  assert.equal(old.loaded, false);
  assert.equal(old.title, "Old chat");
  assert.equal(old.project, "proj");
  assert.equal(old.reviewed, false);
  assert.equal(old.reviewCount, 0);
  assert.deepEqual(h.reads, [], "listing must not read any session log");
});

test("an unloaded session can be opened, analyzed, and is then flagged as reviewed", async () => {
  const h = harness();
  const detail = await h.state("old1");
  assert.equal(detail.live, false);
  assert.equal(detail.loaded, false);
  assert.equal(detail.goal, "fix the old bug");
  assert.equal(detail.activity.filter(x => x.kind !== "message").length, 1, "one tool row");
  assert.equal(detail.activity.find(x => x.kind !== "message").status, "success");
  assert.equal(detail.activity.some(x => x.kind === "message" && x.role === "user"), true, "the user message is also a row");

  const result = await h.analyze("old1");
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.review.seq, 5, "readSeq is max seq + 1, like a live session's seq");
  assert.match(h.prompts[0], /npm test/);
  assert.deepEqual(result.reviewTrail && result.reviewTrail.moved, false);

  const roster = await h.state();
  const old = roster.sessions.find(s => s.id === "old1");
  assert.equal(old.reviewed, true);
  assert.equal(old.reviewCount, 1);
  assert.ok(old.reviewedAt > 0);
  assert.equal(old.title, "Old chat");
});

test("an unknown unloaded session is refused without a model call", async () => {
  const h = harness();
  const result = await h.analyze("ghost");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no-session");
  assert.equal(h.prompts.length, 0);
});

test("without the session controller the persistence list is used and titles fall back", async () => {
  const h = harness({ controller: false });
  const body = await h.state();
  const old = body.sessions.find(s => s.id === "old1");
  assert.ok(old);
  assert.equal(old.loaded, false);
  assert.equal(old.untitled, true);
  assert.equal(old.updatedAt, 1793080906683);
  assert.ok(!body.sessions.some(s => s.id === "kid"));
});

test("the cap keeps every reviewed session even beyond the limit", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, updatedAt: 100 - i, child: false }));
  rows.push({ id: "kid", updatedAt: 1000, child: true });
  const kept = pickStoredRows(rows, { liveIds: new Set(["s0"]), reviewedIds: new Set(["s9"]), limit: 3 });
  assert.deepEqual(kept.map(r => r.id), ["s1", "s2", "s3", "s9"]);
});

test("stored rows normalize both list shapes", () => {
  assert.equal(storedRow({ sessionId: "a", projections: { values: { title: "T" } } }).title, "T");
  assert.equal(storedRow({ sessionId: "a", origin: "subagent" }).child, true);
  assert.equal(storedRow({ header: { id: "b", delegationDepth: 1 } }).child, true);
  assert.equal(storedRow({ header: { id: "b" }, revision: "1:2:3:1793080906683000000:0" }).updatedAt, 1793080906683);
  assert.equal(storedRow({}), null);
  assert.equal(foldStored("x", {}, storedLog).readSeq, 5);
  assert.equal(foldStored("x", {}, []).readSeq, 0);
});

test("the stored listing is cached between polls", async () => {
  let calls = 0;
  let clock = 0;
  const roster = createStoredRoster(() => ({ controller: { list: async () => { calls += 1; return { items: [] }; } } }), { ttlMs: 15000, now: () => clock });
  await roster.list(); await roster.list();
  assert.equal(calls, 1);
  clock = 16000;
  await roster.list();
  assert.equal(calls, 2);
});

// --- external models --------------------------------------------------------

test("the models URL is derived from the chat completions endpoint", () => {
  assert.equal(modelsUrl("https://api.x.com/v1/chat/completions"), "https://api.x.com/v1/models");
  assert.equal(modelsUrl("https://api.x.com/openai/v1/chat/completions/"), "https://api.x.com/openai/v1/models");
  assert.equal(modelsUrl("https://api.x.com/custom/path"), "https://api.x.com/v1/models");
  assert.throws(() => modelsUrl("ftp://x"));
  assert.throws(() => modelsUrl("not a url"));
});

test("the stored key is only sent to the stored endpoint's origin", () => {
  const stored = { endpoint: "https://api.x.com/v1/chat/completions", apiKey: "sk-stored" };
  assert.equal(chooseKey({ endpoint: "https://api.x.com/other", stored }), "sk-stored");
  assert.equal(chooseKey({ endpoint: "https://evil.example/v1/chat/completions", stored }), "");
  assert.equal(chooseKey({ endpoint: "http://api.x.com/v1/chat/completions", stored }), "", "scheme is part of the origin");
  assert.equal(chooseKey({ endpoint: "https://evil.example", apiKey: "sk-typed", stored }), "sk-typed");
});

test("models are fetched with the right key, sorted, and the key is never echoed", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, auth: init.headers.authorization });
    return { ok: true, json: async () => ({ data: [{ id: "b-model" }, { id: "a-model" }, { id: "a-model" }] }) };
  };
  const stored = { endpoint: "https://api.x.com/v1/chat/completions", apiKey: "sk-stored" };
  const ok = await fetchExternalModels({ stored, fetchImpl });
  assert.deepEqual(ok.models, ["a-model", "b-model"]);
  assert.deepEqual(seen[0], { url: "https://api.x.com/v1/models", auth: "Bearer sk-stored" });

  await fetchExternalModels({ endpoint: "https://evil.example/v1/chat/completions", stored, fetchImpl });
  assert.equal(seen[1].auth, undefined, "the stored key must not follow a different endpoint");

  const failing = async () => ({ ok: false, status: 401, text: async () => "bad key sk-stored" });
  const bad = await fetchExternalModels({ stored, fetchImpl: failing });
  assert.equal(bad.reason, "bad-key");
  assert.doesNotMatch(JSON.stringify(bad), /sk-stored/);
});

test("the external-models route uses stored settings and never returns the key", async () => {
  const h = harness();
  const settings = h.routes.get("/api/dsh-focusing.settings");
  await settings.fetch(new Request("http://x/api/dsh-focusing.settings", { method: "POST", body: JSON.stringify({ settings: { source: "external", endpoint: "https://api.x.com/v1/chat/completions", apiKey: "sk-secret", externalModel: "m" } }) }));
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => { seen.push([url, init.headers.authorization]); return { ok: true, json: async () => ({ data: [{ id: "z" }, { id: "y" }] }) }; };
  try {
    const route = h.routes.get("/api/dsh-focusing.external-models");
    const body = await (await route.fetch(new Request("http://x/api/dsh-focusing.external-models", { method: "POST", body: "{}" }))).json();
    assert.deepEqual(body, { ok: true, models: ["y", "z"] });
    assert.deepEqual(seen[0], ["https://api.x.com/v1/models", "Bearer sk-secret"]);
    const other = await (await route.fetch(new Request("http://x/api/dsh-focusing.external-models", { method: "POST", body: JSON.stringify({ endpoint: "https://evil.example/v1/chat/completions" }) }))).json();
    assert.equal(other.ok, true);
    assert.equal(seen[1][1], undefined);
    assert.doesNotMatch(JSON.stringify([body, other]), /sk-secret/);
  } finally {
    globalThis.fetch = original;
  }
});
