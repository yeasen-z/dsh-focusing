// Shared incremental index for file-backed coding-agent transcripts.
//
// A source adapter supplies file discovery and a streaming parser. This module
// owns only the durable summary cache: path + size + mtime identifies a file
// revision, and parser/cache versions invalidate old semantics after upgrade.

import { readFileSync, writeFileSync, mkdirSync, statSync, renameSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { sessionTags } from "./session-tags.mjs";

// Summary indexing keeps these events; large tool results are deliberately not
// held in memory because no roster/calendar field depends on them.
const SUMMARY_EVENTS = new Set(["session_meta", "user/message", "assistant/message", "tool/call", "turn/start", "turn/end"]);

/** Facts the roster, records list and activity calendar need from one chat. */
export function summarize(header, events, fold) {
  const record = fold(events, header);
  const users = events.filter(e => e.type === "user/message");
  const first = users[0]?.data?.content?.[0]?.text ?? "";
  const last = events.reduce((m, e) => (Number.isFinite(e.time) ? Math.max(m, e.time) : m), 0);
  return {
    id: header.id,
    title: header.title ?? "",
    cwd: header.cwd ?? "",
    createdAt: header.createdAt ?? null,
    updatedAt: last || null,
    firstPrompt: first.replace(/\s+/g, " ").slice(0, 100),
    turns: events.filter(e => e.type === "turn/start").length,
    userMessages: users.length,
    dayTurns: (record.turns ?? []).map(t => ({
      at: t.start ?? t.requests?.[0]?.time ?? t.end ?? null,
      calls: t.calls ?? 0,
      requests: t.requests?.length ?? 0,
    })),
    personal: fold && (record.turns ?? []).some(t => t.requests?.length > 0),
  };
}

/** Stream one file and retain only the small events needed by summarize(). */
export async function summarizeTranscriptFile(path, fold, streamFile) {
  const kept = [];
  const header = await streamFile(path, e => { if (SUMMARY_EVENTS.has(e.type)) kept.push(e); });
  // Deliberately omitted records are cached separately from unreadable files.
  if (header.excluded) return { excluded: true };
  return header.id ? summarize(header, kept, fold) : null;
}

export function isRecent(updatedAt, { now = Date.now(), days = 30 } = {}) {
  if (!Number.isFinite(updatedAt)) return false;
  return now - updatedAt <= days * 86400000;
}

/**
 * Create one per-source index. `listFiles(home)` returns {path, archived?};
 * `streamFile(path, onEvent)` returns the normalized session header.
 */
export function createTranscriptIndex({
  home, fold, cacheFile, logger, listFiles, streamFile,
  source = "transcript", version = 1, shouldWrite = () => true,
} = {}) {
  if (typeof listFiles !== "function" || typeof streamFile !== "function") {
    throw new Error("A transcript index needs file discovery and a streaming parser");
  }
  let entries = new Map(); // path -> { key, summary, archived }
  let loaded = false;

  function loadCache() {
    if (loaded) return;
    loaded = true;
    if (!cacheFile || !existsSync(cacheFile)) return;
    try {
      const raw = JSON.parse(readFileSync(cacheFile, "utf8"));
      if (raw?.version !== version || (raw.source !== undefined && raw.source !== source) || raw.home !== home) return;
      entries = new Map(Object.entries(raw.entries ?? {}));
    } catch (error) {
      logger?.(`focusing: ${source} index cache unreadable; rebuilding`, error);
    }
  }

  function saveCache() {
    // A retired home/generation may finish parsing after its replacement. It
    // may drain that work, but must not overwrite the newer home's cache.
    if (!cacheFile || shouldWrite() === false) return;
    try {
      mkdirSync(dirname(cacheFile), { recursive: true });
      const tmp = `${cacheFile}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version, source, home, entries: Object.fromEntries(entries) }));
      renameSync(tmp, cacheFile);
    } catch (error) {
      logger?.(`focusing: could not save ${source} index`, error);
    }
  }

  /** Cached summaries only; stale/missing files are rebuilt by settle(). */
  function refresh() {
    loadCache();
    const out = [];
    for (const file of listFiles(home)) {
      const hit = entries.get(file.path);
      if (hit?.summary && !hit.summary.excluded) out.push({
        ...hit.summary,
        tags: hit.summary.tags ?? sessionTags({ ...hit.summary, source }),
        archived: file.archived,
        path: file.path,
      });
    }
    return out;
  }

  function stale() {
    loadCache();
    const todo = [];
    for (const file of listFiles(home)) {
      let stats;
      try { stats = statSync(file.path); } catch { continue; }
      const key = `${stats.size}:${stats.mtimeMs}`;
      const hit = entries.get(file.path);
      if (!hit || hit.key !== key) todo.push({ ...file, key });
    }
    return todo;
  }

  let settling = null;
  async function settle() {
    if (settling) return settling;
    settling = (async () => {
      let dirty = false;
      for (const file of stale()) {
        try {
          const summary = await summarizeTranscriptFile(file.path, fold, streamFile);
          entries.set(file.path, { key: file.key, archived: file.archived, summary });
          dirty = true;
        } catch (error) {
          logger?.(`focusing: ${source} chat unreadable`, file.path, error);
          entries.set(file.path, { key: file.key, archived: file.archived, summary: null });
        }
      }
      const live = new Set(listFiles(home).map(f => f.path));
      for (const path of [...entries.keys()]) if (!live.has(path)) { entries.delete(path); dirty = true; }
      if (dirty) saveCache();
    })().finally(() => { settling = null; });
    return settling;
  }

  const idle = () => settling ?? Promise.resolve();

  function errors() {
    loadCache();
    return listFiles(home).filter(file => entries.get(file.path)?.summary === null).map(file => file.path);
  }
  return { refresh, stale, settle, idle, errors };
}
