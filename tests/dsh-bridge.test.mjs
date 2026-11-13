import test from "node:test";
import assert from "node:assert/strict";
import { createDshBridgeApp } from "../lib/dsh-bridge.mjs";

function fixture(token = "test-token") {
  const calls = [];
  const connection = {
    browserPeer: { id: "owner-peer" },
    createSharedFetchHandler(channel) {
      assert.equal(channel, "/api");
      return {
        async fetch(request, peer) {
          const url = new URL(request.url);
          const body = await request.text();
          calls.push({ path: url.pathname, query: url.searchParams, method: request.method, body, peer });
          if (url.pathname === "/api/dsh-focusing.state") {
            return Response.json({ sessions: [{ id: "native-1" }], settingsSummary: { source: "dsh", label: "m" } });
          }
          if (url.pathname === "/api/dsh-focusing.settings") {
            return Response.json({
              ok: true,
              settings: { source: "dsh", claudeEnabled: true },
              codexStatus: { enabled: false, sessions: 0 },
              claudeStatus: { enabled: true, ok: true, sessions: 1 },
            });
          }
          if (url.pathname === "/api/dsh-focusing.records") {
            return Response.json({ ok: true, records: [{ id: "claude:c1", source: "claude", project: "app", cwd: "/w/app", tags: ["source:claude", "project:app", "workspace:/w/app"] }], stats: {} });
          }
          if (url.pathname === "/api/dsh-focusing.records/detail") {
            return Response.json({ ok: true, record: { id: "claude:c1", source: "claude", title: "detail" } });
          }
          if (url.pathname === "/api/dsh-focusing.activity") return Response.json({ ok: true, total: 1, days: [] });
          if (url.pathname === "/api/dsh-focusing.preview") return Response.json({ ok: true, system: "s", user: "u", model: "m" });
          if (url.pathname === "/api/dsh-focusing.analyze") return Response.json({ ok: true, review: { stuck: false } });
          if (url.pathname === "/api/dsh-focusing.models") return Response.json({ ok: true, models: [{ id: "m" }] });
          if (url.pathname === "/api/dsh-focusing.external-models") return Response.json({ ok: true, models: ["m"] });
          if (url.pathname === "/api/dsh-focusing.export") return new Response("# export", { headers: { "content-type": "text/markdown", "content-disposition": "attachment; filename=x.md" } });
          return Response.json({ ok: true });
        },
      };
    },
  };
  const contextSource = {
    record: async id => ({ id, source: "claude", project: "app", cwd: "/w/app" }),
    events: async id => ({
      header: { id, source: "claude" },
      events: [
        { type: "user/message", data: { content: [{ type: "text", text: "one" }] } },
        { type: "assistant/message", data: { message: { content: [{ type: "text", text: "two" }] } } },
        { type: "turn/end", data: { turn: 1 } },
      ],
    }),
  };
  return { app: createDshBridgeApp({ connection, contextSource, token }), calls };
}

test("all business calls use the shared DSH handler and owner peer", async () => {
  const { app, calls } = fixture();
  const state = await app.focusState("native-1");
  assert.equal(state.sessions[0].id, "native-1");
  await app.pluginSettings({ claudeEnabled: true }, true);
  await app.models();
  const analyzed = await app.analyze("claude:c1");
  assert.equal(analyzed.review.stuck, false);
  const settings = await app.pluginSettings({ claudeEnabled: true }, true);
  assert.equal(settings.settings.claudeEnabled, true);
  assert.ok(calls.every(call => call.peer.id === "owner-peer"));
  const save = calls.find(call => call.path === "/api/dsh-focusing.settings" && call.method === "POST");
  assert.deepEqual(JSON.parse(save.body), { settings: { claudeEnabled: true }, test: true });
  assert.equal(calls.find(call => call.path === "/api/dsh-focusing.analyze").method, "POST");
});

test("records, activity and detail keep repeated tag/source query parameters", async () => {
  const { app, calls } = fixture();
  const records = await app.sessions({ range: "all", sources: "claude", tags: ["project:app", "workspace:/w/app"] });
  assert.equal(records.records.length, 1);
  const recordsCall = calls.find(call => call.path === "/api/dsh-focusing.records");
  assert.equal(recordsCall.query.get("sources"), "claude");
  assert.deepEqual(recordsCall.query.getAll("tag"), ["project:app", "workspace:/w/app"]);
  const tags = await app.tags({ range: "all" });
  assert.ok(tags.some(tag => tag.id === "workspace:/w/app" && tag.count === 1));
  await app.activity({ days: 7, external: "1", tags: ["source:claude"] });
  const activityCall = calls.find(call => call.path === "/api/dsh-focusing.activity");
  assert.deepEqual(activityCall.query.getAll("tag"), ["source:claude"]);
  const detail = await app.session("claude:c1", { tags: ["project:app"] });
  assert.equal(detail.record.title, "detail");
});

test("events use the shared context source with tag enforcement and bounded paging", async () => {
  const { app } = fixture();
  const first = await app.events("claude:c1", { tags: ["project:app"], limit: 2 });
  assert.equal(first.items.length, 2);
  assert.equal(first.total, 3);
  assert.equal(first.nextCursor, "2");
  const rest = await app.events("claude:c1", { offset: first.nextCursor, limit: 2 });
  assert.equal(rest.items.length, 1);
  assert.equal(rest.nextCursor, null);
  const missing = await app.events("claude:c1", { tags: ["project:other"] });
  assert.equal(missing, undefined);
});

test("preview and export preserve the original response contract", async () => {
  const { app } = fixture();
  assert.deepEqual(await app.preview("claude:c1"), { system: "s", user: "u", model: "m" });
  const exported = await app.exportSession("claude:c1", "md");
  assert.equal(exported.body, "# export");
  assert.equal(exported.contentType, "text/markdown");
  assert.match(exported.disposition, /x\.md/);
});

test("startup token redirects to a clean URL; later requests require the cookie", async () => {
  const { app } = fixture();
  const request = path => ({ url: path, headers: { host: "127.0.0.1:5000" } });
  assert.equal((await app.onRequest(request("/"))).status, 401);
  assert.equal((await app.onRequest(request("/?token=wrong"))).status, 401);
  const redirect = await app.onRequest(request("/?token=test-token"));
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), "/");
  const cookie = redirect.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const authorized = await app.onRequest({ url: "/", headers: { host: "127.0.0.1:5000", cookie: cookie.split(";")[0] } });
  assert.equal(authorized, undefined);
  await app.close();
  assert.equal((await app.onRequest(request("/"))).status, 410);
});

test("route table only matches DSH APIs and forwards the original Request", async () => {
  const { app, calls } = fixture();
  assert.equal(app.routes.get("/"), undefined);
  assert.equal(app.routes.get("/focusing-client.js"), undefined);
  assert.equal(app.routes.get("/api/v1/health"), undefined);
  assert.equal(app.routes.get("/api/dsh-focusing.bridge"), undefined, "the management route must not stop the server through its own request");
  const route = app.routes.get("/api/dsh-focusing.ask");
  const response = await route.fetch(new Request("http://standalone.local/api/dsh-focusing.ask", { method: "POST", body: "{}" }));
  assert.equal(response.ok, true);
  assert.equal(calls.at(-1).path, "/api/dsh-focusing.ask");
  assert.equal(calls.at(-1).peer.id, "owner-peer");
});
