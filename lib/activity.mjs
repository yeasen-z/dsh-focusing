// The activity calendar: how much happened on each day, GitHub-style.
//
// Pure functions over folded records, so DSH and Codex chats are counted by
// the same rule. A day's number is the turns the person got answered that day
// (a turn is one request and the work that followed). Tool calls and the
// sessions that were touched are carried along for the tooltip.

import { localDate } from "./time-range.mjs";

const DAY = 86400000;

function turnTime(turn) {
  return turn.start ?? turn.requests?.[0]?.time ?? turn.end ?? null;
}

/**
 * Per-day totals for the window [from, to] (local dates, inclusive).
 * `groups` is [{ source, records }]; the result also splits each day by source
 * so the grid can say how much came from where.
 */
export function buildActivity(groups, { start, end, offsetMin = 0 }) {
  const days = new Map();
  const sessionsSeen = new Map();
  for (const { source, records } of groups) {
    for (const record of records) {
      for (const turn of record.turns ?? []) {
        const at = turnTime(turn);
        if (at === null || at < start || at >= end) continue;
        const day = localDate(at, offsetMin);
        const entry = days.get(day) ?? { day, turns: 0, calls: 0, sessions: 0, bySource: {} };
        entry.turns += 1;
        entry.calls += turn.calls ?? 0;
        entry.bySource[source] = (entry.bySource[source] ?? 0) + 1;
        const key = `${day}|${record.id}`;
        if (!sessionsSeen.has(key)) { sessionsSeen.set(key, true); entry.sessions += 1; }
        days.set(day, entry);
      }
    }
  }
  return days;
}

/** Every local date from start to end, so quiet days appear as empty squares. */
export function dayRange(start, end, offsetMin = 0) {
  const out = [];
  for (let at = start; at < end; at += DAY) out.push(localDate(at, offsetMin));
  const last = localDate(end - 1, offsetMin);
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/**
 * Bucket counts into 0..4 levels from the busiest day, like GitHub: the scale
 * adapts to the person, so a quiet profile still shows structure.
 */
export function levelOf(count, max) {
  if (!count || count <= 0) return 0;
  if (max <= 4) return Math.min(4, count);
  const ratio = count / max;
  return ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1;
}

/** The calendar payload: every day in the window with its level and split. */
export function activityCalendar(groups, { start, end, offsetMin = 0 }) {
  const counted = buildActivity(groups, { start, end, offsetMin });
  const dates = dayRange(start, end, offsetMin);
  const max = Math.max(0, ...[...counted.values()].map(d => d.turns));
  const days = dates.map(day => {
    const hit = counted.get(day);
    return { day, turns: hit?.turns ?? 0, calls: hit?.calls ?? 0, sessions: hit?.sessions ?? 0, bySource: hit?.bySource ?? {}, level: levelOf(hit?.turns ?? 0, max) };
  });
  const active = days.filter(d => d.turns > 0);
  return {
    days, max,
    total: active.reduce((n, d) => n + d.turns, 0),
    activeDays: active.length,
    longestStreak: longestStreak(days),
    currentStreak: currentStreak(days),
  };
}

function longestStreak(days) {
  let best = 0, run = 0;
  for (const d of days) { run = d.turns > 0 ? run + 1 : 0; best = Math.max(best, run); }
  return best;
}

// A streak is alive if today or yesterday had activity: today may not have started yet.
function currentStreak(days) {
  let i = days.length - 1;
  if (i >= 0 && days[i].turns === 0) i -= 1;
  let run = 0;
  for (; i >= 0 && days[i].turns > 0; i -= 1) run += 1;
  return run;
}
