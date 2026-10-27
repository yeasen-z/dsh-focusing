/**
 * Storage for analysis settings.
 *
 * Kept in the plugin's own file under the profile directory when a writable
 * home is available, otherwise in memory. The API key never appears in any
 * response body, so a crash log or transcript export cannot leak it.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { DEFAULT_SETTINGS, mergeSettings, normalizeSettings, publicSettings } from "./settings.mjs";

export function createSettingsStore({ file, logger } = {}) {
  let current = normalizeSettings(DEFAULT_SETTINGS);
  let loaded = false;

  async function load() {
    if (loaded) return current;
    loaded = true;
    if (!file) return current;
    try {
      const raw = await fs.readFile(file, "utf8");
      current = normalizeSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
    } catch (error) {
      if (error?.code !== "ENOENT") {
        // A corrupt file must not brick the panel: fall back to defaults and say so.
        logger?.("focusing: could not read analysis settings", error);
      }
    }
    return current;
  }

  async function save(next) {
    current = normalizeSettings(next);
    if (!file) return current;
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(current, null, 2), "utf8");
    } catch (error) {
      logger?.("focusing: could not write analysis settings", error);
    }
    return current;
  }

  return {
    load,
    save,
    get() {
      return current;
    },
    /** Apply a submitted patch; an empty apiKey keeps the stored one. */
    async update(patch) {
      return save(mergeSettings(current, patch));
    },
    view() {
      return publicSettings(current);
    },
  };
}
