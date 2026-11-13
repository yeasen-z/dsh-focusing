// Host-independent lifecycle for file-backed session sources.
//
// The composition root supplies source adapters and settings. This runtime owns
// directory changes, incremental indexes, public status, on-demand metadata and
// shutdown draining without knowing Cordis, HTTP or DSH session services.

import { statSync } from "node:fs";
import { createPanelMetadata, foldPanelEvent } from "./panel-data.mjs";

/**
 * Adapter contract:
 * - options(settings): { enabled, mode, path }
 * - resolve({mode,path}): { ok, home, via } or a public failure
 * - createIndex/createRoster/createRecords(home, index)
 * - load(path): { header, events }
 * Optional: forced() pins a home, cacheFile persists summaries.
 */
export function createImportedSourceRuntime({ settingsStore, adapters, fold, logger = () => {} } = {}) {
  if (!adapters || typeof fold !== "function") throw new Error("Imported sources need adapters and a record fold");
  const readers = Object.fromEntries(Object.keys(adapters).map(kind => [kind, null]));
  const retired = new Set();
  const generations = Object.fromEntries(Object.keys(adapters).map(kind => [kind, 0]));
  const metaCaches = Object.fromEntries(Object.keys(adapters).map(kind => [kind, new Map()]));
  const settings = () => settingsStore.view?.() ?? settingsStore.get();
  const kinds = () => Object.keys(adapters);
  const isImported = id => kinds().some(kind => String(id).startsWith(`${kind}:`));

  function source(kind, { rebuild = true } = {}) {
    const adapter = adapters[kind];
    if (!adapter) return { enabled: false, sessions: 0, rows: [] };
    const options = adapter.options(settings());
    if (!options.enabled) return { enabled: false, sessions: 0, rows: [] };
    const forced = adapter.forced?.();
    const found = forced ? { ok: true, home: forced, via: "env" } : adapter.resolve({ mode: options.mode, path: options.path });
    if (!found.ok) return { enabled: true, ok: false, mode: options.mode, reason: found.reason, path: found.path, tried: found.tried, sessions: 0, rows: [] };
    // Calendar/status-only reads need configuration and availability, not a full
    // directory scan or a new index. Existing readers also stay untouched.
    if (!rebuild && !readers[kind]) {
      return { enabled: true, ok: true, loaded: false, loading: false, mode: options.mode, via: found.via, path: found.home, sessions: 0, pending: 0, rows: [] };
    }
    if (readers[kind]?.home !== found.home) {
      if (readers[kind]) retired.add(readers[kind]);
      const generation = ++generations[kind];
      const index = adapter.createIndex({
        home: found.home, fold, cacheFile: adapter.cacheFile, logger,
        shouldWrite: () => generations[kind] === generation,
      });
      readers[kind] = {
        kind,
        home: found.home,
        index,
        roster: adapter.createRoster(found.home, index),
        records: adapter.createRecords(found.home, index),
      };
    }
    const reader = readers[kind];
    const pending = rebuild ? reader.index.stale().length : 0;
    if (rebuild && pending) void reader.index.settle().catch(() => {});
    let rows = [];
    if (rebuild) {
      try { rows = reader.roster.rows(); } catch (error) {
        return { enabled: true, ok: false, mode: options.mode, reason: "unreadable", path: found.home, detail: String(error?.message ?? error), sessions: 0, rows: [] };
      }
    }
    return {
      enabled: true, ok: true, loaded: rebuild && pending === 0, loading: rebuild && pending > 0,
      mode: options.mode, via: found.via, path: found.home,
      sessions: rows.length, pending, rows,
    };
  }

  function records(kind, { rebuild = true } = {}) {
    const current = source(kind, { rebuild });
    if (!current.enabled || !current.ok) return { enabled: current.enabled, ok: current.ok, records: [], pending: 0 };
    if (!rebuild) return { enabled: true, ok: true, records: [], pending: 0 };
    const reader = readers[kind];
    try { return { enabled: true, ok: true, records: reader.records.records(), pending: reader.index.stale().length }; }
    catch { return { enabled: true, ok: false, records: [], pending: 0 }; }
  }

  const publicStatus = current => { const { rows, ...status } = current; return status; };
  const statusFields = sources => Object.fromEntries(
    Object.entries(sources).map(([kind, current]) => [`${kind}Status`, publicStatus(current)]),
  );

  async function chats(kind) {
    const current = source(kind);
    if (!current.enabled) return [];
    if (!current.ok) throw new Error(`${adapters[kind].label ?? kind} source unavailable: ${current.reason}`);
    const reader = readers[kind];
    await reader.index.settle();
    if (reader.index.errors().length) throw new Error(`Some ${kind} sessions could not be indexed; check the source logs`);
    const titles = new Map(reader.roster.rows().map(row => [row.sourceId, row.title]));
    return reader.index.refresh().map(chat => ({ ...chat, title: titles.get(chat.id) }));
  }

  async function metadata(sessionId) {
    const kind = kinds().find(name => String(sessionId).startsWith(`${name}:`));
    if (!kind) return null;
    // Resolving settings first prevents a retained reader from making a disabled
    // source readable. A direct read also settles the initial roster race.
    const current = source(kind);
    if (!current.enabled || !current.ok) return null;
    const reader = readers[kind];
    if (!reader) return null;
    await reader.index.settle();
    const sourceId = String(sessionId).slice(kind.length + 1);
    const chat = reader.index.refresh().find(item => item.id === sourceId);
    if (!chat?.path) return null;
    let stats;
    try { stats = statSync(chat.path); } catch { return null; }
    const key = `${kind}:${chat.path}:${stats.size}:${stats.mtimeMs}`;
    const cache = metaCaches[kind];
    const hit = cache.get(key);
    if (hit) return hit;
    const { header, events } = await adapters[kind].load(chat.path);
    const state = createPanelMetadata(sessionId, header);
    for (const event of events) foldPanelEvent(state, event);
    state.readSeq = events.length;
    if (cache.size > 20) cache.delete(cache.keys().next().value);
    cache.set(key, state);
    return state;
  }

  function idle(kind) {
    const previous = [...retired].filter(reader => !kind || reader.kind === kind);
    const current = kind ? [readers[kind]] : Object.values(readers);
    const draining = [...current, ...previous].filter(Boolean);
    // Retired readers still own in-flight I/O. Wait for every one, then forget
    // them; their cache-write guards have already prevented stale-home writes.
    return Promise.all(draining.map(reader => reader.index.idle())).finally(() => {
      for (const reader of previous) retired.delete(reader);
    });
  }

  return { source, records, chats, metadata, statusFields, idle, isImported };
}
