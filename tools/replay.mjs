#!/usr/bin/env node
// Replay a real session log through the detector.
//
// This is the honest test for a detector: a session that ran for real, whose
// ground truth we know ("this was legitimate long work, not a loop"). It answers
// the only question that matters before trusting the rules — how often would they
// have fired, and would each firing have been right?
//
// Usage:
//   node tools/replay.mjs <session.v4.jsonl.zstd> [--threshold 3] [--budget 120] [--quiet]
//
// The log is a concatenation of zstd frames; Node's zstdDecodeSync reads only the
// first, so the frames are split here and decoded one by one.

import { readFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import { LoopDetector, fingerprintCall } from "../lib/detector.mjs";
import { buildDiagnosisPrompt, parseVerdict } from "../lib/index.mjs";

const ZSTD_MAGIC = 0xfd2fb528;

/** Split a concatenated zstd stream into frame buffers. */
export function splitFrames(buf) {
  const frames = [];
  let offset = 0;
  while (offset + 4 <= buf.length) {
    if (buf.readUInt32LE(offset) !== ZSTD_MAGIC) {
      offset += 1;
      continue;
    }
    // The frame length is not stored up front: find the shortest prefix that
    // decodes, which is the frame boundary.
    let lo = offset + 5;
    let hi = buf.length;
    let end = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      try {
        zstdDecompressSync(buf.subarray(offset, mid));
        end = mid;
        hi = mid - 1;
      } catch {
        lo = mid + 1;
      }
    }
    if (end < 0) break;
    frames.push(buf.subarray(offset, end));
    offset = end;
  }
  return frames;
}

export function readEvents(path) {
  const frames = splitFrames(readFileSync(path));
  const text = frames.map(f => zstdDecompressSync(f).toString("utf8")).join("\n");
  return text
    .split("\n")
    .filter(line => line.trim().startsWith("{"))
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function inferKind(name, args) {
  const n = String(name ?? "").toLowerCase();
  const a = args && typeof args === "object" ? args : {};
  if (n === "edit" || n === "multi_edit" || n === "write") return "edit";
  if (n === "bash" || n === "pwsh" || n === "terminal") return "execute";
  if (n === "read" || n === "read_image") return "read";
  if (n === "grep" || n === "glob" || n === "search") return "search";
  if (typeof a.path === "string" && typeof a.old_string === "string") return "edit";
  if (typeof a.command === "string") return "execute";
  return "other";
}

function textOf(content) {
  return Array.isArray(content)
    ? content.filter(b => b?.type === "text" && typeof b.text === "string").map(b => b.text).join("\n").trim()
    : "";
}

/**
 * Fold the log and return every point where a rule would have fired.
 *
 * Note the `dsh-focusing` guard: this plugin's own corrections are in the log as
 * user messages. Counting them as "the person's request" is how a replay talks
 * itself into a loop, so they are skipped exactly as the Host skips them.
 */
export function replay(events, { threshold = 3, budget = 120 } = {}) {
  const detector = new LoopDetector({ windowSteps: 14 });
  const pending = new Map();
  const hits = [];
  let step = 0;
  let turns = 0;

  for (const event of events) {
    const data = event.data ?? {};
    if (event.type === "turn/start") {
      turns += 1;
      step = 0;
      detector.setTurn(data.turn);
      continue;
    }
    if (event.type === "step/start") {
      step = data.step;
      detector.setTurn(data.turn);
      continue;
    }
    if (event.type === "user/message") {
      const kind = data.source?.kind;
      const text = textOf(data.content);
      if ((kind === undefined || kind === "user") && text && !/^Current runtime context:/.test(text)) {
        detector.observeUser(text);
      }
      continue;
    }
    if (event.type === "tool/call") {
      let args = {};
      try {
        args = JSON.parse(data.arguments);
      } catch {
        args = {};
      }
      const kind = inferKind(data.name, args);
      pending.set(data.callId, {
        toolName: data.name,
        toolKind: kind,
        call: fingerprintCall(data.name, args, kind),
        turn: data.turn,
        step: data.step,
      });
      continue;
    }
    if (event.type === "tool/result") {
      const id = data.message?.toolCallId;
      const call = pending.get(id);
      pending.delete(id);
      detector.observeStep({
        turn: data.turn,
        step: data.step,
        toolName: call?.toolName,
        toolKind: call?.toolKind,
        call: call?.call,
        result: { isError: data.message?.isError === true, content: data.message?.content },
      });
      const verdict = detector.assess({ threshold, maxStepsPerTurn: budget }, { turnSteps: step });
      const loopSignals = verdict.signals.filter(s => s.kind !== "step-budget");
      if (loopSignals.length) {
        hits.push({
          turn: data.turn,
          step,
          signals: loopSignals.map(s => s.kind),
          repeats: verdict.repeats,
          snapshot: detector.snapshot(),
          verdict,
        });
      }
    }
  }
  return { hits, turns, steps: step, goal: detector.originalGoal };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = process.argv.slice(2);
  const path = args.find(a => !a.startsWith("--"));
  const num = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i >= 0 ? Number(args[i + 1]) : fallback;
  };
  if (!path) {
    console.error("usage: node tools/replay.mjs <session.v4.jsonl.zstd> [--threshold 3] [--budget 120] [--prompt]");
    process.exit(2);
  }
  const quiet = args.includes("--quiet");
  const showPrompt = args.includes("--prompt");
  const events = readEvents(path);
  const result = replay(events, { threshold: num("--threshold", 3), budget: num("--budget", 120) });

  console.log(`events: ${events.length}  turns: ${result.turns}  last step: ${result.steps}`);
  console.log(`goal: ${result.goal ? result.goal.slice(0, 80).replace(/\n/g, " ") + "…" : "(not captured)"}`);
  console.log(`rule hits: ${result.hits.length}  (steps ${result.hits.map(h => h.step).join(", ") || "none"})`);

  if (!quiet && result.hits.length) {
    const first = result.hits[0];
    console.log("\n--- first hit ---");
    console.log(`step ${first.step}: ${first.signals.join(", ")} (repeats ${first.repeats})`);
    for (const r of first.snapshot.recent) {
      console.log(`  step ${r.step}: ${r.tool ?? "?"} ${r.file ?? r.cmd ?? ""} ${r.failed ? "FAILED" : "ok"}`);
    }
    if (showPrompt) {
      console.log("\n--- diagnosis prompt that would be sent ---");
      console.log(buildDiagnosisPrompt(first.verdict, { ...first.snapshot, turnSteps: first.step }));
    }
  }
  const sample = parseVerdict("VERDICT: NORMAL\nREASON: it is editing one large file.\nNEXT: none");
  console.log(`\nparseVerdict self-check: ${JSON.stringify(sample)}`);
}
