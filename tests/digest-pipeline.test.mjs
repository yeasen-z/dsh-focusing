import test from 'node:test';
import assert from 'node:assert/strict';
import { createDigestPlan, runDigestPipeline, DIGEST_PROMPT_LIMIT } from '../lib/digest-pipeline.mjs';

const range = { label: 'This week', from: '2026-11-09', to: '2026-11-15' };
const source = (id, size = 80) => ({ id, title: `Session ${id}`, project: '/project', days: [{ day: '2026-11-15' }], turns: 2, calls: 3, requests: [{ text: `request-${id} ${'x'.repeat(size)}` }], replies: [{ text: `finished-${id}` }], files: ['file.js'], commands: ['node --test'], todos: [], tags: [] });
const fresh = () => ({ id: 'digest-test', request: 'Summarize work', range: { ...range } });
function success(prompt) {
  const refs = [...new Set([...prompt.user.matchAll(/SOURCE (s\d+) /g)].map(match => match[1]).concat([...prompt.user.matchAll(/"sessions":\[([^\]]*)\]/g)].flatMap(match => JSON.parse(`[${match[1]}]`))))];
  return { ok: true, model: 'test-model', text: JSON.stringify({ title: 'Work', summary: 'Evidence-backed work summary', projects: [{ name: 'project', status: 'done', headline: 'Implemented and checked', items: refs.map(ref => ({ state: 'done', text: `Evidence for ${ref}`, sessions: [ref, 'unknown-source'] })) }] }) };
}

test('small input makes one call after frozen checkpoint and validates source citations', async () => {
  const digest = fresh();
  const checkpoints = [];
  let calls = 0;
  await runDigestPipeline({ digest, slices: [source('real-id')], save: async value => checkpoints.push(structuredClone(value)), complete: async prompt => {
    calls++;
    assert.ok(checkpoints.length);
    assert.equal(checkpoints[0].pipeline.nodes[0].status, 'pending');
    assert.ok(prompt.system.includes('untrusted historical data'));
    assert.ok(prompt.system.length + prompt.user.length <= DIGEST_PROMPT_LIMIT);
    assert.equal(prompt.maxTokens, 8192);
    return success(prompt);
  } });
  assert.equal(calls, 1);
  assert.equal(digest.draft, false);
  assert.equal(digest.retryable, false);
  assert.equal(digest.pipeline.status, 'done');
  assert.deepEqual(digest.result.projects[0].items[0].sessions, ['real-id']);
  assert.deepEqual(digest.pipeline.coverage, { totalSessions: 1, completedSessions: 1, totalBatches: 1, completedBatches: 1, failedBatches: 0 });
});

test('weekly digests start with the newest evidence and checkpoint model-requested earlier pages', async () => {
  const digest = { ...fresh(), kind: 'weekly', range: { ...range, key: 'this-week' } };
  const first = source('first');
  first.requests = [{ time: 1, text: `EARLIER_GOAL ${'a'.repeat(1000)}` }];
  first.replies = [{ time: 2, text: `${'b'.repeat(1500)} LATEST_OUTCOME` }];
  const second = source('second', 2400);
  second.replies = [{ time: 2, text: `${'c'.repeat(1000)} UNREQUESTED_OUTCOME` }];
  const prompts = [];
  await runDigestPipeline({ digest, slices: [first, second], complete: async prompt => {
    prompts.push(prompt.user);
    const answer = success(prompt);
    if (prompt.user.includes('SOURCE s1 PAGE 1')) {
      assert.match(prompt.user, /LATEST_OUTCOME/);
      assert.doesNotMatch(prompt.user, /UNREQUESTED_OUTCOME/);
      assert.doesNotMatch(prompt.user, /EARLIER_GOAL/);
      answer.text = JSON.stringify({ ...JSON.parse(answer.text), readEarlier: ['s1', 's1', 'foreign'] });
      return answer;
    }
    if (prompt.user.includes('SOURCE s1 PAGE 2')) {
      assert.doesNotMatch(prompt.user, /SOURCE s2/);
      assert.match(prompt.user, /EARLIER_GOAL/);
      return { ok: false, reason: 'timeout' };
    }
    assert.match(prompt.user, /SOURCE s2 PAGE 1/);
    assert.match(prompt.user, /UNREQUESTED_OUTCOME/);
    return answer;
  } });
  assert.equal(digest.retryable, true);
  assert.equal(digest.pipeline.coverage.completedSessions, 1);
  const restored = structuredClone(digest);
  const retried = [];
  await runDigestPipeline({ digest: restored, complete: async prompt => {
    retried.push(prompt.user);
    return success(prompt);
  } });
  assert.equal(restored.partial, false);
  assert.equal(restored.pipeline.coverage.completedSessions, 2);
  assert.equal(retried.length, 2);
  assert.equal(retried[0], prompts.find(prompt => prompt.includes('SOURCE s1 PAGE 2')));
  assert.match(retried[1], /Merge every supplied summary/);
});

test('earlier reading stays within the per-session limit and uses frozen sources after interruption', async () => {
  const digest = { ...fresh(), kind: 'weekly', range: { ...range, key: 'this-week' } };
  const slices = [source('long-session', 22000)];
  const pageCalls = [];
  const complete = async prompt => {
    const page = prompt.user.match(/SOURCE s1 PAGE (\d+) (MORE|LIMIT|END)/);
    if (page) pageCalls.push([Number(page[1]), page[2]]);
    const answer = success(prompt);
    return { ...answer, text: JSON.stringify({ ...JSON.parse(answer.text), readEarlier: ['s1'] }) };
  };
  const controller = new AbortController();
  await runDigestPipeline({ digest, slices, complete, signal: controller.signal, save: async value => {
    if (value.pipeline.nodes.some(node => node.round === 0 && node.status === 'done')) controller.abort();
  } });
  assert.deepEqual(pageCalls, [[1, 'MORE']]);
  assert.equal(digest.pipeline.coverage.completedSessions, 0);
  const restored = structuredClone(digest);
  await runDigestPipeline({ digest: restored, slices, complete });
  assert.deepEqual(pageCalls, [[1, 'MORE'], [2, 'MORE'], [3, 'LIMIT']]);
  assert.equal(restored.pipeline.coverage.completedSessions, 1);
  assert.equal(restored.pipeline.leaves.length, 3);
  assert.equal(restored.pipeline.status, 'done');
});

test('weekly digest batches fit the prompt limit and continue after failed model calls', async () => {
  const digest = { ...fresh(), kind: 'weekly', range: { ...range, key: 'this-week' } };
  const slices = Array.from({ length: 43 }, (_, index) => source(`id-${index}`, 15000));
  let active = 0, maxActive = 0, calls = 0;
  await runDigestPipeline({ digest, slices, complete: async prompt => {
    assert.ok(prompt.system.length + prompt.user.length <= DIGEST_PROMPT_LIMIT);
    assert.equal([...prompt.user.matchAll(/SOURCE s\d+ PAGE/g)].length, 1);
    calls++;
    maxActive = Math.max(maxActive, ++active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return { ok: false, reason: 'timeout' };
  } });
  assert.equal(maxActive, 3);
  assert.equal(calls, slices.length);
  assert.equal(digest.pipeline.leaves.length, slices.length);
  assert.equal(digest.pipeline.coverage.failedBatches, calls);
});

test('weekly reduction compacts page JSON before merging it', async () => {
  const digest = { ...fresh(), kind: 'weekly', range: { ...range, key: 'this-week' } };
  const longSummary = 'long-summary-'.repeat(120);
  let reduction;
  await runDigestPipeline({ digest, slices: [source('a'), source('b')], complete: async prompt => {
    if (prompt.user.includes('Merge every supplied summary.')) {
      reduction = prompt.user;
      return success(prompt);
    }
    const answer = success(prompt);
    return { ...answer, text: JSON.stringify({ ...JSON.parse(answer.text), summary: longSummary }) };
  } });
  assert.ok(reduction);
  assert.match(reduction, /compact session cards/);
  assert.ok(!reduction.includes(longSummary));
  assert.match(reduction, /long-summary/);
  assert.equal(digest.partial, false);
});

test('oversized single session is split losslessly including long titles and all excerpts', () => {
  const slice = source('very-long-id'.repeat(4000), 42000);
  slice.title = 'title-'.repeat(8000);
  slice.replies.push({ text: 'LAST_REPLY_UNIQUE_MARKER' });
  slice.commands.push('LAST_COMMAND_UNIQUE_MARKER');
  const plan = createDigestPlan([slice], 'report', range);
  const fragments = plan.nodes.flatMap(node => [...node.input.matchAll(/SOURCE s1 FRAGMENT \d+\/\d+\n([\s\S]*?)\nEND FRAGMENT\n/g)].map(match => match[1]));
  const reconstructed = JSON.parse(fragments.join(''));
  assert.equal(reconstructed.title, slice.title);
  assert.deepEqual(reconstructed.requests, slice.requests);
  assert.deepEqual(reconstructed.replies, slice.replies);
  assert.deepEqual(reconstructed.commands, slice.commands);
  assert.ok(plan.nodes.length > 3);
  assert.equal(plan.sources[0].id, slice.id);
  assert.ok(plan.nodes.every(node => !node.input.includes(slice.id)));
  slice.requests[0].text = 'MUTATED_LIVE_RECORD';
  assert.ok(!JSON.stringify(plan).includes('MUTATED_LIVE_RECORD'));
  assert.deepEqual(JSON.parse(JSON.stringify(plan)), plan);
});

test('all prompts remain bounded through hierarchical reduction of many sessions', async () => {
  const digest = fresh();
  digest.request = 'r'.repeat(2000);
  digest.range.label = 'd'.repeat(1300);
  const slices = Array.from({ length: 24 }, (_, index) => source(`session-${index}`, 7200));
  let calls = 0;
  const seen = new Set();
  await runDigestPipeline({ digest, slices, complete: async prompt => {
    calls++;
    assert.ok(prompt.system.length + prompt.user.length <= DIGEST_PROMPT_LIMIT, `oversized request: ${prompt.system.length + prompt.user.length}`);
    for (const match of prompt.user.matchAll(/SOURCE (s\d+) /g)) seen.add(match[1]);
    return success(prompt);
  } });
  assert.equal(digest.pipeline.status, 'done');
  assert.equal(seen.size, slices.length);
  assert.equal(digest.pipeline.coverage.completedSessions, slices.length);
  assert.ok(digest.pipeline.nodes.filter(node => node.kind === 'reduce').length > 2);
  assert.equal(calls, digest.pipeline.nodes.length);
});

test('explicit retry only calls failed leaves and new reductions, never successful batches', async () => {
  const digest = fresh();
  const slices = Array.from({ length: 5 }, (_, index) => source(`session-${index}`, 14000));
  let failingInput;
  const counts = new Map();
  const invoke = async prompt => {
    counts.set(prompt.user, (counts.get(prompt.user) || 0) + 1);
    failingInput ??= prompt.user;
    if (prompt.user === failingInput && counts.get(prompt.user) === 1) return { ok: false, reason: 'timeout', detail: 'Timed out' };
    return success(prompt);
  };
  await runDigestPipeline({ digest, slices, complete: invoke });
  assert.equal(digest.status, 'done');
  assert.equal(digest.partial, true);
  assert.equal(digest.retryable, true);
  assert.equal(digest.draft, false);
  assert.ok(digest.result.summary.includes('尚未完成'));
  assert.equal(counts.get(failingInput), 1);
  const savedInputs = digest.pipeline.nodes.filter(node => node.status === 'done').map(node => node.input);
  const frozenHash = digest.pipeline.hash;
  const restored = JSON.parse(JSON.stringify(digest));
  await runDigestPipeline({ digest: restored, slices: [source('unrelated-new-live-session')], complete: invoke });
  assert.equal(restored.pipeline.hash, frozenHash);
  assert.equal(restored.pipeline.status, 'done');
  assert.equal(counts.get(failingInput), 2);
  for (const input of savedInputs) {
    assert.equal([...counts.entries()].find(([prompt]) => prompt.endsWith(input))[1], 1);
  }
  assert.ok(!JSON.stringify(restored.pipeline.sources).includes('unrelated-new-live-session'));
});

test('failed reduction retries without rereading or rerunning successful leaves/reducers', async () => {
  const digest = fresh();
  const calls = new Map();
  let failedReduction;
  const invoke = async prompt => {
    calls.set(prompt.user, (calls.get(prompt.user) || 0) + 1);
    if (prompt.user.includes('Merge every supplied summary.') && !failedReduction) {
      failedReduction = prompt.user;
      return { ok: false, reason: 'timeout' };
    }
    return success(prompt);
  };
  await runDigestPipeline({ digest, slices: Array.from({ length: 5 }, (_, i) => source(`id-${i}`, 15000)), complete: invoke });
  assert.equal(digest.retryable, true);
  const done = digest.pipeline.nodes.filter(node => node.status === 'done').map(node => node.input);
  await runDigestPipeline({ digest, complete: invoke });
  assert.equal(digest.pipeline.status, 'done');
  assert.equal(calls.get(failedReduction), 2);
  for (const input of done) assert.equal([...calls.entries()].find(([prompt]) => prompt.endsWith(input))[1], 1);
});

test('all failed leaves produce honest draft and no automatic repeats or reductions', async () => {
  const digest = fresh();
  let calls = 0;
  await runDigestPipeline({ digest, slices: [source('a', 20000)], complete: async () => { calls++; return { ok: false, reason: 'timeout' }; } });
  assert.equal(digest.draft, true);
  assert.equal(digest.partial, true);
  assert.equal(digest.error.reason, 'timeout');
  assert.equal(digest.pipeline.coverage.completedSessions, 0);
  assert.equal(calls, digest.pipeline.leaves.length);
  assert.ok(digest.pipeline.nodes.every(node => node.kind === 'leaf'));
  assert.ok(digest.result.sections[0].body.includes('尚无成功批次'));
});

test('abort checkpoints completed work and stops before the next model call', async () => {
  const digest = fresh();
  const controller = new AbortController();
  let calls = 0;
  let snapshots = 0;
  await runDigestPipeline({ digest, slices: [source('a', 30000)], signal: controller.signal, complete: async prompt => { calls++; return success(prompt); }, save: async value => {
    snapshots++;
    if (value.pipeline.nodes.some(node => node.status === 'done')) controller.abort(new Error('cancelled'));
  } });
  assert.equal(calls, 1);
  assert.ok(snapshots >= 3);
  assert.equal(digest.pipeline.status, 'aborted');
  assert.equal(digest.status, 'failed');
  assert.equal(digest.retryable, true);
  assert.equal(digest.pipeline.nodes[0].status, 'done');
  assert.equal(digest.pipeline.coverage.completedSessions, 0);
  await runDigestPipeline({ digest, complete: async prompt => { calls++; return success(prompt); } });
  assert.equal(digest.pipeline.status, 'done');
  assert.equal(calls, digest.pipeline.nodes.length);
});

test('empty inputs perform no model calls and persist a structural result', async () => {
  const digest = fresh();
  await runDigestPipeline({ digest, slices: [], complete: async () => { throw new Error('must not call'); } });
  assert.equal(digest.status, 'done');
  assert.equal(digest.draft, true);
  assert.equal(digest.pipeline.coverage.totalSessions, 0);
});

test('oversized request/range and duplicate IDs fail explicitly before model calls', () => {
  assert.throws(() => createDigestPlan([source('a')], 'r'.repeat(2001), range), /2000 characters/);
  assert.throws(() => createDigestPlan([source('a')], 'report', { label: 'x'.repeat(1501) }), /range metadata/);
  assert.throws(() => createDigestPlan([source('a'), source('a')], 'report', range), /Duplicate session/);
});

test('malformed, truncated and oversized summaries cannot silently become successful checkpoints', async () => {
  for (const answer of [
    { ok: true, text: '{}' },
    { ok: true, text: '{"summary":"partial"}', truncated: true },
    { ok: true, text: JSON.stringify({ summary: 'x', sections: [{ title: 'too long', body: 'a'.repeat(7000) }] }) },
    { ok: true, text: JSON.stringify({ summary: 'a'.repeat(7000) }) },
  ]) {
    const digest = fresh();
    let calls = 0;
    await runDigestPipeline({ digest, slices: [source('a')], complete: async () => { calls++; return answer; } });
    assert.equal(calls, 1);
    assert.equal(digest.pipeline.status, 'partial');
    assert.equal(digest.pipeline.nodes[0].status, 'failed');
    assert.equal(digest.retryable, true);
  }
});
