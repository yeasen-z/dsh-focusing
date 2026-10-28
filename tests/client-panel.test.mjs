/**
 * The analyze button must exist in every panel state.
 *
 * It used to live only inside the diagnosis card, which renders after a
 * session's detail loads. Any loading or empty state therefore showed a panel
 * with no way to start a review, and "the button does nothing" was really
 * "there is no button".
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SOURCE = fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

function loadPanel() {
  let captured = null;
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    Fragment: "Fragment",
    useEffect: () => {},
    useRef: value => ({ current: value }),
  };
  globalThis.window = { __ModuleLoader__: { load: (d) => { captured = d; } } };
  // Keep a fetch stub a test already installed; only provide a default when
  // there is none, otherwise the harness would silently hide the real call.
  if (typeof globalThis.fetch !== 'function') {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
  }
  globalThis.document = { body: { appendChild() {} }, createElement: () => ({ click() {}, remove() {} }) };
  new Function(SOURCE)();
  const api = captured.factory((name) => {
    if (name === "react") return React;
    throw new Error(`unexpected import: ${name}`);
  });
  const dicts = {};
  let Panel = null;
  api.apply({
    locale: {
      bind: () => (key) => dicts[key],
      register: (ns, locale, table) => { Object.assign(dicts, table); return () => {}; },
      subscribe: () => () => {},
    },
    effect: (fn) => { fn(); return () => {}; },
    slots: {
      inject: (name, fn) => fn(),
      register: (options, component) => {
        if (options.name === "focusing.panel.body") Panel = component.FocusPanel || component;
        return () => {};
      },
    },
    get: () => undefined,
  });
  return { React, Panel, dicts };
}

function renderState({ data = null, sessions = [], picked = null, busy = false, reviewError = '', reviewDetail = '', rosterFilter = 'all', openSettings = () => {} }) {
  const { React, Panel, dicts } = loadPanel();
  // Hook order: data, sessions, picked, query, tab, error, tick, busy,
  // reviewError, reviewDetail, localeTick, preview, previewError, modelSummary,
  // collapsed, rosterFilter. (Settings lives in its own dialog now.)
  const values = [data, sessions, picked, '', 'overview', '', 0, busy, reviewError, reviewDetail, 0, null, '', null, {}, rosterFilter];
  let index = 0;
  React.useState = initial => {
    const slot = index++;
    if(values[slot] === undefined) values[slot] = initial;
    return [values[slot], next => { values[slot] = typeof next === 'function' ? next(values[slot]) : next; }];
  };
  const tree = Panel({ t: (key) => dicts[key], subscribeLocale: () => () => {}, openSettings });
  const buttons = [];
  const nodes = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    nodes.push(node);
    if (node.type === "button") buttons.push(node);
    (node.children || []).forEach(walk);
  };
  walk(tree);
  return { buttons, dicts, values, tree, nodes };
}

function deepText(node) {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(deepText).join('');
  if (!node || typeof node !== 'object') return '';
  return (node.children || []).map(deepText).join('');
}
const labelOf = deepText;
const byLabel = (buttons, dicts, key) => buttons.find(b => labelOf(b) === dicts[key]);

test('the settings entry exists in the top bar before any session is loaded', () => {
  const { buttons, dicts } = renderState({});
  assert.ok(byLabel(buttons, dicts, 'analysisSettings'), 'no way to configure analysis was offered');
});






test("clicking Analyze actually sends one POST to the analysis endpoint", async () => {
  const { buttons, dicts } = renderState({ picked: "s1", data: detail });
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return { ok: true, json: async () => ({ ok: true, review: { reason: "Reviewed", stuck: false } }) };
  };
  await findAnalyze(buttons, dicts).props.onClick();
  assert.equal(requests.length, 1, "click handler must reach fetch, not swallow a ReferenceError");
  assert.equal(requests[0].url, "/api/dsh-focusing.analyze");
  assert.equal(requests[0].init.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].init.body), { session: "s1" });
});

function findAnalyze(buttons, dicts) {
  return buttons.find((b) => {
    const label = (b.children || []).filter((c) => typeof c === "string").join("");
    return label === dicts.runAnalysis || label === dicts.reviewing;
  });
}

const loaded = {
  id: "s1", title: "Chat", project: "p", status: "running",
  turnSteps: 1, toolCalls: 0, goal: "g", signals: [], activity: [], events: [], config: {},
};
const detail = { ...loaded, session: "s1", sessions: [{ id: "s1", title: "Chat" }] };

const analysis = {
  source: 'dsh', provider: '', model: '', endpoint: '', apiKey: '', externalModel: '',
  persona: 'You are a careful reviewer.', includeGoal: true, includeProject: true,
  includeToolArgs: true, includeToolOutput: true, maxActivities: 40, excerptChars: 400,
  maxTokens: 1024, temperature: 0, timeoutMs: 60000, hasApiKey: false,
};
const detailWithSettings = { ...detail, analysis };

test('only one analysis action exists in loading, result, and failure states', () => {
  for (const extra of [{}, { data: detail }, { data: { ...detail, review: { reason: 'old', stuck: false } } }, { data: detail, reviewError: 'failed', reviewDetail: 'AUTH' }]) {
    const { buttons, dicts } = renderState({ picked: 's1', ...extra });
    const actions = buttons.filter(b => b.children.some(c => [dicts.runAnalysis, dicts.rerunAnalysis, dicts.reviewing].includes(c)));
    assert.equal(actions.length, 1);
  }
});

test('click surfaces network errors in the overview', async () => {
  const h = renderState({ picked: 's1', data: detail });
  globalThis.fetch = async () => { throw new Error('Network unavailable'); };
  await findAnalyze(h.buttons, h.dicts).props.onClick();
  assert.equal(h.values[4], 'overview');
  assert.equal(h.values[7], false);
  assert.equal(h.values[8], 'failed');
  assert.equal(h.values[9], 'Network unavailable');
});

test('non-JSON and failed HTTP responses are visible errors', async () => {
  for (const response of [
    { ok: false, status: 401, json: async () => { throw new Error('bad json'); } },
    { ok: false, status: 503, json: async () => ({ reason: 'no-llm', detail: 'Model service unavailable' }) },
  ]) {
    const h = renderState({ picked: 's1', data: detail });
    globalThis.fetch = async () => response;
    await findAnalyze(h.buttons, h.dicts).props.onClick();
    assert.ok(h.values[8]);
    assert.match(h.values[9], /401|Model service unavailable/);
  }
});

test('success is applied immediately without waiting for the next poll', async () => {
  const h = renderState({ picked: 's1', data: detail });
  const review = { reason: 'Reviewed', stuck: false };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, review }) });
  await findAnalyze(h.buttons, h.dicts).props.onClick();
  assert.deepEqual(h.values[0].review, review);
  assert.equal(h.values[8], '');
});

test('a rapid second click cannot send a second request', async () => {
  const h = renderState({ picked: 's1', data: detail });
  let release; let count = 0;
  globalThis.fetch = () => { count++; return new Promise(resolve => { release = resolve; }); };
  const click = findAnalyze(h.buttons, h.dicts).props.onClick;
  const pending = click();
  await click();
  assert.equal(count, 1);
  release({ ok: true, json: async () => ({ ok: true, review: { reason: 'OK' } }) });
  await pending;
});

test('JSON download click uses the declared export endpoint', () => {
  const h = renderState({ picked: 's1', data: detail });
  let link;
  globalThis.document.createElement = () => (link = { click() {}, remove() {} });
  h.buttons.find(b => b.children.includes(h.dicts.saveJson)).props.onClick();
  assert.equal(link.href, '/api/dsh-focusing.export?session=s1&format=json');
});

test('review action stays beside its result rather than in the top bar', () => {
  const h = renderState({ picked: 's1', data: detail });
  const topbar = h.nodes.find(n => n.props?.className === 'fz-topbar');
  const section = h.nodes.find(n => n.props?.className === 'fz-diagnosis');
  assert.doesNotMatch(deepText(topbar), new RegExp(h.dicts.runAnalysis));
  assert.match(deepText(section), new RegExp(h.dicts.runAnalysis));
  const tabs = h.nodes.filter(n => n.props?.className?.startsWith('fz-tab '));
  assert.equal(tabs.length, 1);
});



test('review renders evidence and next action with a folded original reply', () => {
  const h = renderState({ picked: 's1', data: { ...detail, review: {
    stuck: true, reason: 'VERDICT: STUCK\nEVIDENCE: repeated edit\nNEXT: run tests',
  } } });
  const sections = h.nodes.filter(n => n.props?.className === 'fz-review-section');
  assert.equal(sections.length, 2);
  assert.match(deepText(sections[0]), /repeated edit/);
  assert.match(deepText(sections[1]), /run tests/);
  const original = h.nodes.find(n => n.props?.className === 'fz-raw');
  assert.ok(original);
  assert.notEqual(original.props.open, true);
});

test('a saved analysis shows when it was taken and whether the session moved on since', () => {
  const at = new Date(2026, 9, 20, 9, 30).getTime();
  const base = { ...detail, review: { stuck: false, at, reason: 'VERDICT: NORMAL\nEVIDENCE: fine' } };
  const stale = renderState({ picked: 's1', data: { ...base, reviewTrail: { moved: true, toolCalls: 7, failures: 2, turns: 1, userMessages: 1, lastAt: at + 3600e3 } } });
  const staleText = deepText(stale.nodes.find(n => n.props?.className === 'fz-trail stale'));
  assert.match(staleText, /7/);
  assert.match(staleText, /2/);
  const meta = stale.nodes.filter(n => n.type === 'small').map(deepText).join(' ');
  assert.match(meta, /10\/20/, 'an older analysis carries its date, not just a clock time');

  const fresh = renderState({ picked: 's1', data: { ...base, reviewTrail: { moved: false } } });
  assert.ok(fresh.nodes.find(n => n.props?.className === 'fz-trail fresh'));
  const unknown = renderState({ picked: 's1', data: { ...base, reviewTrail: null } });
  assert.ok(unknown.nodes.find(n => n.props?.className === 'fz-trail unknown'));
});

test("the analyze control is present with no sessions at all", () => {
  const { buttons, dicts } = renderState({});
  assert.ok(findAnalyze(buttons, dicts), "no way to start a review was offered");
});

test("the analyze control is present while the panel is still loading", () => {
  const { buttons, dicts } = renderState({ sessions: [{ id: "s1", title: "Chat" }], picked: "s1" });
  const button = findAnalyze(buttons, dicts);
  assert.ok(button, "loading state hid the review control");
  assert.equal(button.props.disabled, false, "a picked session can be reviewed immediately");
});

test("the analyze control works once the session is loaded", () => {
  const { buttons, dicts } = renderState({
    sessions: [{ id: "s1", title: "Chat" }],
    picked: "s1",
    data: detail,
  });
  const button = findAnalyze(buttons, dicts);
  assert.ok(button);
  assert.equal(button.props.disabled, false);
  assert.equal(typeof button.props.onClick, "function");
});

test("the control reports progress and blocks a second run", () => {
  const { buttons, dicts } = renderState({
    sessions: [{ id: "s1", title: "Chat" }],
    picked: "s1",
    data: detail,
    busy: true,
  });
  const button = findAnalyze(buttons, dicts);
  assert.ok(button, "the control disappeared while running");
  assert.equal(button.props.disabled, true, "a running review must not start another");
  const label = (button.children || []).filter((c) => typeof c === "string").join("");
  assert.equal(label, dicts.reviewing, "the person must see that work is happening");
});

const rosterRows = [
  { id: 'a', title: 'Reviewed live', project: 'p', updatedAt: 3, loaded: true, reviewed: true, reviewCount: 2 },
  { id: 'b', title: 'Plain live', project: 'p', updatedAt: 2, loaded: true, reviewed: false },
  { id: 'c', title: 'Old stored', project: 'p', updatedAt: 1, loaded: false, reviewed: true, reviewCount: 1 },
];
// A session choice is either a row or a recent card; both are one click to load.
const sessionButtons = nodes => nodes.filter(n => n.type === 'button' && /^fz-(session|recent-card)( |$)/.test(String(n.props?.className || '')));

test('roster filter shows all sessions or only those with saved analyses', () => {
  const all = renderState({ sessions: rosterRows });
  assert.equal(sessionButtons(all.nodes).length, 3);
  const filters = all.nodes.filter(n => String(n.props?.className || '').startsWith('fz-filter-btn'));
  assert.deepEqual(filters.map(f => deepText(f).replace(/\d+$/, '')), [all.dicts.rosterAll, all.dicts.rosterReviewed]);
  assert.match(deepText(filters[1]), /2$/, 'the reviewed choice shows how many qualify');
  filters[1].props.onClick();

  const reviewed = renderState({ sessions: rosterRows, rosterFilter: 'reviewed' });
  assert.deepEqual(sessionButtons(reviewed.nodes).map(b => deepText(b).includes('Plain live')), [false, false]);
  assert.equal(sessionButtons(reviewed.nodes).length, 2);
});

test('rows mark saved analyses and unloaded history', () => {
  const { nodes, dicts } = renderState({ sessions: rosterRows });
  const marks = nodes.filter(n => n.props?.className === 'fz-reviewed-mark');
  assert.equal(marks.length, 2);
  const unloaded = sessionButtons(nodes).filter(b => b.props.className.includes('unloaded'));
  assert.equal(unloaded.length, 1);
  assert.match(unloaded[0].props.title, new RegExp(dicts.notLoaded));
});

test('the reviewed filter explains an empty result', () => {
  const { nodes, dicts } = renderState({ sessions: [rosterRows[1]], rosterFilter: 'reviewed' });
  assert.ok(nodes.some(n => deepText(n) === dicts.noReviewed));
});

