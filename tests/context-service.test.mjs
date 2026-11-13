import test from "node:test";
import assert from "node:assert/strict";
import { createContextService } from "../lib/context-service.mjs";
import { foldRecord, summarizeRecord } from "../lib/context-records.mjs";

const at = Date.parse("2026-11-12T01:00:00Z");
function record(id, source, cwd, request, title) {
  return foldRecord([
    { type: "user/message", time: at, data: { source: { kind: "user" }, content: [{ type: "text", text: request }] } },
    { type: "turn/start", time: at + 1, data: { turn: 1 } },
    { type: "assistant/message", time: at + 2, data: { turn: 1, message: { content: [{ type: "text", text: `${title} done` }] } } },
    { type: "turn/end", time: at + 3, data: { turn: 1, reason: { kind: "completed" } } },
  ], { id, source, cwd, createdAt: at, readOnly: source !== "dsh" });
}
function timeline(record) {
  return {
    id: record.id,
    turns: record.turns.map(turn => ({ start: turn.start, end: turn.end, calls: turn.calls, failed: turn.failed, requests: turn.requests })),
    summary: summarizeRecord(record),
  };
}

test("excluding imports keeps status lightweight and never fails the native calendar", async () => {
  const dsh = record("dsh-1", "dsh", "/w/app", "do alpha", "Alpha work");
  const claude = record("claude:c1", "claude", "/w/core", "do beta", "Claude work");
  const calls = [];
  const service = createContextService({
    source: {}, index: { activityRecords: async () => [dsh], errors: () => [] },
    settingsStore: { get: () => ({ activityIncludeExternal: false }) },
    importedRecords: {
      claude: options => {
        calls.push(options);
        if (options?.rebuild) throw new Error("full import must not start");
        return { enabled: true, ok: true, pending: 4, records: [claude] };
      },
    },
    now: () => Date.parse("2026-11-12T04:00:00Z"),
  });
  const result = await service.activity({ span: 7, includeExternal: false });
  assert.deepEqual(calls, [{ rebuild: false }]);
  assert.equal(result.total, 1);
  assert.equal(result.externalEnabled, true, "lightweight configuration status remains accurate");
  assert.equal(result.externalPending, 0);
  assert.equal(result.days.find(day => day.turns > 0).bySource.claude, undefined);

  const broken = createContextService({
    source: {}, index: { activityRecords: async () => [dsh], errors: () => [] },
    settingsStore: { get: () => ({ activityIncludeExternal: false }) },
    importedRecords: { claude: () => { throw new Error("unreadable optional source"); } },
    now: () => Date.parse("2026-11-12T04:00:00Z"),
  });
  const fallback = await broken.activity({ span: 7, includeExternal: false });
  assert.equal(fallback.total, 1, "an optional source cannot fail the DSH-only calendar");
  assert.equal(fallback.externalAvailable, false);
  assert.deepEqual(fallback.externalProblemSources, ["claude"]);
});

test("context queries work without Request, Response or Cordis service lookup", async () => {
  const dsh = record("dsh-1", "dsh", "/w/app", "do alpha", "Alpha work");
  const claude = record("claude:c1", "claude", "/w/core", "do beta", "Claude work");
  const records = [dsh, claude];
  const source = {
    records: async () => records,
    timelines: async () => records.map(timeline),
    record: async id => records.find(item => item.id === id),
  };
  const index = { activityRecords: async () => [dsh], errors: () => [] };
  const service = createContextService({
    source, index,
    settingsStore: { get: () => ({ activityIncludeExternal: true }) },
    importedRecords: { claude: () => ({ enabled: true, ok: true, pending: 2, records: [claude] }) },
    sourceLabels: { claude: "Claude" },
    now: () => Date.parse("2026-11-12T04:00:00Z"),
  });
  const range = { start: 0, end: Infinity, offsetMin: 0 };

  const all = await service.listRecords(range);
  assert.equal(all.records.length, 2);
  assert.deepEqual(all.projects, ["app", "core"]);
  assert.deepEqual(all.workspaces, ["/w/app", "/w/core"]);
  const filtered = await service.listRecords(range, { query: "beta", workspaces: ["/w/core"] });
  assert.deepEqual(filtered.records.map(row => row.id), ["claude:c1"]);
  assert.equal(filtered.stats.sessions, 1);

  const tagged = await service.listRecords(range, { tags: ["source:claude", "project:core", "workspace:/w/core"] });
  assert.deepEqual(tagged.records.map(row => row.id), ["claude:c1"]);
  assert.deepEqual(tagged.tags, ["source:claude", "project:core", "workspace:/w/core"]);
  assert.equal((await service.listRecords(range, { tags: ["workspace:/w/other"] })).records.length, 0);

  const detail = await service.recordDetail("claude:c1", range);
  assert.equal(detail.source, "claude");
  assert.equal(detail.readOnly, true);
  assert.equal(detail.lastReply, "Claude work done");
  assert.equal(await service.recordDetail("missing", range), undefined);

  const slices = await service.slicesFor(range, { query: "claude" });
  assert.deepEqual(slices.map(slice => slice.id), ["claude:c1"]);
  const activity = await service.activity({ span: 7, offsetMin: 0 });
  assert.equal(activity.total, 2);
  assert.equal(activity.externalPending, 2);
  assert.equal(activity.externalEnabled, true);
  assert.equal(activity.days.find(day => day.turns > 0).bySource.claude, 1);
  assert.equal(activity.days.find(day => day.turns > 0).bySource.dsh, 1);
  const scopedActivity = await service.activity({ span: 7, tags: ["source:claude", "workspace:/w/core"] });
  assert.equal(scopedActivity.total, 1);
  assert.deepEqual(scopedActivity.tags, ["source:claude", "workspace:/w/core"]);
});
