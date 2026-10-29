// One record interface for native and imported conversations.
import { stat } from "node:fs/promises";
import { streamRollout } from "./codex-rollout.mjs";
import { foldRecord } from "./context-records.mjs";

export function createContextSource(native, external) {
  const cache = new Map();
  async function read(chat) {
    const info = await stat(chat.path);
    const key = `${chat.path}:${info.size}:${info.mtimeMs}`;
    if (cache.has(key)) return cache.get(key);
    const events = [];
    const header = await streamRollout(chat.path, event => events.push(event));
    const record = foldRecord(events, { ...header, id: `codex:${header.id}`, source: "codex", readOnly: true });
    record.title = chat.title || record.title;
    if (cache.size >= 20) cache.delete(cache.keys().next().value);
    cache.set(key, record);
    return record;
  }
  return {
    errors: () => native.errors(),
    async events(id, { signal } = {}) {
      signal?.throwIfAborted();
      if (!id.startsWith("codex:")) return native.events(id);
      const chat = (await external?.() ?? []).find(c => `codex:${c.id}` === id);
      if (!chat) return undefined;
      const events = [];
      const header = await streamRollout(chat.path, event => { signal?.throwIfAborted(); events.push(event); });
      return { header: { ...header, id, source: "codex" }, events };
    },
    async record(id) {
      if (!id.startsWith("codex:")) return native.record(id);
      const chats = await external?.() ?? [];
      const chat = chats.find(c => `codex:${c.id}` === id);
      return chat ? read(chat) : undefined;
    },
    async records(options = {}) {
      const records = !options.sources || options.sources.includes('dsh') ? await native.records(options) : [];
      const chats = !options.sources || options.sources.includes('codex') ? await external?.() ?? [] : [];
      const seen = new Set();
      // Serial reads bound memory and decompression work for large archives.
      for (const chat of chats) {
        options.signal?.throwIfAborted();
        if (seen.has(chat.id) || (chat.updatedAt ?? chat.createdAt ?? Infinity) < (options.since ?? 0)) continue;
        seen.add(chat.id);
        records.push(await read(chat));
      }
      return records;
    },
  };
}
