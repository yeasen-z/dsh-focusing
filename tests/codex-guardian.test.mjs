import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { zstdCompressSync } from 'node:zlib';
import { parseRollout, streamRollout, createCodexRoster, createCodexRecords } from '../lib/codex-rollout.mjs';
import { createCodexIndex } from '../lib/codex-index.mjs';
import { foldRecord } from '../lib/context-records.mjs';

const line = (type, payload) => JSON.stringify({ timestamp: '2026-11-14T00:00:00Z', type, payload });
const rollout = meta => [
  line('session_meta', { id: 'review', cwd: '/work/project', ...meta }),
  line('event_msg', { type: 'task_started', turn_id: 'turn' }),
  line('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Assess this planned action' }] }),
  line('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'allow' }] }),
  line('event_msg', { type: 'task_complete', turn_id: 'turn' }),
].join('\n');
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'focusing-guardian-'));
  t.after(async () => { assert.ok(home.startsWith(join(tmpdir(), 'focusing-guardian-'))); await rm(home, { recursive: true, force: true }); });
  await mkdir(join(home, 'sessions'));
  await mkdir(join(home, 'archived_sessions'));
  return home;
}
for (const meta of [
  { thread_source: 'guardian_review' },
  { source: { subagent: { other: 'guardian' } } },
  { session_id: 'parent', thread_source: 'guardian_review', source: { subagent: { other: 'guardian' } } },
]) test(`Guardian provenance excludes automatic approval messages: ${JSON.stringify(meta)}`, () => {
  const parsed = parseRollout(rollout(meta) + '\n' + rollout({ id: 'later-metadata' }));
  assert.equal(parsed.header.excluded, true);
  assert.equal(parsed.header.id, null);
  assert.deepEqual(parsed.events, []);
});

test('a title, parent link, ordinary review, or other subagent is not Guardian provenance', () => {
  for (const meta of [
    { title: 'Guardian Review' }, { parent_thread_id: 'parent' },
    { source: { subagent: { other: 'review' } } }, { thread_source: 'review' },
    { source: 'cli' }, { source: null }, {},
  ]) {
    const parsed = parseRollout(rollout(meta));
    assert.equal(parsed.header.id, 'review');
    assert.equal(parsed.header.excluded, undefined);
    assert.equal(parsed.events.filter(e => e.type === 'user/message').length, 1);
  }
});

test('rebuilds old Codex caches and excludes Guardian from roster, activity and errors across restart', async t => {
  const home = await fixture(t), cacheFile = join(home, 'cache.json');
  const main = join(home, 'sessions', 'rollout-main.jsonl');
  const guardian = join(home, 'sessions', 'rollout-guardian.jsonl');
  const archived = join(home, 'archived_sessions', 'rollout-guardian.jsonl');
  await writeFile(main, rollout({ id: 'main' }));
  await writeFile(guardian, rollout({ thread_source: 'guardian_review' }));
  await writeFile(archived, rollout({ id: 'archived', source: { subagent: { other: 'guardian' } } }));
  await writeFile(join(home, 'session_index.jsonl'), JSON.stringify({ id: 'main', thread_name: 'Guardian Review' }));
  const oldEntries = {};
  for (const path of [main, guardian, archived]) {
    const s = await stat(path);
    oldEntries[path] = { key: `${s.size}:${s.mtimeMs}`, summary: { id: 'cached-review', title: 'Guardian Review', dayTurns: [] } };
  }
  await writeFile(cacheFile, JSON.stringify({ version: 1, source: 'codex', home, entries: oldEntries }));
  let index = createCodexIndex({ home, fold: foldRecord, cacheFile });
  assert.deepEqual(index.refresh(), [], 'old cache must not leak reviews before rebuilding');
  await index.settle();
  assert.deepEqual(index.refresh().map(row => row.id), ['main']);
  assert.deepEqual(index.errors(), [], 'deliberately excluded logs are not unreadable-source warnings');
  assert.deepEqual(createCodexRecords(home, index).records().map(row => row.id), ['codex:main']);
  const roster = createCodexRoster(home, index).rows();
  assert.equal(roster.length, 1);
  assert.equal(roster[0].title, 'Guardian Review', 'a normal chat keeps its editable title');
  const saved = JSON.parse(await readFile(cacheFile, 'utf8'));
  assert.equal(saved.version, 2);
  assert.deepEqual(saved.entries[guardian].summary, { excluded: true });
  index = createCodexIndex({ home, fold: foldRecord, cacheFile });
  assert.deepEqual(index.refresh().map(row => row.id), ['main']);
  assert.deepEqual(index.stale(), []);
  assert.deepEqual(index.errors(), []);
});

test('compressed archived Guardian logs use the same streaming exclusion', async t => {
  const home = await fixture(t);
  const path = join(home, 'archived_sessions', 'rollout-guardian.jsonl.zst');
  await writeFile(path, zstdCompressSync(Buffer.from(rollout({ thread_source: 'guardian_review' }))));
  const events = [];
  const header = await streamRollout(path, e => events.push(e));
  assert.equal(header.excluded, true);
  assert.deepEqual(events, []);
  const index = createCodexIndex({ home, fold: foldRecord });
  await index.settle();
  assert.deepEqual(index.refresh(), []);
  assert.deepEqual(index.errors(), []);
});
