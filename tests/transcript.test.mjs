import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTranscript, transcriptToMarkdown, blocksToText } from "../lib/transcript.mjs";

const text = (...parts) => parts.map(t => ({ type: "text", text: t }));
const event = (type, data, time = 100) => ({ type, data, time });
const human = (value, time = 1) => event("user/message", { role: "user", source: { kind: "user" }, content: text(value) }, time);
const assistant = (value, turn = 1, step = 1, time = 2) =>
  event("assistant/message", { turn, step, message: { role: "assistant", source: { kind: "model" }, content: text(value) } }, time);
const call = (id, name, args, turn = 1, step = 1, time = 3) =>
  event("tool/call", { turn, step, callId: id, name, arguments: typeof args === "string" ? args : JSON.stringify(args) }, time);
const result = (id, value, turn = 1, step = 1, extra = {}, time = 4) =>
  event("tool/result", { turn, step, message: { toolCallId: id, content: text(value), ...extra } }, time);

test("transcript keeps the person's words and drops injected context", () => {
  const { turns, totalMessages } = buildTranscript([
    event("turn/start", { turn: 1 }, 0),
    human("Current runtime context. Snapshot", 1),
    event("user/message", { role: "user", source: { kind: "focusing" }, content: text("Correction text") }, 2),
    human("请修复登录问题", 3),
    assistant("我先看一下代码。", 1, 1, 4),
  ]);
  assert.equal(totalMessages, 2);
  assert.equal(turns[0].messages[0].role, "user");
  assert.equal(turns[0].messages[0].text, "请修复登录问题");
  assert.equal(turns[0].messages[1].role, "assistant");
});

test("tool calls carry their own result and failure state", () => {
  const { turns } = buildTranscript([
    event("turn/start", { turn: 1 }, 0),
    human("run tests"),
    assistant("running", 1, 1),
    call("c1", "Bash", { command: "pnpm test" }, 1, 1, 10),
    result("c1", "all good", 1, 1, {}, 20),
    call("c2", "Bash", { command: "pnpm build" }, 1, 2, 30),
    result("c2", "boom", 1, 2, { isError: true }, 40),
  ]);
  const tools = turns[0].messages.filter(m => m.role === "tool");
  assert.equal(tools.length, 2);
  assert.equal(tools[0].result, "all good");
  assert.equal(tools[0].isError, false);
  assert.equal(tools[0].completedAt, 20);
  assert.equal(tools[1].isError, true);
  assert.equal(tools[1].name, "Bash");
});

test("a tool call with no result is exported as unfinished, not successful", () => {
  const { turns } = buildTranscript([
    event("turn/start", { turn: 1 }, 0),
    human("go"),
    call("c1", "Read", { path: "a.ts" }, 1, 1),
  ]);
  const tool = turns[0].messages.find(m => m.role === "tool");
  assert.equal(tool.completedAt, null);
  assert.equal(tool.isError, false);
  const md = transcriptToMarkdown({ turns });
  assert.match(md, /未完成/);
});

test("turns are grouped and turn boundaries are recorded", () => {
  const { turns } = buildTranscript([
    event("turn/start", { turn: 1 }, 0),
    human("first"),
    assistant("a1", 1, 1),
    event("turn/end", { turn: 1, reason: { kind: "completed" } }, 50),
    event("turn/start", { turn: 2 }, 60),
    human("second", 61),
    assistant("a2", 2, 1),
  ]);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].endReason, "completed");
  assert.equal(turns[0].messages[0].text, "first");
  assert.equal(turns[1].messages[0].text, "second");
});

test("markdown export is readable and marks failed tools", () => {
  const { turns } = buildTranscript([
    event("turn/start", { turn: 1 }, 0),
    human("修 bug"),
    assistant("好的，先看报错。", 1, 1),
    call("c1", "Bash", { command: "pnpm test" }, 1, 1, 10),
    result("c1", "FAIL", 1, 1, { isError: true }, 20),
  ]);
  const md = transcriptToMarkdown({ turns }, { title: "修 bug 的会话", project: "my-app", session: "s1", goal: "修 bug" });
  assert.match(md, /^# 修 bug 的会话/m);
  assert.match(md, /## 第 1 轮/);
  assert.match(md, /### 你/);
  assert.match(md, /### 助手/);
  assert.match(md, /工具调用 · Bash · 失败/);
  assert.match(md, /pnpm test/);
  assert.match(md, /FAIL/);
});

test("very long tool output is bounded", () => {
  const { turns } = buildTranscript([
    event("turn/start", { turn: 1 }, 0),
    human("x"),
    call("c1", "Bash", { command: "y" }),
    result("c1", "Z".repeat(9000)),
  ]);
  const tool = turns[0].messages.find(m => m.role === "tool");
  assert.equal(tool.result.length, 4000);
});

test("fenced code inside output still exports as valid markdown", () => {
  const md = transcriptToMarkdown({
    turns: [{
      turn: 1,
      messages: [{ role: "tool", name: "Read", arguments: "a", result: "```js\nconst a = 1\n```", isError: false, completedAt: 1 }],
    }],
  });
  assert.match(md, /````/);
  assert.ok(blocksToText(text("a", "b")) === "a\n\nb");
});
