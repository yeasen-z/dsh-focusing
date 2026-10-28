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
import { readRollout, listRolloutFiles } from "./codex-rollout.mjs";

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

/**
 * The shared index. `fold` is the record fold (passed in to keep this module
 * free of DSH internals). `cacheFile` is optional: without it the index lives
 * for the process only.
 */
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

  /** Every chat's summary; decompresses only the files that changed. */
  function refresh() {
    loadCache();
    const files = listRolloutFiles(home);
    const seen = new Set();
    let dirty = false;
    const out = [];
    for (const file of files) {
      let stats;
      try { stats = statSync(file.path); } catch { continue; }
      const key = `${stats.size}:${stats.mtimeMs}`;
      seen.add(file.path);
      let hit = entries.get(file.path);
      if (!hit || hit.key !== key) {
        try {
          const { header, events } = readRollout(file.path);
          hit = { key, archived: file.archived, summary: header.id ? summarize(header, events, fold) : null };
          entries.set(file.path, hit);
          dirty = true;
        } catch (error) {
          logger?.("focusing: codex chat unreadable", file.path, error);
          continue;
        }
      }
      if (hit.summary) out.push({ ...hit.summary, archived: file.archived, path: file.path });
    }
    for (const path of [...entries.keys()]) if (!seen.has(path)) { entries.delete(path); dirty = true; }
    if (dirty) saveCache();
    return out;
  }

  return { refresh };
}
