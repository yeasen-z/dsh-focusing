// Smoke-render each workbench view with a stub React, so a typo in a view
// function fails here instead of blanking the page.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SOURCE = fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

function load() {
  let captured;
  globalThis.window = { __ModuleLoader__: { load: d => { captured = d; } } };
  globalThis.fetch ??= async () => ({ ok: true, json: async () => ({}) });
  new Function(SOURCE)();
  let states = [];
  let index = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: "Fragment",
    useEffect: () => {}, useRef: v => ({ current: v }), useCallback: f => f,
    useState: init => { const i = index++; if (!(i in states)) states[i] = init; return [states[i], v => { states[i] = typeof v === "function" ? v(states[i]) : v; }]; },
  };
  const api = captured.factory(n => { if (n === "react") return React; throw new Error(n); });
  const dict = {};
  let Workbench;
  api.apply({
    locale: { bind: () => k => dict[k] ?? k, register: (ns, l, table) => { if (l === "zh") Object.assign(dict, table); return () => {}; }, subscribe: () => () => {} },
    effect: fn => fn(), get: () => undefined,
    slots: { inject: (n, fn) => fn(), register: (o, c) => { if (o.name === "focusing.panel.body") Workbench = c; return () => {}; } },
  });
  const render = (preset) => {
    states = preset; index = 0;
    return Workbench({ t: k => dict[k] ?? k, subscribeLocale: () => () => {}, openSession: () => {} });
  };
  return { render, dict };
}
const text = n => typeof n === "string" ? n : Array.isArray(n) ? n.map(text).join("") : n && typeof n === "object" ? (n.children || []).map(text).join("") : "";
const find = (n, pred, out = []) => { if (n && typeof n === "object") { if (pred(n)) out.push(n); (n.children || []).forEach(c => find(c, pred, out)); } return out; };

// State order in Workbench: localeTick, view, digestId, digest, digestError, digests, ask, range, home, ...
const digest = {
  id: "d1", request: "整理我这周干了什么，进度如何", kind: "weekly", status: "done", createdAt: Date.now(),
  range: { key: "this-week", label: "本周", from: "2026-10-26", to: "2026-10-27" },
  stats: { sessions: 2, projects: 1, activeDays: 2, calls: 30 },
  sources: [{ id: "s1", title: "修复登录", project: "app", calls: 10 }],
  result: { title: "本周工作整理", summary: "主线是 **app**", projects: [{ name: "app", progress: 70, status: "active", headline: "h", items: [{ state: "done", text: "修复登录", sessions: ["s1"] }] }],
    days: [{ day: "2026-10-27", items: [{ text: "修复登录", project: "app" }] }], next: ["发布"], sections: [] },
  followups: [{ q: "还差什么", a: "- 验证" }],
};

test("home shows the ask box, prompt chips and capability cards", () => {
  const { render, dict } = load();
  const tree = render([0, "home", null, null, "", [], "", "", { range: { label: "本周" }, stats: { sessions: 3, projects: 2, activeDays: 2 } }]);
  const all = text(tree);
  assert.match(all, new RegExp(dict.wb_heroTitle));
  assert.match(all, /3 个会话/);
  assert.equal(find(tree, n => n.props?.className === "fw-chip").length, 4);
  assert.equal(find(tree, n => n.props?.className === "fw-cap").length, 3);
  assert.ok(find(tree, n => n.type === "textarea").length === 1);
});

test("a finished digest renders summary, projects, days, next steps and follow-ups", () => {
  const { render } = load();
  const tree = render([0, "result", "d1", digest, "", [], "", "", null]);
  const all = text(tree);
  for (const s of ["本周工作整理", "app", "70%", "修复登录", "发布", "还差什么"]) assert.ok(all.includes(s), s);
  // Markdown blocks are function components; check what they are given.
  const md = find(tree, n => typeof n.type === "function" && typeof n.props?.text === "string").map(n => n.props.text);
  assert.ok(md.includes("主线是 **app**"));
  assert.ok(md.includes("- 验证"));
});

test("a running digest shows its stages", () => {
  const { render, dict } = load();
  const all = text(render([0, "result", "d1", { ...digest, status: "running", stage: "model", result: null }, "", [], "", "", null]));
  assert.ok(all.includes(dict.wb_stageModel));
  assert.ok(all.includes("2 个会话"));
});

test("records and digests views render lists", () => {
  const { render } = load();
  const rec = { id: "s1", title: "修复登录", project: "app", gist: "g", turns: 2, calls: 5, todosDone: 1, todosTotal: 2, lastAt: Date.now() };
  const states = [0, "records", null, null, "", [], "", "", null, "", false, "", "this-week", "", "", { ok: true, records: [rec], stats: { sessions: 1, turns: 2, calls: 5 }, range: { label: "本周", from: "a", to: "b" }, projects: ["app"] }, ""];
  assert.ok(text(render(states)).includes("修复登录"));
  const all = text(render([0, "digests", null, null, "", [{ id: "d1", title: "本周工作整理", kind: "weekly", range: { label: "本周" }, createdAt: Date.now() }], "", "", null]));
  assert.ok(all.includes("本周工作整理"));
});

// Room states start at index 24: rooms, roomId, room, roomErr, form, pickList, modelList, sayText, roomBusy.
// Workbench hook order: localeTick, view, digestId, digest, digestError, digests,
// ask, range, home, fu, fuBusy, fuError, recRange, recQuery, recProject, records,
// recError, expanded, detail, toast, settingsOpen, settingsTab, savedModel, now,
// rooms, roomId, room, roomErr, form, pickList, modelList, sayText, roomBusy.
const base = view => [...[0, view, null, null, "", [], "", "", null, "", false, "", "this-week", "", "",
  null, "", null, null, "", false, "model", null, Date.now()]];

test("rooms view lists rooms and the new-room form offers sessions and per-participant models", () => {
  const { render, dict } = load();
  const list = render([...base("rooms"), [{ id: "r1", title: "后端 × 前端", participants: [{}, {}], messages: 3, updatedAt: Date.now() }]]);
  assert.ok(text(list).includes("后端 × 前端"));
  const form = render([...base("rooms"), [], null, null, "", { topic: "", picks: [{ id: "s1", title: "后端", route: null }] },
    [{ id: "s2", title: "前端", lastAt: Date.now() }], [{ provider: "p", id: "m", name: "M", providerName: "P" }]]);
  const all = text(form);
  assert.ok(all.includes("前端") && all.includes("后端"));
  assert.ok(all.includes(dict.wb_createRoom));
  const options = find(form, n => n.type === "option").map(text);
  assert.ok(options.includes("M · P"), "a DSH model can be chosen per participant");
});

test("an open room shows snapshot freshness, messages, speak buttons and the handoff draft action", () => {
  const { render, dict } = load();
  const room = {
    id: "r1", title: "对齐接口", createdAt: Date.now(),
    participants: [
      { label: "A", session: "b", title: "后端", snapshot: { takenAt: Date.now(), turns: 2, calls: 5 } },
      { label: "B", session: "f", title: "前端", snapshot: { takenAt: Date.now(), turns: 1, calls: 3 } },
    ],
    freshness: [{ moved: true, toolCalls: 4, turns: 1 }, { moved: false }],
    messages: [{ role: "user", text: "对齐字段" }, { role: "participant", speaker: 0, text: "返回 {id,name}", model: "p/m" }],
    handoff: { text: "## Goal\n合并", at: Date.now() },
  };
  const tree = render([...base("room"), [], "r1", room, "", null, null, null, "", false]);
  const all = text(tree);
  assert.ok(all.includes("后端") && all.includes("前端"));
  assert.ok(all.includes(dict.wb_sourceSame));
  assert.match(all, /4/);
  assert.ok(all.includes("A · 后端"));
  const buttons = find(tree, n => n.type === "button").map(text);
  assert.ok(buttons.some(b => b.includes("让 A 发言")) && buttons.some(b => b.includes("让 B 发言")));
  assert.ok(buttons.some(b => b.includes(dict.wb_openNew)));
  const md = find(tree, n => typeof n.type === "function" && typeof n.props?.text === "string").map(n => n.props.text);
  assert.ok(md.includes("## Goal\n合并") && md.includes("返回 {id,name}"));
});

test("settings have one entry, and it shows the model and Codex import on its face", () => {
  const { render, dict } = load();
  const tree = render([0, "home", null, null, "", [], "", "", { range: { label: "本周" }, stats: { sessions: 1, projects: 1, activeDays: 1 } }]);
  const openers = find(tree, n => n.type === "button" && n.props?.["aria-haspopup"] === "dialog");
  assert.equal(openers.length, 1, "exactly one button opens the settings dialog");
  assert.equal(openers[0].props.className, "fw-status-card");
  const face = text(openers[0]);
  assert.ok(face.includes(dict.settingsChipLabel), "the model in force is visible");
  assert.ok(face.includes(dict.codexChipLabel) && face.includes(dict.codexOff), "and whether Codex chats are imported");
  const gear = find(tree, n => n.type === "button" && n.props?.className === "fw-nav-item" && n.props?.title === dict.wb_settings);
  assert.equal(gear.length, 0, "no separate gear button");
});
