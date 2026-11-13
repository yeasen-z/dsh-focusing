// Independent Focusing application composition: local settings, Codex/Claude
// sources and read-only context queries. No DSH services or HTTP objects here.

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createSettingsStore } from "./settings-store.mjs";
import { createImportedSourceRuntime } from "./imported-runtime.mjs";
import { createContextSource } from "./context-source.mjs";
import { createContextService } from "./context-service.mjs";
import { foldRecord } from "./context-records.mjs";
import { createCodexIndex } from "./codex-index.mjs";
import { createCodexRoster, createCodexRecords, resolveCodexHome, streamRollout, loadRollout } from "./codex-rollout.mjs";
import { createClaudeIndex, createClaudeRoster, createClaudeRecords, resolveClaudeHome, streamSession, loadSession } from "./claude-code.mjs";
import { resolveRange } from "./time-range.mjs";
import { matchesTags, normalizeTagScope, sessionTagObjects } from "./session-tags.mjs";
import { createModelGateway } from "./model-gateway.mjs";
import { mountStandaloneRoutes } from "./standalone-routes.mjs";
import { createReviewStore } from "./review-store.mjs";
import { buildReviewPrompt, composeSystemPrompt } from "./review.mjs";
import { settingsProblem } from "./settings.mjs";
import { buildTranscript, transcriptToMarkdown } from "./transcript.mjs";
import { exportDisposition } from "./filename.mjs";
import { fetchExternalModels } from "./roster.mjs";

const EMPTY_NATIVE = {
  errors: () => [],
  records: async () => [],
  timelines: async () => [],
  record: async () => undefined,
  events: async () => undefined,
};
const EMPTY_INDEX = { activityRecords: async () => [], errors: () => [] };
const SOURCE_SETTINGS = new Set([
  "codexEnabled", "codexPathMode", "codexPath",
  "claudeEnabled", "claudePathMode", "claudePath",
  "activityIncludeExternal", "loadArchived",
  "source", "provider", "model", "endpoint", "apiKey", "externalModel",
  "persona", "includeGoal", "includeProject", "includeUserText", "includeToolArgs", "includeToolOutput",
  "maxActivities", "excerptChars", "maxTokens", "temperature", "timeoutMs",
]);
const SOURCE_LABELS = { codex: "Codex", claude: "Claude Code" };

export function defaultDataDir() {
  return join(homedir(), ".focusing");
}

function clampOffset(value) {
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= 14 * 60 ? Math.round(n) : 0;
}

export function createStandaloneApp({ dataDir = defaultDataDir(), codexHome, claudeHome, logger = () => {}, native = {} } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const settingsPath = join(dataDir, "settings.json");
  const firstRun = !existsSync(settingsPath);
  const settingsStore = native.settingsStore ?? createSettingsStore({ file: settingsPath, logger });
  // Standalone mode has no Host model. Start with the external connection tab so
  // the same Settings dialog does not default to an unavailable DSH provider.
  const settingsReady = firstRun && !native.settingsStore
    ? settingsStore.save({ ...settingsStore.get(), source: "external" })
    : Promise.resolve();
  const modelGateway = native.modelGateway ?? createModelGateway({ settingsStore, resolveRoute: async () => undefined });
  const runtime = createImportedSourceRuntime({
    settingsStore,
    fold: foldRecord,
    logger,
    adapters: {
      codex: {
        label: "Codex",
        options: view => ({ enabled: view.codexEnabled, mode: view.codexPathMode, path: view.codexPath }),
        forced: () => codexHome,
        resolve: resolveCodexHome,
        createIndex: createCodexIndex,
        createRoster: createCodexRoster,
        createRecords: createCodexRecords,
        cacheFile: join(dataDir, "codex-index.json"),
        load: async path => loadRollout(path),
      },
      claude: {
        label: "Claude Code",
        options: view => ({ enabled: view.claudeEnabled, mode: view.claudePathMode, path: view.claudePath }),
        forced: () => claudeHome,
        resolve: resolveClaudeHome,
        createIndex: createClaudeIndex,
        createRoster: createClaudeRoster,
        createRecords: createClaudeRecords,
        cacheFile: join(dataDir, "claude-index.json"),
        load: async path => loadSession(path),
      },
    },
  });
  const pluginRoutes = mountStandaloneRoutes({ settingsStore, runtime, modelGateway, dataDir, logger, serviceOverrides: native.services });
  const reviewStore = native.reviewStore ?? createReviewStore({ file: join(dataDir, "reviews.json"), logger });
  void reviewStore.ready();
  const analysisInFlight = new Set();
  const source = createContextSource(native.source ?? EMPTY_NATIVE, {
    codex: { chats: () => runtime.chats("codex"), stream: streamRollout },
    claude: { chats: () => runtime.chats("claude"), stream: streamSession },
  });
  const queries = createContextService({
    source,
    index: native.index ?? EMPTY_INDEX,
    settingsStore,
    titleOf: native.titleOf,
    isLive: native.isLive,
    importedRecords: {
      codex: options => runtime.records("codex", options),
      claude: options => runtime.records("claude", options),
    },
    sourceLabels: SOURCE_LABELS,
  });

  function sources() {
    const imported = Object.keys(SOURCE_LABELS).map(id => {
      const { rows, ...status } = runtime.source(id);
      return {
        id,
        label: SOURCE_LABELS[id],
        ...status,
        capabilities: { readOnly: true, canAnalyze: true, canContinueInDsh: false },
      };
    });
    return native.sourceStatus
      ? [{ id: "dsh", label: "DSH", ...native.sourceStatus(), capabilities: { readOnly: false, canAnalyze: true, canContinueInDsh: true } }, ...imported]
      : imported;
  }

  async function settings(patch) {
    await settingsReady;
    if (patch !== undefined) {
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Settings must be an object");
      const allowed = Object.fromEntries(Object.entries(patch).filter(([key]) => SOURCE_SETTINGS.has(key)));
      await settingsStore.update(allowed);
    }
    return { settings: settingsStore.view(), sources: sources() };
  }

  async function sessions(params) {
    const offsetMin = clampOffset(params.offset);
    const range = resolveRange(params.range, { offsetMin, locale: params.locale === "en" ? "en" : "zh" });
    const sourcesFilter = typeof params.sources === "string" && params.sources
      ? params.sources.split(",")
      : undefined;
    if (sourcesFilter?.some(value => !["dsh", "codex", "claude"].includes(value))) throw new Error("Unknown session source");
    return queries.listRecords(range, {
      query: params.q || "",
      project: params.project || "",
      workspaces: params.cwd ? String(params.cwd).split("\n") : [],
      sources: sourcesFilter,
      tags: normalizeTagScope(params.tags),
    });
  }

  async function tags(params = {}) {
    const result = await sessions({ ...params, tags: [] });
    const counts = new Map();
    for (const record of result.records) {
      for (const tag of sessionTagObjects(record)) {
        const current = counts.get(tag.id) ?? { ...tag, count: 0 };
        current.count += 1;
        counts.set(tag.id, current);
      }
    }
    return [...counts.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
  }

  async function session(id, params = {}) {
    const range = resolveRange(params.range, { offsetMin: clampOffset(params.offset), locale: params.locale === "en" ? "en" : "zh" });
    const record = await queries.recordDetail(id, range, normalizeTagScope(params.tags));
    if (record === undefined) return undefined;
    return { record, capabilities: { readOnly: true, canAnalyze: true, canContinueInDsh: capabilities().canStartDraft } };
  }

  async function events(id, params = {}) {
    const tags = normalizeTagScope(params.tags);
    if (tags.length) {
      const record = await source.record(id);
      if (!record || !matchesTags(record, tags)) return undefined;
    }
    const raw = await source.events(id);
    if (!raw) return undefined;
    const offset = Math.max(0, Math.floor(Number(params.offset) || 0));
    const limit = Math.min(200, Math.max(1, Math.floor(Number(params.limit) || 100)));
    const items = raw.events.slice(offset, offset + limit);
    const next = offset + items.length;
    return {
      sessionId: id,
      source: raw.header.source,
      items,
      total: raw.events.length,
      offset,
      nextCursor: next < raw.events.length ? String(next) : null,
      contentIsUntrusted: true,
    };
  }

  function sourceStatus(kind) {
    const { rows, ...status } = runtime.source(kind);
    return status;
  }

  function modelSummary() {
    if (native.modelSummary) return native.modelSummary();
    const view = settingsStore.view();
    const external = view.source === "external";
    return {
      source: view.source,
      label: external ? view.externalModel || undefined : view.model || undefined,
      model: external ? view.externalModel : view.model,
      provider: external ? undefined : view.provider,
      hasApiKey: view.hasApiKey,
      problem: external ? settingsProblem(view)?.reason : "host-unavailable",
    };
  }

  async function pluginSettings(patch, withTest = false) {
    const previous = settingsStore.get();
    const result = await settings(patch);
    if (withTest) {
      const next = settingsStore.get();
      const problem = settingsProblem(next);
      try { result.test = problem ? { ok: false, ...problem } : await modelGateway.test(next); }
      catch (error) { result.test = { ok: false, reason: "failed", detail: String(error?.message ?? error) }; }
      if (!result.test.ok) {
        const connection = Object.fromEntries(["source", "provider", "model", "endpoint", "apiKey", "externalModel", "maxTokens", "temperature", "timeoutMs"].map(key => [key, previous[key]]));
        await settingsStore.save({ ...next, ...connection });
        result.settings = settingsStore.view();
        result.reverted = true;
      }
    }
    return {
      ...result,
      codexStatus: sourceStatus("codex"),
      claudeStatus: sourceStatus("claude"),
      settingsSummary: modelSummary(),
    };
  }

  function capabilities() {
    return {
      mode: "standalone",
      nativeDsh: false,
      canAsk: false,
      canReport: true,
      canRooms: false,
      canAnalyze: true,
      canFork: false,
      canStartDraft: false,
      canOpenSession: false,
      canExport: true,
      canModelSettings: true,
      ...native.capabilities,
    };
  }

  function reviewFields(id) {
    const list = reviewStore.list(id);
    return { reviewed: list.length > 0, reviewedAt: list[0]?.at ?? null, reviewCount: list.length };
  }

  function panelPicture(metadata) {
    return {
      turn: metadata.turn ?? null,
      turnSteps: metadata.turnSteps ?? 0,
      toolCalls: metadata.toolCalls ?? 0,
      totalToolCalls: metadata.totalToolCalls ?? 0,
      turnStartedAt: metadata.turnStartedAt ?? null,
      turnEndedAt: metadata.turnEndedAt ?? null,
      turnEndReason: metadata.turnEndReason ?? null,
      goal: metadata.goal ?? null,
      recent: metadata.activity.slice(-8),
      activity: metadata.activity.slice(),
      risk: 0, signals: [], repeats: 0, noProgress: 0, events: [], diagnostics: [],
    };
  }

  async function focusState(id) {
    await reviewStore.ready();
    const nativeRows = native.roster ? await native.roster() : [];
    const importedRows = Object.keys(SOURCE_LABELS).flatMap(kind => runtime.source(kind).rows.map(row => ({ ...row, ...reviewFields(row.id) })));
    const sessions = [...nativeRows, ...importedRows];
    const common = {
      config: { soft: false, hard: false, subagent: false },
      sessions,
      analysis: settingsStore.view(),
      settingsSummary: modelSummary(),
      codexStatus: sourceStatus("codex"),
      claudeStatus: sourceStatus("claude"),
    };
    if (!id) return { live: false, reason: "no-session", ...common };
    const metadata = native.metadata && !/^(?:codex|claude):/.test(id)
      ? await native.metadata(id)
      : await runtime.metadata(id);
    const summary = sessions.find(row => row.id === id);
    const saved = reviewStore.latest(id);
    if (!metadata) return { live: false, reason: "no-agent", session: id, ...summary, ...common, review: saved };
    return {
      live: false, reason: "no-agent", session: id, loaded: true,
      title: summary?.title ?? metadata.title ?? metadata.fallbackTitle,
      project: summary?.project ?? metadata.project,
      cwd: summary?.cwd ?? metadata.cwd,
      updatedAt: summary?.updatedAt ?? metadata.updatedAt,
      ...panelPicture(metadata),
      ...common,
      review: saved,
      reviewTrail: null,
      reviewHistory: reviewStore.list(id).slice(1),
      analyzing: [...analysisInFlight].some(task => task.id === id),
    };
  }

  async function preview(id) {
    const metadata = native.metadata && !/^(?:codex|claude):/.test(id)
      ? await native.metadata(id)
      : await runtime.metadata(id);
    if (!metadata) return undefined;
    const settings = settingsStore.get();
    return {
      model: settings.source === "external"
        ? `${settings.endpoint || "(no endpoint)"} · ${settings.externalModel || "(no model)"}`
        : "(host model unavailable in standalone mode)",
      system: composeSystemPrompt(settings),
      user: buildReviewPrompt(settings, metadata, metadata.activity),
    };
  }

  async function analyze(id) {
    if ([...analysisInFlight].some(task => task.id === id)) return { ok: false, reason: "busy", session: id };
    const task = (async () => {
      const metadata = native.metadata && !/^(?:codex|claude):/.test(id)
      ? await native.metadata(id)
      : await runtime.metadata(id);
      if (!metadata) return { ok: false, reason: "no-session", session: id };
      const outcome = await modelGateway.review({
        settings: settingsStore.get(), metadata, activities: metadata.activity,
      });
      const review = {
        ...outcome,
        session: id,
        at: outcome.at ?? Date.now(),
        seq: metadata.readSeq,
        calls: metadata.totalToolCalls,
        title: metadata.title || metadata.fallbackTitle,
        project: metadata.project,
        cwd: metadata.cwd,
      };
      if (outcome.ok) await reviewStore.add(id, review);
      return {
        ok: outcome.ok,
        reason: outcome.reason,
        detail: outcome.ok ? undefined : outcome.detail,
        review: reviewStore.latest(id),
        reviewTrail: null,
        reviewHistory: reviewStore.list(id).slice(1),
      };
    })();
    task.id = id;
    analysisInFlight.add(task);
    try { return await task; }
    finally { analysisInFlight.delete(task); }
  }

  async function exportSession(id, format = "md") {
    const metadata = native.metadata && !/^(?:codex|claude):/.test(id)
      ? await native.metadata(id)
      : await runtime.metadata(id);
    if (!metadata) return undefined;
    const raw = await source.events(id);
    if (!raw) return undefined;
    const transcript = buildTranscript(raw.events);
    const title = metadata.title || metadata.fallbackTitle;
    const exportedAt = Date.now();
    const review = reviewStore.latest(id);
    if (format === "json") {
      return {
        body: JSON.stringify({
          exportedAt, session: id, title, project: metadata.project, cwd: metadata.cwd,
          goal: metadata.goal ?? null, signals: [], review, turns: transcript.turns,
        }, null, 2),
        contentType: "application/json; charset=utf-8",
        disposition: exportDisposition({ title, at: exportedAt, format: "json" }),
      };
    }
    return {
      body: transcriptToMarkdown(transcript, {
        title, project: metadata.project, session: id, goal: metadata.goal,
        exportedAt, review, signals: [],
      }),
      contentType: "text/markdown; charset=utf-8",
      disposition: exportDisposition({ title, at: exportedAt, format: "md" }),
    };
  }

  return {
    sources,
    settings,
    pluginSettings,
    modelSummary,
    capabilities,
    focusState,
    preview,
    analyze,
    exportSession,
    models: native.models ?? (() => ({ ok: true, models: [], providers: [], current: null, hostAvailable: false })),
    externalModels: body => fetchExternalModels({ endpoint: body.endpoint, apiKey: body.apiKey, stored: settingsStore.get() }),
    workspaceAction: native.workspaceAction,
    routes: pluginRoutes.routes,
    sessions,
    tags,
    session,
    events,
    activity: params => queries.activity({ span: params.days, offsetMin: clampOffset(params.offset), includeExternal: params.external === undefined ? undefined : params.external === "1", tags: normalizeTagScope(params.tags) }),
    close: async () => { await settingsReady; await pluginRoutes.close(); await Promise.allSettled([...analysisInFlight]); await runtime.idle(); await native.close?.(); },
    // Exposed for contract tests and the next standalone application phases.
    runtime,
    source,
    queries,
    settingsStore,
  };
}
