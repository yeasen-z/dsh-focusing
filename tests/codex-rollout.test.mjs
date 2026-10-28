// The Codex reader turns a rollout into the same events a DSH session produces,
// so the panel's fold and analysis work on Codex chats without changes. The
// fixture uses the real record shapes Codex writes.
import test from "node:test";
import assert from "node:assert/strict";
import { parseRollout } from "../lib/codex-rollout.mjs";

const line = (type, payload, timestamp = "2026-10-16T05:53:00.000Z") => JSON.stringify({ timestamp, type, payload });
const userMsg = (text) => line("response_item", { type: "message", role: "user", content: [{ type: "input_text", text }] });
const rollout = [
  line("session_meta", { id: "01a14345", cwd: "/work/paper", timestamp: "2026-10-16T05:52:53.898Z" }, "2026-10-16T05:52:59.789Z"),
  line("event_msg", { type: "task_started", turn_id: "t1" }),
  // Codex wraps the real prompt with its own blocks; only the prompt counts.
  userMsg("<environment_context>\n  <cwd>/work/paper</cwd>\n</environment_context>"),
  userMsg("帮我整理这篇论文"),
  line("response_item", { type: "custom_tool_call", call_id: "c1", name: "exec", input: "text(await tools.exec_command({cmd:\"ls\"}))" }),
  line("response_item", { type: "custom_tool_call_output", call_id: "c1", output: [{ type: "input_text", text: "a.pdf\n" }] }),
  line("event_msg", { type: "task_complete", turn_id: "t1" }),
  line("event_msg", { type: "task_started", turn_id: "t2" }),
  userMsg("# Files mentioned by the user:\n\n## paper.pdf"),
  line("event_msg", { type: "turn_aborted", turn_id: "t2" }),
  "this line is not json",
].join("\n");

test("the header carries the session identity, cwd and start time", () => {
  const { header } = parseRollout(rollout);
  assert.equal(header.id, "01a14345");
  assert.equal(header.cwd, "/work/paper");
  assert.equal(header.source, "codex");
  assert.equal(header.createdAt, Date.parse("2026-10-16T05:52:59.789Z"));
});

test("only what the person typed is a user message; injected and attached blocks are dropped", () => {
  const { events } = parseRollout(rollout);
  const users = events.filter(e => e.type === "user/message").map(e => e.data.content[0].text);
  assert.deepEqual(users, ["帮我整理这篇论文"]);
});

test("turns and tool calls pair up in the DSH event shapes the fold reads", () => {
  const { events } = parseRollout(rollout);
  assert.equal(events.filter(e => e.type === "turn/start").length, 2);
  assert.equal(events.filter(e => e.type === "turn/end").length, 2, "a completed and an aborted turn both end");
  const call = events.find(e => e.type === "tool/call");
  assert.equal(call.data.callId, "c1");
  assert.equal(call.data.name, "exec");
  assert.equal(call.data.turn, 1, "the call belongs to the turn it ran in");
  const result = events.find(e => e.type === "tool/result");
  assert.equal(result.data.message.toolCallId, "c1", "the result links back to its call");
  assert.match(result.data.message.output, /a\.pdf/);
});

test("a malformed line is skipped, not fatal", () => {
  const { header, events } = parseRollout("not json\n" + rollout);
  assert.equal(header.id, "01a14345");
  assert.ok(events.length > 0);
});

test("an empty or header-only rollout yields no events", () => {
  assert.deepEqual(parseRollout("").events, []);
  assert.equal(parseRollout(line("session_meta", { id: "x", cwd: "/a" })).events.length, 0);
});
