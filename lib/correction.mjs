// dsh-focusing — the course-correction message.
//
// The text injected before a step is the whole product: it is the only thing
// the model actually reads. Three rules shaped it.
//
// 1. It is written in the model's own voice, not the user's. The correction
//    arrives as a user message, so a message that says "you are looping" reads
//    as the person changing the subject mid-task. A self-check note reads as
//    the model noticing.
// 2. It states FACTS the model cannot see from inside the loop: how many times
//    it repeated, what the original ask was, how much time has passed. The
//    model already knows what it is doing; what it lacks is the global view.
// 3. It ends with a decision, not a prohibition. "Decide which of these it is"
//    produces useful behaviour; "stop repeating" produces a different loop.

const KIND_LABEL = {
  edit: "编辑",
  execute: "执行命令",
  read: "读取",
  search: "搜索",
};

function oneLine(text, max) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function elapsed(startedAt, now) {
  const ms = Math.max(0, now - startedAt);
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  if (minutes >= 1) return `${minutes} 分 ${seconds} 秒`;
  return `${seconds} 秒`;
}

function describeRepeat(signal) {
  const call = signal.call ?? {};
  const times = signal.count ?? signal.repeats ?? 0;
  if (call.file) return `同一个文件 \`${call.file}\` 已经被反复处理 ${times} 次`;
  if (call.cmd) return `同一条命令 \`${oneLine(call.cmd, 120)}\` 已经被重复执行 ${times} 次`;
  if (call.file_read) return `同一个目标 \`${oneLine(call.file_read, 80)}\` 已经被重复访问 ${times} 次`;
  return `同一个工具调用 \`${signal.toolName ?? "?"}\` 已经被重复 ${times} 次`;
}

/**
 * Build the text injected as the extra user message before the next step.
 *
 * @param {object} args
 * @param {object} args.verdict  result of `LoopDetector.assess()`
 * @param {object} args.snapshot result of `LoopDetector.snapshot()`
 * @param {string} [args.goal]   the original goal, when known
 * @param {number} [args.now]
 * @param {string} [args.subagentConclusion] a global diagnosis, when one ran
 */
export function buildCorrection({ verdict, snapshot, goal, now = Date.now(), subagentConclusion }) {
  const lines = [];
  lines.push("**（自查 · 全局视角提醒）** 停一下，从外面看一眼这一轮。");
  lines.push("");

  const goalText = goal ?? snapshot.originalGoal;
  if (goalText) {
    lines.push(`当前这一轮真正要做的事是：`);
    lines.push(`> ${oneLine(goalText, 700)}`);
    lines.push("");
  }

  lines.push(`事实（这些从循环内部看不到）：`);
  lines.push(`- 这一轮到目前已经走了 **${snapshot.turnSteps ?? snapshot.stepsInWindow} 步**，用时约 ${elapsed(snapshot.turnStartedAt, now)}。`);

  for (const signal of verdict.signals) {
    if (signal.kind === "same-call") {
      lines.push(`- ${describeRepeat({ ...signal, toolName: signal.toolName })}${signal.consecutive > 1 ? `，而且最近 ${signal.consecutive} 步连续都是它` : ""}。`);
    } else if (signal.kind === "same-failing-result") {
      lines.push(`- 同一个错误原文已经**完整出现 ${signal.count} 次**了 —— 这不是偶发失败，是这条路走不通。`);
    } else if (signal.kind === "no-progress") {
      lines.push(`- 最近 **${signal.count} 步没有任何一次新的有效产出**。`);
    } else if (signal.kind === "step-budget") {
      lines.push(`- 这一轮已超过预期的 ${signal.count} 步预算。`);
    }
  }

  const recent = (snapshot.recent ?? []).slice(-6);
  if (recent.length) {
    lines.push("");
    lines.push("最近几步实际做了什么：");
    for (const r of recent) {
      const target = r.file ? ` \`${r.file}\`` : r.cmd ? ` \`${oneLine(r.cmd, 70)}\`` : "";
      const mark = r.failed ? "✗ 失败" : "✓";
      lines.push(`- 第 ${r.step} 步：${r.tool ?? "?"}${target} ${mark}`);
    }
  }

  if (subagentConclusion) {
    lines.push("");
    lines.push("一个没有这轮上下文的独立分析者看过现场后的判断：");
    lines.push(`> ${oneLine(subagentConclusion, 1200).replace(/^> /, "")}`);
  }

  lines.push("");
  lines.push("**现在先别继续原来那一步。** 先判断这属于哪一种：");
  lines.push("1. **方向没变但方法错了** —— 说出前面几次尝试各自失败的原因，然后换一个本质不同的做法（不是再试一次同样的东西，也不是只改一个参数）。");
  lines.push("2. **信息不够** —— 明确列出你缺哪一条具体信息，用一次调用去拿到它，而不是继续猜。");
  lines.push("3. **这件事做不到 / 前提不成立** —— 直接说明卡在哪里、你验证到了什么，让用户决定。");
  lines.push("4. **跑偏了** —— 回到上面那句原始目标，指出这一轮从哪一步开始离开了它，然后从那里重来。");
  lines.push("");
  lines.push("用一到两句话说明你的判断，然后立刻按新判断行动。不要复述这份提醒，也不要道歉。");

  return lines.join("\n");
}

/** One-line summary for the panel's event list. */
export function summarizeSignal(signal) {
  const call = signal.call ?? {};
  if (signal.kind === "same-call") {
    if (call.file) return `${KIND_LABEL.edit}重复：${call.file} ×${signal.count}`;
    if (call.cmd) return `命令重复：${oneLine(call.cmd, 60)} ×${signal.count}`;
    return `调用重复：${signal.toolName ?? "?"} ×${signal.count}`;
  }
  if (signal.kind === "same-failing-result") return `同一错误重复 ${signal.count} 次`;
  if (signal.kind === "no-progress") return `连续 ${signal.count} 步无新产出`;
  if (signal.kind === "step-budget") return `步数超过预算（${signal.count} 步）`;
  return signal.kind;
}
