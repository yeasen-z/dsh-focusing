/**
 * The bug that made the panel look dead: the route called ctx.get(...) on the
 * plugin's OUTER context instead of the injected child. Stub tests passed
 * because they mocked the outer get; at runtime it returned undefined.
 *
 * This test makes the outer context useless on purpose. Everything the route
 * needs is visible only through the child. If the route regresses to the outer
 * ctx, these tests fail.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../lib/index.mjs";
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DSH_FOCUSING_CODEX_HOME = mkdtempSync(join(tmpdir(), "focusing-codex-empty-"));

// Route tests must never load or overwrite the person's real profile settings.
// Each plugin instance gets an empty, separately owned temporary directory.
const ownedProfiles = [];
const testProfile = () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'focusing-route-test-')));
  ownedProfiles.push(directory);
  return directory;
};
after(() => {
  const root = realpathSync(tmpdir());
  for (const directory of ownedProfiles) {
    if (!directory.startsWith(`${root}/focusing-route-test-`)) throw new Error('Unexpected cleanup path');
    rmSync(directory, { recursive: true, force: true });
  }
});

async function* chunks(list) {
  for (const item of list) yield item;
}

function session(id) {
  return {
    id,
    header: { cwd: "/w/proj", createdAt: 1 },
    seq: 2,
    snapshotEvents: (a, b) => [
      { type: "user/message", data: { role: "user", source: { kind: "user" }, content: [{ type: "text", text: "do the task" }] }, time: 1 },
      { type: "turn/start", data: { turn: 1, step: 1 }, time: 2 },
    ].slice(a, b),
  };
}

function harness({ llm, omitLlm = false, calls = { n: 0 } } = {}) {
  const s = session("s1");
  const services = {
    sessions: { list: () => [s], get: id => (id === "s1" ? s : undefined) },
    agents: { list: () => [], get: () => undefined },
    sessionTitle: { get: () => ({ title: "A real chat" }) },
    agentDefaultModel: { currentSelection: () => ({ provider: "deepseek", model: "v4.1-flash" }) },
    llm: omitLlm ? undefined : (llm ?? {
      listProviders: () => [{ id: "deepseek", name: "DeepSeek" }, { id: "broken", name: "Broken" }],
      listModels: async (provider) => {
        if (provider === "broken") throw new Error("endpoint unreachable");
        return [{ provider: "deepseek", id: "v4.1-flash", name: "Flash" }];
      },
      stream: () => {
        calls.n += 1;
        return chunks([
          { type: "text-delta", text: "VERDICT: NORMAL" },
          { type: "finish", reason: { kind: "stop" } },
        ]);
      },
    }),
  };
  const routes = new Map();
  // The outer context knows NOTHING. This is the regression trap.
  const outerGet = (name) => {
    if (name === "connection") return undefined;
    return undefined;
  };
  const ctx = {
    get: outerGet,
    on: () => {},
    inject: (keys, cb) => {
      if (!keys.includes("connection")) return;
      cb({
        connection: { fetch: { register: (v) => { routes.set(v.path, v); return () => {}; } } },
        get: (name) => services[name],
        effect: (fn) => fn(),
      });
    },
  };
  const previousProfile = process.env.DSH_PROFILE_DIR;
  process.env.DSH_PROFILE_DIR = testProfile();
  try { apply(ctx); }
  finally {
    if (previousProfile === undefined) delete process.env.DSH_PROFILE_DIR;
    else process.env.DSH_PROFILE_DIR = previousProfile;
  }
  return {
    calls,
    analyze: async (id) => (await routes.get("/api/dsh-focusing.analyze").fetch(
      new Request("http://x/api/dsh-focusing.analyze", { method: "POST", body: JSON.stringify({ session: id }) }),
    )).json(),
    models: async () => (await routes.get("/api/dsh-focusing.models")
      .fetch(new Request("http://x/api/dsh-focusing.models"))).json(),
    state: async (id) => (await routes.get("/api/dsh-focusing.state")
      .fetch(new Request(`http://x/api/dsh-focusing.state${id ? `?session=${id}` : ""}`))).json(),
    exportTranscript: async (id, format) => routes.get("/api/dsh-focusing.export")
      .fetch(new Request(`http://x/api/dsh-focusing.export?session=${id}&format=${format}`)),
    getSettings: async () => (await routes.get("/api/dsh-focusing.settings")
      .fetch(new Request("http://x/api/dsh-focusing.settings"))).json(),
    saveSettings: async (settings, test) => (await routes.get("/api/dsh-focusing.settings")
      .fetch(new Request("http://x/api/dsh-focusing.settings", { method: "POST", body: JSON.stringify({ settings, test }) }))).json(),
    preview: async (id) => (await routes.get("/api/dsh-focusing.preview")
      .fetch(new Request(`http://x/api/dsh-focusing.preview?session=${id}`))).json(),
    routes,
  };
}

test("settings round-trip through the child context with the key redacted", async () => {
  const h = harness();
  const initial = await h.getSettings();
  assert.equal(initial.ok, true);
  assert.equal(initial.settings.source, "dsh", "a fresh install analyses with the Host model");
  assert.ok(initial.settings.persona, "the default reviewer prompt must be present");

  const saved = await h.saveSettings({ provider: "p1", model: "m1", apiKey: "sk-secret", source: "external", endpoint: "https://api.example.com/v1/chat/completions", externalModel: "mm" });
  assert.equal(saved.ok, true);
  assert.equal(saved.settings.provider, "p1");
  assert.equal(saved.settings.model, "m1");
  assert.equal(saved.settings.hasApiKey, true);
  assert.doesNotMatch(JSON.stringify(saved), /sk-secret/, "the key must never be returned to the panel");

  const again = await h.getSettings();
  assert.equal(again.settings.model, "m1", "settings must survive a re-read");
  assert.equal(again.settings.apiKey, undefined);
});

test("a saved model is the one that answers the review", async () => {
  const seen = [];
  const h = harness({
    llm: {
      stream(options) {
        seen.push(`${options.provider}/${options.model}`);
        return chunks([
          { type: "text-delta", text: "VERDICT: STUCK\nEVIDENCE: stuck" },
          { type: "finish", reason: { kind: "stop" } },
        ]);
      },
    },
  });
  await h.saveSettings({ provider: "custom", model: "reviewer-v1" });
  const result = await h.analyze("s1");
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(seen, ["custom/reviewer-v1"], "the configured model must be used, not the default");
  assert.equal(result.review.stuck, true);
});

test("a saved persona is what the model is told", async () => {
  const systems = [];
  const h = harness({
    llm: {
      stream(options) {
        systems.push(options.system);
        return chunks([{ type: "text-delta", text: "VERDICT: NORMAL" }, { type: "finish", reason: { kind: "stop" } }]);
      },
    },
  });
  await h.saveSettings({ persona: "You are a strict architecture reviewer." });
  await h.analyze("s1");
  assert.match(systems[0], /strict architecture reviewer/);
  assert.match(systems[0], /VERDICT: NORMAL or STUCK/, "the answer contract must survive a custom persona");
});

test("preview shows the exact payload, including hidden sections being gone", async () => {
  const h = harness();
  const shown = await h.preview("s1");
  assert.equal(shown.ok, true);
  assert.match(shown.system, /VERDICT: NORMAL or STUCK/);
  assert.match(shown.user, /do the task/);

  await h.saveSettings({ includeGoal: false });
  const narrowed = await h.preview("s1");
  assert.doesNotMatch(narrowed.user, /do the task/);
});

test("a connection test sends no session content", async () => {
  const prompts = [];
  const h = harness({
    llm: {
      stream(options) {
        prompts.push(options.messages[0].content[0].text);
        return chunks([{ type: "text-delta", text: "ready" }, { type: "finish", reason: { kind: "stop" } }]);
      },
    },
  });
  const result = await h.saveSettings({ provider: "p", model: "m" }, true);
  assert.equal(result.ok, true);
  assert.equal(result.test.ok, true);
  assert.doesNotMatch(prompts[0], /do the task/, "a test must not leak the conversation to an external service");
});

test("a failing connection test reverts the saved settings", async () => {
  const h = harness({
    llm: { stream: () => chunks([{ type: "finish", reason: { kind: "error", failure: { code: "AUTH", message: "bad key" } } }]) },
  });
  await h.saveSettings({ provider: "good", model: "ok-model" });
  const failed = await h.saveSettings({ provider: "bad", model: "bad-model" }, true);
  assert.equal(failed.test.ok, false);
  assert.equal(failed.reverted, true);
  assert.equal(failed.settings.model, "ok-model", "working settings must not be replaced by a broken test");
});

test("state route works when the outer context exposes nothing", async () => {
  const { state } = harness();
  const roster = await state();
  assert.equal(roster.sessions.length, 1, "roster must be read through the child context");
  assert.equal(roster.sessions[0].title, "A real chat");
  const selected = await state("s1");
  assert.equal(selected.session, "s1");
  assert.equal(selected.title, "A real chat");
});

test("analyze route reaches the model through the child context", async () => {
  const h = harness();
  const result = await h.analyze("s1");
  assert.equal(result.ok, true, `analysis failed: ${JSON.stringify(result)}`);
  assert.equal(result.review.stuck, false);
  assert.equal(h.calls.n, 1, "exactly one model call");
});

test("analyze reports a missing model service instead of silently doing nothing", async () => {
  const h = harness({ omitLlm: true });
  const result = await h.analyze("s1");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no-llm");
  assert.ok(result.detail, "the person must be told what is missing");
});

test("export route reads the log through the child context", async () => {
  const h = harness();
  const md = await h.exportTranscript("s1", "md");
  assert.equal(md.status, 200);
  const text = await md.text();
  assert.match(text, /do the task/);
  const json = await h.exportTranscript("s1", "json");
  assert.equal(json.status, 200);
  const body = await json.json();
  assert.equal(body.session, "s1");
});

test("the model catalogue lists what DSH really offers and survives one bad provider", async () => {
  const h = harness();
  const body = await h.models();
  assert.equal(body.ok, true);
  assert.deepEqual(body.models.map(m => `${m.provider}/${m.id}`), ["deepseek/v4.1-flash"]);
  assert.deepEqual(body.current, { provider: "deepseek", model: "v4.1-flash" });
  // The failing provider is reported, not hidden: silence with no explanation
  // is what makes a model picker look broken.
  assert.deepEqual(body.providers.map(p => `${p.provider}:${p.models.length}`), ["deepseek:1", "broken:0"]);
  assert.match(body.providers[1].reason ?? body.providers[1].detail, /endpoint unreachable|failed/);
});

test("with no model service the catalogue says so instead of inventing models", async () => {
  const h = harness({ omitLlm: true });
  const body = await h.models();
  assert.equal(body.ok, false);
  assert.equal(body.reason, "no-llm");
  assert.deepEqual(body.models, [], "nothing is offered rather than a guess");
});
