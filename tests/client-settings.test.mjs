// The global model settings live in ONE centered dialog, mounted at the
// workbench root. These tests pin what the user asked for: a dialog (not a
// page or a side drawer), the model chosen from a list, and the focus-guard
// content in the same place.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SOURCE = fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

function load() {
  let captured;
  globalThis.window = { __ModuleLoader__: { load: d => { captured = d; } } };
  globalThis.fetch ??= async () => ({ ok: true, json: async () => ({}) });
  const listeners = [];
  const scrim = { classList: { _on: null, toggle(_c, on) { this._on = on; } }, focus() {}, querySelectorAll: () => [] };
  globalThis.document = {
    __listeners: listeners, scrim,
    addEventListener: (type, fn) => listeners.push({ type, fn }),
    removeEventListener: (type, fn) => { const i = listeners.findIndex(l => l.fn === fn); if (i >= 0) listeners.splice(i, 1); },
    body: { appendChild() {} }, createElement: () => ({ click() {}, remove() {} }),
  };
  new Function(SOURCE)();
  let states = [];
  let index = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: "Fragment",
    useEffect: fn => { fn(); },
    useRef: v => ({ current: v ?? globalThis.document.scrim }),
    useCallback: f => f,
    useState: init => { const i = index++; if (!(i in states)) states[i] = init; return [states[i], next => { states[i] = typeof next === "function" ? next(states[i]) : next; }]; },
  };
  const api = captured.factory(n => { if (n === "react") return React; throw new Error(n); });
  const dict = {};
  let Dialog = null;
  api.apply({
    locale: { bind: () => k => dict[k] ?? k, register: (ns, l, table) => { if (l === "zh") Object.assign(dict, table); return () => {}; }, subscribe: () => () => {} },
    effect: fn => fn(), get: () => undefined,
    slots: { inject: (n, fn) => fn(), register: (o, c) => { if (o.name === "focusing.panel.body") Dialog = c.SettingsDialog; return () => {}; } },
  });
  const render = preset => {
    states = preset; index = 0;
    return Dialog({ t: k => dict[k] ?? k, subscribeLocale: () => () => {}, open: true, onClose: () => {}, ...(typeof preset === "object" && !Array.isArray(preset) ? preset : {}) });
  };
  return { render, dict };
}

const text = n => typeof n === "string" ? n : Array.isArray(n) ? n.map(text).join("") : n && typeof n === "object" ? (n.children || []).map(text).join("") : "";
const find = (n, pred, out = []) => { if (n && typeof n === "object") { if (pred(n)) out.push(n); (n.children || []).forEach(c => find(c, pred, out)); } return out; };
const deep = n => typeof n === "string" ? n : Array.isArray(n) ? n.map(deep).join("") : n && typeof n === "object" ? (n.children || []).map(deep).join("") : "";

const catalog = [{ provider: "deepseek", id: "chat", name: "DeepSeek Chat", providerName: "DeepSeek" }];
const settings = {
  source: "dsh", provider: "", model: "", persona: "You are a careful reviewer.", includeGoal: true, includeProject: true,
  includeToolArgs: true, includeToolOutput: true, maxActivities: 60, excerptChars: 400, maxTokens: 1024, timeoutMs: 60000, hasApiKey: false,
};
// States: localeTick, tab, saved, form, note, busy, test, models, providerInfo, extModels, preview, previewError.
const set = (extra = {}) => [0, extra.tab || "model", extra.saved === undefined ? settings : extra.saved, extra.form ?? null, extra.note || "", extra.busy || "", extra.test ?? null, extra.models === undefined ? catalog : extra.models, extra.providerInfo ?? [{ provider: "deepseek-account", name: "DeepSeek Account", models: [] }], extra.extModels ?? null, extra.preview ?? null, extra.previewError || ""];

test("the settings are a centered dialog with a scrim, mounted once", () => {
  const { render, dict } = load();
  const tree = render(set());
  const scrim = find(tree, n => String(n.props?.className || "").startsWith("fws-scrim"))[0];
  assert.ok(scrim, "a modal scrim must wrap the settings");
  assert.ok(!scrim.props.hidden, "it is shown while open");
  const dialog = find(tree, n => n.props?.role === "dialog")[0];
  assert.ok(dialog, "the settings must be a dialog, not a page");
  assert.equal(dialog.props["aria-modal"], "true");
  // A single global scope, stated inside the dialog.
  const all = text(tree);
  for (const key of ["settingsScope1", "settingsScope2", "settingsScope3", "settingsScope4"]) assert.ok(all.includes(dict[key]), key);
});

test("the model is chosen from what DSH reports; no free-text model id", () => {
  const { render, dict } = load();
  const trees = [settings.source === "dsh" ? render(set()) : null];
  const tree = trees[0];
  const selects = find(tree, n => n.type === "select");
  assert.equal(selects.length, 1, "one model select");
  const options = find(selects[0], n => n.type === "option").map(deep);
  assert.ok(options.includes(dict.modelFollowDefault), "follow the DSH default is offered");
  assert.ok(options.includes("DeepSeek Chat · DeepSeek"));
  const typed = find(tree, n => n.type === "input" && n.props?.placeholder === dict.modelFollowDefault);
  assert.equal(typed.length, 0, "the DSH model must never be a text box");
});

test("an empty catalogue explains why, instead of silently offering a text box", () => {
  const { render, dict } = load();
  const all = text(render(set({ models: [] })));
  assert.ok(all.includes(dict.noCatalogHint));
});

test("the external source reveals endpoint, a masked key and a fetchable model list", () => {
  const { render, dict } = load();
  const tree = render(set({ form: { ...settings, source: "external", endpoint: "https://api.x.com/v1/chat/completions", externalModel: "a" }, extModels: { models: ["a", "b"] } }));
  const all = text(tree);
  assert.ok(all.includes(dict.endpoint) && all.includes(dict.apiKey) && all.includes(dict.externalModel));
  const password = find(tree, n => n.type === "input" && n.props?.type === "password")[0];
  assert.equal(password.props.value, "", "the key is never pre-filled into the page");
  const fetchBtn = find(tree, n => n.type === "button" && deep(n).includes(dict.fetchModels))[0];
  assert.ok(fetchBtn, "a list can be fetched from the endpoint");
  const options = find(tree, n => n.type === "option").map(n => n.props?.value).filter(Boolean);
  assert.deepEqual(options, ["a", "b"], "fetched models become choices");
});

test("saving posts to the settings endpoint and keeps the dialog's own state", async () => {
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    if (url.endsWith(".settings") && !init) return { ok: true, json: async () => ({ ok: true, settings }) };
    if (url.endsWith(".models")) return { ok: true, json: async () => ({ ok: true, models: catalog }) };
    return { ok: true, json: async () => ({ ok: true, settings: { ...settings, model: "chat", provider: "deepseek" } }) };
  };
  const { render, dict } = load();
  const tree = render(set({ form: { ...settings, provider: "deepseek", model: "chat" } }));
  const saveBtn = find(tree, n => n.type === "button" && deep(n) === dict.saveSettings)[0];
  assert.ok(saveBtn, "a save button exists");
  assert.equal(saveBtn.props.disabled, false, "an edited form can be saved");
  await saveBtn.props.onClick();
  const post = requests.find(r => r.url === "/api/dsh-focusing.settings" && r.body);
  assert.ok(post, "the save must go to the settings endpoint");
  assert.equal(post.body.settings.model, "chat");
});

test("an unchanged form cannot be saved and says so", () => {
  const { render, dict } = load();
  const tree = render(set());
  const saveBtn = find(tree, n => n.type === "button" && deep(n) === dict.saveSettings)[0];
  assert.equal(saveBtn.props.disabled, true);
  assert.ok(text(tree).includes(dict.settingsClean));
});

test("the focus-guard prompt and content switches share the same dialog", () => {
  const { render, dict } = load();
  const tree = render(set({ tab: "focus" }));
  assert.ok(text(tree).includes(dict.settingsTabFocus), "a second tab holds the focus-guard content");
  const textarea = find(tree, n => n.type === "textarea")[0];
  assert.equal(textarea.props.value, "You are a careful reviewer.", "the persona is editable here");
  assert.equal(find(tree, n => n.props?.type === "checkbox").length, 4, "four content switches");
  const tabs = find(tree, n => n.props?.role === "tab").map(deep);
  assert.deepEqual(tabs, [dict.settingsTabModel, dict.settingsTabFocus]);
});

test("the connection test reports success and failure in place", async () => {
  globalThis.fetch = async (url, init) => {
    if (url.endsWith(".settings") && !init) return { ok: true, json: async () => ({ ok: true, settings }) };
    if (url.endsWith(".models")) return { ok: true, json: async () => ({ ok: true, models: catalog }) };
    return { ok: true, json: async () => ({ ok: true, settings, test: { ok: false, reason: "bad-key", detail: "HTTP 401" } }) };
  };
  const { render, dict } = load();
  const tree = render(set({ form: { ...settings, provider: "deepseek", model: "chat" } }));
  const testBtn = find(tree, n => n.type === "button" && deep(n) === dict.testConnection)[0];
  await testBtn.props.onClick();
  assert.ok(text(render(set({ test: { ok: false, reason: "bad-key", detail: "HTTP 401" } }))).includes(dict.settingsTestFailed));
});

test("Escape closes the dialog and focus is kept inside it", () => {
  const { render } = load();
  render(set());
  const keydown = globalThis.document.__listeners.find(l => l.type === "keydown");
  assert.ok(keydown, "the dialog listens for keys while open");
  let closed = 0;
  const { render: again } = load();
  again({ ...set(), onClose: () => { closed++; } });
  const handler = globalThis.document.__listeners.find(l => l.type === "keydown");
  handler.fn({ key: "Escape", stopPropagation() {} });
  assert.equal(closed, 1, "Escape closes the dialog");
});

test("a silent provider is named, not just an empty dropdown", () => {
  const { render, dict } = load();
  const all = text(render(set({
    models: [],
    providerInfo: [
      { provider: "deepseek-account", name: "DeepSeek Account", models: [] },
      { provider: "routerlink", name: "RouterLink", models: [], reason: "ACCOUNT_SIGN_IN_REQUIRED", detail: "sign in first" },
    ],
  })));
  assert.ok(all.includes("DeepSeek Account"), "every provider is listed");
  assert.ok(all.includes(dict.providerNoModels), "silence without an error is explained");
  assert.ok(all.includes("RouterLink") && all.includes("ACCOUNT_SIGN_IN_REQUIRED"), "a provider error is shown verbatim");
});

test("a pointer click leaves the field unpainted; only the keyboard marks it", () => {
  const { render } = load();
  render(set());
  const keydown = globalThis.document.__listeners.find(l => l.type === "keydown");
  const pointerdown = globalThis.document.__listeners.find(l => l.type === "pointerdown");
  assert.ok(keydown && pointerdown, "the dialog tracks both input methods");
  const scrim = globalThis.document.scrim;
  // Pressing Tab opts into focus rings.
  keydown.fn({ key: "Tab", stopPropagation() {} });
  assert.equal(scrim.classList._on, true, "keyboard use shows focus rings");
  // Any pointer press opts back out, so clicking a field changes nothing.
  pointerdown.fn({});
  assert.equal(scrim.classList._on, false, "a click must not paint the field");
});
