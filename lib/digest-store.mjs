// Saved digests, so a result survives reloads and restarts. One JSON file in
// the profile directory; newest first; bounded.

import fs from "node:fs/promises";
import path from "node:path";

const LIMIT = 60;

export function createDigestStore({ file, logger } = {}) {
  let items = [];
  let loaded = false;
  let writing = Promise.resolve();

  async function load() {
    if (loaded) return items;
    loaded = true;
    if (!file) return items;
    try {
      const parsed = JSON.parse(await fs.readFile(file, "utf8"));
      if (Array.isArray(parsed?.digests)) items = parsed.digests.filter(d => d && typeof d.id === "string");
    } catch (error) {
      if (error?.code !== "ENOENT") logger?.("focusing: could not read digests", error);
    }
    return items;
  }

  function persist() {
    if (!file) return Promise.resolve();
    const body = JSON.stringify({ version: 1, digests: items }, null, 1);
    writing = writing.then(async () => {
      try {
        await fs.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        await fs.writeFile(tmp, body, "utf8");
        await fs.rename(tmp, file);
      } catch (error) {
        logger?.("focusing: could not write digests", error);
      }
    });
    return writing;
  }

  return {
    load,
    async list() {
      await load();
      return items.map(d => ({
        id: d.id, request: d.request, title: d.result?.title || d.request, kind: d.kind,
        range: d.range, createdAt: d.createdAt, stats: d.stats, draft: !!d.draft,
      }));
    },
    async get(id) {
      await load();
      return items.find(d => d.id === id);
    },
    async put(digest) {
      await load();
      items = [digest, ...items.filter(d => d.id !== digest.id)].slice(0, LIMIT);
      await persist();
      return digest;
    },
    async remove(id) {
      await load();
      const before = items.length;
      items = items.filter(d => d.id !== id);
      if (items.length !== before) await persist();
      return items.length !== before;
    },
  };
}
