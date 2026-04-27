"use client";

/**
 * Settings → Runtime
 *
 * The single home for runtime explanation. Folds in everything that used
 * to live under the "Claude CLI" sidebar entry plus a parallel CodePilot
 * Runtime card. Sits at the third tier of the user mental model:
 *
 *   Providers (assets) → Models (exposure) → Runtime (environment)
 *
 * Phase 2B layout, top to bottom:
 *   1. Default-engine selector — which runtime owns the next chat
 *   2. Claude Code Runtime card — status / reason / impact / recovery,
 *      plus model options (thinking / 1M) and the settings.json editor
 *      (expandable advanced section)
 *   3. CodePilot Runtime card — capabilities / permissions / context
 *      (medium granularity, three buckets)
 *   4. Session-level read-only explainer — what a new chat will use
 *   5. Utility: import past chat sessions
 *
 * 2B.6 (`session_events.runtime.selected` minimal write) is deferred to a
 * separate commit — the read-only session-level explainer below derives
 * the same answer client-side from `/api/providers/models?runtime=auto`
 * + `runtime_applied` + the global default pair, so 2B can ship without
 * the persisted event log. Phase 3 Run Cockpit picks it up.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  ArrowClockwise,
  ArrowsClockwise,
  CaretDown,
  CheckCircle,
  Circle,
  Code,
  FloppyDisk,
  Lightning,
  SlidersHorizontal,
  SpinnerGap,
  Warning,
  XCircle,
} from "@/components/ui/icon";
import { useClaudeStatus } from "@/hooks/useClaudeStatus";
import { useTranslation } from "@/hooks/useTranslation";
import {
  resolveLegacyRuntimeForDisplay,
  isConcreteRuntime,
} from "@/lib/runtime/legacy";
import {
  computeEffectiveRuntime,
  resolveNewChatDefault,
  runtimeDisplayLabel,
} from "@/lib/runtime/effective";
import type { TranslationKey } from "@/i18n";
import type { ProviderOptions } from "@/types";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AgentRuntime = "claude-code-sdk" | "native";

/**
 * Five-state runtime status. Each state pairs with reason / impact /
 * recovery so the panel can answer "why is it this way / what does it
 * mean / what do I do about it" without the user reading source.
 */
type RuntimeState =
  | "selected" // currently the default (active for new chats)
  | "available" // ready, not currently default
  | "degraded" // works but with caveats (version mismatch, warnings, etc.)
  | "blocked" // cannot run (CLI missing / login expired)
  | "disabled"; // user explicitly turned off (cli_enabled=false)

interface RuntimeStatusInfo {
  state: RuntimeState;
  reason: string;
  impact: string;
  recovery?: string; // omitted when no recovery is needed
}

// ---------------------------------------------------------------------------
// Status pill (mirrors design.md "Status pill — provider runtime state")
// ---------------------------------------------------------------------------

function RuntimeStatusPill({
  state,
  isZh,
}: {
  state: RuntimeState;
  isZh: boolean;
}) {
  const tone: Record<RuntimeState, string> = {
    selected: "bg-status-success-muted text-status-success-foreground",
    available: "bg-muted text-muted-foreground",
    degraded: "bg-status-warning-muted text-status-warning-foreground",
    blocked: "bg-status-error-muted text-status-error-foreground",
    disabled: "bg-muted text-muted-foreground",
  };
  const dot: Record<RuntimeState, string> = {
    selected: "bg-status-success-foreground",
    available: "bg-muted-foreground",
    degraded: "bg-status-warning-foreground",
    blocked: "bg-status-error-foreground",
    disabled: "bg-muted-foreground",
  };
  const label: Record<RuntimeState, [string, string]> = {
    selected: ["当前默认", "Current default"],
    available: ["可用", "Available"],
    degraded: ["可用但有提示", "Available with warnings"],
    blocked: ["不可用", "Blocked"],
    disabled: ["已关闭", "Disabled"],
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
        tone[state],
      )}
    >
      <span className={cn("size-1.5 rounded-full", dot[state])} />
      {isZh ? label[state][0] : label[state][1]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Reason / impact / recovery block — three labelled rows, render only what
// has content. Reason is mandatory; impact/recovery are conditional.
// ---------------------------------------------------------------------------

function RuntimeStatusExplanation({ info, isZh }: { info: RuntimeStatusInfo; isZh: boolean }) {
  const rows: { label: string; value: string }[] = [
    { label: isZh ? "原因" : "Reason", value: info.reason },
    { label: isZh ? "影响" : "Impact", value: info.impact },
  ];
  if (info.recovery) {
    rows.push({ label: isZh ? "怎么恢复" : "Recovery", value: info.recovery });
  }
  return (
    <div className="rounded-md bg-muted/40 px-3.5 divide-y divide-border/50">
      {rows.map((r) => (
        <div key={r.label} className="py-2.5 flex items-start justify-between gap-3">
          <span className="text-[11px] text-muted-foreground shrink-0">{r.label}</span>
          <span className="text-xs text-foreground/85 text-right">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outer card shell — same border weight + radius as Provider Card so the
// page reads as one family.
// ---------------------------------------------------------------------------

function RuntimeCard({
  name,
  state,
  isZh,
  children,
}: {
  name: string;
  state: RuntimeState;
  isZh: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-card border border-border/50 p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-sm font-semibold leading-tight">{name}</h3>
        <RuntimeStatusPill state={state} isZh={isZh} />
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Engine picker card — large, click-anywhere card used at the page top to
// pick the default runtime. Two cards render side by side; the selected
// one carries a primary-tinted border + ring + bg-tint and a filled check
// indicator in the top-right corner. Unselected stays muted with a hollow
// circle indicator that fills on hover so the affordance is obvious.
// ---------------------------------------------------------------------------

function EnginePickerCard({
  engine: _engine, // kept for future telemetry; not read in render today
  selected,
  onSelect,
  title,
  tagline,
  pitch,
  statusKind,
  statusText,
  isZh,
}: {
  engine: AgentRuntime;
  selected: boolean;
  onSelect: () => void;
  title: string;
  tagline: string;
  pitch: string;
  /** `ok` → success-tone status row; `warning` → warning-tone (e.g. CLI not installed). */
  statusKind: "ok" | "warning";
  statusText: string;
  isZh: boolean;
}) {
  void _engine;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "relative w-full text-left rounded-lg border p-5 flex flex-col gap-3 transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2",
        selected
          ? "border-primary/40 bg-primary/5 ring-1 ring-primary/30 shadow-sm"
          : "border-border/50 bg-card hover:border-border hover:bg-muted/30",
      )}
    >
      {/* Top-right indicator. Filled CheckCircle when selected; hollow Circle
          otherwise with a faint hover boost so the click affordance reads. */}
      <span className="absolute top-4 right-4 text-muted-foreground">
        {selected ? (
          <CheckCircle size={18} weight="fill" className="text-primary" />
        ) : (
          <Circle size={18} className="text-muted-foreground/60" />
        )}
      </span>

      {/* Title block — engine name + small subtitle so the card has a
          micro-headline distinct from the body pitch. */}
      <div className="pr-8">
        <h4 className={cn("text-sm font-semibold", selected ? "text-primary" : "text-foreground")}>
          {title}
        </h4>
        <p className="text-[11px] text-muted-foreground mt-0.5">{tagline}</p>
      </div>

      {/* Pitch text — 2-3 sentences max. Mid-card so it's the visual focus. */}
      <p className="text-xs text-foreground/85 leading-relaxed">{pitch}</p>

      {/* Status row — bottom-anchored. Color-coded at a glance:
            ok      → success-foreground (Claude Code installed / AI SDK ready)
            warning → warning-foreground (CLI missing, would fall back) */}
      <div className="mt-auto flex items-center gap-1.5 text-[11px]">
        {statusKind === "ok" ? (
          <CheckCircle
            size={12}
            weight="fill"
            className="text-status-success-foreground shrink-0"
          />
        ) : (
          <Warning
            size={12}
            weight="fill"
            className="text-status-warning-foreground shrink-0"
          />
        )}
        <span
          className={cn(
            "truncate",
            statusKind === "ok"
              ? "text-status-success-foreground"
              : "text-status-warning-foreground",
          )}
        >
          {statusText}
        </span>
        {/* Right-side reminder — when not selected, hint the click action. */}
        {!selected && (
          <span className="ml-auto text-muted-foreground/70 shrink-0">
            {isZh ? "点击切换" : "Click to switch"}
          </span>
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface SettingsData {
  [key: string]: unknown;
}

const KNOWN_FIELDS = [
  { key: "permissions", label: "Permissions", type: "object" as const },
  { key: "env", label: "Environment Variables", type: "object" as const },
] as const;

export function RuntimePanel() {
  const { t } = useTranslation();
  const isZh = t("nav.chats") === "对话";

  // ── Runtime selection (DB setting) ──
  // `agentRuntime` is the *stored* preference from the DB. The effective
  // runtime that the chat path actually uses is computed below as
  // `effectiveRuntime` — `cli_enabled=false` is the highest-priority
  // override in `lib/runtime/registry.ts:resolveRuntime`, so even if
  // `agent_runtime='claude-code-sdk'` is stored, AI SDK is what runs
  // when CLI is disabled. The picker writes both fields together (via
  // `handleRuntimeChange`), so new state stays consistent; this guard
  // only fires for legacy DBs where the two fields drifted apart.
  const [agentRuntime, setAgentRuntime] = useState<AgentRuntime>("claude-code-sdk");
  const [cliEnabled, setCliEnabled] = useState(true);

  // ── Claude Code status (subprocess detection) ──
  const { status: claudeStatus, refresh: refreshStatus, invalidateAndRefresh } = useClaudeStatus();
  const [upgrading, setUpgrading] = useState(false);

  // ── Model options (env provider) — applies when Claude Code Runtime selected ──
  const [thinkingMode, setThinkingMode] = useState("adaptive");
  const [context1m, setContext1m] = useState(false);

  // ── Session-level fields (for the read-only explainer) ──
  // Sourced from /api/providers/models?runtime=auto + the __global__
  // options (default_model + default_model_provider). This MUST mirror
  // chat/page.tsx's resolution chain — otherwise we tell the user "new
  // chats use X" and the chat init silently picks Y. See P1 fix below.
  const [defaultProviderName, setDefaultProviderName] = useState<string | null>(null);
  const [defaultModelLabel, setDefaultModelLabel] = useState<string | null>(null);
  /** What the server actually resolved when filtering by runtime=auto.
   *  Echoes `runtime_applied` from the API; null when fetch failed. */
  const [resolvedRuntimeFromApi, setResolvedRuntimeFromApi] = useState<string | null>(null);
  /** True when /api/providers/models?runtime=auto returned an empty
   *  groups list — i.e. no provider/model is currently runtime-compatible. */
  const [noCompatibleProvider, setNoCompatibleProvider] = useState(false);

  // ── Claude settings.json editor state ──
  const [settings, setSettings] = useState<SettingsData>({});
  const [originalSettings, setOriginalSettings] = useState<SettingsData>({});
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingSaveAction, setPendingSaveAction] = useState<"form" | "json" | null>(null);

  // ── Dialogs ──
  const [installWizardOpen, setInstallWizardOpen] = useState(false);

  // ── Loading ──
  const [loading, setLoading] = useState(true);

  // i18n key lookup tables for the settings.json form fields
  const knownFieldKeys: Record<string, { label: TranslationKey; description: TranslationKey }> = {
    permissions: { label: "cli.permissions", description: "cli.permissionsDesc" },
    env: { label: "cli.envVars", description: "cli.envVarsDesc" },
  };
  const dynamicFieldLabels: Record<string, TranslationKey> = {
    skipDangerousModePermissionPrompt: "cli.field.skipDangerousModePermissionPrompt",
    verbose: "cli.field.verbose",
    theme: "cli.field.theme",
  };

  // ── Fetch all data ──
  const fetchAll = useCallback(async () => {
    try {
      // `?runtime=auto` makes the server filter groups/models the chat
      // path can't reach. Without this filter, the explainer below could
      // confidently report "new chats will use Claude Code / Sonnet 4.6"
      // while chat init actually rejects that combination because the
      // active runtime requires a different provider compat — the two
      // surfaces would disagree and the user would lose trust.
      //
      // The __global__ options carry the user's chosen default model +
      // provider. We reuse the same resolution chain as `chat/page.tsx`
      // (validate global pair → fall back to provider-only → fall back
      // to first compatible group) so this page is the single source of
      // truth for "what does a new chat actually look like."
      const [cliRes, appRes, optRes, modelsRes, globalOptRes] = await Promise.all([
        fetch("/api/settings"),
        fetch("/api/settings/app"),
        fetch("/api/providers/options?providerId=env"),
        fetch("/api/providers/models?runtime=auto"),
        fetch("/api/providers/options?providerId=__global__"),
      ]);

      if (cliRes.ok) {
        const data = await cliRes.json();
        const s = data.settings || {};
        setSettings(s);
        setOriginalSettings(s);
        setJsonText(JSON.stringify(s, null, 2));
      }

      if (appRes.ok) {
        const appData = await appRes.json();
        const appSettings = appData.settings || {};
        setCliEnabled(appSettings.cli_enabled !== "false");
        // agent_runtime: 'claude-code-sdk' | 'native'. Migrate legacy 'auto'
        // values in-place — same flow as the legacy CliSettingsSection used.
        const saved = appSettings.agent_runtime;
        if (!isConcreteRuntime(saved)) {
          let cliConnected: boolean | null = null;
          try {
            const statusRes = await fetch("/api/claude-status");
            if (statusRes.ok) {
              const s = await statusRes.json();
              cliConnected = !!s?.connected;
            }
          } catch {
            /* ignore — cliConnected stays null */
          }
          if (cliConnected !== null) {
            const migrated = resolveLegacyRuntimeForDisplay(saved, cliConnected);
            setAgentRuntime(migrated as AgentRuntime);
            fetch("/api/settings/app", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ settings: { agent_runtime: migrated } }),
            }).catch(() => undefined);
          } else {
            setAgentRuntime("claude-code-sdk");
          }
        } else {
          setAgentRuntime(saved as AgentRuntime);
        }
      }

      if (optRes.ok) {
        const optData = await optRes.json();
        const opts: ProviderOptions = optData.options || {};
        setThinkingMode(opts.thinking_mode || "adaptive");
        setContext1m(opts.context_1m || false);
      }

      if (modelsRes.ok) {
        const data = await modelsRes.json() as {
          groups?: Array<{
            provider_id: string;
            provider_name: string;
            models: Array<{ value: string; label: string }>;
          }>;
          default_provider_id?: string;
          runtime_applied?: string;
        };
        setResolvedRuntimeFromApi(data.runtime_applied ?? null);
        const groups = data.groups ?? [];

        if (groups.length === 0) {
          setNoCompatibleProvider(true);
          setDefaultProviderName(null);
          setDefaultModelLabel(null);
        } else {
          setNoCompatibleProvider(false);

          // Pull global default pair from the second options request,
          // plus localStorage saved pair (mirrors what chat/page.tsx
          // reads at chat init). Together they let `resolveNewChatDefault`
          // produce the exact same result chat init would.
          let globalDefaultModel = "";
          let globalDefaultProvider = "";
          if (globalOptRes.ok) {
            const globalData = await globalOptRes.json() as {
              options?: { default_model?: string; default_model_provider?: string };
            };
            globalDefaultModel = globalData.options?.default_model ?? "";
            globalDefaultProvider = globalData.options?.default_model_provider ?? "";
          }

          let savedProviderId = "";
          let savedModel = "";
          if (typeof window !== "undefined") {
            savedProviderId = localStorage.getItem("codepilot:last-provider-id") ?? "";
            savedModel = localStorage.getItem("codepilot:last-model") ?? "";
          }

          const resolved = resolveNewChatDefault({
            groups,
            apiDefaultProviderId: data.default_provider_id,
            globalDefaultModel,
            globalDefaultProvider,
            savedProviderId,
            savedModel,
          });

          if (resolved) {
            setDefaultProviderName(resolved.providerName);
            setDefaultModelLabel(resolved.modelLabel);
          } else {
            setDefaultProviderName(null);
            setDefaultModelLabel(null);
          }
        }
      } else {
        // API itself unreachable — clear the explainer rather than show stale data.
        setResolvedRuntimeFromApi(null);
        setNoCompatibleProvider(false);
        setDefaultProviderName(null);
        setDefaultModelLabel(null);
      }
    } catch {
      setSettings({});
      setOriginalSettings({});
      setJsonText("{}");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Refetch when any provider-changing action elsewhere (Models page
  // toggle, refresh, role-mapping save, runtime switch on this page,
  // etc.) dispatches `provider-changed`. Without this listener the
  // explainer data goes stale: e.g. switching engine from Claude Code
  // to AI SDK clears the picker but `resolvedRuntimeFromApi` and
  // `defaultProviderName` hang on the previous probe's result.
  useEffect(() => {
    const handler = () => { fetchAll(); };
    window.addEventListener("provider-changed", handler);
    return () => window.removeEventListener("provider-changed", handler);
  }, [fetchAll]);

  // ── Engine selector handler ──
  const handleRuntimeChange = async (value: AgentRuntime) => {
    setAgentRuntime(value);
    const cliEnabledValue = value === "native" ? "false" : "true";
    setCliEnabled(cliEnabledValue === "true");

    // Clear stale explainer state immediately so the user doesn't see
    // the previous resolution while the new fetch is in flight. The
    // engine-picker cards already re-paint from local state above; the
    // explainer block needs a server round-trip because runtime=auto
    // filtering happens server-side.
    setResolvedRuntimeFromApi(null);
    setDefaultProviderName(null);
    setDefaultModelLabel(null);
    setNoCompatibleProvider(false);

    try {
      await fetch("/api/settings/app", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: { agent_runtime: value, cli_enabled: cliEnabledValue },
        }),
      });
      // The `provider-changed` event triggers the listener above, which
      // calls `fetchAll` and refreshes the explainer. We don't need to
      // call fetchAll inline — the listener path is the canonical refetch
      // trigger for any runtime / provider / model change.
      window.dispatchEvent(new Event("provider-changed"));
    } catch {
      /* ignore — next user action will refetch */
    }
  };

  // ── Claude Code Runtime install / upgrade ──
  const handleUpgrade = async () => {
    if (!claudeStatus?.installType) return;
    setUpgrading(true);
    try {
      const res = await fetch("/api/claude-upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installType: claudeStatus.installType }),
      });
      const data = await res.json();
      if (data.success) await invalidateAndRefresh();
    } finally {
      setUpgrading(false);
    }
  };

  // ── Model options (Claude Code only) ──
  const saveModelOption = async (key: string, value: string | boolean) => {
    if (key === "thinking_mode") setThinkingMode(value as string);
    if (key === "context_1m") setContext1m(value as boolean);
    try {
      await fetch("/api/providers/options", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: "env", options: { [key]: value } }),
      });
    } catch {
      /* ignore */
    }
  };

  // ── settings.json editor handlers ──
  const hasChanges = JSON.stringify(settings) !== JSON.stringify(originalSettings);

  const handleSave = async (source: "form" | "json") => {
    let dataToSave: SettingsData;
    if (source === "json") {
      try {
        dataToSave = JSON.parse(jsonText);
        setJsonError("");
      } catch {
        setJsonError("Invalid JSON format");
        return;
      }
    } else {
      dataToSave = settings;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: dataToSave }),
      });
      if (res.ok) {
        setSettings(dataToSave);
        setOriginalSettings(dataToSave);
        setJsonText(JSON.stringify(dataToSave, null, 2));
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
      }
    } finally {
      setSaving(false);
      setShowConfirmDialog(false);
      setPendingSaveAction(null);
    }
  };

  const handleReset = () => {
    setSettings(originalSettings);
    setJsonText(JSON.stringify(originalSettings, null, 2));
    setJsonError("");
  };

  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(jsonText);
      setJsonText(JSON.stringify(parsed, null, 2));
      setJsonError("");
    } catch {
      setJsonError(t("cli.formatError"));
    }
  };

  const confirmSave = (source: "form" | "json") => {
    setPendingSaveAction(source);
    setShowConfirmDialog(true);
  };

  const updateField = (key: string, value: unknown) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  // ── Derived state ──
  const connected = claudeStatus?.connected ?? false;
  const updateAvailable = claudeStatus?.updateAvailable ?? false;
  const hasWarnings = !!claudeStatus?.warnings && claudeStatus.warnings.length > 0;

  /**
   * What the chat runtime registry will *actually* pick. Delegates to
   * the shared `computeEffectiveRuntime` helper so this surface, the
   * chat header `RuntimeBadge`, and `registry.ts:resolveRuntime` all
   * agree on the same priority chain (`cli_enabled=false` overrides
   * the stored preference).
   *
   * `handleRuntimeChange` keeps both DB fields in sync on every write,
   * so the drift warning below only fires for legacy DB rows where
   * the two settings were saved apart by an earlier build.
   */
  const effectiveRuntime: AgentRuntime = computeEffectiveRuntime(
    agentRuntime,
    cliEnabled,
    connected,
  );
  const driftWarning = effectiveRuntime !== agentRuntime;

  /**
   * Compute Claude Code Runtime status info from current data. Five-state
   * decision tree:
   *
   *   not connected → blocked    (CLI missing / OAuth expired)
   *   connected + warnings → degraded    (version mismatch etc.)
   *   connected + selected → selected
   *   connected + not selected → available
   *
   * The `disabled` state isn't surfaced for Claude Code in this build —
   * `cli_enabled=false` only flips when the user picks AI SDK as engine,
   * in which case Claude Code reads as `available` + the AI SDK card
   * reads as `selected`.
   */
  const claudeCodeStatus: RuntimeStatusInfo = useMemo(() => {
    if (!connected) {
      return {
        state: "blocked",
        reason: isZh
          ? "未检测到 Claude Code CLI（或 OAuth 登录已过期）"
          : "Claude Code CLI not detected (or OAuth login has expired)",
        impact: isZh
          ? "无法用 Claude Code 内核跑会话；选用此 Runtime 的会话会回退到 AI SDK"
          : "Sessions cannot run on the Claude Code engine; selecting this runtime falls back to AI SDK",
        recovery: isZh
          ? "下方点「安装」启动一键安装向导，或先在系统终端 `claude /login` 完成授权"
          : "Click Install below to launch the wizard, or run `claude /login` in a terminal",
      };
    }
    if (hasWarnings) {
      return {
        state: "degraded",
        reason: isZh
          ? "Claude Code 已安装但有兼容性提示（详见下方警告列表）"
          : "Claude Code is installed but reports compatibility warnings (see below)",
        impact: isZh
          ? "可以运行，但部分功能行为可能与新版本不一致；建议升级"
          : "Sessions still run, but some behavior may diverge from the latest version. Upgrade recommended.",
        recovery: updateAvailable
          ? isZh
            ? "下方点「升级」一键更新到最新版本"
            : "Click Upgrade below to update to the latest version"
          : isZh
            ? "在系统终端运行 `claude --version` 检查版本与 SDK 兼容性"
            : "Run `claude --version` in a terminal to check the version against SDK compatibility",
      };
    }
    if (effectiveRuntime === "claude-code-sdk") {
      return {
        state: "selected",
        reason: isZh
          ? "Claude Code 已安装并被设为默认引擎"
          : "Claude Code is installed and set as the default engine",
        impact: isZh
          ? "新会话默认走 Claude Code 内核，使用 ~/.claude/settings.json 中的环境与权限"
          : "New chats run on the Claude Code engine, honoring ~/.claude/settings.json",
      };
    }
    return {
      state: "available",
      reason: isZh
        ? "Claude Code 已安装但未被设为默认引擎"
        : "Claude Code is installed but isn't the default engine",
      impact: isZh
        ? "想切回 Claude Code 内核，把上方「默认引擎」切到 Claude Code 即可"
        : 'Switch the "Default engine" selector above to use Claude Code',
    };
  }, [connected, hasWarnings, updateAvailable, effectiveRuntime, isZh]);

  /**
   * CodePilot Runtime is bundled and always available; the only thing
   * that can change is whether it's selected as default.
   */
  const codepilotStatus: RuntimeStatusInfo = useMemo(() => {
    if (effectiveRuntime === "native") {
      return {
        state: "selected",
        reason: isZh
          ? "AI SDK 是默认内核（无需 CLI，直连 provider API）"
          : "AI SDK is the default engine (no CLI required, direct provider API)",
        impact: isZh
          ? "新会话默认用 AI SDK；工具、权限和上下文由 CodePilot 自己管理"
          : "New chats run on the AI SDK engine; tools, permissions, and context managed by CodePilot itself",
      };
    }
    return {
      state: "available",
      reason: isZh
        ? "AI SDK 内核随应用自带，始终可用"
        : "AI SDK engine ships with the app and is always available",
      impact: isZh
        ? "想切到 AI SDK 内核，把上方「默认引擎」切到 AI SDK 即可"
        : 'Switch the "Default engine" selector above to use AI SDK',
    };
  }, [effectiveRuntime, isZh]);

  /**
   * Session-level resolved engine string for the read-only explainer.
   * Authoritative when the API echoes back `runtime_applied`; otherwise
   * fall back to the locally-computed `effectiveRuntime`. The
   * "fallback — Claude Code unavailable" annotation only shows when
   * the stored preference says Claude Code but the effective runtime
   * routed elsewhere.
   */
  const resolvedEngineLabel = useMemo(() => {
    // Authoritative source: API `runtime_applied` field. The /api/providers/models
    // server-side filter knows the live state of CLI subprocess + cli_enabled
    // and returns the runtime it actually filtered against. Fall back to the
    // locally-computed effectiveRuntime only when that field is missing
    // (request failed or older API version).
    const apiSaid = resolvedRuntimeFromApi;
    // Normalize the API's underscore form to the canonical agent_runtime spelling.
    const apiNormalized: AgentRuntime | null =
      apiSaid === "claude_code" ? "claude-code-sdk" : apiSaid === "codepilot_runtime" ? "native" : null;
    const resolvedRuntime = apiNormalized ?? effectiveRuntime;
    const resolvedLabel = runtimeDisplayLabel(resolvedRuntime);

    // Annotate the label when the user's stored preference disagrees
    // with the actually-resolved runtime — i.e. they picked Claude
    // Code but CLI is missing OR cli_enabled=false routes them away.
    if (agentRuntime === "claude-code-sdk" && resolvedRuntime !== "claude-code-sdk") {
      return isZh
        ? `${resolvedLabel}（Claude Code 不可用，自动降级）`
        : `${resolvedLabel} (fallback — Claude Code unavailable)`;
    }
    return resolvedLabel;
  }, [resolvedRuntimeFromApi, effectiveRuntime, agentRuntime, isZh]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">{t("cli.loadingSettings")}</span>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-medium">{t("settings.runtime" as TranslationKey)}</h2>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {isZh
            ? "查看当前 Agent 由谁运行、为什么是这个状态、影响是什么、怎么恢复。Providers 管资产，Models 管暴露，Runtime 管运行环境。"
            : "Inspect which runtime is currently in charge of the Agent — why it's in this state, what the impact is, and how to recover. Providers govern assets, Models govern exposure, Runtime governs environment."}
        </p>
      </div>

      {/* ── Default-engine picker (two large cards, mutually exclusive) ──
          Each card is the entire click target. Selected card carries
          primary-tinted border + bg + ring; unselected stays muted.
          The status hint at the bottom of each card flips based on
          actual reachability (Claude Code: install / OAuth state;
          AI SDK: always ready since it ships in-app). */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Lightning size={16} weight="fill" className="text-status-success-foreground" />
          <h3 className="text-sm font-semibold">{isZh ? "默认引擎" : "Default engine"}</h3>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3">
          {isZh
            ? "选择新会话默认使用哪个 Runtime。当前正在运行的回复不受影响；后续每条新消息会按"
              + "「默认 Runtime + Provider」重新解析。"
            : "Choose which runtime new chats use by default. Replies already streaming aren't interrupted; every subsequent message re-resolves the default runtime + provider on send."}
        </p>
        {driftWarning && (
          <div className="mb-3 rounded-md border border-status-warning-muted bg-status-warning-muted/30 px-3 py-2 text-[11px] text-status-warning-foreground flex items-start gap-1.5">
            <Warning size={14} weight="fill" className="mt-0.5 shrink-0" />
            <span>
              {isZh
                ? "检测到旧设置不一致：你保存的偏好是 Claude Code，但 CLI 已被关闭，运行时实际走 AI SDK。点上面任一卡片可一次写齐两边。"
                : "Legacy state mismatch: stored preference is Claude Code but CLI is disabled, so runtime actually routes to AI SDK. Click either card to rewrite both fields together."}
            </span>
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <EnginePickerCard
            engine="claude-code-sdk"
            selected={effectiveRuntime === "claude-code-sdk"}
            onSelect={() => handleRuntimeChange("claude-code-sdk")}
            title="Claude Code"
            tagline={isZh ? "Anthropic 官方 CLI" : "Anthropic official CLI"}
            pitch={isZh
              ? "用 Anthropic 官方 CLI 跑 Agent，完整兼容 Claude Code 生态：~/.claude/settings.json、hooks、MCP server 直接可用。"
              : "Runs the Agent through Anthropic's official Claude Code CLI. Fully compatible with the Claude Code ecosystem — ~/.claude/settings.json, hooks, and MCP servers all work as-is."}
            statusKind={connected ? "ok" : "warning"}
            statusText={connected
              ? `${isZh ? "已安装" : "Installed"} v${claudeStatus?.version ?? ""}${claudeStatus?.installType ? ` · ${claudeStatus.installType}` : ""}`
              : (isZh ? "未安装 — 选用后会自动降级到 AI SDK" : "Not installed — selecting it falls back to AI SDK")}
            isZh={isZh}
          />
          <EnginePickerCard
            engine="native"
            selected={effectiveRuntime === "native"}
            onSelect={() => handleRuntimeChange("native")}
            title="AI SDK"
            tagline={isZh ? "CodePilot 自带内核" : "CodePilot built-in"}
            pitch={isZh
              ? "CodePilot 直连 provider API 跑 Agent。多 provider、权限与上下文由 CodePilot 自管，不依赖外部 CLI。"
              : "CodePilot calls provider APIs directly. Multi-provider, with permissions and context managed in-app — no external CLI required."}
            statusKind="ok"
            statusText={isZh ? "随应用自带，始终可用" : "Bundled with the app, always available"}
            isZh={isZh}
          />
        </div>
      </div>

      {/* ── Claude Code Runtime card ──────────────────────────────────── */}
      <RuntimeCard name="Claude Code Runtime" state={claudeCodeStatus.state} isZh={isZh}>
        <RuntimeStatusExplanation info={claudeCodeStatus} isZh={isZh} />

        {/* CLI install / version / upgrade row */}
        <div className="rounded-md bg-muted/40 px-3.5 divide-y divide-border/50">
          <div className="py-2.5 flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground shrink-0">
              {isZh ? "CLI 状态" : "CLI status"}
            </span>
            <div className="flex items-center gap-2">
              {connected ? (
                <>
                  <CheckCircle size={14} className="text-status-success-foreground" />
                  <span className="text-xs text-muted-foreground">
                    v{claudeStatus?.version}
                    {claudeStatus?.installType ? ` (${claudeStatus.installType})` : ""}
                  </span>
                  {updateAvailable && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs gap-1"
                      onClick={handleUpgrade}
                      disabled={upgrading}
                    >
                      {upgrading ? (
                        <SpinnerGap size={12} className="animate-spin" />
                      ) : (
                        <ArrowsClockwise size={12} />
                      )}
                      {t("cli.update")}
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <XCircle size={14} className="text-status-error-foreground" />
                  <span className="text-xs text-muted-foreground">
                    {isZh ? "未安装" : "Not installed"}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs gap-1"
                    onClick={() => setInstallWizardOpen(true)}
                  >
                    {t("cli.install")}
                  </Button>
                </>
              )}
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={refreshStatus}>
                <ArrowClockwise size={12} />
              </Button>
            </div>
          </div>
        </div>

        {/* Warnings (only when present) */}
        {hasWarnings && (
          <div className="rounded-md border border-status-warning-muted bg-status-warning-muted/30 px-3 py-2">
            <div className="flex items-start gap-2">
              <Warning
                size={14}
                className="text-status-warning-foreground mt-0.5 flex-shrink-0"
              />
              <div className="text-xs text-status-warning-foreground space-y-0.5">
                {claudeStatus!.warnings!.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Model options — only meaningful when Claude Code is selected and connected */}
        {effectiveRuntime === "claude-code-sdk" && connected && (
          <div className="rounded-md bg-muted/40 px-3.5 divide-y divide-border/50">
            <div className="py-2.5 flex items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium">{t("cli.thinkingMode")}</span>
                <span className="text-[11px] text-muted-foreground">{t("cli.thinkingModeDesc")}</span>
              </div>
              <Select value={thinkingMode} onValueChange={(v) => saveModelOption("thinking_mode", v)}>
                <SelectTrigger className="w-[140px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="adaptive">{t("settings.thinkingAdaptive" as TranslationKey)}</SelectItem>
                  <SelectItem value="enabled">{t("settings.thinkingEnabled" as TranslationKey)}</SelectItem>
                  <SelectItem value="disabled">{t("settings.thinkingDisabled" as TranslationKey)}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="py-2.5 flex items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium">{t("cli.context1m")}</span>
                <span className="text-[11px] text-muted-foreground">{t("cli.context1mDesc")}</span>
              </div>
              <Switch
                checked={context1m}
                onCheckedChange={(c) => saveModelOption("context_1m", c)}
              />
            </div>
          </div>
        )}

        {/* settings.json editor (collapsed by default — advanced) */}
        <details className="rounded-md bg-muted/40 px-3.5 py-2 group">
          <summary className="flex items-center justify-between gap-2 cursor-pointer text-xs font-medium select-none list-none">
            <span className="flex items-center gap-1.5">
              <Code size={12} className="text-muted-foreground" />
              {t("cli.cliConfig")}
            </span>
            <CaretDown
              size={12}
              className="text-muted-foreground transition-transform group-open:rotate-180"
            />
          </summary>
          <p className="mt-1 mb-3 text-[11px] text-muted-foreground">{t("cli.cliConfigDesc")}</p>
          <Tabs defaultValue="form">
            <TabsList className="mb-3">
              <TabsTrigger value="form" className="gap-2 text-xs">
                <SlidersHorizontal size={14} />
                {t("cli.form")}
              </TabsTrigger>
              <TabsTrigger value="json" className="gap-2 text-xs">
                <Code size={14} />
                {t("cli.json")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="form">
              <div className="space-y-3">
                {KNOWN_FIELDS.map((field) => (
                  <div key={field.key}>
                    <Label className="text-xs font-medium">
                      {t(knownFieldKeys[field.key]?.label ?? (field.label as TranslationKey))}
                    </Label>
                    <p className="mb-1.5 text-[11px] text-muted-foreground">
                      {t(knownFieldKeys[field.key]?.description ?? ("" as TranslationKey))}
                    </p>
                    <Textarea
                      value={
                        typeof settings[field.key] === "object"
                          ? JSON.stringify(settings[field.key], null, 2)
                          : String(settings[field.key] ?? "")
                      }
                      onChange={(e) => {
                        try {
                          const parsed = JSON.parse(e.target.value);
                          updateField(field.key, parsed);
                        } catch {
                          updateField(field.key, e.target.value);
                        }
                      }}
                      className="font-mono text-xs"
                      rows={4}
                    />
                  </div>
                ))}
                {Object.entries(settings)
                  .filter(([key]) => !KNOWN_FIELDS.some((f) => f.key === key))
                  .map(([key, value]) => (
                    <div key={key}>
                      <Label className="text-xs font-medium">
                        {dynamicFieldLabels[key] ? t(dynamicFieldLabels[key]) : key}
                      </Label>
                      {typeof value === "boolean" ? (
                        <div className="mt-1.5 flex items-center gap-2">
                          <Switch checked={value} onCheckedChange={(c) => updateField(key, c)} />
                          <span className="text-xs text-muted-foreground">
                            {value ? t("common.enabled") : t("common.disabled")}
                          </span>
                        </div>
                      ) : typeof value === "string" ? (
                        <Input
                          value={value}
                          onChange={(e) => updateField(key, e.target.value)}
                          className="mt-1.5 text-xs"
                        />
                      ) : (
                        <Textarea
                          value={JSON.stringify(value, null, 2)}
                          onChange={(e) => {
                            try {
                              updateField(key, JSON.parse(e.target.value));
                            } catch {
                              updateField(key, e.target.value);
                            }
                          }}
                          className="mt-1.5 font-mono text-xs"
                          rows={4}
                        />
                      )}
                    </div>
                  ))}
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => confirmSave("form")}
                    disabled={!hasChanges || saving}
                    size="sm"
                    className="gap-1.5"
                  >
                    {saving ? <SpinnerGap size={14} className="animate-spin" /> : <FloppyDisk size={14} />}
                    {saving ? t("provider.saving") : t("cli.save")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReset}
                    disabled={!hasChanges}
                    className="gap-1.5"
                  >
                    <ArrowClockwise size={14} />
                    {t("cli.reset")}
                  </Button>
                  {saveSuccess && (
                    <span className="text-xs text-status-success-foreground">
                      {t("cli.settingsSaved")}
                    </span>
                  )}
                </div>
              </div>
            </TabsContent>
            <TabsContent value="json">
              <div className="space-y-3">
                <Textarea
                  value={jsonText}
                  onChange={(e) => {
                    setJsonText(e.target.value);
                    setJsonError("");
                  }}
                  className="min-h-[300px] font-mono text-xs"
                  placeholder='{"key": "value"}'
                />
                {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => confirmSave("json")}
                    disabled={saving}
                    size="sm"
                    className="gap-1.5"
                  >
                    {saving ? <SpinnerGap size={14} className="animate-spin" /> : <FloppyDisk size={14} />}
                    {saving ? t("provider.saving") : t("cli.save")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleFormatJson} className="gap-1.5">
                    <Code size={14} />
                    {t("cli.format")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleReset} className="gap-1.5">
                    <ArrowClockwise size={14} />
                    {t("cli.reset")}
                  </Button>
                  {saveSuccess && (
                    <span className="text-xs text-status-success-foreground">
                      {t("cli.settingsSaved")}
                    </span>
                  )}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </details>
      </RuntimeCard>

      {/* ── CodePilot Runtime card ────────────────────────────────────── */}
      <RuntimeCard name="CodePilot Runtime (AI SDK)" state={codepilotStatus.state} isZh={isZh}>
        <RuntimeStatusExplanation info={codepilotStatus} isZh={isZh} />

        {/* Capabilities / Permissions / Context — three medium-granularity blocks */}
        <div className="rounded-md bg-muted/40 px-3.5 divide-y divide-border/50">
          <div className="py-2.5 flex items-start justify-between gap-3">
            <div className="flex flex-col gap-0.5 max-w-[55%]">
              <span className="text-xs font-medium">{isZh ? "能力" : "Capabilities"}</span>
              <span className="text-[11px] text-muted-foreground leading-snug">
                {isZh
                  ? "内置工具（Read / Edit / Bash 等），MCP 工具集（Chrome DevTools / 自定义 Server），文件 / 终端 / 浏览器全套支持"
                  : "Built-in tools (Read / Edit / Bash / etc.), MCP toolsets (Chrome DevTools / custom servers), full file / terminal / browser stack"}
              </span>
            </div>
            <span className="text-[10px] text-muted-foreground/70">
              {isZh ? "随应用更新" : "ships with app"}
            </span>
          </div>
          <div className="py-2.5 flex items-start justify-between gap-3">
            <div className="flex flex-col gap-0.5 max-w-[55%]">
              <span className="text-xs font-medium">{isZh ? "权限" : "Permissions"}</span>
              <span className="text-[11px] text-muted-foreground leading-snug">
                {isZh
                  ? "默认 explore（读 + 安全命令自动；写 / 删 / 网络需确认），可切到 normal / trust / plan"
                  : "Defaults to Explore (auto for reads + safe commands; confirm before write / delete / network). Switchable to Normal / Trust / Plan."}
              </span>
            </div>
            <span className="text-[10px] text-muted-foreground/70">
              {isZh ? "会话级控制" : "per-session"}
            </span>
          </div>
          <div className="py-2.5 flex items-start justify-between gap-3">
            <div className="flex flex-col gap-0.5 max-w-[55%]">
              <span className="text-xs font-medium">{isZh ? "上下文" : "Context"}</span>
              <span className="text-[11px] text-muted-foreground leading-snug">
                {isZh
                  ? "CodePilot 管理项目工作区、会话历史、模型选择和本地状态；自动按 token 预算修剪 / 压缩"
                  : "CodePilot owns project workspace, session history, model choice, and local state; automatic token-budget prune + compress."}
              </span>
            </div>
            <span className="text-[10px] text-muted-foreground/70">
              {isZh ? "本地存储" : "local"}
            </span>
          </div>
        </div>
      </RuntimeCard>

      {/* ── Session-level read-only explainer ──────────────────────────── */}
      <div className="rounded-lg bg-card border border-border/50 p-5 flex flex-col gap-3">
        <h3 className="text-sm font-semibold leading-tight">
          {isZh ? "新会话会用什么" : "What a new chat will use"}
        </h3>
        <p className="text-[11px] text-muted-foreground">
          {isZh
            ? "按当前默认设置，下一条新消息会解析为以下运行组合。每次发送前都会重新检查 Runtime、Provider 和模型兼容性 — 不持久绑定到某个会话。"
            : "With the current defaults, your next new message resolves to the combination below. Runtime, provider, and model compatibility are re-checked on every send — nothing is pinned to a session."}
        </p>
        {noCompatibleProvider ? (
          <div className="rounded-md border border-status-warning-muted bg-status-warning-muted/30 px-3 py-2 text-xs text-status-warning-foreground flex items-start gap-1.5">
            <Warning size={14} weight="fill" className="mt-0.5 shrink-0" />
            <span>
              {isZh
                ? `当前 Runtime（${resolvedEngineLabel}）下没有可用的 provider/model。新会话会进入"无兼容服务"状态，需要先在「服务商 / 模型」里启用一个匹配 Runtime 的模型。`
                : `No provider/model is compatible with the current runtime (${resolvedEngineLabel}). New chats land in the "no compatible provider" state until you enable a matching model in Providers / Models.`}
            </span>
          </div>
        ) : (
          <div className="rounded-md bg-muted/40 px-3.5 divide-y divide-border/50">
            <div className="py-2.5 flex items-center justify-between gap-3">
              <span className="text-[11px] text-muted-foreground shrink-0">
                {isZh ? "Runtime" : "Runtime"}
              </span>
              <span className="text-xs text-foreground/85 text-right">{resolvedEngineLabel}</span>
            </div>
            <div className="py-2.5 flex items-center justify-between gap-3">
              <span className="text-[11px] text-muted-foreground shrink-0">
                {isZh ? "默认 Provider" : "Default provider"}
              </span>
              <span className="text-xs text-foreground/85 text-right truncate">
                {defaultProviderName ?? (isZh ? "未配置" : "Not configured")}
              </span>
            </div>
            <div className="py-2.5 flex items-center justify-between gap-3">
              <span className="text-[11px] text-muted-foreground shrink-0">
                {isZh ? "默认模型" : "Default model"}
              </span>
              <span className="text-xs text-foreground/85 text-right truncate">
                {defaultModelLabel ?? (isZh ? "未配置" : "Not configured")}
              </span>
            </div>
            {/* Fallback row: shows when the user's stored preference is Claude
                Code but the effective runtime routed to AI SDK (CLI missing
                OR cli_enabled=false). Both branches are user-relevant; we
                gate on agentRuntime !== effectiveRuntime so we don't show a
                "fallback" when the user picked AI SDK on purpose. */}
            {agentRuntime === "claude-code-sdk" && effectiveRuntime !== "claude-code-sdk" && (
              <div className="py-2.5 flex items-center justify-between gap-3">
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {isZh ? "降级路径" : "Fallback"}
                </span>
                <span className="text-xs text-status-warning-foreground text-right">
                  {!cliEnabled
                    ? (isZh
                        ? "CLI 已禁用 → 走 AI SDK"
                        : "CLI disabled → routes to AI SDK")
                    : (isZh
                        ? "Claude Code 不可用 → 自动用 AI SDK"
                        : "Claude Code unavailable → falls back to AI SDK")}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confirmation dialog for settings.json saves */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cli.confirmSaveTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("cli.confirmSaveDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingSaveAction && handleSave(pendingSaveAction)}>
              {t("common.save")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Install wizard for Claude Code CLI */}
      {installWizardOpen && (
        <InstallWizardDialog
          open={installWizardOpen}
          onOpenChange={(open) => {
            setInstallWizardOpen(open);
            if (!open) invalidateAndRefresh();
          }}
          onInstallComplete={async () => {
            await invalidateAndRefresh();
            await fetch("/api/settings/app", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ settings: { cli_enabled: "true" } }),
            });
            setInstallWizardOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Install wizard — instructions dialog (matches the legacy implementation).
// Shows the official install command for the user's platform; user runs it
// in their terminal, then clicks "Done" to re-detect.
// ---------------------------------------------------------------------------

function InstallWizardDialog({
  open,
  onOpenChange,
  onInstallComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstallComplete: () => void;
}) {
  const { t } = useTranslation();
  const isWindows = typeof navigator !== "undefined" && /Win/.test(navigator.userAgent);
  const installCommand = isWindows
    ? "irm https://claude.ai/install.ps1 | iex"
    : "curl -fsSL https://claude.ai/install.sh | bash";

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("cli.installTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("cli.installDesc")}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="my-3 rounded-md bg-muted p-3">
          <code className="text-xs font-mono select-all">{installCommand}</code>
        </div>
        <p className="text-xs text-muted-foreground">{t("cli.installAfter")}</p>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={onInstallComplete}>{t("cli.installDone")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
