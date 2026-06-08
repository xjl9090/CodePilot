# Issue Tracker — 统一问题跟踪

> 创建时间：2026-04-13
> 最后更新：2026-06-06（新增 B-024 Codex Runtime Stop 后恢复发送：#578 前端 force-abort 已修，但 `/api/chat/interrupt` 漏掉 `codex_runtime` fan-out，待 Claude Code 按 [codex-stop-recovery.md](codex-stop-recovery.md) 修）
> 合并自：`open-issues-2026-03-12.md` + `v0.48-post-release-issues.md` + GitHub Issues 最新盘点

**AI 须知：**
- 发现新 bug 或用户报告时更新此文件，不要新建分散的跟踪文档
- 修复后标注状态、修复版本、关键 commit
- 定期检查 Sentry 和 GitHub Issues 是否有新增项
- 状态说明：🔴 未修复 | 🟡 部分修复 | 🟢 已修复 | ⚪ 需验证 | 🔵 设计如此

---

## 一、活跃 Bug（按优先级排序）

### P0 — 阻断核心功能

#### B-001 Provider 认证路径仍有边缘失败
- **Issues:** [#456](https://github.com/op7418/CodePilot/issues/456), [#461](https://github.com/op7418/CodePilot/issues/461), [#474](https://github.com/op7418/CodePilot/issues/474), [#478](https://github.com/op7418/CodePilot/issues/478), [#476](https://github.com/op7418/CodePilot/issues/476), [#457](https://github.com/op7418/CodePilot/issues/457), [#470](https://github.com/op7418/CodePilot/issues/470)
- **状态:** 🟢 主要路径已修（待 v0.50.2 发布验证），#474 独立子问题待跟进
- **现象:** Provider 诊断 1-5 全 PASS，第 6 项"实际连通测试"报 `PROCESS_CRASH` 或 `No API credentials found`
- **已修复的部分（v0.48.1-v0.48.2）：**
  - `resolveProvider()` 改为尊重 `default_provider_id`，不再依赖 `is_active`
  - `hasAnyCredentials()` 检查全部 Provider
  - auto 模式增加凭据检查（无 Anthropic 凭据 → native runtime）
  - SDK 认证死循环 3 轮迭代修复（env → DB provider → env_only）
- **本轮修复（2026-04-15，待发版）：cc-switch / 外部托管 settings.json 识别**
  - 新增 `src/lib/claude-settings.ts`：读 `~/.claude/settings.json` 的 `env` 块
  - `runtime/registry.ts hasCredentialsForRequest()` 增加 settings.json 作为凭据来源
  - `provider-resolver.ts buildResolution()` env 模式把 settings.json 计入 `hasCredentials`
  - 移除 `provider-resolver.ts:318` 的 `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1` 死代码（SDK 0.2.62 不识别该变量，属于早期设计遗留）
  - 改进 `ai-provider.ts` 错误消息：当 settings.json 有凭据但 native runtime 失败时，明确引导用户切 SDK runtime
  - 新增 `claude-settings-credentials.test.ts`（10 个单测）+ 重写 `provider-preset.test.ts` 的 MANAGED_BY_HOST 测试
  - 详细分析见 `cc-switch-credential-bridge.md`
- **#474 独立子问题（未修）：**
  - 用户诊断 JSON 显示 `hasCredentials: true`、base URL `http://model.mify.ai.srv/anthropic` 是内部 DNS
  - runtime logs 仍有 "No provider credentials available" — 说明 agent-loop 调 `createModel({})` 时 providerId 透传丢失
  - Live probe 超时 15s（上游不可达）是另一层问题
  - 跟踪：检查 agent-loop → createModel 的 providerId 传递链路
- **Sentry 关联（14d）：** `No provider credentials available` Top 2 = **1,462 events**；预期本轮修复后 72h 内大幅下降
- **下一步:** v0.50.2 发版后跟踪 Sentry 指纹变化；发版说明里加 cc-switch 用户的"自动识别"升级亮点
- **B-001 Follow-up（已修复）：按 provider group 决定凭据归属 + per-request shadow `~/.claude/`**
  - 第三轮 review 后实施，2026-04-15
  - 规则：env group 完全尊重 Claude Code 来源（settings.json/cc-switch）；DB provider 显式选中时，auth/baseURL/model 仅以 DB provider 为准
  - 实现：`src/lib/claude-home-shadow.ts` 在 DB provider 请求里建临时 HOME，`.claude/settings.json` 剥 `ANTHROPIC_*` env keys（保留 mcpServers/hooks/enabledPlugins/permissions/apiKeyHelper），其余 `~/.claude/` 通过 symlink/junction 镜像
  - `runtime/registry.ts hasCredentialsForRequest()` 同步收紧：DB provider 不再用 settings.json 兜底（避免静默 rescue 配错 key 的 provider）
  - 用户级 MCP / plugins / hooks / CLAUDE.md 仍然完整可用
  - 12 个 shadow 单测 + 3 个 group-ownership 端到端测试覆盖：env+settings、DB+settings 共存、DB 配错 key 不救活、shadow 保留所有非认证字段及子目录、cleanup 真实生效
- **B-001 Follow-up TODO（非阻塞）：DB provider 凭据归属端到端 smoke**
  - 当前覆盖：所有 loader/helper 的输入边界都有单测（settingSources、shadow HOME、`prepareSdkSubprocessEnv`、`loadProjectMcpServers`、`mcpServerOverrides` 等）
  - 未覆盖：真实 claude CLI subprocess + SDK 内部 `qZq()` + 实际 API 请求路由的端到端验证。如果上游 SDK 行为变（例如 settings 加载顺序变化），unit test 不一定能感知
  - 建议方案：搭一个 mock 端点 + 真实 CLI 的 smoke fixture，断言 DB provider 请求实际打到 DB provider 的 base_url / api_key（不是 cc-switch 的）。当前 `package.json` 的 `test:smoke` 是 Playwright UI，不适用此场景，需要单独 harness
  - 优先级：低。属于"上游 SDK 升级回归"防护，不是当前修复正确性的必要条件
  - 触发条件：升级 `@anthropic-ai/claude-agent-sdk` 时主动跑一次

#### B-002 Sentry: AI_NoOutputGeneratedError 持续增长
- **状态:** 🟡 部分修复（v0.48.1 修了 eventCount→hasContent 误报）
- **Sentry 数据:** 107x → 170x（2026-04-11）
- **已修复:** 空响应误报（agent-loop.ts eventCount→hasContent）
- **残留原因：**
  - sdkProxyOnly provider 被 native runtime 错误调用
  - 第三方代理模型 ID 不识别
  - 请求格式不匹配
- **下一步:** 在 Sentry 上报中加 provider/model 信息定位具体来源

---

### P1 — 功能受损

#### B-003 OpenAI OAuth 登录 403
- **Issues:** [#464](https://github.com/op7418/CodePilot/issues/464)
- **状态:** 🟢 已修（待 v0.50.2 发版验证）
- **现象:** `Token exchange failed: Token exchange failed: 403 - [object Object]`，macOS + Windows 均复现；项目维护者两台机器都不复现
- **本轮修复（2026-04-15）：网络鲁棒性 + 错误序列化**
  - `src/lib/openai-oauth.ts`: `exchangeCodeForTokens` 改为最多 3 次重试，对 403/408/429/5xx 和网络级错误（ECONNRESET / ETIMEDOUT / ENOTFOUND / ECONNREFUSED）做指数退避（1s/2s/4s）
  - 不重试 400/401/404/422 等真正的 auth/config 错误（避免无谓重试）
  - 错误消息改用 `JSON.stringify(j)` 替代 toString，根治 `[object Object]` 序列化 bug
  - 对照参考项目 OpenCode（`资料/opencode-dev/codex.ts:580`）的 polling 容错语义：`if (status !== 403 && status !== 404) return failed`，OpenCode 也把 403 当可重试处理
  - 新增 `openai-oauth-retry.test.ts`（14 个单测）覆盖 retry 分类逻辑
- **根因结论：**
  - 用户在不稳定网络（VPN / 跨境）+ OpenAI auth code 边缘节点 propagation 延迟时，单次请求容易撞 403
  - 维护者两台机器网络稳定，单次请求总是命中已 propagate 的节点 → 不复现
  - 与 client ID / redirect URI / 账号类型无关（之前的猜测排除）

#### B-004 打包版 localStorage 随机端口导致设置丢失
- **Issues:** [#465](https://github.com/op7418/CodePilot/issues/465), [#466](https://github.com/op7418/CodePilot/issues/466) 评论, [#477](https://github.com/op7418/CodePilot/issues/477)（默认模型不生效）
- **状态:** 🟢 根因修复（待 v0.50.2 发版验证）
- **现象：**
  - 模型选择器总是恢复为"自动（列表中第一个）"/ "Default (recommended)"
  - 每次重启显示"设置助理"提醒（promoDismissed 不持久）
  - 主题设置重启失效
  - 输入框默认模型徽标"原来有现在没了"（实质是 localStorage 清空导致 last-provider-id 丢失，即使 DB 有 global default 也匹配不到）
- **根因（已确认）：** `electron/main.ts:515` 的 `getPort()` 用 `server.listen(0, ...)` —— OS 分配随机端口；Electron 渲染进程的 origin 是 `http://127.0.0.1:<random>`；浏览器 localStorage 按 origin 存储 → 每次重启端口不同 → localStorage 整体失效
- **本轮修复（2026-04-15，待发版）：从根因层修，而非逐个迁移 localStorage**
  - `electron/main.ts:510-571` 重写 `getPort()`：先尝试稳定端口范围 `47823-47830`（IANA 未分配，常用程度低）；只在 8 个候选端口全部被占时才 fallback 到 OS-assigned
  - 新增 `isPortFree(port)` helper：用 `server.listen(port, ...)` 探测端口可用性
  - 单端口稳定后，**所有现有 localStorage 持久化代码自动生效**——不需要逐个迁移到 DB
  - 详细分析见 `electron-port-stability.md`
- **影响范围：** 一次性解决以下副作用问题
  - 主题（theme_mode + theme_family）重启保留
  - 默认模型 / 默认 provider 选择重启保留
  - 工作目录记忆（`codepilot:last-working-directory`）
  - 各类 announcement / banner dismiss 状态（已迁移 DB 的不受影响，未迁移的也不再丢）
- **不解决的边缘情况：**
  - 用户同时跑 8+ 个 CodePilot 实例 → 第 9 个会 fallback 到随机端口（极不常见）
  - 系统上其他程序占用 `47823-47830` 全部 8 个端口（极不常见）
  - 这两种情况下都会 console.warn 提示用户 settings 可能不持久

#### B-005 Generative UI 第三方 API 渲染失效
- **Issues:** [#471](https://github.com/op7418/CodePilot/issues/471)
- **状态:** ⚪ 暂无代码 bug 可修，建议用户升 v0.50.x 复测
- **现象：**
  1. show-widget / Generative UI 在第三方 API 上只显示原始 JSON 文本块
  2. OpenRouter 官方预设 + 正确 API Key → Provider 诊断仍无法通过
- **2026-04-15 重新核查（无修复行动）：**
  - Native runtime（处理第三方 API 的路径）实际上**已经**注册了 widget 工具：`src/lib/builtin-tools/widget-guidelines.ts` 提供 `codepilot_load_widget_guidelines` tool，`condition: 'always'`
  - chat/route.ts → `assembleContext({entryPoint: 'desktop'})` → `WIDGET_SYSTEM_PROMPT`（详细版）注入 `finalSystemPrompt`
  - native-runtime → `buildSystemPrompt({userPrompt: finalSystemPrompt})` → 包装在 `# User Instructions` 段
  - agent-loop → `assembleTools()` → 再加 builtin widget 短 prompt + 工具
  - **结论：第三方 API 路径同时拥有 widget 详细系统提示 + tool**，能力上对等
- **未修原因：**
  - 用户 #471 报告时间 2026-04-12，正是 v0.49.0 发布日；可能是 v0.49.0 早期 bug 被 v0.50.x 修了
  - 维护者两台机器 v0.50.1 复测 Generative UI 都正常，反向佐证不是当前代码 bug
  - 第三方某些较弱模型（如部分 GLM/Kimi 变体）确实可能对 `show-widget` 格式遵循度低，但这是**模型能力问题**而非 CodePilot 代码 bug
- **下一步:** 在 issue #471 回复请用户升 v0.50.1+ 重测；如果仍现，索取具体 provider/model 配置

#### B-006 会话切换模型重置
- **Issues:** [#462](https://github.com/op7418/CodePilot/issues/462)
- **状态:** 🟡 可能和 B-004 相关
- **现象:** 第三方 API 用户每次切换会话，模型回到 Claude 默认模型，即使在设置中已设为默认
- **可能原因:** session 的 model 字段没正确持久化，或读取时 fallback 到已被清空的 localStorage
- **下一步:** 和 B-004 一起排查，确认 model 字段的读写链路

#### B-007 Turbopack 环境 CLI 启动失败
- **Issues:** [#470](https://github.com/op7418/CodePilot/issues/470)
- **状态:** ⚪ 有 workaround，非代码 bug
- **现象:** v0.48.2 用户报 `Claude Code CLI not found`，但终端 CLI 正常可用，能读到历史对话和 Skills
- **根因:** Next.js 16 Turbopack 处理 symlink/junction 的 bug（用户评论中找到）
- **Workaround:** 改用 `next dev --webpack` 代替 Turbopack
- **下一步:** 在 FAQ / 文档中说明；考虑默认关闭 Turbopack 或检测并提示

#### B-008 Sentry: Controller is already closed
- **状态:** 🔴 未修复（v0.48.0 前已存在）
- **Sentry 数据:** 28x → 30x
- **根因:** ReadableStream controller 在流结束后仍有写入（keep_alive timer 或 onStepFinish callback 延迟触发）
- **下一步:** 在 controller.enqueue 外加 try-catch 或检查 controller 状态

#### B-009 Sentry: Model not found: sonnet 短别名解析失败
- **状态:** 🔴 未修复
- **Sentry 数据:** 8x → 145x（大增，部分是用户配错模型名如 `gemma:e4b`）
- **根因:** native runtime 的 `createModel()` 短别名映射在某些路径被绕过；第三方代理不接受短别名
- **下一步:** 确保所有路径经过 `isShortAlias()` 映射；对用户输入的无效模型名给出明确错误提示

---

### P2 — 体验问题

#### B-010 Windows 发消息弹终端窗口
- **Issue:** [#244](https://github.com/op7418/CodePilot/issues/244)
- **状态:** 🔴 未修复
- **根因:** `child_process.spawn()` 缺少 `windowsHide: true`
- **修复方向:** `claude-client.ts` spawn 调用加 `windowsHide: true`

#### B-011 中文输入法回车误发送消息
- **Issue:** [#225](https://github.com/op7418/CodePilot/issues/225)
- **状态:** 🔴 未修复
- **根因:** `compositionend` 同步重置 `isComposing`，后续 `keydown(Enter)` 看到 false 触发提交
- **修复方向:** `handleCompositionEnd` 用 `setTimeout(0)` 延迟重置

#### B-012 多 Bridge 适配器同时启用互相干扰
- **Issue:** [#455](https://github.com/op7418/CodePilot/issues/455)
- **状态:** ⚪ 需重新诊断（2026-04-14 代码核实：隔离层面看不出问题）
- **代码核实:**
  - `FeishuChannelPlugin` 状态都是 instance 字段（`channels/feishu/index.ts:42-49`），无 globalThis 共享
  - `state.adapters` 是 per-type Map（`bridge-manager.ts:203`）
  - 每个 adapter 有独立 abort controller（`bridge-manager.ts:452`）
  - 错误追踪也是 per-adapter（`adapterMeta`）
- **下一步:** 需向用户收集具体复现步骤和日志——可能是飞书/QQ 单独的问题，或者是 `bridgeModeActive` 这类全局 flag 的交互

#### B-017 Feishu WSClient 长连接稳定性
- **Issues:** [#323](https://github.com/op7418/CodePilot/issues/323), [#288](https://github.com/op7418/CodePilot/issues/288), [#199](https://github.com/op7418/CodePilot/issues/199), [#149](https://github.com/op7418/CodePilot/issues/149), [#148](https://github.com/op7418/CodePilot/issues/148)
- **状态:** ⚪ 需重新诊断
- **现象:** Feishu WebSocket 长连接失败、断连、测试连接失败
- **已知错误码:** `code 1000040345 system busy`（飞书服务端）
- **下一步:** 收集 WSClient 错误日志和复现环境；考虑在 `gateway.ts` 的 `start()` 外层加重连+健康检查
- **关联:** `@larksuiteoapi/node-sdk` v1.59.0 的 WSClient 不提供 clean stop（`gateway.ts:180-186` 注释）

#### B-013 连接测试误报失败
- **状态:** 🟡 部分修复（v0.48.2 修了 masked key 回填）
- **残留:** 测试和实际聊天走的 provider resolution 路径不同

#### B-014 Claude Code 批量导入需逐个手点
- **Issue:** [#465](https://github.com/op7418/CodePilot/issues/465) 附带反馈
- **状态:** 🔴 未修复
- **描述:** 导入 Claude Code 会话需要一个个手动选择，无批量选择

#### B-019 SDK runtime + 慢 provider 首包静默撞 330s Stream idle timeout
- **Issue:** [#499](https://github.com/op7418/CodePilot/issues/499)
- **状态:** 🔴 未修复（长期存在的架构盲点，v0.50.3 runtime auto 简化后暴露面扩大）
- **现象:** Aliyun Bailian + `qwen3.6-plus`（及其他慢首包 provider）发消息后 330 秒固定报 `Stream idle timeout — no response for 330s`
- **代码位置:**
  - `src/lib/stream-session-manager.ts:88` 硬编码 `STREAM_IDLE_TIMEOUT_MS = 330_000`
  - `src/lib/stream-session-manager.ts:242-248` 每 10s `setInterval` 检查 `Date.now() - lastEventTime >= 330s` → abort
  - `markActive()` 覆盖 22+ 个 SSE 事件类型，包括 `onKeepAlive`（line 466-468）——**任何**事件都刷新 lastEventTime
- **根因（架构层）:** **SDK runtime 路径缺 keepalive 兜底**
  - Native runtime `src/lib/agent-loop.ts:76,119-121` 每 **15s** 主动发 `keep_alive` SSE，天然防止 330s 超时
  - SDK runtime `src/lib/claude-client.ts:1451-1452` **只透传** Claude Code SDK 自己发的 `keep_alive`——SDK 与上游中间静默时，我们不补心跳，客户端就真的会 330s 后 abort
  - v0.50.3 的 runtime auto 改成 binary check，**装了 CLI 的用户默认走 SDK runtime**——扩大了暴露面。Bailian Coding Plan 后端有排队机制，首包可能静默几分钟，正好撞上
- **为什么 v0.50.3 才集中爆出:** `STREAM_IDLE_TIMEOUT_MS = 330_000` 常量早就存在，不是本版引入的；但 qwen3.6-plus 是 v0.50.3 新加模型（commit `2d06f50`）+ 百炼首包排队慢 + SDK runtime 成为装了 CLI 用户的默认 = 三者叠加
- **修复方向（二选一或都做）:**
  1. **快修**：把 `STREAM_IDLE_TIMEOUT_MS` 提到 600s 或做成 provider 级可配置（UI 或 `options_json` 字段）
  2. **根治**：在 SDK runtime 的 SSE pipe 侧也加 15s keepalive 定时器，对齐 Native runtime 的兜底节奏
- **推荐:** 先做根治（#2），成本不大、一劳永逸；#1 作为 provider-level override 留给有异常慢后端的场景（少数）
- **下一步:** 下个 hotfix 窗口处理

#### B-020 MiMo 模型配置疑似被回退
- **状态:** 🟢 已修复（worktree `ea860da`，Phase 4 / #577；待 preview 真机复测）
- **本轮修复（2026-06-03，`ea860da`）:** MiMo 可设型号不再被 preset / discovery 回退到默认；成功回答后不再追加 provider error（同 #577）。已确认真实 upstream model id 后才改默认，未臆造。
- **现象:** MiMo 的模型配置不知何时从用户预期的 `2.5 Pro` 被改成了 `V2.5` 和 `V2`；用户认为这是“偷偷改掉”的回归。
- **影响:** Provider 默认模型 / role model 可能不再指向用户实际购买或可用的 MiMo 模型，导致新用户开箱不可用或老用户发送到错误模型。
- **需核查:**
  - `provider-catalog.ts` 中 MiMo preset 的 `model_names` / `roleModels` / default model。
  - Provider 编辑/连接弹窗是否把真实型号保存到 `role_models_json`。
  - 旧 DB 行是否被 preset sync / align / discovery 覆盖。
- **下一步:** preview 真机复测 MiMo 型号选择持久；保留为 provider catalog 回归观察项。

#### B-021 服务商编辑页右上角关闭按钮失效
- **状态:** 🟡 部分修复 / ⚪ 待 Windows 真机验证（worktree `2646f23`，Phase 5）
- **本轮修复（2026-06-03，`2646f23`）:** Windows fullscreen 编辑弹窗的应用内 close 按钮让出系统窗口控制区，消除与系统 X 贴脸 / 重叠（对应 preview blocker「双 X 过近」）；"点击无效"若源于系统按钮覆盖应用按钮则一并缓解。**Windows-only，源码 / 回归 guard 已加，待 Windows packaged 真机 smoke 终验点击可关闭。**
- **现象:** 编辑服务商页面 / 弹窗中，右上角的“×”点击后无法关闭页面。
- **影响:** 用户进入 Provider 编辑后无法正常退出，属于设置页 P1 体验阻断。
- **关联历史:** 近期修过 Windows fullscreen 弹窗关闭按钮与系统窗口控制区重叠问题，但本反馈是“点击无效”，需要重新核查事件处理与 Dialog close wiring。
- **需核查:**
  - ProviderForm / DialogContent fullscreen 分支的 `onOpenChange` / close button 是否被阻断。
  - Windows WCO safe-area 调整后是否造成按钮视觉可见但事件落到错误层级。
  - macOS / Windows 是否表现一致。
- **下一步:** Windows packaged smoke 终验点击可关闭；macOS 侧已确认无回归。

#### B-022 消息队列疑似回归
- **状态:** ⚪ 需验证（同源的 #578「中断后发送无响应」已由 worktree `fcce794` 修复；本条「streaming 期间排队」症状待专项 smoke）
- **本轮进展（2026-06-03，`fcce794`，Phase 2 / #578）:** 中断任务后输入框发送无响应已修（无条件调度 force-abort，清掉卡住的运行锁 / abort controller）。与 B-022 同源——发送入口被未清理的运行锁卡住；但「streaming 期间能否继续排队」未单独验证。
- **现象:** 以前消息发送后，用户可以继续发送下一条，后续消息会进入队列；现在有用户反馈不行。
- **影响:** 长任务期间无法连续追加指令，影响核心聊天工作流。
- **需核查:**
  - `ChatView` 的 `messageQueue` / `isStreaming` 逻辑是否仍允许 streaming 期间排队。
  - `MessageInput` disabled 条件是否因为 runtime/provider gate、provider loading、session incompatible 等状态过宽，导致 streaming 期间输入/发送入口被完全禁掉。
  - `stop` / `force-abort` 修复后是否改变了队列调度顺序。
- **下一步:** 增加 smoke：发送第一条并保持 streaming，再发送第二条，断言第二条进入队列且第一条完成后自动发送。

#### B-023 MCP 设置页可见但运行时不可调用
- **Issue:** [#569](https://github.com/op7418/CodePilot/issues/569)
- **状态:** 🔴 未修复（2026-06-02 用户反馈；2026-06-04 从主分支 tracker 草稿迁入 worktree active 看板，避免合并丢失——GitHub issue 仍是永久记录）
- **现象:** MCP 列表能自动读取 Claude Code 配置，但运行状态里看不到，模型也无法调用；用户补充：必须把 MCP 再配置到项目路径才会识别。
- **影响:** MCP 可见性与可调用性不一致——用户以为已启用但模型实际调不到；属"设置页看得到、运行时不可调用"的假承诺（触及 CLAUDE.md 语义验收）。
- **需核查:** 全局/用户级 Claude Code MCP 配置与 CodePilot runtime 注入 / 运行状态 UI 的来源是否一致；为什么只有配置到项目路径才识别。
- **下一步:** 合并后排查 runtime MCP 注入来源 vs 运行状态 UI 来源；若不修则降级文案，别让设置页假承诺"已启用"。

#### B-024 Codex Runtime 终止后无法拉起新任务
- **计划:** [codex-stop-recovery.md](codex-stop-recovery.md)
- **状态:** 🔴 未修复（2026-06-06 用户反馈；Codex 已调研，待 Claude Code 修）
- **现象:** Codex Runtime 正在执行任务时点击 Stop / 终止后，同一会话后续无法发送新指令，像是进程或 session 挂死；用户需要新建会话、重启或等待未知时间才能继续。
- **本地核实:** 三因素根因：#578 的 `stream-session-manager.ts` force-abort 兜底只保证前端 stream 离开 active；`src/app/api/chat/interrupt/route.ts` 只调用 native 和 SDK conversation interrupt，未调用 `getRuntime('codex_runtime')?.interrupt(sessionId)`；`chat/route.ts` 已把 abortController 传到 Codex Runtime，但 `src/lib/codex/runtime.ts` 当前不读 `options.abortController?.signal`。而 Codex Runtime 已有 `turn/interrupt` 实现，说明中断能力存在但两条入口都没接上。
- **影响:** Stop 后后台 Codex turn 可能继续运行，`chat/route.ts` 的后台 `collectStreamResponse` 不结束，session lock 的 60s renew interval 不会 clear，会持续续租 600s lock，下一条同会话 send 可能被无限期 `SESSION_BUSY` 或 runtime running 状态阻塞。
- **需核查:**
  - `/api/chat/interrupt` 是否对 `native` / `codex_runtime` / SDK conversation 都做 best-effort fan-out。
  - 用户很快点 Stop 时，`turn/start` 尚未返回 turnId，`activeCodexTurns` 还没 set，Codex Runtime interrupt 是否会 no-op 并丢失中断。
  - Stop 后 `collectStreamResponse`、session lock、runtime status 是否在 terminal/interrupted 路径完成收口；即使上游没有 terminal event，也要有精确 lockId 的 bounded cleanup。
- **下一步:** Claude Code 按计划 P1-P3 修复并补 guardrail：route fan-out、Codex abort signal/race、精确 lockId watchdog；P5/P6 只在 P1-P3 smoke 后仍有状态分裂/no-output 时展开。

#### B-025 主日志 12G 暴涨与 Codex Runtime 闪退
- **计划:** [log-bloat-codex-runtime-crash.md](log-bloat-codex-runtime-crash.md)
- **状态:** 🔴 日志暴涨已确认；闪退高相关待 live 复现（2026-06-08 用户提供 12G `codepilot-main` 日志）
- **现象:** 用户另一台电脑 `codepilot-main` 日志达到约 12.5G；Codex Runtime 下客户端偶发闪退，最近一次疑似发生在突破沙盒权限、需要网络授权/搜索文件时。
- **本地核实:** 用户日志尾部 50MB 中约 70,000 行里 69,253 行是 Codex app-server `codex_core::tasks` enter/exit tracing；`electron/main.ts` 明确没有 size-based rotation；`src/lib/codex/app-server-manager.ts` 默认 `RUST_LOG=info`；Electron 主进程把 server stdout/stderr 写入持久日志，并且 `serverErrors.push(msg)` 无界累积。
- **影响:** 日志暴涨会吃磁盘；无界 `serverErrors` 会把同一批 tracing 噪声留在主进程内存里，是 Codex Runtime 闪退/卡死的高置信候选根因。当前日志没有 `panic` / OOM / uncaught 栈，仍需 live smoke 和 crash breadcrumb 定案。
- **下一步:** Claude Code 优先修 P0 logging 上限：主日志 size rotation、`serverErrors` ring buffer、Codex tracing 默认降级/过滤；随后补 `render-process-gone` / `child-process-gone` / uncaught breadcrumb，并跑真实 Codex `require_escalated` / network approval smoke。

---

#### B-018 macOS 启动 / 新对话时弹 "找不到用于储存 'apple' 的钥匙串" 对话框
- **Issue:** [#501](https://github.com/op7418/CodePilot/issues/501)
- **状态:** 🟡 非代码缺陷 + 有规避方案未落地（2026-04-16 诊断）
- **现象:** v0.50.3 上部分 macOS 用户启动或点"新对话"时，系统弹 `Cannot find keychain to store 'apple'` 对话框；仅"取消/还原为默认"两选项，点取消后反复弹（3-5 次），不影响最终功能但体验阻塞
- **维护者环境不复现**（两台机器均未触发）；报告者（vivi2886）使用第三方 API Key，CodePilot DB 无 OAuth token 记录也仍触发
- **根因诊断:**
  - 我们自己的代码**零处**调用 keychain / safeStorage / keytar（grep `'apple'` / `safeStorage` / `keytar` 于 `src/` 和 `electron/` 均无命中；仅 `claude-client.ts:1723` 的注释和 `main.ts:744` 的 CSS font-family 含 "apple"）
  - "apple" 这个 service name 是 **Electron 底层 Chromium 在 macOS 访问 login keychain 的默认行为**（Chromium 用 keychain 加密 cookie / password manager 数据）
  - 用户本机 login keychain 状态异常时（常见：系统重装后未迁移、第三方清理软件动过、登录密码重置过 keychain 未同步解锁）Chromium 初始化尝试访问 keychain 就会弹这个系统对话框
- **规避方案（未实施）:** `electron/main.ts` 顶部加 `app.commandLine.appendSwitch('password-store', 'basic')`，让 Chromium 不碰系统 keychain，改用 profile 本地加密。副作用：Chromium 存的 cookie 不再经 keychain 加密——对我们这种本地 Electron 应用没敏感 cookie（所有凭据都在我们自己的 sqlite），影响可接受
- **下一步:** 下个小版本（0.50.4 或独立 hotfix）加 `password-store=basic` 开关；issue 里可先回复用户说明"环境相关非代码 bug + 系统 Keychain Access 修复步骤 + 下版会加规避开关"
- **Sentry 可见度:** 这个对话框是 macOS 系统级弹窗，不走 Electron renderer 的 JS 异常通道，Sentry 不会采到——所以只能靠 GitHub Issue 观测规模

---

### P3 — 低优先级

#### B-015 Bridge 斜杠命令不识别
- **Issues:** [#231](https://github.com/op7418/CodePilot/issues/231), [#229](https://github.com/op7418/CodePilot/issues/229)
- **状态:** 🔴 未修复
- **根因:** Bridge 走 SDK `query()`，斜杠命令不被 CLI 处理

#### B-016 Windows 卸载卡住
- **Issue:** [#454](https://github.com/op7418/CodePilot/issues/454)
- **状态:** 🔴 未修复（NSIS 已知问题，非代码 bug）

---

## 二、已修复（归档）

| ID | 问题 | 修复版本 | 关键 commit/文件 |
|----|------|----------|-----------------|
| ~~B-F01~~ | #456 主路径认证死循环 | v0.48.1-v0.48.2 | sdk-runtime.ts 3 轮迭代 |
| ~~B-F02~~ | AI_NoOutputGeneratedError 误报 | v0.48.1 | agent-loop.ts eventCount→hasContent |
| ~~B-F03~~ | 看板 Widget 样式丢失 | v0.48.1 | widget-sanitizer.ts overflow:hidden |
| ~~B-F04~~ | SqliteError FOREIGN KEY | v0.48.1 | db.ts 事务清理 outbound_refs |
| ~~B-F05~~ | Codex API 超时 | v0.48.1 | ai-provider.ts 30s 超时+代理提示 |
| ~~B-F06~~ | #449 Provider test masked key | v0.48.2 | 回填真实 key |
| ~~B-F07~~ | #447 default_provider_id 不生效 | v0.48.2 | resolveProvider 改造 |
| ~~B-F08~~ | #341 CLI 检测失败 | v0.38.4 | findClaudeBinary() |
| ~~B-F09~~ | #343/#346 切换 Provider 崩溃 | v0.38.4 | PATCH 自动清 stale sdk_session_id |
| ~~B-F10~~ | #347 默认模型回退 | v0.38.4 | global default model |
| ~~B-F11~~ | FeatureAnnouncement 重启后重现 | v0.49.0 | DB + localStorage 双写 |
| ~~B-F12~~ | OpenAI OAuth 基础流程 | v0.48.2 | commit 38fe566 |
| ~~B-F13~~ | 长对话中模型"幻觉调用工具"（假 tool_use，文件未动用户却被告知已改）| v0.50.2 | `context-pruner.ts` RECENT_TURNS 6→16 + `[Pruned <toolName> result: <摘录>]` marker |

### B-F13 症状识别（便于未来快速判断类似现象）

**用户可见症状:**
- 长时间任务进行到后段，AI 回复里出现 "I used Bash / Edit / Write..." 等工具调用描述
- 界面把这些文本渲染成了工具卡片样式，但实际**文件没变 / git 没提交 / 命令未执行**
- 用户被迫反复提醒"你都没调用 git"、"文件没改"等；AI 回复一轮通常会"恢复"（真的去执行），但下次长任务又复现

**根因链:**
1. v0.49.0 Hermes 升级把 `context-pruner.ts` 的 `RECENT_TURNS_TO_KEEP` 从 **16 降到 6**
2. 旧 `tool_result` 被替换为裸 `[truncated]` 占位（没有工具名、没有摘录）
3. 长对话中一个工具密集轮次（多个 `tool_use` block）的 `tool_result` 很快被挤出 recent 窗口
4. 模型看到"我曾经调用过什么但看不到结果"的残缺上下文，**开始生成文本形式的"假"工具调用描述**（不是真正的 `tool_use` block）
5. 前端 Markdown/SSE 渲染层会把 `(used Bash: {...})` 这种格式**当成**工具调用卡片展示（尤其是从别的 Agent 回放来的历史），但实际上 `agent-loop` 并未向 Vercel AI SDK 发出 `tool_use` request

**漏洞窗口:** v0.49.0 ~ v0.50.1（含），v0.50.2 恢复 16 轮 + 工具名+200 字摘录的 Pruned marker 后**不再复发**

**未来类似现象的判断清单:**
- 是否 v0.49.0 ~ v0.50.1 区间的用户？→ 引导升级到 0.50.2+
- 仍在 v0.50.2+ 发生？→ 可能是**超长任务导致 recent 16 轮也覆盖不住**，需要考虑把 `tool_use`/`tool_result` 的保留优先级提到最高（永不 prune 配对的 block），或给 UI 加"context 已压缩"告警让用户主动续接
- 相关代码位置: `src/lib/context-pruner.ts:28,52-77`

---

## 三、Feature Requests（按活跃度排序）

| Issue | 描述 | 状态 | 备注 |
|-------|------|------|------|
| [#469](https://github.com/op7418/CodePilot/issues/469) | 一键导入 + 浏览 Claude Code 对话历史 | 🟡 部分满足 | v0.49.0 `codepilot_session_search` 解决了搜索，可视化浏览未做 |
| [#473](https://github.com/op7418/CodePilot/issues/473) | 语音交互 STT/TTS | 📋 待评估 | |
| [#460](https://github.com/op7418/CodePilot/issues/460) | 定时任务 | 📋 待评估 | |
| [#459](https://github.com/op7418/CodePilot/issues/459) | 左侧 UI 采用 Codex 文案风格 | 📋 待评估 | |
| [#458](https://github.com/op7418/CodePilot/issues/458) | 多 OpenAI OAuth 账号 | 📋 待评估 | |
| [#463](https://github.com/op7418/CodePilot/issues/463) | 代码界面可编辑 + 语法高亮 | 🔵 设计如此 | Claude Code 理念：AI 写 100% 代码 |
| [#246](https://github.com/op7418/CodePilot/issues/246) | 应用内自动更新 | 📋 待实现 | 已有 electron-updater 依赖 |
| FR-auto-permission | 自动权限系统：Claude Code / Codex 已支持自动权限；后续 CodePilot 也应支持根据请求内容自动分析并完成审批 | 📋 待设计 | 用户要求记录：自动权限会自动分析内容并完成审批；需定义安全边界、可审计日志、可关闭开关 |
| FR-edit-user-message | 对话编辑：用户停止对话后，可点击自己发出的消息，在“复制”旁增加笔形编辑按钮；编辑后直接再次发送 | 📋 待设计 | 目标是避免复制、粘贴到输入框再发送；需考虑消息重放、后续 assistant 消息处理、队列/停止状态 |
| [#254](https://github.com/op7418/CodePilot/issues/254) | 会话列表待确认状态指示 | 📋 待实现 | |
| [#236](https://github.com/op7418/CodePilot/issues/236) | @ 自动补全文件路径 | 📋 待实现 | |
| [#242](https://github.com/op7418/CodePilot/issues/242) | 多 bot 桥接 | 📋 待实现 | 高复杂度 |
| [#234](https://github.com/op7418/CodePilot/issues/234) | Codex / 多 CLI 后端支持 | 📋 长期规划 | |

---

## 四、Sentry 监控摘要（截至 2026-04-11）

| 错误 | 数量 | 趋势 | 关联 Bug | 状态 |
|------|------|------|----------|------|
| Claude Code process exited with code 1 | 6640x | 既有 | — | 既有问题，量最大 |
| AI_NoOutputGeneratedError | 170x | ↑ | B-002 | 🟡 部分修复 |
| HTTP 404 model not found | 145x | ↑↑ | B-009 | 🔴 |
| No provider credentials | 54x | ↑ | B-001 | 🟡 |
| SqliteError FOREIGN KEY | 40x | 🆕 | — | 🟢 已修复 |
| Controller already closed | 30x | → | B-008 | 🔴 |
| AI_RetryError: chatgpt.com timeout | 15x | 🆕 | — | 🟢 已修复 |
| fetch failed | 11x | 🆕 | — | 网络层 |
| ClaudeCodeCompat 503/500/400 | 9x | ↑ | — | 第三方代理 |
| AI_MissingToolResultsError | 5x | → | — | 🔴 |
| HMAC apikey not found | 4x | → | — | 特定 Provider |

---

## 五、流程管理备注

- [#466](https://github.com/op7418/CodePilot/issues/466) 用户建议增加内测版流程，在内部群测试通过后再发布正式版
- 多位用户反馈"来回升级回退太麻烦"，说明发版质量需提升
- 建议：每次发版前至少用 Provider 诊断工具跑一轮第三方 API 场景的端到端测试
