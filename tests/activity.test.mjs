// The activity calendar counts answered turns per day -- the same rule for DSH
// and Codex chats -- and buckets them into GitHub-style levels.
import test from "node:test";
import assert from "node:assert/strict";
import { buildActivity, activityCalendar, dayRange, levelOf } from "../lib/activity.mjs";

const DAY = 86400000;
const at = (iso) => Date.parse(iso);
const turn = (iso, calls = 0) => ({ start: at(iso), end: at(iso) + 1000, requests: [{ time: at(iso), text: "x" }], calls });
const window = { start: at("2026-10-20T00:00:00Z"), end: at("2026-10-28T00:00:00Z"), offsetMin: 0 };

test("a day's number is the turns answered that day, with calls and sessions alongside", () => {
  const records = [
    { id: "a", turns: [turn("2026-10-26T01:00:00Z", 3), turn("2026-10-26T05:00:00Z", 2), turn("2026-10-27T01:00:00Z")] },
    { id: "b", turns: [turn("2026-10-26T09:00:00Z", 4)] },
  ];
  const days = buildActivity([{ source: "dsh", records }], window);
  assert.deepEqual([days.get("2026-10-26").turns, days.get("2026-10-26").calls, days.get("2026-10-26").sessions], [3, 9, 2]);
  assert.equal(days.get("2026-10-27").turns, 1);
  assert.equal(days.has("2026-10-25"), false, "quiet days are absent from the counts");
});

test("turns outside the window are not counted", () => {
  const records = [{ id: "a", turns: [turn("2026-10-19T23:00:00Z"), turn("2026-10-28T01:00:00Z"), turn("2026-10-21T01:00:00Z")] }];
  const days = buildActivity([{ source: "dsh", records }], window);
  assert.deepEqual([...days.keys()], ["2026-10-21"]);
});

test("the person's own time zone decides which day a turn belongs to", () => {
  const records = [{ id: "a", turns: [turn("2026-10-26T20:30:00Z")] }];
  const utc = buildActivity([{ source: "dsh", records }], window);
  const shanghai = buildActivity([{ source: "dsh", records }], { ...window, offsetMin: 480 });
  assert.ok(utc.has("2026-10-26"));
  assert.ok(shanghai.has("2026-10-27"), "04:30 the next morning in UTC+8");
});

test("each source is counted separately, and together for the day's number", () => {
  const dsh = [{ id: "a", turns: [turn("2026-10-26T01:00:00Z")] }];
  const codex = [{ id: "codex:z", turns: [turn("2026-10-26T02:00:00Z"), turn("2026-10-26T03:00:00Z")] }];
  const days = buildActivity([{ source: "dsh", records: dsh }, { source: "codex", records: codex }], window);
  assert.deepEqual(days.get("2026-10-26").bySource, { dsh: 1, codex: 2 });
  assert.equal(days.get("2026-10-26").turns, 3);
});

test("the calendar lists every day, including empty ones, and totals them", () => {
  const records = [{ id: "a", turns: [turn("2026-10-21T01:00:00Z"), turn("2026-10-22T01:00:00Z"), turn("2026-10-27T01:00:00Z")] }];
  const cal = activityCalendar([{ source: "dsh", records }], window);
  assert.equal(cal.days.length, 8, "Oct 20 through Oct 27");
  assert.equal(cal.days[0].day, "2026-10-20");
  assert.equal(cal.days[0].level, 0, "an empty day is level 0");
  assert.equal(cal.total, 3);
  assert.equal(cal.activeDays, 3);
  assert.equal(cal.longestStreak, 2, "Oct 21-22");
  assert.equal(cal.currentStreak, 1, "Oct 27 is the last day with activity");
});

test("a streak stays alive while today has not started yet, but not past a full empty day", () => {
  const records = [{ id: "a", turns: [turn("2026-10-25T01:00:00Z"), turn("2026-10-26T01:00:00Z")] }];
  // The window ends on Oct 26: its last day is the active one.
  const active = activityCalendar([{ source: "dsh", records }], { ...window, end: at("2026-10-26T12:00:00Z") });
  assert.equal(active.currentStreak, 2);
  // Ends on Oct 27: today (Oct 27) is empty, yesterday was active -- still alive.
  const todayEmpty = activityCalendar([{ source: "dsh", records }], { ...window, end: at("2026-10-27T12:00:00Z") });
  assert.equal(todayEmpty.days.at(-1).turns, 0);
  assert.equal(todayEmpty.currentStreak, 2, "only today is empty, so the run before it stands");
  // Ends on Oct 28: yesterday and today are both empty -- the run is over.
  const over = activityCalendar([{ source: "dsh", records }], { ...window, end: at("2026-10-28T12:00:00Z") });
  assert.equal(over.currentStreak, 0);
});

test("levels scale to the busiest day; small numbers keep their own steps", () => {
  assert.equal(levelOf(0, 10), 0);
  assert.deepEqual([1, 2, 3, 4].map(n => levelOf(n, 4)), [1, 2, 3, 4], "a quiet profile still shows structure");
  assert.deepEqual([2, 6, 11, 20].map(n => levelOf(n, 20)), [1, 2, 3, 4]);
  assert.equal(levelOf(20, 20), 4);
});

test("dayRange covers each date once", () => {
  const days = dayRange(window.start, window.end, 0);
  assert.equal(new Set(days).size, days.length);
  assert.equal(days[0], "2026-10-20");
});
