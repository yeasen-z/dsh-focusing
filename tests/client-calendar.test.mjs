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
    useState: init => { const i = index++; if (!(i in states)) states[i] = init; return [states[i], v => { states[i] = typeof v === "function" ? v(states[i]) : v; }]; },
  };
  const api = captured.factory(n => React);
  const dict = {}; let Workbench;
  api.apply({ locale: { bind: () => k => dict[k] ?? k, register: (ns, l, t) => { if (l === "zh") Object.assign(dict, t); return () => {}; }, subscribe: () => () => {} }, effect: fn => fn(), get: () => undefined, slots: { inject: (n, fn) => fn(), register: (o, c) => { if (o.name === "focusing.panel.body") Workbench = c; return () => {}; } } });
  const Cal = Workbench.ActivityCalendar;
  const t = k => dict[k] ?? k;
  const calls = [];
  const render = (preset) => { states = preset ?? states; index = 0; effects = []; return Cal({ t, openSettings: tab => calls.push(tab) }); };
  // Loaded state: data present (states: data, span, err, busy, tick).
  return { render, dict, calls, states: () => states };
}
const find = (n, p, o = []) => { if (n && typeof n === "object") { if (p(n)) o.push(n); (n.children || []).forEach(c => find(c, p, o)); } return o; };
const text = n => typeof n === "string" ? n : Array.isArray(n) ? n.map(text).join("") : n && typeof n === "object" ? (n.children || []).map(text).join("") : "";
const cells = tree => find(tree, n => /(^| )fw-cal-cell( |$)/.test(String(n.props?.className)) && !/legend/.test(String(n.props?.className)) && n.props?.title !== undefined || /fw-cal-cell pad/.test(String(n.props?.className)));

test("the calendar is on the home page, between the hero and the capability cards", () => {
  assert.match(SOURCE, /h\(ActivityCalendar,\{t,openSettings\}\)/);
  const order = ["wb_heroTitle", "calTitle", "wb_capTitle"].map(k => SOURCE.indexOf(`t('${k}')`, SOURCE.indexOf("function renderHome")));
  assert.ok(order[0] > 0 && order[0] < order[1] && order[1] < order[2], "hero, then activity, then capabilities");
});

test("every day is one square, levelled, with a tooltip that says what happened", async () => {
  const { render, dict } = await mount(calendar());
  const tree = render([calendar(), 182, "", false, 0]);
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
  const tree = render([shifted, 182, "", false, 0]);
  const pads = find(tree, n => /fw-cal-cell pad/.test(String(n.props?.className)));
  assert.equal(pads.length, 1);
  const grid = find(tree, n => /^fw-cal-grid( |$)/.test(String(n.props?.className)))[0];
  assert.ok(String(grid.children[0].props.className).includes("pad"), "the blank comes first");
  assert.equal(grid.children.length, 9, "one blank plus the eight days");
});

test("the summary reads the totals and streaks", async () => {
  const { render } = await mount(calendar());
  const tree = render([calendar(), 182, "", false, 0]);
  assert.match(text(find(tree, n => n.props?.className === "fw-cal-sum")[0]), /12 轮对话 · 活跃 4 天 · 最长连续 1 天 · 当前连续 1 天/);
});

test("the include-imported switch is a real, saved setting", async () => {
  const posts = [];
  const { render } = await mount(calendar(), { posts });
  const tree = render([calendar(), 182, "", false, 0]);
  const box = find(tree, n => n.props?.type === "checkbox")[0];
  assert.equal(box.props.checked, false);
  assert.equal(box.props.disabled, false, "usable when Codex import is on");
  await box.props.onChange({ target: { checked: true } });
  assert.deepEqual(posts.map(p => [p.url, p.body]), [["/api/dsh-focusing.settings", { settings: { activityIncludeExternal: true } }]]);
});

test("with the switch on, the footer counts how many turns came from Codex", async () => {
  const { render } = await mount(calendar());
  const on = calendar({ includeExternal: true });
  const tree = render([on, 182, "", false, 0]);
  assert.equal(find(tree, n => n.props?.type === "checkbox")[0].props.checked, true);
  assert.match(text(find(tree, n => n.props?.className === "fw-cal-note")[0]), /其中 5 轮来自 Codex/);
});

test("when Codex import is off the switch is disabled and the page says why, with a way there", async () => {
  const { render, calls } = await mount(calendar());
  const off = calendar({ externalEnabled: false, externalAvailable: false });
  const tree = render([off, 182, "", false, 0]);
  const box = find(tree, n => n.props?.type === "checkbox")[0];
  assert.equal(box.props.disabled, true);
  assert.match(text(find(tree, n => n.props?.className === "fw-cal-note")[0]), /Codex 导入未开启/);
  find(tree, n => n.type === "button" && /去设置/.test(text(n)))[0].props.onClick();
  assert.deepEqual(calls, ["sources"], "it opens the Sources tab");
});

test("a broken Codex directory is reported instead of silently counting nothing", async () => {
  const { render } = await mount(calendar());
  const tree = render([calendar({ includeExternal: true, externalAvailable: false }), 182, "", false, 0]);
  assert.match(text(find(tree, n => n.props?.className === "fw-cal-note")[0]), /Codex 目录有问题/);
});

test("a failed request shows an error, not an empty grid", async () => {
  const { render } = await mount(calendar());
  const tree = render([null, 182, "boom", false, 0]);
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
