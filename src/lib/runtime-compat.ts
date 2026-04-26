/**
 * Runtime Compatibility Matrix — single source of truth.
 *
 * Every consumer (Provider Card badges, Models page filter+badges, chat
 * picker, provider-resolver) must call into here so the labels and gates
 * stay consistent. The matrix has two layers:
 *
 *   - Provider layer: one of `ProviderRuntimeCompat` per provider record.
 *   - Model layer: a bag of capability flags per `ModelRuntimeCompat`.
 *
 * Heuristics (deliberately simple — explicit list rather than inference):
 *   image-image protocols                        → media_only
 *   anthropic-official / bedrock / vertex preset → claude_code_ready
 *   anthropic protocol w/ any other preset       → claude_code_experimental
 *   openrouter / openai-compatible / google chat → codepilot_only
 *   no matched preset                            → unknown
 */
import type { ApiProvider, ProviderRuntimeCompat, ModelRuntimeCompat } from '@/types';
import { findMatchingPresetForRecord, type VendorPreset } from '@/lib/provider-catalog';

export interface ProviderCompatRecord {
  provider_type: string;
  base_url: string;
}

const CLAUDE_CODE_READY_PRESETS = new Set(['anthropic-official', 'bedrock', 'vertex']);

export function getProviderCompat(record: ProviderCompatRecord): ProviderRuntimeCompat {
  // Image protocols short-circuit — never participate in chat-side runtimes.
  if (record.provider_type === 'gemini-image' || record.provider_type === 'openai-image') {
    return 'media_only';
  }
  const preset: VendorPreset | undefined = findMatchingPresetForRecord(record);
  if (!preset) return 'unknown';
  if (CLAUDE_CODE_READY_PRESETS.has(preset.key)) return 'claude_code_ready';
  if (preset.protocol === 'anthropic') return 'claude_code_experimental';
  if (preset.protocol === 'openrouter'
      || preset.protocol === 'openai-compatible'
      || preset.protocol === 'google') {
    return 'codepilot_only';
  }
  return 'unknown';
}

/** Convenience for callers holding a full `ApiProvider`. */
export function getProviderCompatFromApi(provider: ApiProvider): ProviderRuntimeCompat {
  return getProviderCompat({ provider_type: provider.provider_type, base_url: provider.base_url });
}

/**
 * Model-layer compat. We don't try to introspect every upstream model —
 * we project from provider compat + model id heuristics + any catalog
 * capability flags the caller passes through.
 */
export function getModelCompat(args: {
  modelId: string;
  upstreamModelId?: string;
  providerCompat: ProviderRuntimeCompat;
  /** Catalog `capabilities` if available. */
  capabilities?: {
    reasoning?: boolean;
    toolUse?: boolean;
    supportsEffort?: boolean;
    supportsAdaptiveThinking?: boolean;
  };
}): ModelRuntimeCompat {
  const { modelId, upstreamModelId, providerCompat, capabilities } = args;

  if (providerCompat === 'media_only') {
    return { media: true };
  }

  const compat: ModelRuntimeCompat = { chat: true };

  // Tool-use defaults to true unless catalog explicitly says otherwise.
  // Most modern chat models carry tools — opting out is the rare case.
  if (capabilities?.toolUse !== false) compat.tool_capable = true;
  if (capabilities?.reasoning || capabilities?.supportsEffort || capabilities?.supportsAdaptiveThinking) {
    compat.thinking_capable = true;
  }

  // Runtime gate. Anthropic-style aliases (sonnet/opus/haiku/claude-*) are
  // first-class for Claude Code regardless of provider; everything else
  // follows provider compat.
  //
  // The `includes('claude-')` branch covers OpenRouter / relay path forms
  // like `anthropic/claude-3-opus` or `claude-sonnet-4-6@org`. Pure
  // `startsWith` would miss those, leaving Anthropic models on aggregator
  // providers wrongly gated out of the Claude Code runtime even though
  // those aggregators do route to the Anthropic API. False-positive risk
  // (a custom model with `-claude-` in its name) is acceptable given the
  // alternative — silently hiding Anthropic models from Claude Code users.
  const id = (modelId || '').toLowerCase();
  const upstream = (upstreamModelId || '').toLowerCase();
  const looksClaudeAlias = id === 'sonnet' || id === 'opus' || id === 'haiku'
    || id.startsWith('claude-') || id.includes('/claude-')
    || upstream.startsWith('claude-') || upstream.includes('/claude-');

  switch (providerCompat) {
    case 'claude_code_ready':
      // Anthropic official / Bedrock / Vertex — `@ai-sdk/anthropic` can also
      // talk to these directly without the Claude Code subprocess, so the
      // model is reachable from CodePilot Runtime too. Marking both lets a
      // user on Native runtime configure only Anthropic and still see models.
      compat.claude_code_compatible = true;
      compat.codepilot_runtime_compatible = true;
      break;
    case 'claude_code_experimental':
      // Anthropic-compat brand presets (Kimi / GLM / MiniMax / etc.) — many
      // are `sdkProxyOnly` and can only be reached via the Claude Code
      // subprocess wire format. Group-layer filtering enforces the
      // sdkProxyOnly constraint; at the model layer we conservatively flag
      // claude_code only so picker filtering doesn't silently let CodePilot
      // Runtime route to a proxy that won't accept its requests.
      compat.claude_code_compatible = true;
      break;
    case 'codepilot_only':
      compat.codepilot_runtime_compatible = true;
      // Some OpenRouter / relay surfaces also expose Claude through their
      // own SDK; mark Claude-alias rows as Claude-Code-compatible too so
      // they don't get hidden when the user is on the Claude runtime.
      if (looksClaudeAlias) compat.claude_code_compatible = true;
      break;
    case 'unknown':
      // We don't know the right answer — let the user verify. Both
      // runtimes keep the model visible until they hide it explicitly.
      compat.claude_code_compatible = true;
      compat.codepilot_runtime_compatible = true;
      break;
  }

  return compat;
}

/**
 * Display labels — keeps wording consistent across Provider Card, Models
 * page filter, and any future telemetry. UI calls these directly so a
 * future copy change touches one place.
 */
export function compatLabel(compat: ProviderRuntimeCompat, isZh: boolean): string {
  switch (compat) {
    case 'claude_code_ready':        return isZh ? 'Claude Code 直连' : 'Claude Code direct';
    case 'claude_code_experimental': return isZh ? 'Claude Code 兼容' : 'Claude Code compat';
    case 'codepilot_only':           return isZh ? 'OpenAI 兼容' : 'OpenAI compat';
    case 'media_only':               return isZh ? '图片生成' : 'Image gen';
    case 'unknown':                  return isZh ? '需验证' : 'Needs verification';
  }
}

/** Tooltip-length explanation — used on hover and in filter help. */
export function compatTooltip(compat: ProviderRuntimeCompat, isZh: boolean): string {
  switch (compat) {
    case 'claude_code_ready':
      return isZh
        ? '官方 Anthropic API / Bedrock / Vertex，Claude Code 直接接入，工具 / thinking 完整支持'
        : 'Official Anthropic API / Bedrock / Vertex — Claude Code talks to it directly, full tool + thinking support';
    case 'claude_code_experimental':
      return isZh
        ? 'Anthropic 兼容第三方网关，可在 Claude Code 中使用，但工具调用 / thinking / 模型别名取决于供应商实现'
        : 'Anthropic-compatible third-party gateway — works through Claude Code, but tool / thinking / aliases depend on the vendor';
    case 'codepilot_only':
      return isZh
        ? 'OpenAI 兼容协议，CodePilot 自己的聊天路径会处理它；不进入 Claude Code 流程'
        : 'OpenAI-compatible protocol — handled by CodePilot\'s own chat path, not routed through Claude Code';
    case 'media_only':
      return isZh
        ? '图片生成服务，只用于媒体创作功能，不出现在聊天模型选择器'
        : 'Image-generation service — used by media features only, never appears in chat pickers';
    case 'unknown':
      return isZh
        ? '自定义地址或未识别的预设，是否兼容 Claude Code 取决于该网关实现，建议测试连接后再启用关键模型'
        : 'Custom URL or unrecognized preset — Claude Code compatibility depends on the gateway, test before relying on it';
  }
}

/** Tone for badges — matches the design system status palette. */
export function compatTone(compat: ProviderRuntimeCompat): string {
  switch (compat) {
    case 'claude_code_ready':        return 'bg-status-success-muted text-status-success-foreground';
    case 'claude_code_experimental': return 'bg-status-warning-muted text-status-warning-foreground';
    case 'codepilot_only':           return 'bg-primary/10 text-primary';
    case 'media_only':               return 'bg-muted text-muted-foreground';
    case 'unknown':                  return 'bg-muted text-muted-foreground';
  }
}
