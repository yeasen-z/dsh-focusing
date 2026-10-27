// dsh-focusing — office-mode signal detection.
//
// The plugin is not a loop detector. It watches an agent doing office work and
// notices four kinds of small, expensive mistakes that are easy to make from
// inside a long session and obvious from outside:
//
//   1. loop        repeating the same edit or the same failing command
//   2. drift       the turn has moved away from, or already satisfied, the ask
//   3. misuse      writing to a file it never read / that changed under it
//   4. priority    spending steps on side quests before the actual deliverable
//
// All four are reduced here to deterministic observations over durable events.
// `lib/index.mjs` decides what to do about them; this file only knows what is
// true. Keeping the judgement out of here is what lets the same module be
// replayed against a real session log (tools/replay.mjs).
//
// Dependency-free on purpose: no DSH imports, so it runs and is tested outside
// the Host process.

export { hash32, fingerprintCall } from "./detector.mjs";
import { LoopDetector, fingerprintCall, hash32 } from "./detector.mjs";

/** FNV-1a over normalized text; used to recognise "the same" ask again. */
const norm = text => String(text ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Split an ask into the concrete deliverables it mentions.
 *
 * Deliberately dumb and conservative: it looks for artifact-shaped nouns and
 * verb+object phrases in both languages the user actually writes in. A missed
 * deliverable means one fewer thing to check; a false one means noise in the
 * panel. Neither is dangerous, which is why this stays a heuristic and never
 * blocks anything on its own.
 */
export function extractDeliverables(text) {
  const clean = String(text ?? "");
  const out = new Set();
  const patterns = [
    // An explicit filename anywhere: report.md, data.csv, src/app.ts
    /\b[\w][\w./-]*\.(?:pptx?|docx?|xlsx?|csv|pdf|md|html|ts|tsx|js|mjs|py|json)\b/gi,
    // A named artifact type, with whatever short noun runs into it:
    // "周报 PPT", "财务 表格", "季度 报告", "演示文稿"
    /[\u4e00-\u9fa5]{0,6}(?:PPT|ppt|幻灯片|演示文稿|文档|表格|报告|方案|纪要)(?![\u4e00-\u9fa5]{2,})/g,
    // English artifact words
    /\b(?:deck|slides?|report|spreadsheet|memo|document)\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of clean.matchAll(pattern)) {
      const value = String(match[0]).trim();
      if (!value) continue;
      // A bare "文档" with no distinguishing noun is too generic to check against.
      if (/^(?:文档|表格|报告|方案|纪要)$/.test(value)) continue;
      if (value.length > 24) continue;
      out.add(value);
    }
  }
  // Keep the longest form of an overlapping family ("报告" vs "季度财务报告") and
  // drop the short one: only the most specific name is worth checking later.
  const list = [...out];
  return list.filter(a => !list.some(b => b !== a && b.length > a.length && b.includes(a)));
}

/** Steps an edit could not have followed a read: the model is writing blind. */
function isBlindWriteError(errorText) {
  return /FS_NOT_OBSERVED|has not been read|未读取|尚未读取/i.test(String(errorText ?? ""));
}

/** The file changed between read and write. Repeating the same edit cannot fix it. */
function isStaleWriteError(errorText) {
  return /FS_STALE_VERSION|stale|已被修改|已变更/i.test(String(errorText ?? ""));
}

function blockText(content) {
  if (!Array.isArray(content)) return "";
  return content.filter(b => b && b.type === "text" && typeof b.text === "string").map(b => b.text).join("\n");
}

/**
 * One session's office-work state.
 *
 * Everything here is derived from events, so a reload loses at most the window
 * and never invents a conclusion.
 */
export class OfficeSignals {
  constructor(options = {}) {
    this.now = options.now ?? (() => Date.now());
    this.windowSteps = Math.max(6, Number(options.windowSteps) || 14);
    this.loop = new LoopDetector({ windowSteps: this.windowSteps, now: this.now });

    this.turn = 0;
    this.turnStartedAt = this.now();
    this.stepsThisTurn = 0;

    /** The person's own words for this turn, and what it asked to produce. */
    this.ask = null;
    this.deliverables = [];
    /** Files touched this turn, in first-touch order. */
    this.touched = new Map();
    /** Anything that looks like a real output this turn. */
    this.produced = [];
    this.staleWrites = 0;
    this.blindWrites = 0;
    this.lastEvent = null;
  }

  // --- turn lifecycle -------------------------------------------------------
  startTurn(turn, at) {
    this.turn = turn;
    this.turnStartedAt = Number(at) || this.now();
    this.stepsThisTurn = 0;
    this.loop.setTurn(turn);
    this.ask = null;
    this.deliverables = [];
    this.touched = new Map();
    this.produced = [];
    this.staleWrites = 0;
    this.blindWrites = 0;
  }

  /** Record the person's ask. Plugin/compaction messages are not asks. */
  observeAsk(text) {
    const clean = String(text ?? "").trim();
    if (!clean) return;
    if (/^Current runtime context:/i.test(clean)) return;
    // The first ask of the turn wins: later user messages are usually steering.
    if (this.ask !== null) return;
    this.ask = clean.length > 1600 ? `${clean.slice(0, 1600)}…` : clean;
    this.deliverables = extractDeliverables(clean);
  }

  observeStepStart() {
    this.stepsThisTurn += 1;
  }

  /** A file was read: it is now legally editable, and it is no longer "new work". */
  observeRead(path) {
    if (!path) return;
    const entry = this.touched.get(path) ?? { reads: 0, edits: 0, firstStep: this.stepsThisTurn };
    entry.reads += 1;
    entry.lastReadStep = this.stepsThisTurn;
    this.touched.set(path, entry);
  }

  /** A file was written/edited. */
  observeEdit(path, { created } = {}) {
    if (!path) return;
    const entry = this.touched.get(path) ?? { reads: 0, edits: 0, firstStep: this.stepsThisTurn };
    entry.edits += 1;
    entry.lastEditStep = this.stepsThisTurn;
    this.touched.set(path, entry);
    this.produced.push({ step: this.stepsThisTurn, path, created: created === true });
  }

  /** A tool result carrying an error we classify. */
  observeError(errorText) {
    if (isStaleWriteError(errorText)) this.staleWrites += 1;
    else if (isBlindWriteError(errorText)) this.blindWrites += 1;
  }

  // --- assessment -----------------------------------------------------------

  /**
   * The loop signal, unchanged in meaning, now one input among four.
   */
  loopVerdict(config) {
    return this.loop.assess(config, { turnSteps: this.stepsThisTurn });
  }

  /**
   * Tool misuse: the model is writing files it never read, or retrying an edit
   * whose file moved under it. Both are proven by the tool's own error text, so
   * these are the highest-confidence signals in the plugin.
   */
  misuseVerdict() {
    const signals = [];
    if (this.blindWrites > 0) {
      signals.push({
        kind: "write-without-read",
        count: this.blindWrites,
        weight: 0.95,
        hint: "编辑前必须先读取文件；这里应当先 read 目标文件，再改。",
      });
    }
    if (this.staleWrites > 0) {
      signals.push({
        kind: "stale-write",
        count: this.staleWrites,
        weight: 0.95,
        hint: "文件在读取后被改动过；必须重新 read 拿到最新内容再重试，重放旧编辑永远不会成功。",
      });
    }
    return signals;
  }

  /**
   * Priority: steps are going to files that are not the deliverable.
   *
   * Narrow on purpose. "It edited an unrelated file" is normal while exploring a
   * repo, so this only fires when a deliverable was explicitly named, work is
   * underway, and nothing at all has been produced yet.
   */
  priorityVerdict() {
    const named = this.deliverables;
    if (!named.length) return null;
    if (this.produced.length > 0) return null;
    if (this.stepsThisTurn < 6) return null;
    const lower = named.map(n => n.toLowerCase());
    const touchedNear = [...this.touched.keys()].some(path => {
      const p = path.toLowerCase();
      return lower.some(n => p.includes(n) || n.includes(p));
    });
    if (touchedNear) return null;
    return {
      kind: "not-started-deliverable",
      count: this.stepsThisTurn,
      weight: 0.7,
      deliverables: named,
      touched: [...this.touched.keys()].slice(-5),
      hint: `这一轮要产出的是「${named.join("」「")}」，但到现在为止改动的都是别的文件。先确认交付物在哪里落地。`,
    };
  }

  /**
   * Drift: the ask is either already satisfied, or has quietly been dropped.
   *
   * It never *claims* drift on its own — it reports the evidence and lets the
   * diagnosis decide. "Already done" is the cheap, checkable half; "abandoned"
   * needs judgement this module must not fake.
   */
  driftVerdict() {
    const named = this.deliverables;
    if (!named.length) return null;
    const lower = named.map(n => n.toLowerCase());
    const satisfied = this.produced.filter(p => {
      const path = String(p.path ?? "").toLowerCase();
      return lower.some(n => (n.includes(".") ? path.endsWith(n.replace(/^.*[/\\]/, "")) : path.includes(n)));
    });
    if (!satisfied.length) return null;
    return {
      kind: "deliverable-satisfied",
      count: satisfied.length,
      weight: 0.55,
      deliverables: named,
      matched: satisfied.map(p => p.path),
      hint: `要求里的「${named.join("」「")}」看起来已经产出了（${satisfied.map(p => p.path).join("、")}）。先核对是否已满足要求，再决定还要不要继续。`,
    };
  }

  /** Every signal currently true, strongest first. */
  assess(config = {}) {
    const loop = this.loopVerdict({
      threshold: config.loopThreshold ?? 3,
      maxStepsPerTurn: 0,
    });
    const signals = [
      ...this.misuseVerdict(),
      ...loop.signals.filter(s => s.kind !== "step-budget"),
      ...(this.driftVerdict() ? [this.driftVerdict()] : []),
      ...(this.priorityVerdict() ? [this.priorityVerdict()] : []),
    ].sort((a, b) => b.weight - a.weight);
    return { signals, loop, risk: signals.reduce((max, s) => Math.max(max, s.weight), 0) };
  }

  summary() {
    return {
      turn: this.turn,
      stepsThisTurn: this.stepsThisTurn,
      turnStartedAt: this.turnStartedAt,
      ask: this.ask,
      deliverables: this.deliverables,
      touched: [...this.touched.entries()].map(([path, e]) => ({ path, ...e })),
      produced: this.produced.slice(-8),
      staleWrites: this.staleWrites,
      blindWrites: this.blindWrites,
      loop: this.loop.snapshot(),
    };
  }
}
