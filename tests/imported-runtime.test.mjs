import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createImportedSourceRuntime } from "../lib/imported-runtime.mjs";
import { createClaudeIndex, createClaudeRoster, createClaudeRecords, resolveClaudeHome, loadSession } from "../lib/claude-code.mjs";
import { foldRecord } from "../lib/context-records.mjs";

test("the imported runtime runs a real Claude adapter without Host or HTTP services", async () => {
  const home = mkdtempSync(join(tmpdir(), "focusing-runtime-contract-"));
  const project = join(home, "projects", "-w-core");
  mkdirSync(project, { recursive: true });
  const rows = [
    { type: "user", sessionId: "core-1", cwd: "/w/core", timestamp: "2026-11-12T01:00:00Z", message: { role: "user", content: "core task" } },
    { type: "assistant", sessionId: "core-1", cwd: "/w/core", timestamp: "2026-11-12T01:00:01Z", message: { role: "assistant", content: [{ type: "text", text: "done" }] } },
  ];
  writeFileSync(join(project, "core-1.jsonl"), rows.map(row => JSON.stringify(row)).join("\n"));
  const current = { claudeEnabled: false, claudePathMode: "auto", claudePath: "" };
  const runtime = createImportedSourceRuntime({
    settingsStore: { view: () => current },
    fold: foldRecord,
    adapters: {
      claude: {
        options: view => ({ enabled: view.claudeEnabled, mode: view.claudePathMode, path: view.claudePath }),
        forced: () => home,
        resolve: resolveClaudeHome,
        createIndex: createClaudeIndex,
        createRoster: createClaudeRoster,
        createRecords: createClaudeRecords,
        load: loadSession,
      },
    },
  });
  try {
    assert.equal(runtime.source("claude").enabled, false);
    assert.equal(await runtime.metadata("claude:core-1"), null);
    current.claudeEnabled = true;
    const found = runtime.source("claude");
    assert.equal(found.ok, true);
    assert.equal("rows" in runtime.statusFields({ claude: found }).claudeStatus, false);

    const chats = await runtime.chats("claude");
    assert.equal(chats.length, 1);
    assert.equal(chats[0].turns, 1);
    assert.equal(runtime.records("claude").records[0].turns.length, 1);
    const detail = await runtime.metadata("claude:core-1");
    assert.equal(detail.goal, "core task");
    assert.equal(detail.activity.at(-1).text, "done");
    assert.equal(runtime.isImported("claude:core-1"), true);
    assert.equal(runtime.isImported("native-1"), false);

    current.claudeEnabled = false;
    assert.equal(await runtime.metadata("claude:core-1"), null, "a retained reader cannot bypass disabled settings");
    await runtime.idle();
  } finally {
    await runtime.idle();
    rmSync(home, { recursive: true, force: true });
  }
});

test("status-only reads avoid indexing and replaced readers drain without cache-write rights", async () => {
  let home = "A";
  const created = [];
  const runtime = createImportedSourceRuntime({
    settingsStore: { view: () => ({}) },
    fold: foldRecord,
    adapters: {
      claude: {
        options: () => ({ enabled: true, mode: "manual", path: home }),
        resolve: () => ({ ok: true, home, via: "manual" }),
        createIndex: ({ home: current, shouldWrite }) => {
          let finish;
          const pending = current === "A" ? new Promise(resolve => { finish = resolve; }) : Promise.resolve();
          const reader = {
            home: current, shouldWrite, finish,
            index: {
              stale: () => [{}], settle: () => pending, idle: () => pending,
              refresh: () => [], errors: () => [],
            },
          };
          created.push(reader);
          return reader.index;
        },
        createRoster: () => ({ rows: () => [] }),
        createRecords: () => ({ records: () => [] }),
        load: async () => ({ header: {}, events: [] }),
      },
    },
  });

  const status = runtime.records("claude", { rebuild: false });
  assert.equal(status.enabled, true);
  assert.equal(created.length, 0, "status-only reading creates no index");

  runtime.source("claude");
  assert.equal(created.length, 1);
  home = "B";
  runtime.source("claude");
  assert.equal(created.length, 2);
  assert.equal(created[0].shouldWrite(), false, "the retired home cannot overwrite the new cache");
  assert.equal(created[1].shouldWrite(), true);

  let drained = false;
  const draining = runtime.idle().then(() => { drained = true; });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(drained, false, "idle waits for the retired reader, not only the current one");
  created[0].finish();
  await draining;
  assert.equal(drained, true);
});
