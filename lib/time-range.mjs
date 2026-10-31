// Time ranges for context work: "this week", "yesterday", "last 7 days".
//
// Pure functions. The Client sends its UTC offset (minutes east of UTC, i.e.
// `-new Date().getTimezoneOffset()`), so "today" means the person's today even
// when the Host runs in another zone.

const DAY = 86400000;

export const RANGE_KEYS = ["today", "yesterday", "this-week", "last-week", "last-7d", "this-month", "last-30d", "all"];

const LABELS = {
  zh: {
    today: "今天", yesterday: "昨天", "this-week": "本周", "last-week": "上周",
    "last-7d": "最近 7 天", "this-month": "本月", "last-30d": "最近 30 天", all: "全部",
  },
  en: {
    today: "Today", yesterday: "Yesterday", "this-week": "This week", "last-week": "Last week",
    "last-7d": "Last 7 days", "this-month": "This month", "last-30d": "Last 30 days", all: "All",
  },
};

/** Start of the local day containing `at`, as a UTC epoch. */
function startOfDay(at, offsetMin) {
  const shift = offsetMin * 60000;
  return Math.floor((at + shift) / DAY) * DAY - shift;
}

/** Local calendar fields of an instant. */
export function localParts(at, offsetMin = 0) {
  const d = new Date(at + offsetMin * 60000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay() };
}

/** "2026-10-27" in the person's zone. */
export function localDate(at, offsetMin = 0) {
  const p = localParts(at, offsetMin);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * Resolve a named range to [start, end). Weeks start on Monday.
 * Unknown keys fall back to `this-week`.
 */
export function resolveRange(key, { now = Date.now(), offsetMin = 0, locale = "zh" } = {}) {
  const k = RANGE_KEYS.includes(key) ? key : "this-week";
  const today = startOfDay(now, offsetMin);
  const weekday = (localParts(now, offsetMin).weekday + 6) % 7; // Monday = 0
  let start;
  let end = now;
  switch (k) {
    case "today": start = today; break;
    case "yesterday": start = today - DAY; end = today; break;
    case "this-week": start = today - weekday * DAY; break;
    case "last-week": start = today - (weekday + 7) * DAY; end = today - weekday * DAY; break;
    case "last-7d": start = today - 6 * DAY; break;
    case "this-month": start = today - (localParts(now, offsetMin).day - 1) * DAY; break;
    case "last-30d": start = today - 29 * DAY; break;
    case "all": start = 0; break;
  }
  const labels = LABELS[locale] ?? LABELS.zh;
  return {
    key: k, start, end, offsetMin,
    label: labels[k],
    // All time has no first day; "…" says so instead of inventing 1970.
    from: k === "all" ? "…" : localDate(start, offsetMin),
    to: localDate(Math.max(start, end - 1), offsetMin),
  };
}

/**
 * Guess the range a request is about from its words. Returns undefined when
 * the request names no time, so the caller keeps the person's selection.
 */
export function inferRangeKey(text) {
  const s = String(text ?? "").toLowerCase();
  if (/今天|今日|today/.test(s)) return "today";
  if (/昨天|昨日|yesterday/.test(s)) return "yesterday";
  if (/上周|上个星期|上星期|last week/.test(s)) return "last-week";
  if (/本周|这周|这个星期|这星期|本星期|this week|周报|weekly/.test(s)) return "this-week";
  if (/本月|这个月|this month|月报|monthly/.test(s)) return "this-month";
  if (/(最近|过去|近)\s*(30|三十)\s*天|last 30 days/.test(s)) return "last-30d";
  if (/(最近|过去|近)\s*(7|七)\s*天|last 7 days|past week/.test(s)) return "last-7d";
  if (/全部|所有|所有记录|all time|everything|entire history/.test(s)) return "all";
  return undefined;
}

/** Enumerate local dates in a range, oldest first. */
export function daysOf(range) {
  const out = [];
  for (let at = range.start; at < range.end; at += DAY) out.push(localDate(at, range.offsetMin));
  return out;
}
