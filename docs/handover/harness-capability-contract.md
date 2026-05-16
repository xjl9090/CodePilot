# Harness Capability Contract

> 产品思考见 [docs/insights/harness-capability-contract.md](../insights/harness-capability-contract.md)
> 执行计划：[docs/exec-plans/active/phase-5d-harness-capability-contract.md](../exec-plans/active/phase-5d-harness-capability-contract.md)
> 相关：[docs/handover/codex-tool-bridge.md](./codex-tool-bridge.md)（Phase 5c Codex bridge 实现）/ [docs/handover/provider-proxy-bridge.md](./provider-proxy-bridge.md)（Codex Responses proxy 协议层）

## 这层做什么

把 CodePilot 自有能力（Memory / Tasks / Widget / Media / Notify / Dashboard / CLI tools）的**跨 Runtime 行为契约**钉死成单一来源，让 ClaudeCode SDK Runtime / Native Runtime / Codex Runtime 看到的同一个 CodePilot 能力是真的同一个能力，不是三份漂移的实现。

不替换现有 MCP 服务器、AI SDK tools 或 Codex bridge factory；只声明它们必须满足的契约 + 用测试守住。

## 三层模型

每个能力按三层定义：

| 层 | 内容 | 如何固定 |
|---|---|---|
| Tool schema | 工具名、参数 schema、描述 | 各 Runtime 的 factory 函数（MCP / AI SDK tool / bridge tool）继续保留实现；契约声明 `toolNames`，drift 测试断言这些名字真的注册了 |
| Context instruction | system prompt fragment（capability 文本提示） | 单一权威文件持有完整 fragment；另外两个 Runtime 通过 TS import 引用同一常量，禁止改写 |
| UI artifact contract | tool 结果格式 + canonical 事件 + 前端渲染路径 | 契约声明 `toolResultShape` / `canonicalEventTypes` / `uiRenderPath` / 可选 `artifactContract`；renderer 与契约由 contract test 校验 |

Widget 的 `show-widget` JSON 示例需要 round-trip 校验：契约持有 `canonicalJson`，测试用 `JSON.parse` 解开，再喂给 `parseAllShowWidgets` 必须返回一个 `widget` segment（不是 `malformed_widget`）。

## 文件总览

| 文件 | 角色 |
|---|---|
| `src/lib/harness/capability-contract.ts` | 唯一目录。每个能力一个 `CapabilityContract` 条目，导入并暴露权威 prompt fragment + 三 Runtime 暴露方式。 |
| `src/lib/widget-guidelines.ts` | Widget 权威源。`WIDGET_SYSTEM_PROMPT` / `WIDGET_WIRE_FORMAT_SPEC` / `CANONICAL_SHOW_WIDGET_JSON` 在这里；Native + Codex bridge 通过 import 消费。 |
| `src/lib/memory-search-mcp.ts` | Memory 权威源 (`MEMORY_SEARCH_SYSTEM_PROMPT`)。 |
| `src/lib/notification-mcp.ts` | Tasks + Notify 权威源 (`NOTIFICATION_MCP_SYSTEM_PROMPT`)。 |
| `src/lib/builtin-tools/media.ts` | 媒体（image gen + import）权威源 (`MEDIA_SYSTEM_PROMPT`)。MCP 端没有等价文件 — tech-debt：未来补 `media-mcp.ts` 让它和其它能力同形。 |
| `src/lib/dashboard-mcp.ts` | Dashboard 权威源 (`DASHBOARD_MCP_SYSTEM_PROMPT`)。Codex bridge 未实现，状态 `deferred`。 |
| `src/lib/builtin-tools/widget-guidelines.ts` | Native Runtime widget。re-export 权威 prompt，不再持有 abridged 副本。 |
| `src/lib/codex/proxy/builtin-bridge.ts` | Codex Runtime bridge。`WIDGET_PROMPT = CANONICAL_WIDGET_SYSTEM_PROMPT`（slice 7 修过的最小漂移点）。 |
| `src/__tests__/unit/harness-capability-contract.test.ts` | 契约测试套。catalog 完整性 / 工具名一致性 / drift 检测 / Widget JSON round-trip / 媒体 render path / 状态分类。 |

## 当前能力矩阵

由 `HARNESS_CAPABILITIES` 数组持有；如下表是 2026-05-16 slice 7 状态。任何更新先改契约 + 跑测试，不要直接改 MCP / Native / bridge。

| Capability | Status | Tool names | ClaudeCode SDK | Native | Codex Proxy | 备注 |
|---|---|---|---|---|---|---|
| widget | live | `codepilot_load_widget_guidelines` | MCP `createWidgetMcpServer` | AI SDK `createWidgetGuidelinesTools`（re-export 权威 prompt） | bridge `buildWidgetGuidelinesTool`，`WIDGET_PROMPT = canonical` | slice 7 de-drifted；artifact contract = `show-widget` fence，JSON.parse-safe 示例 |
| memory | live | `codepilot_memory_recent`、`codepilot_memory_search`、`codepilot_memory_get` | MCP `createMemorySearchMcpServer` | AI SDK `createMemorySearchTools`（仍有 prompt drift） | bridge `buildMemoryRecentTool` / `buildMemorySearchTool` / `buildMemoryGetTool` | workspace-gated；Native + bridge prompt 与 MCP 仍漂移，slice 8 tech-debt |
| tasks_and_notify | live | `codepilot_notify`、`codepilot_schedule_task`、`codepilot_list_tasks`、`codepilot_cancel_task`、`codepilot_hatch_buddy` | MCP `createNotificationMcpServer` | AI SDK `createNotificationTools` | bridge `buildNotifyTool` 等四个；`codepilot_hatch_buddy` 未在 bridge 实现（契约 notes 中明确） | slice 4 已修 durable / list / cancel parity |
| image_generation | live | `codepilot_generate_image` | MCP `createImageGenMcpServer`（通过 MEDIA_RESULT_MARKER 注入 SSE media） | AI SDK `createMediaTools` (image key)（仅返回文本，无 MediaBlock — drift tech-debt） | bridge `buildImageGenerationTool`（带 MediaBlock + materialize） | slice 2 + 4 已修 |
| media_import | live | `codepilot_import_media` | unsupported（无 MCP 等价文件 — tech-debt） | AI SDK `createMediaTools` (import key) | bridge `buildImportMediaTool`（slice 4 已按 mimeType 推断 type） | |
| dashboard | deferred | `codepilot_dashboard_*` ×5 | MCP `createDashboardMcpServer` | AI SDK `createDashboardTools` | unsupported — 写操作需要 bridge permission round-trip 设计 | Phase 5d Phase 3 之后再开 |
| cli_tools | deferred | `codepilot_cli_tools_*` ×6 | MCP `createCliToolsMcpServer` | AI SDK `createCliToolsTools` | unsupported — install/update/remove 需要 permission 契约 | 同上 |

## 契约测试都测什么

`harness-capability-contract.test.ts` 锁定的不变量：

1. **Catalog hygiene** — 每个 entry 字段齐全；id 唯一；非 live 必须有 `deferredReason`；live 至少两个 runtime wired。
2. **Tool-name agreement** — live capability 声明的工具名必须在至少一个 wired 文件源中出现。
3. **Bridge drift 严格检测** — bridge `WIDGET_PROMPT` 必须是 `CANONICAL_WIDGET_SYSTEM_PROMPT` 的 import + 直接赋值；Native widget 同样必须 re-export 权威。
4. **Widget JSON round-trip** — 契约里的 `canonicalJson` 走 `JSON.parse` 不抛；走 `parseAllShowWidgets` 必须返回 widget segment（不是 malformed）。
5. **Media render path** — `toolResultShape === 'media'` 的 capability，`uiRenderPath` 必须提到 `MediaPreview`。
6. **状态-暴露一致性** — deferred 必须至少一个 runtime 标 unsupported；unsupported 必须带 `notes` 解释。
7. **runtime 真实挂载** — `createCodePilotBuiltinTools` 真的 mount 了 contract 声明的 `bridge_executable` 工具；未 mount 的（如 `codepilot_hatch_buddy`）必须在 contract notes 中明确解释。

## 接入新 Runtime 的硬性流程

> 这部分对应 Phase 5d Phase 5 的 Playbook。新 Runtime（Hermes / Gemini / OpenClaw 等）落地前必须按此走。

1. **Snapshot 上游协议** — 把目标 Runtime 的 SDK / protocol fixture 拷到 `资料/<runtime>/`。Codex `tool_spec.rs` enum 是最近一次的真实参照（参考 `资料/codex/codex-rs/tools/src/tool_spec.rs`）。
2. **填 Runtime Capability Inventory** — 对每个 `live` capability 决定：原生支持 / 通过 bridge 执行 / 当前 unsupported with reason。
3. **修改契约** — 给每个 capability 的 `exposure` map 加一个新的 runtime key（先 `unsupported with notes`，再逐项升级）。
4. **跑 contract tests** — `npm run test`。测试不会过的 capability，要么写实现，要么明确 unsupported。
5. **跑 smoke matrix** — capability 全部 live 之后才跑真实凭据 smoke。**禁止反过来：先 live smoke 再补字段**（这是 Phase 5c 三天救火的根因）。
6. **打开 picker** — smoke 全过、契约绿，才把 Runtime 在 Settings / Runtime picker 标可用。

## 当前已知 tech-debt

| 项 | 影响 | 解决方向 |
|---|---|---|
| Native widget 早期有 abridged prompt，slice 7 已 re-export 权威 | 已修 | — |
| Native memory + tasks 仍有自己的 prompt（drift） | 模型在 Native Runtime 下读到的规则与 ClaudeCode/Codex 不同 | slice 8：让 builtin-tools/memory-search.ts + builtin-tools/notification.ts 从 MCP 文件 re-export |
| `image_generation` Native exposure 不返回 MediaBlock | Native Runtime 下用户看不到图片卡（要看 marker text） | slice 8：让 Native execute 也构造 MediaBlock 走 ai-sdk tool result |
| `media_import` 在 ClaudeCode 路径无 MCP 等价 | ClaudeCode 用户无法用专门的 import 工具（只能让 image-gen MCP 间接处理） | 补 `media-import-mcp.ts` 后契约 claudecode_sdk 升级为 `mcp_server` |
| Dashboard / CLI tools 无 Codex bridge | Codex Runtime 用户调不动这两族工具 | 需要先定 bridge 端 permission round-trip 协议 |
| `cli_tools` 没有独立 `_SYSTEM_PROMPT` export | 契约的 systemPromptFragment 暂为空字符串 | slice 8：从 MCP factory 提取 |

## 与既有契约的关系

- `RuntimeRunEvent` / `AgentRuntime`（`src/lib/runtime/contract.ts`） — 是输出面契约（runtime 发什么事件给 UI）。Harness Capability Contract 是**输入面 + 中间面**契约（UI 上看到的"一项能力"在每个 runtime 各自怎么挂、提示什么、产出什么）。两层互不替代，配合用。
- `Provider Proxy Bridge`（`docs/handover/provider-proxy-bridge.md`） — Codex Responses proxy 的协议层（八个 hook）。Capability Contract 是其上一层：proxy 让 Codex 能跑 CodePilot provider 的请求；bridge 是 proxy 上挂的 CodePilot 能力适配器。
- `Codex Tool Bridge`（`docs/handover/codex-tool-bridge.md`） — Phase 5c 的具体实现交付。Phase 5d 把 5c 的经验抽成契约。
