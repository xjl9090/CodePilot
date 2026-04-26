/**
 * chat-runtime — single source for "which runtime category does the
 * current chat session map to" — expressed in the same vocabulary as
 * the model-layer Runtime Compat flags (`claude_code` / `codepilot_runtime`).
 *
 * Why this exists separately from `runtime/registry`:
 *   `runtime/registry` returns the concrete agent runtime id used to
 *   spawn the SDK subprocess (`'claude-code-sdk'` / `'native'`). The chat
 *   picker / Models page / provider-resolver want a label that matches
 *   `ModelRuntimeCompat`'s `claude_code_compatible` / `codepilot_runtime_compatible`
 *   flags so filtering reads naturally. This module is the translation
 *   layer; everything else uses these labels.
 *
 * Consumers:
 *   - `/api/providers/models?runtime=auto`  — server resolves + filters
 *   - `provider-resolver.resolveProvider({ runtime })` — gates default-model
 *     selection alongside the existing hidden-id guard
 *   - `useProviderModels({ runtime: 'auto' })` — chat picker hook passes
 *     'auto' through and lets the server decide
 */

import { resolveRuntime } from './runtime/registry';

/** Two-state chat-side runtime label, aligned with ModelRuntimeCompat flags. */
export type ChatRuntime = 'claude_code' | 'codepilot_runtime';

/** Wire form for HTTP query params — adds 'auto' (server resolves). */
export type ChatRuntimeParam = ChatRuntime | 'auto';

/** Type guard for parsing untrusted query strings. */
export function isChatRuntimeParam(v: unknown): v is ChatRuntimeParam {
  return v === 'claude_code' || v === 'codepilot_runtime' || v === 'auto';
}

/**
 * Server-side: read `agent_runtime` setting + CLI binary availability via
 * the runtime registry, then map the concrete runtime to a chat-side label.
 *
 * Same resolution chain as `streamClaude` in `claude-client.ts`, so the
 * picker / resolver agree with what actually spawns.
 */
export function getActiveChatRuntime(): ChatRuntime {
  const concrete = resolveRuntime();
  return concrete.id === 'claude-code-sdk' ? 'claude_code' : 'codepilot_runtime';
}

/**
 * Resolve a query-string runtime to a concrete `ChatRuntime`. Pass-through
 * for explicit values; `'auto'` triggers server-side resolution.
 */
export function resolveChatRuntimeParam(param: ChatRuntimeParam): ChatRuntime {
  return param === 'auto' ? getActiveChatRuntime() : param;
}
