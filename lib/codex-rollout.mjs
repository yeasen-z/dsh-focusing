// Reads Codex desktop sessions as DSH-shaped events, so the panel's existing
// fold, roster, and analysis work on them unchanged.
//
// A Codex session is a JSONL "rollout" under ~/.codex/sessions (and
// archived_sessions). Each line is { timestamp, type, payload }. This module
// maps only the records the review needs and ignores the rest:
//
//   session_meta                      -> the session header (id, cwd, start time)
//   response_item message (user)      -> user/message          (the person's words)
//   event_msg task_started            -> turn/start
//   response_item custom_tool_call    -> tool/call
//   response_item custom_tool_call_output -> tool/result
//   event_msg task_complete|turn_aborted -> turn/end
//
// The user message is taken from response_item only: Codex also writes it as an
// item_completed event, and counting both would double every prompt.

import { readFileSync } from "node:fs";
import zlib from "node:zlib";

const SESSION_META = "session_meta";

/** Parse one rollout file's text into its header and DSH-shaped events. */
export function parseRollout(text) {
  const header = { id: null, cwd: "", createdAt: null, source: "codex" };
  const events = [];
  let turn = 0;
  let currentTurn = null;
  let seq = 0;
  const push = (type, time, data) => events.push({ type, time, data, seq: ++seq });

  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    const time = Date.parse(record.timestamp) || null;
    const payload = record.payload && typeof record.payload === "object" ? record.payload : {};

    if (record.type === SESSION_META) {
      header.id = payload.id ?? payload.session_id ?? header.id;
      header.cwd = typeof payload.cwd === "string" ? payload.cwd : header.cwd;
      header.createdAt = time ?? header.createdAt;
      continue;
    }

    if (record.type === "response_item") {
      if (payload.type === "message" && payload.role === "user") {
        const text = userText(payload.content);
        // Codex injects its own environment and instruction blocks as user-role
        // messages. Only what the person typed is a user message.
        if (text && !isInjected(text)) push("user/message", time, { source: { kind: "user" }, content: [{ type: "text", text }] });
      } else if (payload.type === "message" && payload.role === "assistant") {
        const reply = replyText(payload.content);
        if (reply) push("assistant/message", time, { turn: currentTurn ?? turn, message: { content: [{ type: "text", text: reply }] } });
      } else if (payload.type === "custom_tool_call") {
        push("tool/call", time, {
          turn: currentTurn ?? turn,
          callId: payload.call_id ?? payload.id,
          name: payload.name ?? "tool",
          arguments: typeof payload.input === "string" ? payload.input : JSON.stringify(payload.input ?? {}),
        });
      } else if (payload.type === "custom_tool_call_output") {
        push("tool/result", time, { message: { toolCallId: payload.call_id, content: [{ type: "text", text: outputText(payload.output) }] } });
      }
      continue;
    }

    if (record.type === "event_msg") {
      if (payload.type === "task_started") {
        turn += 1;
        currentTurn = turn;
        push("turn/start", time, { turn });
      } else if (payload.type === "task_complete" || payload.type === "turn_aborted") {
        push("turn/end", time, { turn: currentTurn ?? turn, reason: { kind: payload.type === "task_complete" ? "completed" : "aborted" } });
        currentTurn = null;
      }
    }
  }
  return { header, events };
}

/**
 * Read one rollout file from disk. Codex compresses finished rollouts to
 * .jsonl.zst, and on a long-used machine most of them are; Node decodes zstd
 * itself, so no tool needs to be installed.
 */
export function readRollout(path) {
  const raw = readFileSync(path);
  if (!path.endsWith(".zst")) return parseRollout(raw.toString("utf8"));
  if (typeof zlib.zstdDecompressSync !== "function") throw new Error("this Node cannot read zstd-compressed Codex chats (needs Node 22.15+)");
  return parseRollout(zlib.zstdDecompressSync(raw).toString("utf8"));
}

function replyText(content) {
  if (!Array.isArray(content)) return typeof content === "string" ? content.trim() : "";
  return content.filter(part => part?.type === "output_text" && typeof part.text === "string").map(part => part.text).join("\n").trim();
}

function userText(content) {
  if (!Array.isArray(content)) return typeof content === "string" ? content.trim() : "";
  return content.filter(part => part?.type === "input_text" && typeof part.text === "string").map(part => part.text).join("\n").trim();
}

// Environment and instruction blocks Codex wraps around the real prompt.
// Codex also attaches file context and app navigation as user-role text: those
// are not prompts the person wrote, so they are not counted as user messages.
const INJECTED = /^<(environment_context|user_instructions|app-context|permissions|collaboration_mode|external_codex_apps_open_page)[\s>]/;
const ATTACHED = /^# Files (mentioned|pasted) by the user:/;
function isInjected(text) {
  const head = text.trimStart();
  return INJECTED.test(head) || ATTACHED.test(head);
}

function outputText(output) {
  if (typeof output === "string") return output;
  if (!Array.isArray(output)) return "";
  return output.map(part => (typeof part?.text === "string" ? part.text : "")).join("");
}

import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** Where Codex keeps its rollouts, unless the Host says otherwise. */
export function codexHome(env = process.env) {
  return env.CODEX_HOME || join(homedir(), ".codex");
}

/** Expand a leading ~ the way a person types it into a settings field. */
export function expandHome(path) {
  const text = String(path ?? "").trim();
  if (text === "~") return homedir();
  if (text.startsWith("~/")) return join(homedir(), text.slice(2));
  return text;
}

/**
 * Find the Codex data directory. Automatic discovery tries CODEX_HOME, then
 * ~/.codex; a manual path is used as given (either the .codex directory itself
 * or its sessions/ folder). Returns the directory and how it was found, or why
 * nothing usable was found -- the settings surface shows this as it is.
 */
export function resolveCodexHome({ mode = "auto", path = "" } = {}, env = process.env) {
  const looksLikeHome = dir => existsSync(join(dir, "sessions")) || existsSync(join(dir, "archived_sessions"));
  if (mode === "manual") {
    const given = expandHome(path);
    if (!given) return { ok: false, reason: "no-path" };
    if (!existsSync(given)) return { ok: false, reason: "missing", path: given };
    // Accept the sessions folder too: people often paste that one.
    const home = /[\\/]sessions[\\/]?$/.test(given) ? join(given, "..") : given;
    return looksLikeHome(home) ? { ok: true, home, via: "manual" } : { ok: false, reason: "not-codex", path: given };
  }
  const candidates = [env.CODEX_HOME ? { dir: env.CODEX_HOME, via: "env" } : null, { dir: join(homedir(), ".codex"), via: "default" }].filter(Boolean);
  for (const { dir, via } of candidates) if (looksLikeHome(dir)) return { ok: true, home: dir, via };
  return { ok: false, reason: "not-found", tried: candidates.map(c => c.dir) };
}

/** Every rollout file under sessions/ and archived_sessions/. Missing dirs are fine. */
export function listRolloutFiles(home = codexHome()) {
  const files = [];
  const walk = dir => {
    let names;
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names) {
      const path = join(dir, name);
      let stats;
      try { stats = statSync(path); } catch { continue; }
      if (stats.isDirectory()) walk(path);
      else if (name.startsWith("rollout-") && (name.endsWith(".jsonl") || name.endsWith(".jsonl.zst"))) files.push({ path, archived: dir.includes("archived_sessions") });
    }
  };
  walk(join(home, "sessions"));
  walk(join(home, "archived_sessions"));
  return files;
}

/** Thread names Codex shows in its own sidebar, keyed by session id. */
export function readThreadNames(home = codexHome()) {
  const names = new Map();
  const index = join(home, "session_index.jsonl");
  if (!existsSync(index)) return names;
  for (const line of readFileSync(index, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.id && typeof row.thread_name === "string") names.set(String(row.id), row.thread_name);
    } catch { /* a bad index line costs one title, not the list */ }
  }
  return names;
}

/**
 * Roster rows for Codex sessions, shaped like DSH rows and tagged with their
 * source. Each rollout is parsed once per (path, mtime): the panel polls every
 * few seconds, and a finished rollout does not change.
 */
export function createCodexRoster(home = codexHome()) {
  const parsed = new Map();
  return {
    rows() {
      const names = readThreadNames(home);
      const out = [];
      const seen = new Set();
      const files = listRolloutFiles(home);
      for (const file of files) {
        let mtime;
        try { mtime = statSync(file.path).mtimeMs; } catch { continue; }
        let entry = parsed.get(file.path);
        if (!entry || entry.mtime !== mtime) {
          const { header, events } = readRollout(file.path);
          const users = events.filter(e => e.type === "user/message");
          const first = users[0]?.data?.content?.[0]?.text ?? "";
          const last = events.reduce((m, e) => (Number.isFinite(e.time) ? Math.max(m, e.time) : m), 0);
          entry = { mtime, header, title: "", firstPrompt: first.replace(/\s+/g, " ").slice(0, 100), updatedAt: last || mtime, turns: events.filter(e => e.type === "turn/start").length, userMessages: users.length };
          parsed.set(file.path, entry);
        }
        if (!entry.header.id || seen.has(entry.header.id)) continue;
        seen.add(entry.header.id);
        const title = names.get(entry.header.id) || entry.firstPrompt || "";
        out.push({
          id: `codex:${entry.header.id}`, source: "codex", sourceId: entry.header.id,
          title, untitled: !title, project: projectNameOf(entry.header.cwd), cwd: entry.header.cwd,
          status: "idle", updatedAt: entry.updatedAt, createdAt: entry.header.createdAt,
          loaded: true, archived: file.archived, turns: entry.turns, userMessages: entry.userMessages,
          reviewed: false, reviewCount: 0,
        });
      }
      // Forget rollouts that no longer exist, using the same listing (one walk per poll).
      const live = new Set(files.map(f => f.path));
      for (const path of [...parsed.keys()]) if (!live.has(path)) parsed.delete(path);
      return out;
    },
  };
}

function projectNameOf(cwd) {
  if (!cwd) return "";
  return cwd.split("/").filter(Boolean).pop() ?? "";
}

/**
 * Folded records for Codex chats, for the activity calendar. Same shape the
 * record index produces for DSH sessions, so day counting is one code path.
 * Cached per (path, mtime) like the roster.
 */
export function createCodexRecords(home = codexHome(), fold) {
  const cache = new Map();
  return {
    records() {
      const out = [];
      for (const file of listRolloutFiles(home)) {
        let mtime;
        try { mtime = statSync(file.path).mtimeMs; } catch { continue; }
        let hit = cache.get(file.path);
        if (!hit || hit.mtime !== mtime) {
          const { header, events } = readRollout(file.path);
          hit = { mtime, record: header.id ? { ...fold(events, { ...header, id: `codex:${header.id}` }), source: "codex", archived: file.archived } : null };
          cache.set(file.path, hit);
        }
        if (hit.record) out.push(hit.record);
      }
      return out;
    },
  };
}
