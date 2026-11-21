import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createTodoStore, TODO_LIMITS } from "../lib/todo-store.mjs";

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "focusing-todos-"));
  const resolved = await fs.realpath(dir);
  assert.ok(path.basename(resolved).startsWith("focusing-todos-"));
  t.after(() => fs.rm(resolved, { recursive: true, force: true }));
  return { dir: resolved, file: path.join(resolved, "private", "todos.json") };
}
const create = (store, task = { title: "Prepare release" }) => store.mutate({ action: "create", task });
const update = (store, task, patch) => store.mutate({ action: "update", id: task.id, revision: task.revision, task: patch });

test("CRUD survives restart, tracks completion and writes private files", async t => {
  const { file } = await fixture(t);
  let store = createTodoStore({ file });
  assert.deepEqual(await store.list(), []);
  let [task] = await create(store, { title: "  Prepare release  ", quadrant: "plan", dueDate: "2028-02-29", project: "Work" });
  assert.equal(task.title, "Prepare release");
  assert.equal(task.revision, 1);
  assert.equal(task.completedAt, null);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(path.dirname(file))).mode & 0o777, 0o700);
  store = createTodoStore({ file });
  assert.deepEqual(await store.list(), [task]);
  [task] = await update(store, task, { status: "done" });
  assert.ok(task.completedAt >= task.createdAt);
  const completedAt = task.completedAt;
  [task] = await update(store, task, { notes: "Released" });
  assert.equal(task.completedAt, completedAt);
  [task] = await update(store, task, { status: "doing" });
  assert.equal(task.completedAt, null);
  assert.equal(task.revision, 4);
  assert.deepEqual(await store.mutate({ action: "delete", id: task.id, revision: task.revision }), []);
  assert.deepEqual(await createTodoStore({ file }).list(), []);
});

test("concurrent creates survive disk reload and competing revisions have one winner", async t => {
  const { file } = await fixture(t);
  const store = createTodoStore({ file });
  await Promise.all(Array.from({ length: 20 }, (_, index) => create(store, { title: `Task ${index}` })));
  assert.equal((await createTodoStore({ file }).list()).length, 20);
  const [task] = await store.list();
  const results = await Promise.allSettled([update(store, task, { title: "First" }), update(store, task, { title: "Second" }), store.mutate({ action: "delete", id: task.id, revision: task.revision })]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  for (const result of results.filter(result => result.status === "rejected")) assert.equal(result.reason.status, 409);
  assert.equal((await store.list())[0].revision, 2);
  assert.deepEqual(await createTodoStore({ file }).list(), await store.list());
});

test("failed atomic save preserves memory and disk, cleans temporary files and allows retry", async t => {
  const { file } = await fixture(t);
  let fail = false;
  const io = { ...fs, rename: async (...args) => { if (fail) throw Object.assign(new Error("injected rename failure"), { code: "EIO" }); return fs.rename(...args); } };
  const store = createTodoStore({ file, io });
  const [task] = await create(store);
  const disk = await fs.readFile(file, "utf8");
  fail = true;
  await assert.rejects(update(store, task, { title: "Unsaved" }), { status: 500, reason: "storage-error" });
  await assert.rejects(store.mutate({ action: "delete", id: task.id, revision: 1 }), { status: 500 });
  await assert.rejects(create(store, { title: "Not added" }), { status: 500 });
  assert.deepEqual(await store.list(), [task]);
  assert.equal(await fs.readFile(file, "utf8"), disk);
  assert.deepEqual(await fs.readdir(path.dirname(file)), ["todos.json"]);
  fail = false;
  assert.equal((await update(store, task, { title: "Saved" }))[0].revision, 2);
});

test("invalid JSON and schema fail closed without overwriting evidence", async t => {
  const { file } = await fixture(t);
  await fs.mkdir(path.dirname(file));
  for (const raw of ["{broken", "null", '{"version":2,"tasks":[]}', '{"version":1,"tasks":[{"id":"bad"}]}']) {
    await fs.writeFile(file, raw);
    const store = createTodoStore({ file });
    await assert.rejects(store.list(), { status: 500 });
    await assert.rejects(create(store), { status: 500 });
    assert.equal(await fs.readFile(file, "utf8"), raw);
  }
});

test("stored task metadata, duplicates and missing fields fail validation", async t => {
  const { file } = await fixture(t);
  const [task] = await create(createTodoStore({ file }));
  const cases = [[task, task], [{ ...task, revision: 0 }], [{ ...task, completedAt: 1 }], [{ ...task, dueDate: "2026-02-30" }], [{ ...task, extra: true }], [{ ...task, updatedAt: task.createdAt - 1 }]];
  for (const tasks of cases) {
    await fs.writeFile(file, JSON.stringify({ version: 1, tasks }));
    await assert.rejects(createTodoStore({ file }).list(), { status: 500 });
  }
});

test("validation rejects bad dates, enums, metadata and oversized strings without mutation", async () => {
  const store = createTodoStore();
  for (const task of [null, [], {}, { title: " " }, { title: 4 }, { title: "x", quadrant: "urgent" }, { title: "x", status: "finished" }, { title: "x", dueDate: "2025-02-29" }, { title: "x", dueDate: "0000-01-01" }, { title: "x", revision: 5 }, { title: "x".repeat(TODO_LIMITS.title + 1) }]) await assert.rejects(create(store, task), { status: 400 });
  assert.deepEqual(await store.list(), []);
  await assert.rejects(store.mutate({ action: "update", id: "missing", revision: 1, task: { title: "x" } }), { status: 404 });
  await assert.rejects(store.mutate({ action: "delete", id: "missing" }), { status: 400 });
});

test("task count limit rejects additions without dropping existing tasks", async t => {
  const { file } = await fixture(t);
  const [template] = await create(createTodoStore({ file }));
  const tasks = Array.from({ length: TODO_LIMITS.tasks }, (_, index) => ({ ...template, id: `task-${index}` }));
  await fs.writeFile(file, JSON.stringify({ version: 1, tasks }));
  const store = createTodoStore({ file });
  await assert.rejects(create(store), { status: 400 });
  assert.equal((await store.list()).length, TODO_LIMITS.tasks);
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")).tasks, tasks);
});

test("requests and returned snapshots cannot mutate queued or stored tasks", async () => {
  const store = createTodoStore();
  const input = { action: "create", task: { title: "Original" } };
  const pending = store.mutate(input);
  input.task.title = "Changed";
  const tasks = await pending;
  assert.equal(tasks[0].title, "Original");
  tasks[0].title = "Externally changed";
  assert.equal((await store.list())[0].title, "Original");
});
