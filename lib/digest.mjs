// Digests: turn a time-sliced set of context records into the page the person
// asked for ("整理我这周干了什么，进度如何").
//
// Split of responsibility:
//   - numbers (sessions, calls, active days) and the per-day activity index are
//     computed here, deterministically, and never left to the model;
//   - the narrative — summary, per-project progress, risks, next steps — comes
//     from the model, constrained to a JSON contract this module parses;
//   - when no model answers, `draftDigest` produces a usable structural draft
//     from the same facts, so the page is never empty.

import { rangeStats } from "./context-records.mjs";

const CONTEXT_BUDGET = 48000;

export const DIGEST_SYSTEM = `You organize a developer's work context. You receive records of their coding-agent sessions in a time range (what they asked, what the agent replied at the end of each turn, files edited, commands run, todo lists) and a request from them.

Rules:
- Use only the records. Never invent work, files, numbers or dates that are not there.
- Group by project (the "project" field) unless the request asks otherwise.
- Progress is a judgment from the records: done when the last reply says finished/verified and nothing is open; estimate a percent only when the records support it, else null.
- A risk is something the records show as failing, blocked, unverified or explicitly left open.
- Write in the language of the request. Be concise and concrete; cite session ids in "sessions".

Answer with ONE JSON object and nothing else:
{
  "title": "short title for this result",
  "summary": "2-4 sentences: the main line of work, what got done, what is open",
  "projects": [
    { "name": "project", "progress": 0-100 or null, "status": "done" | "active" | "blocked" | "paused",
      "headline": "one line",
      "items": [ { "state": "done" | "doing" | "risk", "text": "concrete item", "sessions": ["id"] } ] }
  ],
  "days": [ { "day": "YYYY-MM-DD", "items": [ { "text": "what happened", "project": "project" } ] } ],
  "next": [ "concrete next step" ],
  "sections": [ { "title": "extra section the request needs (e.g. handoff notes)", "body": "markdown" } ]
}
Omit "days" when the range is a single day. Use "sections" only when the request needs content the other fields cannot hold.`;

export const FOLLOWUP_SYSTEM = `You answer follow-up questions about a developer's work, using only the digest and session records provided. Do not invent facts. Answer in the language of the question, concisely, in markdown. Cite session titles when useful.`;

function clip(text, limit) {
  const s = String(text ?? "").trim();
  return s.length > limit ? `${s.slice(0, limit)}…` : s;
}

function shortPath(file, cwd) {
  if (cwd && file.startsWith(cwd)) return file.slice(cwd.length).replace(/^\/+/, "") || file;
  return file;
}

/** One session block for the prompt, at a given detail level (0 = full). */
function renderSlice(slice, level) {
  const reqLimit = [500, 240, 120][level];
  const replyLimit = [800, 360, 160][level];
  const lines = [
    `## session ${slice.id}`,
    `title: ${slice.title || "(untitled)"}`,
    `project: ${slice.project || "(none)"}`,
    `active: ${slice.days.map(d => d.day).join(", ")} · ${slice.turns} turns · ${slice.calls} tool calls${slice.failed ? ` (${slice.failed} failed)` : ""}${slice.unfinished ? " · last turn unfinished" : ""}`,
  ];
  const requests = level === 2 ? slice.requests.slice(-3) : slice.requests.slice(-8);
  if (requests.length) {
    lines.push("asked:");
    for (const r of requests) lines.push(`- ${clip(r.text.replace(/\s+/g, " "), reqLimit)}`);
  }
  const replies = level === 0 ? slice.replies.slice(-3) : slice.replies.slice(-1);
  if (replies.length) {
    lines.push("agent reported:");
    for (const r of replies) lines.push(`> ${clip(r.text.replace(/\s+/g, " "), replyLimit)}`);
  }
  if (slice.files.length) {
    const files = slice.files.slice(0, level === 0 ? 20 : 8).map(f => shortPath(f, slice.cwd));
    lines.push(`files edited (${slice.files.length}): ${files.join(", ")}`);
  }
  if (level === 0 && slice.commands.length) lines.push(`commands: ${slice.commands.slice(0, 6).join(" | ")}`);
  if (slice.todos?.length && level < 2) {
    lines.push("todo list:");
    for (const t of slice.todos.slice(0, 12)) lines.push(`- [${t.status}] ${clip(t.content, 140)}`);
  }
  return lines.join("\n");
}

/**
 * Pack records into the prompt budget: newest sessions get full detail, older
 * ones are condensed, and the rest are listed by title only.
 */
export function buildContextBlock(slices, budget = CONTEXT_BUDGET) {
  const ordered = [...slices].sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0));
  const blocks = [];
  let used = 0;
  const omitted = [];
  for (const slice of ordered) {
    let placed = false;
    for (const level of [0, 1, 2]) {
      const text = renderSlice(slice, level);
      if (used + text.length <= budget) {
        blocks.push(text);
        used += text.length + 2;
        placed = true;
        break;
      }
    }
    if (!placed) omitted.push(slice);
  }
  if (omitted.length) {
    blocks.push(`## ${omitted.length} more sessions (titles only)\n${omitted.map(s => `- ${s.id} · ${s.project} · ${clip(s.title, 80)}`).join("\n")}`);
  }
  return { text: blocks.join("\n\n"), included: ordered.length - omitted.length, omitted: omitted.length };
}

export function buildDigestPrompt({ request, range, slices }) {
  const stats = rangeStats(slices);
  const { text } = buildContextBlock(slices);
  return [
    `REQUEST: ${request}`,
    `RANGE: ${range.label} (${range.from} – ${range.to})`,
    `FACTS: ${stats.sessions} sessions, ${stats.projects} projects, ${stats.activeDays} active days, ${stats.turns} turns, ${stats.calls} tool calls.`,
    "",
    "RECORDS (newest first):",
    text || "(no sessions in this range)",
  ].join("\n");
}

/** Extract the first balanced JSON object from model text. */
export function extractJson(text) {
  const raw = String(text ?? "");
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidates = [fenced?.[1], raw];
  for (const source of candidates) {
    if (!source) continue;
    const start = source.indexOf("{");
    if (start < 0) continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < source.length; i++) {
      const c = source[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        try { return JSON.parse(source.slice(start, i + 1)); } catch { break; }
      }
    }
  }
  return undefined;
}

const STATES = new Set(["done", "doing", "risk"]);
const STATUSES = new Set(["done", "active", "blocked", "paused"]);
const asText = (v, limit = 2000) => (typeof v === "string" ? clip(v, limit) : "");
const asList = v => (Array.isArray(v) ? v : []);

/** Validate the model's JSON into the shape the page renders. */
export function normalizeDigest(input, knownIds = new Set()) {
  const value = input && typeof input === "object" ? input : {};
  const progress = v => {
    const n = Number(v);
    return v === null || v === undefined || v === "" || !Number.isFinite(n) ? null : Math.max(0, Math.min(100, Math.round(n)));
  };
  return {
    title: asText(value.title, 120),
    summary: asText(value.summary, 3000),
    projects: asList(value.projects).slice(0, 20).map(p => ({
      name: asText(p?.name, 120) || "—",
      progress: progress(p?.progress),
      status: STATUSES.has(p?.status) ? p.status : "active",
      headline: asText(p?.headline, 300),
      items: asList(p?.items).slice(0, 30).map(item => ({
        state: STATES.has(item?.state) ? item.state : "doing",
        text: asText(item?.text, 500),
        sessions: asList(item?.sessions).filter(id => typeof id === "string" && (!knownIds.size || knownIds.has(id))).slice(0, 6),
      })).filter(item => item.text),
    })),
    days: asList(value.days).slice(0, 62).map(d => ({
      day: asText(d?.day, 20),
      items: asList(d?.items).slice(0, 20).map(item => ({ text: asText(item?.text, 400), project: asText(item?.project, 120) })).filter(i => i.text),
    })).filter(d => d.day && d.items.length),
    next: asList(value.next).map(n => asText(n, 400)).filter(Boolean).slice(0, 12),
    sections: asList(value.sections).slice(0, 8).map(s => ({ title: asText(s?.title, 120), body: asText(s?.body, 8000) })).filter(s => s.body),
  };
}

/** A structural digest from the facts alone, used when no model answers. */
export function draftDigest({ range, slices, locale = "zh" }) {
  const zh = locale !== "en";
  const byProject = new Map();
  for (const s of slices) {
    const key = s.project || (zh ? "未指定项目" : "No project");
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key).push(s);
  }
  const projects = [...byProject.entries()]
    .sort((a, b) => b[1].reduce((n, s) => n + s.calls, 0) - a[1].reduce((n, s) => n + s.calls, 0))
    .map(([name, list]) => ({
      name,
      progress: null,
      status: list.some(s => s.running || s.unfinished) ? "active" : "paused",
      headline: zh ? `${list.length} 个会话 · ${list.reduce((n, s) => n + s.calls, 0)} 次工具调用` : `${list.length} sessions · ${list.reduce((n, s) => n + s.calls, 0)} tool calls`,
      items: list.map(s => ({
        state: s.running || s.unfinished ? "doing" : s.failed > 0 && s.endReason === "error" ? "risk" : "done",
        text: s.title || s.requests[0]?.text.slice(0, 120) || s.id,
        sessions: [s.id],
      })),
    }));
  const dayMap = new Map();
  for (const s of slices) {
    for (const d of s.days) {
      if (!dayMap.has(d.day)) dayMap.set(d.day, []);
      dayMap.get(d.day).push({ text: s.title || s.id, project: s.project });
    }
  }
  const stats = rangeStats(slices);
  return {
    title: zh ? `${range.label}工作整理` : `${range.label} — work digest`,
    summary: zh
      ? `${range.label}共有 ${stats.sessions} 个会话，涉及 ${stats.projects} 个项目，活跃 ${stats.activeDays} 天。这是根据会话记录直接生成的结构草稿，未经模型归纳。`
      : `${stats.sessions} sessions across ${stats.projects} projects over ${stats.activeDays} active days. This is a structural draft from the records, not a model summary.`,
    projects,
    days: [...dayMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, items]) => ({ day, items })),
    next: [],
    sections: [],
  };
}

export function buildFollowupPrompt({ question, digest, slices, history = [] }) {
  const { text } = buildContextBlock(slices, 30000);
  const lines = [
    "DIGEST:",
    JSON.stringify({ title: digest.title, summary: digest.summary, projects: digest.projects, next: digest.next }, null, 1).slice(0, 12000),
    "",
    "RECORDS:",
    text,
  ];
  if (history.length) {
    lines.push("", "EARLIER QUESTIONS:");
    for (const h of history.slice(-4)) lines.push(`Q: ${h.q}`, `A: ${clip(h.a, 800)}`);
  }
  lines.push("", `QUESTION: ${question}`);
  return lines.join("\n");
}

/** Markdown export of a digest. */
export function digestToMarkdown(digest) {
  const r = digest.result;
  const mark = { done: "✅", doing: "🔄", risk: "⚠️" };
  const out = [`# ${r.title || digest.request}`, "", `> ${digest.request}`, `> ${digest.range.label}（${digest.range.from} – ${digest.range.to}）`, ""];
  if (r.summary) out.push(r.summary, "");
  const s = digest.stats;
  out.push(`会话 ${s.sessions} · 项目 ${s.projects} · 活跃 ${s.activeDays} 天 · 工具调用 ${s.calls}`, "");
  if (r.projects.length) {
    out.push("## 按项目");
    for (const p of r.projects) {
      out.push("", `### ${p.name}${p.progress === null ? "" : ` · ${p.progress}%`}`);
      if (p.headline) out.push(p.headline);
      for (const item of p.items) out.push(`- ${mark[item.state] ?? "-"} ${item.text}`);
    }
    out.push("");
  }
  if (r.days.length) {
    out.push("## 按天");
    for (const d of r.days) {
      out.push("", `**${d.day}**`);
      for (const item of d.items) out.push(`- ${item.text}${item.project ? ` · ${item.project}` : ""}`);
    }
    out.push("");
  }
  if (r.next.length) {
    out.push("## 下一步");
    for (const n of r.next) out.push(`- ${n}`);
    out.push("");
  }
  for (const section of r.sections) out.push(`## ${section.title}`, "", section.body, "");
  for (const f of digest.followups ?? []) out.push(`---`, "", `**问：** ${f.q}`, "", f.a, "");
  return out.join("\n");
}
