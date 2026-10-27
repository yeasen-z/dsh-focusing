// Host routes for collaboration rooms. See room.mjs for the guarantees.
//
//   GET  /api/dsh-focusing.rooms            list
//   GET  /api/dsh-focusing.room?id=         one room + how far each source moved since its snapshot
//   POST /api/dsh-focusing.room             { action, ... }
//        create  { sessions:[id], topic?, routes?:[route|null] }
//        say     { id, text }                 the person's message (no model call)
//        turn    { id, speakers:[index] }     run participants one after another (background)
//        cancel  { id }
//        remove  { id, index }                delete one message
//        resnap  { id, index }                re-freeze one participant at the source's current state
//        handoff { id, locale? }              write a handoff brief (background)
//        target  { id }                       where a new session for the handoff should open
//        opened  { id }                       remember that the brief was put into a new session
//        delete  { id }
//
// A route is { provider, model } (a DSH model), "external" (the configured
// external endpoint) or null (follow the analysis settings).

import fs from "node:fs/promises";
import path from "node:path";
import { complete } from "./complete.mjs";
import { createRouteResolver } from "./review.mjs";
import { trailSince } from "./review-store.mjs";
import {
  takeSnapshot, participantLabel, nextSpeaker, buildTurnPrompt, buildHandoffPrompt, draftHandoff,
  roomSummary, roomTitle, HANDOFF_SYSTEM, MAX_SOURCES, MAX_MESSAGES,
} from "./room.mjs";

export const ROUTE_ROOMS = "/api/dsh-focusing.rooms";
export const ROUTE_ROOM = "/api/dsh-focusing.room";
const ROOM_LIMIT = 40;
const TURN_TOKENS = 1400;
const HANDOFF_TOKENS = 2400;

export function createRoomStore({ file, logger } = {}) {
  let rooms = [];
  let loading;
  let writing = Promise.resolve();
  const ready = () => (loading ??= (async () => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await fs.readFile(file, "utf8"));
      if (Array.isArray(parsed?.rooms)) rooms = parsed.rooms.filter(r => r && typeof r.id === "string" && Array.isArray(r.participants));
    } catch (error) {
      if (error?.code !== "ENOENT") logger?.("focusing: could not read rooms", error);
    }
  })());
  const persist = () => {
    if (!file) return Promise.resolve();
    // `pending` describes work in this process only; never persist it.
    const body = JSON.stringify({ version: 1, rooms: rooms.map(({ pending, ...r }) => r) }, null, 1);
    writing = writing.then(async () => {
      try {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(`${file}.tmp`, body, "utf8");
        await fs.rename(`${file}.tmp`, file);
      } catch (error) {
        logger?.("focusing: could not write rooms", error);
      }
    });
    return writing;
  };
  return {
    ready,
    list: () => rooms,
    get: id => rooms.find(r => r.id === id),
    async put(room) {
      await ready();
      room.updatedAt = Date.now();
      rooms = [room, ...rooms.filter(r => r.id !== room.id)].slice(0, ROOM_LIMIT);
      await persist();
      return room;
    },
    async remove(id) {
      await ready();
      rooms = rooms.filter(r => r.id !== id);
      await persist();
    },
  };
}

/** Settings for one participant's call: the analysis settings, with its route applied. */
export function settingsFor(base, route) {
  if (route === "external") return { ...base, source: "external" };
  if (route && route.provider && route.model) return { ...base, source: "dsh", provider: route.provider, model: route.model };
  return base;
}

export function routeLabel(route, base) {
  if (route === "external") return base?.externalModel ? `external/${base.externalModel}` : "external";
  if (route?.provider && route?.model) return `${route.provider}/${route.model}`;
  return null;
}

const newId = () => `room-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function registerRoomRoutes(child, { settingsStore, roomsFile, logger }) {
  const cors = { "cache-control": "no-store" };
  const json = (body, status = 200) => Response.json(body, { status, headers: cors });
  const store = createRoomStore({ file: roomsFile, logger });
  void store.ready();
  const controllers = new Map(); // room id -> AbortController of the running job

  /** Full log of one session, read-only, plus the exclusive end offset. */
  async function readSource(id) {
    const live = child.get("sessions")?.get?.(id);
    if (live) {
      const end = Number(live.seq);
      return {
        header: live.header ?? {},
        events: live.snapshotEvents(0, end),
        endSeq: end,
        title: child.get("sessionTitle")?.get?.(live)?.title,
      };
    }
    const query = child.get("sessionQuery");
    if (!query?.readSession) throw new Error("session query service unavailable");
    const { session, events } = await query.readSession(id);
    const endSeq = events.reduce((m, e) => Math.max(m, Number(e?.seq) || 0), -1) + 1;
    return { header: session ?? {}, events, endSeq, title: undefined };
  }

  async function snapshotOf(id) {
    const source = await readSource(id);
    return takeSnapshot({ id, header: source.header, events: source.events, endSeq: source.endSeq, title: source.title });
  }

  /** What each source did after its snapshot; null entries when unknown. */
  async function freshness(room) {
    return Promise.all(room.participants.map(async (p) => {
      if (!Number.isFinite(p.snapshot?.seq)) return null;
      try {
        const live = child.get("sessions")?.get?.(p.session);
        if (live) {
          const end = Number(live.seq);
          return end < p.snapshot.seq ? null : trailSince(live.snapshotEvents(p.snapshot.seq, end), 0);
        }
        const { events } = await child.get("sessionQuery").readSession(p.session);
        return trailSince(events, p.snapshot.seq);
      } catch {
        return null;
      }
    }));
  }

  const resolver = () => createRouteResolver({ defaultModel: child.get("agentDefaultModel") });

  async function speak(room, speaker, signal) {
    const p = room.participants[speaker];
    const base = settingsStore.get();
    const { system, user } = buildTurnPrompt(room, speaker);
    const answer = await complete({
      settings: settingsFor(base, p.route),
      llm: child.get("llm"),
      resolveRoute: resolver(),
      system,
      user,
      maxTokens: Math.max(TURN_TOKENS, base.maxTokens),
      timeoutMs: Math.max(90000, base.timeoutMs),
      signal,
    });
    return answer;
  }

  async function runTurns(room, speakers) {
    const controller = new AbortController();
    controllers.set(room.id, controller);
    try {
      for (let i = 0; i < speakers.length; i++) {
        if (controller.signal.aborted) break;
        const speaker = speakers[i];
        room.pending = { kind: "turn", speaker, queue: speakers.slice(i + 1), startedAt: Date.now() };
        const answer = await speak(room, speaker, controller.signal);
        if (controller.signal.aborted) break;
        if (!answer.ok) {
          room.error = { speaker, reason: answer.reason, detail: answer.detail, at: Date.now() };
          break;
        }
        room.error = null;
        room.messages.push({ role: "participant", speaker, text: answer.text, at: Date.now(), model: answer.model });
        if (room.messages.length > MAX_MESSAGES) room.messages.splice(0, room.messages.length - MAX_MESSAGES);
        await store.put(room);
      }
    } finally {
      controllers.delete(room.id);
      room.pending = null;
      await store.put(room);
    }
  }

  async function runHandoff(room, locale) {
    const controller = new AbortController();
    controllers.set(room.id, controller);
    room.pending = { kind: "handoff", startedAt: Date.now() };
    try {
      const base = settingsStore.get();
      const answer = await complete({
        settings: base,
        llm: child.get("llm"),
        resolveRoute: resolver(),
        system: HANDOFF_SYSTEM,
        user: buildHandoffPrompt(room),
        maxTokens: Math.max(HANDOFF_TOKENS, base.maxTokens),
        timeoutMs: Math.max(120000, base.timeoutMs),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      room.handoff = answer.ok
        ? { text: answer.text, at: Date.now(), model: answer.model, draft: false }
        : { text: draftHandoff(room, locale), at: Date.now(), draft: true, error: { reason: answer.reason, detail: answer.detail } };
    } finally {
      controllers.delete(room.id);
      room.pending = null;
      await store.put(room);
    }
  }

  const view = async (room) => ({ ...room, freshness: await freshness(room) });

  child.effect(() => child.connection.fetch.register({
    path: ROUTE_ROOMS,
    methods: ["GET"],
    fetch: async () => {
      await store.ready();
      return json({ ok: true, rooms: store.list().map(roomSummary) });
    },
  }));

  child.effect(() => child.connection.fetch.register({
    path: ROUTE_ROOM,
    methods: ["GET", "POST"],
    requestBody: "buffered",
    fetch: async (request) => {
      await store.ready();
      if (request.method === "GET") {
        const room = store.get(new URL(request.url).searchParams.get("id"));
        return room ? json({ ok: true, room: await view(room) }) : json({ ok: false, reason: "not-found" });
      }
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, reason: "bad-request" }, 400); }
      const action = body?.action;

      if (action === "create") {
        const ids = [...new Set((Array.isArray(body.sessions) ? body.sessions : []).filter(s => typeof s === "string" && s))];
        // The same session may join twice with different models: same facts, two viewpoints.
        const raw = Array.isArray(body.sessions) ? body.sessions.filter(s => typeof s === "string" && s) : [];
        if (raw.length < 1 || raw.length > MAX_SOURCES || !ids.length) return json({ ok: false, reason: "bad-sessions", detail: `1–${MAX_SOURCES} sessions` });
        const routes = Array.isArray(body.routes) ? body.routes : [];
        const participants = [];
        const cache = new Map();
        for (let i = 0; i < raw.length; i++) {
          let snapshot = cache.get(raw[i]);
          try {
            snapshot ??= await snapshotOf(raw[i]);
          } catch (error) {
            return json({ ok: false, reason: "read-failed", detail: `${raw[i]}: ${String(error?.message ?? error).slice(0, 200)}` });
          }
          cache.set(raw[i], snapshot);
          const route = routes[i] === "external" || (routes[i]?.provider && routes[i]?.model) ? routes[i] : null;
          participants.push({ label: participantLabel(i), session: raw[i], title: snapshot.title, project: snapshot.project, route, routeLabel: routeLabel(route, settingsStore.get()), snapshot });
        }
        const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 2000) : "";
        const room = { id: newId(), title: roomTitle(participants, topic), topic, createdAt: Date.now(), participants, messages: [], handoff: null, error: null };
        if (topic) room.messages.push({ role: "user", text: topic, at: Date.now() });
        await store.put(room);
        return json({ ok: true, room: await view(room) });
      }

      const room = store.get(body?.id);
      if (!room) return json({ ok: false, reason: "not-found" });
      const busy = controllers.has(room.id);

      if (action === "delete") {
        controllers.get(room.id)?.abort();
        await store.remove(room.id);
        return json({ ok: true });
      }
      if (action === "cancel") {
        controllers.get(room.id)?.abort();
        return json({ ok: true });
      }
      if (busy && action !== "opened" && action !== "target") return json({ ok: false, reason: "busy", room: await view(room) });

      if (action === "say") {
        const text = typeof body.text === "string" ? body.text.trim().slice(0, 6000) : "";
        if (!text) return json({ ok: false, reason: "empty" });
        room.messages.push({ role: "user", text, at: Date.now() });
        await store.put(room);
        return json({ ok: true, room: await view(room) });
      }
      if (action === "turn") {
        const count = room.participants.length;
        let speakers = Array.isArray(body.speakers) ? body.speakers.filter(n => Number.isInteger(n) && n >= 0 && n < count) : [];
        if (!speakers.length) speakers = [nextSpeaker(room)];
        speakers = speakers.slice(0, 8);
        room.pending = { kind: "turn", speaker: speakers[0], queue: speakers.slice(1), startedAt: Date.now() };
        void runTurns(room, speakers).catch(error => logger?.("focusing: room turn failed", error));
        return json({ ok: true, room: await view(room) });
      }
      if (action === "remove") {
        if (!Number.isInteger(body.index) || !room.messages[body.index]) return json({ ok: false, reason: "bad-index" });
        room.messages.splice(body.index, 1);
        await store.put(room);
        return json({ ok: true, room: await view(room) });
      }
      if (action === "resnap") {
        const p = room.participants[body.index];
        if (!p) return json({ ok: false, reason: "bad-index" });
        try {
          p.snapshot = await snapshotOf(p.session);
          p.title = p.snapshot.title || p.title;
        } catch (error) {
          return json({ ok: false, reason: "read-failed", detail: String(error?.message ?? error).slice(0, 200) });
        }
        room.messages.push({ role: "note", text: `resnap:${p.label}`, at: Date.now() });
        await store.put(room);
        return json({ ok: true, room: await view(room) });
      }
      if (action === "handoff") {
        room.pending = { kind: "handoff", startedAt: Date.now() };
        void runHandoff(room, body.locale === "en" ? "en" : "zh").catch(error => logger?.("focusing: room handoff failed", error));
        return json({ ok: true, room: await view(room) });
      }
      if (action === "target") {
        // Where the new session should live: the first participant's workspace when DSH knows it.
        const cwd = room.participants.find(p => p.snapshot?.cwd)?.snapshot.cwd;
        let workspaceId;
        try {
          workspaceId = cwd ? (await child.get("workspaceRegistry")?.resolveByPath?.(cwd))?.id : undefined;
        } catch { workspaceId = undefined; }
        return json({ ok: true, cwd: cwd ?? null, workspaceId: workspaceId ?? null });
      }
      if (action === "opened") {
        if (room.handoff) room.handoff.openedAt = Date.now();
        await store.put(room);
        return json({ ok: true, room: await view(room) });
      }
      return json({ ok: false, reason: "bad-action" }, 400);
    },
  }));
}
