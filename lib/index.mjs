// dsh-focusing — Host half.
//
// Watches the LIVE agent loop for the deterministic fingerprints of being stuck
// and, when it finds them, changes what the next step is allowed to do. Three
// interventions, in increasing strength, each independently switchable:
//
//   soft     `agent/pre-step` prepends a course-correction context to the step.
//   hard     `tools/pre-execute` denies the call that keeps repeating.
//   subagent a clean-context child is asked for the global diagnosis, and its
//            conclusion is what the soft correction carries.
//
// Deriving the signals
// --------------------
// Two sources, used for different jobs:
//   - `session/event` supplies the durable facts (tool/call + its outcome), folded
//     by the pure detector in `detector.mjs`. This path survives plugin reloads
//     and also catches a turn that already ran before the plugin was enabled.
//   - `tools/pre-execute` supplies the call BEFORE it runs, which is the only
//     place a hard block can happen.
//
// Deliberately NOT used: `system-prompt/assemble` (the correction must be a
// visible, separable message, not hidden prompt text) and `tools/guard` (it cannot
// explain itself).

import { LoopDetector, fingerprintCall } from "./detector.mjs";
import { buildCorrection, summarizeSignal } from "./correction.mjs";
import { createPanelDataCache, sessionMetadata, isListable, createPanelMetadata, foldPanelEvent } from "./panel-data.mjs";
import { buildTranscript, transcriptToMarkdown } from "./transcript.mjs";
import { runReview, createRouteResolver, buildReviewPrompt, composeSystemPrompt, testConnection } from "./review.mjs";
import { createSettingsStore } from "./settings-store.mjs";
import { createCodexRoster, createCodexRecords, resolveCodexHome } from "./codex-rollout.mjs";
import { createCodexIndex } from "./codex-index.mjs";
import { foldRecord } from "./context-records.mjs";
import { settingsProblem } from "./settings.mjs";
import { exportDisposition } from "./filename.mjs";
import { registerContextRoutes } from "./context-routes.mjs";
import { registerRoomRoutes } from "./room-routes.mjs";
import { createReviewStore, trailSince } from "./review-store.mjs";
import { createStoredRoster, pickStoredRows, createStoredFoldCache, fetchExternalModels, projectName } from "./roster.mjs";

export const name = "dsh-focusing";

/** Services the plugin can live without. */
const OPTIONAL = ["tools", "agents", "subagents", "llm", "agentDefaultModel"];

// The settings a connection test can fail on; a failed test restores only these.
const CONNECTION_KEYS = ["source", "provider", "model", "endpoint", "apiKey", "externalModel", "maxTokens", "temperature", "timeoutMs"];
const ROUTE_STATE = "/api/dsh-focusing.state";
const ROUTE_ANALYZE = "/api/dsh-focusing.analyze";
const ROUTE_EXPORT = "/api/dsh-focusing.export";
const ROUTE_SETTINGS = "/api/dsh-focusing.settings";
const ROUTE_PREVIEW = "/api/dsh-focusing.preview";
const ROUTE_MODELS = "/api/dsh-focusing.models";
const ROUTE_EXTERNAL_MODELS = "/api/dsh-focusing.external-models";

/**
 * Where analysis settings are stored: the profile directory when the Host
 * exposes one, otherwise alongside this module. Returns undefined when no
 * writable location is known, which keeps settings in memory only.
 */
function settingsFile() {
  try {
    const home = process.env.DSH_PROFILE_DIR || process.env.DSH_HOME;
    const base = home || process.cwd();
    return `${base}/dsh-focusing.analysis.json`;
  } catch {
    return undefined;
  }
}

/** Saved single-session analyses live next to the analysis settings. */
function reviewsFile() {
  const file = settingsFile();
  return file ? file.replace(/analysis\.json$/, "reviews.json") : undefined;
}

/** Saved digests live next to the analysis settings. */
function digestFile() {
  const file = settingsFile();
  return file ? file.replace(/analysis\.json$/, "digests.json") : undefined;
}

const REASON_DENIED = "dsh-focusing/loop";
const ROUTE_HINT = "改用 hook: 'agent_pre_step' / 'tool_pre_execute'。";

/**
 * Tool names whose kind we need before dispatch. Read from the registry when it
 * offers a projection, otherwise inferred from the name and arguments.
 */
function inferKind(name, args) {
  const n = String(name ?? "").toLowerCase();
  const a = args && typeof args === "object" ? args : Object.create(null);
  if (n === "edit" || n === "multi_edit" || n === "write" || n === "notebook_edit") return "edit";
  if (n === "bash" || n === "pwsh" || n === "terminal" || n === "run" || n === "shell") return "execute";
  if (n === "read" || n === "read_image") return "read";
  if (n === "grep" || n === "glob" || n === "search") return "search";
  if (typeof a.path === "string" && typeof a.old_string === "string") return "edit";
  if (typeof a.command === "string") return "execute";
  return "other";
}

/** Flatten a message's content blocks to text, for goal extraction and errors. */
function textOf(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter(b => b && b.type === "text" && typeof b.text === "string")
    .map(b => b.text)
    .join("\n")
    .trim();
}

/**
 * Which user messages are the person's actual words.
 *
 * `runtime-context`, compaction summaries, and other plugin injections also
 * arrive as user messages; mistaking one of those for the original goal would
 * make the drift check compare the task against its own context dump.
 */
function isHumanMessage(message) {
  const kind = message?.source?.kind;
  if (kind !== undefined && kind !== "user") return false;
  const text = textOf(message?.content);
  if (!text) return false;
  if (/^Current runtime context:/.test(text)) return false;
  return true;
}

/** A frozen-by-structure message the loop accepts at `agent/pre-step`. */
function userMessage(content, source) {
  return {
    id: crypto.randomUUID(),
    role: "user",
    source,
    content: [{ type: "text", text: content }],
  };
}

/** Deep-merge defaults with the row's config; config replaces wholesale otherwise. */
function withDefaults(DEFAULTS, config) {
  const out = { ...DEFAULTS };
  for (const [key, value] of Object.entries(config ?? {})) {
    out[key] = value && typeof value === "object" && !Array.isArray(value) && DEFAULTS[key] && typeof DEFAULTS[key] === "object"
      ? { ...DEFAULTS[key], ...value }
      : value;
  }
  return out;
}

/** Resolve a promise or reject on timeout, without leaking the timer. */
function withTimeout(promise, ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("focusing/timeout")), Math.max(1000, ms));
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("focusing/aborted"));
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      value => {
        clearTimeout(timer);
        signal?.removeEventListener?.("abort", onAbort);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        signal?.removeEventListener?.("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * The diagnosis prompt.
 *
 * It is written to make "no" the easy answer. A reviewer asked "is this agent
 * stuck?" tends to agree; one asked to pick between clearly-named cases, where
 * the first is legitimate work, has to actually distinguish them. That framing
 * is what keeps the confirmation from rubber-stamping every rule hit.
 */
export function buildDiagnosisPrompt(verdict, snapshot) {
  const timeline = (snapshot.recent ?? [])
    .map(r => `step ${r.step}: ${r.tool ?? "?"}${r.file ? ` ${r.file}` : r.cmd ? ` ${r.cmd}` : ""} ${r.failed ? "FAILED" : "ok"}`)
    .join("\n");
  return (
    "Judge one thing: is the agent below stuck, or is it doing legitimate work?\n\n" +
    `THE PERSON'S REQUEST:\n${snapshot.originalGoal ?? "(unknown)"}\n\n` +
    `A RULE FIRED WITH THESE FACTS:\n${verdict.signals.map(s => `- ${summarizeSignal(s)}`).join("\n")}\n\n` +
    `ITS LAST STEPS (oldest first):\n${timeline || "(none)"}\n\n` +
    "Rules are dumb and fire on repetition alone. Judge whether repetition here is a symptom or just the shape of the work:\n" +
    "- Editing the same file repeatedly is NORMAL when the task is one big file, and STUCK when each edit undoes or retries the previous one.\n" +
    "- Running the same command repeatedly is NORMAL when polling or verifying, and STUCK when the failure text is unchanged.\n" +
    "- A long run is NORMAL when new files or new results keep appearing.\n\n" +
    "Answer in exactly this form, in the same language as the request:\n" +
    "VERDICT: NORMAL or STUCK\n" +
    "REASON: one sentence.\n" +
    "NEXT: if STUCK, name the one concrete action that would break the loop (or the one missing fact). If NORMAL, write none."
  );
}

/**
 * Prompt for a MANUAL review: no rule fired, the person asked for one look at
 * the recorded activity. Unlike the rule-driven prompt this must be willing to
 * answer NORMAL, so it is framed as "is anything wrong here?", not
 * "justify this signal".
 */
export function buildManualPrompt(metadata, activities) {
  const limit = 40;
  const list = (activities ?? []).slice(-limit);
  const lines = list.map(a => {
    const target = a.cmd ?? a.file ?? a.description ?? "";
    const state = a.failed ? "FAILED" : a.status === "running" ? "?" : a.status === "incomplete" ? "UNFINISHED" : "ok";
    const step = a.step === undefined ? "?" : a.step;
    return `step ${step}: ${a.name ?? "?"} ${String(target).slice(0, 300)} — ${state}`;
  });
  const failures = list.filter(a => a.failed);
  const failureText = failures.length
    ? failures.slice(-3).map(a => `- ${a.name} ${String(a.cmd ?? a.file ?? "").slice(0, 200)}\n  ${String(a.resultExcerpt ?? "").slice(0, 400)}`).join("\n")
    : "(none)";
  return (
    "You are reviewing a coding session from OUTSIDE. You did not run these steps.\n" +
    "Judge only from the record below. Do not invent files, commands, or results.\n\n" +
    `THE PERSON'S REQUEST:\n${metadata?.goal ?? "(not captured)"}\n\n` +
    `RECENT ACTIVITY (oldest first, last ${list.length} calls):\n${lines.join("\n") || "(no tool activity recorded)"}\n\n` +
    `RECENT FAILURES:\n${failureText}\n\n` +
    "Look for: the same action repeated without new information, work that drifted from the request,\n" +
    "an omission the request clearly needs, or a wrong priority (polishing instead of fixing).\n" +
    "Repetition alone is NOT a problem — re-reading a file or re-running a test after a fix is normal.\n" +
    "If the record is too thin to judge, say NORMAL and say what is missing.\n\n" +
    "Answer in exactly this form, in the same language as the request:\n" +
    "VERDICT: NORMAL or STUCK\n" +
    "REASON: one or two sentences citing what you saw.\n" +
    "NEXT: if STUCK, the single most useful next action. If NORMAL, write none."
  );
}
/** Read the structured answer, falling back to the text form. */
export function parseVerdict(text, structured) {
  const raw = String(text ?? "").trim();
  const fromStructured = typeof structured === "object" && structured !== null ? structured : undefined;
  const flag = fromStructured?.verdict ?? fromStructured?.stuck;
  let stuck;
  if (typeof flag === "boolean") stuck = flag;
  else if (typeof flag === "string") stuck = /stuck|循环|卡住/i.test(flag);
  else stuck = /\bVERDICT:\s*STUCK\b|判定[:：]\s*循环/i.test(raw);
  const next = /NEXT:\s*([\s\S]*)$/i.exec(raw)?.[1]?.trim();
  const reason = /REASON:\s*([\s\S]*?)(?:\nNEXT:|$)/i.exec(raw)?.[1]?.trim();
  return {
    stuck,
    text: [reason, next && !/^none$/i.test(next) ? next : undefined].filter(Boolean).join(" —— ") || raw.slice(0, 400),
  };
}

const DEFAULT_CONFIG = {
  soft: { enabled: true, threshold: 3, cooldownSteps: 4, maxPerTurn: 3 },
  hard: { enabled: false, threshold: 4, tools: [] },
  // The budget is a safety net, NOT a loop signal. A long honest session edits
  // hundreds of files over 100+ steps; firing on step count alone would nag a
  // model that is doing exactly what it was asked. It only speaks when a repeat
  // signal is present as well, and its own ceiling is deliberately high.
  budget: { enabled: true, maxStepsPerTurn: 120 },
  subagent: { enabled: false, maxPerTurn: 1 },
  goalDrift: { enabled: true, checkEverySteps: 12 },
  windowSteps: 14,
};

export function apply(ctx, rawConfig = {}) {
  const config = withDefaults(DEFAULT_CONFIG, rawConfig);
  const windowSteps = Number(config.windowSteps) || 14;
  // One Codex reader for the plugin's life, shared by every route. Declared at
  // the apply scope so the test handle at the bottom can reach it too.
  let codexReader = null;

  /** sessionId → per-session state. Dropped when the agent is disposed. */
  const states = new Map();

  function stateOf(agent) {
    let state = states.get(agent.id);
    if (!state) {
      state = {
        agent,
        detector: new LoopDetector({ windowSteps }),
        pending: new Map(),
        events: [],
        lastSoftStep: -Infinity,
        softCount: 0,
        softTurn: 0,
        subagentCount: 0,
        subagentTurn: 0,
        blockedFingerprints: new Set(),
        lastDriftStep: 0,
        stepsThisTurn: 0,
      };
      states.set(agent.id, state);
    }
    return state;
  }

  function record(state, entry) {
    state.events.push({ at: Date.now(), ...entry });
    if (state.events.length > 80) state.events.splice(0, state.events.length - 80);
  }

  /** Steps in the current turn, counted from durable `step/start` events. */
  function turnSteps(state) {
    return state.stepsThisTurn;
  }

  function verdictOf(state, stepsInTurn) {
    return state.detector.assess(
      {
        threshold: config.soft.threshold,
        maxStepsPerTurn: config.budget.enabled ? config.budget.maxStepsPerTurn : 0,
      },
      { turnSteps: stepsInTurn ?? state.stepsThisTurn },
    );
  }

  // ---------------------------------------------------------------------------
  // Durable observation: what actually happened.
  // ---------------------------------------------------------------------------
  ctx.on("session/event", (session, event) => {
    const agent = ctx.get("agents")?.get(session?.id);
    if (!agent) return;
    const state = stateOf(agent);

    if (event.type === "turn/start") {
      state.detector.setTurn(event.data.turn);
      state.stepsThisTurn = 0;
      state.softCount = 0;
      state.subagentCount = 0;
      state.blockedFingerprints.clear();
      state.lastDriftStep = 0;
      return;
    }

    if (event.type === "user/message") {
      if (isHumanMessage(event.data)) state.detector.observeUser(textOf(event.data.content));
      return;
    }

    if (event.type === "step/start") {
      state.stepsThisTurn += 1;
      state.detector.setTurn(event.data.turn);
      return;
    }

    if (event.type === "tool/call") {
      const { callId, name: toolName, arguments: raw } = event.data;
      let args;
      try {
        args = JSON.parse(raw);
      } catch {
        args = { __unparsed: String(raw).slice(0, 500) };
      }
      const kind = inferKind(toolName, args);
      state.pending.set(callId, {
        toolName,
        toolKind: kind,
        call: fingerprintCall(toolName, args, kind),
        turn: event.data.turn,
        step: event.data.step,
      });
      return;
    }

    if (event.type === "tool/result") {
      const callId = event.data.message?.toolCallId ?? event.data.message?.source?.callId;
      const pending = callId === undefined ? undefined : state.pending.get(callId);
      if (pending) state.pending.delete(callId);
      const message = event.data.message;
      state.detector.observeStep({
        turn: event.data.turn,
        step: event.data.step,
        toolName: pending?.toolName,
        toolKind: pending?.toolKind,
        call: pending?.call,
        result: {
          isError: message?.isError === true || event.data.error !== undefined,
          content: message?.content,
        },
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Live intervention: what the next step may do.
  // ---------------------------------------------------------------------------
  ctx.inject(OPTIONAL, (child) => {
    const registrations = [];

    // --- hard: deny the repeating call, once per fingerprint per turn ---------
    const onPreExecute = child.on("tools/pre-execute", async (exec, next) => {
      const decision = await next();
      if (!config.hard.enabled || decision.kind !== "allow") return decision;
      if (!exec.agent) return decision;
      const state = states.get(exec.agent.id);
      if (!state) return decision;

      const kind = inferKind(exec.name, exec.arguments);
      const call = fingerprintCall(exec.name, exec.arguments, kind);
      const allowed = Array.isArray(config.hard.tools) ? config.hard.tools : [];
      if (allowed.length && !allowed.includes(exec.name)) return decision;
      if (state.blockedFingerprints.has(call.fingerprint)) return decision;

      const repeats = state.detector.countRepeats(call.fingerprint) + 1;
      if (repeats < (config.hard.threshold ?? 4)) return decision;

      state.blockedFingerprints.add(call.fingerprint);
      record(state, {
        kind: "hard",
        turn: state.detector.turn,
        step: state.stepsThisTurn,
        detail: summarizeSignal({ kind: "same-call", count: repeats, call, toolName: exec.name }),
      });
      return {
        kind: "deny",
        reason:
          `dsh-focusing 拦下了这次调用：${call.file ? `文件 \`${call.file}\`` : "同一个调用"}` +
          `已经重复 ${repeats} 次没有产生新结果，继续同样的调用不会再改变结果。\n\n` +
          "换一个本质不同的做法，或者说明卡在哪里让用户决定。这不是权限问题，重试不会通过。",
        info: { name: "FocusingLoop", code: REASON_DENIED, reason: ROUTE_HINT },
      };
    });
    if (onPreExecute) registrations.push(onPreExecute);

    // --- soft: prepend the course correction to the step about to enter ------
    const onPreStep = child.on("agent/pre-step", async (payload, next) => {
      const decision = await next();
      if (decision.kind !== "enter") return decision;

      const state = states.get(payload.agent.id);
      if (!state) return decision;
      // The durable `step/start` is appended after this decision, so the
      // pre-step is the earliest place that knows which step is starting.
      state.detector.setTurn(payload.turn);
      const stepsInTurn = payload.step;

      const verdict = verdictOf(state, stepsInTurn);
      if (!verdict.signals.length) return decision;

      // The budget alone never speaks. It is a safety net around a loop that was
      // already detected, so "this turn is long" cannot nag an honest long task.
      const loopEvidence = verdict.signals.some(
        s => s.kind === "same-call" || s.kind === "same-failing-result" || s.kind === "no-progress",
      );
      if (!loopEvidence) return decision;

      const budgetSignal = verdict.signals.find(s => s.kind === "step-budget");
      const budgetHit = !!budgetSignal;
      const withinCooldown = stepsInTurn - state.lastSoftStep < (config.soft.cooldownSteps ?? 4);
      const overCap = state.softCount >= (config.soft.maxPerTurn ?? 3);

      const shouldSpeak = config.soft.enabled && (!withinCooldown || budgetHit) && (budgetHit || !overCap);
      if (!shouldSpeak) return decision;

      const snapshot = state.detector.snapshot();
      snapshot.turnSteps = stepsInTurn;

      // Rule said "look here". Before anything reaches the model, ask the one
      // thing the rules cannot know: is this actually a loop?
      let conclusion;
      if (config.subagent.enabled) {
        const canAsk = state.subagentCount < (config.subagent.maxPerTurn ?? 1);
        if (!canAsk) return decision;
        state.subagentCount += 1;
        const diagnosis = await runDiagnosis(child, state, verdict, snapshot, payload.signal);
        if (!diagnosis.stuck) return decision;
        conclusion = diagnosis.text || undefined;
      }

      state.lastSoftStep = stepsInTurn;
      state.softCount += 1;

      const text = buildCorrection({ verdict, snapshot, subagentConclusion: conclusion });
      record(state, {
        kind: "soft",
        turn: payload.turn,
        step: stepsInTurn,
        detail: verdict.signals.map(summarizeSignal).join("；"),
        subagent: conclusion ? summarizeSignal({ kind: "subagent" }) : undefined,
      });

      // `source.kind` is this plugin's own tag, which is the documented marker
      // for "not the person speaking": the UI renders it apart from user input,
      // and it lets a later reader tell an injected correction from a real ask.
      const correction = userMessage(text, { kind: "focusing" });
      return {
        ...decision,
        messages: [...decision.messages, correction],
      };
    });
    if (onPreStep) registrations.push(onPreStep);

    // --- global-view diagnosis ----------------------------------------------
    //
    // The rules above decide WHEN to look. This decides WHAT is going on. The
    // split is deliberate: a rule is cheap, deterministic and replayable, so it
    // is the right thing to run on every step; a model reads context and can
    // recognise legitimate work that merely looks repetitive, so it is the
    // right thing to ask — but only after a rule pointed at a candidate.
    //
    // Asking costs one real model turn, so a "no" from the diagnosis suppresses
    // the correction entirely. That is the whole point of the confirmation.

    async function runDiagnosis(childCtx, state, verdict, snapshot, signal) {
      const subagents = childCtx.get("subagents");
      if (!subagents) return { stuck: false, reason: "unavailable" };
      const providerName = subagents.list?.().includes("spawn-in-process")
        ? "spawn-in-process"
        : subagents.list?.()[0];
      if (!providerName) return { stuck: false, reason: "no-provider" };

      const prompt = buildDiagnosisPrompt(verdict, snapshot);
      const timeout = Number(config.subagent.timeoutMs) || 30000;
      try {
        const activation = await subagents.startActivation({
          provider: providerName,
          label: "focusing/global-view",
          request: {
            parent: state.agent,
            prompt: [{ type: "text", text: prompt }],
          },
          signal,
          delivery: "caller",
        });
        const timed = await withTimeout(activation.result, timeout, signal);
        const text = textOf(timed?.output) || timed?.diagnostic || "";
        const verdictLine = parseVerdict(text, timed?.structured);
        record(state, {
          kind: "subagent",
          turn: state.detector.turn,
          step: snapshot.turnSteps,
          detail: `${verdictLine.stuck ? "确认循环" : "判定为正常"}：${verdictLine.text.slice(0, 300)}`,
        });
        return verdictLine;
      } catch {
        // A failed diagnosis must not become a correction. Silence is the safe
        // default when the confirming opinion is missing.
        return { stuck: false, reason: "failed" };
      } finally {
        state.subagentTurn = state.detector.turn;
      }
    }

    // --- cleanup belongs to this plugin's lifetime --------------------------
    child.effect(() => () => {
      for (const dispose of registrations) {
        try {
          dispose?.();
        } catch {
          /* already gone */
        }
      }
    });
  });

  // Agent disposal drops the state, so a session id reused later starts clean.
  ctx.on("agent/disposed", ({ agent }) => states.delete(agent.id));

  // ---------------------------------------------------------------------------
  // Panel read route.
  // ---------------------------------------------------------------------------
  ctx.inject(["connection"], (child) => {
    if (!child.connection?.fetch) return;
    const cors = { "cache-control": "no-store" };
    const json = body => Response.json(body, { status: 200, headers: cors });
    const flags = () => ({
      soft: config.soft.enabled,
      hard: config.hard.enabled,
      subagent: config.subagent.enabled,
    });

    const panelData = createPanelDataCache();
    // One Codex roster for the plugin's life: its per-file cache is what keeps a
    // 3.5s poll from reparsing every rollout.
    // Codex import follows the settings: off, auto-discovered, or a typed path.
    // One reader per resolved directory, so its per-file cache survives polls;
    // a test can pin the directory with DSH_FOCUSING_CODEX_HOME.
    // The profile's index file is fixed when the plugin starts. Reading it on the
    // first request instead would depend on whatever the environment says then.
    const codexIndexFile = settingsFile()?.replace(/analysis\.json$/, "codex-index.json");
    function codexSource() {
      const view = settingsStore.view();
      if (!view.codexEnabled) return { enabled: false, sessions: 0, rows: [] };
      const forced = process.env.DSH_FOCUSING_CODEX_HOME;
      const found = forced ? { ok: true, home: forced, via: "env" } : resolveCodexHome({ mode: view.codexPathMode, path: view.codexPath });
      if (!found.ok) return { enabled: true, ok: false, mode: view.codexPathMode, reason: found.reason, path: found.path, tried: found.tried, sessions: 0, rows: [] };
      // One summary index per directory, shared by the roster and the calendar:
      // each rollout is decompressed once, not once per consumer.
      if (codexReader?.home !== found.home) {
        const index = createCodexIndex({ home: found.home, fold: foldRecord, cacheFile: codexIndexFile, logger: (...a) => console.warn(...a) });
        codexReader = { home: found.home, index, roster: createCodexRoster(found.home, index), records: createCodexRecords(found.home, index) };
      }
      // Rebuild whatever changed in the background; this request never waits on it.
      // `pending` tells the page how many chats are still being read.
      const pending = codexReader.index.stale().length;
      if (pending) void codexReader.index.settle().catch(() => {});
      let rows = [];
      try { rows = codexReader.roster.rows(); } catch (error) {
        return { enabled: true, ok: false, mode: view.codexPathMode, reason: "unreadable", path: found.home, detail: String(error?.message ?? error), sessions: 0, rows: [] };
      }
      // loaded: the path works and every summary is built. loading: the path works
      // but some summaries are still being read.
      return { enabled: true, ok: true, loaded: pending === 0, loading: pending > 0, mode: view.codexPathMode, via: found.via, path: found.home, sessions: rows.length, pending, rows };
    }
    /** Folded Codex records for the activity calendar, or why there are none. */
    function codexRecords() {
      const source = codexSource();
      if (!source.enabled || !source.ok) return { enabled: source.enabled, ok: source.ok, records: [], pending: 0 };
      // Answer from the summaries that exist now; the rest builds in the background.
      try { return { enabled: true, ok: true, records: codexReader.records.records(), pending: codexReader.index.stale().length }; }
      catch { return { enabled: true, ok: false, records: [], pending: 0 }; }
    }
    /** The part of the Codex status the client shows; never the rows themselves. */
    const codexStatus = source => { const { rows, ...status } = source; return status; };

    // Successful reviews are saved to the profile directory (reviews.json), so
    // they survive plugin reloads and Host restarts. Newest first; a failed
    // re-run keeps the previous result. Each review remembers the log offset it
    // read (`seq`), so the panel can show what the session did afterwards.
    const reviewStore = createReviewStore({
      file: reviewsFile(),
      logger: (...args) => console.warn(...args),
    });
    void reviewStore.ready();
    const reviewsOf = (id) => reviewStore.list(id);

    /**
     * What the session did after `review` read it; null when it cannot be told.
     * A loaded session is read from memory; otherwise from stored history.
     */
    const trailOf = async (id, review) => {
      if (!review || !Number.isFinite(review.seq)) return null;
      // A Codex chat is a finished file: it never does anything after a review.
      if (String(id).startsWith("codex:")) return null;
      try {
        const live = child.get("sessions")?.get?.(id);
        if (live) {
          const end = Number(live.seq);
          return end < review.seq ? null : trailSince(live.snapshotEvents(review.seq, end), 0);
        }
        const query = child.get("sessionQuery");
        if (!query?.readSession) return null;
        const { events } = await query.readSession(id);
        return trailSince(events, review.seq);
      } catch {
        return null;
      }
    };
    const analysisInFlight = new Set();

    // A Codex chat has no live session object; its events live in a rollout file
    // on disk. Fold them through the same foldPanelEvent DSH sessions use, so a
    // Codex chat reviews exactly like a DSH one. Nothing waits for the index:
    // the rollout is read straight from its path.
    // Folded activity per Codex chat, keyed by file identity. The panel polls
    // every few seconds; without this cache each poll would re-read and re-fold
    // the whole rollout. A Codex chat is a finished file, so its mtime changing
    // is the only reason to fold again.
    const codexMetaCache = new Map();
    async function codexMetadata(sessionId) {
      if (!sessionId.startsWith("codex:") || !codexReader) return null;
      const sourceId = sessionId.slice("codex:".length);
      const chat = codexReader.index.refresh().find(c => c.id === sourceId);
      if (!chat?.path) return null;
      let stats;
      try { stats = (await import("node:fs")).statSync(chat.path); } catch { return null; }
      const key = `${chat.path}:${stats.size}:${stats.mtimeMs}`;
      const hit = codexMetaCache.get(key);
      if (hit) return hit;
      const { loadRollout } = await import("./codex-rollout.mjs");
      const { header, events } = loadRollout(chat.path);
      const state = createPanelMetadata(sessionId, header);
      for (const event of events) foldPanelEvent(state, event);
      state.readSeq = events.length;
      // Keep the cache small: a few open chats, not every chat ever selected.
      if (codexMetaCache.size > 20) codexMetaCache.delete(codexMetaCache.keys().next().value);
      codexMetaCache.set(key, state);
      return state;
    }

    // Analysis settings live beside the profile, in the plugin's own file. The
    // API key stays here; the Client only ever sees whether one is stored.
    const settingsStore = createSettingsStore({
      file: settingsFile(),
      logger: (...args) => console.warn(...args),
    });
    void settingsStore.load();

    // Context workbench: records across sessions, digests, follow-ups. Uses the
    // same analysis settings (source, model) as the single-session review.
    // Each group is isolated: one broken module must not take the others, or
    // its routes, down with it.
    const mount = (label, fn) => {
      try {
        fn();
      } catch (error) {
        console.warn(`focusing: ${label} route group failed to mount`, error);
      }
    };
    mount("context", () => registerContextRoutes(child, {
      settingsStore,
      digestFile: digestFile(),
      logger: (...args) => console.warn(...args),
      codexRecords,
      codexChats: async () => {
        const source = codexSource();
        if (!source.enabled) return [];
        if (!source.ok) throw new Error(`Codex source unavailable: ${source.reason}`);
        const reader = codexReader;
        await reader.index.settle();
        if (reader.index.errors().length) throw new Error("Some Codex sessions could not be indexed; check the Codex source logs");
        const titles = new Map(reader.roster.rows().map(row => [row.sourceId, row.title]));
        return reader.index.refresh().map(chat => ({ ...chat, title: titles.get(chat.id) }));
      },
    }));
    // Collaboration rooms: new conversations over frozen copies of sessions.
    mount("rooms", () => registerRoomRoutes(child, {
      settingsStore,
      roomsFile: settingsFile()?.replace(/analysis\.json$/, "rooms.json"),
      logger: (...args) => console.warn(...args),
    }));

    // The metadata fold is independent of the detector. Reading historical
    // activity must not seed or otherwise alter live intervention decisions.
    // Identifies the activity a response carries: the row count plus the newest
    // row's state, so a new row or a finished call both change it.
    const activityStamp = (metadata) => {
      const list = metadata?.activity ?? [];
      const last = list.at(-1);
      return `${list.length}:${last?.status ?? last?.role ?? ""}:${last?.completedAt ?? last?.time ?? ""}:${metadata?.totalToolCalls ?? 0}`;
    };
    const picture = (id, metadata) => {
      const state = states.get(id);
      const verdict = state ? verdictOf(state) : { risk: 0, signals: [], repeats: 0, noProgress: 0 };
      const events = state?.events.slice(-40) ?? [];
      return {
        session: id,
        risk: Math.round(verdict.risk * 100) / 100,
        signals: verdict.signals.map(s => ({ kind: s.kind, count: s.count, label: summarizeSignal(s) })),
        repeats: verdict.repeats,
        noProgress: verdict.noProgress,
        turn: metadata?.turn ?? null,
        turnSteps: metadata?.turnSteps ?? state?.stepsThisTurn ?? 0,
        toolCalls: metadata?.toolCalls ?? 0,
        totalToolCalls: metadata?.totalToolCalls ?? 0,
        turnStartedAt: metadata?.turnStartedAt ?? null,
        turnEndedAt: metadata?.turnEndedAt ?? null,
        turnEndReason: metadata?.turnEndReason ?? null,
        goal: metadata?.goal ?? null,
        recent: metadata?.activity.slice(-8) ?? [],
        activity: metadata?.activity.slice() ?? [],
        events,
        diagnostics: events.filter(e => e.kind === "subagent"),
      };
    };

    // Stored (unloaded) sessions: listed from the session controller or the
    // persistence index, cached briefly because the panel polls every few
    // seconds; selected ones are folded from their stored log on demand.
    const storedRoster = createStoredRoster(() => ({
      controller: child.get("sessionController"),
      persistence: child.get("sessionPersistence"),
    }));
    const storedFolds = createStoredFoldCache(async (id) => {
      const query = child.get("sessionQuery");
      if (!query?.readSession) throw new Error("session query service unavailable");
      return query.readSession(id);
    });
    const reviewFields = (id) => {
      const list = reviewsOf(id);
      return { reviewed: list.length > 0, reviewedAt: list[0]?.at ?? null, reviewCount: list.length };
    };
    /** Metadata for a session that is not loaded; undefined when it cannot be read. */
    const storedMetadata = async (id) => {
      const listing = await storedRoster.list().catch(() => ({ rows: [] }));
      const row = listing.rows.find(r => r.id === id);
      try {
        return { row, metadata: await storedFolds.read(id, row?.key) };
      } catch {
        return { row, metadata: undefined };
      }
    };

    // The panel cannot read "the session the person is looking at": the `main`
    // slot carries no session binding. Return the roster on every poll and add
    // detail only for the explicitly selected session.
    child.effect(() => child.connection.fetch.register({
      path: ROUTE_STATE,
      methods: ["GET"],
      requestBody: "buffered",
      fetch: async (request) => {
        const url = new URL(request.url);
        const wanted = url.searchParams.get("session");
        await reviewStore.ready();
        // Inside the route, resolve through the injected child so the services
        // named by OPTIONAL are actually reachable.
        const registry = child.get("agents");
        const store = child.get("sessions");
        const titleService = child.get("sessionTitle");
        const agents = registry?.list?.() ?? [];
        const liveSessions = store?.list?.() ?? [];
        // Archived chats keep their Workspace slot, so they are still listed
        // here; the registry's own archive set is what says which they are.
        // Read on every request: archiving elsewhere must show up immediately.
        // The getter throws while the registry is still starting, which is
        // normal right after a Harness restart -- the panel polls immediately --
        // so an unreadable set means "nothing known to be archived", never a
        // failed roster.
        let archivedList = [];
        try {
          archivedList = child.get("workspaceRegistry")?.archivedSessionIds ?? [];
        } catch {
          archivedList = [];
        }
        const archivedIds = new Set(archivedList.map(String));
        const isArchived = id => archivedIds.has(String(id));
        const ids = [...new Set([...liveSessions.map(s => s.id), ...agents.map(a => a.id)])];
        panelData.retain(ids);
        const sessions = ids.map(id => {
          const session = store?.get?.(id);
          // No stored session means no log to read: this is an agent shell, not
          // a conversation. Returning null keeps it out of the list entirely
          // instead of inventing an "Untitled session" row for it.
          if (!session) return null;
          const meta = sessionMetadata(panelData.read(session), titleService?.get?.(session));
          // "Running" must mean an agent is alive right now. The log fold only
          // knows a turn STARTED, so a session whose turn ended without a
          // `turn/end` (crash, reload, compaction) would otherwise show a green
          // dot forever. Liveness is the registry, not the log.
          if (!registry?.get?.(id)) meta.status = "idle";
          return isListable(panelData.read(session)) ? { ...meta, loaded: true, archived: isArchived(id), ...reviewFields(id) } : null;
        }).filter(Boolean);

        // Codex desktop chats: read-only rows, tagged with their source, appended
        // after the DSH rows. The client shows them in their own group.
        const codex = codexSource();
        for (const row of codex.rows) sessions.push({ ...row, archived: isArchived(row.sourceId) || row.archived });

        // Stored sessions that are not loaded: listed read-only so a saved
        // analysis stays reachable after a restart. Live rows win.
        const liveIds = new Set(ids.filter(id => store?.get?.(id)));
        const listing = await storedRoster.list(request.signal).catch(() => ({ rows: [] }));
        const reviewedIds = new Set(listing.rows.filter(r => reviewsOf(r.id).length).map(r => r.id));
        for (const row of pickStoredRows(listing.rows, { liveIds, reviewedIds })) {
          const saved = reviewStore.latest(row.id);
          const title = row.title || saved?.title || "";
          sessions.push({
            id: row.id, title, untitled: !title,
            project: projectName(row.cwd), cwd: row.cwd, status: "idle",
            updatedAt: row.updatedAt, loaded: false, archived: isArchived(row.id), ...reviewFields(row.id),
          });
        }

        // Always refresh the roster, even when the person selected a session.
        // Never silently substitute another session's activity for that choice.
        if (!wanted) {
          return json({ live: false, reason: "no-session", config: flags(), sessions, analysis: settingsStore.view(), settingsSummary: modelSummary(), codexStatus: codexStatus(codex) });
        }
        const session = store?.get?.(wanted);
        const agent = registry?.get?.(wanted);
        const metadata = session ? panelData.read(session) : null;
        const summary = sessions.find(s => s.id === wanted);
        if (!session && !agent) {
          const saved = reviewStore.latest(wanted);
          // A Codex chat has no live session or agent; its activity is folded
          // from its rollout file, exactly as the analyze route does.
          const codexMeta = wanted.startsWith("codex:") ? await codexMetadata(wanted) : null;
          const { metadata: storedMeta } = codexMeta ? { metadata: codexMeta } : await storedMetadata(wanted);
          const shown = storedMeta ? picture(wanted, storedMeta) : {};
          if (storedMeta) {
            shown.activityStamp = activityStamp(storedMeta);
            if (url.searchParams.get("known") === shown.activityStamp) { delete shown.activity; delete shown.recent; shown.activityUnchanged = true; }
          }
          return json({
            live: false, reason: "no-agent", session: wanted, loaded: false,
            ...summary, ...shown, config: flags(), sessions,
            review: saved, reviewTrail: await trailOf(wanted, saved), reviewHistory: reviewsOf(wanted).slice(1),
            analyzing: analysisInFlight.has(wanted),
            analysis: settingsStore.view(), settingsSummary: modelSummary(), codexStatus: codexStatus(codex),
          });
        }
        const live = picture(wanted, metadata);
        live.activityStamp = activityStamp(metadata);
        // The panel polls every few seconds. When the person already holds this
        // exact activity, leave it out instead of resending megabytes.
        if (url.searchParams.get("known") === live.activityStamp) { delete live.activity; delete live.recent; live.activityUnchanged = true; }
        return json({
          live: !!agent, reason: agent ? undefined : "no-agent",
          ...summary, ...live, config: flags(), sessions,
          review: reviewStore.latest(wanted),
          reviewTrail: await trailOf(wanted, reviewStore.latest(wanted)),
          reviewHistory: reviewsOf(wanted).slice(1),
          analyzing: analysisInFlight.has(wanted),
          analysis: settingsStore.view(), settingsSummary: modelSummary(), codexStatus: codexStatus(codex),
        });
      },
    }));

    /** What the nav chip shows: the one global model, and whether it can work. */
    function modelSummary() {
      const view = settingsStore.view();
      const problem = settingsProblem(settingsStore.get());
      const external = view.source === "external";
      const label = external
        ? (view.externalModel ? `${view.externalModel}` : "")
        : (view.model ? `${view.model}${view.provider ? ` · ${view.provider}` : ""}` : "");
      return {
        source: view.source,
        label: label || undefined,
        model: external ? view.externalModel : view.model,
        provider: external ? undefined : view.provider,
        hasApiKey: view.hasApiKey,
        problem: problem?.reason,
      };
    }

    // Manual analysis endpoint: POST { session }. Runs ONE review and keeps the
    // result. Never re-runs on its own — the person asks again to replace it.
    child.effect(() => child.connection.fetch.register({
      path: ROUTE_ANALYZE,
      methods: ["POST"],
      requestBody: "buffered",
      fetch: async (request) => {
        let sessionId;
        try {
          sessionId = (await request.json())?.session;
        } catch {
          return Response.json({ ok: false, reason: "bad-request" }, { status: 400, headers: cors });
        }
        if (typeof sessionId !== "string" || !sessionId) {
          return Response.json({ ok: false, reason: "bad-request" }, { status: 400, headers: cors });
        }
        // One review at a time per session: a second press must not start a
        // parallel model turn that races the first result.
        if (analysisInFlight.has(sessionId)) {
          return json({ ok: false, reason: "busy", session: sessionId });
        }
        const session = child.get("sessions")?.get?.(sessionId);

        analysisInFlight.add(sessionId);
        try {
          await reviewStore.ready();
          // A loaded session is read from memory; an unloaded one from its
          // stored log, so a past conversation can be reviewed too.
          let metadata;
          let readSeq;
          if (session) {
            // The offset the review will read up to. Anything the session does
            // while the model is thinking counts as "after" the review.
            readSeq = Number(session.seq);
            metadata = panelData.read(session);
          } else if (sessionId.startsWith("codex:")) {
            metadata = await codexMetadata(sessionId);
            if (!metadata) return json({ ok: false, reason: "no-session", session: sessionId });
            readSeq = metadata.readSeq;
          } else {
            metadata = (await storedMetadata(sessionId)).metadata;
            if (!metadata) return json({ ok: false, reason: "no-session", session: sessionId });
            readSeq = metadata.readSeq;
          }
          const settings = settingsStore.get();
          // Direct model call: no Agent required, so a finished conversation can
          // be reviewed as well. The source, model and prompt all come from the
          // saved analysis settings, not from fixed values.
          const outcome = await runReview({
            settings,
            llm: child.get("llm"),
            resolveRoute: createRouteResolver({ defaultModel: child.get("agentDefaultModel"), session }),
            session,
            metadata,
            activities: metadata.activity,
          });
          const review = {
            ...outcome,
            session: sessionId,
            at: outcome.at ?? Date.now(),
            seq: readSeq,
            // Tool calls only: activity also holds message rows now.
            calls: metadata.activity.filter(a => a.kind !== 'message').length,
            goal: metadata.goal ?? null,
            title: sessionMetadata(metadata, session ? child.get("sessionTitle")?.get?.(session) : undefined).title
              || reviewStore.latest(sessionId)?.title || "",
          };
          // Keep the previous result on failure so a transient error does not
          // erase a review the person already has.
          if (outcome.ok) await reviewStore.add(sessionId, review);
          return json({
            ok: outcome.ok,
            reason: outcome.reason,
            // The person must see WHY it failed, not just that it did.
            detail: outcome.ok ? undefined : outcome.detail,
            review: reviewStore.latest(sessionId),
            reviewTrail: await trailOf(sessionId, reviewStore.latest(sessionId)),
            reviewHistory: reviewsOf(sessionId).slice(1),
          });
        } finally {
          analysisInFlight.delete(sessionId);
        }
      },
    }));

    // Analysis settings: GET returns the redacted view, POST saves a patch and
    // returns the redacted view plus a "test" result when asked. Saving never
    // starts a review; the person runs one from the panel.
    // Read-only catalogue of the models DSH can actually reach, so the panel
    // offers what exists instead of asking the person to type model ids.
    child.effect(() => child.connection.fetch.register({
      path: ROUTE_MODELS,
      methods: ["GET"],
      requestBody: "buffered",
      fetch: async () => {
        const llm = child.get("llm");
        const current = child.get("agentDefaultModel")?.currentSelection?.() ?? null;
        if (!llm?.listProviders || !llm?.listModels) {
          return json({ ok: false, reason: "no-llm", models: [], current });
        }
        const providers = llm.listProviders() ?? [];
        // One failing provider must not hide the others, and a provider that
        // advertises nothing must be REPORTED rather than silently dropped:
        // "no models" and "a provider is not signed in" look the same from an
        // empty list, which is exactly what makes the picker look broken.
        const settled = await Promise.all(providers.map(async (provider) => {
          try {
            const models = await llm.listModels(provider.id);
            return {
              provider: provider.id,
              name: provider.name ?? provider.id,
              models: (models ?? []).map(model => ({
                provider: provider.id,
                providerName: provider.name ?? provider.id,
                id: model.id,
                name: model.name || model.id,
              })),
            };
          } catch (error) {
            return {
              provider: provider.id,
              name: provider.name ?? provider.id,
              models: [],
              reason: error?.code ?? "failed",
              detail: String(error?.message ?? error).slice(0, 300),
            };
          }
        }));
        return json({ ok: true, models: settled.flatMap(p => p.models), providers: settled, current });
      },
    }));

    // Models an external OpenAI-compatible endpoint offers, so the person can
    // pick instead of typing. The stored key is only sent to the stored
    // endpoint's origin and is never returned.
    child.effect(() => child.connection.fetch.register({
      path: ROUTE_EXTERNAL_MODELS,
      methods: ["GET", "POST"],
      requestBody: "buffered",
      fetch: async (request) => {
        let body = {};
        if (request.method === "POST") {
          try { body = (await request.json()) ?? {}; } catch { body = {}; }
        }
        const endpoint = typeof body.endpoint === "string" && body.endpoint.trim() ? body.endpoint.trim() : undefined;
        const apiKey = typeof body.apiKey === "string" && body.apiKey ? body.apiKey : undefined;
        const result = await fetchExternalModels({ endpoint, apiKey, stored: settingsStore.get() });
        return json(result.ok ? { ok: true, models: result.models } : { ok: false, reason: result.reason, detail: result.detail });
      },
    }));

    child.effect(() => child.connection.fetch.register({
      path: ROUTE_SETTINGS,
      methods: ["GET", "POST"],
      requestBody: "buffered",
      fetch: async (request) => {
        if (request.method === "GET") {
          return json({ ok: true, settings: settingsStore.view(), codexStatus: codexStatus(codexSource()) });
        }
        let body;
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, reason: "bad-request" }, { status: 400, headers: cors });
        }
        const previous = settingsStore.get();
        const next = await settingsStore.update(body?.settings ?? body ?? {});
        // Saving never waits for the summaries: the folder is checked now, and the
        // count is whatever is built so far. The rest builds in the background.
        const saved = { ok: true, settings: settingsStore.view(), codexStatus: codexStatus(codexSource()) };

        // A connection test sends nothing from the conversation: it proves the
        // endpoint and credentials work, not what a review would say.
        if (body?.test) {
          const problem = settingsProblem(next);
          if (problem) saved.test = { ok: false, ...problem };
          else try {
            const result = await testConnection({
              settings: next,
              llm: child.get("llm"),
              resolveRoute: createRouteResolver({ defaultModel: child.get("agentDefaultModel") }),
            });
            saved.test = result.ok
              ? { ok: true, model: result.model }
              : { ok: false, reason: result.reason, detail: result.detail };
          } catch (error) {
            saved.test = { ok: false, reason: "failed", detail: String(error?.message ?? error) };
          }
          if (!saved.test.ok) {
            // A broken connection should not silently replace a working one --
            // but it must not undo unrelated settings saved in the same form
            // (the dialog's tabs share one form), so only the connection reverts.
            const connection = {};
            for (const key of CONNECTION_KEYS) connection[key] = previous[key];
            await settingsStore.save({ ...next, ...connection });
            saved.settings = settingsStore.view();
            saved.reverted = true;
          }
        }
        return json(saved);
      },
    }));

    // Preview exactly what would be sent, so an external service is never given
    // the conversation without the person seeing it first.
    child.effect(() => child.connection.fetch.register({
      path: ROUTE_PREVIEW,
      methods: ["GET"],
      requestBody: "buffered",
      fetch: async (request) => {
        const sessionId = new URL(request.url).searchParams.get("session");
        const session = sessionId ? child.get("sessions")?.get?.(sessionId) : undefined;
        if (!session) return json({ ok: false, reason: "no-session" });
        const settings = settingsStore.get();
        const metadata = panelData.read(session);
        return json({
          ok: true,
          model: settings.source === "external"
            ? `${settings.endpoint || "(no endpoint)"} · ${settings.externalModel || "(no model)"}`
            : [settings.provider, settings.model].filter(Boolean).join("/") || "(host default)",
          system: composeSystemPrompt(settings),
          user: buildReviewPrompt(settings, metadata, metadata.activity),
        });
      },
    }));

    // Save the conversation as a file. GET with ?session=&format=md|json so the
    // browser downloads it directly and the panel never has to hold the text.
    child.effect(() => child.connection.fetch.register({
      path: ROUTE_EXPORT,
      methods: ["GET"],
      requestBody: "buffered",
      fetch: async (request) => {
        const url = new URL(request.url);
        const sessionId = url.searchParams.get("session");
        const format = (url.searchParams.get("format") || "md").toLowerCase();
        const session = sessionId ? child.get("sessions")?.get?.(sessionId) : undefined;
        if (!session) return json({ ok: false, reason: "no-session" });

        const metadata = panelData.read(session);
        const events = session.snapshotEvents(0, Number(session.seq));
        const transcript = buildTranscript(events);
        const summary = sessionMetadata(metadata, child.get("sessionTitle")?.get?.(session));
        const exportedAt = Date.now();

        if (format === "json") {
          const payload = {
            exportedAt,
            session: summary.id,
            title: summary.title,
            project: summary.project,
            cwd: summary.cwd,
            goal: metadata.goal ?? null,
            signals: (states.get(sessionId) ? verdictOf(states.get(sessionId)).signals : []).map(s => ({
              kind: s.kind, count: s.count, label: summarizeSignal(s),
            })),
            review: reviewStore.latest(sessionId),
            turns: transcript.turns,
          };
          return new Response(JSON.stringify(payload, null, 2), {
            status: 200,
            headers: {
              ...cors,
              "content-type": "application/json; charset=utf-8",
              "content-disposition": exportDisposition({ title: summary.title, at: exportedAt, format: "json" }),
            },
          });
        }

        const markdown = transcriptToMarkdown(transcript, {
          ...summary,
          goal: metadata.goal,
          exportedAt,
          review: reviewStore.latest(sessionId),
          signals: states.get(sessionId)
            ? verdictOf(states.get(sessionId)).signals.map(s => ({ kind: s.kind, count: s.count, label: summarizeSignal(s) }))
            : [],
        });
        return new Response(markdown, {
          status: 200,
          headers: {
            ...cors,
            "content-type": "text/markdown; charset=utf-8",
            "content-disposition": exportDisposition({ title: summary.title, at: exportedAt, format: "md" }),
          },
        });
      },
    }));
  });
  // Read-only handle for tests: resolves once any Codex summary rebuild is done,
  // so a test's folder is not removed under a write still in progress.
  return { codexIdle: () => codexReader?.index?.idle() ?? Promise.resolve() };
}
