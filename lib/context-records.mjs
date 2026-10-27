// Context records: fold one complete session log into what a person would
// remember about it — what they asked, what got done, which files moved, what
// is still open. Pure; no DSH imports, so it is testable against plain arrays.
//
// The fold is per TURN with timestamps so a record can later be sliced to any
// time range ("this week") without re-reading the log.

const REQUEST_LIMIT = 600;
const REPLY_LIMIT = 900;
const COMMAND_LIMIT = 140;
const COMMANDS_PER_TURN = 6;
const FILES_PER_TURN = 40;

const NOISE = /^(?:Current runtime context[.:]|<system-reminder>|Time sampled while preparing)/;

export function blocksText(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter(b => b && b.type === "text" && typeof b.text === "string")
    .map(b => b.text)
    .join("\n")
    .trim();
}

/** The person's own words, with harness-appended context stripped. */
export function humanRequest(message) {
  const kind = message?.source?.kind;
  if (kind !== undefined && kind !== "user") return "";
  let text = blocksText(message?.content);
  if (!text || NOISE.test(text)) return "";
  // Some clients append runtime context or reminders after the request.
  text = text.split(/\n?(?:Current runtime context[.:]|<system-reminder>)/)[0].trim();
  return text;
}

export function projectOf(cwd) {
  if (typeof cwd !== "string" || !cwd) return "";
  const parts = cwd.replace(/\\/g, "/").replace(/\/+$/, "").split("/").filter(Boolean);
  return parts.at(-1) || "/";
}

function clip(text, limit) {
  const s = String(text ?? "").replace(/\s+\n/g, "\n").trim();
  return s.length > limit ? `${s.slice(0, limit)}…` : s;
}

function parseArgs(raw) {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw !== "string") return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

const EDIT_TOOLS = /^(?:edit|multi_edit|write|notebook_edit|str_replace_editor|apply_patch|create_file)$/i;
const SHELL_TOOLS = /^(?:bash|pwsh|shell|terminal|run)$/i;

/** Fold a full event array into a context record. */
export function foldRecord(events, header = {}) {
  const record = {
    id: header.id ?? "",
    cwd: header.cwd ?? "",
    project: projectOf(header.cwd),
    createdAt: header.createdAt ?? null,
    parent: header.parentSession ?? null,
    origin: header.origin ?? null,
    depth: header.delegationDepth ?? 0,
    title: "",
    updatedAt: header.createdAt ?? null,
    turns: [],
    todos: [],
    todosAt: null,
    open: false,
  };
  const calls = new Map();
  let turn = null;
  let pendingRequests = [];

  const ensureTurn = (n, time) => {
    if (turn && (n === undefined || turn.n === n)) return turn;
    turn = {
      n: n ?? (record.turns.length + 1), start: time ?? null, end: null, endReason: null,
      requests: pendingRequests, reply: "", calls: 0, failed: 0, files: [], commands: [],
    };
    pendingRequests = [];
    record.turns.push(turn);
    return turn;
  };

  for (const event of events ?? []) {
    if (!event || typeof event !== "object") continue;
    const data = event.data ?? {};
    const time = Number.isFinite(event.time) ? event.time : null;
    if (time !== null) record.updatedAt = Math.max(record.updatedAt ?? 0, time);

    switch (event.type) {
      case "session/title":
        if (typeof data.title === "string" && data.title.trim()) record.title = data.title.trim();
        break;
      case "user/message": {
        const text = humanRequest(data);
        if (!text) break;
        const entry = { time, text: clip(text, REQUEST_LIMIT) };
        // A message typed while a turn runs belongs to that turn; otherwise it
        // opens the next one.
        if (turn && turn.end === null) turn.requests.push(entry);
        else pendingRequests.push(entry);
        break;
      }
      case "turn/start":
        turn = null;
        ensureTurn(data.turn, time);
        record.open = true;
        break;
      case "turn/end": {
        const t = ensureTurn(data.turn, time);
        t.end = time;
        t.endReason = data.reason?.kind ?? null;
        record.open = false;
        break;
      }
      case "assistant/message": {
        const text = blocksText(data.message?.content);
        if (text) ensureTurn(data.turn, time).reply = clip(text, REPLY_LIMIT);
        break;
      }
      case "tool/call": {
        const t = ensureTurn(data.turn, time);
        t.calls += 1;
        const args = parseArgs(data.arguments);
        const name = String(data.name ?? "");
        calls.set(data.callId, t);
        const file = args.file_path ?? args.path ?? args.filePath;
        if (EDIT_TOOLS.test(name) && typeof file === "string" && file) {
          if (!t.files.includes(file) && t.files.length < FILES_PER_TURN) t.files.push(file);
        }
        const command = args.command ?? args.cmd;
        if (SHELL_TOOLS.test(name) && typeof command === "string" && command.trim()) {
          const c = clip(command.split("\n")[0], COMMAND_LIMIT);
          if (!t.commands.includes(c) && t.commands.length < COMMANDS_PER_TURN) t.commands.push(c);
        }
        break;
      }
      case "tool/result": {
        const message = data.message;
        const callId = message?.toolCallId ?? message?.source?.callId;
        const t = calls.get(callId);
        if (!t) break;
        const text = blocksText(message?.content);
        if (message?.isError === true || data.error !== undefined || /\[exit code:\s*-?(?!0\b)\d+\]/i.test(text)) t.failed += 1;
        break;
      }
      case "todo/write":
        if (Array.isArray(data.todos)) {
          record.todos = data.todos
            .filter(x => x && typeof x.content === "string")
            .slice(0, 30)
            .map(x => ({ content: clip(x.content, 200), status: x.status ?? "pending" }));
          record.todosAt = time;
        }
        break;
      default:
        break;
    }
  }
  // Requests typed after the last turn (not yet answered).
  if (pendingRequests.length) {
    record.turns.push({
      n: record.turns.length + 1, start: pendingRequests[0].time, end: null, endReason: null,
      requests: pendingRequests, reply: "", calls: 0, failed: 0, files: [], commands: [],
    });
  }
  record.fallbackTitle = record.turns.flatMap(t => t.requests)[0]?.text.replace(/\s+/g, " ").slice(0, 80) ?? "";
  return record;
}

/** True when a session is something a person did, not a delegated child or a blank. */
export function isPersonal(record) {
  if ((record.depth ?? 0) > 0 || record.origin === "subagent") return false;
  return record.turns.some(t => t.requests.length > 0);
}

function turnTime(t) {
  return t.start ?? t.requests[0]?.time ?? t.end ?? null;
}

/**
 * Restrict a record to the turns that happened in [start, end).
 * Returns null when nothing happened in that window.
 */
export function sliceRecord(record, range, localDate) {
  const turns = record.turns.filter(t => {
    const at = turnTime(t);
    const last = t.end ?? at;
    return at !== null && last !== null && last >= range.start && at < range.end;
  });
  if (!turns.length) return null;
  const files = new Set();
  const commands = [];
  const days = new Map();
  let calls = 0;
  let failed = 0;
  for (const t of turns) {
    calls += t.calls;
    failed += t.failed;
    for (const f of t.files) files.add(f);
    for (const c of t.commands) if (commands.length < 12 && !commands.includes(c)) commands.push(c);
    const day = localDate ? localDate(turnTime(t)) : null;
    if (day) {
      const d = days.get(day) ?? { day, turns: 0, calls: 0 };
      d.turns += 1;
      d.calls += t.calls;
      days.set(day, d);
    }
  }
  return {
    id: record.id,
    title: record.title || record.fallbackTitle,
    untitled: !record.title && !record.fallbackTitle,
    project: record.project,
    cwd: record.cwd,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    firstAt: turnTime(turns[0]),
    lastAt: Math.max(...turns.map(t => t.end ?? turnTime(t))),
    turns: turns.length,
    calls,
    failed,
    files: [...files],
    commands,
    days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
    requests: turns.flatMap(t => t.requests.filter(r => r.time === null || (r.time >= range.start && r.time < range.end))),
    replies: turns.filter(t => t.reply).map(t => ({ time: t.end ?? turnTime(t), text: t.reply })),
    lastReply: turns.findLast(t => t.reply)?.reply ?? "",
    todos: record.todos,
    open: record.open,
    unfinished: turns.at(-1)?.end === null,
    endReason: turns.at(-1)?.endReason ?? null,
  };
}

/** The compact row the records list shows. */
export function recordSummary(slice) {
  const todos = slice.todos ?? [];
  return {
    id: slice.id,
    title: slice.title,
    untitled: slice.untitled,
    project: slice.project,
    cwd: slice.cwd,
    firstAt: slice.firstAt,
    lastAt: slice.lastAt,
    turns: slice.turns,
    calls: slice.calls,
    failed: slice.failed,
    files: slice.files.length,
    gist: (slice.lastReply || slice.requests.at(-1)?.text || "").replace(/\s+/g, " ").slice(0, 220),
    firstRequest: slice.requests[0]?.text.replace(/\s+/g, " ").slice(0, 220) ?? "",
    todosDone: todos.filter(t => t.status === "completed").length,
    todosTotal: todos.length,
    running: !!slice.running,
    unfinished: slice.unfinished,
    endReason: slice.endReason,
    days: slice.days.map(d => d.day),
  };
}

/** Deterministic numbers the digest shows; never left to the model. */
export function rangeStats(slices) {
  const projects = new Set();
  const days = new Set();
  let turns = 0;
  let calls = 0;
  let failed = 0;
  let files = 0;
  for (const s of slices) {
    if (s.project) projects.add(s.project);
    for (const d of s.days) days.add(d.day);
    turns += s.turns;
    calls += s.calls;
    failed += s.failed;
    files += s.files.length;
  }
  return { sessions: slices.length, projects: projects.size, activeDays: days.size, turns, calls, failed, files };
}
