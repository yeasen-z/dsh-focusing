import test from 'node:test';
import assert from 'node:assert/strict';
import { createContextSource } from '../lib/context-source.mjs';
import { createRecordIndex } from '../lib/record-index.mjs';

test('native picker uses current sidebar titles and activity timestamps without reading logs', async () => {
  const index = createRecordIndex(() => ({ controller: { list: async () => ({ items: [
    { sessionId: 'main', cwd: '/project', projections: { values: { title: 'Renamed session' } }, createdAt: 100, updatedAt: 200 },
    { sessionId: 'child', parentSessionId: 'main' }, { sessionId: 'blank', blank: true },
  ] }) }, query: { readSession: () => { throw new Error('must not read transcripts'); } } }));
  assert.deepEqual(await index.catalog(), [{ id: 'main', source: 'dsh', title: 'Renamed session', cwd: '/project', createdAt: 100, updatedAt: 200 }]);
});

test('native picker falls back with a warning if sidebar metadata is unavailable', async () => {
  const index = createRecordIndex(() => ({ controller: { list: async () => { throw new Error('offline'); } }, persistence: { list: async () => [
    { header: { id: 'main', title: 'Fallback', cwd: '/project', createdAt: 100 } },
    { header: { id: 'child', parentSession: 'main' } },
  ] } }));
  const rows = await index.catalog();
  assert.equal(rows.length, 1); assert.equal(rows[0].title, 'Fallback');
  assert.equal(rows[0].createdAt, 100);
  assert.match(index.errors().join(), /titles unavailable/);
});

test('snapshot source picker combines metadata without opening transcripts and excludes native children', async () => {
  const source = createContextSource({
    errors: () => [],
    catalog: async () => [{ id: 'native', title: 'Native', source: 'dsh', cwd: '/native' }, { id: 'child', origin: 'subagent' }],
    events: () => { throw new Error('should not read logs'); },
  }, { codex: { chats: () => [{ id: 'imported', firstPrompt: 'Imported', cwd: '/external', path: '/must-not-open' }], stream: () => { throw new Error('should not read logs'); } } });
  assert.deepEqual(await source.catalog(), [
    { id: 'native', title: 'Native', source: 'dsh', cwd: '/native' },
    { id: 'codex:imported', title: 'Imported', source: 'codex', cwd: '/external', firstPrompt: 'Imported', createdAt: null, updatedAt: null },
  ]);
});

test('keyword discovery can read many transcripts from one catalog snapshot per source', async () => {
  let nativeLists = 0;
  let importedLists = 0;
  const index = createRecordIndex(() => ({
    persistence: { list: async () => { nativeLists++; return ['one', 'two'].map(id => ({ header: { id } })); } },
    query: { readSession: async id => ({ events: [id] }) },
  }));
  const source = createContextSource(index, { codex: {
    chats: () => { importedLists++; return ['three', 'four'].map(id => ({ id, path: id })); },
    stream: async (id, emit) => { emit(id); return { id }; },
  } });
  const reader = await source.eventsReader(['dsh', 'codex']);
  const ids = ['one', 'two', 'codex:three', 'codex:four'];
  const results = await Promise.all(ids.map(reader));
  assert.deepEqual(results.map(result => result.events[0]), ['one', 'two', 'three', 'four']);
  assert.equal(nativeLists, 1);
  assert.equal(importedLists, 1);
});

test('source picker reports partial-source failures and honors cancellation', async () => {
  const source = createContextSource({ errors: () => [], catalog: async () => [{ id: 'native' }] }, {
    codex: { chats: () => { throw new Error('source offline'); } },
  });
  assert.deepEqual(await source.catalog(), [{ id: 'native' }]);
  assert.match(source.errors().join(), /source offline/);
  await assert.rejects(source.catalog({ signal: AbortSignal.abort(new Error('cancelled')) }), /cancelled/);
});
