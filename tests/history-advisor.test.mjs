import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHistoryAdvisor, historyInitialPrompt, registerHistoryAdvisorRoutes, ROUTE_HISTORY_ADVISOR } from '../lib/history-advisor.mjs';
import { createHistoryStore } from '../lib/history-store.mjs';
import { PRESET_ID } from '../lib/history-advisor-policy.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
async function host(t) {
  const root = await mkdtemp(join(tmpdir(), 'focusing-advisor-test-'));
  const directory = join(root, 'history'), cwd = join(root, 'workspace'), elsewhere = join(root, 'other');
  await Promise.all([mkdir(cwd), mkdir(elsewhere)]);
  const disposers = [], routes = new Map(), starts = [], sends = [], validations = [], statReads = [], presetReads = [], sourceReads = [];
  const parent = { id: 'parent', prompt: () => { throw new Error('Must never prompt the main session'); } };
  let disposalCount = 0;
  const state = {
    digest: { id: 'digest', kind: 'handoff', status: 'done', range: { key: 'session', label: 'Session', from: '2026-01-01', to: '2026-01-02' }, sessionIds: ['source'], sources: [{ id: 'source', title: 'Past work' }], createdAt: 1000, finishedAt: 2000, request: 'Handoff', stats: { sessions: 1, projects: 1, activeDays: 1, calls: 0 }, result: { title: 'Handoff', summary: 'Historical summary', projects: [], days: [], next: [], sections: [] } },
    raw: { header: { cwd }, events: [{ type: 'user/message', time: 1000, data: { content: 'original request' } }, { type: 'assistant/message', time: 2000, data: { message: { content: [{ type: 'text', text: 'original answer' }] } } }] },
    target: { header: { cwd, origin: 'user' } },
    sourceEnabled: true,
    sourceRaws: new Map(),
    catalog: [{ id: 'source', title: 'Past work', source: 'dsh', cwd }, { id: 'parent', title: 'Current session', source: 'dsh', cwd }],
    catalogReads: [],
    warnings: [],
  };
  const store = createHistoryStore({ directory });
  const services = {
    agents: { get: () => undefined },
    sessions: { get: () => undefined },
    agentPresets: { resolve: async id => { presetReads.push(id); return { id }; } },
    sessionController: {
      events: async (args, signal) => { validations.push({ args, signal }); return { records: [], hasMore: false, cursor: null }; },
      prompt: () => { throw new Error('Must never send a main-session prompt'); },
      sendMessage: () => { throw new Error('Must never send a main-session message'); },
    },
    sessionPersistence: { stat: async (sessionId, options) => { statReads.push({ sessionId, options }); return sessionId === parent.id ? state.target : undefined; } },
    subagents: {
      listDescendants: async parentId => {
        const binding = await store.getBinding(parentId);
        return binding?.childId ? [{ id: binding.childId, kind: 'child', mode: 'continuable', parentId }] : [];
      },
      startActivation: async spec => {
        starts.push(spec);
        const persisted = await createHistoryStore({ directory }).getAdvisorBinding(spec.childId);
        assert.equal(persisted?.sessionId, parent.id, 'child identity is durable before activation');
        assert.equal(persisted.childId, spec.childId);
        return { dispose: () => { disposalCount++; } };
      },
      sendMessage: async (...args) => { sends.push(args); return { accepted: true }; },
    },
  };
  const ctx = { get: name => services[name], effect: fn => { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose); }, connection: { fetch: { register: route => { routes.set(route.path, route); return () => routes.delete(route.path); } } } };
  const advisor = createHistoryAdvisor(ctx, { directory, store, source: () => state.sourceEnabled ? {
    events: async (id, options) => { sourceReads.push({ id, options }); return state.sourceRaws.has(id) ? state.sourceRaws.get(id) : id === 'source' ? state.raw : undefined; },
    catalog: async options => { state.catalogReads.push(options); return state.catalog; },
    errors: () => state.warnings,
  } : null, getDigest: async id => id === 'digest' ? state.digest : null });
  t.after(async () => { for (const dispose of disposers.splice(0)) await dispose(); await rm(root, { recursive: true, force: true }); });
  const attach = async () => { const prepared = await advisor.prepare('digest'); await advisor.bind(parent.id, prepared.snapshot.id); return prepared; };
  return { root, directory, cwd, elsewhere, parent, state, store, services, ctx, advisor, attach, starts, sends, validations, statReads, presetReads, sourceReads, routes, disposers, disposalCount: () => disposalCount };
}

function manifestOf(text) {
  const marker = 'Current linked snapshots (this request):\n';
  assert.ok(text.includes(marker));
  return JSON.parse(text.split(marker)[1].split('\n')[0]);
}
function routeClient(h) {
  registerHistoryAdvisorRoutes(h.ctx, h.advisor);
  return async body => {
    const response = await h.routes.get(ROUTE_HISTORY_ADVISOR).fetch(new Request(`http://localhost${ROUTE_HISTORY_ADVISOR}`, { method: 'POST', body: JSON.stringify({ sessionId: h.parent.id, ...body }) }));
    return { status: response.status, body: await response.json() };
  };
}
function extraSource(h, id = 'claude:second') {
  const raw = structuredClone(h.state.raw);
  raw.header.cwd = h.elsewhere;
  raw.events[0].data.content = 'second source request';
  h.state.sourceRaws.set(id, raw);
  h.state.catalog.push({ id, title: 'Other workspace work', source: 'claude', cwd: h.elsewhere });
  return raw;
}

test('prepare requires a done single-session handoff', async t => {
  const h = await host(t), good = structuredClone(h.state.digest);
  for (const patch of [{ status: 'running' }, { status: 'error' }, { kind: 'weekly' }, { range: { key: 'week' } }, { sessionIds: [] }, { sessionIds: ['a', 'b'] }, { note: 'empty' }]) {
    h.state.digest = { ...good, ...patch };
    await assert.rejects(h.advisor.prepare('digest'), /completed, single-session handoff/);
  }
  await assert.rejects(h.advisor.prepare('missing'), /completed/);
  h.state.digest = good;
  assert.ok((await h.advisor.prepare('digest')).snapshot.id);
  assert.ok(h.presetReads.every(id => id === PRESET_ID));
});

test('prepare rejects disabled source, unavailable events and absent working directory', async t => {
  const h = await host(t);
  h.state.sourceEnabled = false;
  await assert.rejects(h.advisor.prepare('digest'), /sources are unavailable/);
  h.state.sourceEnabled = true;
  const raw = h.state.raw;
  h.state.raw = null;
  await assert.rejects(h.advisor.prepare('digest'), /source session is unavailable/);
  h.state.raw = { header: { cwd: h.cwd }, events: [] };
  await assert.rejects(h.advisor.prepare('digest'), /source session is unavailable/);
  h.state.raw = { ...raw, header: {} };
  await assert.rejects(h.advisor.prepare('digest'), /no working directory/);
});

test('prepare freezes data and marks shortened initial context while retaining full brief', async t => {
  const h = await host(t);
  h.state.digest.result.summary = 'z'.repeat(12000) + 'END OF BRIEF';
  const prepared = await h.advisor.prepare('digest', 'en');
  const before = await h.store.getSnapshot(prepared.snapshot.id);
  assert.match(prepared.prompt, /Brief shortened/);
  assert.match(prepared.prompt, /snapshot is fixed/i);
  assert.ok(before.brief.includes('END OF BRIEF'));
  assert.ok(!prepared.prompt.includes('END OF BRIEF'));
  assert.match(historyInitialPrompt(before, 'zh'), /交接已缩短/);
  h.state.raw.events[0].data.content = 'new live content';
  h.state.digest.result.summary = 'new report';
  assert.deepEqual(await h.store.getSnapshot(prepared.snapshot.id), before);
  assert.equal(before.entries[0].text, 'original request');
  assert.equal(h.starts.length, 0); assert.equal(h.sends.length, 0);
});

test('bind validates controller events and canonical cwd, rejects children and other directories, and is idempotent', async t => {
  const h = await host(t), prepared = await h.advisor.prepare('digest');
  const signal = new AbortController().signal;
  h.state.target = { header: { cwd: h.cwd, origin: 'subagent' } };
  await assert.rejects(h.advisor.bind(h.parent.id, prepared.snapshot.id, signal), /ordinary DSH session/);
  h.state.target = { header: {} };
  await assert.rejects(h.advisor.bind(h.parent.id, prepared.snapshot.id), /working directory/);
  h.state.target = { header: { cwd: h.elsewhere } };
  await assert.rejects(h.advisor.bind(h.parent.id, prepared.snapshot.id), /different workspaces/);
  const alias = join(h.root, 'workspace-alias'); await symlink(h.cwd, alias);
  h.state.target = { header: { cwd: alias } };
  const first = await h.advisor.bind(h.parent.id, prepared.snapshot.id, signal);
  assert.deepEqual(await h.advisor.bind(h.parent.id, prepared.snapshot.id), first);
  assert.deepEqual(h.validations[0], { args: { address: { kind: 'session', sessionId: h.parent.id }, maxMessages: 1 }, signal });
  assert.deepEqual(h.statReads[0], { sessionId: h.parent.id, options: { signal } });
  assert.equal((await h.advisor.status(h.parent.id)).bound, true);
  assert.equal((await h.advisor.status('unbound')).bound, false);
  assert.equal(h.starts.length, 0); assert.equal(h.sends.length, 0);
});

test('bind fails closed when persistence stat is absent, missing or rejects', async t => {
  const h = await host(t), prepared = await h.advisor.prepare('digest');
  const persistence = h.services.sessionPersistence;
  delete h.services.sessionPersistence;
  await assert.rejects(h.advisor.bind(h.parent.id, prepared.snapshot.id), /validation is unavailable/);
  assert.equal(h.validations.length, 0);
  h.services.sessionPersistence = {};
  await assert.rejects(h.advisor.bind(h.parent.id, prepared.snapshot.id), /validation is unavailable/);
  h.services.sessionPersistence = persistence;
  const original = persistence.stat;
  persistence.stat = async () => undefined;
  await assert.rejects(h.advisor.bind(h.parent.id, prepared.snapshot.id), /ordinary DSH session/);
  const failure = new Error('persistence permission denied');
  persistence.stat = async () => { throw failure; };
  await assert.rejects(h.advisor.bind(h.parent.id, prepared.snapshot.id), error => error === failure);
  assert.equal(await h.store.getBinding(h.parent.id), null);
  persistence.stat = original;
  await h.advisor.bind(h.parent.id, prepared.snapshot.id);
});

test('bind authorizes the ordinary address before reading persistence headers', async t => {
  const h = await host(t), prepared = await h.advisor.prepare('digest');
  const denied = new Error('ordinary session access denied');
  h.services.sessionController.events = async () => { throw denied; };
  await assert.rejects(h.advisor.bind(h.parent.id, prepared.snapshot.id), error => error === denied);
  assert.equal(h.statReads.length, 0);
  assert.equal(await h.store.getBinding(h.parent.id), null);
});

test('ask durably binds before activation and repeated asks send to the same child', async t => {
  const h = await host(t), prepared = await h.attach(), controller = new AbortController(), signal = controller.signal;
  const first = await h.advisor.ask(h.parent, 'Why this decision?', signal);
  assert.equal(first.status, 'accepted'); assert.equal(first.snapshotId, prepared.snapshot.id);
  assert.equal(first.delivery, 'native-subagent-completion');
  assert.equal(h.starts.length, 1);
  assert.equal(h.starts[0].parent, h.parent); assert.equal(h.starts[0].signal.aborted, false);
  assert.equal(h.starts[0].agentPreset, PRESET_ID); assert.equal(h.starts[0].delivery, 'parent');
  assert.equal(h.starts[0].prompt[0].type, 'text');
  assert.match(h.starts[0].prompt[0].text, /Why this decision\?/);
  assert.equal(h.starts[0].name, `history-${first.childId.slice(0, 8)}`);
  assert.equal(h.starts[0].label, 'Read-only history advisor');
  const second = await h.advisor.ask(h.parent, 'And the evidence?', signal);
  assert.equal(second.childId, first.childId); assert.equal(h.starts.length, 1);
  assert.deepEqual(h.sends[0].slice(0, 2), [h.parent, first.childId]);
  assert.equal(h.sends[0][2][0].type, 'text');
  assert.match(h.sends[0][2][0].text, /Current linked snapshots \(this request\):/);
  assert.match(h.sends[0][2][0].text, /Parent question:\nAnd the evidence\?/);
  assert.equal(manifestOf(h.sends[0][2][0].text)[0].id, prepared.snapshot.id);
  assert.equal(h.sends[0][3].signal.aborted, false);
  controller.abort(new Error('caller cancelled'));
  assert.equal(h.starts[0].signal.aborted, true);
  assert.equal(h.sends[0][3].signal.aborted, true);
  for (const dispose of h.disposers.splice(0)) await dispose();
  assert.equal(h.disposalCount(), 1);
  await assert.rejects(h.advisor.ask(h.parent, 'after disposal'), /unavailable/);
});

test('ask requires a binding and prevents concurrent admission without losing later access', async t => {
  const h = await host(t);
  await assert.rejects(h.advisor.ask(h.parent, 'question'), /no history advisor/);
  assert.equal(h.starts.length, 0);
  await h.attach();
  const admitted = deferred(), release = deferred(), original = h.services.subagents.startActivation;
  h.services.subagents.startActivation = async spec => { const activation = await original(spec); admitted.resolve(); await release.promise; return activation; };
  const first = h.advisor.ask(h.parent, 'first');
  await admitted.promise;
  await assert.rejects(h.advisor.ask(h.parent, 'duplicate'), /already being admitted/);
  release.resolve();
  await first;
  await h.advisor.ask(h.parent, 'later');
  assert.equal(h.starts.length, 1); assert.equal(h.sends.length, 1);
});

test('pre-aborted operations reject without starting children or persisting bindings', async t => {
  const h = await host(t), controller = new AbortController();
  controller.abort(new Error('request cancelled'));
  await assert.rejects(h.advisor.prepare('digest', 'en', controller.signal), /request cancelled/);
  assert.equal(h.sourceReads.length, 0);
  const prepared = await h.advisor.prepare('digest');
  await assert.rejects(h.advisor.bind(h.parent.id, prepared.snapshot.id, controller.signal), /request cancelled/);
  assert.equal(await h.store.getBinding(h.parent.id), null);
  await h.advisor.bind(h.parent.id, prepared.snapshot.id);
  await assert.rejects(h.advisor.ask(h.parent, 'cancelled', controller.signal), /request cancelled/);
  assert.equal((await h.store.getBinding(h.parent.id)).childId, null);
  assert.equal(h.starts.length, 0);
  await h.advisor.ask(h.parent, 'works after cancellation');
  assert.equal(h.starts.length, 1);
});

test('routes and tool share prepare and attach behavior without sending main-session prompts', async t => {
  const h = await host(t);
  registerHistoryAdvisorRoutes(h.ctx, h.advisor);
  const route = h.routes.get(ROUTE_HISTORY_ADVISOR);
  assert.deepEqual(route.methods, ['POST']);
  const post = body => route.fetch(new Request(`http://localhost${ROUTE_HISTORY_ADVISOR}`, { method: 'POST', body: JSON.stringify(body) }));
  const preparedResponse = await post({ action: 'prepare', digestId: 'digest', locale: 'en' });
  assert.equal(preparedResponse.headers.get('cache-control'), 'no-store');
  const prepared = await preparedResponse.json(); assert.equal(prepared.ok, true);
  const exec = { agent: h.parent, signal: new AbortController().signal };
  const attached = JSON.parse(await h.advisor.tool.execute({ action: 'attach', snapshotId: prepared.snapshot.id }, exec));
  const routeAttach = await (await post({ action: 'attach', sessionId: h.parent.id, snapshotId: prepared.snapshot.id })).json();
  assert.deepEqual(routeAttach.binding, attached.binding);
  const status = JSON.parse(await h.advisor.tool.execute({ action: 'status' }, exec));
  assert.equal(status.snapshot.id, prepared.snapshot.id);
  const toolPrepared = JSON.parse(await h.advisor.tool.execute({ action: 'prepare', digestId: 'digest', locale: 'en' }, exec));
  assert.equal((await h.store.getSnapshot(toolPrepared.snapshot.id)).brief, (await h.store.getSnapshot(prepared.snapshot.id)).brief);
  assert.equal((await post({ action: 'unknown' })).status, 400);
  assert.equal((await post({ action: 'prepare', digestId: 'absent' })).status, 409);
  const bad = await route.fetch(new Request('http://localhost/', { method: 'POST', body: '{' }));
  assert.equal(bad.status, 400);
  assert.equal(h.starts.length, 0); assert.equal(h.sends.length, 0);
});

test('broken preset rejects admission before creating snapshots or starting children', async t => {
  const h = await host(t);
  assert.equal((await h.advisor.status(h.parent.id)).available, true);
  h.services.agentPresets.resolve = async () => ({ broken: { reason: 'invalid config' } });
  assert.equal((await h.advisor.status(h.parent.id)).available, false);
  assert.match((await h.advisor.status(h.parent.id)).detail, /preset is unavailable/);
  await assert.rejects(h.advisor.prepare('digest'), /preset is unavailable/);
  await assert.rejects(h.advisor.ask(h.parent, 'question'), /preset is unavailable/);
  assert.equal(h.sourceReads.length, 0);
  assert.equal(h.starts.length, 0);
});

test('failed admission interrupts a residual live child and preserves its binding', async t => {
  const h = await host(t); await h.attach();
  const interrupts = [];
  let failedChild;
  h.services.agents.get = id => id === failedChild ? { id } : undefined;
  h.services.subagents.interrupt = (...args) => { interrupts.push(args); };
  h.services.subagents.startActivation = async spec => { failedChild = spec.childId; throw new Error('partial admission'); };
  await assert.rejects(h.advisor.ask(h.parent, 'question'), /partial admission/);
  assert.equal((await h.store.getBinding(h.parent.id)).childId, failedChild);
  assert.deepEqual(interrupts, [[failedChild, { kind: 'ancestor', agent: h.parent }]]);
  await h.advisor.ask(h.parent, 'resume safely');
  assert.equal(h.sends[0][1], failedChild);
});

test('failed admission without registry retains child identity rather than assuming rollback', async t => {
  const h = await host(t); await h.attach();
  delete h.services.agents;
  let failedChild;
  h.services.subagents.startActivation = async spec => { failedChild = spec.childId; throw new Error('unknown rollback'); };
  await assert.rejects(h.advisor.ask(h.parent, 'question'), /unknown rollback/);
  assert.equal((await h.store.getBinding(h.parent.id)).childId, failedChild);
  assert.equal((await h.store.getAdvisorBinding(failedChild)).sessionId, h.parent.id);
});

test('sendMessage failure keeps the existing child and never starts a concurrent replacement', async t => {
  const h = await host(t); await h.attach();
  const first = await h.advisor.ask(h.parent, 'first');
  h.services.subagents.sendMessage = async () => { throw new Error('temporary delivery failure'); };
  await assert.rejects(h.advisor.ask(h.parent, 'follow-up'), /temporary delivery failure/);
  await assert.rejects(h.advisor.ask(h.parent, 'retry'), /temporary delivery failure/);
  assert.equal(h.starts.length, 1);
  assert.equal((await h.store.getBinding(h.parent.id)).childId, first.childId);
});

test('activation result rejection is handled and removes completed activation from disposal', async t => {
  const h = await host(t); await h.attach();
  const result = deferred(), warned = deferred();
  let disposals = 0;
  const warning = t.mock.method(console, 'warn', (...args) => { warned.resolve(args); });
  h.services.subagents.startActivation = async () => ({ result: result.promise, dispose: () => { disposals++; } });
  const accepted = await h.advisor.ask(h.parent, 'first');
  result.reject(new Error('background execution failed'));
  const args = await warned.promise;
  assert.match(args[0], /activation failed/);
  assert.match(args[1].message, /background execution failed/);
  await new Promise(resolve => setImmediate(resolve));
  for (const dispose of h.disposers.splice(0)) await dispose();
  assert.equal(disposals, 0);
  assert.equal((await h.store.getBinding(h.parent.id)).childId, accepted.childId);
  assert.equal(warning.mock.callCount(), 1);
});

test('cleanup waits for async disposal and handles its rejection', async t => {
  const h = await host(t); await h.attach();
  const entered = deferred(), release = deferred();
  const warning = t.mock.method(console, 'warn', () => {});
  h.services.subagents.startActivation = async spec => {
    assert.ok(spec.signal instanceof AbortSignal);
    return { dispose: async () => { entered.resolve(); await release.promise; throw new Error('disposal failed'); } };
  };
  await h.advisor.ask(h.parent, 'first');
  let finished = false;
  const cleanup = h.disposers.shift()().then(() => { finished = true; });
  await entered.promise;
  assert.equal(finished, false);
  await assert.rejects(h.advisor.ask(h.parent, 'during cleanup'), /unavailable/);
  release.resolve();
  await cleanup;
  assert.equal(finished, true);
  assert.equal(warning.mock.callCount(), 1);
  assert.match(warning.mock.calls[0].arguments[0], /disposal failed/);
});

test('existing child resumes only from a continuable child row belonging to this parent', async t => {
  const h = await host(t); await h.attach();
  const first = await h.advisor.ask(h.parent, 'first');
  for (const patch of [{ kind: 'diagnostic' }, { mode: 'unavailable' }, { parentId: 'different-parent' }]) {
    h.services.subagents.listDescendants = async (id, signal) => {
      assert.equal(id, h.parent.id); assert.ok(signal instanceof AbortSignal);
      return [{ id: first.childId, kind: 'child', mode: 'continuable', parentId: h.parent.id, ...patch }];
    };
    await assert.rejects(h.advisor.ask(h.parent, 'unsafe resume'), /not safely resumable/);
  }
  h.services.subagents.listDescendants = async () => { throw new Error('catalog failed'); };
  await assert.rejects(h.advisor.ask(h.parent, 'catalog error'), /catalog failed/);
  assert.equal(h.starts.length, 1); assert.equal(h.sends.length, 0);
});

test('absent reservation recovers only after both live checks and durable absence', async t => {
  const h = await host(t); await h.attach();
  await h.store.setChild(h.parent.id, 'crash-reservation');
  const checks = [];
  h.services.subagents.listDescendants = async () => [];
  h.services.agents.get = id => { checks.push(['agent', id]); return undefined; };
  h.services.sessions.get = id => { checks.push(['session', id]); return undefined; };
  const stat = h.services.sessionPersistence.stat;
  h.services.sessionPersistence.stat = async (id, options) => { checks.push(['stat', id]); return stat(id, options); };
  const recovered = await h.advisor.ask(h.parent, 'recover');
  assert.notEqual(recovered.childId, 'crash-reservation');
  assert.deepEqual(checks.map(([kind]) => kind), ['agent', 'session', 'stat', 'agent', 'session']);
  assert.equal((await h.store.getAdvisorBinding('crash-reservation')).sessionId, h.parent.id);
  assert.equal(h.starts.length, 1);
});

test('missing catalog row fails closed for resident, durable, uncertain and racing children', async t => {
  const h = await host(t); await h.attach();
  await h.store.setChild(h.parent.id, 'reserved');
  h.services.subagents.listDescendants = async () => [];
  const originalStat = h.services.sessionPersistence.stat;
  const scenarios = [
    { setup: () => { h.services.agents.get = () => ({}); }, error: /still materializing or resident/ },
    { setup: () => { h.services.sessions.get = () => ({}); }, error: /still materializing or resident/ },
    { setup: () => { h.services.sessionPersistence.stat = async () => ({ header: {} }); }, error: /uncatalogued durable session/ },
    { setup: () => { h.services.sessionPersistence.stat = async () => { throw new Error('cannot read durable session'); }; }, error: /cannot read durable session/ },
    { setup: () => { let checks = 0; h.services.agents.get = () => ++checks === 2 ? {} : undefined; }, error: /became resident/ },
    { setup: () => { h.services.agents = undefined; }, error: /Cannot verify/ },
    { setup: () => { h.services.sessions = undefined; }, error: /Cannot verify/ },
    { setup: () => { h.services.sessionPersistence = undefined; }, error: /Cannot verify/ },
  ];
  for (const scenario of scenarios) {
    h.services.agents = { get: () => undefined };
    h.services.sessions = { get: () => undefined };
    h.services.sessionPersistence = { stat: originalStat };
    scenario.setup();
    await assert.rejects(h.advisor.ask(h.parent, 'recover'), scenario.error);
    assert.equal((await h.store.getBinding(h.parent.id)).childId, 'reserved');
  }
  assert.equal(h.starts.length, 0); assert.equal(h.sends.length, 0);
});

test('cleanup aborts and waits for pending admission before disposing its eventual handle', async t => {
  const h = await host(t); await h.attach();
  const entered = deferred(), release = deferred();
  let signal, disposed = false, finished = false;
  h.services.subagents.startActivation = async spec => {
    signal = spec.signal; entered.resolve(); await release.promise;
    return { dispose: async () => { disposed = true; } };
  };
  const pending = h.advisor.ask(h.parent, 'pending admission');
  await entered.promise;
  const cleanup = h.disposers.shift()().then(() => { finished = true; });
  assert.equal(signal.aborted, true);
  assert.match(signal.reason.message, /unloaded/);
  assert.equal(finished, false); assert.equal(disposed, false);
  release.resolve();
  await assert.rejects(pending, /unloaded during admission/); await cleanup;
  assert.equal(finished, true); assert.equal(disposed, true);
});

test('linked routes list available sources, add cross-workspace history and reject duplicate sources', async t => {
  const h = await host(t), post = routeClient(h);
  extraSource(h);
  h.state.warnings = [{ source: 'codex', detail: 'disabled' }];
  const empty = await post({ action: 'list' });
  assert.equal(empty.status, 200); assert.equal(empty.body.bound, false); assert.deepEqual(empty.body.links, []);
  const sources = await post({ action: 'sources' });
  assert.equal(sources.status, 200);
  assert.equal(sources.body.targetCwd, h.cwd);
  assert.deepEqual(sources.body.items.map(item => item.id), ['source', 'claude:second']);
  assert.deepEqual(sources.body.warnings, h.state.warnings);
  assert.ok(h.state.catalogReads[0].signal instanceof AbortSignal);
  const added = await post({ action: 'add', sourceSessionId: 'claude:second' });
  assert.equal(added.status, 200); assert.equal(added.body.links.length, 1);
  const link = added.body.links[0];
  assert.equal(link.source.cwd, h.elsewhere); assert.equal(link.source.title, 'Other workspace work');
  assert.equal(link.source.kind, 'claude');
  await assert.rejects(h.advisor.bind(h.parent.id, link.snapshot.id), /different workspaces/);
  const duplicate = await post({ action: 'add', sourceSessionId: 'claude:second' });
  assert.equal(duplicate.status, 409);
  assert.deepEqual((await post({ action: 'list' })).body.links, added.body.links);
  assert.equal((await post({ action: 'add', sourceSessionId: h.parent.id })).status, 409);
  const preview = await post({ action: 'preview', linkId: link.id, start: 0, limit: 1 });
  assert.equal(preview.status, 200); assert.equal(preview.body.page.id, link.snapshot.id);
  assert.equal(preview.body.page.items[0].text, 'second source request'); assert.equal(preview.body.page.nextStart, 1);
  assert.equal(h.starts.length, 0); assert.equal(h.sends.length, 0);
});

test('all linked routes authorize ordinary target session before touching historical sources', async t => {
  const h = await host(t), post = routeClient(h);
  const actions = [{ action: 'list' }, { action: 'sources' }, { action: 'add', sourceSessionId: 'source' }, { action: 'update', linkId: 'missing', expectedSnapshotId: 'missing' }, { action: 'preview', linkId: 'missing' }];
  h.services.sessionController.events = async () => { throw new Error('target access denied'); };
  for (const action of actions) {
    const response = await post(action);
    assert.equal(response.status, 409); assert.match(response.body.detail, /target access denied/);
  }
  assert.equal(h.statReads.length, 0); assert.equal(h.sourceReads.length, 0); assert.equal(h.state.catalogReads.length, 0);
  h.services.sessionController.events = async () => ({ records: [], hasMore: false, cursor: null });
  h.state.target.header.origin = 'subagent';
  for (const action of actions) {
    const response = await post(action);
    assert.equal(response.status, 409); assert.match(response.body.detail, /ordinary DSH session/);
  }
  assert.equal(h.sourceReads.length, 0); assert.equal(h.state.catalogReads.length, 0);
  assert.equal(await h.store.getBinding(h.parent.id), null);
});

test('update uses snapshot CAS, retains old versions and previews only authorized versions', async t => {
  const h = await host(t), post = routeClient(h);
  const added = (await post({ action: 'add', sourceSessionId: 'source' })).body;
  const link = added.links[0], oldId = link.snapshot.id;
  const original = await h.store.getSnapshot(oldId);
  const unlinked = await h.advisor.prepare('digest');
  const denied = await post({ action: 'preview', linkId: link.id, snapshotId: unlinked.snapshot.id });
  assert.equal(denied.status, 409); assert.match(denied.body.detail, /not linked/);
  h.state.raw.events[0].data.content = 'updated request';
  const updated = await post({ action: 'update', linkId: link.id, expectedSnapshotId: oldId });
  assert.equal(updated.status, 200);
  const current = updated.body.links[0];
  assert.notEqual(current.snapshot.id, oldId);
  assert.deepEqual(current.versions.map(version => version.id), [oldId, current.snapshot.id]);
  assert.deepEqual(await h.store.getSnapshot(oldId), original);
  assert.equal((await h.store.getSnapshot(current.snapshot.id)).brief, '');
  const stale = await post({ action: 'update', linkId: link.id, expectedSnapshotId: oldId });
  assert.equal(stale.status, 409); assert.equal(stale.body.reason, 'snapshot-conflict');
  const oldPreview = await post({ action: 'preview', linkId: link.id, snapshotId: oldId });
  const currentPreview = await post({ action: 'preview', linkId: link.id });
  assert.equal(oldPreview.body.page.items[0].text, 'original request');
  assert.equal(currentPreview.body.page.items[0].text, 'updated request');
  assert.deepEqual((await post({ action: 'list' })).body.links, updated.body.links);
});

test('concurrent updates surface store CAS conflicts as snapshot-conflict responses', async t => {
  const h = await host(t), post = routeClient(h);
  const link = (await post({ action: 'add', sourceSessionId: 'source' })).body.links[0];
  const original = h.store.updateLink, both = deferred();
  let arrivals = 0;
  h.store.updateLink = async args => { if (++arrivals === 2) both.resolve(); await both.promise; return original(args); };
  const responses = await Promise.all([post({ action: 'update', linkId: link.id, expectedSnapshotId: link.snapshot.id }), post({ action: 'update', linkId: link.id, expectedSnapshotId: link.snapshot.id })]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal(responses.find(r => r.status === 409).body.reason, 'snapshot-conflict');
  assert.equal((await h.advisor.status(h.parent.id)).links[0].versions.length, 2);
});

test('source disappearance or disablement during update leaves the prior binding intact', async t => {
  const h = await host(t), post = routeClient(h);
  const link = (await post({ action: 'add', sourceSessionId: 'source' })).body.links[0];
  const binding = await h.store.getBinding(h.parent.id);
  h.state.raw = undefined;
  const missing = await post({ action: 'update', linkId: link.id, expectedSnapshotId: link.snapshot.id });
  assert.equal(missing.status, 409); assert.match(missing.body.detail, /source session is unavailable/);
  assert.deepEqual(await h.store.getBinding(h.parent.id), binding);
  h.state.sourceEnabled = false;
  const disabled = await post({ action: 'update', linkId: link.id, expectedSnapshotId: link.snapshot.id });
  assert.equal(disabled.status, 409);
  assert.deepEqual(await h.store.getBinding(h.parent.id), binding);
  assert.equal((await post({ action: 'preview', linkId: link.id })).status, 200);
});

test('updating second link preserves first and resumed advisor receives current added and updated manifest', async t => {
  const h = await host(t), post = routeClient(h);
  const first = (await post({ action: 'add', sourceSessionId: 'source' })).body.links[0];
  const ask = await h.advisor.ask(h.parent, 'initial');
  assert.deepEqual(manifestOf(h.starts[0].prompt[0].text).map(item => item.id), [first.snapshot.id]);
  const secondRaw = extraSource(h);
  const second = (await post({ action: 'add', sourceSessionId: 'claude:second' })).body.links[1];
  secondRaw.events[0].data.content = 'updated second source';
  const updated = await post({ action: 'update', linkId: second.id, expectedSnapshotId: second.snapshot.id });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body.links[0], first);
  const secondCurrent = updated.body.links[1];
  const crossLinkPreview = await post({ action: 'preview', linkId: first.id, snapshotId: secondCurrent.snapshot.id });
  assert.equal(crossLinkPreview.status, 409);
  const resumed = await h.advisor.ask(h.parent, 'current evidence');
  assert.equal(resumed.childId, ask.childId); assert.equal(h.starts.length, 1);
  const text = h.sends[0][2][0].text, manifest = manifestOf(text);
  assert.deepEqual(manifest.map(item => [item.linkId, item.id]), [[first.id, first.snapshot.id], [second.id, secondCurrent.snapshot.id]]);
  assert.ok(!manifest.some(item => item.id === second.snapshot.id));
  assert.match(text, /Parent question:\ncurrent evidence/);
  assert.equal((await h.advisor.status(h.parent.id)).binding.snapshotId, first.snapshot.id);
});

test('tool invocation requires an executing agent and Host requires the child catalog API', async t => {
  const h = await host(t);
  await assert.rejects(h.advisor.tool.execute({ action: 'prepare', digestId: 'digest' }, {}), /DSH Agent is required/);
  await assert.rejects(h.advisor.tool.execute({ action: 'status' }), /DSH Agent is required/);
  delete h.services.subagents.listDescendants;
  await assert.rejects(h.advisor.prepare('digest'), /does not support/);
});

test('failed initial activation can retry with a new child while retaining old child ownership', async t => {
  const h = await host(t); await h.attach();
  const original = h.services.subagents.startActivation;
  let failedChild;
  h.services.subagents.startActivation = async spec => {
    if (!failedChild) { failedChild = spec.childId; throw new Error('activation unavailable'); }
    return original(spec);
  };
  h.services.subagents.sendMessage = async () => { throw new Error('child does not exist'); };
  await assert.rejects(h.advisor.ask(h.parent, 'first'), /activation unavailable/);
  assert.equal((await h.store.getAdvisorBinding(failedChild)).sessionId, h.parent.id);
  const retried = await h.advisor.ask(h.parent, 'retry');
  assert.notEqual(retried.childId, failedChild);
  assert.equal((await h.store.getAdvisorBinding(failedChild)).sessionId, h.parent.id);
  assert.equal((await h.store.getAdvisorBinding(retried.childId)).sessionId, h.parent.id);
});
