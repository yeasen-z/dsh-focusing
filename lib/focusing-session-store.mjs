// Focusing-owned native DSH sessions. This store contains ownership and scope
// metadata only; the DSH session log remains the sole source of conversation truth.
import fs from "node:fs/promises";
import path from "node:path";

const VERSION = 1;
const LIMIT = 300;

export function createFocusingSessionStore({ file, logger } = {}) {
  let items = [];
  let loaded = false;
  let writing = Promise.resolve();

  async function load() {
    if (loaded) return items;
    loaded = true;
    if (!file) return items;
    try {
      const value = JSON.parse(await fs.readFile(file, "utf8"));
      if (Array.isArray(value?.sessions)) {
        items = value.sessions.filter(item => item && typeof item.id === "string" && typeof item.sessionId === "string");
      }
    } catch (error) {
      if (error?.code !== "ENOENT") logger?.("focusing: could not read owned sessions", error);
    }
    return items;
  }

  function persist() {
    if (!file) return Promise.resolve();
    const body = JSON.stringify({ version: VERSION, sessions: items }, null, 1);
    writing = writing.then(async () => {
      try {
        await fs.mkdir(path.dirname(file), { recursive: true });
        const temporary = `${file}.tmp`;
        await fs.writeFile(temporary, body, "utf8");
        await fs.rename(temporary, file);
      } catch (error) {
        logger?.("focusing: could not write owned sessions", error);
      }
    });
    return writing;
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
    async put(item) {
      await load();
      const saved = { ...item };
      items = [saved, ...items.filter(entry => entry.id !== saved.id && entry.sessionId !== saved.sessionId)].slice(0, LIMIT);
      await persist();
      return saved;
    },
    async remove(id) {
      await load();
      const before = items.length;
      items = items.filter(item => item.id !== id && item.sessionId !== id);
      if (items.length !== before) await persist();
      return items.length !== before;
    },
  };
}
