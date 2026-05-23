"use client";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SpinnerGap, CheckCircle } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";

// ── Onboarding Status Card ──

interface OnboardingCardProps {
  onboardingComplete: boolean;
  creatingSession: boolean;
  onStartOnboarding: () => void;
}

export function OnboardingCard({ onboardingComplete, creatingSession, onStartOnboarding }: OnboardingCardProps) {
  const { t } = useTranslation();

  // When complete: compact one-line status
  if (onboardingComplete) {
    return (
      <div className="rounded-lg border border-border/50 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle size={14} className="text-status-success-foreground" />
          <span className="text-xs text-status-success-foreground">{t('assistant.configured')}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 h-auto p-0"
          onClick={onStartOnboarding}
          disabled={creatingSession}
        >
          {creatingSession ? (
            <SpinnerGap size={12} className="animate-spin" />
          ) : (
            t('assistant.reconfigure')
          )}
        </Button>
      </div>
    );
  }

  // When not complete: full card with Wizard button
  return (
    <div className="rounded-lg bg-card border border-border/50 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-medium">{t('assistant.onboardingTitle')}</h2>
          <p className="text-xs text-muted-foreground mt-1">{t('assistant.onboardingDesc')}</p>
          <p className="text-xs mt-1">
            <span className="text-status-warning-foreground">{t('assistant.onboardingNotStarted')}</span>
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onStartOnboarding}
          disabled={creatingSession}
        >
          {creatingSession ? (
            <SpinnerGap size={14} className="animate-spin" />
          ) : (
            t('assistant.startOnboarding')
          )}
        </Button>
      </div>
    </div>
  );
}

// ── Heartbeat Card ──

interface CheckInCardProps {
  lastCheckInDate: string | null;
  checkInDoneToday: boolean;
  autoTriggerEnabled: boolean;
  onAutoTriggerChange: (enabled: boolean) => void;
  /**
   * Phase 3 Step 4 — heartbeat interval (in hours). When set the
   * select control is rendered below the description; when undefined
   * the control hides (e.g. legacy callers that don't supply it).
   * Min 1h enforced server-side.
   */
  intervalHours?: number;
  onIntervalChange?: (hours: number) => void;
}

export function CheckInCard({
  lastCheckInDate,
  checkInDoneToday,
  autoTriggerEnabled,
  onAutoTriggerChange,
  intervalHours,
  onIntervalChange,
}: CheckInCardProps) {
  const { t } = useTranslation();

  // v12 layout: title + Switch on the top row only; description and
  // status get full card width below. v13 (Step 4) adds an interval
  // picker (24 / 12 / 6 / 1 hours) when `intervalHours` + the change
  // callback are supplied — the only NEW user-facing control on this
  // card after Step 4. Hidden when the toggle is off (no interval to
  // configure when heartbeat won't run).
  return (
    <div className="rounded-lg bg-card border border-border/50 p-5 space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-medium">{t('assistant.heartbeatTitle')}</h2>
        <Switch checked={autoTriggerEnabled} onCheckedChange={onAutoTriggerChange} />
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {t('assistant.heartbeatDesc')}
      </p>
      <p className="text-xs">
        {lastCheckInDate && (
          <span className="text-muted-foreground">
            {t('assistant.lastHeartbeatLabel')}: {lastCheckInDate}
          </span>
        )}
        {lastCheckInDate ? " " : null}
        {checkInDoneToday
          ? <span className="text-status-success-foreground">{t('assistant.heartbeatOk')}</span>
          : <span className="text-status-warning-foreground">{t('assistant.heartbeatNeeded')}</span>
        }
      </p>
      {autoTriggerEnabled && typeof intervalHours === 'number' && onIntervalChange && (
        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-xs text-muted-foreground">
            {t('assistant.heartbeatInterval' as TranslationKey)}
          </span>
          <Select
            value={String(intervalHours)}
            onValueChange={(v) => onIntervalChange(parseInt(v, 10) || 24)}
          >
            <SelectTrigger className="w-auto text-xs h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">{t('assistant.heartbeatInterval1h' as TranslationKey)}</SelectItem>
              <SelectItem value="6">{t('assistant.heartbeatInterval6h' as TranslationKey)}</SelectItem>
              <SelectItem value="12">{t('assistant.heartbeatInterval12h' as TranslationKey)}</SelectItem>
              <SelectItem value="24">{t('assistant.heartbeatInterval24h' as TranslationKey)}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        {t('assistant.editHeartbeatHint')}
      </p>
    </div>
  );
}
