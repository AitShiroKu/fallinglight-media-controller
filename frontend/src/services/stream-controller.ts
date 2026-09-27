/**
 * Stream Controller Service — WebSocket client for remote broadcast control.
 * Connects to /ws/streaming?role=controller and relays playback commands
 * to all connected receiver PCs across campus / LAN.
 *
 * NOTE: To prevent circular dependencies, this service does NOT import
 * any Zustand stores directly. Instead, stores and services subscribe via
 * listener callbacks (e.g. onConnectionChange, onStateUpdate, onTrackEnded).
 */

export interface RemotePlaybackState {
  isPlaying: boolean;
  isPaused: boolean;
  currentTime: number;
  duration: number;
}

export interface RemoteVUData {
  left: number;
  right: number;
  leftDb: number;
  rightDb: number;
}

class StreamControllerService {
  private ws: WebSocket | null = null;
  private pingInterval: number | null = null;
  private reconnectTimeout: number | null = null;
  private currentRoomId: string | null = null;
  private sessionToken: string | null = null;
  public isConnected = false;
  public isConnecting = false;
  public isStreaming = false;
  public receiverCount = 0;

  private connectionListeners = new Set<(connected: boolean) => void>();
  private receiverCountListeners = new Set<(count: number) => void>();
  private stateListeners = new Set<(state: RemotePlaybackState) => void>();
  private vuListeners = new Set<(vu: RemoteVUData) => void>();
  private trackEndedListeners = new Set<() => void>();
  private roomClosedListeners = new Set<() => void>();
  private schedulerTriggerListeners = new Set<(job: any) => void>();

  private volumeProvider: (() => number) | null = null;

  public setVolumeProvider(fn: () => number): void {
    this.volumeProvider = fn;
  }

  public syncCurrentVolume(): void {
    if (this.volumeProvider) {
      try {
        const vol = this.volumeProvider();
        this.sendVolume(vol);
      } catch {}
    }
  }

  public onConnectionChange(fn: (connected: boolean) => void): () => void {
    this.connectionListeners.add(fn);
    return () => this.connectionListeners.delete(fn);
  }

  public onReceiverCountChange(fn: (count: number) => void): () => void {
    this.receiverCountListeners.add(fn);
    return () => this.receiverCountListeners.delete(fn);
  }

  public onStateUpdate(fn: (state: RemotePlaybackState) => void): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  public onVuUpdate(fn: (vu: RemoteVUData) => void): () => void {
    this.vuListeners.add(fn);
    return () => this.vuListeners.delete(fn);
  }

  public onTrackEnded(fn: () => void): () => void {
    this.trackEndedListeners.add(fn);
    return () => this.trackEndedListeners.delete(fn);
  }

  public onRoomClosed(fn: () => void): () => void {
    this.roomClosedListeners.add(fn);
    return () => this.roomClosedListeners.delete(fn);
  }

  public onSchedulerTrigger(fn: (job: any) => void): () => void {
    this.schedulerTriggerListeners.add(fn);
    return () => this.schedulerTriggerListeners.delete(fn);
  }

  private notifyConnection(connected: boolean): void {
    this.isConnected = connected;
    this.connectionListeners.forEach((fn) => {
      try { fn(connected); } catch (e) { console.error(e); }
    });
  }

  private notifyReceiverCount(count: number): void {
    this.receiverCount = count;
    this.receiverCountListeners.forEach((fn) => {
      try { fn(count); } catch (e) { console.error(e); }
    });
  }

  private notifyStateUpdate(state: RemotePlaybackState): void {
    this.stateListeners.forEach((fn) => {
      try { fn(state); } catch (e) { console.error(e); }
    });
  }

  private notifyVuUpdate(vu: RemoteVUData): void {
    this.vuListeners.forEach((fn) => {
      try { fn(vu); } catch (e) { console.error(e); }
    });
  }

  private notifyTrackEnded(): void {
    this.trackEndedListeners.forEach((fn) => {
      try { fn(); } catch (e) { console.error(e); }
    });
  }

  private notifyRoomClosed(): void {
    this.roomClosedListeners.forEach((fn) => {
      try { fn(); } catch (e) { console.error(e); }
    });
  }

  private async fetchSessionToken(): Promise<string | null> {
    try {
      const res = await fetch('/api/auth/check');
      if (res.ok) {
        const data = await res.json();
        this.sessionToken = data.token || null;
        return this.sessionToken;
      }
    } catch {
      // ignore
    }
    return null;
  }

  public async start(roomId: string): Promise<boolean> {
    this.currentRoomId = roomId;
    this.isStreaming = true;

    // If already connected or connecting to this room, do not restart connection
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return true;
    }

    await this.fetchSessionToken();
    this.connectWs();
    return true;
  }

  public stop(): void {
    this.currentRoomId = null;
    this.isStreaming = false;
    this.isConnecting = false;
    this.receiverCount = 0;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.stopPing();
    if (this.ws) {
      // Detach listeners before closing to prevent spurious onclose reconnects
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.notifyConnection(false);
  }

  private connectWs(): void {
    if (!this.currentRoomId || !this.isStreaming) {
      this.isConnecting = false;
      return;
    }

    // If socket is already open or connecting, do not re-create
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        return;
      }
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      try { this.ws.close(); } catch {}
      this.ws = null;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.isConnecting = true;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let url = `${protocol}//${window.location.host}/ws/streaming?role=controller&room=${encodeURIComponent(this.currentRoomId)}`;
    if (this.sessionToken) {
      url += `&token=${encodeURIComponent(this.sessionToken)}`;
    }

    const socket = new WebSocket(url);
    this.ws = socket;

    socket.onopen = () => {
      if (this.ws !== socket) return;
      this.isConnecting = false;
      this.notifyConnection(true);
      this.startPing();
      this.syncCurrentVolume();
    };

    socket.onmessage = (event) => {
      if (this.ws !== socket) return;
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      } catch {}
    };

    socket.onclose = () => {
      if (this.ws !== socket) return;
      this.isConnecting = false;
      this.stopPing();
      this.notifyConnection(false);
      this.ws = null;

      // Auto-reconnect if still in streaming mode
      if (this.isStreaming && this.currentRoomId) {
        if (this.reconnectTimeout) {
          clearTimeout(this.reconnectTimeout);
        }
        this.reconnectTimeout = window.setTimeout(() => {
          this.reconnectTimeout = null;
          this.connectWs();
        }, 2500);
      }
    };

    socket.onerror = () => {
      if (this.ws !== socket) return;
      this.isConnecting = false;
      // onclose will handle reconnect
    };
  }

  private handleMessage(data: any): void {
    switch (data.type) {
      case 'connected':
        this.notifyConnection(true);
        break;

      case 'peer_connected':
        if (data.role === 'receiver') {
          const count = typeof data.count === 'number'
            ? data.count
            : (this.receiverCount + 1);
          this.notifyReceiverCount(count);
          this.syncCurrentVolume();
        }
        break;

      case 'peer_disconnected':
        if (data.role === 'receiver') {
          const count = typeof data.count === 'number'
            ? data.count
            : Math.max(0, this.receiverCount - 1);
          this.notifyReceiverCount(count);
        }
        break;

      case 'state_update':
        if (this.isStreaming) {
          this.notifyStateUpdate({
            isPlaying: !!data.playing,
            isPaused: !data.playing && (data.currentTime > 0 || !!data.track),
            currentTime: data.currentTime || 0,
            duration: data.duration || 0,
          });
        }
        break;

      case 'vu_update':
        if (this.isStreaming && data.l !== undefined && data.r !== undefined) {
          const l = Math.min(1, Math.max(0, data.l));
          const r = Math.min(1, Math.max(0, data.r));
          const leftDb = Math.max(-60, 20 * Math.log10(l || 0.0001));
          const rightDb = Math.max(-60, 20 * Math.log10(r || 0.0001));
          this.notifyVuUpdate({ left: l, right: r, leftDb, rightDb });
        }
        break;

      case 'track_ended':
        if (this.isStreaming) {
          this.notifyTrackEnded();
        }
        break;

      case 'room_closed':
        this.stop();
        this.notifyRoomClosed();
        break;

      case 'scheduler_trigger':
        if (data.job) {
          this.schedulerTriggerListeners.forEach((fn) => {
            try { fn(data.job); } catch (e) { console.error(e); }
          });
        }
        break;
    }
  }

  public send(data: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  public sendPlay(filename: string, loop = 1, isVideo = false): void {
    this.send({ type: 'play', filename, loop, isVideo });
  }

  public sendPause(): void {
    this.send({ type: 'pause' });
  }

  public sendResume(): void {
    this.send({ type: 'resume' });
  }

  public sendStop(): void {
    this.send({ type: 'stop' });
  }

  public sendVolume(level: number): void {
    this.send({ type: 'volume', level: Math.round(level) });
  }

  public sendSeek(ratio: number, seconds?: number): void {
    this.send({ type: 'seek', ratio, seconds });
  }

  public sendDuck(active: boolean): void {
    this.send({ type: 'duck', active });
  }

  private startPing(): void {
    this.stopPing();
    this.pingInterval = window.setInterval(() => {
      this.send({ type: 'ping' });
    }, 15000);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
}

export const streamController = new StreamControllerService();
