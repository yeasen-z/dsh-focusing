// Codex chat summaries, read once and kept.
//
// Decompressing and folding a rollout is the expensive part (about 15 ms each,
// and most of the ~150 chats are zstd-compressed). The roster and the activity
// calendar both need only a few facts from each chat, so this module keeps
// those facts -- never the full events -- and reuses them until the rollout
// file changes. The summaries are also written to the profile directory, so a
// Host restart does not start from scratch.
//
// Key: the file path plus its size and mtime. A finished rollout never changes,
// so after the first read every later one is a stat() and a map lookup.

import { readFileSync, writeFileSync, mkdirSync, statSync, renameSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { loadRollout, streamRollout, listRolloutFiles } from "./codex-rollout.mjs";

const VERSION = 1;

/** Facts the roster and calendar need, folded from one rollout. */
export function summarize(header, events, fold) {
  const record = fold(events, header);
  const users = events.filter(e => e.type === "user/message");
  const first = users[0]?.data?.content?.[0]?.text ?? "";
  const last = events.reduce((m, e) => (Number.isFinite(e.time) ? Math.max(m, e.time) : m), 0);
  return {
    id: header.id,
    cwd: header.cwd ?? "",
    createdAt: header.createdAt ?? null,
    updatedAt: last || null,
    firstPrompt: first.replace(/\s+/g, " ").slice(0, 100),
    turns: events.filter(e => e.type === "turn/start").length,
    userMessages: users.length,
    // Per turn: when it started and how many tool calls it made, for the calendar.
    // Kept small: only what the day counts need.
    dayTurns: (record.turns ?? []).map(t => ({
      at: t.start ?? t.requests?.[0]?.time ?? t.end ?? null,
      calls: t.calls ?? 0,
      requests: t.requests?.length ?? 0,
    })),
    personal: fold && (record.turns ?? []).some(t => t.requests?.length > 0),
  };
}

// The events a summary needs. Tool results are not among them: dropping them
// changes no summary field (checked on every real chat), and they are most of
// a rollout's events.
const SUMMARY_EVENTS = new Set(["session_meta", "user/message", "assistant/message", "tool/call", "turn/start", "turn/end"]);

/**
 * Summarise one rollout by streaming it: only the events a summary needs are
 * kept, so memory grows with the number of turns, not with the output text.
 */
export async function summarizeFile(path, fold) {
  const kept = [];
  const header = await streamRollout(path, e => { if (SUMMARY_EVENTS.has(e.type)) kept.push(e); });
  return header.id ? summarize(header, kept, fold) : null;
}

/**
 * The shared index. `fold` is the record fold (passed in to keep this module
 * free of DSH internals). `cacheFile` is optional: without it the index lives
 * for the process only.
 */
/**
 * Recent chats are loaded in full when they are analysed; older ones stay
 * compressed and are only read when the person opens them. "Recent" is by the
 * chat's last activity, against a window in days.
 */
export function isRecent(updatedAt, { now = Date.now(), days = 30 } = {}) {
  if (!Number.isFinite(updatedAt)) return false;
  return now - updatedAt <= days * 86400000;
}

export function createCodexIndex({ home, fold, cacheFile, logger } = {}) {
  let entries = new Map(); // path -> { key, summary, archived }
  let loaded = false;

  function loadCache() {
    if (loaded) return;
    loaded = true;
    if (!cacheFile || !existsSync(cacheFile)) return;
    try {
      const raw = JSON.parse(readFileSync(cacheFile, "utf8"));
      if (raw?.version !== VERSION || raw.home !== home) return;
      entries = new Map(Object.entries(raw.entries ?? {}));
    } catch (error) {
      logger?.("focusing: codex index cache unreadable; rebuilding", error);
    }
  }

  function saveCache() {
    if (!cacheFile) return;
    try {
      mkdirSync(dirname(cacheFile), { recursive: true });
      const tmp = `${cacheFile}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: VERSION, home, entries: Object.fromEntries(entries) }));
      renameSync(tmp, cacheFile);
    } catch (error) {
      logger?.("focusing: could not save codex index", error);
    }
  }

  /**
   * Every chat's summary, from the cache, without waiting on disk. A chat whose
   * file changed (or is new) is reported by `stale()` and rebuilt by `settle()`.
   * The roster and calendar call this on every poll, so it never decompresses.
   */
  function refresh() {
    loadCache();
    const out = [];
    for (const file of listRolloutFiles(home)) {
      const hit = entries.get(file.path);
      if (hit?.summary) out.push({ ...hit.summary, archived: file.archived, path: file.path });
    }
    return out;
  }

  /** Chats whose cached summary is missing or older than the file on disk. */
  function stale() {
    loadCache();
    const todo = [];
    for (const file of listRolloutFiles(home)) {
      let stats;
      try { stats = statSync(file.path); } catch { continue; }
      const key = `${stats.size}:${stats.mtimeMs}`;
      const hit = entries.get(file.path);
      if (!hit || hit.key !== key) todo.push({ ...file, key });
    }
    return todo;
  }

  /**
   * Rebuild the stale summaries one file at a time, streaming each. Runs in the
   * background; a file that fails is logged and skipped, not retried in a loop.
   */
  let settling = null;
  async function settle() {
    if (settling) return settling;
    settling = (async () => {
      let dirty = false;
      for (const file of stale()) {
        try {
          const summary = await summarizeFile(file.path, fold);
          entries.set(file.path, { key: file.key, archived: file.archived, summary });
          dirty = true;
        } catch (error) {
          logger?.("focusing: codex chat unreadable", file.path, error);
          entries.set(file.path, { key: file.key, archived: file.archived, summary: null });
        }
      }
      const live = new Set(listRolloutFiles(home).map(f => f.path));
      for (const path of [...entries.keys()]) if (!live.has(path)) { entries.delete(path); dirty = true; }
      if (dirty) saveCache();
    })().finally(() => { settling = null; });
    return settling;
  }

  // idle() resolves once no background rebuild is running. The roster never
  // needs it; tests and shutdown use it so nothing writes after its folder is gone.
  const idle = () => settling ?? Promise.resolve();

  function errors() {
    loadCache();
    return listRolloutFiles(home).filter(file => entries.get(file.path)?.summary === null).map(file => file.path);
  }
  return { refresh, stale, settle, idle, errors };
}
