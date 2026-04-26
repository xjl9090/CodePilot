import { NextRequest, NextResponse } from 'next/server';
import { getAllProviders, getDefaultProviderId, setDefaultProviderId, getProvider, getAllModelsForProvider, getSetting } from '@/lib/db';
import { getContextWindow } from '@/lib/model-context';
import { getDefaultModelsForProvider, getEffectiveProviderProtocol, findPresetForLegacy } from '@/lib/provider-catalog';
import type { Protocol } from '@/lib/provider-catalog';
import type { ErrorResponse, ProviderModelGroup } from '@/types';
import { getOAuthStatus } from '@/lib/openai-oauth-manager';
import { getProviderCompat, getModelCompat } from '@/lib/runtime-compat';
import { isChatRuntimeParam, resolveChatRuntimeParam, type ChatRuntime } from '@/lib/chat-runtime';

// OpenAI models available through ChatGPT Plus/Pro OAuth (Codex API)
// Reasoning effort defaults to 'medium' server-side (not user-configurable)
const OPENAI_OAUTH_MODELS = [
  { value: 'gpt-5.4', label: 'GPT-5.4' },
  { value: 'gpt-5.4-mini', label: 'GPT-5.4-Mini' },
  { value: 'gpt-5.3-codex', label: 'GPT-5.3-Codex' },
  { value: 'gpt-5.3-codex-spark', label: 'GPT-5.3-Codex-Spark' },
];

// Default Claude model options (for the built-in 'env' provider).
// Capability metadata ensures `xhigh` appears in the effort dropdown even
// before SDK capability discovery populates getCachedModels('env').
// upstreamModelId mirrors provider-resolver.ts's envModels table so the
// chat-page context indicator can resolve alias-specific windows
// (env Opus alias = claude-opus-4-7 = 1M, vs Bedrock/Vertex opus = 200K).
const DEFAULT_MODELS = [
  {
    value: 'sonnet',
    label: 'Sonnet 4.6',
    upstreamModelId: 'claude-sonnet-4-20250514',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'max'],
    supportsAdaptiveThinking: true,
  },
  {
    value: 'opus',
    label: 'Opus 4.7',
    upstreamModelId: 'claude-opus-4-7',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsAdaptiveThinking: true,
  },
  {
    value: 'haiku',
    label: 'Haiku 4.5',
    upstreamModelId: 'claude-haiku-4-5-20251001',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high'],
  },
];

// Short alias → upstream ID map for cached SDK models that may only
// return bare aliases (sonnet/opus/haiku). Mirrors the env provider's
// alias table in provider-resolver.ts.
const ENV_ALIAS_TO_UPSTREAM: Record<string, string> = {
  sonnet: 'claude-sonnet-4-20250514',
  opus: 'claude-opus-4-7',
  haiku: 'claude-haiku-4-5-20251001',
};

interface ModelEntry {
  value: string;
  label: string;
  upstreamModelId?: string;
  capabilities?: Record<string, unknown>;
  variants?: Record<string, unknown>;
}

/**
 * Deduplicate models: if multiple aliases map to the same label, keep only the first one.
 */
function deduplicateModels(models: ModelEntry[]): ModelEntry[] {
  const seen = new Set<string>();
  const result: ModelEntry[] = [];
  for (const m of models) {
    if (!seen.has(m.label)) {
      seen.add(m.label);
      result.push(m);
    }
  }
  return result;
}

/** Media-only provider protocols — skip in chat model selector */
const MEDIA_PROTOCOLS = new Set<string>(['gemini-image', 'openai-image']);
const MEDIA_PROVIDER_TYPES = new Set(['gemini-image', 'openai-image']);

export async function GET(request: NextRequest) {
  try {
    // Optional `?runtime=` query — when present, every group has its model
    // list filtered down to entries compatible with the specified runtime.
    // Accepts `claude_code` / `codepilot_runtime` (explicit) or `auto` (let
    // the server resolve via `agent_runtime` setting + CLI binary check).
    // No param at all = no filtering — used by Settings > Providers' global
    // default-model selector that needs to see the full catalog.
    const runtimeParam = request.nextUrl.searchParams.get('runtime');
    const runtimeFilter: ChatRuntime | null = (runtimeParam && isChatRuntimeParam(runtimeParam))
      ? resolveChatRuntimeParam(runtimeParam)
      : null;

    const providers = getAllProviders();
    const groups: ProviderModelGroup[] = [];

    // Show the built-in Claude Code provider group unless user explicitly chose AI SDK only.
    // Auto and Claude Code modes both need Claude Code models visible.
    const runtimeSetting = getSetting('agent_runtime') || 'auto';
    const cliEnabled = runtimeSetting !== 'native';

    if (cliEnabled) {
      // Mark as sdkProxyOnly if no direct API credentials exist — in that case
      // the env provider only works through the Claude Code SDK subprocess.
      const envHasDirectCredentials = !!(
        process.env.ANTHROPIC_API_KEY ||
        process.env.ANTHROPIC_AUTH_TOKEN ||
        getSetting('anthropic_auth_token')
      );
      groups.push({
        provider_id: 'env',
        provider_name: 'Claude Code',
        provider_type: 'anthropic',
        compat: 'claude_code_ready',
        ...(!envHasDirectCredentials ? { sdkProxyOnly: true } : {}),
        // Use upstreamModelId for context-window lookup so the bare `opus`
        // alias doesn't get clamped to the 200K Bedrock/Vertex value.
        models: DEFAULT_MODELS.map(m => {
          const cw = getContextWindow(m.value, { upstream: m.upstreamModelId });
          return cw != null ? { ...m, contextWindow: cw } : m;
        }),
      });
    }

    // If SDK has discovered models, use them for the env group
    const envGroup = groups.find(g => g.provider_id === 'env');
    if (envGroup) {
      try {
        const { getCachedModels } = await import('@/lib/agent-sdk-capabilities');
        const sdkModels = getCachedModels('env');
        if (sdkModels.length > 0) {
          envGroup.models = sdkModels.map(m => {
            // SDK sometimes returns short aliases (e.g. 'opus') — map to
            // the concrete upstream so context window and downstream
            // sanitizer checks agree with the env provider's resolver.
            const upstream = ENV_ALIAS_TO_UPSTREAM[m.value];
            const cw = getContextWindow(m.value, { upstream });
            return {
              value: m.value,
              label: m.displayName,
              description: m.description,
              supportsEffort: m.supportsEffort,
              supportedEffortLevels: m.supportedEffortLevels,
              supportsAdaptiveThinking: m.supportsAdaptiveThinking,
              ...(upstream ? { upstreamModelId: upstream } : {}),
              ...(cw != null ? { contextWindow: cw } : {}),
            };
          });
        }
      } catch {
        // SDK capabilities not available, keep defaults
      }
    }

    // Build a group for each configured provider
    for (const provider of providers) {
      // Determine protocol — use new field if present, otherwise infer from legacy
      const protocol: Protocol = getEffectiveProviderProtocol(
        provider.provider_type,
        provider.protocol,
        provider.base_url,
      );

      // Skip media-only providers in chat model selector
      if (MEDIA_PROTOCOLS.has(protocol) || MEDIA_PROVIDER_TYPES.has(provider.provider_type)) continue;

      // Get models: DB provider_models first, then catalog defaults, then env fallback
      let rawModels: ModelEntry[];

      // 1) Read provider_models — the *enabled* rows feed the picker, but we
      //    also need the *full* row set as a suppression list so disabled
      //    rows aren't re-added by the catalog fallback below.
      const dbModels: { value: string; label: string; upstreamModelId?: string; capabilities?: Record<string, unknown>; variants?: Record<string, unknown> }[] = [];
      const dbHiddenIds = new Set<string>();
      let dbHasAnyRow = false;
      try {
        const provModelsAll = getAllModelsForProvider(provider.id);
        dbHasAnyRow = provModelsAll.length > 0;
        for (const m of provModelsAll) {
          if (m.enabled === 0) {
            dbHiddenIds.add(m.model_id);
            continue;
          }
          let caps: Record<string, unknown> | undefined;
          let vars: Record<string, unknown> | undefined;
          try { const p = JSON.parse(m.capabilities_json || '{}'); if (Object.keys(p).length > 0) caps = p; } catch { /* ignore */ }
          try { const v = JSON.parse(m.variants_json || '{}'); if (Object.keys(v).length > 0) vars = v; } catch { /* ignore */ }
          dbModels.push({
            value: m.model_id,
            label: m.display_name || m.model_id,
            upstreamModelId: m.upstream_model_id || undefined,
            capabilities: caps,
            variants: vars,
          });
        }
      } catch { /* table may not exist in old DBs */ }

      // 2) Catalog defaults — but skip any id the user has explicitly hidden
      //    in the Models page, otherwise the picker silently re-adds them.
      const catalogModels = getDefaultModelsForProvider(protocol, provider.base_url, provider.provider_type);
      const catalogRaw = catalogModels
        .filter(m => !dbHiddenIds.has(m.modelId))
        .map(m => ({
          value: m.modelId,
          label: m.displayName,
          upstreamModelId: m.upstreamModelId,
          capabilities: m.capabilities as Record<string, unknown> | undefined,
        }));

      if (dbHasAnyRow) {
        // User has materialized rows for this provider — DB enabled set is
        // authoritative. Only catalog ids that are NEITHER in the DB nor
        // hidden show through (covers brand-new catalog additions the user
        // hasn't seen yet).
        const dbIds = new Set(dbModels.map(m => m.value));
        rawModels = [...dbModels, ...catalogRaw.filter(m => !dbIds.has(m.value))];
      } else {
        rawModels = [...catalogRaw];
      }

      // Inject models from role_models_json into the list if not already
      // present — but skip ids the user has explicitly hidden in Settings >
      // Models. Without this guard, hiding a role/default model on the
      // Models page wouldn't actually remove it from the chat picker.
      try {
        const rm = JSON.parse(provider.role_models_json || '{}');
        const roleEntries: { id: string; role: string }[] = [];
        for (const role of ['default', 'reasoning', 'small', 'haiku', 'sonnet', 'opus'] as const) {
          if (rm[role] && !roleEntries.some(e => e.id === rm[role])) {
            roleEntries.push({ id: rm[role], role });
          }
        }
        for (const entry of roleEntries) {
          if (dbHiddenIds.has(entry.id)) continue;
          if (!rawModels.some(m => m.value === entry.id || m.upstreamModelId === entry.id)) {
            const label = entry.role === 'default' ? entry.id : `${entry.id} (${entry.role})`;
            rawModels.unshift({ value: entry.id, label });
          }
        }
      } catch { /* ignore */ }

      // Legacy: inject ANTHROPIC_MODEL from env overrides — same hidden-set
      // guard, same reasoning.
      try {
        const envOverrides = provider.env_overrides_json || provider.extra_env || '{}';
        const envObj = JSON.parse(envOverrides);
        const envModelId = envObj.ANTHROPIC_MODEL;
        if (envModelId && !dbHiddenIds.has(envModelId) && !rawModels.some(m => m.value === envModelId || m.upstreamModelId === envModelId)) {
          rawModels.unshift({ value: envModelId, label: envModelId });
        }
      } catch { /* ignore */ }

      const models = deduplicateModels(rawModels).map(m => {
        // Pass upstream so alias windows resolve per provider:
        // first-party opus → 1M (Opus 4.7) vs Bedrock/Vertex opus → 200K
        // (Opus 4.6). The model API is per-provider, so the correct
        // upstream is whatever catalog declared for this provider group.
        const cw = getContextWindow(m.value, { upstream: m.upstreamModelId });
        // Lift effort/thinking capability flags from nested `capabilities` to top-level
        // so MessageInput / EffortSelectorDropdown can read them without unwrapping.
        const caps = (m.capabilities || {}) as Record<string, unknown>;
        const effortLift = {
          ...(caps.supportsEffort != null ? { supportsEffort: caps.supportsEffort as boolean } : {}),
          ...(caps.supportedEffortLevels != null ? { supportedEffortLevels: caps.supportedEffortLevels as string[] } : {}),
          ...(caps.supportsAdaptiveThinking != null ? { supportsAdaptiveThinking: caps.supportsAdaptiveThinking as boolean } : {}),
        };
        return {
          ...m,
          ...effortLift,
          ...(cw != null ? { contextWindow: cw } : {}),
        };
      });

      // Detect SDK-proxy-only providers via preset match
      const preset = findPresetForLegacy(provider.base_url, provider.provider_type, protocol);
      const sdkProxyOnly = preset?.sdkProxyOnly === true;

      // total_count is the user-visible "synced model count" on Provider cards.
      // Counts everything in provider_models for this provider (enabled +
      // hidden), or the catalog size when the table is empty (e.g. a fresh
      // catalog-only provider whose seed already ran for the picker).
      const totalCount = dbHasAnyRow
        ? (dbModels.length + dbHiddenIds.size)
        : catalogModels.length;

      groups.push({
        provider_id: provider.id,
        provider_name: provider.name,
        provider_type: provider.provider_type,
        ...(sdkProxyOnly ? { sdkProxyOnly: true } : {}),
        total_count: totalCount,
        compat: getProviderCompat({
          provider_type: provider.provider_type,
          base_url: provider.base_url,
        }),
        models,
      });
    }

    // Add OpenAI OAuth virtual provider when authenticated
    try {
      const oauthStatus = getOAuthStatus();
      if (oauthStatus.authenticated) {
        groups.push({
          provider_id: 'openai-oauth',
          provider_name: `OpenAI${oauthStatus.plan ? ` (${oauthStatus.plan})` : ''}`,
          provider_type: 'openai-oauth',
          compat: 'codepilot_only',
          models: OPENAI_OAUTH_MODELS,
        });
      }
    } catch { /* OpenAI OAuth module not available */ }

    // Apply runtime filter — only when caller asked for it. Two layers:
    //   1. Group layer: drop sdkProxyOnly groups in codepilot_runtime mode
    //      (their wire format requires the SDK subprocess), and never let
    //      media_only through (also caught at row layer below).
    //   2. Row layer: getModelCompat per model — drop media flags, drop
    //      rows whose runtime flag isn't set. Keeps the alias lift behavior
    //      (claude-* on codepilot_only providers stays claude_code_compatible).
    //
    // Empty groups are kept (`models: []`) so the picker can still surface
    // the provider chip — caller decides whether to render an empty section.
    // This matches `design.md` §"Filter precedence": hidden gates win first
    // (already applied above), runtime filter narrows next, media never
    // reaches chat surfaces.
    let outGroups = groups;
    if (runtimeFilter) {
      outGroups = groups.map(g => {
        const providerCompat = g.compat ?? 'unknown';
        if (providerCompat === 'media_only') return { ...g, models: [] };
        // sdkProxyOnly providers (MiniMax / Xiaomi-MiMo / some Code Plan
        // brands) only accept the SDK wire format — CodePilot Runtime can't
        // route to them, so the entire group disappears in that mode.
        if (runtimeFilter === 'codepilot_runtime' && g.sdkProxyOnly) {
          return { ...g, models: [] };
        }
        const filteredModels = g.models.filter(m => {
          const cap = getModelCompat({
            modelId: m.value,
            upstreamModelId: m.upstreamModelId,
            providerCompat,
            capabilities: m.capabilities as Parameters<typeof getModelCompat>[0]['capabilities'],
          });
          if (cap.media) return false;
          return runtimeFilter === 'claude_code'
            ? !!cap.claude_code_compatible
            : !!cap.codepilot_runtime_compatible;
        });
        return { ...g, models: filteredModels };
      });
    }

    // Determine default provider — auto-heal stale references on read
    let defaultProviderId = getDefaultProviderId();
    if (defaultProviderId && !getProvider(defaultProviderId)) {
      // Stale default (provider was deleted). Fix it now.
      const firstValid = outGroups.find(g => g.provider_id !== 'env');
      defaultProviderId = firstValid?.provider_id || '';
      setDefaultProviderId(defaultProviderId);
    }
    defaultProviderId = defaultProviderId || outGroups[0]?.provider_id || '';

    return NextResponse.json({
      groups: outGroups,
      default_provider_id: defaultProviderId,
    });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to get models' },
      { status: 500 }
    );
  }
}
