// Record index: list every session the Host knows (live and stored), fold each
// into a context record once, and reuse the fold until the session changes.
//
// Change detection:
//   live    -> the in-memory event count (`session.seq`)
//   stored  -> the persistence revision (a stat-derived token)
// A stored revision also tells us when the file was last written, which lets a
// "this week" request skip months-old sessions without decompressing them.

import { foldRecord, summarizeRecord } from "./context-records.mjs";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";

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
export function createRecordIndex(services, { activityFile, summaryFile, logger } = {}) {
  const cache = new Map(); // id -> { key, record }
  let lastErrors = [];
  let activityCache;
  const activityRecord = record => ({
    id: record.id,
    depth: record.depth,
    origin: record.origin,
    turns: (record.turns ?? []).map(turn => ({
      start: turn.start ?? null,
      end: turn.end ?? null,
      calls: turn.calls ?? 0,
      failed: turn.failed ?? 0,
      requests: (turn.requests ?? []).map(request => ({ time: request.time ?? null })),
    })),
  });
  function loadActivity() {
    if (activityCache) return activityCache;
    try {
      const data = JSON.parse(readFileSync(activityFile, "utf8"));
      activityCache = data.version === 1 && data.entries && typeof data.entries === "object" ? data.entries : {};
    } catch { activityCache = {}; }
    return activityCache;
  }
  // The list row the records page shows, kept in its own file: the calendar
  // cache stays free of conversation text, and this one is rebuilt only for
  // sessions whose file changed.
  let summaryCache;
  // Default next to the activity cache, so a caller that only knows about one
  // file still gets the durable list rows.
  const summariesFile = summaryFile ?? (activityFile ? activityFile.replace(/\.json$/, ".records.json") : undefined);
  function loadSummaries() {
    if (summaryCache) return summaryCache;
    try {
      const data = JSON.parse(readFileSync(summariesFile, "utf8"));
      summaryCache = data.version === 1 && data.entries && typeof data.entries === "object" ? data.entries : {};
    } catch { summaryCache = {}; }
    return summaryCache;
  }
  function saveSummaries() {
    if (!summariesFile) return;
    try {
      mkdirSync(dirname(summariesFile), { recursive: true });
      const temporary = `${summariesFile}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify({ version: 1, entries: summaryCache }));
      renameSync(temporary, summariesFile);
    } catch (error) { logger?.("focusing: could not save record summaries", error); }
  }

  function saveActivity() {
    if (!activityFile) return;
    try {
      mkdirSync(dirname(activityFile), { recursive: true });
      const temporary = `${activityFile}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify({ version: 1, entries: activityCache }));
      renameSync(temporary, activityFile);
    } catch (error) { logger?.("focusing: could not save activity index", error); }
  }

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

  async function activityRecords({ since = 0, signal } = {}) {
    lastErrors = [];
    const entries = await catalog(signal);
    const saved = loadActivity();
    const summaries = loadSummaries();
    let dirty = false;
    let dirtySummary = false;
    const wanted = entries.filter(e => e.mtime === undefined || e.mtime >= since || (e.header.createdAt ?? 0) >= since);
    const results = await limited(wanted, READ_CONCURRENCY, async entry => {
      signal?.throwIfAborted?.();
      const hit = saved[entry.id];
      const cachedSummary = summaries[entry.id];
      const summaryFresh = !summariesFile || (cachedSummary?.key === entry.key
        && (cachedSummary.summary === null || cachedSummary.summary?.id === entry.id));
      if (hit?.key === entry.key && hit.record?.id === entry.id && Array.isArray(hit.record.turns) && summaryFresh) return hit.record;
      const folded = cache.get(entry.id);
      const record = folded?.key === entry.key ? folded.record : foldRecord(await readEvents(entry), { ...entry.header, id: entry.id });
      saved[entry.id] = { key: entry.key, record: activityRecord(record) };
      // A session with nothing to list stores null, so it is not refolded on
      // every visit just because it has no row.
      summaries[entry.id] = { key: entry.key, summary: summarizeRecord(record) ?? null };
      dirty = true;
      dirtySummary = true;
      return saved[entry.id].record;
    });
    const current = new Set(entries.map(e => e.id));
    for (const id of Object.keys(saved)) if (!current.has(id)) { delete saved[id]; dirty = true; }
    for (const id of Object.keys(summaries)) if (!current.has(id)) { delete summaries[id]; dirtySummary = true; }
    if (dirty) saveActivity();
    if (dirtySummary) saveSummaries();
    const out = [];
    for (const result of results) {
      if (result?.error) lastErrors.push(String(result.error?.message ?? result.error).slice(0, 200));
      else if (result) out.push(result);
    }
    return out;
  }

  return {
    records,
    activityRecords,
    /** [{ id, turns, summary }] for the records list, no transcript reads. */
    async timelines(options = {}) {
      const list = await activityRecords(options);
      const summaries = loadSummaries();
      return list.map(entry => ({ ...entry, summary: summaries[entry.id]?.summary })).filter(entry => entry.summary);
    },
    async events(id) {
      const entry = (await catalog()).find(e => e.id === id);
      if (!entry) return undefined;
      return { header: entry.header, events: await readEvents(entry) };
    },
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
