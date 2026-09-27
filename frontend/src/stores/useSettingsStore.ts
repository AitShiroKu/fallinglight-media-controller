import { create } from 'zustand';
import { audioEngine } from '../services/audio-engine';

export interface AppSettings {
  defaultVolume: number;
  fadeDuration: number;
  duckVolume: number;
  duckDuration: number;
  ytQuality: string;
  warnOnClose: boolean;
  autoAdvance?: boolean;
}

interface SettingsState {
  settings: AppSettings;
  isLoading: boolean;
  loadSettings: () => Promise<void>;
  saveSettings: (updated: Partial<AppSettings>) => Promise<boolean>;
}

const DEFAULT_SETTINGS: AppSettings = {
  defaultVolume: 0.8,
  fadeDuration: 1.5,
  duckVolume: 0.12,
  duckDuration: 300,
  ytQuality: '0',
  warnOnClose: true,
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  isLoading: false,
  loadSettings: async () => {
    set({ isLoading: true });
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data: AppSettings = await res.json();
        set({ settings: data, isLoading: false });

        // Synchronize with audio engine
        audioEngine.configureSettings({
          defaultVolume: data.defaultVolume,
          fadeDuration: data.fadeDuration,
          duckVolume: data.duckVolume,
          duckDuration: data.duckDuration,
        });
      } else {
        set({ isLoading: false });
      }
    } catch {
      set({ isLoading: false });
    }
  },

  saveSettings: async (updated) => {
    const nextSettings = { ...get().settings, ...updated };
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextSettings),
      });
      if (res.ok) {
        set({ settings: nextSettings });
        audioEngine.configureSettings({
          defaultVolume: nextSettings.defaultVolume,
          fadeDuration: nextSettings.fadeDuration,
          duckVolume: nextSettings.duckVolume,
          duckDuration: nextSettings.duckDuration,
        });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },
}));
