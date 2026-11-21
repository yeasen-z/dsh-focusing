import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createHistoryStore, readHistorySnapshot, searchHistorySnapshot } from '../lib/history-store.mjs';

async function fixture(t) {
  const parent = await mkdtemp(join(tmpdir(), 'history-store-test-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const directory = join(parent, 'private');
  return { directory, store: createHistoryStore({ directory }) };
}
const event = (text, type = 'user/message') => ({ type, time: 123, data: type === 'assistant/message' ? { message: { content: [{ type: 'text', text }] } } : { content: text } });
const input = () => ({ sourceId: 'claude:source', record: { source: 'claude', title: 'Title', cwd: '/project' }, events: [event('hello')], brief: 'Summary' });

test('selected-range projections use immutable fragmented storage with explicit provenance', async t => {
  const { store, directory } = await fixture(t);
  const slice = { id: 'codex:range', source: 'codex', title: 'Selected record', cwd: '/project', requests: [{ text: '证据'.repeat(7000) }] };
  const range = { start: 100, end: 200 };
  const snapshot = await store.createRecordSnapshot({ slice, range });
  assert.ok(snapshot.entries.length > 1);
  assert.ok(snapshot.entries.every(entry => entry.type === 'focusing/record-slice' && entry.text.length <= 6000));
  const expected = structuredClone({ slice, range });
  slice.requests[0].text = 'changed live source';
  range.end = 999;
  const reopened = await createHistoryStore({ directory }).getSnapshot(snapshot.id);
  assert.deepEqual(JSON.parse(reopened.entries.map(e => e.text).join('')), expected);
  assert.match(reopened.brief, /not a full conversation/);
  assert.equal((await stat(join(directory, `${snapshot.id}.json`))).mode & 0o777, 0o600);
});

test('immutable snapshot survives restart and source/returned value changes; private modes', async t => {
  const { store, directory } = await fixture(t);
  const original = input(), snapshot = await store.createSnapshot(original);
  assert.deepEqual(snapshot.source, { sessionId: 'claude:source', kind: 'claude', title: 'Title', cwd: '/project' });
  original.events[0].data.content = 'changed'; original.record.title = 'changed';
  const reopened = createHistoryStore({ directory });
  assert.deepEqual(await reopened.getSnapshot(snapshot.id), snapshot);
  snapshot.entries[0].text = 'tampered in memory';
  assert.equal((await store.getSnapshot(snapshot.id)).entries[0].text, 'hello');
  assert.throws(() => readHistorySnapshot(snapshot), /hash/);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  assert.equal((await stat(join(directory, `${snapshot.id}.json`))).mode & 0o777, 0o600);
  assert.equal(await store.getSnapshot(randomUUID()), null);
});

test('extracts only ordinary historical text and selected tool/status fields', async t => {
  const { store } = await fixture(t);
  const events = [
    event('person'),
    { ...event('RUNTIME SECRET'), data: { source: { kind: 'runtime' }, content: 'RUNTIME SECRET' } },
    event('SYSTEM SECRET', 'system/message'), event('DEVELOPER SECRET', 'developer/message'),
    { type: 'assistant/message', data: { replay: 'REPLAY SECRET', message: { content: [{ type: 'reasoning', text: 'REASON SECRET' }, { type: 'text', text: 'answer' }, { type: 'provider', text: 'PROVIDER SECRET' }], providerMetadata: 'META SECRET' } } },
    { type: 'tool/call', data: { name: 'bash', arguments: { command: 'pwd' }, provider: 'META SECRET' } },
    { type: 'tool/result', data: { message: { content: [{ type: 'text', text: 'output' }, { type: 'reasoning', text: 'REASON SECRET' }], isError: true, metadata: { exitCode: 2, providerReplay: 'META SECRET' } }, error: { code: 'EFAIL', reason: 'failed', provider: 'META SECRET' } } },
    { type: 'turn/end', data: { reason: { kind: 'failed', provider: 'META SECRET' }, turn: 1 } },
  ];
  const snapshot = await store.createSnapshot({ ...input(), events });
  assert.deepEqual(snapshot.entries.map(e => e.type), ['user/message', 'assistant/message', 'tool/call', 'tool/result', 'turn/end']);
  assert.equal(JSON.stringify(snapshot).includes('SECRET'), false);
  assert.match(snapshot.entries[2].text, /pwd/);
  assert.match(snapshot.entries[3].text, /output.*\n.*exitCode.*2/);
  assert.match(snapshot.entries[3].text, /EFAIL/);
  assert.match(snapshot.entries[4].text, /failed/);
});

test('tool fragments retain call identifiers across out-of-order results and restart', async t => {
  const { store, directory } = await fixture(t);
  const events = [
    { type: 'tool/call', data: { callId: 'first', name: 'bash', arguments: 'first command' } },
    { type: 'tool/call', data: { callId: 'second', name: 'bash', arguments: 'second command' } },
    { type: 'tool/result', data: { message: { toolCallId: 'second', source: { callId: 'ignored', provider: 'SECRET' }, content: 'second result' } } },
    { type: 'tool/result', data: { message: { source: { callId: 'first', provider: 'SECRET' }, content: 'a'.repeat(6001) } } },
    event('ordinary message'),
  ];
  const created = await store.createSnapshot({ ...input(), events });
  const snapshot = await createHistoryStore({ directory }).getSnapshot(created.id);
  assert.deepEqual(snapshot.entries.map(e => e.callId), ['first', 'second', 'second', 'first', 'first', undefined]);
  assert.equal(JSON.stringify(snapshot).includes('SECRET'), false);
  assert.equal(readHistorySnapshot(snapshot).items[2].callId, 'second');
  assert.equal(searchHistorySnapshot(snapshot, { query: 'second result' }).items[0].callId, 'second');
});

test('empty turn endings are omitted while useful turn status remains', async t => {
  const { store } = await fixture(t);
  const snapshot = await store.createSnapshot({ ...input(), events: [
    { type: 'turn/end' },
    { type: 'turn/end', data: { reason: {} } },
    { type: 'turn/end', data: { reason: { provider: 'ignored' } } },
    { type: 'turn/end', data: { reason: '' } },
    { type: 'turn/end', data: { reason: { kind: 'completed' }, turn: 1 } },
    { type: 'turn/end', data: { status: 'aborted' } },
  ] });
  assert.equal(snapshot.entries.length, 2);
  assert.deepEqual(snapshot.entries.map(e => e.eventIndex), [4, 5]);
  assert.match(snapshot.entries[0].text, /completed/);
  assert.match(snapshot.entries[1].text, /aborted/);
});

test('search caps returned offsets without losing text, match counts or fragment totals', async t => {
  const { store } = await fixture(t);
  const snapshot = await store.createSnapshot({ ...input(), events: [event('a'.repeat(12000)), event('a'.repeat(20)), event('a'.repeat(21))] });
  const first = searchHistorySnapshot(snapshot, { query: 'a', limit: 1 });
  assert.equal(first.total, 4);
  assert.equal(first.truncated, true);
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0].matchCount, 6000);
  assert.equal(first.items[0].offsetsTruncated, true);
  assert.deepEqual(first.items[0].matchOffsets, Array.from({ length: 20 }, (_, i) => i));
  assert.equal(first.items[0].text, 'a'.repeat(6000));
  assert.ok(Buffer.byteLength(JSON.stringify(first)) < 8000);
  const all = searchHistorySnapshot(snapshot, { query: 'a', limit: 50 });
  assert.equal(all.truncated, false);
  assert.deepEqual(all.items.map(e => e.matchCount), [6000, 6000, 20, 21]);
  assert.deepEqual(all.items.map(e => e.offsetsTruncated), [true, true, false, true]);
  assert.equal(all.items[1].matchOffsets[0], 6000);
});

test('pagination preserves all text, stable indexes and fragment provenance', async t => {
  const { store } = await fixture(t);
  const text = 'a'.repeat(5998) + '[.*]' + '尾'.repeat(7000);
  const snapshot = await store.createSnapshot({ ...input(), events: [event(text)] });
  assert.equal(snapshot.entries.length, 3);
  assert.equal(snapshot.entries.map(e => e.text).join(''), text);
  assert.deepEqual(snapshot.entries.map(e => [e.index, e.eventIndex, e.offset, e.totalChars]), [[0, 0, 0, text.length], [1, 0, 6000, text.length], [2, 0, 12000, text.length]]);
  const first = readHistorySnapshot(snapshot, { limit: 2 });
  assert.equal(first.nextStart, 2); assert.equal(first.total, 3);
  for (const key of ['id', 'hash', 'source', 'capturedAt']) assert.deepEqual(first[key], snapshot[key]);
  assert.equal(readHistorySnapshot(snapshot, { start: 2 }).nextStart, null);
  assert.deepEqual(readHistorySnapshot(snapshot, { start: 300 }).items, []);
  const result = searchHistorySnapshot(snapshot, { query: '[.*]' });
  assert.equal(result.total, 1); assert.deepEqual(result.items[0].matchOffsets, [5998]);
  assert.equal(result.items[0].index, 0);
  assert.equal(searchHistorySnapshot(snapshot, { query: 'MISSING' }).total, 0);
});

test('literal search reports totals and does not interpret patterns or case', async t => {
  const { store } = await fixture(t);
  const snapshot = await store.createSnapshot({ ...input(), events: [event('A.* A.*'), event('A.*'), event('abc')] });
  const found = searchHistorySnapshot(snapshot, { query: 'A.*', limit: 1 });
  assert.equal(found.total, 2); assert.equal(found.truncated, true);
  assert.deepEqual(found.items[0].matchOffsets, [0, 4]);
  assert.equal(searchHistorySnapshot(snapshot, { query: 'a.*' }).total, 0);
});

test('bind is idempotent, refuses replacement, and persists historical child access', async t => {
  const { store, directory } = await fixture(t);
  const snapshot = await store.createSnapshot(input()), other = await store.createSnapshot(input());
  const binding = await store.bind({ sessionId: 'session', snapshotId: snapshot.id });
  assert.equal(binding.childId, null);
  assert.deepEqual(await store.bind({ sessionId: 'session', snapshotId: snapshot.id }), binding);
  await assert.rejects(store.bind({ sessionId: 'session', snapshotId: other.id }), /different snapshot/);
  await store.setChild('session', 'child-old');
  const updated = await store.setChild('session', 'child-new');
  assert.deepEqual(updated.childIds, ['child-old', 'child-new']);
  const restart = createHistoryStore({ directory });
  assert.deepEqual(await restart.getAdvisorBinding('child-old'), updated);
  assert.deepEqual(await restart.getAdvisorBinding('child-new'), updated);
  assert.deepEqual(await restart.getBinding('session'), updated);
  assert.deepEqual(await restart.listBindings(), [updated]);
  assert.equal(await restart.getBinding('absent'), null);
  assert.equal(await restart.getAdvisorBinding('absent'), null);
  await store.bind({ sessionId: 'other', snapshotId: other.id });
  await assert.rejects(store.setChild('other', 'child-old'), /another binding/);
  await assert.rejects(store.setChild('absent', 'child'), /not found/);
  assert.equal((await stat(join(directory, 'bindings.json'))).mode & 0o777, 0o600);
  assert.equal((await readdir(directory)).some(name => name.endsWith('.tmp')), false);
});

test('clearChild uses compare-and-swap and preserves historical ownership', async t => {
  const { store } = await fixture(t), snapshot = await store.createSnapshot(input());
  await store.bind({ sessionId: 'owner', snapshotId: snapshot.id });
  await store.setChild('owner', 'old');
  const latest = await store.setChild('owner', 'new');
  assert.deepEqual(await store.clearChild('owner', 'old'), latest);
  const cleared = await store.clearChild('owner', 'new');
  assert.equal(cleared.childId, null);
  assert.deepEqual(cleared.childIds, ['old', 'new']);
  assert.deepEqual(await store.getAdvisorBinding('old'), cleared);
  assert.deepEqual(await store.getAdvisorBinding('new'), cleared);
  assert.deepEqual(await store.clearChild('owner', 'new'), cleared);
  await store.bind({ sessionId: 'other', snapshotId: snapshot.id });
  await assert.rejects(store.setChild('other', 'new'), /another binding/);
  await assert.rejects(store.clearChild('missing', 'new'), /not found/);
});

test('concurrent store instances serialize updates and reject competing child claims', async t => {
  const { store, directory } = await fixture(t);
  const second = createHistoryStore({ directory }), snapshot = await store.createSnapshot(input());
  await Promise.all([store.bind({ sessionId: 'a', snapshotId: snapshot.id }), second.bind({ sessionId: 'b', snapshotId: snapshot.id })]);
  const results = await Promise.allSettled([store.setChild('a', 'shared'), second.setChild('b', 'shared')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await store.listBindings()).length, 2);
  await second.setChild('b', 'unshared');
});

test('rejects invalid input and traversal without silently coercing values', async t => {
  const { store } = await fixture(t);
  assert.throws(() => createHistoryStore({ directory: '' }), /directory/);
  for (const id of ['../bindings', '..', '/tmp/file', '', null]) await assert.rejects(store.getSnapshot(id), /snapshot id/);
  for (const patch of [{ sourceId: '' }, { record: null }, { record: { title: 3 } }, { events: {} }, { brief: {} }]) await assert.rejects(store.createSnapshot({ ...input(), ...patch }));
  await assert.rejects(store.bind({ sessionId: 'a', snapshotId: randomUUID() }), /not found/);
  await assert.rejects(store.getBinding(''));
  const snapshot = await store.createSnapshot(input());
  for (const args of [{ start: -1 }, { start: 1.2 }, { limit: 0 }, { limit: 51 }, { start: '0' }]) assert.throws(() => readHistorySnapshot(snapshot, args));
  for (const args of [{ query: '' }, { query: 3 }, { query: 'a', limit: 0 }]) assert.throws(() => searchHistorySnapshot(snapshot, args));
});

test('rejects corrupted JSON, invalid binding shapes and tampered snapshots', async t => {
  const { store, directory } = await fixture(t);
  const snapshot = await store.createSnapshot(input()), path = join(directory, `${snapshot.id}.json`);
  const original = await readFile(path, 'utf8');
  for (const text of ['{', 'null', original.replace('hello', 'changed')]) {
    await writeFile(path, text);
    await assert.rejects(store.getSnapshot(snapshot.id));
  }
  await writeFile(path, original);
  for (const text of ['{', 'null', '{}', '[{}]']) {
    await writeFile(join(directory, 'bindings.json'), text);
    await assert.rejects(store.listBindings());
    await assert.rejects(store.bind({ sessionId: 'new', snapshotId: snapshot.id }));
    assert.equal(await readFile(join(directory, 'bindings.json'), 'utf8'), text);
  }
});

test('explicitly refuses oversized brief and snapshots without writing partial snapshots', async t => {
  const { store, directory } = await fixture(t);
  await assert.rejects(store.createSnapshot({ ...input(), brief: 'a'.repeat(100001) }), /100000/);
  await assert.rejects(store.createSnapshot({ ...input(), events: [event('x'.repeat(32 * 1024 * 1024))] }), /32 MiB/);
  const snapshot = await store.createSnapshot({ ...input(), brief: 'a'.repeat(100000) });
  assert.equal(snapshot.brief.length, 100000);
  assert.equal((await readdir(directory)).length, 1);
});

test('legacy bindings normalize on every read without writes and migrate on the next mutation', async t => {
  const { store, directory } = await fixture(t);
  const snapshot = await store.createSnapshot(input());
  const path = join(directory, 'bindings.json');
  const legacy = { sessionId: 'parent', snapshotId: snapshot.id, childId: 'current', childIds: ['old', 'current'], createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-02-01T00:00:00.000Z' };
  const text = JSON.stringify([legacy]);
  await writeFile(path, text);
  const expected = { ...legacy, links: [{ id: snapshot.id, sourceSessionId: snapshot.source.sessionId, snapshotId: snapshot.id, versions: [snapshot.id], createdAt: legacy.createdAt, updatedAt: legacy.updatedAt }] };
  assert.deepEqual(await store.getBinding('parent'), expected);
  assert.deepEqual(await store.getAdvisorBinding('old'), expected);
  assert.deepEqual(await store.listBindings(), [expected]);
  assert.deepEqual(await store.bind({ sessionId: 'parent', snapshotId: snapshot.id }), expected);
  assert.equal(await readFile(path, 'utf8'), text, 'read and idempotent bind must not rewrite a v1 file');
  const restarted = createHistoryStore({ directory });
  assert.deepEqual(await restarted.getBinding('parent'), expected);
  await restarted.setChild('parent', 'next');
  const persisted = JSON.parse(await readFile(path, 'utf8'))[0];
  assert.deepEqual(persisted.links, expected.links);
  assert.deepEqual(persisted.childIds, ['old', 'current', 'next']);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test('addLink creates an unbound session and appends sources while rejecting duplicate-source versions', async t => {
  const { store, directory } = await fixture(t);
  const first = await store.createSnapshot(input());
  const next = await store.createSnapshot(input());
  const other = await store.createSnapshot({ ...input(), sourceId: 'codex:other' });
  const initial = await store.addLink({ sessionId: 'parent', snapshotId: first.id });
  assert.equal(initial.links[0].id, first.id);
  assert.equal(initial.snapshotId, first.id);
  assert.deepEqual(initial.links[0].versions, [first.id]);
  assert.deepEqual(await store.addLink({ sessionId: 'parent', snapshotId: first.id }), initial);
  await assert.rejects(store.addLink({ sessionId: 'parent', snapshotId: next.id }), /use updateLink/);
  const multiple = await store.addLink({ sessionId: 'parent', snapshotId: other.id });
  assert.deepEqual(multiple.links.map(link => link.sourceSessionId), ['claude:source', 'codex:other']);
  assert.equal(multiple.snapshotId, first.id);
  assert.deepEqual(multiple.links[0], initial.links[0]);
  assert.deepEqual(await store.addLink({ sessionId: 'parent', snapshotId: other.id }), multiple);
  await assert.rejects(store.bind({ sessionId: 'parent', snapshotId: other.id }), /different snapshot/);
  assert.deepEqual(await store.bind({ sessionId: 'parent', snapshotId: first.id }), multiple);
  multiple.links[0].versions.push(randomUUID());
  assert.deepEqual((await createHistoryStore({ directory }).getBinding('parent')).links[0].versions, [first.id]);
});

test('updateLink retains stable source identity, historical versions and children, with strict CAS and rollback', async t => {
  const { store, directory } = await fixture(t);
  const first = await store.createSnapshot(input()), second = await store.createSnapshot(input());
  const original = await store.bind({ sessionId: 'parent', snapshotId: first.id });
  await store.setChild('parent', 'old');
  await store.setChild('parent', 'current');
  const args = { sessionId: 'parent', linkId: original.links[0].id, expectedSnapshotId: first.id, snapshotId: second.id };
  const updated = await store.updateLink(args);
  assert.equal(updated.snapshotId, second.id);
  assert.equal(updated.links[0].id, first.id);
  assert.equal(updated.links[0].sourceSessionId, first.source.sessionId);
  assert.equal(updated.links[0].createdAt, original.links[0].createdAt);
  assert.equal(updated.createdAt, original.createdAt);
  assert.deepEqual(updated.links[0].versions, [first.id, second.id]);
  assert.equal(updated.childId, 'current');
  assert.deepEqual(updated.childIds, ['old', 'current']);
  await assert.rejects(store.updateLink(args), /version conflict/);
  assert.deepEqual(await store.updateLink({ ...args, expectedSnapshotId: second.id }), updated);
  await assert.rejects(store.bind({ sessionId: 'parent', snapshotId: first.id }), /different snapshot/);
  assert.deepEqual(await store.bind({ sessionId: 'parent', snapshotId: second.id }), updated);
  const rollback = await store.updateLink({ ...args, expectedSnapshotId: second.id, snapshotId: first.id });
  assert.equal(rollback.snapshotId, first.id);
  assert.deepEqual(rollback.links[0].versions, [first.id, second.id]);
  const reopened = createHistoryStore({ directory });
  assert.deepEqual(await reopened.getAdvisorBinding('old'), rollback);
  assert.deepEqual(await reopened.getAdvisorBinding('current'), rollback);
  assert.deepEqual(await reopened.getSnapshot(first.id), first);
  assert.deepEqual(await reopened.getSnapshot(second.id), second);
});

test('updating another source leaves the compatibility snapshot on the first link', async t => {
  const { store } = await fixture(t);
  const a = await store.createSnapshot(input());
  const b = await store.createSnapshot({ ...input(), sourceId: 'codex:b' });
  const b2 = await store.createSnapshot({ ...input(), sourceId: 'codex:b' });
  await store.addLink({ sessionId: 'parent', snapshotId: a.id });
  const before = await store.addLink({ sessionId: 'parent', snapshotId: b.id });
  const args = { sessionId: 'parent', linkId: b.id, expectedSnapshotId: b.id };
  await assert.rejects(store.updateLink({ ...args, snapshotId: a.id }), /sourceSessionId mismatch/);
  assert.deepEqual(await store.getBinding('parent'), before);
  const updated = await store.updateLink({ ...args, snapshotId: b2.id });
  assert.equal(updated.snapshotId, a.id);
  assert.deepEqual(updated.links[0], before.links[0]);
  assert.equal(updated.links[1].snapshotId, b2.id);
  assert.deepEqual(updated.links[1].versions, [b.id, b2.id]);
});

test('parallel instances preserve appended sources and allow exactly one competing source update', async t => {
  const { store, directory } = await fixture(t), other = createHistoryStore({ directory });
  const a = await store.createSnapshot(input()), a2 = await store.createSnapshot(input()), a3 = await store.createSnapshot(input());
  const b = await store.createSnapshot({ ...input(), sourceId: 'b' });
  await Promise.all([store.addLink({ sessionId: 'parent', snapshotId: a.id }), other.addLink({ sessionId: 'parent', snapshotId: b.id })]);
  assert.equal((await store.getBinding('parent')).links.length, 2);
  const updates = await Promise.allSettled([
    store.updateLink({ sessionId: 'parent', linkId: a.id, expectedSnapshotId: a.id, snapshotId: a2.id }),
    other.updateLink({ sessionId: 'parent', linkId: a.id, expectedSnapshotId: a.id, snapshotId: a3.id }),
  ]);
  assert.equal(updates.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(updates.find(result => result.status === 'rejected').reason.message, /version conflict/);
  const final = await other.getBinding('parent');
  assert.equal(final.links[0].versions.length, 2);
  assert.deepEqual(final.links[1].versions, [b.id]);
  const competing = await Promise.allSettled([
    store.addLink({ sessionId: 'second-parent', snapshotId: a.id }),
    other.addLink({ sessionId: 'second-parent', snapshotId: a2.id }),
  ]);
  assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await other.getBinding('second-parent')).links.length, 1);
  assert.deepEqual(await store.getBinding('parent'), final);
});

test('malformed multi-link caches fail closed without silently normalizing or overwriting them', async t => {
  const { store, directory } = await fixture(t), snapshot = await store.createSnapshot(input());
  const binding = await store.bind({ sessionId: 'parent', snapshotId: snapshot.id });
  const path = join(directory, 'bindings.json');
  const bad = [
    { links: null }, { links: [] }, { snapshotId: randomUUID() },
    { links: [binding.links[0], binding.links[0]] },
    ...[
      { id: 'bad' }, { sourceSessionId: '' }, { versions: [] },
      { versions: [randomUUID()] }, { versions: [snapshot.id, snapshot.id] },
      { createdAt: 3 }, { updatedAt: null }, { snapshotId: randomUUID() },
    ].map(patch => ({ links: [{ ...binding.links[0], ...patch }] })),
  ];
  for (const patch of bad) {
    const text = JSON.stringify([{ ...binding, ...patch }]);
    await writeFile(path, text);
    await assert.rejects(store.getBinding('parent'));
    await assert.rejects(store.addLink({ sessionId: 'parent', snapshotId: snapshot.id }));
    assert.equal(await readFile(path, 'utf8'), text);
  }
});

test('legacy normalization validates its snapshot and leaves a missing or corrupt cache recoverable', async t => {
  const { store, directory } = await fixture(t), snapshot = await store.createSnapshot(input());
  const binding = await store.bind({ sessionId: 'parent', snapshotId: snapshot.id });
  delete binding.links;
  const path = join(directory, 'bindings.json'), snapshotPath = join(directory, `${snapshot.id}.json`);
  const cache = JSON.stringify([binding]), original = await readFile(snapshotPath, 'utf8');
  await writeFile(path, cache);
  await writeFile(snapshotPath, original.replace('hello', 'tampered'));
  await assert.rejects(store.getBinding('parent'), /hash mismatch/);
  await rm(snapshotPath);
  await assert.rejects(store.listBindings(), /Snapshot not found/);
  assert.equal(await readFile(path, 'utf8'), cache);
  await writeFile(snapshotPath, original);
  assert.equal((await store.getBinding('parent')).links[0].sourceSessionId, snapshot.source.sessionId);
});

test('link mutations validate targets and both source identities without partial writes', async t => {
  const { store, directory } = await fixture(t), a = await store.createSnapshot(input()), b = await store.createSnapshot(input());
  const binding = await store.addLink({ sessionId: 'parent', snapshotId: a.id });
  const path = join(directory, 'bindings.json'), aPath = join(directory, `${a.id}.json`), bPath = join(directory, `${b.id}.json`);
  const args = { sessionId: 'parent', linkId: a.id, expectedSnapshotId: a.id, snapshotId: b.id };
  const original = await readFile(path, 'utf8');
  for (const patch of [{ sessionId: '' }, { linkId: '../bad' }, { expectedSnapshotId: 'bad' }, { snapshotId: 'bad' }, { sessionId: 'missing' }, { linkId: randomUUID() }, { snapshotId: randomUUID() }]) await assert.rejects(store.updateLink({ ...args, ...patch }));
  await assert.rejects(store.addLink({ sessionId: 'parent', snapshotId: randomUUID() }), /not found/);
  await writeFile(bPath, (await readFile(bPath, 'utf8')).replace('hello', 'tampered'));
  await assert.rejects(store.updateLink(args), /hash mismatch/);
  assert.equal(await readFile(path, 'utf8'), original);
  await rm(aPath);
  await assert.rejects(store.updateLink({ ...args, snapshotId: a.id }), /not found/);
  assert.equal(await readFile(path, 'utf8'), original);
  // A structurally valid but wrong recorded source must not reclassify a link.
  await writeFile(aPath, JSON.stringify(a));
  await writeFile(bPath, JSON.stringify(b));
  binding.links[0].sourceSessionId = 'wrong-source';
  await writeFile(path, JSON.stringify([binding]));
  await assert.rejects(store.updateLink(args), /sourceSessionId mismatch/);
});
