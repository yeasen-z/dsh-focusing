import test from "node:test";
import assert from "node:assert/strict";
import { createModelGateway } from "../lib/model-gateway.mjs";
import { normalizeSettings } from "../lib/settings.mjs";

function hostLlm(requests) {
  return {
    stream(options) {
      requests.push(options);
      return (async function* () {
        yield { type: "text-delta", text: options.system.includes("VERDICT:") ? "VERDICT: NORMAL" : "ready" };
        yield { type: "finish", reason: { kind: "stop" } };
      })();
    },
  };
}
const route = async settings => ({ provider: settings.provider, model: settings.model });

test("one gateway serves completions, review and connection tests with per-call settings and routes", async () => {
  const requests = [];
  const settings = normalizeSettings({ provider: "p", model: "m" });
  const gateway = createModelGateway({
    settingsStore: { get: () => settings },
    llm: hostLlm(requests),
    resolveRoute: route,
  });
  const completed = await gateway.complete({ system: "system", user: "user" });
  assert.equal(completed.ok, true);
  assert.equal(completed.text, "ready");
  assert.equal(completed.model, "p/m");

  const overridden = await gateway.complete({
    settings: normalizeSettings({ provider: "p2", model: "m2" }),
    system: "system", user: "participant",
  });
  assert.equal(overridden.model, "p2/m2");

  const reviewer = gateway.with({ resolveRoute: async () => ({ provider: "session", model: "last" }) });
  const reviewed = await reviewer.review({ metadata: { project: "core", goal: "task" }, activities: [] });
  assert.equal(reviewed.ok, true, JSON.stringify(reviewed));
  assert.equal(reviewed.stuck, false);
  assert.equal(reviewed.model, "session/last");

  const tested = await gateway.test();
  assert.equal(tested.ok, true);
  assert.equal(tested.model, "p/m");
  assert.deepEqual(requests.map(request => `${request.provider}/${request.model}`), ["p/m", "p2/m2", "session/last", "p/m"]);
});

test("the Host model port may become available after gateway creation", async () => {
  let current;
  const requests = [];
  const gateway = createModelGateway({
    settingsStore: { get: () => normalizeSettings({ provider: "p", model: "m" }) },
    llm: () => current,
    resolveRoute: route,
  });
  assert.equal((await gateway.complete({ system: "s", user: "u" })).reason, "no-llm");
  current = hostLlm(requests);
  assert.equal((await gateway.complete({ system: "s", user: "u" })).ok, true);
});

test("the external driver needs only settings and fetch, with no Host model service", async () => {
  const calls = [];
  const settings = normalizeSettings({
    source: "external", endpoint: "https://example.test/v1/chat/completions",
    externalModel: "external-m", apiKey: "secret-key",
  });
  const gateway = createModelGateway({
    settingsStore: { get: () => settings },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ choices: [{ message: { content: "ready" }, finish_reason: "stop" }] }) };
    },
  });
  const result = await gateway.complete({ system: "s", user: "u" });
  assert.equal(result.ok, true);
  assert.equal(result.model, "example.test/external-m");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.authorization, "Bearer secret-key");
  assert.doesNotMatch(JSON.stringify(result), /secret-key/);
});
