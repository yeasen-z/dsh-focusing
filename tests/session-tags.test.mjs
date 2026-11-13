import test from "node:test";
import assert from "node:assert/strict";
import { sessionTags, sessionTagObjects, normalizeTagScope, matchesTags } from "../lib/session-tags.mjs";
import { foldRecord, summarizeRecord } from "../lib/context-records.mjs";
import { createContextQueries } from "../lib/context-tools.mjs";

const at = Date.parse("2026-11-12T01:00:00Z");
function record(id, source, cwd, text) {
  return foldRecord([
    { type: "user/message", time: at, data: { source: { kind: "user" }, content: [{ type: "text", text }] } },
    { type: "turn/start", time: at + 1, data: { turn: 1 } },
    { type: "assistant/message", time: at + 2, data: { turn: 1, message: { content: [{ type: "text", text: "done" }] } } },
    { type: "turn/end", time: at + 3, data: { turn: 1, reason: { kind: "completed" } } },
  ], { id, source, cwd, createdAt: at });
}

test("canonical tags distinguish project and exact workspace, including Windows paths", () => {
  const record = { source: "claude", cwd: "C:\\work\\app\\", project: "app" };
  assert.deepEqual(sessionTags(record), ["source:claude", "project:app", "workspace:C:/work/app"]);
  const objects = sessionTagObjects(record);
  assert.equal(objects.find(tag => tag.kind === "workspace").label, "app");
  assert.equal(objects.find(tag => tag.kind === "workspace").path, "C:/work/app");
  assert.deepEqual(normalizeTagScope(["workspace:C:\\work\\app\\", "project:app", "project:app"]), ["workspace:C:/work/app", "project:app"]);
  assert.equal(matchesTags(record, ["source:claude", "project:app", "workspace:C:/work/app"]), true);
  assert.equal(matchesTags(record, ["workspace:C:/work/other"]), false);
  assert.throws(() => normalizeTagScope("project:app"), /array/);
  assert.throws(() => normalizeTagScope(["unknown:x"]), /source:|project:|workspace:/);
});

test("persistent summaries carry tags and folded search includes middle requests and replies", () => {
  const folded = record("claude:1", "claude", "/work/app", "first");
  folded.turns[0].reply = "answer in the middle";
  folded.turns.push({ ...folded.turns[0], n: 2, requests: [{ time: at + 10, text: "second unique request" }], reply: "last reply" });
  const summary = summarizeRecord(folded);
  assert.deepEqual(summary.tags, ["source:claude", "project:app", "workspace:/work/app"]);
  assert.match(summary.search, /answer in the middle/);
  assert.match(summary.search, /second unique request/);
  assert.match(summary.search, /last reply/);
});

test("Q&A tools AND caller tags with the bound scope and reject out-of-scope raw reads", async () => {
  const claude = record("claude:1", "claude", "/work/app", "claude task");
  const dsh = record("dsh-1", "dsh", "/work/app", "dsh task");
  const other = record("claude:2", "claude", "/work/other", "other task");
  const source = {
    records: async () => [claude, dsh, other],
    record: async id => [claude, dsh, other].find(item => item.id === id),
    events: async id => ({ header: { id }, events: [] }),
    errors: () => [],
  };
  const query = createContextQueries(source, { bound: { tags: ["workspace:/work/app"] } });
  const scoped = await query("focus_list_sessions", { tags: ["source:claude"] }, {});
  assert.deepEqual(scoped.items.map(item => item.id), ["claude:1"]);
  await assert.rejects(query("focus_read_session", { sessionId: "claude:2" }, {}), /outside the selected tags/);
  await assert.rejects(query("focus_read_session", { sessionId: "dsh-1", tags: ["source:claude"] }, {}), /outside the selected tags/);
});
