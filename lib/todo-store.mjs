// Personal tasks are independent of sessions, agents, and model activity.
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const TODO_LIMITS = Object.freeze({ tasks: 2000, title: 300, notes: 20000, project: 200, storeBytes: 64 * 1024 * 1024 });
const fields = ["title", "notes", "project", "quadrant", "status", "dueDate"];
const metadata = ["id", "createdAt", "updatedAt", "completedAt", "revision"];
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const timestamp = value => Number.isSafeInteger(value) && value >= 0;
export class TodoError extends Error {
  constructor(status, reason, message, options) { super(message, options); this.status = status; this.reason = reason; }
}
const invalid = message => { throw new TodoError(400, "bad-request", message); };
function dateValid(value) {
  if (value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function patchOf(input, partial = false) {
  if (!object(input) || Object.keys(input).some(key => !fields.includes(key))) invalid("Task contains unknown fields.");
  if (!partial && !Object.hasOwn(input, "title")) invalid("A title is required.");
  const result = {};
  for (const key of fields) {
    if (!Object.hasOwn(input, key)) continue;
    let value = input[key];
    if (typeof value !== "string") invalid(`${key} must be a string.`);
    if (["title", "project"].includes(key)) value = value.trim();
    if (TODO_LIMITS[key] && value.length > TODO_LIMITS[key]) invalid(`${key} is too long.`);
    if (key === "title" && !value) invalid("A title is required.");
    if (key === "quadrant" && !["do", "plan", "delegate", "later"].includes(value)) invalid("Invalid quadrant.");
    if (key === "status" && !["todo", "doing", "done"].includes(value)) invalid("Invalid status.");
    if (key === "dueDate" && !dateValid(value)) invalid("Invalid due date; use YYYY-MM-DD or an empty string.");
    result[key] = value;
  }
  return result;
}
function storedTasks(data) {
  if (!object(data) || data.version !== 1 || !Array.isArray(data.tasks) || data.tasks.length > TODO_LIMITS.tasks) throw new Error("Invalid todo store envelope.");
  const ids = new Set();
  return data.tasks.map(task => {
    if (!object(task) || Object.keys(task).length !== fields.length + metadata.length || [...fields, ...metadata].some(key => !Object.hasOwn(task, key))) throw new Error("Invalid stored task fields.");
    const mutable = Object.fromEntries(fields.map(key => [key, task[key]]));
    patchOf(mutable);
    if (typeof task.id !== "string" || !task.id || task.id.length > 100 || ids.has(task.id) || !timestamp(task.createdAt) || !timestamp(task.updatedAt) || task.updatedAt < task.createdAt || !Number.isSafeInteger(task.revision) || task.revision < 1 || (task.status === "done" ? !timestamp(task.completedAt) || task.completedAt < task.createdAt || task.completedAt > task.updatedAt : task.completedAt !== null)) throw new Error("Invalid stored task metadata.");
    ids.add(task.id);
    return { ...task };
  });
}

/** One store owns each file. All operations, including reads, join its queue.
 * io is a filesystem seam for deterministic failed-write tests. No file means
 * explicitly ephemeral storage; integrations should always supply a private file.
 */
export function createTodoStore({ file, logger, io = fs } = {}) {
  const target = file ? path.resolve(file) : null;
  let tasks = [];
  let loading;
  let queue = Promise.resolve();
  const log = error => { try { logger?.("focusing: todo storage failed", error); } catch {} };
  const storageError = error => { log(error); return new TodoError(500, "storage-error", "Task storage is unavailable.", { cause: error }); };
  const ready = () => (loading ??= (async () => {
    if (!target) return;
    try {
      const stat = await io.stat(target);
      if (stat.size > TODO_LIMITS.storeBytes) throw new Error("Todo store is too large.");
      const next = storedTasks(JSON.parse(await io.readFile(target, "utf8")));
      await io.chmod(target, 0o600);
      tasks = next;
    } catch (error) {
      if (error.code !== "ENOENT") throw storageError(error);
    }
  })());
  const serial = work => {
    const pending = queue.then(async () => { await ready(); return work(); });
    queue = pending.catch(() => {});
    return pending;
  };
  async function save(next) {
    if (!target) return;
    const temporary = `${target}.${randomUUID()}.tmp`;
    let handle;
    try {
      await io.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      const body = JSON.stringify({ version: 1, tasks: next });
      if (Buffer.byteLength(body) > TODO_LIMITS.storeBytes) invalid("Task storage limit reached.");
      handle = await io.open(temporary, "wx", 0o600);
      await handle.writeFile(body, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await io.rename(temporary, target);
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      // temporary is an absolute sibling of the verified target, generated above.
      await io.unlink(temporary).catch(() => {});
      if (error instanceof TodoError) throw error;
      throw storageError(error);
    }
  }
  return {
    ready,
    list: () => serial(() => tasks.map(task => ({ ...task }))),
    mutate(input) {
      // Detach caller-owned objects before queued work starts.
      let body;
      try { body = structuredClone(input); } catch { return Promise.reject(new TodoError(400, "bad-request", "Invalid request.")); }
      return serial(async () => {
        if (!object(body) || !["create", "update", "delete"].includes(body.action)) invalid("Invalid action.");
        const allowed = body.action === "create" ? ["action", "task"] : body.action === "update" ? ["action", "id", "revision", "task"] : ["action", "id", "revision"];
        if (Object.keys(body).some(key => !allowed.includes(key))) invalid("Unknown request fields.");
        let next;
        const now = Date.now();
        if (body.action === "create") {
          const patch = patchOf(body.task);
          if (tasks.length >= TODO_LIMITS.tasks) invalid("Task limit reached.");
          const task = { id: randomUUID(), notes: "", project: "", quadrant: "do", status: "todo", dueDate: "", ...patch, createdAt: now, updatedAt: now, completedAt: patch.status === "done" ? now : null, revision: 1 };
          next = [task, ...tasks];
        } else {
          if (typeof body.id !== "string" || !body.id || body.id.length > 100 || !Number.isSafeInteger(body.revision) || body.revision < 1) invalid("An id and positive revision are required.");
          const patch = body.action === "update" ? patchOf(body.task, true) : null;
          const previous = tasks.find(task => task.id === body.id);
          if (!previous) throw new TodoError(404, "not-found", "Task not found.");
          if (previous.revision !== body.revision) throw new TodoError(409, "conflict", "Task changed; reload before retrying.");
          if (body.action === "delete") next = tasks.filter(task => task.id !== body.id);
          else {
            if (previous.revision === Number.MAX_SAFE_INTEGER) throw new TodoError(409, "conflict", "Task revision limit reached.");
            const updatedAt = Math.max(now, previous.updatedAt);
            const updated = { ...previous, ...patch, updatedAt, revision: previous.revision + 1 };
            updated.completedAt = updated.status === "done" ? previous.completedAt ?? updatedAt : null;
            next = tasks.map(task => task.id === body.id ? updated : task);
          }
        }
        await save(next);
        tasks = next;
        return tasks.map(task => ({ ...task }));
      });
    },
  };
}
