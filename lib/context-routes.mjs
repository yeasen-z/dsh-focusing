// Context workbench routes: records, digests, follow-ups.
//
//   GET  /api/dsh-focusing.records   ?range=&offset=&project=&q=
//   GET  /api/dsh-focusing.digests                     saved digest list
//   POST /api/dsh-focusing.digest    {request, range, offset, project, locale}
//   GET  /api/dsh-focusing.digest    ?id=              one digest (poll while running)
//   POST /api/dsh-focusing.digest    {action:"delete", id}
//   POST /api/dsh-focusing.followup  {id, question}
//   GET  /api/dsh-focusing.digest-export ?id=          markdown download
//
// A digest is generated in the background so the page can show its stages;
// the client polls the GET route until `status` is "done" or "failed".

import { resolveRange, inferRangeKey, localDate, RANGE_KEYS } from "./time-range.mjs";
import { rangeStats } from "./context-records.mjs";
import { createContextService } from "./context-service.mjs";
import { createRecordIndex } from "./record-index.mjs";
import { createContextSource } from "./context-source.mjs";
import { streamRollout } from "./codex-rollout.mjs";
import { streamSession } from "./claude-code.mjs";
import { createContextTools } from "./context-tools.mjs";
import { ASK_RESULT_LIMIT, runAsk } from "./ask.mjs";
import { createDigestStore } from "./digest-store.mjs";
import { createHistoryStore } from "./history-store.mjs";
import { runDigestPipeline } from "./digest-pipeline.mjs";
import { createAskStore } from "./ask-store.mjs";
import { createTemplateStore, templateText } from "./template-store.mjs";
import { createModelGateway } from "./model-gateway.mjs";
import {
  FOLLOWUP_SYSTEM, buildFollowupPrompt,
  normalizeDigest, draftDigest, digestToMarkdown,
} from "./digest.mjs";
import { createRouteResolver } from "./review.mjs";
import { normalizeTagScope } from "./session-tags.mjs";

export const ROUTE_RECORDS = "/api/dsh-focusing.records";
export const ROUTE_DIGESTS = "/api/dsh-focusing.digests";
export const ROUTE_DIGEST = "/api/dsh-focusing.digest";
export const ROUTE_FOLLOWUP = "/api/dsh-focusing.followup";
export const ROUTE_DIGEST_EXPORT = "/api/dsh-focusing.digest-export";
export const ROUTE_ACTIVITY = "/api/dsh-focusing.activity";
export const ROUTE_ASK = "/api/dsh-focusing.ask";
export const ROUTE_TEMPLATES = "/api/dsh-focusing.templates";

const DIGEST_TIMEOUT = 180000;

/** What kind of result a request asks for; drives the label only. */
export function requestKind(text, rangeKey) {
  const s = String(text ?? "");
  if (/交接|handoff|hand-off|移交/i.test(s)) return "handoff";
  if (/分析|卡住|失败|循环|打转|问题|analy[sz]e|stuck|fail/i.test(s)) return "analysis";
  if (rangeKey === "today" || rangeKey === "yesterday") return "daily";
  if (rangeKey === "this-week" || rangeKey === "last-week" || rangeKey === "last-7d") return "weekly";
  return "digest";
}

/** The whole history of one session, labelled as such. */
function sessionRange(locale, offsetMin) {
  const end = Date.now();
  return { key: "session", start: 0, end, offsetMin, label: locale === "en" ? "Whole session" : "整个会话", from: "…", to: localDate(end, offsetMin) };
}

function clampOffset(value) {
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= 14 * 60 ? Math.round(n) : 0;
}

export function registerContextRoutes(child, { settingsStore, digestFile, activityFile, logger, codexRecords, claudeRecords, codexChats, claudeChats, onContextSource, modelGateway }) {
  const cors = { "cache-control": "no-store" };
  const json = (body, status = 200) => Response.json(body, { status, headers: cors });
  const index = createRecordIndex(() => ({
    sessions: child.get("sessions"),
    persistence: child.get("sessionPersistence"),
    query: child.get("sessionQuery"),
    controller: child.get("sessionController"),
  }), { activityFile, summaryFile: activityFile ? activityFile.replace(/activity-index\.json$/, "records-index.json") : undefined, logger });
  const source = createContextSource(index, {
    codex: { chats: codexChats, stream: streamRollout },
    claude: { chats: claudeChats, stream: streamSession },
  });
  onContextSource?.(source);
  const store = createDigestStore({ file: digestFile, logger });
  void store.load().catch(() => {}); // Requests still surface a persisted-store read failure.
  const running = new Map(); // id -> live digest object while generating

  const isLive = id => !!child.get("agents")?.get?.(id);
  const titleOf = (record) => {
    const live = child.get("sessions")?.get?.(record.id);
    const snap = live ? child.get("sessionTitle")?.get?.(live) : undefined;
    return snap?.title || record.title || record.fallbackTitle || "";
  };

  const contextService = createContextService({
    source, index, settingsStore, titleOf, isLive,
    importedRecords: { codex: codexRecords, claude: claudeRecords },
    sourceLabels: { codex: "Codex", claude: "Claude" },
  });
  const { slicesFor } = contextService;

  const resolveRoute = () => createRouteResolver({ defaultModel: child.get("agentDefaultModel") });
  const models = modelGateway ?? createModelGateway({ settingsStore, llm: () => child.get("llm"), resolveRoute: settings => resolveRoute()(settings) });

  const snapshots = digestFile ? createHistoryStore({ directory: `${digestFile}.snapshots` }) : undefined;
  const digestControllers = new Map();
  child.effect(() => () => { for (const controller of digestControllers.values()) controller.abort(); });
  const saveDigest = digest => store.put(structuredClone(digest));
  // Checkpoints and frozen inputs stay on the Host, not in every polling response.
  function publicDigest(digest) {
    const { pipeline, frozenSlices, ...visible } = digest;
    const interrupted = digest.status === 'running' && !running.has(digest.id);
    return { ...visible, status: running.has(digest.id) ? 'running' : visible.status,
      ...(pipeline ? { progress: { ...pipeline.coverage, phase: digest.stage } } : {}),
      ...(interrupted ? { status: 'interrupted', retryable: true } : {}),
    };
  }
  async function frozenSlicesFor(digest) {
    if (digest.frozenSlices) return structuredClone(digest.frozenSlices);
    if (!digest.snapshots?.length || !snapshots) throw new Error('Frozen digest sources are unavailable');
    const slices = [];
    for (const ref of digest.snapshots) {
      const snapshot = await snapshots.getSnapshot(ref.id);
      if (!snapshot || snapshot.hash !== ref.hash || snapshot.source.sessionId !== ref.sourceSessionId || snapshot.entries.some(e => e.type !== 'focusing/record-slice')) throw new Error('Frozen digest source mismatch');
      const saved = JSON.parse(snapshot.entries.map(e => e.text).join(''));
      if (saved.slice?.id !== ref.sourceSessionId || JSON.stringify(saved.range) !== JSON.stringify(digest.range)) throw new Error('Frozen digest range mismatch');
      slices.push(saved.slice);
    }
    return slices;
  }
  async function generate(digest, { project, locale }) {
    const controller = new AbortController();
    digestControllers.set(digest.id, controller);
    try {
      await saveDigest(digest);
      let slices;
      if (digest.pipeline && digest.snapshots?.length) await frozenSlicesFor(digest); // Validate retained evidence before resuming checkpoints.
      if (!digest.pipeline) {
        digest.stage = 'scan';
        slices = digest.frozenSlices || digest.snapshots?.length
          ? await frozenSlicesFor(digest)
          : await slicesFor(digest.range, { project, session: digest.session, tags: digest.tags });
        controller.signal.throwIfAborted();
        digest.stats = rangeStats(slices);
        digest.sources = slices.map(s => ({ id: s.id, source: s.source, tags: s.tags, readOnly: s.readOnly, title: s.title, project: s.project, calls: s.calls, lastAt: s.lastAt }));
        digest.sessionIds = slices.map(s => s.id);
        if (digest.range.key === 'session' && slices[0]?.firstAt) digest.range.from = localDate(slices[0].firstAt, digest.range.offsetMin);
        if (!slices.length) {
          Object.assign(digest, { status: 'done', stage: 'done', result: normalizeDigest(draftDigest({ range: digest.range, slices, locale })), draft: true, retryable: false, note: 'empty' });
          return;
        }
        digest.stage = 'snapshot';
        digest.frozenSlices = slices;
        digest.snapshots ??= [];
        await saveDigest(digest);
        if (snapshots) {
          for (const slice of slices) {
            controller.signal.throwIfAborted();
            if (digest.snapshots.some(ref => ref.sourceSessionId === slice.id)) continue;
            const snapshot = await snapshots.createRecordSnapshot({ slice, range: digest.range });
            digest.snapshots.push({ id: snapshot.id, sourceSessionId: slice.id, hash: snapshot.hash, capturedAt: snapshot.capturedAt });
            await saveDigest(digest);
          }
          delete digest.frozenSlices;
        }
      }
      const settings = settingsStore.get();
      await runDigestPipeline({ digest, slices, locale, signal: controller.signal, save: saveDigest,
        complete: options => models.complete({ ...options, settings, timeoutMs: Math.max(DIGEST_TIMEOUT, settings.timeoutMs) }),
      });
      if (digest.draft && digest.partial) {
        const frozen = slices ?? await frozenSlicesFor(digest);
        const draft = normalizeDigest(draftDigest({ range: digest.range, slices: frozen, locale }));
        digest.result = { ...draft, summary: digest.result?.summary || draft.summary, sections: digest.result?.sections ?? draft.sections };
      }
      if (!digest.result?.title) digest.result = { ...digest.result, title: digest.request };
    } catch (error) {
      Object.assign(digest, { status: 'failed', stage: 'failed', retryable: true, error: { reason: controller.signal.aborted ? 'interrupted' : 'failed', detail: String(error?.message ?? error).slice(0, 400) } });
    } finally {
      digest.finishedAt = Date.now();
      try { await saveDigest(digest); }
      catch (error) { logger?.warn?.(`Could not persist digest: ${error?.message ?? error}`); }
      finally { running.delete(digest.id); digestControllers.delete(digest.id); }
    }
  }

  // --- records -------------------------------------------------------------
  child.effect(() => child.connection.fetch.register({
    path: ROUTE_RECORDS,
    methods: ["GET"],
    requestBody: "buffered",
    fetch: async (request) => {
      const url = new URL(request.url);
      const range = resolveRange(url.searchParams.get("range"), {
        offsetMin: clampOffset(url.searchParams.get("offset")),
        locale: url.searchParams.get("locale") === "en" ? "en" : "zh",
      });
      try {
        const result = await contextService.listRecords(range, {
          query: url.searchParams.get("q") || "",
          project: url.searchParams.get("project") || "",
          workspaces: (url.searchParams.get("cwd") || "").split("\n"),
          tags: normalizeTagScope(url.searchParams.getAll("tag")),
          sources: url.searchParams.get("sources")?.split(",").filter(Boolean),
        });
        return json({ ok: true, ...result });
      } catch (error) {
        return json({ ok: false, reason: "failed", detail: String(error?.message ?? error), range });
      }
    },
  }));

  // --- the activity calendar --------------------------------------------------
  // GET ?days=&offset=&external=   per-day counts for a GitHub-style grid.
  // `external` picks whether enabled Codex/Claude imports count; it defaults to
  // the saved setting, so the page and the setting agree until it is changed.
  child.effect(() => child.connection.fetch.register({
    path: ROUTE_ACTIVITY,
    methods: ["GET"],
    requestBody: "buffered",
    fetch: async (request) => {
      const url = new URL(request.url);
      const offsetMin = clampOffset(url.searchParams.get("offset"));
      const span = Math.min(366, Math.max(7, Math.round(Number(url.searchParams.get("days"))) || 182));
      const wanted = url.searchParams.get("external");
      try {
        const result = await contextService.activity({
          span, offsetMin,
          includeExternal: wanted === null ? undefined : wanted === "1",
          tags: normalizeTagScope(url.searchParams.getAll("tag")),
        });
        return json({ ok: true, ...result });
      } catch (error) {
        return json({ ok: false, reason: "failed", detail: String(error?.message ?? error) });
      }
    },
  }));

  // --- one record in detail -------------------------------------------------
  child.effect(() => child.connection.fetch.register({
    path: `${ROUTE_RECORDS}/detail`,
    methods: ["GET"],
    requestBody: "buffered",
    fetch: async (request) => {
      const url = new URL(request.url);
      const id = url.searchParams.get("id");
      const range = resolveRange(url.searchParams.get("range"), { offsetMin: clampOffset(url.searchParams.get("offset")) });
      const record = await contextService.recordDetail(id, range, normalizeTagScope(url.searchParams.getAll("tag")));
      if (record === undefined) return json({ ok: false, reason: "no-session" });
      return json({ ok: true, record });
    },
  }));

  // --- digest list ----------------------------------------------------------
  child.effect(() => child.connection.fetch.register({
    path: ROUTE_DIGESTS,
    methods: ["GET"],
    requestBody: "buffered",
    fetch: async () => {
      const saved = (await store.list()).filter(d => !running.has(d.id));
      const live = [...running.values()].map(d => ({ id: d.id, request: d.request, title: d.request, kind: d.kind, range: d.range, createdAt: d.createdAt, running: true }));
      return json({ ok: true, digests: [...live, ...saved] });
    },
  }));

  // --- digest create / read / delete ----------------------------------------
  child.effect(() => child.connection.fetch.register({
    path: ROUTE_DIGEST,
    methods: ["GET", "POST"],
    requestBody: "buffered",
    fetch: async (request) => {
      if (request.method === "GET") {
        const id = new URL(request.url).searchParams.get("id");
        const digest = running.get(id) ?? await store.get(id);
        return digest ? json({ ok: true, digest: publicDigest(digest) }) : json({ ok: false, reason: "not-found" }, 404);
      }
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, reason: "bad-request" }, 400); }
      if (body?.action === "delete") {
        const id = String(body.id ?? '');
        if (running.has(id) || followupsInFlight.has(id)) return json({ ok: false, reason: 'busy' }, 409);
        return json({ ok: await store.remove(id) });
      }
      if (body?.action === 'retry') {
        const id = String(body.id ?? '');
        const digest = await store.get(id);
        if (!digest) return json({ ok: false, reason: 'not-found' }, 404);
        if (running.has(id) || followupsInFlight.has(id) || running.size >= 2) return json({ ok: false, reason: 'busy' }, 409);
        if (!digest.retryable && digest.status !== 'running' && digest.status !== 'failed') return json({ ok: false, reason: 'not-retryable' }, 400);
        Object.assign(digest, { status: 'running', stage: 'queued', retryable: false });
        delete digest.finishedAt;
        running.set(id, digest);
        void generate(digest, { project: digest.project, locale: digest.locale ?? 'zh' });
        return json({ ok: true, digest: publicDigest(digest) });
      }
      // A template stands in for the typed request: same code path, same result.
      const template = typeof body?.templateId === "string" && body.templateId ? await templates.get(body.templateId) : undefined;
      if (body?.templateId && !template) return json({ ok: false, reason: "not-found", detail: "unknown template" }, 404);
      if (template?.needsSession) return json({ ok: false, reason: "needs-session", detail: "this template is started from a record" }, 400);
      const localeFor = body?.locale === "en" ? "en" : "zh";
      const text = (template ? templateText(template, localeFor) : typeof body?.request === "string" ? body.request : "").trim().slice(0, 2000);
      if (!text) return json({ ok: false, reason: "bad-request", detail: "request is empty" }, 400);
      if (running.size >= 2) return json({ ok: false, reason: "busy" });
      const locale = body.locale === "en" ? "en" : "zh";
      const asked = RANGE_KEYS.includes(body.range) ? body.range : template?.range && RANGE_KEYS.includes(template.range) ? template.range : undefined;
      // An explicit range in the words wins over the default picker value,
      // unless the person changed the picker on purpose.
      const session = typeof body.session === "string" && body.session ? body.session : "";
      const rangeKey = body.rangeLocked && asked ? asked : inferRangeKey(text) ?? asked ?? "this-week";
      // A session-scoped request (handoff notes) covers that whole session.
      const range = session
        ? sessionRange(locale, clampOffset(body.offset))
        : resolveRange(rangeKey, { offsetMin: clampOffset(body.offset), locale });
      const project = typeof body.project === "string" && body.project ? body.project : "";
      const digest = {
        id: `dg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        request: text, kind: requestKind(text, range.key), range, project, session, locale, tags: normalizeTagScope(body.tags), templateId: template?.id,
        createdAt: Date.now(), status: "running", stage: "queued",
        stats: null, sources: [], sessionIds: [], result: null, followups: [],
      };
      running.set(digest.id, digest);
      void generate(digest, { project, locale });
      return json({ ok: true, digest: publicDigest(digest) });
    },
  }));

  // --- templates: what the generator can be asked for ----------------------
  child.effect(() => child.connection.fetch.register({
    path: ROUTE_TEMPLATES,
    methods: ["GET", "POST"],
    requestBody: "buffered",
    fetch: async (request) => {
      if (request.method === "GET") return json({ ok: true, templates: await templates.list() });
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, reason: "bad-request" }, 400); }
      const action = body?.action;
      if (action === "create") return json(await templates.create(body));
      if (action === "update") return json(await templates.update(String(body.id ?? ""), body));
      if (action === "delete") return json(await templates.remove(String(body.id ?? "")));
      return json({ ok: false, reason: "bad-request", detail: "unknown action" }, 400);
    },
  }));

  // --- ask: a conversation the plugin maintains itself ---------------------
  // Not a DSH session and no registered tool. A conversation is a plain message
  // list kept in a JSON file next to the digests. Follow-ups can use previous
  // answers and tool results within the same search scope. The thread is written
  // before the model runs and again when the round ends.
  const askStore = createAskStore({ file: digestFile ? `${digestFile}.asks.json` : undefined, logger });
  const templates = createTemplateStore({ file: digestFile ? `${digestFile}.templates.json` : undefined, logger });
  void templates.load();
  const live = new Map(); // conversationId -> the conversation, while a turn runs
  const publicConv = (c) => ({
    id: c.id, title: c.title, status: c.status, range: c.range, tags: c.tags ?? [], window: c.window ?? undefined,
    steps: c.steps ?? [], messages: c.messages ?? [], rounds: c.rounds ?? [], scopeStart: c.scopeStart,
    model: c.model, detail: c.detail, reason: c.reason, createdAt: c.createdAt, updatedAt: c.updatedAt,
    truncated: c.truncated, partial: c.partial,
  });
  // Disk first, memory second: the file always holds the final state before the
  // in-memory "running" mark goes away, so a reload never sees a finished turn
  // as "running" (which would misreport it as interrupted).
  const persist = async (c) => { const copy = { ...publicConv(c), updatedAt: Date.now() }; try { await askStore.put(copy); } finally { Object.assign(c, copy); } };
  /** Stored as running but no longer in memory: the Host restarted underneath it. */
  const reconcile = (c) => (c.status === "running" && !live.has(c.id)
    ? { ...c, status: "interrupted", detail: c.detail ?? "The Host restarted before this finished." }
    : c);

  // The window a question may search: one of the ordinary range keys, or "all".
  // Default is not "all" — sweeping every workspace for years is slow and vague.
  const ASK_RANGE_DEFAULT = "last-30d";
  const askWindow = (key, offsetMinutes) => (key === "all" ? null : resolveRange(RANGE_KEYS.includes(key) ? key : ASK_RANGE_DEFAULT, { now: Date.now(), offsetMin: offsetMinutes }));
  function askModelMessages(conv) {
    const messages = [];
    for (const message of conv.messages.slice(conv.scopeStart ?? 0)) {
      const previous = messages.at(-1);
      if (previous?.role === "user" && message.role === "user") {
        const text = [...previous.content, ...message.content].map(block => block.text).join("\n\n");
        messages[messages.length - 1] = { role: "user", content: [{ type: "text", text }] };
      } else messages.push(message);
    }
    return messages;
  }
  async function runTurn(conv, offsetMinutes) {
    conv.controller = new AbortController();
    live.set(conv.id, conv);
    Object.assign(conv, { status: "running", steps: [], model: undefined, detail: undefined, reason: undefined, truncated: undefined, partial: undefined });
    await persist(conv); // the new question is on disk before any model call
    // The running conversation exposes recorded steps. Messages are published together at the end.
    const done = async (patch, output = [], round = null) => {
      const messages = [...conv.messages, ...output];
      const rounds = round ? [...conv.rounds, { ...round, at: messages.length - 1 }] : conv.rounds;
      const final = publicConv({ ...conv, messages, rounds, ...patch, updatedAt: Date.now() });
      try { await askStore.put(final); } finally {
        Object.assign(conv, final); conv.controller = undefined; live.delete(conv.id);
      }
    };
    try {
      const settings = settingsStore.get();
      if (settings.source === "external") {
        await done({ status: "failed", reason: "unsupported", detail: "Asking with tools needs the Host model; switch the analysis source to the Host model." });
        return;
      }
      const route = await resolveRoute()(settings);
      const messages = askModelMessages(conv);
      const base = messages.length;
      const prior = conv.rounds.findLast(round => round.at >= (conv.scopeStart ?? 0) &&
        (round.coverage === "checked" || round.coverage === "partial"));
      const bound = conv.window || conv.tags.length
        ? { start: conv.window?.start ?? 0, end: conv.window?.end ?? null, tags: conv.tags }
        : null;
      const result = await runAsk({
        llm: child.get("llm"), route, settings, offsetMinutes,
        window: conv.window ?? null, tags: conv.tags, requireEvidence: true,
        priorEvidence: prior ? prior.reasons ?? [] : null,
        tools: createContextTools(source, { bound, offsetMinutes, resultLimit: ASK_RESULT_LIMIT }),
        messages, signal: conv.controller.signal,
        onStep: (_step, steps) => { conv.steps = steps.map(step => ({ ...step })); },
      });
      if (conv.controller.signal.aborted) await done({ status: "cancelled" });
      else if (result.ok || result.reason === "no-evidence") {
        const coverage = result.dialogue ? "dialogue" : !result.ok ? "no-evidence" : result.partial ? "partial" : "checked";
        await done(
          { status: "idle", model: result.model, truncated: result.truncated === true, partial: !!result.partial, reason: result.reason },
          messages.slice(base),
          { coverage, reasons: result.coverageReasons ?? [], ...(result.reused ? { reused: true } : {}) },
        );
      } else await done({ status: "failed", detail: result.detail, reason: result.reason });
    } catch (error) {
      if (conv.controller.signal.aborted) await done({ status: "cancelled" });
      else { logger?.warn?.(`ask failed: ${error?.message ?? error}`); await done({ status: "failed", detail: String(error?.message ?? error).slice(0, 300) }); }
    }
  }

  child.effect(() => child.connection.fetch.register({
    path: ROUTE_ASK,
    methods: ["GET", "POST"],
    requestBody: "buffered",
    fetch: async (request) => {
      if (request.method === "GET") {
        const id = new URL(request.url).searchParams.get("id");
        if (!id) {
          const saved = (await askStore.list()).filter(c => !live.has(c.id)).map(reconcile);
          const all = [...saved, ...[...live.values()].map(publicConv)];
          return json({ ok: true, asks: all.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)) });
        }
        if (live.has(id)) return json({ ok: true, ask: publicConv(live.get(id)) });
        const saved = await askStore.get(id);
        return saved ? json({ ok: true, ask: reconcile(saved) }) : json({ ok: false, reason: "not-found" }, 404);
      }
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, reason: "bad-request" }, 400); }
      const id = String(body?.id ?? "");
      // Stop ends the current turn but keeps the conversation; delete forgets it.
      if (body?.action === "stop") {
        live.get(id)?.controller?.abort();
        return json({ ok: live.has(id) });
      }
      if (body?.action === "delete") {
        live.get(id)?.controller?.abort();
        live.delete(id);
        return json({ ok: await askStore.remove(id) });
      }
      const question = typeof body?.question === "string" ? body.question.trim().slice(0, 2000) : "";
      if (!question) return json({ ok: false, reason: "bad-request", detail: "question is empty" }, 400);
      if (live.size >= 2) return json({ ok: false, reason: "busy" });
      if (live.has(id)) return json({ ok: false, reason: "busy", detail: "this conversation is still answering" });
      let conv = id ? await askStore.get(id) : undefined;
      if (id && !conv) return json({ ok: false, reason: "not-found", detail: "conversation not found" }, 404);
      if (!conv) {
        conv = { id: `ask-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, title: question.slice(0, 60), status: "idle", steps: [], messages: [], createdAt: Date.now() };
      }
      const prior = conv.messages ?? [];
      const offset = clampOffset(body.offset);
      const requestedRange = body.range ?? conv.range;
      const rangeKey = RANGE_KEYS.includes(requestedRange) ? requestedRange : ASK_RANGE_DEFAULT;
      const window = askWindow(rangeKey, offset);
      let tags;
      try { tags = normalizeTagScope(body.tags === undefined ? conv.tags : body.tags); }
      catch (error) { return json({ ok: false, reason: "bad-request", detail: error.message }, 400); }
      const oldTags = conv.tags ?? [];
      const changed = (conv.range ?? ASK_RANGE_DEFAULT) !== rangeKey ||
        (window && conv.window && (window.start > conv.window.start || window.end < conv.window.end)) ||
        oldTags.length !== tags.length || oldTags.some(tag => !tags.includes(tag));
      if (changed) conv.scopeStart = prior.length;
      conv.messages = [...prior, { role: "user", content: [{ type: "text", text: question }] }];
      conv.range = rangeKey;
      conv.tags = tags;
      conv.window = window ? { start: window.start, end: window.end, key: window.key, label: window.label, from: window.from, to: window.to } : null;
      void runTurn(conv, offset);
      return json({ ok: true, ask: publicConv(conv) });
    },
  }));

  // --- follow-up --------------------------------------------------------------
  const followupsInFlight = new Set();
  child.effect(() => child.connection.fetch.register({
    path: ROUTE_FOLLOWUP,
    methods: ["POST"],
    requestBody: "buffered",
    fetch: async (request) => {
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, reason: "bad-request" }, 400); }
      const question = typeof body?.question === "string" ? body.question.trim().slice(0, 2000) : "";
      const digest = await store.get(String(body?.id ?? ""));
      if (!digest || !question) return json({ ok: false, reason: "bad-request" }, 400);
      if (followupsInFlight.has(digest.id) || running.has(digest.id)) return json({ ok: false, reason: "busy" });
      followupsInFlight.add(digest.id);
      try {
        const slices = digest.snapshots?.length || digest.frozenSlices
          ? await frozenSlicesFor(digest)
          : (await slicesFor(digest.range, { project: digest.project, session: digest.session, ids: digest.sessionIds, tags: digest.tags }))
            .filter(s => !digest.sessionIds?.length || digest.sessionIds.includes(s.id));
        const answer = await models.complete({
          settings: settingsStore.get(),
          system: FOLLOWUP_SYSTEM,
          user: buildFollowupPrompt({ question, digest: digest.result, slices, history: digest.followups }),
          maxTokens: 2048,
        });
        if (!answer.ok) return json({ ok: false, reason: answer.reason, detail: answer.detail });
        digest.followups = [...(digest.followups ?? []), { q: question, a: answer.text, at: Date.now(), model: answer.model }];
        await store.put(digest);
        return json({ ok: true, digest: publicDigest(digest) });
      } catch (error) {
        return json({ ok: false, reason: "source-unavailable", detail: String(error?.message ?? error) });
      } finally {
        followupsInFlight.delete(digest.id);
      }
    },
  }));

  // --- markdown export --------------------------------------------------------
  child.effect(() => child.connection.fetch.register({
    path: ROUTE_DIGEST_EXPORT,
    methods: ["GET"],
    requestBody: "buffered",
    fetch: async (request) => {
      const id = new URL(request.url).searchParams.get("id");
      const digest = await store.get(id);
      if (!digest?.result) return json({ ok: false, reason: "not-found" }, 404);
      const name = `focusing-${digest.range.from}-${digest.range.to}.md`;
      return new Response(digestToMarkdown(digest), {
        status: 200,
        headers: {
          ...cors,
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="${name}"`,
        },
      });
    },
  }));
  return { getDigest: id => store.get(id), askStore };
}
