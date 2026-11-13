// DSH bridge: forward the official, already-mounted Focusing handlers through
// the standalone HTTP adapter. No store or route implementation is duplicated.

import { randomUUID, timingSafeEqual } from "node:crypto";
import { normalizeTagScope, sessionTagObjects } from "./session-tags.mjs";

const COOKIE_NAME = "focusing_bridge";
const BRIDGE_CAPABILITIES = Object.freeze({
  mode: "dsh-bridge",
  nativeDsh: true,
  canAsk: true,
  canReport: true,
  canRooms: true,
  canAnalyze: true,
  canExport: true,
  canModelSettings: true,
  // Client navigation/draft actions must not be simulated with prompt().
  canFork: false,
  canStartDraft: false,
  canOpenSession: false,
});

function queryOf(params = {}) {
  const query = new URLSearchParams();
  for (const key of ["range", "offset", "project", "q", "cwd", "external", "days", "sources", "locale"]) {
    const value = params[key];
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  }
  for (const tag of normalizeTagScope(params.tags)) query.append("tag", tag);
  return query;
}

/**
 * @param {object} options
 * @param {import("@deepseek-ai/dsh").Connection} options.connection
 * @param {{record(id:string):Promise<object>,events(id:string):Promise<object>}} options.contextSource
 * @param {string} [options.token] optional only for deterministic tests
 */
export function createDshBridgeApp({ connection, contextSource, token = randomUUID() } = {}) {
  if (!connection?.createSharedFetchHandler || !connection?.browserPeer) {
    throw new Error("The DSH bridge needs connection.createSharedFetchHandler and connection.browserPeer");
  }
  if (!contextSource?.record || !contextSource?.events) {
    throw new Error("The DSH bridge needs the shared context source for event reads");
  }
  const shared = connection.createSharedFetchHandler("/api");
  const peer = connection.browserPeer;
  let closed = false;

  async function call(path, init = {}) {
    const headers = new Headers(init.headers);
    let body;
    if (init.body !== undefined) {
      body = typeof init.body === "string" ? init.body : JSON.stringify(init.body);
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
    }
    const request = new Request(new URL(path, "http://dsh-bridge.local"), {
      method: init.method ?? "GET",
      headers,
      body,
      signal: init.signal,
    });
    // browserPeer is an owner principal. The bridge therefore has its own
    // mandatory startup token + cookie gate before any request reaches here.
    return shared.fetch(request, peer);
  }

  async function callJson(path, init) {
    const response = await call(path, init);
    return response.json();
  }

  async function focusState(session) {
    const query = session ? `?session=${encodeURIComponent(session)}` : "";
    return callJson(`/api/dsh-focusing.state${query}`);
  }

  async function pluginSettings(patch, test = false) {
    if (patch === undefined) return callJson("/api/dsh-focusing.settings");
    return callJson("/api/dsh-focusing.settings", { method: "POST", body: { settings: patch, test: test === true } });
  }

  async function sources() {
    const [state, current] = await Promise.all([focusState(), pluginSettings()]);
    const nativeCount = (state.sessions ?? []).filter(row => !row.source || row.source === "dsh").length;
    return [
      { id: "dsh", label: "DSH", enabled: true, ok: true, loaded: true, sessions: nativeCount, pending: 0, capabilities: { readOnly: false, canAnalyze: true, canContinueInDsh: false } },
      { id: "codex", label: "Codex", ...current.codexStatus, capabilities: { readOnly: true, canAnalyze: true, canContinueInDsh: false } },
      { id: "claude", label: "Claude Code", ...current.claudeStatus, capabilities: { readOnly: true, canAnalyze: true, canContinueInDsh: false } },
    ];
  }

  async function sessions(params = {}) {
    const query = queryOf(params);
    return callJson(`/api/dsh-focusing.records?${query}`);
  }

  async function tags(params = {}) {
    const result = await sessions({ ...params, tags: [] });
    const counts = new Map();
    for (const record of result.records ?? []) {
      for (const tag of sessionTagObjects(record)) {
        const current = counts.get(tag.id) ?? { ...tag, count: 0 };
        current.count += 1;
        counts.set(tag.id, current);
      }
    }
    return [...counts.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
  }

  async function session(id, params = {}) {
    const query = queryOf(params);
    query.set("id", id);
    const body = await callJson(`/api/dsh-focusing.records/detail?${query}`);
    if (!body.ok || !body.record) return undefined;
    return { record: body.record, capabilities: { readOnly: true, canAnalyze: true, canContinueInDsh: false } };
  }

  async function events(id, params = {}) {
    const tags = normalizeTagScope(params.tags);
    if (tags.length) {
      const record = await contextSource.record(id);
      const { matchesTags } = await import("./session-tags.mjs");
      if (!record || !matchesTags(record, tags)) return undefined;
    }
    const raw = await contextSource.events(id);
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

  async function preview(id) {
    const body = await callJson(`/api/dsh-focusing.preview?session=${encodeURIComponent(id)}`);
    if (!body.ok) return undefined;
    const { ok, ...result } = body;
    return result;
  }

  async function exportSession(id, format = "md") {
    const response = await call(`/api/dsh-focusing.export?session=${encodeURIComponent(id)}&format=${encodeURIComponent(format)}`);
    if (!response.ok) return undefined;
    return {
      body: await response.text(),
      contentType: response.headers.get("content-type") ?? "text/plain; charset=utf-8",
      disposition: response.headers.get("content-disposition") ?? "attachment",
    };
  }

  function authorized(value) {
    const left = Buffer.from(String(value ?? ""));
    const right = Buffer.from(token);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  async function onRequest(request) {
    if (closed) return Response.json({ ok: false, reason: "bridge-closed" }, { status: 410 });
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.searchParams.has("token")) {
      if (!authorized(url.searchParams.get("token"))) {
        return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });
      }
      // Do not keep the capability in the visible URL after bootstrap. Later
      // access uses an HttpOnly cookie instead of a query credential.
      url.searchParams.delete("token");
      const location = `${url.pathname}${url.searchParams.size ? `?${url.searchParams}` : ""}`;
      return new Response(null, {
        status: 302,
        headers: {
          location,
          "cache-control": "no-store",
          "set-cookie": `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`,
        },
      });
    }
    const cookies = String(request.headers.cookie ?? "").split(/;\s*/);
    const presented = cookies.find(value => value.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
    if (authorized(presented)) return undefined;
    return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  return {
    capabilities: () => ({ ...BRIDGE_CAPABILITIES }),
    sources,
    settings: async patch => ({ settings: (await pluginSettings(patch)).settings, sources: await sources() }),
    pluginSettings,
    modelSummary: async () => (await focusState()).settingsSummary,
    focusState,
    sessions,
    tags,
    session,
    events,
    activity: async params => callJson(`/api/dsh-focusing.activity?${queryOf(params)}`),
    preview,
    analyze: async id => callJson("/api/dsh-focusing.analyze", { method: "POST", body: { session: id } }),
    exportSession,
    models: async () => callJson("/api/dsh-focusing.models"),
    externalModels: async body => callJson("/api/dsh-focusing.external-models", { method: "POST", body }),
    workspaceAction: async () => { throw new Error("This workspace action needs the DSH Client navigation bridge"); },
    routes: {
      get: path => path.startsWith("/api/dsh-focusing.") && path !== "/api/dsh-focusing.bridge" ? ({
        methods: ["GET", "HEAD", "POST"],
        fetch: request => shared.fetch(request, peer),
      }) : undefined,
    },
    onRequest,
    withToken: origin => {
      const url = new URL(origin);
      url.searchParams.set("token", token);
      return url.toString();
    },
    close: async () => { closed = true; },
  };
}
