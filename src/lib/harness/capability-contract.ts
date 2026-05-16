/**
 * Harness Capability Contract — single source of truth for what
 * CodePilot exposes to a model, across all three runtime
 * orchestrators (ClaudeCode SDK Runtime, CodePilot Native Runtime,
 * Codex Runtime via provider proxy).
 *
 * Phase 5c slice 7 (2026-05-16).
 *
 * ── Why this module exists ─────────────────────────────────────────
 *
 * ClaudeCode is stable because the SDK natively understands MCP /
 * tools / permissions — CodePilot just feeds it in-process MCP
 * servers and the SDK handles round-trips without translation.
 *
 * Codex Account is stable because Codex runs its own model + plugin
 * stack end-to-end; CodePilot just reads `item/completed`
 * notifications.
 *
 * Codex Runtime + a CodePilot provider (GLM/Kimi/openai-oauth/etc.)
 * goes through a much longer pipeline:
 *
 *   Codex app-server → Responses proxy → AI SDK streamText →
 *   upstream model → Responses SSE → Codex app-server → CodePilot UI
 *
 * Every link in that chain involves a translation we own
 * (`src/lib/codex/proxy/*`, `src/lib/codex/runtime.ts`,
 * `src/lib/codex/event-mapper.ts`). Each translation is a place
 * where the capability contract can drift — three independent
 * `WIDGET_SYSTEM_PROMPT` constants paraphrasing the same rules,
 * three independent tool schemas, three independent UI render
 * paths.
 *
 * Pre-contract evidence (slice 6 smoke):
 *   - `WIDGET_SYSTEM_PROMPT` in `src/lib/widget-guidelines.ts`
 *     (slice-6 hardened, 30+ lines, includes the wire-format spec
 *     and image-gen rule).
 *   - `WIDGET_SYSTEM_PROMPT` in `src/lib/builtin-tools/widget-guidelines.ts`
 *     (14-line abridged version, missing both).
 *   - Codex bridge `WIDGET_PROMPT` (slice-6 standalone, paraphrased
 *     differently from the canonical).
 *
 * Three drifting copies. GLM/Kimi via Codex Runtime saw the bridge
 * version; ClaudeCode users saw the MCP version; same product
 * surface, different rules.
 *
 * ── What this module IS ────────────────────────────────────────────
 *
 * A declarative catalog. Each capability has exactly ONE entry that
 * names:
 *
 *   1. The authoritative file + export for the system prompt
 *      fragment. All three runtimes import from that file or this
 *      contract re-exports it.
 *   2. The exposure surface on each runtime (which factory function
 *      builds the tool, what kind of tool wrapper it uses).
 *   3. The tool result shape + canonical event types the runtime
 *      MUST emit when the tool runs.
 *   4. The UI render path — which component consumes the tool
 *      result. If a capability emits media but no renderer can
 *      consume it, that's a contract violation visible here.
 *   5. The status: `live` (fully wired all three runtimes),
 *      `deferred` (planned, not yet implemented anywhere), or
 *      `unsupported` (deliberately disabled, with reason).
 *
 * ── What this module IS NOT ────────────────────────────────────────
 *
 * It does NOT replace the actual MCP server factories / AI SDK tool
 * factories / bridge tool builders — those stay in their existing
 * files. The contract documents what they must satisfy. Drift tests
 * in `harness-capability-contract.test.ts` enforce the alignment.
 *
 * ── New-runtime onboarding ─────────────────────────────────────────
 *
 * Before adding a fourth runtime (Gemini app-server, OpenClaw, etc.)
 * the integration MUST:
 *
 *   1. Implement an exposure factory for each `status: 'live'`
 *      capability OR explicitly mark the capability as unsupported
 *      with a `deferredReason` on the new runtime's entry.
 *   2. Embed the canonical `systemPromptFragment` verbatim (no
 *      paraphrase). Codex-style prefixes / wrappers are allowed only
 *      if they don't contradict the canonical rules.
 *   3. Pass the runtime-specific contract test (TBD when the new
 *      runtime lands; today the test enforces only the three
 *      existing runtimes).
 *   4. Real-credential smoke can run AFTER contract tests pass, NOT
 *      before. Live-smoke-driven patching is what the pre-contract
 *      slices 1-6 demonstrated doesn't scale.
 */

import { WIDGET_SYSTEM_PROMPT, CANONICAL_SHOW_WIDGET_JSON } from '@/lib/widget-guidelines';
import { MEMORY_SEARCH_SYSTEM_PROMPT } from '@/lib/memory-search-mcp';
import { NOTIFICATION_MCP_SYSTEM_PROMPT } from '@/lib/notification-mcp';
import { MEDIA_SYSTEM_PROMPT } from '@/lib/builtin-tools/media';
import { DASHBOARD_MCP_SYSTEM_PROMPT } from '@/lib/dashboard-mcp';

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type CapabilityStatus =
  /** All three runtimes wired + tested. */
  | 'live'
  /** Planned but not yet wired anywhere. Build path: pick a runtime
   *  to land first, mark its exposure with kind=ai_sdk_tool/mcp_server,
   *  flip status to `live` once the other two follow + tests pass. */
  | 'deferred'
  /** Deliberately disabled. `deferredReason` MUST explain why
   *  (security risk, design conflict, etc.) — otherwise it's just
   *  a `deferred` in disguise. */
  | 'unsupported';

export type RuntimeExposureKind =
  /** In-process MCP server registered with the Claude Agent SDK. */
  | 'mcp_server'
  /** AI SDK tool with execute(), called inside Native Runtime's
   *  streamText loop or Codex proxy's streamText loop. */
  | 'ai_sdk_tool'
  /** AI SDK tool with execute() that runs server-side in the Codex
   *  Responses proxy and pipes results back to CodePilot UI via the
   *  side-channel event bus. */
  | 'bridge_executable'
  /** Codex-native tool surface (shell / namespace / etc.) that the
   *  proxy preserves on `passthroughTools` but doesn't execute. */
  | 'bridge_passthrough'
  /** Runtime deliberately does not expose this capability — either
   *  not applicable (e.g. workspace memory in a chat-less smoke) or
   *  intentionally disabled. */
  | 'unsupported';

export interface RuntimeExposure {
  readonly kind: RuntimeExposureKind;
  /** Source file path (relative to repo root). Drift tests grep
   *  this file to confirm the factory exists. */
  readonly module?: string;
  /** Exported function name. The test grep is on this symbol — if
   *  the factory gets renamed the test must be updated alongside. */
  readonly factory?: string;
  /** Short note for the contract reader, NOT for the test. */
  readonly notes?: string;
}

export interface CapabilityArtifactContract {
  /** Code fence language (e.g. `show-widget`, `image-gen-request`,
   *  `batch-plan`) the model must emit to trigger the renderer. */
  readonly fenceLanguage: string;
  /** A copy/paste-safe example the contract test can JSON.parse +
   *  feed into the renderer. Pre-slice-7 widget had a double-escaped
   *  example that broke JSON.parse — fixed by switching HTML attr
   *  quotes to single quotes. */
  readonly canonicalJson: string;
  /** Required top-level JSON fields. Renderer-side parser fails fast
   *  when any required field is missing. */
  readonly requiredFields: readonly string[];
}

export interface CapabilityContract {
  readonly id: string;
  readonly displayName: string;
  readonly status: CapabilityStatus;
  /** Required when status !== 'live'. Single sentence explaining
   *  why this capability isn't wired today + what would unblock it. */
  readonly deferredReason?: string;
  /** Tool names the runtime exposes. For `live` capabilities these
   *  MUST match the actual function names the model can call (the
   *  registered MCP tools / AI SDK tool keys / bridge tool keys). */
  readonly toolNames: readonly string[];
  readonly exposure: {
    readonly claudecode_sdk: RuntimeExposure;
    readonly native: RuntimeExposure;
    readonly codex_proxy: RuntimeExposure;
  };
  /** Canonical system-prompt fragment all three runtimes must inject.
   *  Drift tests assert each runtime's exposure file includes this
   *  string verbatim or re-exports it via TypeScript import. */
  readonly systemPromptFragment: string;
  /** Whether the tool result is plain text, MediaBlock-bearing, or
   *  a mix. Bridge layer uses this to decide whether to call
   *  `materializeCodexEventMedia` before SSE-emitting. */
  readonly toolResultShape: 'text' | 'media' | 'mixed';
  /** Canonical events the runtime must emit when the tool runs.
   *  `tool_started` + `tool_completed` is the baseline for any
   *  callable tool. */
  readonly canonicalEventTypes: ReadonlyArray<
    'tool_started' | 'tool_completed' | 'file_changed' | 'usage_updated'
  >;
  /** Component path that renders the tool result + a one-line note
   *  about the render mechanism. Drift tests don't import the
   *  component (UI test surface) but a future audit can grep here
   *  for "is the render path actually wired?". */
  readonly uiRenderPath: string;
  /** Required when the capability produces an in-chat artifact
   *  (widget / image / batch plan / etc.). Contract test will
   *  JSON.parse `canonicalJson` and feed it to the named parser. */
  readonly artifactContract?: CapabilityArtifactContract;
}

// ─────────────────────────────────────────────────────────────────────
// Catalog
// ─────────────────────────────────────────────────────────────────────

const widget: CapabilityContract = {
  id: 'widget',
  displayName: 'Generative UI widgets',
  status: 'live',
  toolNames: ['codepilot_load_widget_guidelines'],
  exposure: {
    claudecode_sdk: {
      kind: 'mcp_server',
      module: 'src/lib/widget-guidelines.ts',
      factory: 'createWidgetMcpServer',
      notes: 'Authoritative implementation. Owns WIDGET_SYSTEM_PROMPT + WIDGET_WIRE_FORMAT_SPEC.',
    },
    native: {
      kind: 'ai_sdk_tool',
      module: 'src/lib/builtin-tools/widget-guidelines.ts',
      factory: 'createWidgetGuidelinesTools',
      notes: 'Re-exports WIDGET_SYSTEM_PROMPT from the canonical source (slice 7).',
    },
    codex_proxy: {
      kind: 'bridge_executable',
      module: 'src/lib/codex/proxy/builtin-bridge.ts',
      factory: 'buildWidgetGuidelinesTool',
      notes: 'WIDGET_PROMPT = canonical fragment verbatim (slice 7 de-drift).',
    },
  },
  systemPromptFragment: WIDGET_SYSTEM_PROMPT,
  toolResultShape: 'text',
  canonicalEventTypes: ['tool_started', 'tool_completed'],
  uiRenderPath: 'parseAllShowWidgets → PinnableWidget (src/components/chat/MessageItem.tsx); MalformedWidgetNotice for invalid fences (slice 6)',
  artifactContract: {
    fenceLanguage: 'show-widget',
    canonicalJson: CANONICAL_SHOW_WIDGET_JSON,
    requiredFields: ['title', 'widget_code'],
  },
};

const memory: CapabilityContract = {
  id: 'memory',
  displayName: 'Assistant workspace memory',
  status: 'live',
  toolNames: ['codepilot_memory_recent', 'codepilot_memory_search', 'codepilot_memory_get'],
  exposure: {
    claudecode_sdk: {
      kind: 'mcp_server',
      module: 'src/lib/memory-search-mcp.ts',
      factory: 'createMemorySearchMcpServer',
      notes: 'Authoritative implementation. Owns MEMORY_SEARCH_SYSTEM_PROMPT with the "first-turn must call memory_recent" rule.',
    },
    native: {
      kind: 'ai_sdk_tool',
      module: 'src/lib/builtin-tools/memory-search.ts',
      factory: 'createMemorySearchTools',
      notes: 'Currently has its own MEMORY_SEARCH_SYSTEM_PROMPT (5-line abridged) that drifts from MCP. Tech-debt: align with canonical in follow-up slice.',
    },
    codex_proxy: {
      kind: 'bridge_executable',
      module: 'src/lib/codex/proxy/builtin-bridge.ts',
      factory: 'buildMemorySearchTool',
      notes: 'Workspace-gated. Bridge MEMORY_PROMPT paraphrases canonical; tech-debt as Native.',
    },
  },
  systemPromptFragment: MEMORY_SEARCH_SYSTEM_PROMPT,
  toolResultShape: 'text',
  canonicalEventTypes: ['tool_started', 'tool_completed'],
  uiRenderPath: 'Inline text in assistant message (no special artifact); MessageItem.tsx tool_use/tool_result blocks',
};

const tasksAndNotify: CapabilityContract = {
  id: 'tasks_and_notify',
  displayName: 'Scheduled tasks + immediate notifications',
  status: 'live',
  toolNames: [
    'codepilot_notify',
    'codepilot_schedule_task',
    'codepilot_list_tasks',
    'codepilot_cancel_task',
    'codepilot_hatch_buddy',
  ],
  exposure: {
    claudecode_sdk: {
      kind: 'mcp_server',
      module: 'src/lib/notification-mcp.ts',
      factory: 'createNotificationMcpServer',
      notes: 'Authoritative. Owns NOTIFICATION_MCP_SYSTEM_PROMPT.',
    },
    native: {
      kind: 'ai_sdk_tool',
      module: 'src/lib/builtin-tools/notification.ts',
      factory: 'createNotificationTools',
      notes: 'NOTIFICATION_SYSTEM_PROMPT (note name diff: SYSTEM vs MCP_SYSTEM). Drift TBD-checked in slice 8.',
    },
    codex_proxy: {
      kind: 'bridge_executable',
      module: 'src/lib/codex/proxy/builtin-bridge.ts',
      factory: 'buildNotifyTool / buildScheduleTaskTool / buildListTasksTool / buildCancelTaskTool',
      notes: 'Slice 4 added durable/list/cancel parity with the MCP variant. codepilot_hatch_buddy is NOT exposed via bridge — Codex-runtime buddy hatching deferred to a future slice.',
    },
  },
  systemPromptFragment: NOTIFICATION_MCP_SYSTEM_PROMPT,
  toolResultShape: 'text',
  canonicalEventTypes: ['tool_started', 'tool_completed'],
  uiRenderPath: 'Inline text; system notifications via NotificationManager.sendNotification (renderer toast + Electron + Telegram per priority)',
};

const imageGeneration: CapabilityContract = {
  id: 'image_generation',
  displayName: 'AI image generation',
  status: 'live',
  toolNames: ['codepilot_generate_image'],
  exposure: {
    claudecode_sdk: {
      kind: 'mcp_server',
      module: 'src/lib/image-gen-mcp.ts',
      factory: 'createImageGenMcpServer',
      notes: 'Uses MEDIA_RESULT_MARKER text marker; claude-client.ts parses the marker and injects into SSE tool_result.media.',
    },
    native: {
      kind: 'ai_sdk_tool',
      module: 'src/lib/builtin-tools/media.ts',
      factory: 'createMediaTools (codepilot_generate_image key)',
      notes: 'Calls generateSingleImage directly; result text only — Native Runtime does not currently emit MediaBlock for image results. Drift tech-debt.',
    },
    codex_proxy: {
      kind: 'bridge_executable',
      module: 'src/lib/codex/proxy/builtin-bridge.ts',
      factory: 'buildImageGenerationTool',
      notes: 'Slice 2 + slice 4 fully wired with MediaBlock construction + materializeCodexEventMedia + side-channel emit.',
    },
  },
  // No canonical MCP-side prompt — the image-gen MCP relies on tool
  // description + co-registered media MCP. We use the Native side's
  // MEDIA_SYSTEM_PROMPT as the closest available canonical.
  systemPromptFragment: MEDIA_SYSTEM_PROMPT,
  toolResultShape: 'media',
  canonicalEventTypes: ['tool_started', 'tool_completed'],
  uiRenderPath: 'SSE tool_result.media → useSSEStream → SSECallbacks.onToolResult → MediaPreview (src/components/chat/MediaPreview.tsx)',
};

const mediaImport: CapabilityContract = {
  id: 'media_import',
  displayName: 'Import local file into media library',
  status: 'live',
  toolNames: ['codepilot_import_media'],
  exposure: {
    claudecode_sdk: {
      kind: 'unsupported',
      notes: 'No MCP equivalent today — the SDK runtime path imports via direct tool-result text matching, no canonical MCP factory exists. Tech-debt: ship a media-import MCP server in parallel with the others.',
    },
    native: {
      kind: 'ai_sdk_tool',
      module: 'src/lib/builtin-tools/media.ts',
      factory: 'createMediaTools (codepilot_import_media key)',
    },
    codex_proxy: {
      kind: 'bridge_executable',
      module: 'src/lib/codex/proxy/builtin-bridge.ts',
      factory: 'buildImportMediaTool',
      notes: 'Slice 4 fix: MediaBlock.type now matches mimeType prefix (image / video / audio).',
    },
  },
  systemPromptFragment: MEDIA_SYSTEM_PROMPT,
  toolResultShape: 'media',
  canonicalEventTypes: ['tool_started', 'tool_completed'],
  uiRenderPath: 'Same as image_generation — tool_result.media → MediaPreview.',
};

const dashboard: CapabilityContract = {
  id: 'dashboard',
  displayName: 'Dashboard pin / list / refresh',
  status: 'deferred',
  deferredReason: 'Codex Runtime bridge not yet implemented. ClaudeCode SDK + Native paths are wired but Codex bridge needs permission round-trip design for write operations (pin / remove / update). Slice 8+ candidate.',
  toolNames: [
    'codepilot_dashboard_pin',
    'codepilot_dashboard_list',
    'codepilot_dashboard_refresh',
    'codepilot_dashboard_update',
    'codepilot_dashboard_remove',
  ],
  exposure: {
    claudecode_sdk: {
      kind: 'mcp_server',
      module: 'src/lib/dashboard-mcp.ts',
      factory: 'createDashboardMcpServer',
    },
    native: {
      kind: 'ai_sdk_tool',
      module: 'src/lib/builtin-tools/dashboard.ts',
      factory: 'createDashboardTools',
    },
    codex_proxy: {
      kind: 'unsupported',
      notes: 'Deferred — see deferredReason. Model attempting to call any codepilot_dashboard_* in Codex Runtime gets ai-sdk "tool not found".',
    },
  },
  systemPromptFragment: DASHBOARD_MCP_SYSTEM_PROMPT,
  toolResultShape: 'text',
  canonicalEventTypes: ['tool_started', 'tool_completed'],
  uiRenderPath: 'Settings → Dashboard panel; widget pinning surfaces via show-widget fence (cross-cutting with widget capability)',
};

const cliTools: CapabilityContract = {
  id: 'cli_tools',
  displayName: 'CLI tools management (list / install / update / remove)',
  status: 'deferred',
  deferredReason: 'Codex Runtime bridge not yet implemented. install/update/remove require permission contracts that Phase 5c slice 7 has not designed for the bridge path. Read-only list could ship first; gated on permission round-trip story.',
  toolNames: [
    'codepilot_cli_tools_list',
    'codepilot_cli_tools_install',
    'codepilot_cli_tools_add',
    'codepilot_cli_tools_remove',
    'codepilot_cli_tools_check_updates',
    'codepilot_cli_tools_update',
  ],
  exposure: {
    claudecode_sdk: {
      kind: 'mcp_server',
      module: 'src/lib/cli-tools-mcp.ts',
      factory: 'createCliToolsMcpServer',
    },
    native: {
      kind: 'ai_sdk_tool',
      module: 'src/lib/builtin-tools/cli-tools.ts',
      factory: 'createCliToolsTools',
    },
    codex_proxy: {
      kind: 'unsupported',
      notes: 'Deferred — permission story not designed for write operations on the Codex bridge path.',
    },
  },
  // CLI tools have no single SYSTEM_PROMPT export — the prompt lives
  // inline in the MCP factory. Leave blank for now; future slice
  // refactor extracts it. Drift test for this capability is therefore
  // a status-only check, not a string comparison.
  systemPromptFragment: '',
  toolResultShape: 'text',
  canonicalEventTypes: ['tool_started', 'tool_completed'],
  uiRenderPath: 'Inline tool results; CLI tools panel in Settings reads the same underlying registry',
};

// ─────────────────────────────────────────────────────────────────────
// Catalog + accessors
// ─────────────────────────────────────────────────────────────────────

/**
 * Ordered list, not a Record, so drift tests can iterate
 * deterministically + add a new capability without worrying about
 * map ordering surprises.
 */
export const HARNESS_CAPABILITIES: readonly CapabilityContract[] = [
  widget,
  memory,
  tasksAndNotify,
  imageGeneration,
  mediaImport,
  dashboard,
  cliTools,
];

export function getCapability(id: string): CapabilityContract | undefined {
  return HARNESS_CAPABILITIES.find((c) => c.id === id);
}

export function liveCapabilities(): readonly CapabilityContract[] {
  return HARNESS_CAPABILITIES.filter((c) => c.status === 'live');
}

export function deferredCapabilities(): readonly CapabilityContract[] {
  return HARNESS_CAPABILITIES.filter((c) => c.status === 'deferred');
}

export function unsupportedCapabilities(): readonly CapabilityContract[] {
  return HARNESS_CAPABILITIES.filter((c) => c.status === 'unsupported');
}
