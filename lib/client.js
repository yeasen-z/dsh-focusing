// Focusing: context & session workbench (records, digests) plus the original
// single-session focus panel. Real session data only; no simulated results.
window.__ModuleLoader__.load({
  id: 'dsh-focusing',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'dsh-focusing';
    const ROUTE = '/api/dsh-focusing.state';
    const ROUTE_ANALYZE = '/api/dsh-focusing.analyze';
    const ROUTE_EXPORT = '/api/dsh-focusing.export';
    const ROUTE_SETTINGS = '/api/dsh-focusing.settings';
    const ROUTE_PREVIEW = '/api/dsh-focusing.preview';
    const TEXT = {
      zh: {
        panel:'Focusing', tagline:'给编程任务，一个全局视角。', sessionsTitle:'会话', search:'搜索聊天或项目', sessions:'观察中的会话',
        liveData:'真实会话数据 · 含未加载的历史会话',rosterAll:'全部',rosterReviewed:'有分析记录',recentSessions:'最近使用',archivedTag:'已归档',codexSource:'Codex 会话',codexReadOnly:'只读，来自 Codex',orderHint:'顺序在打开时固定',refreshOrder:'刷新',refreshOrderHint:'重新读取最新内容，并按最近活动重新排序',rosterFilter:'筛选会话',reviewedMark:'有 {n} 次分析记录',notLoaded:'未加载，只读历史',noReviewed:'还没有分析过的会话',fetchModels:'获取模型列表',fetchingModels:'获取中…',fetchModelsFailed:'获取模型列表失败',fetchedModels:'共 {n} 个模型，可直接选择或手动输入',externalModelHint:'可点击「获取模型列表」从接口读取，也可直接输入模型名。',noCatalogHint:'没有从 DSH 读到可用模型（模型服务不可用或尚未配置供应商），所以只能手动输入模型名；留空则跟随 DSH 默认模型。', workspace:'工作空间', observe:'仅观察，不干预', intervene:'干预已配置', refresh:'刷新',
        overview:'概览', activity:'全部活动', diagnoses:'诊断记录', goal:'当前任务目标', noGoal:'本轮尚未捕获任务目标。',
        running:'正在运行', idle:'已空闲', unknown:'状态未知', clues:'有待确认的线索', quiet:'暂未发现异常线索',
        noProof:'规则命中不代表任务已经卡住；需要结合代码改动与执行结果判断。',
        quietNote:'当前观察窗口未命中重复规则。这不是对任务正确性或完成度的判断。', pending:'待独立复核',
        notVerdict:'规则命中 ≠ 已确认卡住', evidence:'查看证据', steps:'本轮步骤', calls:'工具调用', interventions:'已执行干预',
        recent:'最近活动', viewAll:'查看全部', diagnosis:'独立诊断', diagnosisNote:'先理解上下文，再决定是否介入',
        noDiagnosis:'还没有独立诊断',analyzedAt:'分析于',savedNote:'已保存，重启后仍在',trailNone:'此后会话没有新的动作，结论仍然适用',trailMoved:'此后会话又有了新进展，这份结论可能已过期',trailMovedDetail:'新增 {calls} 次工具调用{fail} · {turns} 轮 · {users} 条用户消息 · 最近活动 {last}',trailFail:'（其中 {n} 次失败）',trailUnknown:'无法判断此后是否有新进展',trailRerun:'基于最新记录重新分析',reviewHistory:'更早的分析',stale:'可能已过期',fresh:'仍然适用', notConnected:'点击顶栏「分析一下」读取当前会话记录；只在点击时请求模型。',reviewFailureTitle:'分析未完成',analysisSettings:'分析设置',analysisSettingsHint:'设置分析用的模型、提示词和发给它的内容',analysisSource:'分析来源',sourceHost:'DSH 已配置的模型',sourceExternal:'外部接口服务',sourceHostHint:'复用当前 DSH 已授权的模型，不创建 agent，也不影响聊天用的模型。',sourceExternalHint:'调用 OpenAI 兼容的 chat completions 接口；密钥只保存在本机 Host，不会显示在面板或导出文件里。',endpoint:'接口地址',endpointHint:'完整的 chat completions 地址，例如 https://api.example.com/v1/chat/completions',apiKey:'API Key',apiKeyHint:'保存后不再显示；留空表示沿用已保存的密钥。',externalModel:'接口模型名',model:'模型',modelHint:'这些是 DSH 当前可用的模型；分析不会影响聊天用的模型。',modelFollowDefault:'跟随 DSH 当前默认模型',modelsLoading:'正在读取可用模型…',persona:'分析提示词（角色）',personaHint:'这段文字决定分析者怎么读记录；输出格式（VERDICT/EVIDENCE/NEXT）由程序固定附加，保证结果可解析。',resetPersona:'恢复默认',analysisScope:'送给分析的内容',sessionList:'会话列表',loadArchived:'加载已归档聊天',loadArchivedHint:'关闭时，已归档的聊天不会出现在分析页列表里。归档只是收起来，不会删除聊天。',includeGoal:'包含当前任务目标',includeProject:'包含项目与目录',includeToolArgs:'包含工具参数',includeToolOutput:'包含工具输出',maxActivities:'最多几条工具调用',excerptChars:'每条输出截断字数',advanced:'调用参数',maxTokens:'最大输出 tokens',temperature:'temperature（留空则不发送）',timeoutMs:'超时（毫秒）',saveSettings:'保存设置',testing:'测试中…',testConnection:'测试连接',previewPayload:'预览将发送的内容',previewTitle:'将发送的内容',previewSystem:'系统提示词',previewUser:'用户消息',previewFailed:'预览失败',settingsSaved:'设置已保存。',settingsSaveFailed:'设置保存失败',settingsTestOk:'连接正常',settingsTestFailed:'连接失败',settingsReverted:'已回退到之前的设置',reviewKept:'上一次结论保留在下方。',reviewInvalidResponse:'分析接口返回了无效响应',
        noActivity:'暂时没有工具活动。任务开始执行后，记录会显示在这里。', noSessions:'暂无可观察的会话。打开聊天并开始任务后再刷新。',
        noMatch:'没有匹配的聊天或项目。', loading:'正在读取会话…', error:'无法读取观察数据', retry:'重试',
        failed:'失败', done:'完成', pendingCall:'执行中', incomplete:'未完成', details:'查看调用详情', step:'步', noOutput:'没有可展示的结果摘要。',
        soft:'注入纠偏', hard:'拦截调用', subagent:'独立诊断', unavailable:'该会话当前不可用，请从左侧选择其他聊天。',
        footer:'规则提供线索，独立诊断给出判断。', scope:'仅显示当前选中的会话', metadata:'技术详情',
        noProject:'未指定项目', untitled:'未命名聊天', justNow:'刚刚', minutesAgo:'分钟前', hoursAgo:'小时前',
        'same-call':'重复调用', 'same-failing-result':'同一错误重复出现', 'no-progress':'连续活动缺少新结果', 'step-budget':'步数预算提示',
        recorded:'已记录',saveMd:'存为 Markdown',saveJson:'存为 JSON',saveMdHint:'把这段对话保存成 Markdown 文件',saveJsonHint:'导出结构化 JSON，包含工具调用与结果',runAnalysis:'分析一下',runAnalysisHint:'让一个没有上下文的复核者读这段记录',rerunAnalysis:'重新分析',reviewing:'正在分析…',reviewingNote:'一个没有上下文的复核者正在阅读这条记录，不会改动能你的工作。',reviewStuck:'复核认为有值得注意的地方',reviewNormal:'复核没有发现问题',reviewScope:'仅据本次记录判断',reviewNoAgent:'这个会话当前没有活跃的 agent，无法启动复核。请在聊天运行中再试。',reviewUnsupported:'当前环境没有可用的复核能力。',reviewFailed:'请求失败，请查看下方详情。',reviewBusy:'已经有一个复核在进行中。',reviewTimeout:'复核超时，之前的结论已保留。',reviewEmpty:'复核没有给出结论，之前的结论已保留。',reviewNoLlm:'当前环境没有可用的模型服务，无法发起分析。',reviewNoModel:'没有找到可用的模型，请先在设置里选择一个模型再试。', diagnosisCaution:'以下为实际记录，不将规则权重当作风险概率。', softMode:'软干预', hardMode:'硬干预', childMode:'子代理', on:'开启', off:'关闭',
      },
      en: {
        panel:'Focusing',tagline:'A whole-picture view of coding work.',sessionsTitle:'Sessions',search:'Search chats or projects',sessions:'Observed sessions',
        liveData:'Session data, including unloaded history',rosterAll:'All',rosterReviewed:'With analyses',recentSessions:'Recent',archivedTag:'Archived',codexSource:'Codex sessions',codexReadOnly:'Read-only, from Codex',orderHint:'Order fixed when opened',refreshOrder:'Refresh',refreshOrderHint:'Re-sort and load the latest contents',rosterFilter:'Filter sessions',reviewedMark:'{n} saved analyses',notLoaded:'Not loaded; read-only history',noReviewed:'No analyzed sessions yet',fetchModels:'Fetch model list',fetchingModels:'Fetching…',fetchModelsFailed:'Could not fetch models',fetchedModels:'{n} models; pick one or type a custom id',externalModelHint:'Use Fetch model list to read them from the endpoint, or type a model id.',noCatalogHint:'DSH returned no models (the model service is unavailable or no provider is configured), so type a model id; leave empty to follow the DSH default.',workspace:'Workspace',observe:'Observation only',intervene:'Interventions configured',refresh:'Refresh',
        overview:'Overview',activity:'All activity',diagnoses:'Diagnosis history',goal:'Current task',noGoal:'No task captured for this turn yet.',
        running:'Running',idle:'Idle',unknown:'Unknown',clues:'Signals need a closer look',quiet:'No signals detected',
        noProof:'A rule match is not proof of a loop. Review code changes and execution results first.',
        quietNote:'No repeat rule matched the observation window. This does not assess correctness or completion.',pending:'Awaiting independent review',
        notVerdict:'Rule match ≠ confirmed loop',evidence:'View evidence',steps:'Steps this turn',calls:'Tool calls',interventions:'Interventions',
        recent:'Recent activity',viewAll:'View all',diagnosis:'Independent diagnosis',diagnosisNote:'Understand the context before intervening',
        noDiagnosis:'No independent diagnosis yet',analyzedAt:'Analyzed',savedNote:'Saved; survives restarts',trailNone:'The session has done nothing since, so this conclusion still applies',trailMoved:'The session has moved on since; this conclusion may be out of date',trailMovedDetail:'{calls} new tool calls{fail} · {turns} turns · {users} user messages · last activity {last}',trailFail:' ({n} failed)',trailUnknown:'Cannot tell whether the session moved on',trailRerun:'Analyze again on the latest record',reviewHistory:'Earlier analyses',stale:'May be out of date',fresh:'Still applies',notConnected:'Use Analyze in the top bar to review this session. Model calls run only on request.',reviewFailureTitle:'Analysis did not complete',analysisSettings:'Analysis settings',analysisSettingsHint:'Choose the review model, its prompt, and what it is sent',analysisSource:'Source',sourceHost:'A model DSH already has',sourceExternal:'External endpoint',sourceHostHint:'Reuses a model DSH is already authorized for. No agent is created and your chat model is untouched.',sourceExternalHint:'Calls an OpenAI-compatible chat completions endpoint. The key stays on this machine and never appears in the panel or an export.',endpoint:'Endpoint URL',endpointHint:'The full chat completions URL, e.g. https://api.example.com/v1/chat/completions',apiKey:'API key',apiKeyHint:'Hidden once saved. Leave empty to keep the stored key.',externalModel:'Model name',model:'Model',modelHint:'Models DSH can currently reach. The analysis does not change your chat model.',modelFollowDefault:'Follow the current DSH default',modelsLoading:'Reading available models…',persona:'Reviewer prompt',personaHint:'This text decides how the record is read. The VERDICT/EVIDENCE/NEXT format is appended automatically so the result stays parseable.',resetPersona:'Restore default',analysisScope:'What the reviewer sees',sessionList:'Session list',loadArchived:'Load archived chats',loadArchivedHint:'When off, archived chats stay out of the analysis list. Archiving only puts a chat away; it never deletes one.',includeGoal:'Include the current request',includeProject:'Include project and directory',includeToolArgs:'Include tool arguments',includeToolOutput:'Include tool output',maxActivities:'Max tool calls',excerptChars:'Output excerpt length',advanced:'Call parameters',maxTokens:'Max output tokens',temperature:'Temperature (empty = omit)',timeoutMs:'Timeout (ms)',saveSettings:'Save settings',testing:'Testing…',testConnection:'Test connection',previewPayload:'Preview what is sent',previewTitle:'Request preview',previewSystem:'System prompt',previewUser:'User message',previewFailed:'Preview failed',settingsSaved:'Settings saved.',settingsSaveFailed:'Could not save settings',settingsTestOk:'Connection OK',settingsTestFailed:'Connection failed',settingsReverted:'Reverted to the previous settings',reviewKept:'The previous result is retained below.',reviewInvalidResponse:'Invalid response from the analysis endpoint',
        noActivity:'No tool activity yet. Records will appear when the task starts.',noSessions:'No observed sessions. Start a task in a chat, then refresh.',
        noMatch:'No matching chats or projects.',loading:'Loading sessions…',error:'Unable to load observation data',retry:'Retry',
        failed:'Failed',done:'Completed',pendingCall:'In progress',incomplete:'Incomplete',details:'View call details',step:'Step',noOutput:'No result excerpt available.',
        soft:'Correction injected',hard:'Call blocked',subagent:'Independent diagnosis',unavailable:'This session is unavailable. Select another chat.',
        footer:'Rules surface signals. Independent review provides judgment.',scope:'Only the selected session is shown',metadata:'Technical details',
        noProject:'No project',untitled:'Untitled chat',justNow:'Just now',minutesAgo:'min ago',hoursAgo:'hr ago',
        'same-call':'Repeated call','same-failing-result':'Repeated error','no-progress':'No new result','step-budget':'Step budget notice',
        recorded:'Recorded',saveMd:'Save Markdown',saveJson:'Save JSON',saveMdHint:'Download this conversation as Markdown',saveJsonHint:'Export structured JSON with tool calls and results',runAnalysis:'Analyze',runAnalysisHint:'Have a reviewer with no context read this record',rerunAnalysis:'Analyze again',reviewing:'Analyzing…',reviewingNote:'A reviewer with no context of this conversation is reading the record. It changes nothing in your work.',reviewStuck:'The review found something worth attention',reviewNormal:'The review found nothing wrong',reviewScope:'judged from this record only',reviewNoAgent:'This session has no live agent, so no review can start. Try again while the chat is running.',reviewUnsupported:'No review capability is available here.',reviewFailed:'The request failed. See the details below.',reviewBusy:'A review is already running.',reviewTimeout:'The review timed out. The previous result is kept.',reviewEmpty:'The review returned no conclusion. The previous result is kept.',reviewNoLlm:'No model service is available here, so no analysis can run.',reviewNoModel:'No model could be resolved. Choose one in settings and try again.',diagnosisCaution:'Actual records only. Rule weights are not probabilities.',softMode:'Soft correction',hardMode:'Hard block',childMode:'Subagent',on:'On',off:'Off',
      },
    };
    Object.assign(TEXT.zh,{roleUser:'你',roleAssistant:'助手',toolCalls:'次调用',failed:'次失败',earlierRows:'还有 {n} 条更早的记录未显示，点击显示更多',showAll:'展开全部（共 {n} 字）',showLess:'收起',
      askChats:'对话',askRange:'搜索范围',askR7:'最近 7 天',askR30:'最近 30 天',askRAll:'全部记录',askToday:'今天',askYesterday:'昨天',askOlder:'更早',askMore:'还有 {n} 条',wb_templates:'模板',wb_newTemplate:'新建模板',wb_generate:'生成',wb_tplBuiltin:'内置',wb_tplEmpty:'还没有模板。',
      wb_tplName:'名称',wb_tplNamePh:'模板名称，例如：发布复盘',wb_tplInstruction:'指令',wb_tplInstructionPh:'这个模板要整理什么，例如：总结本周发布相关的改动、风险和阻塞',
      wb_tplSave:'保存',wb_tplCancel:'取消',wb_tplEdit:'编辑',wb_tplView:'查看指令',wb_tplNeedsSession:'在上下文记录中选择一个会话后生成',wb_tplGoRecords:'去上下文记录',
      wb_ask:'问答',wb_grpData:'整理',wb_grpGuard:'守护',askNone:'还没有对话',askEmptyTitle:'问问你的历史',askEmptySub:'跨所有工作区查找：做过什么、花了多久、在哪个会话里。回答只依据真实记录。',
      askFollowPh:'继续追问…',askS1:'上周我在哪个项目上花的时间最多？',askS2:'昨天做了什么？',askS3:'哪些会话改过登录相关的代码？',askS4:'最近一次提到部署是在哪个会话？',
      wb_capAsk:'问答',wb_capAskText:'直接问历史：做过什么、花了多久、在哪个会话。可以接着追问。',
      wb_capRooms:'协作室',wb_capRoomsText:'把 1～4 个会话冻结成快照，让它们交接或对话。',
      wb_recentChats:'最近的对话',wb_noChats:'还没有对话。',wb_history:'历史',
      askPlaceholder:'问问你的历史，例如：上周我在哪个项目上花的时间最多？',askHint:'会查询所有工作区的记录',askSend:'发送',askPick:'选择对话',askNew:'新建对话',
      askStop:'停止',askDelete:'删除',askStarting:'正在思考…',askThinking:'正在查询…',askCalling:'执行中…',askFailed:'没有得到回答',askLost:'任务已不存在',askTruncated:'回答被截断',
      askCancelled:'已停止，保留了已查到的内容',askInterrupted:'没有完成：服务重启中断了它',
    });
    Object.assign(TEXT.en,{roleUser:'You',roleAssistant:'Assistant',toolCalls:'calls',failed:'failed',earlierRows:'{n} earlier rows not shown; click for more',showAll:'Show all ({n} chars)',showLess:'Show less',
      askChats:'Chats',askRange:'Search window',askR7:'Last 7 days',askR30:'Last 30 days',askRAll:'Everything',askToday:'Today',askYesterday:'Yesterday',askOlder:'Earlier',askMore:'{n} more',wb_templates:'Templates',wb_newTemplate:'New template',wb_generate:'Generate',wb_tplBuiltin:'Built-in',wb_tplEmpty:'No templates yet.',
      wb_tplName:'Name',wb_tplNamePh:'Template name, e.g. Release review',wb_tplInstruction:'Instruction',wb_tplInstructionPh:'What should it organize? e.g. summarize this week\'s release changes, risks and blockers',
      wb_tplSave:'Save',wb_tplCancel:'Cancel',wb_tplEdit:'Edit',wb_tplView:'View instruction',wb_tplNeedsSession:'Started from a record, with a session picked there',wb_tplGoRecords:'Open records',
      wb_ask:'Ask',wb_grpData:'Organize',wb_grpGuard:'Guard',askNone:'No conversations yet',askEmptyTitle:'Ask your history',askEmptySub:'Searches every workspace: what you did, how long it took, in which session. Answers rest on real records only.',
      askFollowPh:'Ask a follow-up…',askS1:'Which project took most of my time last week?',askS2:'What did I do yesterday?',askS3:'Which sessions touched the login code?',askS4:'When did I last talk about deploying, and where?',
      wb_capAsk:'Ask',wb_capAskText:'Ask your history directly: what you did, how long, in which session. Keep going with follow-ups.',
      wb_capRooms:'Rooms',wb_capRoomsText:'Freeze 1–4 sessions into snapshots and let them hand off or talk.',
      wb_recentChats:'Recent chats',wb_noChats:'No conversations yet.',wb_history:'History',
      askPlaceholder:'Ask about your history, e.g. which project took most of my time last week?',askHint:'Searches every workspace',askSend:'Send',askPick:'Choose a conversation',askNew:'New chat',
      askStop:'Stop',askDelete:'Delete',askStarting:'Thinking…',askThinking:'Searching…',askCalling:'Running…',askFailed:'No answer',askLost:'The job no longer exists',askTruncated:'answer was cut off',
      askCancelled:'Stopped; what was found is kept',askInterrupted:'Not finished: the Host restarted',
    });
    Object.assign(TEXT.zh,{diagnosis:'分析结论',noDiagnosis:'尚未分析',notConnected:'读取当前会话记录，给出独立判断；不会修改工作内容。',activity:'活动记录',rawReply:'原始回复',reviewEvidence:'证据',reviewNext:'建议下一步',ruleSignals:'规则线索',ruleLabel:'规则检测，未经模型确认',moreActions:'更多操作',timeoutSeconds:'超时（秒）',close:'关闭',reviewNormal:'没有发现明显问题',reviewStuck:'有值得检查的地方',reviewingNote:'正在独立阅读当前会话记录，不会修改工作内容。',previewPayload:'预览已保存的请求',settingsHint:'设置分析模型与阅读方式，不影响聊天模型。'})
    Object.assign(TEXT.zh,{
      providerNoModels:'该来源当前没有模型（可能未登录或未授权）',
      settingsTitle:'设置',settingsSub:'对整个 Focusing 生效，不影响你聊天用的模型。',
      settingsScope1:'整理与报告',settingsScope2:'追问',settingsScope3:'协作室（可逐人覆盖）',settingsScope4:'专注纠偏',
      settingsTabModel:'模型与连接',calTitle:'活动记录',calHint:'每格一天，颜色越深，当天处理的对话越多',calMonths:'1月,2月,3月,4月,5月,6月,7月,8月,9月,10月,11月,12月',calSummary:'{total} 轮对话 · 活跃 {days} 天 · 最长连续 {longest} 天 · 当前连续 {current} 天',calTip:'{turns} 轮对话 · {sessions} 个会话 · {calls} 次工具调用',calNone:'没有记录',calDsh:'DSH',calCodex:'Codex',calExternal:'包括外部导入的会话',calExternalHint:'把导入的 Codex 会话也算进来',calExternalHintOff:'勾选后会开启 Codex 导入，并把它们算进来',calExternalOff:'勾选后会同时开启 Codex 导入（只读）。',calGoSettings:'去设置',calExternalBroken:'Codex 目录有问题，没有统计到外部会话。',calExternalCount:'其中 {n} 轮来自 Codex',calFailed:'读取活动记录失败',calLess:'少',calMore:'多',settingsTabSources:'数据来源',sourceDsh:'DSH 会话',sourceCodex:'Codex 会话',codexEnable:'导入 Codex 会话',codexEnableHint:'读取本机 Codex（桌面版、CLI、VS Code 扩展）保存的会话记录，只读，不会修改它们。',codexWhere:'会话位置',codexAuto:'自动发现',codexManual:'手动填写',codexPath:'Codex 目录',codexAutoHint:'依次查找 CODEX_HOME 和 ~/.codex。',codexChipLabel:'Codex 会话',showingArchived:'含已归档聊天 · 可在设置中更改',hidingArchived:'不含已归档聊天 · 可在设置中更改',codexOff:'未导入',codexOn:'已加载 {n} 个',codexSet:'已设置',codexUnset:'未设置',settingsOpen:'设置',codexProblem:'找不到会话',codexSaveToCheck:'保存后检查',codexNoPath:'还没有填写目录',codexMissing:'目录不存在',codexNotCodex:'这里没有 sessions 或 archived_sessions 文件夹',codexNotFound:'没有找到 Codex 目录',codexUnreadable:'目录无法读取',settingsTabFocus:'专注纠偏的内容',
      settingsChipHint:'整理、追问、协作室、专注纠偏共用的模型',
      settingsKeyNote:'密钥只保存在本机，不会显示在页面或导出文件里；只有你主动发起整理、发言或分析时才会调用模型。',
      settingsDirty:'有未保存的更改',settingsClean:'没有未保存的更改',saving:'正在保存…',cancel:'取消',close:'关闭',
      apiKeyStored:'•••••••• 已保存；留空表示不修改',notSent:'留空则不发送',notTested:'未测试',
      testSentNothing:'只发送了一句测试，没有带任何会话内容',loadPreview:'预览',previewBtnHint:'查看实际会发出去的提示词',previewFailed:'预览失败：请先打开一个会话',
    });
    Object.assign(TEXT.en,{diagnosis:'Analysis',noDiagnosis:'Not analyzed yet',notConnected:'Read this session for an independent assessment. Your work stays unchanged.',activity:'Activity',rawReply:'Original reply',reviewEvidence:'Evidence',reviewNext:'Suggested next step',ruleSignals:'Rule signals',ruleLabel:'Rule detection · not confirmed by a model',moreActions:'More actions',timeoutSeconds:'Timeout (seconds)',close:'Close',reviewNormal:'No clear issue found',reviewStuck:'Something worth checking',previewPayload:'Preview saved request',settingsHint:'Choose a reviewer without changing your chat model.'});
    const CSS = `
.fz-host{position:relative;display:flex;flex:1;min-width:0;min-height:0;height:100%;overflow:hidden;container-type:inline-size}
.fz{--bg:var(--dsw-alias-bg-base);--paper:var(--dsw-alias-bg-layer-1);--ink:var(--dsw-alias-label-primary);--muted:var(--dsw-alias-label-secondary);--line:var(--dsw-alias-border-l1);--hover:var(--dsw-alias-bg-layer-2);--blue:var(--dsw-alias-brand-primary);--green:var(--dsw-alias-state-success-primary);--amber:var(--dsw-alias-state-warn-primary);--red:var(--dsw-alias-state-error-primary);position:absolute;inset:0;display:grid;grid-template-columns:minmax(0,1fr);overflow:hidden;background:var(--bg);color:var(--ink);font-family:inherit;font-size:13px;line-height:1.65;container-type:inline-size}
.fz *{box-sizing:border-box}.fz button,.fz input,.fz textarea{font:inherit}.fz button{cursor:pointer;color:inherit}.fz button:disabled{opacity:.5;cursor:default}.fz input:focus,.fz textarea:focus,.fz select:focus,.fz input:focus-visible,.fz textarea:focus-visible,.fz select:focus-visible{outline:none!important;box-shadow:none!important;border-color:inherit!important}
.fz button:focus-visible,.fz summary:focus-visible{outline:2px solid var(--blue);outline-offset:3px}.fz svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}.fz p{line-height:1.8}.fz summary{cursor:pointer}.fz pre{font:12px/1.75 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:320px;overflow:auto;background:var(--bg);padding:12px;border:1px solid var(--line);border-radius:6px;color:var(--muted);margin:8px 0}
.fz-side-title{font-size:13px;font-weight:600;color:var(--ink);padding:2px 10px 12px}.fz-side{position:absolute;top:0;bottom:0;left:0;z-index:20;width:320px;max-width:calc(100% - 32px);background:var(--dsw-specific-sidebar-fill);border-right:1px solid var(--line);box-shadow:0 12px 32px rgba(0,0,0,.28);padding:18px 12px;overflow:auto;transform:translateX(-102%);transition:transform .18s ease;visibility:hidden}.fz-side.open{transform:none;visibility:visible}.fz-scrim{position:absolute;inset:0;z-index:19;background:rgba(0,0,0,.18);opacity:0;pointer-events:none;transition:opacity .18s ease}.fz-scrim.open{opacity:1;pointer-events:auto}.fz-drawer-btn{display:flex;align-items:center;gap:10px;min-width:0;border:1px solid var(--line);background:var(--paper);color:var(--ink);border-radius:8px;padding:6px 10px;font-size:13px;font-weight:550}.fz-drawer-btn:hover{background:var(--hover)}.fz-drawer-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:42ch}.fz-drawer-icon{color:var(--muted)}
[data-platform=darwin] .fz-side{padding-top:var(--dsh-frame-top-clearance,48px)}.fz-brand{font-size:17px;font-weight:650;padding:0 10px}.fz-brand span{color:var(--blue)}.fz-tagline{font-size:12px;color:var(--muted);padding:3px 10px 18px}.fz-search{display:flex;align-items:center;gap:8px;border:1px solid var(--line);background:var(--bg);padding:7px 10px;border-radius:6px;color:var(--muted)}.fz-search input{border:0;background:none;color:var(--ink);width:100%;min-width:0;outline:none;font-size:12px}.fz-side-label{padding:20px 8px 8px;display:flex;justify-content:space-between;font-size:12px;color:var(--muted)}.fz-group{margin:2px 0 12px}.fz-session.archived{opacity:.7}.fz-archived-tag{flex-shrink:0;font-size:10.5px;line-height:1;padding:3px 6px;border-radius:4px;border:1px solid var(--line);color:var(--muted);background:var(--bg)}.fz-recent{margin:2px 0 14px}.fz-recent-head{cursor:default}.fz-source-section{margin-top:18px;padding-top:12px;border-top:1px dashed var(--line)}.fz-source-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:0 4px 6px}.fz-source-name{font-size:11.5px;font-weight:600;color:var(--muted);letter-spacing:.02em}.fz-source-note{font-size:10.5px;color:var(--muted)}.fz-codex-group .fz-group-name{color:var(--ink)}.fz-recent-cards{display:flex;flex-direction:column;gap:6px;margin-top:6px}.fz-recent-card{display:flex;flex-direction:column;gap:3px;align-items:stretch;text-align:left;width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--paper);color:var(--ink)}.fz-recent-card:hover{background:var(--hover)}.fz-recent-card.selected{border-color:var(--blue);box-shadow:inset 3px 0 0 var(--blue)}.fz-recent-card-title{font-size:13px;font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fz-recent-card-meta{font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fz-recent-card.unloaded .fz-recent-card-title{color:var(--muted)}.fz-recent-card .fz-archived-tag{align-self:flex-start;margin-top:2px}.fz-order-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:4px 0 6px}.fz-order-hint{font-size:11px;color:var(--muted)}.fz-order-refresh{border:1px solid var(--line);background:var(--paper);color:var(--ink);border-radius:6px;padding:3px 9px;font-size:11.5px}.fz-order-refresh:hover{background:var(--hover)}.fz-source-line{font-size:11.5px;color:var(--muted);margin:0 2px 10px}.fz-archive-switch{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--muted);margin:0 2px 10px;cursor:pointer}.fz-archive-switch input{accent-color:var(--blue)}.fz-recent-label{flex:1;text-align:left;font-weight:600;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fz-group-head{display:flex;align-items:center;gap:7px;width:100%;background:none;border:0;padding:6px 8px;border-radius:6px;color:var(--muted)!important;font-size:12px}.fz-group-head:hover,.fz-session:hover{background:var(--hover)}.fz-group-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;font-weight:550}.fz-group-count,.fz-session-time{font-size:11px;color:var(--muted)}.fz-caret{width:0;height:0;border-left:4px solid currentColor;border-top:3px solid transparent;border-bottom:3px solid transparent;transform:rotate(90deg)}.fz-caret.closed{transform:none}.fz-group-body{display:flex;flex-direction:column;gap:2px;margin-left:8px;padding-left:7px;border-left:1px solid var(--line)}.fz-session{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:0;border-radius:6px;background:none;padding:7px 8px;font-size:13px}.fz-session.selected{background:var(--hover);box-shadow:inset 2px 0 0 var(--blue)}.fz-session-title{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.fz-dot{display:inline-block;width:6px;height:6px;background:var(--green);border-radius:50%;flex-shrink:0}.fz-dot.idle{background:var(--muted)}.fz-dot.error{background:var(--red)}.fz-side-foot{border-top:1px solid var(--line);margin:24px 8px 0;padding-top:12px;font-size:11px;color:var(--muted)}
.fz-main{overflow:auto;min-width:0;min-height:0}.fz-topbar{min-height:54px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:10px 28px;gap:12px}.fz-crumb{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fz-crumb span{color:var(--ink);margin-left:8px}.fz-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}.fz-mode{font-size:11px;color:var(--muted);margin-right:6px}.fz-save-btn,.fz-run-btn,.fz-icon-btn{border:1px solid var(--line);background:var(--paper);color:var(--ink);border-radius:6px;padding:6px 11px;font-size:12px;white-space:nowrap}.fz-icon-btn{display:grid;place-items:center;padding:6px}.fz-save-btn:hover,.fz-icon-btn:hover{background:var(--hover)}.fz-save-btn.primary{background:var(--dsw-alias-brand-primary);color:var(--bg);border-color:var(--dsw-alias-brand-primary)}.fz-save-btn.active{border-color:var(--dsw-alias-brand-primary)}.fz-text-btn{padding:0;border:0;background:none;color:var(--blue)!important;font-size:12px}.fz-roster-filter{display:flex;gap:4px;margin:10px 0 2px}.fz-filter-btn{flex:1;border:1px solid var(--line);background:none;border-radius:6px;padding:3px 6px;font-size:11.5px;color:var(--muted)}.fz-filter-btn.active{background:var(--hover);color:var(--ink);border-color:var(--muted)}.fz-filter-count{margin-left:4px;font-size:10.5px;opacity:.8}.fz-session.unloaded .fz-session-title{color:var(--muted)}.fz-reviewed-mark{font-size:8px;color:var(--blue);margin:0 4px;flex-shrink:0}.fz-ext-model{display:flex;flex-direction:column;gap:6px}.fz-trail{margin-top:10px;padding:8px 12px;border-radius:8px;font-size:12px;background:var(--hover);color:var(--muted)}.fz-trail.stale{background:color-mix(in srgb,var(--amber) 14%,transparent);color:var(--ink)}.fz-trail.fresh b{color:var(--green)}.fz-trail.stale b{color:var(--amber)}.fz-content{max-width:940px;margin:auto;padding:28px 36px 24px}.fz h2{margin:0 0 8px;font-size:20px;font-weight:600;line-height:1.5;overflow-wrap:anywhere}.fz-meta{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12px}.fz-tabs{display:flex;gap:24px;border-bottom:1px solid var(--line);margin-top:20px}.fz-tab{background:none;border:0;border-bottom:2px solid transparent;padding:11px 0;font-size:13px;color:var(--muted)!important}.fz-tab.active{color:var(--ink)!important;border-color:var(--ink);font-weight:550}.fz-count{font-size:11px;margin-left:6px;color:var(--muted)}.fz-pane{padding-top:24px}.fz-section-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px}.fz-section-head h3{margin:0;font-size:13px;font-weight:600}.fz-section-head>span{font-size:12px;color:var(--muted)}.fz-diagnosis{margin-bottom:28px}.fz-empty-card{border:1px solid var(--line);border-radius:8px;padding:18px;color:var(--muted);font-size:13px}.fz-empty-card b{display:block;color:var(--ink);font-weight:550;margin-bottom:5px}.fz-record{border:1px solid var(--line);border-radius:8px;padding:18px;background:var(--paper);margin-bottom:10px}.fz-record.review{border-left:3px solid var(--green)}.fz-record.review.stuck{border-left-color:var(--amber)}.fz-record h4{font-size:14px;margin:0 0 10px;font-weight:550}.fz-record p{font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 10px}.fz-record small{display:block;margin-top:14px;font-size:12px;color:var(--muted)}.fz-review-section{margin:14px 0}.fz-review-section b{display:block;font-size:12px;color:var(--muted);font-weight:500;margin-bottom:4px}.fz-raw summary{font-size:12px;color:var(--muted)}.fz-empty-card.review-error{border-left:3px solid var(--amber)}.fz-empty-card.review-error b{color:var(--amber)}.fz-goal{margin-bottom:20px}.fz-goal b{display:block;font-size:12px;color:var(--muted);font-weight:500;margin-bottom:6px}.fz-goal p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;max-height:150px;overflow:auto}.fz-rules{border-block:1px solid var(--line);padding:12px 0;margin-bottom:12px}.fz-rules>summary{font-size:13px;font-weight:500}.fz-rule-count{margin-left:12px;color:var(--muted);font-size:12px;font-weight:400}.fz-note{font-size:12px;color:var(--muted)}.fz-signal{margin:12px 0;font-size:12px}.fz-statline{color:var(--muted);font-size:12px;margin-bottom:24px}.fz-msg{display:grid;grid-template-columns:minmax(0,1fr);gap:2px;padding:8px 0;border-bottom:1px solid var(--line)}
.fz-msg-head{display:flex;justify-content:space-between;gap:10px;font-size:11px;color:var(--muted)}
.fz-msg-role{font-weight:600}.fz-msg.user .fz-msg-role{color:var(--ink)}.fz-msg.assistant .fz-msg-role{color:var(--muted)}
.fz-msg-text{border:0;background:none;padding:0;text-align:left;font-size:13px;line-height:1.6;color:var(--ink);cursor:pointer;min-width:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.fz-msg-text.open{display:block;-webkit-line-clamp:unset;line-clamp:unset;overflow:visible;white-space:pre-wrap;word-break:break-word;cursor:pointer}
.fz-run{border:1px solid var(--line);border-radius:8px;margin:6px 0}
.fz-run>summary{display:flex;align-items:center;gap:8px;padding:7px 10px;font-size:12px;color:var(--muted);cursor:pointer;list-style:none}
.fz-run>summary::-webkit-details-marker{display:none}
.fz-caret{margin-left:auto;font-size:10px}
.fz-run-body{border-top:1px solid var(--line);padding:6px 10px;display:grid;gap:4px}
.fz-call>summary{display:grid;grid-template-columns:8px auto minmax(0,1fr);align-items:baseline;gap:8px;font-size:12px;cursor:pointer;list-style:none;padding:2px 0}
.fz-call>summary::-webkit-details-marker{display:none}
.fz-call-name{color:var(--ink);white-space:nowrap}
.fz-earlier{display:block;width:100%;border:1px dashed var(--line);background:none;color:var(--muted);font-size:12px;padding:8px;margin:0 0 6px;border-radius:8px;cursor:pointer}
.fz-more{border:0;background:none;color:var(--muted);font-size:11px;cursor:pointer;padding:0 0 6px 16px;text-decoration:underline}
.fz-call-target{font:11px/1.6 ui-monospace,monospace;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fz-call>div>pre{margin:4px 0 4px 16px;max-height:320px;overflow:auto;white-space:pre-wrap;word-break:break-word;font:11px/1.6 ui-monospace,monospace;color:var(--muted);background:var(--bg-soft,rgba(127,127,127,.08));border-radius:6px;padding:8px 10px}
.fz-event{display:grid;grid-template-columns:42px 10px minmax(0,1fr) auto;gap:10px;min-height:60px;font-size:13px}.fz-event time{color:var(--muted);font:11px/26px ui-monospace,monospace}.fz-track{position:relative;display:flex;justify-content:center;padding-top:10px}.fz-track:after{content:'';position:absolute;width:1px;background:var(--line);top:19px;bottom:0}.fz-event:last-child .fz-track:after{display:none}.fz-event-body{min-width:0}.fz-event-target{display:block;font:12px/1.8 ui-monospace,monospace;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fz-event-state{font-size:11px;color:var(--muted);padding-top:3px}.fz-event-state.error{color:var(--red)}.fz-event summary{font-size:12px;color:var(--muted)}.fz-event details{margin:3px 0 12px}.fz-footer{margin-top:28px;border-top:1px solid var(--line);padding-top:14px;display:flex;justify-content:space-between;gap:12px;color:var(--muted);font-size:11px}.fz-technical{margin-top:20px;color:var(--muted);font-size:12px}.fz-settings{display:flex;gap:12px;font-size:12px}.fz-error{border:1px solid var(--red);padding:12px;border-radius:6px;margin-bottom:16px;color:var(--red)}.fz-error button{margin-left:12px}.fz-empty{padding:28px 12px;color:var(--muted);font-size:13px;text-align:center}
.fz-export{position:relative}.fz-export>summary{list-style:none;font-size:20px;line-height:24px;padding:2px 9px;border-radius:6px}.fz-export>summary::-webkit-details-marker{display:none}.fz-export[open]>summary{background:var(--hover)}.fz-export-menu{position:absolute;right:0;top:36px;z-index:5;min-width:160px;padding:5px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--line);border-radius:8px}.fz-export-menu button{display:block;width:100%;border:0;background:none;text-align:left;padding:8px 10px;font-size:12px;border-radius:4px}.fz-export-menu button:hover{background:var(--hover)}
.fz-drawer-layer{position:absolute;inset:0;z-index:10;display:flex;justify-content:flex-end}.fz-drawer-backdrop{position:absolute;inset:0;border:0;background:color-mix(in srgb,var(--bg) 72%,transparent);cursor:pointer!important}.fz-drawer{position:relative;width:min(480px,100%);height:100%;background:var(--paper);border-left:1px solid var(--line);overflow:auto;overscroll-behavior:contain;padding:24px}.fz-settings-panel>.fz-section-head{position:sticky;top:-24px;background:var(--paper);padding:16px 0;z-index:2;margin-top:-16px}.fz-settings-panel>.fz-section-head h3{font-size:16px}.fz-field-group{border-top:1px solid var(--line);padding:18px 0}.fz-group-title{font-size:13px;font-weight:550;margin-bottom:12px}.fz-field{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}.fz-field-label,.fz-field-hint{font-size:12px;color:var(--muted)}.fz-field-hint{line-height:1.7;margin:0}.fz-input,.fz-textarea{width:100%;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink);padding:8px 10px;min-width:0}.fz-input:focus,.fz-textarea:focus{border-color:var(--blue)}.fz-textarea{font:12px/1.8 ui-monospace,SFMono-Regular,Menlo,monospace;resize:vertical;min-height:170px}.fz-radio-row,.fz-check-grid{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:10px}.fz-radio-row{background:var(--bg);padding:8px;border:1px solid var(--line);border-radius:6px}.fz-check{display:flex;align-items:center;gap:7px;font-size:12px;cursor:pointer}.fz-check input{accent-color:var(--blue)}.fz-check-grid{display:grid;grid-template-columns:1fr 1fr}.fz-field-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 16px;margin-top:14px}.fz-inline-actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:12px}.fz-connection-test{display:flex;justify-content:flex-end;margin:-5px 0 16px}.fz-save-note{font-size:12px;color:var(--muted);overflow-wrap:anywhere}.fz-drawer-footer{position:sticky;bottom:-24px;background:var(--paper);border-top:1px solid var(--line);padding:16px 0;margin-bottom:-16px;z-index:1;flex-direction:row-reverse;justify-content:space-between}.fz-preview{margin-top:24px}.fz-preview b{display:block;font-size:12px;margin-top:14px;color:var(--muted)}
@container(max-width:760px){.fz{grid-template-columns:minmax(0,1fr)}.fz-content{padding:24px}.fz-topbar{padding:10px 20px}.fz-mode{display:none}.fz-session-time{display:none}}
@container(max-width:560px){.fz-side{width:min(320px,calc(100% - 24px))}.fz-side-label,.fz-side-foot{display:none}.fz-search{margin:0 0 8px}.fz-topbar{padding:8px 16px}.fz-crumb{max-width:100px}.fz-content{padding:20px 16px}.fz-drawer{padding:20px;width:100%}.fz-footer{display:block}.fz-field-grid{gap:0 10px}.fz h2{font-size:18px}}
`;
    /** Sidebar glyph: a loop with an arrow leaving it (the original artwork). */
    function FocusingIcon() {
      return h('svg',{
        viewBox:'0 0 24 24',width:18,height:18,fill:'none',stroke:'currentColor',
        strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true,
      },
        h('path',{d:'M9.5 5.5a6 6 0 1 0 3.5 11'}),
        h('path',{d:'M15 4.5h4.5V9'}),
        h('path',{d:'M19.5 4.5 13 11'}),
      );
    }
    function Icon({name}) {
      const paths={focus:['M8 3H4v4m12-4h4v4M4 17v4h4m12-4v4h-4'],search:['M15 15l5 5'],refresh:['M20 11a8 8 0 1 0-2 6','M20 4v7h-7'],check:['m6 12 4 4 8-9'],diamond:['m12 3 9 9-9 9-9-9Z','M12 8v5m0 3h.01']};
      return h('svg',{viewBox:'0 0 24 24','aria-hidden':true},...(paths[name]||paths.focus).map((d,i)=>h('path',{d,key:i})),name==='focus'?h('circle',{cx:12,cy:12,r:5}):null,name==='search'?h('circle',{cx:10,cy:10,r:6}):null);
    }
    const textOf = v => typeof v === 'string' ? v : '';
    const ROUTE_EXTERNAL_MODELS='/api/dsh-focusing.external-models';
    /**
     * Which sessions the person can see. Archived chats keep their Workspace
     * slot -- that is how unarchiving restores their position -- so they arrive
     * in the roster like any other, and only the setting decides what is shown.
     */
    const visibleSessions=(list,showArchived)=>showArchived?list:list.filter(s=>!s.archived);
    /** The roster order at a moment: newest first. Only captured, never re-derived by a poll. */
    const orderOf=(list,showArchived)=>visibleSessions(list,showArchived).slice().sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).map(s=>s.id);

    // Long output shows its first part and an ellipsis; one click shows it all.
    function Panel({t,subscribeLocale,openSettings,onModelSummary,onCodexStatus}) {
      const page=wbPageLoad();
      const [data,setData]=React.useState(null), [sessions,setSessions]=React.useState([]);
      const [picked,setPicked]=React.useState(page.picked), [query,setQuery]=React.useState(page.rosterQuery);
      const [tab,setTab]=React.useState(page.rosterTab), [error,setError]=React.useState(''), [tick,setTick]=React.useState(0);
      const [busy,setBusy]=React.useState(false), [reviewError,setReviewError]=React.useState('');
      const [reviewDetail,setReviewDetail]=React.useState('');
      const [,setLocaleTick]=React.useState(0);
      const [preview,setPreview]=React.useState(null);
      const [previewError,setPreviewError]=React.useState('');
      const [modelSummary,setModelSummary]=React.useState(null);
      // Which message rows are open in full. Declared here on purpose: tests stub
      // useState by hook order, so everything after it keeps its place.
      const [expanded,setExpanded]=React.useState(new Set());
      const toggleRow=key=>setExpanded(prev=>{const next=new Set(prev);if(next.has(key))next.delete(key);else next.add(key);return next;});
      const analysisRequest=React.useRef(null);
      const selectedId=React.useRef(picked);selectedId.current=picked;
      React.useEffect(()=>()=>{analysisRequest.current?.abort();},[]);
      React.useEffect(()=>subscribeLocale(()=>setLocaleTick(n=>n+1)),[subscribeLocale]);
      React.useEffect(()=>{
        const controller=new AbortController();let timer;
        async function load(){
          try{
            const response=await fetch(picked?`${ROUTE}?session=${encodeURIComponent(picked)}`:ROUTE,{signal:controller.signal,credentials:'same-origin'});
            if(!response.ok)throw new Error(`HTTP ${response.status}`);
            const body=await response.json();if(controller.signal.aborted)return;
            const list=Array.isArray(body.sessions)?body.sessions.filter(s=>s&&typeof s==='object'&&typeof s.id==='string'):null;
            if(list){
              setSessions(list);
              // First load, or an explicit refresh: take the order now. Later
              // polls only update contents, never this order.
              if(!orderTaken.current){orderTaken.current=true;setOrderSnapshot(orderOf(list,body.analysis?.loadArchived===true));}
            }
            setError('');
            if(body.settingsSummary){setModelSummary(body.settingsSummary);onModelSummary?.(body.settingsSummary);}
            if(body.codexStatus)onCodexStatus?.(body.codexStatus);
            const showArchived=body.analysis?.loadArchived===true;
            if(body.analysis)setLoadArchived(showArchived);
            if(picked)setData(body);
            else if(list){
              // The setting arrives in this same response, so pick from the list
              // it describes: never open on a chat the roster will not show.
              const first=visibleSessions(list,showArchived)[0];
              if(first)setPicked(first.id);
            }
          }catch(e){if(!controller.signal.aborted)setError(e.message);}
          finally{if(!controller.signal.aborted)timer=setTimeout(load,3500);}
        }
        load();return()=>{controller.abort();clearTimeout(timer);};
      },[picked,tick]);
      async function runAnalysis(){
        if(!picked||busy||analysisRequest.current||data?.analyzing)return;
        const session=picked;
        const controller=new AbortController();analysisRequest.current=controller;
        const timer=setTimeout(()=>controller.abort(),90000);
        setBusy(true);setReviewError('');setReviewDetail('');setTab('overview');
        try{
          const res=await fetch(ROUTE_ANALYZE,{method:'POST',credentials:'same-origin',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({session})});
          let body;
          try{body=await res.json();}catch{throw new Error(`HTTP ${res.status}: ${t('reviewInvalidResponse')}`);}
          if(selectedId.current!==session)return;
          if(!res.ok||!body.ok){
            setReviewError(body.reason||'failed');
            setReviewDetail(body.detail||`HTTP ${res.status}${body.reason?` · ${body.reason}`:''}`);
          }else if(body.review){
            setData(previous=>previous?.session===session?{...previous,review:body.review,reviewTrail:body.reviewTrail??null,reviewHistory:body.reviewHistory||[],analyzing:false}:previous);
          }else{throw new Error(t('reviewInvalidResponse'));}
        }catch(e){
          if(selectedId.current===session){
            setReviewError(controller.signal.aborted?'timeout':'failed');
            setReviewDetail(controller.signal.aborted?t('reviewTimeout'):String(e?.message||e));
          }
        }finally{
          clearTimeout(timer);analysisRequest.current=null;
          setBusy(false);setTick(n=>n+1);
        }
      }
      // Save the conversation straight from the Host: the response is a file,
      // so the browser downloads it and the panel never holds the transcript.
      function saveChatLog(format){
        if(!picked)return;
        const url=`${ROUTE_EXPORT}?session=${encodeURIComponent(picked)}&format=${format}`;
        const link=document.createElement('a');
        link.href=url;
        link.download='';
        link.rel='noopener';
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
      async function loadPreview(){
        if(!picked)return;
        setPreviewError('');
        try{
          const res=await fetch(`${ROUTE_PREVIEW}?session=${encodeURIComponent(picked)}`,{credentials:'same-origin'});
          const body=await res.json();
          if(!body.ok){setPreviewError(t('previewFailed'));return;}
          setPreview(body);
        }catch(e){setPreviewError(e.message);}
      }
      function relative(at){if(!at)return '—';const n=Math.max(0,Math.floor((Date.now()-at)/60000));return n<1?t('justNow'):n<60?`${n} ${t('minutesAgo')}`:`${Math.floor(n/60)} ${t('hoursAgo')}`;}
      function clock(at){return at?new Date(at).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}):'—';}
      const selected=sessions.find(s=>s.id===picked);
      // Never display the previous chat while the next request is in flight.
      const current=data?.session===picked?data:null;
      const signals=current?.signals||[];
      const activity=current?.activity||current?.recent||[];
      const events=current?.events||[];
      const diagnoses=events.filter(e=>e.kind==='subagent');
      const flags=current?.config||{};
      const interventions=events.filter(e=>e.kind==='soft'||e.kind==='hard').length;
      // Group by workspace the way the host's own sidebar does: one heading per
      // project, its chats nested underneath, so a long flat list never appears.
      // Groups start collapsed; opening one is remembered.
      const [expandedGroups,setExpandedGroups]=React.useState(page.expandedGroups);
      // Added after `collapsed` on purpose: tests stub useState by hook order.
      const [rosterFilter,setRosterFilter]=React.useState(page.rosterFilter);
      // Whether archived chats are listed. Declared last on purpose: tests stub
      // useState by hook order, so earlier indices must not shift.
      const [loadArchived,setLoadArchived]=React.useState(false);
      // The roster's order as of the last open or refresh. Held in state so a
      // poll cannot change it; replaced only by the refresh button.
      const [orderSnapshot,setOrderSnapshot]=React.useState([]);
      const [orderStamp,setOrderStamp]=React.useState(0);
      // The session list is a drawer over the content, opened from the topbar.
      // Declared last so earlier hook indices do not shift.
      const [drawerOpen,setDrawerOpen]=React.useState(false);
      // The same page memory the workbench uses: this panel unmounts too.
      React.useEffect(()=>{wbPageSave({picked,rosterTab:tab,rosterQuery:query,rosterFilter,expandedGroups});},[picked,tab,query,rosterFilter,expandedGroups]);
      const toggleGroup=key=>setExpandedGroups(c=>({...c,[key]:!c[key]}));
      const orderTaken=React.useRef(false);
      // Refresh: re-read the contents now and take a new order from them. This is
      // the only way the order changes.
      const refreshOrder=()=>{setOrderSnapshot(orderOf(sessions,loadArchived));setOrderStamp(n=>n+1);setTick(n=>n+1);};
      const visible=visibleSessions(sessions,loadArchived);
      // A remembered session can be gone by the time you come back, or hidden
      // because it was archived since. Fall back to the first one the person can
      // actually see, rather than leaving the panel on an invisible session --
      // the guard needs `loadArchived`, so it lives below the roster, not above.
      React.useEffect(()=>{
        const shown=visibleSessions(sessions,loadArchived);
        if(!shown.length)return;
        if(picked&&shown.some(s=>s?.id===picked))return;
        setPicked(shown[0].id);
      },[sessions,picked,loadArchived]);
      const filtered=visible.filter(s=>(rosterFilter!=='reviewed'||s.reviewed)&&`${s.title||''} ${s.project||''} ${s.cwd||''}`.toLowerCase().includes(query.toLowerCase()));
      const rank=id=>{const i=orderSnapshot.indexOf(id);return i<0?Number.MAX_SAFE_INTEGER:i;};
      // DSH chats and Codex chats are shown apart: they come from different tools,
      // and a Codex chat has no live DSH session behind it.
      const dshFiltered=filtered.filter(s=>s.source!=='codex');
      const codexFiltered=filtered.filter(s=>s.source==='codex');
      const grouped=(()=>{
        const map=new Map();
        for(const s of dshFiltered){
          const key=s.project||s.cwd||'';
          if(!map.has(key))map.set(key,{key,name:s.project||t('noProject'),path:s.cwd||'',items:[]});
          map.get(key).items.push(s);
        }
        for(const g of map.values())g.items.sort((a,b)=>rank(a.id)-rank(b.id));
        return [...map.values()].sort((a,b)=>rank(a.items[0]?.id)-rank(b.items[0]?.id));
      })();
      const codexGrouped=(()=>{
        const map=new Map();
        for(const s of codexFiltered){
          const key=s.project||s.cwd||'';
          if(!map.has(key))map.set(key,{key,name:s.project||t('noProject'),path:s.cwd||'',items:[]});
          map.get(key).items.push(s);
        }
        return [...map.values()].sort((a,b)=>(b.items[0]?.updatedAt||0)-(a.items[0]?.updatedAt||0));
      })();
      // The order is fixed until the person asks for a refresh. Sorting by age on
      // every poll made a running chat jump around; the rows still update in place.
      const ordered=[...filtered].sort((a,b)=>rank(a.id)-rank(b.id)||(b.updatedAt||0)-(a.updatedAt||0));
      // The three most recently used are taken once, from the snapshot, not by
      // re-sorting, so the pinned list cannot reshuffle either.
      const recent=ordered.filter(s=>s.source!=='codex').slice(0,3);
      const choose=id=>{selectedId.current=id;setPicked(id);setData(null);setReviewError('');setReviewDetail('');setDrawerOpen(false);};
      const sessionRow=s=>h('button',{className:`fz-session${s.id===picked?' selected':''}${s.loaded===false?' unloaded':''}${s.archived?' archived':''}`,key:s.id,onClick:()=>choose(s.id),'aria-pressed':s.id===picked,title:`${s.source==='codex'?`${s.title||t('untitled')} · ${t('codexReadOnly')}`:s.loaded===false?`${s.title||t('untitled')} · ${t('notLoaded')}`:s.title||t('untitled')}${s.archived?` · ${t('archivedTag')}`:''}`},h('span',{className:`fz-dot${s.status==='running'?'':' idle'}`}),h('span',{className:'fz-session-title'},s.title||t('untitled')),s.reviewed?h('span',{className:'fz-reviewed-mark',title:t('reviewedMark').replace('{n}',String(s.reviewCount||1)),'aria-label':t('reviewedMark').replace('{n}',String(s.reviewCount||1))},'◆'):null,s.archived?h('span',{className:'fz-archived-tag'},t('archivedTag')):null,h('span',{className:'fz-session-time'},relative(s.updatedAt)));
      // A recent session is a card: title first, then where it lives and how old it is.
      const recentCard=s=>h('button',{className:`fz-recent-card${s.id===picked?' selected':''}${s.loaded===false?' unloaded':''}${s.archived?' archived':''}`,key:s.id,type:'button',onClick:()=>choose(s.id),'aria-pressed':s.id===picked,title:s.loaded===false?`${s.title||t('untitled')} · ${t('notLoaded')}`:s.title||t('untitled')},
        h('span',{className:'fz-recent-card-title'},s.title||t('untitled')),
        h('span',{className:'fz-recent-card-meta'},[s.project,relative(s.updatedAt)].filter(Boolean).join(' · ')),
        s.reviewed?h('span',{className:'fz-reviewed-mark',title:t('reviewedMark').replace('{n}',String(s.reviewCount||1)),'aria-label':t('reviewedMark').replace('{n}',String(s.reviewCount||1))},'◆'):null,
        s.archived?h('span',{className:'fz-archived-tag'},t('archivedTag')):null);
      const sectionHead=(title,right)=>h('div',{className:'fz-section-head'},h('h3',null,title),right);
      const empty=message=>h('div',{className:'fz-empty'},message);

      const recordList=list=>list.length?h('div',null,...list.slice().reverse().map((e,i)=>h('article',{className:'fz-record',key:`${e.at}-${i}`},h('h4',null,t(e.kind)),h('p',null,e.detail||t('recorded')),h('small',null,clock(e.at))))):null;

      // Host reasons map to sentences the person can act on. A raw code like
      // "no-live-agent" would mean nothing in the panel.
      const REVIEW_REASON={'no-live-agent':'reviewNoAgent','unavailable':'reviewUnsupported','no-provider':'reviewUnsupported','failed':'reviewFailed','busy':'reviewBusy','no-session':'reviewNoAgent','timeout':'reviewTimeout','empty':'reviewEmpty','no-llm':'reviewNoLlm','no-model':'reviewNoModel',};
      // The saved manual review, shown exactly as recorded: a first read of the
      // same activity, not a verdict about the person's work.
      // Full date + time: a saved analysis can be days old, so a bare clock is ambiguous.
      function stamp(at){
        if(!at)return '—';const d=new Date(at),n=new Date();
        const hm=d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
        if(d.toDateString()===n.toDateString())return hm;
        const sameYear=d.getFullYear()===n.getFullYear();
        return `${sameYear?`${d.getMonth()+1}/${d.getDate()}`:d.toLocaleDateString()} ${hm}`;
      }
      // What the session did after the analysis read it, so a saved conclusion
      // is never mistaken for the current state.
      const trailNote=()=>{
        const trail=current?.reviewTrail;
        if(!trail)return h('div',{className:'fz-trail unknown'},t('trailUnknown'));
        if(!trail.moved)return h('div',{className:'fz-trail fresh'},h('b',null,t('fresh')),' · ',t('trailNone'));
        const fail=trail.failures?t('trailFail').replace('{n}',String(trail.failures)):'';
        const detail=t('trailMovedDetail').replace('{calls}',String(trail.toolCalls)).replace('{fail}',fail).replace('{turns}',String(trail.turns)).replace('{users}',String(trail.userMessages)).replace('{last}',stamp(trail.lastAt));
        return h('div',{className:'fz-trail stale'},h('b',null,t('stale')),' · ',t('trailMoved')+'：'+detail,
          h('button',{className:'fz-text-btn',type:'button',style:{marginLeft:8},disabled:busy||!!current?.analyzing,onClick:runAnalysis},t('trailRerun')));
      };
      const historyList=()=>{
        const older=current?.reviewHistory||[];
        if(!older.length)return null;
        return h('details',{className:'fz-raw'},h('summary',null,`${t('reviewHistory')} (${older.length})`),
          ...older.map((r,i)=>h('div',{key:i,style:{margin:'8px 0'}},h('b',null,`${r.stuck?t('reviewStuck'):t('reviewNormal')}`),h('small',{style:{marginLeft:8}},stamp(r.at)),h('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},r.reason))));
      };
      const reviewCard=()=>{
        const review=current?.review;
        const analyzing=busy||current?.analyzing;
        if(analyzing)return h('div',{className:'fz-empty-card'},h('b',null,t('reviewing')),t('reviewingNote'));
        const failure=reviewError?h('div',{className:'fz-empty-card review-error',role:'alert'},
          h('b',null,t('reviewFailureTitle')),
          h('p',null,t(REVIEW_REASON[reviewError]||'reviewFailed')),
          reviewDetail?h('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},reviewDetail):null,
          review?h('small',null,t('reviewKept')):null):null;
        if(!review)return failure||h('div',{className:'fz-empty-card'},h('b',null,t('noDiagnosis')),t('notConnected'));
        return h(React.Fragment,null,failure,h('article',{className:`fz-record review ${review.stuck?'stuck':'normal'}`},
          h('h4',null,review.stuck?t('reviewStuck'):t('reviewNormal')),
          ...(()=>{
            const raw=review.reason||'';
            const evidence=/(?:^|\n)EVIDENCE:\s*([\s\S]*?)(?=\nNEXT:|$)/i.exec(raw)?.[1]?.trim();
            const next=/(?:^|\n)NEXT:\s*([\s\S]*)$/i.exec(raw)?.[1]?.trim();
            const summary=raw.replace(/^\s*VERDICT:\s*(?:NORMAL|STUCK)\s*\n?/i,'').split(/\n(?:EVIDENCE|NEXT):/i)[0].trim();
            return [summary&&!/^EVIDENCE:|^NEXT:/i.test(summary)?h('p',{key:'summary'},summary):null,
              evidence?h('div',{className:'fz-review-section',key:'evidence'},h('b',null,t('reviewEvidence')),h('p',null,evidence)):null,
              next?h('div',{className:'fz-review-section',key:'next'},h('b',null,t('reviewNext')),h('p',null,next)):null,
              h('details',{className:'fz-raw',key:'raw'},h('summary',null,t('rawReply')),h('pre',null,raw))];
          })(),
          h('small',null,`${t('analyzedAt')} ${stamp(review.at)} · ${review.calls||0} ${t('calls')} · ${review.model||t('reviewScope')} · ${t('savedNote')}`),
          trailNote(),
          historyList()));
      };
      // Rows: what the person and the assistant said, and between them the tool
      // calls folded into one collapsed run. Text is stored whole; a message
      // shows two lines and opens on click, a call's output opens on demand.
      const callRow=(a,i)=>{
        const failed=a.failed||a.status==='error'||a.status==='failed';
        const name=a.name||a.tool||'—';
        const target=a.command||a.cmd||a.path||a.file||'';
        const out=textOf(a.output)||textOf(a.result)||'';
        return h('details',{className:'fz-call',key:a.id||`c${i}`},
          h('summary',null,h('i',{className:`fz-dot${failed?' error':''}`}),h('span',{className:'fz-call-name'},a.description||name),h('span',{className:'fz-call-target',title:target},target)),
          h(CallOutput,{head:target||name,out:out||t('noOutput'),t}));
      };
      const activityRows=()=>{
        const rows=[];let run=[];
        const flush=()=>{
          if(!run.length)return;
          const calls=run;run=[];
          const failedN=calls.filter(a=>a.failed||a.status==='error'||a.status==='failed').length;
          const live=calls.some(a=>['pending','running'].includes(a.status));
          rows.push(h('details',{className:'fz-run',key:`run${rows.length}`,open:live},
            h('summary',null,h('i',{className:`fz-dot${failedN?' error':''}`}),h('span',null,`${calls.length} ${t('toolCalls')}${failedN?` · ${failedN} ${t('failed')}`:''}`),h('span',{className:'fz-caret','aria-hidden':true},'▸')),
            h('div',{className:'fz-run-body'},...calls.map(callRow))));
        };
        activity.forEach((a,i)=>{
          if(a.kind==='message'){
            flush();
            const key=`m${i}-${a.time||''}`;const open=expanded.has(key);
            rows.push(h('article',{className:`fz-msg ${a.role==='user'?'user':'assistant'}`,key},
              h('div',{className:'fz-msg-head'},h('span',{className:'fz-msg-role'},t(a.role==='user'?'roleUser':'roleAssistant')),h('time',null,clock(a.time||a.at))),
              h('button',{type:'button',className:`fz-msg-text${open?' open':''}`,'aria-expanded':open,onClick:()=>toggleRow(key)},a.text||'')));
          }else run.push(a);
        });
        flush();
        return rows;
      };
      const timeline=(all)=>{
        if(!activity.length)return h('div',{className:'fz-empty-card'},t('noActivity'));
        const rows=activityRows();
        return all?h(RowWindow,{rows,t}):h('div',null,...rows.slice(-4));
      };
      const previewBlock=()=>h(React.Fragment,null,previewError?h('p',{className:'fz-save-note',role:'alert'},previewError):null,preview?h('details',{className:'fz-preview',open:true},h('summary',null,`${t('previewTitle')} · ${preview.model}`),h('b',null,t('previewSystem')),h('pre',null,preview.system),h('b',null,t('previewUser')),h('pre',null,preview.user)):null);
      const diagnosisBlock=h('section',{className:'fz-diagnosis'},sectionHead(t('diagnosis'),h('span',{className:'fz-inline-actions',style:{margin:0}},h('button',{className:'fz-text-btn',type:'button',disabled:!picked,onClick:loadPreview,title:t('previewPayload')},t('previewPayload')),h('button',{className:'fz-save-btn primary',type:'button',disabled:!picked||busy||!!current?.analyzing,onClick:runAnalysis,title:t('runAnalysisHint')},busy||current?.analyzing?t('reviewing'):t(current?.review?'rerunAnalysis':'runAnalysis')))),previewBlock(),reviewCard(),recordList(diagnoses));
      let body;
      if((reviewError||busy)&&!current)body=empty(t('loading'));
      else if(!current)body=empty(picked?t('loading'):sessions.length?t('loading'):t('noSessions'));
      else if(!current.live&&!current.id)body=empty(t('unavailable'));
      else if(tab==='activity')body=h(React.Fragment,null,sectionHead(t('activity'),null),timeline(true));
      
      else body=h(React.Fragment,null,
        h('section',{className:'fz-goal'},h('b',null,t('goal')),h('p',null,current.goal||t('noGoal'))),
        h('details',{className:'fz-rules'},h('summary',null,t('ruleSignals'),h('span',{className:'fz-rule-count'},signals.length?String(signals.length):t('quiet'))),
          h('p',{className:'fz-note'},t('ruleLabel')),
          signals.length?signals.map((signal,i)=>h('div',{className:'fz-signal',key:i},h('b',null,t(signal.kind)),h('p',null,signal.label||signal.kind))):h('p',{className:'fz-note'},t('quietNote'))),
        h('div',{className:'fz-statline'},`${current.turnSteps||0} ${t('steps')} · ${current.toolCalls??activity.filter(a=>a.kind!=='message').length} ${t('calls')} · ${interventions} ${t('interventions')}`),
        sectionHead(t('recent'),h('button',{className:'fz-text-btn',onClick:()=>setTab('activity')},t('viewAll'),' →')),timeline(false),
        h('details',{className:'fz-technical'},h('summary',null,t('metadata')),h('pre',null,`${picked}\n${current.cwd||selected?.cwd||''}`),h('div',{className:'fz-settings'},...[[t('softMode'),flags.soft],[t('hardMode'),flags.hard],[t('childMode'),flags.subagent]].map(([label,on])=>h('span',{key:label},`${label} · ${t(on?'on':'off')}`)))));
      return h('div',{className:'fz'},h('style',null,CSS),
        h('div',{className:`fz-scrim${drawerOpen?' open':''}`,onClick:()=>setDrawerOpen(false),'aria-hidden':true}),
        h('aside',{className:`fz-side${drawerOpen?' open':''}`,'aria-label':t('sessionsTitle')},h('div',{className:'fz-side-title'},t('sessionsTitle')),h('label',{className:'fz-search'},h(Icon,{name:'search'}),h('input',{value:query,onChange:e=>setQuery(e.target.value),placeholder:t('search'),'aria-label':t('search')})),h('div',{className:'fz-source-line'},t(loadArchived?'showingArchived':'hidingArchived')),h('div',{className:'fz-order-bar'},h('span',{className:'fz-order-hint'},t('orderHint')),h('button',{type:'button',className:'fz-order-refresh',onClick:refreshOrder,title:t('refreshOrderHint')},t('refreshOrder'))),h('div',{className:'fz-roster-filter',role:'group','aria-label':t('rosterFilter')},...[['all','rosterAll'],['reviewed','rosterReviewed']].map(([k,label])=>h('button',{key:k,type:'button',className:`fz-filter-btn${rosterFilter===k?' active':''}`,'aria-pressed':rosterFilter===k,onClick:()=>setRosterFilter(k)},t(label),k==='reviewed'?h('span',{className:'fz-filter-count'},String(visible.filter(s=>s.reviewed).length)):null))),h('div',{className:'fz-side-label'},h('span',null,t('sessions')),h('span',null,String(filtered.length).padStart(2,'0'))),h('div',{className:'fz-sessions'},recent.length?h('section',{className:'fz-group fz-recent',key:'__recent__'},h('div',{className:'fz-group-head fz-recent-head'},h('span',{className:'fz-recent-label'},t('recentSessions')),h('span',{className:'fz-group-count'},String(recent.length))),h('div',{className:'fz-recent-cards'},...recent.map(recentCard))):null,...grouped.map(g=>h('section',{className:'fz-group',key:g.key},h('button',{className:'fz-group-head',type:'button',onClick:()=>toggleGroup(g.key),'aria-expanded':expandedGroups[g.key]===true},h('span',{className:`fz-caret${expandedGroups[g.key]?'':' closed'}`}),h('span',{className:'fz-group-name'},g.name),h('span',{className:'fz-group-count'},String(g.items.length))),expandedGroups[g.key]?h('div',{className:'fz-group-body'},...g.items.map(sessionRow)):null)),codexGrouped.length?h('section',{className:'fz-source-section',key:'__codex__'},h('div',{className:'fz-source-head'},h('span',{className:'fz-source-name'},t('codexSource')),h('span',{className:'fz-source-note'},t('codexReadOnly'))),...codexGrouped.map(g=>h('section',{className:'fz-group fz-codex-group',key:'codex:'+g.key},h('button',{className:'fz-group-head',type:'button',onClick:()=>toggleGroup('codex:'+g.key),'aria-expanded':expandedGroups['codex:'+g.key]===true},h('span',{className:`fz-caret${expandedGroups['codex:'+g.key]?'':' closed'}`}),h('span',{className:'fz-group-name'},g.name),h('span',{className:'fz-group-count'},String(g.items.length))),expandedGroups['codex:'+g.key]?h('div',{className:'fz-group-body'},...g.items.map(sessionRow)):null))):null,!filtered.length&&query?empty(t('noMatch')):!filtered.length&&rosterFilter==='reviewed'?empty(t('noReviewed')):null),h('div',{className:'fz-side-foot'},t('liveData'))),
        h('section',{className:'fz-main'},h('header',{className:'fz-topbar'},h('button',{className:'fz-drawer-btn',type:'button','aria-expanded':drawerOpen,onClick:()=>setDrawerOpen(o=>!o),title:t('sessionsTitle')},h('span',{className:'fz-drawer-icon'},'☰'),h('span',{className:'fz-drawer-name'},current?.title||selected?.title||t('sessionsTitle'))),h('div',{className:'fz-crumb'},t('workspace'),h('span',null,'/ ',current?.project||selected?.project||'—')),h('div',{className:'fz-actions'},h('span',{className:'fz-mode'},t(flags.soft||flags.hard?'intervene':'observe')),h('details',{className:'fz-export'},h('summary',{'aria-label':t('moreActions'),title:t('moreActions')},'···'),h('div',{className:'fz-export-menu'},h('button',{type:'button',disabled:!picked,onClick:()=>saveChatLog('md')},t('saveMd')),h('button',{type:'button',disabled:!picked,onClick:()=>saveChatLog('json')},t('saveJson')))))),
          h('div',{className:'fz-content'},error?h('div',{className:'fz-error',role:'alert'},t('error'),` · ${error}`,h('button',{className:'fz-text-btn',onClick:()=>setTick(n=>n+1)},t('retry'))):null,h('h2',null,current?.title||selected?.title||t('panel')),h('div',{className:'fz-meta'},h('i',{className:`fz-dot${(current?.status||selected?.status)==='running'?'':' idle'}`}),t(current?.status||selected?.status||'unknown'),' / ',current?.project||selected?.project||t('noProject'),' / ',relative(current?.updatedAt||selected?.updatedAt)),h('nav',{className:'fz-tabs','aria-label':t('overview')},...['overview','activity'].map(key=>h('button',{className:`fz-tab${tab===key?' active':''}`,key,onClick:()=>setTab(key),'aria-current':tab===key?'page':undefined},t(key),key==='overview'?null:h('span',{className:'fz-count'},String(key==='activity'?activity.length:diagnoses.length))))),h('div',{className:'fz-pane'},diagnosisBlock,body),h('footer',{className:'fz-footer'},h('span',null,t('footer')),h('span',{title:t('settingsChipHint')},modelSummary?.label?`${t('settingsChipLabel')} · ${modelSummary.label}`:t('scope'))))));
    }
    // ======================================================================
    // Context workbench (v2): home / digest result / records / digests, with
    // the original single-session panel kept as the "专注纠偏" module.
    // ======================================================================
    const OUT_HEAD=1200;
    function CallOutput({head,out,t}){
      const [full,setFull]=React.useState(false);
      const long=out.length>OUT_HEAD;
      const shown=full||!long?out:out.slice(0,OUT_HEAD)+'…';
      return h('div',null,
        h('pre',null,head+'\n\n'+shown),
        long?h('button',{type:'button',className:'fz-more',onClick:()=>setFull(!full)},full?t('showLess'):t('showAll').replace('{n}',String(out.length))):null);
    }
    // A long session has hundreds of rows. Show the latest batch and say plainly
    // that the rest is not shown; each click reveals another batch.
    const ROW_BATCH=40;
    function RowWindow({rows,t}){
      const [limit,setLimit]=React.useState(ROW_BATCH);
      const hidden=Math.max(0,rows.length-limit);
      const visible=hidden?rows.slice(rows.length-limit):rows;
      return h('div',null,
        hidden?h('button',{type:'button',className:'fz-earlier',onClick:()=>setLimit(n=>n+ROW_BATCH)},'… '+t('earlierRows').replace('{n}',String(hidden))):null,
        ...visible);
    }
    // ---- ask about your history ------------------------------------------------
    // A conversation is a message list the plugin keeps itself. The Ask page shows
    // it as a thread: what was asked, the tool calls folded into one run, then the
    // answer. A tool result is paired with its call by toolCallId.
    function convTurns(messages){
      const turns=[];let pending=null;
      for(const m of messages||[]){
        if(m.role==='user'){pending=null;turns.push({kind:'user',text:(m.content||[]).map(b=>b.text||'').join('')});continue;}
        if(m.role==='assistant'){
          const text=(m.content||[]).filter(b=>b.type==='text').map(b=>b.text||'').join('');
          const calls=(m.content||[]).filter(b=>b.type==='tool-call').map(b=>({id:b.id,name:b.name,arguments:b.arguments}));
          // Tool-only model rounds are one logical run: aggregate repeated search/read
          // cycles into a single disclosure instead of stacking one card per round.
          if(calls.length&& !text && pending?.kind==='assistant'&&!pending.text&&pending.calls.length){pending.calls.push(...calls);continue;}
          pending={kind:'assistant',text,calls};
          turns.push(pending);continue;
        }
        if(m.role==='tool'&&pending){const call=pending.calls.find(c=>c.id===m.toolCallId);if(call){call.result=(m.content||[]).map(b=>b.text||'').join('');if(m.isError)call.failed=true;}continue;}
      }
      return turns;
    }
    function callTarget(c){
      try{const a=typeof c.arguments==='string'?JSON.parse(c.arguments||'{}'):(c.arguments||{});return Object.entries(a).map(([k,v])=>k+'='+(typeof v==='string'?v:JSON.stringify(v))).join(' ');}
      catch{return String(c.arguments||'');}
    }
    // Several tool calls are one collapsed row; opening it lists each call, and
    // each call opens to its output.
    function callRun(calls,t,open){
      const fails=calls.filter(c=>c.failed).length;
      return h('details',{className:'fz-run',open},
        h('summary',null,h('i',{className:'fz-dot'+(fails?' error':'')}),h('span',null,calls.length+' '+t('toolCalls')+(fails?' · '+fails+' '+t('failed'):'')),h('span',{className:'fz-caret','aria-hidden':true},'▸')),
        h('div',{className:'fz-run-body'},...calls.map((c,k)=>{
          const target=callTarget(c);
          return h('details',{className:'fz-call',key:c.id||k},
            h('summary',null,h('i',{className:'fz-dot'+(c.failed?' error':'')}),h('span',{className:'fz-call-name'},c.name),h('span',{className:'fz-call-target',title:target},target)),
            h(CallOutput,{head:c.name+(target?' '+target:''),out:c.result??(c.status==='running'?t('askCalling'):t('noOutput')),t}));
        })));
    }
    // The thread only: the title, the delete button and the input belong to the page.
    function ChatView({conv,t}){
      const turns=convTurns(conv.messages);
      const running=conv.status==='running';
      const live=(conv.steps||[]).filter(x=>x.kind==='call');
      return h('div',{className:'fw-thread'},
        ...turns.map((turn,i)=>{
          if(turn.kind==='user')return h('div',{key:i,className:'fw-msg-user'},turn.text);
          return h('div',{key:i,className:'fw-msg-ai'},
            turn.calls.length?callRun(turn.calls,t,turn.calls.some(c=>c.result===undefined)):null,
            turn.text?h(Md,{text:turn.text}):null);
        }),
        running?h('div',{className:'fw-ask-status',role:'status'},live.length?t('askThinking'):t('askStarting')):null,
        running&&live.length?h('div',{className:'fw-msg-ai'},callRun(live,t,true)):null,
        conv.status==='cancelled'?h('div',{className:'fw-ask-status'},t('askCancelled')):null,
        conv.status==='interrupted'?h('div',{className:'fw-ask-status'},t('askInterrupted')):null,
        conv.status==='failed'?h('div',{className:'fw-ask-error',role:'alert'},t('askFailed')+(conv.detail?': '+conv.detail:'')):null,
        conv.model&&!running?h('div',{className:'fw-ask-model'},conv.truncated?t('askTruncated')+' · '+conv.model:conv.model):null);
    }
    // ---- conversations ---------------------------------------------------------
    // Asked conversations are kept on the Host (disk); this module-level store is
    // only the page's view of them. It outlives the Workbench component, because
    // visiting another sidebar entry unmounts that, and it keeps polling any
    // conversation whose turn is still running. One conversation is active at a
    // time; sending without an id starts a new one.
    // The template list changes rarely, so a revisit paints the last one at once
    // and refreshes it quietly. Seeded by tests through Workbench.tplSeed.
    let tplCache=null;
    const tplCacheGet=()=>tplCache;
    const tplCachePut=list=>{tplCache=list;};
    // The window a question may search. Not the whole archive by default: an
    // unbounded sweep of every workspace is slow and tends to answer vaguely.
    const ASK_RANGES=[['last-7d','askR7'],['last-30d','askR30'],['all','askRAll']];
    const askStore=(()=>{
      let list=[];let timer=null;let loaded=false;let loading=null;const subs=new Set();
      let activeId=null;
      let rangeKey='last-30d';
      const emit=()=>{subs.forEach(fn=>{try{fn();}catch{}});};
      const patch=(id,fn)=>{list=list.map(c=>c.id===id?fn(c):c);};
      async function poll(){
        const ids=list.filter(c=>c.status==='running').map(c=>c.id);
        for(const id of ids){
          try{
            const b=await getJson(WB.ask+'?id='+encodeURIComponent(id));
            if(b.ok)patch(id,()=>b.ask);else patch(id,c=>({...c,status:'failed',detail:'lost'}));
          }catch{/* try again on the next tick */}
        }
        if(ids.length)emit();
        schedule();
      }
      function schedule(){
        const running=list.some(c=>c.status==='running');
        if(running&&!timer)timer=setInterval(poll,900);
        else if(!running&&timer){clearInterval(timer);timer=null;}
      }
      // History comes from the Host, newest activity first.
      function load(){
        if(loading)return loading;
        loading=getJson(WB.ask).then(b=>{
          if(b.ok&&Array.isArray(b.asks)){
            const local=list.filter(c=>String(c.id).startsWith('x'));
            const have=new Set(b.asks.map(c=>c.id));
            const fresh=list.filter(c=>!String(c.id).startsWith('x')&&!have.has(c.id));
            list=[...local,...fresh,...b.asks];loaded=true;emit();schedule();
          }
        }).catch(()=>{}).finally(()=>{loading=null;});
        return loading;
      }
      return{
        get:()=>list,
        active:()=>list.find(c=>c.id===activeId),
        activeId:()=>activeId,
        subscribe:fn=>{subs.add(fn);if(!loaded)load();schedule();return()=>{subs.delete(fn);};},
        newChat(){activeId=null;emit();},
        range:()=>rangeKey,
        setRange(key){rangeKey=ASK_RANGES.some(([k])=>k===key)?key:rangeKey;emit();},
        pick(id){activeId=id;const c=list.find(x=>x.id===id);if(c?.range)rangeKey=c.range;emit();},
        reload:load,
        // Continue the active conversation; with none active, start a new one.
        async send(question){
          try{
            const body={question,offset:-new Date().getTimezoneOffset(),range:rangeKey};
            if(activeId&&!String(activeId).startsWith('x'))body.id=activeId;
            const b=await getJson(WB.ask,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
            if(b.ok){
              list=[b.ask,...list.filter(c=>c.id!==b.ask.id)];
              activeId=b.ask.id;
            }else list=[{id:'x'+Date.now(),title:question,status:'failed',steps:[],messages:[{role:'user',content:[{type:'text',text:question}]}],detail:b.detail||b.reason||'failed',createdAt:Date.now()},...list];
          }catch(error){list=[{id:'x'+Date.now(),title:question,status:'failed',steps:[],messages:[{role:'user',content:[{type:'text',text:question}]}],detail:String(error.message||error),createdAt:Date.now()},...list];}
          emit();schedule();
        },
        // Stop ends the current turn but keeps the conversation.
        async stop(id){
          try{await getJson(WB.ask,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'stop',id})});}catch{/* already over */}
          poll();
        },
        // Delete forgets the conversation, here and on the Host.
        async remove(id){
          if(activeId===id)activeId=null;
          list=list.filter(c=>c.id!==id);emit();schedule();
          if(!String(id).startsWith('x'))try{await getJson(WB.ask,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'delete',id})});}catch{/* already gone */}
        },
        // Seed the view directly (used by tests; the Host is the source of truth).
        seed:next=>{list=next;loaded=true;emit();},
      };
    })();
    const WB = {
      digest: '/api/dsh-focusing.digest', digests: '/api/dsh-focusing.digests',
      records: '/api/dsh-focusing.records', detail: '/api/dsh-focusing.records/detail', activity: '/api/dsh-focusing.activity', ask: '/api/dsh-focusing.ask', templates: '/api/dsh-focusing.templates',
      followup: '/api/dsh-focusing.followup', exportMd: '/api/dsh-focusing.digest-export',
      rooms: '/api/dsh-focusing.rooms', room: '/api/dsh-focusing.room', models: '/api/dsh-focusing.models',
    };
    Object.assign(TEXT.zh,{
      wb_discussion:'讨论',wb_discussionHint:'每位参与者只在你点名时发言；都基于各自冻结的快照',wb_rooms:'协作室',wb_roomsTitle:'协作室',wb_roomsSub:'把 1～4 个会话冻结成快照，放进一个新的协作空间：让它们交接、对话，或用不同模型各抒己见。原会话只读，不会被写入任何内容。',
      wb_newRoom:'新建协作室',wb_roomTopic:'目的（可选）',wb_roomTopicPh:'例如：后端接口已完成，和前端会话对齐字段并约定下一步',wb_pickSessions:'选择会话（1～4 个，可重复选同一会话配不同模型）',
      wb_roomModel:'发言模型',wb_followSettings:'跟随分析设置',wb_externalRoute:'外部接口',wb_createRoom:'冻结快照并创建',wb_creating:'正在冻结快照…',wb_noRooms:'还没有协作室',
      wb_participants:'参与者',wb_snapshotAt:'快照于',wb_sourceMoved:'源会话此后又有 {calls} 次工具调用、{turns} 轮',wb_sourceSame:'源会话此后无新动作',wb_sourceUnknown:'无法判断源会话此后的变化',wb_resnap:'重新快照',
      wb_roomEmpty:'还没有发言。点下方「让 A 发言」开始，或先以主持人身份说明要讨论什么。',wb_moderator:'我（主持）',wb_sayPh:'以主持人身份发言：提问、纠正、指定议题…',wb_sayOnly:'只记录发言',
      wb_letSpeak:'让 {label} 发言',wb_roundAll:'轮流一轮',wb_speaking:'{label} 正在组织发言…',wb_cancel:'停止',wb_handoffBrief:'生成交接简报',wb_handoffBusy:'正在写交接简报…',
      wb_handoffTitle:'交接简报',wb_handoffHint:'将作为新会话的第一条消息。打开后只放入输入框，由你检查后再发送。',wb_openNew:'在新会话中打开（草稿）',wb_opened:'已放入新会话的输入框，请检查后发送',wb_draftNote:'模型未完成，下面是不经模型的原始交接材料',
      wb_readonlyNote:'只读快照 · 原会话不受影响',wb_removeMsg:'删除这条',wb_resnapNote:'{label} 已重新快照',wb_roomDelete:'删除协作室',wb_roomMsgs:'{n} 条发言',wb_pickHint:'从最近 30 天的会话中选择',wb_needSession:'至少选择一个会话',
      wb_sub:'你的 context · session 管家',wb_home:'工作台',wb_caps:'能力',wb_records:'上下文记录',wb_digests:'整理与报告',wb_focus:'专注纠偏',wb_settings:'设置',
      wb_heroTitle:'你的工作上下文',wb_heroSub:'Focusing 汇集所有会话的记录：可以问、可以查、可以整理成报告。',
      wb_scope:'范围',wb_rangeAuto:'按指令自动判断',
            wb_capTitle:'能力模块',wb_capHint:'更多能力会陆续加入',wb_capDigest:'整理与报告',wb_capDigestText:'把散落在多个会话里的工作，整理成周报、日报或交接文档。',
      wb_capRecords:'上下文记录',wb_capRecordsText:'全部会话的上下文档案：请求、改动、结论与待办，可按时间检索。',wb_capFocus:'专注纠偏',wb_capFocusText:'观察单个会话是否原地打转，必要时发起独立分析。',
      wb_recent:'最近的整理结果',wb_viewAll:'查看全部',wb_noRecent:'还没有整理结果。',
      wb_liveStats:'{range}：{sessions} 个会话 · {projects} 个项目 · 活跃 {days} 天',
      wb_back:'返回',wb_copy:'复制 Markdown',wb_download:'下载',wb_regen:'重新生成',wb_delete:'删除',wb_copied:'已复制为 Markdown',wb_deleted:'已删除',
      wb_stageScan:'扫描范围内的会话记录',wb_stageFold:'提取每个会话的请求、改动与结论',wb_stageModel:'由模型归纳进度、风险与下一步',wb_stageDone:'生成结果',
      wb_found:'找到 {sessions} 个会话 · {calls} 次工具调用',wb_elapsed:'已用 {s} 秒',
      wb_draftTitle:'模型没有给出归纳，下面是根据记录直接生成的结构草稿',wb_openSettings:'去设置模型',wb_emptyRange:'这个时间范围内没有找到你的会话记录。换一个范围试试。',
      wb_statSessions:'涉及会话',wb_statProjects:'项目',wb_statDays:'活跃天数',wb_statCalls:'工具调用',
      wb_byProject:'按项目的进度',wb_byProjectHint:'进度由模型依据会话记录判断',wb_byDay:'按天回顾',wb_next:'建议的下一步',wb_sources:'数据来源',wb_sourcesHint:'点击打开原会话',
      wb_done:'完成',wb_doing:'进行',wb_risk:'风险',st_done:'已完成',st_active:'进行中',st_blocked:'受阻',st_paused:'暂停',
      wb_followTitle:'基于这份结果追问',wb_followHint:'追问只引用这份结果涉及的会话',wb_followPh:'例如：哪件事最接近收尾？还差什么？',wb_follow:'追问',wb_you:'你',wb_failedReq:'请求失败',
      wb_failed:'整理失败',wb_retry:'重试',wb_model:'模型',wb_draft:'草稿',
      wb_recTitle:'上下文记录',wb_recSub:'每个会话沉淀为一份上下文档案：你问了什么、改了什么、结论是什么。',wb_search:'搜索标题、项目或内容',wb_allProjects:'全部项目',wb_workspaceFilter:'工作区',wb_allWorkspaces:'全部工作区',
      wb_recStats:'{sessions} 个会话 · {turns} 轮 · {calls} 次工具调用',wb_noRecords:'这个范围内没有会话记录。',wb_loading:'正在读取…',
      wb_turns:'轮',wb_calls:'次调用',wb_failedCalls:'次失败',wb_unfinished:'未结束',wb_running:'运行中',wb_asked:'你问过',wb_lastReply:'最后的结论',wb_files:'改动的文件',wb_todos:'待办清单',
      wb_openSession:'打开会话',wb_handoff:'生成交接文档',wb_handoffReq:'把「{title}」的上下文整理成交接文档：目标、当前状态、关键文件、未解决问题和下一步',
      wb_digTitle:'整理与报告',wb_digSub:'所有由指令生成的整理结果都保存在这里，重启后仍在。',wb_noDigests:'还没有整理结果。',wb_generating:'生成中',
      k_weekly:'周报',k_daily:'日报',k_handoff:'交接',k_analysis:'分析',k_digest:'整理',
      r_today:'今天',r_yesterday:'昨天','r_this-week':'本周','r_last-week':'上周','r_last-7d':'最近 7 天','r_this-month':'本月','r_last-30d':'最近 30 天',r_session:'整个会话',
      wb_busy:'已有整理在进行，请稍候',wb_emptyAsk:'先输入想整理或分析的内容',
    });
    Object.assign(TEXT.en,{
      wb_discussion:'Discussion',wb_discussionHint:'Participants speak only when you call on them, each from its own frozen snapshot',wb_rooms:'Rooms',wb_roomsTitle:'Collaboration rooms',wb_roomsSub:'Freeze 1–4 sessions into snapshots and bring them into a new shared space: hand off, talk it through, or let different models argue. The source sessions are only read, never written.',
      wb_newRoom:'New room',wb_roomTopic:'Purpose (optional)',wb_roomTopicPh:'e.g. The backend API is done; align fields with the frontend session and agree on next steps',wb_pickSessions:'Pick sessions (1–4; the same session may join twice with different models)',
      wb_roomModel:'Model',wb_followSettings:'Follow analysis settings',wb_externalRoute:'External endpoint',wb_createRoom:'Freeze and create',wb_creating:'Freezing snapshots…',wb_noRooms:'No rooms yet',
      wb_participants:'Participants',wb_snapshotAt:'Snapshot',wb_sourceMoved:'Source moved on: {calls} tool calls, {turns} turns since',wb_sourceSame:'Source unchanged since',wb_sourceUnknown:'Cannot tell whether the source changed',wb_resnap:'Re-snapshot',
      wb_roomEmpty:'Nobody has spoken yet. Use "Let A speak" below, or first say what to discuss.',wb_moderator:'Me (moderator)',wb_sayPh:'Speak as the moderator: ask, correct, set the agenda…',wb_sayOnly:'Post only',
      wb_letSpeak:'Let {label} speak',wb_roundAll:'One round',wb_speaking:'{label} is writing…',wb_cancel:'Stop',wb_handoffBrief:'Write handoff brief',wb_handoffBusy:'Writing the handoff brief…',
      wb_handoffTitle:'Handoff brief',wb_handoffHint:'Becomes the first message of a new session. Opening only fills the composer; you review and send it.',wb_openNew:'Open in a new session (draft)',wb_opened:'Placed in a new session composer; review and send',wb_draftNote:'The model did not finish; this is the raw handoff material',
      wb_readonlyNote:'Read-only snapshot · source untouched',wb_removeMsg:'Delete',wb_resnapNote:'{label} re-snapshotted',wb_roomDelete:'Delete room',wb_roomMsgs:'{n} messages',wb_pickHint:'Sessions from the last 30 days',wb_needSession:'Pick at least one session',
      providerNoModels:'This provider offers no models right now (signed out or not authorized)',
      settingsTitle:'Settings',settingsSub:'The model chosen here applies to all of Focusing and never changes the model you chat with.',
      settingsScope1:'Digests',settingsScope2:'Follow-ups',settingsScope3:'Rooms (override per participant)',settingsScope4:'Focus guard',
      settingsTabModel:'Model & connection',calTitle:'Activity',calHint:'One square per day; darker means more conversation that day',calMonths:'Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec',calSummary:'{total} turns · {days} active days · longest streak {longest} · current streak {current}',calTip:'{turns} turns · {sessions} sessions · {calls} tool calls',calNone:'No activity',calDsh:'DSH',calCodex:'Codex',calHalf:'6 months',calYear:'1 year',calSpan:'Time span',calExternal:'Include imported sessions',calExternalHint:'Also count imported Codex sessions',calExternalHintOff:'Ticking turns on Codex import and counts them',calExternalOff:'Ticking this also turns on Codex import (read-only).',calGoSettings:'Open settings',calExternalBroken:'The Codex directory has a problem, so no imported sessions were counted.',calExternalCount:'{n} turns of these come from Codex',calFailed:'Could not read the activity',calLess:'Less',calMore:'More',settingsTabSources:'Sources',sourceDsh:'DSH chats',sourceCodex:'Codex chats',codexEnable:'Import Codex chats',codexEnableHint:'Reads the chats Codex (desktop, CLI, VS Code extension) keeps on this machine. Read-only; nothing is changed.',codexWhere:'Location',codexAuto:'Discover',codexManual:'Enter path',codexPath:'Codex directory',codexAutoHint:'Looks in CODEX_HOME, then ~/.codex.',codexChipLabel:'Codex chats',showingArchived:'Including archived chats · change in Settings',hidingArchived:'Archived chats hidden · change in Settings',codexOff:'Not imported',codexOn:'{n} imported',codexProblem:'No chats found',codexSaveToCheck:'Save to check',codexNoPath:'No directory entered yet',codexMissing:'Directory does not exist',codexNotCodex:'No sessions or archived_sessions folder here',codexNotFound:'No Codex directory found',codexUnreadable:'Directory cannot be read',settingsTabFocus:'Focus guard content',
      settingsChipLabel:'Analysis model · global',settingsChipHint:'Shared by digests, follow-ups, rooms and the focus guard',
      settingsKeyNote:'The key is stored locally only, never shown in the page or exports, and a model is called only when you start a digest, a room turn or an analysis.',
      settingsDirty:'Unsaved changes',settingsClean:'No unsaved changes',saving:'Saving…',cancel:'Cancel',close:'Close',
      apiKeyStored:'•••••••• saved; leave empty to keep it',notSent:'Leave empty to omit',notTested:'Not tested',
      testSentNothing:'only a test sentence was sent, no conversation content',loadPreview:'Preview',previewBtnHint:'See the exact prompt that would be sent',previewFailed:'Preview failed: open a session first',
      wb_sub:'Your context & session keeper',wb_home:'Workbench',wb_caps:'Capabilities',wb_records:'Context records',wb_digests:'Digests',wb_focus:'Focus guard',wb_settings:'Settings',
      wb_heroTitle:'Your work context',wb_heroSub:'Focusing gathers every session: ask it, search it, or turn it into a report.',
      wb_scope:'Range',wb_rangeAuto:'Infer from request',
            wb_capTitle:'Capabilities',wb_capHint:'More are coming',wb_capDigest:'Digests',wb_capDigestText:'Turn work scattered across sessions into weekly, daily or handoff notes.',
      wb_capRecords:'Context records',wb_capRecordsText:'A searchable archive of every session: requests, changes, conclusions, todos.',wb_capFocus:'Focus guard',wb_capFocusText:'Watch one session for loops and request an independent review.',
      wb_recent:'Recent digests',wb_viewAll:'View all',wb_noRecent:'No digests yet.',
      wb_liveStats:'{range}: {sessions} sessions · {projects} projects · {days} active days',
      wb_back:'Back',wb_copy:'Copy Markdown',wb_download:'Download',wb_regen:'Regenerate',wb_delete:'Delete',wb_copied:'Copied as Markdown',wb_deleted:'Deleted',
      wb_stageScan:'Scanning sessions in range',wb_stageFold:'Extracting requests, changes and conclusions',wb_stageModel:'Model is summarizing progress, risks and next steps',wb_stageDone:'Building the result',
      wb_found:'Found {sessions} sessions · {calls} tool calls',wb_elapsed:'{s}s elapsed',
      wb_draftTitle:'The model gave no summary; this is a structural draft from the records',wb_openSettings:'Check model settings',wb_emptyRange:'No sessions found in this range. Try another one.',
      wb_statSessions:'Sessions',wb_statProjects:'Projects',wb_statDays:'Active days',wb_statCalls:'Tool calls',
      wb_byProject:'Progress by project',wb_byProjectHint:'Judged by the model from session records',wb_byDay:'Day by day',wb_next:'Suggested next steps',wb_sources:'Sources',wb_sourcesHint:'Click to open the session',
      wb_done:'Done',wb_doing:'Doing',wb_risk:'Risk',st_done:'Done',st_active:'Active',st_blocked:'Blocked',st_paused:'Paused',
      wb_followTitle:'Ask about this result',wb_followHint:'Follow-ups use only the sessions in this result',wb_followPh:'e.g. What is closest to done? What is missing?',wb_follow:'Ask',wb_you:'You',wb_failedReq:'Request failed',
      wb_failed:'Digest failed',wb_retry:'Retry',wb_model:'Model',wb_draft:'Draft',
      wb_recTitle:'Context records',wb_recSub:'Each session as a context record: what you asked, what changed, what was concluded.',wb_search:'Search title, project or content',wb_allProjects:'All projects',wb_workspaceFilter:'Workspaces',wb_allWorkspaces:'All workspaces',
      wb_recStats:'{sessions} sessions · {turns} turns · {calls} tool calls',wb_noRecords:'No sessions in this range.',wb_loading:'Loading…',
      wb_turns:'turns',wb_calls:'calls',wb_failedCalls:'failed',wb_unfinished:'Unfinished',wb_running:'Running',wb_asked:'You asked',wb_lastReply:'Last conclusion',wb_files:'Files changed',wb_todos:'Todo list',
      wb_openSession:'Open session',wb_handoff:'Handoff notes',wb_handoffReq:'Write handoff notes for "{title}": goal, current state, key files, open problems and next steps',
      wb_digTitle:'Digests',wb_digSub:'Every generated result is kept here and survives restarts.',wb_noDigests:'No digests yet.',wb_generating:'Generating',
      k_weekly:'Weekly',k_daily:'Daily',k_handoff:'Handoff',k_analysis:'Analysis',k_digest:'Digest',
      r_today:'Today',r_yesterday:'Yesterday','r_this-week':'This week','r_last-week':'Last week','r_last-7d':'Last 7 days','r_this-month':'This month','r_last-30d':'Last 30 days',r_session:'Whole session',
      wb_busy:'A digest is already running',wb_emptyAsk:'Type what you want organized first',
    });
    const WB_RANGES=['today','yesterday','this-week','last-week','last-7d','this-month','last-30d'];
    const WB_CSS=`
.fw-status-card{position:relative;display:grid;gap:7px;border:1px solid var(--line);background:var(--paper);border-radius:10px;padding:9px 30px 9px 10px;text-align:left;min-width:0;color:var(--ink)}.fw-status-card:hover{background:var(--hover)}.fw-status-row{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:8px;min-width:0}.fw-status-text{min-width:0}.fw-status-text small{display:block;font-size:10.5px;color:var(--muted);line-height:1.3}.fw-status-text b{display:block;font-size:12px;font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fw-status-gear{position:absolute;top:8px;right:8px;color:var(--muted);display:flex}.fw-status-gear svg{width:14px;height:14px}.fw-chip-dot.off{background:var(--muted);opacity:.5}



.fw-chip-dot{width:7px;height:7px;border-radius:99px;background:var(--green);flex-shrink:0}
.fw-chip-dot.warn{background:var(--amber)}
.fw{--bg:var(--dsw-alias-bg-base);--paper:var(--dsw-alias-bg-layer-1);--ink:var(--dsw-alias-label-primary);--muted:var(--dsw-alias-label-secondary);--line:var(--dsw-alias-border-l1);--hover:var(--dsw-alias-bg-layer-2);--blue:var(--dsw-alias-brand-primary);--green:var(--dsw-alias-state-success-primary);--amber:var(--dsw-alias-state-warn-primary);--red:var(--dsw-alias-state-error-primary);--blue-soft:color-mix(in srgb,var(--blue) 12%,transparent);--green-soft:color-mix(in srgb,var(--green) 13%,transparent);--amber-soft:color-mix(in srgb,var(--amber) 14%,transparent);--red-soft:color-mix(in srgb,var(--red) 12%,transparent);position:absolute;inset:0;display:grid;grid-template-columns:196px minmax(0,1fr);overflow:hidden;background:var(--bg);color:var(--ink);font-size:13px;line-height:1.65;container-type:inline-size}
.fw *{box-sizing:border-box}.fw button,.fw input,.fw textarea,.fw select{font:inherit;color:inherit}.fw button{cursor:pointer}.fw button:disabled{opacity:.5;cursor:default}
.fw input:focus,.fw textarea:focus,.fw select:focus,.fw input:focus-visible,.fw textarea:focus-visible,.fw select:focus-visible{outline:none!important;box-shadow:none!important;border-color:inherit!important}
.fw button:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.fw svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}
.fw-nav{background:var(--dsw-specific-sidebar-fill,var(--paper));border-right:1px solid var(--line);display:flex;flex-direction:column;gap:2px;padding:18px 10px;overflow:hidden;min-height:0}
.fw-brand{display:flex;align-items:center;gap:8px;padding:0 10px;font-size:16px;font-weight:650;letter-spacing:-.3px}.fw-brand svg{width:20px;height:20px;color:var(--blue)}
/* The brand and the one settings entry share the top row; the gear never wraps
   under the name. */
.fw-brandbar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 2px}
.fw-gear{border:0;background:none;color:var(--muted);display:flex;align-items:center;justify-content:center;padding:4px;border-radius:7px;cursor:pointer;flex:0 0 auto}
.fw-gear:hover{background:var(--hover);color:var(--ink)}
.fw-gear svg{width:15px;height:15px}
.fw-nav-list{display:flex;flex-direction:column;gap:2px;min-height:0;flex:0 0 auto}
.fw-sum{font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 8px}
.fw-tag{font-size:11px;color:var(--muted);padding:2px 10px 16px}
.fw-nav-item{display:flex;align-items:center;gap:9px;border:0;background:none;text-align:left;padding:8px 10px;border-radius:8px;color:var(--muted);font-size:13px;width:100%}
.fw-nav-item:hover{background:var(--hover);color:var(--ink)}.fw-nav-item.active{background:var(--blue-soft);color:var(--blue);font-weight:550}
.fw-nav-label{font-size:10px;letter-spacing:1px;color:var(--muted);padding:16px 10px 4px}.fw-nav-foot{margin-top:auto;display:grid;gap:6px;padding-top:12px}
.fw-badge{margin-left:auto;font-size:10px;background:var(--blue-soft);color:var(--blue);padding:0 7px;border-radius:99px}
.fw-main{overflow:auto;min-width:0;min-height:0;position:relative;scrollbar-gutter:stable}.fw-main.flush{overflow:hidden}
/* macOS draws the traffic lights INSIDE the window (titleBarStyle hiddenInset,
   lights at 16,18) and DSH reserves their room as --dsh-frame-top-clearance
   (48px on darwin) -- its own sidebar holds a 52px top strip the same way. The
   rail always keeps that room, so it never moves under the buttons and it stays
   aligned with the shell's own sidebar. Only padding moves: the rail's
   background still reaches the window edge. */
[data-platform=darwin] .fw-nav{padding-top:var(--dsh-frame-top-clearance,48px)}
.fw-page{max-width:900px;margin:0 auto;padding:32px 36px 72px}
.fw-eyebrow{font-size:10px;letter-spacing:1.4px;color:var(--muted);margin-bottom:6px;text-transform:uppercase}
.fw-h2{font-size:21px;font-weight:650;letter-spacing:-.4px;margin:0 0 4px}.fw-sub{color:var(--muted);font-size:12.5px;margin:0 0 22px}
.fw-card{background:var(--paper);border:1px solid var(--line);border-radius:12px}
.fw-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--paper);border-radius:8px;padding:6px 12px;font-size:12.5px;white-space:nowrap}
.fw-btn:hover{background:var(--hover)}.fw-btn.primary{background:var(--blue);border-color:var(--blue);color:var(--bg)}.fw-btn.danger{color:var(--red)}
.fw-text-btn{border:0;background:none;color:var(--blue);font-size:12px;padding:2px 4px;display:inline-flex;align-items:center;gap:4px}
.fw-pill{font-size:10.5px;padding:1px 8px;border-radius:99px;white-space:nowrap;display:inline-block;line-height:18px}
.fw-pill.blue{background:var(--blue-soft);color:var(--blue)}.fw-pill.green{background:var(--green-soft);color:var(--green)}.fw-pill.amber{background:var(--amber-soft);color:var(--amber)}.fw-pill.red{background:var(--red-soft);color:var(--red)}.fw-pill.gray{background:var(--hover);color:var(--muted)}
.fw-dot{width:7px;height:7px;border-radius:99px;background:var(--line);display:inline-block;flex-shrink:0}.fw-dot.on{background:var(--green)}
.fw-hero{padding:22px 0 18px;text-align:center}.fw-hero h2{font-size:24px;font-weight:650;letter-spacing:-.5px;margin:0 0 6px}.fw-hero p{color:var(--muted);font-size:12.5px;margin:0 0 6px}
.fw-live{font-size:11.5px;color:var(--muted);min-height:18px}

@keyframes fwpulse{50%{opacity:.35}}
/* tool-call rows: the panel's own sheet is not loaded here, so they are restated */
.fw .fz-run{border:1px solid var(--line);border-radius:8px;margin:8px 0 0;min-width:0}
.fw .fz-run>summary{display:flex;align-items:center;gap:8px;padding:6px 10px;font-size:12px;font-weight:400;color:var(--muted);cursor:pointer;list-style:none}
.fw .fz-run>summary::-webkit-details-marker{display:none}
.fw .fz-caret{margin-left:auto;font-size:10px;transition:transform .15s}
.fw .fz-run[open]>summary .fz-caret{transform:rotate(90deg)}
.fw .fz-run-body{border-top:1px solid var(--line);padding:6px 10px;display:grid;gap:4px;min-width:0}
.fw .fz-dot{display:inline-block;width:6px;height:6px;background:var(--green);border-radius:50%;flex-shrink:0}
.fw .fz-dot.error{background:var(--red)}
.fw .fz-call{min-width:0}
.fw .fz-call>summary{display:grid;grid-template-columns:8px auto minmax(0,1fr);align-items:baseline;gap:8px;font-size:12px;font-weight:400;cursor:pointer;list-style:none;padding:2px 0}
.fw .fz-call>summary::-webkit-details-marker{display:none}
.fw .fz-call-name{color:var(--ink);white-space:nowrap}
.fw .fz-call-target{font:11px/1.6 ui-monospace,monospace;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.fw .fz-call>div>pre{margin:4px 0 4px 16px;max-height:260px;overflow:auto;white-space:pre-wrap;word-break:break-word;font:11px/1.6 ui-monospace,monospace;color:var(--muted);background:var(--bg);border-radius:6px;padding:8px 10px}
.fw .fz-more{border:0;background:none;color:var(--muted);font-size:11px;cursor:pointer;padding:0 0 6px 16px;text-decoration:underline}
/* the ask chat: conversation switcher, message list, status lines */
.fw-ask-status{color:var(--muted);font-size:12px;animation:fwpulse 1.4s infinite}
.fw-ask-model{font-size:11px;color:var(--muted)}
.fw-ask-error{color:var(--red);font-size:12px;overflow-wrap:anywhere}
.fw-ask-hint{font-size:11px;color:var(--muted);min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fw-ask{max-width:660px;margin:0 auto;background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:6px;text-align:left}
.fw-ask:focus-within{border-color:var(--blue)}
.fw-ask textarea{width:100%;border:0;background:none;resize:none;outline:none;padding:10px 12px 4px;font-size:14px;min-height:50px;display:block}
.fw-ask-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 6px 4px;flex-wrap:wrap}
/* Ask: a page of its own. Past conversations on the left, one thread in the
   middle, the input pinned under it. Only the thread scrolls. */
.fw-chat{display:grid;grid-template-columns:minmax(0,1fr);height:100%;min-height:0}
.fw-nav-chats{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;margin-top:10px;padding-top:8px;border-top:1px solid var(--line)}
.fw-nav-chats-head{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:0 4px 2px 8px}
.fw-nav-chats-label{font-size:10px;letter-spacing:1px;color:var(--muted)}
.fw-nav-groups{display:flex;flex-direction:column;gap:2px;overflow:auto;min-height:0;padding-right:2px}
.fw-nav-group{display:flex;flex-direction:column;gap:1px}
.fw-nav-group-head{display:flex;align-items:center;gap:5px;width:100%;border:0;background:none;padding:5px 8px;border-radius:6px;color:var(--muted);font-size:10.5px;letter-spacing:.5px}
.fw-nav-group-head:hover{color:var(--ink)}
.fw-nav-group-head svg{width:11px;height:11px;flex:none;transition:transform .12s ease}
.fw-nav-group-head[aria-expanded=false] svg{transform:rotate(-90deg)}
.fw-nav-group-head span{flex:1;text-align:left}
.fw-nav-group-head em{font-style:normal;font-size:10px;color:var(--muted)}
.fw-nav-more{border:0;background:none;padding:5px 8px;border-radius:6px;color:var(--blue);font-size:11px;text-align:left}
.fw-nav-more:hover{background:var(--hover)}
.fw-nav-new{border:0;background:none;color:var(--muted);display:flex;padding:3px;border-radius:6px}
.fw-nav-new:hover{background:var(--hover);color:var(--ink)}
.fw-nav-new svg{width:13px;height:13px}
.fw-nav-chat-list{display:flex;flex-direction:column;gap:1px;overflow:auto;min-height:0}
.fw-nav-chat{display:flex;align-items:center;gap:6px;width:100%;border:0;background:none;text-align:left;padding:6px 8px;border-radius:7px;color:var(--ink);font-size:12px;min-width:0}
.fw-nav-chat:hover{background:var(--hover)}
.fw-nav-chat.active{background:var(--blue-soft);color:var(--blue)}
.fw-nav-chat-t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fw-nav-chat time{font-size:10px;color:var(--muted);flex:none}
.fw-nav-chat-none{padding:10px 8px;color:var(--muted);font-size:11.5px}
.fw-chat-main{display:flex;flex-direction:column;min-width:0;min-height:0}
.fw-chat-head{display:flex;align-items:center;gap:10px;padding:10px 20px;border-bottom:1px solid var(--line);min-height:44px}
.fw-chat-heading{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;font-size:13px}
.fw-chat-pick{display:none;max-width:46%;border:1px solid var(--line);border-radius:8px;background:var(--paper);color:var(--ink);font-size:12px;padding:4px 8px}
.fw-chat-scroll{flex:1;min-height:0;overflow:auto;padding:20px}
.fw-chat-col{max-width:720px;margin:0 auto;min-height:100%;display:flex;flex-direction:column}
.fw-chat-empty{margin:auto;text-align:center;padding:24px 0}
.fw-chat-empty h2{font-size:20px;font-weight:650;letter-spacing:-.4px;margin:0 0 6px}
.fw-chat-empty p{color:var(--muted);font-size:12.5px;margin:0 auto 18px;max-width:440px}
.fw-chat-empty .fw-chips{margin-top:0}
.fw-chat-composer{padding:8px 20px 16px}
.fw-chat-box{max-width:720px;margin:0 auto;background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:6px}
.fw-chat-box:focus-within{border-color:var(--blue)}
.fw-chat-box textarea{width:100%;border:0;background:none;resize:none;outline:none;padding:8px 10px 2px;font-size:14px;min-height:44px;max-height:180px;display:block}
.fw-chat-range{border:1px solid var(--line);background:none;color:var(--muted);border-radius:999px;padding:2px 8px;font-size:11px!important;max-width:130px}
.fw-workspace-filter{align-items:center;flex-wrap:wrap;gap:5px;margin-top:-3px;min-height:24px}
.fw-workspace-label{font-size:11px;color:var(--muted);margin-right:2px}
.fw-workspace-tag{border:1px solid var(--line);border-radius:7px;padding:3px 8px;background:transparent;color:var(--muted);font-size:11px;cursor:pointer;flex:0 1 auto;width:auto;max-width:320px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:none;animation:none;box-shadow:none}
.fw-workspace-tag:hover{background:var(--hover);color:var(--ink)}
.fw-workspace-tag.on{color:var(--blue);border-color:var(--blue);background:var(--blue-soft,#eef4ff)}
.fw-workspace-tag:focus-visible{outline:2px solid var(--blue);outline-offset:1px}
.fw-chat-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:2px 4px}
.fw-thread{display:flex;flex-direction:column;gap:16px}
.fw-msg-user{align-self:flex-end;max-width:82%;background:var(--hover);border-radius:14px 14px 3px 14px;padding:8px 13px;font-size:13.5px;white-space:pre-wrap;overflow-wrap:anywhere}
.fw-msg-ai{min-width:0;font-size:13.5px;line-height:1.7;overflow-wrap:anywhere;display:grid;gap:8px}
/* Digests: the generate box. */
.fw-tpl-tools{display:flex;align-items:center;gap:8px}
.fw-tpl{display:flex;align-items:center;gap:12px;padding:11px 14px;border-top:1px solid var(--line);min-width:0}
.fw-tpl:first-child{border-top:0}
.fw-tpl:hover{background:var(--hover)}
.fw-tpl-main{flex:1;min-width:0}
.fw-tpl-name{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600}
.fw-tpl-text{margin:2px 0 0;font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fw-tpl-actions{display:flex;align-items:center;gap:4px;flex:none}
.fw-tpl-form{background:var(--paper);border:1px solid var(--blue);border-radius:12px;padding:10px;margin:0 0 12px;display:grid;gap:8px}
.fw-tpl-form-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.fw-tpl-form-row input{flex:1;min-width:160px;border:1px solid var(--line);border-radius:8px;padding:6px 10px;font-size:13px;background:var(--bg);outline:none}
.fw-tpl-form textarea{width:100%;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px;background:var(--bg);resize:vertical;outline:none}
.fw-tpl-form-foot{display:flex;justify-content:flex-end;gap:8px}




.fw-recent2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 16px}
.fw-recent2 section{min-width:0}
.fw-select{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--muted);border:1px solid var(--line);border-radius:8px;padding:3px 8px;background:none}
.fw-select select{border:0;background:none;outline:none;font-size:11.5px;color:var(--ink);cursor:pointer}
.fw-chips{max-width:660px;margin:12px auto 0;display:flex;flex-wrap:wrap;gap:7px;justify-content:center}
.fw-chip{border:1px solid var(--line);background:var(--paper);border-radius:99px;padding:4px 12px;font-size:12px;color:var(--muted)}.fw-chip:hover{color:var(--ink);border-color:var(--muted)}
.fw-sh{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:30px 0 10px}.fw-sh h3{font-size:13.5px;font-weight:600;margin:0}.fw-sh span{font-size:11px;color:var(--muted)}
.fw-caps{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.fw-cap{padding:14px;display:flex;flex-direction:column;gap:6px;text-align:left;border-radius:12px;background:var(--paper);border:1px solid var(--line)}.fw-cap:hover{background:var(--hover)}
.fw-cap-icon{width:30px;height:30px;border-radius:8px;display:grid;place-items:center}.fw-cap h4{margin:2px 0 0;font-size:13px;font-weight:600}.fw-cap p{margin:0;font-size:12px;color:var(--muted);line-height:1.5}
.fw-row{display:flex;align-items:center;gap:10px;padding:11px 14px;border:0;border-top:1px solid var(--line);width:100%;background:none;text-align:left}
.fw-row:first-child{border-top:0}.fw-row:hover{background:var(--hover)}.fw-row .grow{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fw-row time{font-size:11px;color:var(--muted);white-space:nowrap}
.fw-empty{padding:28px;text-align:center;color:var(--muted);font-size:12.5px}
.fw-echo{display:inline-flex;align-items:center;gap:7px;background:var(--blue-soft);color:var(--blue);border-radius:99px;padding:4px 12px;font-size:12px;margin-bottom:10px;max-width:100%}
.fw-result-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:16px;flex-wrap:wrap}.fw-actions{display:flex;gap:6px;flex-wrap:wrap}
.fw-summary{padding:16px 18px;font-size:13.5px;line-height:1.8}
.fw-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:12px 0}
.fw-stat{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:10px 14px}.fw-cal{padding:14px 16px 12px}.fw-cal-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px}.fw-cal-sum{font-size:12.5px;color:var(--ink)}.fw-cal-tools{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.fw-cal-span{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}.fw-cal-span button{border:0;background:transparent;color:var(--muted);font-size:11.5px;padding:4px 10px;cursor:pointer}.fw-cal-span button.on{background:var(--hover);color:var(--ink)}.fw-cal-ext{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--ink);cursor:pointer;border:0;background:transparent;padding:4px 6px;margin:-4px -6px;border-radius:7px}.fw-cal-ext:hover{background:var(--hover)}.fw-cal-ext:disabled{cursor:default;opacity:.6}.fw-cal-box{width:15px;height:15px;border-radius:4px;border:1.5px solid var(--muted);display:inline-flex;align-items:center;justify-content:center;font-size:11px;line-height:1;color:#fff;flex-shrink:0}.fw-cal-ext.on .fw-cal-box{background:var(--green);border-color:var(--green)}.fw-cal-scroll{padding-bottom:4px}.fw-cal-grid-wrap{width:100%;min-width:0}.fw-cal-months{display:grid;gap:3px;height:15px;font-size:10.5px;color:var(--muted)}.fw-cal-months span{white-space:nowrap}.fw-cal-grid{display:grid;grid-auto-flow:column;grid-template-rows:repeat(7,var(--calw,13px));grid-auto-columns:var(--calw,13px);gap:3px}.fw-cal-grid.loading{opacity:.5}.fw-cal-cell{width:100%;height:100%;border-radius:3px;display:inline-block;background:color-mix(in srgb,var(--ink) 8%,transparent)}.fw-cal-cell.pad{background:transparent}.fw-cal-cell.l1{background:color-mix(in srgb,var(--green) 28%,transparent)}.fw-cal-cell.l2{background:color-mix(in srgb,var(--green) 50%,transparent)}.fw-cal-cell.l3{background:color-mix(in srgb,var(--green) 75%,transparent)}.fw-cal-cell.l4{background:var(--green)}.fw-cal-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:8px;font-size:11.5px;color:var(--muted);flex-wrap:wrap}.fw-cal-legend{display:inline-flex;align-items:center;gap:4px}.fw-cal-legend .fw-cal-cell{width:11px;height:11px;flex:0 0 auto}.fw-cal-err{font-size:12px;color:var(--red);margin-bottom:6px}.fw-stat span{font-size:11px;color:var(--muted);display:block}.fw-stat strong{font-size:18px;font-weight:650;letter-spacing:-.3px}
.fw-proj{padding:14px 18px}.fw-proj+.fw-proj{border-top:1px solid var(--line)}
.fw-proj-head{display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap}.fw-proj-head h4{margin:0;font-size:13.5px;font-weight:600}.fw-proj-head .pct{margin-left:auto;font-size:12px;color:var(--muted)}
.fw-headline{font-size:12px;color:var(--muted);margin:0 0 8px}
.fw-bar{height:5px;border-radius:99px;background:var(--hover);overflow:hidden;margin-bottom:10px}.fw-bar i{display:block;height:100%;border-radius:99px;background:var(--blue)}.fw-bar i.done{background:var(--green)}
.fw-items{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:5px}.fw-items li{font-size:12.5px;display:flex;gap:8px;align-items:baseline}
.fw-mark{font-size:10.5px;min-width:32px;flex-shrink:0;text-align:center;border-radius:5px;padding:0 4px}
.fw-mark.done{background:var(--green-soft);color:var(--green)}.fw-mark.doing{background:var(--blue-soft);color:var(--blue)}.fw-mark.risk{background:var(--amber-soft);color:var(--amber)}
.fw-day{display:grid;grid-template-columns:86px minmax(0,1fr);gap:12px;padding:10px 18px;border-top:1px solid var(--line)}.fw-day:first-child{border-top:0}
.fw-day b{display:block;font-size:12.5px}.fw-day small{font-size:11px;color:var(--muted)}.fw-day em{font-style:normal;color:var(--muted);font-size:11.5px}
.fw-sources{display:flex;flex-wrap:wrap;gap:6px}.fw-source{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--paper);border-radius:8px;padding:4px 10px;font-size:11.5px;color:var(--muted);max-width:280px}
.fw-source:hover{color:var(--ink)}.fw-source span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fw-notice{display:flex;gap:10px;padding:12px 14px;border-radius:10px;margin-bottom:12px;background:var(--amber-soft);font-size:12.5px}.fw-notice.red{background:var(--red-soft)}.fw-notice b{display:block}.fw-notice p{margin:2px 0 0;color:var(--muted);word-break:break-word}
.fw-thinking{padding:22px;display:flex;flex-direction:column;gap:12px}
.fw-think{display:flex;align-items:center;gap:10px;font-size:12.5px;color:var(--muted)}.fw-think.done{color:var(--ink)}.fw-think svg{color:var(--green)}
.fw-spin{width:10px;height:10px;border:1.5px solid var(--line);border-top-color:var(--blue);border-radius:99px;animation:fwspin .8s linear infinite;flex-shrink:0}
.fw-nav-chat .fw-spin{width:8px;height:8px;border-width:1.5px}
.fw-think .fw-spin{width:11px;height:11px;border-width:2px}.fw-gap{width:14px;flex-shrink:0}
@keyframes fwspin{to{transform:rotate(360deg)}}
.fw-md p{margin:0 0 8px}.fw-md p:last-child{margin-bottom:0}.fw-md ul{margin:0 0 8px;padding-left:18px}.fw-md h5{font-size:13px;margin:10px 0 4px}.fw-md code{font-size:12px;background:var(--hover);padding:0 4px;border-radius:4px}
.fw-fu{padding:12px 16px;margin-top:8px}.fw-fu-q{font-size:12px;color:var(--blue);margin-bottom:4px}
.fw-filter{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;align-items:center}
.fw-seg{border:1px solid var(--line);background:var(--paper);border-radius:8px;padding:4px 11px;font-size:12px;color:var(--muted)}.fw-seg.on{background:var(--blue-soft);color:var(--blue);border-color:transparent}
.fw-search{flex:1;min-width:180px;display:flex;align-items:center;gap:7px;background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:5px 10px;color:var(--muted)}.fw-search input{width:100%;border:0;background:none;outline:none;font-size:12.5px}
.fw-rec{border-top:1px solid var(--line)}.fw-rec:first-child{border-top:0}
.fw-rec-btn{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:3px 14px;padding:12px 16px;width:100%;border:0;background:none;text-align:left}.fw-rec-btn:hover{background:var(--hover)}
.fw-rec-l1{display:flex;align-items:center;gap:8px;font-size:13.5px;min-width:0}.fw-rec-l1 .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fw-rec-l2{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.fw-rec-r{grid-row:1/3;grid-column:2;display:flex;flex-direction:column;align-items:flex-end;gap:4px;font-size:11px;color:var(--muted);white-space:nowrap}
.fw-detail{padding:4px 16px 16px 31px;display:grid;gap:12px}.fw-detail h5{margin:0 0 4px;font-size:11.5px;color:var(--muted);font-weight:500}
.fw-detail ul{margin:0;padding-left:16px;font-size:12.5px}.fw-detail li{margin:2px 0}.fw-files{font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:11.5px;color:var(--muted)}
.fw-toast{position:absolute;bottom:20px;left:50%;transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:7px 16px;border-radius:9px;font-size:12px;z-index:20;pointer-events:none}
.fw-focus{position:relative;height:100%;min-height:0}
@container(max-width:820px){.fw{grid-template-columns:56px minmax(0,1fr)}.fw-status-card{padding:8px 0;justify-items:center;gap:5px}.fw-status-text{display:none}.fw-status-row{grid-template-columns:auto}.fw-status-gear{position:static;order:-1}.fw-nav{padding:14px 6px}.fw-brandbar{flex-direction:column;gap:2px;padding:0}.fw-nav-foot{padding-top:8px}.fw-sum{text-align:center;padding:0}.fw-brand span,.fw-tag,.fw-nav-label,.fw-nav-item .lbl,.fw-badge{display:none}.fw-brand{justify-content:center;padding:0}.fw-nav-item{justify-content:center;padding:9px}.fw-caps{grid-template-columns:1fr 1fr}.fw-recent2{grid-template-columns:1fr}.fw-nav-chats{display:none}.fw-chat-pick{display:block}.fw-chat-heading{display:none}.fw-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.fw-page{padding:24px 20px 60px}}
`;
    // GitHub-style activity grid: one square per day, darker means more answered
    // turns. Weeks run as columns, Monday on top. The "include imported chats"
    // switch writes the saved setting, so the page and the setting never disagree.
    // The last calendar, kept for the life of the page (and the tab), so a visit
    // does not start from an empty grid. It is only a stand-in until it is stale.
    function WIcon({name}){
      const P={
        focus:['M8 3H4v4m12-4h4v4M4 17v4h4m12-4v4h-4','M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z'],
        home:['m4 11 8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1Z'],
        layers:['m12 3 9 5-9 5-9-5Z','m3 13 9 5 9-5'],
        users:['M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z','M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5','M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.8c1.8.7 3 2.6 3 5.2'],
        doc:['M6 3h8l4 4v14H6Z','M14 3v4h4M9 12h6M9 16h6'],
        pulse:['M3 12h4l2.5-7 5 14L17 12h4'],
        gear:['M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z','M12 2v3m0 14v3M4.9 4.9 7 7m10 10 2.1 2.1M2 12h3m14 0h3M4.9 19.1 7 17M17 7l2.1-2.1'],
        chat:['M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8.5L6 20v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z'],plus:['M12 5v14M5 12h14'],chevron:['m7 10 5 5 5-5'],
        send:['M5 12 20 5l-4 14-4-6Zm7 1 8-8'],check:['m6 12 4 4 8-9'],back:['M19 12H5m5 5-5-5 5-5'],arrow:['M5 12h14m-5-5 5 5-5 5'],
        copy:['M9 9h11v11H9Z','M5 15V5a1 1 0 0 1 1-1h9'],download:['M12 4v11m-5-5 5 5 5-5M5 20h14'],trash:['M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3'],
        refresh:['M20 11a8 8 0 1 0-2 6','M20 4v7h-7'],search:['M15 15l5 5','M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z'],spark:['M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2 2m8 8 2 2M6 18l2-2m8-8 2-2'],
        clock:['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z','M12 7v5l3 2'],warn:['m12 3 9 16H3Z','M12 10v4m0 3h.01'],
      };
      return h('svg',{viewBox:'0 0 24 24','aria-hidden':true},...(P[name]||P.focus).map((d,i)=>h('path',{d,key:i})));
    }
    /** Small, safe markdown: headings, bullets, bold, inline code. */
    function inlineMd(text,keyBase){
      const out=[];const re=/(\*\*[^*]+\*\*|`[^`]+`)/g;let last=0,m,i=0;
      while((m=re.exec(text))){if(m.index>last)out.push(text.slice(last,m.index));const tok=m[0];out.push(tok.startsWith('**')?h('b',{key:`${keyBase}-${i++}`},tok.slice(2,-2)):h('code',{key:`${keyBase}-${i++}`},tok.slice(1,-1)));last=m.index+tok.length;}
      if(last<text.length)out.push(text.slice(last));return out;
    }
    function Md({text}){
      const lines=String(text||'').split('\n');const blocks=[];let list=null,para=[];
      const flushPara=()=>{if(para.length){blocks.push(h('p',{key:blocks.length},...inlineMd(para.join(' '),blocks.length)));para=[];}};
      const flushList=()=>{if(list){blocks.push(h('ul',{key:blocks.length},...list.map((x,i)=>h('li',{key:i},...inlineMd(x,`${blocks.length}-${i}`)))));list=null;}};
      for(const raw of lines){const line=raw.trimEnd();
        const bullet=/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);const head=/^\s*#{1,6}\s+(.*)$/.exec(line);
        if(bullet){flushPara();(list??=[]).push(bullet[1]);}
        else if(head){flushPara();flushList();blocks.push(h('h5',{key:blocks.length},...inlineMd(head[1],blocks.length)));}
        else if(!line.trim()){flushPara();flushList();}
        else if(/^\s*\|?\s*:?-{3,}/.test(line)){/* table rule */}
        else{flushList();para.push(line.replace(/^\s*>\s?/,'').replace(/\|/g,' · ').replace(/^ · | · $/g,''));}
      }
      flushPara();flushList();return h('div',{className:'fw-md'},...blocks);
    }
    const tzOffset=()=>-new Date().getTimezoneOffset();
    const fmt=(s,vars)=>String(s||'').replace(/\{(\w+)\}/g,(_,k)=>vars[k]??'');
    // A bare "HTTP 404" tells nobody which request failed. The message always
    // carries the path so a missing route is obvious instead of mysterious.
    // A 404 is also retried once with a cache-buster: a 404 the browser cached
    // while the route did not exist yet would otherwise outlive the fix and
    // look like a permanent missing module.
    async function getJson(url,options){
      let res=await fetch(url,{credentials:'same-origin',...options});
      let body=null;try{body=await res.json();}catch{body=null;}
      if(res.status===404&&!options?.signal?.aborted){
        const bust=`${url}${url.includes('?')?'&':'?'}_=${Date.now()}`;
        res=await fetch(bust,{credentials:'same-origin',cache:'no-store',...options});
        try{body=await res.json();}catch{body=null;}
      }
      if(!res.ok&&!body)throw new Error(`HTTP ${res.status} · ${String(url).split('?')[0]}`);
      if(!res.ok&&body&&!body.ok)return body;
      return body??{};
    }
    // Switching away from the panel unmounts these components, so anything the
    // user chose about the page -- which page, which subject, and the filters
    // inside it -- has to live outside them. Session scope: it survives
    // remounts and a reload, and dies with the tab. Transient data (loaded
    // lists, errors, an unsent question) is deliberately not kept.
    const WB_PAGE_KEY='dsh-focusing.page';
    const WB_VIEWS=['home','ask','records','digests','result','rooms','room','focus'];
    const WB_PAGE_DEFAULTS={
      view:'home', digestId:null, roomId:null,
      recRange:'this-week', recQuery:'', recProject:'', recWorkspaces:[], range:'', expanded:null,
      picked:null, rosterTab:'overview', rosterQuery:'', rosterFilter:'all', expandedGroups:{},
    };
    const wbText=(v,fallback)=>typeof v==='string'&&v.length<=400?v:fallback;
    const wbId=v=>typeof v==='string'&&v? v : null;
    let wbPageMem=null;
    function wbPageLoad(){
      if(wbPageMem)return wbPageMem;
      let stored=null;
      try{const raw=window.sessionStorage?.getItem(WB_PAGE_KEY);if(raw){const p=JSON.parse(raw);if(p&&typeof p==='object')stored=p;}}catch{}
      const d=WB_PAGE_DEFAULTS, p=stored||{};
      const page={
        view:WB_VIEWS.includes(p.view)?p.view:d.view,
        digestId:wbId(p.digestId), roomId:wbId(p.roomId),
        recRange:wbText(p.recRange,d.recRange),
        recQuery:wbText(p.recQuery,d.recQuery),
        recProject:wbText(p.recProject,d.recProject),
        recWorkspaces:Array.isArray(p.recWorkspaces)?p.recWorkspaces.filter(x=>typeof x==='string').slice(0,100):[],
        range:wbText(p.range,d.range),
        expanded:wbId(p.expanded),
        picked:wbId(p.picked),
        rosterTab:wbText(p.rosterTab,d.rosterTab),
        rosterQuery:wbText(p.rosterQuery,d.rosterQuery),
        rosterFilter:p.rosterFilter==='reviewed'?'reviewed':'all',
        expandedGroups:p.expandedGroups&&typeof p.expandedGroups==='object'&&!Array.isArray(p.expandedGroups)?p.expandedGroups:{},
      };
      // A detail view without its subject would render an empty page.
      if(page.view==='result'&&!page.digestId)page.view='home';
      if(page.view==='room'&&!page.roomId)page.view='rooms';
      wbPageMem=page;
      return wbPageMem;
    }
    function wbPageSave(patch){
      wbPageMem={...wbPageLoad(),...patch};
      try{window.sessionStorage?.setItem(WB_PAGE_KEY,JSON.stringify(wbPageMem));}catch{}
    }

    // GitHub-style activity grid: one square per day, darker means more answered
    // turns. Weeks run as columns, Monday on top. The "include imported chats"
    // switch writes the saved setting, so the page and the setting never disagree.
    // The last calendar, kept for the life of the page (and the tab), so a visit
    // does not start from an empty grid. It is only a stand-in until it is stale.
    const CAL_FRESH_MS=10*60*1000, CAL_RECHECK_MS=3000, CAL_KEY='dsh-focusing.activity.v1';
    let calMem=null;
    function calCacheGet(){
      if(calMem)return calMem;
      try{const raw=window.sessionStorage?.getItem(CAL_KEY);if(raw){const v=JSON.parse(raw);if(v&&v.data&&Array.isArray(v.data.days))calMem=v;}}catch{}
      return calMem;
    }
    function calCachePut(v){
      calMem=v;
      try{if(v)window.sessionStorage?.setItem(CAL_KEY,JSON.stringify(v));else window.sessionStorage?.removeItem(CAL_KEY);}catch{}
    }
    function ActivityCalendar({t,openSettings,onCodexStatus}){
      // The grid changes slowly, so coming back to the page shows the last one at
      // once and refreshes it quietly -- and only when it has gone stale.
      const span=365;
      const [data,setData]=React.useState(()=>calCacheGet()?.data||null);
      const [err,setErr]=React.useState('');
      const [busy,setBusy]=React.useState(false);
      const [tick,setTick]=React.useState(0);
      const cells=data?.days||[];
      const lead=cells.length?(new Date(`${cells[0].day}T00:00:00Z`).getUTCDay()+6)%7:0;
      const items=[...Array(lead).fill(null),...cells];
      const weeks=Math.ceil(items.length/7);
      // Fit the year to the width at hand: no scrolling. The cell size lives in
      // --calw and is recomputed whenever the card changes width.
      const wrapRef=React.useRef(null);
      React.useEffect(()=>{
        const el=wrapRef.current;if(!el||typeof ResizeObserver!=='function')return undefined;
        // weeks is in scope: the grid and the month labels share that column count.
        const fit=()=>{
          const w=el.clientWidth;if(!w||!weeks)return;
          el.style.setProperty('--calw',`${Math.max(6,Math.floor((w-(weeks-1)*3)/weeks))}px`);
        };
        fit();
        const ro=new ResizeObserver(fit);ro.observe(el);return()=>ro.disconnect();
      },[]);
      React.useEffect(()=>{
        const hit=calCacheGet();
        if(tick===0&&hit){setData(hit.data);if(Date.now()-hit.at<CAL_FRESH_MS)return undefined;}
        const c=new AbortController();
        getJson(`${WB.activity}?days=${span}&offset=${tzOffset()}`,{signal:c.signal})
          .then(b=>{if(c.signal.aborted)return;if(b.ok){setData(b);setErr('');if(!b.externalPending)calCachePut({span,data:b,at:Date.now()});else setTimeout(()=>{if(!c.signal.aborted)setTick(x=>x+1);},CAL_RECHECK_MS);}else setErr(b.detail||b.reason||'failed');})
          .catch(e=>{if(!c.signal.aborted)setErr(e.message);});
        return()=>c.abort();
      },[span,tick]);
      // The switch both asks for imported chats in the grid and, if reading Codex
      // was never turned on, turns it on: a button that needs another setting
      // first does nothing the person can see.
      async function setExternal(on){
        setBusy(true);
        try{
          const patch={activityIncludeExternal:on};
          if(on&&data&&!data.externalEnabled)patch.codexEnabled=true;
          const r=await getJson('/api/dsh-focusing.settings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({settings:patch})});
          if(r&&r.ok===false)throw new Error(r.detail||r.reason||'failed');
          if(r?.codexStatus)onCodexStatus?.(r.codexStatus);
          calCachePut(null);setTick(n=>n+1);
        }
        catch(e){setErr(e.message);}finally{setBusy(false);}
      }
      const months=String(t('calMonths')).split(',');
      // A month label sits over the first week of that month; the partial month
      // at the left edge is dropped when the next label would collide with it.
      const labels=[];
      for(let w=0;w<weeks;w++){
        const first=items.slice(w*7,w*7+7).find(Boolean);if(!first)continue;
        const m=Number(first.day.slice(5,7));
        if(!labels.length||labels[labels.length-1].m!==m)labels.push({w,m});
      }
      if(labels.length>1&&labels[1].w-labels[0].w<3)labels.shift();
      const split=d=>Object.entries(d.bySource||{}).map(([k,v])=>`${t(k==='codex'?'calCodex':'calDsh')} ${v}`).join(' · ');
      const tip=d=>d.turns?`${d.day} · ${fmt(t('calTip'),{turns:d.turns,sessions:d.sessions,calls:d.calls})}${split(d)?` · ${split(d)}`:''}`:`${d.day} · ${t('calNone')}`;
      const codexTurns=cells.reduce((n,d)=>n+(d.bySource?.codex||0),0);
      const externalOn=!!data?.includeExternal;
      const note=!data?'':!data.externalEnabled?t('calExternalOff'):externalOn&&!data.externalAvailable?t('calExternalBroken'):externalOn?fmt(t('calExternalCount'),{n:codexTurns}):'';
      return h('div',{className:'fw-card fw-cal'},
        h('div',{className:'fw-cal-head'},
          h('div',{className:'fw-cal-sum'},data?fmt(t('calSummary'),{total:data.total,days:data.activeDays,longest:data.longestStreak,current:data.currentStreak}):(err?'':t('wb_loading'))),
          h('div',{className:'fw-cal-tools'},
            // One button for the whole control: the box, the label text and the
            // padding around them all toggle it, not just the tiny checkbox.
            h('button',{type:'button',className:`fw-cal-ext${externalOn?' on':''}`,role:'switch','aria-checked':String(externalOn),disabled:busy||!data,title:data&&!data.externalEnabled?t('calExternalHintOff'):t('calExternalHint'),onClick:()=>setExternal(!externalOn)},
              h('span',{className:'fw-cal-box','aria-hidden':true},externalOn?'✓':''),
              h('span',null,t('calExternal'))))),
        err?h('div',{className:'fw-cal-err',role:'alert'},`${t('calFailed')} · ${err}`):null,
        h('div',{className:'fw-cal-scroll'},
          h('div',{className:'fw-cal-grid-wrap',ref:wrapRef},
            h('div',{className:'fw-cal-months',style:{gridTemplateColumns:`repeat(${weeks},var(--calw,13px))`}},...labels.map(l=>h('span',{key:l.w,style:{gridColumn:l.w+1}},months[l.m-1]||''))),
            h('div',{className:`fw-cal-grid${data?'':' loading'}`,role:'img','aria-label':data?fmt(t('calSummary'),{total:data.total,days:data.activeDays,longest:data.longestStreak,current:data.currentStreak}):t('wb_loading')},
              ...(data?items:Array(span).fill(undefined)).map((d,i)=>d===null?h('span',{key:`p${i}`,className:'fw-cal-cell pad'}):h('span',{key:d?.day||`s${i}`,className:`fw-cal-cell l${d?d.level:0}`,title:d?tip(d):undefined}))))),
        h('div',{className:'fw-cal-foot'},
          h('span',{className:'fw-cal-note'},note,null),
          h('span',{className:'fw-cal-legend','aria-hidden':true},t('calLess'),...[0,1,2,3,4].map(l=>h('span',{key:l,className:`fw-cal-cell l${l}`})),t('calMore'))));
    }

    // The two summary lines at the foot of the nav. The first is the model in
    // force; the second says whether Codex chats are set up. A folder that works
    // reads as set up at once: nothing waits for the background read, and the
    // count is only in the hover text.
    function codexLineText(status,t){
      const on=!!(status&&status.enabled&&status.ok);
      return `${t('codexChipLabel')} · ${on?t('codexSet'):t('codexUnset')}`;
    }
    function codexLineTitle(status,t){
      if(!status||!status.enabled)return `${t('codexChipLabel')} · ${t('codexOff')}`;
      if(!status.ok)return `${t('codexChipLabel')} · ${t('codexProblem')}`;
      return `${t('codexChipLabel')} · ${t('codexOn').replace('{n}',String(status.sessions??0))}${status.path?` · ${status.path}`:''}`;
    }
    function Workbench({t,subscribeLocale,openSession,startDraft,settingsSummary}){
      const [,setLocaleTick]=React.useState(0);
      const page=wbPageLoad();
      const [view,setView]=React.useState(page.view);
      const [digestId,setDigestId]=React.useState(page.digestId);
      const [digest,setDigest]=React.useState(null);
      const [digestError,setDigestError]=React.useState('');
      const [digests,setDigests]=React.useState(null);
      const [ask,setAsk]=React.useState('');
      const [range,setRange]=React.useState(page.range);
      const [home,setHome]=React.useState(null);
      const [fu,setFu]=React.useState(''), [fuBusy,setFuBusy]=React.useState(false), [fuError,setFuError]=React.useState('');
      const [recRange,setRecRange]=React.useState(page.recRange), [recQuery,setRecQuery]=React.useState(page.recQuery), [recProject,setRecProject]=React.useState(page.recProject), [recWorkspaces,setRecWorkspaces]=React.useState(page.recWorkspaces);
      const [records,setRecords]=React.useState(null), [recError,setRecError]=React.useState('');
      const [expanded,setExpanded]=React.useState(page.expanded), [detail,setDetail]=React.useState(null);
      const [toast,setToast]=React.useState('');
      // The global settings dialog: one instance for every module.
      const [settingsOpen,setSettingsOpen]=React.useState(false);
      const [settingsTab,setSettingsTab]=React.useState('model');
      // The model label the person last saved. Kept in sessionStorage so coming
      // back to the panel shows it at once, without waiting for a round trip.
      const readSavedModel=()=>{try{return window.sessionStorage?.getItem('dsh-focusing.modelLabel')||null;}catch{return null;}};
      const [savedModel,setSavedModelRaw]=React.useState(readSavedModel());
      const setSavedModel=label=>{setSavedModelRaw(label);try{if(label)window.sessionStorage?.setItem('dsh-focusing.modelLabel',label);else window.sessionStorage?.removeItem('dsh-focusing.modelLabel');}catch{}};
      const [now,setNow]=React.useState(Date.now());
      // Rooms (appended after the existing hooks so their order stays stable).
      const [rooms,setRooms]=React.useState(null), [roomId,setRoomId]=React.useState(page.roomId), [room,setRoom]=React.useState(null), [roomErr,setRoomErr]=React.useState('');
      const [form,setForm]=React.useState(null), [pickList,setPickList]=React.useState(null), [modelList,setModelList]=React.useState(null);
      const [sayText,setSayText]=React.useState(''), [roomBusy,setRoomBusy]=React.useState(false);
      const toastTimer=React.useRef(null);
      React.useEffect(()=>subscribeLocale(()=>setLocaleTick(n=>n+1)),[subscribeLocale]);
      // Remember the page, its subject and its filters.
      React.useEffect(()=>{
        wbPageSave({view,digestId,roomId,range,recRange,recQuery,recProject,recWorkspaces,expanded});
      },[view,digestId,roomId,range,recRange,recQuery,recProject,recWorkspaces,expanded]);
      const say=msg=>{setToast(msg);clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(''),2600);};
      const openSettings=(tab)=>{setSettingsTab(tab||'model');setSettingsOpen(true);};
      const [liveSummary,setLiveSummary]=React.useState(settingsSummary||null);
      const onModelSummary=summary=>setLiveSummary(prev=>prev===summary?prev:summary);
      // Coming back to the panel remounts this component and drops the state
      // savedModel held. Pull the live summary and Codex status once, so the
      // nav shows what is actually in force instead of the injected snapshot.
      React.useEffect(()=>{
        const c=new AbortController();
        getJson(ROUTE,{signal:c.signal})
          .then(b=>{if(c.signal.aborted)return;
            if(b.settingsSummary)setLiveSummary(b.settingsSummary);
            if(b.codexStatus)setCodexStatus(b.codexStatus);})
          .catch(()=>{});
        return()=>c.abort();
      },[]);
      // What the Codex import found, shown on the nav card; the panel and the
      // settings dialog both report it, whichever spoke last wins.
      const [codexStatus,setCodexStatus]=React.useState(null);
      const [,setAskTick]=React.useState(0);
      // The Ask page: its own input, and a scroll area that follows the thread
      // while the person is at the bottom.
      const [chatText,setChatText]=React.useState('');
      // Digest templates: the shipped set plus the person's own, and the small
      // form that adds or edits one.
      const [templates,setTemplates]=React.useState(()=>tplCacheGet());
      const [tplForm,setTplForm]=React.useState(null), [tplView,setTplView]=React.useState(null);
      const [tplBusy,setTplBusy]=React.useState(false), [tplErr,setTplErr]=React.useState('');
      // Groups are open by default and each shows a few rows; folding one is the
      // reader's choice. The sidebar stays one screen tall either way.
      const [chatFold,setChatFold]=React.useState({});
      const [chatMore,setChatMore]=React.useState({});
      const chatScroll=React.useRef(null), chatStick=React.useRef(true), chatLast=React.useRef(null);
      React.useEffect(()=>askStore.subscribe(()=>setAskTick(n=>n+1)),[]);
      const asks=askStore.get();
      const activeConv=askStore.active();
      const chatTail=`${activeConv?.id}|${activeConv?.messages?.length}|${activeConv?.steps?.length}|${activeConv?.status}`;
      React.useEffect(()=>{
        const el=chatScroll.current;if(!el)return;
        if(chatLast.current!==activeConv?.id){chatLast.current=activeConv?.id;chatStick.current=true;}
        if(chatStick.current)el.scrollTop=el.scrollHeight;
      },[chatTail,view]);

      React.useEffect(()=>()=>clearTimeout(toastTimer.current),[]);

      const loadDigests=React.useCallback?React.useCallback(async()=>{try{const b=await getJson(WB.digests);if(b.ok)setDigests(b.digests||[]);}catch{setDigests(d=>d??[]);}},[]):async()=>{};
      React.useEffect(()=>{if(view==='home'||view==='digests')loadDigests();if(view==='digests')loadTemplates();},[view]);
      React.useEffect(()=>{
        if(view!=='home')return;const c=new AbortController();
        getJson(`${WB.records}?range=this-week&offset=${tzOffset()}`,{signal:c.signal}).then(b=>{if(b.ok)setHome({range:b.range,stats:b.stats});}).catch(()=>{});
        return()=>c.abort();
      },[view]);
      // Poll a digest while it is generating.
      React.useEffect(()=>{
        if(view!=='result'||!digestId)return;let timer;const c=new AbortController();
        const load=async()=>{
          try{const b=await getJson(`${WB.digest}?id=${encodeURIComponent(digestId)}`,{signal:c.signal});
            if(c.signal.aborted)return;
            if(!b.ok){setDigestError(b.detail||b.reason||'not-found');return;}
            setDigest(b.digest);setDigestError('');
            if(b.digest.status==='running')timer=setTimeout(load,1200);
          }catch(e){if(!c.signal.aborted){setDigestError(e.message);timer=setTimeout(load,3000);}}
        };
        load();return()=>{c.abort();clearTimeout(timer);};
      },[view,digestId]);
      React.useEffect(()=>{
        if(!(view==='result'&&digest?.status==='running'))return;
        const id=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(id);
      },[view,digest?.status]);
      // Records list.
      React.useEffect(()=>{
        if(view!=='records')return;const c=new AbortController();
        const timer=setTimeout(()=>{
          setRecError('');
          getJson(`${WB.records}?range=${recRange}&offset=${tzOffset()}&q=${encodeURIComponent(recQuery)}&project=${encodeURIComponent(recProject)}&cwd=${encodeURIComponent((recWorkspaces||[]).join('\n'))}`,{signal:c.signal})
            .then(b=>{if(c.signal.aborted)return;if(b.ok)setRecords(b);else{setRecError(`${b.detail||b.reason||'failed'} · ${WB.records}`);}})
            .catch(e=>{if(!c.signal.aborted)setRecError(e.message);});
        },recQuery?300:0);
        return()=>{c.abort();clearTimeout(timer);};
      },[view,recRange,recQuery,recProject,recWorkspaces]);
      React.useEffect(()=>{
        if(!expanded)return;const c=new AbortController();setDetail(null);
        getJson(`${WB.detail}?id=${encodeURIComponent(expanded)}&offset=${tzOffset()}`,{signal:c.signal}).then(b=>{if(!c.signal.aborted)setDetail(b.ok?b.record:{error:b.reason});}).catch(e=>{if(!c.signal.aborted)setDetail({error:e.message});});
        return()=>c.abort();
      },[expanded]);

      // ---------------------------------------------------------- rooms data
      const loadRooms=async()=>{try{const b=await getJson(WB.rooms);if(b.ok)setRooms(b.rooms||[]);}catch{setRooms(r=>r??[]);}};
      React.useEffect(()=>{if(view==='rooms')loadRooms();},[view]);
      React.useEffect(()=>{
        if(view!=='rooms'||!form||pickList)return;const c=new AbortController();
        getJson(`${WB.records}?range=last-30d&offset=${tzOffset()}`,{signal:c.signal}).then(b=>{if(!c.signal.aborted)setPickList(b.ok?(b.records||[]).filter(r=>r.source!=='codex'):[]);}).catch(()=>{if(!c.signal.aborted)setPickList([]);});
        getJson(WB.models,{signal:c.signal}).then(b=>{if(!c.signal.aborted)setModelList(b.ok?b.models||[]:[]);}).catch(()=>{if(!c.signal.aborted)setModelList([]);});
        return()=>c.abort();
      },[view,form,pickList]);
      // Poll an open room while a participant is speaking or a brief is being written.
      React.useEffect(()=>{
        if(view!=='room'||!roomId)return;let timer;const c=new AbortController();
        const load=async()=>{
          try{const b=await getJson(`${WB.room}?id=${encodeURIComponent(roomId)}`,{signal:c.signal});if(c.signal.aborted)return;
            if(!b.ok){setRoomErr(b.reason||'not-found');return;}setRoom(b.room);setRoomErr('');
            if(b.room.pending)timer=setTimeout(load,1500);}
          catch(e){if(!c.signal.aborted){setRoomErr(e.message);timer=setTimeout(load,3000);}}
        };
        load();return()=>{c.abort();clearTimeout(timer);};
      },[view,roomId,room?.pending?.kind,room?.pending?.speaker,tickRoom(room)]);
      function tickRoom(r){return r?`${r.messages?.length||0}:${r.handoff?.at||0}`:'';}
      async function roomAction(action,extra={},{quiet}={}){
        if(!room&&action!=='create')return;
        setRoomBusy(true);
        try{const b=await getJson(WB.room,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,id:room?.id,...extra})});
          if(!b.ok){say(b.reason==='busy'?t('wb_busy'):`${t('wb_failedReq')} · ${b.detail||b.reason||''}`);if(b.room)setRoom(b.room);return b;}
          if(b.room)setRoom(b.room);if(!quiet&&action==='resnap')say(fmt(t('wb_resnapNote'),{label:room.participants[extra.index]?.label}));return b;}
        catch(e){say(`${t('wb_failedReq')} · ${e.message}`);}finally{setRoomBusy(false);}
      }
      async function createRoom(){
        const picks=(form?.picks||[]);if(!picks.length){say(t('wb_needSession'));return;}
        setRoomBusy(true);
        try{const b=await getJson(WB.room,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'create',topic:form.topic||'',sessions:picks.map(p=>p.id),routes:picks.map(p=>p.route||null)})});
          if(!b.ok){say(`${t('wb_failedReq')} · ${b.detail||b.reason||''}`);return;}
          setForm(null);setPickList(null);setRoom(b.room);setRoomId(b.room.id);setView('room');}
        catch(e){say(`${t('wb_failedReq')} · ${e.message}`);}finally{setRoomBusy(false);}
      }
      function openRoom(id){setRoom(null);setRoomErr('');setRoomId(id);setSayText('');setView('room');}
      async function sendSay(thenSpeak){
        const text=sayText.trim();
        if(text){const b=await roomAction('say',{text});if(!b?.ok)return;setSayText('');}
        if(thenSpeak!==undefined)await roomAction('turn',{speakers:thenSpeak});
      }
      async function openHandoff(){
        if(!room?.handoff?.text)return;
        const target=await getJson(WB.room,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'target',id:room.id})}).catch(()=>({}));
        const ok=startDraft?.(target?.workspaceId||undefined,room.handoff.text);
        if(ok){await roomAction('opened',{}, {quiet:true});say(t('wb_opened'));}
        else{try{await navigator.clipboard.writeText(room.handoff.text);say(t('wb_copied'));}catch(e){say(e.message);}}
      }
      async function startDigest(text,extra={}){
        const request=String(text||'').trim();
        if(!request){say(t('wb_emptyAsk'));return;}
        try{
          const b=await getJson(WB.digest,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({request,range:range||undefined,rangeLocked:!!range,offset:tzOffset(),locale:/^en/i.test(navigator.language||'')&&!/[\u4e00-\u9fff]/.test(request)?'en':'zh',...extra})});
          if(!b.ok){say(b.reason==='busy'?t('wb_busy'):`${t('wb_failedReq')} · ${b.detail||b.reason||''}`);return;}
          setDigest(b.digest);setDigestId(b.digest.id);setFu('');setFuError('');setView('result');setAsk('');
        }catch(e){say(`${t('wb_failedReq')} · ${e.message}`);}
      }
      function openDigest(id){setDigest(null);setDigestError('');setDigestId(id);setFu('');setFuError('');setView('result');}
      async function removeDigest(id){
        try{const b=await getJson(WB.digest,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'delete',id})});if(b.ok){say(t('wb_deleted'));if(view==='result')setView('digests');loadDigests();}}catch(e){say(e.message);}
      }
      async function copyMd(id){
        try{const res=await fetch(`${WB.exportMd}?id=${encodeURIComponent(id)}`,{credentials:'same-origin'});if(!res.ok)throw new Error(`HTTP ${res.status}`);await navigator.clipboard.writeText(await res.text());say(t('wb_copied'));}
        catch(e){say(`${t('wb_failedReq')} · ${e.message}`);}
      }
      function download(id){const a=document.createElement('a');a.href=`${WB.exportMd}?id=${encodeURIComponent(id)}`;a.download='';document.body.appendChild(a);a.click();a.remove();}
      async function sendFollowup(){
        const q=fu.trim();if(!q||!digest)return;setFuBusy(true);setFuError('');
        try{const b=await getJson(WB.followup,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:digest.id,question:q})});
          if(!b.ok){setFuError(b.detail||b.reason||t('wb_failedReq'));return;}setDigest(b.digest);setFu('');}
        catch(e){setFuError(e.message);}finally{setFuBusy(false);}
      }
      const relTime=at=>{if(!at)return '—';const d=new Date(at),n=new Date();const sameDay=d.toDateString()===n.toDateString();const hm=d.toTimeString().slice(0,5);if(sameDay)return hm;const days=Math.round((new Date(n.toDateString())-new Date(d.toDateString()))/86400000);return days===1?`${t('r_yesterday')} ${hm}`:`${d.getMonth()+1}/${d.getDate()} ${hm}`;};
      const rangeText=r=>r?`${r.label||t(`r_${r.key}`)} · ${r.from===r.to?r.from:`${r.from} – ${r.to}`}`:'';
      const kindPill=k=>h('span',{className:'fw-pill blue'},t(`k_${k||'digest'}`));
      const sh=(title,hint)=>h('div',{className:'fw-sh'},h('h3',null,title),hint?(typeof hint==='string'?h('span',null,hint):hint):null);
      const runningCount=(digests||[]).filter(d=>d.running).length;

      // ---------------------------------------------------------- home
      // ---------------------------------------------------------- ask
      // Asking has a page of its own: past conversations on the left, the open
      // thread in the middle, one input at the bottom. Conversations are kept on
      // the Host and the store outlives this page, so a running turn carries on
      // while another entry is open.
      function sendAsk(text){
        const question=String(text||'').trim();
        if(!question)return;
        setChatText('');
        askStore.send(question);
      }
      const deleteAsk=id=>askStore.remove(id);
      const stopAsk=id=>askStore.stop(id);
      const askRunning=asks.filter(c=>c.status==='running').length;
      // Conversations sit at the foot of the sidebar on every page, so switching
      // threads never costs a trip through another page. Picking one opens it.
      const chatItem=c=>h('button',{key:c.id,type:'button',role:'option','aria-selected':c.id===activeConv?.id,className:`fw-nav-chat${c.id===activeConv?.id?' active':''}`,title:c.title||'',onClick:()=>{askStore.pick(c.id);setView('ask');}},
        c.status==='running'?h('span',{className:'fw-spin'}):null,
        h('span',{className:'fw-nav-chat-t'},c.title||c.id),
        h('time',null,relTime(c.updatedAt||c.createdAt)));
      const chatShow=8;
      const navChats=()=>{
        const startOfDay=at=>{const d=new Date(at||0);d.setHours(0,0,0,0);return d.getTime();};
        const today=startOfDay(Date.now()), yesterday=today-864e5;
        const groups=[{key:'today',label:t('askToday'),list:[]},{key:'yesterday',label:t('askYesterday'),list:[]},{key:'older',label:t('askOlder'),list:[]}];
        for(const c of asks){const at=c.updatedAt||c.createdAt||0;groups[at>=today?0:at>=yesterday?1:2].list.push(c);}
        const block=g=>{
          if(!g.list.length)return null;
          const folded=!!chatFold[g.key], all=!!chatMore[g.key];
          const shown=all?g.list:g.list.slice(0,chatShow);
          const rest=g.list.length-shown.length;
          return h('div',{key:g.key,className:'fw-nav-group'},
            h('button',{className:'fw-nav-group-head',type:'button','aria-expanded':!folded,onClick:()=>setChatFold(f=>({...f,[g.key]:!f[g.key]}))},
              h(WIcon,{name:'chevron'}),h('span',null,g.label),h('em',null,String(g.list.length))),
            folded?null:h('div',{className:'fw-nav-chat-list'},...shown.map(chatItem),
              rest>0?h('button',{className:'fw-nav-more',type:'button',onClick:()=>setChatMore(m=>({...m,[g.key]:true}))},t('askMore').replace('{n}',rest)):null));
        };
        return h('div',{className:'fw-nav-chats'},
        h('div',{className:'fw-nav-chats-head'},
          h('span',{className:'fw-nav-chats-label'},t('askChats')),
          h('button',{className:'fw-nav-new',type:'button',title:t('askNew'),'aria-label':t('askNew'),onClick:()=>{askStore.newChat();setView('ask');}},h(WIcon,{name:'plus'}))),
        h('div',{className:'fw-nav-groups',role:'listbox','aria-label':t('askPick')},
          ...(asks.length?groups.map(block):[h('div',{className:'fw-nav-chat-none'},t('askNone'))])));
      };
      function renderAsk(){
        const running=activeConv?.status==='running';
        const head=h('header',{className:'fw-chat-head'},
          // The list lives in the sidebar; a narrow panel swaps it for this.
          h('select',{className:'fw-chat-pick',value:activeConv?.id||'','aria-label':t('askPick'),onChange:e=>e.target.value?askStore.pick(e.target.value):askStore.newChat()},
            h('option',{value:''},t('askNew')),...asks.map(c=>h('option',{key:c.id,value:c.id},c.title||c.id))),
          h('div',{className:'fw-chat-heading',title:activeConv?.title||''},activeConv?activeConv.title:t('askNew')),
          activeConv?h('button',{className:'fw-text-btn',type:'button',onClick:()=>deleteAsk(activeConv.id)},h(WIcon,{name:'trash'}),t('askDelete')):null);
        const empty=h('div',{className:'fw-chat-empty'},
          h('h2',null,t('askEmptyTitle')),h('p',null,t('askEmptySub')),
          h('div',{className:'fw-chips'},...['askS1','askS2','askS3','askS4'].map(k=>h('button',{key:k,className:'fw-chip',type:'button',onClick:()=>sendAsk(t(k))},t(k)))));
        const composer=h('div',{className:'fw-chat-composer'},h('div',{className:'fw-chat-box'},
          h('textarea',{rows:1,value:chatText,placeholder:activeConv?t('askFollowPh'):t('askPlaceholder'),'aria-label':t('askPlaceholder'),onChange:e=>setChatText(e.target.value),onKeyDown:e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent?.isComposing){e.preventDefault();if(!running)sendAsk(chatText);}}}),
          h('div',{className:'fw-chat-foot'},
            h('span',{className:'fw-ask-hint'},t('askHint')),
            h('select',{className:'fw-chat-range',value:askStore.range(),'aria-label':t('askRange'),title:t('askRange'),onChange:e=>askStore.setRange(e.target.value)},
              ...ASK_RANGES.map(([k,l])=>h('option',{key:k,value:k},t(l)))),
            running?h('button',{className:'fw-btn',type:'button',onClick:()=>stopAsk(activeConv.id)},t('askStop'))
              :h('button',{className:'fw-btn primary',type:'button',disabled:!chatText.trim(),onClick:()=>sendAsk(chatText)},h(WIcon,{name:'send'}),t('askSend')))));
        return h('div',{className:'fw-chat'},
          h('section',{className:'fw-chat-main'},head,
            h('div',{className:'fw-chat-scroll',ref:chatScroll,onScroll:e=>{const el=e.target;chatStick.current=el.scrollHeight-el.scrollTop-el.clientHeight<80;}},
              h('div',{className:'fw-chat-col'},activeConv?h(ChatView,{key:activeConv.id,conv:activeConv,t}):empty)),
            composer));
      }

      // ---------------------------------------------------------- home
      // A guide, not a form: where each feature lives, how the year looks, and
      // the last few things done. Nothing is typed here.
      function renderHome(){
        const st=home?.stats;
        const recentDigests=(digests||[]).slice(0,3);
        const recentChats=asks.slice(0,3);
        const entry=([v,icon,c,ti,tx])=>h('button',{key:v,className:'fw-cap',type:'button',onClick:()=>setView(v)},
          h('span',{className:'fw-cap-icon',style:{background:`var(--${c}-soft)`,color:`var(--${c})`}},h(WIcon,{name:icon})),
          h('h4',null,t(ti)),h('p',null,t(tx)));
        const chatRow=c=>h('button',{key:c.id,className:'fw-row',type:'button',onClick:()=>{askStore.pick(c.id);setView('ask');}},
          c.status==='running'?h('span',{className:'fw-spin'}):null,
          h('span',{className:'grow'},c.title||c.id),h('time',null,relTime(c.updatedAt||c.createdAt)),h(WIcon,{name:'arrow'}));
        return h('div',{className:'fw-page'},
          h('div',{className:'fw-hero'},
            h('h2',null,t('wb_heroTitle')),h('p',null,t('wb_heroSub')),
            h('div',{className:'fw-live'},st?fmt(t('wb_liveStats'),{range:home.range?.label||t('r_this-week'),sessions:st.sessions,projects:st.projects,days:st.activeDays}):'')),
          h('div',{className:'fw-caps'},...[['ask','chat','blue','wb_capAsk','wb_capAskText'],['records','layers','green','wb_capRecords','wb_capRecordsText'],['digests','doc','amber','wb_capDigest','wb_capDigestText'],['rooms','users','blue','wb_capRooms','wb_capRoomsText'],['focus','pulse','red','wb_capFocus','wb_capFocusText']].map(entry)),
          sh(t('calTitle')),
          h(ActivityCalendar,{t,openSettings,onCodexStatus:setCodexStatus}),
          h('div',{className:'fw-recent2'},
            h('section',null,
              sh(t('wb_recentChats'),h('button',{className:'fw-text-btn',type:'button',onClick:()=>setView('ask')},t('wb_viewAll'),' →')),
              h('div',{className:'fw-card'},recentChats.length?recentChats.map(chatRow):h('div',{className:'fw-empty'},t('wb_noChats')))),
            h('section',null,
              sh(t('wb_recent'),h('button',{className:'fw-text-btn',type:'button',onClick:()=>setView('digests')},t('wb_viewAll'),' →')),
              h('div',{className:'fw-card'},recentDigests.length?recentDigests.map(d=>digestRow(d)):h('div',{className:'fw-empty'},digests===null?t('wb_loading'):t('wb_noRecent'))))));
      }
      function digestRow(d,withDelete){
        return h('div',{key:d.id,style:{display:'flex',alignItems:'center'},className:'fw-row-wrap'},
          h('button',{className:'fw-row',type:'button',onClick:()=>openDigest(d.id)},
            d.running?h('span',{className:'fw-spin'}):kindPill(d.kind),
            h('span',{className:'grow'},d.title||d.request),
            h('time',null,`${d.range?.label||''} · ${relTime(d.createdAt)}`),h(WIcon,{name:'arrow'})),
          withDelete&&!d.running?h('button',{className:'fw-text-btn',type:'button','aria-label':t('wb_delete'),title:t('wb_delete'),style:{padding:'0 12px',color:'var(--muted)'},onClick:()=>removeDigest(d.id)},h(WIcon,{name:'trash'})):null);
      }

      // ---------------------------------------------------------- result
      function renderResult(){
        if(!digest)return h('div',{className:'fw-page'},digestError?h('div',{className:'fw-notice red'},h(WIcon,{name:'warn'}),h('div',null,h('b',null,t('wb_failed')),h('p',null,digestError))):h('div',{className:'fw-empty'},t('wb_loading')));
        const back=h('button',{className:'fw-text-btn',type:'button',style:{marginBottom:10},onClick:()=>setView('home')},h(WIcon,{name:'back'}),t('wb_back'));
        const echo=h('div',{className:'fw-echo'},h(WIcon,{name:'spark'}),h('span',{style:{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}},digest.request));
        if(digest.status==='running'){
          const order=['scan','fold','model','done'];const at=Math.max(0,order.indexOf(digest.stage));
          const labels=['wb_stageScan','wb_stageFold','wb_stageModel','wb_stageDone'];
          return h('div',{className:'fw-page'},back,h('div',null,echo),
            h('div',{className:'fw-card fw-thinking','aria-live':'polite'},
              ...labels.map((k,i)=>h('div',{key:k,className:`fw-think${i<at?' done':''}`},i<at?h(WIcon,{name:'check'}):i===at?h('span',{className:'fw-spin'}):h('span',{className:'fw-gap'}),t(k),
                i===0&&digest.stats?h('span',{className:'fw-pill gray',style:{marginLeft:6}},fmt(t('wb_found'),{sessions:digest.stats.sessions,calls:digest.stats.calls})):null)),
              h('div',{style:{fontSize:11,color:'var(--muted)'}},`${rangeText(digest.range)} · ${fmt(t('wb_elapsed'),{s:Math.max(0,Math.round((now-digest.createdAt)/1000))})}`)));
        }
        if(digest.status==='failed'){
          return h('div',{className:'fw-page'},back,h('div',null,echo),h('div',{className:'fw-notice red'},h(WIcon,{name:'warn'}),h('div',null,h('b',null,t('wb_failed')),h('p',null,digest.error?.detail||''),
            h('div',{style:{marginTop:8}},h('button',{className:'fw-btn',type:'button',onClick:()=>startDigest(digest.request,{range:digest.range.key,rangeLocked:true})},t('wb_retry'))))));
        }
        const r=digest.result||{projects:[],days:[],next:[],sections:[]};const s=digest.stats||{};
        const stateLabel={done:'wb_done',doing:'wb_doing',risk:'wb_risk'};
        const statusPill={done:'green',active:'blue',blocked:'red',paused:'gray'};
        const sourceTitle=id=>(digest.sources||[]).find(x=>x.id===id)?.title||id.slice(0,8);
        return h('div',{className:'fw-page'},back,h('div',null,echo),
          h('div',{className:'fw-result-head'},
            h('div',{style:{minWidth:0}},h('h2',{className:'fw-h2'},r.title||digest.request),
              h('div',{className:'fw-sub',style:{margin:0}},rangeText(digest.range),digest.model?` · ${t('wb_model')} ${digest.model}`:'',digest.draft?h('span',{className:'fw-pill amber',style:{marginLeft:8}},t('wb_draft')):null)),
            h('div',{className:'fw-actions'},
              h('button',{className:'fw-btn',type:'button',onClick:()=>copyMd(digest.id)},h(WIcon,{name:'copy'}),t('wb_copy')),
              h('button',{className:'fw-btn',type:'button',onClick:()=>download(digest.id)},h(WIcon,{name:'download'}),t('wb_download')),
              h('button',{className:'fw-btn',type:'button',onClick:()=>startDigest(digest.request,{range:digest.range.key,rangeLocked:true,session:digest.range.key==='session'?digest.sessionIds?.[0]:undefined})},h(WIcon,{name:'refresh'}),t('wb_regen')),
              h('button',{className:'fw-btn danger',type:'button',onClick:()=>removeDigest(digest.id)},h(WIcon,{name:'trash'})))),
          digest.note==='empty'?h('div',{className:'fw-notice'},h(WIcon,{name:'warn'}),h('div',null,h('b',null,t('wb_emptyRange')))):
          digest.draft&&digest.error?h('div',{className:'fw-notice'},h(WIcon,{name:'warn'}),h('div',null,h('b',null,t('wb_draftTitle')),h('p',null,`${digest.error.reason||''} · ${digest.error.detail||''}`),
            h('div',{style:{marginTop:6}},h('button',{className:'fw-btn',type:'button',onClick:()=>openSettings('model')},t('wb_openSettings'))))):null,
          r.summary?h('div',{className:'fw-card fw-summary'},h(Md,{text:r.summary})):null,
          h('div',{className:'fw-stats'},...[['wb_statSessions',s.sessions],['wb_statProjects',s.projects],['wb_statDays',s.activeDays],['wb_statCalls',s.calls]].map(([k,v])=>h('div',{key:k,className:'fw-stat'},h('span',null,t(k)),h('strong',null,String(v??0))))),
          r.projects.length?h(React.Fragment,null,sh(t('wb_byProject'),t('wb_byProjectHint')),
            h('div',{className:'fw-card'},...r.projects.map((p,i)=>h('div',{key:i,className:'fw-proj'},
              h('div',{className:'fw-proj-head'},h('span',{className:`fw-dot${p.status==='active'?' on':''}`}),h('h4',null,p.name),h('span',{className:`fw-pill ${statusPill[p.status]||'gray'}`},t(`st_${p.status}`)),p.progress!==null?h('span',{className:'pct'},`${p.progress}%`):null),
              p.headline?h('p',{className:'fw-headline'},p.headline):null,
              p.progress!==null?h('div',{className:'fw-bar'},h('i',{className:p.progress>=100?'done':'',style:{width:`${p.progress}%`}})):null,
              h('ul',{className:'fw-items'},...p.items.map((it,j)=>h('li',{key:j},h('span',{className:`fw-mark ${it.state}`},t(stateLabel[it.state])),h('span',null,it.text,
                ...(it.sessions||[]).slice(0,2).map(id=>h('button',{key:id,className:'fw-text-btn',type:'button',title:sourceTitle(id),onClick:()=>openSession(id)},'↗')))))))))):null,
          r.days.length?h(React.Fragment,null,sh(t('wb_byDay'),rangeText(digest.range)),
            h('div',{className:'fw-card'},...r.days.map((d,i)=>{const dt=new Date(`${d.day}T00:00:00`);const wd=isNaN(dt)?'':dt.toLocaleDateString(undefined,{weekday:'short'});
              return h('div',{key:i,className:'fw-day'},h('div',null,h('b',null,wd),h('small',null,d.day.slice(5))),
                h('ul',{className:'fw-items'},...d.items.map((it,j)=>h('li',{key:j},h('span',{className:'fw-dot',style:{background:'var(--blue)',width:5,height:5,position:'relative',top:-2}}),h('span',null,it.text,it.project?h('em',null,` · ${it.project}`):null)))));}))):null,
          r.next.length?h(React.Fragment,null,sh(t('wb_next')),h('div',{className:'fw-card',style:{padding:'12px 18px'}},h('ul',{className:'fw-items'},...r.next.map((n,i)=>h('li',{key:i},h('span',{className:'fw-mark doing'},String(i+1)),h('span',null,n)))))):null,
          ...r.sections.map((sec,i)=>h(React.Fragment,{key:`sec${i}`},sh(sec.title),h('div',{className:'fw-card fw-summary'},h(Md,{text:sec.body})))),
          (digest.sources||[]).length?h(React.Fragment,null,sh(t('wb_sources'),t('wb_sourcesHint')),
            h('div',{className:'fw-sources'},...digest.sources.map(src=>h('button',{key:src.id,className:'fw-source',type:'button',title:`${src.project} · ${src.calls} ${t('wb_calls')}`,onClick:()=>{if(src.id.startsWith('codex:')){setView('records');setRecRange('last-30d');setRecQuery('');setRecProject('');setExpanded(src.id);}else openSession(src.id);}},h(WIcon,{name:'layers'}),h('span',null,src.title||src.id))))):null,
          sh(t('wb_followTitle'),t('wb_followHint')),
          ...(digest.followups||[]).map((f,i)=>h('div',{key:`fu${i}`,className:'fw-card fw-fu'},h('div',{className:'fw-fu-q'},`${t('wb_you')}：${f.q}`),h(Md,{text:f.a}))),
          fuError?h('div',{className:'fw-notice red',style:{marginTop:8}},h(WIcon,{name:'warn'}),h('div',null,h('b',null,t('wb_failedReq')),h('p',null,fuError))):null,
          h('div',{className:'fw-ask',style:{maxWidth:'none',marginTop:8}},
            h('textarea',{rows:1,value:fu,placeholder:t('wb_followPh'),'aria-label':t('wb_followTitle'),onChange:e=>setFu(e.target.value),onKeyDown:e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent?.isComposing){e.preventDefault();sendFollowup();}}}),
            h('div',{className:'fw-ask-foot',style:{justifyContent:'flex-end'}},h('button',{className:'fw-btn primary',type:'button',disabled:fuBusy||!fu.trim(),onClick:sendFollowup},fuBusy?h('span',{className:'fw-spin'}):h(WIcon,{name:'send'}),t('wb_follow')))));
      }

      // ---------------------------------------------------------- records
      function renderRecords(){
        const list=records?.records||[];const st=records?.stats;
        return h('div',{className:'fw-page'},
          h('div',{className:'fw-eyebrow'},'Context records'),h('h2',{className:'fw-h2'},t('wb_recTitle')),h('p',{className:'fw-sub'},t('wb_recSub')),
          h('div',{className:'fw-filter'},...['today','this-week','last-week','this-month','last-30d'].map(k=>h('button',{key:k,type:'button',className:`fw-seg${recRange===k?' on':''}`,onClick:()=>{setRecRange(k);setExpanded(null);}},t(`r_${k}`)))),
          h('div',{className:'fw-filter'},
            h('label',{className:'fw-search'},h(WIcon,{name:'search'}),h('input',{value:recQuery,placeholder:t('wb_search'),'aria-label':t('wb_search'),onChange:e=>setRecQuery(e.target.value)}))),
            
          st?h('div',{style:{fontSize:11.5,color:'var(--muted)',margin:'2px 0 10px'}},`${rangeText(records.range)} · ${fmt(t('wb_recStats'),{sessions:st.sessions,turns:st.turns,calls:st.calls})}`):null,
          h('div',{className:'fw-filter fw-workspace-filter'},h('span',{className:'fw-workspace-label'},t('wb_workspaceFilter')),...(records?.workspaces||[]).map(cwd=>{const parts=cwd.split(/[\\/]/).filter(Boolean),name=parts.at(-1)||cwd,duplicates=(records?.workspaces||[]).filter(p=>(p.split(/[\\/]/).filter(Boolean).at(-1)||p)===name).length>1,label=duplicates?`${parts.at(-2)||''} / ${name}`:name;return h('button',{key:cwd,type:'button',className:`fw-workspace-tag${recWorkspaces?.includes(cwd)?' on':''}`,'aria-pressed':String(recWorkspaces?.includes(cwd)),title:cwd,onClick:()=>setRecWorkspaces(current=>current.includes(cwd)?current.filter(x=>x!==cwd):[...current,cwd])},label)} )),
           
           expanded&&detail&&!list.some(r=>r.id===expanded)?renderDetail({...detail,id:expanded}):null,
          recError?h('div',{className:'fw-notice red'},h(WIcon,{name:'warn'}),h('div',null,h('b',null,t('wb_failedReq')),h('p',null,recError))):null,
          h('div',{className:'fw-card'},records===null?h('div',{className:'fw-empty'},t('wb_loading')):list.length?list.map(rec=>h('div',{key:rec.id,className:'fw-rec'},
            h('button',{className:'fw-rec-btn',type:'button','aria-expanded':expanded===rec.id,onClick:()=>setExpanded(expanded===rec.id?null:rec.id)},
              h('span',{className:'fw-rec-l1'},h('span',{className:`fw-dot${rec.running?' on':''}`}),h('span',{className:'t'},rec.title||t('untitled')),
                rec.running?h('span',{className:'fw-pill green'},t('wb_running')):rec.unfinished?h('span',{className:'fw-pill amber'},t('wb_unfinished')):null,
                rec.source==='codex'?h('span',{className:'fw-pill gray'},'Codex · '+t('codexReadOnly')):null,
                rec.todosTotal?h('span',{className:'fw-pill gray'},`☑ ${rec.todosDone}/${rec.todosTotal}`):null),
              h('span',{className:'fw-rec-l2'},rec.gist||rec.firstRequest),
              h('span',{className:'fw-rec-r'},rec.project?h('span',{className:'fw-pill gray'},rec.project):null,h('span',null,`${relTime(rec.lastAt)} · ${rec.turns} ${t('wb_turns')} · ${rec.calls} ${t('wb_calls')}`))),
            expanded===rec.id?renderDetail(rec):null)):h('div',{className:'fw-empty'},t('wb_noRecords'))));
      }
      function renderDetail(rec){
        if(!detail)return h('div',{className:'fw-detail'},h('div',{className:'fw-empty',style:{padding:10}},t('wb_loading')));
        if(detail.error)return h('div',{className:'fw-detail'},h('p',{style:{color:'var(--red)'}},detail.error));
        const cwd=detail.cwd||'';const short=f=>cwd&&f.startsWith(cwd)?f.slice(cwd.length).replace(/^\/+/,''):f;
        return h('div',{className:'fw-detail'},
          detail.requests?.length?h('div',null,h('h5',null,t('wb_asked')),h('ul',null,...detail.requests.slice(-8).map((q,i)=>h('li',{key:i},q.text.length>220?`${q.text.slice(0,220)}…`:q.text)))):null,
          detail.lastReply?h('div',null,h('h5',null,t('wb_lastReply')),h('div',{style:{fontSize:12.5,maxHeight:180,overflow:'auto'}},h(Md,{text:detail.lastReply}))):null,
          detail.files?.length?h('div',null,h('h5',null,`${t('wb_files')} (${detail.files.length})`),h('div',{className:'fw-files'},detail.files.slice(0,15).map(short).join(' · '))):null,
          detail.todos?.length?h('div',null,h('h5',null,t('wb_todos')),h('ul',{className:'fw-items'},...detail.todos.slice(0,12).map((td,i)=>h('li',{key:i},h('span',{className:`fw-mark ${td.status==='completed'?'done':td.status==='in_progress'?'doing':'risk'}`},td.status==='completed'?'✓':td.status==='in_progress'?'…':'○'),h('span',null,td.content))))):null,
          h('div',{className:'fw-actions'},
            rec.source!=='codex'?h('button',{className:'fw-btn',type:'button',onClick:()=>openSession(rec.id)},h(WIcon,{name:'arrow'}),t('wb_openSession')):null,
            h('button',{className:'fw-btn',type:'button',onClick:()=>startDigest(fmt(t('wb_handoffReq'),{title:rec.title||rec.id}),{session:rec.id})},h(WIcon,{name:'doc'}),t('wb_handoff'))));
      }

      // ---------------------------------------------------------- rooms
      const routeValue=r=>r==='external'?'external':r?.provider?`${r.provider}/${r.model}`:'';
      const parseRoute=v=>v==='external'?'external':v?{provider:v.split('/')[0],model:v.split('/').slice(1).join('/')}:null;
      function modelPicker(value,onChange){
        return h('label',{className:'fw-select'},t('wb_roomModel'),
          h('select',{value:routeValue(value),onChange:e=>onChange(parseRoute(e.target.value))},
            h('option',{value:''},t('wb_followSettings')),h('option',{value:'external'},t('wb_externalRoute')),
            ...(modelList||[]).map(m=>h('option',{key:`${m.provider}/${m.id}`,value:`${m.provider}/${m.id}`},`${m.name} · ${m.providerName}`))));
      }
      function renderRooms(){
        const picks=form?.picks||[];
        const toggle=rec=>setForm(f=>({...f,picks:picks.length>=4?picks:[...picks,{id:rec.id,title:rec.title,project:rec.project,route:null}]}));
        return h('div',{className:'fw-page'},
          h('div',{className:'fw-eyebrow'},'Rooms'),h('h2',{className:'fw-h2'},t('wb_roomsTitle')),h('p',{className:'fw-sub'},t('wb_roomsSub')),
          form?h('div',{className:'fw-card',style:{padding:16,marginBottom:18,display:'grid',gap:12}},
            h('div',{style:{display:'grid',gap:6}},h('b',{style:{fontSize:12.5}},t('wb_roomTopic')),
              h('div',{className:'fw-ask',style:{maxWidth:'none',margin:0}},h('textarea',{rows:2,value:form.topic||'',placeholder:t('wb_roomTopicPh'),'aria-label':t('wb_roomTopic'),onChange:e=>setForm(f=>({...f,topic:e.target.value}))}))),
            h('div',{style:{display:'grid',gap:6}},h('b',{style:{fontSize:12.5}},`${t('wb_participants')} (${picks.length}/4)`),
              ...picks.map((p,i)=>h('div',{key:i,className:'fw-row-wrap',style:{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}},
                h('span',{className:'fw-pill blue'},String.fromCharCode(65+i)),h('span',{style:{flex:1,minWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontSize:12.5}},p.title||p.id),
                modelPicker(p.route,route=>setForm(f=>({...f,picks:f.picks.map((x,j)=>j===i?{...x,route}:x)}))),
                h('button',{className:'fw-text-btn',type:'button','aria-label':t('wb_delete'),onClick:()=>setForm(f=>({...f,picks:f.picks.filter((_,j)=>j!==i)}))},h(WIcon,{name:'trash'}))))),
            h('div',{style:{display:'grid',gap:4}},h('small',{style:{color:'var(--muted)'}},`${t('wb_pickSessions')} · ${t('wb_pickHint')}`),
              h('div',{className:'fw-card',style:{maxHeight:260,overflow:'auto'}},pickList===null?h('div',{className:'fw-empty'},t('wb_loading')):pickList.length?pickList.map(rec=>
                h('button',{key:rec.id,className:'fw-row',type:'button',disabled:picks.length>=4,onClick:()=>toggle(rec)},
                  h('span',{className:`fw-dot${rec.running?' on':''}`}),h('span',{className:'grow'},rec.title||t('untitled')),
                  rec.project?h('span',{className:'fw-pill gray'},rec.project):null,h('time',null,relTime(rec.lastAt)),h('span',null,'+'))):h('div',{className:'fw-empty'},t('wb_noRecords')))),
            h('div',{className:'fw-actions'},
              h('button',{className:'fw-btn primary',type:'button',disabled:roomBusy||!picks.length,onClick:createRoom},roomBusy?h('span',{className:'fw-spin'}):h(WIcon,{name:'check'}),roomBusy?t('wb_creating'):t('wb_createRoom')),
              h('button',{className:'fw-btn',type:'button',onClick:()=>{setForm(null);setPickList(null);}},t('wb_cancel'))),
            h('small',{style:{color:'var(--muted)'}},t('wb_readonlyNote'))):
          h('div',{style:{marginBottom:14}},h('button',{className:'fw-btn primary',type:'button',onClick:()=>setForm({topic:'',picks:[]})},h(WIcon,{name:'spark'}),t('wb_newRoom'))),
          h('div',{className:'fw-card'},rooms===null?h('div',{className:'fw-empty'},t('wb_loading')):rooms.length?rooms.map(r=>
            h('div',{key:r.id,className:'fw-row-wrap',style:{display:'flex',alignItems:'center'}},
              h('button',{className:'fw-row',type:'button',onClick:()=>openRoom(r.id)},
                r.pending?h('span',{className:'fw-spin'}):h('span',{className:'fw-pill blue'},String(r.participants.length)),
                h('span',{className:'grow'},r.title),
                h('time',null,`${fmt(t('wb_roomMsgs'),{n:r.messages})} · ${relTime(r.updatedAt)}`),h(WIcon,{name:'arrow'})))):h('div',{className:'fw-empty'},t('wb_noRooms'))));
      }
      function renderRoom(){
        const backBtn=h('button',{className:'fw-text-btn',type:'button',style:{marginBottom:10},onClick:()=>{setView('rooms');setRoom(null);}},h(WIcon,{name:'back'}),t('wb_back'));
        if(!room)return h('div',{className:'fw-page'},backBtn,roomErr?h('div',{className:'fw-notice red'},h(WIcon,{name:'warn'}),h('div',null,h('b',null,t('wb_failed')),h('p',null,roomErr))):h('div',{className:'fw-empty'},t('wb_loading')));
        const pending=room.pending;const P=room.participants;
        const fresh=(i)=>{const tr=room.freshness?.[i];if(!tr)return h('span',{style:{color:'var(--muted)'}},t('wb_sourceUnknown'));
          return tr.moved?h('span',{style:{color:'var(--amber)'}},fmt(t('wb_sourceMoved'),{calls:tr.toolCalls,turns:tr.turns})):h('span',{style:{color:'var(--green)'}},t('wb_sourceSame'));};
        const who=m=>m.role==='user'?t('wb_moderator'):`${P[m.speaker]?.label??'?'} · ${P[m.speaker]?.title||''}`;
        return h('div',{className:'fw-page'},backBtn,
          h('div',{className:'fw-result-head'},
            h('div',{style:{minWidth:0}},h('h2',{className:'fw-h2'},room.title),h('div',{className:'fw-sub',style:{margin:0}},`${t('wb_readonlyNote')} · ${relTime(room.createdAt)}`)),
            h('div',{className:'fw-actions'},h('button',{className:'fw-btn danger',type:'button','aria-label':t('wb_roomDelete'),title:t('wb_roomDelete'),onClick:async()=>{await roomAction('delete');setView('rooms');setRoom(null);}},h(WIcon,{name:'trash'})))),
          sh(t('wb_participants')),
          h('div',{className:'fw-card'},...P.map((p,i)=>h('div',{key:i,className:'fw-proj'},
            h('div',{className:'fw-proj-head'},h('span',{className:'fw-pill blue'},p.label),h('h4',null,p.title||p.session),p.project?h('span',{className:'fw-pill gray'},p.project):null,h('span',{className:'fw-pill gray'},p.routeLabel||t('wb_followSettings'))),
            h('div',{style:{fontSize:11.5,color:'var(--muted)',display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}},
              `${t('wb_snapshotAt')} ${relTime(p.snapshot?.takenAt)} · ${p.snapshot?.turns??0} ${t('wb_turns')} · ${p.snapshot?.calls??0} ${t('wb_calls')}`,fresh(i),
              h('button',{className:'fw-text-btn',type:'button',disabled:roomBusy||!!pending,onClick:()=>roomAction('resnap',{index:i})},t('wb_resnap')),
              h('button',{className:'fw-text-btn',type:'button',onClick:()=>openSession(p.session)},t('wb_openSession')))))),
          sh(t('wb_discussion'),t('wb_discussionHint')),
          room.messages.length?null:h('div',{className:'fw-notice'},h(WIcon,{name:'spark'}),h('div',null,h('p',null,t('wb_roomEmpty')))),
          ...room.messages.map((m,i)=>m.role==='note'?null:h('div',{key:`m${i}`,className:'fw-card fw-fu',style:m.role==='user'?{borderColor:'var(--blue)'}:null},
            h('div',{className:'fw-fu-q',style:{display:'flex',justifyContent:'space-between',gap:8}},h('span',null,who(m),m.model?h('small',{style:{color:'var(--muted)',marginLeft:6}},m.model):null),
              h('button',{className:'fw-text-btn',type:'button',disabled:!!pending,title:t('wb_removeMsg'),'aria-label':t('wb_removeMsg'),onClick:()=>roomAction('remove',{index:i})},'×')),
            h(Md,{text:m.text}))),
          pending?.kind==='turn'?h('div',{className:'fw-card fw-thinking'},h('div',{className:'fw-think'},h('span',{className:'fw-spin'}),fmt(t('wb_speaking'),{label:P[pending.speaker]?.label||'?'}),
            h('button',{className:'fw-btn',type:'button',style:{marginLeft:'auto'},onClick:()=>roomAction('cancel')},t('wb_cancel')))):null,
          room.error?h('div',{className:'fw-notice red'},h(WIcon,{name:'warn'}),h('div',null,h('b',null,`${P[room.error.speaker]?.label??''} · ${t('wb_failed')}`),h('p',null,`${room.error.reason||''} · ${room.error.detail||''}`))):null,
          h('div',{className:'fw-ask',style:{maxWidth:'none',marginTop:8}},
            h('textarea',{rows:2,value:sayText,placeholder:t('wb_sayPh'),'aria-label':t('wb_sayPh'),onChange:e=>setSayText(e.target.value)}),
            h('div',{className:'fw-ask-foot',style:{flexWrap:'wrap',gap:6,justifyContent:'flex-end'}},
              h('button',{className:'fw-btn',type:'button',disabled:roomBusy||!!pending||!sayText.trim(),onClick:()=>sendSay()},t('wb_sayOnly')),
              ...P.map((p,i)=>h('button',{key:i,className:'fw-btn',type:'button',disabled:roomBusy||!!pending,onClick:()=>sendSay([i])},fmt(t('wb_letSpeak'),{label:p.label}))),
              P.length>1?h('button',{className:'fw-btn primary',type:'button',disabled:roomBusy||!!pending,onClick:()=>sendSay(P.map((_,i)=>i))},h(WIcon,{name:'send'}),t('wb_roundAll')):null)),
          sh(t('wb_handoffTitle'),t('wb_handoffHint')),
          pending?.kind==='handoff'?h('div',{className:'fw-card fw-thinking'},h('div',{className:'fw-think'},h('span',{className:'fw-spin'}),t('wb_handoffBusy'))):
          room.handoff?h('div',{className:'fw-card fw-summary'},
            room.handoff.draft?h('div',{className:'fw-notice'},h(WIcon,{name:'warn'}),h('div',null,h('b',null,t('wb_draftNote')),room.handoff.error?h('p',null,`${room.handoff.error.reason} · ${room.handoff.error.detail||''}`):null)):null,
            h(Md,{text:room.handoff.text}),
            h('div',{className:'fw-actions',style:{marginTop:10}},
              h('button',{className:'fw-btn primary',type:'button',onClick:openHandoff},h(WIcon,{name:'arrow'}),t('wb_openNew')),
              h('button',{className:'fw-btn',type:'button',onClick:async()=>{try{await navigator.clipboard.writeText(room.handoff.text);say(t('wb_copied'));}catch(e){say(e.message);}}},h(WIcon,{name:'copy'}),t('wb_copy')),
              h('button',{className:'fw-btn',type:'button',disabled:roomBusy,onClick:()=>roomAction('handoff',{locale:'zh'})},h(WIcon,{name:'refresh'}),t('wb_regen'))),
            room.handoff.openedAt?h('small',{style:{color:'var(--muted)'}},`${t('wb_opened')} · ${relTime(room.handoff.openedAt)}`):null):
          h('div',null,h('button',{className:'fw-btn',type:'button',disabled:roomBusy||!!pending,onClick:()=>roomAction('handoff',{locale:'zh'})},h(WIcon,{name:'doc'}),t('wb_handoffBrief'))));
      }

      // ---------------------------------------------------------- digests
      // The page language, used for template text and for the report itself.
      const pageLocale=()=>/^en/i.test(navigator.language||'')?'en':'zh';
      async function loadTemplates(){
        try{const b=await getJson(`${WB.templates}?locale=${pageLocale()}`);if(b.ok&&Array.isArray(b.templates)){tplCachePut(b.templates);setTemplates(b.templates);}}
        catch{setTemplates(x=>x??[]);}
      }
      async function runTemplate(tpl){
        setTplErr('');
        try{
          const body={templateId:tpl.id,offset:tzOffset(),locale:pageLocale()};
          if(range&&tpl.range!==range)body.range=range,body.rangeLocked=true;
          const b=await getJson(WB.digest,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
          if(!b.ok){say(b.reason==='busy'?t('wb_busy'):`${t('wb_failedReq')} · ${b.detail||b.reason||''}`);return;}
          setDigest(b.digest);setDigestId(b.digest.id);setFu('');setFuError('');setView('result');
        }catch(e){say(`${t('wb_failedReq')} · ${e.message}`);}
      }
      async function saveTemplate(){
        const form=tplForm;if(!form)return;
        setTplBusy(true);setTplErr('');
        try{
          const body={action:form.id?'update':'create',id:form.id,name:form.name,instruction:form.instruction,range:form.range||''};
          const b=await getJson(WB.templates,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
          if(!b.ok)throw new Error(b.detail||b.reason||'failed');
          setTplForm(null);await loadTemplates();
        }catch(e){setTplErr(e.message);}finally{setTplBusy(false);}
      }
      async function deleteTemplate(id){
        try{await getJson(WB.templates,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'delete',id})});}catch{/* already gone */}
        await loadTemplates();
      }
      // One row per template: what it asks for, and one button to run it. The
      // shipped ones cannot be edited; the person's own can.
      const tplRow=tpl=>h('div',{key:tpl.id,className:'fw-tpl'},
        h('div',{className:'fw-tpl-main'},
          h('div',{className:'fw-tpl-name'},tpl.name,tpl.builtin?h('span',{className:'fw-pill gray'},t('wb_tplBuiltin')):null),
          h('p',{className:'fw-tpl-text'},tpl.needsSession?t('wb_tplNeedsSession'):tpl.instruction)), 
        h('div',{className:'fw-tpl-actions'},
          tpl.needsSession
            ?h('button',{className:'fw-btn',type:'button',onClick:()=>setView('records')},t('wb_tplGoRecords'))
            :h('button',{className:'fw-btn',type:'button',onClick:()=>runTemplate(tpl)},h(WIcon,{name:'spark'}),t('wb_generate')),
          tpl.builtin?null:h('button',{className:'fw-text-btn',type:'button',onClick:()=>{setTplErr('');setTplForm({...tpl});}},t('wb_tplEdit')), 
          tpl.builtin?null:h('button',{className:'fw-text-btn',type:'button','aria-label':t('wb_delete'),title:t('wb_delete'),onClick:()=>deleteTemplate(tpl.id)},h(WIcon,{name:'trash'}))));
      function renderTplForm(){
        const form=tplForm;
        return h('div',{className:'fw-tpl-form'},
          h('div',{className:'fw-tpl-form-row'},
            h('input',{type:'text',value:form.name,maxLength:40,placeholder:t('wb_tplNamePh'),'aria-label':t('wb_tplName'),onChange:e=>setTplForm(f=>({...f,name:e.target.value}))}),
            h('label',{className:'fw-select'},h(WIcon,{name:'clock'}),t('wb_scope'),
              h('select',{value:form.range||'',onChange:e=>setTplForm(f=>({...f,range:e.target.value}))},
                h('option',{value:''},t('wb_rangeAuto')),...WB_RANGES.map(k=>h('option',{key:k,value:k},t(`r_${k}`)))))),
          h('textarea',{rows:3,value:form.instruction,maxLength:2000,placeholder:t('wb_tplInstructionPh'),'aria-label':t('wb_tplInstruction'),onChange:e=>setTplForm(f=>({...f,instruction:e.target.value}))}),
          tplErr?h('div',{className:'fw-ask-error',role:'alert'},tplErr):null,
          h('div',{className:'fw-tpl-form-foot'},
            h('button',{className:'fw-text-btn',type:'button',onClick:()=>setTplForm(null)},t('wb_tplCancel')),
            h('button',{className:'fw-btn primary',type:'button',disabled:tplBusy||!form.name.trim()||!form.instruction.trim(),onClick:saveTemplate},t('wb_tplSave'))));
      }
      function renderDigests(){
        const list=templates||[];
        return h('div',{className:'fw-page'},
          h('div',{className:'fw-eyebrow'},'Digests'),h('h2',{className:'fw-h2'},t('wb_digTitle')),h('p',{className:'fw-sub'},t('wb_digSub')),
          // Pick what to ask for, not how to word it: the shipped templates cover
          // the usual reports, and any number of your own can be added.
          sh(t('wb_templates'),
            h('div',{className:'fw-tpl-tools'},
              h('label',{className:'fw-select'},h(WIcon,{name:'clock'}),t('wb_scope'),
                h('select',{value:range,onChange:e=>setRange(e.target.value)},h('option',{value:''},t('wb_rangeAuto')),...WB_RANGES.map(k=>h('option',{key:k,value:k},t(`r_${k}`))))),
              h('button',{className:'fw-text-btn',type:'button',onClick:()=>{setTplErr('');setTplForm({id:null,name:'',instruction:'',range:''});}},h(WIcon,{name:'plus'}),t('wb_newTemplate')))),
          tplForm?renderTplForm():null,
          h('div',{className:'fw-card'},
            templates===null?h('div',{className:'fw-empty'},t('wb_loading'))
              :list.length?[...list.map(tplRow)]:h('div',{className:'fw-empty'},t('wb_tplEmpty'))),
          sh(t('wb_history')),
          h('div',{className:'fw-card'},digests===null?h('div',{className:'fw-empty'},t('wb_loading')):digests.length?digests.map(d=>digestRow(d,true)):h('div',{className:'fw-empty'},t('wb_noDigests'))));
      }

      // Which model the whole plugin is using, as the nav chip shows it.
      const modelLabelOf=next=>{
        if(!next)return null;
        if(next.source==='external')return next.externalModel?`${t('sourceExternal')} · ${next.externalModel}`:t('sourceExternal');
        return next.model?`${next.model}${next.provider?` · ${next.provider}`:''}`:(settingsSummary?.model||t('modelFollowDefault'));
      };
      const currentModelName=savedModel||liveSummary?.label||t('modelFollowDefault');
      const currentModelWarn=!!(liveSummary?.problem||(liveSummary?.source==='external'&&!liveSummary?.hasApiKey));
      // Codex: off, connected with N chats, or a problem worth seeing.
      const nav=(v,icon,label,badge)=>h('button',{key:v,type:'button',className:`fw-nav-item${view===v||(v==='digests'&&view==='result')||(v==='rooms'&&view==='room')?' active':''}`,'aria-current':view===v?'page':undefined,title:label,onClick:()=>setView(v)},h(WIcon,{name:icon}),h('span',{className:'lbl'},label),badge?h('span',{className:'fw-badge'},String(badge)):null);
      let body;
      if(view==='focus')body=h('div',{className:'fw-focus'},h(Panel,{t,subscribeLocale,openSettings,onModelSummary,onCodexStatus:setCodexStatus}));
      else if(view==='result')body=renderResult();
      else if(view==='records')body=renderRecords();
      else if(view==='digests')body=renderDigests();
      else if(view==='ask')body=renderAsk();
      else if(view==='rooms')body=renderRooms();
      else if(view==='room')body=renderRoom();
      else body=renderHome();
      return h('div',{className:'fw'},h('style',null,WB_CSS),
        h('nav',{className:'fw-nav','aria-label':'Focusing'},
          h('div',{className:'fw-brandbar'},
            h('div',{className:'fw-brand'},h(WIcon,{name:'focus'}),h('span',null,'Focusing')),
            // The one settings entry, in the top corner of the panel.
            h('button',{type:'button',className:'fw-gear',title:t('settingsOpen'),'aria-label':t('settingsOpen'),'aria-haspopup':'dialog',onClick:()=>openSettings('model')},h(WIcon,{name:'gear'}))),
          h('div',{className:'fw-tag'},t('wb_sub')),
          h('div',{className:'fw-nav-list'},
          nav('home','home',t('wb_home')),
          nav('ask','chat',t('wb_ask'),askRunning),
          h('div',{className:'fw-nav-label'},t('wb_grpData')),
          nav('records','layers',t('wb_records')),nav('digests','doc',t('wb_digests'),runningCount),nav('rooms','users',t('wb_rooms')),
          h('div',{className:'fw-nav-label'},t('wb_grpGuard')),
          nav('focus','pulse',t('wb_focus')),),
          navChats(),
          h('div',{className:'fw-nav-foot'},
            // Plain text, not controls: the model in force.
            h('div',{className:'fw-sum',title:currentModelName},currentModelName))),
        h('main',{className:`fw-main${view==='focus'||view==='ask'?' flush':''}`},
          body),
        h(SettingsDialog,{t,subscribeLocale,open:settingsOpen,initialTab:settingsTab,onClose:()=>setSettingsOpen(false),onSaved:next=>setSavedModel(modelLabelOf(next)),onCodexStatus:setCodexStatus}),
        toast?h('div',{className:'fw-toast',role:'status'},toast):null);
    }
    // ======================================================================
    // Global model settings: one centered dialog, shared by every module.
    //
    // It is mounted once at the workbench root, so every entry point (the
    // nav chip, a failed digest, the focus panel) opens the same dialog and
    // edits the same global settings. The API key never arrives here: only
    // whether one is stored.
    const DIALOG_CSS=`
/* Two deliberately separate palettes. The dialog never borrows the page's
   "brand" for text-on-fill: in DSH dark mode brand is near-white, so white
   text on it disappears. Every pair below is checked for contrast. */
.fws-scrim{
  --fws-scrim:#0f111547;--fws-card:var(--dsw-alias-bg-layer-1,#fff);--fws-field:var(--dsw-static-neutral-bluish-00,#fff);
  --fws-track:var(--dsw-static-neutral-bluish-100,#ebeef2);--fws-thumb:#fff;--fws-thumb-shadow:0 1px 3px #1a233a24;
  --fws-line:#0f11151a;--fws-line-strong:#0f111533;--fws-ink:#0f1115;--fws-muted:#61666b;--fws-hover:#2631480f;
  --fws-accent:#3462c9;--fws-accent-soft:#4176e614;--fws-primary:#0f1115;--fws-primary-ink:#fff;--fws-primary-hover:#43454a;
  --fws-ok:#15803d;--fws-ok-soft:#22c55e1f;--fws-bad:#c81e1e;--fws-bad-soft:#ef44441a;--fws-warn:#b45309;
  --fws-shadow:0 24px 60px #1a233a33,0 2px 8px #1a233a14;color-scheme:light;
  position:fixed;inset:0;z-index:60;background:var(--fws-scrim);display:flex;align-items:center;justify-content:center;padding:20px}
body[data-ds-dark-theme] .fws-scrim{
  --fws-scrim:#000000a6;--fws-card:#2c2c2e;--fws-field:#1b1b1c;
  --fws-track:#1b1b1c;--fws-thumb:#43454a;--fws-thumb-shadow:0 1px 2px #0009;
  --fws-line:#ffffff0f;--fws-line-strong:#ffffff1c;--fws-ink:#f5f6f7;--fws-muted:#adb2b8;--fws-hover:#ffffff12;
  --fws-accent:#5d8ef0;--fws-accent-soft:#5d8ef026;--fws-primary:#f5f6f7;--fws-primary-ink:#0f1115;--fws-primary-hover:#e1e5ee;
  --fws-ok:#4ed17e;--fws-ok-soft:#4ed17e24;--fws-bad:#ff7b7b;--fws-bad-soft:#f25a5a29;--fws-warn:#f7ad31;
  --fws-shadow:0 0 0 1px #ffffff14,0 28px 70px #000c;color-scheme:dark}
.fws-scrim[hidden]{display:none}
.fws{color-scheme:inherit;outline:none;width:min(500px,100%);max-height:min(680px,calc(100dvh - 40px));display:flex;flex-direction:column;background:var(--fws-card);color:var(--fws-ink);border:1px solid var(--fws-line);border-radius:16px;box-shadow:var(--fws-shadow);font-size:13px;line-height:1.65;font-family:inherit;text-align:left;overflow:hidden}
.fws *{box-sizing:border-box}.fws button,.fws input,.fws select,.fws textarea{font:inherit;color:inherit}.fws button{cursor:pointer}.fws button:disabled{opacity:.4;cursor:default}
/* Focus must not repaint a field: the caret is the only feedback. Buttons and
   summaries keep a ring so keyboard use stays visible. */
.fws input:focus,.fws select:focus,.fws textarea:focus,
.fws input:focus-visible,.fws select:focus-visible,.fws textarea:focus-visible,
.fws .fws-in:focus,.fws .fws-in:focus-visible{
  outline:none!important;box-shadow:none!important;
  border-color:var(--fws-line-strong)!important;background:var(--fws-field)!important;
  -webkit-text-fill-color:var(--fws-ink)!important}
.fws button:focus-visible,.fws summary:focus-visible{outline:2px solid var(--fws-accent);outline-offset:2px}
/* A pointer click must leave the field exactly as it was: the caret is the
   feedback. Only keyboard navigation marks focus, and then with a hairline
   that is neutral instead of the accent colour. */

.fws-head{display:flex;align-items:flex-start;gap:12px;padding:18px 20px 10px}
.fws-head h3{margin:0;font-size:15px;color:var(--fws-ink)}.fws-head p{margin:3px 0 0;font-size:12px;color:var(--fws-muted)}
.fws-x{margin-left:auto;border:0;background:none;color:var(--fws-muted);border-radius:8px;padding:4px;display:grid;place-items:center}.fws-x:hover{background:var(--fws-hover);color:var(--fws-ink)}
.fws-x svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round}
.fws-scope{display:flex;flex-wrap:wrap;gap:6px;padding:0 20px 2px}
.fws-scope span{font-size:11px;color:var(--fws-accent);background:var(--fws-accent-soft);border-radius:99px;padding:1px 9px}
.fws-tabs{display:flex;gap:2px;padding:12px 20px 0;border-bottom:1px solid var(--fws-line)}
.fws-tab{border:0;background:none;padding:7px 12px;font-size:12.5px;color:var(--fws-muted);border-bottom:2px solid transparent;margin-bottom:-1px}
.fws-tab:hover{color:var(--fws-ink)}
.fws-tab.on{color:var(--fws-ink);border-bottom-color:var(--fws-accent);font-weight:600}
.fws-body{padding:14px 20px 6px;overflow:auto;display:grid;gap:14px;overscroll-behavior:contain}
.fws-seg{display:grid;grid-template-columns:1fr 1fr;background:var(--fws-track);border:1px solid var(--fws-line);border-radius:10px;padding:3px}
.fws-seg button{border:0;background:none;border-radius:7px;padding:6px 8px;font-size:12.5px;color:var(--fws-muted)}
.fws-seg button:hover{color:var(--fws-ink)}
.fws-seg button.on{background:var(--fws-thumb);color:var(--fws-ink);font-weight:600;box-shadow:var(--fws-thumb-shadow)}
.fws-field{display:grid;gap:5px}.fws-field>span.fws-lab{font-size:12px;font-weight:600;color:var(--fws-ink)}
.fws-field small,.fws-hint{font-size:11.5px;color:var(--fws-muted);line-height:1.6;margin:0}
.fws-in{width:100%;border:1px solid var(--fws-line-strong);background:var(--fws-field);color:var(--fws-ink);border-radius:9px;padding:7px 10px;font-size:13px;min-width:0;-webkit-appearance:none;appearance:none;color-scheme:inherit;box-shadow:none}
.fws-in:-webkit-autofill{-webkit-box-shadow:0 0 0 1000px var(--fws-field) inset;-webkit-text-fill-color:var(--fws-ink)}
.fws-in::placeholder{color:var(--fws-muted);opacity:.8}
.fws-in:hover{border-color:color-mix(in srgb,var(--fws-ink) 30%,transparent)}
.fws-in:focus{outline:none;box-shadow:none}
.fws-in:disabled{opacity:.55}
.fws select.fws-in option{background:var(--fws-field);color:var(--fws-ink)}
.fws textarea.fws-in{font:12px/1.8 ui-monospace,SFMono-Regular,Menlo,monospace;min-height:132px;resize:vertical}
.fws input[type=checkbox]{accent-color:var(--fws-accent)}
.fws-row{display:flex;gap:8px;align-items:stretch}.fws-row .fws-in{flex:1;min-width:0}
.fws-btn{border:1px solid var(--fws-line-strong);background:transparent;color:var(--fws-ink);border-radius:9px;padding:6px 12px;font-size:12.5px;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
.fws-btn:hover:not(:disabled){background:var(--fws-hover)}
.fws-btn.primary{background:var(--fws-primary);border-color:var(--fws-primary);color:var(--fws-primary-ink);font-weight:600}
.fws-btn.primary:hover:not(:disabled){background:var(--fws-primary-hover);border-color:var(--fws-primary-hover)}
.fws-btn.link{border:0;background:none;color:var(--fws-accent);padding:0;font-size:12px}
.fws-test{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;border:1px dashed var(--fws-line-strong);border-radius:10px}
.fws-pill{font-size:11.5px;border-radius:99px;padding:1px 9px;background:var(--fws-hover);color:var(--fws-muted)}
.fws-pill.ok{background:var(--fws-ok-soft);color:var(--fws-ok)}
.fws-pill.bad{background:var(--fws-bad-soft);color:var(--fws-bad)}
.fws-test .m{flex-basis:100%;font-size:11.5px;color:var(--fws-muted);overflow-wrap:anywhere}
.fws-spin{width:13px;height:13px;border:2px solid var(--fws-line-strong);border-top-color:var(--fws-accent);border-radius:99px;animation:fwsSpin .8s linear infinite;flex-shrink:0}
@keyframes fwsSpin{to{transform:rotate(360deg)}}
.fws details{border-top:1px solid var(--fws-line);padding-top:10px}
.fws summary{font-size:12px;color:var(--fws-muted);cursor:pointer;list-style:none;display:flex;align-items:center;gap:6px}
.fws summary:hover{color:var(--fws-ink)}
.fws summary::-webkit-details-marker{display:none}
.fws summary::before{content:"\\25B8";font-size:10px;transition:transform .12s}.fws details[open] summary::before{transform:rotate(90deg)}
.fws pre{background:var(--fws-field);border:1px solid var(--fws-line);border-radius:8px;color:var(--fws-ink)}
.fws-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
.fws-lock{display:flex;gap:7px;align-items:flex-start;font-size:11.5px;color:var(--fws-muted)}
.fws-lock svg{width:13px;height:13px;flex-shrink:0;margin-top:2px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round}
.fws-foot{display:flex;align-items:center;gap:8px;padding:12px 20px 16px;border-top:1px solid var(--fws-line);margin-top:8px}
.fws-dirty{font-size:11.5px;color:var(--fws-warn);margin-right:auto}.fws-dirty.clean{color:var(--fws-muted)}
@container(max-width:560px){.fws{max-height:calc(100dvh - 16px)}.fws-scrim{padding:8px}.fws-grid2{grid-template-columns:1fr}}
`;
    const DIALOG_PATHS={settings:'/api/dsh-focusing.settings',models:'/api/dsh-focusing.models',externalModels:'/api/dsh-focusing.external-models',preview:'/api/dsh-focusing.preview'};

    function SettingsDialog({t,subscribeLocale,open,onClose,onSaved,initialTab,onCodexStatus}){
      const [,setLocaleTick]=React.useState(0);
      const [tab,setTab]=React.useState(initialTab||'model');
      const [saved,setSaved]=React.useState(null);       // redacted view from the Host
      const [form,setForm]=React.useState(null);         // the edit in progress
      const [note,setNote]=React.useState('');
      const [busy,setBusy]=React.useState('');
      const [test,setTest]=React.useState(null);
      const [models,setModels]=React.useState(null);
      const [providerInfo,setProviderInfo]=React.useState([]);
      const [extModels,setExtModels]=React.useState(null);
      const [preview,setPreview]=React.useState(null);
      const [previewError,setPreviewError]=React.useState('');
      // What the Host found for the Codex import (declared last: hook order).
      const [codexFound,setCodexFound]=React.useState(null);
      const scrim=React.useRef(null), card=React.useRef(null);
      React.useEffect(()=>subscribeLocale(()=>setLocaleTick(n=>n+1)),[subscribeLocale]);
      const cur=form||saved||{};
      const dirty=!!form&&!!saved&&JSON.stringify({...form,apiKey:undefined})!==JSON.stringify({...saved,apiKey:undefined});
      const patch=(key,value)=>setForm(f=>({...(f||saved||{}),[key]:value}));
      React.useEffect(()=>{
        if(!open||saved)return undefined;const c=new AbortController();
        (async()=>{
          try{
            const r=await fetch(DIALOG_PATHS.settings,{signal:c.signal,credentials:'same-origin'});
            const b=await r.json();
            if(!b.ok||!b.settings)throw new Error(t('settingsSaveFailed'));
            if(!c.signal.aborted){setSaved(b.settings);setForm(null);if(b.codexStatus){setCodexFound(b.codexStatus);onCodexStatus?.(b.codexStatus);}}
          }catch(e){if(!c.signal.aborted)setNote(`${t('settingsSaveFailed')} · ${e.message}`);}
        })();
        return()=>c.abort();
      },[open,saved,t]);
      // The catalogue is read once per mount: the model field is a list, not a text box.
      React.useEffect(()=>{
        if(!open||models)return undefined;const c=new AbortController();
        fetch(DIALOG_PATHS.models,{signal:c.signal,credentials:'same-origin'}).then(r=>r.json())
          .then(b=>{if(!c.signal.aborted){setModels(b.ok&&Array.isArray(b.models)?b.models:[]);setProviderInfo(Array.isArray(b.providers)?b.providers:[]);}})
          .catch(()=>{if(!c.signal.aborted)setModels([]);});
        return()=>c.abort();
      },[open,models]);
      React.useEffect(()=>{if(open&&initialTab)setTab(initialTab);},[open,initialTab]);
      const close=()=>{setForm(null);setNote('');setTest(null);setPreview(null);setPreviewError('');onClose?.();};
      React.useEffect(()=>{
        if(!open)return undefined;
        const onKey=e=>{
          if(e.key==='Escape'){e.stopPropagation();close();return;}
          if(e.key!=='Tab')return;
          const items=[...((card.current?.querySelectorAll('button,input,select,textarea,summary')||[]))].filter(n=>!n.disabled&&n.offsetParent!==null);
          if(!items.length)return;
          const first=items[0],last=items[items.length-1];
          if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
          else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
        };
        document.addEventListener('keydown',onKey,true);
        return()=>document.removeEventListener('keydown',onKey,true);
      },[open]);
      React.useEffect(()=>{if(open)setTimeout(()=>{try{card.current?.focus();}catch{}},0);},[open]);

      // Only what the person changed is sent. The dialog keeps its loaded copy
      // between openings, and other parts of the page save settings too (the
      // calendar's switch); sending the whole form would write stale values back.
      const changedKeys=(next,base)=>{
        if(!next)return {};
        const out={};
        for(const k of Object.keys(next)){
          if(k==='apiKey'||k==='hasApiKey'){if(k==='apiKey'&&next.apiKey)out.apiKey=next.apiKey;continue;}
          if(!base||JSON.stringify(next[k])!==JSON.stringify(base[k]))out[k]=next[k];
        }
        return out;
      };
      async function save(withTest){
        setBusy(withTest?'test':'save');setNote('');
        try{
          const r=await fetch(DIALOG_PATHS.settings,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({settings:changedKeys(form,saved),test:!!withTest})});
          const b=await r.json();
          if(!b.ok){setNote(t('settingsSaveFailed'));return false;}
          setSaved(b.settings);
          if(b.codexStatus){setCodexFound(b.codexStatus);onCodexStatus?.(b.codexStatus);}
          calCachePut(null);
          if(b.test){
            setTest(b.test);setForm(null);
            setNote(b.test.ok?`${t('settingsTestOk')}${b.test.model?` · ${b.test.model}`:''}`:`${t('settingsTestFailed')} · ${b.test.detail||b.test.reason||''}${b.reverted?` · ${t('settingsReverted')}`:''}`);
            if(!b.reverted)onSaved?.(b.settings);
            return !!b.test.ok;
          }
          setForm(null);setNote(t('settingsSaved'));onSaved?.(b.settings);
          return true;
        }catch(e){setNote(`${t('settingsSaveFailed')} · ${e.message}`);return false;}
        finally{setBusy('');}
      }
      async function fetchModels(){
        setBusy('models');setExtModels(null);
        try{
          const r=await fetch(DIALOG_PATHS.externalModels,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({endpoint:cur.endpoint||undefined,apiKey:cur.apiKey||undefined})});
          const b=await r.json();
          setExtModels(b.ok?{models:b.models||[]}:{error:b.detail||b.reason||`HTTP ${r.status}`});
        }catch(e){setExtModels({error:String(e?.message||e)});}
        finally{setBusy('');}
      }
      async function loadPreview(){
        setBusy('preview');setPreviewError('');
        try{
          const r=await fetch(DIALOG_PATHS.preview,{credentials:'same-origin'});
          const b=await r.json();
          if(!b.ok){setPreviewError(t('previewFailed'));return;}
          setPreview(b);
        }catch(e){setPreviewError(e.message);}
        finally{setBusy('');}
      }

      const field=(label,control,hint)=>h('label',{className:'fws-field'},h('span',{className:'fws-lab'},label),control,hint?h('small',null,hint):null);
      const num=(key,min,max,scale)=>h('input',{className:'fws-in',type:'number',min,max,value:scale?Math.round((cur[key]||0)/scale):(cur[key]??''),onChange:e=>patch(key,e.target.value===''?undefined:(scale?Number(e.target.value)*scale:Number(e.target.value)))});
      const toggle=(key,label,defaultOn=true)=>h('label',{style:{display:'flex',alignItems:'center',gap:7,fontSize:12,cursor:'pointer'}},h('input',{type:'checkbox',checked:defaultOn?cur[key]!==false:cur[key]===true,style:{accentColor:'var(--fws-accent)'},onChange:e=>patch(key,e.target.checked)}),h('span',null,label));
      const useExternal=cur.source==='external';

      // A model is chosen from the list DSH reports; typing one is only a
      // fallback for an endpoint that cannot list its models.
      const modelSelect=()=>{
        if(models===null)return h('div',{className:'fws-in',style:{color:'var(--fws-muted)'}},t('modelsLoading'));
        if(!models.length)return h('div',null,
          h('select',{className:'fws-in',disabled:true}),
          h('small',{className:'fws-hint',style:{display:'block',marginTop:4}},t('noCatalogHint')),
          // Say WHICH provider is silent and why: an unauthenticated provider
          // returns an empty list, not an error, so silence must be explained.
          providerInfo.length?h('ul',{className:'fws-hint',style:{margin:'6px 0 0',paddingLeft:18}},
            ...providerInfo.map(p=>h('li',{key:p.provider},p.reason
              ?`${p.name} · ${p.reason}${p.detail?` · ${p.detail}`:''}`
              :`${p.name} · ${t('providerNoModels')}`))):null);
        const value=`${cur.provider||''}/${cur.model||''}`;
        return h('select',{className:'fws-in',value,onChange:e=>{
          const [provider,model]=e.target.value.split('/');
          setForm(f=>({...(f||saved||{}),provider:provider||'',model:model||''}));
        }},
          h('option',{value:'/'},t('modelFollowDefault')),
          ...models.map(m=>h('option',{key:`${m.provider}/${m.id}`,value:`${m.provider}/${m.id}`},`${m.name} · ${m.providerName}`)));
      };
      const externalModel=()=>{
        const list=extModels?.models||[];
        const value=cur.externalModel??'';
        return h('div',{style:{display:'grid',gap:6}},
          h('div',{className:'fws-row'},
            h('input',{className:'fws-in',type:'text',list:'fws-ext-list',value,placeholder:'gpt-4o-mini','aria-label':t('externalModel'),onChange:e=>patch('externalModel',e.target.value)}),
            h('button',{className:'fws-btn',type:'button',disabled:busy==='models',onClick:fetchModels},busy==='models'?h('span',{className:'fws-spin'}):null,busy==='models'?t('fetchingModels'):t('fetchModels'))),
          h('datalist',{id:'fws-ext-list'},...list.map(id=>h('option',{key:id,value:id}))),
          extModels?.error?h('small',{className:'fws-hint',style:{color:'var(--fws-bad)'},role:'alert'},`${t('fetchModelsFailed')} · ${extModels.error}`):
          list.length?h('small',{className:'fws-hint'},t('fetchedModels').replace('{n}',String(list.length))):h('small',{className:'fws-hint'},t('externalModelHint')));
      };

      const modelTab=()=>h(React.Fragment,null,
        h('div',{className:'fws-seg',role:'group','aria-label':t('analysisSource')},
          h('button',{type:'button',className:useExternal?'':'on','aria-pressed':String(!useExternal),onClick:()=>patch('source','dsh')},t('sourceHost')),
          h('button',{type:'button',className:useExternal?'on':'','aria-pressed':String(useExternal),onClick:()=>patch('source','external')},t('sourceExternal'))),
        useExternal?h(React.Fragment,null,
          field(t('endpoint'),h('input',{className:'fws-in',type:'text',value:cur.endpoint||'',placeholder:'https://api.example.com/v1/chat/completions',onChange:e=>patch('endpoint',e.target.value)}),t('endpointHint')),
          field(t('apiKey'),h('input',{className:'fws-in',type:'password',value:cur.apiKey??'',placeholder:cur.hasApiKey?t('apiKeyStored'):'',onChange:e=>patch('apiKey',e.target.value)}),t('apiKeyHint')),
          field(t('externalModel'),externalModel())):
        field(t('model'),modelSelect(),t('modelHint')),
        h('div',{className:'fws-test'},
          h('button',{className:'fws-btn',type:'button',disabled:!!busy,onClick:()=>save(true)},busy==='test'?t('testing'):t('testConnection')),
          test?h('span',{className:`fws-pill ${test.ok?'ok':'bad'}`,role:'status'},test.ok?t('settingsTestOk'):t('settingsTestFailed')):h('span',{className:'fws-pill'},t('notTested')),
          test?h('span',{className:'m'},test.ok?`${test.model||''} · ${t('testSentNothing')}`:`${test.reason||''} · ${test.detail||''}`):null),
        h('details',null,
          h('summary',null,t('advanced')),
          h('div',{className:'fws-grid2'},
            field(t('maxTokens'),num('maxTokens',64,8192)),
            field(t('timeoutSeconds'),num('timeoutMs',5,300,1000)),
            field(t('temperature'),h('input',{className:'fws-in',type:'number',min:0,max:2,value:cur.temperature??'',placeholder:t('notSent'),onChange:e=>patch('temperature',e.target.value===''?undefined:Number(e.target.value))})),
            h('div',{className:'fws-field'},h('span',{className:'fws-lab'},t('previewPayload')),
              h('button',{className:'fws-btn',type:'button',disabled:!!busy,onClick:loadPreview,title:t('previewPayload')},busy==='preview'?t('testing'):t('loadPreview'),h('small',{className:'fws-hint',style:{marginLeft:4}},t('previewBtnHint')))))),
        previewError?h('small',{className:'fws-hint',style:{color:'var(--fws-bad)'},role:'alert'},previewError):null,
        preview?h('details',{open:true},h('summary',null,`${t('previewTitle')} · ${preview.model}`),h('b',null,t('previewSystem')),h('pre',{style:{whiteSpace:'pre-wrap',fontSize:11.5,margin:'4px 0 0'}},preview.system),h('b',null,t('previewUser')),h('pre',{style:{whiteSpace:'pre-wrap',fontSize:11.5,margin:'4px 0 0'}},preview.user)):null);

      const focusTab=()=>h(React.Fragment,null,
        h('div',{className:'fws-field'},h('span',{className:'fws-lab'},t('persona')),
          h('textarea',{className:'fws-in',rows:8,value:cur.persona||'',onChange:e=>patch('persona',e.target.value)}),
          h('div',{className:'fws-row',style:{marginTop:4,alignItems:'center'}},
            h('button',{className:'fws-btn',type:'button',onClick:()=>patch('persona',undefined)},t('resetPersona')),
            h('small',{className:'fws-hint',style:{marginLeft:8}},t('personaHint')))),
        h('div',{className:'fws-field'},h('span',{className:'fws-lab'},t('analysisScope')),
          h('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}},
            toggle('includeGoal',t('includeGoal')),toggle('includeProject',t('includeProject')),
            toggle('includeToolArgs',t('includeToolArgs')),toggle('includeToolOutput',t('includeToolOutput'))),
          h('div',{className:'fws-grid2'},
            field(t('maxActivities'),num('maxActivities',1,200)),
            field(t('excerptChars'),num('excerptChars',0,4000)))));

      // Where chats come from: DSH's own (with or without archived ones) and,
      // optionally, Codex's local records. The status line says what the Host
      // actually found, so a wrong path is visible before anything is analysed.
      const codexState=()=>{
        if(!cur.codexEnabled)return h('span',{className:'fws-pill'},t('codexOff'));
        const f=codexFound;
        if(!f||!f.enabled)return h('span',{className:'fws-pill'},t('codexSaveToCheck'));
        if(f.ok)return h(React.Fragment,null,h('span',{className:'fws-pill ok'},t('codexOn').replace('{n}',String(f.sessions??0))),h('span',{className:'m'},`${f.path}${f.via==='env'?' · CODEX_HOME':''}`));
        const why=f.reason==='no-path'?t('codexNoPath'):f.reason==='missing'?t('codexMissing'):f.reason==='not-codex'?t('codexNotCodex'):f.reason==='not-found'?t('codexNotFound'):t('codexUnreadable');
        return h(React.Fragment,null,h('span',{className:'fws-pill bad'},t('codexProblem')),h('span',{className:'m'},`${why}${f.path?` · ${f.path}`:''}${f.tried?` · ${f.tried.join(', ')}`:''}`));
      };
      const sourcesTab=()=>h(React.Fragment,null,
        h('div',{className:'fws-field'},h('span',{className:'fws-lab'},t('sourceDsh')),
          h('div',null,toggle('loadArchived',t('loadArchived'),false)),
          h('small',{className:'fws-hint'},t('loadArchivedHint'))),
        h('div',{className:'fws-field'},h('span',{className:'fws-lab'},t('sourceCodex')),
          h('div',null,toggle('codexEnabled',t('codexEnable'),false)),
          h('small',{className:'fws-hint'},t('codexEnableHint')),
          cur.codexEnabled?h(React.Fragment,null,
            h('div',{className:'fws-seg',role:'group','aria-label':t('codexWhere'),style:{marginTop:8}},
              h('button',{type:'button',className:cur.codexPathMode==='manual'?'':'on','aria-pressed':String(cur.codexPathMode!=='manual'),onClick:()=>patch('codexPathMode','auto')},t('codexAuto')),
              h('button',{type:'button',className:cur.codexPathMode==='manual'?'on':'','aria-pressed':String(cur.codexPathMode==='manual'),onClick:()=>patch('codexPathMode','manual')},t('codexManual'))),
            cur.codexPathMode==='manual'?
              h('input',{className:'fws-in',type:'text',value:cur.codexPath||'',placeholder:'~/.codex','aria-label':t('codexPath'),onChange:e=>patch('codexPath',e.target.value),style:{marginTop:6}}):
              h('small',{className:'fws-hint'},t('codexAutoHint'))):null,
          h('div',{className:'fws-test',style:{marginTop:6}},codexState())));

      return h('div',{className:'fws-scrim',ref:scrim,hidden:!open,onMouseDown:e=>{if(e.target===scrim.current)close();}},
        h('style',null,DIALOG_CSS),
        h('div',{className:'fws',ref:card,role:'dialog','aria-modal':'true','aria-label':t('settingsTitle')},
          h('div',{className:'fws-head'},
            h('div',null,h('h3',null,t('settingsTitle')),h('p',null,t('settingsSub'))),
            h('button',{className:'fws-x',type:'button',onClick:close,'aria-label':t('close')},h('svg',{viewBox:'0 0 24 24'},h('path',{d:'M6 6l12 12M18 6 6 18'})))),
          h('div',{className:'fws-scope'},...['settingsScope1','settingsScope2','settingsScope3','settingsScope4'].map(k=>h('span',{key:k},t(k)))),
          h('div',{className:'fws-tabs',role:'tablist'},
            h('button',{className:`fws-tab${tab==='model'?' on':''}`,type:'button',role:'tab','aria-selected':String(tab==='model'),onClick:()=>setTab('model')},t('settingsTabModel')),
            h('button',{className:`fws-tab${tab==='focus'?' on':''}`,type:'button',role:'tab','aria-selected':String(tab==='focus'),onClick:()=>setTab('focus')},t('settingsTabFocus')),
            h('button',{className:`fws-tab${tab==='sources'?' on':''}`,type:'button',role:'tab','aria-selected':String(tab==='sources'),onClick:()=>setTab('sources')},t('settingsTabSources'))),
          h('div',{className:'fws-body'},
            !saved?h('div',{className:'fws-hint'},note||t('loading')):tab==='model'?modelTab():tab==='sources'?sourcesTab():focusTab(),
            note&&saved?h('p',{className:'fws-hint',role:'status'},note):null,
            h('div',{className:'fws-lock'},h('svg',{viewBox:'0 0 24 24'},h('path',{d:'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3'})),h('span',null,t('settingsKeyNote')))),
          h('div',{className:'fws-foot'},
            h('span',{className:`fws-dirty${dirty?'':' clean'}`},dirty?t('settingsDirty'):t('settingsClean')),
            h('button',{className:'fws-btn',type:'button',onClick:close},t('cancel')),
            h('button',{className:'fws-btn primary',type:'button',disabled:!dirty||busy==='save',onClick:()=>save(false)},busy==='save'?t('saving'):t('saveSettings')))));
    }
    Workbench.SettingsDialog=SettingsDialog;
    Workbench.ActivityCalendar=ActivityCalendar;
    Workbench.codexLineText=codexLineText;
        Workbench.codexLineTitle=codexLineTitle;
    Workbench.FocusPanel=Panel;
    Workbench.askStore=askStore;
    // Tests seed the template list the way the Host would; the page then renders
    // without waiting for a round trip.
    Workbench.tplSeed=list=>{tplCachePut(list);};
    return {
      inject:['slots','locale'],
      apply(ctx){
        const t=ctx.locale.bind(NS);
        ctx.effect(()=>[ctx.locale.register(NS,'en',TEXT.en),ctx.locale.register(NS,'zh',TEXT.zh)]);
        const subscribeLocale=fn=>ctx.locale.subscribe(fn);
        const inject=()=>({t,subscribeLocale});
        ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'focusing',order:58,locale:NS,label:()=>t('panel')},()=>h(FocusingIcon)));
        // A plugin-owned positioned parent bounds the scroll region; no absolute
        // positioning escapes into the shell and no second navigation rail.
        ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'focusing',locale:NS,inject,children:{'focusing.panel.body':{kind:'single',scope:'root'}}},props=>h('div',{className:'fz-host',style:{position:'relative',display:'flex',flex:1,minHeight:0,minWidth:0,height:'100%',overflow:'hidden'}},props.renderSlot('focusing.panel.body'))));
        const openSession=id=>{try{ctx.get('uiWorkspace')?.openSession(id);}catch(error){console.warn('focusing: cannot open session',error);}};
        // Put text into a NEW session's composer as an unsent draft. Never sends.
        const startDraft=(workspaceId,prompt)=>{
          const ui=ctx.get('uiWorkspace');if(!ui?.startSession)return false;
          try{ui.startSession(workspaceId,{prompt,whenDraftExists:'replace'});return true;}catch(error){console.warn('focusing: cannot start session',error);return false;}
        };
        const injectWb=()=>({t,subscribeLocale,openSession,startDraft});
        ctx.slots.inject('focusing.panel.body',()=>ctx.slots.register({name:'focusing.panel.body',locale:NS,inject:injectWb},Workbench));
      },
    };
  },
});
