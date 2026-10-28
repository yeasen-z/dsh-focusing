// The analysis roster: project folders start folded, and the three most
// recently used sessions stay pinned open at the top so the newest work is one
// click away instead of hidden inside a folder.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SOURCE = fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
const NOW = Date.now();

function sessions() {
  return [
    { id: "s-old", title: "十小时前", project: "alpha", cwd: "/a", updatedAt: NOW - 10 * 3600e3, status: "idle", reviewed: false },
    { id: "s-new", title: "一分钟前", project: "alpha", cwd: "/a", updatedAt: NOW - 60e3, status: "idle", reviewed: true, reviewCount: 2 },
    { id: "s-mid", title: "两小时前", project: "beta", cwd: "/b", updatedAt: NOW - 2 * 3600e3, status: "idle", reviewed: false },
    { id: "s-4th", title: "三小时前", project: "beta", cwd: "/b", updatedAt: NOW - 3 * 3600e3, status: "idle", reviewed: false },
  ];
}

async function mount({ filter = "all", query = "" } = {}) {
  let captured;
  const effects = [];
  const saved = { window: globalThis.window };
  globalThis.window = { __ModuleLoader__: { load: d => { captured = d; } } };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, status: "done", sessions: sessions(), digest: { status: "done" } }) });
  new Function(SOURCE)();

  let states = [], index = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: "Fragment",
    useEffect: fn => { effects.push(fn); },
    useRef: v => ({ current: v }),
    useCallback: f => f,
    useState: init => { const i = index++; if (!(i in states)) states[i] = init; return [states[i], v => { states[i] = typeof v === "function" ? v(states[i]) : v; }]; },
  };
  const api = captured.factory(n => { if (n === "react") return React; throw new Error(n); });
  const dict = {};
  let Panel;
  api.apply({
    locale: { bind: () => k => dict[k] ?? k, register: (ns, l, t) => { if (l === "zh") Object.assign(dict, t); return () => {}; }, subscribe: () => () => {} },
    effect: fn => fn(), get: () => undefined,
    slots: { inject: (n, fn) => fn(), register: (o, c) => { if (o.name === "focusing.panel.body") Panel = c.FocusPanel || c; return () => {}; } },
  });

  // Every render registers effects; the panel's polling timer would keep the
  // test process alive, so each render's cleanups are collected and run at the
  // end of the test that owns them.
  const cleanups = [];
  const tick = () => {
    index = 0;
    const node = Panel({ t: k => dict[k] ?? k, subscribeLocale: () => () => {}, openSettings: () => {} });
    cleanups.push(...effects.splice(0).map(fn => fn()).filter(fn => typeof fn === "function"));
    return node;
  };
  const stop = () => { while (cleanups.length) cleanups.pop()(); };
  tick();
  await new Promise(r => setTimeout(r, 20));   // the roster arrives asynchronously
  // the roster filter and search are state 15 / 3; set them before inspecting
  if (filter !== "all") states[15] = filter;
  if (query) states[3] = query;
  const tree = tick();
  if (saved.window === undefined) delete globalThis.window; else globalThis.window = saved.window;
  return { tree, dict, tick, stop, state: states };
}

const all = tree => { const out = []; const visit = n => { if (n && typeof n === "object") { out.push(n); (n.children || []).forEach(visit); } }; visit(tree); return out; };
const projectSections = tree => all(tree).filter(n => n.type === "section" && n.props?.className === "fz-group" && n.props?.key !== "__recent__");
const recentSection = tree => all(tree).find(n => n.props?.className === "fz-group fz-recent");
const rowTitles = section => all(section).filter(n => n.props?.className === "fz-session-title").map(n => n.children[0]);
const bodyOf = section => all(section).find(n => n.props?.className === "fz-group-body");

test("project folders start folded", async () => {
  const { tree, stop } = await mount();
  const folders = projectSections(tree);
  assert.equal(folders.length, 2, "one folder per project");
  for (const folder of folders) {
    assert.equal(bodyOf(folder), undefined, "a folded folder renders no rows");
    const caret = all(folder).find(n => n.props?.className?.startsWith("fz-caret"));
    assert.match(caret.props.className, /closed/, "and its caret points at the folder");
    assert.equal(all(folder).find(n => n.props?.className === "fz-group-head").props["aria-expanded"], false);
  }
  stop();
});

test("the three most recent sessions stay pinned open at the top", async () => {
  const { tree, dict, stop } = await mount();
  const recent = recentSection(tree);
  assert.ok(recent, "a recent section exists");
  assert.ok(all(recent).some(n => n.children?.includes(dict.recentSessions)), "it is labelled");
  assert.deepEqual(rowTitles(recent), ["一分钟前", "两小时前", "三小时前"], "newest first, three at most");
  assert.ok(bodyOf(recent), "and it is open");
  stop();
});

test("the recent section is not collapsible", async () => {
  const { tree, stop } = await mount();
  const head = all(recentSection(tree)).find(n => n.props?.className?.includes("fz-recent-head"));
  assert.equal(head.type, "div", "a plain label, so it cannot be folded away");
  assert.equal(head.props.onClick, undefined);
  stop();
});

test("opening a folder shows its rows and keeps the others folded", async () => {
  const { tree, tick, stop, state } = await mount();
  const alpha = projectSections(tree).find(s => all(s).some(n => n.children?.includes("alpha")));
  const head = all(alpha).find(n => n.props?.className === "fz-group-head");
  head.props.onClick();                    // the user opens "alpha"
  assert.equal(state[14].alpha, true, "the open folder is remembered");
  const after = projectSections(tick()).find(s => all(s).some(n => n.children?.includes("alpha")));
  assert.deepEqual(rowTitles(bodyOf(after)), ["十小时前", "一分钟前"], "its sessions are listed");
  const beta = projectSections(tick()).find(s => all(s).some(n => n.children?.includes("beta")));
  assert.equal(bodyOf(beta), undefined, "the other folder stays folded");
  stop();
});

test("the recent list follows the roster filter and the search box", async () => {
  const reviewed = await mount({ filter: "reviewed" });
  assert.deepEqual(rowTitles(recentSection(reviewed.tree)), ["一分钟前"], "only reviewed sessions");
  reviewed.stop();
  const searched = await mount({ query: "两小时" });
  assert.deepEqual(rowTitles(recentSection(searched.tree)), ["两小时前"], "only matches");
  searched.stop();
});
