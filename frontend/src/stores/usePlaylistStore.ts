import { create } from 'zustand';
import { usePlayerStore } from './usePlayerStore';
import { audioEngine } from '../services/audio-engine';
import { generateUUID } from '../utils/uuid';

export interface PlaylistItem {
  id: string;
  filename: string;
  name: string;
  folder: string;
  url: string;
  loop: number; // 0 = infinite, 1 = once, 2 = twice, etc.
  currentLoop: number;
  autoNext: boolean;
  isVideo: boolean;
}

interface PlaylistState {
  items: PlaylistItem[];
  currentIndex: number;

  // Actions
  addTrack: (filePath: string, loop?: number, autoNext?: boolean) => number;
  addFolderTracks: (folderPath: string) => Promise<void>;
  playFolder: (folderPath: string) => Promise<void>;
  playFile: (filePath: string) => Promise<void>;
  removeTrack: (index: number) => void;
  clearAll: () => void;
  moveTrack: (fromIndex: number, toIndex: number) => void;
  setLoop: (index: number, loop: number) => void;
  toggleAutoNext: (index: number) => void;
  playIndex: (index: number) => Promise<void>;
  next: () => void;
  previous: () => void;
  onTrackEnded: () => void;
}

const isVideoFilename = (name: string): boolean => {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  return ['.mp4', '.webm', '.mkv', '.avi'].includes(ext);
};

export const usePlaylistStore = create<PlaylistState>((set, get) => ({
    items: [],
    currentIndex: -1,

    addTrack: (filePath, loop = 1, autoNext = true) => {
      const cleanPath = filePath.replace(/^\/+/, '');
      const parts = cleanPath.split('/');
      const fileName = parts.pop() || cleanPath;
      const folder = parts.join('/');
      const isVideo = isVideoFilename(fileName);
      const encodedUrl = '/uploads/' + cleanPath.split('/').map(encodeURIComponent).join('/');

      const item: PlaylistItem = {
        id: generateUUID(),
        filename: cleanPath,
        name: fileName,
        folder,
        url: encodedUrl,
        loop,
        currentLoop: 0,
        autoNext,
        isVideo,
      };

      const newIndex = get().items.length;
      set((state) => ({ items: [...state.items, item] }));
      return newIndex;
    },

    playFile: async (filePath) => {
      const cleanPath = filePath.replace(/^\/+/, '');
      const existingIdx = get().items.findIndex(
        (item) => item.filename === cleanPath || item.filename === filePath
      );
      if (existingIdx !== -1) {
        await get().playIndex(existingIdx);
      } else {
        const newIdx = get().addTrack(cleanPath, 1, true);
        await get().playIndex(newIdx);
      }
    },

    playFolder: async (folderPath) => {
      try {
        const res = await fetch('/api/files?folder=' + encodeURIComponent(folderPath));
        const data = await res.json();
        const files: any[] = data.files || [];
        if (files.length === 0) return;

        const startIndex = get().items.length;
        files.forEach((f) => {
          get().addTrack(f.path || f.name, 1, true);
        });

        await get().playIndex(startIndex);
      } catch (err) {
        console.error('Failed to play folder tracks:', err);
      }
    },

    addFolderTracks: async (folderPath) => {
      try {
        const res = await fetch('/api/files?folder=' + encodeURIComponent(folderPath));
        const data = await res.json();
        const files: any[] = data.files || [];
        files.forEach((f) => {
          get().addTrack(f.path || f.name, 1, true);
        });
      } catch (err) {
        console.error('Failed to add folder tracks:', err);
      }
    },

    removeTrack: (index) => {
      set((state) => {
        const newItems = state.items.filter((_, i) => i !== index);
        let newIdx = state.currentIndex;
        if (index === state.currentIndex) {
          newIdx = -1;
          usePlayerStore.getState().stop();
        } else if (index < state.currentIndex) {
          newIdx = state.currentIndex - 1;
        }
        return { items: newItems, currentIndex: newIdx };
      });
    },

    clearAll: () => {
      usePlayerStore.getState().stop();
      set({ items: [], currentIndex: -1 });
    },

    moveTrack: (fromIndex, toIndex) => {
      set((state) => {
        if (fromIndex < 0 || fromIndex >= state.items.length || toIndex < 0 || toIndex >= state.items.length) {
          return state;
        }
        const newItems = [...state.items];
        const [moved] = newItems.splice(fromIndex, 1);
        newItems.splice(toIndex, 0, moved);

        let newIdx = state.currentIndex;
        if (state.currentIndex === fromIndex) {
          newIdx = toIndex;
        } else if (fromIndex < state.currentIndex && toIndex >= state.currentIndex) {
          newIdx--;
        } else if (fromIndex > state.currentIndex && toIndex <= state.currentIndex) {
          newIdx++;
        }
        return { items: newItems, currentIndex: newIdx };
      });
    },

    setLoop: (index, loop) => {
      set((state) => {
        const newItems = [...state.items];
        if (newItems[index]) {
          newItems[index] = { ...newItems[index], loop, currentLoop: 0 };
        }
        return { items: newItems };
      });
    },

    toggleAutoNext: (index) => {
      set((state) => {
        const newItems = [...state.items];
        if (newItems[index]) {
          newItems[index] = { ...newItems[index], autoNext: !newItems[index].autoNext };
        }
        return { items: newItems };
      });
    },

    playIndex: async (index) => {
      const items = get().items;
      if (index < 0 || index >= items.length) return;
      const track = items[index];

      set({ currentIndex: index });
      try {
        await usePlayerStore.getState().playTrack(
          track.name,
          track.url,
          track.isVideo,
          track.folder,
          track.filename,
          track.loop
        );
      } catch (err) {
        console.error('[usePlaylistStore] Play index failed:', err);
      }
    },

    next: () => {
      const { items, currentIndex, playIndex } = get();
      const nextIdx = currentIndex + 1;
      if (nextIdx < items.length) {
        playIndex(nextIdx);
      }
    },

    previous: () => {
      const { items, currentIndex, playIndex } = get();
      const prevIdx = currentIndex - 1;
      if (prevIdx >= 0) {
        playIndex(prevIdx);
      }
    },

    onTrackEnded: () => {
      const { items, currentIndex, playIndex } = get();
      const track = items[currentIndex];
      if (!track) return;

      // Handle loop repetitions
      if (track.loop === 0) {
        // Infinite loop
        playIndex(currentIndex);
        return;
      }

      const nextLoop = track.currentLoop + 1;
      if (nextLoop < track.loop) {
        set((state) => {
          const newItems = [...state.items];
          newItems[currentIndex] = { ...track, currentLoop: nextLoop };
          return { items: newItems };
        });
        playIndex(currentIndex);
        return;
      }

      // Track completed all loops, reset loop counter
      set((state) => {
        const newItems = [...state.items];
        newItems[currentIndex] = { ...track, currentLoop: 0 };
        return { items: newItems };
      });

      // Check per-media autoNext setting ("เล่นต่อเมื่อจบ" vs "หยุดเมื่อจบ")
      // Stop only when the user explicitly configured this track to Stop (autoNext === false)
      if (track.autoNext === false) {
        usePlayerStore.getState().stop();
        const nextIdx = currentIndex + 1;
        if (nextIdx < items.length) {
          set({ currentIndex: nextIdx });
        }
        return;
      }

      // Advance to next track
      const nextIdx = currentIndex + 1;
      if (nextIdx < items.length) {
        playIndex(nextIdx);
      } else {
        // Reached end of playlist
        usePlayerStore.getState().stop();
        set({ currentIndex: -1 });
      }
    },
}));

// Bind audio engine track ended listener to playlist auto-advance logic
audioEngine.setOnEnded(() => {
  usePlaylistStore.getState().onTrackEnded();
});

