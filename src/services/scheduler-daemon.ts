/**
 * Scheduler Daemon — Background execution engine for automated media broadcasting.
 *
 * Runs on the Bun server 24/7. Evaluates schedules every 10 seconds against
 * the current system time and day of week.
 *
 * When a scheduled job fires:
 * 1. If a master controller is connected over WebSocket, sends a 'scheduler_trigger' event.
 * 2. If speaker/video receivers are connected (or standby), directly broadcasts volume and play commands.
 */
import { loadSchedules, isVideoPath, type ScheduleJob } from "../utils/storage";
import {
  broadcastToReceivers,
  relayToController,
  ensureStreamingRoom,
} from "../routes/streaming";

/**
 * Universal day matcher.
 * Matches day index (0 = Sun, 1 = Mon, ..., 6 = Sat) against configured days array.
 * Supports both name strings ('mon', 'tue', etc.) and numeric strings ('1', '2', etc., and '0' or '7' for Sun).
 */
export function isDayMatched(dayIndex: number, days?: string[]): boolean {
  if (!days || days.length === 0) return true;
  const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const currentDayName = dayNames[dayIndex];
  const currentDayIndexStr = String(dayIndex);

  return days.some((d) => {
    const norm = String(d).toLowerCase().trim();
    if (norm === currentDayName || norm === currentDayIndexStr) return true;
    if (dayIndex === 0 && (norm === "7" || norm === "sun")) return true;
    return false;
  });
}

// Track fired jobs in memory to avoid duplicate triggers within the same minute
const firedHistory = new Set<string>();
let checkInterval: ReturnType<typeof setInterval> | null = null;

export function clearFiredHistory(): void {
  firedHistory.clear();
}

export async function checkAndRunSchedules(customDate?: Date): Promise<ScheduleJob[]> {
  const now = customDate || new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const timeStr = `${hours}:${minutes}`;
  const dayOfWeek = now.getDay();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const todayDate = `${year}-${month}-${day}`;

  // Prune history from previous days
  for (const key of Array.from(firedHistory)) {
    if (!key.includes(todayDate)) {
      firedHistory.delete(key);
    }
  }

  const schedules = await loadSchedules();
  const triggered: ScheduleJob[] = [];

  for (const job of schedules) {
    if (!job.enabled) continue;
    if (job.time !== timeStr) continue;

    const firedKey = `${job.id}_${todayDate}_${job.time}`;
    if (firedHistory.has(firedKey)) continue;

    let shouldFire = false;
    if (job.type === "daily") {
      shouldFire = true;
    } else if (job.type === "weekly") {
      shouldFire = isDayMatched(dayOfWeek, job.days);
    } else if (job.type === "once") {
      shouldFire = job.date === todayDate;
    }

    if (shouldFire) {
      firedHistory.add(firedKey);
      triggered.push(job);
      console.log(
        `[SchedulerDaemon] 🔔 Triggering schedule: "${job.name}" (${job.filename}) at ${job.time} (Vol: ${job.volume}%, Loop: ${job.loop})`
      );

      // 1. Notify connected controller
      relayToController({
        type: "scheduler_trigger",
        job,
      });

      // 2. Broadcast directly to all receiver speakers/displays
      ensureStreamingRoom();
      broadcastToReceivers({
        type: "volume",
        volume: job.volume ?? 80,
      });
      broadcastToReceivers({
        type: "play",
        filename: job.filename,
        loop: job.loop ?? 1,
        isVideo: isVideoPath(job.filename),
      });
    }
  }

  return triggered;
}

export function startSchedulerDaemon(intervalMs = 10000): void {
  if (checkInterval) return;
  console.log("[SchedulerDaemon] Starting background scheduler daemon (interval 10s)...");

  // Initial check shortly after startup
  setTimeout(() => {
    checkAndRunSchedules().catch((err) =>
      console.error("[SchedulerDaemon] Startup check error:", err)
    );
  }, 1000);

  checkInterval = setInterval(() => {
    checkAndRunSchedules().catch((err) =>
      console.error("[SchedulerDaemon] Check error:", err)
    );
  }, intervalMs);
}

export function stopSchedulerDaemon(): void {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
    console.log("[SchedulerDaemon] Stopped background scheduler daemon.");
  }
}
