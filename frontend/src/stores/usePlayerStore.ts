import { create } from 'zustand';
import { audioEngine, VUData } from '../services/audio-engine';
import { streamController } from '../services/stream-controller';
import { usePlaylistStore } from './usePlaylistStore';

interface PlayerState {
  isPlaying: boolean;
  isPaused: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  isDucked: boolean;
  currentTrack: {
    title: string;
    url: string;
    isVideo: boolean;
    folder?: string;
  } | null;

  // Actions
  playTrack: (title: string, url: string, isVideo?: boolean, folder?: string, filename?: string, loop?: number) => Promise<void>;
  togglePlay: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  seek: (seconds: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  toggleDucking: () => void;
  setDucking: (active: boolean) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
    isPlaying: false,
    isPaused: false,
    currentTime: 0,
    duration: 0,
    volume: 0.8,
    isMuted: false,
    isDucked: false,
    currentTrack: null,

    playTrack: async (title, url, isVideo = false, folder = '', filename?: string, loop = 1) => {
      set({
        currentTrack: { title, url, isVideo, folder },
        isPlaying: true,
        isPaused: false,
      });
      try {
        await audioEngine.play(url, isVideo, filename, loop);
      } catch (err) {
        set({ isPlaying: false, isPaused: false });
        console.error('[usePlayerStore] Playback rejected:', err);
        throw err;
      }
    },

    togglePlay: () => {
      const { isPlaying, isPaused, currentTrack } = get();
      if (isPlaying) {
        get().pause();
      } else if (isPaused && currentTrack) {
        get().resume();
      } else {
        // Stopped state (!isPlaying && !isPaused)
        if (currentTrack) {
          get().playTrack(currentTrack.title, currentTrack.url, currentTrack.isVideo, currentTrack.folder);
        } else {
          try {
            const playlist = usePlaylistStore.getState();
            if (playlist && playlist.items && playlist.items.length > 0) {
              const idx = playlist.currentIndex >= 0 ? playlist.currentIndex : 0;
              playlist.playIndex(idx);
            }
          } catch (e) {
            console.warn('[usePlayerStore] togglePlay playlist fallback error:', e);
          }
        }
      }
    },

    pause: () => {
      audioEngine.pause();
      set({ isPlaying: false, isPaused: true });
    },

    resume: async () => {
      set({ isPlaying: true, isPaused: false });
      try {
        await audioEngine.resume();
      } catch (e) {
        console.warn('[usePlayerStore] resume warning:', e);
      }
    },

    stop: () => {
      audioEngine.stop();
      set({ isPlaying: false, isPaused: false, currentTime: 0 });
    },

    seek: (seconds: number) => {
      audioEngine.seek(seconds);
      set({ currentTime: seconds });
    },

    setVolume: (vol: number) => {
      const clamped = Math.max(0, Math.min(1, vol));
      audioEngine.setVolume(clamped);
      if (streamController.isStreaming) {
        streamController.sendVolume(clamped * 100);
      }
      set({ volume: clamped, isMuted: clamped === 0 });
    },

    toggleMute: () => {
      if (get().isMuted) {
        const restored = 0.8;
        audioEngine.setVolume(restored);
        if (streamController.isStreaming) {
          streamController.sendVolume(restored * 100);
        }
        set({ volume: restored, isMuted: false });
      } else {
        audioEngine.setVolume(0);
        if (streamController.isStreaming) {
          streamController.sendVolume(0);
        }
        set({ volume: 0, isMuted: true });
      }
    },

    toggleDucking: () => {
      const active = audioEngine.toggleDucking();
      set({ isDucked: active });
    },

    setDucking: (active: boolean) => {
      audioEngine.setDucking(active);
      set({ isDucked: active });
    },
}));

// Bind audio engine listeners for local playback
audioEngine.setOnTimeUpdate((time, duration) => {
  usePlayerStore.setState({ currentTime: time, duration });
});

// Bind stream controller listeners for remote broadcast playback
streamController.onStateUpdate((remoteState) => {
  const isLocallyPlaying = usePlayerStore.getState().isPlaying;
  // If the master controller is actively playing, never allow a slave receiver to pause/stop it
  if (isLocallyPlaying && !remoteState.isPlaying) {
    return;
  }
  // If controller is locally playing, local timeupdate provides higher fidelity than remote polling
  if (isLocallyPlaying) {
    if (remoteState.duration && !usePlayerStore.getState().duration) {
      usePlayerStore.setState({ duration: remoteState.duration });
    }
    return;
  }
  usePlayerStore.setState(remoteState);
});

// Provide current master volume to stream controller for automatic receiver synchronization
streamController.setVolumeProvider(() => {
  const { volume, isMuted } = usePlayerStore.getState();
  return isMuted ? 0 : volume * 100;
});


