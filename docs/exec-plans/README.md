# Exec Plans / 执行计划

中大型功能的执行计划，包含分阶段目标、进度状态和决策日志。

> **日常入口：[active/refactor-closeout.md](active/refactor-closeout.md)**——这是总控板（当前 Phase 状态 / 下一步 / 未闭环风险 / 验收入口 / 最近决策 / Phase 6-7 方案）。后续 ClaudeCode / Codex 只从这一个计划领取任务，不再从下方"被接管 / 暂缓"清单里的旧 active 计划自行开支线。
>
> **查历史细节：`completed/refactor-phase-*.md` + `completed/phase-4-markdown-artifact.md` + `completed/phase-5*.md`**——总控板里的"历史归档"列直接 link 过去。Phase 1（模型同步与渠道扩展）/ Phase 2（Runtime 与会话执行）/ Phase 3（后台常驻、定时任务、通知）/ Phase 4（Markdown 数据层 + Artifact 表现层）/ Phase 5（Codex Runtime + Harness 架构）已完成的计划文本与全部决策日志按 Phase 归档，不要去 active 总控板里翻。

**AI 须知：**
- 新建执行计划放在 `active/`；按下面「目录语义」流转到 `completed/` / `deferred/` / `superseded/`
- 纯调研/可行性分析仍放 `docs/research/`
- 修改或新增文件后更新下方索引
- 检索本目录前先读此文件

## 目录语义（四类目录）

`docs/exec-plans/` 下的执行计划分四类，**AI 只从 `active/` 领任务**：

| 目录 | 含义 | 当前任务入口 |
|------|------|--------------|
| `active/` | 真正在推进的当前计划 | ✅ 是 |
| `completed/` | 已完成，留作历史执行日志与决策证据 | ❌ 否 |
| [`deferred/`](deferred/README.md) | 用户明确暂缓、未来可能重启 | ❌ 否 |
| [`superseded/`](superseded/README.md) | 被新计划接管、仅作历史参考 | ❌ 否 |

`deferred` / `superseded` 里的文件顶部都有 `Archive note`，说明移出原因和重启方式；恢复工作由用户主动发起、再 `git mv` 回 `active/`。

## 什么时候需要执行计划

- 涉及数据库 schema 变更
- 跨 3 个以上模块的功能
- 需要分阶段交付的中大型功能
- 重构或迁移类任务

## Signal → Triage → Fix → Verify → Guardrail

中大型功能进入执行后，所有 P1/P2 review finding、用户反馈、CDP 失败、测试失败、日志暴露的问题，都按同一个闭环处理，避免问题只停留在聊天记录里。

| 阶段 | 要求 | 产物 |
|------|------|------|
| Signal | 记录触发信号：review finding、用户反馈、CDP 截图、测试失败、日志证据 | finding / issue / plan note |
| Triage | 判断根因、影响范围、是否阻断用户路径、是否已有同类历史 | 修复范围 + 优先级 |
| Fix | 做最小必要改动；Claude Code 不得借小修复扩成无关重构 | commit / patch summary |
| Verify | 跑相关测试；UI 改动必须 CDP 验证；说明验证场景 | test output / CDP notes |
| Guardrail | 同类问题第二次出现，或涉及 schema/runtime/default/log/security，必须沉淀防线 | guardrail doc / tech-debt tracker / plan update |

**Claude Code 交付说明必须包含：**

- 上下文：用户原始诉求、讨论过程、关键判断、被否掉的方案和原因。不要只贴最终结论；尤其是跨 Runtime / provider / permission / schema / security 的任务，必须让下一个读计划的人知道为什么这么做。
- 根因：为什么会出错。
- 改动：按文件或模块说明改了什么。
- 验证：跑了哪些测试 / CDP 路径。
- 防回归：新增测试、文档、guardrail，或说明为什么暂不需要。

**Codex review 规则：**

- Codex 给 ClaudeCode 的执行文案必须共享判断过程：先写用户问题和争议，再写取舍理由，最后才写执行清单。不能只把聊天里的结论压缩成命令，否则 ClaudeCode 重启或上下文变短后会重复旧误判。
- P1/P2 finding 不能只用聊天确认关闭，必须有修复、测试证据或 tech-debt tracker 条目。
- 涉及 Runtime resolver、默认模型、Provider/Models 暴露、日志脱敏、权限边界、DB schema 的改动，优先要求回归测试。
- 文案承诺类问题也算产品 bug：如果按钮/页面承诺了"诊断、修复、导出、安全"，实现必须真的支持，否则降级文案。

## 执行计划模板

```markdown
# {功能名称}

> 创建时间：YYYY-MM-DD
> 最后更新：YYYY-MM-DD

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | ... | 📋 待开始 / 🔄 进行中 / ✅ 已完成 / ⏸ 暂缓 | |

## 决策日志

- YYYY-MM-DD: 决策内容及原因

## 详细设计

（目标、技术方案、拆分步骤、依赖项、验收标准）

## Smoke Ledger（真实凭据 / UI / E2E 验证记录）

> 跑了真实 smoke 后必须在这里登记一行：Runtime / Provider / Model / 凭据形态 / 场景 / 结果 / 证据。不要把这类信息只留在聊天里——下次切回这个 Phase 时翻不到。
> 第一次跑前可保留下面这行示例不删；跑过后追加真实记录。

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|------|---------|----------|-------|---------|------|--------|----------|
| _示例_ | codex_runtime | OpenRouter | claude-haiku-4.5 | API key | two-turn chat | ✅ | session id / provider id / marker |
```

每个新阶段必须先写清楚：**用户会看到什么变化 / 哪个页面或按钮可以验收 / 本阶段明确不做什么**。说不清用户结果就不能开工（来自 refactor-closeout 审批原则）。

**Smoke Ledger 段是 development-harness-optimization Step 5 起的强制段**。新建 Phase 计划必须保留这段，不追溯已有 active phase（grandfather clause）。下次接入新 Runtime / Provider / 凭据形态时，真实 smoke 结果不再散落在聊天里，而是直接登记在所属 Phase 计划的 Smoke Ledger 表，回头一眼能找到。

## 索引

### Active — 当前推进

| 文件 | 主题 | 状态 |
|------|------|------|
| [active/refactor-closeout.md](active/refactor-closeout.md) | **重构收口总控板**：当前 Phase 状态 / 下一步 / 未闭环风险 / 验收入口 / 最近决策 / Phase 7 方案 | Phase 0-6 ✅ / Phase 8 ✅；Phase 7：图标 ✅归档 / 7b 收口 0-2(3-5 不做) / 7c ✅归档，剩 点阵视觉；遗留清理 post-refactor-cleanup ✅ 已完成归档 |
| [active/main-merge-readiness.md](active/main-merge-readiness.md) | **重构分支合并主分支计划**：worktree → main 的冻结、验证、integration merge 演练、preview 真机验收、正式合并与回滚方案 | 📋 计划已写 + 快照更新至 `bd7b1fd` / 测试 3233 / smoke 16/16；**主分支 tracker #11-#22 编号冲突已预警**；待用户确认后执行，不自动 merge / push |
| [active/merge-blockers-chat-ownership-openrouter.md](active/merge-blockers-chat-ownership-openrouter.md) | **合并前收口：侧栏新建对话入口（来源建模已否决 strip / OpenRouter 发送回归 → tech-debt #37）** | 🟢 已交付：侧栏「写新对话」入口 `a1c9997`；对话来源建模按用户否决 strip（→ tech-debt #38）；OpenRouter"无法发送"本机复现不到、真实缺陷是静默 Opus→Sonnet（→ tech-debt #37，已修 `b6d2e43`+`0f73a5f`，de19e576 真机确认）。待 Codex 复审 |
| [active/preview-build-readiness.md](active/preview-build-readiness.md) | **分支预览包发布前收口**：不合 main，从当前 worktree 打 macOS + Windows Preview 包前的 blocker 修复、Windows readiness、macOS readiness、打包 smoke 与小范围试用闭环 | 📋 已 review，待执行（数据隔离已决"不隔离"+ 装前备份提示；剩 1 个 P1：Windows 包必须在 Windows 构建） |
| [active/preview-final-blockers.md](active/preview-final-blockers.md) | **Preview 合并前最终 blocker 修复**：Windows Codex `.cmd` spawn EINVAL / interrupt 后无法再发送 / Windows single-instance tray + installer + packaged cache / full access 二次确认 / Windows provider edit 双 X / Mimo mapping 与新会话追加错误 | 📋 待 Claude Code 执行；FileTree 与 Workflow 已按用户确认 defer |
| [active/phase-7b-macos-native-visual-profile.md](active/phase-7b-macos-native-visual-profile.md) | **Phase 7b macOS 平台视觉层**：借鉴 Raycast / Apple HIG 的平台感原则，只在窗口 chrome、顶部栏、侧栏、输入区和浮层做 macOS 材质与 hover profile，不分叉页面内容 | 🟢 收口于 Phase 0-2（卡片几何拆出为 7c 已归档）；Phase 3/4/5 用户 2026-05-29 决定不做 |
| [active/development-harness-optimization.md](active/development-harness-optimization.md) | **开发流程 Harness 优化讨论稿（v2）**：Codex 初稿 + ClaudeCode 按用户"可审核"约束重组。事实层面补 3 项 Codex 漏说的已有资产（guardrails/ 4 份模块契约 / lint:colors / tech-debt-tracker）；方向上 Skill 化暂缓、主推自动检查脚本（docs drift / hook 配置）+ 测试矩阵补洞；每个 Step 必须以"用户能看到什么 / 不做什么 / 怎么验收"开头 | 📋 讨论中；待用户对齐 Step 1-3，再决定是否进入 Step 4-6 |
| [active/issue-tracker.md](active/issue-tracker.md) | **统一问题跟踪**：所有 Bug / Feature Request / Sentry 监控的活动看板 | 持续维护 |
| [active/document-system-governance.md](active/document-system-governance.md) | **文档体系治理**：基于 2026-06-05 文档健康审计，清理 active 语义污染，建立 deferred / superseded 目录，归档合并与 preview 旧计划，并升级 docs drift 防线 | 📋 计划已写；待 Claude Code 按 Phase 1-5 执行 |

### 被 refactor-closeout 接管（保留作历史参考）

文件已加 `Superseded by refactor-closeout.md` 顶部标注，不再单独推进；相关工作并入 refactor-closeout 对应 Phase。

| 文件 | 原主题 | 接管至 |
|------|--------|--------|
| [active/opus-4-7-upgrade.md](active/opus-4-7-upgrade.md) | Opus 4.7 模型升级（双 SDK / `xhigh` / tokenizer / 字面化回归） | Phase 1（模型同步与渠道扩展） |
| [active/agent-sdk-0-2-111-adoption.md](active/agent-sdk-0-2-111-adoption.md) | SDK 0.2.111 能力采纳（chip / 限流 UI / WarmQuery / session fork / context usage） | Phase 2（Runtime 与会话执行）+ Phase 6（上下文可视化） |
| [active/scheduled-tasks-notifications.md](active/scheduled-tasks-notifications.md) | 定时任务 + 通知（Notification MCP / TaskScheduler / Electron 系统通知 / 管理 UI） | Phase 3（助理、定时任务、心跳通知） |
| [active/chat-latency-remediation.md](active/chat-latency-remediation.md) | 聊天链路提速（模式入口收敛 / MCP 持久 / 首包优化） | Phase 2（Runtime 与会话执行）+ Phase 3 |
| [active/context-storage-migration.md](active/context-storage-migration.md) | 上下文共享与存储迁移（`message_parts` / `session_runtime_state` / 压缩摘要） | Phase 6（上下文可视化）+ Phase 2 |
| [active/agent-runtime-abstraction-revision.md](active/agent-runtime-abstraction-revision.md) | Runtime 可插拔抽象层（薄接口、Native / SDK / 未来 Codex / Gemini） | Phase 2（Runtime 与会话执行）+ Phase 5（Codex Runtime） |
| [active/agent-trust-ownership-refactor.md](active/agent-trust-ownership-refactor.md) | Agent Trust & Ownership Refactor（剩余 Run Cockpit + session-level Runtime + 事件日志） | Phase 2（Runtime 与会话执行）+ Phase 3 |

### 暂缓（本轮不开工，等收口完成后再评估）

文件已加 ⏸ 暂缓顶部标注，与 refactor-closeout 的"暂缓清单"对齐。

| 文件 | 原主题 | 暂缓原因 |
|------|--------|----------|
| [active/chat-run-checkpoint.md](active/chat-run-checkpoint.md) | Chat Run Checkpoint（Round 1+2 已完成；Round 3 PermissionPrompt 视觉收编） | Run Checkpoint Round 3（用户 2026-04-30 决定） |
| [active/memory-system-v3.md](active/memory-system-v3.md) | 记忆系统 V3（Phase 1-3 + V3.1 已完成；Phase 4 Memory Flush + Memory 管理面板） | Memory 管理面板 |
| [active/site-and-docs.md](active/site-and-docs.md) | 官网 + 文档站（Phase 0-3 已完成；Phase 4-5 packages/ui + 桌面端适配） | 大规模官网 / 文档站 |
| [active/weixin-bridge-channel.md](active/weixin-bridge-channel.md) | 微信 Bridge 通道一次性交付 | 更多 Bridge 渠道 |
| [active/qq-bridge-channel.md](active/qq-bridge-channel.md) | QQ Bridge Channel | 更多 Bridge 渠道 |
| [active/unified-context-layer.md](active/unified-context-layer.md) | 统一上下文层 + 浮窗助理（Phase 1-3 已完成；Phase 4-5 浮窗 + 通知） | 浮窗助理；通知 / 后台能力走 closeout Phase 3；上下文能力顺延 Phase 6 |
| [active/git-terminal-integration.md](active/git-terminal-integration.md) | Git + 终端集成 | 不在本轮 6 条主线 |

### Completed

> Refactor closeout 的 Phase 1-5 归档在 `completed/refactor-phase-*.md` + `completed/phase-4-markdown-artifact.md` + `completed/phase-5*.md`，由 active 总控板的"历史归档"列直接 link；下方按完成日期倒序排其它独立计划。

| 文件 | 主题 | 完成日期 |
|------|------|----------|
| [completed/post-refactor-cleanup.md](completed/post-refactor-cleanup.md) | **重构收尾后遗留清理**：Opus 4.8 接入 + Sonnet 4.6 别名 (#23) / Mac 通知链路确认 (#34) / pin 误报修复 (#27) / Plan 模式 Widget (#26) / Windows shell 默认 PowerShell (#28) / pre-commit enforce + 测试 flake 根治 (#30) / design.md 横切三节 (E)；13 React Compiler error 拆 #35；Preview 打包属独立下一阶段 | 2026-05-31 |
| [completed/phase-8-codex-mcp-context-injection.md](completed/phase-8-codex-mcp-context-injection.md) | **Phase 8 Codex MCP / Memory 注入**：`config.mcp_servers` 注入链路 + 5 项核心能力（Memory / Widget / Tasks+Notify / Dashboard / CLI）在 Codex Account 下真账号 smoke 通过 + 按能力区分的 elicitation 审批策略（read 自动 / write 弹审批）+ Codex 原生图片入库对齐素材库；Image/Media 与用户自定义 MCP 用户决定 defer | 2026-05-29 |
| [completed/phase-7-icon-system.md](completed/phase-7-icon-system.md) | **Phase 7 图标体系与表意校准**：CodePilot semantic icon layer（一概念一 glyph）+ HugeIcons 主库 + LobeHub 品牌图标保留 + Brain/Lightning/Terminal 冲突裁决 + eslint guardrail；96 文件迁到 CodePilotIcon | 2026-05-29 |
| [completed/phase-7c-card-primitive.md](completed/phase-7c-card-primitive.md) | **Phase 7c 浮动卡片 layout primitive**：CardFrame / CardSurface / ResizeGutter 三个单职责组件收敛四张浮动卡片的 shadow / clip-path / gutter 几何；sidebar 改 row-level card、AssistantPanel 接入、真实 DOM gutter 几何 e2e；验收证据见 [handover/macos-visual-profile.md](handover/macos-visual-profile.md) Phase 7c 章节 | 2026-05-26 |
| [completed/phase-6-context-visualization.md](completed/phase-6-context-visualization.md) | Phase 6 上下文用量可视化：点阵式 Context Breakdown、来源分解、剩余上下文、三 Runtime context-accounting smoke；真实数据契约见 [context-accounting-runtime-contract.md](completed/context-accounting-runtime-contract.md) | 2026-05-20 |
| [completed/context-accounting-runtime-contract.md](completed/context-accounting-runtime-contract.md) | Context Accounting Runtime Contract：三 Runtime context_breakdown 持久化、ToolInvocation 抽象、真实 smoke evidence 与 Phase 6 数据源收口 | 2026-05-20 |
| [completed/phase-5-codex-runtime.md](completed/phase-5-codex-runtime.md) | Phase 5 Codex Runtime 接入：Codex app-server / Codex Account / Runtime adapter / approval + file events / provider proxy translator / OpenRouter + OAuth 收口 / installed_idle 状态文案 | 2026-05-19 |
| [completed/phase-5c-codex-tool-bridge.md](completed/phase-5c-codex-tool-bridge.md) | Phase 5c CodePilot Tool Bridge：Codex Runtime 下桥接 Memory / Tasks / Widget / Image / Media，unsupported 能力在 Settings 与工具结果中诚实降级 | 2026-05-18 |
| [completed/phase-5d-harness-capability-contract.md](completed/phase-5d-harness-capability-contract.md) | Phase 5d Harness Capability Contract：Capability registry / Context Compiler / Runtime adapter facade / Artifact contract / New Runtime Playbook | 2026-05-18 |
| [completed/phase-5d-phase-2-context-compiler.md](completed/phase-5d-phase-2-context-compiler.md) | Phase 5d Phase 2 Context Compiler：三 Runtime 统一上下文编译，Runtime 只 adapt 不 redefine | 2026-05-18 |
| [completed/phase-5d-phase-6-codex-account-harness.md](completed/phase-5d-phase-6-codex-account-harness.md) | Phase 5d Phase 6 Codex Account Harness 调研计划：已归入 Phase 5e 的 provider-aware Settings / 能力降级收口 | 2026-05-18 |
| [completed/phase-5e-runtime-harness-architecture.md](completed/phase-5e-runtime-harness-architecture.md) | Phase 5e Runtime Harness Architecture：Runtime / Provider / Harness 三层边界、三层 HarnessBundle、User/External scanner、Settings 能力清单、mutationLevel 权限分级、Native 基础盘补齐、Codex 不支持能力诚实降级、New Runtime Playbook 收口 | 2026-05-18 |
| [completed/phase-4-markdown-artifact.md](completed/phase-4-markdown-artifact.md) | refactor-closeout Phase 4 归档：Markdown 数据层（trust tier / quiet refresh / 编辑冲突）+ HTML 表现层（同源路由 / CSP 4 轮）+ Markdown 原地风格 + Artifact code-fence / dev-output 引用 | 2026-05-12 |
| [completed/refactor-phase-3-background-tasks-notifications.md](completed/refactor-phase-3-background-tasks-notifications.md) | refactor-closeout Phase 3 归档（菜单栏常驻 + 全局定时任务 + 本机通知 + Bridge 解耦 + 后台 Agent 任务 + 心跳后台化 + dev-server 内存收口） | 2026-05-10 |
| [completed/refactor-phase-2-runtime-session.md](completed/refactor-phase-2-runtime-session.md) | refactor-closeout Phase 2 归档（Runtime 与会话执行：session.runtime_pin + composer 切换面板 + 409 banner + transcript marker） | 2026-05-07 |
| [completed/refactor-phase-1-models-providers.md](completed/refactor-phase-1-models-providers.md) | refactor-closeout Phase 1 归档（默认模型契约 + 套餐型白名单 + OpenRouter search-and-add + 自定义模型入口） | 2026-05-06 |
| [completed/openrouter-search-and-add.md](completed/openrouter-search-and-add.md) | OpenRouter 取消全量目录物化 → 独立 search-models + validate-models 路由 + 「整理早期导入的目录」opt-in 入口；关闭 tech-debt #13 | 2026-05-06 |
| [completed/tooling-assistant-surface-cleanup.md](completed/tooling-assistant-surface-cleanup.md) | Phase 2D Skills / MCP / CLI 三入口收敛到 `/plugins`（2D.0 + 2D.1 + 2D.2 + 2D.4 完成；2D.3 推迟、2D.5 独立） | 2026-05-01 |
| [completed/markdown-artifact-overhaul.md](completed/markdown-artifact-overhaul.md) | Markdown 渲染/编辑 × Artifact 网页预览扩展 | 2026-04-21 |
| [completed/composer-refactor.md](completed/composer-refactor.md) | Composer 重构 + 单聊天权限 + 远程桥接联动 | 2026-04-29 |
| [completed/context-chips-phase-1.md](completed/context-chips-phase-1.md) | Chat composer 显式上下文 chips Phase 1 | 2026-04-29 |
| [completed/workspace-sidebar-tabs.md](completed/workspace-sidebar-tabs.md) | Workspace Sidebar Tabs（Git / Widget 固定 + Markdown / Artifact / 文件预览动态） | 2026-04-30 |
| [completed/runtime-auto-and-onboarding.md](completed/runtime-auto-and-onboarding.md) | Runtime auto 简化 + 错误归一翻译 + 入口拦截 + 百炼 catalog 替换 | 2026-04-15（已发布 v0.50.x） |
| [completed/cc-switch-credential-bridge.md](completed/cc-switch-credential-bridge.md) | cc-switch 凭据桥接（per-request shadow `~/.claude/`） | 2026-04-15（已发布 v0.50.2） |
| [completed/electron-port-stability.md](completed/electron-port-stability.md) | Electron 端口稳定化（修主题 / 默认模型 / dismiss 状态重启失效） | 2026-04-15（已发布 v0.50.2） |
| [completed/decouple-claude-code.md](completed/decouple-claude-code.md) | 脱离 Claude Code 依赖 — 自建 Agent Runtime（Provider/Loop/Tools/MCP/Permission/Session/Skills/SubAgent） | 2026-04-07（Phase 0-7 + 4 闭环 + Phase 8 ✅） |
| [completed/decouple-test-plan.md](completed/decouple-test-plan.md) | 脱离 Claude Code 功能测试方案（配套 decouple-claude-code） | 2026-04-07 |
| [completed/provider-governance.md](completed/provider-governance.md) | 服务商系统治理（Preset 声明式 + Schema 校验 + 连通性验证 + meta 引导 + 错误恢复 + 模型目录动态化） | 2026-04 |
| [completed/provider-resolver-refactor.md](completed/provider-resolver-refactor.md) | Provider Resolver 统一（Phase 1-5 完成） | 2026-03 |
| [completed/v0.48-post-release-issues.md](completed/v0.48-post-release-issues.md) | v0.48.0/0.48.1 发版后问题追查（已归档至 issue-tracker.md） | 2026-04 |
| [completed/open-issues-2026-03-12.md](completed/open-issues-2026-03-12.md) | 早期 GitHub Issues triage 快照（已合并至 issue-tracker.md） | 2026-04 |
| [completed/hermes-inspired-runtime-upgrade.md](completed/hermes-inspired-runtime-upgrade.md) | Hermes 借鉴的 Runtime 能力升级（6 核心 + 12 额外） | 2026-04-12 |
| [completed/engineering-quality-assurance.md](completed/engineering-quality-assurance.md) | 工程质量保障体系（Harness Engineering） | 2026-03-04 |
| [completed/skills-mcp-tooling-fix.md](completed/skills-mcp-tooling-fix.md) | Skills / MCP / Tooling 修复 | 早期 |
| [completed/cli-upgrade-proxy.md](completed/cli-upgrade-proxy.md) | CLI 升级代理 | 早期 |
| [completed/assistant-workspace.md](completed/assistant-workspace.md) | 助理工作区 | 早期 |
