import { createTodoStore, TodoError } from "./todo-store.mjs";

export const ROUTE_TODOS = "/api/dsh-focusing.todos";
export const TODO_REQUEST_BYTES = 128 * 1024;
const json = (body, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function readBody(request) {
  if (Number(request.headers.get("content-length")) > TODO_REQUEST_BYTES) throw new TodoError(400, "bad-request", "Request is too large.");
  if (!request.body) throw new TodoError(400, "bad-request", "A JSON body is required.");
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > TODO_REQUEST_BYTES) {
        await reader.cancel();
        throw new TodoError(400, "bad-request", "Request is too large.");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof TodoError) throw error;
    throw new TodoError(400, "bad-request", "Invalid JSON body.");
  } finally { reader.releaseLock(); }
}

/** The effect owns and returns the native route disposer, as other Host routes do. */
export function registerTodoRoutes(child, { file, logger } = {}) {
  const store = createTodoStore({ file, logger });
  return child.effect(() => child.connection.fetch.register({
    path: ROUTE_TODOS,
    methods: ["GET", "POST"],
    requestBody: "buffered",
    async fetch(request) {
      try {
        if (request.method === "GET") return json({ ok: true, tasks: await store.list() });
        if (request.method !== "POST") return json({ ok: false, reason: "method-not-allowed" }, 405);
        return json({ ok: true, tasks: await store.mutate(await readBody(request)) });
      } catch (error) {
        if (error instanceof TodoError) return json({ ok: false, reason: error.reason, detail: error.message }, error.status);
        try { logger?.("focusing: todo route failed", error); } catch {}
        return json({ ok: false, reason: "storage-error", detail: "Task storage is unavailable." }, 500);
      }
    },
  }));
}
