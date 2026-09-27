/**
 * AudioEngine — High-performance Web Audio API service
 * Handles audio playback, Web Audio gain nodes, microphone ducking,
 * VU meter analysis, and synchronized video playback.
 */

import { streamController } from './stream-controller';

export interface VUData {
  left: number; // 0 to 1
  right: number; // 0 to 1
  leftDb: number;
  rightDb: number;
}

export type VULocationCallback = (vu: VUData) => void;

class AudioEngineService {
  private ctx: AudioContext | null = null;
  private audioEl: HTMLAudioElement;
  private videoEl: HTMLVideoElement | null = null;

  private audioSourceNode: MediaElementAudioSourceNode | null = null;
  private videoSourceNode: MediaElementAudioSourceNode | null = null;
  private volumeGainNode: GainNode | null = null;
  private duckGainNode: GainNode | null = null;
  private analyserLeft: AnalyserNode | null = null;
  private analyserRight: AnalyserNode | null = null;
  private splitterNode: ChannelSplitterNode | null = null;

  private isDucked = false;
  private isVideoMode = false;
  private currentUrl = '';
  private currentVolume = 0.8;
  private fadeDuration = 1.5;
  private duckVolume = 0.12;
  private duckDuration = 300;

  private vuInterval: number | null = null;
  private vuListeners: Set<VULocationCallback> = new Set();
  private onEndedCallback: (() => void) | null = null;
  private onTimeUpdateCallback: ((time: number, duration: number) => void) | null = null;

  public remoteMode = false;
  private remoteDuration = 0;

  constructor() {
    this.audioEl = new Audio();
    this.audioEl.crossOrigin = 'anonymous';
    this.audioEl.preload = 'auto';

    this.audioEl.addEventListener('ended', () => {
      if (this.activeMedia === this.audioEl && this.onEndedCallback) {
        this.notifyEnded();
      }
    });

    this.audioEl.addEventListener('timeupdate', () => {
      if (!this.isVideoMode && this.onTimeUpdateCallback && this.audioEl.duration) {
        this.onTimeUpdateCallback(this.audioEl.currentTime, this.audioEl.duration);
      }
    });

    this.audioEl.addEventListener('loadedmetadata', () => {
      if (!this.isVideoMode && this.onTimeUpdateCallback && this.audioEl.duration) {
        this.onTimeUpdateCallback(this.audioEl.currentTime, this.audioEl.duration);
      }
    });

    // When playing remotely via streamController, handle remote state and track ended signal
    streamController.onStateUpdate((state) => {
      if (state.duration && state.duration > 0) {
        this.remoteDuration = state.duration;
      }
    });

    streamController.onTrackEnded(() => {
      this.notifyEnded();
    });
  }

  public setVideoElement(videoEl: HTMLVideoElement | null) {
    if (this.videoEl === videoEl) return;
    this.videoEl = videoEl;
    if (this.videoEl) {
      this.videoEl.crossOrigin = 'anonymous';
      this.videoEl.preload = 'auto';
      this.videoEl.playsInline = true;

      // Connect video source node if AudioContext exists
      if (this.ctx && !this.videoSourceNode && this.duckGainNode) {
        try {
          this.videoSourceNode = this.ctx.createMediaElementSource(this.videoEl);
          this.videoSourceNode.connect(this.duckGainNode);
        } catch (e) {
          console.warn('[AudioEngine] Video source connection warning:', e);
        }
      }

      // If a video track was playing or loaded, sync into this video element immediately
      if (this.isVideoMode && this.currentUrl) {
        const wasAudioPlaying = !this.audioEl.paused && !this.audioEl.ended;
        const seekTime = this.audioEl.currentTime;

        // Stop fallback audio element
        this.audioEl.pause();
        this.audioEl.src = '';

        this.videoEl.src = this.currentUrl;
        this.videoEl.volume = this.currentVolume;

        if (seekTime > 0) {
          this.videoEl.addEventListener('loadedmetadata', () => {
            if (this.videoEl) this.videoEl.currentTime = seekTime;
          }, { once: true });
        }

        if (wasAudioPlaying || this.isPlaying) {
          this.videoEl.play().catch((err) => {
            console.warn('[AudioEngine] Video play on mount rejected, attempting muted fallback:', err);
            if (this.videoEl) {
              this.videoEl.muted = true;
              this.videoEl.play().catch(() => {});
            }
          });
        }
      }

      this.videoEl.addEventListener('ended', () => {
        if (this.activeMedia === this.videoEl && this.onEndedCallback) {
          this.notifyEnded();
        }
      });

      this.videoEl.addEventListener('timeupdate', () => {
        if (this.isVideoMode && this.onTimeUpdateCallback && this.videoEl?.duration) {
          this.onTimeUpdateCallback(this.videoEl.currentTime, this.videoEl.duration);
        }
      });

      this.videoEl.addEventListener('loadedmetadata', () => {
        if (this.isVideoMode && this.onTimeUpdateCallback && this.videoEl?.duration) {
          this.onTimeUpdateCallback(this.videoEl.currentTime, this.videoEl.duration);
        }
      });
    }
  }

  private lastEndedTimestamp = 0;

  public setOnEnded(cb: () => void) {
    this.onEndedCallback = cb;
  }

  public notifyEnded() {
    const now = Date.now();
    if (now - this.lastEndedTimestamp < 1000) return;
    this.lastEndedTimestamp = now;
    if (this.onEndedCallback) {
      this.onEndedCallback();
    }
  }

  public setOnTimeUpdate(cb: (time: number, duration: number) => void) {
    this.onTimeUpdateCallback = cb;
  }

  public addVUListener(cb: VULocationCallback) {
    this.vuListeners.add(cb);
    if (this.vuListeners.size === 1) {
      this.startVULoop();
    }
    return () => {
      this.vuListeners.delete(cb);
      if (this.vuListeners.size === 0) {
        this.stopVULoop();
      }
    };
  }

  public async resumeContext() {
    this.initAudioNodes();
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume().catch(() => {});
    }
  }

  private initAudioNodes() {
    if (!this.ctx) {
      try {
        const AudioContextClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new AudioContextClass();

        this.volumeGainNode = this.ctx.createGain();
        this.duckGainNode = this.ctx.createGain();

        this.volumeGainNode.gain.setValueAtTime(this.currentVolume, this.ctx.currentTime);
        this.duckGainNode.gain.setValueAtTime(1.0, this.ctx.currentTime);

        this.splitterNode = this.ctx.createChannelSplitter(2);
        this.analyserLeft = this.ctx.createAnalyser();
        this.analyserRight = this.ctx.createAnalyser();

        this.analyserLeft.fftSize = 256;
        this.analyserRight.fftSize = 256;

        // DuckGain -> VolumeGain -> Destination & Analysers
        this.duckGainNode.connect(this.volumeGainNode);

        this.volumeGainNode.connect(this.splitterNode);
        this.splitterNode.connect(this.analyserLeft, 0);
        this.splitterNode.connect(this.analyserRight, 1);

        this.volumeGainNode.connect(this.ctx.destination);
      } catch (e) {
        console.warn('[AudioEngine] Web Audio API init warning:', e);
      }
    }

    if (this.ctx && this.duckGainNode) {
      if (!this.audioSourceNode) {
        try {
          this.audioSourceNode = this.ctx.createMediaElementSource(this.audioEl);
          this.audioSourceNode.connect(this.duckGainNode);
        } catch (e) {
          console.warn('[AudioEngine] Audio source connection warning:', e);
        }
      }

      if (this.videoEl && !this.videoSourceNode) {
        try {
          this.videoSourceNode = this.ctx.createMediaElementSource(this.videoEl);
          this.videoSourceNode.connect(this.duckGainNode);
        } catch (e) {
          console.warn('[AudioEngine] Video source connection warning:', e);
        }
      }
    }
  }

  private get activeMedia(): HTMLMediaElement {
    return this.isVideoMode && this.videoEl ? this.videoEl : this.audioEl;
  }

  public async play(url: string, isVideo = false, filename?: string, loop = 1) {
    this.currentUrl = url;
    this.isVideoMode = isVideo;

    // Send broadcast command to remote receivers if streaming room is active
    if (this.remoteMode || streamController.isStreaming) {
      const cleanFile = filename || decodeURIComponent(url.replace(/^\/uploads\//, ''));
      streamController.sendPlay(cleanFile, loop, isVideo);
    }

    this.initAudioNodes();

    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume().catch(() => {});
    }

    if (this.volumeGainNode && this.ctx) {
      try {
        this.volumeGainNode.gain.setValueAtTime(this.currentVolume, this.ctx.currentTime);
      } catch {}
    }

    if (isVideo && this.videoEl) {
      // 1. Pause and clear audio element so they don't both play
      this.audioEl.pause();
      this.audioEl.src = '';

      // 2. Play video element directly
      this.videoEl.crossOrigin = 'anonymous';
      this.videoEl.volume = this.currentVolume;
      this.videoEl.src = url;
      await this.videoEl.play().catch((err) => {
        console.warn('[AudioEngine] Video play rejected, falling back to muted:', err);
        if (this.videoEl) {
          this.videoEl.muted = true;
          return this.videoEl.play().catch(() => {});
        }
      });
    } else if (isVideo && !this.videoEl) {
      // Video mode requested but VideoDeck is not yet mounted.
      // Pre-load audio in audioEl so sound is immediate, and transfer to videoEl on mount.
      this.audioEl.crossOrigin = 'anonymous';
      this.audioEl.volume = this.currentVolume;
      this.audioEl.src = url;
      await this.audioEl.play().catch((err) => {
        console.warn('[AudioEngine] Audio fallback play rejected:', err);
      });
    } else {
      // 1. Pause and clear video element if present
      if (this.videoEl) {
        this.videoEl.pause();
        this.videoEl.src = '';
      }

      // 2. Play audio element
      this.audioEl.crossOrigin = 'anonymous';
      this.audioEl.volume = this.currentVolume;
      this.audioEl.src = url;
      await this.audioEl.play().catch((err) => {
        console.warn('[AudioEngine] Audio play rejected:', err);
      });
    }
  }

  public async resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume().catch(() => {});
    }
    const media = this.activeMedia;
    if (media && media.src && media.src !== window.location.href) {
      await media.play().catch((err) => {
        console.warn('[AudioEngine] Resume rejected, attempting muted fallback:', err);
        if (this.isVideoMode && this.videoEl) {
          this.videoEl.muted = true;
          return this.videoEl.play().catch(() => {});
        }
      });
    } else if (this.currentUrl) {
      await this.play(this.currentUrl, this.isVideoMode);
    }
    if (this.remoteMode || streamController.isStreaming) {
      streamController.sendResume();
    }
  }

  public pause() {
    const media = this.activeMedia;
    if (media) {
      media.pause();
    }
    if (this.remoteMode || streamController.isStreaming) {
      streamController.sendPause();
    }
  }

  public stop() {
    if (this.remoteMode || streamController.isStreaming) {
      streamController.sendStop();
    }
    this.audioEl.pause();
    this.audioEl.src = '';
    if (this.videoEl) {
      this.videoEl.pause();
      this.videoEl.src = '';
    }
  }

  public async stopWithFade(duration = this.fadeDuration) {
    if (!this.ctx || !this.volumeGainNode) {
      this.stop();
      return;
    }
    const curr = this.volumeGainNode.gain.value;
    const now = this.ctx.currentTime;
    this.volumeGainNode.gain.cancelScheduledValues(now);
    this.volumeGainNode.gain.setValueAtTime(curr, now);
    this.volumeGainNode.gain.linearRampToValueAtTime(0, now + duration);

    setTimeout(() => {
      this.stop();
      if (this.volumeGainNode && this.ctx) {
        this.volumeGainNode.gain.setValueAtTime(this.currentVolume, this.ctx.currentTime);
      }
    }, duration * 1000);
  }

  public seek(seconds: number) {
    const el = this.activeMedia;
    if (el) {
      const elDur = el.duration;
      if (elDur && isFinite(elDur) && elDur > 0) {
        // Clamp to at most (duration - 0.5s) so seeking to or near the end never triggers immediate ended
        const clamped = Math.max(0, Math.min(Math.max(0, elDur - 0.5), seconds));
        if (el.readyState >= 1) {
          el.currentTime = clamped;
        } else {
          el.addEventListener('loadedmetadata', () => {
            el.currentTime = clamped;
          }, { once: true });
        }
      } else {
        if (el.readyState >= 1) {
          el.currentTime = Math.max(0, seconds);
        }
      }
    }
    if (this.remoteMode || streamController.isStreaming) {
      const dur = this.remoteDuration > 0 ? this.remoteDuration : (this.duration > 0 ? this.duration : (el?.duration || 0));
      if (dur > 0) {
        // Clamp to at most 0.99 (never 1.0) so seeking to or near the end never falsely triggers track_ended
        const ratio = Math.max(0, Math.min(0.99, seconds / dur));
        streamController.sendSeek(ratio, seconds);
      } else {
        streamController.sendSeek(0, seconds);
      }
    }
  }

  public setVolume(vol: number) {
    this.currentVolume = Math.max(0, Math.min(1, vol));
    if (this.volumeGainNode && this.ctx) {
      this.volumeGainNode.gain.setValueAtTime(this.currentVolume, this.ctx.currentTime);
    }
    if (this.audioEl) {
      this.audioEl.volume = this.currentVolume;
    }
    if (this.videoEl) {
      this.videoEl.volume = this.currentVolume;
    }
    if (this.remoteMode || streamController.isStreaming) {
      streamController.sendVolume(this.currentVolume * 100);
    }
  }

  public setDucking(active: boolean) {
    this.isDucked = active;
    if (this.remoteMode || streamController.isStreaming) {
      streamController.sendDuck(active);
    }
    if (!this.ctx || !this.duckGainNode) return;
    const targetGain = active ? this.duckVolume : 1.0;
    const rampSeconds = this.duckDuration / 1000;
    const now = this.ctx.currentTime;

    this.duckGainNode.gain.cancelScheduledValues(now);
    this.duckGainNode.gain.setValueAtTime(this.duckGainNode.gain.value, now);
    this.duckGainNode.gain.linearRampToValueAtTime(targetGain, now + rampSeconds);
  }

  public toggleDucking() {
    this.setDucking(!this.isDucked);
    return this.isDucked;
  }

  public get isPlaying(): boolean {
    const el = this.activeMedia;
    return !el.paused && !el.ended && (el.currentTime > 0 || (el.readyState >= 2 && !el.seeking));
  }

  public get isPaused(): boolean {
    return this.activeMedia.paused;
  }

  public get currentTime(): number {
    return this.activeMedia.currentTime;
  }

  public get duration(): number {
    if (this.remoteMode && this.remoteDuration > 0) {
      return this.remoteDuration;
    }
    return this.activeMedia.duration || this.remoteDuration || 0;
  }

  public get duckActive(): boolean {
    return this.isDucked;
  }

  public configureSettings(settings: {
    defaultVolume?: number;
    fadeDuration?: number;
    duckVolume?: number;
    duckDuration?: number;
  }) {
    if (settings.defaultVolume !== undefined) this.setVolume(settings.defaultVolume);
    if (settings.fadeDuration !== undefined) this.fadeDuration = settings.fadeDuration;
    if (settings.duckVolume !== undefined) this.duckVolume = settings.duckVolume;
    if (settings.duckDuration !== undefined) this.duckDuration = settings.duckDuration;
  }

  private startVULoop() {
    if (this.vuInterval) return;
    const leftData = new Uint8Array(128);
    const rightData = new Uint8Array(128);

    this.vuInterval = window.setInterval(() => {
      if (!this.analyserLeft || !this.analyserRight || !this.isPlaying) {
        // In remote streaming mode, if local audio is not playing, do not overwrite remote VU with zeroes
        if (this.remoteMode || streamController.isStreaming) {
          return;
        }
        this.broadcastVU({ left: 0, right: 0, leftDb: -60, rightDb: -60 });
        return;
      }

      this.analyserLeft.getByteTimeDomainData(leftData);
      this.analyserRight.getByteTimeDomainData(rightData);

      let sumL = 0;
      let sumR = 0;
      for (let i = 0; i < 128; i++) {
        const vl = (leftData[i] - 128) / 128;
        const vr = (rightData[i] - 128) / 128;
        sumL += vl * vl;
        sumR += vr * vr;
      }

      const rmsL = Math.sqrt(sumL / 128);
      const rmsR = Math.sqrt(sumR / 128);

      const left = Math.min(1, rmsL * 2.8);
      const right = Math.min(1, rmsR * 2.8);
      const leftDb = Math.max(-60, 20 * Math.log10(rmsL || 0.0001));
      const rightDb = Math.max(-60, 20 * Math.log10(rmsR || 0.0001));

      this.broadcastVU({ left, right, leftDb, rightDb });
    }, 40);
  }

  private stopVULoop() {
    if (this.vuInterval) {
      clearInterval(this.vuInterval);
      this.vuInterval = null;
    }
  }

  private broadcastVU(vu: VUData) {
    this.vuListeners.forEach((listener) => listener(vu));
  }
}

export const audioEngine = new AudioEngineService();
