// Ownership and scope metadata. The DSH session log owns conversation history.
import fs from "node:fs/promises";
import path from "node:path";

const VERSION = 1;

export function createFocusingSessionStore({ file, logger } = {}) {
  let items = [];
  let loading;
  let writing = Promise.resolve();

  async function read() {
    if (!file) return;
    try {
      const value = JSON.parse(await fs.readFile(file, "utf8"));
      if (!Array.isArray(value?.sessions)) throw new Error("Invalid owned sessions file");
      items = value.sessions.filter(item => item && typeof item.id === "string" && typeof item.sessionId === "string");
    } catch (error) {
      if (error?.code === "ENOENT") return;
      logger?.("focusing: could not read owned sessions", error);
      throw error;
    }
  }

  function load() {
    loading ??= read().catch(error => {
      loading = undefined;
      throw error;
    });
    return loading;
  }

  async function persist(next) {
    if (file) {
      try {
        await fs.mkdir(path.dirname(file), { recursive: true });
        const temporary = `${file}.tmp`;
        await fs.writeFile(temporary, JSON.stringify({ version: VERSION, sessions: next }, null, 1), "utf8");
        await fs.rename(temporary, file);
      } catch (error) {
        logger?.("focusing: could not write owned sessions", error);
        throw error;
      }
    }
    items = next;
  }

  function mutate(operation) {
    const result = writing.then(async () => {
      await load();
      return operation();
    });
    writing = result.catch(() => {});
    return result;
  }

  return {
    load,
    async list() {
      await load();
      return [...items].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
    },
    async get(id) {
      await load();
      return items.find(item => item.id === id || item.sessionId === id);
    },
    put(item) {
      return mutate(async () => {
        const saved = { ...item };
        await persist([saved, ...items.filter(entry => entry.id !== saved.id && entry.sessionId !== saved.sessionId)]);
        return saved;
      });
    },
  };
}
