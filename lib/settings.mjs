/**
 * Analysis settings: which model answers, what it is told, what context it sees.
 *
 * Two sources are supported:
 *   - "dsh"      reuses a model the Host already has credentials for. No Agent
 *                and no subagent is created, so a finished chat can be reviewed.
 *   - "external" calls an OpenAI-compatible chat-completions endpoint directly.
 *
 * Credentials are held here and never leave the Host: the Client receives a
 * redacted view, and the transcript export never contains them.
 */

/** Reviewer persona: a sceptical reader with no stake in the work. */
export const DEFAULT_PERSONA = `You are a careful reviewer of a coding agent's work log.

You have no prior context beyond the log you are given, and no stake in the outcome.
You read what actually happened and judge one thing only: is this session going
badly in a way the person driving it would want pointed out.

Look for:
- Repetition: the same command, file, or failed fix tried again with no new information.
- Goal drift: the original request no longer being addressed, or silently dropped.
- Tool misuse: editing without reading, blind retries, ignoring a failure already shown.
- Wrong priority: polishing details while the stated task is unfinished, or vice versa.

Rules:
- Judge only from the log. Never invent an event that is not there.
- A session can be completely normal. Most are. Say so plainly.
- Do not pad. If nothing is wrong, one sentence is enough.`;

/**
 * The answer contract is NOT editable: the panel reads a verdict out of it, and
 * a free-form persona would silently break that. The person edits the persona;
 * this stays fixed and is appended to every request.
 */
export const OUTPUT_CONTRACT = `Answer in exactly this form, in the language of the log:

VERDICT: NORMAL or STUCK
EVIDENCE: one or two concrete quotes or event references from the log (omit for NORMAL)
NEXT: one concrete action the person could take (omit for NORMAL)`;

export const DEFAULT_SETTINGS = {
  source: "dsh",
  // Used when source is "dsh". Empty means "whatever the Host defaults to".
  provider: "",
  model: "",
  // Used when source is "external". OpenAI-compatible by default.
  endpoint: "",
  apiKey: "",
  externalModel: "",
  persona: DEFAULT_PERSONA,
  // Archived chats keep their Workspace slot, so they still appear in the
  // session roster. Off by default: they were archived on purpose.
  loadArchived: false,
  // What the reviewer is allowed to see.
  includeGoal: true,
  includeProject: true,
  includeUserText: true,
  includeToolArgs: true,
  includeToolOutput: true,
  maxActivities: 40,
  excerptChars: 400,
  // Call parameters.
  maxTokens: 1024,
  // Empty means "do not send temperature at all". Many reasoning models reject
  // it outright (HTTP 400 "Unsupported parameter"), so silence is the safe
  // default; a value is only sent when the person actually sets one.
  temperature: null,
  timeoutMs: 60000,
};

/** True when a parameter has no value and must be left out of the request. */
export const isUnset = (value) => value === null || value === undefined || value === "";

const LIMITS = {
  maxActivities: { min: 1, max: 200 },
  excerptChars: { min: 0, max: 4000 },
  maxTokens: { min: 64, max: 8192 },
  temperature: { min: 0, max: 2 },
  timeoutMs: { min: 5000, max: 300000 },
};

function clampNumber(value, fallback, { min, max }) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function asText(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

/** Coerce stored or submitted settings into a valid, complete record. */
export function normalizeSettings(input = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...(input ?? {}) };
  const out = {
    source: merged.source === "external" ? "external" : "dsh",
    provider: asText(merged.provider).trim(),
    model: asText(merged.model).trim(),
    endpoint: asText(merged.endpoint).trim(),
    apiKey: asText(merged.apiKey),
    externalModel: asText(merged.externalModel).trim(),
    persona: asText(merged.persona, DEFAULT_PERSONA).trim() || DEFAULT_PERSONA,
    // Strictly opt-in: anything that is not a literal true stays off.
    loadArchived: merged.loadArchived === true,
    includeGoal: merged.includeGoal !== false,
    includeProject: merged.includeProject !== false,
    includeUserText: merged.includeUserText !== false,
    includeToolArgs: merged.includeToolArgs !== false,
    includeToolOutput: merged.includeToolOutput !== false,
  };
  for (const [key, range] of Object.entries(LIMITS)) {
    if (key === "temperature") {
      // Unset stays unset (nothing is sent); a real value is clamped.
      out[key] = isUnset(merged[key]) ? null : clampNumber(merged[key], 0, range);
      continue;
    }
    out[key] = clampNumber(merged[key], DEFAULT_SETTINGS[key], range);
  }
  return out;
}

/** The whole system prompt: the person's persona plus the fixed answer contract. */
export function composeSystemPrompt(settings) {
  const persona = asText(settings?.persona, DEFAULT_PERSONA).trim() || DEFAULT_PERSONA;
  return `${persona}\n\n${OUTPUT_CONTRACT}`;
}

/**
 * Validate what the chosen source needs before a call is attempted, so the
 * panel can explain the problem instead of failing inside the request.
 */
export function settingsProblem(settings) {
  if (settings.source === "external") {
    if (!settings.endpoint) return { reason: "no-endpoint", detail: "External endpoint URL is empty." };
    let url;
    try {
      url = new URL(settings.endpoint);
    } catch {
      return { reason: "bad-endpoint", detail: `Not a valid URL: ${settings.endpoint}` };
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { reason: "bad-endpoint", detail: "Endpoint must be an http(s) URL." };
    }
    if (!settings.externalModel) return { reason: "no-model", detail: "External model name is empty." };
    return undefined;
  }
  if (settings.model && !settings.provider) {
    return { reason: "no-model", detail: "A model is set without a provider." };
  }
  return undefined;
}

/** What the panel may see: never the key, but whether one is stored. */
export function publicSettings(settings) {
  const { apiKey, ...rest } = settings;
  return { ...rest, hasApiKey: Boolean(apiKey) };
}

/**
 * Merge a submitted patch into stored settings.
 *
 * An empty submitted `apiKey` means "leave the stored key alone", so the panel
 * can show a masked field without requiring the person to retype the secret.
 */
export function mergeSettings(stored, patch = {}) {
  const next = { ...stored };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    if (key === "apiKey") {
      if (typeof value === "string" && value.length > 0) next.apiKey = value;
      if (value === null) next.apiKey = "";
      continue;
    }
    next[key] = value;
  }
  return normalizeSettings(next);
}
