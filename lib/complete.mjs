// One generic text completion through whichever source the analysis settings
// select. Shared by digests and follow-ups; the review path keeps its own
// verdict contract in review.mjs.

import { collectStream } from "./review.mjs";
import { settingsProblem, isUnset } from "./settings.mjs";

/**
 * @returns {Promise<{ok:true,text:string,model:string}|{ok:false,reason:string,detail:string}>}
 */
export async function complete({ settings, llm, resolveRoute, system, user, maxTokens, timeoutMs, fetchImpl, signal }) {
  const problem = settingsProblem(settings);
  if (problem) return { ok: false, ...problem };
  const limit = Math.max(5000, Number(timeoutMs ?? settings.timeoutMs) || 60000);
  const tokens = Math.max(256, Number(maxTokens ?? settings.maxTokens) || 1024);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limit);
  const onAbort = () => controller.abort();
  signal?.addEventListener?.("abort", onAbort, { once: true });
  const temperature = isUnset(settings.temperature) ? undefined : settings.temperature;
  try {
    if (settings.source === "external") {
      const doFetch = fetchImpl ?? globalThis.fetch;
      const label = `${new URL(settings.endpoint).host}/${settings.externalModel}`;
      const response = await doFetch(settings.endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: settings.externalModel,
          ...(temperature === undefined ? {} : { temperature }),
          max_tokens: tokens,
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
        }),
      });
      if (!response.ok) {
        let body = "";
        try { body = (await response.text()).slice(0, 300); } catch { /* none */ }
        return { ok: false, reason: response.status === 401 || response.status === 403 ? "bad-key" : "failed", detail: `HTTP ${response.status}${body ? `: ${body}` : ""}` };
      }
      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content;
      const text = typeof content === "string"
        ? content
        : Array.isArray(content) ? content.map(p => (typeof p === "string" ? p : p?.text ?? "")).join("") : "";
      if (!text.trim()) return { ok: false, reason: "empty", detail: `${label} returned no text` };
      return { ok: true, text: text.trim(), model: label };
    }

    if (!llm?.stream) return { ok: false, reason: "no-llm", detail: "The Host model service is unavailable." };
    const route = await resolveRoute(settings);
    if (!route?.provider || !route?.model) return { ok: false, reason: "no-model", detail: "No provider/model is available." };
    const label = `${route.provider}/${route.model}`;
    const collected = await collectStream(llm.stream({
      provider: route.provider,
      model: route.model,
      system,
      messages: [{ role: "user", content: [{ type: "text", text: user }] }],
      ...(temperature === undefined ? {} : { temperature }),
      maxTokens: tokens,
      signal: controller.signal,
    }));
    if (controller.signal.aborted) return { ok: false, reason: "timeout", detail: `No answer within ${limit} ms.` };
    if (collected.failure) return { ok: false, reason: "failed", detail: `${collected.failure.code ?? "error"}: ${collected.failure.message ?? ""}`.slice(0, 400) };
    if (!collected.text) return { ok: false, reason: "empty", detail: `${label} returned no text` };
    // A length stop still carries useful text; the parser tolerates truncation.
    return { ok: true, text: collected.text, model: label, truncated: collected.finish?.kind !== "stop" };
  } catch (error) {
    return {
      ok: false,
      reason: controller.signal.aborted ? "timeout" : "failed",
      detail: controller.signal.aborted ? `No answer within ${limit} ms.` : String(error?.message ?? error).slice(0, 400),
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", onAbort);
  }
}
