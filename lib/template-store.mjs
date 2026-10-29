// Templates for the digest generator: what to ask for, and which range to
// cover. Three are built in and cannot be edited; the person can add their own.
// A template holds only words and a range -- nothing about models or data -- so
// generating from one is the same code path as generating from typed text.

import fs from "node:fs/promises";
import path from "node:path";
import { RANGE_KEYS } from "./time-range.mjs";

const LIMIT = 50;
const NAME_LIMIT = 40;
const INSTRUCTION_LIMIT = 2000;

/** The shipped set. `needsSession` ones are started from a record, not here. */
export const BUILTIN_TEMPLATES = [
  {
    id: "builtin:weekly",
    name: "周报",
    nameEn: "Weekly",
    instruction: "整理我这周干了什么，进度如何",
    instructionEn: "Summarize what I did this week and how far along it is",
    range: "this-week",
    builtin: true,
  },
  {
    id: "builtin:daily",
    name: "日报",
    nameEn: "Daily",
    instruction: "总结今天各会话的进展",
    instructionEn: "What progress did each session make today?",
    range: "today",
    builtin: true,
  },
  {
    id: "builtin:handoff",
    name: "会话交接",
    nameEn: "Handoff",
    instruction: "把「{title}」的上下文整理成交接文档：目标、当前状态、关键文件、未解决问题和下一步",
    instructionEn: 'Write handoff notes for "{title}": goal, current state, key files, open problems and next steps',
    range: "session",
    builtin: true,
    needsSession: true,
  },
];

/** The words of a template in the page's language, without the id/range noise. */
export function templateText(template, locale = "zh") {
  if (!template) return "";
  return (locale === "en" ? template.instructionEn : template.instruction) || template.instruction || "";
}

export function templateName(template, locale = "zh") {
  if (!template) return "";
  return (locale === "en" ? template.nameEn : template.name) || template.name || "";
}

/** A submitted template, validated and trimmed, or a reason it was refused. */
export function normalizeTemplate(input) {
  if (!input || typeof input !== "object") return { ok: false, reason: "bad-request", detail: "template is missing" };
  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
  const instruction = typeof input.instruction === "string" ? input.instruction.trim() : "";
  if (!name) return { ok: false, reason: "bad-request", detail: "name is empty" };
  if (name.length > NAME_LIMIT) return { ok: false, reason: "bad-request", detail: `name is longer than ${NAME_LIMIT}` };
  if (!instruction) return { ok: false, reason: "bad-request", detail: "instruction is empty" };
  if (instruction.length > INSTRUCTION_LIMIT) return { ok: false, reason: "bad-request", detail: `instruction is longer than ${INSTRUCTION_LIMIT}` };
  const range = input.range === "" || input.range == null ? "" : RANGE_KEYS.includes(input.range) ? input.range : undefined;
  if (range === undefined) return { ok: false, reason: "bad-request", detail: "unknown range" };
  return { ok: true, template: { name, instruction, range } };
}

export function createTemplateStore({ file, logger } = {}) {
  let items = [];
  let loaded = false;
  let writing = Promise.resolve();

  async function load() {
    if (loaded) return items;
    loaded = true;
    if (!file) return items;
    try {
      const parsed = JSON.parse(await fs.readFile(file, "utf8"));
      if (Array.isArray(parsed?.templates)) {
        items = parsed.templates.filter(t => t && typeof t.id === "string" && typeof t.name === "string");
      }
    } catch (error) {
      if (error?.code !== "ENOENT") logger?.("focusing: could not read templates", error);
    }
    return items;
  }

  function persist() {
    if (!file) return Promise.resolve();
    const body = JSON.stringify({ version: 1, templates: items }, null, 1);
    writing = writing.then(async () => {
      try {
        await fs.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        await fs.writeFile(tmp, body, "utf8");
        await fs.rename(tmp, file);
      } catch (error) {
        logger?.("focusing: could not write templates", error);
      }
    });
    return writing;
  }

  return {
    load,
    /** Built-ins first, then the person's own; newest last. */
    async list() {
      await load();
      return [...BUILTIN_TEMPLATES, ...items];
    },
    async get(id) {
      if (BUILTIN_TEMPLATES.some(t => t.id === id)) return BUILTIN_TEMPLATES.find(t => t.id === id);
      await load();
      return items.find(t => t.id === id);
    },
    async create(input) {
      const { ok, template, ...rest } = normalizeTemplate(input);
      if (!ok) return { ok, ...rest };
      await load();
      const now = Date.now();
      const saved = { ...template, id: `tpl-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`, createdAt: now, updatedAt: now };
      items = [...items, saved].slice(-LIMIT);
      await persist();
      return { ok: true, template: saved };
    },
    async update(id, input) {
      await load();
      if (BUILTIN_TEMPLATES.some(t => t.id === id)) return { ok: false, reason: "read-only", detail: "built-in templates cannot be edited" };
      const { ok, template, ...rest } = normalizeTemplate(input);
      if (!ok) return { ok, ...rest };
      const at = items.findIndex(t => t.id === id);
      if (at < 0) return { ok: false, reason: "not-found" };
      const saved = { ...items[at], ...template, updatedAt: Date.now() };
      items = items.map((t, i) => (i === at ? saved : t));
      await persist();
      return { ok: true, template: saved };
    },
    async remove(id) {
      if (BUILTIN_TEMPLATES.some(t => t.id === id)) return { ok: false, reason: "read-only", detail: "built-in templates cannot be deleted" };
      await load();
      const before = items.length;
      items = items.filter(t => t.id !== id);
      if (items.length !== before) await persist();
      return { ok: items.length !== before, reason: items.length === before ? "not-found" : undefined };
    },
  };
}
