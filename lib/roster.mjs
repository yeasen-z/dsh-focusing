// Focus panel roster helpers: stored (unloaded) sessions, their folded
// metadata, and the external-endpoint model catalogue.
//
// Kept out of index.mjs so each piece is testable with plain fakes.

import { createPanelMetadata, foldPanelEvent, projectName } from "./panel-data.mjs";

export const ROSTER_LIMIT = 200;
const STORED_TTL_MS = 15000;

/** mtime (ms) from a jsonl persistence revision "dev:ino:size:mtimeNs:ctimeNs". */
function revisionTime(revision) {
  const parts = String(revision ?? "").split(":");
  if (parts.length < 5 || !/^\d{13,}$/.test(parts[3])) return undefined;
  return Number(BigInt(parts[3]) / 1000000n);
}

/**
 * Normalize one row from sessionController.list() or sessionPersistence.list()
 * to { id, cwd, title, updatedAt, createdAt, key, child }.
 * `child` marks rows that are not the person's own conversation.
 */
export function storedRow(item) {
  if (item?.sessionId) {
    const title = item.projections?.values?.title;
    return {
      id: item.sessionId,
      cwd: item.cwd ?? "",
      title: typeof title === "string" ? title : (typeof title?.title === "string" ? title.title : ""),
      updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : null,
      createdAt: Number.isFinite(item.createdAt) ? item.createdAt : null,
      key: `c:${item.updatedAt ?? ""}`,
      child: !!(item.parentSessionId || item.origin === "subagent" || item.blank),
    };
  }
  const header = item?.header;
  if (!header?.id) return null;
  const mtime = revisionTime(item.revision);
  return {
    id: header.id,
    cwd: header.cwd ?? "",
    title: "",
    updatedAt: mtime ?? header.createdAt ?? null,
    createdAt: header.createdAt ?? null,
    key: `p:${item.revision ?? header.createdAt ?? ""}`,
    child: !!(header.parentSession || header.origin === "subagent" || (header.delegationDepth ?? 0) > 0),
  };
}

/**
 * Cached listing of stored sessions. Prefers the session controller (titles,
 * blank/subagent flags); falls back to the persistence list.
 */
export function createStoredRoster(services, { ttlMs = STORED_TTL_MS, now = () => Date.now() } = {}) {
  let cache = null;
  let pending = null;

  async function load(signal) {
    const { controller, persistence } = services();
    if (controller?.list) {
      try {
        const value = await controller.list({}, signal ?? new AbortController().signal);
        const items = Array.isArray(value?.items) ? value.items : Array.isArray(value) ? value : null;
        if (items) return { source: "controller", rows: items.map(storedRow).filter(Boolean) };
      } catch {
        /* fall through to persistence */
      }
    }
    if (persistence?.list) {
      try {
        const snaps = await persistence.list();
        return { source: "persistence", rows: (snaps ?? []).map(storedRow).filter(Boolean) };
      } catch {
        /* nothing stored is reachable */
      }
    }
    return { source: "none", rows: [] };
  }

  return {
    async list(signal) {
      if (cache && now() - cache.at < ttlMs) return cache.value;
      pending ??= load(signal).then((value) => {
        cache = { at: now(), value };
        return value;
      }).finally(() => { pending = null; });
      return pending;
    },
    invalidate() { cache = null; },
  };
}

/**
 * Build the roster rows that are not live: own sessions only, newest first,
 * capped, but every reviewed session is always kept.
 */
export function pickStoredRows(rows, { liveIds, reviewedIds, limit = ROSTER_LIMIT }) {
  const own = rows.filter(r => !r.child && !liveIds.has(r.id));
  own.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const kept = [];
  let plain = 0;
  for (const row of own) {
    if (reviewedIds.has(row.id)) kept.push(row);
    else if (plain < limit) { kept.push(row); plain += 1; }
  }
  return kept;
}

/** Fold a stored session's events into the panel metadata shape. */
export function foldStored(id, header, events) {
  const state = createPanelMetadata(id, header ?? {});
  let maxSeq = -1;
  for (const event of events ?? []) {
    if (Number.isFinite(event?.seq)) maxSeq = Math.max(maxSeq, event.seq);
    foldPanelEvent(state, event);
  }
  // A stored session has no live agent: the fold's "running" only means a turn
  // started without a recorded end.
  state.status = "idle";
  // Exclusive end, matching a live session's `seq`.
  state.readSeq = maxSeq + 1;
  return state;
}

/** Per-id cache of stored folds keyed by a change token. */
export function createStoredFoldCache(readSession, { limit = 40 } = {}) {
  const entries = new Map();
  return {
    async read(id, key) {
      const hit = entries.get(id);
      if (hit && key !== undefined && hit.key === key) return hit.state;
      const snapshot = await readSession(id);
      const state = foldStored(id, snapshot?.session ?? snapshot?.header ?? {}, snapshot?.events ?? []);
      entries.delete(id);
      entries.set(id, { key, state });
      while (entries.size > limit) entries.delete(entries.keys().next().value);
      return state;
    },
  };
}

export { projectName };

// ---------------------------------------------------------------------------
// External endpoint model catalogue.
// ---------------------------------------------------------------------------

/** OpenAI-compatible models URL for a chat completions endpoint. */
export function modelsUrl(endpoint) {
  const url = new URL(String(endpoint ?? ""));
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("endpoint must be http(s)");
  const path = url.pathname.replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(path)) {
    url.pathname = path.replace(/\/chat\/completions$/, "/models");
    url.search = "";
    url.hash = "";
    return url.toString();
  }
  return `${url.origin}/v1/models`;
}

function originOf(value) {
  try { return new URL(String(value)).origin; } catch { return undefined; }
}

/**
 * Which key to send: an explicitly typed key always; the stored key only to
 * the stored endpoint's origin, so it can never be redirected elsewhere.
 */
export function chooseKey({ endpoint, apiKey, stored }) {
  if (typeof apiKey === "string" && apiKey) return apiKey;
  if (!stored?.apiKey) return "";
  const a = originOf(endpoint);
  return a && a === originOf(stored.endpoint) ? stored.apiKey : "";
}

/** GET the models list. Returns { ok, models } or { ok:false, reason, detail }. Never echoes the key. */
export async function fetchExternalModels({ endpoint, apiKey, stored, fetchImpl, timeoutMs = 15000 }) {
  const target = endpoint || stored?.endpoint;
  if (!target) return { ok: false, reason: "no-endpoint", detail: "No endpoint is set." };
  let url;
  try { url = modelsUrl(target); } catch (error) {
    return { ok: false, reason: "bad-endpoint", detail: String(error?.message ?? error) };
  }
  const key = chooseKey({ endpoint: target, apiKey, stored });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (fetchImpl ?? globalThis.fetch)(url, {
      method: "GET",
      signal: controller.signal,
      headers: { accept: "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    });
    if (!response.ok) {
      let body = "";
      try { body = (await response.text()).slice(0, 200); } catch { body = ""; }
      if (key) body = body.split(key).join("***");
      return {
        ok: false,
        reason: response.status === 401 || response.status === 403 ? "bad-key" : "failed",
        detail: `HTTP ${response.status}${body ? `: ${body}` : ""}`,
      };
    }
    const payload = await response.json();
    const list = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : Array.isArray(payload) ? payload : [];
    const models = [...new Set(list.map(m => (typeof m === "string" ? m : m?.id ?? m?.name)).filter(v => typeof v === "string" && v))].sort();
    if (!models.length) return { ok: false, reason: "empty", detail: `${url} returned no models` };
    return { ok: true, models, url };
  } catch (error) {
    const detail = controller.signal.aborted ? `No answer within ${timeoutMs} ms.` : String(error?.message ?? error).slice(0, 300);
    return { ok: false, reason: controller.signal.aborted ? "timeout" : "failed", detail: key ? detail.split(key).join("***") : detail };
  } finally {
    clearTimeout(timer);
  }
}
