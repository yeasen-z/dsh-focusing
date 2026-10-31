import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRecordIndex } from "../lib/record-index.mjs";
import { activityCalendar } from "../lib/activity.mjs";
import { isPersonal } from "../lib/context-records.mjs";

test("calendar summaries survive restart and only reread changed sessions", async () => {
  const directory = resolve(mkdtempSync(join(tmpdir(), "focusing-activity-index-")));
  try {
    const file = join(directory, "activity-index.json");
    const at = Date.UTC(2026, 9, 29, 12);
    const stored = new Map([
      ["user", { revision: "1", header: { id: "user", createdAt: at, depth: 0 }, events: [
        { type: "user/message", time: at, data: { source: { kind: "user" }, content: [{ type: "text", text: "hello" }] } },
        { type: "turn/start", time: at + 1, data: { turn: 1 } },
        { type: "tool/call", time: at + 2, data: { turn: 1, callId: "c1", name: "read", arguments: "{}" } },
        { type: "turn/end", time: at + 3, data: { turn: 1 } },
      ] }],
      ["child", { revision: "1", header: { id: "child", createdAt: at, delegationDepth: 1 }, events: [
        { type: "user/message", time: at, data: { source: { kind: "user" }, content: [{ type: "text", text: "delegated" }] } },
        { type: "turn/start", time: at + 1, data: { turn: 1 } },
        { type: "turn/end", time: at + 2, data: { turn: 1 } },
      ] }],
    ]);
    const reads = [];
    const services = () => ({
      sessions: { list: () => [] },
      persistence: { list: async () => [...stored.values()].map(row => ({ header: row.header, revision: row.revision })) },
      query: { readSession: async id => { reads.push(id); return { events: stored.get(id).events }; } },
    });
    const window = { since: at - 1000 };
    const first = createRecordIndex(services, { activityFile: file });
    const records = await first.activityRecords(window);
    const calendar = activityCalendar([{ source: "dsh", records: records.filter(isPersonal) }], { start: at - 1000, end: at + 86400000 });
    assert.equal(calendar.total, 1);
    assert.equal(calendar.days.find(day => day.turns).calls, 1);
    assert.deepEqual(reads.sort(), ["child", "user"]);
    const cached = readFileSync(file, "utf8");
    assert.ok(!cached.includes("hello") && !cached.includes("delegated"), "cache contains counts, not conversation text");

    const restarted = createRecordIndex(services, { activityFile: file });
    assert.equal((await restarted.activityRecords(window)).length, 2);
    assert.deepEqual(reads.sort(), ["child", "user"], "a restart does not reread the logs");
    assert.equal(readFileSync(file, "utf8"), cached, "an unchanged visit does not rewrite the cache");

    stored.get("user").revision = "2";
    await restarted.activityRecords(window);
    assert.deepEqual(reads.sort(), ["child", "user", "user"], "only a changed session is folded again");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the records list comes from the durable index and never refolds an unchanged session", async () => {
  const directory = resolve(mkdtempSync(join(tmpdir(), "focusing-records-index-")));
  try {
    const activity = join(directory, "activity-index.json");
    const recordsFile = join(directory, "records-index.json");
    const at = Date.UTC(2026, 9, 29, 12);
    const stored = new Map([
      ["s1", { revision: "1:2:3:1:0", header: { id: "s1", cwd: "/w/app", createdAt: at }, events: [
        { type: "user/message", time: at, data: { source: { kind: "user" }, content: [{ type: "text", text: "fix the login form" }] } },
        { type: "turn/start", time: at + 1, data: { turn: 1 } },
        { type: "assistant/message", time: at + 2, data: { turn: 1, message: { content: [{ type: "text", text: "repaired the redirect" }] } } },
        { type: "turn/end", time: at + 3, data: { turn: 1 } },
      ] }],
    ]);
    const reads = [];
    const services = () => ({
      sessions: { list: () => [] },
      persistence: { list: async () => [...stored.values()].map(row => ({ header: row.header, revision: row.revision })) },
      query: { readSession: async id => { reads.push(id); return { events: stored.get(id).events }; } },
    });
    const first = createRecordIndex(services, { activityFile: activity, summaryFile: recordsFile });
    const rows = await first.timelines({ since: 0 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].summary.title, "fix the login form", "the row keeps what the list shows");
    assert.equal(rows[0].summary.cwd, "/w/app");
    assert.deepEqual(reads, ["s1"]);

    const restarted = createRecordIndex(services, { activityFile: activity, summaryFile: recordsFile });
    const again = await restarted.timelines({ since: 0 });
    assert.deepEqual(reads, ["s1"], "a restart draws the list without reading the transcript");
    assert.equal(again[0].summary.gist, "repaired the redirect");

    assert.ok(readFileSync(recordsFile, "utf8").includes("fix the login form"), "the rows live in their own file");
    assert.ok(!readFileSync(activity, "utf8").includes("fix the login form"), "the calendar cache stays free of conversation text");

    stored.get("s1").revision = "1:2:4:2:0";
    await restarted.timelines({ since: 0 });
    assert.deepEqual(reads, ["s1", "s1"], "only a changed session is folded again");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
