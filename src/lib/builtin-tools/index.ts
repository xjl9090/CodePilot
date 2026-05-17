/**
 * builtin-tools/index.ts — Registry of built-in MCP-equivalent tools for Native Runtime.
 *
 * These tools provide the same capabilities as the 7 built-in MCP servers
 * (notification, memory, dashboard, cli-tools, media, image-gen, widget)
 * but packaged as Vercel AI SDK tools for the Native Runtime.
 *
 * Phase 5d Phase 2 slice 2d (2026-05-17) — `getBuiltinTools` now
 * delegates system-prompt assembly to the Harness Context Compiler.
 * Per-group `systemPrompt` fields stay declared (they document the
 * canonical fragment for that group) but are NOT directly returned
 * to callers; the compiler produces the final ordered + de-duplicated
 * prompt string from the capability catalog. This keeps Native
 * adapter "only adapt compiler output" — gating decisions stay in
 * this file (workspace / keyword / always), prompt text comes from
 * the compiler.
 *
 * Migration status:
 * ✅ notification (4 tools) — fully migrated
 * ✅ memory-search (3 tools) — fully migrated
 * ✅ dashboard (5 tools) — fully migrated
 * ✅ media (2 tools: import + generate) — fully migrated
 * ✅ widget-guidelines (1 tool) — fully migrated
 * ✅ cli-tools (6 tools) — fully migrated
 */

import type { ToolSet } from 'ai';
import { compileContext } from '@/lib/harness/context-compiler';

export interface BuiltinToolGroup {
  name: string;
  systemPrompt: string;
  condition: 'always' | 'workspace' | { keywords: RegExp };
  tools: ToolSet;
}

export interface GetBuiltinToolsOptions {
  workspacePath?: string;
  prompt?: string;
  /**
   * Originating chat session id — plumbed through to
   * `createNotificationTools` so codepilot_schedule_task knows which
   * chat session the task is being created from. Mirrors the SDK
   * MCP variant in claude-client.ts.
   */
  sessionId?: string;
}

/**
 * Map a builtin-tool group `name` to the capability ids from
 * `src/lib/harness/capability-contract.ts`. Drives the
 * `enabledCapabilities` set the compiler consumes when this function
 * decides a group is active.
 *
 * Returns an array because one group can mount tools that belong to
 * multiple capabilities (e.g. `codepilot-media` mounts both
 * `codepilot_import_media` → media_import AND
 * `codepilot_generate_image` → image_generation). The compiler then
 * emits fragments + tool descriptors for every returned id.
 *
 * Empty array = the group is not capability-tracked yet (Phase 4
 * candidates like session-search / ask-user-question whose prompts
 * haven't earned a capability contract entry).
 */
function capabilityIdsForGroup(groupName: string): readonly string[] {
  switch (groupName) {
    case 'codepilot-notify':
      return ['tasks_and_notify'];
    case 'codepilot-memory':
      return ['memory'];
    case 'codepilot-widget-guidelines':
      return ['widget'];
    case 'codepilot-dashboard':
      return ['dashboard'];
    case 'codepilot-media':
      // Phase 5d Phase 2 P1 fix (2026-05-17) — pre-fix this returned
      // only 'media_import' but the underlying `createMediaTools()`
      // mounts BOTH the import tool AND `codepilot_generate_image`.
      // That meant the compiler's enabledCapabilities / toolDescriptors
      // / future runtimeHints.native.toolSetKeys never knew about
      // image_generation on the Native runtime even though the tool
      // was registered and callable. Returning both keeps the
      // compiler contract aligned with what Native actually exposes.
      return ['media_import', 'image_generation'];
    case 'codepilot-cli-tools':
      return ['cli_tools'];
    case 'codepilot-session-search':
    case 'codepilot-ask-user':
      // Native-only groups without a capability contract entry yet.
      // Their per-group `systemPrompt` was never canonicalised; the
      // caller (getBuiltinTools) routes them into `nonCapabilityPrompts`
      // so they don't disappear during Phase 2.
      return [];
    default:
      return [];
  }
}

/**
 * Get all built-in tools that should be registered for the current
 * context. Returns:
 *   - `tools`: the merged AI SDK ToolSet from gated-in groups
 *   - `systemPrompts`: legacy slot kept for back-compat; index 0 is
 *     the compiler-produced canonical prompt for capability-tracked
 *     groups; additional entries (if any) are non-capability groups
 *     whose prompt isn't in the harness contract yet (e.g. session-
 *     search, ask-user-question).
 *
 * Native Runtime callers should treat `systemPrompts` as a flat
 * list to concatenate — same shape as pre-Phase-5d.
 */
export function getBuiltinTools(
  options: GetBuiltinToolsOptions,
): { tools: ToolSet; systemPrompts: string[] } {
  const tools: ToolSet = {};
  const enabledCapabilities = new Set<string>();
  const nonCapabilityPrompts: string[] = [];

  for (const group of getToolGroups(options)) {
    // Check condition (gating logic stays in the caller as the
    // compiler is a pure function and does not read filesystem /
    // keyword regex / mode state).
    if (group.condition === 'always') {
      // Always include
    } else if (group.condition === 'workspace') {
      if (!options.workspacePath) continue;
    } else if (typeof group.condition === 'object' && group.condition.keywords) {
      const text = (options.prompt || '').toLowerCase();
      if (!group.condition.keywords.test(text)) continue;
    }

    Object.assign(tools, group.tools);
    const capIds = capabilityIdsForGroup(group.name);
    if (capIds.length > 0) {
      for (const id of capIds) enabledCapabilities.add(id);
    } else if (group.systemPrompt) {
      // Non-capability group whose prompt hasn't been canonicalised
      // yet (session-search / ask-user-question). Keep its raw
      // systemPrompt in the legacy slot so we don't drop the
      // capability while Phase 4 is pending.
      nonCapabilityPrompts.push(group.systemPrompt);
    }
  }

  // Compiler produces the canonical, ordered, de-duplicated prompt
  // for every capability-tracked group. Result is a single string;
  // we push as `systemPrompts[0]` so the existing caller contract
  // (array of strings → join) keeps working.
  const compiled = compileContext({
    sessionId: options.sessionId || 'native-anonymous',
    workingDirectory: options.workspacePath || undefined,
    runtimeId: 'codepilot_runtime',
    providerId: '',
    model: '',
    userPrompt: options.prompt || '',
    enabledCapabilities,
    tokenBudget: { systemPromptMax: 100_000, contextMax: 200_000 },
  });

  const systemPrompts: string[] = [];
  if (compiled.systemPromptText.length > 0) systemPrompts.push(compiled.systemPromptText);
  systemPrompts.push(...nonCapabilityPrompts);

  return { tools, systemPrompts };
}

function getToolGroups(options: GetBuiltinToolsOptions): BuiltinToolGroup[] {
  const groups: BuiltinToolGroup[] = [];

  // Notification tools — always available. Pass through the run
  // context so codepilot_schedule_task injects origin_session_id +
  // working_directory into /api/tasks/schedule POST body.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createNotificationTools, NOTIFICATION_SYSTEM_PROMPT } = require('./notification');
    groups.push({
      name: 'codepilot-notify',
      systemPrompt: NOTIFICATION_SYSTEM_PROMPT,
      condition: 'always',
      tools: createNotificationTools({
        sessionId: options.sessionId,
        workingDirectory: options.workspacePath,
      }),
    });
  } catch { /* notification module not available */ }

  // Widget guidelines — keyword-gated
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createWidgetGuidelinesTools, WIDGET_SYSTEM_PROMPT } = require('./widget-guidelines');
    groups.push({
      name: 'codepilot-widget-guidelines',
      systemPrompt: WIDGET_SYSTEM_PROMPT,
      condition: 'always',
      tools: createWidgetGuidelinesTools(),
    });
  } catch { /* module not available */ }

  // Dashboard tools — keyword-gated
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createDashboardTools, DASHBOARD_SYSTEM_PROMPT } = require('./dashboard');
    groups.push({
      name: 'codepilot-dashboard',
      systemPrompt: DASHBOARD_SYSTEM_PROMPT,
      condition: 'always',
      tools: createDashboardTools(),
    });
  } catch { /* module not available */ }

  // Media tools — keyword-gated
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createMediaTools, MEDIA_SYSTEM_PROMPT } = require('./media');
    groups.push({
      name: 'codepilot-media',
      systemPrompt: MEDIA_SYSTEM_PROMPT,
      condition: 'always',
      tools: createMediaTools(),
    });
  } catch { /* module not available */ }

  // Memory search tools — workspace-gated
  if (options.workspacePath) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createMemorySearchTools, MEMORY_SEARCH_SYSTEM_PROMPT } = require('./memory-search');
      groups.push({
        name: 'codepilot-memory',
        systemPrompt: MEMORY_SEARCH_SYSTEM_PROMPT,
        condition: 'workspace',
        tools: createMemorySearchTools(options.workspacePath),
      });
    } catch { /* module not available */ }
  }

  // Session history search tool — always available (queries SQLite messages table)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createSessionSearchTools, SESSION_SEARCH_SYSTEM_PROMPT } = require('./session-search');
    groups.push({
      name: 'codepilot-session-search',
      systemPrompt: SESSION_SEARCH_SYSTEM_PROMPT,
      condition: 'always',
      tools: createSessionSearchTools(),
    });
  } catch { /* module not available */ }

  // AskUserQuestion — structured question UI for Native Runtime.
  // SDK Runtime has this built in; Native Runtime needs it as a builtin tool.
  // The tool goes through the permission wrapper which emits permission_request SSE,
  // and the existing AskUserQuestionUI in PermissionPrompt.tsx renders the UI.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createAskUserQuestionTools, ASK_USER_QUESTION_SYSTEM_PROMPT } = require('./ask-user-question');
    groups.push({
      name: 'codepilot-ask-user',
      systemPrompt: ASK_USER_QUESTION_SYSTEM_PROMPT,
      condition: 'always',
      tools: createAskUserQuestionTools(),
    });
  } catch { /* module not available */ }

  // CLI tools — keyword-gated
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createCliToolsTools, CLI_TOOLS_SYSTEM_PROMPT } = require('./cli-tools');
    groups.push({
      name: 'codepilot-cli-tools',
      systemPrompt: CLI_TOOLS_SYSTEM_PROMPT,
      condition: 'always',
      tools: createCliToolsTools(),
    });
  } catch { /* module not available */ }

  return groups;
}
