import os
import json
import logging
from datetime import datetime
from PySide6.QtCore import QObject, Signal
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger

logger = logging.getLogger("Scheduler")

class ProgramScheduler(QObject):
    """
    Manages automated media schedules. Uses APScheduler to trigger events based
    on specific timestamps or recurring weekly rules.
    Schedules are persisted in 'schedules.json'.
    """
    # Signal emitted when a schedule trigger occurs
    # Sends a dict containing track details: {path, title, loop_count}
    trigger_playback = Signal(dict)
    
    # Signal emitted when schedule list changes
    schedules_changed = Signal(list)

    def __init__(self, db_path="schedules.json", settings_path="settings.json"):
        super().__init__()
        self.db_path = db_path
        self.settings_path = settings_path
        
        # Load timezone from settings.json
        self.timezone = "Asia/Bangkok"
        if os.path.exists(self.settings_path):
            try:
                with open(self.settings_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.timezone = data.get("scheduler_timezone", "Asia/Bangkok")
            except Exception as e:
                logger.error(f"Error loading settings timezone: {e}")
                
        self.scheduler = BackgroundScheduler(timezone=self.timezone)
        self.schedules = []
        
        # Load stored schedules
        self.load_schedules()
        
        # Start the background execution engine
        self.scheduler.start()
        logger.info(f"APScheduler background engine started with timezone: {self.timezone}")

    def update_timezone(self, timezone_str):
        """Updates the scheduler timezone dynamically."""
        if self.timezone == timezone_str:
            return
        logger.info(f"Updating scheduler timezone from {self.timezone} to {timezone_str}")
        self.timezone = timezone_str
        
        # Recreate scheduler with new timezone
        try:
            self.scheduler.shutdown(wait=False)
        except Exception as e:
            logger.error(f"Error shutting down scheduler: {e}")
            
        self.scheduler = BackgroundScheduler(timezone=self.timezone)
        self.scheduler.start()
        self._refresh_jobs()

    def load_schedules(self):
        """Loads schedule items from JSON store."""
        if os.path.exists(self.db_path):
            try:
                with open(self.db_path, 'r', encoding='utf-8') as f:
                    self.schedules = json.load(f)
                logger.info(f"Loaded {len(self.schedules)} schedules from {self.db_path}.")
            except Exception as e:
                logger.error(f"Error reading schedules.json: {e}")
                self.schedules = []
        else:
            self.schedules = []
            self.save_schedules()
            
        self._refresh_jobs()

    def save_schedules(self):
        """Saves current schedule items to JSON store."""
        try:
            with open(self.db_path, 'w', encoding='utf-8') as f:
                json.dump(self.schedules, f, indent=4)
            logger.info("Schedules stored successfully.")
        except Exception as e:
            logger.error(f"Failed to write schedules to {self.db_path}: {e}")

    def add_schedule(self, name, time_str, days=None, date_str=None, target_path="", target_title="", loop_count=1, enabled=True):
        """
        Adds a new schedule configuration.
        - time_str: "HH:MM:SS" format.
        - days: list of lowercase strings (e.g. ['mon', 'tue']) for weekly recurring.
        - date_str: "YYYY-MM-DD" format for one-time triggers.
        """
        import uuid
        sched_id = str(uuid.uuid4())
        
        schedule_item = {
            'id': sched_id,
            'name': name,
            'time': time_str,
            'days': days or [],
            'date': date_str or "",
            'target_path': target_path,
            'target_title': target_title or os.path.basename(target_path),
            'loop_count': loop_count,
            'enabled': enabled
        }
        
        self.schedules.append(schedule_item)
        self.save_schedules()
        self._refresh_jobs()
        self.schedules_changed.emit(self.schedules)
        return sched_id

    def delete_schedule(self, sched_id):
        """Removes a schedule by ID."""
        self.schedules = [s for s in self.schedules if s['id'] != sched_id]
        self.save_schedules()
        self._refresh_jobs()
        self.schedules_changed.emit(self.schedules)

    def toggle_schedule(self, sched_id, enabled):
        """Enables/disables a schedule by ID."""
        for s in self.schedules:
            if s['id'] == sched_id:
                s['enabled'] = enabled
                break
        self.save_schedules()
        self._refresh_jobs()
        self.schedules_changed.emit(self.schedules)

    def _refresh_jobs(self):
        """
        Clears all active APScheduler jobs and re-registers enabled ones.
        """
        # Clear currently scheduled jobs
        self.scheduler.remove_all_jobs()
        logger.info("Cleared active scheduler jobs.")

        for s in self.schedules:
            if not s['enabled']:
                continue

            try:
                trigger = None
                time_obj = datetime.strptime(s['time'], "%H:%M:%S").time()

                if s['date']:
                    # One-time Date Trigger
                    date_obj = datetime.strptime(s['date'], "%Y-%m-%d").date()
                    run_datetime = datetime.combine(date_obj, time_obj)
                    
                    # If date has already passed, skip scheduling it
                    if run_datetime < datetime.now():
                        logger.warning(f"Skipped scheduling expired one-time task: {s['name']}")
                        continue
                        
                    trigger = DateTrigger(run_date=run_datetime)
                    logger.info(f"Scheduled Date Job '{s['name']}' at {run_datetime}")
                
                elif s['days']:
                    # Weekly Recurring Cron Trigger
                    day_str = ",".join(s['days']) # e.g. "mon,tue,wed"
                    trigger = CronTrigger(
                        day_of_week=day_str,
                        hour=time_obj.hour,
                        minute=time_obj.minute,
                        second=time_obj.second
                    )
                    logger.info(f"Scheduled Weekly Job '{s['name']}' on [{day_str}] at {s['time']}")
                
                else:
                    # Daily Cron Trigger (no days specified, triggers every day)
                    trigger = CronTrigger(
                        hour=time_obj.hour,
                        minute=time_obj.minute,
                        second=time_obj.second
                    )
                    logger.info(f"Scheduled Daily Job '{s['name']}' at {s['time']}")

                if trigger:
                    self.scheduler.add_job(
                        func=self._on_job_trigger,
                        trigger=trigger,
                        args=[s],
                        id=s['id']
                    )
            except Exception as e:
                logger.error(f"Failed to load schedule for job '{s['name']}': {e}")

    def _on_job_trigger(self, schedule_dict):
        """Callback run by APScheduler in a background thread."""
        logger.info(f"SCHEDULE TRIGGERED: {schedule_dict['name']}")
        track_info = {
            'path': schedule_dict['target_path'],
            'title': schedule_dict['target_title'],
            'loop_count': schedule_dict['loop_count']
        }
        self.trigger_playback.emit(track_info)

    def get_next_run(self, sched_id):
        """Returns the next run datetime object for a schedule, or None."""
        job = self.scheduler.get_job(sched_id)
        if job:
            return job.next_run_time
        return None

    def update_schedule(self, sched_id, name, time_str, days=None, date_str=None, target_path="", target_title="", loop_count=1, enabled=True):
        """Updates an existing schedule configuration."""
        for s in self.schedules:
            if s['id'] == sched_id:
                s['name'] = name
                s['time'] = time_str
                s['days'] = days or []
                s['date'] = date_str or ""
                s['target_path'] = target_path
                s['target_title'] = target_title or os.path.basename(target_path)
                s['loop_count'] = loop_count
                s['enabled'] = enabled
                break
        self.save_schedules()
        self._refresh_jobs()
        self.schedules_changed.emit(self.schedules)

    def shutdown(self):
        """Shuts down the scheduler gracefully."""
        self.scheduler.shutdown()
        logger.info("Scheduler shutdown complete.")
