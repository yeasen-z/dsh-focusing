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
import { createDigestStore } from "./digest-store.mjs";
import { complete } from "./complete.mjs";
import {
  DIGEST_SYSTEM, FOLLOWUP_SYSTEM, buildDigestPrompt, buildFollowupPrompt,
  extractJson, normalizeDigest, draftDigest, digestToMarkdown,
} from "./digest.mjs";
import { createRouteResolver } from "./review.mjs";

export const ROUTE_RECORDS = "/api/dsh-focusing.records";
export const ROUTE_DIGESTS = "/api/dsh-focusing.digests";
export const ROUTE_DIGEST = "/api/dsh-focusing.digest";
export const ROUTE_FOLLOWUP = "/api/dsh-focusing.followup";
export const ROUTE_DIGEST_EXPORT = "/api/dsh-focusing.digest-export";

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

export function registerContextRoutes(child, { settingsStore, digestFile, logger }) {
  const cors = { "cache-control": "no-store" };
  const json = (body, status = 200) => Response.json(body, { status, headers: cors });
  const index = createRecordIndex(() => ({
    sessions: child.get("sessions"),
    persistence: child.get("sessionPersistence"),
    query: child.get("sessionQuery"),
  }));
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
  async function slicesFor(range, { project, query, session } = {}) {
    const records = session
      ? [await index.record(session)].filter(Boolean)
      : await index.records({ since: range.start });
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

  const resolveRoute = () => createRouteResolver({ defaultModel: child.get("agentDefaultModel") });

  async function generate(digest, { project, locale }) {
    const stage = (name, extra = {}) => Object.assign(digest, { stage: name, ...extra });
    try {
      stage("scan");
      const range = digest.range;
      const slices = await slicesFor(range, { project, session: digest.session });
      digest.stats = rangeStats(slices);
      digest.sources = slices.map(s => ({ id: s.id, title: s.title, project: s.project, calls: s.calls, lastAt: s.lastAt }));
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
      running.delete(digest.id);
      if (digest.status === "done") await store.put(digest);
    }
  }

  // --- records -------------------------------------------------------------
  child.effect(() => child.connection.fetch.register({
    path: ROUTE_RECORDS,
    methods: ["GET"],
    fetch: async (request) => {
      const url = new URL(request.url);
      const range = resolveRange(url.searchParams.get("range"), {
        offsetMin: clampOffset(url.searchParams.get("offset")),
        locale: url.searchParams.get("locale") === "en" ? "en" : "zh",
      });
      try {
        const all = await slicesFor(range, { query: url.searchParams.get("q") || "" });
        const project = url.searchParams.get("project") || "";
        const slices = project ? all.filter(s => s.project === project) : all;
        const projects = [...new Set(all.map(s => s.project).filter(Boolean))].sort();
        return json({
          ok: true, range, stats: rangeStats(slices), projects,
          records: slices.map(s => recordSummary(s)), errors: index.errors(),
        });
      } catch (error) {
        return json({ ok: false, reason: "failed", detail: String(error?.message ?? error), range });
      }
    },
  }));

  // --- one record in detail -------------------------------------------------
  child.effect(() => child.connection.fetch.register({
    path: `${ROUTE_RECORDS}/detail`,
    methods: ["GET"],
    fetch: async (request) => {
      const url = new URL(request.url);
      const id = url.searchParams.get("id");
      const range = resolveRange(url.searchParams.get("range"), { offsetMin: clampOffset(url.searchParams.get("offset")) });
      const record = id ? await index.record(id).catch(() => undefined) : undefined;
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
      const text = typeof body?.request === "string" ? body.request.trim().slice(0, 2000) : "";
      if (!text) return json({ ok: false, reason: "bad-request", detail: "request is empty" }, 400);
      if (running.size >= 2) return json({ ok: false, reason: "busy" });
      const locale = body.locale === "en" ? "en" : "zh";
      const asked = RANGE_KEYS.includes(body.range) ? body.range : undefined;
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
        request: text, kind: requestKind(text, range.key), range, project, session,
        createdAt: Date.now(), status: "running", stage: "queued",
        stats: null, sources: [], sessionIds: [], result: null, followups: [],
      };
      running.set(digest.id, digest);
      void generate(digest, { project, locale });
      return json({ ok: true, digest });
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
        const slices = (await slicesFor(digest.range, { project: digest.project, session: digest.session }))
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
      } finally {
        followupsInFlight.delete(digest.id);
      }
    },
  }));

  // --- markdown export --------------------------------------------------------
  child.effect(() => child.connection.fetch.register({
    path: ROUTE_DIGEST_EXPORT,
    methods: ["GET"],
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
