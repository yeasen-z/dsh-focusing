import { setImmediate } from 'node:timers/promises';
import { blocksText, humanRequest } from './context-records.mjs';

const MAX_READS = 4;
const MAX_MATCHES = 4;
const MAX_WARNINGS = 8;
const EXCERPT_LENGTH = 280;
const WEIGHTS = {
  title: 5, project: 4, cwd: 3, file: 3, command: 3,
  'user/message': 4, 'assistant/message': 3, 'tool/call': 3, 'tool/result': 2,
  'turn/start': 1, 'turn/end': 1,
};
const STOP_WORDS = new Set(`a an and are about can could did do does for from had has have how i in is it me my of on or our please show tell that the their them there this to was we were what when where which who why will with would you your
我 我们 你 他们 的 了 吗 呢 是 有 和 与 在 关于 请 帮 帮我 给 给我 上 次 上次 什么 什么时候 怎么 怎样 如何 为何 为什么 哪里 哪个 哪些 是否 一下 找 查 找到 告诉`.split(/\s+/));
const DATE = String.raw`\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{4}年\d{1,2}月\d{1,2}日`;
const TIME = String.raw`\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?`;
const ISO = String.raw`\d{4}-\d{2}-\d{2}t${TIME}(?:z|[+-]\d{2}:\d{2})`;
const wholeAtomic = new RegExp(`^(?:${ISO}|${DATE}|${TIME})$`);
const chunks = new RegExp(`${ISO}|${DATE}|${TIME}|[\\p{L}\\p{M}\\p{N}]+`, 'gu');
const han = /\p{Script=Han}/u;
const singleHan = /^\p{Script=Han}$/u;
const wordSegmenter = new Intl.Segmenter('zh', { granularity: 'word' });
const normalize = text => text.normalize('NFKC').toLowerCase();
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const asText = value => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
const finite = Number.isFinite;

function literalPattern(text) {
  const word = `(?!\\p{Script=Han})[\\p{L}\\p{M}\\p{N}${text.includes('_') ? '_' : ''}]`;
  const left = /^[\p{L}\p{M}\p{N}]/u.test(text) && !han.test([...text][0]) ? `(?<!${word})` : '';
  const last = [...text].at(-1);
  const right = /^[\p{L}\p{M}\p{N}]$/u.test(last) && !han.test(last) ? `(?!${word})` : '';
  return new RegExp(`${left}${text.split(/\s+/).map(escape).join('\\s+')}${right}`, 'u');
}

function segmentedTerms(text) {
  const terms = [];
  let singleHanRun = '';
  for (const { segment, isWordLike } of wordSegmenter.segment(text)) {
    if (isWordLike && singleHan.test(segment) && !STOP_WORDS.has(segment)) {
      singleHanRun += segment;
      continue;
    }
    if (singleHanRun) terms.push(singleHanRun);
    singleHanRun = '';
    if (isWordLike) terms.push(segment);
  }
  if (singleHanRun) terms.push(singleHanRun);
  return terms;
}

function termPattern(term, temporal) {
  if (!temporal) return literalPattern(term);
  if (term.includes('t')) {
    const time = Date.parse(term);
    if (!finite(time)) return literalPattern(term);
    const utc = new Date(time).toISOString().toLowerCase();
    const variants = [term, utc, utc.replace(/\.000z$/, 'z')];
    return new RegExp(`(?<![\\p{L}\\p{N}])(?:${variants.map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'u');
  }
  if (/^\d{4}[-/年]/.test(term)) {
    const [year, month, day] = term.match(/\d+/g);
    const m = Number(month) < 10 ? `0?${Number(month)}` : month;
    const d = Number(day) < 10 ? `0?${Number(day)}` : day;
    return new RegExp(`(?<!\\d)(?:${year}[-/]${m}[-/]${d}|${year}年${m}月${d}日)(?!\\d)`, 'u');
  }
  const [hour, minute, seconds] = term.split(':');
  const h = Number(hour) < 10 ? `0?${Number(hour)}` : hour;
  return new RegExp(`(?<![\\d:])${h}:${minute}${seconds ? `:${escape(seconds)}` : ''}(?!\\d)`, 'u');
}

function compileQuery(query) {
  const input = normalize(query.trim());
  if (!input) return null;
  const terms = new Map();
  const add = (term, kind) => {
    if (!terms.has(term) || kind !== 'word') terms.set(term, kind);
  };
  const unquoted = input.replace(/"([^"\n]+)"|“([^”\n]+)”|`([^`\n]+)`/g, (_, ascii, curly, code) => {
    const phrase = (ascii ?? curly ?? code).trim();
    if (phrase) add(phrase, 'exact');
    return ' ';
  });
  const phraseTerms = [];
  for (const [text] of unquoted.matchAll(chunks)) {
    if (wholeAtomic.test(text)) {
      add(text, 'time');
      continue;
    }
    for (const term of han.test(text) ? segmentedTerms(text) : [text]) {
      if (STOP_WORDS.has(term)) continue;
      add(term, 'word');
      phraseTerms.push(term);
    }
  }
  if (!terms.size) add(input, 'exact');
  const phrase = phraseTerms.length > 1
    ? new RegExp(phraseTerms.map((term, index) => {
      const separator = han.test(phraseTerms[index - 1]?.slice(-1) ?? '') && han.test(term[0]) ? '[^\\p{L}\\p{M}\\p{N}]*' : '[^\\p{L}\\p{M}\\p{N}]+';
      return `${index ? separator : ''}${literalPattern(term).source}`;
    }).join(''), 'u')
    : null;
  return {
    terms: [...terms].map(([term, kind]) => ({ pattern: termPattern(term, kind === 'time'), kind })),
    literal: literalPattern(input), phrase, hasTimeTerms: [...terms.values()].includes('time'),
  };
}

function originalOffset(text, index) {
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (normalize(text.slice(0, middle)).length < index) low = middle + 1;
    else high = middle;
  }
  return low;
}

function excerpt(text, normalized, hit) {
  const matchedAt = text.length === normalized.length ? hit.index : originalOffset(text, hit.index);
  let start = Math.max(0, matchedAt - Math.floor(EXCERPT_LENGTH / 4));
  let end = Math.min(text.length, start + EXCERPT_LENGTH - 2);
  if (start && /[\uDC00-\uDFFF]/.test(text[start])) start++;
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
  return `${start ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}

function matchText(compiled, text, temporalOnly = false) {
  if (!text) return null;
  const normalized = normalize(text);
  const hits = new Set();
  let best;
  for (const [index, term] of compiled.terms.entries()) {
    if (temporalOnly && term.kind !== 'time') continue;
    const hit = term.pattern.exec(normalized);
    if (!hit) continue;
    hits.add(index);
    if (!best || hit[0].length > best[0].length) best = hit;
  }
  if (!best) return null;
  const literal = temporalOnly ? null : compiled.literal.exec(normalized);
  const phrase = temporalOnly || literal ? null : compiled.phrase?.exec(normalized);
  const score = hits.size * 4 + (literal && compiled.terms.length > 1 ? 12 : phrase ? 8 : 0);
  return { score, hits, text: excerpt(text, normalized, literal ?? phrase ?? best) };
}

function coversRequired(compiled, hits) {
  return compiled.terms.every((term, index) => term.kind === 'word' || hits.has(index));
}

function matchAtTime(compiled, text, time, offsetMin) {
  const content = matchText(compiled, text);
  if (!compiled.hasTimeTerms || !finite(time) || Math.abs(time) > 8.64e15) return content;
  const stamp = matchText(compiled, timestampText(time, offsetMin), true);
  if (!content || !stamp) return content ?? stamp;
  for (const hit of stamp.hits) {
    if (!content.hits.has(hit)) content.score += 4;
    content.hits.add(hit);
  }
  return content;
}

function inRange(time, range) {
  return finite(time) && time >= (range?.start ?? -Infinity) && time < (range?.end ?? Infinity);
}

function eventText(event) {
  const data = event.data ?? {};
  switch (event.type) {
    case 'user/message': return humanRequest(data);
    case 'assistant/message': return blocksText(data.message?.content ?? data.content);
    case 'tool/call': return [data.name, asText(data.arguments ?? data.args)].filter(Boolean).join('\n');
    case 'tool/result': return [blocksText(data.message?.content ?? data.content), asText(data.error)].filter(Boolean).join('\n');
    case 'turn/end': return asText(data.reason);
    default: return '';
  }
}

function timestampText(time, offsetMin) {
  const iso = new Date(time).toISOString();
  if (!finite(offsetMin) || offsetMin === 0 || Math.abs(time + offsetMin * 60_000) > 8.64e15) return iso;
  const local = new Date(time + offsetMin * 60_000).toISOString().slice(0, -1);
  return `${iso}\n${local}`;
}

function compareEvidence(a, b) {
  return b.score - a.score || (b.time ?? -Infinity) - (a.time ?? -Infinity) || (a.eventIndex ?? 0) - (b.eventIndex ?? 0);
}

async function searchSlice(compiled, slice, events, range, signal) {
  const matches = [];
  const covered = new Set();
  const match = (text, time) => matchAtTime(compiled, text, time, range?.offsetMin);
  const collect = (hit, evidence) => {
    if (!hit) return;
    for (const term of hit.hits) covered.add(term);
    const row = { ...evidence, text: hit.text, score: hit.score * WEIGHTS[evidence.type] };
    matches.push(row);
    matches.sort(compareEvidence);
    if (matches.length > MAX_MATCHES) matches.pop();
  };
  for (const type of ['title', 'project', 'cwd']) {
    collect(matchText(compiled, slice[type]), { type, time: null });
  }
  if (events) {
    for (let index = 0; index < events.length; index++) {
      signal?.throwIfAborted();
      if (index && index % 128 === 0) await setImmediate(undefined, { signal });
      const event = events[index];
      if (!event || !Object.hasOwn(WEIGHTS, event.type) || !inRange(event.time, range)) continue;
      collect(match(eventText(event), event.time), { type: event.type, time: event.time, eventIndex: index });
    }
  } else {
    for (const entry of slice.requests ?? []) {
      if (inRange(entry.time, range)) collect(match(entry.text, entry.time), { type: 'user/message', time: entry.time });
    }
    // Replies, files and commands have turn-level timestamps at best. A turn
    // spanning a boundary can contain evidence that falls on either side.
    const last = slice.unfinished ? slice.updatedAt : slice.lastAt;
    if (inRange(slice.firstAt, range) && inRange(last, range)) {
      for (const entry of slice.replies ?? []) {
        if (inRange(entry.time, range)) collect(matchText(compiled, entry.text), { type: 'assistant/message', time: entry.time });
      }
      for (const [type, entries] of [['file', slice.files], ['command', slice.commands]]) {
        for (const text of entries ?? []) collect(matchText(compiled, text), { type, time: null });
      }
    }
  }
  if (!matches.length || !coversRequired(compiled, covered)) return;
  return {
    slice,
    score: matches[0].score + covered.size * 12,
    matches: matches.map(({ score, ...evidence }) => evidence),
  };
}

/** Search eligible session slices with a bounded pool of original transcript reads. */
export async function searchContextSessions(source, candidates, { query, range, signal }) {
  signal?.throwIfAborted();
  const compiled = compileQuery(query);
  if (!compiled || !candidates.length) return { matches: [], warnings: [] };
  const matches = [];
  const failedReads = [];
  const rawAvailable = typeof source.events === 'function';
  let failureCount = 0;
  let next = 0;
  async function worker() {
    while (next < candidates.length) {
      signal?.throwIfAborted();
      const index = next++;
      const slice = candidates[index];
      let events;
      if (rawAvailable) {
        try {
          const raw = await source.events(slice.id, { signal });
          if (Array.isArray(raw?.events)) events = raw.events;
        } catch {
          signal?.throwIfAborted();
        }
        if (!events) {
          failureCount++;
          failedReads.push(index);
          failedReads.sort((a, b) => a - b);
          if (failedReads.length > MAX_WARNINGS) failedReads.pop();
        }
      }
      signal?.throwIfAborted();
      const match = await searchSlice(compiled, slice, events, range, signal);
      if (match) matches.push(match);
    }
  }
  let abort;
  try {
    const cancelled = signal && new Promise((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
    });
    const pending = Promise.all(Array.from({ length: Math.min(candidates.length, MAX_READS) }, worker));
    await (cancelled ? Promise.race([pending, cancelled]) : pending);
    signal?.throwIfAborted();
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
  }
  matches.sort((a, b) => b.score - a.score || (b.slice.lastAt ?? -Infinity) - (a.slice.lastAt ?? -Infinity) || a.slice.id.localeCompare(b.slice.id));
  const warnings = failedReads.map(index => `Original transcript unavailable for ${candidates[index].id}. Searched folded session data.`);
  if (!rawAvailable) warnings.push('Original transcripts unavailable. Searched folded session records.');
  if (failureCount > MAX_WARNINGS) warnings.push(`Original transcripts unavailable for ${failureCount - MAX_WARNINGS} more sessions. Searched folded session data.`);
  return { matches, warnings };
}
