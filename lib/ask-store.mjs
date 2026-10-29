// Conversations the person had with the ask tool, so what was asked and what
// came back survives page reloads and Host restarts. One JSON file in the
// profile directory; newest activity first; bounded. A conversation is a plain
// message list the plugin maintains itself -- not a DSH session -- plus the
// bookkeeping (status, per-turn tool steps) the page renders.

import fs from "node:fs/promises";
import path from "node:path";

const LIMIT = 300;
// Stored text (tool results, messages) is capped so the file stays small; the
// live run and the model always saw the whole thing. The cap is recorded.
export const STORED_TEXT_LIMIT = 20000;

const cap = (value) => {
  if (typeof value !== "string" || value.length <= STORED_TEXT_LIMIT) return [value, undefined];
  return [value.slice(0, STORED_TEXT_LIMIT), value.length];
};

export function trimForStorage(ask) {
  const steps = (ask.steps ?? []).map(step => {
    const [result, storedTruncated] = cap(step.result);
    return storedTruncated === undefined ? step : { ...step, result, storedTruncated };
  });
  const messages = (ask.messages ?? []).map(message => {
    if (!Array.isArray(message.content)) return message;
    let changed = false;
    const content = message.content.map(block => {
      if (typeof block.text !== "string") return block;
      const [text, n] = cap(block.text);
      if (n === undefined) return block;
      changed = true;
      return { ...block, text };
    });
    return changed ? { ...message, content, storedTruncated: true } : message;
  });
  return { ...ask, steps, messages };
}

export function createAskStore({ file, logger } = {}) {
  let items = [];
  let loaded = false;
  let writing = Promise.resolve();

  async function load() {
    if (loaded) return items;
    loaded = true;
    if (!file) return items;
    try {
      const parsed = JSON.parse(await fs.readFile(file, "utf8"));
      if (Array.isArray(parsed?.asks)) items = parsed.asks.filter(a => a && typeof a.id === "string");
    } catch (error) {
      if (error?.code !== "ENOENT") logger?.("focusing: could not read asks", error);
    }
    return items;
  }

  function persist() {
    if (!file) return Promise.resolve();
    const body = JSON.stringify({ version: 1, asks: items }, null, 1);
    writing = writing.then(async () => {
      try {
        await fs.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        await fs.writeFile(tmp, body, "utf8");
        await fs.rename(tmp, file);
      } catch (error) {
        logger?.("focusing: could not write asks", error);
      }
    });
    return writing;
  }

  return {
    load,
    async list() {
      await load();
      return items;
    },
    async get(id) {
      await load();
      return items.find(a => a.id === id);
    },
    async put(ask) {
      await load();
      const saved = trimForStorage(ask);
      items = [saved, ...items.filter(a => a.id !== saved.id)].slice(0, LIMIT);
      await persist();
      return saved;
    },
    async remove(id) {
      await load();
      const before = items.length;
      items = items.filter(a => a.id !== id);
      if (items.length !== before) await persist();
      return items.length !== before;
    },
  };
}
