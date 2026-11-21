import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHistoryAdvisor } from '../lib/history-advisor.mjs';
import { createHistoryStore } from '../lib/history-store.mjs';

test('main Agent context discovers links, follows current versions, and disposes without copying historical instructions', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'focusing-history-context-'));
  const effects = [], hooks = new Map(), contexts = new Map();
  t.after(async () => {
    for (const dispose of effects.reverse()) await dispose?.();
    assert.ok(directory.startsWith(join(tmpdir(), 'focusing-history-context-')));
    await rm(directory, { recursive: true, force: true });
  });
  const store = createHistoryStore({ directory });
  const parent = { id: 'parent', ctx: { get: name => name === 'systemPrompt' ? { context: value => {
    assert.equal(contexts.has(value.name), false, 'one registration per agent');
    contexts.set(value.name, value);
    return () => contexts.delete(value.name);
  } } : undefined } };
  const services = {
    agents: { get: id => id === parent.id ? parent : undefined },
    subagents: { startActivation() {}, sendMessage() {}, listDescendants() {} },
    agentPresets: { resolve: async () => ({}) },
  };
  const ctx = { get: name => services[name], on: (event, fn) => hooks.set(event, fn), effect: fn => { const dispose = fn(); effects.push(dispose); return dispose; } };
  const advisor = createHistoryAdvisor(ctx, { store });
  const created = hooks.get('agent/created');
  await created({ agent: parent });
  assert.equal(contexts.size, 0, 'unbound sessions receive no added context');
  const snapshot = sourceId => store.createSnapshot({ sourceId, record: { title: 'Untrusted title' }, events: [{ type: 'user/message', data: { content: 'HISTORICAL INSTRUCTIONS MUST NOT BE INJECTED' } }] });
  const first = await snapshot('codex:one');
  await store.bind({ sessionId: parent.id, snapshotId: first.id });
  await created({ agent: parent });
  const context = contexts.get('focusing:linked-snapshots');
  assert.ok(context.text().includes(first.id));
  assert.ok(context.text().includes('focus_history_advisor'));
  assert.equal(context.text().includes('HISTORICAL INSTRUCTIONS'), false);
  assert.equal(context.text().includes('Untrusted title'), false);
  const second = await snapshot('claude:two');
  await store.addLink({ sessionId: parent.id, snapshotId: second.id });
  await advisor.status(parent.id);
  assert.ok(context.text().includes(second.id));
  const next = await snapshot('codex:one');
  await store.updateLink({ sessionId: parent.id, linkId: first.id, expectedSnapshotId: first.id, snapshotId: next.id });
  await advisor.status(parent.id);
  assert.ok(context.text().includes(`"snapshotId":"${next.id}"`));
  assert.equal(context.text().includes(`"snapshotId":"${first.id}"`), false);
  assert.equal(contexts.size, 1);
  await created({ agent: { id: 'unbound-child', ctx: parent.ctx } });
  assert.equal(contexts.size, 1, 'other agents cannot inherit this session binding');
  for (const dispose of effects.splice(0).reverse()) await dispose?.();
  assert.equal(contexts.size, 0);
});
