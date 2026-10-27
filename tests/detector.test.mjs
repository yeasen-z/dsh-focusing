// Tests for the pure halves: the detector and the correction text.
// Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { LoopDetector, fingerprintCall } from "../lib/detector.mjs";
import { buildCorrection, summarizeSignal } from "../lib/correction.mjs";

function call(name, args, kind) {
  return { name, args, kind, fp: fingerprintCall(name, args, kind) };
}

function step(detector, turn, n, c, { failed = false, error = "", content } = {}) {
  return detector.observeStep({
    turn,
    step: n,
    toolName: c?.name ?? "misc",
    toolKind: c?.kind,
    call: c?.fp,
    result:
      failed || content
        ? { isError: failed, content: [{ type: "text", text: error || JSON.stringify(content ?? "") }] }
        : { isError: false, content: [{ type: "text", text: `ok-${n}` }] },
  });
}

test("identical edits to the same file are one fingerprint regardless of path form", () => {
  const a = fingerprintCall("edit", { path: "./src/app.ts", old_string: "x", new_string: "y" }, "edit");
  const b = fingerprintCall("edit", { file_path: "/w/src/app.ts", old_string: "p", new_string: "q" }, "edit");
  assert.equal(a.file, "src/app.ts");
  assert.equal(a.fingerprint, b.fingerprint);
});

test("different commands are different fingerprints", () => {
  const a = fingerprintCall("bash", { command: "npm test" }, "execute");
  const b = fingerprintCall("bash", { command: "npm run build" }, "execute");
  assert.notEqual(a.fingerprint, b.fingerprint);
});

test("whitespace and case do not create a fake difference", () => {
  const a = fingerprintCall("bash", { command: "npm   test" }, "execute");
  const b = fingerprintCall("bash", { command: "NPM TEST" }, "execute");
  assert.equal(b.cmd, "npm test");
  assert.equal(a.fingerprint, b.fingerprint);
});

test("a healthy session produces no signals", () => {
  const d = new LoopDetector({ windowSteps: 14 });
  const edits = ["a.ts", "b.ts", "c.ts", "d.ts"];
  edits.forEach((f, i) => step(d, 1, i + 1, call("edit", { path: `src/${f}` }, "edit")));
  const verdict = d.assess({ threshold: 3 }, { turnSteps: 4 });
  assert.deepEqual(verdict.signals, []);
  assert.equal(verdict.risk, 0);
});

test("the same call three times raises same-call at the threshold", () => {
  const d = new LoopDetector({ windowSteps: 14 });
  const c = call("edit", { path: "src/app.ts" }, "edit");
  for (let i = 1; i <= 3; i += 1) step(d, 1, i, c);
  const verdict = d.assess({ threshold: 3 }, { turnSteps: 3 });
  const kinds = verdict.signals.map(s => s.kind);
  assert.ok(kinds.includes("same-call"), kinds.join(","));
  assert.equal(verdict.repeats, 3);
  assert.ok(verdict.risk > 0.5);
});

test("below the threshold nothing fires", () => {
  const d = new LoopDetector({ windowSteps: 14 });
  const c = call("edit", { path: "src/app.ts" }, "edit");
  step(d, 1, 1, c);
  step(d, 1, 2, c);
  assert.deepEqual(d.assess({ threshold: 3 }, { turnSteps: 2 }).signals, []);
});

test("an identical error twice is a stronger signal than repetition alone", () => {
  const d = new LoopDetector({ windowSteps: 14 });
  const c = call("bash", { command: "npm test" }, "execute");
  step(d, 1, 1, c, { failed: true, error: "TypeError: x is not a function" });
  step(d, 1, 2, c, { failed: true, error: "TypeError: x is not a function" });
  const verdict = d.assess({ threshold: 3 }, { turnSteps: 2 });
  const failing = verdict.signals.find(s => s.kind === "same-failing-result");
  assert.ok(failing, "expected same-failing-result");
  assert.equal(failing.count, 2);
});

test("different errors on the same command do not claim a repeated error", () => {
  const d = new LoopDetector({ windowSteps: 14 });
  const c = call("bash", { command: "npm test" }, "execute");
  step(d, 1, 1, c, { failed: true, error: "Error A" });
  step(d, 1, 2, c, { failed: true, error: "Error B" });
  const verdict = d.assess({ threshold: 3 }, { turnSteps: 2 });
  assert.equal(verdict.signals.find(s => s.kind === "same-failing-result"), undefined);
});

test("the step budget fires on the turn total the caller supplies", () => {
  const d = new LoopDetector({ windowSteps: 4 });
  step(d, 1, 1, call("read", { path: "a.ts" }, "read"));
  const verdict = d.assess({ threshold: 3, maxStepsPerTurn: 25 }, { turnSteps: 25 });
  assert.ok(verdict.signals.some(s => s.kind === "step-budget"));
  assert.equal(verdict.risk, 1);
});

test("a new turn clears the window so the previous turn cannot keep firing", () => {
  const d = new LoopDetector({ windowSteps: 14 });
  const c = call("edit", { path: "src/app.ts" }, "edit");
  for (let i = 1; i <= 4; i += 1) step(d, 1, i, c);
  assert.ok(d.assess({ threshold: 3 }, { turnSteps: 4 }).signals.length > 0);
  d.setTurn(2);
  assert.deepEqual(d.assess({ threshold: 3 }, { turnSteps: 0 }).signals, []);
});

test("the original goal is captured once and survives later turns' noise", () => {
  const d = new LoopDetector({ windowSteps: 14 });
  d.observeUser("重构 auth 模块，不要改接口");
  d.observeUser("顺便看看为什么 CI 挂了");
  assert.equal(d.originalGoal, "重构 auth 模块，不要改接口");
});

test("the window is bounded", () => {
  const d = new LoopDetector({ windowSteps: 5 });
  for (let i = 1; i <= 20; i += 1) step(d, 1, i, call("read", { path: `f${i}.ts` }, "read"));
  assert.equal(d.window.length, 5);
});

test("the correction names the file, the count, and the original goal", () => {
  const d = new LoopDetector({ windowSteps: 14 });
  d.observeUser("让登录页在移动端不再横向滚动");
  const c = call("edit", { path: "src/pages/Login.tsx" }, "edit");
  for (let i = 1; i <= 4; i += 1) step(d, 1, i, c);
  const verdict = d.assess({ threshold: 3 }, { turnSteps: 4 });
  const text = buildCorrection({ verdict, snapshot: { ...d.snapshot(), turnSteps: 4 }, now: Date.now() });
  assert.match(text, /Login\.tsx/);
  assert.match(text, /4 次/);
  assert.match(text, /横向滚动/);
  assert.match(text, /全局视角/);
});

test("a subagent conclusion is quoted inside the correction", () => {
  const d = new LoopDetector({ windowSteps: 14 });
  const c = call("bash", { command: "npm test" }, "execute");
  for (let i = 1; i <= 3; i += 1) step(d, 1, i, c, { failed: true, error: "boom" });
  const verdict = d.assess({ threshold: 3 }, { turnSteps: 3 });
  const text = buildCorrection({
    verdict,
    snapshot: { ...d.snapshot(), turnSteps: 3 },
    subagentConclusion: "这是一个真实的循环：测试根本不存在。",
  });
  assert.match(text, /测试根本不存在/);
  assert.match(text, /独立分析者/);
});

test("signal summaries are one line", () => {
  const line = summarizeSignal({ kind: "same-call", count: 3, call: { file: "a/b.ts" } });
  assert.equal(line, "编辑重复：a/b.ts ×3");
  assert.ok(!line.includes("\n"));
});
