// Codex's public index API. The cache engine is shared with other transcript
// sources; these wrappers keep existing Codex caches and callers compatible.

import { loadRollout, streamRollout, listRolloutFiles } from "./codex-rollout.mjs";
import {
  summarize,
  summarizeTranscriptFile,
  isRecent,
  createTranscriptIndex,
} from "./transcript-index.mjs";

export { summarize, isRecent };

/** Read a whole rollout only for analysis; indexes use the streaming variant. */
export { loadRollout };

export async function summarizeFile(path, fold) {
  return summarizeTranscriptFile(path, fold, streamRollout);
}

export function createCodexIndex({ home, fold, cacheFile, logger, shouldWrite } = {}) {
  return createTranscriptIndex({
    home, fold, cacheFile, logger, shouldWrite,
    listFiles: listRolloutFiles,
    streamFile: streamRollout,
    source: "codex",
    version: 1,
  });
}
