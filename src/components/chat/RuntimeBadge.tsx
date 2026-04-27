'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/hooks/useTranslation';
import { Badge } from '@/components/ui/badge';
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from '@/components/ui/hover-card';
import type { ConcreteRuntime } from '@/lib/runtime/legacy';
import { computeEffectiveRuntime, type AgentRuntime } from '@/lib/runtime/effective';

interface RuntimeBadgeProps {
  providerId?: string;
}

const LABELS: Record<ConcreteRuntime, { en: string; zh: string }> = {
  native: { en: 'Agent: AI SDK', zh: 'Agent 引擎：AI SDK' },
  'claude-code-sdk': { en: 'Agent: Claude Code', zh: 'Agent 引擎：Claude Code' },
};

export function RuntimeBadge({ providerId }: RuntimeBadgeProps) {
  // Stored preference + the cli_enabled override. Legacy `'auto'` values
  // are coerced inside `computeEffectiveRuntime`. We track both fields
  // because `cli_enabled=false` is the highest-priority override in
  // `registry.ts:resolveRuntime` — without reading it here, the badge
  // would show "Claude Code" while chat actually runs AI SDK whenever
  // a legacy DB has the two fields drifted.
  const [storedRuntime, setStoredRuntime] = useState<string>("claude-code-sdk");
  const [cliEnabled, setCliEnabled] = useState<boolean>(true);
  const [cliConnected, setCliConnected] = useState<boolean>(false);
  const router = useRouter();
  const { t } = useTranslation();
  const isZh = t('nav.chats') === '对话';

  // Resolved runtime mirrors the one used by RuntimePanel +
  // registry.ts. The badge UI treats both ConcreteRuntime and
  // AgentRuntime as the same 2-value union.
  const settingRuntime: AgentRuntime = computeEffectiveRuntime(storedRuntime, cliEnabled, cliConnected);

  // OpenAI models can't use Claude Code SDK — forced to AI SDK regardless
  // of the stored preference + cli_enabled.
  const isNonAnthropicProvider = providerId === 'openai-oauth';
  const effectiveRuntime: ConcreteRuntime = isNonAnthropicProvider ? 'native' : (settingRuntime as ConcreteRuntime);
  // Override flag — true when the user's stored preference says Claude Code
  // but something (provider type, cli_enabled=false, CLI not connected)
  // routed them away. Drives the explanatory hover-card content.
  const isOverridden =
    storedRuntime === "claude-code-sdk" && effectiveRuntime !== "claude-code-sdk";

  useEffect(() => {
    const loadRuntime = async () => {
      try {
        const [settingsRes, statusRes] = await Promise.all([
          fetch('/api/settings/app').catch(() => null),
          fetch('/api/claude-status').catch(() => null),
        ]);
        const settings = settingsRes?.ok ? await settingsRes.json() : null;
        const status = statusRes?.ok ? await statusRes.json() : null;
        const saved = settings?.settings?.agent_runtime ?? "claude-code-sdk";
        const savedCliEnabled = settings?.settings?.cli_enabled !== "false";
        setStoredRuntime(saved);
        setCliEnabled(savedCliEnabled);
        setCliConnected(!!status?.connected);
      } catch {
        /* ignore — keep previous values */
      }
    };
    loadRuntime();
    const handler = () => loadRuntime();
    window.addEventListener('provider-changed', handler);
    return () => window.removeEventListener('provider-changed', handler);
  }, []);

  const label = LABELS[effectiveRuntime];

  // Stored-preference label for the override hover-card body — what the
  // user thinks they picked, before any override applied.
  const storedRuntimeForLabel: ConcreteRuntime =
    storedRuntime === "native" ? "native" : "claude-code-sdk";
  const overrideReason = isNonAnthropicProvider
    ? (isZh
        ? "OpenAI 模型不支持 Claude Code 引擎，已自动切换为 AI SDK"
        : "OpenAI models are not compatible with Claude Code engine, automatically switched to AI SDK")
    : !cliEnabled
      ? (isZh
          ? "Claude Code CLI 已在「设置 → Runtime」关闭，运行时改走 AI SDK"
          : "Claude Code CLI is disabled in Settings → Runtime, routing through AI SDK instead")
      : (isZh
          ? "Claude Code CLI 未检测到，运行时改走 AI SDK"
          : "Claude Code CLI not detected, routing through AI SDK instead");

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <Badge
          variant="outline"
          className="text-[10px] px-1.5 py-0 cursor-pointer hover:bg-accent"
          onClick={() => router.push('/settings#runtime')}
        >
          {isZh ? label.zh : label.en}
        </Badge>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="end" className="w-64 p-3 text-xs space-y-1.5">
        {isOverridden ? (
          <>
            <p>{isZh
              ? `当前实际走 ${LABELS[effectiveRuntime].zh.replace('Agent 引擎：', '')}（保存的偏好是 ${LABELS[storedRuntimeForLabel].zh.replace('Agent 引擎：', '')}）`
              : `Currently routing through ${LABELS[effectiveRuntime].en.replace('Agent: ', '')} (saved preference: ${LABELS[storedRuntimeForLabel].en.replace('Agent: ', '')})`
            }</p>
            <p className="text-muted-foreground">{overrideReason}</p>
          </>
        ) : (
          <p className="text-muted-foreground">
            {effectiveRuntime === 'native'
              ? (isZh ? 'AI SDK：内置多模型引擎，无需 CLI' : 'AI SDK: built-in multi-model engine, no CLI required')
              : (isZh ? 'Claude Code：通过 CLI 子进程驱动' : 'Claude Code: driven by CLI subprocess')
            }
          </p>
        )}
        <p className="text-muted-foreground">
          {isZh ? '点击前往设置' : 'Click to open settings'}
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}
