// Settings are read from disk when the store is made, so a request that arrives
// right after a restart sees what the user saved, not the defaults.
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { createSettingsStore } from "../lib/settings-store.mjs";

function tempFile() {
  const dir = mkdtempSync(join(tmpdir(), "focusing-settings-"));
  return { dir, file: join(dir, "dsh-focusing.analysis.json") };
}

test("a saved Codex setting is visible to the very first read after a restart", async () => {
  const { dir, file } = tempFile();
  try {
    const first = createSettingsStore({ file });
    await first.save({ codexEnabled: true, activityIncludeExternal: true });
    // A new store, as after a restart: no await before the first read.
    const restarted = createSettingsStore({ file });
    assert.equal(restarted.get().codexEnabled, true, "not the default false");
    assert.equal(restarted.view().activityIncludeExternal, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing settings file means defaults, and a corrupt one does not break the store", () => {
  const { dir, file } = tempFile();
  try {
    assert.equal(createSettingsStore({ file }).get().codexEnabled, false, "missing file: defaults");
    writeFileSync(file, "{ not json");
    const store = createSettingsStore({ file, logger: () => {} });
    assert.equal(store.get().codexEnabled, false, "corrupt file: defaults, not a crash");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the API key stays out of view() responses, and is kept on disk for the plugin", async () => {
  const { dir, file } = tempFile();
  try {
    const store = createSettingsStore({ file });
    await store.save({ apiKey: "sk-secret-123" });
    assert.equal(JSON.stringify(store.view()).includes("sk-secret-123"), false);
    assert.ok(readFileSync(file, "utf8").includes("sk-secret-123"), "the key is stored on disk for the plugin to use");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
