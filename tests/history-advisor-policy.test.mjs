import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { apply, PRESET_ID, resolveHistoryDirectory } from '../lib/history-advisor-policy.mjs';
import { createHistoryStore } from '../lib/history-store.mjs';

function harness() {
  const effects = [], listeners = new Map(), masks = [], guards = [], sections = [];
  const own = fn => { effects.push(fn); return fn; };
  const ctx = {
    tools: {
      restrict(mask) { masks.push(mask); return own(() => masks.splice(masks.indexOf(mask), 1)); },
      guard(fn) { guards.push(fn); return own(() => guards.splice(guards.indexOf(fn), 1)); },
    },
    systemPrompt: { section(value) { sections.push(value); return own(() => sections.splice(sections.indexOf(value), 1)); } },
    on(name, fn) { listeners.set(name, fn); return own(() => listeners.delete(name)); },
    effect(fn) { return own(fn()); },
  };
  const child = id => {
    const definitions = new Map();
    const agent = { id, ctx: { tools: { register(definition) {
      if (definitions.has(definition.name)) throw new Error('Duplicate tool');
      definitions.set(definition.name, definition);
      return () => definitions.delete(definition.name);
    } } } };
    return { agent, definitions };
  };
  return { ctx, child, masks, guards, sections,
    created: (agent, source = 'startup', signal) => listeners.get('agent/created')({ agent, source, signal }),
    dispose() { for (const dispose of effects.reverse()) dispose(); },
  };
}
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'focusing-advisor-policy-'));
  // Only delete this exact mkdtemp result, verified under the intended temp root.
  assert.equal(resolve(directory).startsWith(resolve(tmpdir()) + '/focusing-advisor-policy-'), true);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createHistoryStore({ directory });
  const snapshot = await store.createSnapshot({ sourceId: 'source', record: { title: 'Original chat' }, brief: 'PRIVATE BRIEF', events: [
    { type: 'user/message', data: { content: 'alpha evidence' } },
    { type: 'user/message', data: { content: 'beta evidence' } },
  ] });
  await store.bind({ sessionId: 'main', snapshotId: snapshot.id });
  await store.setChild('main', 'child');
  const host = harness();
  apply(host.ctx, { directory });
  return { directory, store, snapshot, host, ...host.child('child') };
}
const exec = agent => ({ agent, signal: new AbortController().signal });
const snapshotInput = (sourceId, text) => ({ sourceId, record: { title: sourceId }, brief: 'private orientation', events: [{ type: 'user/message', data: { content: text } }] });

async function multipleSources(store) {
  const second = await store.createSnapshot(snapshotInput('second-source', 'second source evidence'));
  const binding = await store.addLink({ sessionId: 'main', snapshotId: second.id });
  return { second, binding, firstLink: binding.links[0], secondLink: binding.links[1] };
}

test('preset policy denies every capability except the three bound history tools', async t => {
  const { host, agent, definitions } = await fixture(t);
  assert.equal(PRESET_ID, 'focusing-history-advisor');
  assert.deepEqual(host.masks, [{ allow: [] }]);
  assert.equal(definitions.size, 0);
  await host.created(agent);
  await host.created(agent); // repeated announcement does not duplicate registration
  assert.deepEqual([...definitions.keys()], ['focus_history_read', 'focus_history_search', 'focus_history_list']);
  for (const name of ['bash', 'read', 'write', 'edit', 'subagent', 'subagent_fork', 'send_message', 'workflow', 'run_code', 'plugin_manager', 'unknown']) {
    assert.equal(typeof host.guards[0]({ name, agent }), 'string', name);
  }
  for (const name of definitions.keys()) assert.equal(host.guards[0]({ name, agent }), undefined);
  assert.equal(host.sections[0].text.includes('PRIVATE BRIEF'), false);
  assert.match(host.sections[0].text, /untrusted evidence/);
  host.dispose();
  assert.equal(definitions.size, 0);
  assert.equal(host.guards.length, 0);
});

test('tools read and search only the caller binding with pagination and provenance', async t => {
  const { host, agent, definitions, snapshot } = await fixture(t);
  await host.created(agent);
  const read = definitions.get('focus_history_read'), search = definitions.get('focus_history_search');
  const first = JSON.parse(await read.execute({ start: 0, limit: 1 }, exec(agent)));
  assert.equal(first.id, snapshot.id);
  assert.equal(first.nextStart, 1);
  assert.equal(first.items[0].text, 'alpha evidence');
  assert.equal(first.contentIsUntrusted, true);
  const found = JSON.parse(await search.execute({ query: 'beta', limit: 1 }, exec(agent)));
  assert.equal(found.items[0].index, 1);
  assert.equal(found.source.sessionId, 'source');
  assert.deepEqual(read.output.render({}, 'result'), [{ type: 'text', text: 'result' }]);
});

test('rejects injected snapshot/path/session targets, spoofed caller and invalid query bounds', async t => {
  const { host, agent, definitions } = await fixture(t);
  await host.created(agent);
  const read = definitions.get('focus_history_read'), search = definitions.get('focus_history_search');
  for (const args of [null, [], { snapshotId: 'other' }, { sessionId: 'other' }, { path: '/etc/passwd' }, { start: -1 }, { limit: 51 }, { start: '0' }]) {
    await assert.rejects(read.execute(args, exec(agent)));
  }
  for (const args of [{}, { query: '' }, { query: 3 }, { query: 'a', path: '/tmp' }]) await assert.rejects(search.execute(args, exec(agent)));
  await assert.rejects(read.execute({}, exec({ id: agent.id })), /caller/);
  await assert.rejects(read.execute({}, {}), /caller/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(read.execute({}, { agent, signal: controller.signal }), /abort/i);
});

test('created gate blocks unbound, missing and corrupt durable state before tools publish', async t => {
  const { host, snapshot, directory } = await fixture(t);
  const unbound = host.child('unbound');
  await assert.rejects(host.created(unbound.agent), /binding/);
  assert.equal(unbound.definitions.size, 0);
  const child = host.child('child');
  await writeFile(join(directory, `${snapshot.id}.json`), '{');
  await assert.rejects(host.created(child.agent));
  assert.equal(child.definitions.size, 0);
  // Verified fixture snapshot path; remove only this exact generated snapshot.
  const snapshotPath = join(directory, `${snapshot.id}.json`);
  assert.equal(resolve(snapshotPath).startsWith(resolve(directory) + '/'), true);
  await rm(snapshotPath);
  await assert.rejects(host.created(child.agent), /unavailable/);
  await writeFile(join(directory, 'bindings.json'), '{');
  await assert.rejects(host.created(child.agent));
});

test('existing tools reread disk and fail closed if bindings or snapshot become corrupt', async t => {
  const { host, agent, definitions, snapshot, directory } = await fixture(t);
  await host.created(agent);
  const read = definitions.get('focus_history_read');
  await writeFile(join(directory, `${snapshot.id}.json`), JSON.stringify({ ...snapshot, brief: 'tampered' }));
  await assert.rejects(read.execute({}, exec(agent)), /hash/);
  await writeFile(join(directory, `${snapshot.id}.json`), JSON.stringify(snapshot));
  await writeFile(join(directory, 'bindings.json'), '[]');
  await assert.rejects(read.execute({}, exec(agent)), /binding/);
});

test('one child discovers added sources and version updates while retaining exact old evidence', async t => {
  const { host, agent, definitions, store, snapshot } = await fixture(t);
  await host.created(agent);
  const call = async (name, args = {}) => JSON.parse(await definitions.get(name).execute(args, exec(agent)));
  const { firstLink, secondLink, second } = await multipleSources(store);
  const initial = await call('focus_history_list');
  assert.equal(initial.links.length, 2);
  assert.equal(initial.links[1].linkId, secondLink.id);
  assert.equal(initial.links[1].current.snapshotId, second.id);
  assert.equal(initial.links[1].current.source.sessionId, 'second-source');
  assert.equal(JSON.stringify(initial).includes('private orientation'), false);
  assert.equal(JSON.stringify(initial).includes('second source evidence'), false);
  assert.equal((await call('focus_history_read', { linkId: secondLink.id })).items[0].text, 'second source evidence');
  assert.equal((await call('focus_history_search', { snapshotId: second.id, query: 'evidence' })).linkId, secondLink.id);
  const next = await store.createSnapshot(snapshotInput('source', 'updated evidence'));
  await store.updateLink({ sessionId: 'main', linkId: firstLink.id, expectedSnapshotId: snapshot.id, snapshotId: next.id });
  const latest = await call('focus_history_read');
  assert.equal(latest.snapshotId, next.id);
  assert.equal(latest.capturedAt, next.capturedAt);
  assert.equal(latest.isCurrent, true);
  assert.equal(latest.items[0].text, 'updated evidence');
  const old = await call('focus_history_read', { snapshotId: snapshot.id });
  assert.equal(old.items[0].text, 'alpha evidence');
  assert.equal(old.isCurrent, false);
  assert.equal(old.snapshotId, snapshot.id);
  assert.equal(old.capturedAt, snapshot.capturedAt);
  assert.equal((await call('focus_history_search', { linkId: firstLink.id, snapshotId: snapshot.id, query: 'beta' })).items[0].index, 1);
  const versions = (await call('focus_history_list')).links[0].versions;
  assert.deepEqual(versions.map(v => [v.snapshotId, v.current]), [[snapshot.id, false], [next.id, true]]);
  // Current may point to an older version; never infer it from array position.
  await store.updateLink({ sessionId: 'main', linkId: firstLink.id, expectedSnapshotId: next.id, snapshotId: snapshot.id });
  const rolledBack = await call('focus_history_list');
  assert.equal(rolledBack.links[0].current.snapshotId, snapshot.id);
  assert.equal((await call('focus_history_read')).snapshotId, snapshot.id);
  assert.equal((await call('focus_history_read', { snapshotId: next.id })).isCurrent, false);
});

test('version selectors never authorize another source or a snapshot merely present on disk', async t => {
  const { host, agent, definitions, store } = await fixture(t);
  const { firstLink, second } = await multipleSources(store);
  const external = await store.createSnapshot(snapshotInput('external', 'must not disclose'));
  await store.bind({ sessionId: 'other-main', snapshotId: external.id });
  await host.created(agent);
  for (const name of ['focus_history_read', 'focus_history_search']) {
    const tool = definitions.get(name);
    for (const selector of [{ snapshotId: external.id }, { linkId: firstLink.id, snapshotId: second.id }, { linkId: 'missing' }, { snapshotId: '' }, { linkId: null }]) {
      await assert.rejects(tool.execute({ ...(name.endsWith('search') ? { query: 'evidence' } : {}), ...selector }, exec(agent)));
    }
  }
  await assert.rejects(definitions.get('focus_history_list').execute({ snapshotId: external.id }, exec(agent)));
});

test('created gate validates every current source and rejects corrupt secondary snapshots', async t => {
  const { host, agent, definitions, store, directory } = await fixture(t);
  const { second } = await multipleSources(store);
  await writeFile(join(directory, `${second.id}.json`), '{');
  await assert.rejects(host.created(agent));
  assert.equal(definitions.size, 0);
});

test('new preset instance resumes the same child using persisted binding and owns cleanup', async t => {
  const { host, directory, snapshot, store } = await fixture(t);
  const { secondLink, second } = await multipleSources(store);
  host.dispose();
  const resumed = harness();
  apply(resumed.ctx, { directory });
  const { agent, definitions } = resumed.child('child');
  await resumed.created(agent, 'resume');
  assert.equal(JSON.parse(await definitions.get('focus_history_read').execute({}, exec(agent))).id, snapshot.id);
  assert.equal(JSON.parse(await definitions.get('focus_history_read').execute({ linkId: secondLink.id }, exec(agent))).snapshotId, second.id);
  assert.equal(JSON.parse(await definitions.get('focus_history_list').execute({}, exec(agent))).links.length, 2);
  resumed.dispose();
  assert.equal(definitions.size, 0);
  assert.equal(typeof resolveHistoryDirectory(), 'string');
});
