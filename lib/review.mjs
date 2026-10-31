/**
 * Review a session with a model, using the person's analysis settings.
 *
 * Two transports, one contract:
 *   - "dsh"      `llm.stream()` on a model the Host already authenticates.
 *   - "external" an OpenAI-compatible chat-completions endpoint.
 *
 * Neither creates an Agent or a subagent, so a finished chat can be reviewed.
 */

import { composeSystemPrompt, settingsProblem, isUnset } from "./settings.mjs";

export { DEFAULT_PERSONA, OUTPUT_CONTRACT, composeSystemPrompt } from "./settings.mjs";

const VERDICT_LINE = /^\s*VERDICT:\s*(NORMAL|STUCK)\s*$/im;

function clip(text, limit) {
  const value = String(text ?? "");
  if (!limit || value.length <= limit) return value;
  return `${value.slice(0, limit)}…(${value.length} chars)`;
}

function renderActivity(entry, index, settings) {
  const name = entry.name || entry.tool || "tool";
  const target = entry.command || entry.cmd || entry.path || entry.file || "";
  const failed = entry.failed || entry.status === "failed" ? " [FAILED]" : "";
  const head = `${index + 1}. ${name}${failed}`;
  const parts = [settings.includeToolArgs && target ? `${head} → ${target}` : head];
  if (settings.includeToolOutput) {
    const output = clip(entry.output ?? entry.result ?? "", settings.excerptChars);
    if (output) parts.push(`   output: ${output}`);
  }
  return parts.join("\n");
}

/**
 * Build the reviewer prompt from what the panel already knows, honouring the
 * visibility switches so the person controls exactly what leaves their machine.
 */
export function buildReviewPrompt(settings, metadata = {}, rawActivities = []) {
  const activities = (rawActivities || []).slice(-settings.maxActivities);
  const failures = activities.filter((a) => a.failed || a.status === "failed").length;
  const lines = [];

  if (settings.includeProject) {
    lines.push(`PROJECT: ${metadata.project || "(unknown)"}`);
    if (metadata.cwd) lines.push(`CWD: ${metadata.cwd}`);
    lines.push("");
  }
  if (settings.includeGoal) {
    lines.push("THE PERSON'S REQUEST:");
    lines.push(metadata.goal ? clip(metadata.goal, 1200) : "(no explicit request captured)");
    lines.push("");
  }
  lines.push(`WHAT HAPPENED (last ${activities.length} tool calls, ${failures} failed):`);
  lines.push(activities.length
    ? activities.map((entry, index) => renderActivity(entry, index, settings)).join("\n")
    : "(no tool calls recorded)");

  if (metadata.turnSteps) lines.push("", `STEPS IN THE CURRENT TURN: ${metadata.turnSteps}`);
  return lines.join("\n");
}

/** Collect DSH `llm.stream()` chunks into one answer plus its terminal state. */
export async function collectStream(stream) {
  let text = "";
  let finish;
  let failure;
  for await (const chunk of stream) {
    if (chunk?.type === "text-delta") text += chunk.text ?? "";
    else if (chunk?.type === "finish") {
      finish = chunk.reason;
      if (finish?.kind === "error" || finish?.kind === "aborted") failure = finish.failure;
    }
  }
  return { text: text.trim(), finish, failure };
}

/** Turn a finished answer into the review shape the panel renders, or a failure. */
export function finishReview({ text, stoppedCleanly, failure, route, detailLabel }) {
  if (failure) {
    return { ok: false, reason: "failed", detail: `${failure.code ?? "error"}: ${failure.message ?? ""}`.slice(0, 400) };
  }
  if (!stoppedCleanly) {
    return { ok: false, reason: "failed", detail: `${detailLabel}: incomplete answer` };
  }
  if (!text) {
    return { ok: false, reason: "empty", detail: `${detailLabel} returned no text` };
  }
  if (!VERDICT_LINE.test(text)) {
    return { ok: false, reason: "failed", detail: `${detailLabel}: answer has no NORMAL/STUCK verdict` };
  }
  return {
    ok: true,
    stuck: /^\s*VERDICT:\s*STUCK\s*$/im.test(text),
    reason: text,
    at: Date.now(),
    model: route,
    source: detailLabel,
  };
}

/**
 * A model may refuse an optional sampling parameter outright (reasoning models
 * reject `temperature` with HTTP 400 "Unsupported parameter"). Recognise that
 * specific refusal so the call can be retried without the parameter rather than
 * failing the whole review.
 *
 * The failure can arrive two ways: thrown while building the stream, or as a
 * terminal `finish` reason carrying a provider failure. Both are checked.
 */
function refusesParameter(source, name) {
  const text = [
    source?.message,
    source?.code,
    source?.param,
    source?.failure?.message,
    source?.failure?.code,
  ].filter(Boolean).join(" ");
  return source?.param === name
    || new RegExp(`unsupported[^.]*${name}|${name}[^.]*not supported`, "i").test(text);
}

/**
 * Call a model the Host already has credentials for.
 * No Agent is involved; only `llm.stream()`.
 */
export async function reviewWithHostLlm({ llm, resolveRoute, settings, metadata, activities }) {
  if (!llm?.stream) {
    return { ok: false, reason: "no-llm", detail: "The Host model service is unavailable." };
  }
  let route;
  try {
    route = await resolveRoute();
  } catch (error) {
    return { ok: false, reason: "no-model", detail: String(error?.message ?? error).slice(0, 300) };
  }
  if (!route?.provider || !route?.model) {
    return { ok: false, reason: "no-model", detail: "No provider/model is available for the review." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
  // An unset temperature is not sent at all: many models reject it, and the
  // person never asked for a specific value.
  let temperature = isUnset(settings.temperature) ? undefined : settings.temperature;
  const start = (withTemperature) => llm.stream({
    provider: route.provider,
    model: route.model,
    system: composeSystemPrompt(settings),
    messages: [{ role: "user", content: [{ type: "text", text: buildReviewPrompt(settings, metadata, activities) }] }],
    ...(withTemperature === undefined ? {} : { temperature: withTemperature }),
    maxTokens: settings.maxTokens,
    signal: controller.signal,
  });
  try {
    let stream;
    try {
      stream = start(temperature);
    } catch (error) {
      // Some providers reject the request while building the stream.
      if (temperature === undefined || !refusesParameter(error, "temperature")) throw error;
      temperature = undefined;
      stream = start(undefined);
    }
    let collected;
    try {
      collected = await collectStream(stream);
    } catch (error) {
      if (temperature === undefined || !refusesParameter(error, "temperature")) throw error;
      // The refusal arrived as a streamed error chunk: quietly run once more
      // without the parameter and keep the setting as the person saved it.
      temperature = undefined;
      collected = { ...(await collectStream(start(undefined))), dropped: ["temperature"] };
    }
    // A refused parameter normally arrives as a terminal failure chunk rather
    // than a thrown error, so it must be inspected after collection too.
    if (temperature !== undefined && collected.finish?.failure
      && refusesParameter(collected.finish.failure, "temperature")) {
      temperature = undefined;
      collected = { ...(await collectStream(start(undefined))), dropped: ["temperature"] };
    }
    if (controller.signal.aborted) {
      return { ok: false, reason: "timeout", detail: `No answer within ${settings.timeoutMs} ms.` };
    }
    return {
      ...finishReview({
        ...collected,
        stoppedCleanly: collected.finish?.kind === "stop",
        route: `${route.provider}/${route.model}`,
        detailLabel: `${route.provider}/${route.model}`,
      }),
      dropped: collected.dropped ?? [],
    };
  } catch (error) {
    return {
      ok: false,
      reason: controller.signal.aborted ? "timeout" : "failed",
      detail: String(error?.message ?? error).slice(0, 400),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Extract the assistant text from an OpenAI-compatible response body. */
export function readCompletionText(body) {
  const choice = body?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === "string") return { text: content.trim(), finishReason: choice?.finish_reason };
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (typeof part === "string" ? part : part?.type === "text" ? part.text ?? "" : ""))
      .join("");
    return { text: text.trim(), finishReason: choice?.finish_reason };
  }
  return { text: "", finishReason: choice?.finish_reason };
}

/**
 * Call an OpenAI-compatible endpoint.
 *
 * `fetchImpl` is injected so the contract can be tested without the network.
 * The key is sent only in the Authorization header and never logged or returned.
 */
export async function reviewWithExternal({ settings, metadata, activities, fetchImpl }) {
  const problem = settingsProblem(settings);
  if (problem) return { ok: false, ...problem };
  const doFetch = fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== "function") {
    return { ok: false, reason: "no-fetch", detail: "No fetch implementation is available." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
  const label = `${new URL(settings.endpoint).host}/${settings.externalModel}`;
  try {
    const response = await doFetch(settings.endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: settings.externalModel,
        temperature: isUnset(settings.temperature) ? undefined : settings.temperature,
        max_tokens: settings.maxTokens,
        messages: [
          { role: "system", content: composeSystemPrompt(settings) },
          { role: "user", content: buildReviewPrompt(settings, metadata, activities) },
        ],
      }),
    });

    if (!response.ok) {
      // The service's own message is what the person needs to see; the key is not.
      let body = "";
      try {
        body = (await response.text()).slice(0, 300);
      } catch {
        body = "";
      }
      return {
        ok: false,
        reason: response.status === 401 || response.status === 403 ? "bad-key" : "failed",
        detail: `HTTP ${response.status}${body ? `: ${body}` : ""}`,
      };
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, reason: "failed", detail: "The endpoint did not return JSON." };
    }
    const { text, finishReason } = readCompletionText(payload);
    return finishReview({
      text,
      stoppedCleanly: finishReason === "stop" || finishReason === undefined,
      failure: undefined,
      route: label,
      detailLabel: label,
    });
  } catch (error) {
    return {
      ok: false,
      reason: controller.signal.aborted ? "timeout" : "failed",
      detail: controller.signal.aborted
        ? `No answer within ${settings.timeoutMs} ms.`
        : String(error?.message ?? error).slice(0, 400),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Run one review through whichever source the settings select. */
export function runReview({ settings, llm, resolveRoute, session, metadata, activities, fetchImpl }) {
  const problem = settingsProblem(settings);
  if (problem) return Promise.resolve({ ok: false, ...problem });
  if (settings.source === "external") {
    return reviewWithExternal({ settings, metadata, activities, fetchImpl });
  }
  return reviewWithHostLlm({
    llm,
    resolveRoute: () => resolveRoute(settings),
    settings,
    metadata,
    activities,
  });
}

/**
 * Prove that the configured source answers at all. This is NOT a review: it
 * sends one trivial exchange and accepts any reply, because a connection test
 * checks reachability and credentials, not the verdict contract.
 */
export async function testConnection({ settings, llm, resolveRoute, fetchImpl }) {
  const problem = settingsProblem(settings);
  if (problem) return { ok: false, ...problem };
  const probe = "Reply with the single word: ready.";
  if (settings.source === "external") {
    const doFetch = fetchImpl ?? globalThis.fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(settings.timeoutMs, 30000));
    try {
      const response = await doFetch(settings.endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: settings.externalModel,
          max_tokens: 16,
          messages: [
            { role: "system", content: probe },
            { role: "user", content: probe },
          ],
        }),
      });
      if (!response.ok) {
        let body = "";
        try {
          body = (await response.text()).slice(0, 200);
        } catch {
          body = "";
        }
        return {
          ok: false,
          reason: response.status === 401 || response.status === 403 ? "bad-key" : "failed",
          detail: `HTTP ${response.status}${body ? `: ${body}` : ""}`,
        };
      }
      return { ok: true, model: `${new URL(settings.endpoint).host}/${settings.externalModel}` };
    } catch (error) {
      return {
        ok: false,
        reason: controller.signal.aborted ? "timeout" : "failed",
        detail: String(error?.message ?? error).slice(0, 300),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  if (!llm?.stream) return { ok: false, reason: "no-llm", detail: "The Host model service is unavailable." };
  let route;
  try {
    route = await resolveRoute(settings);
  } catch (error) {
    return { ok: false, reason: "no-model", detail: String(error?.message ?? error).slice(0, 300) };
  }
  if (!route?.provider || !route?.model) {
    return { ok: false, reason: "no-model", detail: "No provider/model is available." };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(settings.timeoutMs, 30000));
  try {
    const stream = llm.stream({
      provider: route.provider,
      model: route.model,
      system: probe,
      messages: [{ role: "user", content: [{ type: "text", text: probe }] }],
      temperature: 0,
      maxTokens: 16,
      signal: controller.signal,
    });
    const { failure, finish } = await collectStream(stream);
    if (controller.signal.aborted) {
      return { ok: false, reason: "timeout", detail: "No answer in time." };
    }
    if (failure || finish?.kind === "error") {
      return { ok: false, reason: "failed", detail: `${failure?.code ?? "error"}: ${failure?.message ?? ""}` };
    }
    return { ok: true, model: `${route.provider}/${route.model}` };
  } catch (error) {
    return {
      ok: false,
      reason: controller.signal.aborted ? "timeout" : "failed",
      detail: String(error?.message ?? error).slice(0, 300),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the Host route: the configured pair, else the live default, else the
 * model this session last ran on.
 */
export function createRouteResolver({ defaultModel, session }) {
  return async (settings) => {
    if (settings?.provider && settings?.model) {
      return { provider: settings.provider, model: settings.model };
    }
    const selection = defaultModel?.currentSelection?.();
    if (selection?.provider && selection?.model) {
      return { provider: selection.provider, model: selection.model };
    }
    const route = session?.requestHeader?.()?.config || session?.requestContext?.();
    if (route?.provider && route?.model) {
      return { provider: route.provider, model: route.model };
    }
    return undefined;
  };
}

/**
 * What to do about a saved provider/model pair that the catalogue no longer
 * matches. A model id may contain "/" ("copilot/auto"); a value saved while the
 * picker split on every slash arrives truncated there. Repair it to the single
 * model it started. When the provider serves nothing of that name at all, the
 * pair is dead and every call fails with UNKNOWN_MODEL, so the pair is cleared
 * and the DSH default (the "follow the default model" choice) takes over.
 * Returns a settings patch, or undefined when nothing needs changing.
 */
export async function repairModelRoute(llm, settings) {
  // Only the Host-model path uses this pair; an external endpoint has its own.
  if (settings?.source && settings.source !== "dsh") return undefined;
  if (!settings?.provider || !settings?.model || !llm?.listModels) return undefined;
  try {
    const models = (await llm.listModels(settings.provider)) ?? [];
    const ids = models.map(model => model?.id).filter(id => typeof id === "string" && id);
    if (!ids.length || ids.includes(settings.model)) return undefined;
    const longer = ids.filter(id => id.startsWith(`${settings.model}/`));
    if (longer.length === 1) return { model: longer[0] };
    return { provider: "", model: "" };
  } catch {
    return undefined;
  }
}
