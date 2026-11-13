import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseSession, resolveClaudeHome, listSessionFiles, createClaudeIndex, createClaudeRoster, createClaudeRecords,
} from "../lib/claude-code.mjs";
import { foldRecord, isPersonal } from "../lib/context-records.mjs";

const row = (type, timestamp, extra = {}) => JSON.stringify({ type, timestamp, sessionId: "session-1", cwd: "/work/app", ...extra });
const at = second => `2026-11-01T02:00:${String(second).padStart(2, "0")}.000Z`;
const user = (text, second, extra = {}) => row("user", at(second), {
  uuid: `u${second}`, userType: "external", isSidechain: false,
  message: { role: "user", content: text }, ...extra,
});
const assistant = (content, second) => row("assistant", at(second), {
  uuid: `a${second}`, message: { role: "assistant", content },
});

const transcript = [
  JSON.stringify({ type: "summary", summary: "修复登录问题", leafUuid: "later" }),
  user("修一下登录", 1),
  assistant([{ type: "thinking", thinking: "private" }, { type: "text", text: "先检查代码" }], 2),
  assistant([{ type: "tool_use", id: "toolu_1", name: "Edit", input: { file_path: "/work/app/auth.js", old_string: "a", new_string: "b" } }], 3),
  row("user", at(4), { message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "permission denied", is_error: true }] } }),
  assistant([{ type: "text", text: "需要调整方案" }], 5),
  user("不要把这个子代理消息算进来", 6, { isSidechain: true }),
  user("<system-reminder>internal only</system-reminder>", 7, { isMeta: true }),
  user("再检查测试", 8),
  assistant([{ type: "text", text: "测试已经通过" }], 9),
  "not json",
].join("\n");

test("Claude records become normalized turns, messages and linked tool calls", () => {
  const { header, events } = parseSession(transcript);
  assert.equal(header.id, "session-1");
  assert.equal(header.source, "claude");
  assert.equal(header.cwd, "/work/app");
  assert.equal(header.title, "修复登录问题");
  assert.equal(header.createdAt, Date.parse(at(1)));
  assert.deepEqual(events.filter(e => e.type === "user/message").map(e => e.data.content[0].text), ["修一下登录", "再检查测试"]);
  assert.equal(events.filter(e => e.type === "turn/start").length, 2);
  assert.equal(events.filter(e => e.type === "turn/end").length, 2, "the next prompt and EOF close turns");
  assert.equal(events.find(e => e.type === "session/title").data.title, "修复登录问题");
  const call = events.find(e => e.type === "tool/call");
  assert.equal(call.data.callId, "toolu_1");
  assert.equal(call.data.turn, 1);
  const result = events.find(e => e.type === "tool/result");
  assert.equal(result.data.message.toolCallId, "toolu_1");
  assert.equal(result.data.message.isError, true);
});

test("the normalized events retain review evidence without counting sidechains or tool envelopes", () => {
  const { header, events } = parseSession(transcript);
  const record = foldRecord(events, { ...header, id: `claude:${header.id}`, readOnly: true });
  assert.equal(record.turns.length, 2);
  assert.equal(record.turns[0].requests[0].text, "修一下登录");
  assert.equal(record.turns[0].calls, 1);
  assert.equal(record.turns[0].failed, 1);
  assert.deepEqual(record.turns[0].files, ["/work/app/auth.js"]);
  assert.equal(record.turns[1].reply, "测试已经通过");
  assert.equal(record.title, "修复登录问题");
  assert.equal(isPersonal(record), true);
});

test("string tool results and toolUseResult metadata never become user prompts", () => {
  const text = [
    user("run a command", 1),
    assistant([{ type: "tool_use", id: "toolu_b", name: "Bash", input: { command: "npm test" } }], 2),
    row("user", at(3), {
      toolUseResult: { stdout: "ok", stderr: "" },
      message: { role: "user", content: "ok" },
    }),
    assistant([{ type: "text", text: "done" }], 4),
  ].join("\n");
  const { events } = parseSession(text);
  assert.equal(events.filter(e => e.type === "user/message").length, 1);
  assert.equal(events.filter(e => e.type === "tool/call").length, 1);
});

test("sidechains cannot supply session identity, metadata or title events", () => {
  const sidechain = [
    user("agent task", 0, { isSidechain: true, cwd: "/agent/work" }),
    row("summary", at(0), { isSidechain: true, summary: "Agent title" }),
  ].join("\n");
  const only = parseSession(sidechain);
  assert.deepEqual(only.header, { id: null, cwd: "", createdAt: null, source: "claude", title: "" });
  assert.deepEqual(only.events, []);
  const mixed = parseSession(`${sidechain}\n${transcript}\n${sidechain}`);
  assert.deepEqual(mixed, parseSession(transcript), "sidechains before and after the main records cannot change its metadata");
});

function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), "focusing-claude-fixture-"));
  const project = join(home, "projects", "-work-app");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "session-1.jsonl"), transcript);
  return home;
}

test("Claude discovery accepts CLAUDE_CONFIG_DIR and a manual projects folder", () => {
  const home = fakeHome();
  try {
    assert.deepEqual(resolveClaudeHome({}, { CLAUDE_CONFIG_DIR: home }), { ok: true, home, via: "env" });
    assert.deepEqual(resolveClaudeHome({ mode: "manual", path: join(home, "projects") }), { ok: true, home, via: "manual" });
    assert.equal(resolveClaudeHome({ mode: "manual", path: home }).ok, true);
    assert.equal(resolveClaudeHome({ mode: "manual", path: join(home, "missing") }).reason, "missing");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("discovery skips independent subagents while retaining nested main sessions", () => {
  const home = fakeHome();
  try {
    const project = join(home, "projects", "-work-app");
    const nested = join(project, "session-1", "nested");
    const agents = join(project, "session-1", "subagents", "nested");
    mkdirSync(nested, { recursive: true });
    mkdirSync(agents, { recursive: true });
    writeFileSync(join(nested, "main.jsonl"), transcript);
    // Discovery must exclude independent logs even without isSidechain flags.
    writeFileSync(join(agents, "agent.jsonl"), transcript);
    assert.deepEqual(listSessionFiles(home).map(file => file.path).sort(), [
      join(project, "session-1.jsonl"), join(nested, "main.jsonl"),
    ].sort());
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("an earlier sidechain with the parent id cannot mask the main session, including with an old cache", async () => {
  const home = fakeHome();
  const cacheFile = join(home, "claude-index.json");
  try {
    const agent = join(home, "projects", "-work-app", "000-agent.jsonl");
    writeFileSync(agent, user("agent task", 0, { isSidechain: true }));
    const files = listSessionFiles(home);
    assert.equal(files[0].path, agent, "exercise the former first-match collision");
    const oldEntries = Object.fromEntries(files.map(({ path }) => {
      const stats = statSync(path);
      return [path, { key: `${stats.size}:${stats.mtimeMs}`, archived: false, summary: {
        id: "session-1", title: "stale agent title", cwd: "/agent/work", turns: 0, userMessages: 0, dayTurns: [],
      } }];
    }));
    writeFileSync(cacheFile, JSON.stringify({ version: 1, source: "claude", home, entries: oldEntries }));
    const index = createClaudeIndex({ home, cacheFile, fold: foldRecord });
    assert.deepEqual(index.refresh(), [], "old summaries are rejected before any refresh can expose them");
    assert.equal(index.stale().length, 2, "unchanged files must be reparsed after the semantic change");
    await index.settle();
    const summaries = index.refresh();
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].path, join(home, "projects", "-work-app", "session-1.jsonl"));
    const rows = createClaudeRoster(home, index).rows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, "修复登录问题");
    assert.equal(rows[0].turns, 2);
    assert.equal(createClaudeRecords(home, index).records().length, 1);
    const restarted = createClaudeIndex({ home, cacheFile, fold: foldRecord });
    assert.equal(restarted.refresh().length, 1);
    assert.equal(restarted.stale().length, 0);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("Claude summaries feed the roster and calendar and survive restart without reparsing", async () => {
  const home = fakeHome();
  const cacheFile = join(home, "claude-index.json");
  try {
    let reads = 0;
    const fold = (events, header) => { reads += 1; return foldRecord(events, header); };
    const first = createClaudeIndex({ home, fold, cacheFile });
    await first.settle();
    const rows = createClaudeRoster(home, first).rows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "claude:session-1");
    assert.equal(rows[0].source, "claude");
    assert.equal(rows[0].title, "修复登录问题");
    assert.equal(rows[0].turns, 2);
    assert.equal(createClaudeRecords(home, first).records()[0].turns.length, 2);
    assert.equal(reads, 1);

    const after = createClaudeIndex({ home, fold, cacheFile });
    assert.equal(createClaudeRoster(home, after).rows().length, 1);
    assert.equal(reads, 1, "an unchanged cache is reused after restart");
    await after.settle();
    assert.equal(reads, 1);

    const file = join(home, "projects", "-work-app", "session-1.jsonl");
    writeFileSync(file, `${readFileSync(file, "utf8")}\n${user("third turn", 10)}\n${assistant([{ type: "text", text: "ok" }], 11)}`);
    await after.settle();
    assert.equal(after.refresh()[0].turns, 3, "an appended session is reindexed");
    assert.equal(reads, 2);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
