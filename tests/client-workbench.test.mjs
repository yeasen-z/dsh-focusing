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
  return { render, dict, store: Workbench.askStore };
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

test("home shows one compact ask box and the capability cards", () => {
  const { render, dict } = load();
  const tree = render([0, "home", null, null, "", [], "", "", { range: { label: "本周" }, stats: { sessions: 3, projects: 2, activeDays: 2 } }]);
  const all = text(tree);
  assert.match(all, new RegExp(dict.wb_heroTitle));
  assert.match(all, /3 个会话/);
  assert.equal(find(tree, n => n.props?.className === "fw-cap").length, 3);
  assert.equal(find(tree, n => n.type === "textarea").length, 1, "one compact ask box");
  assert.equal(find(tree, n => n.props?.className === "fw-chat-wrap").length, 0, "no embedded chat");
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

test("the footer is two plain text lines; the one gear that opens settings sits in the top bar", () => {
  const { render, dict } = load();
  const tree = render([0, "home", null, null, "", [], "", "", { range: { label: "本周" }, stats: { sessions: 1, projects: 1, activeDays: 1 } }]);
  const openers = find(tree, n => n.type === "button" && n.props?.["aria-haspopup"] === "dialog");
  assert.equal(openers.length, 1, "exactly one control opens settings");
  assert.equal(openers[0].props.className, "fw-gear");
  const bar = find(tree, n => n.props?.className === "fw-brandbar")[0];
  assert.ok(bar && find(bar, n => n === openers[0]).length === 1, "the gear is in the top bar, beside the name");
  const foot = find(tree, n => n.props?.className === "fw-nav-foot")[0];
  assert.equal(find(foot, n => n.type === "button").length, 0, "nothing in the footer is a control");
  const lines = find(foot, n => String(n.props?.className ?? "").startsWith("fw-sum"));
  assert.equal(lines.length, 1, "one line: the model in force; the Codex line is not shown");
  assert.equal(lines[0].props.title, text(lines[0]), "the full model name is the hover text");
  assert.ok(text(lines[0]).length > 0);
  assert.equal(find(tree, n => String(n.props?.className ?? "").includes("fw-chip-dot")).length, 0, "no status dots");
});


test("the top bar keeps the gear on the name's row; the sheet never lets it wrap under", () => {
  // The markup was right but the rules were missing once: without them the gear
  // fell to its own line and sat misaligned. Both halves are pinned here.
  const rule = sel => new RegExp("\\" + sel + "\\{([^}]*)\\}").exec(SOURCE)?.[1] ?? "";
  const bar = rule(".fw-brandbar");
  assert.ok(bar, "the brand bar is styled at all");
  assert.match(bar, /display:flex/);
  assert.match(bar, /justify-content:space-between/, "the name left, the gear right");
  assert.match(bar, /align-items:center/);
  assert.ok(!/flex-wrap:wrap/.test(bar), "the gear never wraps onto its own line");
  assert.match(rule(".fw-gear"), /flex:0 0 auto/, "and cannot be squeezed out of the row");
  // A narrow sidebar stacks them on purpose, centred -- not a broken wrap.
  const compact = /@container\(max-width:820px\)\{[^\n]*/.exec(SOURCE)?.[0] ?? "";
  assert.match(compact, /\.fw-brandbar\{flex-direction:column/, "narrow: a deliberate stack");
  assert.match(compact, /\.fw-brand\{justify-content:center;padding:0\}/, "with no stray gap under the name");
});

test("the Codex line reads set up or not set up; the count and folder are in the hover text", () => {
  const { dict } = load();
  const t = k => dict[k] ?? k;
  const { codexLineText, codexLineTitle } = loadHelpers();
  const set = `${dict.codexChipLabel} · ${dict.codexSet}`, unset = `${dict.codexChipLabel} · ${dict.codexUnset}`;
  // A working folder is set up at once, whether or not its summaries are built yet.
  assert.equal(codexLineText({ enabled: true, ok: true, sessions: 0, pending: 151 }, t), set);
  assert.equal(codexLineText({ enabled: true, ok: true, sessions: 151, pending: 0 }, t), set);
  assert.equal(codexLineText({ enabled: true, ok: false, reason: "not-found" }, t), unset, "a folder that does not work is not set up");
  assert.equal(codexLineText({ enabled: false }, t), unset);
  assert.equal(codexLineText(null, t), unset, "no status yet");
  assert.match(codexLineTitle({ enabled: true, ok: true, sessions: 151, path: "/h/.codex" }, t), /151.*\/h\/\.codex/);
  assert.match(codexLineTitle({ enabled: true, ok: false }, t), new RegExp(dict.codexProblem));
  assert.match(codexLineTitle({ enabled: false }, t), new RegExp(dict.codexOff));
});



function loadHelpers() {
  const src = fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
  const pick = name => src.slice(src.indexOf(`function ${name}(`), src.indexOf("\n    }", src.indexOf(`function ${name}(`)) + 6);
  return new Function(`${pick("codexLineText")}${pick("codexLineTitle")}; return { codexLineText, codexLineTitle };`)();
}



// Conversations live in a page-level store, not in component state. `render`
// gives the Workbench; seed the store (and open one), then render.
const user = text => ({ role: "user", content: [{ type: "text", text }] });
const asst = (text, ...calls) => ({ role: "assistant", content: [...(text ? [{ type: "text", text }] : []), ...calls.map(c => ({ type: "tool-call", ...c }))] });
const result = (toolCallId, text) => ({ role: "tool", toolCallId, content: [{ type: "text", text }] });
const withAsks = (list, load, open = list[0]?.id) => {
  load.store.seed(list);
  if (open) load.store.pick(open); else load.store.newChat();
  return [0, "home", null, null, "", [], "", "", { range: { label: "本周" }, stats: { sessions: 1, projects: 1, activeDays: 1 } }];
};
// Function components are not expanded by the stub React: find the ChatView
// node and call it with its own props, as React would.
const chatViews = (tree) => find(tree, n => typeof n.type === "function" && n.type.name === "ChatView").map(n => n.type(n.props));
const runDetails = (tree) => find(tree, n => n.type === "details" && n.props?.className === "fz-run");

test("a conversation shows the thread: questions, answers, and tool calls collapsed between them", () => {
  const env = load();
  const { render, dict } = env;
  const conv = {
    id: "ask-1", title: "上周做了什么", status: "idle", model: "p/m", steps: [],
    messages: [
      user("上周做了什么"),
      asst("", { id: "c1", name: "focus_list_sessions", arguments: '{"query":"登录"}' }, { id: "c2", name: "focus_read_session", arguments: '{"sessionId":"s1"}' }),
      result("c1", '{"total":2}'), result("c2", "Error: nope"),
      asst("做了登录修复。"),
      user("具体哪个项目？"),
      asst("是 dsh-focusing。"),
    ],
  };
  const views = chatViews(render(withAsks([conv], env)));
  assert.equal(views.length, 1);
  const tree = views[0];
  const all = text(tree);
  assert.ok(all.includes("上周做了什么") && all.includes("具体哪个项目？"), "both questions are in the thread");
  assert.equal(find(tree, n => n.props?.className === "fw-msg-user").length, 2);
  // Answers are markdown: they reach the Md component as its `text` prop, in order.
  const md = find(tree, n => typeof n.type === "function" && typeof n.props?.text === "string").map(n => n.props.text);
  assert.deepEqual(md, ["做了登录修复。", "是 dsh-focusing。"]);
  assert.ok(all.includes(`2 ${dict.toolCalls}`), "the two calls are one folded run");
  assert.ok(all.includes("focus_list_sessions") && all.includes("query=登录"), "the call and its arguments are shown");
  assert.equal(runDetails(tree).length, 1);
  assert.equal(runDetails(tree)[0].props.open, false, "collapsed once finished");
  assert.ok(all.includes("p/m"), "the model that answered is named");
});

test("a running turn says so and keeps its calls open so the work is visible", () => {
  const env = load();
  const { render, dict } = env;
  const running = { id: "ask-2", title: "q", status: "running", messages: [user("q")], steps: [{ kind: "call", id: "c1", name: "focus_activity", arguments: "{}", status: "running" }] };
  const tree = chatViews(render(withAsks([running], env)))[0];
  assert.ok(text(tree).includes(dict.askThinking));
  assert.equal(runDetails(tree)[0].props.open, true);
  const starting = chatViews(render(withAsks([{ id: "ask-3", title: "q", status: "running", messages: [user("q")], steps: [] }], env)))[0];
  assert.ok(text(starting).includes(dict.askStarting));
  assert.equal(runDetails(starting).length, 0);
});

test("a failed turn shows its reason as an alert and keeps the question", () => {
  const env = load();
  const { render, dict } = env;
  const tree = chatViews(render(withAsks([{ id: "x1", title: "q", status: "failed", steps: [], messages: [user("问过的内容")], detail: "HTTP 500" }], env)))[0];
  assert.ok(text(tree).includes("HTTP 500"));
  assert.ok(text(tree).includes("问过的内容"));
  assert.equal(find(tree, n => n.props?.role === "alert").length, 1);
  assert.ok(find(tree, n => n.type === "button" && n.children.includes(dict.askDelete)).length >= 1);
});

test("stopped and interrupted turns keep the thread and say why they ended", () => {
  const env = load();
  const { render, dict } = env;
  const base = { id: "a", title: "问过的内容", messages: [user("问过的内容")], steps: [{ kind: "call", id: "c1", name: "focus_activity", arguments: "{}", status: "done", result: "{}" }], createdAt: Date.now() };
  const stopped = chatViews(render(withAsks([{ ...base, status: "cancelled" }], env)))[0];
  assert.ok(text(stopped).includes("问过的内容") && text(stopped).includes(dict.askCancelled));
  const interrupted = chatViews(render(withAsks([{ ...base, id: "b", status: "interrupted" }], env)))[0];
  assert.ok(text(interrupted).includes(dict.askInterrupted));
  // Both can be deleted; only a running one offers Stop.
  const buttons = tree => find(tree, n => n.type === "button").map(n => text(n));
  assert.ok(buttons(stopped).includes(dict.askDelete) && !buttons(stopped).includes(dict.askStop));
  const live = chatViews(render(withAsks([{ ...base, id: "c", status: "running" }], env)))[0];
  assert.ok(buttons(live).includes(dict.askStop) && buttons(live).includes(dict.askDelete));
});

test("there is a way to start a new chat, and to switch between past ones", () => {
  const env = load();
  const { render, dict } = env;
  const a = { id: "a", title: "第一个话题", status: "idle", messages: [user("第一个话题")], steps: [] };
  const b = { id: "b", title: "第二个话题", status: "idle", messages: [user("第二个话题")], steps: [] };
  const tree = render(withAsks([a, b], env, "a"));
  const select = find(tree, n => n.type === "select")[0];
  assert.ok(select, "a switcher lists the conversations");
  const options = find(select, n => n.type === "option").map(n => text(n));
  assert.deepEqual(options, [dict.askNew, "第一个话题", "第二个话题"]);
  assert.equal(select.props.value, "a", "the open one is selected");
  assert.ok(find(tree, n => n.type === "button" && text(n) === dict.askNew).length >= 1, "and a visible new-chat button while one is open");

  select.props.onChange({ target: { value: "b" } });
  assert.equal(env.store.activeId(), "b");
  select.props.onChange({ target: { value: "" } });
  assert.equal(env.store.active(), undefined, "choosing the first entry starts afresh");
  const fresh = render(withAsks([a, b], env, null));
  assert.equal(chatViews(fresh).length, 0, "no thread is shown for a new chat");
  assert.equal(find(fresh, n => n.type === "button" && text(n) === dict.askNew).length, 0, "and no redundant button");
});
