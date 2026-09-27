/**
 * Scheduler Engine — Client-side scheduled playback service.
 *
 * Runs an active timer loop every 5 seconds.
 * Evaluates active schedules from useSchedulerStore.
 * When matching the current time and day:
 * 1. Sets the volume as configured in the schedule job.
 * 2. Adds the track with loop count to the playlist.
 * 3. Immediately triggers playback (which also broadcasts to streaming receivers).
 * 4. Displays an alert toast in the UI.
 */
import { useSchedulerStore, ScheduleJob } from '../stores/useSchedulerStore';
import { usePlayerStore } from '../stores/usePlayerStore';
import { usePlaylistStore } from '../stores/usePlaylistStore';
import { streamController } from './stream-controller';

/**
 * Check if a given day index (0 = Sun, 1 = Mon, ..., 6 = Sat) matches configured days.
 * Supports day name strings ('mon', 'tue', etc.) and numeric strings ('1', '2', etc., and '0' or '7' for Sun).
 */
export function isDayMatched(dayIndex: number, days?: string[]): boolean {
  if (!days || days.length === 0) return true;
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const currentDayName = dayNames[dayIndex];
  const currentDayIndexStr = String(dayIndex);

  return days.some((d) => {
    const norm = String(d).toLowerCase().trim();
    if (norm === currentDayName || norm === currentDayIndexStr) return true;
    if (dayIndex === 0 && (norm === '7' || norm === 'sun')) return true;
    return false;
  });
}

type ScheduledAlertListener = (message: string | null) => void;

class SchedulerEngineService {
  private timer: number | null = null;
  private firedHistory = new Set<string>();
  private alertListeners = new Set<ScheduledAlertListener>();
  private currentAlertTimeout: number | null = null;
  private isStarted = false;

  public onAlert(listener: ScheduledAlertListener): () => void {
    this.alertListeners.add(listener);
    return () => this.alertListeners.delete(listener);
  }

  private notifyAlert(msg: string): void {
    if (this.currentAlertTimeout) {
      clearTimeout(this.currentAlertTimeout);
    }
    this.alertListeners.forEach((fn) => {
      try { fn(msg); } catch (e) { console.error(e); }
    });
    this.currentAlertTimeout = window.setTimeout(() => {
      this.alertListeners.forEach((fn) => {
        try { fn(null); } catch (e) { console.error(e); }
      });
      this.currentAlertTimeout = null;
    }, 6000);
  }

  private unsubscribeTrigger: (() => void) | null = null;

  /**
   * Start the scheduler ticker.
   */
  public start(intervalMs = 5000): void {
    if (this.isStarted) return;
    this.isStarted = true;

    // Load initial schedules if not yet loaded
    const store = useSchedulerStore.getState();
    if (store.schedules.length === 0) {
      store.loadSchedules();
    }

    // Subscribe to server-side scheduler trigger over WebSocket
    this.unsubscribeTrigger = streamController.onSchedulerTrigger((job) => {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const todayDate = `${year}-${month}-${day}`;
      const firedKey = `${job.id}_${todayDate}_${job.time}`;

      // Deduplicate if already fired locally
      if (!this.firedHistory.has(firedKey)) {
        this.firedHistory.add(firedKey);
        this.triggerJob(job, 'server').catch((err) =>
          console.error('[SchedulerEngine] Server job execution failed:', err)
        );
      }
    });

    // Run immediate check
    this.checkSchedules();

    this.timer = window.setInterval(() => {
      this.checkSchedules();
    }, intervalMs);

    // Re-check immediately if window becomes visible (e.g. computer wakes from sleep)
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  /**
   * Stop the scheduler ticker.
   */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.unsubscribeTrigger) {
      this.unsubscribeTrigger();
      this.unsubscribeTrigger = null;
    }
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.isStarted = false;
  }

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      this.checkSchedules();
    }
  };

  /**
   * Trigger a scheduled job immediately.
   */
  public async triggerJob(job: ScheduleJob, source: 'timer' | 'server' | 'manual' = 'timer'): Promise<void> {
    const filename = job.filename;
    if (!filename) return;

    console.log(`[SchedulerEngine] 🔔 Triggering job (${source}): "${job.name}" (${filename})`);

    // 1. Set configured playback volume
    const targetVol = typeof job.volume === 'number' ? job.volume / 100 : 0.8;
    usePlayerStore.getState().setVolume(targetVol);

    // 2. Add track to playlist with configured loop count and play
    const playlist = usePlaylistStore.getState();
    const cleanPath = filename.replace(/^\/+/, '');
    const loopCount = job.loop !== undefined ? job.loop : 1;

    // Add track to playlist
    const newIdx = playlist.addTrack(cleanPath, loopCount, true);
    await playlist.playIndex(newIdx);

    // 3. Show status notification
    const alertMsg = `🔔 ตารางเวลาทำงาน: ${job.name} (${job.time})`;
    this.notifyAlert(alertMsg);
  }

  /**
   * Test play a schedule job directly.
   */
  public async testPlay(job: ScheduleJob): Promise<void> {
    await this.triggerJob(job, 'manual');
  }

  /**
   * Check all enabled schedules against the current clock time.
   */
  public checkSchedules(): void {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const timeStr = `${hours}:${minutes}`;
    const dayOfWeek = now.getDay(); // 0 = Sun, 1 = Mon ...
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const todayDate = `${year}-${month}-${day}`;

    // Clean up fired history for previous dates
    for (const key of Array.from(this.firedHistory)) {
      if (!key.includes(todayDate)) {
        this.firedHistory.delete(key);
      }
    }

    const schedules = useSchedulerStore.getState().schedules;
    if (!schedules || schedules.length === 0) return;

    for (const job of schedules) {
      if (!job.enabled) continue;
      if (job.time !== timeStr) continue;

      const firedKey = `${job.id}_${todayDate}_${job.time}`;
      if (this.firedHistory.has(firedKey)) continue;

      let shouldFire = false;
      if (job.type === 'daily') {
        shouldFire = true;
      } else if (job.type === 'weekly') {
        shouldFire = isDayMatched(dayOfWeek, job.days);
      } else if (job.type === 'once') {
        shouldFire = job.date === todayDate;
      }

      if (shouldFire) {
        this.firedHistory.add(firedKey);
        this.triggerJob(job, 'timer').catch((err) =>
          console.error('[SchedulerEngine] Job execution failed:', err)
        );
      }
    }
  }
}

export const schedulerEngine = new SchedulerEngineService();
