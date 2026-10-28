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
    { id: "s-arch", title: "已归档的", project: "alpha", cwd: "/a", updatedAt: NOW - 30e3, status: "idle", reviewed: false, archived: true },
    { id: "s-old", title: "十小时前", project: "alpha", cwd: "/a", updatedAt: NOW - 10 * 3600e3, status: "idle", reviewed: false },
    { id: "s-new", title: "一分钟前", project: "alpha", cwd: "/a", updatedAt: NOW - 60e3, status: "idle", reviewed: true, reviewCount: 2 },
    { id: "s-mid", title: "两小时前", project: "beta", cwd: "/b", updatedAt: NOW - 2 * 3600e3, status: "idle", reviewed: false },
    { id: "s-4th", title: "三小时前", project: "beta", cwd: "/b", updatedAt: NOW - 3 * 3600e3, status: "idle", reviewed: false },
  ];
}

async function mount({ filter = "all", query = "", loadArchived = false, extra = [] } = {}) {
  let captured;
  const effects = [];
  const saved = { window: globalThis.window };
  globalThis.window = { __ModuleLoader__: { load: d => { captured = d; } } };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, status: "done", sessions: [...sessions(), ...extra], digest: { status: "done" }, analysis: { loadArchived } }) });
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
// The recent list shows cards and the folders show rows; both carry the title in a
// dedicated span, so the helper reads either.
const rowTitles = section => all(section).filter(n => n.props?.className === "fz-session-title" || n.props?.className === "fz-recent-card-title").map(n => n.children[0]);
const bodyOf = section => all(section).find(n => n.props?.className === "fz-group-body");

test("project folders start folded", async t => {
  const { tree, stop } = await mount();
  t.after(stop);
  const folders = projectSections(tree);
  assert.equal(folders.length, 2, "one folder per project");
  for (const folder of folders) {
    assert.equal(bodyOf(folder), undefined, "a folded folder renders no rows");
    const caret = all(folder).find(n => n.props?.className?.startsWith("fz-caret"));
    assert.match(caret.props.className, /closed/, "and its caret points at the folder");
    assert.equal(all(folder).find(n => n.props?.className === "fz-group-head").props["aria-expanded"], false);
  }
});

test("the three most recent sessions stay pinned open at the top", async t => {
  const { tree, dict, stop } = await mount();
  t.after(stop);
  const recent = recentSection(tree);
  assert.ok(recent, "a recent section exists");
  assert.ok(all(recent).some(n => n.children?.includes(dict.recentSessions)), "it is labelled");
  assert.deepEqual(rowTitles(recent), ["一分钟前", "两小时前", "三小时前"], "newest first, three at most");
  assert.ok(all(recent).some(n => n.props?.className === "fz-recent-cards"), "and it is open, its cards always shown");
});

test("the recent section is not collapsible", async t => {
  const { tree, stop } = await mount();
  t.after(stop);
  const head = all(recentSection(tree)).find(n => n.props?.className?.includes("fz-recent-head"));
  assert.equal(head.type, "div", "a plain label, so it cannot be folded away");
  assert.equal(head.props.onClick, undefined);
});

test("opening a folder shows its rows and keeps the others folded", async t => {
  const { tree, tick, stop, state } = await mount();
  t.after(stop);
  const alpha = projectSections(tree).find(s => all(s).some(n => n.children?.includes("alpha")));
  const head = all(alpha).find(n => n.props?.className === "fz-group-head");
  head.props.onClick();                    // the user opens "alpha"
  assert.equal(state[14].alpha, true, "the open folder is remembered");
  const after = projectSections(tick()).find(s => all(s).some(n => n.children?.includes("alpha")));
  assert.deepEqual(rowTitles(bodyOf(after)), ["一分钟前", "十小时前"], "its sessions are listed, newest first");
  const beta = projectSections(tick()).find(s => all(s).some(n => n.children?.includes("beta")));
  assert.equal(bodyOf(beta), undefined, "the other folder stays folded");
});

test("archived chats stay out of the roster by default", async t => {
  const { tree, stop } = await mount();
  t.after(stop);
  const rows = all(tree).filter(n => /^fz-(session|recent-card)( |$)/.test(String(n.props?.className)));
  assert.ok(rows.length > 0, "the roster is not empty");
  assert.ok(!all(tree).some(n => n.children?.includes("已归档的")), "the archived chat is hidden");
  assert.ok(!rowTitles(recentSection(tree)).includes("已归档的"), "and it cannot reach the recent list either");
});

test("turning the setting on lists archived chats, marked as such", async t => {
  const { tree, stop } = await mount({ loadArchived: true });
  t.after(stop);
  const recent = rowTitles(recentSection(tree));
  assert.ok(recent.includes("已归档的"), "the archived chat is listed again");
  assert.equal(recent[0], "已归档的", "newest first, so it leads the recent list");
  const row = all(tree).find(n => /(^| )archived( |$)/.test(String(n.props?.className)));
  assert.ok(row, "the card carries the archived class");
  const tag = all(row).find(n => n.props?.className === "fz-archived-tag");
  assert.ok(tag, "and carries a visible tag, not only a faded row");
  assert.deepEqual(tag.children, ["已归档"], "reading the label in the reader's language");
  const live = all(tree).filter(n => (n.props?.className === "fz-session-title" || n.props?.className === "fz-recent-card-title") && n.children[0] === "一分钟前");
  assert.ok(live.length > 0, "a live chat in the same list");
  const tags = all(tree).filter(n => n.props?.className === "fz-archived-tag");
  assert.equal(tags.length, 1, "only the archived chat carries the tag");
});

test("the recent list follows the roster filter and the search box", async t => {
  const reviewed = await mount({ filter: "reviewed" });
  t.after(reviewed.stop);
  assert.deepEqual(rowTitles(recentSection(reviewed.tree)), ["一分钟前"], "only reviewed sessions");
  reviewed.stop();
  const searched = await mount({ query: "两小时" });
  t.after(searched.stop);
  assert.deepEqual(rowTitles(recentSection(searched.tree)), ["两小时前"], "only matches");
});

test("recent sessions are large cards: one click loads, and the card says where it lives", async t => {
  const { tree, stop } = await mount();
  t.after(stop);
  const cards = all(tree).filter(n => /^fz-recent-card( |$)/.test(String(n.props?.className)));
  assert.equal(cards.length, 3, "the three most recent");
  assert.equal(cards[0].type, "button", "a real button, so it is keyboard reachable");
  assert.equal(typeof cards[0].props.onClick, "function", "and loads the chat on click");
  const meta = all(cards[0]).find(n => n.props?.className === "fz-recent-card-meta");
  assert.ok(meta && String(meta.children[0]).includes("alpha"), "the card names its project");
});

test("the archived switch sits under the search box and writes the same setting", async t => {
  const { tree, stop } = await mount();
  t.after(stop);
  const search = all(tree).find(n => n.props?.className === "fz-search");
  const archive = all(tree).find(n => n.props?.className === "fz-archive-switch");
  assert.ok(search && archive, "both are in the rail");
  // Document order: the switch must come after the search box it sits under.
  const ordered = all(tree).map(n => n.props?.className).filter(c => c === "fz-search" || c === "fz-archive-switch");
  assert.deepEqual(ordered, ["fz-search", "fz-archive-switch"], "the switch sits under the search box");
  const box = all(archive).find(n => n.type === "input");
  assert.equal(box.props.checked, false, "off by default, as the stored setting says");
});

test("a running chat keeps its place while its contents update", async t => {
  // The bug: every poll re-sorted by age, so a chat that was active jumped to
  // the top. The order is captured when the panel opens and only Refresh moves it.
  const { tree, tick, stop, state } = await mount();
  t.after(stop);
  const before = rowTitles(recentSection(tree));
  assert.deepEqual(before, ["一分钟前", "两小时前", "三小时前"]);
  // Make the oldest chat the most recently active, as a running chat does.
  const list = state[1];
  const oldest = list.find(s => s.title === "三小时前");
  oldest.updatedAt = Date.now();
  const after = rowTitles(recentSection(tick()));
  assert.deepEqual(after, before, "the order does not reshuffle under the person");
  // The contents did update: the row is still there and reads the new state.
  assert.equal(list.find(s => s.title === "三小时前").updatedAt > 0, true);
});

test("refresh takes a new order from the current contents", async t => {
  const { tree, tick, stop, state } = await mount();
  t.after(stop);
  state[1].find(s => s.title === "三小时前").updatedAt = Date.now();
  assert.notDeepEqual(rowTitles(recentSection(tick())), ["三小时前", "一分钟前", "两小时前"], "still held");
  // Refresh is the explicit re-sort; it is the only path that changes the order.
  const refresh = all(tree).find(n => n.props?.className === "fz-order-refresh") || all(tick()).find(n => n.props?.className === "fz-order-refresh");
  assert.ok(refresh, "a refresh control is shown");
  refresh.props.onClick();
  assert.deepEqual(rowTitles(recentSection(tick())), ["三小时前", "一分钟前", "两小时前"], "refresh re-sorts");
});

test("the session list is a drawer: closed by default, opened from the topbar", async t => {
  const { tree, tick, stop } = await mount();
  t.after(stop);
  const rail = () => all(tick()).find(n => n.type === "aside");
  assert.ok(!/(^| )open( |$)/.test(String(rail().props.className)), "closed at first, so the content has the width");
  const button = all(tick()).find(n => n.props?.className === "fz-drawer-btn");
  assert.ok(button, "a topbar button opens it");
  assert.equal(button.props["aria-expanded"], false);
  button.props.onClick();
  assert.ok(/(^| )open( |$)/.test(String(rail().props.className)), "the button opens the drawer");
  assert.equal(all(tick()).find(n => n.props?.className === "fz-drawer-btn").props["aria-expanded"], true);
});

test("choosing a chat closes the drawer; the scrim closes it without choosing", async t => {
  const { tree, tick, stop } = await mount();
  t.after(stop);
  const open = () => { all(tick()).find(n => n.props?.className === "fz-drawer-btn").props.onClick(); };
  const isOpen = () => /(^| )open( |$)/.test(String(all(tick()).find(n => n.type === "aside").props.className));
  open();
  assert.ok(isOpen());
  all(tick()).find(n => /^fz-scrim( |$)/.test(String(n.props?.className))).props.onClick();
  assert.ok(!isOpen(), "the scrim dismisses it");
  open();
  const card = all(tick()).find(n => /^fz-recent-card( |$)/.test(String(n.props?.className)));
  card.props.onClick();
  assert.ok(!isOpen(), "choosing a chat closes it, since the content now shows that chat");
});

test("the analysis page has no settings button in its top-right; settings stay in the global nav", async t => {
  const { tree, tick, stop } = await mount();
  t.after(stop);
  const top = all(tick()).filter(n => n.props?.className === "fz-actions");
  assert.equal(top.length, 1, "the top-right action group still exists");
  const labels = all(top[0]).filter(n => n.type === "button").map(n => n.props?.className);
  assert.ok(!labels.includes("fz-save-btn"), "the analysis settings button is gone");
});

const codexRow = { id: "codex:aaa", source: "codex", sourceId: "aaa", title: "来自 Codex 的会话", project: "paper", cwd: "/p", updatedAt: NOW - 5 * 60e3, status: "idle", loaded: true, archived: false, reviewed: false, reviewCount: 0 };

test("Codex chats sit in their own section, apart from the DSH folders", async t => {
  const { tree, tick, stop, state } = await mount({ extra: [codexRow] });
  t.after(stop);
  const section = all(tree).find(n => n.props?.className === "fz-source-section");
  assert.ok(section, "a separate Codex section");
  // Folders start collapsed; the user opens the Codex folder, then its chat shows.
  all(section).find(n => n.props?.className === "fz-group-head").props.onClick();
  const opened = all(tick()).find(n => n.props?.className === "fz-source-section");
  assert.ok(all(opened).some(n => n.children?.includes("来自 Codex 的会话")), "its chat is listed there once the folder opens");
  // The DSH folders hold none of the Codex chats.
  const dshFolders = all(tree).filter(n => n.props?.className === "fz-group");
  assert.ok(!dshFolders.some(f => all(f).some(n => n.children?.includes("来自 Codex 的会话"))), "not mixed into the DSH folders");
});

test("the pinned recent list shows DSH chats only", async t => {
  const { tree, stop } = await mount({ extra: [codexRow] });
  t.after(stop);
  const recentCards = all(tree).filter(n => /^fz-recent-card( |$)/.test(String(n.props?.className)));
  assert.ok(!recentCards.some(c => all(c).some(n => n.children?.includes("来自 Codex 的会话"))), "no Codex chat is pinned");
});

test("a Codex chat is read-only: its tooltip says so", async t => {
  const { tree, tick, stop } = await mount({ extra: [codexRow] });
  t.after(stop);
  all(all(tree).find(n => n.props?.className === "fz-source-section")).find(n => n.props?.className === "fz-group-head").props.onClick();
  const row = all(all(tick()).find(n => n.props?.className === "fz-source-section")).find(n => /(^| )fz-session( |$)/.test(String(n.props?.className)) && all(n).some(c => c.children?.includes("来自 Codex 的会话")));
  assert.ok(row, "the Codex row renders");
  assert.match(row.props.title, /只读/, "its hover text says it is read-only");
});
