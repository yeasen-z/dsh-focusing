// Persisted manual analyses, so a result survives reloads and restarts.
//
// One JSON file in the profile directory: { version, reviews: { [sessionId]: Review[] } }
// with the newest review first. Each review remembers `seq`, the session log
// offset it was read at, which is what lets the panel later say how much the
// session has done since (see `trailSince`).
//
// Bounded on purpose: a few analyses per session, a few hundred sessions.

import fs from "node:fs/promises";
import path from "node:path";
import { humanText } from "./panel-data.mjs";

export const PER_SESSION = 10;
export const MAX_SESSIONS = 200;

export function createReviewStore({ file, logger } = {}) {
  /** @type {Map<string, any[]>} */
  let reviews = new Map();
  let writing = Promise.resolve();
  let loading;

  async function read() {
    if (!file) return;
    try {
      const parsed = JSON.parse(await fs.readFile(file, "utf8"));
      for (const [id, list] of Object.entries(parsed?.reviews ?? {})) {
        if (!Array.isArray(list)) continue;
        const valid = list.filter(r => r && typeof r.at === "number" && typeof r.reason === "string");
        if (valid.length) reviews.set(id, valid.slice(0, PER_SESSION));
      }
    } catch (error) {
      if (error?.code !== "ENOENT") logger?.("focusing: could not read saved analyses", error);
    }
  }

  /** Resolves once the file has been read; idempotent. */
  const ready = () => (loading ??= read());

  function persist() {
    if (!file) return Promise.resolve();
    const body = JSON.stringify({ version: 1, reviews: Object.fromEntries(reviews) }, null, 1);
    writing = writing.then(async () => {
      try {
        await fs.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        await fs.writeFile(tmp, body, "utf8");
        await fs.rename(tmp, file);
      } catch (error) {
        logger?.("focusing: could not write saved analyses", error);
      }
    });
    return writing;
  }

  return {
    ready,
    /** Newest-first reviews of one session. Call after `ready()`. */
    list: id => reviews.get(id) ?? [],
    latest: id => reviews.get(id)?.[0] ?? null,
    async add(id, review) {
      await ready();
      reviews.set(id, [review, ...(reviews.get(id) ?? [])].slice(0, PER_SESSION));
      if (reviews.size > MAX_SESSIONS) {
        const oldest = [...reviews.entries()]
          .sort((a, b) => (b[1][0]?.at ?? 0) - (a[1][0]?.at ?? 0))
          .slice(MAX_SESSIONS);
        for (const [key] of oldest) reviews.delete(key);
      }
      await persist();
      return review;
    },
    async remove(id) {
      await ready();
      if (reviews.delete(id)) await persist();
    },
  };
}

/**
 * What the session did after a review read it. `fromSeq` is the log offset the
 * review captured: events with `seq >= fromSeq` are newer than the review.
 * Pure, so it is testable on a plain array.
 */
export function trailSince(events, fromSeq) {
  const trail = { events: 0, toolCalls: 0, failures: 0, userMessages: 0, turns: 0, lastAt: null };
  const failed = new Set();
  const calls = new Set();
  for (const event of events ?? []) {
    if (!event || !(Number(event.seq) >= fromSeq)) continue;
    trail.events += 1;
    if (Number.isFinite(event.time)) trail.lastAt = Math.max(trail.lastAt ?? 0, event.time);
    const data = event.data ?? {};
    if (event.type === "tool/call") {
      trail.toolCalls += 1;
      calls.add(data.callId);
    } else if (event.type === "tool/result") {
      const message = data.message;
      const id = message?.toolCallId ?? message?.source?.callId;
      const text = Array.isArray(message?.content)
        ? message.content.filter(b => b?.type === "text").map(b => b.text).join("\n")
        : "";
      if (calls.has(id) && (message?.isError === true || data.error !== undefined || /\[exit code:\s*-?(?!0\b)\d+\]/i.test(text))) {
        if (!failed.has(id)) trail.failures += 1;
        failed.add(id);
      }
    } else if (event.type === "user/message") {
      if (humanText(data)) trail.userMessages += 1;
    } else if (event.type === "turn/start") {
      trail.turns += 1;
    }
  }
  // "Moved on" means the work itself changed, not just housekeeping events.
  trail.moved = trail.toolCalls > 0 || trail.userMessages > 0 || trail.turns > 0;
  return trail;
}
