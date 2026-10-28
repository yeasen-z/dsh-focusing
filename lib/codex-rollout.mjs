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
      } else if (payload.type === "custom_tool_call") {
        push("tool/call", time, {
          turn: currentTurn ?? turn,
          callId: payload.call_id ?? payload.id,
          name: payload.name ?? "tool",
          arguments: typeof payload.input === "string" ? payload.input : JSON.stringify(payload.input ?? {}),
        });
      } else if (payload.type === "custom_tool_call_output") {
        push("tool/result", time, { message: { toolCallId: payload.call_id, output: outputText(payload.output) } });
      }
      continue;
    }

    if (record.type === "event_msg") {
      if (payload.type === "task_started") {
        turn += 1;
        currentTurn = turn;
        push("turn/start", time, { turn });
      } else if (payload.type === "task_complete" || payload.type === "turn_aborted") {
        push("turn/end", time, { turn: currentTurn ?? turn, reason: payload.type === "task_complete" ? "completed" : "aborted" });
        currentTurn = null;
      }
    }
  }
  return { header, events };
}

/** Read one rollout file from disk. */
export function readRollout(path) {
  return parseRollout(readFileSync(path, "utf8"));
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
