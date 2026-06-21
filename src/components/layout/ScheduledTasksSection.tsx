"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { CaretDown, CaretRight } from "@/components/ui/icon";
import { CodePilotIcon } from "@/components/ui/semantic-icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";
import { showToast } from "@/hooks/useToast";
import {
  formatRelativeNextRun,
  groupTasksByBucket,
  type TaskBucketId,
} from "@/lib/task-bucket";
import type { ScheduledTask } from "@/types";

const BUCKET_LABEL_KEY: Record<TaskBucketId, TranslationKey> = {
  overdue: "tasks.bucketOverdue" as TranslationKey,
  dueSoon: "tasks.bucketDueSoon" as TranslationKey,
  today: "tasks.bucketToday" as TranslationKey,
  tomorrow: "tasks.bucketTomorrow" as TranslationKey,
  thisWeek: "tasks.bucketThisWeek" as TranslationKey,
  later: "tasks.bucketLater" as TranslationKey,
};

const POLL_INTERVAL_MS = 60_000;

export function ScheduledTasksSection() {
  const router = useRouter();
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchTasks = useCallback(async () => {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      const res = await fetch("/api/tasks/list?status=active", { signal: ctl.signal });
      if (res.ok) {
        const data = await res.json();
        setTasks(Array.isArray(data.tasks) ? data.tasks : []);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    const id = setInterval(fetchTasks, POLL_INTERVAL_MS);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [fetchTasks]);

  const handleRunNow = useCallback(
    async (e: React.MouseEvent, taskId: string) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const res = await fetch(`/api/tasks/${taskId}/run`, { method: "POST" });
        if (res.ok) {
          showToast({
            type: "success",
            message: t("tasks.runNow" as TranslationKey),
          });
          // Re-fetch shortly so last_status flips to running in the UI.
          setTimeout(fetchTasks, 1500);
        }
      } catch {
        // best-effort
      }
    },
    [fetchTasks, t],
  );

  const handleOpenInSettings = useCallback(
    (e: React.MouseEvent, taskId: string) => {
      e.preventDefault();
      e.stopPropagation();
      router.push(`/settings/tasks?taskId=${taskId}`);
    },
    [router],
  );

  // Primary task-body click: jump to the task's bound execution chat
  // (where the AI actually runs the prompt) if it exists. Falls back to
  // the settings management view when there's no chat yet — reminders
  // (no chat by design), or ai_tasks that have never fired.
  const handleOpenTask = useCallback(
    (e: React.MouseEvent, task: ScheduledTask) => {
      e.preventDefault();
      e.stopPropagation();
      if (task.kind === "ai_task" && task.session_id) {
        router.push(`/chat/${task.session_id}`);
        return;
      }
      router.push(`/settings/tasks?taskId=${task.id}`);
    },
    [router],
  );

  const buckets = groupTasksByBucket(tasks);

  return (
    <div className="px-2 pt-1 pb-2">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className={cn(
          "flex w-full items-center gap-1 px-3 h-7 cursor-pointer select-none rounded-xl",
          "transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
        )}
      >
        <span className="text-[13px] font-semibold text-sidebar-foreground/55">
          {t("settings.tasks" as TranslationKey)}
        </span>
        {tasks.length > 0 && (
          <span className="text-[11px] font-normal text-muted-foreground/70">
            {tasks.length}
          </span>
        )}
        <span className="text-muted-foreground/80 ml-auto">
          {collapsed ? <CaretRight size={12} /> : <CaretDown size={12} />}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            style={{ overflow: "hidden" }}
          >
            {tasks.length === 0 ? (
              <div className="px-3 py-3">
                <p className="text-[11px] text-muted-foreground/70">
                  {t("tasks.empty" as TranslationKey)}
                </p>
                <button
                  type="button"
                  onClick={() => router.push("/settings/tasks")}
                  className="mt-1.5 text-[11px] font-medium text-primary hover:underline"
                >
                  {t("tasks.manageAll" as TranslationKey)}
                </button>
              </div>
            ) : (
              <div className="flex flex-col">
                {buckets.map((bucket) => (
                  <div key={bucket.id} className="mt-1">
                    <div className="px-3 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                      {t(BUCKET_LABEL_KEY[bucket.id])}
                    </div>
                    {bucket.tasks.map((task) => {
                      const isHovered = hovered === task.id;
                      const isRunning = task.last_status === "running";
                      const priorityDotClass =
                        task.priority === "urgent"
                          ? "bg-status-error"
                          : task.priority === "low"
                            ? "bg-muted-foreground/40"
                            : "bg-muted-foreground/70";
                      return (
                        <button
                          key={task.id}
                          type="button"
                          onMouseEnter={() => setHovered(task.id)}
                          onMouseLeave={() => setHovered(null)}
                          onClick={(e) => handleOpenTask(e, task)}
                          className={cn(
                            "group flex items-start gap-2 rounded-xl px-3 py-1.5 cursor-pointer select-none transition-colors",
                            "hover:bg-sidebar-accent",
                            "text-left w-full",
                          )}
                        >
                          <div className="flex flex-col items-center pt-0.5">
                            <CodePilotIcon
                              name="task"
                              size="sm"
                              className={cn(
                                "shrink-0",
                                isRunning ? "text-primary animate-pulse" : "text-muted-foreground",
                              )}
                              aria-hidden
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="flex-1 truncate text-[13px] font-normal text-sidebar-foreground">
                                {task.name}
                              </span>
                              <span
                                className={cn(
                                  "h-1.5 w-1.5 rounded-full shrink-0",
                                  priorityDotClass,
                                )}
                                aria-label={task.priority}
                              />
                            </div>
                            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
                              <span className="truncate font-mono">
                                {task.schedule_value}
                              </span>
                              <span className="text-muted-foreground/40">·</span>
                              <span className="shrink-0">
                                {task.kind === "reminder"
                                  ? t("tasks.kindReminder" as TranslationKey)
                                  : t("tasks.kindAiTask" as TranslationKey)}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center shrink-0">
                            {isHovered ? (
                              <div className="flex items-center gap-0.5">
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                  title={t("tasks.runNow" as TranslationKey)}
                                  onClick={(e) => handleRunNow(e, task.id)}
                                >
                                  <CodePilotIcon name="play" size="sm" aria-hidden />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                  title={t("tasks.openInSettings" as TranslationKey)}
                                  onClick={(e) => handleOpenInSettings(e, task.id)}
                                >
                                  <CodePilotIcon name="external" size="sm" aria-hidden />
                                </Button>
                              </div>
                            ) : (
                              <span className="text-[11px] text-muted-foreground/70 shrink-0 tabular-nums">
                                {formatRelativeNextRun(task.next_run)}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => router.push("/settings/tasks")}
                  className="mt-1.5 px-3 py-1.5 text-left text-[11px] font-semibold text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors"
                >
                  {t("tasks.manageAll" as TranslationKey)} →
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
