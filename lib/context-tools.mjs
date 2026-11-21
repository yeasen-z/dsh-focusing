// Model-facing, read-only queries. HTTP and tools share the same context source.
import { createHash } from 'node:crypto';
import { isPersonal, sliceRecord, recordSummary } from './context-records.mjs';
import { localDate } from './time-range.mjs';
import { activityCalendar } from './activity.mjs';
import { matchesTags, normalizeTagScope } from './session-tags.mjs';
import { searchContextSessions } from './context-search.mjs';

const string = { type: 'string' };
const SOURCES = ['dsh', 'codex', 'claude'];
const common = {
  start: { type: 'string', description: 'Inclusive ISO timestamp with Z or explicit UTC offset.' },
  end: { type: 'string', description: 'Exclusive ISO timestamp with Z or explicit UTC offset.' },
  sources: { type: 'array', items: { type: 'string', enum: SOURCES }, description: 'Session sources to search. Defaults to DSH, Codex and Claude; imported sources return data only when enabled.' },
  tags: { type: 'array', items: string, description: 'Optional canonical tags such as source:claude, project:my-app or workspace:/abs/path. Every tag must match; use workspace to distinguish same-named projects.' },
};
const paging = {
  cursor: { type: 'string', description: 'The nextCursor from the preceding page. Repeat the same filters.' },
  limit: { type: 'integer', description: 'Maximum items per page (1–50). The page may be shorter to fit the response budget.' },
};
const activityPaging = { cursor: paging.cursor, limit: { type: 'integer', description: 'Maximum days per page (1–366). Totals always cover the full requested range.' } };
function pageFingerprint(identity, items) {
  const hash = createHash('sha256').update(JSON.stringify(identity));
  for (const item of items) hash.update('\n').update(JSON.stringify(item));
  return hash.digest('hex');
}
function integer(value, fallback, min, max) {
  const n = value ?? fallback;
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Expected integer ${min}..${max}`);
  return n;
}
function rangeOf(args, bound) {
  const parse = value => {
    if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Use ISO timestamps with explicit timezone');
    return Date.parse(value);
  };
  let start = args.start === undefined ? 0 : parse(args.start);
  let end = args.end === undefined ? null : parse(args.end);
  // The person chose a window for this question; the model may look inside it but
  // never past it. Clamping (rather than rejecting) keeps "last week" working when
  // the window is "last 30 days"; asking wholly outside it is an error it can read.
  if (bound) {
    if (start < bound.start) start = bound.start;
    if (bound.end != null && (end === null || end > bound.end)) end = bound.end;
    if (end !== null && end <= start) throw new Error('That time range lies outside the window this question may search');
  }
  if (end !== null && end <= start) throw new Error('end must be after start');
  return { start, end };
}
function page(items, { cursor, limit }, identity, envelope, resultLimit, itemKey = 'items') {
  const fingerprint = pageFingerprint(identity, items);
  let offset = 0;
  if (cursor !== undefined) {
    if (typeof cursor !== 'string' || cursor.length > 300) throw new Error('Invalid cursor');
    let parsed;
    try { parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString()); } catch { throw new Error('Invalid cursor'); }
    if (parsed?.hash !== fingerprint) throw new Error('Query or data changed; restart without cursor');
    offset = integer(parsed.offset, 0, 0, items.length);
  }
  const response = (selected, next) => ({
    ...envelope,
    pageOffset: offset,
    nextCursor: next < items.length ? Buffer.from(JSON.stringify({ hash: fingerprint, offset: next })).toString('base64url') : null,
    truncated: next < items.length,
    [itemKey]: selected,
  });
  const selected = [];
  const end = Math.min(items.length, offset + limit);
  let itemChars = 0;
  for (let i = offset; i < end; i++) {
    if (resultLimit !== Infinity) {
      const size = JSON.stringify(items[i]).length + (selected.length ? 1 : 0);
      if (JSON.stringify(response([], i + 1)).length + itemChars + size > resultLimit) break;
      itemChars += size;
    }
    selected.push(items[i]);
  }
  const result = response(selected, offset + selected.length);
  if ((!selected.length && offset < end) || (resultLimit !== Infinity && JSON.stringify(result).length > resultLimit)) {
    throw new Error('One result is too large for this page. Narrow the query or time range.');
  }
  return result;
}

function coverageOf(warnings) {
  if (!warnings.length) return {};
  return {
    coverage: 'partial',
    warningCount: warnings.length,
    warnings: warnings.slice(0, 4).map(warning => String(warning).slice(0, 240)),
  };
}

export function createContextQueries(source, options = {}) {
  const bound = options.bound ?? null;
  const resultLimit = options.resultLimit ?? Infinity;
  const fragmentSize = Number.isFinite(resultLimit) ? Math.min(6000, Math.max(1, Math.floor((resultLimit - 1000) / 2))) : 6000;
  return async function query(name, args, exec) {
    exec?.signal?.throwIfAborted();
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Expected an argument object');
    const allowedArgs = name === 'focus_read_session' ? [...Object.keys(common), ...Object.keys(paging), 'sessionId', 'startEventIndex']
      : name === 'focus_activity' ? [...Object.keys(common), ...Object.keys(activityPaging), 'offsetMinutes', 'cwd']
      : name === 'focus_list_sessions' ? [...Object.keys(common), ...Object.keys(paging), 'offsetMinutes', 'project', 'query', 'cwd'] : null;
    if (!allowedArgs || Object.keys(args).some(key => !allowedArgs.includes(key))) throw new Error('Unknown tool or argument');
    const range = rangeOf(args, bound);
    if (name === 'focus_activity' && (!args.start || !args.end || range.end - range.start > 366 * 86400000)) throw new Error('Activity requires explicit start/end spanning at most 366 days');
    const requestedSources = args.sources ?? SOURCES;
    if (!Array.isArray(requestedSources) || !requestedSources.length || requestedSources.some(source => !SOURCES.includes(source))) throw new Error('Invalid sources');
    const sources = [...new Set(requestedSources)];
    // Caller-selected tags are always ANDed with the conversation's bound scope,
    // so the model can narrow but never widen the records it is allowed to read.
    const tags = normalizeTagScope([...normalizeTagScope(args.tags), ...(bound?.tags ?? [])]);
    const identity = [name, range, sources, tags, args.project, args.query, args.cwd, args.sessionId, args.startEventIndex, args.offsetMinutes];
    const envelope = { range, now: new Date().toISOString(), contentIsUntrusted: true };
    const excluded = await options.excludedSessions?.();
    if (name === 'focus_read_session') {
      if (typeof args.sessionId !== 'string' || !args.sessionId) throw new Error('sessionId is required');
      if (excluded?.has(args.sessionId)) throw new Error('Ask conversations are outside the historical search sources');
      const startEventIndex = integer(args.startEventIndex, 0, 0, Number.MAX_SAFE_INTEGER);
      const record = await source.record(args.sessionId);
      if (!record || !sources.includes(record.source ?? 'dsh') || !matchesTags(record, tags)) throw new Error('Session unavailable, disabled, or outside the selected tags');
      const raw = await source.events(args.sessionId, { signal: exec?.signal });
      if (!raw) throw new Error('Session unavailable');
      const chunks = [];
      const allowed = new Set(['user/message','assistant/message','tool/call','tool/result','turn/start','turn/end']);
      for (let i = startEventIndex; i < raw.events.length; i++) {
        exec?.signal?.throwIfAborted();
        const event = raw.events[i];
        if (!allowed.has(event.type) || !Number.isFinite(event.time) || event.time < range.start || (range.end !== null && event.time >= range.end)) continue;
        // Exact serialized event fragments, never silently clipped. Reassemble
        // fragments with the same eventIndex before parsing their JSON.
        const text = JSON.stringify(event);
        for (let at = 0; at < text.length; at += fragmentSize) {
          chunks.push({ eventIndex: i, type: event.type, time: event.time, offset: at, totalChars: text.length, text: text.slice(at, at + fragmentSize) });
        }
      }
      const readEnvelope = { ...envelope, sessionId: args.sessionId, source: record.source ?? 'dsh', encoding: 'json-event-fragments', total: chunks.length };
      return page(chunks, { cursor: args.cursor, limit: integer(args.limit, 6, 1, 50) }, identity, readEnvelope, resultLimit);
    }
    if (args.project !== undefined && typeof args.project !== 'string') throw new Error('project must be a string');
    if (args.cwd !== undefined && typeof args.cwd !== 'string') throw new Error('cwd must be a string');
    if (args.query !== undefined && (typeof args.query !== 'string' || args.query.length > 500)) throw new Error('query must be a string up to 500 characters');
    const records = (await source.records({since:range.start, signal:exec?.signal, sources})).filter(r => !excluded?.has(r.id) && matchesTags(r, tags) && (!args.cwd || r.cwd === args.cwd) && isPersonal(r) && sources.includes(r.source ?? 'dsh') && (!args.project || r.project === args.project));
    exec?.signal?.throwIfAborted();
    const warnings = source.errors();
    const offsetMin = integer(args.offsetMinutes, options.offsetMinutes ?? 0, -840, 840);
    if (name === 'focus_activity') {
      const groups = sources.map(source => ({ source, records: records.filter(record => (record.source ?? 'dsh') === source) }));
      const { days, ...stats } = activityCalendar(groups, { ...range, offsetMin });
      const totalCalls = days.reduce((sum, day) => sum + day.calls, 0);
      const totalSessions = records.filter(record => record.turns.some(turn => {
        const at = turn.start ?? turn.requests[0]?.time ?? turn.end;
        return at != null && at >= range.start && at < range.end;
      })).length;
      const activityEnvelope = { ...envelope, ...coverageOf(warnings), offsetMinutes: offsetMin, ...stats, totalCalls, totalSessions, totalDays: days.length };
      return page(days, { cursor: args.cursor, limit: args.limit === undefined ? days.length : integer(args.limit, 1, 1, 366) }, identity, activityEnvelope, resultLimit, 'days');
    }
    const slices = records.flatMap(record => {
      const slice = sliceRecord(record, { ...range, end: range.end ?? Infinity }, at => localDate(at, offsetMin));
      if (!slice) return [];
      const replies = slice.replies.filter(reply => reply.time >= range.start && (range.end === null || reply.time < range.end));
      return [{ ...slice, replies, lastReply: replies.at(-1)?.text ?? '' }];
    });
    const keyword = args.query?.trim();
    const reader = keyword && slices.length ? await source.eventsReader?.(sources, exec?.signal) : null;
    const search = keyword ? await searchContextSessions(reader ? { events: reader } : source, slices, { query: keyword, range: { ...range, offsetMin }, signal: exec?.signal }) : null;
    const rows = search
      ? search.matches.map(({ slice, score, matches }) => ({ ...recordSummary(slice), score, matches }))
      : slices.map(recordSummary).sort((a, b) => b.lastAt - a.lastAt || a.id.localeCompare(b.id));
    const listWarnings = new Set([...warnings, ...source.errors(), ...(search?.warnings ?? [])]);
    const listEnvelope = { ...envelope, ...coverageOf([...listWarnings]), queryMode: search ? 'ranked lexical search' : 'recent sessions', total: rows.length };
    return page(rows, { cursor: args.cursor, limit: integer(args.limit, 20, 1, 50) }, identity, listEnvelope, resultLimit);
  };
}

export function createContextTools(source, options = {}) {
  const query = createContextQueries(source, options);
  const definitions = [
    ['focus_list_sessions', 'Find prior chats across workspaces. Keyword results are ranked and include matching excerpts and event locations. Omit the query for a recent-first list.', {
      ...common, ...paging, project: string,
      query: { type: 'string', description: 'A short topic, key terms or an exact identifier to find in original messages and tool events.' },
      cwd: { type: 'string', description: 'Only chats from this exact workspace path.' },
      offsetMinutes: { type: 'integer', description: 'Minutes east of UTC for local dates.' },
    }],
    ['focus_read_session', 'Read original conversation events, including tool results. Returns exact JSON fragments of up to 6,000 characters each. Join fragments sharing an eventIndex by offset.', {
      ...common, ...paging, sessionId: string,
      startEventIndex: { type: 'integer', description: 'Start at a matching eventIndex from focus_list_sessions. Omit to start at the beginning.' },
    }],
    ['focus_activity', 'Count turns, tool calls and distinct sessions over up to 366 days. Daily details may be paginated.', {
      ...common, ...activityPaging,
      cwd: { type: 'string', description: 'Only count chats from this exact workspace path.' },
      offsetMinutes: { type: 'integer', description: 'Minutes east of UTC, -840..840.' },
    }],
  ];
  return definitions.map(([name,description,properties])=>({
    name, description, parameters:{type:'object',properties,additionalProperties:false,required:name==='focus_read_session'?['sessionId']:name==='focus_activity'?['start','end']:[]},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    timeoutMs:60000,
    execute:async(args,exec)=>JSON.stringify(await query(name,args,exec)),
  }));
}
