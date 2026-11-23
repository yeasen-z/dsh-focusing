// Historical Q&A uses native DSH Agents and durable Session logs.
import { randomUUID } from "node:crypto";
import { createFocusingSessionStore } from "./focusing-session-store.mjs";
import { createAskStore } from "./ask-store.mjs";
import { RANGE_KEYS, resolveRange } from "./time-range.mjs";
import { normalizeTagScope } from "./session-tags.mjs";

export const ROUTE_NATIVE_ASK = "/api/dsh-focusing.native-ask";

function fold(events = []) {
  const messages = [];
  const assistantSteps = new Map();
  const receipts = new Map();
  let updatedAt = 0;
  let status = "idle";
  let detail;
  let openTurnSeq;
  for (const { type, seq, time, data } of events) {
    updatedAt = Math.max(updatedAt, time ?? 0);
    if (type === "user/message" && (data.source?.kind === undefined || data.source.kind === "user")) {
      messages.push({ role: "user", content: data.content ?? [] });
    }
    if (type === "user/message" || type === "agent/inbox/spliced") {
      const inputs = type === "user/message" ? [data] : data.inserted ?? [];
      for (const input of inputs) {
        const source = input.source;
        if (source?.kind === "user" && source.rpcId && !receipts.has(source.rpcId)) receipts.set(source.rpcId, seq);
      }
    }
    if (type === "assistant/message" || type === "tool/call") {
      const key = `${data.turn}:${data.step}`;
      if (type === "assistant/message") {
        const content = (data.message.content ?? []).filter(block => block.type === "text" || block.type === "tool-call");
        const message = { role: "assistant", content };
        assistantSteps.set(key, message);
        if (content.length) messages.push(message);
      } else {
        const call = { type: "tool-call", id: data.callId, name: data.name, arguments: data.arguments };
        const assistant = assistantSteps.get(key);
        if (!assistant) {
          const message = { role: "assistant", content: [call] };
          assistantSteps.set(key, message);
          messages.push(message);
        } else if (!assistant.content.some(block => block.type === "tool-call" && block.id === call.id)) {
          if (!assistant.content.length) messages.push(assistant);
          assistant.content.push(call);
        }
      }
    }
    if (type === "tool/result") {
      const { message, error } = data;
      messages.push({
        role: "tool", toolCallId: message.toolCallId ?? message.source?.callId,
        content: message.content ?? [],
        ...(message.isError || error ? { isError: true } : {}),
      });
    }
    if (type === "turn/start") {
      openTurnSeq = seq;
      status = "idle";
      detail = undefined;
    }
    if (type === "turn/end") {
      openTurnSeq = undefined;
      const reason = data.reason;
      status = {
        aborted: "cancelled", error: "failed", blocked: "failed", interrupted: "interrupted",
      }[reason?.kind] ?? "idle";
      detail = reason?.error?.message ?? (reason?.kind === "blocked" ? "DSH blocked this turn." : undefined);
    }
  }
  return { messages, receipts, updatedAt, openTurnSeq, status: openTurnSeq === undefined ? status : "interrupted", detail };
}

export function registerNativeAskRoutes(child, { file, legacyStore, legacyFile, logger, setupAgent } = {}) {
  const store = createFocusingSessionStore({ file, logger });
  const legacy = legacyStore ?? createAskStore({ file: legacyFile, logger });
  let legacyReady;
  const operations = new Map();
  const pendingPrompts = new Map();
  const json = (body, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
  const fail = (reason, status, detail) => json({ ok: false, reason, detail }, status);
  const controller = () => child.get("sessionController");
  const registry = () => child.get("workspaceRegistry");
  const isArchived = entry => registry()?.archivedSessionIds?.includes(entry.sessionId) ?? (entry.archived === true);
  const legacyReadOnly = item => ({
    ...item, legacy: true, readOnly: true,
    status: item.status === "running" || item.status === "queued" ? "interrupted" : item.status,
  });

  function serialize(sessionId, operation) {
    const task = (operations.get(sessionId) ?? Promise.resolve()).catch(() => {}).then(operation);
    operations.set(sessionId, task);
    return task.finally(() => {
      if (operations.get(sessionId) === task) operations.delete(sessionId);
    });
  }

  async function archiveInHost(sessionId, archived) {
    const workspaces = registry();
    if (!workspaces) throw new Error("Session archiving is unavailable in this Host.");
    if (archived) {
      await workspaces.archiveSession(sessionId, { stopActivity: true });
      pendingPrompts.delete(sessionId);
    } else {
      await workspaces.unarchiveSession(sessionId);
    }
  }

  function publicMetadata(entry, archived) {
    return {
      id: entry.id, sessionId: entry.sessionId, native: true,
      kind: entry.kind, title: entry.title, range: entry.scope?.range,
      window: entry.scope?.window, tags: entry.scope?.tags ?? [],
      createdAt: entry.createdAt, updatedAt: entry.updatedAt,
      archived, readOnly: archived, messages: [], steps: [],
      ...(entry.report ? { report: entry.report } : {}),
    };
  }

  async function publicSession(entry, signal) {
    const { sessionId } = entry;
    // A terminal state must never accompany history captured before it settled.
    const state = await controller().state({ sessionId }, signal);
    const { events } = await child.get("sessionQuery").readSession(sessionId);
    const folded = fold(events);
    const pending = pendingPrompts.get(sessionId);
    for (const requestId of pending ?? []) {
      if (folded.receipts.get(requestId) <= state.cursor) pending.delete(requestId);
    }
    if (pending?.size === 0) pendingPrompts.delete(sessionId);
    const archived = isArchived(entry);
    const running = !archived && (state.running || state.queue?.length > 0
      || pending?.size > 0 || folded.openTurnSeq > state.cursor);
    return {
      ...publicMetadata(entry, archived),
      updatedAt: Math.max(entry.updatedAt ?? entry.createdAt, folded.updatedAt),
      status: running ? "running" : folded.status,
      detail: running ? undefined : folded.detail,
      messages: folded.messages,
    };
  }

  async function replyAfterMutation(entry, signal, fallbackStatus) {
    try {
      return json({ ok: true, ask: await publicSession(entry, signal) });
    } catch (error) {
      // The native mutation succeeded. A failed read must not induce a second prompt.
      logger?.("focusing: could not read native ask after a successful operation", error);
      return json({ ok: true, ask: { ...publicMetadata(entry, isArchived(entry)), status: fallbackStatus } });
    }
  }

  async function submit(entry, question, body, signal) {
    if (typeof setupAgent === "function") {
      const resolved = await controller().resolveAgent(entry.sessionId);
      if (resolved?.error) throw resolved.error;
      if (!resolved?.agent?.ctx) throw new Error("The native DSH Agent is unavailable for this session.");
      await setupAgent(resolved.agent.ctx, resolved.agent, entry);
    }
    const requestId = `focusing-${randomUUID()}`;
    const pending = pendingPrompts.get(entry.sessionId) ?? new Set();
    pending.add(requestId);
    pendingPrompts.set(entry.sessionId, pending);
    try {
      await controller().prompt({
        requestId, sessionId: entry.sessionId, mode: "queue",
        content: [{ type: "text", text: question }],
        clientTimeZone: typeof body.timeZone === "string" ? body.timeZone : undefined,
      }, signal);
    } catch (error) {
      pending.delete(requestId);
      if (pending.size === 0) pendingPrompts.delete(entry.sessionId);
      throw error;
    }
    return replyAfterMutation(entry, signal, "running");
  }

  child.effect(() => child.connection.fetch.register({
    path: ROUTE_NATIVE_ASK,
    methods: ["GET", "POST"],
    requestBody: "buffered",
    async fetch(request) {
      try {
        const { signal } = request;
        const readLegacy = () => legacyReady ??= legacy.load();
        if (request.method === "GET") {
          const url = new URL(request.url);
          const id = url.searchParams.get("id");
          if (id) {
            const entry = await store.get(id);
            if (entry) return json({ ok: true, ask: await publicSession(entry, signal) });
            await readLegacy();
            const old = await legacy.get(id);
            if (old) return json({ ok: true, ask: legacyReadOnly(old) });
            return fail("not-found", 404);
          }
          const reports = url.searchParams.get("kind") === "reports";
          const entries = (await store.list()).filter(entry => !isArchived(entry)
            && (reports ? entry.kind === "historical-report" : entry.kind === "historical-qa"));
          const native = await Promise.all(entries.map(async entry => {
            try {
              return await publicSession(entry, signal);
            } catch (error) {
              logger?.("focusing: could not read native ask", error);
              return { ...publicMetadata(entry, isArchived(entry)), status: "failed", detail: String(error?.message ?? error) };
            }
          }));
          if (!reports) await readLegacy();
          const old = reports ? [] : (await legacy.list()).map(legacyReadOnly);
          return json({ ok: true, asks: [...native.filter(item => !item.archived), ...old]
            .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)) });
        }
        if (request.method !== "POST") return fail("method-not-allowed", 405);
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)
          || (body.id !== undefined && (typeof body.id !== "string" || !body.id))) {
          return fail("invalid", 400, "A JSON object with a valid conversation ID is required when addressing a conversation.");
        }
        const action = body.action ?? "prompt";
        if (!["prompt", "stop", "archive", "unarchive", "delete"].includes(action)) return fail("invalid", 400, "Unknown conversation action.");
        const question = typeof body.question === "string" ? body.question.trim() : "";
        if (action === "prompt" && !question) return fail("invalid", 400, "Question is required.");
        if (action !== "prompt" && !body.id) return fail("invalid", 400, "Conversation ID is required.");
        let tags;
        if (action === "prompt" && body.tags !== undefined) {
          try {
            tags = normalizeTagScope(body.tags);
          } catch (error) {
            return fail("invalid", 400, error.message);
          }
        }
        if (body.id) {
          const found = await store.get(body.id);
          if (!found) {
            await readLegacy();
            const old = await legacy.get(body.id);
            if (!old) return fail("not-found", 404);
            if (action === "delete") return json({ ok: await legacy.remove(body.id) });
            return fail("read-only", 409, "Legacy conversations are read-only. Start a new native conversation to continue.");
          }
          return await serialize(found.sessionId, async () => {
            const entry = await store.get(found.sessionId);
            const archived = isArchived(entry);
            if (action === "archive" || action === "unarchive" || action === "delete") {
              const nextArchived = action !== "unarchive";
              await archiveInHost(entry.sessionId, nextArchived);
              // Keep ownership after archival so a Host resume still applies the same scope.
              const saved = await store.put({ ...entry, archived: nextArchived, updatedAt: Date.now() });
              return action === "delete" ? json({ ok: true }) : replyAfterMutation(saved, signal, "idle");
            }
            if (action === "stop") {
              if (!archived) {
                try {
                  await controller().cancel({ sessionId: entry.sessionId });
                } catch (error) {
                  // A detached session has no active turn to cancel.
                  if (error?.code !== "session/not-found") throw error;
                }
              }
              return replyAfterMutation(entry, signal, archived ? "idle" : "running");
            }
            if (archived) return fail("read-only", 409, "Restore the archived conversation before continuing.");
            const boundTags = entry.scope?.tags ?? [];
            if ((body.range !== undefined && body.range !== entry.scope?.range)
              || (tags && (tags.length !== boundTags.length || tags.some(tag => !boundTags.includes(tag))))) {
              return fail("scope-mismatch", 409, "The date range and tags are fixed for this conversation. Start a new conversation to change them.");
            }
            return submit(entry, question, body, signal);
          });
        }
        const range = body.range === undefined ? "last-30d" : body.range;
        if (!RANGE_KEYS.includes(range)) return fail("invalid", 400, "Unknown date range.");
        const offsetMinutes = Number(body.offset ?? 0);
        if (!Number.isInteger(offsetMinutes) || Math.abs(offsetMinutes) > 1440) return fail("invalid", 400, "UTC offset must be a valid number of minutes.");
        let report = null;
        if (body.report !== undefined) {
          const value = body.report;
          if (!value || typeof value !== "object" || Array.isArray(value)
            || typeof value.request !== "string" || !value.request.trim() || value.request.length > 2000) {
            return fail("invalid", 400, "A report needs its original request of at most 2000 characters.");
          }
          const allowedKinds = new Set(["daily", "weekly", "analysis", "digest"]);
          if (value.kind !== undefined && !allowedKinds.has(value.kind)) return fail("invalid", 400, "Unknown report kind.");
          if (value.templateId !== undefined && (typeof value.templateId !== "string" || value.templateId.length > 120)) return fail("invalid", 400, "Invalid template ID.");
          report = {
            request: value.request.trim(), kind: value.kind ?? "digest",
            ...(value.templateId ? { templateId: value.templateId } : {}),
          };
        }
        signal.throwIfAborted();
        const { sessionId } = await controller().create({ cwd: process.cwd() });
        return await serialize(sessionId, async () => {
          const now = Date.now();
          const window = range === "all" ? null : resolveRange(range, { now, offsetMin: offsetMinutes });
          let entry;
          try {
            const savedReport = report ? { ...report, range: resolveRange(range, { now, offsetMin: offsetMinutes, locale: body.locale === "en" ? "en" : "zh" }) } : null;
            entry = await store.put({
              id: `focus-${randomUUID()}`, sessionId, kind: report ? "historical-report" : "historical-qa",
              title: (report?.request ?? question).slice(0, 120),
              ...(savedReport ? { report: savedReport } : {}),
              scope: { range, offsetMinutes, window: window && { start: window.start, end: window.end }, tags: tags ?? [] },
              createdAt: now, updatedAt: now,
            });
            return await submit(entry, question, body, signal);
          } catch (error) {
            try {
              await archiveInHost(sessionId, true);
              if (entry) await store.put({ ...entry, archived: true, updatedAt: Date.now() });
            } catch (archiveError) {
              logger?.("focusing: could not archive the session after creation failed", archiveError);
            }
            throw error;
          }
        });
      } catch (error) {
        logger?.("focusing: native ask route failed", error);
        return fail("source-unavailable", 500, String(error?.message ?? error));
      }
    },
  }));

  return { store };
}
