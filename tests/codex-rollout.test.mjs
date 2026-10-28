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
  assert.deepEqual(events.filter(e => e.type === "turn/end").map(e => e.data.reason.kind), ["completed", "aborted"], "the reason is read as { kind }");
  const call = events.find(e => e.type === "tool/call");
  assert.equal(call.data.callId, "c1");
  assert.equal(call.data.name, "exec");
  assert.equal(call.data.turn, 1, "the call belongs to the turn it ran in");
  const result = events.find(e => e.type === "tool/result");
  assert.equal(result.data.message.toolCallId, "c1", "the result links back to its call");
  assert.match(result.data.message.content[0].text, /a\.pdf/, "output is a text block, as in a DSH tool result");
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

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodexRoster, createCodexRecords } from "../lib/codex-rollout.mjs";
import { createCodexIndex } from "../lib/codex-index.mjs";
import { foldRecord } from "../lib/context-records.mjs";
const rosterFor = home => createCodexRoster(home, createCodexIndex({ home, fold: foldRecord }));

// A fake ~/.codex with one live rollout and one archived one.
function fakeCodexHome() {
  const home = mkdtempSync(join(tmpdir(), "focusing-codex-fixture-"));
  const day = join(home, "sessions", "2026", "10", "16");
  mkdirSync(day, { recursive: true });
  mkdirSync(join(home, "archived_sessions"), { recursive: true });
  writeFileSync(join(day, "rollout-2026-10-16T13-52-53-aaa.jsonl"), rollout.replace("01a14345", "aaa"));
  writeFileSync(join(home, "archived_sessions", "rollout-2026-10-01T00-00-00-bbb.jsonl"), rollout.replace("01a14345", "bbb"));
  writeFileSync(join(home, "session_index.jsonl"), JSON.stringify({ id: "aaa", thread_name: "命名的会话" }) + "\n");
  return home;
}

test("the roster lists Codex chats as read-only rows, tagged with their source", () => {
  const home = fakeCodexHome();
  try {
    const rows = rosterFor(home).rows();
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.source, "codex", "every row says where it came from");
      assert.match(row.id, /^codex:/, "its id cannot collide with a DSH id");
    }
    const named = rows.find(r => r.sourceId === "aaa");
    assert.equal(named.title, "命名的会话", "Codex's own thread name wins");
    assert.equal(named.project, "paper");
    assert.equal(rows.find(r => r.sourceId === "bbb").archived, true, "the archived folder is marked archived");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("a missing Codex home is an empty roster, not an error", () => {
  assert.deepEqual(rosterFor(join(tmpdir(), "no-such-codex-home-xyz")).rows(), []);
});

test("an unchanged rollout is not decompressed again, and neither consumer re-reads it", () => {
  const home = fakeCodexHome();
  try {
    let reads = 0;
    const index = createCodexIndex({ home, fold: foldRecord });
    const refresh = index.refresh;
    // Count how many chats are folded: every fold is a full decompress+parse.
    const countingFold = (events, header) => { reads += 1; return foldRecord(events, header); };
    const counted = createCodexIndex({ home, fold: countingFold });
    const roster = createCodexRoster(home, counted);
    roster.rows();
    assert.equal(reads, 2, "the first poll folds each chat once");
    roster.rows();
    createCodexRecords(home, counted).records();
    assert.equal(reads, 2, "the next poll and the calendar both reuse the same summaries");
    assert.ok(refresh);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("summaries survive a restart through the saved index file", () => {
  const home = fakeCodexHome();
  const cacheFile = join(home, "codex-index.json");
  try {
    createCodexRoster(home, createCodexIndex({ home, fold: foldRecord, cacheFile })).rows();
    let reads = 0;
    const after = createCodexIndex({ home, fold: (e, h) => { reads += 1; return foldRecord(e, h); }, cacheFile });
    const rows = createCodexRoster(home, after).rows();
    assert.equal(rows.length, 2, "the chats are all there after restart");
    assert.equal(reads, 0, "and nothing was decompressed again");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("a changed rollout is folded again, and a deleted one leaves the index", () => {
  const home = fakeCodexHome();
  try {
    const index = createCodexIndex({ home, fold: foldRecord });
    assert.equal(index.refresh().length, 2);
    const day = join(home, "sessions", "2026", "10", "16");
    const file = join(day, "rollout-2026-10-16T13-52-53-aaa.jsonl");
    writeFileSync(file, readFileSync(file, "utf8") + "\n" + JSON.stringify({ timestamp: "2026-10-16T09:00:00.000Z", type: "event_msg", payload: { type: "task_started", turn_id: "t9" } }));
    const grown = index.refresh().find(c => c.id === "aaa");
    assert.equal(grown.turns, 3, "the new turn shows up after the file changes");
    rmSync(join(home, "archived_sessions", "rollout-2026-10-01T00-00-00-bbb.jsonl"));
    assert.equal(index.refresh().length, 1, "a deleted chat leaves the roster");
  } finally { rmSync(home, { recursive: true, force: true }); }
});


test("the reader's events fold into the same records DSH sessions produce", async () => {
  const { foldRecord, isPersonal } = await import("../lib/context-records.mjs");
  const withReply = rollout.replace(line("event_msg", { type: "task_complete", turn_id: "t1" }),
    line("response_item", { type: "message", role: "assistant", content: [{ type: "output_text", text: "整理好了" }] }) + "\n" + line("event_msg", { type: "task_complete", turn_id: "t1" }));
  const { header, events } = parseRollout(withReply);
  const record = foldRecord(events, header);
  assert.equal(record.turns.length, 2);
  assert.equal(record.turns[0].calls, 1, "the tool call counts against its turn");
  assert.equal(record.turns[0].reply, "整理好了", "the assistant's reply is kept");
  assert.equal(record.turns[0].requests[0].text, "帮我整理这篇论文");
  assert.equal(isPersonal(record), true, "a chat the person typed in counts as theirs");
});
