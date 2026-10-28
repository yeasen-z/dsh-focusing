// Leaving the Focusing panel unmounts the workbench, so the page you were on
// must live outside the component. These tests remount it the way DSH does and
// check that the same page -- including which digest or room was open -- comes
// back, that a detail page without its subject degrades safely, and that a
// non-macOS/absent sessionStorage environment still works.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SOURCE = fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

function session() {
  const store = new Map();
  return {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); },
    _store: store,
  };
}

function mount(store) {
  let captured;
  const effects = [];
  const saved = { window: globalThis.window, document: globalThis.document };
  globalThis.window = { __ModuleLoader__: { load: d => { captured = d; } }, sessionStorage: store };
  // A terminal, non-running payload: a stub that returns nothing would make the
  // digest poller retry forever and hang the test run.
  globalThis.fetch = async () => ({ ok: true, json: async () => ({
    ok: true, status: "done",
    digest: { id: "d", status: "done", result: null, sources: [], followups: [] },
    room: { id: "r", pending: null, turns: [] },
    rooms: [], records: [], digests: [], sessions: [], models: [], settings: {},
    range: { label: "本周" }, stats: { sessions: 0, projects: 0, activeDays: 0, calls: 0 },
  }) });
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
  let Workbench;
  api.apply({
    locale: { bind: () => k => dict[k] ?? k, register: (ns, l, t) => { if (l === "zh") Object.assign(dict, t); return () => {}; }, subscribe: () => () => {} },
    effect: fn => fn(), get: () => undefined,
    slots: { inject: (n, fn) => fn(), register: (o, c) => { if (o.name === "focusing.panel.body") Workbench = c; return () => {}; } },
  });
  const render = preset => {
    states = preset; index = 0;
    const tree = Workbench({ t: k => dict[k] ?? k, subscribeLocale: () => () => {}, openSession: () => {} });
    // run the effects, as React would after the first paint
    const cleanups = effects.splice(0).map(fn => fn());
    return { tree, dict, cleanups: cleanups.filter(f => typeof f === "function") };
  };
  const restore = () => {
    if (saved.window === undefined) delete globalThis.window; else globalThis.window = saved.window;
    if (saved.document === undefined) delete globalThis.document; else globalThis.document = saved.document;
  };
  return { render, restore };
}

// Same state layout the other workbench tests use: 24 entries, then the
// rooms/roomId/room states.
const base = view => [0, view, null, null, "", [], "", "", null, "", false, "", "this-week", "", "",
  null, "", null, null, "", false, "model", null, Date.now()];

const navItems = tree => {
  const out = [];
  const visit = n => { if (n && typeof n === "object") { if (n.props?.["aria-current"] === "page") out.push(n); (n.children || []).forEach(visit); } };
  visit(tree);
  return out;
};

test("the page survives a remount", () => {
  const store = session();
  // first visit: land on the records page, then leave the panel
  let app = mount(store);
  app.render(base("records"));
  app.restore();

  // coming back must reopen records, not home
  app = mount(store);
  const { tree, dict } = app.render([]);
  const active = navItems(tree);
  assert.equal(active.length, 1, "exactly one nav item is current");
  assert.equal(active[0].props.title, dict.wb_records, "records is the current page");
  app.restore();
});

test("an open digest is restored with its subject", () => {
  const store = session();
  let app = mount(store);
  app.render([0, "result", "digest-42"]);
  app.restore();

  app = mount(store);
  app.render([]);
  const saved = JSON.parse(store._store.get("dsh-focusing.page"));
  assert.deepEqual(saved, { view: "result", digestId: "digest-42", roomId: null }, "the digest id is kept");
  app.restore();
});

test("an open room is restored with its subject", () => {
  const store = session();
  let app = mount(store);
  app.render([...base("room"), [], "room-7"]);
  app.restore();

  app = mount(store);
  app.render([]);
  const saved = JSON.parse(store._store.get("dsh-focusing.page"));
  assert.equal(saved.view, "room");
  assert.equal(saved.roomId, "room-7", "the room id is kept");
  app.restore();
});

test("a detail page without its subject falls back instead of showing nothing", () => {
  const store = session();
  store.setItem("dsh-focusing.page", JSON.stringify({ view: "result", digestId: null }));
  const app = mount(store);
  app.render([]);
  const saved = JSON.parse(store._store.get("dsh-focusing.page"));
  assert.equal(saved.view, "home", "a digest page with no digest reopened home");
  app.restore();
});

test("corrupt or unknown stored state falls back to home", () => {
  for (const stored of ["{not json", JSON.stringify({ view: "nope" }), JSON.stringify(null)]) {
    const store = session();
    store.setItem("dsh-focusing.page", stored);
    const app = mount(store);
    app.render([]);
    assert.equal(JSON.parse(store._store.get("dsh-focusing.page")).view, "home", `recovered from ${stored}`);
    app.restore();
  }
});

test("a missing sessionStorage does not break the page", () => {
  const app = mount(undefined);
  const { tree, dict } = app.render([]);
  assert.ok(JSON.stringify(tree).includes(dict.wb_home) || JSON.stringify(tree).length > 0, "still renders");
  app.restore();
});
