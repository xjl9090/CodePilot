import type { ScheduledTask } from "@/types";

export type TaskBucketId =
  | "dueSoon"
  | "today"
  | "tomorrow"
  | "thisWeek"
  | "later"
  | "overdue";

export interface TaskBucket {
  id: TaskBucketId;
  tasks: ScheduledTask[];
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Bucket scheduled tasks by `next_run` relative to `now`.
 *
 * Daily-cron tasks whose `next_run` is tomorrow morning still earn a
 * place in the user's view, so we don't filter to "today only" — we
 * group by relative recency instead. Empty buckets are dropped.
 *
 * Order:
 *   overdue   → next_run < now (failure / paused with stale next_run)
 *   dueSoon   → 0 ≤ Δ < 1h
 *   today     → 1h ≤ Δ < end-of-today (local)
 *   tomorrow  → next_run is tomorrow's local date
 *   thisWeek  → 2-7 days out
 *   later     → > 7 days
 */
export function groupTasksByBucket(
  tasks: ScheduledTask[],
  nowMs: number = Date.now(),
): TaskBucket[] {
  const startOfToday = startOfDay(nowMs);
  const startOfTomorrow = startOfToday + DAY_MS;
  const startOfDayAfter = startOfToday + 2 * DAY_MS;
  const startOfWeekEnd = startOfToday + 7 * DAY_MS;

  const buckets: Record<TaskBucketId, ScheduledTask[]> = {
    overdue: [],
    dueSoon: [],
    today: [],
    tomorrow: [],
    thisWeek: [],
    later: [],
  };

  // Sort once by next_run ascending so each bucket is in time order.
  const sorted = [...tasks].sort((a, b) => parseTs(a.next_run) - parseTs(b.next_run));

  for (const task of sorted) {
    const ts = parseTs(task.next_run);
    if (Number.isNaN(ts)) continue;
    const delta = ts - nowMs;

    if (delta < 0) {
      buckets.overdue.push(task);
    } else if (delta < HOUR_MS) {
      buckets.dueSoon.push(task);
    } else if (ts < startOfTomorrow) {
      buckets.today.push(task);
    } else if (ts < startOfDayAfter) {
      buckets.tomorrow.push(task);
    } else if (ts < startOfWeekEnd) {
      buckets.thisWeek.push(task);
    } else {
      buckets.later.push(task);
    }
  }

  const order: TaskBucketId[] = ["overdue", "dueSoon", "today", "tomorrow", "thisWeek", "later"];
  return order
    .filter((id) => buckets[id].length > 0)
    .map((id) => ({ id, tasks: buckets[id] }));
}

/**
 * Short relative-time string for the next_run field. Tuned for the
 * sidebar — terse over precise.
 *   <1m       → "now"
 *   <1h       → "in 12m"
 *   <24h same-day → "in 3h"
 *   tomorrow  → "tomorrow 09:00"
 *   else      → local Mon 09:00 / Apr 12 09:00
 *   past      → "Xm ago" / "Xh ago"
 */
export function formatRelativeNextRun(
  nextRun: string,
  nowMs: number = Date.now(),
  locale: string = typeof navigator !== "undefined" ? navigator.language : "en-US",
): string {
  const ts = parseTs(nextRun);
  if (Number.isNaN(ts)) return "—";
  const delta = ts - nowMs;
  const absMin = Math.round(Math.abs(delta) / 60_000);

  if (delta < 0) {
    if (absMin < 1) return "just now";
    if (absMin < 60) return `${absMin}m ago`;
    const absH = Math.round(absMin / 60);
    if (absH < 24) return `${absH}h ago`;
    return new Date(ts).toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  if (absMin < 1) return "now";
  if (absMin < 60) return `in ${absMin}m`;
  const absH = Math.round(absMin / 60);
  if (absH < 24) {
    const sameDay = startOfDay(ts) === startOfDay(nowMs);
    if (sameDay) return `in ${absH}h`;
  }

  const date = new Date(ts);
  const time = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const startOfTomorrow = startOfDay(nowMs) + DAY_MS;
  if (ts >= startOfTomorrow && ts < startOfTomorrow + DAY_MS) {
    return `tomorrow ${time}`;
  }
  return date.toLocaleDateString(locale, { month: "short", day: "numeric" }) + " " + time;
}

function parseTs(iso: string | undefined): number {
  if (!iso) return Number.NaN;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? Number.NaN : t;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
