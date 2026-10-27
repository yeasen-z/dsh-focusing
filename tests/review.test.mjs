import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReviewPrompt,
  collectStream,
  reviewWithHostLlm,
  reviewWithExternal,
  createRouteResolver,
  composeSystemPrompt,
  DEFAULT_PERSONA,
  OUTPUT_CONTRACT,
  finishReview,
  readCompletionText,
} from "../lib/review.mjs";
import { normalizeSettings, DEFAULT_SETTINGS, settingsProblem, mergeSettings } from "../lib/settings.mjs";

async function* chunks(list) {
  for (const item of list) yield item;
}

const metadata = { project: "demo", cwd: "/w/demo", goal: "把列表改成工作区式", turnSteps: 7 };
const settings = normalizeSettings({});

test("prompt carries the request, the project, and the failures", () => {
  const prompt = buildReviewPrompt(settings, metadata, [
    { name: "Edit", path: "a.js" },
    { name: "Bash", command: "npm test", status: "failed", output: "1 failing" },
  ]);
  assert.match(prompt, /PROJECT: demo/);
  assert.match(prompt, /把列表改成工作区式/);
  assert.match(prompt, /1 failed/);
  assert.match(prompt, /\[FAILED\]/);
  assert.match(prompt, /1 failing/);
});

test("prompt bounds how much activity it sends", () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ name: "Bash", command: `cmd ${i}` }));
  const prompt = buildReviewPrompt(settings, metadata, many);
  assert.match(prompt, /last 40 tool calls/);
  assert.match(prompt, /cmd 199/);
  assert.doesNotMatch(prompt, /cmd 0$/m);
});

test("long tool output is clipped so one call cannot flood the prompt", () => {
  const prompt = buildReviewPrompt(settings, metadata, [
    { name: "Bash", command: "cat big", status: "failed", output: "x".repeat(5000) },
  ]);
  assert.ok(prompt.length < 3000, `prompt was ${prompt.length} chars`);
  assert.match(prompt, /chars\)/);
});

test("visibility switches remove content from the prompt", () => {
  const hidden = normalizeSettings({
    includeGoal: false, includeProject: false, includeToolArgs: false, includeToolOutput: false,
  });
  const prompt = buildReviewPrompt(hidden, metadata, [{ name: "Edit", path: "secret.js", output: "SECRET_OUT" }]);
  assert.doesNotMatch(prompt, /demo/);
  assert.doesNotMatch(prompt, /secret\.js/);
  assert.doesNotMatch(prompt, /SECRET_OUT/);
  assert.doesNotMatch(prompt, /把列表改成工作区式/);
  assert.match(prompt, /WHAT HAPPENED/);
});

test("the default persona may say NORMAL, and the contract is appended", () => {
  assert.match(DEFAULT_PERSONA, /no prior context/);
  assert.match(DEFAULT_PERSONA, /Most are/);
  assert.match(composeSystemPrompt(settings), /VERDICT: NORMAL or STUCK/);
  assert.ok(composeSystemPrompt(settings).startsWith(DEFAULT_PERSONA.slice(0, 20)));
});

test("a custom persona cannot drop the answer contract", () => {
  const custom = normalizeSettings({ persona: "You are terse." });
  const system = composeSystemPrompt(custom);
  assert.match(system, /You are terse\./);
  assert.match(system, /VERDICT: NORMAL or STUCK/);
});

test("streamed text is collected and a clean finish is reported", async () => {
  const result = await collectStream(chunks([
    { type: "text-delta", text: "VERDICT: " },
    { type: "text-delta", text: "NORMAL" },
    { type: "finish", reason: { kind: "stop" } },
  ]));
  assert.equal(result.text, "VERDICT: NORMAL");
  assert.equal(result.finish.kind, "stop");
});

test("a review asks the configured model directly, with no agent involved", async () => {
  const calls = [];
  const llm = {
    stream(options) {
      calls.push(options);
      return chunks([{ type: "text-delta", text: "VERDICT: NORMAL" }, { type: "finish", reason: { kind: "stop" } }]);
    },
  };
  const review = await reviewWithHostLlm({
    llm,
    resolveRoute: async () => ({ provider: "deepseek", model: "deepseek-chat" }),
    settings: normalizeSettings({ provider: "deepseek", model: "deepseek-chat" }),
    metadata,
    activities: [],
  });
  assert.equal(review.ok, true);
  assert.equal(review.stuck, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, "deepseek");
  assert.equal(calls[0].model, "deepseek-chat");
  assert.match(calls[0].system, /VERDICT: NORMAL or STUCK/);
  assert.equal('temperature' in calls[0], false, 'the key is absent, not sent as null');
  assert.equal(review.model, "deepseek/deepseek-chat");
});

test("a model that refuses temperature is retried once without it", async () => {
  const calls = [];
  const llm = {
    stream(options) {
      calls.push(options);
      if ("temperature" in options) {
        return chunks([{ type: "finish", reason: { kind: "error", failure: {
          code: "INVALID_REQUEST",
          message: "Unsupported parameter: 'temperature' is not supported with this model.",
        } } }]);
      }
      return chunks([{ type: "text-delta", text: "VERDICT: NORMAL" }, { type: "finish", reason: { kind: "stop" } }]);
    },
  };
  const review = await reviewWithHostLlm({
    llm,
    resolveRoute: async () => ({ provider: "deepseek", model: "deepseek-reasoner" }),
    settings: normalizeSettings({ provider: "deepseek", model: "deepseek-reasoner", temperature: 0.5 }),
    metadata,
    activities: [],
  });
  assert.equal(calls.length, 2, "one attempt with temperature, one without");
  assert.equal(calls[0].temperature, 0.5);
  assert.equal("temperature" in calls[1], false);
  assert.equal(review.ok, true, "the review still succeeds");
  assert.deepEqual(review.dropped, ["temperature"], "the panel can say what was dropped");
});

test("an unrelated failure is not retried and stays a failure", async () => {
  let calls = 0;
  const llm = {
    stream() {
      calls++;
      return chunks([{ type: "finish", reason: { kind: "error", failure: { code: "AUTH", message: "bad key" } } }]);
    },
  };
  const review = await reviewWithHostLlm({
    llm,
    resolveRoute: async () => ({ provider: "p", model: "m" }),
    settings: normalizeSettings({ provider: "p", model: "m" }),
    metadata,
    activities: [],
  });
  assert.equal(calls, 1, "an auth failure must not be retried");
  assert.equal(review.ok, false);
  assert.match(review.detail, /bad key/);
});

test("STUCK is read from the verdict line only", async () => {
  const llm = {
    stream: () => chunks([
      { type: "text-delta", text: "VERDICT: STUCK\nEVIDENCE: e\nNEXT: n" },
      { type: "finish", reason: { kind: "stop" } },
    ]),
  };
  const review = await reviewWithHostLlm({
    llm, resolveRoute: async () => ({ provider: "p", model: "m" }), settings, metadata, activities: [],
  });
  assert.equal(review.ok, true);
  assert.equal(review.stuck, true);
});

test("a session with nothing wrong is not reported as stuck", async () => {
  const llm = {
    stream: () => chunks([
      { type: "text-delta", text: "VERDICT: NORMAL\nIt looks stuck on nothing." },
      { type: "finish", reason: { kind: "stop" } },
    ]),
  };
  const review = await reviewWithHostLlm({
    llm, resolveRoute: async () => ({ provider: "p", model: "m" }), settings, metadata, activities: [],
  });
  assert.equal(review.ok, true);
  assert.equal(review.stuck, false);
});

test("missing capability and missing model are named, not guessed", async () => {
  const noService = await reviewWithHostLlm({ llm: undefined, resolveRoute: async () => ({}), settings, metadata });
  assert.equal(noService.reason, "no-llm");
  const noRoute = await reviewWithHostLlm({ llm: { stream() {} }, resolveRoute: async () => undefined, settings, metadata });
  assert.equal(noRoute.reason, "no-model");
});

test("a provider failure is surfaced with its code", async () => {
  const llm = {
    stream: () => chunks([{ type: "finish", reason: { kind: "error", failure: { code: "AUTH", message: "invalid api key" } } }]),
  };
  const review = await reviewWithHostLlm({
    llm, resolveRoute: async () => ({ provider: "p", model: "m" }), settings, metadata, activities: [],
  });
  assert.equal(review.ok, false);
  assert.match(review.detail, /AUTH/);
  assert.match(review.detail, /invalid api key/);
});

test("an empty answer is a failure, not a clean review", async () => {
  const silent = { stream: () => chunks([{ type: "finish", reason: { kind: "stop" } }]) };
  const review = await reviewWithHostLlm({
    llm: silent, resolveRoute: async () => ({ provider: "p", model: "m" }), settings, metadata,
  });
  assert.equal(review.ok, false);
  assert.equal(review.reason, "empty");
});

test("route follows the configured model, then the live default, then the session", async () => {
  const configured = createRouteResolver({
    defaultModel: { currentSelection: () => ({ provider: "deepseek", model: "v4.1-flash" }) },
    session: {},
  });
  assert.deepEqual(await configured(normalizeSettings({ provider: "x", model: "y" })), { provider: "x", model: "y" });

  const fromDefault = await configured(normalizeSettings({}));
  assert.deepEqual(fromDefault, { provider: "deepseek", model: "v4.1-flash" });

  const fromSession = createRouteResolver({
    defaultModel: undefined,
    session: { requestHeader: () => ({ config: { provider: "sess-p", model: "sess-m" } }) },
  });
  assert.deepEqual(await fromSession(normalizeSettings({})), { provider: "sess-p", model: "sess-m" });
});

test("terminal abort or truncation never saves a partial verdict as success", async () => {
  for (const kind of ["aborted", "length", "error"]) {
    const result = await reviewWithHostLlm({
      llm: { stream: () => chunks([
        { type: "text-delta", text: "VERDICT: NORMAL" },
        { type: "finish", reason: { kind, failure: { code: "CANCELLED", message: "cancelled" } } },
      ]) },
      resolveRoute: async () => ({ provider: "p", model: "m" }), settings, metadata, activities: [],
    });
    assert.equal(result.ok, false, `${kind} was reported as success`);
  }
});

test("unstructured output is not silently treated as NORMAL", () => {
  const result = finishReview({ text: "Something went wrong.", stoppedCleanly: true, route: "p/m", detailLabel: "p/m" });
  assert.equal(result.ok, false);
});

test("an external endpoint receives the full prompt and returns a parsed verdict", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "VERDICT: STUCK\nEVIDENCE: x" }, finish_reason: "stop" }] }),
    };
  };
  const external = normalizeSettings({
    source: "external",
    endpoint: "https://api.example.com/v1/chat/completions",
    apiKey: "sk-secret",
    externalModel: "gpt-4o-mini",
  });
  const result = await reviewWithExternal({ settings: external, metadata, activities: [], fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.stuck, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.authorization, "Bearer sk-secret");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, "gpt-4o-mini");
  assert.match(body.messages[0].content, /VERDICT: NORMAL or STUCK/);
  assert.match(body.messages[1].content, /WHAT HAPPENED/);
});

test("an external failure reports the service message but never the key", async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, text: async () => "invalid api key" });
  const external = normalizeSettings({
    source: "external", endpoint: "https://api.example.com/v1/chat/completions",
    apiKey: "sk-secret", externalModel: "m",
  });
  const result = await reviewWithExternal({ settings: external, metadata, activities: [], fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "bad-key");
  assert.match(result.detail, /401/);
  assert.doesNotMatch(JSON.stringify(result), /sk-secret/);
});

test("external settings are validated before any request", () => {
  assert.equal(settingsProblem(normalizeSettings({ source: "external" })).reason, "no-endpoint");
  assert.equal(settingsProblem(normalizeSettings({ source: "external", endpoint: "not a url", externalModel: "m" })).reason, "bad-endpoint");
  assert.equal(settingsProblem(normalizeSettings({ source: "external", endpoint: "https://a/b" })).reason, "no-model");
  assert.equal(settingsProblem(normalizeSettings({ provider: "p" })), undefined);
});

test("an empty submitted key keeps the stored one", () => {
  const stored = normalizeSettings({ apiKey: "sk-old" });
  assert.equal(mergeSettings(stored, { apiKey: "" }).apiKey, "sk-old");
  assert.equal(mergeSettings(stored, { apiKey: "sk-new" }).apiKey, "sk-new");
  assert.equal(mergeSettings(stored, { apiKey: null }).apiKey, "");
});

test("numbers are clamped to sane ranges", () => {
  const wild = normalizeSettings({ maxActivities: 9999, maxTokens: 1, temperature: -3, timeoutMs: 10 });
  assert.equal(wild.maxActivities, DEFAULT_SETTINGS.maxActivities === 40 ? 200 : wild.maxActivities);
  assert.equal(wild.maxTokens, 64);
  assert.equal(normalizeSettings({}).temperature, null, 'temperature defaults to unset');
  assert.equal(wild.temperature, 0, 'a negative value is clamped up to 0, and 0 is sent when set');
  assert.equal(wild.timeoutMs, 5000);
});

test("an aborted review reports a timeout", async () => {
  const hanging = {
    stream(options) {
      return (async function* () {
        await new Promise((resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(new Error("aborted")));
        });
      })();
    },
  };
  const review = await reviewWithHostLlm({
    llm: hanging, resolveRoute: async () => ({ provider: "p", model: "m" }),
    settings: normalizeSettings({ timeoutMs: 5000 }), metadata, activities: [],
  });
  assert.equal(review.ok, false);
});

test("readCompletionText accepts string and block-array content", () => {
  assert.equal(readCompletionText({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }).text, "ok");
  assert.equal(readCompletionText({ choices: [{ message: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] } }] }).text, "ab");
  assert.equal(readCompletionText({}).text, "");
});
