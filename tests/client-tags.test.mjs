// Canonical session tags: record filters, cache scope and conversation scope.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SOURCE = fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
const text = n => typeof n === "string" ? n : Array.isArray(n) ? n.map(text).join("") : n && typeof n === "object" ? (n.children || []).map(text).join("") : "";
const find = (n, pred, out = []) => { if (Array.isArray(n)) { n.forEach(c => find(c, pred, out)); return out; } if (n && typeof n === "object") { if (pred(n)) out.push(n); (n.children || []).forEach(c => find(c, pred, out)); } return out; };

function load({ storage } = {}) {
  let captured;
  globalThis.window = { __ModuleLoader__: { load: d => { captured = d; } }, sessionStorage: storage };
  globalThis.fetch ??= async () => ({ ok: true, json: async () => ({}) });
  new Function(SOURCE)();
  let states = [], index = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: "Fragment", useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn,
    useState: init => { const i = index++; if (!(i in states)) states[i] = typeof init === "function" ? init() : init; return [states[i], value => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; },
  };
  const api = captured.factory(name => { if (name === "react") return React; throw new Error(name); });
  const dict = {};
  let Workbench, injected;
  api.apply({
    locale: { bind: () => k => dict[k] ?? k, register: (_ns, language, table) => { if (language === "zh") Object.assign(dict, table); return () => {}; }, subscribe: () => () => {} },
    effect: fn => fn(), get: () => undefined,
    slots: { inject: (_name, fn) => fn(), register: (options, component) => { if (options.name === "focusing.panel.body") { Workbench = component; injected = options.inject?.(); } return () => {}; } },
  });
  const render = preset => { states = preset ? [...preset] : []; index = 0; return Workbench({ ...injected, t: key => dict[key] ?? key, subscribeLocale: () => () => {}, openSession() {} }); };
  const rerender = () => { index = 0; return Workbench({ ...injected, t: key => dict[key] ?? key, subscribeLocale: () => () => {}, openSession() {} }); };
  return { render, rerender, dict, store: Workbench.askStore, state: () => states, view: () => states[1], Workbench };
}
const record = (extra = {}) => ({ id: "s1", title: "修复登录", cwd: "/w/app", project: "app", gist: "g", turns: 2, calls: 5, lastAt: Date.now(), ...extra });
const recordsOf = rec => ({ ok: true, records: [rec], stats: { sessions: 1, turns: 2, calls: 5 }, range: { label: "本周", from: "a", to: "b" }, projects: ["app"], workspaces: ["/w/app"] });
const recordsState = (records, extra = {}) => [0, "records", null, null, "", [], "", "", null, "", false, "", "this-week", "", "", "", records, "", ...Object.values(extra)];

test("canonical tags cover source/project/workspace and append repeated tag parameters", () => {
  const { Workbench } = load();
  const tags = Workbench.sessionTags({ source: "claude", cwd: "C:\\work\\app\\", project: "app" });
  assert.deepEqual(tags.map(tag => tag.id), ["source:claude", "project:app", "workspace:C:/work/app"]);
  assert.equal(tags.find(tag => tag.kind === "workspace").label, "app");
  const params = Workbench.appendTagParams(new URLSearchParams({ range: "all" }), ["source:claude", "workspace:C:/work/app", "source:claude"]);
  assert.deepEqual(params.getAll("tag"), ["source:claude", "workspace:C:/work/app"]);
  assert.notEqual(Workbench.scopeKey(["project:b", "project:a"]), Workbench.scopeKey(["project:a"]));
  assert.equal(Workbench.scopeKey(["project:b", "project:a"]), Workbench.scopeKey(["project:a", "project:b"]));
});

test("clicking a record tag toggles the AND filter and its removable scope chip", () => {
  const env = load();
  const rec = record({ tags: ["source:dsh", "project:app", "workspace:/w/app"] });
  const tree = env.render(recordsState(recordsOf(rec)));
  const workspace = find(tree, n => n.type === "button" && n.props?.title === "workspace:/w/app")[0];
  assert.ok(workspace, "the canonical workspace tag is rendered on the record");
  workspace.props.onClick({ stopPropagation() {} });
  const filtered = env.rerender();
  assert.deepEqual(env.state().at(-1), ["workspace:/w/app"]);
  const selected = find(filtered, n => n.type === "button" && n.props?.["aria-label"] === "workspace:/w/app ×")[0];
  assert.ok(selected, "the selected scope is visible and removable");
  selected.props.onClick();
  assert.deepEqual(env.state().at(-1), [], "clicking the selected tag removes it again");
});

test("record detail starts a tagged conversation and send forwards the same scope", async () => {
  const env = load();
  const rec = record({ tags: ["source:dsh", "project:app", "workspace:/w/app"] });
  const detail = { ...rec, requests: [], lastReply: "改好了", files: [], todos: [] };
  const tree = env.render(recordsState(recordsOf(rec), { 18: rec.id, 19: detail }));
  const discuss = find(tree, n => n.type === "button" && text(n).includes(env.dict.wb_discussTags))[0];
  assert.ok(discuss, "the detail offers a tag-scoped discussion");
  discuss.props.onClick();
  assert.equal(env.view(), "ask");
  assert.deepEqual(env.store.tags(), rec.tags);
  assert.ok(text(env.rerender()).includes("workspace:/w/app"), "the ask page displays its scope");

  let posted;
  globalThis.fetch = async (_url, options) => {
    posted = JSON.parse(options.body);
    return { ok: true, json: async () => ({ ok: true, ask: { id: "ask-1", title: posted.question, status: "idle", steps: [], messages: [], tags: posted.tags } }) };
  };
  await env.store.send("继续这个项目");
  assert.deepEqual(posted.tags, rec.tags, "the first question carries the record tags");
});

test("new chats preserve scope and picking a conversation restores its own scope", () => {
  const env = load();
  env.store.newChat(["source:claude", "workspace:/w/app"]);
  env.store.newChat();
  assert.deepEqual(env.store.tags(), ["source:claude", "workspace:/w/app"], "an explicit new chat does not silently drop scope");
  env.store.seed([{ id: "old", title: "old", status: "idle", messages: [], steps: [], tags: ["workspace:/w/other"] }]);
  env.store.pick("old");
  assert.deepEqual(env.store.tags(), ["workspace:/w/other"], "the existing conversation's saved scope wins");
  env.store.newChat();
  assert.deepEqual(env.store.tags(), ["workspace:/w/other"]);
  env.store.setTags([]);
  assert.deepEqual(env.store.tags(), []);
});

test("record cache is not reused across different tag scopes", () => {
  const stored = new Map();
  const storage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) };
  const payload = recordsOf(record({ title: "其他范围的缓存" }));
  storage.setItem("dsh-focusing.records.v1", JSON.stringify({ range: "this-week", tags: [], data: payload }));
  storage.setItem("dsh-focusing.page", JSON.stringify({ view: "records", recTags: ["project:app"] }));
  const env = load({ storage });
  const tree = env.render([]);
  assert.ok(!text(tree).includes("其他范围的缓存"), "a cached list from another tag scope is never shown");
});
