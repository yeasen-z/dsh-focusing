// One record interface for native and imported conversations. Each imported
// SourceAdapter supplies chat summaries and a streaming parser; folding, time
// slicing, reports, Q&A and review all consume the same normalized records.
import { stat } from "node:fs/promises";
import { streamRollout } from "./codex-rollout.mjs";
import { streamSession } from "./claude-code.mjs";
import { foldRecord, summarizeRecord } from "./context-records.mjs";

const DEFAULT_READERS = { codex: streamRollout, claude: streamSession };

function normalizeAdapters(imported, claudeChats) {
  // Backward-compatible form: createContextSource(native, codexChats).
  if (typeof imported === "function" || imported == null || claudeChats) {
    return {
      codex: { chats: imported, stream: streamRollout },
      ...(claudeChats ? { claude: { chats: claudeChats, stream: streamSession } } : {}),
    };
  }
  return imported;
}

export function createContextSource(native, imported, claudeChats) {
  const adapters = normalizeAdapters(imported, claudeChats);
  const cache = new Map();
  const sourceErrors = new Map();
  const kinds = () => Object.keys(adapters);
  const importedKind = id => kinds().find(kind => String(id).startsWith(`${kind}:`));
  const adapter = kind => {
    const value = adapters[kind];
    return typeof value === "function" ? { chats: value, stream: DEFAULT_READERS[kind] } : value;
  };
  const chats = async kind => await adapter(kind)?.chats?.() ?? [];

  async function read(chat, kind) {
    const info = await stat(chat.path);
    const key = `${kind}:${chat.path}:${info.size}:${info.mtimeMs}`;
    if (cache.has(key)) return cache.get(key);
    const events = [];
    const stream = adapter(kind)?.stream ?? DEFAULT_READERS[kind];
    if (!stream) throw new Error(`No transcript reader registered for ${kind}`);
    const header = await stream(chat.path, event => events.push(event));
    const id = `${kind}:${header.id ?? chat.id}`;
    const record = foldRecord(events, { ...header, id, source: kind, readOnly: true });
    record.title = chat.title || record.title;
    if (cache.size >= 20) cache.delete(cache.keys().next().value);
    cache.set(key, record);
    return record;
  }

  async function importedRecords(kind, options) {
    if (options.sources && !options.sources.includes(kind)) return [];
    try {
      const result = await chats(kind);
      sourceErrors.delete(kind);
      return result;
    } catch (error) {
      // One unavailable optional source must not hide healthy sources. Expose
      // the warning alongside the partial result so it is never silent.
      sourceErrors.set(kind, `${kind}: ${String(error?.message ?? error)}`);
      return [];
    }
  }

  async function readImportedEvents(kind, chat, id, signal) {
    const stream = adapter(kind)?.stream ?? DEFAULT_READERS[kind];
    if (!stream) throw new Error(`No transcript reader registered for ${kind}`);
    const events = [];
    const header = await stream(chat.path, event => { signal?.throwIfAborted(); events.push(event); });
    return { header: { ...header, id, source: kind, readOnly: true }, events };
  }

  return {
    errors: () => [...native.errors(), ...sourceErrors.values()],
    async catalog({ signal } = {}) {
      signal?.throwIfAborted();
      const out = native.catalog ? await native.catalog(signal) : [];
      for (const kind of kinds()) {
        for (const chat of await importedRecords(kind, {})) {
          signal?.throwIfAborted();
          out.push({ id: `${kind}:${chat.id}`, source: kind, title: chat.title || chat.firstPrompt || chat.id, cwd: chat.cwd || '', firstPrompt: chat.firstPrompt || '', createdAt: chat.createdAt ?? null, updatedAt: chat.updatedAt ?? null });
        }
      }
      return out.filter(row => row.origin !== 'subagent' && !(row.depth > 0));
    },
    async events(id, { signal } = {}) {
      signal?.throwIfAborted();
      const kind = importedKind(id);
      if (!kind) return native.events(id);
      const chat = (await chats(kind)).find(c => `${kind}:${c.id}` === id);
      if (!chat) return undefined;
      return readImportedEvents(kind, chat, id, signal);
    },
    async eventsReader(sources, signal) {
      const readNative = sources.includes('dsh') ? await native.eventsReader?.(signal) ?? (id => native.events(id)) : null;
      const chatsById = new Map();
      for (const kind of kinds()) {
        for (const chat of await importedRecords(kind, { sources })) chatsById.set(`${kind}:${chat.id}`, { kind, chat });
      }
      return (id) => {
        signal?.throwIfAborted();
        const entry = chatsById.get(id);
        if (entry) return readImportedEvents(entry.kind, entry.chat, id, signal);
        return importedKind(id) ? undefined : readNative?.(id);
      };
    },
    async record(id) {
      const kind = importedKind(id);
      if (!kind) return native.record(id);
      const chat = (await chats(kind)).find(c => `${kind}:${c.id}` === id);
      return chat ? read(chat, kind) : undefined;
    },
    /** Durable per-session timelines + list rows; fold only changed files. */
    async timelines(options = {}) {
      const nativeRows = !options.sources || options.sources.includes("dsh") ? await native.timelines(options) : [];
      const seen = new Set(nativeRows.map(row => row.id));
      const out = nativeRows.slice();
      for (const kind of kinds()) {
        const entries = await importedRecords(kind, options);
        for (const chat of entries) {
          options.signal?.throwIfAborted();
          const id = `${kind}:${chat.id}`;
          if (seen.has(id) || (chat.updatedAt ?? chat.createdAt ?? Infinity) < (options.since ?? 0)) continue;
          seen.add(id);
          let record;
          try { record = await read(chat, kind); }
          catch (error) { sourceErrors.set(kind, `${kind}: ${String(error?.message ?? error)}`); continue; }
          const summary = summarizeRecord(record);
          if (!summary) continue;
          out.push({
            id: record.id,
            depth: record.depth ?? 0,
            origin: record.origin,
            turns: (record.turns ?? []).map(turn => ({
              start: turn.start ?? null, end: turn.end ?? null,
              calls: turn.calls ?? 0, failed: turn.failed ?? 0,
              requests: (turn.requests ?? []).map(request => ({ time: request.time ?? null })),
            })),
            summary,
          });
        }
      }
      return out;
    },
    async records(options = {}) {
      const records = !options.sources || options.sources.includes("dsh") ? await native.records(options) : [];
      const seen = new Set(records.map(record => record.id));
      // Serial reads bound memory and decompression work for large archives.
      for (const kind of kinds()) {
        const entries = await importedRecords(kind, options);
        for (const chat of entries) {
          options.signal?.throwIfAborted();
          const id = `${kind}:${chat.id}`;
          if (seen.has(id) || (chat.updatedAt ?? chat.createdAt ?? Infinity) < (options.since ?? 0)) continue;
          seen.add(id);
          try { records.push(await read(chat, kind)); }
          catch (error) { sourceErrors.set(kind, `${kind}: ${String(error?.message ?? error)}`); }
        }
      }
      return records;
    },
  };
}
