import { create } from 'zustand';

export interface ScheduleJob {
  id: string;
  name: string;
  type: 'once' | 'daily' | 'weekly';
  time: string;
  date?: string;
  days?: string[];
  filename: string;
  volume: number;
  loop: number;
  enabled: boolean;
}

interface SchedulerState {
  schedules: ScheduleJob[];
  isLoading: boolean;

  loadSchedules: () => Promise<void>;
  createSchedule: (job: Omit<ScheduleJob, 'id' | 'enabled'>) => Promise<boolean>;
  updateSchedule: (id: string, job: Partial<ScheduleJob>) => Promise<boolean>;
  deleteSchedule: (id: string) => Promise<boolean>;
  toggleSchedule: (id: string) => Promise<boolean>;
  exportSchedules: () => void;
  importSchedules: (file: File) => Promise<{ success: boolean; imported?: number; error?: string }>;
}

export const useSchedulerStore = create<SchedulerState>((set, get) => ({
  schedules: [],
  isLoading: false,

  loadSchedules: async () => {
    set({ isLoading: true });
    try {
      const res = await fetch('/api/scheduler');
      if (res.ok) {
        const data = await res.json();
        set({ schedules: data.schedules || [], isLoading: false });
      } else {
        set({ isLoading: false });
      }
    } catch {
      set({ isLoading: false });
    }
  },

  createSchedule: async (job) => {
    try {
      const res = await fetch('/api/scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job),
      });
      const data = await res.json();
      if (data.success) {
        await get().loadSchedules();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  updateSchedule: async (id, job) => {
    try {
      const res = await fetch(`/api/scheduler/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job),
      });
      const data = await res.json();
      if (data.success) {
        await get().loadSchedules();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  deleteSchedule: async (id) => {
    try {
      const res = await fetch(`/api/scheduler/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        await get().loadSchedules();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  toggleSchedule: async (id) => {
    try {
      const res = await fetch(`/api/scheduler/${encodeURIComponent(id)}/toggle`, {
        method: 'PATCH',
      });
      const data = await res.json();
      if (data.success) {
        set((state) => ({
          schedules: state.schedules.map((s) =>
            s.id === id ? { ...s, enabled: data.enabled } : s
          ),
        }));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  exportSchedules: () => {
    window.location.href = '/api/scheduler/export';
  },

  importSchedules: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/scheduler/import', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        await get().loadSchedules();
        return { success: true, imported: data.imported };
      }
      return { success: false, error: data.error || 'Import failed' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Import error' };
    }
  },
}));
