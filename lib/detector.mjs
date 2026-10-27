// dsh-focusing — loop detector.
//
// Pure, dependency-free state machine. Nothing here imports a DSH package, so
// it runs (and is tested) outside the Host process. The Host half feeds it
// observations and asks it for a verdict; it never touches the session.
//
// Why this shape: "the model is stuck" is not one condition but several, and
// each has a cheap, deterministic fingerprint. We fold a short sliding window of
// steps and score the fingerprints rather than asking a model to judge. A model
// judging its own loop is exactly the thing that fails — the diagnosis must be
// independent of the context it is diagnosing.
//
// All state is derived from what the Host observes; a reload simply restarts
// the window, which costs one detection and never corrupts a session.

/** FNV-1a. Short, stable, and good enough to bucket near-identical payloads. */
export function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Collapse whitespace and case so trivial re-wording does not read as progress. */
function normalize(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Reduce one tool call to `{ file, cmd, fingerprint }`.
 *
 * `file` and `cmd` are the fields the hard intervention blocks on, so they stay
 * human-meaningful; `fingerprint` is the normalized hash used for repeat
 * counting. Paths are compared by their tail so `./a/b.ts` and `/w/a/b.ts`
 * count as the same file.
 */
export function fingerprintCall(name, args, toolKind) {
  const a = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  const pick = (...keys) => {
    for (const key of keys) {
      const value = a[key];
      if (typeof value === "string" && value.trim()) return value;
    }
    return undefined;
  };

  if (toolKind === "edit") {
    const path = pick("path", "file_path", "filePath", "filename", "target");
    if (path) {
      const file = path.replace(/\\/g, "/").split("/").filter(Boolean).slice(-2).join("/");
      return { file, cmd: undefined, fingerprint: `${name}|${file}` };
    }
  }

  if (toolKind === "execute") {
    const cmd = pick("command", "cmd", "script", "line");
    if (cmd) {
      return { file: undefined, cmd: normalize(cmd).slice(0, 300), fingerprint: `${name}|${hash32(normalize(cmd))}` };
    }
  }

  if (toolKind === "read" || toolKind === "search") {
    const path = pick("path", "file_path", "pattern", "query", "glob");
    if (path) {
      return { file: undefined, file_read: path, fingerprint: `${name}|${hash32(normalize(path))}` };
    }
  }

  // Generic: the whole argument object, so an identical call is a repeat.
  return { file: undefined, cmd: undefined, fingerprint: `${name}|${hash32(normalize(JSON.stringify(a)))}` };
}

/**
 * A step's outcome, in the two dimensions the loop score cares about:
 * did it fail, and did it produce anything new.
 */
function summarizeResult(result) {
  if (!result) return { isError: false, errorHash: undefined, progress: false };
  const isError = result.isError === true;
  let text = "";
  try {
    text = JSON.stringify(result.content ?? result.value ?? "").slice(0, 2000);
  } catch {
    text = "";
  }
  return {
    isError,
    errorHash: isError ? hash32(normalize(text)) : undefined,
    // Any successful call that is not a repeat counts as progress once; the
    // "repeat" half of the score handles calls that change nothing.
    progress: !isError,
  };
}

export class LoopDetector {
  /**
   * @param {object} options
   * @param {number} options.windowSteps  how many steps of history to keep
   * @param {() => number} [options.now]  injectable clock, for tests
   */
  constructor(options = {}) {
    this.windowSteps = Math.max(4, Number(options.windowSteps) || 14);
    this.now = options.now ?? (() => Date.now());
    /** Recent step records, oldest first. */
    this.window = [];
    /** Turn number of the current turn. */
    this.turn = 0;
    this.turnStartedAt = this.now();
    this.originalGoal = null;
    this.lastSignal = null;
  }

  setTurn(turn) {
    if (turn === this.turn) return;
    this.turn = turn;
    this.turnStartedAt = this.now();
    this.window = [];
    this.lastSignal = null;
  }

  /** Remember the first user text of a turn as "what was actually asked". */
  observeUser(text) {
    if (this.originalGoal !== null) return;
    const clean = String(text ?? "").trim();
    if (!clean) return;
    this.originalGoal = clean.length > 1500 ? `${clean.slice(0, 1500)}…` : clean;
  }

  clearGoal() {
    this.originalGoal = null;
  }

  /**
   * Record one completed step.
   *
   * @param {object} step
   * @param {number} step.turn
   * @param {number} step.step
   * @param {string} [step.toolName]
   * @param {{file?:string,cmd?:string,fingerprint:string}} [step.call]
   * @param {string} [step.toolKind]
   * @param {{isError?:boolean, text?:string}} [step.result]
   */
  observeStep(step) {
    const turn = Number(step.turn) || this.turn || 1;
    this.setTurn(turn);

    const record = {
      turn,
      step: Number(step.step) || 0,
      toolName: step.toolName,
      toolKind: step.toolKind,
      call: step.call,
      result: summarizeResult(step.result),
      at: this.now(),
    };

    // "Same failing result" is a stronger signal than "same call": the model
    // may legitimately re-run a command after changing the cause.
    if (record.result.errorHash) {
      const prior = this.window.filter(r => r.result.errorHash === record.result.errorHash).length;
      record.result.errorRepeat = prior + 1;
    }

    this.window.push(record);
    while (this.window.length > this.windowSteps) this.window.shift();
    return record;
  }

  /** How many times `fingerprint` appears in the window, including now. */
  countRepeats(fingerprint) {
    if (!fingerprint) return 0;
    return this.window.filter(r => r.call?.fingerprint === fingerprint).length;
  }

  /** Consecutive trailing steps on the same fingerprint. */
  consecutiveRepeatRun(fingerprint) {
    if (!fingerprint) return 0;
    let run = 0;
    for (let i = this.window.length - 1; i >= 0; i -= 1) {
      if (this.window[i].call?.fingerprint !== fingerprint) break;
      run += 1;
    }
    return run;
  }

  /** Steps since the last time this window saw a successful, non-repeated call. */
  stepsWithoutProgress() {
    const seen = new Map();
    for (const r of this.window) {
      const key = r.call?.fingerprint ?? `step:${r.turn}:${r.step}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    let since = 0;
    for (let i = this.window.length - 1; i >= 0; i -= 1) {
      const r = this.window[i];
      const key = r.call?.fingerprint ?? `step:${r.turn}:${r.step}`;
      if (r.result.progress && seen.get(key) === 1) break;
      since += 1;
    }
    return since;
  }

  /** The dominant repeated call in the window, if any. */
  dominantRepeat() {
    const counts = new Map();
    for (const r of this.window) {
      if (!r.call?.fingerprint) continue;
      const entry = counts.get(r.call.fingerprint) ?? { count: 0, record: r };
      entry.count += 1;
      counts.set(r.call.fingerprint, entry);
    }
    let best = null;
    for (const [fingerprint, entry] of counts) {
      if (!best || entry.count > best.count) best = { fingerprint, ...entry };
    }
    return best;
  }

  /**
   * The verdict for the current window.
   *
   * `signals` is ordered by strength so a UI can show the strongest first:
   *   same-failing-result  identical error text repeated (highest confidence)
   *   same-call            identical call repeated
   *   no-progress          several steps with nothing succeeding newly
   *   step-budget          the turn has run longer than the configured ceiling
   *
   * `options.turnSteps` is the turn total, which the caller owns: the window is
   * bounded and cannot answer "how long has this turn run".
   *
   * `risk` is 0..1 and is what the panel displays; it is not used to decide
   * anything, so retuning it never changes behaviour.
   */
  assess(config = {}, options = {}) {
    const signals = [];
    const dominant = this.dominantRepeat();
    const repeats = dominant?.count ?? 0;
    const run = this.consecutiveRepeatRun(dominant?.fingerprint);
    const noProgress = this.stepsWithoutProgress();
    const turnSteps = Number(options.turnSteps) || this.window.filter(r => r.turn === this.turn).length;

    const errorRepeats = this.window.reduce((max, r) => Math.max(max, r.result.errorRepeat ?? 0), 0);

    if (errorRepeats >= 2) {
      signals.push({ kind: "same-failing-result", count: errorRepeats, weight: 0.9, call: dominant?.record?.call });
    }
    if (repeats >= (config.threshold ?? 3)) {
      signals.push({
        kind: "same-call",
        count: repeats,
        weight: Math.min(0.95, 0.4 + repeats * 0.12),
        call: dominant?.record?.call,
        toolName: dominant?.record?.toolName,
        consecutive: run,
      });
    }
    if (noProgress >= Math.max(3, (config.threshold ?? 3) + 1) && repeats >= 2) {
      signals.push({ kind: "no-progress", count: noProgress, weight: 0.6 });
    }
    const budget = Number(config.maxStepsPerTurn) || 0;
    if (budget > 0 && turnSteps >= budget) {
      signals.push({ kind: "step-budget", count: turnSteps, weight: 1 });
    }

    const risk = signals.reduce((max, s) => Math.max(max, s.weight), 0);
    const verdict = { signals, risk, repeats, run, noProgress, turnSteps };
    if (signals.length) this.lastSignal = verdict;
    return verdict;
  }

  /** Everything the Host needs to build a course-correction message. */
  snapshot() {
    const recent = this.window.slice(-8).map(r => ({
      turn: r.turn,
      step: r.step,
      tool: r.toolName,
      file: r.call?.file,
      cmd: r.call?.cmd,
      failed: r.result.isError,
      errorRepeat: r.result.errorRepeat ?? 0,
    }));
    return {
      turn: this.turn,
      originalGoal: this.originalGoal,
      turnStartedAt: this.turnStartedAt,
      stepsInWindow: this.window.length,
      recent,
    };
  }
}
