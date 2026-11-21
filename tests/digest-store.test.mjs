import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDigestStore } from '../lib/digest-store.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'digest-checkpoint-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return join(root, 'digests.json');
}
test('concurrent first reads wait for existing checkpoints and writes retain private modes', async t => {
  const file = await fixture(t);
  await writeFile(file, JSON.stringify({ digests: [{ id: 'old', status: 'running', pipeline: { nodes: [] } }] }));
  const store = createDigestStore({ file });
  const [first, list, second] = await Promise.all([store.get('old'), store.list(), store.get('old')]);
  assert.equal(first.id, 'old');
  assert.equal(second.id, 'old');
  assert.equal(list[0].status, 'interrupted');
  assert.equal(list[0].retryable, true);
  assert.equal(list[0].pipeline, undefined);
  await store.put({ id: 'new', status: 'done' });
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).digests.map(d => d.id), ['new', 'old']);
});
test('failed checkpoint writes reject instead of claiming success and later writes recover', async t => {
  const file = await fixture(t);
  const store = createDigestStore({ file });
  await store.load();
  await mkdir(file); // destination is deliberately not a regular file
  await assert.rejects(store.put({ id: 'first' }));
  await rm(file, { recursive: true });
  await store.put({ id: 'second' });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).digests.map(d => d.id), ['second', 'first']);
});
test('corrupt checkpoints are reported and never overwritten by a new empty store', async t => {
  const file = await fixture(t);
  await writeFile(file, 'not json');
  const store = createDigestStore({ file });
  await assert.rejects(store.get('old'));
  await assert.rejects(store.put({ id: 'new' }));
  assert.equal(await readFile(file, 'utf8'), 'not json');
});
