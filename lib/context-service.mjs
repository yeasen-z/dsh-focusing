// Host-independent context queries. Callers supply a unified ContextSource, a
// native activity index and optional Host presentation capabilities. No HTTP,
// Cordis or DSH service lookup occurs here.

import { isPersonal, sliceRecord } from "./context-records.mjs";
import { localDate } from "./time-range.mjs";
import { activityCalendar } from "./activity.mjs";
import { matchesTags, normalizeTagScope } from "./session-tags.mjs";

export function createContextService({
  source, index, importedRecords = {}, sourceLabels = {}, settingsStore,
  titleOf = record => record.title || record.fallbackTitle || "",
  isLive = () => false,
  now = () => Date.now(),
} = {}) {
  if (!source || !index) throw new Error("Context queries need a source and native index");

  /** Records sliced to a range, filtered to things the person did. */
  async function slicesFor(range, { project, query, session, ids, tags = [] } = {}) {
    const requiredTags = normalizeTagScope(tags);
    const records = ids ? await Promise.all(ids.map(async id => {
      const record = await source.record(id);
      if (!record) throw new Error(`Source session unavailable: ${id}`);
      return record;
    })) : session
      ? [await source.record(session)].filter(Boolean)
      : await source.records({ since: range.start });
    if (session && !records.length) throw new Error("Session is unavailable or its source is disabled");
    const slices = [];
    for (const record of records) {
      if (!session && !isPersonal(record)) continue;
      if (!matchesTags(record, requiredTags)) continue;
      if (project && record.project !== project) continue;
      const slice = sliceRecord(record, range, at => localDate(at, range.offsetMin));
      if (!slice) continue;
      slice.title = titleOf(record) || slice.title;
      slice.running = isLive(record.id) && record.open;
      if (query) {
        const hay = `${slice.title}\n${slice.project}\n${slice.requests.map(r => r.text).join("\n")}\n${slice.lastReply}`.toLowerCase();
        if (!hay.includes(query.toLowerCase())) continue;
      }
      slices.push(slice);
    }
    slices.sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0));
    return slices;
  }

  /** Durable per-session rows, with only turns inside the requested range. */
  async function rowsFor(range, { query, sources, tags = [] } = {}) {
    const requiredTags = normalizeTagScope(tags);
    const entries = await source.timelines({ since: range.start, ...(sources ? { sources } : {}) });
    const needle = String(query || "").toLowerCase();
    const rows = [];
    for (const entry of entries) {
      const summary = entry.summary;
      if (!summary) continue;
      if (!matchesTags(summary, requiredTags)) continue;
      if ((entry.depth ?? summary.depth ?? 0) > 0 || entry.origin === "subagent") continue;
      if (needle && !String(summary.search || "").includes(needle)) continue;
      const turns = [];
      const days = new Set();
      let firstAt = null;
      let lastAt = 0;
      let calls = 0;
      let failed = 0;
      for (const turn of entry.turns || []) {
        const at = turn.start ?? turn.requests?.[0]?.time ?? turn.end ?? null;
        const last = turn.end ?? at;
        if (at === null || last === null) continue;
        if (last < range.start || at >= range.end) continue;
        turns.push(turn);
        calls += turn.calls ?? 0;
        failed += turn.failed ?? 0;
        if (firstAt === null || at < firstAt) firstAt = at;
        if (last > lastAt) lastAt = last;
        days.add(localDate(at, range.offsetMin));
        days.add(localDate(last, range.offsetMin));
      }
      if (!turns.length) continue;
      rows.push({ ...summary, turns: turns.length, calls, failed, firstAt, lastAt, days: [...days].sort() });
    }
    rows.sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0));
    return rows;
  }

  function statsOf(rows) {
    const projects = new Set();
    const days = new Set();
    let turns = 0;
    let calls = 0;
    let failed = 0;
    let files = 0;
    for (const row of rows) {
      if (row.project) projects.add(row.project);
      for (const day of row.days) days.add(day);
      turns += row.turns;
      calls += row.calls;
      failed += row.failed;
      files += row.files ?? 0;
    }
    return { sessions: rows.length, projects: projects.size, activeDays: days.size, turns, calls, failed, files };
  }

  async function listRecords(range, { query = "", project = "", workspaces = [], sources, tags = [] } = {}) {
    const all = await rowsFor(range, { query, sources, tags });
    const selected = [...new Set(workspaces.map(x => String(x).trim()).filter(Boolean))].slice(0, 100);
    const rows = all.filter(row => (!project || row.project === project) && (!selected.length || selected.includes(row.cwd)));
    return {
      range,
      tags: normalizeTagScope(tags),
      stats: statsOf(rows),
      projects: [...new Set(all.map(row => row.project).filter(Boolean))].sort(),
      workspaces: [...new Set(all.map(row => row.cwd).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
      records: rows.map(({ search, depth, ...row }) => row),
      errors: source.errors?.() ?? [],
    };
  }

  /** Undefined means no source session; null means it has no displayable turns. */
  async function recordDetail(id, range, tags = []) {
    const requiredTags = normalizeTagScope(tags);
    const record = id ? await source.record(id).catch(() => undefined) : undefined;
    if (!record || !matchesTags(record, requiredTags)) return undefined;
    const slice = sliceRecord(record, { ...range, start: 0, end: Infinity }, at => localDate(at, range.offsetMin));
    return slice ? { ...slice, title: titleOf(record) || slice.title, running: isLive(id) && record.open } : null;
  }

  async function activity({ span = 182, offsetMin = 0, includeExternal, tags = [] } = {}) {
    const requiredTags = normalizeTagScope(tags);
    const days = Math.min(366, Math.max(7, Math.round(Number(span)) || 182));
    const end = now() + 1;
    const startOfToday = Math.floor((now() + offsetMin * 60000) / 86400000) * 86400000 - offsetMin * 60000;
    const start = startOfToday - (days - 1) * 86400000;
    const include = includeExternal === undefined ? settingsStore.get().activityIncludeExternal === true : includeExternal === true;
    const dsh = (await index.activityRecords({ since: start })).filter(record => isPersonal(record) && matchesTags(record, requiredTags));
    const groups = [{ source: "dsh", records: dsh }];
    const external = Object.entries(importedRecords).map(([sourceName, read]) => {
      let value;
      try {
        const current = read?.({ rebuild: include }) ?? { enabled: false, records: [] };
        // Exclusion keeps lightweight enabled/availability status, but never
        // starts or returns full imported records and pending index work.
        value = include ? current : { ...current, records: [], pending: 0 };
      } catch (error) {
        // A broken optional source must not take down the native-only calendar.
        value = { enabled: true, ok: false, records: [], pending: 0, detail: String(error?.message ?? error) };
      }
      return { source: sourceName, label: sourceLabels[sourceName] ?? sourceName, value };
    });
    for (const item of external) {
      if (include && item.value.enabled && item.value.ok !== false && item.value.records.length) {
        groups.push({ source: item.source, records: item.value.records.filter(record => isPersonal(record) && matchesTags(record, requiredTags)) });
      }
    }
    const enabled = external.filter(item => item.value.enabled);
    return {
      ...activityCalendar(groups, { start, end, offsetMin }),
      span: days,
      includeExternal: include,
      tags: requiredTags,
      externalAvailable: enabled.some(item => item.value.ok !== false),
      externalPending: enabled.reduce((n, item) => n + (item.value.pending ?? 0), 0),
      externalEnabled: enabled.length > 0,
      externalProblemSources: enabled.filter(item => item.value.ok === false).map(item => item.label),
      errors: source.errors?.() ?? [],
    };
  }

  return { slicesFor, listRecords, recordDetail, activity, rowsFor, statsOf };
}
