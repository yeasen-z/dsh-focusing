# dsh-focusing

> 你的 context / session 管家：跨会话整理上下文、分析进度；循环检测是其中一个能力模块。

## 上下文工作台（v2）

左侧栏点 Focusing 进入工作台。直接用一句话提要求，例如「整理我这周干了什么，进度如何」。

| 模块 | 作用 | 数据 |
|---|---|---|
| 工作台 | 输入框 + 预设指令 + 最近的整理结果 | — |
| 整理与报告 | 由指令生成周报 / 日报 / 交接文档；可复制 Markdown、下载、重新生成、追问 | `${DSH_PROFILE_DIR}/dsh-focusing.digests.json`，重启后仍在 |
| 上下文记录 | 按时间范围列出每个会话：你问了什么、最后的结论、改动的文件、待办；可打开原会话或一键生成交接文档 | 实时读取会话日志 |
| 协作室 | 把 1～4 个会话冻结成快照放进一个**新的**协作空间：参与者轮流发言（每位可配不同模型），可生成交接简报并放进新会话输入框 | `dsh-focusing.rooms.json`；原会话只读 |
| 专注纠偏 | 原有的单会话循环检测面板（见下文）；手动分析结果持久化；名单含未加载的历史会话，可筛「有分析记录」 | `dsh-focusing.reviews.json` |

### 协作室：保证与限制

- **不碰原会话**：创建时把每个会话读一遍、折叠成快照（请求、各轮结论、改动文件、命令、待办），记下读到的日志位置 `seq`。之后只再读原会话来显示「快照之后又有 N 次工具调用」，从不写入。
- **新的空间**：协作室是 Focusing 自己的记录，不是 DSH 会话；参与者是「快照 + 模型」，每次发言是一次独立的模型调用（不创建 agent、没有工具、不能改文件）。
- **只在你点名时发言**：「让 A 发言」「轮流一轮」；你也可以以主持人身份插话、删掉某条、或给某位重新快照。没有定时、没有自动循环。
- **交接**：「生成交接简报」写出给新 agent 的第一条消息；「在新会话中打开」通过 `uiWorkspace.startSession(workspace, {prompt})` 只把它放进新会话的输入框，由你检查后发送。模型失败时给出不经模型的原始材料。
- 同一个会话可以加入两次、配不同模型，用来对同一事实听两种观点。

### 一次整理怎么生成

1. **范围**：从指令里识别（今天 / 昨天 / 这周 / 上周 / 最近 7 天 / 本月 / 最近 30 天），也可在输入框下手动指定。按浏览器时区计算，周一为一周起点。
2. **扫描**：`sessionPersistence.list()` 拿到全部会话；按存储修改时间跳过范围外的旧会话，**不解压**。正在运行的会话直接读内存。
3. **折叠**（`lib/context-records.mjs`）：每个会话按轮折叠成上下文记录——真人请求（去掉 runtime context / system reminder 等注入）、每轮最后的回复、编辑过的文件、shell 命令、失败调用、todo 清单。按 revision 缓存，未变的会话不重复读取。子代理会话不算作你的工作。
4. **数字由程序计算**：会话数、项目数、活跃天数、工具调用次数不交给模型。
5. **归纳由模型完成**：输入按预算打包（最新的会话给全文，较旧的压缩，再多的只列标题），要求模型只依据记录输出固定 JSON（摘要、按项目进度与完成/进行/风险条目、按天回顾、下一步、附加章节）。解析后校验，模型引用的未知会话 id 会被丢弃。
6. **模型失败也有结果**：没配置、超时或输出无法解析时，返回由记录直接生成的结构草稿，并标明原因。

模型来源复用「分析设置」（DSH 已配置模型或外部 OpenAI 兼容接口）。只在你点击「开始整理」/「追问」时才调用模型。

### 路由

| 路由 | 用途 |
|---|---|
| `GET /api/dsh-focusing.records?range=&offset=&q=&project=` | 范围内的会话记录 |
| `GET /api/dsh-focusing.records/detail?id=` | 单个会话的完整记录 |
| `POST /api/dsh-focusing.digest` `{request, range?, rangeLocked?, offset, session?}` | 后台生成整理结果，立即返回 id |
| `GET /api/dsh-focusing.digest?id=` | 读取（生成中可轮询阶段） |
| `POST /api/dsh-focusing.digest` `{action:"delete", id}` | 删除 |
| `GET /api/dsh-focusing.digests` | 已保存列表 |
| `POST /api/dsh-focusing.followup` `{id, question}` | 基于结果追问，答案存回结果 |
| `GET /api/dsh-focusing.digest-export?id=` | Markdown 下载 |
| `GET /api/dsh-focusing.rooms` | 协作室列表 |
| `GET /api/dsh-focusing.room?id=` | 一个协作室，附每个源会话在快照之后的变化 |
| `POST /api/dsh-focusing.room` `{action, ...}` | `create` / `say` / `turn` / `cancel` / `remove` / `resnap` / `handoff` / `target` / `opened` / `delete` |
| `GET\|POST /api/dsh-focusing.external-models` | 外部接口的模型列表（Key 只在同源时由 Host 带上，不返回） |

---

## 专注纠偏：检测 agent 是否在原地打转

这是给 DSH 的一个插件。它的出发点是一个具体的观察：模型很擅长执行，但不擅长在自己
的循环里看清自己在循环里。所以这个插件不在模型内部做工作，而是在 **agent loop 的中间
插入判断**——用一个独立的、不看对话的检测器决定要不要打断。

## 它靠什么判断（全部可确定性验证）

| 信号 | 含义 | 强度 |
|---|---|---|
| `same-failing-result` | 同一个错误原文反复完整出现 | 最高（0.9） |
| `same-call` | 同一个调用反复出现（同文件编辑 / 同命令） | 随次数上升 |
| `no-progress` | 连续多步没有任何新的有效产出 | 中（0.6） |
| `step-budget` | 本轮步数超过上限 | 安全网，**不单独触发** |

`step-budget` 单独出现时不做任何干预。这是被真实数据纠正过的设计：本插件在自己身上
第一次触发时，唯一命中的就是步数预算（90 步），而那一轮是正常的长任务而非循环。

## 三种干预强度

| 级别 | 机制 | 默认 |
|---|---|---|
| 软 | `agent/pre-step` 在进入下一步前追加一条纠偏 message | 关闭 |
| 硬 | `tools/pre-execute` 拒绝那个反复重复的调用（每轮每指纹一次） | 关闭 |
| 子代理 | 起一个干净上下文的子 agent 只看事实做全局诊断，结论并入纠偏 | 关闭 |

安装后默认 **全部关闭**，不会改变任何既有行为。要启用就改 `cordis.patch.yml` 里
`config.soft.enabled: true`。

## 关键设计决定

- **纠偏以 `source.kind = "focusing"` 的 user message 注入**，而不是藏进 system prompt。
  原因有两个：模型无法在自己的 system prompt 里「看见」这次干预；而带自有 source
  的 message 在 UI 里会和真人输入分开渲染，事后能区分。
- **检测器是纯函数**（`lib/detector.mjs`），不 import 任何 DSH 包，可以脱离 Host
  单测和回放历史会话。模型判断自己是否循环正是会失败的那件事，所以诊断必须独立。
- **纠偏文案用第一人称自查口气**，并给出四条分支判断，而不是一句「停止重复」。
  后者只会换来另一种循环。事实部分给出模型从循环内部看不到的东西：重复次数、
  原始目标、已经花掉多久。
- **面板只读**。所有决策在 Host，页面只问 `/api/dsh-focusing.state` 发生了什么。

## 已验证 / 未验证

已验证：

- 15 个单测全部通过（指纹、阈值、误报、跨轮清理、文案内容）。
- 用真实会话日志（86 步、56 次工具调用）回放检测器：首次触发落在第 72 步，
  命中内容正是「连续编辑同一文件 `lib/index.mjs`」，符合设计意图。
- 插件已安装进 `desktop` profile（`application: applied`），并**在真实运行中触发过**
  ——纠偏消息已写入会话日志的 `user/message` 事件。

**未验证**：Web UI 面板的视觉与交互。Client 半部已写好但尚未在浏览器中确认渲染。

## 已知缺陷（未修复）

1. **`turnStartedAt` 不准**：Hot reload 后 `Detector` 重建，`turnStartedAt` 取的是
   reload 时刻，所以纠偏里会显示「用时约 0 秒」。应从 `turn/start` 事件时间戳取，
   而不是构造时刻。
2. **重载后最近步骤的工具名丢失**：`pending` map 在 reload 时清空，于是重载前发出、
   重载后才返回的调用在时间线里显示为 `?`。应以会话日志回填 `pending`。
3. **替换已安装模块需要重启 Harness**：安装目录链接工作区不代表运行中的模块已更新。
   disable → enable、刷新页面及相同 slot 注册均不能证明加载了新模块；请完整重启 Harness 后重新打开面板。

## 手动分析排查修复

- 客户端原来引用了未定义的 `ROUTE_ANALYZE` / `ROUTE_EXPORT`。点击在发请求前失败；已补齐地址。
- 分析只保留顶栏一个入口；点击后切到诊断页。网络错误、HTTP 错误及服务端详情直接展示，成功结果立即显示。
- 新增执行 `onClick` 的请求测试，不再只判断按钮存在；同时覆盖重复点击、唯一入口和失败详情。
- 本地 63 项测试通过；这些是单元/交互处理测试，**不等于浏览器里的真实模型请求已验证**。
- 当前分析默认调用 Host 已授权的模型，也可切换到 OpenAI 兼容的外部接口；只支持已加载的会话。
- **分析结果已持久化**：保存在 `${DSH_PROFILE_DIR}/dsh-focusing.reviews.json`，每个会话保留最近 10 次，最多 200 个会话；重启后仍在；会话重新加载后旧结论会自动出现（名单里仍只列已加载的会话，所以已卸载会话的旧分析暂时选不到）。
- **标注获取时间**：每份结论显示「分析于 日期 时间」；非当天的带日期。
- **标注此后有无新进展**：分析时记录当时读到的日志偏移 `seq`，打开面板时统计偏移之后的新动作（工具调用、失败、轮次、用户消息）。有新动作显示「可能已过期」并列出数量、提供「基于最新记录重新分析」；没有则显示「仍然适用」；读不到日志时明确显示「无法判断」，不假装新鲜。
- 更早的几次分析折叠在「更早的分析」里。失败的重跑不会覆盖已有结论。

## 分析设置

顶栏「分析设置」打开面板，可配置：

| 项目 | 说明 |
|---|---|
| 分析来源 | `DSH 已配置的模型`（默认）或 `外部接口服务` |
| Provider / 模型 | 留空则跟随 DSH 默认模型 |
| 接口地址 / API Key / 模型名 | 仅外部来源；OpenAI 兼容 chat completions |
| 分析提示词 | 可编辑角色描述；`VERDICT/EVIDENCE/NEXT` 输出格式由程序固定附加 |
| 送给分析的内容 | 任务目标、项目目录、工具参数、工具输出四项开关，以及条数与截断长度 |
| 调用参数 | 最大输出 tokens、temperature、超时 |

- 「测试连接」只发一句探测文本，不发送任何聊天内容；失败会回退到之前的设置。
- 「预览将发送的内容」完整展示系统提示词与用户消息，使用外部服务前可先确认。
- 保存设置不会触发分析；分析仍只由「分析一下」发起。
- API Key 只保存在 Host，通过 `/api/dsh-focusing.settings` 返回时替换为 `hasApiKey` 标记。

## 结构

```
lib/detector.mjs    纯检测器：指纹、滑窗、评分（无依赖，可单测）
lib/correction.mjs  纠偏文案生成
lib/index.mjs       Host：事件折叠、pre-step 注入、pre-execute 拦截、子代理诊断、面板路由
lib/client.js       Client：工作台（首页 / 结果 / 记录 / 报告）+ 专注纠偏面板
lib/time-range.mjs  时间范围解析（纯函数）
lib/context-records.mjs  会话日志 → 上下文记录、按范围切片、统计（纯函数）
lib/record-index.mjs     跨会话索引与缓存（读 sessionPersistence / sessionQuery / sessions）
lib/digest.mjs      整理提示词、预算打包、JSON 解析校验、草稿、Markdown 导出
lib/digest-store.mjs     整理结果持久化
lib/review-store.mjs     单会话分析持久化 + 「此后有无新进展」统计
lib/roster.mjs           专注纠偏名单：未加载会话、折叠缓存、外部模型列表
lib/room.mjs             协作室：快照、发言/交接提示词（纯函数）
lib/room-routes.mjs      协作室路由与存储
lib/complete.mjs    通用模型调用（Host 模型或外部接口）
lib/context-routes.mjs   工作台路由
tests/              node --test tests/*.test.mjs
```

## 调试

```bash
node --test tests/*.test.mjs
node --check lib/index.mjs && node --check lib/client.js
dsh --profile "$DSH_PROFILE" --dump-config | grep focusing
```
