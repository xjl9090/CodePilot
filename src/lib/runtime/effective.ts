/**
 * Shared runtime resolution helpers — single source of truth for two
 * questions that previously had three different answers across the
 * codebase:
 *
 *   1. Given the stored `agent_runtime` + `cli_enabled` settings, which
 *      runtime is actually selected? (Settings > Runtime panel +
 *      RuntimeBadge in chat header + future Run Cockpit.)
 *
 *   2. Given the runtime-filtered `/api/providers/models?runtime=auto`
 *      result and the user's global default pair (+ optionally
 *      localStorage saved pair), which provider/model would a fresh
 *      chat actually pick at init?
 *
 * Without these helpers the three call sites had drifted:
 *   - `registry.ts:resolveRuntime` correctly applied `cli_enabled=false`
 *     as the highest-priority override
 *   - `RuntimeBadge` ignored `cli_enabled` and just read `agent_runtime`
 *   - `RuntimePanel` originally read `cli_enabled` only into state, not
 *     into the displayed selection
 *   - `chat/page` did `globalPair → providerOnly → savedPair → first`
 *     while `RuntimePanel` did `globalPair → providerOnly → first`
 *     (skipping the saved-pair retry — divergent for users with a
 *     valid global model that happened to be filtered out by runtime
 *     compat)
 *
 * Keep these pure: no `fetch`, no React, no DOM. Each caller fetches
 * their inputs and feeds them in.
 */

import { resolveLegacyRuntimeForDisplay, isConcreteRuntime } from "./legacy";

export type AgentRuntime = "claude-code-sdk" | "native";

/** Engine label used in user-facing strings. Settings page maps it to
 *  zh/en + an optional fallback annotation; just produces the canonical
 *  spelling here. */
export function runtimeDisplayLabel(runtime: AgentRuntime): "Claude Code" | "AI SDK" {
  return runtime === "claude-code-sdk" ? "Claude Code" : "AI SDK";
}

/**
 * Compute the *effective* runtime — what the chat path will actually
 * route to. Mirrors the priority chain in `registry.ts:resolveRuntime`:
 *
 *   1. `cli_enabled === false` → 'native' (highest priority)
 *   2. otherwise → the stored `agent_runtime`
 *
 * `agent_runtime='auto'` (legacy) is coerced to a concrete value via
 * `resolveLegacyRuntimeForDisplay`. Callers that already store concrete
 * values can pass them through unchanged.
 *
 * @param storedAgentRuntime  raw value from `settings.agent_runtime` —
 *   may be `'claude-code-sdk'` / `'native'` / `'auto'` (legacy) / null.
 * @param cliEnabled  raw value from `settings.cli_enabled`. Stored as
 *   string `'true' | 'false'`; the helper accepts both string and
 *   boolean for caller convenience.
 * @param cliConnected  whether Claude Code CLI is currently detected.
 *   Only used to disambiguate the legacy `'auto'` value; ignored for
 *   concrete inputs.
 */
export function computeEffectiveRuntime(
  storedAgentRuntime: string | null | undefined,
  cliEnabled: boolean | string | null | undefined,
  cliConnected: boolean,
): AgentRuntime {
  // Coerce cli_enabled to boolean. DB stores it as a string `'true' |
  // 'false'`; React state usually has it as a boolean. `null` /
  // `undefined` defaults to enabled (back-compat with rows that predate
  // the column).
  const cliEnabledBool =
    typeof cliEnabled === "boolean"
      ? cliEnabled
      : cliEnabled !== "false";

  // cli_enabled=false is the highest-priority override. Even if the
  // user's stored preference is Claude Code, this short-circuits to AI
  // SDK because the registry won't spawn the CLI subprocess.
  if (!cliEnabledBool) return "native";

  if (isConcreteRuntime(storedAgentRuntime)) {
    return storedAgentRuntime as AgentRuntime;
  }

  // Legacy `'auto'` or `null` — coerce to whichever concrete runtime
  // matches the current CLI state.
  return resolveLegacyRuntimeForDisplay(storedAgentRuntime, cliConnected) as AgentRuntime;
}

// ---------------------------------------------------------------------------
// New-chat default resolver
// ---------------------------------------------------------------------------

export interface ResolvedNewChatDefault {
  providerId: string;
  providerName: string;
  modelValue: string;
  modelLabel: string | null;
}

interface ProviderGroup {
  provider_id: string;
  provider_name: string;
  models: Array<{ value: string; label: string }>;
}

interface NewChatResolveInput {
  /** The runtime-filtered groups from `/api/providers/models?runtime=auto`. */
  groups: ProviderGroup[];
  /** Server-suggested default provider id (the response's
   *  `default_provider_id` field). Used as a tertiary fallback after
   *  global pair + provider-only fallbacks fail. */
  apiDefaultProviderId?: string;
  /** Global default pair from `/api/providers/options?providerId=__global__`. */
  globalDefaultModel?: string;
  globalDefaultProvider?: string;
  /** Per-tab last-used pair (chat/page reads this from localStorage).
   *  Settings can pass undefined if it wants the system default rather
   *  than the user's last-pick. */
  savedProviderId?: string;
  savedModel?: string;
}

/**
 * Mirror of `chat/page.tsx`'s resolution chain. The same code path
 * Settings uses to predict "what will a new chat use" runs in chat/page
 * to actually pick — so the two surfaces always agree.
 *
 * Resolution order:
 *
 *   1. Global pair both set AND model is present in the (runtime-filtered)
 *      target provider's group → use that pair.
 *   2. Global provider set (but model is unset / filtered out) → use
 *      that provider's first runtime-compatible model.
 *   3. Saved (localStorage) pair, validated against a runtime-compatible
 *      group's models → use that pair.
 *   4. API-suggested default provider id, first model.
 *   5. First compatible group, first model.
 *
 * Returns null when `groups` is empty (no compatible provider at all).
 */
export function resolveNewChatDefault(input: NewChatResolveInput): ResolvedNewChatDefault | null {
  const {
    groups,
    apiDefaultProviderId,
    globalDefaultModel,
    globalDefaultProvider,
    savedProviderId,
    savedModel,
  } = input;

  if (groups.length === 0) return null;

  // 1. Global pair both set + model valid in the filtered group.
  if (globalDefaultModel && globalDefaultProvider) {
    const targetGroup = groups.find((g) => g.provider_id === globalDefaultProvider);
    const modelInGroup = targetGroup?.models.find((m) => m.value === globalDefaultModel);
    if (targetGroup && modelInGroup) {
      return {
        providerId: targetGroup.provider_id,
        providerName: targetGroup.provider_name,
        modelValue: modelInGroup.value,
        modelLabel: modelInGroup.label,
      };
    }
    // Global model was set but is missing from the runtime-filtered group
    // (most likely the user's chosen model is incompatible with the
    // currently-effective runtime). Fall through to the saved/first
    // chain — `chat/page.tsx` does the same.
  }

  // 2. Provider set, but model unset.
  if (globalDefaultProvider && !globalDefaultModel) {
    const targetGroup = groups.find((g) => g.provider_id === globalDefaultProvider);
    if (targetGroup?.models?.length) {
      const first = targetGroup.models[0];
      return {
        providerId: targetGroup.provider_id,
        providerName: targetGroup.provider_name,
        modelValue: first.value,
        modelLabel: first.label,
      };
    }
  }

  // 3. Saved (localStorage) pair, validated.
  if (savedProviderId) {
    const savedGroup = groups.find((g) => g.provider_id === savedProviderId);
    if (savedGroup) {
      const savedModelInGroup = savedModel
        ? savedGroup.models.find((m) => m.value === savedModel)
        : undefined;
      if (savedModelInGroup) {
        return {
          providerId: savedGroup.provider_id,
          providerName: savedGroup.provider_name,
          modelValue: savedModelInGroup.value,
          modelLabel: savedModelInGroup.label,
        };
      }
      if (savedGroup.models?.length) {
        const first = savedGroup.models[0];
        return {
          providerId: savedGroup.provider_id,
          providerName: savedGroup.provider_name,
          modelValue: first.value,
          modelLabel: first.label,
        };
      }
    }
  }

  // 4. API-suggested default + 5. first compatible group.
  const apiDefault = apiDefaultProviderId
    ? groups.find((g) => g.provider_id === apiDefaultProviderId)
    : undefined;
  const fallbackGroup = apiDefault ?? groups[0];
  if (!fallbackGroup) return null;

  const firstModel = fallbackGroup.models[0];
  return {
    providerId: fallbackGroup.provider_id,
    providerName: fallbackGroup.provider_name,
    modelValue: firstModel?.value ?? "",
    modelLabel: firstModel?.label ?? null,
  };
}
