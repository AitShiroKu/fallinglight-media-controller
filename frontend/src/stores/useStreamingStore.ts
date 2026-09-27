import { create } from 'zustand';
import { streamController } from '../services/stream-controller';
import { audioEngine } from '../services/audio-engine';

export interface ReceiverInfo {
  index: number;
  readyState: number;
  remoteAddress: string;
}

export interface StreamDebugData {
  active: boolean;
  roomId: string | null;
  createdAt?: number;
  uptimeSeconds: number;
  controllerConnected: boolean;
  receiverCount: number;
  receivers: ReceiverInfo[];
  serverTime: string;
}

interface StreamingState {
  isStreaming: boolean;
  roomId: string | null;
  receiverCount: number;
  controllerConnected: boolean;
  isLoading: boolean;
  debugData: StreamDebugData | null;

  checkStatus: () => Promise<void>;
  enableStreaming: () => Promise<string | null>;
  disableStreaming: () => Promise<boolean>;
  loadDebugInfo: () => Promise<StreamDebugData | null>;
  resetRoom: () => Promise<boolean>;
  pruneSockets: () => Promise<boolean>;
}

export const useStreamingStore = create<StreamingState>((set, get) => ({
  isStreaming: false,
  roomId: null,
  receiverCount: 0,
  controllerConnected: false,
  isLoading: false,
  debugData: null,

  checkStatus: async () => {
    try {
      const res = await fetch('/api/streaming/status');
      if (res.ok) {
        const data = await res.json();
        const active = !!data.active;
        set({
          isStreaming: active,
          roomId: data.roomId || null,
          receiverCount: data.receiverCount || 0,
          controllerConnected: !!data.controllerConnected,
        });
        audioEngine.remoteMode = active;
        if (active && data.roomId) {
          if (!streamController.isConnected && !streamController.isConnecting) {
            await streamController.start(data.roomId);
          }
        } else if (!active) {
          streamController.stop();
        }
      }
    } catch (err) {
      console.error('Failed to check streaming status:', err);
    }
  },

  enableStreaming: async () => {
    set({ isLoading: true });
    try {
      const res = await fetch('/api/streaming/enable', { method: 'POST' });
      const data = await res.json();
      if (data.success && data.roomId) {
        set({
          isStreaming: true,
          roomId: data.roomId,
          receiverCount: data.receiverCount || 0,
          isLoading: false,
        });
        audioEngine.remoteMode = true;
        await streamController.start(data.roomId);
        return data.roomId;
      }
      set({ isLoading: false });
      return null;
    } catch {
      set({ isLoading: false });
      return null;
    }
  },

  disableStreaming: async () => {
    set({ isLoading: true });
    try {
      streamController.stop();
      audioEngine.remoteMode = false;
      const res = await fetch('/api/streaming/disable', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        set({
          isStreaming: false,
          roomId: null,
          receiverCount: 0,
          controllerConnected: false,
          isLoading: false,
        });
        return true;
      }
      set({ isLoading: false });
      return false;
    } catch {
      set({ isLoading: false });
      return false;
    }
  },

  loadDebugInfo: async () => {
    try {
      const res = await fetch('/api/streaming/debug');
      if (res.ok) {
        const data: StreamDebugData = await res.json();
        set({ debugData: data });
        return data;
      }
      return null;
    } catch {
      return null;
    }
  },

  resetRoom: async () => {
    try {
      streamController.stop();
      audioEngine.remoteMode = false;
      const res = await fetch('/api/streaming/reset', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        set({
          isStreaming: false,
          roomId: null,
          receiverCount: 0,
          controllerConnected: false,
          debugData: null,
        });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  pruneSockets: async () => {
    try {
      const res = await fetch('/api/streaming/clean-dead', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        set({
          receiverCount: data.receiverCount,
          controllerConnected: data.controllerConnected,
        });
        await get().loadDebugInfo();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },
}));

// Subscribe to streamController events to keep Zustand store synchronized
streamController.onConnectionChange((connected) => {
  useStreamingStore.setState({ controllerConnected: connected });
});

streamController.onReceiverCountChange((count) => {
  useStreamingStore.setState({ receiverCount: count });
});

streamController.onRoomClosed(() => {
  useStreamingStore.setState({
    isStreaming: false,
    roomId: null,
    receiverCount: 0,
    controllerConnected: false,
  });
});
