// Collaboration rooms: a NEW, Focusing-owned conversation built from frozen
// snapshots of existing sessions.
//
// Guarantees, by construction:
//   - Source sessions are only READ. A snapshot is a copy taken at one log
//     offset (`seq`, exclusive end); nothing is ever written back to them.
//   - The room is its own record (rooms.json). Participants speak only when
//     the person asks for a turn; nothing runs on a timer.
//   - Handing a room off to a new DSH session puts a draft in the composer;
//     the person reviews and sends it themselves.
//
// This file is pure: prompt construction, snapshot rendering, normalisation.

import { foldRecord } from "./context-records.mjs";

export const MAX_SOURCES = 4;
export const MAX_MESSAGES = 60;
export const SNAPSHOT_BUDGET = 14000;
const LABELS = ["A", "B", "C", "D"];

const clip = (text, limit) => {
  const s = String(text ?? "");
  return s.length > limit ? `${s.slice(0, limit - 1)}…` : s;
};
const shortPath = (file, cwd) => (cwd && file.startsWith(cwd) ? file.slice(cwd.length).replace(/^\/+/, "") || file : file);

/**
 * Freeze one session into a snapshot. `events` is the full log; `endSeq` is
 * the exclusive log offset the copy was taken at (used later to tell what the
 * source did after the snapshot).
 */
export function takeSnapshot({ id, header = {}, events, endSeq, title, takenAt = Date.now() }) {
  const record = foldRecord(events, { ...header, id });
  const turns = record.turns;
  const requests = turns.flatMap(t => t.requests);
  const files = [...new Set(turns.flatMap(t => t.files))];
  const commands = [...new Set(turns.flatMap(t => t.commands))];
  const replies = turns.filter(t => t.reply).map(t => ({ turn: t.n, at: t.end ?? t.start, text: t.reply }));
  return {
    session: id,
    title: title || record.title || record.fallbackTitle || "",
    project: record.project,
    cwd: record.cwd,
    takenAt,
    seq: Number.isFinite(endSeq) ? endSeq : null,
    lastEventAt: record.updatedAt ?? null,
    turns: turns.length,
    calls: turns.reduce((n, t) => n + t.calls, 0),
    failed: turns.reduce((n, t) => n + t.failed, 0),
    requests: requests.slice(-12).map(r => ({ at: r.time, text: clip(r.text, 1200) })),
    firstRequest: requests[0] ? clip(requests[0].text, 1200) : "",
    replies: replies.slice(-4).map(r => ({ ...r, text: clip(r.text, 3000) })),
    files: files.slice(0, 60),
    commands: commands.slice(-15),
    todos: record.todos,
    unfinished: !!turns.at(-1) && turns.at(-1).end === null,
  };
}

/** Plain-text rendering of a snapshot, packed into `budget` characters. */
export function renderSnapshot(snap, budget = SNAPSHOT_BUDGET) {
  const head = [
    `Session: ${snap.title || snap.session}`,
    `Project: ${snap.project || "-"}${snap.cwd ? ` (${snap.cwd})` : ""}`,
    `Frozen at: ${new Date(snap.takenAt).toISOString()} · ${snap.turns} turns · ${snap.calls} tool calls${snap.failed ? ` (${snap.failed} failed)` : ""}${snap.unfinished ? " · last turn unfinished" : ""}`,
  ];
  const parts = [];
  if (snap.firstRequest) parts.push(`Original request:\n${snap.firstRequest}`);
  const later = snap.requests.slice(snap.requests[0]?.text === snap.firstRequest ? 1 : 0);
  if (later.length) parts.push(`Later requests (oldest first):\n${later.map(r => `- ${r.text.replace(/\s+/g, " ")}`).join("\n")}`);
  if (snap.todos?.length) parts.push(`Todo list:\n${snap.todos.map(t => `- [${t.status}] ${t.content}`).join("\n")}`);
  if (snap.files.length) parts.push(`Files edited (${snap.files.length}): ${snap.files.map(f => shortPath(f, snap.cwd)).join(", ")}`);
  if (snap.commands.length) parts.push(`Recent commands: ${snap.commands.join(" | ")}`);
  // Replies are the most informative and the largest; newest first so a tight
  // budget keeps the latest state.
  const replies = [...snap.replies].reverse().map(r => `Agent reported (turn ${r.turn}):\n${r.text}`);
  let text = head.join("\n");
  for (const part of [...parts, ...replies]) {
    const room = budget - text.length - 2;
    if (room <= 200) break;
    text += `\n\n${part.length > room ? `${part.slice(0, room - 1)}…` : part}`;
  }
  return text;
}

export function participantLabel(index) {
  return LABELS[index] ?? String(index + 1);
}

/** Who speaks next when the person just says "next". */
export function nextSpeaker(room) {
  const count = room.participants.length;
  if (!count) return -1;
  const last = [...room.messages].reverse().find(m => m.role === "participant");
  return last ? (last.speaker + 1) % count : 0;
}

export const ROOM_SYSTEM = `You are one participant in a shared working room. Each participant was given a frozen snapshot of a DIFFERENT coding-agent session, so each knows things the others do not. A human moderates.

Rules:
- Speak from your own snapshot. When you rely on it, say so ("in my session, ..."). Do not invent facts that are in neither your snapshot nor the conversation.
- Engage with what the others said: confirm, correct, or ask a specific question. Point out conflicts (interfaces, assumptions, file ownership) and dependencies.
- Prefer concrete items: file paths, function names, decisions, open problems.
- Be concise: at most ~250 words unless the human asks for more.
- Reply in the language the human uses in the room (default: the language of your snapshot).
- Write only your message, without a name prefix.`;

/** System + user prompt for one participant's turn. */
export function buildTurnPrompt(room, speaker) {
  const me = room.participants[speaker];
  const others = room.participants.filter((_, i) => i !== speaker)
    .map(p => `- ${p.label}: ${p.title || p.session}${p.project ? ` (${p.project})` : ""}`).join("\n");
  const transcript = room.messages.slice(-30).map(m => {
    if (m.role === "user") return `[Human]: ${m.text}`;
    const who = room.participants[m.speaker];
    return `[${who?.label ?? "?"}${m.speaker === speaker ? " (you)" : ""}]: ${m.text}`;
  }).join("\n\n");
  const user = [
    `You are participant ${me.label}.`,
    room.topic ? `ROOM TOPIC: ${room.topic}` : "ROOM TOPIC: (none given) Compare your contexts and agree on how the work fits together.",
    `OTHER PARTICIPANTS:\n${others || "(none)"}`,
    `YOUR SNAPSHOT:\n${renderSnapshot(me.snapshot)}`,
    `CONVERSATION SO FAR:\n${transcript || "(empty — you speak first: introduce what your session did and what the others should know)"}`,
    `Now write your next message as ${me.label}.`,
  ].join("\n\n");
  return { system: ROOM_SYSTEM, user };
}

export const HANDOFF_SYSTEM = `You write a handoff brief that will be pasted as the FIRST message of a new coding-agent session. The new agent has none of the earlier context. Use only the material provided. Structure in markdown:
## Goal
## What each earlier session did (one subsection per session, with key files and decisions)
## Agreed points / open conflicts (from the room conversation, if any)
## Next steps (numbered, concrete)
## Do not
Be specific and compact. Write in the language of the material. Output only the brief.`;

export function buildHandoffPrompt(room) {
  const transcript = room.messages.map(m => (m.role === "user"
    ? `[Human]: ${m.text}`
    : `[${room.participants[m.speaker]?.label ?? "?"}]: ${m.text}`)).join("\n\n");
  return [
    room.topic ? `PURPOSE: ${room.topic}` : "PURPOSE: continue the combined work of these sessions.",
    ...room.participants.map(p => `SNAPSHOT ${p.label}:\n${renderSnapshot(p.snapshot, 10000)}`),
    transcript ? `ROOM CONVERSATION:\n${transcript}` : "",
  ].filter(Boolean).join("\n\n");
}

/** A handoff brief that needs no model: the snapshots and the conversation, as is. */
export function draftHandoff(room, locale = "zh") {
  const zh = locale !== "en";
  const lines = [
    zh ? "# 交接简报" : "# Handoff brief",
    "",
    zh
      ? `以下是 ${room.participants.length} 个会话在 ${new Date(room.createdAt).toLocaleString("zh-CN")} 冻结的快照${room.messages.length ? "和协作室里的讨论" : ""}。原会话没有被修改。`
      : `Frozen snapshots of ${room.participants.length} sessions${room.messages.length ? " plus the room discussion" : ""}. The original sessions were not modified.`,
  ];
  if (room.topic) lines.push("", zh ? `**目的**：${room.topic}` : `**Purpose**: ${room.topic}`);
  for (const p of room.participants) {
    lines.push("", `## ${p.label} · ${p.title || p.session}`, "", "```text", renderSnapshot(p.snapshot, 6000), "```");
  }
  if (room.messages.length) {
    lines.push("", zh ? "## 讨论" : "## Discussion");
    for (const m of room.messages) {
      const who = m.role === "user" ? (zh ? "我" : "Me") : room.participants[m.speaker]?.label ?? "?";
      lines.push("", `**${who}**：${m.text}`);
    }
  }
  lines.push("", zh ? "请先复述你理解的目标和下一步，再开始动手。" : "First restate the goal and next steps as you understand them, then start.");
  return lines.join("\n");
}

/** Shape a stored room for the list view. */
export function roomSummary(room) {
  return {
    id: room.id,
    title: room.title,
    topic: room.topic,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    participants: room.participants.map(p => ({ label: p.label, title: p.title, project: p.project, session: p.session })),
    messages: room.messages.length,
    pending: room.pending ?? null,
    handoff: room.handoff ? { at: room.handoff.at, openedAt: room.handoff.openedAt ?? null } : null,
  };
}

export function roomTitle(participants, topic) {
  if (topic) return clip(topic.replace(/\s+/g, " "), 60);
  return clip(participants.map(p => p.title || p.session.slice(0, 8)).join(" × "), 60);
}
