// macOS draws the traffic lights inside the window (titleBarStyle hiddenInset,
// lights at 16,18). DSH exposes the room they need as
// --dsh-frame-top-clearance (48px on darwin). A left rail that reaches the
// window's top-left must move its content down, but a rail that already sits
// below or to the right of the buttons must keep its natural padding.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SOURCE = fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

function mount({ platform, railRect, clearance = "48px" }) {
  let captured;
  const effects = [];
  const saved = { window: globalThis.window, document: globalThis.document };
  globalThis.window = { __ModuleLoader__: { load: d => { captured = d; } }, addEventListener() {}, removeEventListener() {} };
  globalThis.requestAnimationFrame = fn => { fn(); return 1; };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.getComputedStyle = () => ({ getPropertyValue: p => p === "--dsh-frame-top-clearance" ? clearance : "" });
  globalThis.fetch ??= async () => ({ ok: true, json: async () => ({}) });

  const classes = new Set();
  const rail = {
    classList: { toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); } },
    getBoundingClientRect: () => railRect,
  };
  globalThis.document = {
    documentElement: { getAttribute: n => (n === "data-platform" ? platform : null) },
  };
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

  const tree = Workbench({ t: k => dict[k] ?? k, subscribeLocale: () => () => {}, openSession: () => {} });
  const visit = n => {
    if (n && typeof n === "object") {
      if (n.props?.className === "fw-nav" && n.props.ref) n.props.ref.current = rail;
      (n.children || []).forEach(visit);
    }
  };
  visit(tree);
  for (const fn of effects) { const stop = fn(); if (typeof stop === "function") stop(); }

  if (saved.window === undefined) delete globalThis.window; else globalThis.window = saved.window;
  if (saved.document === undefined) delete globalThis.document; else globalThis.document = saved.document;
  return classes.has("fw-traffic-safe");
}

const rect = (left, top) => ({ left, top, width: 200, height: 800 });

test("the rail moves when the window buttons would cover it", () => {
  assert.equal(mount({ platform: "darwin", railRect: rect(0, 0) }), true, "fullscreen at the top-left");
  assert.equal(mount({ platform: "darwin", railRect: rect(0, 40) }), true, "partially covered");
});

test("the rail keeps its padding when it is already clear of the buttons", () => {
  assert.equal(mount({ platform: "darwin", railRect: rect(0, 56) }), false, "below the top strip");
  assert.equal(mount({ platform: "darwin", railRect: rect(260, 0) }), false, "right of the shell sidebar");
  assert.equal(mount({ platform: "darwin", railRect: rect(260, 56) }), false, "clear on both axes");
});

test("platforms without in-window window buttons are untouched", () => {
  assert.equal(mount({ platform: "win32", railRect: rect(0, 0) }), false, "windows uses its own titlebar");
  assert.equal(mount({ platform: "linux", railRect: rect(0, 0) }), false, "linux has no traffic lights");
});

test("a missing clearance variable falls back to the darwin default", () => {
  assert.equal(mount({ platform: "darwin", railRect: rect(0, 0), clearance: "" }), true, "still protects the corner");
});

test("the inset is defined in CSS against the shell's own variable", () => {
  for (const cls of [".fw-nav.fw-traffic-safe", ".fz-side.fz-traffic-safe"]) {
    const re = new RegExp(cls.replace(/\./g, "\\.") + "\\{padding-top:var\\(--dsh-frame-top-clearance,48px\\)\\}");
    assert.match(SOURCE, re, `${cls} must pad by --dsh-frame-top-clearance`);
  }
});
