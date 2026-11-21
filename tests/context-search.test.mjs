import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { foldRecord, sliceRecord } from '../lib/context-records.mjs';
import { searchContextSessions } from '../lib/context-search.mjs';

const at = Date.parse('2026-10-29T01:00:00Z');
const range = { start: at, end: at + 60_000 };
const user = (time, content) => ({ type: 'user/message', time, data: { content } });
const assistant = (time, content) => ({ type: 'assistant/message', time, data: { message: { content } } });
const result = (time, content) => ({ type: 'tool/result', time, data: { message: { content } } });
const slice = (id, fields) => ({ id, title: 'Maintenance', project: 'my-project', firstAt: at, lastAt: at + 100, ...fields });
const transcripts = byId => ({ events: async id => ({ events: byId[id] ?? [] }) });

function search(source, candidates, query, options) {
  return searchContextSessions(source, candidates, { query, range, ...options });
}

test('search finds late unabridged requests, tool arguments and tool results', async () => {
  const events = [user(at, 'Early setup'), { type: 'turn/start', time: at + 1, data: {} }];
  for (let i = 2; i < 145; i++) events.push(assistant(at + i, 'Working through the transcript.'));
  const padding = 'ordinary output '.repeat(3000);
  events.push(
    user(at + 145, `${padding}lease-renewal`),
    { type: 'tool/call', time: at + 146, data: { name: 'bash', arguments: { command: `${padding}cat ./config/renewal.conf` } } },
    result(at + 147, `${padding}E_STALE_LEASE`),
    { type: 'turn/end', time: at + 148, data: {} },
  );
  const candidate = sliceRecord(foldRecord(events, { id: 'long', cwd: '/work' }), range);
  assert.doesNotMatch(candidate.requests.at(-1).text, /lease-renewal/);
  for (const [query, index, type, exact] of [
    ['LEASE renewal', 145, 'user/message', /lease-renewal/],
    ['"./config/renewal.conf"', 146, 'tool/call', /\.\/config\/renewal\.conf/],
    ['E_STALE_LEASE', 147, 'tool/result', /E_STALE_LEASE/],
  ]) {
    const found = await search(transcripts({ long: events }), [candidate], query);
    assert.deepEqual(found.warnings, []);
    assert.equal(found.matches[0].slice, candidate);
    const [match] = found.matches[0].matches;
    assert.equal(match.eventIndex, index);
    assert.equal(match.type, type);
    assert.equal(match.time, events[index].time);
    assert.match(match.text, exact);
    assert.ok(match.text.length <= 280);
  }
});

test('ranking favors phrases and fields, combines separated concepts, and breaks ties consistently', async () => {
  const records = [
    slice('d', { lastAt: at + 10 }),
    slice('c', { lastAt: at + 20 }),
    slice('b', { lastAt: at + 20 }),
    slice('partial', { lastAt: at + 30 }),
    slice('separated'),
    slice('title', { title: 'Refresh token' }),
  ];
  const byId = Object.fromEntries(['b', 'c', 'd'].map(id => [id, [user(at, 'Refresh token')]]));
  byId.partial = [user(at, 'Refresh your browser. A tokenizer is installed.')];
  byId.separated = [user(at, 'Refresh it'), assistant(at + 1, 'The token was saved.')];
  const { matches } = await search(transcripts(byId), records, 'refresh token');
  assert.deepEqual(matches.map(match => match.slice.id), ['title', 'b', 'c', 'd', 'separated', 'partial']);
  assert.deepEqual(matches.at(-2).matches.map(match => match.type), ['user/message', 'assistant/message']);
  assert.deepEqual((await search(transcripts(byId), records, '"refresh token"')).matches.map(match => match.slice.id), ['title', 'b', 'c', 'd']);
});

test('search enforces inclusive start and exclusive end for raw and folded evidence', async () => {
  const raw = [user(at - 1, 'cutoff content'), user(at, 'cutoff at start'), result(at + 1, 'cutoff in tool'), user(range.end, 'cutoff at end'), user(null, 'cutoff with no time')];
  const covering = slice('covering', {
    firstAt: at - 10, lastAt: range.end + 10,
    commands: ['cutoff command'], files: ['cutoff file'], replies: [{ time: at + 1, text: 'cutoff folded reply' }],
    requests: raw.filter(event => event.type === 'user/message').map(event => ({ time: event.time, text: event.data.content })),
  });
  const rawSearch = await search(transcripts({ covering: raw }), [covering], 'cutoff');
  assert.deepEqual(rawSearch.matches[0].matches.map(match => match.eventIndex), [1, 2]);
  const folded = await search({}, [covering], 'cutoff');
  assert.deepEqual(folded.matches[0].matches, [{ type: 'user/message', time: at, text: 'cutoff at start' }]);
});

test('source failures retain healthy transcripts and in-window folded evidence', async () => {
  const source = {
    async events(id) {
      if (id === 'error') throw new Error('Private transcript content');
      if (id === 'missing') return undefined;
      return { events: [result(at + 5, 'Searchmarker in healthy transcript')] };
    },
  };
  const candidates = [
    slice('error', { files: ['/work/searchmarker.txt'] }),
    slice('missing', { commands: ['searchmarker --version'] }),
    slice('healthy'),
  ];
  const { matches, warnings } = await search(source, candidates, 'searchmarker');
  assert.deepEqual(new Set(matches.map(match => match.slice.id)), new Set(['error', 'missing', 'healthy']));
  assert.deepEqual(matches.find(match => match.slice.id === 'error').matches, [{ type: 'file', time: null, text: '/work/searchmarker.txt' }]);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /error/);
  assert.match(warnings[1], /missing/);
  assert.doesNotMatch(warnings.join(' '), /Private transcript content/);
});

test('raw reads are bounded and abort rejects even when the source ignores cancellation', async () => {
  let active = 0;
  let peak = 0;
  const candidates = Array.from({ length: 12 }, (_, i) => slice(String(i)));
  const completion = await search({ async events() {
    peak = Math.max(peak, ++active);
    await setImmediate();
    active--;
    return { events: [user(at, 'overflow')] };
  } }, candidates, 'overflow');
  assert.equal(completion.matches.length, candidates.length);
  assert.ok(peak > 1 && peak <= 4);

  const controller = new AbortController();
  const reads = [];
  const pending = search({ events(id, { signal }) {
    assert.equal(signal, controller.signal);
    return new Promise(resolve => reads.push(resolve));
  } }, candidates, 'overflow', { signal: controller.signal });
  const aborted = assert.rejects(pending, /stopped/);
  controller.abort(new Error('stopped'));
  await aborted;
  const started = reads.length;
  reads.forEach(resolve => resolve({ events: [] }));
  await setImmediate();
  assert.equal(reads.length, started);
  assert.ok(started <= 4);
});

test('Chinese word segmentation finds separated concepts and favors the phrase', async () => {
  const candidates = [slice('separated'), slice('phrase'), slice('partial')];
  const source = transcripts({
    separated: [user(at, '讨论了缓存策略'), assistant(at + 1, '失效的原因已经找到')],
    phrase: [user(at, '已经解决了缓存失效问题')],
    partial: [user(at, '缓存目录发生了变化')],
  });
  const { matches } = await search(source, candidates, '缓存失效');
  assert.deepEqual(matches.map(match => match.slice.id), ['phrase', 'separated', 'partial']);
  assert.match(matches[0].matches[0].text, /缓存失效/);
  assert.deepEqual(matches[1].matches.map(match => match.eventIndex), [0, 1]);
});

test('date and time terms match atomic values and in-window event timestamps', async () => {
  const source = transcripts({
    correct: [user(at, 'renewal')],
    lexical: [user(at + 1, 'renewal is scheduled for 2026年11月2日 9:30')],
    numbers: [user(at + 1, 'renewal was seen in 2026, with code 11 and count 2, at 19:30')],
  });
  const candidates = [slice('correct'), slice('lexical'), slice('numbers')];
  assert.deepEqual((await search(source, candidates, 'renewal 2026-11-02 09:30')).matches.map(match => match.slice.id), ['lexical']);
  assert.equal((await search(source, candidates, 'renewal 2026-10-29T09:00:00+08:00')).matches.length, 1);
  assert.equal((await search(source, candidates, '2026-10-29T09:00:00+08:00')).matches[0].matches[0].text, '2026-10-29T01:00:00.000Z');
  assert.equal((await search(source, [slice('correct')], 'renewal 09:00', { range: { ...range, offsetMin: 480 } })).matches.length, 1);
});

test('search preserves spelling and supports normalized exact excerpts', async () => {
  const source = transcripts({
    matching: [user(at, `${'padding '.repeat(1000)}Ｆｕｌｌ   ＷＩＤＴＨ`)],
    other: [user(at, 'full widthwise')],
  });
  const { matches } = await search(source, [slice('matching'), slice('other')], '"full WIDTH"');
  assert.deepEqual(matches.map(match => match.slice.id), ['matching']);
  assert.match(matches[0].matches[0].text, /Ｆｕｌｌ ＷＩＤＴＨ/);
  assert.ok(matches[0].matches[0].text.length <= 280);
});

test('literal identifiers and paths outrank separated token hits', async () => {
  const source = transcripts({
    separated: [user(at, 'Use foo bar in the config with the yml extension.')],
    literal: [user(at, 'Edit ./config/foo_bar.yml to fix it.')],
  });
  const candidates = [slice('separated'), slice('literal')];
  for (const query of ['foo_bar', './config/foo_bar.yml']) {
    const { matches } = await search(source, candidates, query);
    assert.deepEqual(matches.map(match => match.slice.id), ['literal', 'separated']);
    assert.ok(matches[0].score > matches[1].score);
  }
});

test('failure warnings are bounded and count omitted failures', async () => {
  const candidates = Array.from({ length: 12 }, (_, i) => slice(String(i)));
  const { warnings } = await search({ events: async () => undefined }, candidates, 'marker');
  assert.equal(warnings.length, 9);
  assert.match(warnings[0], /for 0\./);
  assert.match(warnings.at(-1), /4 more sessions/);
});
