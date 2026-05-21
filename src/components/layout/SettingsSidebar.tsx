"use client";

import { useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft } from "@/components/ui/icon";
import { CodePilotIcon } from "@/components/ui/semantic-icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";
import {
  SETTINGS_NAV_ITEMS,
  pathnameToSettingsSection,
} from "@/components/settings/nav-config";

interface SettingsSidebarProps {
  open: boolean;
  width?: number;
}

/**
 * Settings sidebar — replaces ChatListPanel when on /settings route.
 * Top: Back button → returns to previous view (chat).
 * Below: section navigation (one entry per /settings/<section> route).
 *
 * Memory contract: nav items are <Link prefetch={false}> so dev only
 * compiles the section a user actually clicks into. Active state is
 * derived from pathname, not hash; legacy /settings#section hash entries
 * are redirected to the new path by the /settings root page on mount.
 *
 * v6 fix (P2): nav items live in `@/components/settings/nav-config`,
 * shared with `src/app/settings/layout.tsx` (the mobile horizontal
 * nav). Previously each file kept its own literal and diverging adds
 * (Tasks here, not there) caused a hydration mismatch.
 */
export function SettingsSidebar({ open, width }: SettingsSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useTranslation();

  const activeSection = pathnameToSettingsSection(pathname || "/settings");

  const handleBack = useCallback(() => {
    // Avoid router.back() — for deep-linked /settings/... entries it can
    // escape to about:blank. Prefer the recorded last non-settings path
    // (written by AppShell), with /chat as explicit fallback.
    if (typeof window !== "undefined") {
      const last = sessionStorage.getItem("codepilot:last-non-settings-path");
      if (last && !last.startsWith("/settings")) {
        router.push(last);
        return;
      }
    }
    router.push("/chat");
  }, [router]);

  if (!open) return null;

  return (
    <aside
      className="hidden h-full shrink-0 flex-col overflow-hidden bg-sidebar/80 backdrop-blur-xl lg:flex"
      style={{ width: width ?? 240 }}
    >
      {/* macOS traffic lights spacing — match ChatListPanel */}
      <div className="h-5 shrink-0 mt-3" />

      {/* Back button */}
      <div className="p-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBack}
          className="group w-full justify-start gap-2 h-9 px-3 rounded-xl text-[13px] font-normal text-sidebar-foreground"
        >
          <ArrowLeft size={16} />
          {t("common.back" as TranslationKey)}
        </Button>
      </div>

      {/* Section navigation */}
      <div className="p-2 flex flex-col gap-0.5">
        {SETTINGS_NAV_ITEMS.map((item) => {
          const isActive = activeSection === item.id;
          return (
            <Link
              key={item.id}
              href={item.href}
              prefetch={false}
              className={cn(
                "group inline-flex items-center w-full justify-start gap-2 h-9 px-3 rounded-xl text-[13px]",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground font-normal hover:bg-sidebar-accent/60",
              )}
            >
              <CodePilotIcon
                name={item.icon}
                size="md"
                strokeWidth={isActive ? 2 : undefined}
                className="text-inherit"
                aria-hidden
              />
              {t(item.i18nKey)}
            </Link>
          );
        })}
      </div>
    </aside>
  );
}
