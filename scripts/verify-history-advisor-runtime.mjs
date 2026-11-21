// Run using the installation's Electron (ELECTRON_RUN_AS_NODE=1), passing its
// package resolution root as argv[2]. No server, profile changes or model calls.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { createHistoryStore } from '../lib/history-store.mjs';
import * as policy from '../lib/history-advisor-policy.mjs';

if (!process.argv[2]) throw new Error('Usage: verify-history-advisor-runtime.mjs <DSH runtime package resolution root>');
const runtimeRoot = resolve(process.argv[2]);
const requireRuntime = createRequire(join(runtimeRoot, 'package.json'));
const load = name => import(pathToFileURL(requireRuntime.resolve(name)).href);
const { Context, Service } = await load('@deepseek-ai/cordis');
const { createScope, scopeTarget } = await load('@deepseek-ai/dsh-scope');
const { default: Tools } = await load('@deepseek-ai/dsh-tools');
const native = await load('@deepseek-ai/dsh-tool-executor-native');

// Prompt rendering is outside this test; the tool registry, scope routing,
// execution pipeline, native executor and policy module are the real modules.
class PromptStub extends Service {
  constructor(ctx) { super(ctx, 'systemPrompt'); }
  tools() { return this.ctx.effect(() => () => {}); }
  section() { return this.ctx.effect(() => () => {}); }
}
const directory = await mkdtemp(join(tmpdir(), 'focusing-advisor-runtime-'));
const root = new Context();
let verified = false;
try {
  const store = createHistoryStore({ directory });
  const snapshot = await store.createSnapshot({
    sourceId: 'runtime-source', record: { title: 'Runtime test' }, brief: 'Test history',
    events: ['first evidence', 'needle evidence', 'last evidence'].map(content => ({ type: 'user/message', data: { content } })),
  });
  await store.bind({ sessionId: 'runtime-parent', snapshotId: snapshot.id });
  await store.setChild('runtime-parent', 'runtime-child');
  await root.plugin(PromptStub);
  await root.plugin(Tools);
  await root.plugin({
    inject: ['tools', 'systemPrompt'],
    async apply(ctx) {
      const dummy = name => ({ name, description: name, parameters: { type: 'object', properties: {} },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        execute: async () => { throw new Error('Forbidden tool executed'); } });
      ctx.tools.register(dummy('bash'));
      const presetKey = {};
      const preset = createScope(ctx, presetKey);
      const agent = { id: 'runtime-child' };
      const child = createScope(ctx, agent, { parent: presetKey });
      agent.ctx = child.ctx;
      const unboundAgent = { id: 'runtime-unbound' };
      const unbound = createScope(ctx, unboundAgent, { parent: presetKey });
      unboundAgent.ctx = unbound.ctx;
      try {
        await preset.ctx.plugin(native);
        await preset.ctx.plugin(policy, { directory });
        const signal = new AbortController().signal;
        const created = value => ctx.serial(scopeTarget(value, value), 'agent/created', { agent: value, source: 'resume', signal });
        await assert.rejects(created(unboundAgent), /binding/);
        await created(agent);
        await created(agent); // idempotent, no duplicate own-scope registration
        const names = ['focus_history_read', 'focus_history_search', 'focus_history_list'];
        assert.equal(child.ctx.tools.get('bash', agent), undefined);
        for (const name of names) assert.ok(child.ctx.tools.get(name, agent));
        // Even an unexpected own-scope dangerous tool cannot bypass the guard.
        child.ctx.tools.register(dummy('write'));
        assert.ok(child.ctx.tools.checkGuards({ agent, name: 'write' }));
        assert.equal(child.ctx.tools.checkGuards({ agent, name: names[0] }), undefined);
        const run = async (name, args) => {
          const batch = await child.ctx.tools.execute({
            agent, signal,
            calls: [{ type: 'tool_call', id: `call-${name}`, name, arguments: JSON.stringify(args) }],
          });
          assert.equal(batch.results.length, 1);
          return batch.results[0].result;
        };
        const pageResult = await run(names[0], { start: 1, limit: 1 });
        assert.equal(pageResult.isError, false, JSON.stringify(pageResult));
        const page = JSON.parse(pageResult.content.find(block => block.type === 'text').text);
        assert.equal(page.id, snapshot.id);
        assert.equal(page.items[0].text, 'needle evidence');
        assert.equal(page.nextStart, 2);
        const searchResult = await run(names[1], { query: 'needle', limit: 1 });
        assert.equal(searchResult.isError, false, JSON.stringify(searchResult));
        const found = JSON.parse(searchResult.content.find(block => block.type === 'text').text);
        assert.equal(found.items[0].index, 1);
        const decode = result => {
          assert.equal(result.isError, false, JSON.stringify(result));
          return JSON.parse(result.content.find(block => block.type === 'text').text);
        };
        const secondary = await store.createSnapshot({ sourceId: 'runtime-secondary', record: {}, events: [{ type: 'user/message', data: { content: 'second source' } }] });
        const binding = await store.addLink({ sessionId: 'runtime-parent', snapshotId: secondary.id });
        const listing = decode(await run(names[2], {}));
        assert.equal(listing.links.length, 2);
        assert.equal(listing.links[1].current.snapshotId, secondary.id);
        assert.equal(decode(await run(names[0], { linkId: binding.links[1].id })).snapshotId, secondary.id);
        const updated = await store.createSnapshot({ sourceId: 'runtime-source', record: {}, events: [{ type: 'user/message', data: { content: 'new version' } }] });
        await store.updateLink({ sessionId: 'runtime-parent', linkId: binding.links[0].id, expectedSnapshotId: snapshot.id, snapshotId: updated.id });
        const current = decode(await run(names[0], {}));
        assert.equal(current.snapshotId, updated.id);
        assert.equal(current.capturedAt, updated.capturedAt);
        assert.equal(current.isCurrent, true);
        const previous = decode(await run(names[0], { snapshotId: snapshot.id }));
        assert.equal(previous.snapshotId, snapshot.id);
        assert.equal(previous.isCurrent, false);
        assert.equal((await run(names[0], { linkId: binding.links[0].id, snapshotId: secondary.id })).isError, true);
        const foreign = await store.createSnapshot({ sourceId: 'runtime-foreign', record: {}, events: [] });
        assert.equal((await run(names[0], { snapshotId: foreign.id })).isError, true);
        assert.equal((await run('write', {})).isError, true);
        assert.equal((await run('bash', {})).isError, true);
        assert.equal((await run(names[0], { snapshotId: 'other' })).isError, true);
        await preset.dispose();
        for (const name of names) assert.equal(child.ctx.tools.get(name, agent), undefined);
        // No fallback executor after the scoped executor is removed.
        await assert.rejects(run(names[0], {}), /executor/i);
        verified = true;
      } finally {
        await unbound.dispose();
        await child.dispose();
        await preset.dispose();
      }
    },
  });
  assert.equal(verified, true, 'Cordis plugin did not finish verification');
  console.log(JSON.stringify({ ok: true, electron: process.versions.electron ?? null,
    checks: ['real scoped registry', 'inherited tools hidden', 'created gate rejects unbound child',
      'native executor pagination', 'native executor literal search', 'own-scope dangerous tool guard',
      'multi-source list and selection', 'same child reads updated current version', 'old version access',
      'foreign snapshot and mismatched source rejection', 'preset disposal removes child tools', 'disposed executor fails closed'] }, null, 2));
} finally {
  await root.fiber.dispose();
  // Never remove an unchecked computed target: only this exact mkdtemp child.
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(directory.startsWith(join(tmpdir(), 'focusing-advisor-runtime-')));
  await rm(directory, { recursive: true, force: true });
}
