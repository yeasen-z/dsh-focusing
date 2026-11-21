import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registerTodoRoutes, ROUTE_TODOS, TODO_REQUEST_BYTES } from "../lib/todo-routes.mjs";

function setup(options) {
  let route;
  let disposed = false;
  const child = { effect: fn => fn(), connection: { fetch: { register: value => { route = value; return async () => { disposed = true; }; } } } };
  const dispose = registerTodoRoutes(child, options);
  const call = async (body, method = body === undefined ? "GET" : "POST") => {
    const response = await route.fetch(new Request(`http://localhost${ROUTE_TODOS}`, { method, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) }));
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
  return { route, call, dispose, disposed: () => disposed };
}
async function fixture(t) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "focusing-todo-routes-")));
  assert.ok(path.basename(dir).startsWith("focusing-todo-routes-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return path.join(dir, "todos.json");
}

test("route declares methods, buffered body, no-store and returns its disposer", async () => {
  const h = setup();
  assert.equal(h.route.path, ROUTE_TODOS);
  assert.deepEqual(h.route.methods, ["GET", "POST"]);
  assert.equal(h.route.requestBody, "buffered");
  const result = await h.call();
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.deepEqual(result.body, { ok: true, tasks: [] });
  await h.dispose();
  assert.equal(h.disposed(), true);
});

test("POST CRUD returns complete lists, persists across route registrations and rejects stale edits", async t => {
  const file = await fixture(t);
  const h = setup({ file });
  let result = await h.call({ action: "create", task: { title: "One" } });
  assert.equal(result.status, 200);
  const first = result.body.tasks[0];
  result = await h.call({ action: "create", task: { title: "Two", quadrant: "delegate" } });
  assert.equal(result.body.tasks.length, 2);
  result = await h.call({ action: "update", id: first.id, revision: first.revision, task: { status: "done" } });
  assert.equal(result.body.tasks.find(task => task.id === first.id).revision, 2);
  assert.equal((await h.call({ action: "delete", id: first.id, revision: 1 })).status, 409);
  assert.equal((await h.call({ action: "update", id: first.id, revision: 1, task: { title: "stale" } })).body.reason, "conflict");
  assert.deepEqual((await setup({ file }).call()).body, result.body);
  result = await h.call({ action: "delete", id: first.id, revision: 2 });
  assert.equal(result.body.tasks.length, 1);
  assert.equal((await h.call({ action: "delete", id: first.id, revision: 2 })).status, 404);
});

test("malformed requests and oversized bodies are 400 with no mutation", async () => {
  const h = setup();
  for (const body of ["{", "null", "[]", {}, { action: "no" }, { action: "create", task: { title: "" } }, { action: "update", id: "x", task: {} }, " ".repeat(TODO_REQUEST_BYTES + 1)]) {
    const result = await h.call(body);
    assert.equal(result.status, 400);
    assert.equal(result.body.ok, false);
  }
  assert.deepEqual((await h.call()).body.tasks, []);
});

test("corruption is reported as storage 500 for reads and writes and is preserved", async t => {
  const file = await fixture(t);
  await fs.writeFile(file, "private broken content");
  const h = setup({ file });
  for (const body of [undefined, { action: "create", task: { title: "x" } }]) {
    const result = await h.call(body);
    assert.equal(result.status, 500);
    assert.equal(result.body.reason, "storage-error");
    assert.ok(!JSON.stringify(result.body).includes(file));
  }
  assert.equal(await fs.readFile(file, "utf8"), "private broken content");
});

test("save failure returns 500 and subsequent GET retains committed state", async t => {
  const file = await fixture(t);
  const h = setup({ file });
  const created = await h.call({ action: "create", task: { title: "Keep" } });
  const task = created.body.tasks[0];
  // The fixture resolves this exact target; replace it with a directory so rename fails.
  assert.equal(path.basename(file), "todos.json");
  await fs.unlink(file);
  await fs.mkdir(file);
  const result = await h.call({ action: "update", id: task.id, revision: 1, task: { title: "Lost" } });
  assert.equal(result.status, 500);
  assert.deepEqual((await h.call()).body, created.body);
});
