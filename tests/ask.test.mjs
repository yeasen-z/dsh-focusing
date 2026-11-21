import test from "node:test";
import assert from "node:assert/strict";
import { ASK_RESULT_LIMIT, runAsk, readTurn, MAX_STEPS } from "../lib/ask.mjs";

const route = { provider: "p", model: "m" };
const settings = { temperature: null, maxTokens: 2048 };
async function* chunks(list) { for (const c of list) yield c; }

const call = (id, name, args) => ({ type: "block-end", index: 0, block: { type: "tool-call", id, name, arguments: JSON.stringify(args) } });
const toolTurn = (...calls) => [...calls, { type: "finish", reason: { kind: "tool-calls" } }];
const textTurn = (text) => [{ type: "text-delta", index: 0, text }, { type: "finish", reason: { kind: "stop" } }];

/** A scripted model: each call to stream() consumes the next turn and records the request. */
function scripted(turns) {
  const requests = [];
  return {
    requests,
    llm: { stream(options) { requests.push(structuredClone({ ...options, signal: undefined })); const next = turns.shift(); if (!next) throw new Error("model called too often"); return chunks(next); } },
  };
}
/** The conversation as the route builds it: the question is already its last message. */
const say = (text) => [{ role: "user", content: [{ type: "text", text }] }];
const tool = (name, execute) => ({ name, description: name, parameters: { type: "object", properties: {}, additionalProperties: false }, execute });

test("a plain answer needs no tools and is returned with its model", async () => {
  const { llm } = scripted([textTurn("你上周主要在做检索。")]);
  const out = await runAsk({ llm, route, tools: [], messages: say("上周做了什么"), settings });
  assert.equal(out.ok, true);
  assert.equal(out.answer, "你上周主要在做检索。");
  assert.equal(out.model, "p/m");
  assert.deepEqual(out.steps.map(s => s.kind), ["answer"]);
});

test("historical answers retry a text-only reply and use the results before publishing", async () => {
  const { llm, requests } = scripted([
    textTurn("Unsupported first answer"),
    [...textTurn("Unsupported preamble").slice(0, 1), ...toolTurn(call("search", "focus_list_sessions", { query: "login" }))],
    textTurn("The log mentions a login fix."),
  ]);
  const messages = say("What did I do about login?");
  const tools = [tool("focus_list_sessions", async () => JSON.stringify({ items: [{ matches: [{ text: "login fix", eventIndex: 12 }] }], total: 1 }))];
  const result = await runAsk({ llm, route, tools, messages, settings, requireEvidence: true });
  assert.equal(result.answer, "The log mentions a login fix.");
  assert.equal(result.partial, false);
  assert.match(requests[1].system, /make a tool call now/);
  assert.deepEqual(messages.map(message => message.role), ["user", "assistant", "tool", "assistant"]);
  assert.ok(!JSON.stringify(messages).includes("Unsupported"));
});

test("an earlier answer does not let a guarded follow-up repeat unsupported claims", async () => {
  const { llm, requests } = scripted([textTurn("Unsupported"), textTurn("Still unsupported")]);
  const messages = [...say("What did I do?"), { role: "assistant", content: [{ type: "text", text: "Earlier answer" }] }, ...say("Which project?")];
  const result = await runAsk({ llm, route, tools: [], messages, settings, requireEvidence: true });
  assert.equal(result.reason, "no-evidence");
  assert.deepEqual(result.steps, []);
  assert.equal(requests.length, 2);
  assert.equal(messages.length, 3);
});

test("a simple greeting can get fixed Ask help after the evidence retry", async () => {
  const { llm, requests } = scripted([textTurn("Hello!"), textTurn("ASK_HELP")]);
  const messages = say("Hello!");
  const result = await runAsk({ llm, route, tools: [], messages, settings, requireEvidence: true });
  assert.equal(result.dialogue, true);
  assert.equal(requests.length, 2);
  assert.deepEqual(messages, say("Hello!"));
});

test("zero lexical matches alone do not establish facts about work", async () => {
  const { llm } = scripted([
    toolTurn(call("search", "focus_list_sessions", { query: "login" })),
    textTurn("No login work occurred."),
    textTurn("Nobody worked on login."),
  ]);
  const tools = [tool("focus_list_sessions", async () => '{"items":[],"total":0}')];
  const result = await runAsk({ llm, route, tools, messages: say("q"), settings, requireEvidence: true });
  assert.equal(result.reason, "no-evidence");
  assert.deepEqual(result.coverageReasons, ["no-matches"]);
  assert.equal(result.steps.length, 1);
});

test("structured tool errors leave a recoverable result and mark covered answers partial", async () => {
  const { llm, requests } = scripted([
    toolTurn(call("large", "focus_list_sessions", {}), call("invalid", "focus_read_session", {}), call("activity", "focus_activity", {})),
    textTurn("Two turns were recorded."),
  ]);
  const tools = [
    tool("focus_list_sessions", async () => JSON.stringify({ items: ["x".repeat(ASK_RESULT_LIMIT)], total: 1 })),
    tool("focus_read_session", async () => '{"items":['),
    tool("focus_activity", async () => '{"days":[],"total":2,"warningCount":4,"nextCursor":"activity-details"}'),
  ];
  const result = await runAsk({ llm, route, tools, messages: say("q"), settings, requireEvidence: true });
  assert.equal(result.partial, true);
  assert.deepEqual(result.coverageReasons, ["tool-error", "source-warning"]);
  const results = requests[1].messages.slice(2);
  assert.deepEqual(results.map(message => !!message.isError), [true, true, false]);
  assert.match(results[0].content[0].text, /Retry with a smaller page/);
  assert.match(results[1].content[0].text, /valid result page/);
  assert.equal(JSON.parse(results[2].content[0].text).total, 2);
});

test("coverage tracks unvisited list pages without requiring irrelevant session events", async () => {
  const tools = [
    tool("focus_list_sessions", async ({ cursor }) => JSON.stringify({ items: [{}], total: 2, nextCursor: cursor ? null : "second-page" })),
    tool("focus_read_session", async () => '{"items":[{"eventIndex":11}],"total":50,"nextCursor":"remaining-events"}'),
  ];
  const list = toolTurn(call("list", "focus_list_sessions", {}), call("read", "focus_read_session", { sessionId: "s" }));
  for (const follow of [false, true]) {
    const turns = [list];
    if (follow) turns.push(toolTurn(call("follow", "focus_list_sessions", { cursor: "second-page" })));
    turns.push(textTurn("I checked the activity in one session."));
    const { llm } = scripted(turns);
    const result = await runAsk({ llm, route, tools, messages: say("q"), settings, requireEvidence: true });
    assert.equal(result.partial, !follow);
    assert.deepEqual(result.coverageReasons, follow ? [] : ["list-pagination"]);
  }
});

test("a tool request is executed, its result is fed back, and the next turn answers", async () => {
  const seen = [];
  const { llm, requests } = scripted([
    toolTurn(call("c1", "focus_list_sessions", { query: "登录" })),
    textTurn("找到 2 个会话。"),
  ]);
  const tools = [tool("focus_list_sessions", async (args, exec) => { seen.push(args); assert.ok(exec.signal === undefined || exec.signal); return '{"total":2}'; })];
  const out = await runAsk({ llm, route, tools, messages: say("找登录相关"), settings });
  assert.equal(out.ok, true);
  assert.deepEqual(seen, [{ query: "登录" }]);
  assert.deepEqual(out.steps.map(s => s.kind), ["call", "answer"]);
  assert.equal(out.steps[0].status, "done");
  assert.equal(out.steps[0].result, '{"total":2}');

  // The second request carries the first assistant turn and the matching tool result.
  const [, second] = requests;
  const [user, assistant, result] = second.messages;
  assert.equal(user.role, "user");
  assert.equal(assistant.role, "assistant");
  assert.deepEqual(assistant.content[0], { type: "tool-call", id: "c1", name: "focus_list_sessions", arguments: '{"query":"登录"}' });
  assert.deepEqual(assistant.source, { kind: "model", provider: "p", model: "m" });
  assert.equal(result.role, "tool");
  assert.equal(result.toolCallId, "c1");
  assert.deepEqual(result.source, { kind: "tool", callId: "c1" });
  assert.equal(result.content[0].text, '{"total":2}');
  // Tool schemas are offered, without the executable.
  assert.deepEqual(Object.keys(second.tools[0]).sort(), ["description", "name", "parameters"]);
});

test("several tool calls in one turn each get a result", async () => {
  const { llm, requests } = scripted([
    toolTurn(call("a", "t", { n: 1 }), call("b", "t", { n: 2 })),
    textTurn("done"),
  ]);
  const out = await runAsk({ llm, route, tools: [tool("t", async ({ n }) => `r${n}`)], messages: say("q"), settings });
  assert.equal(out.ok, true);
  const roles = requests[1].messages.map(m => m.role);
  assert.deepEqual(roles, ["user", "assistant", "tool", "tool"]);
  assert.deepEqual(requests[1].messages.slice(2).map(m => m.toolCallId), ["a", "b"]);
});

test("a failing tool is reported to the model as an error, not thrown away", async () => {
  const { llm, requests } = scripted([toolTurn(call("c1", "t", {})), textTurn("无法读取，原因见上。")]);
  const out = await runAsk({ llm, route, tools: [tool("t", async () => { throw new Error("outside range"); })], messages: say("q"), settings });
  assert.equal(out.ok, true);
  assert.equal(out.steps[0].status, "failed");
  const result = requests[1].messages[2];
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /outside range/);
});

test("an unknown tool and malformed arguments are errors the model can see", async () => {
  const { llm, requests } = scripted([
    toolTurn(call("c1", "nope", {}), { type: "block-end", index: 1, block: { type: "tool-call", id: "c2", name: "t", arguments: "{broken" } }),
    textTurn("ok"),
  ]);
  const out = await runAsk({ llm, route, tools: [tool("t", async () => "x")], messages: say("q"), settings });
  assert.equal(out.ok, true);
  assert.deepEqual(out.steps.filter(s => s.kind === "call").map(s => s.status), ["failed", "failed"]);
  assert.match(requests[1].messages[2].content[0].text, /Unknown tool nope/);
  assert.match(requests[1].messages[3].content[0].text, /not valid JSON/);
});

test("a huge tool result is clipped for the model but kept whole in the record", async () => {
  const big = "x".repeat(50000);
  const { llm, requests } = scripted([toolTurn(call("c1", "t", {})), textTurn("ok")]);
  const out = await runAsk({ llm, route, tools: [tool("t", async () => big)], messages: say("q"), settings });
  assert.equal(out.steps[0].result.length, 50000);
  const fed = requests[1].messages[2].content[0].text;
  assert.ok(fed.length < 13000 && /omitted/.test(fed));
});

test("a model that exhausts the tool budget must summarize collected evidence", async () => {
  const turns = [
    ...Array.from({ length: MAX_STEPS }, () => toolTurn(call("c", "t", {}))),
    textTurn("根据已经查到的记录，目前可以确认……（覆盖可能不完整）"),
  ];
  const { llm, requests } = scripted(turns);
  const out = await runAsk({ llm, route, tools: [tool("t", async () => "x")], messages: say("q"), settings });
  assert.equal(out.ok, true);
  assert.equal(out.partial, true);
  assert.match(out.answer, /覆盖可能不完整/);
  assert.equal(out.steps.filter(s => s.kind === "call").length, MAX_STEPS);
  assert.deepEqual(requests.at(-1).tools, [], "the final synthesis cannot request another tool");
});

test("exhausting the tool budget without evidence skips synthesis", async () => {
  const turns = Array.from({ length: MAX_STEPS }, (_, index) => toolTurn(call(`read-${index}`, "focus_read_session", {})));
  const { llm, requests } = scripted(turns);
  const tools = [tool("focus_read_session", async () => { throw new Error("Unavailable"); })];
  const result = await runAsk({ llm, route, tools, messages: say("q"), settings, requireEvidence: true });
  assert.equal(result.reason, "no-evidence");
  assert.deepEqual(result.coverageReasons, ["tool-error", "tool-budget"]);
  assert.equal(requests.length, MAX_STEPS);
});

test("provider failures, empty answers and a missing model are reported, not thrown", async () => {
  const failed = await runAsk({ llm: scripted([[{ type: "finish", reason: { kind: "error", failure: { code: "rate_limit", message: "slow down" } } }]]).llm, route, tools: [], messages: say("q"), settings });
  assert.deepEqual([failed.ok, failed.reason], [false, "failed"]);
  assert.match(failed.detail, /rate_limit: slow down/);

  const empty = await runAsk({ llm: scripted([[{ type: "finish", reason: { kind: "stop" } }]]).llm, route, tools: [], messages: say("q"), settings });
  assert.deepEqual([empty.ok, empty.reason], [false, "empty"]);

  const thrown = await runAsk({ llm: { stream() { throw new Error("boom"); } }, route, tools: [], messages: say("q"), settings });
  assert.deepEqual([thrown.ok, thrown.reason], [false, "failed"]);

  assert.equal((await runAsk({ llm: undefined, route, tools: [], messages: say("q"), settings })).reason, "no-llm");
  assert.equal((await runAsk({ llm: scripted([]).llm, route: undefined, tools: [], messages: say("q"), settings })).reason, "no-model");
});

test("aborting stops the loop and does not run further tools", async () => {
  const controller = new AbortController();
  let ran = 0;
  const { llm } = scripted([toolTurn(call("c1", "t", {})), textTurn("late")]);
  const tools = [tool("t", async () => { ran++; controller.abort(); return "x"; })];
  await assert.rejects(runAsk({ llm, route, tools, messages: say("q"), settings, signal: controller.signal }));
  assert.equal(ran, 1);
});

test("the person's timezone and the current time are given to the model", async () => {
  const { llm, requests } = scripted([textTurn("ok")]);
  await runAsk({ llm, route, tools: [], messages: say("上周"), settings, offsetMinutes: 480, now: () => new Date("2026-10-29T04:00:00Z") });
  assert.match(requests[0].system, /NOW: 2026-10-29T04:00:00.000Z/);
  assert.match(requests[0].system, /UTC\+08:00/);
  assert.match(requests[0].system, /offsetMinutes=480/);
});

test("Ask leaves maxTokens unset so the provider can use its default", async () => {
  const { llm, requests } = scripted([textTurn("ok")]);
  await runAsk({ llm, route, tools: [], messages: say("q"), settings: { temperature: null, maxTokens: 1024 } });
  assert.ok(!("maxTokens" in requests[0]));
});

test("an unset temperature is not sent; a set one is", async () => {
  const a = scripted([textTurn("ok")]);
  await runAsk({ llm: a.llm, route, tools: [], messages: say("q"), settings: { temperature: null, maxTokens: 2048 } });
  assert.ok(!("temperature" in a.requests[0]));
  const b = scripted([textTurn("ok")]);
  await runAsk({ llm: b.llm, route, tools: [], messages: say("q"), settings: { temperature: 0.2, maxTokens: 2048 } });
  assert.equal(b.requests[0].temperature, 0.2);
});

test("onStep sees each step as it happens, including a call while it is still running", async () => {
  const log = [];
  const { llm } = scripted([toolTurn(call("c1", "t", {})), textTurn("ok")]);
  await runAsk({ llm, route, tools: [tool("t", async () => "x")], messages: say("q"), settings, onStep: (step) => log.push(`${step.kind}:${step.status ?? ""}`) });
  assert.deepEqual(log, ["call:running", "call:done", "answer:"]);
});

test("readTurn collects text, tool-call blocks and the finish state", async () => {
  const turn = await readTurn(chunks([
    { type: "text-delta", index: 0, text: "先 " }, { type: "text-delta", index: 0, text: "查" },
    call("c1", "t", { a: 1 }),
    { type: "finish", reason: { kind: "tool-calls" }, replayState: { response: 1 } },
  ]));
  assert.equal(turn.text, "先 查");
  assert.equal(turn.calls.length, 1);
  assert.equal(turn.finish.kind, "tool-calls");
  assert.deepEqual(turn.replayState, { response: 1 });
});

test("a follow-up continues the same message list: the model sees the earlier turns", async () => {
  const messages = say("上周做了什么");
  const first = scripted([textTurn("主要在做检索。")]);
  const one = await runAsk({ llm: first.llm, route, tools: [], messages, settings });
  assert.equal(one.ok, true);
  // The list now holds the question and the answer; nothing was copied away.
  assert.deepEqual(messages.map(m => m.role), ["user", "assistant"]);

  messages.push({ role: "user", content: [{ type: "text", text: "那具体是哪个项目？" }] });
  const second = scripted([textTurn("是 dsh-focusing。")]);
  const two = await runAsk({ llm: second.llm, route, tools: [], messages, settings });
  assert.equal(two.answer, "是 dsh-focusing。");
  const sent = second.requests[0].messages;
  assert.deepEqual(sent.map(m => m.role), ["user", "assistant", "user"], "the whole thread goes to the model");
  assert.equal(sent[1].content[0].text, "主要在做检索。");
  assert.deepEqual(messages.map(m => m.role), ["user", "assistant", "user", "assistant"]);
});

test("earlier tool calls stay in the thread, so a follow-up can build on what was found", async () => {
  const messages = say("找登录相关");
  const a = scripted([toolTurn(call("c1", "t", {})), textTurn("2 个。")]);
  await runAsk({ llm: a.llm, route, tools: [tool("t", async () => "RESULT")], messages, settings });
  messages.push(...say("第一个呢"));
  const b = scripted([textTurn("它是…")]);
  await runAsk({ llm: b.llm, route, tools: [tool("t", async () => "RESULT")], messages, settings });
  const roles = b.requests[0].messages.map(m => m.role);
  assert.deepEqual(roles, ["user", "assistant", "tool", "assistant", "user"]);
  assert.equal(b.requests[0].messages[2].content[0].text, "RESULT");
});
