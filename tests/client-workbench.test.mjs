// Smoke-render each workbench view with a stub React, so a typo in a view
// function fails here instead of blanking the page.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SOURCE = fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

function load({ uiWorkspace, storage, workspaces, sessions, conversation } = {}) {
  let captured;
  globalThis.window = { __ModuleLoader__: { load: d => { captured = d; } }, sessionStorage: storage };
  globalThis.fetch ??= async () => ({ ok: true, json: async () => ({}) });
  new Function(SOURCE)();
  let states = [];
  let index = 0;
  let refs = [], refIndex = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: "Fragment",
    useEffect: () => {}, useRef: v => refs[refIndex++] ??= { current: v }, useCallback: f => f,
    // React calls a function initializer once; so does this stub, otherwise a
    // lazily seeded state would reach the component as the function itself.
    useState: init => { const i = index++; if (!(i in states)) states[i] = typeof init === "function" ? init() : init; return [states[i], v => { states[i] = typeof v === "function" ? v(states[i]) : v; }]; },
  };
  const api = captured.factory(n => { if (n === "react") return React; throw new Error(n); });
  const dict = {};
  let Workbench, injected;
  api.apply({
    locale: { bind: () => k => dict[k] ?? k, register: (ns, l, table) => { if (l === "zh") Object.assign(dict, table); return () => {}; }, subscribe: () => () => {} },
    effect: fn => fn(), get: n => ({ uiWorkspace, workspaces, sessions, conversation })[n],
    slots: { inject: (n, fn) => fn(), register: (o, c) => { if (o.name === "focusing.panel.body") { Workbench = c; injected = o.inject?.(); } return () => {}; } },
  });
  const render = (preset) => {
    // A copy: an async setState left over from an earlier test must not write
    // back into the shared preset array.
    states = preset ? [...preset] : []; index = 0; refs = []; refIndex = 0;
    return Workbench({ ...injected, t: k => dict[k] ?? k, subscribeLocale: () => () => {}, openSession: () => {} });
  };
  // The page the Workbench would show next: state 1 is `view`.
  const rerender = () => { index = 0; refIndex = 0; return Workbench({ ...injected, t: k => dict[k] ?? k, subscribeLocale: () => () => {}, openSession: () => {} }); };
  const seedTemplates = list => Workbench.tplSeed(list);
  return { render, rerender, dict, startDraft: injected.startDraft, store: Workbench.askStore, seedTemplates, view: () => states[1], state: () => states };
}
const text = n => typeof n === "string" ? n : Array.isArray(n) ? n.map(text).join("") : n && typeof n === "object" ? (n.children || []).map(text).join("") : "";
// Arrays are flattened the way React flattens them, so a mapped child list is
// still found.
const find = (n, pred, out = []) => { if (Array.isArray(n)) { n.forEach(c => find(c, pred, out)); return out; } if (n && typeof n === "object") { if (pred(n)) out.push(n); (n.children || []).forEach(c => find(c, pred, out)); } return out; };

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

const HOME = (extra = {}) => [0, "home", null, null, "", [], "", "", { range: { label: "本周" }, stats: { sessions: 3, projects: 2, activeDays: 2 } }];

test("tool-only consecutive assistant rounds render as one grouped call run", () => {
  const env = load();
  env.store.seed([{ id: "a", title: "q", status: "idle", steps: [], messages: [
    user("q"),
    { role: "assistant", content: [{ type: "tool-call", id: "c1", name: "focus_list_sessions", arguments: "{}" }] },
    { role: "tool", toolCallId: "c1", content: [{ type: "text", text: "list result" }] },
    { role: "assistant", content: [{ type: "tool-call", id: "c2", name: "focus_read_session", arguments: "{}" }] },
    { role: "tool", toolCallId: "c2", content: [{ type: "text", text: "read result" }] },
    asst("answer"),
  ], updatedAt: Date.now() }]);
  env.store.pick("a");
  const tree = chatViews(env.render([0, "ask", null, null, "", [], "", "", null]))[0];
  assert.equal(find(tree, n => n.props?.className === "fz-run").length, 1, "discovery and evidence calls share one card");
  assert.equal(find(tree, n => n.props?.className === "fz-call").length, 2, "calls remain individually inspectable inside the group");
});

test("home prioritizes activity and recent content without repeating feature cards", () => {
  const env = load();
  const { render, dict } = env;
  env.store.seed([{ id: "a", title: "上周做了什么", status: "idle", messages: [], steps: [], updatedAt: Date.now() }]);
  const tree = render(HOME());
  const all = text(tree);
  assert.match(all, new RegExp(dict.wb_heroTitle));
  assert.match(all, /3 个会话/);
  assert.equal(find(tree, n => n.props?.className === "fw-caps" || n.props?.className === "fw-cap").length, 0);
  assert.equal(find(tree, n => n.type === "textarea").length, 0, "nothing is typed on the home page");
  assert.ok(all.includes("上周做了什么"), "the latest chats are listed");
  assert.ok(all.includes(dict.wb_recentChats) && all.includes(dict.wb_recent));
});

test("the Focusing brand returns home and the sidebar does not duplicate it", () => {
  const env = load();
  const preset = HOME(); preset[1] = "records";
  const tree = env.render(preset);
  const brand = find(tree, n => n.props?.className === "fw-brand")[0];
  assert.equal(brand.type, "button");
  assert.equal(text(brand), "Focusing");
  brand.props.onClick();
  assert.equal(env.view(), "home");
  const nav = find(env.render(HOME()), n => String(n.props?.className ?? "").startsWith("fw-nav-item")).map(n => n.props.title);
  assert.deepEqual(nav, [env.dict.todo_pageTitle, env.dict.wb_ask, env.dict.wb_records, env.dict.wb_digests, env.dict.wb_rooms, env.dict.wb_focus]);
});

test("the Ask page is the thread and one input; the conversation list lives in the sidebar", () => {
  const env = load();
  const { render, dict } = env;
  env.store.seed([
    { id: "a", title: "第一个话题", status: "idle", messages: [user("第一个话题"), asst("答一")], steps: [], updatedAt: 2 },
    { id: "b", title: "第二个话题", status: "running", messages: [user("第二个话题")], steps: [], updatedAt: 1 },
  ]);
  env.store.pick("a");
  const tree = render([0, "ask", null, null, "", [], "", "", null]);
  // No second column inside the page: the thread is the page.
  assert.equal(find(tree, n => n.props?.className === "fw-chat-side").length, 0);
  const main = find(tree, n => n.props?.className === "fw-chat-main")[0];
  const scroll = find(main, n => n.props?.className === "fw-chat-scroll")[0];
  assert.ok(scroll && find(scroll, n => n.type === "textarea").length === 0, "the input is not inside the scroll area");
  assert.equal(find(main, n => n.type === "textarea").length, 1, "exactly one input");
  assert.equal(find(tree, n => typeof n.type === "function" && n.type.name === "ChatView").length, 1);

  // The list is in the rail, above the model line.
  const rail = find(tree, n => n.props?.className === "fw-nav-chats")[0];
  assert.ok(rail, "a conversations block in the sidebar");
  const items = find(rail, n => /^fw-nav-chat(\s|$)/.test(String(n.props?.className ?? "")));
  assert.deepEqual(items.map(n => n.props.title), ["第一个话题", "第二个话题"]);
  assert.equal(items[0].props["aria-selected"], true);
  assert.ok(find(items[1], n => n.props?.className === "fw-spin").length, "a running chat shows a spinner");
  const nav = find(tree, n => n.props?.className === "fw-nav-list")[0];
  const foot = find(tree, n => n.props?.className === "fw-nav-foot")[0];
  const order = [nav, rail, foot].map(n => JSON.stringify(tree).indexOf(JSON.stringify(n)));
  assert.ok(order[0] < order[1] && order[1] < order[2], "nav items, then chats, then the model line");
  assert.equal(find(tree, n => n.type === "button" && n.props?.["aria-label"] === dict.askNew).length, 1, "a new-chat control in the rail");
  assert.equal(find(tree, n => n.type === "button" && text(n) === dict.askNew).length, 0, "and not repeated as a label");
});

test("the conversation list stays in the sidebar on every page", () => {
  const env = load();
  const { dict } = env;
  env.store.seed([{ id: "a", title: "第一个话题", status: "idle", messages: [user("第一个话题")], steps: [] }]);
  env.store.pick("a");
  for (const view of ["home", "ask", "records", "digests", "rooms"]) {
    const tree = env.render([0, view, null, null, "", [], "", "", null]);
    const rail = find(tree, n => n.props?.className === "fw-nav-chats")[0];
    assert.ok(rail, `shown on ${view}`);
    assert.ok(find(rail, n => n.type === "button" && text(n).includes("第一个话题")).length, "with the same rows");
    assert.equal(find(rail, n => n.type === "button" && n.props?.["aria-label"] === dict.askNew).length, 1);
  }
});

test("the Ask nav entry always starts fresh, then the created conversation row is selected", async () => {
  const env = load();
  env.store.seed([{ id: "a", title: "已有话题", status: "idle", messages: [user("已有话题")], steps: [] }]);
  env.store.pick("a");
  let tree = env.render([0, "records", null, null, "", [], "", "", null]);
  const askNav = find(tree, n => n.props?.className === "fw-nav-item" && n.props?.title === env.dict.wb_ask)[0];
  askNav.props.onClick();
  assert.equal(env.view(), "ask");
  assert.equal(env.store.active(), undefined, "Ask opens the new-conversation page");

  tree = env.render([0, "ask", null, null, "", [], "", "", null]);
  const selectedNav = find(tree, n => String(n.props?.className ?? "").includes("fw-nav-item active"));
  assert.ok(selectedNav.some(n => n.props.title === env.dict.wb_ask), "Ask is selected before sending");

  env.store.seed([{ id: "new", title: "刚发送的话题", status: "idle", messages: [user("刚发送的话题")], steps: [] }]);
  env.store.pick("new");
  tree = env.render([0, "ask", null, null, "", [], "", "", null]);
  const askAfter = find(tree, n => n.props?.title === env.dict.wb_ask && String(n.props?.className ?? "").startsWith("fw-nav-item"))[0];
  assert.ok(!String(askAfter.props.className).includes("active"), "Ask is no longer selected once a thread exists");
  const row = find(tree, n => n.props?.title === "刚发送的话题" && /^fw-nav-chat/.test(String(n.props?.className ?? "")))[0];
  assert.equal(row.props["aria-selected"], true, "the conversation row becomes selected");
});

test("picking a conversation from another page opens it", () => {
  const env = load();
  const { dict } = env;
  env.store.seed([
    { id: "a", title: "第一个话题", status: "idle", messages: [user("a")], steps: [] },
    { id: "b", title: "第二个话题", status: "idle", messages: [user("b")], steps: [] },
  ]);
  env.store.pick("a");
  const tree = env.render([0, "digests", null, null, "", [], "", "", null]);
  assert.equal(env.view(), "digests");
  const rail = find(tree, n => n.props?.className === "fw-nav-chats")[0];
  const second = find(rail, n => n.type === "button" && text(n).includes("第二个话题"))[0];
  second.props.onClick();
  assert.equal(env.store.activeId(), "b", "the thread opens");
  assert.equal(env.view(), "ask", "and its page comes up");
  // The + button does the same with a fresh chat.
  env.render([0, "records", null, null, "", [], "", "", null]);
  const again = find(env.render([0, "records", null, null, "", [], "", "", null]), n => n.props?.className === "fw-nav-chats")[0];
  find(again, n => n.type === "button" && n.props?.["aria-label"] === dict.askNew)[0].props.onClick();
  assert.equal(env.store.active(), undefined);
  assert.equal(env.view(), "ask");
});

test("many conversations are grouped by day, each group shows a few, and folding works", () => {
  const env = load();
  const { render, dict } = env;
  const day = 864e5;
  // Anchored at local noon, so a run just after midnight cannot push the
  // "today" rows into yesterday and flip the counts.
  const now = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); })();
  const many = [];
  for (let i = 0; i < 12; i++) many.push({ id: `t${i}`, title: `今天 ${i}`, status: "idle", messages: [user(`t${i}`)], steps: [], updatedAt: now - i * 6e4 });
  for (let i = 0; i < 10; i++) many.push({ id: `y${i}`, title: `昨天 ${i}`, status: "idle", messages: [user(`y${i}`)], steps: [], updatedAt: now - day - i * 6e4 });
  for (let i = 0; i < 40; i++) many.push({ id: `o${i}`, title: `更早 ${i}`, status: "idle", messages: [user(`o${i}`)], steps: [], updatedAt: now - 5 * day - i * 6e4 });
  env.store.seed(many);
  env.store.pick("t0");
  const tree = render([0, "ask", null, null, "", [], "", "", null]);
  const rail = find(tree, n => n.props?.className === "fw-nav-chats")[0];
  const heads = find(rail, n => n.props?.className === "fw-nav-group-head");
  assert.deepEqual(heads.map(n => text(n)), ["今天12", "昨天10", "更早40"]);
  const groups = find(rail, n => n.props?.className === "fw-nav-group");
  assert.equal(groups.length, 3);
  // Each group shows at most 8 rows, with a count for the rest.
  const rows = find(rail, n => /^fw-nav-chat(\s|$)/.test(String(n.props?.className ?? "")));
  assert.equal(rows.length, 8 + 8 + 8, "three groups, eight rows each");
  const more = find(rail, n => n.props?.className === "fw-nav-more");
  assert.deepEqual(more.map(n => text(n)), ["还有 4 条", "还有 2 条", "还有 32 条"]);
  assert.equal(find(rail, n => text(n) === "更早 39").length, 0, "beyond the first eight is not rendered yet");

  // "还有 N 条" reveals the rest of that group only. Clicks go through the
  // stub's own state, so re-render without resetting it.
  more[2].props.onClick();
  const after = find(env.rerender(), n => /^fw-nav-chat(\s|$)/.test(String(n.props?.className ?? "")));
  assert.equal(after.length, 8 + 8 + 40);
  assert.equal(find(after, n => text(n) === '更早 39').length, 1, "the rest is now reachable");

  // Folding a group hides its rows and keeps its count.
  const heads2 = find(env.rerender(), n => n.props?.className === "fw-nav-group-head");
  heads2[1].props.onClick();
  const folded = env.rerender();
  const fg = find(folded, n => n.props?.className === "fw-nav-group");
  assert.equal(fg.length, 3, "the header stays");
  assert.equal(find(folded, n => /^fw-nav-chat(\s|$)/.test(String(n.props?.className ?? ""))).length, 8 + 40, "yesterday's rows are gone");
  assert.equal(find(folded, n => n.props?.className === "fw-nav-group-head")[1].props["aria-expanded"], false);
});

test("the native thread header offers archive and keeps the chat open until the Host confirms", async () => {
  const env = load();
  const { render, dict } = env;
  env.store.seed([{ id: "a", native: true, range: "last-7d", title: "第一个话题", status: "idle", messages: [user("q"), asst("a")], steps: [] }]);
  env.store.pick("a");
  const tree = render([0, "ask", null, null, "", [], "", "", null]);
  const head = find(tree, n => n.props?.className === "fw-chat-head")[0];
  assert.ok(text(head).includes("第一个话题"));
  assert.equal(find(tree, n => n.props?.className === "fw-chat-range")[0].props.disabled, true);
  const [archive] = find(head, n => n.type === "button" && text(n) === dict.askArchive);
  assert.ok(archive);
  assert.equal(find(head, n => n.type === "button" && text(n) === dict.askDelete).length, 0);
  const oldFetch = globalThis.fetch;
  let finish;
  globalThis.fetch = async (path, init) => {
    assert.equal(path, "/api/dsh-focusing.native-ask");
    assert.deepEqual(JSON.parse(init.body), { action: "archive", id: "a" });
    return new Promise(resolve => { finish = resolve; });
  };
  try {
    const pending = archive.props.onClick();
    assert.equal(env.store.active().id, "a");
    finish({ ok: true, json: async () => ({ ok: true }) });
    await pending;
    assert.equal(env.store.active(), undefined);
  } finally { globalThis.fetch = oldFetch; }
  assert.match(/\.fw-chat-head\{[^}]*-webkit-app-region:no-drag/.exec(SOURCE)?.[0] ?? "", /no-drag/);
  assert.equal(find(head, n => n.type === "button" && /^fw-nav-chat/.test(String(n.props?.className ?? ""))).length, 0);
});

test("a new chat shows suggestions that send themselves; a running turn offers Stop instead of Send", () => {
  const env = load();
  const { render, dict } = env;
  const sent = [];
  env.store.seed([]);
  env.store.newChat();
  const orig = env.store.send; env.store.send = q => { sent.push(q); };
  const fresh = render([0, "ask", null, null, "", [], "", "", null]);
  assert.equal(find(fresh, n => n.type === "textarea")[0].props.placeholder, dict.askPlaceholder);
  assert.ok(text(fresh).includes(dict.askEmptyTitle));
  const chips = find(fresh, n => n.props?.className === "fw-chip");
  assert.equal(chips.length, 4);
  env.store.send = orig;

  env.store.seed([{ id: "r", title: "q", status: "running", messages: [user("q")], steps: [] }]);
  env.store.pick("r");
  const running = render([0, "ask", null, null, "", [], "", "", null]);
  const labels = find(running, n => n.type === "button").map(n => text(n));
  assert.ok(labels.includes(dict.askStop) && !labels.includes(dict.askSend), "Stop replaces Send while it runs");
  assert.equal(find(running, n => n.type === "textarea")[0].props.placeholder, dict.askFollowPh, "an open chat asks for a follow-up");
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

test("an imported session reference in digest project items opens its records source", () => {
  const env = load();
  const imported = {
    ...digest,
    sources: [{ id: "claude:c1", title: "Claude session" }],
    result: {
      ...digest.result,
      projects: [{ ...digest.result.projects[0], items: [{ state: "done", text: "Claude fix", sessions: ["claude:c1"] }] }],
    },
  };
  const tree = env.render([0, "result", "d1", imported, "", [], "", "", null]);
  const reference = find(tree, n => n.type === "button" && n.props?.title === "Claude session")[0];
  assert.ok(reference, "the project item links to its source session");
  reference.props.onClick();
  assert.equal(env.view(), "records");
  assert.equal(env.state()[35], "claude", "the records source is selected");
  assert.equal(env.state()[18], "claude:c1", "the referenced record is expanded");
});

test("a running digest shows its stages", () => {
  const { render, dict } = load();
  const all = text(render([0, "result", "d1", { ...digest, status: "running", stage: "model", result: null }, "", [], "", "", null]));
  assert.ok(all.includes(dict.wb_stageModel));
  assert.ok(all.includes("2 个会话"));
});

test("records and digests views render lists", () => {
  const { render } = load();
  const rec = { id: "s1", title: "修复登录", cwd: "/w/app", project: "app", gist: "g", turns: 2, calls: 5, todosDone: 1, todosTotal: 2, lastAt: Date.now() };
  const states = [0, "records", null, null, "", [], "", "", null, "", false, "", "this-week", "", "", ["/w/app"], { ok: true, records: [rec], stats: { sessions: 1, turns: 2, calls: 5 }, range: { label: "本周", from: "a", to: "b" }, projects: ["app"], workspaces: ["/w/app"] }, ""];
  const renderedRecords = render(states);
  assert.ok(text(renderedRecords).includes("修复登录"));
  const all = text(render([0, "digests", null, null, "", [{ id: "d1", title: "本周工作整理", kind: "weekly", range: { label: "本周" }, createdAt: Date.now() }], "", "", null]));
  assert.ok(all.includes("本周工作整理"));
});

test("records are a source switch over workspace bars, and a bar unfolds its sessions", () => {
  const env = load();
  const { render, rerender, dict } = env;
  const now = Date.now();
  const dsh = { id: "s1", title: "修复登录", cwd: "/w/app", gist: "g", turns: 2, calls: 5, lastAt: now };
  const docs = { id: "s2", title: "写文档", cwd: "/w/docs", gist: "d", turns: 1, calls: 2, lastAt: now - 1000 };
  const codex = { id: "codex:1", source: "codex", title: "旧 Codex 会话", cwd: "/w/app", gist: "c", turns: 3, calls: 7, lastAt: now - 2000 };
  const claude = { id: "claude:1", source: "claude", title: "Claude Code 会话", cwd: "/w/claude", gist: "c", turns: 2, calls: 4, lastAt: now - 3000 };
  const records = { ok: true, records: [dsh, docs, codex, claude], stats: { sessions: 4, turns: 8, calls: 18 }, range: { label: "本周", from: "a", to: "b" }, projects: ["app"], workspaces: ["/w/app", "/w/docs"] };
  const states = [0, "records", null, null, "", [], "", "", null, "", false, "", "this-week", "", "", "", records, ""];

  const tree = render(states);
  const bars = find(tree, n => n.props?.className === "fw-ws-head");
  assert.equal(bars.length, 2, "one bar per DSH working directory; Codex is not mixed in");
  assert.ok(text(bars[0]).includes("/w/app"), "the bar carries the working directory");
  assert.equal(find(tree, n => String(n.props?.className || "").includes("fw-workspace-tag")).length, 0, "a record carries no workspace tag of its own");
  const pills = find(tree, n => n.props?.className === "fw-pill gray").map(text);
  assert.ok(pills.includes("DSH"), "the record is labelled by source");
  assert.ok(!text(tree).includes("旧 Codex 会话"), "the other source is not listed until it is chosen");

  // Choosing Codex keeps the same shape, with the imported sessions in it.
  const codexTab = find(tree, n => n.type === "button" && String(n.props?.className || "").startsWith("fw-src") && text(n).includes(dict.wb_sourceCodex))[0];
  codexTab.props.onClick();
  const imported = env.rerender();
  assert.ok(text(imported).includes("旧 Codex 会话"));
  assert.ok(!text(imported).includes("写文档"), "only the chosen source is listed");

  const claudeTab = find(imported, n => n.type === "button" && String(n.props?.className || "").startsWith("fw-src") && text(n).includes(dict.wb_sourceClaude))[0];
  claudeTab.props.onClick();
  const claudeView = env.rerender();
  assert.ok(text(claudeView).includes("Claude Code 会话"), "Claude has its own records tab");
  assert.ok(!text(claudeView).includes("旧 Codex 会话"), "the other imported source stays hidden");
  assert.ok(find(claudeView, n => n.props?.className === "fw-pill gray").map(text).includes("Claude"));

  find(claudeView, n => n.type === "button" && String(n.props?.className || "").startsWith("fw-src") && text(n).includes(dict.wb_sourceCodex))[0].props.onClick();
  const backToCodex = env.rerender();

  // The first bar is open with its sessions; folding it hides them.
  const openedRows = find(backToCodex, n => n.props?.className === "fw-rec");
  assert.equal(openedRows.length, 1, "the first workspace starts unfolded");
  find(backToCodex, n => n.props?.className === "fw-ws-head")[0].props.onClick();
  assert.equal(find(rerender(), n => n.props?.className === "fw-rec").length, 0, "clicking the bar folds its sessions away");
});

test("the records spans end with 全部, and choosing it is the selected span", () => {
  const env = load();
  const { dict } = env;
  const rec = { id: "s1", title: "很久以前的会话", cwd: "/w/app", gist: "g", turns: 1, calls: 1, lastAt: Date.now() };
  const records = { ok: true, records: [rec], stats: { sessions: 1, turns: 1, calls: 1 }, range: { key: "this-week", label: "本周", from: "2026-10-26", to: "2026-10-27" }, projects: [], workspaces: ["/w/app"] };
  const tree = env.render([0, "records", null, null, "", [], "", "", null, "", false, "", "this-week", "", "", "", records, ""]);
  const spans = find(tree, n => /^fw-seg/.test(String(n.props?.className || ""))).map(text);
  assert.ok(spans.includes(dict.r_all), "the widest span is offered next to the others");
  assert.equal(spans.at(-1), dict.r_all, "and it comes last");
  const allBtn = find(tree, n => n.type === "button" && text(n) === dict.r_all)[0];
  allBtn.props.onClick();
  const after = env.rerender();
  assert.ok(find(after, n => text(n) === dict.r_all && /fw-seg on/.test(String(n.props?.className || ""))).length, "it becomes the selected span");
});

test("the records page draws the last list at once, before the request returns", () => {
  const stored = new Map();
  const storage = { getItem: k => (stored.has(k) ? stored.get(k) : null), setItem: (k, v) => stored.set(k, v), removeItem: k => stored.delete(k) };
  const payload = {
    ok: true,
    records: [{ id: "s1", title: "缓存里的会话", cwd: "/w/app", gist: "g", turns: 1, calls: 1, lastAt: Date.now() }],
    stats: { sessions: 1, turns: 1, calls: 1 },
    range: { key: "this-week", label: "本周", from: "2026-10-26", to: "2026-10-27" },
    projects: [], workspaces: ["/w/app"],
  };
  storage.setItem("dsh-focusing.records.v1", JSON.stringify({ range: "this-week", data: payload }));
  const env = load({ storage });
  // State up to the records slot: the list itself is not seeded.
  const tree = env.render([0, "records", null, null, "", [], "", "", null, "", false, "", "this-week", "", "", ""]);
  assert.ok(text(tree).includes("缓存里的会话"), "the rows are there without waiting for the Host");
  assert.equal(find(tree, n => n.props?.className === "fw-ws-head").length, 1, "and they are grouped like a fresh answer");
});

test("a DSH record continues as a copied session; a Codex record opens a draft in DSH", async () => {
  const draft = draftServices();
  const env = load({ ...draft.services, uiWorkspace: {
    ...draft.services.uiWorkspace,
    forkSession: async id => { env.forked.push(id); return "child"; },
    openSession: id => { env.forked.push(`open:${id}`); draft.calls.push(['open', id]); },
  } });
  env.forked = [];
  const { dict } = env;
  const dsh = { id: "s1", title: "修复登录", cwd: "/w/app", gist: "g", turns: 2, calls: 5, lastAt: Date.now() };
  const codex = { id: "codex:1", source: "codex", title: "旧 Codex 会话", cwd: "/w/app", gist: "c", turns: 3, calls: 7, lastAt: Date.now() - 1000 };
  const records = { ok: true, records: [dsh, codex], stats: { sessions: 2, turns: 5, calls: 12 }, range: { label: "本周", from: "a", to: "b" }, projects: [], workspaces: ["/w/app"] };
  const detail = { requests: [{ text: "修一下登录" }], lastReply: "改好了", files: [], todos: [] };
  const stateFor = id => [0, "records", null, null, "", [], "", "", null, "", false, "", "this-week", "", "", "", records, "", id, detail];

  const dshView = env.render(stateFor("s1"));
  const copy = find(dshView, n => n.type === "button" && text(n) === dict.wb_continueContext);
  assert.equal(copy.length, 1, "a DSH session offers the exact continuation label");
  copy[0].props.onClick();
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(env.forked, ["s1", "open:child"], "the Host copies the session and the copy is opened");

  const codexView = (() => {
    const first = env.render(stateFor("codex:1"));
    find(first, n => n.type === "button" && String(n.props?.className || "").startsWith("fw-src") && text(n).includes(dict.wb_sourceCodex))[0].props.onClick();
    const switched = env.rerender();
    find(switched, n => n.props?.className === "fw-rec-btn")[0].props.onClick();
    return env.rerender();
  })();
  const carry = find(codexView, n => n.type === "button" && text(n) === dict.wb_continueCodex);
  assert.equal(carry.length, 1, "a Codex session offers its own label");
  await carry[0].props.onClick();
  assert.deepEqual(draft.calls.filter(([kind]) => kind === 'workspace'), [['workspace', { path: '/w/app' }]]);
  assert.deepEqual(draft.calls.filter(([kind]) => kind === 'create'), [['create', { workspaceId: 'ws-registered' }]], 'directory is resolved before creating a new identity');
  assert.equal(draft.calls.some(([kind]) => kind === 'draft'), false, 'external record continuation opens an empty composer');
  assert.equal(find(codexView, n => n.type === "button" && text(n) === dict.wb_continueContext).length, 0, "a Codex session is never forked");
});

// Room states start at index 24: rooms, roomId, room, roomErr, form, pickList, modelList, sayText, roomBusy.
// Workbench hook order: localeTick, view, digestId, digest, digestError, digests,
// ask, range, home, fu, fuBusy, fuError, recRange, recQuery, recProject, recWorkspaces, records,
// recError, expanded, detail, toast, settingsOpen, settingsTab, savedModel, now,
// rooms, roomId, room, roomErr, form, pickList, modelList, sayText, roomBusy.
const base = view => [...[0, view, null, null, "", [], "", "", null, "", false, "", "this-week", "", "", [],
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


test("the sidebar leaves the layout completely and becomes a drawer", () => {
  const narrow = /@container\(max-width:760px\)\{\.fw\{[^\n]*/.exec(SOURCE)?.[0] ?? "";
  assert.match(narrow, /\.fw\{display:block\}/, "narrow widths stop reserving a sidebar grid column");
  assert.match(narrow, /\.fw-main\{height:100%;width:100%;scrollbar-gutter:auto\}/, "content consumes the full width without a gutter");
  assert.match(narrow, /\.fw-nav\{position:absolute/, "the navigation becomes an overlay drawer");
  assert.match(narrow, /transform:translateX\(-102%\)/, "the closed drawer moves fully off screen");
  assert.match(narrow, /\.fw\.nav-open \.fw-nav\{transform:none;visibility:visible\}/, "opening restores the whole sidebar");
  assert.match(narrow, /\.fw-menu\{display:flex/, "a menu button remains available");
  assert.doesNotMatch(SOURCE, /grid-template-columns:56px/, "there is no awkward intermediate icon rail");
  assert.match(SOURCE, /\.fw-focus\{[^}]*container-type:inline-size/, "the outer wrapper owns the query container");
  assert.doesNotMatch(/\.fw\{[^}]*\}/.exec(SOURCE)?.[0] ?? "", /container-type/, "the queried layout must not be its own container");
});

test("the page restores a native draggable title strip", () => {
  assert.match(SOURCE, /\.fw-drag-strip\{[^}]*-webkit-app-region:drag/, "the upper empty strip can drag and double-click the native window");
  assert.match(SOURCE, /className:'fw-drag-strip'/, "the strip is rendered by the workbench");
  assert.match(SOURCE, /\.fw-menu\{[^}]*-webkit-app-region:no-drag/, "the menu remains clickable over that strip");
  assert.match(SOURCE, /\.fw button,\.fw input,\.fw textarea,\.fw select,\.fw a\{[^}]*z-index:9;[^}]*-webkit-app-region:no-drag/, "every interactive control stays above and outside the drag region");
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
  assert.match(rule(".fw-brand"), /font-size:20px/, "the brand reads as a title, not another navigation row");
  assert.match(rule(".fw-brand"), /font-weight:700/, "the brand keeps a strong title weight");
  const narrow = /@container\(max-width:760px\)\{\.fw\{[^\n]*/.exec(SOURCE)?.[0] ?? "";
  assert.ok(!/\.fw-brandbar\{flex-direction:column/.test(narrow), "the drawer keeps the full horizontal header");
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
  return [0, "ask", null, null, "", [], "", "", null];
};
// Function components are not expanded by the stub React: find the ChatView
// node and call it with its own props, as React would.
const chatViews = (tree) => find(tree, n => typeof n.type === "function" && n.type.name === "ChatView").map(n => n.type(n.props));
const runDetails = (tree) => find(tree, n => n.type === "details" && n.props?.className === "fz-run");

test("a conversation shows the thread: questions, answers, and tool calls folded above each answer", () => {
  const env = load();
  const { render, dict } = env;
  const conv = {
    id: "ask-1", title: "上周做了什么", status: "idle", model: "p/m", steps: [],
    messages: [
      user("上周做了什么"),
      asst("", { id: "c1", name: "focus_list_sessions", arguments: '{"query":"登录"}' }, { id: "c2", name: "focus_read_session", arguments: '{"sessionId":"s1"}' }),
      result("c1", '{"total":2}'), { ...result("c2", "Error: nope"), isError: true },
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
  const md = find(tree, n => typeof n.type === "function" && typeof n.props?.text === "string").map(n => n.props.text);
  assert.deepEqual(md, ["做了登录修复。", "是 dsh-focusing。"]);
  assert.ok(all.includes(`2 ${dict.toolCalls}`), "the two calls are one folded run");
  assert.ok(all.includes(`1 ${dict.failed}`), "and the failed one is counted");
  assert.ok(all.includes("focus_list_sessions") && all.includes("query=登录"), "the call and its arguments are shown");
  assert.equal(runDetails(tree).length, 1);
  assert.equal(runDetails(tree)[0].props.open, false, "collapsed once finished");
  assert.ok(all.includes("p/m"), "the model that answered is named");
});

test("Ask shows saved coverage beside the round it describes", () => {
  const env = load();
  const conv = {
    id: "ask-coverage", title: "Find the work", status: "idle", steps: [],
    messages: [user("Find the work"), asst("The session mentions a fix."), user("What else?"), user("Check again"), asst("The fix was in dsh-focusing.")],
    rounds: [
      { at: 1, coverage: "partial", reasons: ["list-pagination", "source-warning"] },
      { at: 2, coverage: "no-evidence", reasons: ["no-matches"] },
      { at: 4, coverage: "partial", reasons: ["list-pagination"], reused: true },
    ],
  };
  const tree = chatViews(env.render(withAsks([conv], env)))[0];
  const notices = find(tree, n => n.props?.className?.startsWith("fw-ask-coverage"));
  assert.deepEqual(notices.map(n => text(n)), [
    ["askPartial", "askCoverageListPagination", "askCoverageSourceWarning"].map(k => env.dict[k]).join(" · "),
    ["askNoEvidence", "askCoverageNoMatches"].map(k => env.dict[k]).join(" · "),
    ["askReused", "askCoverageListPagination"].map(k => env.dict[k]).join(" · "),
  ]);
  assert.equal(notices[1].props.role, "alert");
  assert.ok(text(tree).indexOf(env.dict.askNoEvidence) < text(tree).indexOf("Check again"));
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
  const { render } = env;
  const tree = chatViews(render(withAsks([{ id: "x1", title: "q", status: "failed", steps: [], messages: [user("问过的内容")], detail: "HTTP 500" }], env)))[0];
  assert.ok(text(tree).includes("HTTP 500"));
  assert.ok(text(tree).includes("问过的内容"));
  assert.equal(find(tree, n => n.props?.role === "alert").length, 1);
});

test("stopped and interrupted turns keep the thread and say why they ended", () => {
  const env = load();
  const { render, dict } = env;
  const base = { id: "a", title: "问过的内容", messages: [user("问过的内容")], steps: [], createdAt: Date.now() };
  const stopped = chatViews(render(withAsks([{ ...base, status: "cancelled" }], env)))[0];
  assert.ok(text(stopped).includes("问过的内容") && text(stopped).includes(dict.askCancelled));
  const interrupted = chatViews(render(withAsks([{ ...base, id: "b", status: "interrupted" }], env)))[0];
  assert.ok(text(interrupted).includes(dict.askInterrupted));
});

test("on a narrow panel the chat list gives way to a drop-down, and the sheet says so", () => {
  const env = load();
  const { render, dict } = env;
  const a = { id: "a", title: "第一个话题", status: "idle", messages: [user("第一个话题")], steps: [] };
  const b = { id: "b", title: "第二个话题", status: "idle", messages: [user("第二个话题")], steps: [] };
  env.store.seed([a, b]); env.store.pick("a");
  const tree = render([0, "ask", null, null, "", [], "", "", null]);
  const select = find(tree, n => n.type === "select" && n.props?.className === "fw-chat-pick")[0];
  assert.ok(select, "a drop-down carries the same list when the rail cannot");
  assert.deepEqual(find(select, n => n.type === "option").map(n => text(n)), [dict.askNew, "第一个话题", "第二个话题"]);
  assert.equal(select.props.value, "a");
  select.props.onChange({ target: { value: "b" } });
  assert.equal(env.store.activeId(), "b");
  select.props.onChange({ target: { value: "" } });
  assert.equal(env.store.active(), undefined, "the first entry starts a new chat");
  const narrow = /@container\(max-width:760px\)\{\.fw\{[^\n]*/.exec(SOURCE)?.[0] ?? "";
  assert.ok(!/\.fw-nav-chats\{display:none\}/.test(narrow), "the overlay drawer keeps the full conversation list");
});

test("the running spinner stays small enough for a 12px row", () => {
  const size = sel => { const m = new RegExp(sel.replace(/[.]/g, "\\.") + "\\{width:(\\d+)px").exec(SOURCE); return m ? Number(m[1]) : null; };
  const base = size(".fw-spin");
  assert.ok(base !== null && base <= 11, `a ring bigger than the text reads as an icon: ${base}`);
  const rail = size(".fw-nav-chat .fw-spin");
  assert.ok(rail !== null && rail < base, "and smaller still beside 12px titles");
  assert.match(SOURCE, /\.fw-spin\{[^}]*border:1\.5px solid/);
});

const TEMPLATES = [
  { id: "builtin:weekly", name: "周报", instruction: "整理我这周干了什么，进度如何", range: "this-week", builtin: true },
  { id: "builtin:daily", name: "日报", instruction: "总结今天各会话的进展", range: "today", builtin: true },
  { id: "builtin:handoff", name: "会话交接", instruction: "把「{title}」整理成交接文档", range: "session", builtin: true, needsSession: true },
  { id: "tpl-1", name: "发布复盘", instruction: "总结本周发布相关的改动、风险和阻塞", range: "" },
];
const DIGESTS = [0, "digests", null, null, "", [], "", "", null];

test("the Digests page offers templates instead of a text box, and can add its own", () => {
  const env = load();
  const { render, dict } = env;
  env.seedTemplates(TEMPLATES);
  const tree = render(DIGESTS);
  assert.equal(find(tree, n => n.type === "textarea").length, 0, "no free-text box: asking is the Ask page's job");
  const rows = find(tree, n => n.props?.className === "fw-tpl");
  assert.equal(rows.length, 4);
  assert.ok(text(rows[0]).includes("周报") && text(rows[0]).includes("整理我这周干了什么"));
  assert.ok(text(rows[3]).includes("发布复盘"), "your own template is listed with the shipped ones");
  const labels = rows.map(r => find(r, n => n.type === "button").map(n => text(n)));
  assert.ok(labels[0].includes(dict.wb_generate) && !labels[0].includes(dict.wb_tplEdit), "a shipped template runs but cannot be edited");
  assert.ok(text(rows[0]).includes(dict.wb_tplBuiltin));
  assert.ok(labels[2].includes(dict.wb_tplGoRecords), "the handoff template points at the records page");
  assert.ok(!labels[2].includes(dict.wb_generate), "and cannot be run from here");
  assert.ok(labels[3].includes(dict.wb_generate) && labels[3].includes(dict.wb_tplEdit), "your own can be run and edited");
});

test("generating from a template asks for that template, not a typed request", () => {
  const env = load();
  const { render } = env;
  env.seedTemplates(TEMPLATES);
  const posts = [];
  globalThis.fetch = async (url, init) => { if (init?.method === "POST") posts.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => ({ ok: true, digest: { id: "d9", status: "running", request: "x" } }) }; };
  const tree = render(DIGESTS);
  const weekly = find(tree, n => n.props?.className === "fw-tpl")[0];
  find(weekly, n => n.type === "button" && text(n).includes(env.dict.wb_generate))[0].props.onClick();
  const post = posts.at(-1);
  assert.match(post.url, /dsh-focusing\.digest$/);
  assert.equal(post.body.templateId, "builtin:weekly");
  assert.equal(post.body.request, undefined, "the words live in the template");
  assert.equal(post.body.rangeLocked, undefined, "the template's own range applies unless the person overrides it");
});

test("a new template form saves a name, an instruction and a range", () => {
  const env = load();
  const { render, dict } = env;
  env.seedTemplates(TEMPLATES);
  const tree = render(DIGESTS);
  const open = find(tree, n => n.type === "button" && text(n) === dict.wb_newTemplate)[0];
  assert.ok(open, "a way to add one");
  const posts = [];
  globalThis.fetch = async (url, init) => { if (init?.method === "POST") posts.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ ok: true, templates: TEMPLATES }) }; };
  open.props.onClick();
  const form = env.rerender();
  const name = find(form, n => n.type === "input")[0];
  const instruction = find(form, n => n.type === "textarea")[0];
  assert.ok(name && instruction, "a name and an instruction");
  assert.equal(find(form, n => n.type === "button" && text(n) === dict.wb_tplSave)[0].props.disabled, true, "cannot save while empty");
  name.props.onChange({ target: { value: "发布复盘" } });
  instruction.props.onChange({ target: { value: "总结本周发布相关的改动" } });
  const filled = env.rerender();
  const save = find(filled, n => n.type === "button" && text(n) === dict.wb_tplSave)[0];
  assert.equal(save.props.disabled, false);
  save.props.onClick();
  assert.deepEqual(posts.at(-1), { action: "create", id: null, name: "发布复盘", instruction: "总结本周发布相关的改动", range: "" });
});

test("your own template can be edited and deleted; the shipped ones offer neither", () => {
  const env = load();
  const { render, dict } = env;
  env.seedTemplates(TEMPLATES);
  const posts = [];
  globalThis.fetch = async (url, init) => { if (init?.method === "POST") posts.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ ok: true, templates: TEMPLATES }) }; };
  const rows = find(render(DIGESTS), n => n.props?.className === "fw-tpl");
  const own = rows[3];
  find(own, n => n.type === "button" && text(n) === dict.wb_tplEdit)[0].props.onClick();
  const form = env.rerender();
  assert.equal(find(form, n => n.type === "input")[0].props.value, "发布复盘", "editing starts from what is saved");
  find(form, n => n.type === "button" && text(n) === dict.wb_tplSave)[0].props.onClick();
  assert.equal(posts.at(-1).action, "update");
  assert.equal(posts.at(-1).id, "tpl-1");

  const again = find(env.rerender(), n => n.props?.className === "fw-tpl")[3];
  find(again, n => n.type === "button" && n.props?.["aria-label"] === dict.wb_delete)[0].props.onClick();
  assert.deepEqual(posts.at(-1), { action: "delete", id: "tpl-1" });
  assert.equal(find(rows[0], n => n.type === "button" && n.props?.["aria-label"] === dict.wb_delete).length, 0, "a shipped template has no delete");
});

// Service doubles deliberately expose the obsolete/send APIs as failures: none
// of these actions may reuse a chat or submit text to a model.
function draftServices({ workspaceId = 'ws-registered', create, ready, result = 'applied' } = {}) {
  const calls = [], binding = { sessionId: 'fresh-1', composer: {} };
  let serial = 0;
  const forbidden = () => assert.fail('draft actions must never send or reuse a session');
  const services = {
    workspaces: { create: async options => { calls.push(['workspace', options]); return { workspaceId }; } },
    sessions: {
      create: async options => { calls.push(['create', options]); return create ? create(options) : `fresh-${++serial}`; },
      retain: (id, options) => { calls.push(['retain', id, options]); return {
        ready: ready ? ready(binding) : Promise.resolve(binding), release: () => calls.push(['release', id]),
      }; },
    },
    conversation: { input: {
      requestDraftInitialization: (actual, options) => { calls.push(['draft', actual, options]); return result; },
      send: forbidden, submit: forbidden,
    } },
    uiWorkspace: { openSession: id => calls.push(['open', id]), startSession: forbidden },
  };
  return { calls, binding, services };
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const draftButton = (tree, env) => find(tree, n => n.type === 'button' && text(n) === env.dict.wb_draftOpen)[0];
const handoffDigest = extra => ({ ...digest, kind: 'handoff', range: { key: 'session' }, sessionIds: ['claude:one / two'], ...extra });
const resultState = saved => [0, 'result', saved.id, saved, '', [], '', '', null];
const advisorButton = (tree, env) => find(tree, n => n.type === 'button' && text(n) === env.dict.wb_advisorOpen)[0];
const advisorPrepared = () => ({ ok: true, snapshot: { id: 'snapshot-1', source: { cwd: '/frozen/source' } }, prompt: '# Handoff\n\nConsult history when needed.' });
const flushDraft = () => new Promise(resolve => setImmediate(resolve));
function mockAdvisor(t, calls, respond = body => body.action === 'prepare' ? advisorPrepared() : { ok: true }) {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url, options) => {
    // Plugin mounting may also read interface settings; only advisor traffic is recorded.
    if (url === '/api/dsh-focusing.settings') return { ok: true, json: async () => ({ ok: true }) };
    assert.equal(url, '/api/dsh-focusing.history-advisor');
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.headers['content-type'], 'application/json');
    const body = JSON.parse(options.body);
    calls.push(['advisor', body]);
    const response = await respond(body);
    return { ok: true, json: async () => response };
  };
}

test('history advisor prepares, waits for ready and attach, then opens an unsent kept draft', async t => {
  const ready = deferred(), attached = deferred();
  const stub = draftServices({ ready: () => ready.promise });
  mockAdvisor(t, stub.calls, body => body.action === 'prepare' ? advisorPrepared() : attached.promise);
  const env = load(stub.services), saved = handoffDigest();
  const tree = env.render(resultState(saved));
  const button = advisorButton(tree, env);
  assert.equal(text(button), '带历史顾问继续（草稿）');
  assert.ok(draftButton(tree, env), 'ordinary draft action remains available beside the advisor');
  const pending = button.props.onClick();
  await flushDraft();
  const prepare = ['advisor', { action: 'prepare', digestId: saved.id, locale: /^en/i.test(navigator.language || '') ? 'en' : 'zh' }];
  assert.deepEqual(stub.calls, [prepare, ['workspace', { path: '/frozen/source' }], ['create', { workspaceId: 'ws-registered' }], ['retain', 'fresh-1', { source: 'controllerOperation' }]], 'attach cannot run before the retained binding is ready');
  ready.resolve(stub.binding);
  await flushDraft();
  assert.deepEqual(stub.calls.at(-1), ['advisor', { action: 'attach', sessionId: 'fresh-1', snapshotId: 'snapshot-1' }]);
  assert.equal(stub.calls.some(([kind]) => ['draft', 'open', 'release'].includes(kind)), false, 'attach must finish before draft initialization');
  attached.resolve({ ok: true });
  assert.equal(await pending, true);
  assert.deepEqual(stub.calls.map(([kind]) => kind), ['advisor', 'workspace', 'create', 'retain', 'advisor', 'draft', 'open', 'release']);
  assert.deepEqual(stub.calls.slice(-3), [
    ['draft', stub.binding, { prompt: advisorPrepared().prompt, whenDraftExists: 'keep' }],
    ['open', 'fresh-1'], ['release', 'fresh-1'],
  ]); // send/submit/startSession are forbidden by draftServices.
});

for (const phase of ['prepare', 'attach']) {
  for (const failure of ['response', 'network']) {
    test(`history advisor ${phase} ${failure} failure reports error without opening`, async t => {
      const stub = draftServices();
      mockAdvisor(t, stub.calls, body => {
        if (body.action !== phase) return advisorPrepared();
        if (failure === 'network') throw new Error(`${phase} offline`);
        return { ok: false, detail: `${phase} refused` };
      });
      const env = load(stub.services);
      assert.equal(await advisorButton(env.render(resultState(handoffDigest())), env).props.onClick(), false);
      const kinds = stub.calls.map(([kind]) => kind);
      assert.deepEqual(kinds, phase === 'prepare' ? ['advisor'] : ['advisor', 'workspace', 'create', 'retain', 'advisor', 'release']);
      assert.ok(text(env.rerender()).includes(`${phase} ${failure === 'network' ? 'offline' : 'refused'}`));
      assert.equal(advisorButton(env.rerender(), env).props.disabled, false, 'failure clears the guard for retry');
    });
  }
}

for (const [missing, payload] of [
  ['snapshot', { ok: true, prompt: 'context' }],
  ['snapshot id', { ok: true, snapshot: { source: { cwd: '/source' } }, prompt: 'context' }],
  ['source', { ok: true, snapshot: { id: 'snap' }, prompt: 'context' }],
  ['cwd', { ok: true, snapshot: { id: 'snap', source: {} }, prompt: 'context' }],
  ['blank cwd', { ok: true, snapshot: { id: 'snap', source: { cwd: '  ' } }, prompt: 'context' }],
  ['prompt', { ok: true, snapshot: { id: 'snap', source: { cwd: '/source' } } }],
  ['blank prompt', { ...advisorPrepared(), prompt: ' \n ' }],
]) {
  test(`history advisor rejects missing ${missing} before session creation or attach`, async t => {
    const stub = draftServices();
    mockAdvisor(t, stub.calls, () => payload);
    const env = load(stub.services);
    assert.equal(await advisorButton(env.render(resultState(handoffDigest())), env).props.onClick(), false);
    assert.deepEqual(stub.calls.map(([kind]) => kind), ['advisor']);
    assert.ok(text(env.rerender()).includes(env.dict.wb_draftFailed));
  });
}

for (const phase of ['prepare', 'attach']) {
  test(`history advisor duplicate clicks are guarded while ${phase} is pending, including ordinary draft clicks`, async t => {
    const gate = deferred(), stub = draftServices();
    mockAdvisor(t, stub.calls, body => body.action === phase ? gate.promise : advisorPrepared());
    const env = load(stub.services), tree = env.render(resultState(handoffDigest()));
    const button = advisorButton(tree, env), ordinary = draftButton(tree, env);
    const pending = button.props.onClick();
    await flushDraft();
    await button.props.onClick();
    await ordinary.props.onClick();
    const busy = find(env.rerender(), n => n.type === 'button' && text(n) === env.dict.wb_draftOpening);
    assert.equal(busy.length, 2);
    for (const action of busy) { assert.equal(action.props.disabled, true); await action.props.onClick(); }
    gate.resolve(phase === 'prepare' ? advisorPrepared() : { ok: true });
    assert.equal(await pending, true);
    assert.deepEqual(stub.calls.filter(([kind]) => kind === 'advisor').map(([, body]) => body.action), ['prepare', 'attach']);
    assert.equal(stub.calls.filter(([kind]) => kind === 'create').length, 1);
    assert.equal(advisorButton(env.rerender(), env).props.disabled, false);
    assert.equal(draftButton(env.rerender(), env).props.disabled, false);
  });
}

for (const extra of [{ kind: 'weekly' }, { range: { key: 'this-week' } }, { sessionIds: [] }, { sessionIds: undefined }, { sessionIds: ['one', 'two'] }, { status: 'running' }, { status: 'failed' }, { note: 'empty' }]) {
  test(`history advisor is hidden for ineligible handoff: ${JSON.stringify(extra)}`, () => {
    const env = load(draftServices().services);
    assert.equal(advisorButton(env.render(resultState(handoffDigest(extra))), env), undefined);
  });
}

for (const [directory, workspaceId] of [['/existing/project', 'ws-existing'], ['/new/project', 'ws-new']]) {
  test(`draft creation delegates directory registration/reuse to workspaces.create: ${directory}`, async () => {
    const stub = draftServices({ workspaceId });
    const env = load(stub.services);
    const actual = await env.startDraft({ cwd: directory }, 'unsent context');
    assert.deepEqual(actual, { sessionId: 'fresh-1', workspaceId });
    assert.deepEqual(stub.calls, [
      ['workspace', { path: directory }], ['create', { workspaceId }],
      ['retain', 'fresh-1', { source: 'controllerOperation' }],
      ['draft', stub.binding, { prompt: 'unsent context', whenDraftExists: 'keep' }],
      ['open', 'fresh-1'], ['release', 'fresh-1'],
    ]);
    await env.startDraft({ cwd: directory });
    assert.deepEqual(stub.calls.filter(([kind]) => kind === 'open').map(x => x[1]), ['fresh-1', 'fresh-2'], 'every request creates a separate identity');
  });
}

test('async create and readiness finish before draft initialization and opening', async () => {
  const created = deferred(), ready = deferred();
  const stub = draftServices({ create: () => created.promise, ready: () => ready.promise });
  const env = load(stub.services);
  const operation = env.startDraft({ workspaceId: 'room-workspace' }, 'handoff');
  assert.deepEqual(stub.calls, [['create', { workspaceId: 'room-workspace' }]], 'known workspace IDs bypass path registration');
  created.resolve('async-session');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(stub.calls.some(([kind]) => kind === 'open' || kind === 'draft'), false);
  ready.resolve(stub.binding);
  await operation;
  assert.deepEqual(stub.calls.slice(-3), [['draft', stub.binding, { prompt: 'handoff', whenDraftExists: 'keep' }], ['open', 'async-session'], ['release', 'async-session']]);
});

for (const failure of ['create', 'ready', 'preserved', 'blocked']) {
  test(`draft ${failure} failure never opens and releases any acquired reference`, async () => {
    const stub = draftServices({
      create: failure === 'create' ? async () => { throw new Error('create failed'); } : undefined,
      ready: failure === 'ready' ? async () => { throw new Error('ready failed'); } : undefined,
      result: failure,
    });
    const env = load(stub.services);
    await assert.rejects(env.startDraft({ workspaceId: 'ws' }, 'do not overwrite'), error => {
      assert.equal(error.message, failure === 'create' || failure === 'ready' ? `${failure} failed` : env.dict[failure === 'preserved' ? 'wb_draftExists' : 'wb_draftUnavailable']);
      return true;
    });
    assert.equal(stub.calls.some(([kind]) => kind === 'open'), false);
    assert.equal(stub.calls.filter(([kind]) => kind === 'release').length, failure === 'create' ? 0 : 1);
    if (failure === 'preserved' || failure === 'blocked') assert.equal(stub.calls.find(([kind]) => kind === 'draft')[2].whenDraftExists, 'keep');
  });
}

for (const source of ['codex', 'claude']) {
  test(`${source} record resolves cwd and opens a new empty composer`, async () => {
    const stub = draftServices(), env = load(stub.services);
    const rec = { id: `${source}:1`, source, title: 'external', cwd: `/w/${source}`, lastAt: Date.now() };
    const records = { ok: true, records: [rec], stats: {}, range: {}, projects: [], workspaces: [rec.cwd] };
    let tree = env.render([0, 'records', null, null, '', [], '', '', null, '', false, '', 'this-week', '', '', '', records, '', rec.id, {}]);
    find(tree, n => n.type === 'button' && String(n.props.className).startsWith('fw-src') && text(n).includes(env.dict[source === 'codex' ? 'wb_sourceCodex' : 'wb_sourceClaude']))[0].props.onClick();
    tree = env.rerender();
    find(tree, n => n.props.className === 'fw-rec-btn')[0].props.onClick();
    tree = env.rerender();
    await find(tree, n => n.type === 'button' && text(n) === env.dict.wb_continueCodex)[0].props.onClick();
    assert.deepEqual(stub.calls[0], ['workspace', { path: rec.cwd }]);
    assert.deepEqual(stub.calls[1], ['create', { workspaceId: 'ws-registered' }]);
    assert.equal(stub.calls.some(([kind]) => kind === 'draft'), false);
    assert.deepEqual(stub.calls.slice(-2), [['open', 'fresh-1'], ['release', 'fresh-1']]);
  });
}

for (const fallback of [false, true]) {
  test(`single-session handoff imports the exported Markdown, including model fallback=${fallback}`, async t => {
    const stub = draftServices(), env = load(stub.services), requests = [];
    const markdown = '# Handoff\n\nEvidence and next steps\n';
    const original = globalThis.fetch;
    t.after(() => { globalThis.fetch = original; });
    globalThis.fetch = async (url, options) => {
      requests.push([url, options]);
      return url.includes('export') ? { ok: true, text: async () => markdown } : { ok: true, json: async () => ({ ok: true, record: { cwd: '/source/project' } }) };
    };
    const saved = handoffDigest({ draft: fallback, error: fallback ? { reason: 'model unavailable' } : undefined });
    await draftButton(env.render(resultState(saved)), env).props.onClick();
    assert.equal(requests.length, 2);
    assert.equal(new URL(requests[0][0], 'https://local').searchParams.get('id'), saved.sessionIds[0]);
    assert.match(requests[1][0], /export/);
    assert.equal(new URL(requests[1][0], 'https://local').searchParams.get('id'), saved.id);
    assert.equal(requests[1][1].credentials, 'same-origin');
    assert.deepEqual(stub.calls[0], ['workspace', { path: '/source/project' }]);
    assert.deepEqual(stub.calls.find(([kind]) => kind === 'draft'), ['draft', stub.binding, { prompt: `${env.dict.wb_handoffContext}\n\n${fallback ? `${env.dict.wb_draftNote}\n\n` : ''}${markdown}`, whenDraftExists: 'keep' }]);
  });
}

for (const failure of ['source unavailable', 'missing cwd', 'export HTTP', 'export network', 'export empty']) {
  test(`handoff ${failure} leaves all session services untouched and reports error`, async t => {
    const stub = draftServices(), env = load(stub.services);
    const original = globalThis.fetch;
    t.after(() => { globalThis.fetch = original; });
    globalThis.fetch = async url => {
      if (!url.includes('export')) return { ok: true, json: async () => failure === 'source unavailable' ? { ok: false } : { ok: true, record: failure === 'missing cwd' ? {} : { cwd: '/source' } } };
      if (failure === 'export network') throw new Error('offline');
      return { ok: failure !== 'export HTTP', status: 503, text: async () => '  ' };
    };
    await draftButton(env.render(resultState(handoffDigest())), env).props.onClick();
    assert.deepEqual(stub.calls, []);
    assert.ok(text(env.rerender()).includes(env.dict.wb_draftFailed));
  });
}

test('handoff duplicate clicks remain guarded across rerenders until creation completes', async t => {
  const gate = deferred(), stub = draftServices({ create: () => gate.promise }), env = load(stub.services);
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const requests = [];
  globalThis.fetch = async url => { requests.push(url); return url.includes('export') ? { ok: true, text: async () => '# context' } : { ok: true, json: async () => ({ ok: true, record: { cwd: '/source' } }) }; };
  const button = draftButton(env.render(resultState(handoffDigest())), env);
  const pending = button.props.onClick();
  await button.props.onClick();
  const busy = find(env.rerender(), n => n.type === 'button' && text(n) === env.dict.wb_draftOpening)[0];
  assert.equal(busy.props.disabled, true);
  await busy.props.onClick();
  gate.resolve('only-session');
  await pending;
  assert.equal(requests.length, 2);
  assert.equal(stub.calls.filter(([kind]) => kind === 'create').length, 1);
  assert.equal(draftButton(env.rerender(), env).props.disabled, false);
});

for (const target of [{ ok: true, workspaceId: 'known-room' }, { ok: true, workspaceId: null, cwd: '/room/project' }, { ok: false, reason: 'target unavailable' }, { ok: true }]) {
  test(`room handoff validates target and resolves directory fallback: ${JSON.stringify(target)}`, async t => {
    const stub = draftServices(), env = load(stub.services), actions = [];
    const room = { id: 'room-1', title: 'room', participants: [], messages: [], handoff: { text: '# room handoff' } };
    const original = globalThis.fetch;
    t.after(() => { globalThis.fetch = original; });
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(options.body); actions.push(body);
      return { ok: true, json: async () => body.action === 'target' ? target : { ok: true, room } };
    };
    const tree = env.render([...base('room'), [], room.id, room, '', null, null, null, '', false]);
    await find(tree, n => n.type === 'button' && text(n) === env.dict.wb_openNew)[0].props.onClick();
    if (target.ok && (target.cwd || target.workspaceId)) {
      assert.deepEqual(stub.calls.find(([kind]) => kind === 'create'), ['create', { workspaceId: target.workspaceId || 'ws-registered' }]);
      assert.deepEqual(stub.calls.filter(([kind]) => kind === 'workspace'), target.cwd ? [['workspace', { path: target.cwd }]] : []);
      assert.equal(stub.calls.find(([kind]) => kind === 'draft')[2].prompt, room.handoff.text);
      assert.deepEqual(actions.map(x => x.action), ['target', 'opened']);
    } else {
      assert.deepEqual(stub.calls, []);
      assert.deepEqual(actions.map(x => x.action), ['target']);
      assert.ok(text(env.rerender()).includes(env.dict.wb_draftFailed));
    }
  });
}

test('handoff errors stay with the digest that failed, rather than another digest or room', async t => {
  const stub = draftServices(), env = load(stub.services);
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: false }) });
  await draftButton(env.render(resultState(handoffDigest())), env).props.onClick();
  assert.ok(text(env.rerender()).includes(env.dict.wb_draftFailed));
  // Change the selected digest while preserving the other hook states, as navigation does.
  env.state()[2] = 'other'; env.state()[3] = handoffDigest({ id: 'other' });
  assert.equal(text(env.rerender()).includes(env.dict.wb_draftFailed), false);
  env.state()[1] = 'room'; env.state()[26] = 'r2'; env.state()[27] = { id: 'r2', title: 'other room', participants: [], messages: [], handoff: { text: 'other' } };
  assert.equal(text(env.rerender()).includes(env.dict.wb_draftFailed), false);
});

for (const extra of [{ kind: 'weekly' }, { range: { key: 'this-week' } }, { sessionIds: ['one', 'two'] }, { status: 'running' }, { note: 'empty' }]) {
  test(`handoff draft action is unavailable outside a completed nonempty single-session handoff: ${JSON.stringify(extra)}`, () => {
    const env = load(draftServices().services);
    assert.equal(draftButton(env.render(resultState(handoffDigest(extra))), env), undefined);
  });
}

test('retry after source-reading failure preserves the requested session before sessionIds exist', async t => {
  const env = load(), original = globalThis.fetch, requests = [];
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ ok: true, digest: { id: 'retry', status: 'running' } }) };
  };
  const saved = handoffDigest({ status: 'failed', session: 'codex:source-reading-failed', sessionIds: undefined, error: { reason: 'source read failed' } });
  const tree = env.render(resultState(saved));
  await find(tree, n => n.type === 'button' && text(n) === env.dict.wb_retry)[0].props.onClick();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].session, saved.session);
  assert.equal(requests[0].range, 'session');
  assert.equal(requests[0].rangeLocked, true);
});
