import { test } from "node:test";
import assert from "node:assert/strict";
import { createPanelMetadata, foldPanelEvent, sessionMetadata, projectName, createPanelDataCache } from "../lib/panel-data.mjs";
import { apply } from "../lib/index.mjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DSH_FOCUSING_CODEX_HOME = mkdtempSync(join(tmpdir(), "focusing-codex-empty-"));

const text = value => [{ type: "text", text: value }];
const event = (type, data, time = 100) => ({ type, data, time });
const human = value => event("user/message", { role: "user", source: { kind: "user" }, content: text(value) });
function fold(state, ...events) { for (const e of events) foldPanelEvent(state, e); return state; }
const call = (id = "c", args = { command: "node MyScript.js --Name=Alice", description: "Verify MyScript behavior" }, turn = 1) => event("tool/call", { callId: id, name: "Bash", arguments: JSON.stringify(args), turn, step: 1 }, 110);
const result = (id = "c", extra = {}, value = "Passed", turn = 1) => event("tool/result", { turn, step: 1, message: { toolCallId: id, content: text(value), ...extra } }, 120);

function session(id, events = [], cwd = "/Work/MyProject") {
  return {
    id, header: { cwd, createdAt: 10 }, events, reads: [],
    get seq() { return this.events.length; },
    snapshotEvents(from, to) { this.reads.push([from, to]); return this.events.slice(from, to); },
  };
}

test("title prefers service and durable title over first real human fallback; project comes from header", () => {
  const state = createPanelMetadata("a", { cwd: "/Work/MyProject/", createdAt: 5 });
  fold(state,
    event("user/message", { source: { kind: "runtime-context" }, content: text("Not a title") }),
    human("Current runtime context. Ignore this context"),
    human("Fix MyProject\nwith CorrectCase"));
  assert.deepEqual(sessionMetadata(state), {
    id: "a", title: "Fix MyProject with CorrectCase", untitled: false, project: "MyProject", cwd: "/Work/MyProject/", status: "idle", updatedAt: 100,
  });
  const empty = sessionMetadata(createPanelMetadata("b"));
  assert.equal(empty.title, "", "an unnamed session has no title, not an English placeholder");
  assert.equal(empty.untitled, true, "the panel is told to label it in the reader's language");
  fold(state, event("session/title", { title: "A real title" }, 200));
  assert.equal(sessionMetadata(state).title, "A real title");
  assert.equal(sessionMetadata(state, { title: "Service title" }).title, "Service title");
  assert.equal(projectName("C:\\Work\\MyProject\\"), "MyProject");
  assert.equal(projectName("/"), "/");
  assert.equal(projectName(undefined), "");
});

test("latest turn goal uses first human request and ignores injected context", () => {
  const state = createPanelMetadata("a");
  fold(state, human("First task"), event("turn/start", { turn: 1 }), human("Additional detail"));
  assert.equal(state.goal, "First task");
  fold(state, event("turn/end", { turn: 1, reason: { kind: "completed" } }), event("turn/start", { turn: 2 }),
    event("user/message", { source: { kind: "focusing" }, content: text("Correction") }),
    human("Second task"), human("Second detail"));
  assert.equal(state.goal, "Second task");
  assert.equal(state.status, "running");
  fold(state, event("turn/end", { turn: 2, reason: { kind: "blocked" } }, 300));
  assert.equal(state.status, "idle");
  assert.equal(state.turnEndReason.kind, "blocked");
  assert.equal(state.turnEndedAt, 300);
});

test("actual tool activity preserves case, arguments, description, time, result and step", () => {
  const state = fold(createPanelMetadata("a"), event("turn/start", { turn: 1 }), event("step/start", { turn: 1, step: 1 }), call(), result());
  assert.equal(state.toolCalls, 1);
  assert.equal(state.turnSteps, 1);
  const activity = state.activity[0];
  assert.equal(activity.name, "Bash");
  assert.equal(activity.cmd, "node MyScript.js --Name=Alice");
  assert.equal(activity.arguments.command, activity.cmd);
  assert.equal(activity.description, "Verify MyScript behavior");
  assert.equal(activity.resultExcerpt, "Passed");
  assert.equal(activity.status, "success");
  assert.equal(activity.failed, false);
  assert.equal(activity.time, 110);
  assert.equal(activity.completedAt, 120);
  assert.equal(activity.step, 1);
  fold(state, event("turn/start", { turn: 2 }));
  assert.equal(state.toolCalls, 0);
  assert.equal(state.turnSteps, 0);
  assert.equal(state.activity.length, 1);
});

test("failed and incomplete outcomes cannot be presented as successful", () => {
  for (const [extra, value] of [[{ isError: true }, "Failed"], [{}, "Oops\n[exit code: 2]"], [{}, "[exit code: -1]"]]) {
    const state = fold(createPanelMetadata("a"), call(), result("c", extra, value));
    assert.equal(state.activity[0].status, "failed");
  }
  const state = fold(createPanelMetadata("a"), call(), event("tool/result", { message: { source: { callId: "c" } }, error: { code: "Denied" } }));
  assert.equal(state.activity[0].status, "failed");
  assert.equal(state.activity[0].resultExcerpt, "Denied");
  const incomplete = fold(createPanelMetadata("a"), event("turn/start", { turn: 1 }), call(), event("turn/end", { turn: 1, reason: { kind: "aborted" } }));
  assert.equal(incomplete.activity[0].status, "incomplete");
  assert.equal(fold(createPanelMetadata("a"), call(), result("c", {}, "[exit code: 0]")).activity[0].status, "success");
});

test("activity and results are kept whole and malformed args remain displayable", () => {
  const state = createPanelMetadata("a");
  for (let i = 0; i < 300; i++) fold(state, call(String(i)), result(String(i), {}, "X".repeat(3000)));
  assert.equal(state.activity.length, 300, "no cap on how many rows are kept");
  assert.equal(state.activity[0].id, "0");
  assert.equal(state.activity.at(-1).resultExcerpt.length, 3000, "result text is kept whole; the panel decides what to show");
  fold(state, event("tool/call", { callId: "bad", name: "Tool", arguments: "Bad Case {", turn: 1, step: 2 }));
  assert.equal(state.activity.at(-1).arguments.__unparsed, "Bad Case {");
});

test("cache snapshots once then folds only appended tail, independently per session", () => {
  const cache = createPanelDataCache();
  const a = session("a", [human("Task A"), event("turn/start", { turn: 1 }), call()]);
  const b = session("b", [human("Task B"), event("turn/start", { turn: 1 })], "/Work/OtherProject");
  assert.equal(cache.read(a).goal, "Task A");
  assert.equal(cache.read(b).goal, "Task B");
  cache.read(a);
  assert.deepEqual(a.reads, [[0, 3]]);
  a.events.push(result());
  assert.equal(cache.read(a).activity.find(x => x.kind !== "message").status, "success");
  assert.deepEqual(a.reads, [[0, 3], [3, 4]]);
  assert.equal(cache.read(b).activity.filter(x => x.kind !== "message").length, 0, "no tool rows yet");
  assert.equal(cache.read(b).activity.length, 1, "the user message is a row");
  assert.equal(cache.read(b).project, "OtherProject");
  const replacement = session("a", [human("New session")]);
  assert.equal(cache.read(replacement).fallbackTitle, "New session");
  cache.retain(["b"]);
  cache.read(replacement);
  assert.deepEqual(replacement.reads, [[0, 1], [0, 1]]);
});

function routeHarness(sessions, agents = sessions.map(s => ({ id: s.id }))) {
  const routes = new Map();
  const services = {
    sessions: { list: () => sessions, get: id => sessions.find(s => s.id === id) },
    agents: { list: () => agents, get: id => agents.find(a => a.id === id) },
    sessionTitle: { get: s => s.id === "a" ? { title: "Real title A" } : undefined },
  };
  const ctx = {
    get: name => services[name], on: () => {},
    inject: (keys, callback) => {
      if (!keys.includes("connection")) return;
      callback({
        connection: {
          fetch: { register: value => { routes.set(value.path, value); return () => {}; } },
        },
        // Routes resolve their services through this injected child, so the
        // stubs belong here rather than on the outer plugin context.
        get: name => services[name],
        effect: fn => fn(),
      });
    },
  };
  apply(ctx);
  const get = async (id, known) => (await routes.get("/api/dsh-focusing.state")
    .fetch(new Request(`http://localhost/api/dsh-focusing.state${id ? `?session=${id}${known ? `&known=${encodeURIComponent(known)}` : ""}` : ""}`))).json();
  const analyze = async id => (await routes.get("/api/dsh-focusing.analyze")
    .fetch(new Request("http://localhost/api/dsh-focusing.analyze", {
      method: "POST",
      body: JSON.stringify({ session: id }),
    }))).json();
  return { get, analyze, routes };
}

test("route returns object roster and refreshes it on selected polls without conflating idle and running", async () => {
  const a = session("a", [human("Task A"), event("turn/start", { turn: 1 }), call(), result(), event("turn/end", { turn: 1, reason: { kind: "completed" } })]);
  const sessions = [a];
  const { get } = routeHarness(sessions);
  const roster = await get();
  assert.equal(roster.sessions[0].title, "Real title A");
  assert.equal(roster.sessions[0].status, "idle");
  const selected = await get("a");
  assert.equal(selected.session, "a");
  assert.equal(selected.project, "MyProject");
  assert.equal(selected.toolCalls, 1);
  assert.equal(selected.goal, "Task A");
  assert.equal(selected.recent.find(x => x.cmd)?.cmd, "node MyScript.js --Name=Alice");
  assert.deepEqual(selected.diagnostics, []);
  sessions.push(session("b", [human("Task B"), event("turn/start", { turn: 1 })]));
  assert.equal((await get("a")).sessions.length, 2);
  // A durable turn/start is NOT liveness: with no live agent registered the
  // session is idle, otherwise a crashed turn would show a green dot forever.
  assert.equal((await get("b")).status, "idle");
  assert.equal((await get("missing")).sessions.length, 2);
  assert.deepEqual(a.reads, [[0, 5]]);
});

test("running means a live agent, not merely a started turn", async () => {
  const started = [human("Task"), event("turn/start", { turn: 1 })];
  const alive = session("alive", started);
  const orphaned = session("orphaned", started);
  const { get } = routeHarness([alive, orphaned], [{ id: "alive" }]);
  const roster = await get();
  const byId = Object.fromEntries(roster.sessions.map(s => [s.id, s.status]));
  assert.equal(byId.alive, "running");
  assert.equal(byId.orphaned, "idle");
});

test("analysis names its real blocker when the host has no model service", async () => {
  const a = session("a", [human("Task A"), event("turn/start", { turn: 1 }), call()]);
  // No live agent is no longer a blocker: the review calls the model directly.
  // A missing model service is the real blocker, and it must be named.
  const { analyze } = routeHarness([a], []);
  const noLlm = await analyze("a");
  assert.equal(noLlm.ok, false);
  assert.equal(noLlm.reason, "no-llm");
  assert.equal(noLlm.review, null);
  assert.equal((await analyze("nope")).reason, "no-session");
  assert.equal((await analyze(undefined)).reason, "bad-request");
});

test("manual analysis keeps one result and never re-runs by itself", async () => {
  let calls = 0;
  const a = session("a", [human("Task A"), event("turn/start", { turn: 1 }), call()]);
  const routes = new Map();
  const services = {
    sessions: { list: () => [a], get: id => (id === "a" ? a : undefined) },
    agents: { list: () => [], get: () => undefined },
    agentDefaultModel: { currentSelection: () => ({ provider: "deepseek", model: "v4.1-flash" }) },
    // The review calls the model directly; no agent and no subagent provider.
    llm: {
      stream: () =>
        (async function* () {
          calls += 1;
          yield { type: "text-delta", text: "VERDICT: NORMAL\nEVIDENCE: one file, legitimately edited twice." };
          yield { type: "finish", reason: { kind: "stop" } };
        })(),
    },
  };
  const ctx = {
    get: name => services[name], on: () => {},
    inject: (keys, callback) => {
      if (!keys.includes("connection")) return;
      callback({
        connection: { fetch: { register: v => { routes.set(v.path, v); return () => {}; } } },
        get: name => services[name],
        effect: fn => fn(),
      });
    },
  };
  apply(ctx);
  const post = async () => (await routes.get("/api/dsh-focusing.analyze").fetch(
    new Request("http://localhost/api/dsh-focusing.analyze", { method: "POST", body: JSON.stringify({ session: "a" }) }),
  )).json();
  const get = async () => (await routes.get("/api/dsh-focusing.state").fetch(
    new Request("http://localhost/api/dsh-focusing.state?session=a"),
  )).json();

  const first = await post();
  assert.equal(first.ok, true);
  assert.equal(first.review.stuck, false);
  assert.match(first.review.reason, /legitimately edited/);
  assert.equal(calls, 1);

  // Polling the panel must not spend another model turn.
  for (let i = 0; i < 3; i += 1) {
    const view = await get();
    assert.equal(view.review.stuck, false);
    assert.equal(view.analyzing, false);
  }
  assert.equal(calls, 1);
});

test("analysis works on a finished conversation with no live agent", async () => {
  const a = session("done", [
    human("Task A"),
    event("turn/start", { turn: 1 }),
    call(),
    event("turn/end", { turn: 1, reason: { kind: "completed" } }),
  ]);
  const routes = new Map();
  const services = {
    sessions: { list: () => [a], get: id => (id === "done" ? a : undefined) },
    agents: { list: () => [], get: () => undefined },
    agentDefaultModel: { currentSelection: () => ({ provider: "p", model: "m" }) },
    llm: {
      stream: () =>
        (async function* () {
          yield { type: "text-delta", text: "VERDICT: STUCK\nEVIDENCE: same command failed twice." };
          yield { type: "finish", reason: { kind: "stop" } };
        })(),
    },
  };
  const ctx = {
    get: name => services[name], on: () => {},
    inject: (keys, callback) => {
      if (!keys.includes("connection")) return;
      callback({
        connection: { fetch: { register: v => { routes.set(v.path, v); return () => {}; } } },
        get: name => services[name],
        effect: fn => fn(),
      });
    },
  };
  apply(ctx);
  const result = await (await routes.get("/api/dsh-focusing.analyze").fetch(
    new Request("http://localhost/api/dsh-focusing.analyze", { method: "POST", body: JSON.stringify({ session: "done" }) }),
  )).json();
  assert.equal(result.ok, true);
  assert.equal(result.review.stuck, true);
});

test("user and assistant messages become message rows in order, beside the tool rows", () => {
  const state = createPanelMetadata("m");
  fold(state,
    human("fix it"),
    event("turn/start", { turn: 1 }),
    call("c1"),
    event("assistant/message", { turn: 1, message: { content: [{ type: "text", text: "Done, tests pass." }] } }));
  assert.deepEqual(state.activity.map(a => a.kind === "message" ? a.role : "tool"), ["user", "tool", "assistant"]);
  assert.equal(state.activity.at(-1).text, "Done, tests pass.");
});

test("totalToolCalls counts every tool call in the session, not just this turn's, and not messages", () => {
  const state = createPanelMetadata("t");
  fold(state,
    human("go"), event("turn/start", { turn: 1 }), call("a"), call("b"),
    event("assistant/message", { turn: 1, message: { content: [{ type: "text", text: "ok" }] } }),
    event("turn/end", { turn: 1 }),
    human("more"), event("turn/start", { turn: 2 }), call("c", undefined, 2));
  assert.equal(state.totalToolCalls, 3);
  assert.equal(state.toolCalls, 1, "toolCalls stays the current turn's count");
  assert.equal(state.activity.length, 6, "2 user + 1 assistant + 3 tool rows");
});

test("an unchanged selection is not resent: the stamp matches and activity is left out", async () => {
  const a = session("a", [human("Task A"), event("turn/start", { turn: 1 }), call()]);
  const { get } = routeHarness([a]);
  const first = await get("a");
  assert.ok(first.activityStamp && first.activity.length > 0);
  const again = await get("a", first.activityStamp);
  assert.equal(again.activityUnchanged, true);
  assert.equal(again.activity, undefined, "rows are not sent again");
  assert.equal(again.sessions.length, 1, "the roster still arrives");
  a.events.push(result());
  const moved = await get("a", first.activityStamp);
  assert.equal(moved.activityUnchanged, undefined);
  assert.ok(moved.activity.length > 0, "a changed session sends its rows");
});
