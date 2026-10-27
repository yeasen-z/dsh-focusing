// Record index: list every session the Host knows (live and stored), fold each
// into a context record once, and reuse the fold until the session changes.
//
// Change detection:
//   live    -> the in-memory event count (`session.seq`)
//   stored  -> the persistence revision (a stat-derived token)
// A stored revision also tells us when the file was last written, which lets a
// "this week" request skip months-old sessions without decompressing them.

import { foldRecord } from "./context-records.mjs";

const READ_CONCURRENCY = 4;

/** mtime (ms) encoded in a jsonl persistence revision "dev:ino:size:mtimeNs:ctimeNs". */
export function revisionMtime(revision) {
  const parts = String(revision ?? "").split(":");
  if (parts.length < 5) return undefined;
  const ns = parts[3];
  if (!/^\d{13,}$/.test(ns)) return undefined;
  return Number(BigInt(ns) / 1000000n);
}

async function limited(items, limit, task) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = await task(items[i], i); } catch (error) { out[i] = { error }; }
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * @param {() => {sessions?:any, persistence?:any, query?:any, titles?:any}} services
 */
export function createRecordIndex(services) {
  const cache = new Map(); // id -> { key, record }
  let lastErrors = [];

  /** Every known session as { id, header, key, mtime, live }. */
  async function catalog(signal) {
    const { sessions, persistence, query } = services();
    const byId = new Map();
    if (persistence?.list) {
      try {
        for (const snap of await persistence.list(signal ? { signal } : undefined)) {
          if (!snap?.header?.id) continue;
          byId.set(snap.header.id, {
            id: snap.header.id, header: snap.header, key: `p:${snap.revision ?? ""}`,
            mtime: revisionMtime(snap.revision), live: false,
          });
        }
      } catch (error) {
        lastErrors.push(String(error?.message ?? error));
      }
    } else if (query?.listSessions) {
      try {
        for (const rec of await query.listSessions(signal)) {
          byId.set(rec.header.id, { id: rec.header.id, header: rec.header, key: `q:${rec.header.createdAt}`, mtime: undefined, live: false });
        }
      } catch (error) {
        lastErrors.push(String(error?.message ?? error));
      }
    }
    for (const live of sessions?.list?.() ?? []) {
      byId.set(live.id, { id: live.id, header: live.header ?? byId.get(live.id)?.header ?? {}, key: `l:${live.seq}`, mtime: Date.now(), live: true, session: live });
    }
    return [...byId.values()];
  }

  async function readEvents(entry) {
    if (entry.session) return entry.session.snapshotEvents(0, Number(entry.session.seq));
    const { query } = services();
    if (!query?.readSession) throw new Error("session query service unavailable");
    const snapshot = await query.readSession(entry.id);
    return snapshot.events;
  }

  /**
   * Records touched at or after `since` (ms). Sessions whose storage was last
   * written before `since` are skipped without reading.
   */
  async function records({ since = 0, signal } = {}) {
    lastErrors = [];
    const entries = await catalog(signal);
    const wanted = entries.filter(e => e.mtime === undefined || e.mtime >= since || (e.header.createdAt ?? 0) >= since);
    const results = await limited(wanted, READ_CONCURRENCY, async (entry) => {
      signal?.throwIfAborted?.();
      const hit = cache.get(entry.id);
      if (hit && hit.key === entry.key) return hit.record;
      const events = await readEvents(entry);
      const record = foldRecord(events, { ...entry.header, id: entry.id });
      record.live = entry.live;
      cache.set(entry.id, { key: entry.key, record });
      return record;
    });
    const out = [];
    for (const r of results) {
      if (r?.error) lastErrors.push(String(r.error?.message ?? r.error).slice(0, 200));
      else if (r) out.push(r);
    }
    return out;
  }

  return {
    records,
    errors: () => lastErrors.slice(0, 5),
    cached: id => cache.get(id)?.record,
    async record(id) {
      const entries = await catalog();
      const entry = entries.find(e => e.id === id);
      if (!entry) return undefined;
      const hit = cache.get(id);
      if (hit && hit.key === entry.key) return hit.record;
      const record = foldRecord(await readEvents(entry), { ...entry.header, id });
      record.live = entry.live;
      cache.set(id, { key: entry.key, record });
      return record;
    },
  };
}
