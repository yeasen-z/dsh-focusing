// Archived chats keep their Workspace slot, so the session store still lists
// them. The registry's archive set is what marks them, and the panel decides
// whether to show them -- so the state route must carry the mark.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { apply } from "../lib/index.mjs";
process.env.DSH_FOCUSING_CODEX_HOME = mkdtempSync(join(tmpdir(), "focusing-codex-empty-"));

const STATE = "/api/dsh-focusing.state";

function mount({ archivedSessionIds, registry = true } = {}) {
  const routes = new Map();
  const services = {
    sessions: { list: () => [], get: () => undefined },
    sessionPersistence: { list: async () => [] },
    sessionController: {
      list: async () => ({ items: [
        { sessionId: "s-arch", cwd: "/tmp/alpha", updatedAt: 3000 },
        { sessionId: "s-plain", cwd: "/tmp/beta", updatedAt: 2000 },
      ] }),
    },
    sessionQuery: { readSession: async () => undefined },
    agents: { list: () => [], get: () => undefined },
    sessionTitle: { get: () => undefined },
    agentDefaultModel: { currentSelection: () => null },
    llm: { listProviders: () => [], listModels: async () => [], stream: () => {} },
  };
  const archiveSet = { archivedSessionIds: archivedSessionIds ?? [] };
  if (registry === "starting") {
    // Reproduces the real service before its state is loaded.
    services.workspaceRegistry = { get archivedSessionIds() { throw new Error("workspace registry is not started yet"); } };
  } else if (registry) services.workspaceRegistry = archiveSet;
  const child = {
    get: name => services[name],
    on: () => {}, inject: (keys, cb) => cb(child), effect: fn => fn(),
    connection: { fetch: { register: r => { routes.set(r.path, r); return () => {}; } } },
  };
  const ctx = { get: () => undefined, on: () => {}, inject: (keys, cb) => cb(child), logger: { info: () => {}, warn: () => {} } };
  const previous = process.env.DSH_PROFILE_DIR;
  process.env.DSH_PROFILE_DIR = "/tmp/dsh-focusing-state-archived";
  try { apply(ctx); } finally {
    if (previous === undefined) delete process.env.DSH_PROFILE_DIR;
    else process.env.DSH_PROFILE_DIR = previous;
  }
  return { routes, archiveSet };
}

const roster = async routes => {
  const response = await routes.get(STATE).fetch(new Request(`http://host${STATE}`));
  return (await response.json()).sessions;
};

test("sessions in the registry's archive set are marked archived", async () => {
  const { routes } = mount({ archivedSessionIds: ["s-arch"] });
  const sessions = await roster(routes);
  assert.equal(sessions.find(s => s.id === "s-arch").archived, true);
  assert.equal(sessions.find(s => s.id === "s-plain").archived, false, "and only those");
});

test("nothing is archived when the set is empty", async () => {
  const { routes } = mount({ archivedSessionIds: [] });
  const sessions = await roster(routes);
  assert.deepEqual(sessions.map(s => s.archived), [false, false]);
});

test("an unavailable registry leaves sessions unmarked rather than failing", async () => {
  const sessions = await roster(mount({ registry: false }).routes);
  assert.equal(sessions.length, 2);
  assert.deepEqual(sessions.map(s => s.archived), [false, false]);
});

test("a registry that is still starting does not break the roster", async () => {
  // The panel polls the moment the Harness is up, which can be before the
  // registry has loaded its state. An unreadable set must degrade to "none".
  const sessions = await roster(mount({ registry: "starting" }).routes);
  assert.equal(sessions.length, 2);
  assert.deepEqual(sessions.map(s => s.archived), [false, false]);
});

test("the archive set is read per request, so archiving elsewhere shows up", async () => {
  const { routes, archiveSet } = mount({ archivedSessionIds: [] });
  assert.equal((await roster(routes)).find(s => s.id === "s-arch").archived, false);
  // Archiving happens in DSH's own sidebar, not through this plugin: the set is
  // read from the registry on every poll rather than snapshotted at startup.
  archiveSet.archivedSessionIds = ["s-arch"];
  assert.equal((await roster(routes)).find(s => s.id === "s-arch").archived, true);
});

// The setting itself: archived chats are hidden unless asked for, and an
// unreadable value must fail closed rather than showing them by accident.
test("loadArchived is off by default and strictly opt-in", async () => {
  const { DEFAULT_SETTINGS, mergeSettings, normalizeSettings, publicSettings } = await import("../lib/settings.mjs");
  assert.equal(DEFAULT_SETTINGS.loadArchived, false, "archived chats are not loaded by default");
  assert.equal(normalizeSettings({}).loadArchived, false);
  assert.equal(normalizeSettings({ loadArchived: "true" }).loadArchived, false, "a string is not a yes");
  assert.equal(normalizeSettings({ loadArchived: 1 }).loadArchived, false, "nor a number");
  assert.equal(normalizeSettings({ loadArchived: true }).loadArchived, true);
  assert.equal(mergeSettings(DEFAULT_SETTINGS, { loadArchived: true }).loadArchived, true, "the dialog can save it");
  assert.equal(publicSettings(DEFAULT_SETTINGS).loadArchived, false, "and the panel can read it back");
});
