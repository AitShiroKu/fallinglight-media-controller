import React, { useState, useEffect } from 'react';
import { useSchedulerStore, ScheduleJob } from '../stores/useSchedulerStore';
import { useFileStore } from '../stores/useFileStore';
import { useI18n } from '../services/i18n';
import {
  Calendar,
  Clock,
  Music,
  Volume2,
  Repeat,
  X,
  Plus,
  Check,
} from 'lucide-react';

interface ScheduleModalProps {
  isOpen: boolean;
  editingJob: ScheduleJob | null;
  onClose: () => void;
}

const DAYS = [
  { id: 'mon', key: 'day_mon' },
  { id: 'tue', key: 'day_tue' },
  { id: 'wed', key: 'day_wed' },
  { id: 'thu', key: 'day_thu' },
  { id: 'fri', key: 'day_fri' },
  { id: 'sat', key: 'day_sat' },
  { id: 'sun', key: 'day_sun' },
];

const NUM_TO_NAME: Record<string, string> = {
  '1': 'mon',
  '2': 'tue',
  '3': 'wed',
  '4': 'thu',
  '5': 'fri',
  '6': 'sat',
  '0': 'sun',
  '7': 'sun',
};

function normalizeDays(days?: string[]): string[] {
  if (!days || days.length === 0) return ['mon', 'tue', 'wed', 'thu', 'fri'];
  return days.map((d) => NUM_TO_NAME[d] || d.toLowerCase());
}

export default function ScheduleModal({ isOpen, editingJob, onClose }: ScheduleModalProps) {
  const { createSchedule, updateSchedule } = useSchedulerStore();
  const { files } = useFileStore();
  const { t } = useI18n();

  const [name, setName] = useState('');
  const [type, setType] = useState<'once' | 'daily' | 'weekly'>('daily');
  const [time, setTime] = useState('07:50');
  const [date, setDate] = useState('');
  const [selectedDays, setSelectedDays] = useState<string[]>(['mon', 'tue', 'wed', 'thu', 'fri']);
  const [filename, setFilename] = useState('');
  const [volume, setVolume] = useState(80);
  const [loop, setLoop] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (editingJob) {
      setName(editingJob.name);
      setType(editingJob.type);
      setTime(editingJob.time);
      setDate(editingJob.date || '');
      setSelectedDays(normalizeDays(editingJob.days));
      setFilename(editingJob.filename);
      setVolume(editingJob.volume ?? 80);
      setLoop(editingJob.loop ?? 1);
    } else {
      setName('');
      setType('daily');
      setTime('07:50');
      setDate(new Date().toISOString().slice(0, 10));
      setSelectedDays(['mon', 'tue', 'wed', 'thu', 'fri']);
      setFilename(files.length > 0 ? files[0].path : '');
      setVolume(80);
      setLoop(1);
    }
  }, [editingJob, isOpen, files]);

  if (!isOpen) return null;

  const toggleDay = (dayId: string) => {
    setSelectedDays((prev) =>
      prev.includes(dayId) ? prev.filter((d) => d !== dayId) : [...prev, dayId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !time || !filename || isSubmitting) return;

    setIsSubmitting(true);

    const payload: any = {
      name: name.trim(),
      type,
      time,
      filename,
      volume,
      loop,
    };

    if (type === 'once') {
      payload.date = date;
    } else if (type === 'weekly') {
      payload.days = selectedDays;
    }

    let ok = false;
    if (editingJob) {
      ok = await updateSchedule(editingJob.id, payload);
    } else {
      ok = await createSchedule(payload);
    }

    setIsSubmitting(false);
    if (ok) {
      onClose();
    } else {
      alert('Failed to save schedule');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-dark-800 border border-dark-500 rounded-3xl p-5 sm:p-6 shadow-2xl flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-accent/20 text-accent flex items-center justify-center">
              <Calendar className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-white">
              {editingJob ? t('dialog_edit_schedule') : t('dialog_add_schedule')}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="touch-btn text-muted hover:text-white p-1 rounded-lg hover:bg-dark-700 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-xs">
          {/* Schedule Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-gray-300 font-medium">{t('label_schedule_name')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('placeholder_schedule_name')}
              required
              className="w-full bg-dark-900 border border-dark-500 rounded-xl px-3.5 py-2.5 text-white placeholder-dark-500 focus:border-accent focus:outline-none"
            />
          </div>

          {/* Schedule Type Selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-gray-300 font-medium">{t('label_schedule_type')}</label>
            <div className="grid grid-cols-3 gap-2">
              {(['daily', 'weekly', 'once'] as const).map((tVal) => (
                <button
                  key={tVal}
                  type="button"
                  onClick={() => setType(tVal)}
                  className={`touch-btn py-2 px-2.5 rounded-xl font-semibold border transition text-center capitalize ${
                    type === tVal
                      ? 'bg-accent/20 text-accent border-accent/50'
                      : 'bg-dark-900/60 text-muted border-dark-600/50 hover:bg-dark-700'
                  }`}
                >
                  {tVal === 'daily'
                    ? t('schedule_daily')
                    : tVal === 'weekly'
                    ? t('schedule_weekly')
                    : t('schedule_once')}
                </button>
              ))}
            </div>
          </div>

          {/* Time Picker */}
          <div className="flex flex-col gap-1.5">
            <label className="text-gray-300 font-medium flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-accent" />
              {t('label_time')}
            </label>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              required
              className="w-full bg-dark-900 border border-dark-500 rounded-xl px-3.5 py-2 text-white focus:border-accent focus:outline-none font-mono"
            />
          </div>

          {/* Date Picker (If Type == once) */}
          {type === 'once' && (
            <div className="flex flex-col gap-1.5 animate-in fade-in">
              <label className="text-gray-300 font-medium">{t('label_date')}</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="w-full bg-dark-900 border border-dark-500 rounded-xl px-3.5 py-2 text-white focus:border-accent focus:outline-none font-mono"
              />
            </div>
          )}

          {/* Days of Week (If Type == weekly) */}
          {type === 'weekly' && (
            <div className="flex flex-col gap-1.5 animate-in fade-in">
              <label className="text-gray-300 font-medium">{t('label_days_of_week')}</label>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((d) => {
                  const isSelected = selectedDays.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => toggleDay(d.id)}
                      className={`touch-btn min-h-[32px] px-3 py-1 rounded-xl text-[11px] font-bold border transition ${
                        isSelected
                          ? 'bg-accent text-white border-accent'
                          : 'bg-dark-900 text-muted border-dark-600/60 hover:bg-dark-700'
                      }`}
                    >
                      {t(d.key as any)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Media File Selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-gray-300 font-medium flex items-center gap-1.5">
              <Music className="w-3.5 h-3.5 text-yellow-400" />
              {t('label_media_source')}
            </label>
            <select
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              required
              className="w-full bg-dark-900 border border-dark-500 rounded-xl px-3.5 py-2.5 text-white focus:border-accent focus:outline-none"
            >
              {files.length === 0 ? (
                <option value="">(No files available)</option>
              ) : (
                files.map((f) => (
                  <option key={f.path} value={f.path}>
                    {f.path} ({f.sizeFormatted})
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Volume & Loop Grid */}
          <div className="grid grid-cols-2 gap-3">
            {/* Volume */}
            <div className="flex flex-col gap-1.5">
              <label className="text-gray-300 font-medium flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                  {t('label_volume')}
                </span>
                <span className="font-mono text-muted">{volume}%</span>
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                className="w-full h-1.5 bg-dark-700 rounded-full appearance-none cursor-pointer accent-accent"
              />
            </div>

            {/* Loop Count */}
            <div className="flex flex-col gap-1.5">
              <label className="text-gray-300 font-medium flex items-center gap-1">
                <Repeat className="w-3.5 h-3.5 text-accent" />
                {t('label_loop_count')}
              </label>
              <input
                type="number"
                min="1"
                max="100"
                value={loop}
                onChange={(e) => setLoop(Number(e.target.value))}
                required
                className="w-full bg-dark-900 border border-dark-500 rounded-xl px-3 py-1.5 text-white focus:border-accent focus:outline-none font-mono"
              />
            </div>
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-dark-600/60">
            <button
              type="button"
              onClick={onClose}
              className="touch-btn px-4 py-2 rounded-xl font-semibold text-gray-300 hover:bg-dark-700 transition"
            >
              {t('btn_cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim() || !filename}
              className="touch-btn px-5 py-2 rounded-xl bg-accent hover:bg-accent-light text-white font-bold shadow-md shadow-accent/25 transition disabled:opacity-50"
            >
              {isSubmitting ? 'Saving...' : editingJob ? t('btn_save') : t('btn_add')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
