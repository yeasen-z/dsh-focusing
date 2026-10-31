// Native historical Q&A: Focusing owns the index and scope, while ordinary DSH
// Agent/Session infrastructure owns messages, tools, streaming and persistence.
import { randomUUID } from "node:crypto";
import { createFocusingSessionStore } from "./focusing-session-store.mjs";
import { createAskStore } from "./ask-store.mjs";
import { resolveRange } from "./time-range.mjs";

export const ROUTE_NATIVE_ASK = "/api/dsh-focusing.native-ask";

const textOf = content => Array.isArray(content)
  ? content.filter(block => block?.type === "text").map(block => block.text).join("\n")
  : "";

// Which logged user messages are the person's own words.
//
// DSH records its own model input as user messages too: the runtime-context
// snapshot, the skill catalog, the time context. They belong in the model's
// context, never in the conversation a person reads, and every one of them
// carries a `source.kind` other than "user".
const isHumanTurn = event => {
  const kind = event.data?.source?.kind;
  return kind === undefined || kind === "user";
};

function fold(events) {
  const messages = [];
  let status = "idle";
  let detail;
  for (const event of events ?? []) {
    if (event.type === "user/message") {
      if (isHumanTurn(event)) messages.push({ role: "user", content: event.data?.content ?? [] });
    }
    else if (event.type === "assistant/message") messages.push({ role: "assistant", content: event.data?.message?.content ?? [] });
    else if (event.type === "turn/start") status = "running";
    else if (event.type === "turn/end") {
      const reason = event.data?.reason;
      status = reason?.kind === "aborted" ? "cancelled" : reason?.kind === "error" ? "failed" : "idle";
      detail = reason?.error?.message;
    }
  }
  return { messages, status, detail };
}

export function registerNativeAskRoutes(child, { file, legacyFile, logger, setupAgent } = {}) {
  const store = createFocusingSessionStore({ file, logger });
  const legacy = createAskStore({ file: legacyFile, logger });
  const json = (body, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
  const controller = () => child.get("sessionController");
  // Archiving is the Host's own durable "leave the session list" verb. There is
  // no API that deletes a session log, so Focusing never pretends to: it archives.
  const registry = () => child.get("workspaceRegistry");
  async function setArchived(entry, archived) {
    const workspaces = registry();
    if (!workspaces) throw new Error("Session archiving is unavailable in this Host.");
    if (archived) await workspaces.archiveSession(entry.sessionId, { stopActivity: true });
    else await workspaces.unarchiveSession(entry.sessionId);
    return store.put({ ...entry, archived, updatedAt: Date.now() });
  }
  const prepare = async (sessionId, entry) => {
    if (typeof setupAgent !== "function") return;
    const resolved = await controller().resolveAgent(sessionId);
    if (resolved?.error) throw resolved.error;
    const agent = resolved?.agent;
    if (!agent?.ctx) throw new Error("The native DSH Agent is unavailable for this session.");
    await setupAgent(agent.ctx, agent, entry);
  };

  async function publicSession(entry, signal) {
    const inspected = await controller().inspect(entry.sessionId, signal);
    const folded = fold(inspected.events);
    return {
      id: entry.id,
      sessionId: entry.sessionId,
      native: true,
      kind: entry.kind,
      title: entry.title,
      range: entry.scope?.range,
      window: entry.scope?.window,
      createdAt: entry.createdAt,
      updatedAt: Math.max(entry.updatedAt ?? 0, ...inspected.events.map(event => event.time ?? 0)),
      status: folded.status,
      detail: folded.detail,
      archived: entry.archived === true,
      messages: folded.messages,
      steps: [],
    };
  }

  child.effect(() => child.connection.fetch.register({
    path: ROUTE_NATIVE_ASK,
    // A route without a declared method list is not routed at all, which showed
    // up as a 404 for a path that looked registered.
    methods: ["GET", "POST"],
    requestBody: "buffered",
    async fetch(request) {
      try {
        if (request.method === "GET") {
          const url = new URL(request.url);
          const id = url.searchParams.get("id");
          if (id) {
            const entry = await store.get(id);
            if (entry) return json({ ok: true, ask: await publicSession(entry, request.signal) });
            const old = await legacy.get(id);
            if (old) return json({ ok: true, ask: { ...old, legacy: true, readOnly: true } });
            return json({ ok: false, reason: "not-found" }, 404);
          }
          const settled = await Promise.allSettled((await store.list()).map(entry => publicSession(entry, request.signal)));
          const native = settled.filter(result => result.status === "fulfilled").map(result => result.value);
          const old = (await legacy.list()).map(item => ({ ...item, legacy: true, readOnly: true }));
          return json({ ok: true, asks: [...native, ...old].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)) });
        }
        if (request.method !== "POST") return json({ ok: false, reason: "method-not-allowed" }, 405);
        const body = await request.json();
        if (body.action === "stop") {
          const entry = await store.get(body.id);
          if (!entry) return json({ ok: false, reason: "not-found" }, 404);
          controller().cancel({ sessionId: entry.sessionId });
          return json({ ok: true });
        }
        if (body.action === "delete") {
          const entry = await store.get(body.id);
          if (!entry) return json({ ok: await legacy.remove(body.id) });
          // A deleted conversation must not survive as an orphan in the Host's
          // session list, so it is archived before Focusing forgets it. The log
          // itself stays recoverable from the Host's archived list.
          try {
            await registry()?.archiveSession(entry.sessionId, { stopActivity: true });
          } catch (error) {
            logger?.("focusing: could not archive the session being deleted", error);
          }
          return json({ ok: await store.remove(entry.id) });
        }
        if (body.action === "archive" || body.action === "unarchive") {
          const entry = await store.get(body.id);
          if (!entry) return json({ ok: false, reason: "not-found" }, 404);
          const saved = await setArchived(entry, body.action === "archive");
          return json({ ok: true, ask: await publicSession(saved, request.signal) });
        }
        const question = String(body.question ?? "").trim();
        if (!question) return json({ ok: false, reason: "invalid", detail: "Question is required." }, 400);
        let entry = body.id ? await store.get(body.id) : undefined;
        if (body.id && !entry) return json({ ok: false, reason: "read-only", detail: "Legacy conversations are read-only; start a new native conversation to continue." }, 409);
        if (!entry) {
          const created = await controller().create({ cwd: process.cwd() });
          const now = Date.now();
          const range = body.range ?? "last-30d";
          const offsetMinutes = Number(body.offset) || 0;
          const window = range === "all" ? null : resolveRange(range, { now, offsetMin: offsetMinutes });
          entry = await store.put({
            id: `focus-${randomUUID()}`,
            sessionId: created.sessionId,
            kind: "historical-qa",
            title: question.slice(0, 120),
            scope: { range, offsetMinutes, window: window ? { start: window.start, end: window.end } : null },
            createdAt: now,
            updatedAt: now,
          });
        }
        await prepare(entry.sessionId, entry);
        await controller().prompt({
          requestId: `focusing-${randomUUID()}`,
          sessionId: entry.sessionId,
          mode: "queue",
          content: [{ type: "text", text: question }],
          clientTimeZone: typeof body.timeZone === "string" ? body.timeZone : undefined,
        }, request.signal);
        entry = await store.put({ ...entry, updatedAt: Date.now() });
        return json({ ok: true, ask: await publicSession(entry, request.signal) });
      } catch (error) {
        logger?.("focusing: native ask route failed", error);
        return json({ ok: false, reason: "source-unavailable", detail: String(error?.message ?? error) }, 500);
      }
    },
  }));

  return { store };
}
