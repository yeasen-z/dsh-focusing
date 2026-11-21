// Saved digests, so a result survives reloads and restarts. One JSON file in
// the profile directory; newest first; bounded.

import fs from "node:fs/promises";
import path from "node:path";

const LIMIT = 60;

export function createDigestStore({ file, logger } = {}) {
  let items = [];
  let loading;
  let writing = Promise.resolve();

  async function load() {
    loading ??= (async () => {
      if (!file) return;
      try {
        const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
        if (Array.isArray(parsed?.digests)) items = parsed.digests.filter(d => d && typeof d.id === 'string');
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          if (typeof logger === 'function') logger('focusing: could not read digests', error);
          else logger?.warn?.('focusing: could not read digests', error);
          throw error;
        }
      }
    })();
    await loading;
    return items;
  }

  function persist() {
    if (!file) return Promise.resolve();
    const body = JSON.stringify({ version: 1, digests: items }, null, 1);
    writing = writing.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const tmp = `${file}.tmp`;
      await fs.writeFile(tmp, body, { encoding: 'utf8', mode: 0o600 });
      await fs.chmod(tmp, 0o600);
      await fs.rename(tmp, file);
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
        status: d.status === 'running' ? 'interrupted' : d.status,
        partial: !!d.partial, retryable: !!d.retryable || d.status === 'running',
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
