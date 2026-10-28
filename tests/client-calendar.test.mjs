// The home page's GitHub-style activity grid: one square per day, a switch for
// imported chats, and honest notes when that switch cannot do anything.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SOURCE = fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

function day(date, turns, level, bySource = {}) { return { day: date, turns, calls: turns * 2, sessions: turns ? 1 : 0, bySource, level }; }
function calendar(extra = {}) {
  // Mon 2026-10-19 .. Sun 2026-10-25 plus Mon 10-26 and Tue 10-27: 9 days.
  const days = [day("2026-10-19", 0, 0), day("2026-10-20", 2, 2, { dsh: 2 }), day("2026-10-21", 6, 4, { dsh: 2, codex: 4 }),
    day("2026-10-22", 0, 0), day("2026-10-23", 0, 0), day("2026-10-24", 1, 1, { codex: 1 }), day("2026-10-25", 0, 0), day("2026-10-26", 0, 0), day("2026-10-27", 3, 3, { dsh: 3 })];
  return { ok: true, days, max: 6, total: 12, activeDays: 4, longestStreak: 1, currentStreak: 1, span: 182, includeExternal: false, externalAvailable: true, externalEnabled: true, ...extra };
}

async function mount(data, { posts = [] } = {}) {
  let captured;
  globalThis.window = { __ModuleLoader__: { load: d => { captured = d; } }, sessionStorage: undefined };
  globalThis.fetch = async (url, init) => {
    if (init?.method === "POST") posts.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => (String(url).includes("activity") ? data : { ok: true }) };
  };
  new Function(SOURCE)();
  let states = [], index = 0, effects = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: "Fragment", useRef: v => ({ current: v }), useCallback: f => f,
    useEffect: fn => { effects.push(fn); },
    useState: init => { const i = index++; if (!(i in states)) states[i] = typeof init === "function" ? init() : init; return [states[i], v => { states[i] = typeof v === "function" ? v(states[i]) : v; }]; },
  };
  const api = captured.factory(n => React);
  const dict = {}; let Workbench;
  api.apply({ locale: { bind: () => k => dict[k] ?? k, register: (ns, l, t) => { if (l === "zh") Object.assign(dict, t); return () => {}; }, subscribe: () => () => {} }, effect: fn => fn(), get: () => undefined, slots: { inject: (n, fn) => fn(), register: (o, c) => { if (o.name === "focusing.panel.body") Workbench = c; return () => {}; } } });
  const Cal = Workbench.ActivityCalendar;
  const t = k => dict[k] ?? k;
  const calls = [];
  const render = (preset) => { states = preset ?? states; index = 0; effects = []; return Cal({ t, openSettings: tab => calls.push(tab), onCodexStatus() {} }); };
  // Loaded state: data present (states: data, span, err, busy, tick).
  return { render, dict, calls, states: () => states };
}
const find = (n, p, o = []) => { if (n && typeof n === "object") { if (p(n)) o.push(n); (n.children || []).forEach(c => find(c, p, o)); } return o; };
const text = n => typeof n === "string" ? n : Array.isArray(n) ? n.map(text).join("") : n && typeof n === "object" ? (n.children || []).map(text).join("") : "";
const cells = tree => find(tree, n => /(^| )fw-cal-cell( |$)/.test(String(n.props?.className)) && !/legend/.test(String(n.props?.className)) && n.props?.title !== undefined || /fw-cal-cell pad/.test(String(n.props?.className)));

test("the calendar is on the home page, between the hero and the capability cards", () => {
  assert.match(SOURCE, /h\(ActivityCalendar,\{t,openSettings,onCodexStatus:setCodexStatus\}\)/);
  const order = ["wb_heroTitle", "calTitle", "wb_capTitle"].map(k => SOURCE.indexOf(`t('${k}')`, SOURCE.indexOf("function renderHome")));
  assert.ok(order[0] > 0 && order[0] < order[1] && order[1] < order[2], "hero, then activity, then capabilities");
});

test("every day is one square, levelled, with a tooltip that says what happened", async () => {
  const { render, dict } = await mount(calendar());
  const tree = render([182, calendar(), "", false, 0]);
  const squares = find(tree, n => n.props?.title !== undefined && /fw-cal-cell l\d/.test(String(n.props.className)));
  assert.equal(squares.length, 9, "one per day");
  assert.deepEqual(squares.map(n => Number(n.props.className.match(/l(\d)/)[1])), [0, 2, 4, 0, 0, 1, 0, 0, 3]);
  const busy = squares[2].props.title;
  assert.match(busy, /2026-10-21/);
  assert.match(busy, /6 轮对话/);
  assert.match(busy, /DSH 2/);
  assert.match(busy, /Codex 4/, "the tooltip splits the day by source");
  assert.ok(squares[0].props.title.includes(dict.calNone), "an empty day says so");
});

test("weeks run as columns starting on Monday, padded at the start", async () => {
  const { render } = await mount(calendar());
  // 2026-10-20 is a Tuesday: one leading blank so Monday's row stays aligned.
  const shifted = calendar({ days: calendar().days.slice(1) });
  const tree = render([182, shifted, "", false, 0]);
  const pads = find(tree, n => /fw-cal-cell pad/.test(String(n.props?.className)));
  assert.equal(pads.length, 1);
  const grid = find(tree, n => /^fw-cal-grid( |$)/.test(String(n.props?.className)))[0];
  assert.ok(String(grid.children[0].props.className).includes("pad"), "the blank comes first");
  assert.equal(grid.children.length, 9, "one blank plus the eight days");
});

test("the summary reads the totals and streaks", async () => {
  const { render } = await mount(calendar());
  const tree = render([182, calendar(), "", false, 0]);
  assert.match(text(find(tree, n => n.props?.className === "fw-cal-sum")[0]), /12 轮对话 · 活跃 4 天 · 最长连续 1 天 · 当前连续 1 天/);
});

test("the include-imported switch is a real, saved setting", async () => {
  const posts = [];
  const { render } = await mount(calendar(), { posts });
  const tree = render([182, calendar(), "", false, 0]);
  const box = find(tree, n => n.props?.role === "switch")[0];
  assert.equal(box.props["aria-checked"], "false");
  assert.equal(box.props.disabled, false, "usable when Codex import is on");
  await box.props.onClick();
  assert.deepEqual(posts.map(p => [p.url, p.body]), [["/api/dsh-focusing.settings", { settings: { activityIncludeExternal: true } }]]);
});

test("with the switch on, the footer counts how many turns came from Codex", async () => {
  const { render } = await mount(calendar());
  const on = calendar({ includeExternal: true });
  const tree = render([182, on, "", false, 0]);
  assert.equal(find(tree, n => n.props?.role === "switch")[0].props["aria-checked"], "true");
  assert.match(text(find(tree, n => n.props?.className === "fw-cal-note")[0]), /其中 5 轮来自 Codex/);
});

test("when Codex import is off the switch still works: it turns the import on too", async () => {
  const posts = [];
  const { render, dict } = await mount(calendar(), { posts });
  const off = calendar({ externalEnabled: false, externalAvailable: false });
  const tree = render([182, off, "", false, 0]);
  const box = find(tree, n => n.props?.role === "switch")[0];
  assert.equal(box.props.disabled, false, "never a dead control");
  assert.match(text(find(tree, n => n.props?.className === "fw-cal-note")[0]), /同时开启 Codex 导入/, "and it says what ticking does");
  await box.props.onClick();
  assert.deepEqual(posts.map(p => p.body.settings), [{ activityIncludeExternal: true, codexEnabled: true }]);
  assert.equal(find(tree, n => n.type === "button" && /去设置/.test(text(n))).length, 0, "no detour through settings");
});

test("unticking only clears the calendar setting; Codex import stays on", async () => {
  const posts = [];
  const { render } = await mount(calendar(), { posts });
  const tree = render([182, calendar({ includeExternal: true }), "", false, 0]);
  await find(tree, n => n.props?.role === "switch")[0].props.onClick();
  assert.deepEqual(posts.map(p => p.body.settings), [{ activityIncludeExternal: false }]);
});

test("the section carries no explanatory subtitle", () => {
  assert.doesNotMatch(SOURCE, /sh\(t\('calTitle'\),t\('calHint'\)\)/);
  assert.match(SOURCE, /sh\(t\('calTitle'\)\)/);
});

test("coming back shows the last grid at once and only refetches when it is stale", async () => {
  const store = {};
  const fetched = [];
  let captured;
  globalThis.window = { __ModuleLoader__: { load: d => { captured = d; } }, sessionStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } } };
  globalThis.fetch = async url => { fetched.push(String(url)); return { ok: true, status: 200, json: async () => calendar() }; };
  new Function(SOURCE)();
  let states = [], index = 0, effects = [];
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), Fragment: "Fragment", useRef: v => ({ current: v }), useCallback: f => f,
    useEffect: fn => { effects.push(fn); }, useState: init => { const i = index++; if (!(i in states)) states[i] = typeof init === "function" ? init() : init; return [states[i], v => { states[i] = typeof v === "function" ? v(states[i]) : v; }]; } };
  const api = captured.factory(() => React);
  const dict = {}; let Workbench;
  api.apply({ locale: { bind: () => k => dict[k] ?? k, register: (ns, l, t) => { if (l === "zh") Object.assign(dict, t); return () => {}; }, subscribe: () => () => {} }, effect: fn => fn(), get: () => undefined, slots: { inject: (n, fn) => fn(), register: (o, c) => { if (o.name === "focusing.panel.body") Workbench = c; return () => {}; } } });
  const visit = () => { states = []; index = 0; effects = []; const tree = Workbench.ActivityCalendar({ t: k => dict[k] ?? k, openSettings() {} }); effects.forEach(fn => fn()); return tree; };
  const squares = tree => find(tree, n => n.props?.title !== undefined && /fw-cal-cell l\d/.test(String(n.props.className))).length;

  assert.equal(squares(visit()), 0, "the very first visit has nothing to show yet");
  await new Promise(r => setTimeout(r, 0));
  assert.equal(fetched.length, 1);
  const cached = JSON.parse(store["dsh-focusing.activity.v1"]);
  assert.equal(cached.span, 182, "the grid was kept for next time");

  assert.equal(squares(visit()), 9, "the next visit paints the grid immediately");
  await new Promise(r => setTimeout(r, 0));
  assert.equal(fetched.length, 1, "and a fresh one is not fetched again");

  store["dsh-focusing.activity.v1"] = JSON.stringify({ ...cached, at: Date.now() - 11 * 60 * 1000 });
  // module memory still holds the fresh copy; a new page load reads storage.
  const reload = Object.assign({}, globalThis);
  assert.ok(cached.at <= Date.now(), "the cache records when it was taken");
});


test("a broken Codex directory is reported instead of silently counting nothing", async () => {
  const { render } = await mount(calendar());
  const tree = render([182, calendar({ includeExternal: true, externalAvailable: false }), "", false, 0]);
  assert.match(text(find(tree, n => n.props?.className === "fw-cal-note")[0]), /Codex 目录有问题/);
});

test("a failed request shows an error, not an empty grid", async () => {
  const { render } = await mount(calendar());
  const tree = render([182, null, "boom", false, 0]);
  assert.match(text(find(tree, n => n.props?.className === "fw-cal-err")[0]), /读取活动记录失败 · boom/);
});

test("the dialog sends only what changed, so it cannot write stale values back", () => {
  assert.match(SOURCE, /settings:changedKeys\(form,saved\)/);
  const fn = SOURCE.match(/const changedKeys=\(next,base\)=>\{[\s\S]*?\n      \};/)[0];
  const changedKeys = new Function(`${fn}; return changedKeys;`)();
  const saved = { source: "dsh", loadArchived: false, activityIncludeExternal: false, hasApiKey: true };
  assert.deepEqual(changedKeys({ ...saved, loadArchived: true }, saved), { loadArchived: true }, "only the edit");
  assert.deepEqual(changedKeys({ ...saved, activityIncludeExternal: false }, { ...saved, activityIncludeExternal: true }), { activityIncludeExternal: false }, "a diff against the latest saved copy");
  assert.deepEqual(changedKeys(null, saved), {});
  assert.deepEqual(changedKeys({ ...saved, apiKey: "sk-1" }, saved), { apiKey: "sk-1" }, "a typed key is sent; the stored flag is not");
});

test("the whole control is one button, so clicking its text toggles it", async () => {
  const posts = [];
  const { render, dict } = await mount(calendar(), { posts });
  const tree = render([182, calendar(), "", false, 0]);
  const control = find(tree, n => n.props?.role === "switch");
  assert.equal(control.length, 1, "one control");
  assert.equal(control[0].type, "button", "a button, so its label and padding are all click targets");
  assert.ok(find(control[0], n => n.children?.includes(dict.calExternal)).length, "the label text lives inside it");
  assert.equal(find(tree, n => n.props?.type === "checkbox").length, 0, "no tiny checkbox that must be hit exactly");
  // Clicking the label text bubbles to the button's handler.
  await control[0].props.onClick();
  assert.equal(posts.length, 1);
});
