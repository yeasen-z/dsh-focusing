// dsh-focusing — conversation transcript export.
//
// Reads the durable session log and rebuilds the conversation the person would
// recognise: what they asked, what the assistant answered, and which tools ran
// with what result. Nothing here mutates a session or an agent; it is a pure
// read used by the panel's "save as chat log" action.
//
// Kept separate from panel-data.mjs because that fold is incremental and
// metadata-only; an export needs one bounded pass over the whole log.

const RESULT_LIMIT = 4000;
const ARGUMENT_LIMIT = 2000;

/** Flatten message content to plain text, keeping code blocks readable. */
export function blocksToText(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map(block => {
      if (!block || typeof block !== "object") return "";
      if (block.type === "text" && typeof block.text === "string") return block.text;
      if (block.type === "reasoning" && typeof block.text === "string") return "";
      return "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

/** Which user messages are the person's own words, not injected context. */
function humanSources(message) {
  const kind = message?.source?.kind;
  return kind === undefined || kind === "user";
}

const STOP_TEXT = /^(?:Current runtime context[.:]|<system-reminder>)/;

/**
 * Fold raw session events into an ordered transcript.
 *
 * Each turn becomes a group so the export can show boundaries without relying
 * on wall-clock gaps. Tool results are attached to their call by id, which is
 * the only stable join the log offers.
 */
export function buildTranscript(events, options = {}) {
  const limit = Number(options.limit) || 4000;
  const turns = [];
  const byTurn = new Map();
  const pendingCalls = new Map();

  const turnFor = (n) => {
    if (!byTurn.has(n)) {
      const group = { turn: n, messages: [], startedAt: null, endedAt: null, endReason: null };
      byTurn.set(n, group);
      turns.push(group);
    }
    return byTurn.get(n);
  };

  for (const event of events) {
    const data = event?.data ?? {};
    if (event.type === "turn/start") {
      const group = turnFor(data.turn);
      group.startedAt = event.time ?? null;
      continue;
    }
    if (event.type === "turn/end") {
      const group = turnFor(data.turn);
      group.endedAt = event.time ?? null;
      group.endReason = data.reason?.kind ?? null;
      continue;
    }
    if (event.type === "user/message") {
      if (!humanSources(data)) continue;
      const text = blocksToText(data.content);
      if (!text || STOP_TEXT.test(text)) continue;
      const group = turnFor(turns.length ? turns.at(-1).turn : 0);
      group.messages.push({ role: "user", time: event.time ?? null, text });
      continue;
    }
    if (event.type === "assistant/message") {
      const text = blocksToText(data.message?.content);
      if (!text) continue;
      const group = turnFor(data.turn ?? (turns.at(-1)?.turn ?? 0));
      group.messages.push({ role: "assistant", time: event.time ?? null, step: data.step ?? null, text });
      continue;
    }
    if (event.type === "tool/call") {
      const group = turnFor(data.turn ?? (turns.at(-1)?.turn ?? 0));
      const entry = {
        role: "tool",
        callId: data.callId,
        name: data.name,
        time: event.time ?? null,
        step: data.step ?? null,
        arguments: String(data.arguments ?? "").slice(0, ARGUMENT_LIMIT),
        result: "",
        isError: false,
        completedAt: null,
      };
      group.messages.push(entry);
      if (data.callId !== undefined) pendingCalls.set(data.callId, entry);
      continue;
    }
    if (event.type === "tool/result") {
      const message = data.message;
      const callId = message?.toolCallId ?? message?.source?.callId;
      const entry = callId === undefined ? undefined : pendingCalls.get(callId);
      if (!entry) continue;
      pendingCalls.delete(callId);
      const text = blocksToText(message?.content);
      entry.result = (text || data.error?.reason || data.error?.code || "").slice(0, limit);
      entry.isError = message?.isError === true || data.error !== undefined;
      entry.completedAt = event.time ?? null;
      continue;
    }
  }

  return {
    turns: turns.filter(group => group.messages.length),
    totalMessages: turns.reduce((sum, group) => sum + group.messages.length, 0),
  };
}

function inlineCode(text) {
  const trimmed = String(text ?? "");
  const fence = trimmed.includes("```") ? "````" : "```";
  return `${fence}\n${trimmed}\n${fence}`;
}

/** A readable Markdown log: one section per turn, tools folded under the answer. */
export function transcriptToMarkdown(transcript, meta = {}) {
  const lines = [];
  const title = meta.title || meta.session || "Conversation";
  lines.push(`# ${title}`, "");
  const facts = [];
  if (meta.project) facts.push(`**项目**：${meta.project}`);
  if (meta.session) facts.push(`**会话**：\`${meta.session}\``);
  if (meta.exportedAt) facts.push(`**导出时间**：${new Date(meta.exportedAt).toLocaleString()}`);
  if (facts.length) lines.push(facts.join("  \n"), "");
  if (meta.goal) lines.push(`> **当前任务**：${String(meta.goal).split("\n")[0]}`, "");

  for (const group of transcript.turns) {
    lines.push(`## 第 ${group.turn} 轮`, "");
    for (const message of group.messages) {
      if (message.role === "user") {
        lines.push("### 你", "", message.text, "");
      } else if (message.role === "assistant") {
        lines.push("### 助手", "", message.text, "");
      } else {
        const status = message.isError ? "失败" : message.completedAt ? "完成" : "未完成";
        lines.push(`<details><summary>工具调用 · ${message.name} · ${status}</summary>`, "");
        lines.push("参数：", "", inlineCode(message.arguments), "");
        if (message.result) lines.push("结果：", "", inlineCode(message.result), "");
        lines.push("</details>", "");
      }
    }
  }

  if (meta.review) {
    lines.push("---", "", "## 独立复核记录", "");
    lines.push(`结论：${meta.review.stuck ? "有值得注意的地方" : "未发现问题"}`, "");
    if (meta.review.reason) lines.push(meta.review.reason, "");
  }
  if (meta.signals?.length) {
    lines.push("", "## 观察到的线索", "");
    for (const signal of meta.signals) lines.push(`- ${signal.label || signal.kind} ×${signal.count ?? 1}`);
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
