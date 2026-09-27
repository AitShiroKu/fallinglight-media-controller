import React, { useEffect, useState, useRef } from 'react';
import { useSchedulerStore, ScheduleJob } from '../stores/useSchedulerStore';
import { useI18n } from '../services/i18n';
import ScheduleModal from './ScheduleModal';
import {
  Calendar,
  Plus,
  Download,
  Upload,
  Trash2,
  Edit2,
  Clock,
  Music,
  CheckCircle2,
  AlertCircle,
  Volume2,
  Repeat,
  Play,
} from 'lucide-react';
import { schedulerEngine } from '../services/scheduler-engine';

const DAY_KEY_MAP: Record<string, string> = {
  '1': 'day_mon',
  '2': 'day_tue',
  '3': 'day_wed',
  '4': 'day_thu',
  '5': 'day_fri',
  '6': 'day_sat',
  '0': 'day_sun',
  '7': 'day_sun',
  'mon': 'day_mon',
  'tue': 'day_tue',
  'wed': 'day_wed',
  'thu': 'day_thu',
  'fri': 'day_fri',
  'sat': 'day_sat',
  'sun': 'day_sun',
};

export default function SchedulerDeck() {
  const {
    schedules,
    isLoading,
    loadSchedules,
    deleteSchedule,
    toggleSchedule,
    exportSchedules,
    importSchedules,
  } = useSchedulerStore();

  const { t } = useI18n();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<ScheduleJob | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const importFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadSchedules();
  }, [loadSchedules]);

  const handleEdit = (job: ScheduleJob) => {
    setEditingJob(job);
    setIsModalOpen(true);
  };

  const handleAddNew = () => {
    setEditingJob(null);
    setIsModalOpen(true);
  };

  const handleDelete = async (job: ScheduleJob) => {
    if (confirm(`${t('confirm_delete')} (${job.name})`)) {
      await deleteSchedule(job.id);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const res = await importSchedules(file);
    if (res.success) {
      setStatusMessage(`Imported ${res.imported} schedule(s) successfully!`);
      setTimeout(() => setStatusMessage(null), 4000);
    } else {
      setErrorMessage(res.error || 'Failed to import schedules');
      setTimeout(() => setErrorMessage(null), 4000);
    }
    e.target.value = '';
  };

  const handleTestPlay = async (job: ScheduleJob) => {
    setStatusMessage(`${t('status_scheduled')}: ${job.name} (Test Play)`);
    await schedulerEngine.testPlay(job);
    setTimeout(() => setStatusMessage(null), 4000);
  };

  const formatScheduleTiming = (job: ScheduleJob) => {
    if (job.type === 'once') {
      return (
        <div className="flex flex-col">
          <span className="font-semibold text-accent">{job.time}</span>
          <span className="text-[10px] text-muted font-mono">{job.date || 'Once'}</span>
        </div>
      );
    }
    if (job.type === 'daily') {
      return (
        <div className="flex flex-col">
          <span className="font-semibold text-accent">{job.time}</span>
          <span className="text-[10px] text-emerald-400 font-mono">{t('schedule_daily')}</span>
        </div>
      );
    }
    if (job.type === 'weekly') {
      const daysStr = (job.days || [])
        .map((d) => t(DAY_KEY_MAP[d.toLowerCase()] || d))
        .join(', ');
      return (
        <div className="flex flex-col">
          <span className="font-semibold text-accent">{job.time}</span>
          <span className="text-[10px] text-indigo-400 font-mono truncate max-w-[130px]" title={daysStr}>
            {daysStr || t('schedule_weekly')}
          </span>
        </div>
      );
    }
    return <span className="font-mono text-accent">{job.time}</span>;
  };

  return (
    <div className="flex-1 flex flex-col gap-4 overflow-hidden">
      {/* Schedule Edit/Add Modal */}
      <ScheduleModal
        isOpen={isModalOpen}
        editingJob={editingJob}
        onClose={() => setIsModalOpen(false)}
      />

      {/* Hidden File Input for Import */}
      <input
        type="file"
        ref={importFileRef}
        onChange={handleImport}
        accept=".json"
        className="hidden"
      />

      {/* Toolbar Header */}
      <div className="bg-dark-800/80 border border-dark-500/80 rounded-3xl p-4 sm:p-5 flex items-center justify-between gap-3 flex-wrap shadow-xl">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-2xl bg-indigo-500/15 text-indigo-400 flex items-center justify-center">
            <Calendar className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
              {t('schedule_title')}
              <span className="text-xs font-mono text-muted bg-dark-900/80 px-2 py-0.5 rounded-full border border-dark-600/50">
                {schedules.length}
              </span>
            </h2>
            <p className="text-[11px] text-muted -mt-0.5">Automated broadcasting schedule</p>
          </div>
        </div>

        {/* Header Action Buttons */}
        <div className="flex items-center gap-2">
          {/* Export */}
          <button
            onClick={exportSchedules}
            className="touch-btn min-h-[36px] px-3 py-1.5 rounded-xl bg-dark-700 hover:bg-dark-600 border border-dark-500 text-xs font-semibold text-gray-200 flex items-center gap-1.5 transition active:scale-95"
            title="Export JSON"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t('btn_export')}</span>
          </button>

          {/* Import */}
          <button
            onClick={() => importFileRef.current?.click()}
            className="touch-btn min-h-[36px] px-3 py-1.5 rounded-xl bg-dark-700 hover:bg-dark-600 border border-dark-500 text-xs font-semibold text-gray-200 flex items-center gap-1.5 transition active:scale-95"
            title="Import JSON"
          >
            <Upload className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t('btn_import')}</span>
          </button>

          {/* Add Schedule */}
          <button
            onClick={handleAddNew}
            className="touch-btn min-h-[36px] px-4 py-1.5 rounded-xl bg-accent hover:bg-accent-light text-white text-xs font-bold shadow-md shadow-accent/25 flex items-center gap-1.5 transition active:scale-95"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t('btn_add_schedule')}</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {statusMessage && (
        <div className="bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs px-4 py-2 rounded-2xl flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="bg-rose-500/15 border border-rose-500/30 text-rose-400 text-xs px-4 py-2 rounded-2xl flex items-center gap-2 animate-in fade-in">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Schedules Table */}
      <div className="flex-1 bg-dark-800/80 border border-dark-500/80 rounded-3xl p-4 sm:p-5 flex flex-col gap-3 shadow-xl overflow-hidden min-h-[300px]">
        <div className="flex-1 overflow-auto rounded-2xl border border-dark-600/60 bg-dark-950/60">
          {schedules.length === 0 ? (
            <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-center p-8 gap-3 text-muted">
              <div className="w-14 h-14 rounded-2xl bg-dark-800 border border-dark-600/60 flex items-center justify-center text-dark-500 shadow-inner">
                <Calendar className="w-7 h-7" />
              </div>
              <p className="text-xs max-w-xs">{t('no_schedules')}</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-dark-800/90 sticky top-0 z-10 border-b border-dark-600/60 uppercase text-[10px] font-mono text-muted">
                <tr>
                  <th className="py-2.5 px-3 w-14 text-center">{t('col_enabled')}</th>
                  <th className="py-2.5 px-3">{t('col_name')}</th>
                  <th className="py-2.5 px-3 w-36 text-center">{t('col_schedule')}</th>
                  <th className="py-2.5 px-3">{t('col_media')}</th>
                  <th className="py-2.5 px-3 w-20 text-center">{t('col_vol')}</th>
                  <th className="py-2.5 px-3 w-16 text-center">{t('col_loop')}</th>
                  <th className="py-2.5 px-3 w-28 text-center">{t('col_actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-600/30">
                {schedules.map((job) => (
                  <tr
                    key={job.id}
                    className={`transition-all hover:bg-dark-700/50 ${
                      job.enabled ? 'text-gray-200' : 'text-dark-500 opacity-60'
                    }`}
                  >
                    {/* On/Off Toggle */}
                    <td className="py-3 px-3 text-center">
                      <button
                        onClick={() => toggleSchedule(job.id)}
                        className={`touch-btn w-9 h-5 rounded-full p-0.5 transition-colors mx-auto flex items-center ${
                          job.enabled ? 'bg-accent justify-end' : 'bg-dark-700 justify-start'
                        }`}
                        title={job.enabled ? 'Enabled' : 'Disabled'}
                      >
                        <div className="w-4 h-4 rounded-full bg-white shadow-md transition" />
                      </button>
                    </td>

                    {/* Name */}
                    <td className="py-3 px-3 font-semibold text-xs sm:text-sm text-gray-100">
                      {job.name}
                    </td>

                    {/* Timing */}
                    <td className="py-3 px-3 text-center">
                      {formatScheduleTiming(job)}
                    </td>

                    {/* Media File */}
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2 truncate max-w-xs">
                        <Music className="w-3.5 h-3.5 text-accent shrink-0" />
                        <span className="font-mono text-[11px] truncate">{job.filename}</span>
                      </div>
                    </td>

                    {/* Volume */}
                    <td className="py-3 px-3 text-center font-mono text-[11px]">
                      {job.volume ?? 80}%
                    </td>

                    {/* Loop */}
                    <td className="py-3 px-3 text-center font-mono text-[11px]">
                      {job.loop ?? 1}x
                    </td>

                    {/* Actions: Test Play / Edit / Delete */}
                    <td className="py-3 px-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => handleTestPlay(job)}
                          className="touch-btn w-8 h-8 rounded-xl bg-dark-700 hover:bg-emerald-500/20 text-muted hover:text-emerald-400 flex items-center justify-center transition active:scale-95"
                          title="Test Play Now"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                        </button>
                        <button
                          onClick={() => handleEdit(job)}
                          className="touch-btn w-8 h-8 rounded-xl bg-dark-700 hover:bg-accent/20 text-muted hover:text-accent flex items-center justify-center transition active:scale-95"
                          title="Edit Schedule"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(job)}
                          className="touch-btn w-8 h-8 rounded-xl bg-dark-700 hover:bg-rose-500/20 text-muted hover:text-rose-400 flex items-center justify-center transition active:scale-95"
                          title="Delete Schedule"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
