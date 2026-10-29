// Read-only, incremental panel metadata. Separate from intervention state:
// opening or polling the panel must never change the agent's decisions.
const ACTIVITY_LIMIT = Infinity;
const ARGUMENT_LIMIT = 8000;

export function textContent(content) {
  if (typeof content === "string") return content.trim();
  return Array.isArray(content)
    ? content.filter(b => b?.type === "text" && typeof b.text === "string").map(b => b.text).join("\n").trim()
    : "";
}

export function humanText(message) {
  if (message?.source?.kind !== undefined && message.source.kind !== "user") return "";
  const text = textContent(message?.content);
  return /^(?:Current runtime context[.:]|<system-reminder>)/.test(text) ? "" : text;
}

export function projectName(cwd) {
  if (typeof cwd !== "string" || !cwd) return "";
  const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.split("/").filter(Boolean).at(-1) || "/";
}

export function createPanelMetadata(id, header = {}) {
  return {
    id, cwd: header.cwd ?? "", project: projectName(header.cwd),
    title: "", fallbackTitle: "", startedConversation: false, updatedAt: header.createdAt ?? null,
    status: "idle", turn: null, turnStartedAt: null, turnEndedAt: null,
    turnEndReason: null, turnSteps: 0, toolCalls: 0, totalToolCalls: 0, goal: null,
    pendingGoal: null, activity: [],
  };
}

function argumentsOf(raw) {
  if (typeof raw !== "string") return raw && typeof raw === "object" ? raw : {};
  if (raw.length > ARGUMENT_LIMIT) return { __excerpt: raw.slice(0, ARGUMENT_LIMIT), __truncated: true };
  try { return JSON.parse(raw); } catch { return { __unparsed: raw }; }
}

/** Fold one durable event; mutates only this panel-owned derived cache. */
function pushActivity(state, item) {
  state.activity.push(item);
  if (state.activity.length > ACTIVITY_LIMIT) state.activity.splice(0, state.activity.length - ACTIVITY_LIMIT);
}

export function foldPanelEvent(state, event) {
  const data = event.data ?? {};
  if (Number.isFinite(event.time)) state.updatedAt = Math.max(state.updatedAt ?? 0, event.time);
  if (event.type === "session/title") {
    if (typeof data.title === "string" && data.title.trim()) state.title = data.title.trim();
  } else if (event.type === "user/message") {
    const text = humanText(data);
    if (text) {
      state.startedConversation = true;
      if (!state.fallbackTitle) state.fallbackTitle = text.replace(/\s+/g, " ").slice(0, 100);
      if (state.status === "running") state.goal ??= text.slice(0, 3000);
      else state.pendingGoal ??= text.slice(0, 3000);
      pushActivity(state, { kind: "message", role: "user", text, time: event.time ?? null, turn: state.turn, status: "done", failed: false });
    }
  } else if (event.type === "assistant/message") {
    const text = textContent(data.message?.content);
    if (text) pushActivity(state, { kind: "message", role: "assistant", text, time: event.time ?? null, turn: state.turn, status: "done", failed: false });
  } else if (event.type === "turn/start") {
    state.turn = data.turn;
    state.status = "running";
    state.turnStartedAt = event.time ?? null;
    state.turnEndedAt = null;
    state.turnEndReason = null;
    state.turnSteps = 0;
    state.toolCalls = 0;
    state.goal = state.pendingGoal;
    state.pendingGoal = null;
  } else if (event.type === "turn/end" && (state.turn === null || data.turn === state.turn)) {
    state.status = "idle";
    state.turn = data.turn;
    state.turnEndedAt = event.time ?? null;
    state.turnEndReason = data.reason ?? null;
    for (const item of state.activity) {
      if (item.turn === data.turn && item.status === "running") item.status = "incomplete";
    }
  } else if (event.type === "step/start") {
    if (data.turn === state.turn) state.turnSteps += 1;
  } else if (event.type === "tool/call") {
    state.totalToolCalls += 1; // whole session; toolCalls below is this turn only
    if (data.turn === state.turn) state.toolCalls += 1;
    const args = argumentsOf(data.arguments);
    const object = args && typeof args === "object" ? args : {};
    pushActivity(state, {
      id: data.callId, callId: data.callId, name: data.name, tool: data.name,
      arguments: args, args, rawArguments: typeof data.arguments === "string" ? data.arguments.slice(0, ARGUMENT_LIMIT) : undefined,
      description: typeof object.description === "string" ? object.description : "",
      cmd: object.command ?? object.cmd ?? object.script,
      file: object.file_path ?? object.path ?? object.filePath,
      time: event.time ?? null, at: event.time ?? null, turn: data.turn, step: data.step,
      status: "running", failed: false, result: "", resultExcerpt: "",
    });
  } else if (event.type === "tool/result") {
    const message = data.message;
    const callId = message?.toolCallId ?? message?.source?.callId;
    const item = state.activity.findLast(a => a.callId === callId);
    if (item) {
      const text = textContent(message?.content);
      const failed = message?.isError === true || data.error !== undefined ||
        /\[exit code:\s*-?(?!0\b)\d+\]/i.test(text);
      item.status = failed ? "failed" : "success";
      item.failed = failed;
      item.completedAt = event.time ?? null;
      // Kept whole: the panel decides what to show, and the analysis trace needs it.
      item.result = item.resultExcerpt = text || data.error?.reason || data.error?.code || "";
      if (data.error !== undefined) item.error = data.error;
    }
  }
  return state;
}

/**
 * Resolve the name a person would recognize for a session.
 *
 * Order: the Host's title service, then the title event in the log, then the
 * first thing the person actually typed. There is deliberately NO hard-coded
 * English fallback here — an unnamed session returns "" and the caller shows a
 * localized label, so the panel never displays a placeholder the person cannot
 * read or map back to a chat.
 */
export function sessionTitle(state, titleSnapshot) {
  const candidates = [titleSnapshot?.title, state?.title, state?.fallbackTitle];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

export function sessionMetadata(state, titleSnapshot) {
  return {
    id: state.id,
    title: sessionTitle(state, titleSnapshot),
    // True when no name exists yet, so the UI can label it in the user's language.
    untitled: !sessionTitle(state, titleSnapshot),
    project: state.project, cwd: state.cwd, status: state.status, updatedAt: state.updatedAt,
  };
}

/**
 * A session earns a place in the roster only when there is something to show:
 * a name, or at least one thing the person typed. Agent registrations without a
 * stored session are shells — listing them is what produced a wall of
 * "Untitled session" rows.
 */
export function isListable(meta) {
  return !!(meta.title || meta.fallbackTitle || meta.startedConversation);
}

/** Session identity + seq cursors prevent full rescans on each panel poll. */
export function createPanelDataCache() {
  const entries = new Map();
  return {
    read(session) {
      let entry = entries.get(session.id);
      const end = Number(session.seq);
      if (!entry || entry.session !== session || end < entry.cursor) {
        entry = { session, cursor: 0, state: createPanelMetadata(session.id, session.header) };
        entries.set(session.id, entry);
      }
      if (end > entry.cursor) {
        const events = session.snapshotEvents(entry.cursor, end);
        for (const event of events) foldPanelEvent(entry.state, event);
        entry.cursor = end;
      }
      return entry.state;
    },
    retain(ids) {
      const keep = new Set(ids);
      for (const id of entries.keys()) if (!keep.has(id)) entries.delete(id);
    },
  };
}
