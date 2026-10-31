import test from "node:test";
import assert from "node:assert/strict";
import { resolveRange, inferRangeKey, localDate } from "../lib/time-range.mjs";
import { foldRecord, isPersonal, sliceRecord, recordSummary, rangeStats, humanRequest } from "../lib/context-records.mjs";
import { DIGEST_SYSTEM, extractJson, normalizeDigest, draftDigest, buildContextBlock, buildDigestPrompt, digestToMarkdown } from "../lib/digest.mjs";
import { revisionMtime } from "../lib/record-index.mjs";
import { requestKind } from "../lib/context-routes.mjs";

const H = 3600000;
// Tuesday 2026-10-27 14:00 in UTC+8.
const NOW = Date.UTC(2026, 9, 27, 6, 0, 0);
const OFF = 480;

test("this week starts on Monday in the person's zone", () => {
  const r = resolveRange("this-week", { now: NOW, offsetMin: OFF });
  assert.equal(r.from, "2026-10-26");
  assert.equal(r.to, "2026-10-27");
  assert.equal(localDate(r.start, OFF), "2026-10-26");
  assert.equal(new Date(r.start).toISOString(), "2026-10-25T16:00:00.000Z");
});

test("last week and yesterday are closed ranges", () => {
  const lw = resolveRange("last-week", { now: NOW, offsetMin: OFF });
  assert.equal(lw.from, "2026-10-19");
  assert.equal(lw.to, "2026-10-25");
  const y = resolveRange("yesterday", { now: NOW, offsetMin: OFF });
  assert.equal(y.from, "2026-10-26");
  assert.equal(y.to, "2026-10-26");
});

test("all time is a range like any other, with no lower bound", () => {
  const all = resolveRange("all", { now: NOW, offsetMin: OFF, locale: "zh" });
  assert.equal(all.key, "all");
  assert.equal(all.start, 0, "nothing is left out");
  assert.equal(all.label, "全部");
  assert.equal(all.to, "2026-10-27");
  assert.equal(resolveRange("all", { now: NOW, offsetMin: OFF, locale: "en" }).label, "All");
});

test("the range is inferred from the request words", () => {
  assert.equal(inferRangeKey("整理我这周干了什么，进度如何"), "this-week");
  assert.equal(inferRangeKey("总结今天各会话的进展"), "today");
  assert.equal(inferRangeKey("上周我主要在做什么"), "last-week");
  assert.equal(inferRangeKey("本月每个项目的进展"), "this-month");
  assert.equal(inferRangeKey("最近7天"), "last-7d");
  assert.equal(inferRangeKey("帮我写交接文档"), undefined);
});

const ev = (type, time, data) => ({ type, time, data });
function sampleLog(base) {
  return [
    ev("user/message", base, { source: { kind: "runtime-context" }, content: [{ type: "text", text: "Current runtime context. ..." }] }),
    ev("user/message", base + 1, { source: { kind: "user" }, content: [{ type: "text", text: "修复登录测试\n<system-reminder>skills…" }] }),
    ev("turn/start", base + 2, { turn: 1 }),
    ev("session/title", base + 3, { title: "修复登录" }),
    ev("tool/call", base + 4, { turn: 1, step: 1, callId: "a", name: "edit", arguments: JSON.stringify({ path: "/w/app/src/auth.ts", old_string: "x", new_string: "y" }) }),
    ev("tool/result", base + 5, { turn: 1, message: { toolCallId: "a", content: [{ type: "text", text: "ok" }] } }),
    ev("tool/call", base + 6, { turn: 1, step: 2, callId: "b", name: "bash", arguments: JSON.stringify({ command: "pnpm test" }) }),
    ev("tool/result", base + 7, { turn: 1, message: { toolCallId: "b", content: [{ type: "text", text: "fail [exit code: 1]" }] } }),
    ev("todo/write", base + 8, { todos: [{ content: "fix", status: "completed" }, { content: "verify", status: "pending" }] }),
    ev("assistant/message", base + 9, { turn: 1, message: { role: "assistant", content: [{ type: "text", text: "已修复，测试还剩 1 个失败。" }] } }),
    ev("turn/end", base + 10, { turn: 1, reason: { kind: "completed" } }),
  ];
}

test("a session log folds into a context record", () => {
  const base = NOW - 2 * H;
  const rec = foldRecord(sampleLog(base), { id: "s1", cwd: "/w/app", createdAt: base });
  assert.equal(rec.title, "修复登录");
  assert.equal(rec.project, "app");
  assert.equal(rec.turns.length, 1);
  const t = rec.turns[0];
  assert.deepEqual(t.requests.map(r => r.text), ["修复登录测试"], "injected context is not a request");
  assert.equal(t.calls, 2);
  assert.equal(t.failed, 1);
  assert.deepEqual(t.files, ["/w/app/src/auth.ts"]);
  assert.deepEqual(t.commands, ["pnpm test"]);
  assert.match(t.reply, /1 个失败/);
  assert.equal(rec.todos.length, 2);
  assert.ok(isPersonal(rec));
});

test("subagent sessions are not the person's own work", () => {
  const rec = foldRecord(sampleLog(NOW), { id: "c", cwd: "/w", origin: "subagent", delegationDepth: 1 });
  assert.equal(isPersonal(rec), false);
});

test("slicing keeps only turns inside the range", () => {
  const old = sampleLog(NOW - 20 * 24 * H);
  const recent = sampleLog(NOW - H).map(e => (e.data?.turn === 1 ? { ...e, data: { ...e.data, turn: 2 } } : e));
  const rec = foldRecord([...old, ...recent], { id: "s", cwd: "/w/app" });
  assert.equal(rec.turns.length, 2);
  const range = resolveRange("this-week", { now: NOW, offsetMin: OFF });
  const slice = sliceRecord(rec, range, at => localDate(at, OFF));
  assert.equal(slice.turns, 1);
  assert.deepEqual(slice.days.map(d => d.day), ["2026-10-27"]);
  const summary = recordSummary(slice);
  assert.equal(summary.todosDone, 1);
  assert.equal(summary.todosTotal, 2);
  assert.equal(sliceRecord(rec, resolveRange("today", { now: NOW - 10 * 24 * H, offsetMin: OFF }), x => x), null);
  assert.deepEqual(rangeStats([slice]), { sessions: 1, projects: 1, activeDays: 1, turns: 1, calls: 2, failed: 1, files: 1 });
});

test("humanRequest keeps the request before appended context", () => {
  assert.equal(humanRequest({ content: [{ type: "text", text: "hello\nCurrent runtime context. x" }] }), "hello");
  assert.equal(humanRequest({ source: { kind: "skill-catalog" }, content: "x" }), "");
});

test("model JSON is extracted from fences and prose", () => {
  assert.deepEqual(extractJson('here:\n```json\n{"a":{"b":"}"}}\n```'), { a: { b: "}" } });
  assert.deepEqual(extractJson('prefix {"x":1} suffix'), { x: 1 });
  assert.equal(extractJson("no json"), undefined);
});

test("the report contract asks for complete explanations with evidence, not terse labels", () => {
  assert.match(DIGEST_SYSTEM, /do not reduce a project to its session titles/);
  assert.match(DIGEST_SYSTEM, /full sentence with the change or outcome and its evidence/);
  assert.match(DIGEST_SYSTEM, /3-6 sentences/);
  assert.match(DIGEST_SYSTEM, /Do not pad/);
  assert.doesNotMatch(DIGEST_SYSTEM, /Be concise and concrete/);
});

test("digest output is validated and unknown session ids dropped", () => {
  const d = normalizeDigest({
    title: "本周", summary: "s", projects: [{ name: "app", progress: "140", status: "weird", items: [{ state: "x", text: "t", sessions: ["s1", "ghost"] }, { text: "" }] }],
    days: [{ day: "2026-10-27", items: [{ text: "a" }] }, { day: "", items: [] }], next: ["n", 3],
  }, new Set(["s1"]));
  assert.equal(d.projects[0].progress, 100);
  assert.equal(d.projects[0].status, "active");
  assert.deepEqual(d.projects[0].items, [{ state: "doing", text: "t", sessions: ["s1"] }]);
  assert.equal(d.days.length, 1);
  assert.deepEqual(d.next, ["n"]);
});

test("a draft digest is built from facts when no model answers", () => {
  const range = resolveRange("this-week", { now: NOW, offsetMin: OFF });
  const rec = foldRecord(sampleLog(NOW - H), { id: "s1", cwd: "/w/app" });
  const slice = sliceRecord(rec, range, at => localDate(at, OFF));
  const draft = normalizeDigest(draftDigest({ range, slices: [slice] }));
  assert.equal(draft.projects[0].name, "app");
  assert.equal(draft.projects[0].items[0].text, "修复登录");
  assert.match(draft.summary, /1 个会话/);
  const prompt = buildDigestPrompt({ request: "整理本周", range, slices: [slice] });
  assert.match(prompt, /files edited \(1\): src\/auth\.ts/);
  const md = digestToMarkdown({ request: "整理本周", range, stats: rangeStats([slice]), result: draft, followups: [{ q: "q", a: "a" }] });
  assert.match(md, /^# 本周工作整理/);
  assert.match(md, /\*\*问：\*\* q/);
});

test("the context block stays within budget by condensing old sessions", () => {
  const range = resolveRange("this-month", { now: NOW, offsetMin: OFF });
  const slices = Array.from({ length: 60 }, (_, i) => {
    const log = sampleLog(NOW - (i + 1) * H).map(e => e.type === "assistant/message"
      ? { ...e, data: { ...e.data, message: { content: [{ type: "text", text: "x".repeat(2000) }] } } } : e);
    return sliceRecord(foldRecord(log, { id: `s${i}`, cwd: "/w/app" }), range, at => localDate(at, OFF));
  });
  const block = buildContextBlock(slices, 20000);
  assert.ok(block.text.length < 23000);
  assert.ok(block.omitted > 0);
  assert.match(block.text, /more sessions \(titles only\)/);
});

test("persistence revisions expose their mtime", () => {
  assert.equal(revisionMtime("16777232:123:4567:1793080906683000000:1793080906683000000"), 1793080906683);
  assert.equal(revisionMtime("p-1"), undefined);
});

test("request kinds label results", () => {
  assert.equal(requestKind("整理我这周干了什么", "this-week"), "weekly");
  assert.equal(requestKind("总结今天", "today"), "daily");
  assert.equal(requestKind("写交接文档", "session"), "handoff");
  assert.equal(requestKind("分析为什么卡住", "this-week"), "analysis");
});
