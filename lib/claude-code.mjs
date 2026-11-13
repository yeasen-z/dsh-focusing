// Read Claude Code's local JSONL sessions as DSH-shaped events.
//
// Sessions normally live under ~/.claude/projects/<encoded-workspace>/*.jsonl.
// Claude does not write Codex-style task_started/task_complete records, so a
// genuine user message opens a turn and the next genuine user message (or EOF)
// closes the previous one. Tool-result envelopes and sidechains are not turns.

import { createReadStream, readFileSync, readdirSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { homedir } from "node:os";
import { createTranscriptIndex } from "./transcript-index.mjs";

const INJECTED = /^(?:<system-reminder>|<local-command-stdout>|<command-name>|<command-message>|<command-args>|Caveat:|Current runtime context[.:]|Time sampled while preparing|\[Request interrupted by user)/i;

function textOf(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter(part => part?.type === "text" && typeof part.text === "string")
    .map(part => part.text)
    .join("\n")
    .trim();
}

function resultText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(part => {
    if (typeof part === "string") return part;
    if (part?.type === "text" && typeof part.text === "string") return part.text;
    return typeof part?.content === "string" ? part.content : "";
  }).join("");
}

/** Parse one JSONL stream without retaining the whole file. */
export function createLineReader(onEvent) {
  const header = { id: null, cwd: "", createdAt: null, source: "claude", title: "" };
  let turn = 0;
  let currentTurn = null;
  let seq = 0;
  let lastTime = null;
  let emittedTitle = "";
  const push = (type, time, data) => {
    if (Number.isFinite(time)) lastTime = Math.max(lastTime ?? time, time);
    onEvent({ type, time: Number.isFinite(time) ? time : null, data, seq: ++seq });
  };
  const closeTurn = time => {
    if (currentTurn === null) return;
    push("turn/end", time ?? lastTime, { turn: currentTurn, reason: { kind: "completed" } });
    currentTurn = null;
  };

  function line(raw) {
    if (!raw.trim()) return;
    let record;
    try { record = JSON.parse(raw); } catch { return; }
    if (!record || typeof record !== "object") return;
    // Sidechains reuse their parent's session id, including in standalone logs.
    // Ignore them before collecting identity, metadata or title events so an
    // all-sidechain file cannot produce a main-session index entry.
    if (record.isSidechain === true) return;
    const time = Date.parse(record.timestamp);
    const stamp = Number.isFinite(time) ? time : null;
    if (typeof record.sessionId === "string" && record.sessionId) header.id = record.sessionId;
    if (typeof record.cwd === "string") header.cwd = record.cwd;
    if (stamp !== null) header.createdAt = header.createdAt === null ? stamp : Math.min(header.createdAt, stamp);

    // Claude's summary records carry the sidebar title, but no session id/cwd.
    if (record.type === "summary" && typeof record.summary === "string" && record.summary.trim()) {
      header.title = record.summary.trim();
      if (emittedTitle !== header.title) {
        emittedTitle = header.title;
        push("session/title", stamp ?? header.createdAt, { title: header.title });
      }
      return;
    }

    const message = record.message && typeof record.message === "object" ? record.message : {};
    const content = message.content;

    if (record.type === "assistant") {
      const text = textOf(content);
      if (text) push("assistant/message", stamp, {
        turn: currentTurn ?? turn,
        message: { content: [{ type: "text", text }] },
      });
      if (Array.isArray(content)) {
        for (const part of content) {
          if (part?.type !== "tool_use") continue;
          push("tool/call", stamp, {
            turn: currentTurn ?? turn,
            callId: part.id,
            name: part.name ?? "tool",
            arguments: JSON.stringify(part.input ?? {}),
          });
        }
      }
      return;
    }

    if (record.type !== "user") return;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part?.type !== "tool_result") continue;
        push("tool/result", stamp, {
          message: {
            toolCallId: part.tool_use_id,
            isError: part.is_error === true,
            content: [{ type: "text", text: resultText(part.content) }],
          },
        });
      }
      // A tool-result envelope can also carry reminders or bookkeeping text.
      // None of that is a new prompt from the person.
      if (content.some(part => part?.type === "tool_result")) return;
    }
    if (record.isMeta === true || record.isReplay === true || record.toolUseResult !== undefined) return;
    const text = textOf(content);
    if (!text || INJECTED.test(text.trimStart())) return;
    closeTurn(stamp ?? lastTime);
    turn += 1;
    currentTurn = turn;
    push("user/message", stamp, { source: { kind: "user" }, content: [{ type: "text", text }] });
    push("turn/start", stamp, { turn });
  }

  function finish() {
    closeTurn(lastTime);
    return header;
  }
  return { header, line, finish };
}

/** Parse a complete session, useful for analysis and tests. */
export function parseSession(text) {
  const events = [];
  const reader = createLineReader(e => events.push(e));
  for (const raw of String(text).split("\n")) reader.line(raw);
  return { header: reader.finish(), events };
}

/** Stream a session file; only callers that need full events retain them. */
export async function streamSession(path, onEvent) {
  const reader = createLineReader(onEvent);
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const raw of lines) reader.line(raw);
  return reader.finish();
}

export function loadSession(path) {
  return parseSession(readFileSync(path, "utf8"));
}

export function claudeHome(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

export function expandHome(path) {
  const text = String(path ?? "").trim();
  if (text === "~") return homedir();
  if (text.startsWith("~/")) return join(homedir(), text.slice(2));
  return text;
}

/** Find the Claude config root, accepting its projects/ folder in manual mode. */
export function resolveClaudeHome({ mode = "auto", path = "" } = {}, env = process.env) {
  const looksLikeHome = dir => existsSync(join(dir, "projects"));
  if (mode === "manual") {
    const given = expandHome(path);
    if (!given) return { ok: false, reason: "no-path" };
    if (!existsSync(given)) return { ok: false, reason: "missing", path: given };
    const home = /[\\/]projects[\\/]?$/.test(given) ? join(given, "..") : given;
    return looksLikeHome(home) ? { ok: true, home, via: "manual" } : { ok: false, reason: "not-claude", path: given };
  }
  const candidates = [
    env.CLAUDE_CONFIG_DIR ? { dir: env.CLAUDE_CONFIG_DIR, via: "env" } : null,
    { dir: join(homedir(), ".claude"), via: "default" },
  ].filter(Boolean);
  for (const { dir, via } of candidates) if (looksLikeHome(dir)) return { ok: true, home: dir, via };
  return { ok: false, reason: "not-found", tried: candidates.map(c => c.dir) };
}

/** Every Claude Code session under projects/, including nested version layouts. */
export function listSessionFiles(home = claudeHome()) {
  const files = [];
  const walk = dir => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Independent agent logs share the parent id; they are not sessions.
        if (entry.name !== "subagents") walk(path);
      }
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push({ path, archived: false });
    }
  };
  walk(join(home, "projects"));
  return files;
}

export function createClaudeIndex({ home, fold, cacheFile, logger, shouldWrite } = {}) {
  return createTranscriptIndex({
    home, fold, cacheFile, logger, shouldWrite,
    listFiles: listSessionFiles,
    streamFile: streamSession,
    source: "claude",
    // Rebuild cached summaries that collected identity from sidechain records.
    version: 2,
  });
}

function projectNameOf(cwd) {
  if (!cwd) return "";
  return cwd.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? "";
}

/** Focus-panel rows for imported Claude chats. */
export function createClaudeRoster(home = claudeHome(), index) {
  return {
    rows() {
      const out = [];
      const seen = new Set();
      for (const chat of index.refresh()) {
        if (!chat.id || seen.has(chat.id)) continue;
        seen.add(chat.id);
        const title = chat.title || chat.firstPrompt || "";
        out.push({
          id: `claude:${chat.id}`, source: "claude", sourceId: chat.id,
          title, untitled: !title, project: projectNameOf(chat.cwd), cwd: chat.cwd,
          status: "idle", updatedAt: chat.updatedAt ?? chat.createdAt, createdAt: chat.createdAt,
          loaded: true, archived: false, turns: chat.turns, userMessages: chat.userMessages,
          reviewed: false, reviewCount: 0,
        });
      }
      return out;
    },
  };
}

/** Lightweight activity records backed by the same summaries as the roster. */
export function createClaudeRecords(home = claudeHome(), index) {
  return {
    records() {
      return index.refresh().map(chat => ({
        id: `claude:${chat.id}`, source: "claude", archived: false,
        personal: chat.personal !== false,
        turns: chat.dayTurns.map(t => ({
          start: t.at, end: t.at, calls: t.calls,
          requests: t.requests ? Array.from({ length: t.requests }, () => ({ time: t.at })) : [],
        })),
      }));
    },
  };
}
