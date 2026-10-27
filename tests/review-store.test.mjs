import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, realpathSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReviewStore, trailSince, PER_SESSION } from "../lib/review-store.mjs";

const dir = realpathSync(mkdtempSync(join(tmpdir(), "focusing-reviews-test-")));
after(() => { if (dir.startsWith(realpathSync(tmpdir()))) rmSync(dir, { recursive: true, force: true }); });

const review = (at, extra = {}) => ({ ok: true, at, seq: 10, stuck: false, reason: "VERDICT: NORMAL\nEVIDENCE: x", ...extra });

test("analyses survive a restart, newest first, with their time and offset", async () => {
  const file = join(dir, "a.json");
  const one = createReviewStore({ file });
  await one.add("s1", review(1000, { seq: 5 }));
  await one.add("s1", review(2000, { seq: 9 }));
  await one.add("s2", review(1500));

  const two = createReviewStore({ file });
  await two.ready();
  assert.equal(two.latest("s1").at, 2000);
  assert.equal(two.latest("s1").seq, 9);
  assert.deepEqual(two.list("s1").map(r => r.at), [2000, 1000]);
  assert.equal(two.latest("s2").at, 1500);
  assert.equal(two.latest("nope"), null);
});

test("history per session is bounded", async () => {
  const store = createReviewStore({ file: join(dir, "b.json") });
  for (let i = 0; i < PER_SESSION + 5; i++) await store.add("s", review(i));
  assert.equal(store.list("s").length, PER_SESSION);
  assert.equal(store.latest("s").at, PER_SESSION + 4);
});

test("a corrupt or foreign file does not brick the store", async () => {
  const bad = join(dir, "bad.json");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(bad, "{not json");
  const logs = [];
  const store = createReviewStore({ file: bad, logger: (...a) => logs.push(a) });
  await store.ready();
  assert.equal(store.latest("s"), null);
  await store.add("s", review(1));
  assert.equal(JSON.parse(readFileSync(bad, "utf8")).reviews.s[0].at, 1);
  assert.ok(logs.length >= 1);
});

test("a memory-only store (no file) still works", async () => {
  const store = createReviewStore({});
  await store.add("s", review(1));
  assert.equal(store.latest("s").at, 1);
});

const ev = (seq, type, data = {}, time = seq * 1000) => ({ seq, type, time, data });

test("trail: nothing after the review means the conclusion still applies", () => {
  const events = [ev(8, "tool/call", { callId: "a" }), ev(9, "turn/end", {})];
  const trail = trailSince(events, 10);
  assert.equal(trail.moved, false);
  assert.equal(trail.toolCalls, 0);
});

test("trail: new calls, failures, turns and user messages after the offset are counted", () => {
  const events = [
    ev(8, "tool/call", { callId: "old" }),
    ev(10, "turn/start", { turn: 2 }),
    ev(11, "user/message", { source: { kind: "user" }, content: [{ type: "text", text: "继续" }] }),
    ev(12, "tool/call", { callId: "a" }),
    ev(13, "tool/result", { message: { toolCallId: "a", content: [{ type: "text", text: "boom [exit code: 2]" }] } }),
    ev(14, "tool/call", { callId: "b" }),
    ev(15, "tool/result", { message: { toolCallId: "b", content: [{ type: "text", text: "ok" }] } }),
    ev(16, "user/message", { source: { kind: "runtime-context" }, content: [{ type: "text", text: "Current runtime context." }] }),
  ];
  const trail = trailSince(events, 10);
  assert.deepEqual(
    { moved: trail.moved, calls: trail.toolCalls, failures: trail.failures, turns: trail.turns, users: trail.userMessages, last: trail.lastAt },
    { moved: true, calls: 2, failures: 1, turns: 1, users: 1, last: 16000 },
  );
});

test("trail: housekeeping events alone do not count as moving on", () => {
  const trail = trailSince([ev(10, "session/title", { title: "x" }), ev(11, "step/end", {})], 10);
  assert.equal(trail.events, 2);
  assert.equal(trail.moved, false);
});
