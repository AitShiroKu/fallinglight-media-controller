import React from 'react';
import { usePlayerStore } from '../stores/usePlayerStore';
import { usePlaylistStore } from '../stores/usePlaylistStore';
import { useI18n } from '../services/i18n';
import Seekbar from './Seekbar';
import VUMeter from './VUMeter';
import VideoDeck from './VideoDeck';
import {
  Play,
  Pause,
  Square,
  SkipBack,
  SkipForward,
  Mic,
  Volume2,
  VolumeX,
  Radio,
  Disc3,
  Flame,
} from 'lucide-react';

export default function PlayerDeck() {
  const { t } = useI18n();
  const {
    isPlaying,
    isPaused,
    currentTime,
    duration,
    volume,
    isMuted,
    isDucked,
    currentTrack,
    togglePlay,
    stop,
    seek,
    setVolume,
    toggleMute,
    toggleDucking,
  } = usePlayerStore();

  const { next, previous } = usePlaylistStore();

  return (
    <div className="w-full md:w-[380px] lg:w-[440px] bg-dark-800/90 border border-dark-500/80 rounded-3xl p-4 sm:p-5 flex flex-col gap-4 shadow-2xl shrink-0 overflow-hidden">
      {/* Video Deck / Media Visualizer */}
      <VideoDeck />

      {/* Track Info Card */}
      <div className="bg-dark-900/90 rounded-2xl p-3.5 border border-dark-600/50 flex flex-col gap-1 text-center shadow-inner">
        <div className="flex items-center justify-center gap-1.5 text-[11px] font-mono text-muted uppercase">
          <Disc3 className={`w-3.5 h-3.5 text-accent ${isPlaying ? 'animate-spin' : ''}`} />
          <span>{currentTrack?.folder ? currentTrack.folder : 'Root / Standby'}</span>
        </div>
        <h3 className="text-sm sm:text-base font-bold text-white truncate px-2">
          {currentTrack ? currentTrack.title : t('no_track')}
        </h3>
      </div>

      {/* Interactive Seekbar */}
      <div className="px-1">
        <Seekbar currentTime={currentTime} duration={duration} onSeek={seek} />
      </div>

      {/* Transport Deck Controls */}
      <div className="flex items-center justify-center gap-2 sm:gap-3 py-1">
        {/* Previous Track */}
        <button
          onClick={previous}
          className="touch-btn w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-dark-700 hover:bg-dark-600 border border-dark-500/80 text-gray-200 flex items-center justify-center transition active:scale-95 shadow-sm"
          title="Previous Track"
        >
          <SkipBack className="w-5 h-5" />
        </button>

        {/* Stop Button */}
        <button
          onClick={stop}
          className="touch-btn w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-dark-700 hover:bg-dark-600 border border-dark-500/80 text-gray-200 flex items-center justify-center transition active:scale-95 shadow-sm"
          title="Stop Playback"
        >
          <Square className="w-4 h-4" />
        </button>

        {/* Central 64px Tactile Play/Pause Button */}
        <button
          onClick={togglePlay}
          className="touch-btn w-16 h-16 rounded-3xl bg-accent hover:bg-accent-light text-white flex items-center justify-center transition shadow-xl shadow-accent/35 active:scale-95 select-none"
          title="Play / Pause"
        >
          {isPlaying ? (
            <Pause className="w-8 h-8 fill-current" />
          ) : (
            <Play className="w-8 h-8 fill-current translate-x-0.5" />
          )}
        </button>

        {/* Next Track */}
        <button
          onClick={next}
          className="touch-btn w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-dark-700 hover:bg-dark-600 border border-dark-500/80 text-gray-200 flex items-center justify-center transition active:scale-95 shadow-sm"
          title="Next Track"
        >
          <SkipForward className="w-5 h-5" />
        </button>

        {/* Mic Ducking Toggle Button */}
        <button
          onClick={toggleDucking}
          className={`touch-btn w-11 h-11 sm:w-12 sm:h-12 rounded-2xl border flex items-center justify-center transition active:scale-95 shadow-sm ${
            isDucked
              ? 'bg-rose-500 border-rose-400 text-white shadow-lg shadow-rose-500/40 animate-pulse'
              : 'bg-dark-700 hover:bg-dark-600 border-dark-500/80 text-yellow-400'
          }`}
          title={isDucked ? 'Microphone Active (Audio Ducked)' : 'Turn On Mic Ducking'}
        >
          <Mic className="w-5 h-5" />
        </button>
      </div>

      {/* Master Volume Slider */}
      <div className="flex items-center gap-3 bg-dark-900/80 px-3.5 py-2.5 rounded-2xl border border-dark-600/50">
        <button
          onClick={toggleMute}
          className="touch-btn text-muted hover:text-white transition"
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted || volume === 0 ? (
            <VolumeX className="w-4 h-4 text-rose-400" />
          ) : (
            <Volume2 className="w-4 h-4 text-accent" />
          )}
        </button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={isMuted ? 0 : volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          className="w-full accent-accent touch-slider h-2 bg-dark-700 rounded-lg cursor-pointer"
        />
        <span className="font-mono text-xs font-semibold text-gray-300 w-10 text-right">
          {isMuted ? '0%' : `${Math.round(volume * 100)}%`}
        </span>
      </div>

      {/* Stereo VU Meter Component */}
      <VUMeter />
    </div>
  );
}
