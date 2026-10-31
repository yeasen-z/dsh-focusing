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
import { isPersonal, sliceRecord, recordSummary, rangeStats } from "./context-records.mjs";
import { createRecordIndex } from "./record-index.mjs";
import { createContextSource } from "./context-source.mjs";
import { createContextTools } from "./context-tools.mjs";
import { runAsk } from "./ask.mjs";
import { createDigestStore } from "./digest-store.mjs";
import { createAskStore } from "./ask-store.mjs";
import { createTemplateStore, templateText } from "./template-store.mjs";
import { complete } from "./complete.mjs";
import {
  DIGEST_SYSTEM, FOLLOWUP_SYSTEM, buildDigestPrompt, buildFollowupPrompt,
  extractJson, normalizeDigest, draftDigest, digestToMarkdown,
} from "./digest.mjs";
import { createRouteResolver } from "./review.mjs";
import { activityCalendar } from "./activity.mjs";

export const ROUTE_RECORDS = "/api/dsh-focusing.records";
export const ROUTE_DIGESTS = "/api/dsh-focusing.digests";
export const ROUTE_DIGEST = "/api/dsh-focusing.digest";
export const ROUTE_FOLLOWUP = "/api/dsh-focusing.followup";
export const ROUTE_DIGEST_EXPORT = "/api/dsh-focusing.digest-export";
export const ROUTE_ACTIVITY = "/api/dsh-focusing.activity";
export const ROUTE_ASK = "/api/dsh-focusing.ask";
export const ROUTE_TEMPLATES = "/api/dsh-focusing.templates";

const DIGEST_TOKENS = 4096;
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

export function registerContextRoutes(child, { settingsStore, digestFile, activityFile, logger, codexRecords, codexChats, onContextSource }) {
  const cors = { "cache-control": "no-store" };
  const json = (body, status = 200) => Response.json(body, { status, headers: cors });
  const index = createRecordIndex(() => ({
    sessions: child.get("sessions"),
    persistence: child.get("sessionPersistence"),
    query: child.get("sessionQuery"),
  }), { activityFile, summaryFile: activityFile ? activityFile.replace(/activity-index\.json$/, "records-index.json") : undefined, logger });
  const source = createContextSource(index, codexChats);
  onContextSource?.(source);
  const store = createDigestStore({ file: digestFile, logger });
  void store.load();
  const running = new Map(); // id -> live digest object while generating

  const isLive = id => !!child.get("agents")?.get?.(id);
  const titleOf = (record) => {
    const live = child.get("sessions")?.get?.(record.id);
    const snap = live ? child.get("sessionTitle")?.get?.(live) : undefined;
    return snap?.title || record.title || record.fallbackTitle || "";
  };

  /** Records sliced to a range, filtered to things the person did. */
  async function slicesFor(range, { project, query, session, ids } = {}) {
    const records = ids ? await Promise.all(ids.map(async id => {
      const record = await source.record(id);
      if (!record) throw new Error(`Source session unavailable: ${id}`);
      return record;
    })) : session
      ? [await source.record(session)].filter(Boolean)
      : await source.records({ since: range.start });
    if (session && !records.length) throw new Error("Session is unavailable or its source is disabled");
    const slices = [];
    for (const record of records) {
      if (!session && !isPersonal(record)) continue;
      if (project && record.project !== project) continue;
      const slice = sliceRecord(record, range, at => localDate(at, range.offsetMin));
      if (!slice) continue;
      slice.title = titleOf(record) || slice.title;
      slice.running = isLive(record.id) && record.open;
      if (query) {
        const hay = `${slice.title}\n${slice.project}\n${slice.requests.map(r => r.text).join("\n")}\n${slice.lastReply}`.toLowerCase();
        if (!hay.includes(query.toLowerCase())) continue;
      }
      slices.push(slice);
    }
    slices.sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0));
    return slices;
  }

  /**
   * The records list, built from the durable per-session index: a session is
   * folded once and reused until its file changes, so opening the page after a
   * restart costs a directory listing plus one JSON read, not a re-read of every
   * transcript. Only the turns inside the range are counted, so the numbers and
   * the ordering still match the chosen span.
   */
  async function rowsFor(range, { query } = {}) {
    const entries = await source.timelines({ since: range.start });
    const needle = String(query || "").toLowerCase();
    const rows = [];
    for (const entry of entries) {
      const summary = entry.summary;
      if (!summary) continue;
      // Subagent sessions are not the person's own work.
      if ((entry.depth ?? summary.depth ?? 0) > 0 || entry.origin === "subagent") continue;
      if (needle && !String(summary.search || "").includes(needle)) continue;
      const turns = [];
      const days = new Set();
      let firstAt = null;
      let lastAt = 0;
      let calls = 0;
      let failed = 0;
      for (const turn of entry.turns || []) {
        const at = turn.start ?? turn.requests?.[0]?.time ?? turn.end ?? null;
        const last = turn.end ?? at;
        if (at === null || last === null) continue;
        if (last < range.start || at >= range.end) continue;
        turns.push(turn);
        calls += turn.calls ?? 0;
        failed += turn.failed ?? 0;
        if (firstAt === null || at < firstAt) firstAt = at;
        if (last > lastAt) lastAt = last;
        days.add(localDate(at, range.offsetMin));
        days.add(localDate(last, range.offsetMin));
      }
      if (!turns.length) continue;
      rows.push({ ...summary, turns: turns.length, calls, failed, firstAt, lastAt, days: [...days].sort() });
    }
    rows.sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0));
    return rows;
  }

  /** Numbers for the range, from the rows the list already carries. */
  function statsOf(rows) {
    const projects = new Set();
    const days = new Set();
    let turns = 0;
    let calls = 0;
    let failed = 0;
    let files = 0;
    for (const row of rows) {
      if (row.project) projects.add(row.project);
      for (const day of row.days) days.add(day);
      turns += row.turns;
      calls += row.calls;
      failed += row.failed;
      files += row.files ?? 0;
    }
    return { sessions: rows.length, projects: projects.size, activeDays: days.size, turns, calls, failed, files };
  }

  const resolveRoute = () => createRouteResolver({ defaultModel: child.get("agentDefaultModel") });

  async function generate(digest, { project, locale }) {
    const stage = (name, extra = {}) => Object.assign(digest, { stage: name, ...extra });
    try {
      stage("scan");
      const range = digest.range;
      const slices = await slicesFor(range, { project, session: digest.session });
      digest.stats = rangeStats(slices);
      digest.sources = slices.map(s => ({ id: s.id, source: s.source, readOnly: s.readOnly, title: s.title, project: s.project, calls: s.calls, lastAt: s.lastAt }));
      digest.sessionIds = slices.map(s => s.id);
      if (range.key === "session" && slices[0]?.firstAt) range.from = localDate(slices[0].firstAt, range.offsetMin);
      stage("fold");
      if (!slices.length) {
        Object.assign(digest, { status: "done", stage: "done", result: normalizeDigest(draftDigest({ range, slices, locale })), draft: true, note: "empty" });
        return;
      }
      stage("model");
      const settings = settingsStore.get();
      const answer = await complete({
        settings,
        llm: child.get("llm"),
        resolveRoute: resolveRoute(),
        system: DIGEST_SYSTEM,
        user: buildDigestPrompt({ request: digest.request, range, slices }),
        maxTokens: Math.max(DIGEST_TOKENS, settings.maxTokens),
        timeoutMs: Math.max(DIGEST_TIMEOUT, settings.timeoutMs),
      });
      const parsed = answer.ok ? extractJson(answer.text) : undefined;
      if (parsed) {
        const result = normalizeDigest(parsed, new Set(digest.sessionIds));
        if (!result.title) result.title = draftDigest({ range, slices, locale }).title;
        Object.assign(digest, { status: "done", stage: "done", result, model: answer.model, draft: false });
      } else {
        // The facts still make a useful page; say why the narrative is missing.
        Object.assign(digest, {
          status: "done", stage: "done", draft: true,
          result: normalizeDigest(draftDigest({ range, slices, locale })),
          model: answer.model,
          error: answer.ok ? { reason: "unparsed", detail: answer.text.slice(0, 400) } : { reason: answer.reason, detail: answer.detail },
        });
      }
    } catch (error) {
      Object.assign(digest, { status: "failed", stage: "failed", error: { reason: "failed", detail: String(error?.message ?? error).slice(0, 400) } });
    } finally {
      digest.finishedAt = Date.now();
      await store.put(digest);
      running.delete(digest.id);
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
        const all = await rowsFor(range, { query: url.searchParams.get("q") || "" });
        const project = url.searchParams.get("project") || "";
        const cwdParam = url.searchParams.get("cwd") || "";
        const workspaces = [...new Set(cwdParam.split("\n").map(x => x.trim()).filter(Boolean))].slice(0, 100);
        const rows = all.filter(s => (!project || s.project === project) && (!workspaces.length || workspaces.includes(s.cwd)));
        const projects = [...new Set(all.map(s => s.project).filter(Boolean))].sort();
        const availableWorkspaces = [...new Set(all.map(s => s.cwd).filter(Boolean))].sort((a,b) => a.localeCompare(b));
        return json({
          ok: true, range, stats: statsOf(rows), projects, workspaces: availableWorkspaces,
          records: rows.map(({ search, depth, ...row }) => row), errors: index.errors(),
        });
      } catch (error) {
        return json({ ok: false, reason: "failed", detail: String(error?.message ?? error), range });
      }
    },
  }));

  // --- the activity calendar --------------------------------------------------
  // GET ?days=&offset=&external=   per-day counts for a GitHub-style grid.
  // `external` picks whether imported chats (Codex) count; it defaults to the
  // saved setting, so the page and the setting agree until the person flips it.
  child.effect(() => child.connection.fetch.register({
    path: ROUTE_ACTIVITY,
    methods: ["GET"],
    requestBody: "buffered",
    fetch: async (request) => {
      const url = new URL(request.url);
      const offsetMin = clampOffset(url.searchParams.get("offset"));
      const span = Math.min(366, Math.max(7, Math.round(Number(url.searchParams.get("days"))) || 182));
      const end = Date.now() + 1;
      const startOfToday = Math.floor((Date.now() + offsetMin * 60000) / 86400000) * 86400000 - offsetMin * 60000;
      const start = startOfToday - (span - 1) * 86400000;
      const wanted = url.searchParams.get("external");
      const settings = settingsStore.get();
      const includeExternal = wanted === null ? settings.activityIncludeExternal === true : wanted === "1";
      try {
        const dsh = (await index.activityRecords({ since: start })).filter(isPersonal);
        const groups = [{ source: "dsh", records: dsh }];
        const external = includeExternal && codexRecords ? codexRecords() : { enabled: false, records: [] };
        if (includeExternal && external.records.length) groups.push({ source: "codex", records: external.records.filter(isPersonal) });
        const calendar = activityCalendar(groups, { start, end, offsetMin });
        return json({
          ok: true, ...calendar, span, includeExternal,
          // Whether there is anything to include, so the page can explain a switch that does nothing.
          externalAvailable: !!external.enabled && external.ok !== false,
          // Chats whose summary is still being built. The page does not cache an answer
          // while this is above zero, so the next visit asks again and gets the full grid.
          externalPending: external.pending ?? 0,
          externalEnabled: !!external.enabled,
          errors: index.errors(),
        });
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
      const record = id ? await source.record(id).catch(() => undefined) : undefined;
      if (!record) return json({ ok: false, reason: "no-session" });
      const slice = sliceRecord(record, { ...range, start: 0, end: Infinity }, at => localDate(at, range.offsetMin));
      return json({
        ok: true,
        record: slice ? { ...slice, title: titleOf(record) || slice.title, running: isLive(id) && record.open } : null,
      });
    },
  }));

  // --- digest list ----------------------------------------------------------
  child.effect(() => child.connection.fetch.register({
    path: ROUTE_DIGESTS,
    methods: ["GET"],
    requestBody: "buffered",
    fetch: async () => {
      const saved = await store.list();
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
        return digest ? json({ ok: true, digest }) : json({ ok: false, reason: "not-found" }, 404);
      }
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, reason: "bad-request" }, 400); }
      if (body?.action === "delete") {
        return json({ ok: await store.remove(String(body.id ?? "")) });
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
        request: text, kind: requestKind(text, range.key), range, project, session, templateId: template?.id,
        createdAt: Date.now(), status: "running", stage: "queued",
        stats: null, sources: [], sessionIds: [], result: null, followups: [],
      };
      running.set(digest.id, digest);
      void generate(digest, { project, locale });
      return json({ ok: true, digest });
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
  // list kept in a JSON file next to the digests; each question appends to it
  // and runs the tool loop with the whole list as context, so follow-ups build
  // on what was already discussed. The list is written before the model runs
  // and again when the turn ends, so nothing is lost to a reload or restart.
  const askStore = createAskStore({ file: digestFile ? `${digestFile}.asks.json` : undefined, logger });
  const templates = createTemplateStore({ file: digestFile ? `${digestFile}.templates.json` : undefined, logger });
  void templates.load();
  const live = new Map(); // conversationId -> the conversation, while a turn runs
  // While a turn runs the loop appends to the list; the page sees the thread as it
  // was when the turn began, and the turn's own progress through `steps`.
  const publicConv = (c) => ({ id: c.id, title: c.title, status: c.status, range: c.range, window: c.window ?? undefined, steps: c.steps ?? [], messages: c.status === "running" && c.base != null ? (c.messages ?? []).slice(0, c.base) : (c.messages ?? []), model: c.model, detail: c.detail, reason: c.reason, createdAt: c.createdAt, updatedAt: c.updatedAt, truncated: c.truncated });
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
  async function runTurn(conv, offsetMinutes) {
    conv.controller = new AbortController();
    live.set(conv.id, conv);
    // Where this turn starts. A turn that does not finish is cut back to here, so
    // the thread never keeps a tool call without its result (providers reject that).
    const base = conv.base = conv.messages.length;
    conv.status = "running"; conv.steps = [];
    await persist(conv); // the new question is on disk before any model call
    // Disk first, memory second: the file holds the final state before this
    // conversation stops counting as running, so a reader never sees "finished"
    // while the file still says "running" (which would read as interrupted).
    const done = async (patch) => {
      if (patch.status && patch.status !== "idle") conv.messages.length = base;
      const final = { ...publicConv({ ...conv, status: patch.status ?? "idle", base: undefined }), ...patch, updatedAt: Date.now() };
      try { await askStore.put(final); } finally {
        Object.assign(conv, final); conv.base = undefined; conv.controller = undefined; live.delete(conv.id);
      }
    };
    try {
      const settings = settingsStore.get();
      if (settings.source === "external") {
        await done({ status: "failed", reason: "unsupported", detail: "Asking with tools needs the Host model; switch the analysis source to the Host model." });
        return;
      }
      const route = await resolveRoute()(settings);
      const result = await runAsk({
        llm: child.get("llm"), route, settings, offsetMinutes,
        window: conv.window ?? null,
        tools: createContextTools(source, { bound: conv.window ? { start: conv.window.start, end: conv.window.end } : null }),
        messages: conv.messages, signal: conv.controller.signal,
        onStep: (_step, steps) => { conv.steps = steps.map(step => ({ ...step })); },
      });
      if (result.ok) await done({ model: result.model, truncated: result.truncated === true, status: "idle" });
      else if (conv.controller.signal.aborted) await done({ status: "cancelled" });
      else await done({ status: "failed", detail: result.detail, reason: result.reason });
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
      // After a stopped or failed turn the thread ends on the unanswered question;
      // the follow-up joins it rather than sending two user messages in a row.
      const prior = conv.messages ?? [];
      const last = prior[prior.length - 1];
      conv.messages = last?.role === "user"
        ? [...prior.slice(0, -1), { role: "user", content: [{ type: "text", text: `${last.content?.map(b => b.text).join("") ?? ""}\n\n${question}` }] }]
        : [...prior, { role: "user", content: [{ type: "text", text: question }] }];
      const offset = clampOffset(body.offset);
      const rangeKey = body.range === "all" || RANGE_KEYS.includes(body.range) ? body.range : ASK_RANGE_DEFAULT;
      const window = askWindow(rangeKey, offset);
      conv.range = rangeKey;
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
      if (followupsInFlight.has(digest.id)) return json({ ok: false, reason: "busy" });
      followupsInFlight.add(digest.id);
      try {
        const slices = (await slicesFor(digest.range, { project: digest.project, session: digest.session, ids: digest.sessionIds }))
          .filter(s => !digest.sessionIds?.length || digest.sessionIds.includes(s.id));
        const answer = await complete({
          settings: settingsStore.get(),
          llm: child.get("llm"),
          resolveRoute: resolveRoute(),
          system: FOLLOWUP_SYSTEM,
          user: buildFollowupPrompt({ question, digest: digest.result, slices, history: digest.followups }),
          maxTokens: 2048,
        });
        if (!answer.ok) return json({ ok: false, reason: answer.reason, detail: answer.detail });
        digest.followups = [...(digest.followups ?? []), { q: question, a: answer.text, at: Date.now(), model: answer.model }];
        await store.put(digest);
        return json({ ok: true, digest });
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
}
